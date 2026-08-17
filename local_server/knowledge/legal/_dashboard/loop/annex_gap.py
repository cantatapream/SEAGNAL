#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""별표(법에 딸린 표) 수치가 위키에 옮겨졌는지 기계적으로 판정한다 (H-40 P1).

[왜 필요한가 — 초보자용]
  별표에는 풍속·파고·금액·크기 같은 **사용자가 진짜 알고 싶어 하는 숫자**가 몰려 있다.
  원문(raw)에는 있는데 위키에 안 옮겨져 있으면, 챗봇은 그 숫자를 근거로 대지 못하고
  "확인되지 않는다"고 물러난다(2026-08-17 유선·도선 사고가 정확히 이 유형).

[왜 다시 만들었나]
  `_dashboard/annex_coverage_survey.md`(2026-08-17 전수 조사)는 결론만 남기고 **판정
  스크립트를 저장소에 남기지 않았다**(그 문서 §8이 그렇게 적고 있다). 그래서 "그래서 어느
  별표를 고쳐야 하나"는 목록을 매번 다시 만들어야 했다. 이 파일이 그 판정을 재현·고정한다.

[판정 규칙 — 조사 문서 §1의 5단계를 그대로 구현]
  ① raw 별표 식별: `raw/<분류>/<법>/별표/*별표*.txt`. 파일명에 계층(시행령/시행규칙)이 있으면
     파일명으로, 없으면 파일 안 선언줄(`■ 항만법 시행령 [별표 6]`)로 계층·번호를 정한다.
  ② 전용 페이지: `wiki/annexes/*.md` 를 파일명·frontmatter `id`·본문 `raw 원문:` 경로로 연결.
  ③ 이름 인용: 그 법의 위키 페이지 어딘가가 `별표N` 을 부르고 있는가.
  ④ 수치 이관: raw에서 **숫자+단위**(`10㎧`·`1.5m`·`600만원`)를 뽑아 집합으로 만들고, 위키
     페이지에서 같은 방식으로 뽑아 **60% 이상 겹치면 "옮겨졌다"**로 본다.
  ⑤ 판정 불가: 단위 없는 금액표·좌표·목록·도형은 ④로 못 가린다 → `ⓔ`로 따로 뺀다.

[판정 결과 기호]
  ⓐ 전용 페이지 있음 / ⓑ1 인용한 개념 페이지에 수치 있음 / ⓑ2 같은 법 다른 개념 페이지에 있음
  ⓑ3 statutes·comparisons 허브에만 있음(★질문이 닿는 자리에 없다) / ⓒ1 이름만 인용 /
  ⓒ2 언급 없음 / ⓓ 원문 없음(삭제·스텁) / ⓔ 자동 판정 불가

  **보강 대상(㉮) = ⓑ3 + ⓒ1 + ⓒ2** — "수치가 든 기준표인데 위키가 이름만 부르고 있는 것".

[연계] 조사 문서: `_dashboard/annex_coverage_survey.md` · 계획: `MASTER_PLAN.md` H-40
       사용: `python3 annex_gap.py [--law 법이름] [--group G1] [--json 경로]`
[로드 순서] 읽기 전용. 어떤 파일도 고치지 않는다 — 목록만 만든다(고치는 것은 사람·AI의 몫).
"""
import os, re, sys, json, collections

LEGAL = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW, WIKI = os.path.join(LEGAL, 'raw'), os.path.join(LEGAL, 'wiki')

# 숫자+단위. 단위가 없는 맨 숫자는 오탐이 너무 많아 세지 않는다(조사 문서 §1 ④와 동일).
NUM = re.compile(r'(\d[\d,]*(?:\.\d+)?)\s*(㎧|m/s|m|km|미터|톤|kg|킬로그램|만원|억원|원|일|개월|년|퍼센트|%|점|명|해리|밀리미터|㎜|센티미터|㎝|㎡|㎥|℃)')
DECL = re.compile(r'■\s*(.+?)\s*\[별표\s*(\d+(?:의\d+)?)\s*\]')
FNAME = re.compile(r'^(시행령|시행규칙|법률)?_?별표\s*(\d+(?:의\d+)?)')
# 6개 병렬 그룹 — `annex_coverage_survey.md` §6-2 의 배정을 그대로 옮긴 것(법이 겹치지 않는다).
GROUPS = {
    'G1': ['선박안전법', '선박직원법', '선박법', '선박평형수(船舶平衡水)관리법', '선박교통관제에관한법률'],
    'G2': ['농수산물품질관리법', '수산물유통의관리및지원에관한법률', '농수산물의원산지표시등에관한법률',
           '수산부산물재활용촉진에관한법률'],
    'G3': ['수산업법', '수산자원관리법', '수산종자산업육성법', '내수면어업법', '어선법',
           '배타적경제수역에서의외국인어업등에대한주권적권리의행사에관한법률', '원양산업발전법'],
    'G4': ['해상교통안전법', '수상레저기구의등록및검사에관한법률', '수상레저안전법',
           '수상에서의수색ㆍ구조등에관한법률', '도선법', '해운법', '연안사고예방에관한법률'],
    'G5': ['해양환경관리법', '해양환경보전및활용에관한법률', '해양생태계의보전및관리에관한법률',
           '해양폐기물및해양오염퇴적물관리법', '해양조사와해양정보활용에관한법률',
           '해양공간계획및관리에관한법률', '항만법', '항만운송사업법',
           '항만재개발및주변지역발전에관한법률', '연안관리법', '어촌ㆍ어항법', '영해및접속수역법'],
    'G6': ['양식산업발전법', '해사안전기본법', '국제항해선박및항만시설의보안에관한법률',
           '어선원및어선재해보상보험법', '갯벌및그주변지역의지속가능한관리와복원에관한법률',
           '공유수면관리및매립에관한법률', '해양수산생명자원의확보ㆍ관리및이용등에관한법률',
           '해양치유자원의관리및활용에관한법률', '해양사고의조사및심판에관한법률', '항로표지법'],
}


def units(text):
    """텍스트에서 (숫자, 단위) 짝을 뽑아 집합으로 만든다 — 수치가 옮겨졌는지 대조하는 열쇠."""
    return {(n.replace(',', ''), u) for n, u in NUM.findall(text)}


def raw_annexes(law_dir):
    """한 법의 raw 별표 파일들을 (계층, 번호, 경로, 본문)으로 읽는다. 서식(별지)은 제외."""
    d = os.path.join(law_dir, '별표')
    if not os.path.isdir(d):
        return []
    out = []
    for f in sorted(os.listdir(d)):
        if not f.endswith('.txt') or '별표' not in f:
            continue
        path = os.path.join(d, f)
        text = open(path, encoding='utf-8', errors='replace').read()
        m = FNAME.match(f[:-4])
        tier, no = (m.group(1) or '', m.group(2)) if m else ('', '')
        dm = DECL.search(text)                       # 파일명에 계층이 없으면 선언줄이 진실
        if dm:
            head = dm.group(1)
            if not tier:
                tier = '시행규칙' if '시행규칙' in head else '시행령' if '시행령' in head else ''
            no = dm.group(2)
        if not no:
            continue
        out.append({'tier': tier, 'no': no, 'path': path, 'text': text})
    return out


def wiki_pages(law):
    """그 법의 위키 페이지를 종류별로 모은다 — 어디에 수치가 있느냐가 판정을 가른다."""
    got = {'annexes': [], 'concepts': [], 'hubs': []}
    for kind, sub in (('annexes', 'annexes'), ('concepts', 'concepts'),
                      ('hubs', 'statutes'), ('hubs', 'comparisons')):
        d = os.path.join(WIKI, sub)
        if not os.path.isdir(d):
            continue
        for f in os.listdir(d):
            if not f.endswith('.md'):
                continue
            if sub == 'comparisons':
                text = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
                if law not in text:
                    continue
            elif not f.startswith(law):
                continue
            got[kind].append((f[:-3], open(os.path.join(d, f), encoding='utf-8', errors='replace').read()))
    return got


def judge(a, pages):
    """별표 하나를 판정한다 → (기호, 근거 한 줄)."""
    body = re.sub(r'^\[.*?\]\s*별표.*?\n', '', a['text'], count=1).strip()
    if len(body) < 120 or re.search(r'\[별표\s*\d+(?:의\d+)?\s*\]\s*삭제', a['text']):
        return 'ⓓ', '원문이 삭제됐거나 스텁(내용 없음)'

    tag = f"별표\\s*{re.escape(a['no'])}"
    ru = units(a['text'])
    for name, text in pages['annexes']:                       # ① 전용 페이지
        if re.search(tag, name) and (not a['tier'] or a['tier'] in name):
            return 'ⓐ', f'전용 페이지 있음 — annexes/{name}'

    if len(ru) < 3:
        return 'ⓔ', f'단위가 붙은 숫자가 {len(ru)}개뿐 — 금액표·좌표·목록·도형일 가능성(수동 확인 필요)'

    cited, best = [], (0.0, '')
    for kind in ('concepts', 'hubs'):
        for name, text in pages[kind]:
            hit = re.search(tag, text) is not None
            ov = len(ru & units(text)) / len(ru)
            if ov > best[0]:
                best = (ov, f'{kind}/{name}')
            if hit:
                cited.append((name, ov, kind))
            if ov >= 0.6:
                if kind == 'concepts':
                    return ('ⓑ1' if hit else 'ⓑ2'), f'수치 {ov:.0%} 일치 — concepts/{name}'
                return 'ⓑ3', f'★수치는 있으나 허브에만 — {kind}/{name} ({ov:.0%}) · 개념 페이지엔 없음'
    if cited:
        n, ov, _ = cited[0]
        return 'ⓒ1', f'이름만 인용 — {n} (수치 일치 {ov:.0%}, 최고 {best[0]:.0%} {best[1]})'
    return 'ⓒ2', f'위키 어디에도 언급 없음 (최고 수치일치 {best[0]:.0%} {best[1]})'


def main():
    only_law = sys.argv[sys.argv.index('--law') + 1] if '--law' in sys.argv else None
    group = sys.argv[sys.argv.index('--group') + 1] if '--group' in sys.argv else None
    laws = GROUPS.get(group) if group else None

    rows = []
    for cat in sorted(os.listdir(RAW)):
        if not re.match(r'^(0\d|1[0-4])_', cat):          # 기준법(1군)만 — 15_관련타부처는 대상 아님
            continue
        for law in sorted(os.listdir(os.path.join(RAW, cat))):
            if only_law and law != only_law:
                continue
            if laws and law not in laws:
                continue
            ax = raw_annexes(os.path.join(RAW, cat, law))
            if not ax:
                continue
            pages = wiki_pages(law)
            for a in ax:
                mark, why = judge(a, pages)
                rows.append({'법': law, '계층': a['tier'] or '(법률)', '별표': a['no'],
                             '판정': mark, '근거': why,
                             'raw': os.path.relpath(a['path'], LEGAL)})

    cnt = collections.Counter(r['판정'] for r in rows)
    print(f'별표 {len(rows)}개 판정 — ' + ' / '.join(f'{k} {cnt[k]}' for k in
          ('ⓐ', 'ⓑ1', 'ⓑ2', 'ⓑ3', 'ⓒ1', 'ⓒ2', 'ⓓ', 'ⓔ') if cnt[k]))
    todo = [r for r in rows if r['판정'] in ('ⓑ3', 'ⓒ1', 'ⓒ2')]
    print(f'\n★보강 대상(㉮) {len(todo)}건 — 수치가 든 기준표인데 위키가 이름만 부르고 있는 것\n')
    for r in todo:
        print(f"  [{r['판정']}] {r['법']} {r['계층']} 별표{r['별표']}\n        {r['근거']}\n        {r['raw']}")

    if '--json' in sys.argv:
        with open(sys.argv[sys.argv.index('--json') + 1], 'w', encoding='utf-8') as fp:
            json.dump(rows, fp, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
