#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os
"""H-36 후속 — 13개 계층자산(트리·표·플로우) ↔ 기존 위키(statutes+concepts) 조문 단위 연결지도 빌더.
   트리 항목이 근거로 든 조문을, 그 조문을 이미 인용하고 있는 위키 페이지와 이어 붙인 조회용 인덱스를 만든다.
   위키 파일도 자산 JSON도 절대 수정하지 않는다(읽기 전용) — 산출물은 신규 파일 1개뿐.
   위키 인용 추출 정규식·파일탐색 규칙은 새로 짜지 않고 H-33 lint_coverage.py에서 import해 재사용하고,
   "어느 파일이 인용했는지"를 남기도록 파일 단위 루프만 새로 씌웠다(설계 §1.1).
   [연계] 입력 _dashboard/{vessel_doc_tree,penalty_tree,...}.json 11파일(=13자산)·wiki/statutes,concepts/*.md
         출력 _dashboard/tree_wiki_crossref.json
         설계 _dashboard/H32_tree_wiki_crossref_design.md (스키마·조인규칙·성공기준 V1~V5)
   [로드 순서] 단독 실행(python3 build_tree_wiki_crossref.py). 13개 자산 빌더가 모두 돈 뒤에 실행."""
import json, os, re, glob, sys, random, datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from lint_coverage import CITATION_RE  # ★H-33 검증 정규식 원본 재사용(재구현 금지)

LEGAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../..')
WIKI = f'{LEGAL}/wiki'
DASH = f'{LEGAL}/_dashboard'
OUT = f'{DASH}/tree_wiki_crossref.json'

# ── 자산 파싱 규약 (설계 §1.4) ───────────────────────────────────────────────
LAW_KEYS = ['근거법령', '법령', '적용법령']
SLUG_KEYS = ['근거법령_slug', '법령_slug']
ART_KEYS = ['근거조문', '조문', '벌칙조문', '조']
# 파일 → (조인 대상 루트 키, 기본 자산명). vessel_doc_tree만 컨테이너 필드로 3자산을 가른다(§1.4).
ASSET_SPEC = [
    ('vessel_doc_tree.json',        ['tree'],           '서류'),
    ('business_type_aliases.json',  ['aliases'],        '사업자유형'),
    ('penalty_tree.json',           ['tree'],           '처벌강도'),
    ('zone_tree.json',              ['trees'],          '해역·항해구역'),
    ('tonnage_facet.json',          ['facets'],         '톤수·길이'),
    ('inspection_cycle_table.json', ['검사종류', '증서'], '검사주기'),
    ('pollutant_tree.json',         ['tree'],           '오염물질'),
    ('training_table.json',         ['rows'],           '교육훈련'),
    ('permit_tree.json',            ['subtrees'],       '인허가유형'),
    ('port_entry_flow.json',        ['flows'],          '출입항·위치보고'),
    ('qualification_tree.json',     ['tree', '별표'],    '자격면허등급'),
]
VESSEL_SUBASSET = {'장비': '안전장비', '보험': '보험'}  # vessel_doc_tree 안의 컨테이너 필드 → 자산명

ART_RE = re.compile(r'제(\d+)조(?:의(\d+))?')
LAWMARK_RE = re.compile(r'[「『]([^」』]{2,40})[」』]')
# 괄호 없이 이름만 앞세운 인용("질서위반행위규제법 제18조제1항", "근로기준법 제107조") 탐지 — V4 사람정독에서 발견한 오탐 유형
BARE_RE = re.compile(r'(?:^|[^가-힣])([가-힣]{2,24}(?:법률|법|규칙|기준|규정|지침|고시|협약|조약|령))[\s|｜\]]{0,4}$')
BARE_ALONE_RE = re.compile(r'(?:^|[^가-힣])(고시|훈령|예규|지침)[\s|｜\]]{0,4}$')
# "이 법"·"동 규정"처럼 지시어+일반명사는 그 페이지 자신을 가리키므로 타문서로 보지 않는다
DETERMINER = {'이', '동', '본', '위', '그', '당해', '해당', '같은', '현행', '상위', '하위', '신', '구', '전', '후'}
SUFFIXES = ('법률', '법', '규칙', '기준', '규정', '지침', '고시', '협약', '조약', '령')
# 연쇄 인용("제53조·제50조①", "제21조(처분의 사전 통지)·제22조")은 앞 인용의 귀속을 그대로 물려받는다
CHAIN_GAP_RE = re.compile(r'^[\s·ㆍ,、/및와과부터까지의제항호목~\-①-⑳0-9]{0,10}$')
PAREN_RE = re.compile(r'\([^()]{0,40}\)')
LABEL_KEYS = ['서류명', '장비명', '보험종류', '위반행위', '의무명', '단계명', '교육종류',
              '사업유형명', '제목', '요건', '라벨', '구분', '맥락']


def norm_name(s):
    """법령·고시 이름 비교용 정규화(공백·중점·괄호기호 제거). 매칭 판정에만 쓰고 저장은 원문 그대로."""
    return re.sub(r'[\sㆍ·・「」『』()（）]', '', s or '')


def art_key(raw):
    """조문 표기에서 조 단위 키를 뽑는다. '제27조제2호'→'제27조', '제5조의2(별표1의3)'→'제5조의2'.
    조문번호가 없으면(예 '별표3') None."""
    m = ART_RE.search(str(raw))
    if not m:
        return None
    return f'제{m.group(1)}조' + (f'의{m.group(2)}' if m.group(2) else '')


# ── 1단계: 13개 자산 provenance 수집 ────────────────────────────────────────
def collect_tree_refs():
    """13개 자산의 provenance를 전수 파싱해 참조 목록을 만든다.
    반환: (refs[], stats{}) — refs 각 원소는 {asset,file,node_id,field,법령,slug,계층,조문,조문_원표기,라벨}.
    [연계] 설계 §1.4 루트 화이트리스트 / §1.5 결측치 보정."""
    # 1패스: (법령명 → 슬러그) 사전을 데이터 자신에서 만든다(지어내지 않기 위해, 설계 §1.5)
    name2slug = {}
    conflicts = {}
    docs = {}
    for fname, roots, _ in ASSET_SPEC:
        docs[fname] = json.load(open(f'{DASH}/{fname}', encoding='utf-8'))

        def scan(o):
            if isinstance(o, dict):
                law = next((o[k] for k in LAW_KEYS if o.get(k)), None)
                slug = next((o[k] for k in SLUG_KEYS if o.get(k)), None)
                if law and slug:
                    if law in name2slug and name2slug[law] != slug:
                        conflicts.setdefault(law, set()).update([name2slug[law], slug])
                    name2slug[law] = slug
                for v in o.values():
                    scan(v)
            elif isinstance(o, list):
                for v in o:
                    scan(v)
        for r in roots:
            scan(docs[fname][r])
    if conflicts:
        raise SystemExit(f'[FAIL] 법령명→슬러그 충돌 { {k: sorted(v) for k, v in conflicts.items()} } '
                         '— 설계 §1.5는 충돌 0건을 전제로 보정한다. 수동 확인 필요.')

    refs = []
    stats = {'문서미상': 0, '조문없음': 0, '계층추정': 0, 'per_file': {}}

    def walk(o, path, node_id, layer, asset, fname, base_asset):
        n = 0
        if isinstance(o, dict):
            nid = o.get('id') or node_id
            lay = o.get('계층') or layer
            law = next((o[k] for k in LAW_KEYS if o.get(k)), None)
            art_raw = next((o[k] for k in ART_KEYS if o.get(k)), None)
            if isinstance(art_raw, dict):  # penalty_tree 벌칙조문{조,항,호,표시}
                art_raw = art_raw.get('표시') or art_raw.get('조')
            if law and art_raw:
                slug = next((o[k] for k in SLUG_KEYS if o.get(k)), None) or name2slug.get(law)
                gosi = o.get('고시명')
                jo = art_key(art_raw)
                rec = {
                    'asset': asset, 'file': fname, 'node_id': nid, 'field': path,
                    '법령': law, 'slug': slug, '계층': lay, '고시명': gosi,
                    '조문': jo, '조문_원표기': str(art_raw),
                    '라벨': next((o[k] for k in LABEL_KEYS if isinstance(o.get(k), str)), None),
                }
                if not o.get('계층') and lay:
                    rec['계층_추정'] = True
                    stats['계층추정'] += 1
                if jo is None:
                    stats['조문없음'] += 1
                if not slug and not gosi:
                    stats['문서미상'] += 1
                refs.append(rec)
                n += 1
            for k, v in o.items():
                sub = VESSEL_SUBASSET.get(k) if fname == 'vessel_doc_tree.json' else None
                n += walk(v, f'{path}.{k}', nid, lay, sub or asset, fname, base_asset)
        elif isinstance(o, list):
            for i, v in enumerate(o):
                n += walk(v, f'{path}[{i}]', node_id, layer, asset, fname, base_asset)
        return n

    for fname, roots, asset in ASSET_SPEC:
        c = 0
        for r in roots:
            c += walk(docs[fname][r], r, None, None, asset, fname, asset)
        stats['per_file'][fname] = c
    return refs, stats, name2slug


# ── 2단계: 위키 역인덱스 ────────────────────────────────────────────────────
def page_doc(path):
    """위키 파일 경로 → (문서키, 고시페이지여부). find_wiki_files(slug)의 역함수(설계 §1.2)."""
    base = os.path.basename(path)[:-3]
    rel = os.path.relpath(path, WIKI)
    if rel.startswith('statutes/'):
        return base, False
    if '__' in base:
        return base.split('__')[0], False
    return f'고시:{base}', True          # concepts/<고시명>.md — 가족 없는 인용은 그 고시 자신의 조문


def build_doc_alias(name2slug):
    """문서명(정규화) → 문서키 사전. 위키 본문의 「문서명」을 실제 문서로 해소하는 데 쓴다(설계 §1.3b).
    출처는 전부 실재 데이터 — 위키 파일명(슬러그)·자산이 실제로 쓴 (법령명→슬러그)·자산의 고시명."""
    alias = {}

    def put(name, doc):
        k = norm_name(name)
        if k and alias.get(k, doc) != doc:
            raise SystemExit(f'[FAIL] 문서명 별칭 충돌: {name} → {alias[k]} / {doc}')
        alias[k] = doc
    for p in glob.glob(f'{WIKI}/statutes/*.md'):
        put(os.path.basename(p)[:-3], os.path.basename(p)[:-3])
    for p in glob.glob(f'{WIKI}/concepts/*.md'):
        doc, is_gosi = page_doc(p)
        put(doc.replace('고시:', ''), doc)
    for name, slug in name2slug.items():
        put(name, slug)
        put(slug, slug)
    return alias


def resolve_mark(mark, alias):
    """위키 본문의 「…」 안 문서명을 (문서키, 계층|None)으로 해소한다. 못 찾으면 None."""
    n = norm_name(mark)
    for suf, lay in (('시행규칙', '시행규칙'), ('시행령', '시행령')):
        if n.endswith(suf) and n != suf:
            doc = alias.get(n[:-len(suf)])
            return (doc, lay) if doc else None
    doc = alias.get(n)
    return (doc, None) if doc else None


def find_mark(pre):
    """인용 바로 앞 45자에서 그 인용이 가리키는 문서 이름을 뽑는다.
    반환: ('doc', 이름) | ('fam', '시행령'|'시행규칙') | ('own', None) | None
    ①「…」로 묶인 이름 ②괄호 없는 이름("근로기준법 제107조") ③표 칸의 계층어("| 시행규칙 | 제38조")."""
    marks = LAWMARK_RE.findall(pre)
    if marks:
        tail = pre[pre.rfind('」') + 1:] if '」' in pre else pre
        if len(tail) <= 6:
            return ('doc', marks[-1])
    m = BARE_RE.search(pre)
    if m:
        name = m.group(1)
        if name in ('시행령', '시행규칙'):
            return ('fam', name)
        for suf in SUFFIXES:
            if name.endswith(suf) and name[:-len(suf)] in DETERMINER:
                return ('own', None)   # "이 법"·"동 규칙" 등 — 그 페이지 자신
        return ('doc', name)
    if BARE_ALONE_RE.search(pre):
        return ('doc', '(이름 없는 고시)')   # 해소 불가 → 의심으로 분류됨
    return None


def build_wiki_index(alias):
    """wiki/statutes+concepts 전 파일에서 조문 인용 역인덱스 2종을 만든다(설계 §1.1~§1.3).
    ① own_index[(문서,계층,조)]  — 페이지 자신의 법 조문을 인용한 것(H-33 가정 그대로)
    ② exp_index[(문서,계층|'*',조)] — 본문이 「문서명」을 명시하고 인용한 것(그 문서에 귀속)
    인용 추출은 lint_coverage.CITATION_RE 원본을 그대로 쓰고, 파일 단위 루프만 새로 씌웠다."""
    files = sorted(glob.glob(f'{WIKI}/statutes/*.md')) + sorted(glob.glob(f'{WIKI}/concepts/*.md'))
    own, exp = {}, {}
    total = susp_total = exp_total = unsure = 0
    for p in files:
        doc, is_gosi = page_doc(p)
        own_norm = norm_name(doc.replace('고시:', ''))
        rel = os.path.relpath(p, WIKI)
        try:
            text = open(p, encoding='utf-8').read()
        except Exception:
            continue
        prev = None   # (직전 인용 match, 그 귀속) — 연쇄 인용이 물려받는다
        for m in CITATION_RE.finditer(text):
            fam, jo = m.group(1), m.group(2)
            total += 1
            pre = text[max(0, m.start() - 45):m.start()]
            kind = find_mark(pre)
            if kind is None and prev is not None:
                # 연쇄 인용: 앞 인용과의 사이가 구분자·괄호주석뿐이면 앞 인용의 귀속(문서·가족)을 물려받는다
                gap = PAREN_RE.sub('', text[prev[0].end():m.start()])
                if CHAIN_GAP_RE.match(gap):
                    kind = prev[1] or (('fam', prev[2]) if prev[2] else None)
            prev = (m, kind, fam)
            other, suspect = None, False
            if kind and kind[0] == 'fam':
                # 표 칸("| 시행규칙 | 제38조")·연쇄("시행령 제53조·제50조①")로 가족이 추정되지만
                # 독립 재대조(V1의 '시행령 제N조' 인접 검사)로는 확인할 수 없다 → 아무 데도 싣지 않는다.
                # 이 페이지 자신의 법률 조문이 아니라는 것만 확실하므로, 오탐을 만드는 대신 버린다.
                if not m.group(1):
                    unsure += 1
                    continue
            elif kind and kind[0] == 'doc':
                nm = norm_name(kind[1])
                if own_norm not in nm and nm not in own_norm:
                    r = resolve_mark(kind[1], alias)
                    if r and r[0] != doc:
                        other = r                  # 코퍼스 안 다른 문서로 해소됨 → 그 문서에 귀속
                    else:
                        suspect = r is None        # 해소 실패(형법·행정절차법 등 코퍼스 밖) → 의심
            if other:
                odoc, olay = other
                olay = olay or fam or ('행정규칙' if odoc.startswith('고시:') else '법률')
                exp_total += 1
                for lk in (olay, '*'):
                    exp.setdefault(f'{odoc}::{lk}::제{jo}', {}).setdefault(rel, 0)
                    exp[f'{odoc}::{lk}::제{jo}'][rel] += 1
                continue
            if suspect:
                susp_total += 1
            layer = fam if fam else ('행정규칙' if is_gosi else '법률')
            slot = own.setdefault(f'{doc}::{layer}::제{jo}', {}).setdefault(rel, {'ok': 0, 'susp': 0})
            slot['susp' if suspect else 'ok'] += 1
    return own, exp, files, total, susp_total, exp_total, unsure


# ── 3단계: 조인 + 통계 ──────────────────────────────────────────────────────
def main():
    refs, rstats, name2slug = collect_tree_refs()
    alias = build_doc_alias(name2slug)
    windex, expindex, wfiles, wtotal, wsusp, wexp, wunsure = build_wiki_index(alias)

    crossref = {}
    for r in refs:
        if r['조문'] is None:
            continue
        if r['계층'] == '행정규칙' and r.get('고시명'):
            doc = f"고시:{r['고시명']}"
        elif r['slug']:
            doc = r['slug']
        else:
            continue  # 문서미상(74법 코퍼스 밖) — 매칭 불가, 통계에만 반영
        key = f"{doc}::{r['계층'] or '법률'}::{r['조문']}"
        e = crossref.setdefault(key, {'법령': r['법령'], '계층': r['계층'] or '법률',
                                      '조문': r['조문'], 'tree_refs': [],
                                      'wiki_pages': [], 'wiki_pages_명시인용': [], 'wiki_pages_타법의심': []})
        tr = {k: r[k] for k in ('asset', 'file', 'node_id', 'field', '라벨', '조문_원표기') if r.get(k) is not None}
        e['tree_refs'].append(tr)

    for key, e in crossref.items():
        doc, layer, jo = key.split('::')
        for page, cnt in sorted(windex.get(key, {}).items()):
            (e['wiki_pages'] if cnt['ok'] else e['wiki_pages_타법의심']).append(page)
        # 명시인용 채널: 3계열(법률·시행령·시행규칙)은 계층까지 맞춰 찾고, 그 밖(행정규칙·규칙)은 계층 무관
        ekey = key if layer in ('법률', '시행령', '시행규칙') else f'{doc}::*::{jo}'
        for page in sorted(expindex.get(ekey, {})):
            if page not in e['wiki_pages']:
                e['wiki_pages_명시인용'].append(page)

    # 통계
    def bucket():
        return {'refs': 0, 'keys': set(), 'matched': set()}
    per_asset, per_layer, per_law = {}, {}, {}
    for r in refs:
        for tgt, name in ((per_asset, r['asset']), (per_layer, r['계층'] or '(미상)'), (per_law, r['법령'])):
            b = tgt.setdefault(name, bucket())
            b['refs'] += 1
    for key, e in crossref.items():
        matched = bool(e['wiki_pages'] or e['wiki_pages_명시인용'])
        for tr in e['tree_refs']:
            per_asset[tr['asset']]['keys'].add(key)
            if matched:
                per_asset[tr['asset']]['matched'].add(key)
        for tgt, name in ((per_layer, e['계층']), (per_law, e['법령'])):
            b = tgt.setdefault(name, bucket())
            b['keys'].add(key)
            if matched:
                b['matched'].add(key)

    def fin(d):
        return {k: {'refs': v['refs'], 'keys': len(v['keys']), 'matched': len(v['matched']),
                    'pct': round(len(v['matched']) / len(v['keys']) * 100, 1) if v['keys'] else 0.0}
                for k, v in sorted(d.items(), key=lambda x: -x[1]['refs'])}

    tree_only = sorted(k for k, e in crossref.items() if not (e['wiki_pages'] or e['wiki_pages_명시인용']))
    tree_keys = set(crossref)
    wiki_only = {}
    for key in windex:
        if key in tree_keys:
            continue
        if not any(c['ok'] for c in windex[key].values()):
            continue  # 타법의심뿐인 인용은 위키단독으로도 세지 않는다
        doc, layer, jo = key.split('::')
        wiki_only.setdefault(doc, {}).setdefault(layer, []).append(jo)
    for doc in wiki_only:
        for layer in wiki_only[doc]:
            wiki_only[doc][layer].sort(key=lambda x: (int(ART_RE.search(x).group(1)), x))
    wiki_only_n = sum(len(v) for d in wiki_only.values() for v in d.values())

    matched_keys = sum(1 for e in crossref.values() if e['wiki_pages'] or e['wiki_pages_명시인용'])
    matched_own = sum(1 for e in crossref.values() if e['wiki_pages'])
    out = {
        'generated': datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=9))).isoformat(timespec='seconds'),
        'scope': '13개 계층자산 provenance × wiki/statutes+concepts 조문 단위 조인 (위키·자산 무수정, 조회용 인덱스)',
        'semantics': {
            '키': '<문서>::<계층>::<제N조>. 문서=법령슬러그 또는 "고시:<고시명>". 같은 번호라도 법률/시행령은 다른 조문이라 계층을 키에 넣는다.',
            '매칭의_의미': '"그 위키 페이지가 그 조문을 인용한다"이지 "그 조문을 제대로 해설한다"가 아니다. 표의 근거 열에 조문번호만 적힌 경우도 매칭이다.',
            'wiki_pages': '그 페이지 자신의 법(파일명으로 정해짐)의 조문으로 인용된 것. H-33 lint_coverage의 가정을 그대로 따른 1차 채널.',
            'wiki_pages_명시인용': '다른 법의 페이지지만 본문이 「이 문서명」을 명시하고 그 조문을 인용한 것(예: 해양환경관리법 페이지가 「선박에서의 오염방지에 관한 규칙」 제28조를 인용). 문서 귀속이 본문에 적혀 있어 1차 채널보다 오히려 근거가 뚜렷하다.',
            '조_단위': '항(①②)·호까지는 대조하지 않는다. 트리가 제27조제2호를 근거로 삼고 위키가 제27조제5호만 다뤄도 매칭으로 센다(항 단위는 H-33 hang_gap_candidates 소관).',
            '타법의심': '인용 앞 45자에 「타문서명」이 붙어 있으나 그 이름이 74법 코퍼스 안 문서로 해소되지 않는 인용(형법·행정절차법 등). 이 페이지 자신의 법 조문이 아닐 가능성이 커서 분리 보관한다 — 가드도 휴리스틱이라 버리지 않는다. 사용자 노출 전 사람 확인 필요.',
            'field': '원본 자산 JSON에서 그 항목을 되짚어 갈 수 있는 JSON 경로 문자열.',
        },
        'caveats': [
            '조 단위 조인이다 — 항·호 정밀도는 없다.',
            '매칭은 인용 존재이지 해설 품질이 아니다.',
            f'타문서 인용이 실재한다: 위키 전체 인용 매치 {wtotal:,}건 중 {wexp:,}건은 「문서명」이 코퍼스 안 다른 문서로 해소돼 그 문서에 귀속시켰고(wiki_pages_명시인용), {wsusp:,}건({wsusp/wtotal*100:.1f}%)은 해소 실패(코퍼스 밖 법)라 타법의심으로 분리했다. 두 판정 모두 휴리스틱(앞 45자·꼬리 6자 규칙)이다.',
            '행정규칙(고시) 계층은 구조적으로 매칭률이 낮다 — 자산이 인용한 고시 중 전용 위키 페이지가 있는 것이 소수다. 낮은 수치는 데이터 결함이 아니라 위키가 고시를 아직 그만큼 안 다뤘다는 사실이다.',
            '74법 코퍼스 밖 법(형법·행정절차법 등, penalty_tree 참조해소의 not_in_corpus)은 위키가 없어 매칭 불가 — summary.결측.문서미상으로 분리.',
            'wiki/comparisons·activities·annexes는 대상이 아니다(지시 범위: statutes·concepts).',
            'H-33 _dashboard/coverage/<법>.json은 uncited_articles(위키에 안 실린 조문)만 담아 역방향 매핑이 없어 입력으로 쓰지 않았다.',
        ],
        'summary': {
            'tree_refs_total': len(refs),
            'wiki_files_scanned': len(wfiles),
            'wiki_citation_matches': wtotal,
            'wiki_citation_명시타문서': wexp,
            'wiki_citation_타법의심': wsusp,
            'wiki_citation_가족불확정_제외': wunsure,
            'unique_keys': len(crossref),
            'matched_keys': matched_keys,
            'matched_keys_자기법페이지만': matched_own,
            'match_pct': round(matched_keys / len(crossref) * 100, 1) if crossref else 0.0,
            'per_asset': fin(per_asset),
            'per_layer': fin(per_layer),
            'per_law': fin(per_law),
            'wiki_only': {'unique_keys': wiki_only_n,
                          'per_doc': {d: sum(len(v) for v in l.values()) for d, l in
                                      sorted(wiki_only.items(), key=lambda x: -sum(len(v) for v in x[1].values()))}},
            '결측': {k: rstats[k] for k in ('문서미상', '조문없음', '계층추정')},
            'refs_per_file': rstats['per_file'],
        },
        'crossref': dict(sorted(crossref.items())),
        'tree_only': tree_only,
        'wiki_only': wiki_only,
    }

    # ── 검증 V1·V2 (빌드 게이트 — 실패하면 산출물을 만들지 않는다) ───────────
    fails = verify(out)
    if fails:
        for f in fails[:20]:
            print('[FAIL]', f)
        raise SystemExit(f'검증 실패 {len(fails)}건 — 산출물 생성 중단')

    json.dump(out, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    s = out['summary']
    print(f"완료: {OUT}")
    print(f"  트리 참조 {s['tree_refs_total']:,}건 → 고유키 {s['unique_keys']:,} / 매칭 {s['matched_keys']:,} ({s['match_pct']}%)")
    print(f"  위키 {s['wiki_files_scanned']}파일 · 인용매치 {s['wiki_citation_matches']:,}(명시타문서 {s['wiki_citation_명시타문서']:,} · 타법의심 {s['wiki_citation_타법의심']:,} · 가족불확정제외 {s['wiki_citation_가족불확정_제외']:,})")
    print(f"  위키단독 조문 {s['wiki_only']['unique_keys']:,} · 트리단독 {len(out['tree_only']):,}")
    for a, v in s['per_asset'].items():
        print(f"    {a:<12} refs={v['refs']:>5} keys={v['keys']:>4} matched={v['matched']:>4} ({v['pct']}%)")


# ── 검증 (빌더 로직을 재사용하지 않는 독립 재대조, 설계 §3) ──────────────────
def verify(out):
    """V1: wiki_pages의 모든 항목이 그 파일에 그 조문 인용을 실제로 담고 있는가(통짜 문자열 검사).
    V2: 모든 tree_refs의 field 경로를 원본 JSON에서 되짚으면 같은 조문 값이 나오는가.
    빌더의 CITATION_RE·walk를 쓰지 않고 독립적으로 확인한다."""
    fails = []
    cache = {}
    for key, e in out['crossref'].items():
        doc, layer, jo = key.split('::')
        for bucket in ('wiki_pages', 'wiki_pages_명시인용', 'wiki_pages_타법의심'):
            for page in e[bucket]:
                p = f'{WIKI}/{page}'
                if p not in cache:
                    cache[p] = open(p, encoding='utf-8').read()
                text = cache[p]
                if bucket == 'wiki_pages' and layer in ('시행령', '시행규칙'):
                    ok = re.search(re.escape(layer) + r'\s*' + re.escape(jo), text) is not None
                else:
                    ok = jo in text
                if not ok:
                    fails.append(f'V1 {key} → {page}({bucket}): 인용 미발견')
                # 명시인용은 문서명이 그 페이지에 실제로 적혀 있어야 한다(귀속 근거 자체의 재확인)
                if bucket == 'wiki_pages_명시인용':
                    nm = norm_name(doc.replace('고시:', ''))
                    if nm not in norm_name(text):
                        fails.append(f'V1b {key} → {page}: 문서명 미발견(명시인용 귀속 근거 없음)')

    src = {}
    for fname, _, _ in ASSET_SPEC:
        src[fname] = json.load(open(f'{DASH}/{fname}', encoding='utf-8'))
    step = re.compile(r'([^.\[\]]+)|\[(\d+)\]')
    for key, e in out['crossref'].items():
        for tr in e['tree_refs']:
            cur = src[tr['file']]
            try:
                for m in step.finditer(tr['field']):
                    cur = cur[m.group(1)] if m.group(1) else cur[int(m.group(2))]
            except Exception as ex:
                fails.append(f"V2 {key} → {tr['file']}:{tr['field']} 경로 해석 실패 {ex}")
                continue
            got = next((cur[k] for k in ART_KEYS if isinstance(cur, dict) and cur.get(k)), None)
            if isinstance(got, dict):
                got = got.get('표시') or got.get('조')
            if str(got) != tr['조문_원표기']:
                fails.append(f"V2 {key} → {tr['file']}:{tr['field']} 조문 불일치 {got!r} != {tr['조문_원표기']!r}")
    return fails


def sample(n=20, seed=20260810):
    """V4용 무작위 표본 추출 — 사람이 직접 위키 파일을 열어 확인할 목록을 뽑는다."""
    out = json.load(open(OUT, encoding='utf-8'))
    pool = [(k, e) for k, e in out['crossref'].items() if e['wiki_pages']]
    random.Random(seed).shuffle(pool)
    for i, (k, e) in enumerate(pool[:n], 1):
        tr = e['tree_refs'][0]
        print(f"{i}. {k} | {tr['asset']}/{tr.get('라벨')} | {e['wiki_pages'][0]}")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'sample':
        sample(int(sys.argv[2]) if len(sys.argv) > 2 else 20)
    else:
        main()
