#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""나리야 법률 챗봇 검색+답변 프로토타입 (순수 코드, 임베딩 키 불필요).
   - glossary 구어매핑 + 제목/정의/의무 키워드 스코어로 concept 라우팅
   - concept에서 ⚠요약 / 통상처벌 / 벌칙체계(1·2·3차) 파싱
   - _CHATBOT.md 점진적 공개대로 [1차 답] → [되물음] → [확장 답] 구성
   실행: python3 chatbot_proto.py "질문"   (질문 없으면 데모 4문항)
"""
import os,re,sys,glob
LEGAL='/home/user/SEAGNAL/local_server/knowledge/legal'
CDIR=f'{LEGAL}/wiki/concepts'

# ---------- 로드 ----------
def load_concepts():
    docs=[]
    for p in glob.glob(f'{CDIR}/*.md'):
        try: t=open(p,encoding='utf-8').read()
        except: continue
        law=os.path.basename(p).split('__')[0]
        m=re.search(r'^#\s+(.+)$',t,re.M); title=m.group(1).strip() if m else os.path.basename(p)[:-3]
        mid=re.search(r'^id:\s*(.+)$',t,re.M); cid=mid.group(1).strip() if mid else os.path.basename(p)[:-3]
        # ⚠ 요약(첫 > ⚠ 블록)
        ms=re.search(r'>\s*⚠[^\n]*\*\*[^\n]*\n?((?:>[^\n]*\n?)*)',t)
        summ=''
        msum=re.search(r'>\s*⚠.*?\.\*\*\s*(.+?)\n',t,re.S)
        if msum: summ=re.sub(r'\s+',' ',msum.group(1)).strip()[:400]
        docs.append({'path':p,'law':law,'title':title,'id':cid,'text':t,'summary':summ})
    return docs

def load_glossary():
    g={}
    p=f'{LEGAL}/wiki/_glossary.md'
    if not os.path.exists(p): return g
    for line in open(p,encoding='utf-8'):
        m=re.match(r'\|\s*([^|]+?)\s*\|\s*\[\[([^\]]+)\]\]',line)
        if not m: continue
        target=m.group(2).split('|')[0].strip()
        for term in re.split(r'[,·/]',m.group(1)):
            term=term.strip()
            if term and term!='구어·별칭': g[term]=target
    return g

# ---------- 검색 ----------
STOP=set('안 못 돼 되나 되나요 되요 된다 하면 할 하나 나요 어떻게 어떡해 그 이 저 좀 뭐 무슨 어떤 때 경우 배 바다 에서 에게 으로 로 은 는 이 가 을 를 도 만 의 및 또 또는 관련 대한'.split())
def norm(s): return re.sub(r'[\s,.?!·/()]+','',s)
def content_toks(q):
    return [w for w in re.split(r'[\s,.?!()]+',q) if len(w)>=2 and w not in STOP]

def search(q,docs,gloss,k=3):
    scores={}
    nq=norm(q)
    # 1) glossary 구어매핑 (강한 신호, 띄어쓰기 무시)
    for term,target in gloss.items():
        if norm(term) and norm(term) in nq:
            tgt=target.replace('[[','').replace(']]','')
            for d in docs:
                if tgt in d['id'] or tgt in d['path'] or tgt in d['title']:
                    scores[d['path']]=scores.get(d['path'],0)+50
    # 2) 키워드 스코어 (제목 매우 높게, 본문 낮게, 불용어 제외)
    toks=content_toks(q)
    for d in docs:
        nt=norm(d['title']); body=d['text'][:1500]
        s=scores.get(d['path'],0)
        for w in toks:
            if norm(w) in nt: s+=15      # 제목 히트: 강함
            elif w in body:   s+=2       # 본문 상단
            elif w in d['text']: s+=1
        if s: scores[d['path']]=s
    top=sorted(scores.items(),key=lambda x:-x[1])[:k]
    return [(next(d for d in docs if d['path']==p),sc) for p,sc in top]

# ---------- 처벌 파싱 ----------
def parse_headline_penalty(t):
    """## 위반 시 처벌 표 첫 행에서 처벌 내용."""
    sec=re.search(r'##\s*위반 시 처벌(.+?)(?:\n##|\Z)',t,re.S)
    if not sec: return None
    rows=re.findall(r'\|([^|\n]+)\|([^|\n]+)\|([^|\n]+)\|',sec.group(1))
    for r in rows:
        cell=r[2].strip()
        if cell and '처벌 내용' not in cell and '---' not in cell:
            return cell.replace('**','').strip()
    return None

def parse_tiered(t):
    """## 벌칙 체계 등에서 1차/2차/3차 컬럼이 있으면 (헤더, [행...]) 반환."""
    for sec in re.findall(r'##\s*[^\n]*(?:벌칙 체계|행정처분 체계)[^\n]*(.+?)(?:\n##|\Z)',t,re.S):
        if re.search(r'\b1차\b',sec) and re.search(r'\b2차\b',sec):
            lines=[l for l in sec.splitlines() if l.strip().startswith('|') and '---' not in l]
            if len(lines)>=2: return lines
    return None

# ---------- 답변 구성 ----------
def answer(q,docs,gloss):
    hits=search(q,docs,gloss)
    if not hits or hits[0][1]<3:
        cand=', '.join('%s(%d)'%(h['title'],s) for h,s in hits) if hits else '없음'
        return '[Q] %s\n  → 위키에서 확실한 개념을 못 찾음(확인되지 않음으로 응답). 후보: %s'%(q,cand)
    d,sc=hits[0]
    out=['[Q] %s'%q, '  ┌ 매칭 concept: 「%s」  (score %d, id=%s)'%(d['title'],sc,d['id'])]
    if d['summary']: out.append(f'  │ ⚠요약: {d["summary"]}')
    head=parse_headline_penalty(d['text'])
    tier=parse_tiered(d['text'])
    # [1차 답]
    out.append('  │')
    out.append('  │ [1차 답 — 통상/대표값]')
    if tier:
        out.append('  │   "이건 단속 횟수/상황에 따라 처분이 달라져요.')
        first=tier[1] if len(tier)>1 else tier[0]
        cols=[c.strip() for c in first.strip('|').split('|')]
        out.append(f'  │    보통 최초(1차)엔 → {cols[2] if len(cols)>2 else cols[-1]} 수준입니다.')
        out.append('  │    2차·3차 이후는 더 무거워지는데, 그 부분도 알려드릴까요?"  ← 되물음')
    elif head:
        out.append(f'  │   "{head}" (출처 인용) — 단일 처벌이라 점진 공개 불필요')
    else:
        out.append('  │   (이 개념은 처벌 표가 없음 → 의무/정의 중심 답)')
    # [확장 답]
    if tier:
        out.append('  │')
        out.append('  │ [확장 답 — 사용자가 "응/전부/3차는?" 하면]')
        for l in tier: out.append('  │   '+l.strip())
    # 관련 개념(그래프 홉 자리)
    if len(hits)>1:
        out.append('  │')
        out.append('  └ 관련(추가 제안): '+', '.join('「%s」'%h['title'] for h,_ in hits[1:]))
    else:
        out.append('  └')
    return '\n'.join(out)

if __name__=='__main__':
    docs=load_concepts(); gloss=load_glossary()
    print(f'# concept {len(docs)}개 · glossary {len(gloss)}개 구어 로드\n')
    qs=sys.argv[1:] or [
        '구명조끼 안 입으면 어떻게 돼?',
        '승선원 바뀌었는데 변동신고 안 하면?',
        '술 먹고 배 몰면 어떻게 되나요',
        '조개껍데기 바다에 버려도 되나',
    ]
    for q in qs:
        print(answer(q,docs,gloss)); print()
