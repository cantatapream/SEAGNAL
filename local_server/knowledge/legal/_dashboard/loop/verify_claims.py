#!/usr/bin/env python3
"""감사가 보고한 결함 주장을 **사람(에이전트)이 하나씩 실측 확인**하도록 배치를 짠다.

[왜 있나 — 2026-08-23, 25차에서 측정하고 확정]
25차 결함 465건 중 464건을 확인했더니 **20건(4.3%)이 결함이 아니었고, 그중 9건은
이미 고쳐진 것을 다시 결함으로 세고 있었다.** 양식산업발전법 서식 18종은 21차에 반영이
끝났는데 25차까지 "6라운드째 미반영"으로 남아 있었다. 원인은 하나다 —
**감사가 이전 라운드 감사 파일의 문장을 그대로 베끼기 때문**이다.

그 20건을 그대로 통합수정에 넣으면 **멀쩡한 위키를 건드린다.** 그래서 감사와 통합수정
**사이에** 이 확인 단계를 둔다.

[왜 기계로 안 하나 — 두 번 시도했고 두 번 다 틀렸다]
· 2026-08-20: "항목이 짚은 조문이 위키에 있으면 이미 반영된 것"으로 셌더니 8,862건이
  그리로 갔는데 **그중 1,353건은 감사관이 바로 그 줄에 "위키에 없음"이라 적어 둔 항목**이었다.
· 2026-08-23: 범위를 "raw 에 없다는 주장"으로 좁혀 다시 시도했더니, 표본 12건이 거의 전부
  오탐이었다 — 결함 주장은 "별표4에 규정이 없다"처럼 **번호를 '빠진 것'이 아니라 '이야기하는
  자리'로** 쓴다. 기계는 그 둘을 못 가른다(그 도구는 폐기했다).
**"이 주장이 맞나"는 사람이 원문을 읽어야 갈린다.** 이 도구는 그 읽기를 나눠 맡기는 일만 한다.

[비용 — 실측값이다. 어림짐작이 아니다]
25차 실측: 배치당 36~49건 · 7.5~14.8분 · 토큰 129k~226k. **항목당 약 3,800 토큰.**
8배치를 동시에 돌리면 465건이 약 15분에 끝난다.

[쓰는 법]
  python3 verify_claims.py --items <결함목록.json> --batches 8 --out <디렉토리>
    결함목록.json 은 [{law, text, ...}, ...] 형식이면 된다.
  그러면 <디렉토리>/verify_brief.md(공통 지시) 와 verify_1.md ... verify_N.md 가 생긴다.
  각 배치를 Agent(sonnet)에게 이렇게 시킨다:
    "먼저 <디렉토리>/verify_brief.md 를 정독하고 그대로 따르라.
     검증할 항목 목록: <디렉토리>/verify_N.md
     작업 디렉토리는 .../knowledge/legal 이다."

[연계] ← 감사 산출 결함목록   → verify_brief.md · verify_N.md
       ⚠읽기 전용 — 위키·raw 를 고치지 않는다. 확인 결과는 사람이 R<N>_CORRECTIONS.md 로 정리한다.
"""
import os
import sys
import json
import collections

argv = sys.argv[1:]


def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d


items_path = arg('--items')
nbatch = int(arg('--batches', '8'))
outdir = arg('--out')
if not items_path or not outdir:
    print(__doc__)
    sys.exit(2)

items = json.load(open(items_path, encoding='utf-8'))
if isinstance(items, dict):                      # {gaps:[...], holes:[...]} 형식도 받는다
    merged = []
    for v in items.values():
        if isinstance(v, list):
            merged += v
    items = merged

os.makedirs(outdir, exist_ok=True)

BRIEF = """# 감사 결함 주장 실측 검증 — 공통 지시

작업 디렉토리: <저장소뿌리>/local_server/knowledge/legal

## 왜 이 일을 하나
감사관이 결함을 보고했다. 각 항목에는 **주장**이 붙어 있다 — "원문엔 있는데 위키에만 없다",
"원문 자체에 그 규정이 없다", "구조적으로 수집 불가다" 같은 것이다.
할 일은 **그 주장이 맞는지 실제로 확인하는 것**이다. 추측·추정은 안 된다.

과거에 이런 주장이 틀렸던 적이 많다(2026-08-23 실측: 464건 중 20건이 결함이 아니었다):
- 양식산업발전법 서식 18종 — "6라운드째 미반영"이라 했는데 21차에 이미 전부 반영돼 있었다
- 해양경찰법 "보궐위원 임기 불명" — 법 제7조①에 그대로 적혀 있었다
- 선박안전법 위그선 별표 — "미수집"이라 했는데 이틀 전에 수집이 끝나 있었다
- 항로표지법 "문화재보호법 미수집" — 그 법은 2024년 6개 법으로 쪼개졌고 후신 6법은 전부 수집돼 있었다
**그래서 주장을 그대로 받아 적으면 안 되고, 매번 실물을 봐야 한다.**

## 각 항목마다 이렇게 판정하라

### 1) "원문엔 있고 위키만 누락" / "표에 행만 추가" / "재수집하면 됨" 류 주장
그 조문·별표가 **raw 에 실제로 있는지 직접 확인**한다.
- `raw/` 밑에서 해당 법 폴더를 찾아 `grep` 으로 조문 번호·표제를 찾는다.
- 있으면 → **확인**: 어느 파일 몇 행에 있는지 적는다.
- 없으면 → **주장 틀림**: raw 에 없다고 적고, 실제 성격이 무엇인지(재수집 필요인지
  원문 자체 공백인지) 판단해 적는다.

### 2) "원문 자체에 그 규정이 없다" / "입법공백" 류 주장
정말 없는지 **직접 찾아본 뒤에만** 인정한다.
- 그 법의 법률·시행령·시행규칙·행정규칙 raw 를 관련 키워드로 전수 grep 한다.
- 조문 번호가 바뀌었을 수 있으니 **번호가 아니라 내용(키워드)으로** 찾는다.
- ★**검색어를 쪼개서 최소 3가지 방식으로 찾는다.** 예전에 "없다"고 판정한 15건 중 11건이
  검색어를 안 쪼개서 생긴 착각이었다(예: "여객선 안전관리지침" 0건 → "안전관리지침"으로는 나온다).
- 정말 없으면 → **확인**: 어느 파일들을 어떤 검색어로 찾았는지 적는다(이게 근거다).
- 있으면 → **주장 틀림**: 어디에 있는지 적는다.

### 3) "구조적으로 수집 불가" / "하위법령 미제정" 류 주장
law.go.kr 에 정말 없는지 **API 로 확인**한다.
```
curl -sS --max-time 40 --cacert /root/.ccr/ca-bundle.crt --proxy "$HTTPS_PROXY" \\
  "https://www.law.go.kr/DRF/lawSearch.do?OC=hyoo1431&type=JSON&target=admrul&display=20&query=<검색어>"
```
- `target=admrul`(행정규칙)·`target=law`(법령)·`target=ordin`(자치법규)을 필요에 따라 쓴다.
- 결과가 0건이면 → **확인**: 어떤 검색어로 몇 건이었는지 적는다.
- 있으면 → **주장 틀림**: 찾은 것의 이름과 일련번호를 적는다. **이건 재수집 가능이라는 뜻이다.**

## 반드시 지킬 것
- **추측 금지.** 확인한 것만 쓴다. 못 찾았으면 "못 찾았다"고 쓰고 어디를 찾았는지 적는다.
- **파일을 고치지 마라.** 이번 작업은 확인만 한다. 위키·raw 어느 것도 수정하지 않는다.
- **git 명령을 쓰지 마라.**
- **"N라운드째 변동 없음" 같은 이력 주장은 이 방법으로 못 가린다** — 억지로 판정하지 말고
  "확인 못 함 + 이유"로 넘어가라. (25차 실측: 이런 항목이 60건이었다.)
- 한 항목에 너무 오래 매달리지 마라.

## 보고 형식 (한국어, 항목마다 한 줄)
```
[법명] 주장요약 → 판정: 확인 | 주장틀림 | 확인못함
  근거: (어느 파일 몇 행 / 어떤 검색어로 몇 건 / 무엇을 못 찾았는지)
```
마지막에 집계를 적어라: 확인 N건 · 주장틀림 N건 · 확인못함 N건.
그리고 **주장이 틀린 것**은 따로 모아 다시 나열하라 — 이게 이 작업의 핵심 산출물이다.
"""

open(os.path.join(outdir, 'verify_brief.md'), 'w', encoding='utf-8').write(BRIEF)

# 같은 법은 한 배치에 몰아 준다 — 같은 raw 를 여러 배치가 각자 다시 읽는 낭비를 막는다.
by_law = collections.defaultdict(list)
for it in items:
    by_law[it.get('law', '(법 미상)')].append(it)
laws = sorted(by_law, key=lambda l: -len(by_law[l]))

batches = [[] for _ in range(nbatch)]
for law in laws:                                  # 큰 법부터 가장 적은 배치에 넣는다
    target = min(batches, key=len)
    target.extend(by_law[law])

for n, group in enumerate(batches, 1):
    if not group:
        continue
    lines = ['# 검증 배치 %d — %d건 / %d법\n' % (n, len(group), len({g.get('law') for g in group}))]
    cur = None
    for it in group:
        if it.get('law') != cur:
            cur = it.get('law')
            lines.append('\n## %s' % cur)
        extra = ' '.join('(%s:%s)' % (k, it[k]) for k in ('cls', 'age', 'kind') if it.get(k))
        lines.append('- %s  %s' % (it.get('text', ''), extra))
    open(os.path.join(outdir, 'verify_%d.md' % n), 'w', encoding='utf-8').write('\n'.join(lines))

print('■ 결함 주장 검증 배치를 짰다')
print('   전체 항목 : %d건 / %d법' % (len(items), len(by_law)))
print('   배치      : %d개 (배치당 %d~%d건)'
      % (sum(1 for b in batches if b),
         min(len(b) for b in batches if b), max(len(b) for b in batches if b)))
print('   저장 위치 : %s' % outdir)
print()
print('   실측 기준 예상: 항목당 약 3,800 토큰 · 8배치 동시 실행 시 약 15분')
print('   (25차 실측값 — 배치당 36~49건, 7.5~14.8분, 129k~226k 토큰)')
print()
print('   각 배치를 Agent(sonnet)에게 이렇게 시켜라:')
print('     "먼저 %s/verify_brief.md 를 정독하고 그대로 따르라.' % outdir)
print('      검증할 항목 목록: %s/verify_N.md' % outdir)
print('      작업 디렉토리는 <저장소뿌리>/local_server/knowledge/legal 이다."')
