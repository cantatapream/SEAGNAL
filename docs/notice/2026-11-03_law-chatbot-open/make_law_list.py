#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""make_law_list.py — 공지 첨부 「해양법령 도우미에 들어 있는 법령 목록」을 원문 폴더에서 기계로 센다(읽기 전용).

[쓰는 법] python3 docs/notice/2026-11-03_law-chatbot-open/make_law_list.py
          → 같은 폴더에 law_list.csv · law_list.html 을 쓴다(PDF 는 law_list.html 을 Playwright page.pdf 로).

[세는 법 — 저장소가 이미 쓰는 정의를 따른다. 새 정의를 만들지 않는다]
 ① 해양 분야 기준 법률 = wiki/statutes/*.md (collect_eval.js lawDirs 와 같은 정의, 74개).
    같은 이름 폴더가 둘이면 법률.txt 조문이 많은 쪽(collect_eval.js 와 같은 규칙).
 ② 시행령·시행규칙 「있음」 = 그 폴더 _meta.json families 가 가리키는 파일(collect_eval.js expectedCore 규칙)이
    실제로 있고 본문이 30자 이상(collect_eval.js EMPTY_CHARS). families 값이 「없음 — …」 같은 글이면 그 계층은 없다.
    보충 1: families 에 계층이 있는데 「파일」 칸이 비었으면 폴더 맨 위 <계층>.txt 를 본다(해양수산발전 기본법 시행규칙 — 이름이 다른 규칙).
    _대기(시행 전 예고본)·_구판(옛 판)·_이미지·별표 폴더는 세지 않는다.
 ③ 「일부 조문만」 = _dashboard/loop/_excerpt.py excerpt_reason (파일이 스스로 발췌라고 밝혔나) — 저장소의 단일 판정 자리.
    보충 2: 그 표시가 없어도 조문 번호가 제1조부터 이어지지 않으면(서로 다른 조 번호 수 < 가장 큰 조 번호의 90%) 일부로 본다.
 ④ 그 밖의 법령 = raw/15_관련타부처 와 다른 분야 폴더 가운데 기준 법률이 아닌 폴더. 「<법>시행령」 같은 폴더는 그 법으로 묶는다.
    고시·행정규칙 파일만 든 폴더는 목록에서 뺀다(사장님 지시: 고시 제외). 국제 협약은 따로 묶는다.
 ⑤ 행정규칙(고시·훈령 등) = raw/**/행정규칙/*.txt 머리글 「ID:」 의 서로 다른 번호 수(목록 없음, 개수만).
 ⑥ 자치법규(조례·규칙) = raw/_자치법규/<시도>/<조례>/ 폴더 수(목록 없음, 개수만).
"""
import csv, html, json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
LEGAL = os.path.abspath(os.path.join(HERE, '../../../local_server/knowledge/legal'))
RAW = os.path.join(LEGAL, 'raw')
sys.path.insert(0, os.path.join(LEGAL, '_dashboard', 'loop'))
from _excerpt import excerpt_reason  # noqa: E402

DOMAIN_NAME = {
    '01_해양주권정책': '해양 주권·정책', '02_해양경비구조': '해양 경비·구조', '03_해상교통안전': '해상 교통 안전',
    '04_선박해운': '선박·해운', '05_수산어업': '수산·어업', '06_선원노동': '선원·노동', '07_해양환경생태': '해양 환경·생태',
    '08_섬영토': '섬·영토', '09_레저관광': '해양 레저·관광', '10_항만물류': '항만·물류', '11_해양신산업': '해양 신산업',
    '12_수산물유통': '수산물 유통', '13_공공기관': '해양 공공기관', '14_해양사법': '해양 사고·배상',
    '15_관련타부처': '다른 부처 소관(전문 보유)',
}
SKIP_FILE = re.compile(r'구판|연혁|종전|_MST\d')      # 옛 판 사본은 목록 근거로 쓰지 않는다
RULE_FILE = re.compile(r'^(행정규칙|고시)')           # 고시·행정규칙 파일 → 목록 제외(개수만)
RULE_HEAD = re.compile(r'target=admrul|\[(고시|훈령|예규)|(훈령|예규|고시) 제\s*[\d-]+호')  # 머리말이 행정규칙이라 밝힌 파일도 제외


def read(p, n=None):
    try:
        with open(p, encoding='utf-8') as f:
            return f.read(n) if n else f.read()
    except Exception:
        return None


def arts(p):
    t = read(p)
    return len(re.findall(r'^\[제\d+조', t, re.M)) if t else 0


def body_chars(p):  # collect_eval.js bodyChars 와 같은 규칙
    t = read(p)
    if t is None:
        return -1
    t = re.sub(r'^\[[^\]]*\][^\n]*\n', '', t, count=1)
    t = re.sub(r'^(ID:|소관부서|발령|출처|시행)[^\n]*\n', '', t, flags=re.M)
    t = re.sub(r'\n--\n출처:[\s\S]*$', '', t)
    t = re.sub(r'^[⚠※][^\n]*(?:\n[ \t]+[^\n]*)*\n?', '', t, flags=re.M)
    return len(t.strip())


def partial_reason(p):
    """일부 조문만인가 — ③ 규칙. 아니면 ''."""
    r = excerpt_reason(p)
    if r:
        return r
    t = read(p) or ''
    nums = [int(x) for x in re.findall(r'^\[제(\d+)조(?!의)', t, re.M)]
    if nums:
        mx = max(nums)
        if 1 not in nums or len(set(nums)) < 0.9 * mx:
            return '조문 번호가 이어지지 않음'
    return ''


def meta_of(d):
    try:
        return json.load(open(os.path.join(d, '_meta.json'), encoding='utf-8'))
    except Exception:
        return {}


def expected_core(meta, lp):  # collect_eval.js expectedCore + 보충 1
    out = []
    for k, v in ((meta or {}).get('families') or {}).items():
        if k.endswith('_비고'):
            continue
        b = re.sub(r'\(.*?\)', '', k).strip()
        if b not in ('법률', '시행령', '시행규칙') or isinstance(v, str):
            continue
        items = v if isinstance(v, list) else [v]
        for x in items:
            if not isinstance(x, dict):
                continue
            f = str(x.get('파일') or '').strip()
            if not f and os.path.exists(os.path.join(lp, b + '.txt')):
                f = b + '.txt'   # 보충 1
            if f.endswith('.json'):
                f = f[:-5] + '.txt'
            if f.endswith('.txt'):
                out.append((b, f))
    return out


def spaced_name(folder, texts, meta):
    """보여 줄 이름 — _meta.json 법령명 → 파일 머리에서 폴더 이름을 띄어쓰기 허용으로 찾은 글 → 폴더 이름."""
    nm = meta.get('법령명') or meta.get('조약명')
    if nm:
        return re.sub(r'\s+', ' ', nm).strip()
    key = re.sub(r'_.*$', '', folder)
    pat = r'[\sㆍ·]*'.join(re.escape(c) for c in key)
    for t in list(texts) + [json.dumps(meta, ensure_ascii=False)]:
        m = re.search(pat, t or '')
        if m:
            return re.sub(r'\s+', ' ', m.group(0)).strip()
    return key


base = sorted(f[:-3] for f in os.listdir(os.path.join(LEGAL, 'wiki', 'statutes')) if f.endswith('.md'))
baseset = set(base)
chosen = {}
for dom in sorted(os.listdir(RAW)):
    dp = os.path.join(RAW, dom)
    if not os.path.isdir(dp):
        continue
    for law in sorted(os.listdir(dp)):
        lp = os.path.join(dp, law)
        if law not in baseset or not os.path.exists(os.path.join(lp, '_meta.json')):
            continue
        n = arts(os.path.join(lp, '법률.txt'))
        if law in chosen and n <= chosen[law][2]:
            continue
        chosen[law] = (dom, lp, n)

base_rows = []
for law in base:
    dom, lp, _ = chosen[law]
    meta = meta_of(lp)
    have = {'법률': [], '시행령': [], '시행규칙': []}
    for b, f in expected_core(meta, lp):
        p = os.path.join(lp, f)
        if os.path.exists(p) and body_chars(p) >= 30:
            have[b].append(p)
    st = {}
    for b, ps in have.items():
        if not ps:
            st[b] = '없음'
        elif all(partial_reason(p) for p in ps):
            st[b] = '일부 조문만'
        else:
            st[b] = '있음'
    base_rows.append(dict(분야=DOMAIN_NAME[dom], _d=dom, 이름=spaced_name(law, [], meta), **st))
base_rows.sort(key=lambda r: (r['_d'], r['이름']))

# ── 그 밖의 법령 ──
groups = collections.OrderedDict()   # 묶음 키 → {name, files:[(층, 경로)], treaty}


def add_folder(lp, folder, treaty_hint=False):
    meta = meta_of(lp)
    files = [f for f in sorted(os.listdir(lp)) if f.endswith('.txt') and not SKIP_FILE.search(f)]
    texts = [read(os.path.join(lp, f), 2000) for f in files]
    keep = [f for f, t in zip(files, texts) if not RULE_FILE.match(f) and not RULE_HEAD.search((t or '')[:400])]
    if not keep:
        return
    name = spaced_name(folder, texts, meta)
    treaty = treaty_hint or any(f.startswith('조약') for f in keep) or bool(re.search(r'협약|의정서', folder))
    key = re.sub(r'\s*(시행령|시행규칙)$', '', name).replace(' ', '')
    if key in baseset:
        return   # 기준 법률은 위 표가 전문으로 다룬다(같은 법의 발췌 사본은 따로 적지 않는다)
    g = groups.setdefault(key, dict(name=re.sub(r'\s*(시행령|시행규칙)$', '', name), files=[], treaty=treaty))
    g['treaty'] = g['treaty'] or treaty
    suffix = re.search(r'(시행령|시행규칙)$', name)
    for f in keep:
        layer = re.match(r'[^_.]+', f).group(0)
        if suffix and layer == '법률':
            layer = suffix.group(1)          # 「…시행령」 폴더의 본문 파일
        g['files'].append((layer, os.path.join(lp, f)))


for dom in sorted(os.listdir(RAW)):
    dp = os.path.join(RAW, dom)
    if not os.path.isdir(dp) or dom == '_자치법규':
        continue
    for law in sorted(os.listdir(dp)):
        lp = os.path.join(dp, law)
        if not os.path.isdir(lp) or law in baseset:
            continue
        if law == '국제협약_유류오염관련':   # 협약 넷이 하위 폴더에 있다
            for sub in sorted(os.listdir(lp)):
                if os.path.isdir(os.path.join(lp, sub)):
                    add_folder(os.path.join(lp, sub), sub, True)
            continue
        add_folder(lp, law)

LAYER_LABEL = {'법률': '법', '시행령': '시행령', '대통령령': '시행령', '시행규칙': '시행규칙'}
ORDER = ['협약 본문', '법', '본문', '시행령', '시행규칙']
other_rows = []
for key, g in groups.items():
    full = [p for _, p in g['files'] if not partial_reason(p)]
    lay = collections.OrderedDict()          # 칸 이름 → 그 칸 파일이 전부 일부 조문만인가
    for layer, p in g['files']:
        lab = '협약 본문' if g['treaty'] else LAYER_LABEL.get(layer, '본문')
        if lab == '법' and not re.search(r'법(률)?$', g['name']):
            lab = '본문'                       # 이름이 법이 아닌 규정·규칙·등록령의 본문
        lay[lab] = lay.get(lab, True) and bool(partial_reason(p))
    labs = sorted(lay, key=ORDER.index)
    shown = [l + ('(일부)' if full and lay[l] else '') for l in labs]
    other_rows.append(dict(묶음='국제 협약' if g['treaty'] else '다른 부처 법령', 이름=g['name'],
                           범위='전문' if full else '일부 조문만', 들어있는것='·'.join(shown)))
other_rows.sort(key=lambda r: (r['묶음'] != '다른 부처 법령', r['범위'] != '일부 조문만', r['이름']))

# ── 행정규칙·자치법규 개수 ──
ids, noid = set(), 0
for root, dirs, files in os.walk(RAW):
    if os.path.basename(root) != '행정규칙' or '_자치법규' in root:
        continue
    for f in files:
        if f.endswith('.txt'):
            m = re.search(r'ID:\s*(\d+)', read(os.path.join(root, f), 600) or '')
            if m:
                ids.add(m.group(1))
            else:
                noid += 1
ordin = 0
for sido in os.listdir(os.path.join(RAW, '_자치법규')):
    sp = os.path.join(RAW, '_자치법규', sido)
    if os.path.isdir(sp):
        ordin += sum(1 for x in os.listdir(sp) if os.path.isdir(os.path.join(sp, x)))

S = dict(
    base=len(base_rows),
    base_dec={k: sum(r[k] == '있음' for r in base_rows) for k in ('법률', '시행령', '시행규칙')},
    base_part={k: sum(r[k] == '일부 조문만' for r in base_rows) for k in ('법률', '시행령', '시행규칙')},
    other=sum(r['묶음'] == '다른 부처 법령' for r in other_rows),
    other_full=sum(r['묶음'] == '다른 부처 법령' and r['범위'] == '전문' for r in other_rows),
    other_part=sum(r['묶음'] == '다른 부처 법령' and r['범위'] == '일부 조문만' for r in other_rows),
    treaty=sum(r['묶음'] == '국제 협약' for r in other_rows),
    treaty_part=sum(r['묶음'] == '국제 협약' and r['범위'] == '일부 조문만' for r in other_rows),
    admrul_ids=len(ids), admrul_noid=noid, ordin=ordin)

# ── CSV ──
with open(os.path.join(HERE, 'law_list.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['구분', '분야·묶음', '이름', '법률', '시행령', '시행규칙', '받아 둔 범위', '들어 있는 것'])
    for r in base_rows:
        w.writerow(['해양 분야 기준 법률', r['분야'], r['이름'], r['법률'], r['시행령'], r['시행규칙'], '', ''])
    for r in other_rows:
        w.writerow(['그 밖의 법령', r['묶음'], r['이름'], '', '', '', r['범위'], r['들어있는것']])

# ── HTML (A4) ──
E = html.escape
mark = {'있음': '○', '없음': '–', '일부 조문만': '일부'}
out = []
cur = None
for r in base_rows:
    if r['분야'] != cur:
        cur = r['분야']
        out.append(f'<tr class="grp"><td colspan="4">{E(cur)}</td></tr>')
    out.append(f'<tr><td>{E(r["이름"])}</td>' + ''.join(
        f'<td class="c{" part" if r[k] == "일부 조문만" else ""}">{mark[r[k]]}</td>' for k in ('시행령', '시행규칙')) + '</tr>')
base_html = '\n'.join(out)


def other_table(rows):
    return '\n'.join(f'<tr><td>{E(r["이름"])}</td><td class="c">{E(r["들어있는것"])}</td></tr>' for r in rows)


o_full = [r for r in other_rows if r['묶음'] == '다른 부처 법령' and r['범위'] == '전문']
o_part = [r for r in other_rows if r['묶음'] == '다른 부처 법령' and r['범위'] == '일부 조문만']
tr = [r for r in other_rows if r['묶음'] == '국제 협약']
tr_html = '\n'.join(f'<tr><td>{E(r["이름"])}</td><td class="c">{E(r["범위"])}</td></tr>' for r in tr)

doc = f'''<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>해양법령 도우미 법령 목록</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;700&display=swap" rel="stylesheet">
<style>
@page {{ size: A4; margin: 16mm 14mm 16mm 14mm; }}
body {{ font-family: 'Noto Sans KR', sans-serif; color: #1f2937; font-size: 11pt; line-height: 1.5; margin: 0; }}
h1 {{ font-size: 20pt; margin: 0 0 4pt; color: #0b3b66; }}
.sub {{ color: #475569; margin: 0 0 12pt; }}
h2 {{ font-size: 14pt; color: #0b3b66; border-bottom: 2px solid #0b3b66; padding-bottom: 3pt; margin: 18pt 0 6pt; break-after: avoid; }}
p.note {{ color: #475569; font-size: 10pt; margin: 2pt 0 8pt; }}
.sum {{ display: grid; grid-template-columns: 1fr 1fr; gap: 6pt; margin: 8pt 0 4pt; }}
.sum div {{ border: 1px solid #cbd5e1; border-radius: 6pt; padding: 7pt 9pt; }}
.sum b {{ font-size: 16pt; color: #0b3b66; display: block; }}
table {{ width: 100%; border-collapse: collapse; font-size: 10.5pt; }}
th, td {{ border-bottom: 1px solid #e2e8f0; padding: 3pt 5pt; text-align: left; vertical-align: top; }}
th {{ background: #e8f0f8; color: #0b3b66; }}
thead {{ display: table-header-group; }}
tr {{ break-inside: avoid; }}
td.c, th.c {{ text-align: center; white-space: nowrap; width: 18%; }}
td.part {{ color: #b45309; font-weight: 700; }}
tr.grp td {{ background: #f1f5f9; font-weight: 700; color: #334155; padding-top: 5pt; }}
.cols {{ column-count: 2; column-gap: 10mm; }}
.cols table {{ font-size: 9.5pt; }}
.foot {{ margin-top: 16pt; font-size: 9pt; color: #64748b; }}
</style></head><body>
<h1>해양법령 도우미에 들어 있는 법령 목록</h1>
<p class="sub">앱 속 AI 법령 챗봇 「해양법령 도우미」가 답할 때 바탕으로 삼는 원문(국가법령정보센터에서 받은 것)의 목록입니다.</p>
<div class="sum">
<div><b>{S['base']}개</b>해양 분야 법률(전문) — 시행령 {S['base_dec']['시행령'] + S['base_part']['시행령']}개(일부 조문만 {S['base_part']['시행령']}개) · 시행규칙 {S['base_dec']['시행규칙'] + S['base_part']['시행규칙']}개 함께</div>
<div><b>{S['other']}개</b>관련 다른 부처 법령 — 전문 {S['other_full']}개 · 일부 조문만 {S['other_part']}개</div>
<div><b>{S['admrul_ids']}건 이상</b>고시·훈령 등 행정규칙 · 그 밖에 조례 등 자치법규 {S['ordin']}건 (둘 다 개수만 안내)</div>
<div><b>{S['treaty']}개</b>국제 협약 — 전문 {S['treaty'] - S['treaty_part']}개 · 일부 조문만 {S['treaty_part']}개</div>
</div>
<p class="note">기준일: 2026년 11월 3일 저장소 원문 기준. 원문은 매일·매주 점검해 바뀐 것을 관리자가 확인한 뒤 다시 받습니다.</p>

<h2>1. 해양 분야 법률 {S['base']}개 — 전문</h2>
<p class="note">법률은 모두 전문(모든 조문)을 갖고 있습니다. ○ 있음 · – 해당 법령에 없거나 받지 않음 · 「일부」 일부 조문만.</p>
<table><thead><tr><th>법률 이름</th><th class="c">시행령</th><th class="c">시행규칙</th></tr></thead><tbody>
{base_html}
</tbody></table>

<h2>2. 관련 다른 부처 법령 — 전문 {S['other_full']}개</h2>
<p class="note">해양 법률이 끌어다 쓰는 다른 부처의 법령 가운데 전문을 받아 둔 것입니다.</p>
<div class="cols"><table><thead><tr><th>이름</th><th class="c">들어 있는 것</th></tr></thead><tbody>
{other_table(o_full)}
</tbody></table></div>

<h2>3. 관련 다른 부처 법령 — 일부 조문만 {S['other_part']}개</h2>
<p class="note">해양 법률이 인용하는 <b>그 조문만</b> 받아 둔 법령입니다. 여기 없는 조문은 챗봇이 답하지 못할 수 있습니다.</p>
<div class="cols"><table><thead><tr><th>이름</th><th class="c">들어 있는 것</th></tr></thead><tbody>
{other_table(o_part)}
</tbody></table></div>

<h2>4. 국제 협약 {S['treaty']}개</h2>
<table><thead><tr><th>협약 이름</th><th class="c">받아 둔 범위</th></tr></thead><tbody>
{tr_html}
</tbody></table>

<h2>5. 개수만 안내하는 것</h2>
<p>· 고시·훈령·예규 등 <b>행정규칙: {S['admrul_ids']}건 이상</b> (서로 다른 문서 번호로 센 값. 번호가 적히지 않은 파일 {S['admrul_noid']}개는 빼고 셌습니다)<br>
· 지방자치단체의 <b>조례 등 자치법규: {S['ordin']}건</b></p>
<p class="foot">※ 이 목록은 챗봇이 바탕으로 삼는 원문의 범위입니다. <b>AI는 실수를 할 수 있습니다.</b> 목록에 있는 법령이라도 중요한 내용은 근거 조문이나 국가법령정보센터(law.go.kr)에서 한 번 더 확인하시기를 권고합니다.</p>
</body></html>'''
open(os.path.join(HERE, 'law_list.html'), 'w', encoding='utf-8').write(doc)
print(json.dumps(S, ensure_ascii=False))
