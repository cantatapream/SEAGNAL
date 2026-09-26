#!/usr/bin/env python3
"""3-68ⓐ — **낱말이 갈라진 고시 raw 를 다시 받는다.** 선언: `_dashboard/pdf_wrapped_notices.json`

[무엇이 문제였나 — 2026-09-26, 3-6 을 하다 글자 단위로 막혔다]
  고시 7개 raw 가 **첨부 PDF 를 PyMuPDF 로 전사**한 것이라, 줄이 **낱말 중간에서** 끊긴다:
      `…보통모양의 선`  /  (빈 줄)  /  `형 및 주요 치수비를 …`
  기계로 이으면 「선 형」, 안 이으면 갈라진 채 남는다 — **어느 쪽도 원문이 아니다.**
  그래서 그 7개에서는 조문을 **원문 그대로 인용할 수 없었다**(3-6 은 표 참조만 넣었다).

[왜 고칠 수 있다고 보았나] 같은 파이프라인으로 받은 **5개는 정상폭**이다
  (선박구명설비 106.5자/줄 · 선박설비 99.5 · 선박소방설비 143.4 · 어선기관 57.4 · 어선설비 103.6).
  즉 깨끗하게 받는 길이 있다. 실측으로 세 갈래를 찾았다 —
    ⓐ**API 본문**   : 지금은 API 가 조문내용을 준다(FRP 24,778자 · 만재흘수선 28,296 · 전기설비 53,494).
                     FRP 실측 **평균 241.0자/줄 · 한낱말줄 3.2%** = 정상폭.
    ⓑ**HWPX 첨부**  : API 가 본문을 안 주는 고시. HWPX 는 **쪽 배치가 아니라 문단**을 담아 안 깨진다.
                     강선 실측 — `제3조(적용 등) ① … 보통모양의 **선형** 및 …` 온전.
    ⓒ**HWP(구형)**  : `.hwpx` 가 없는 것(어선구조기준) — 맨 뒤로 미룬다.
  ⚠**PDF 는 쓰지 않는다.** PDF 는 쪽에 배치된 줄을 담는다 — 그것이 지금 문제의 원인이다.
    같은 첨부에 PDF 와 HWPX 가 함께 있으면 **반드시 HWPX 를 고른다.**

[★쓰기 전에 「잃는 것이 없다」를 증명한다 — 과교정은 미교정보다 나쁘다]
  raw 를 통째로 바꾸는 일이라, 조용히 잃으면 아무도 모른다. 그래서 쓰기 전에 **생산 함수로** 본다:
    ① `article_text.extractAttachments` — 뒤에 붙은 **별표 블록**의 열쇠 집합.
       새것이 옛것을 **다 담아야** 한다(강선은 지금 36개다. 하나라도 빠지면 그 별표가 「미수집」이 된다).
    ② `article_text.extractArticleBlock` — 옛 파일에 있던 **조**가 새 파일에도 다 있어야 한다.
    ③ 줄 꼴 — 한낱말줄 비율이 **줄어야** 한다(늘면 더 나빠진 것이다).
  세 가지가 다 통과할 때만 쓴다. 하나라도 걸리면 **쓰지 않고 무엇이 빠지는지 적는다**(L-196).

[쓰는 법]
  python3 _dashboard/loop/admrul_rewrite_clean.py                 # 마른 실행 — 재 보고 안 쓴다
  python3 _dashboard/loop/admrul_rewrite_clean.py --apply         # 증명을 통과한 것만 쓴다
  python3 _dashboard/loop/admrul_rewrite_clean.py --only 강선의구조기준
[연계] 선언 ← `_dashboard/pdf_wrapped_notices.json` · 되돌리기 → `_touched.py --revert <기록>`
"""
import json, os, re, subprocess, sys, urllib.parse, xml.etree.ElementTree as ET, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '..', '..'))
REPO = os.path.abspath(os.path.join(LEGAL, '..', '..', '..'))
RAW = os.path.join(LEGAL, 'raw')
DECL = os.path.join(LEGAL, '_dashboard', 'pdf_wrapped_notices.json')
TMP = os.environ.get('SCRATCH') or '/tmp/admrul_clean'
os.makedirs(TMP, exist_ok=True)
OC = 'hyoo1431'
APPLY = '--apply' in sys.argv
ONLY = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
sys.path.insert(0, HERE)


def 받기(url, out):
    """curl 로 받는다 — 프록시 뒤에서 urllib 가 간헐적으로 끊긴다(실측)."""
    for _ in range(4):
        r = subprocess.run(['curl', '-sSL', '--max-time', '120', url,
                            '-H', 'User-Agent: Mozilla/5.0', '-o', out],
                           capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(out) and os.path.getsize(out) > 200:
            return True
    return False


def 고시파일찾기(이름):
    for r, _d, fs in os.walk(RAW):
        if '행정규칙' not in r:
            continue
        if 이름 + '.txt' in fs:
            return os.path.join(r, 이름 + '.txt')
    return None


JO_LINE = re.compile(r'^제\d+조(?:의\d+)?\s*\(')


def 줄꼴(text):
    """★무엇을 재야 하나 — 처음에 「한낱말줄 비율」로 쟀더니 **좋아진 것이 나빠 보였다**(실측).
    HWPX 는 **표 칸마다 한 문단**이라 짧은 줄이 많다. 그것은 낱말이 갈라진 것이 아니다.
    내가 고치려는 것은 **조문 문장이 줄 중간에서 끊기는 것**이다. 그래서 그것을 직접 잰다:
      `제N조(` 로 시작하는 줄의 **평균 길이**. PDF 전사는 그 줄이 한 뼘에서 끊겨 짧고,
      온전한 원문은 그 조의 첫 항이 한 줄에 다 들어와 길다.
    """
    ne = [l.strip() for l in text.split('\n') if l.strip()]
    jo = [l for l in ne if JO_LINE.match(l)]
    if not ne:
        return {'줄': 0, '평균자': 0.0, '조줄': 0, '조줄평균자': 0.0}
    return {'줄': len(ne), '평균자': round(sum(len(l) for l in ne) / len(ne), 1),
            '조줄': len(jo),
            '조줄평균자': round(sum(len(l) for l in jo) / len(jo), 1) if jo else 0.0}


def api본문(ID):
    p = os.path.join(TMP, f'adm_{ID}.json')
    if not 받기(f'https://www.law.go.kr/DRF/lawService.do?OC={OC}&target=admrul&ID={ID}&type=JSON', p):
        return None, None
    d = json.load(open(p, encoding='utf-8'))
    svc = d.get('AdmRulService', {})
    # ★`조문내용` 은 **문자열이 아니라 목록**이다 — 칸마다 조 하나(FRP 실측 93칸).
    #   처음에 `str()` 로 감싸 읽었더니 **파이썬 표기**(`['제1장 …', '제1조(…'`)를 원문으로 읽었고,
    #   태그를 걷는 정규식이 그것을 뭉개 **조문줄 0줄**이 나왔다(2026-09-26 실측).
    #   L-382 그 함정이다 — 값의 꼴을 안 보고 이름으로 짐작했다. 그래서 꼴을 갈라 다룬다.
    조 = svc.get('조문내용')
    if isinstance(조, list):
        조 = '\n'.join(str(x) for x in 조)
    조 = str(조 or '')
    att = svc.get('첨부파일') or {}
    names = att.get('첨부파일명') or []
    links = att.get('첨부파일링크') or []
    if isinstance(names, str):
        names = [names]
    if isinstance(links, str):
        links = [links]
    return 조, list(zip(names, links))


def api본문_글자(조):
    """API 조문내용은 HTML 조각이다. 태그만 줄바꿈으로 바꾸고 글자는 그대로 둔다."""
    t = re.sub(r'<\s*br\s*/?\s*>', '\n', str(조 or ''), flags=re.I)
    t = re.sub(r'<[^>]+>', '\n', t)
    t = (t.replace('&lt;', '<').replace('&gt;', '>').replace('&amp;', '&')
          .replace('&quot;', '"').replace('&nbsp;', ' '))
    out = [l.rstrip() for l in t.split('\n')]
    # 빈 줄이 여러 개 잇달면 하나로 — 글자는 건드리지 않는다
    res = []
    for l in out:
        if not l.strip() and (not res or not res[-1].strip()):
            continue
        res.append(l)
    return '\n'.join(res).strip()


def hwpx글자(path):
    z = zipfile.ZipFile(path)
    secs = sorted(n for n in z.namelist() if re.match(r'Contents/section\d+\.xml$', n))
    paras = []
    for s in secs:
        root = ET.fromstring(z.read(s))
        for p_ in root.iter():
            if not p_.tag.endswith('}p'):
                continue
            # ★①수식도 싣는다. HWPX 는 수식을 `<hp:equation><hp:script>sqrt {L}</hp:script>` 로 담는다 —
            #   `hp:t` 만 읽으면 **식이 통째로 사라진다**(강선 4,809개 · FRP 77개 실측).
            # ★②`<hp:t>` 는 **자식 요소를 가질 수 있다** — `<hp:t><hp:fwSpace/>  1. 낙하시험 : …</hp:t>`.
            #   ElementTree 는 자식 뒤의 글자를 부모의 `.text` 가 아니라 **그 자식의 `.tail`** 에 둔다.
            #   `t.text` 만 읽었더니 **그 호가 통째로 버려졌다**(강선 제8조의 낙하시험·해머링시험 요건 —
            #   2026-09-26 실측. 처음엔 「원본이 부실하다」고 오판했다. L-382 그 뿌리 — 값의 꼴).
            #   ⇒ `itertext()` 로 그 요소 안의 글자를 **전부** 모은다.
            buf = [''.join(t.itertext()) for t in p_.iter()
                   if (t.tag.endswith('}t') or t.tag.endswith('}script'))]
            line = ''.join(buf).rstrip()
            if not line.strip():
                continue
            # ★조 머리줄의 **앞 공백만** 뗀다. HWPX 에 `' 제32조(용골) …'` 처럼 한 칸 들여쓴 조가 있고
            #   (FRP 실측 3개 — 제32·35·61조), 생산 파서는 **줄머리의** `제N조(` 만 본다. 그대로 두면
            #   그 조가 파일에 있는데도 「없다」가 된다.
            #   ⚠항·호의 들여쓰기(`  ② …`·`   1. …`)는 뜻이 있으니 **건드리지 않는다.**
            #   글자는 한 자도 바뀌지 않는다 — 줄머리 공백만 없앤다.
            if re.match(r'^\s+제\d+조(?:의\d+)?\s*\(', line):
                line = line.lstrip()
            paras.append(line)
    return '\n'.join(paras)


# ★괄호를 **반드시** 요구한다. 처음엔 괄호를 선택으로 두었더니(`[\[…]?`) 본문 속 문장
#   `별표 1에 의한 것 이상이어야 한다.` 를 **블록 머리로 잘못 보고** 그 앞에서 잘랐다 —
#   그래서 조문 구역이 꼬리에 딸려 들어가 **파일이 두 번 들어갔다**(선박전기설비기준 +65%,
#   2026-09-26 실측). 증명 자는 「잃은 것」만 보므로 **중복을 못 잡았다.**
#   저장소가 아는 블록 머리 표기는 전부 괄호가 있다(`[별표1]`·〔별표 1〕·(별표 1)·【별표 1】·<별표 1>).
BYL_HEAD = re.compile(
    r'^\s*[\[〔【(「<]\s*(?:별표|별지|서식)\s*\d+(?:의\d+)?\s*[\]〕】)」>]'
    r'|^\s*[\[〔【(「<]\s*(?:별표|별지|서식)\s*[\]〕】)」>]')


def 별표꼬리(옛text):
    """옛 파일 뒤에 붙은 **별표 블록 구역**을 그대로 떼어 온다(첫 블록 머리줄부터 끝까지).

    ⚠자리 잡는 규칙이 느슨해도 된다 — 결과는 아래 증명이 본다(`extractAttachments` 로
      **옛 열쇠가 하나도 안 빠졌는지**). 규칙이 빗나가면 증명에서 걸려 쓰지 않는다.
    """
    L = 옛text.split('\n')
    for i, l in enumerate(L):
        if BYL_HEAD.match(l):
            return '\n'.join(L[i:])
    return ''


VISION_HEAD = re.compile(r'^【이미지판독\s*\d+】')
JO_HEAD = re.compile(r'^제\d+조(?:의\d+)?\s*\(')


def 판독블록들(옛text):
    """★옛 파일에 **우리가 이미지에서 판독해 채운 블록**이 있으면 그대로 옮긴다.

    무엇인가: `【이미지판독 152345889】` + `[산식]`/`[도해]` + 판독한 글 + 출처 기록.
      PDF 표추출이 망친 산식을 2026-08-16 에 **원본 이미지를 다시 받아 비전으로 판독해** 채운 것이다
      (G-9 수집 공백 후속). API·HWPX 본문에는 **없다** — 이미지라서 글자가 아니다.
    ⚠처음에 이것을 빼먹고 그냥 갈아 끼웠더니 **선박전기설비기준의 판독 블록 2개가 지워졌다**
      (제29조 발전기 절연저항 산식 등 — 2026-09-26 실측). 앞선 작업의 성과를 조용히 지우는 일이다.
    ⇒ 그래서 **어느 조에 붙어 있었는지**까지 같이 들고 가서 그 조 끝에 다시 붙인다.
    """
    L = 옛text.split('\n')
    out = []
    조 = None
    i = 0
    while i < len(L):
        if JO_HEAD.match(L[i]):
            m = re.match(r'^(제\d+조(?:의\d+)?)', L[i])
            조 = m.group(1) if m else 조
        if VISION_HEAD.match(L[i]):
            j = i + 1
            while j < len(L) and not JO_HEAD.match(L[j]) and not VISION_HEAD.match(L[j]):
                j += 1
            블록 = '\n'.join(L[i:j]).rstrip()
            out.append({'조': 조, '글': 블록})
            i = j
            continue
        i += 1
    return out


def 판독다시붙이기(몸통, 블록들):
    """그 조의 본문 끝(다음 조 머리줄 앞)에 다시 붙인다. 조를 못 찾으면 붙이지 않고 알린다."""
    못붙인 = []
    for b in 블록들:
        if not b['조']:
            못붙인.append('(조를 모른다)')
            continue
        if b['글'] in 몸통:
            continue
        L = 몸통.split('\n')
        k = next((n for n, l in enumerate(L) if l.startswith(b['조'] + '(')), None)
        if k is None:
            못붙인.append(b['조'])
            continue
        e = next((n for n in range(k + 1, len(L)) if JO_HEAD.match(L[n])), len(L))
        L[e:e] = ['', b['글'], '']
        몸통 = '\n'.join(L)
    return 몸통, 못붙인


def 머리줄(옛text, 새출처):
    """★우리가 붙인 머리줄은 그대로 살린다 — 운영·위키가 그 줄을 읽는다.
    `출처:`/`전사 방법 안내` 줄만 새것으로 바꾼다(옛 서술은 지우지 않고 아래에 남긴다)."""
    L = 옛text.split('\n')
    keep, 옛출처 = [], []
    for l in L[:14]:
        if l.startswith('[고시/행정규칙]') or l.startswith('ID:') or l.startswith('발령:') \
           or l.startswith('소관부서:') or l.startswith('현행화:'):
            keep.append(l)
        elif '출처:' in l or '전사 방법' in l:
            옛출처.append(l.strip())
    keep.append(새출처)
    for x in 옛출처:
        keep.append('※ 옛 기록(지우지 않는다): ' + x)
    keep.append('')
    return keep


MARK = '<<<답>>>'


def 생산(함수, 인자):
    """생산 함수를 부른다 — 자를 새로 만들지 않는다(L-136).

    ⚠`require('article_text.js')` 는 화면에 배너(`[Gemini] 키 0개 …`)를 먼저 찍는다.
      처음에 `stdout.find('[')` 로 JSON 을 찾았더니 **그 배너의 `[` 를 물어** 늘 빈 배열이
      나왔다(2026-09-26 실측 — 옛 파일의 별표가 0개로, 조가 전부 없는 것으로 보였다).
      그래서 **표식을 두고 그 뒤만 읽는다.** 값의 꼴을 안 보고 짐작하면 이렇게 된다(L-382).
    """
    at = os.path.join(REPO, 'local_server', 'services', 'article_text.js')
    code = ("const at=require(process.argv[1]);const a=JSON.parse(process.argv[2]);"
            "const fs=require('fs');const t=fs.readFileSync(a.f,'utf8');let out;"
            "if(a.fn==='atts'){out=at.extractAttachments(t).map(x=>x.key);}"
            "else if(a.fn==='jos'){out=[];for(const jo of a.joList){"
            "const b=at.extractArticleBlock(t,jo,'notice');"
            "if(b&&b.body&&b.body.trim())out.push(jo);}}"
            "else{out=[];for(const jo of a.joList){const b=at.extractArticleBlock(t,jo,'notice');"
            "out.push([jo,(b&&b.body?b.body.replace(/\\s/g,'').length:0)]);}}"
            "process.stdout.write('" + MARK + "'+JSON.stringify(out));")
    r = subprocess.run(['node', '-e', code, at, json.dumps({'fn': 함수, **인자}, ensure_ascii=False)],
                       capture_output=True, text=True, cwd=REPO)
    s = r.stdout
    i = s.find(MARK)
    if i < 0:
        return None
    try:
        return json.loads(s[i + len(MARK):].strip())
    except Exception:
        return None


def 조번호들(text):
    return list(dict.fromkeys(re.findall(r'(?:^|\n)(제\d+조(?:의\d+)?)\s*\(', text)))


def main():
    decl = json.load(open(DECL, encoding='utf-8'))
    from _touched import Touched
    touched = Touched('admrul_rewrite_clean')
    한것 = 막힌것 = 0
    보고 = []
    for it in decl['고시']:
        이름 = it['이름']
        if ONLY and ONLY != 이름:
            continue
        길 = it['길']
        old_p = 고시파일찾기(이름)
        if not old_p:
            보고.append(f"⚠raw 를 못 찾았다 — {이름}")
            막힌것 += 1
            continue
        옛 = open(old_p, encoding='utf-8').read()
        if 길 == 'hwp':
            보고.append(f"⏭️ {이름} — 구형 `.hwp` 뿐이라 미뤘다(선언에 그렇게 적혀 있다)")
            continue
        조, 첨부 = api본문(it['ID'])
        if 조 is None:
            보고.append(f"⚠API 를 못 불렀다 — {이름}")
            막힌것 += 1
            continue
        if 길 == 'api':
            몸통 = api본문_글자(조)
            # ★API 조문내용에는 **별표 블록이 없다.** 옛 파일 뒤에는 PDF 에서 전사한 별표 블록이
            #   붙어 있고(FRP 12개·만재흘수선 8개·전기설비 9개), 그냥 갈아 끼우면 **전부 사라진다**
            #   (2026-09-26 증명 자가 막았다). 고치려는 것은 **조문의 갈라진 낱말**이지 별표가 아니다.
            #   ⇒ 조문만 새로 받고 **별표 구역은 옛 파일에서 그대로 이어 붙인다.**
            #   자리를 찾는 규칙이 성한지는 아래 증명(`extractAttachments` 로 옛 열쇠가 다 남았나)이 본다.
            꼬리 = 별표꼬리(옛)
            if 꼬리:
                몸통 = 몸통.rstrip() + '\n\n' + 꼬리.strip()
            새출처 = (f"출처: 국가법령정보센터 행정규칙 API 조문내용 (target=admrul · ID={it['ID']}) "
                    f"— 2026-09-26 다시 받았다(3-68ⓐ). ★PDF 전사가 아니다 — 낱말이 갈라지지 않는다.")
        else:
            골 = [(n, l) for n, l in 첨부 if n.lower().endswith('.hwpx')
                  and it.get('첨부고르기', '') in n]
            if not 골:
                골 = [(n, l) for n, l in 첨부 if n.lower().endswith('.hwpx')]
            if not 골:
                보고.append(f"⚠HWPX 첨부가 없다 — {이름} (첨부: {[n for n, _ in 첨부]})")
                막힌것 += 1
                continue
            n, l = 골[0]
            p = os.path.join(TMP, f"{it['ID']}.hwpx")
            if not 받기(l, p):
                보고.append(f"⚠HWPX 를 못 받았다 — {이름} · {n}")
                막힌것 += 1
                continue
            몸통 = hwpx글자(p)
            새출처 = (f"출처: 국가법령정보센터 행정규칙 첨부 **HWPX** 전문 추출 «{n}» "
                    f"— 2026-09-26 다시 받았다(3-68ⓐ). ★PDF 가 아니라 HWPX 다 — "
                    f"PDF 는 쪽에 배치된 줄을 담아 낱말이 갈라진다.")
        # ── ★이미지판독 블록 다시 싣기 ────────────────────────────────────────
        판독 = 판독블록들(옛)
        if 판독:
            몸통, 못붙인 = 판독다시붙이기(몸통, 판독)
            if 못붙인:
                보고.append(f"❌ {이름} — 이미지판독 블록을 붙일 조를 못 찾았다: {못붙인[:5]} ⇒ 쓰지 않는다")
                막힌것 += 1
                continue
            보고.append(f"   ↻ {이름} — 이미지판독 블록 {len(판독)}개를 제 조 자리에 다시 실었다 "
                       + ' · '.join(f"{b['조']}" for b in 판독[:6]))

        # ── ★삭제 표시 살리기 (API 길에서만 생긴다) ──────────────────────────
        #   API `조문내용` 은 삭제된 조를 **머리줄만** 싣는다(`제71조(수밀격벽)`). 옛 파일에는
        #   본문에 `<삭제 2012.11.28>` 표시가 있었다. 그냥 갈아 끼우면 **사용자가 「이 조는
        #   삭제됐다」는 것을 알 수 없게 된다** — 머리만 남아 빈 조처럼 보인다.
        #   ⇒ 옛 파일에서 **그 `<삭제 …>` 표시 한 조각만** 그대로 옮긴다. 우리 자신의 앞선
        #     공식 전사본에서 가져오는 것이고, 무엇을 옮겼는지 파일 머리에 남긴다.
        #   ⚠표시가 `<삭제 …>` 꼴이 아니면 옮기지 않는다 — 옛 본문에는 PDF 가 쓸어 담은
        #     장 제목 같은 것이 섞여 있다(선박만재흘수선기준 제28조 실측).
        살린표시 = []
        for 조 in (it.get('삭제표시_살리기') or []):
            m0 = re.search(r'(?m)^' + re.escape(조) + r'\s*\([^)\n]*\)\s*$', 몸통)
            if not m0:
                continue
            옛블록 = re.search(r'(?m)^' + re.escape(조) + r'\s*\([^)\n]*\)([\s\S]{0,80})', 옛)
            표시 = re.search(r'<\s*삭제[^>]*>', 옛블록.group(1)) if 옛블록 else None
            if not 표시:
                continue
            몸통 = 몸통[:m0.end()] + ' ' + 표시.group(0) + 몸통[m0.end():]
            살린표시.append(f"{조}{표시.group(0)}")
        if 살린표시:
            보고.append(f"   ↻ {이름} — 삭제 표시를 옛 전사본에서 살렸다 {len(살린표시)}건: "
                       + ' · '.join(살린표시[:6]))

        # ── ★원본 오기 바로잡기 — 선언된 글자만, 기록을 남기고 ────────────────────
        #   HWPX 원본에 **한 글자 오기**가 있으면(`제727(브래킷)`·`재815조(적용)`) 생산 파서가
        #   그 조를 못 찾아 **옛 파일은 꺼낼 수 있던 조를 못 꺼내게 된다.** 그래서 바로잡는다 —
        #   다만 ⓐ선언에 적힌 그 글자만, ⓑ몇 번 바꿨는지 세고, ⓒ파일 머리에 남긴다.
        #   ⚠선언에 없는 오기를 만나면 **쓰지 않고 멈춘다**(내가 판단하지 않는다 · G-34).
        정정줄 = []
        for 정 in it.get('조머리_정정', []) or []:
            n = 몸통.count(정['HWPX'])
            if n == 0:
                보고.append(f"⚠{이름} — 선언한 오기를 원본에서 못 찾았다: «{정['HWPX']}» "
                           f"(원본이 바뀐 것일 수 있다 — 다시 봐야 한다)")
                n = -1
            else:
                몸통 = 몸통.replace(정['HWPX'], 정['바로잡음'])
            정정줄.append(f"※ 원본 오기 바로잡음({n}곳): «{정['HWPX']}» → «{정['바로잡음']}» "
                        f"— {정['무엇이']}. 근거: {정['근거']}")
        미선언 = sorted(set(re.findall(r'(?m)^\s*(제\d+(?:의\d+)?\(|재\d+(?:의\d+)?조\()', 몸통)))
        if 미선언:
            보고.append(f"❌ {이름} — **선언에 없는 조머리 오기**가 남았다: {미선언[:6]}  "
                       f"⇒ 쓰지 않는다. 선언(`pdf_wrapped_notices.json` 의 `조머리_정정`)에 "
                       f"근거와 함께 적은 뒤 다시 돌린다.")
            막힌것 += 1
            continue
        if 살린표시:
            정정줄.append("※ 삭제 표시를 옛 전사본에서 그대로 살렸다(" + str(len(살린표시)) + "건): "
                        + ' · '.join(살린표시)
                        + " — API 조문내용은 삭제된 조를 머리줄만 싣는다. 표시가 없으면 사용자가"
                          " 「이 조는 삭제됐다」는 것을 알 수 없다. 글을 새로 지은 것이 아니라"
                          " 우리 앞선 공식 전사본의 그 조각을 옮긴 것이다.")
        새 = '\n'.join(머리줄(옛, 새출처) + 정정줄 + ([''] if 정정줄 else [])) + '\n' + 몸통 + '\n'
        # ── 증명 세 가지 ───────────────────────────────────────────────
        tmp_new = os.path.join(TMP, f"new_{it['ID']}.txt")
        open(tmp_new, 'w', encoding='utf-8').write(새)
        옛별표 = 생산('atts', {'f': old_p}) or []
        새별표 = 생산('atts', {'f': tmp_new}) or []
        잃은별표 = [k for k in 옛별표 if k not in 새별표]
        # ★같은 기준으로 견준다 — 처음엔 「옛 파일에 적힌 조 번호 전부가 새것에서 **본문이 있는가**」로
        #   물었더니 14개가 빠진 것으로 나왔다. 열어 보니 전부 `제460조(삭제 2009.10.6)` 처럼
        #   **본문이 없는 삭제 조**였고 두 파일에 똑같이 있었다(2026-09-26 실측).
        #   그래서 **옛 파일에서 본문이 있던 조**만 골라, 그것이 새것에도 있는지 본다.
        옛조전체 = 조번호들(옛)
        옛본문조 = 생산('jos', {'f': old_p, 'joList': 옛조전체}) or []
        새본문조 = 생산('jos', {'f': tmp_new, 'joList': 옛본문조}) or []
        잃은조_전부 = [j for j in 옛본문조 if j not in 새본문조]
        # ★선언된 것만 통과시킨다 — 까닭과 판정을 사람이 적어 둔 것만(위 `_본문이_없어지는_조가_무엇인가`)
        봐준조 = {x['조']: x for x in (it.get('본문이_없어지는_조') or [])}
        잃은조 = [j for j in 잃은조_전부 if j not in 봐준조]
        봐준것 = [j for j in 잃은조_전부 if j in 봐준조]
        새조전체 = 조번호들(새)
        잃은번호 = [j for j in 옛조전체 if j not in 새조전체]
        # ★조 단위 본문 길이를 견준다 — 이것이 없어서 **FRP 제14조의 ②~⑥ 항이 사라진 것**(473→75자)을
        #   못 잡았다. 「본문이 있나」만 물으면 한 항만 남아도 통과한다(2026-09-26 실측).
        옛길이 = dict(생산('lens', {'f': old_p, 'joList': 옛본문조}) or [])
        새길이 = dict(생산('lens', {'f': tmp_new, 'joList': 옛본문조}) or [])
        봐준쪼그라듦 = {x['조'] for x in (it.get('쪼그라들어도_되는_조') or [])}
        쪼그라든조 = [(j, 옛길이.get(j, 0), 새길이.get(j, 0)) for j in 옛본문조
                  if 옛길이.get(j, 0) >= 120 and 새길이.get(j, 0) < 옛길이.get(j, 0) * 0.7
                  and j not in 봐준쪼그라듦]
        ㄱ, ㄴ = 줄꼴(옛), 줄꼴(새)
        # 조문 줄이 **길어졌으면** 끊겼던 문장이 이어진 것이다(1.3배를 문턱으로 둔다 — 실측 근거는 아래).
        # ⚠조문줄 **개수**로 견주면 안 된다 — PDF 전사는 쪽이 넘어갈 때 조 머리줄을 **한 번 더** 찍어
        #   옛것이 더 많아 보인다(강선 1034 vs 1030). 그래서 개수는 **조 번호 집합**으로 보고(위 잃은번호),
        #   줄 꼴은 **조문줄 평균 길이**로 본다.
        좋아졌나 = ㄴ['조줄평균자'] >= ㄱ['조줄평균자'] * 1.3
        # ★「잃지 않았다」만 보면 **두 번 들어간 것**을 못 잡는다(실측으로 겪었다).
        #   그래서 글자 수도 본다 — 조 수가 같은데 글자가 1.25배를 넘으면 중복을 의심한다.
        옛자, 새자 = len(re.sub(r'\s', '', 옛)), len(re.sub(r'\s', '', 새))
        조수같나 = len(조번호들(옛)) == len(새조전체)
        불었나 = 조수같나 and 새자 > 옛자 * 1.25
        옛판독 = len(re.findall(r'【이미지판독\s*\d+】', 옛))
        새판독 = len(re.findall(r'【이미지판독\s*\d+】', 새))
        판독잃음 = 새판독 < 옛판독
        ok = ((not 잃은별표) and (not 잃은조) and (not 잃은번호) and 좋아졌나
              and (not 불었나) and (not 판독잃음) and (not 쪼그라든조))
        보고.append(
            f"{'✅' if ok else '❌'} {이름}  ({길})\n"
            f"       조문줄  옛 {ㄱ['조줄']}줄·평균{ㄱ['조줄평균자']}자  →  "
            f"새 {ㄴ['조줄']}줄·평균{ㄴ['조줄평균자']}자  {'(문장이 이어졌다)' if 좋아졌나 else '★안 좋아졌다'}\n"
            f"       별표  옛 {len(옛별표)}개 → 새 {len(새별표)}개 · 잃은 것 {len(잃은별표)}"
            + (f" {잃은별표[:8]}" if 잃은별표 else "") + "\n"
            f"       조본문 30%% 넘게 쪼그라든 조 {len(쪼그라든조)}"
            + (("  ★" + ' '.join(f"{j}({a}→{b}자)" for j, a, b in sorted(쪼그라든조, key=lambda x: x[1]-x[2], reverse=True)[:4])) if 쪼그라든조 else "") + "\n"
            f"       판독  이미지판독 블록 옛 {옛판독}개 → 새 {새판독}개"
            + ("  ★줄었다 — 앞선 재수집의 성과를 지우는 것이다" if 판독잃음 else "") + "\n"
            f"       글자  옛 {옛자:,}자 → 새 {새자:,}자 ({100*(새자-옛자)/max(1,옛자):+.1f}%)"
            + ("  ★조 수가 같은데 글자가 25% 넘게 늘었다 — 두 번 들어갔는지 본다" if 불었나 else "") + "\n"
            f"       조    옛 본문 있는 조 {len(옛본문조)}개 중 새것에 없는 것 {len(잃은조)}"
            + (f" {잃은조[:8]}" if 잃은조 else "")
            + f" · 번호 자체가 사라진 조 {len(잃은번호)}"
            + (f" {잃은번호[:8]}" if 잃은번호 else "")
            + (("\n       봐준 조 " + ' · '.join(f"{j}({봐준조[j]['판정']})" for j in 봐준것)
                + "  ← 선언에 까닭이 적혀 있다") if 봐준것 else ""))
        if ok and APPLY:
            open(old_p, 'w', encoding='utf-8').write(새)
            touched.add(old_p)
            한것 += 1
        elif not ok:
            막힌것 += 1
    print(f"\n  ── 3-68ⓐ 다시 받기 {'(실제로 썼다)' if APPLY else '(마른 실행 — 쓰지 않았다)'} ──")
    for b in 보고:
        print('  ' + b)
    print(f"\n  통과해서 쓴 것 {한것} · 막힌 것 {막힌것}")
    if APPLY and 한것:
        touched.save()
    return 1 if 막힌것 else 0


if __name__ == '__main__':
    sys.exit(main())
