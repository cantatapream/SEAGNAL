#!/usr/bin/env python3
"""
27차 라운드 — 프로덕션 챗봇에 골든 질문을 실제로 물어 근거가 나오는지 잰다.

[왜] golden_eval.js 는 **위키 안에서** "기대 조문이 인용 후보에 드는가"를 잰다(무료·오프라인).
     그런데 2026-08-18 실측(L-112)에서 그 판정과 **실제 챗봇 답변이 52% 어긋났다.**
     이 스크립트는 같은 질문을 **운영 서버에 그대로 물어** 그 격차를 다시 잰다.

[채점] AI 를 쓰지 않는다(L-133: 채점자가 AI 면 라운드 간 42% 가 뒤집힌다). 문자열 대조만 한다.
  confirmed      기대 법령 + 기대 조문이 챗봇이 내놓은 근거줄(citationChain)에 있다
  wrong_article  기대 법령은 왔는데 조문이 다르다
  no_evidence    근거줄이 비었거나 기대 법령이 없다
  clarify        되묻기만 하고 답을 주지 않았다
  error          호출 실패

[한계 — 이 자가 못 재는 것]
  · 답변 문장의 사실 정확성은 안 잰다(근거줄이 맞는지만 본다).
  · 되묻기는 1회까지만 자동으로 이어간다. 2단 이상 되물으면 clarify 로 끝난다.
"""
import json, re, sys, time, urllib.request, urllib.error, os
API='https://seagnal-server.fly.dev/api/legal/ask'
def norm(s): return re.sub(r'[\s·ㆍ()「」]','',s or '')
def arts(s):
    return [a for a in re.findall(r'제\d+조(?:의\d+)?', s or '')]

def call(payload, tries=3):
    data=json.dumps(payload,ensure_ascii=False).encode()
    for t in range(tries):
        try:
            req=urllib.request.Request(API,data=data,headers={'Content-Type':'application/json'})
            with urllib.request.urlopen(req,timeout=180) as r:
                raw=r.read().decode('utf-8',errors='replace')
            objs=[json.loads(l) for l in raw.splitlines() if l.strip().startswith('{')]
            done=[o for o in objs if o.get('type')=='done']
            return done[-1] if done else (objs[-1] if objs else None)
        except Exception as e:
            if t==tries-1: return {'_error':str(e)}
            time.sleep(2**t)

# 서버가 "내 쪽 사정으로 답을 못 만들었다"고 알려 오는 문구들. 이건 챗봇의 실력이 아니라
# **잴 수 없었던 것**이므로 감점하지 않고 skipped 로 뺀다(L-263).
UNMEASURABLE = ('쿨다운', '답변 생성 실패', 'quota', 'rate limit', '429', '일시적 오류')

def score(res, q):
    if not res or res.get('_error'): return 'error', [], str(res.get('_error')) if res else 'no response'
    note=str(res.get('note') or '')
    if any(t in note for t in UNMEASURABLE):
        return 'skipped', [], note
    chain=res.get('citationChain') or []
    got=[f"{c.get('law')} {c.get('citedArticle') or c.get('article')}" for c in chain]
    if not chain:
        return ('clarify' if res.get('clarify') else 'no_evidence'), got, str(res.get('note') or '')
    want_law=norm(q['expect_law']); want_arts=set(arts(q['expect_article']))
    lawhit=[c for c in chain if norm(c.get('law'))==want_law or want_law in norm(c.get('law')) or norm(c.get('law')) in want_law]
    if not lawhit: return 'no_evidence', got, ''
    for c in lawhit:
        ca=set(arts(c.get('citedArticle') or '')) | set(arts(c.get('article') or ''))
        if ca & want_arts: return 'confirmed', got, ''
    return 'wrong_article', got, ''

def run(qs, outp):
    out=[]
    if os.path.exists(outp):
        out=[json.loads(l) for l in open(outp,encoding='utf-8') if l.strip()]
    done={ (o['law'],o['question']) for o in out }
    fh=open(outp,'a',encoding='utf-8')
    for i,q in enumerate(qs,1):
        if (q['law'],q['question']) in done: continue
        t0=time.time()
        res=call({'query':q['question']})
        # 되묻기 자동 이어가기 — **실제 앱(client/js/ai-chat/ai_chat.js pickClarifyOption)과 똑같이** 한다.
        #   앱이 하는 것: ①질문 문장은 **원래 질문 그대로 두고** ②선택지의 ctx 를 직전 맥락(lastCtx=
        #   서버가 준 ctxNext) **위에 얹어**(mergeCtx) 다시 보낸다. ctx 없는 선택지는 질문 뒤에
        #   ' — 라벨'을 붙이고 lastCtx 만 보낸다.
        #   ⚠처음엔 query 에 선택지 라벨을 넣고 ctx 를 갈아끼웠는데, 그러면 서버가 같은 축을 계속
        #     다시 물어 무한 되묻기처럼 보였다. 앱과 다른 방식으로 재면 앱의 문제가 아니라 내 문제를
        #     재게 된다.
        #   되묻기는 2단계 이상일 수 있어(이해확인 → 상황확인 → …) 최대 5회까지 이어간다(L-112 교훈 ③).
        lastctx = res.get('ctxNext') if res else None
        qtext = q['question']
        hist=[{'role':'user','content':q['question']}]
        rounds=0
        for _ in range(10):   # 서버 상한(CLARIFY_MAX_ROUNDS=5)보다 넉넉해야 한다 —
                              # 5 로 두었더니 '서버는 답을 냈는데 내가 안 받은' 경우가 생겼다(발견 03).
            cl=(res or {}).get('clarify')
            opts=(cl or {}).get('options') or []
            if not cl or not opts: break
            good=[o for o in opts
                  if o.get('act') not in ('ask','unknown')
                  and not str(o.get('label','')).startswith(('아니요','잘 모르'))]
            opt=good[0] if good else opts[0]
            octx=opt.get('ctx')
            if octx:
                sendq=qtext
                ctx=dict(lastctx or {}); ctx.update(octx)
            else:
                sendq=(qtext + ' — ' + str(opt.get('label') or '')).strip()
                ctx=lastctx or {}
            hist.append({'role':'assistant','content':(res.get('answer') or '')[:400]})
            nxt=call({'query':sendq,'ctx':ctx,'lastQuestion':cl.get('question'),'history':hist[-6:]})
            hist.append({'role':'user','content':str(opt.get('label') or '')})
            if not nxt: break
            res=nxt; rounds+=1
            lastctx = res.get('ctxNext') or lastctx
            if res.get('citationChain'): break
        v,got,note=score(res,q)
        # 한도 표시가 3번 연달아 나오면 스스로 멈춘다 — 더 두드려 봐야 남의 한도만 태운다(L-263).
        if v=='skipped':
            run.streak=getattr(run,'streak',0)+1
            if run.streak>=3:
                print('!! 서버 한도 표시가 3연속 — 여기서 멈춘다. 남은 문항은 나중에 다시 잰다.', flush=True)
                fh.close(); return
        else:
            run.streak=0
        rec={'law':q['law'],'question':q['question'],'expect_law':q['expect_law'],
             'expect_article':q['expect_article'],'verdict':v,'got':got,
             'answer':str(((res or {}).get('answer') or ''))[:400],'note':note,'clarify_rounds':rounds,
             'sec':round(time.time()-t0,1)}
        fh.write(json.dumps(rec,ensure_ascii=False)+'\n'); fh.flush()
        print(f"[{i}/{len(qs)}] {v:14s} {q['law'][:16]:16s} {q['question'][:44]}", flush=True)
    fh.close()

if __name__=='__main__':
    legal='/home/user/SEAGNAL/local_server/knowledge/legal'
    j=json.load(open(f'{legal}/_dashboard/loop/pinned/golden_questions.json'))
    qs=j if isinstance(j,list) else j['questions']
    a=int(sys.argv[1]) if len(sys.argv)>1 else 0
    b=int(sys.argv[2]) if len(sys.argv)>2 else len(qs)
    run(qs[a:b], sys.argv[3] if len(sys.argv)>3 else '/tmp/live27.jsonl')
