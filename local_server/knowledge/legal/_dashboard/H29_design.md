# H-29 법령·고시 변동감지 시스템 — 설계

작성: 2026-08-10 KST · 근거: `MASTER_PLAN.md` H-29 1~4항·8~12항 (5~7항 승인방/예약반영은 이번 범위 제외)
원칙: 탐지는 100% 로직(API 직접대조), AI는 트리아지에만. 이 문서를 먼저 쓰고 코드를 짠다(카파시 1).

---

## 0. 이번 범위 / 제외

| 항목 | 이번에 함 | 이유 |
|---|---|---|
| H-29 1항 법률 자체 변동 광역질의 | ✅ | |
| H-29 2항 위임 행정규칙 광역질의 | ✅ | |
| H-29 3항 탐지=로직 / 트리아지=AI | 탐지 ✅ · 트리아지 **슬롯만** | 큐 스키마에 `ai_recommendation` 필드를 만들고 값은 null. 실제 AI 채움은 후속 |
| H-29 4항 baseline = H-28 결과 재사용 | ✅ | `delegation_scan_result.json` 재사용(§3) |
| H-29 8항 조문단위 부분개정 | ✅ | `조문변경여부=Y` 추출 |
| H-29 9항 소관부처명 변경 | ✅ | 단순 문자열 비교 |
| H-29 10항 별표 | ✅(자동) | 별표는 MST 안에 포함 — 별도 로직 없음(H-29 10항 그대로) |
| H-29 11항 법령ID | ✅ | `_meta.json`에 `법령ID` 신규 백필(§5) |
| H-29 12항 예고(시행예정) 법령 | ✅ 탐지·플래그 | 원문 사전수집(`_대기/`)은 이번엔 안 함 — 승인방(5~7항)이 없어 "대기본을 언제 스왑할지" 결정 주체가 없기 때문 |
| H-29 5~7항 승인방 + `run_once_at` 예약반영 | ❌ | Phase F 관리자 UI 미배선. 대신 큐 스키마에 소비 필드(`status`/`scheduled_for`/`before`/`after`/`공포일자`/`시행일자`/`ai_recommendation`)를 미리 넣어둠 |

---

## 1. ★기존 구현과의 관계 — `services/legal_amendment_scanner.js`

**착수 전 조사에서 이미 같은 목적의 스캐너가 존재함을 발견했다**(2026-08-06 Phase F 3방 작업에서 신설, `HANDOFF.md` 842~845행).

- 동작: `raw/01~14_*`의 `_meta.json` families MST 199개를 매일 KST 01:00 cron으로 `lawService.do?target=eflaw&MST=<저장된MST>` 개별 조회 → 응답의 `공포번호`/`시행일자`가 `_dashboard/amendment_baseline.json`과 다르면 `_amendments/queue.jsonl`에 적재.

### 실측으로 확인한 구조적 한계 (2026-08-10 라이브 호출)

```
lawService.do?target=eflaw&MST=270747  → 법령명 수산업법 · 공포번호 20940 · 시행일자 20260423
   (수산업법은 2026-04-21에 법률 제21570호로 일부개정 공포됨, 신 MST=285535, 시행 20261022)
```

**MST(법령일련번호)는 "그 법의 특정 버전"을 가리키는 고정 식별자**이므로, 저장해둔 옛 MST를 다시 조회하면 언제 조회해도 같은 값이 돌아온다. 즉 이 스캐너는 `_meta.json`의 MST가 사람 손으로 갱신되기 전에는 **원리적으로 개정을 감지할 수 없다**(수산업법의 실제 개정도 감지 못 하는 상태다). 부트스트랩 스캔이 "199건 조회·0건 변경"으로 정상 종료된 것도 이 때문으로 보인다.

### 이번 처리 방침 (카파시 3 — 외과수술식)

- **`legal_amendment_scanner.js`·`amendment_baseline.json`·`_amendments/queue.jsonl`은 이번에 건드리지 않는다.** 라우트(`/api/legal/amendments`)와 관리자 화면(`ai_chat.js` 개정검토방)이 이미 그 파일 포맷에 배선돼 있어, 여기서 바꾸면 이번 요청 범위를 벗어난 UI까지 흔들린다.
- H-29 시스템은 **별도 파일**(`law_change_baseline.json` / `law_change_queue.json`)에 쓴다. 둘을 언제·어떻게 합칠지(스캐너를 H-29 광역질의로 교체하고 큐를 통합할지)는 **오케스트레이터·사용자 결정 사항**으로 남긴다 → §9 후속과제.
- H-29가 MST 고정 문제를 피하는 방식: **MST가 아니라 `법령ID`로 조회**한다. 광역질의(`lawSearch`)가 돌려주는 행에는 그 법의 **현재 MST**가 들어있고, 우리는 저장된 법령ID와 대조만 하면 되므로 "옛 MST를 다시 물어보는" 구조 자체가 없다.

---

## 2. canonical 73법 목록 — 무엇을 쓰는가 (근거)

| 파일 | 건수 | 판단 |
|---|---|---|
| `loop/audit9_groups.json` | 73 | 필드 빈약(name/slug/raw만) |
| `loop/audit10·11·12_groups.json` | 73 | slug 집합 **완전 동일**, 필드 풍부(domain/tier/soban/byl/txt/raw) |
| `loop/audit12_groups_run.json` (Aug 6, 최신) | 73 | audit12에서 `연안관리법`이 빠지고 `자연유산의보존및활용에관한법률`이 들어감 |
| `_dashboard/delegation_scan_result.json` (H-28 산출물) | 73 | slug 집합이 **audit12_groups.json과 정확히 일치**(차집합 0) |
| `wiki/statutes/*.md` | 74 | = 73법 + `자연유산의보존및활용에관한법률` |

**결정: 대상 = `audit12_groups.json`(73법) ∪ `audit12_groups_run.json`에만 있는 1법(자연유산법) = 74건.**

- 근거 ①: H-29 4항이 "baseline은 H-28 결과 재사용"이라고 못박았고, H-28 산출물의 73 slug가 `audit12_groups.json`과 1:1로 일치한다 → 73법의 기준선은 `audit12_groups.json`.
- 근거 ②: `자연유산법`은 `wiki/statutes/`에 페이지가 있고 `raw/15_관련타부처/`에 `_meta.json`도 있으며, **L-59(74법 최신성 재검증)의 계기가 된 바로 그 법**(고시가 구버전으로 수집돼 있던 사례)이다. 변동감지에서 이 법만 빠지면 같은 사고를 또 놓친다.
- 그래서 목록 로더는 두 파일을 합집합으로 읽고, 추가된 1건은 baseline에 `source:"audit12_groups_run.json"`으로 표시해 추적 가능하게 둔다(오케스트레이터가 나중에 73/74 정책을 확정하면 그때 정리).
- `연안관리법`은 audit12에 있으므로 그대로 포함된다(74건에 포함).

---

## 3. H-28 산출물 재사용 방식 (구체적으로)

`_dashboard/delegation_scan_result.json` = 73개 원소 리스트, 각 원소:

```json
{"law":"항만법","slug":"항만법",
 "api_status":{"법률:283707":"ok","시행규칙:288183":"empty","시행령:287353":"ok"},
 "total_delegation_points":2336,
 "uncollected_c_candidates":[...],"structural_b_candidates":[...],
 "genuine_a_candidates":[...],"cited_law_uncollected_candidates":[...]}
```

재사용 항목 (새로 만들지 않는 것):

1. **canonical 73 slug 집합** — §2의 근거로 사용.
2. **`api_status`의 `"<층>:<MST>"` 키** → H-28 전수조사 시점(2026-07-27~28)의 층별 MST를 그대로 baseline에 `h28.mst`로 기록. 지금 `_meta.json` MST와 다르면 그 사이에 재수집이 있었다는 뜻이므로 provenance로만 남긴다(비교 기준선은 어디까지나 현재 `_meta.json`).
3. **`total_delegation_points`** → baseline에 `h28.delegation_points`로 보존. 나중에 "위임포인트 수가 급변했다"를 재스캔 없이 알 수 있는 값.

재사용하지 **않는** 것: `*_candidates` 4종(수집완결성 판정 결과로, 변동감지와 목적이 다름 — H-28 리포트에서 이미 처리 완료).

---

## 4. 실측으로 확정한 API 스펙 (2026-08-10 라이브 호출, 추측 아님)

| 무엇 | 호출 | 실측 결과 |
|---|---|---|
| 법령ID 획득 | `lawService.do?target=law&MST=283707` | `기본정보.법령ID="001737"`, `소관부처.소관부처코드="1192000"` |
| 공포일 범위 광역질의 | `lawSearch.do?target=law&org=1192000&ancYd=20260415~20260430` | 3건 — **시행예정본이 안 나온다**(수산업법 285535 누락) |
| 〃 (eflaw) | `lawSearch.do?target=**eflaw**&org=1192000&ancYd=20260415~20260430` | 14건 — **`현행연혁코드="시행예정"` 수산업법 MST=285535 · 법령ID=001486 · 공포 20260421 · 시행 20261022 정상 노출** |
| 시행예정 전수 | `lawSearch.do?target=eflaw&org=1192000&efYd=20260811~20291231` | 53건, 전부 `시행예정` |
| ★결론 | 법령 광역질의는 반드시 **`target=eflaw`** | `target=law`는 현행본만 색인 → 예고 감지 불가 |
| 예고본 본문 | `lawService.do?target=eflaw&MST=285535` → **`{}` (빈 응답)** / `…&MST=285535&efYd=20261022` → 175KB 정상 | **시행예정본은 `efYd`를 반드시 같이 줘야 한다**(H-29 12항엔 없던 실측 사실) |
| 조문단위 변경 | 위 응답 `법령.조문.조문단위[]` | 127조 중 `조문변경여부=="Y"` 8건(제8·19·21·32·36·37·38·62조), 각 `조문제개정유형="일부개정"`·`조문시행일자="20261022"` |
| 행정규칙 광역질의 | `lawSearch.do?target=admrul&org=1192000&date=20260701~20260810` | **totalCnt=0 — 범위(`~`) 미지원** |
| 〃 단일일자 | `…&date=20260720` | 3건 정상 → `date`는 단일 발령일자만 |
| 〃 채택안 | `…&target=admrul&org=1192000&sort=ddes&display=100&page=N` | **발령일자 내림차순 정렬 확인**(page1 20260810→20260331, page2 20260331→20251124) → 컷오프 날짜까지 페이징 후 조기중단 |
| 행정규칙 안정 식별자 | admrul 검색행/상세 | `행정규칙ID`(예: 61410)는 개정돼도 고정, `행정규칙일련번호/ID`(2100000282754)만 개정마다 새로 발급 → **법령ID의 행정규칙판** |

관련 교훈 준수: **L-59** — ID·MST의 크기/존재로 최신 여부를 판단하지 않고, 항상 `발령일자`·`시행일자`를 직접 비교한다. **L-37** — admrul 대조는 ID가 아니라 **정규화 제목** 축으로 매칭한다.

---

## 5. `_meta.json` 스키마 변경 (H-29 11항)

**변경 전**
```json
"families": { "법률": { "MST": "283707", "파일": "법률.json" } }
```
**변경 후 (추가되는 키는 `법령ID` 하나뿐 — 다른 필드·순서·주석 일절 손대지 않음)**
```json
"families": { "법률": { "MST": "283707", "파일": "법률.json", "법령ID": "001737" } }
```

- 위치를 **families 하위(층별)** 로 잡은 이유: 법률/시행령/시행규칙은 각각 별개의 법령이라 법령ID가 서로 다르다(수산업법 001486 / 시행령 004019 / 시행규칙 014396). 최상위에 하나만 두면 시행령·시행규칙 추적이 안 된다.
- families 값이 `list`(예: 해양경찰법 — 개별 명칭 대통령령 여러 건)나 `str`("없음 …" 설명문)인 케이스가 실재하므로(`collect_contacts.py` 주석 참조) 리스트는 원소별로 처리, 문자열은 건너뛴다.
- **소관부처코드는 `_meta.json`에 넣지 않는다** — 광역질의에만 필요한 값이라 baseline 파일에 둔다(외과수술식: 요청된 필드만 추가).

---

## 6. 만드는 파일

| 파일 | 역할 | API 호출 |
|---|---|---|
| `_dashboard/H29_design.md` | 이 문서 | — |
| `_dashboard/loop/backfill_lawid.py` | 74법 `_meta.json` families에 `법령ID` 백필. 부산물로 층별 전체 스냅샷을 `_dashboard/lawid_backfill.json`에 저장 | `lawService target=law&MST=` × families 수 |
| `_dashboard/loop/build_change_baseline.py` | baseline 조립 → `_dashboard/law_change_baseline.json` | **0회**(위 스냅샷·`_meta.json`·`_admrul.json`·H-28 결과만 읽음) |
| `_dashboard/loop/detect_law_changes.py` | 주기 변동감지 → `_dashboard/law_change_queue.json` | 광역질의(부처수×3) + 매치건만 딥다이브 |

`build_change_baseline.py`가 API를 다시 안 부르도록 백필 스크립트가 스냅샷을 남기는 구조 — 같은 199+건을 두 번 조회하지 않기 위함.

### 데이터 흐름

```
audit12_groups.json (+run 1건)          delegation_scan_result.json (H-28)
        │  74법 slug/raw/domain                │  h28 MST·위임포인트수
        ▼                                      ▼
   backfill_lawid.py ──(법령ID 추가)──▶ raw/**/_meta.json
        │  lawid_backfill.json (층별 스냅샷)
        ▼
   build_change_baseline.py ◀── raw/**/행정규칙/_admrul.json (제목·ID)
        │
        ▼
   law_change_baseline.json  {법령ID→법, 행정규칙 제목집합, 부처코드 집합}
        │
        ▼
   detect_law_changes.py ──광역질의(lawSearch)──▶ 부처별 3종 질의
        │   ├ 법령ID 매치 → 딥다이브(eflaw 조문단위) → 변경조문 추출
        │   ├ 소관부처명 문자열 비교 → 부처 이관 감지
        │   ├ 시행예정 매치 → 예고 플래그(사전수집 후보)
        │   └ admrul 제목 매치 → 발령일자 직접비교(L-59)
        ▼
   law_change_queue.json  (status:pending, ai_recommendation:null)
        └─▶ (후속) H-29 5~7항: Phase F 승인방 → run_once_at 예약 반영
```

### 광역질의 3종

| # | 질의 | 범위 | 잡는 것 | 왜 필요 |
|---|---|---|---|---|
| W1 | `target=eflaw&ancYd=<오늘-N>~<오늘>` | **전부처 1회** | 최근 N일 **공포**된 것 | H-29 1항의 문자 그대로. "개정이 확정된 시점" 기준 |
| W2 | `target=eflaw&efYd=<오늘-N>~<오늘>` | **전부처 1회** | 최근 N일 **시행**된 것 | 오래전 공포되고 이제 시행되는 법은 W1이 못 잡음 |
| W3 | `target=eflaw&org=<코드>&efYd=<내일>~<+5년>` | 부처별 | **시행예정 전수** | 예고본은 공포일이 N일 밖이면 W1에서 빠진다. 첫 실행에서 예고 현황을 완전하게 잡으려면 전수 질의가 필요 |

- **W1·W2에 `org` 필터를 걸지 않은 이유(설계 수정, 실측 근거)**: ⓐ 최근 7일 전부처 결과가 W1 61건·W2 36건(30일도 276건)으로 작아 부처별로 쪼갤 이유가 없고, ⓑ `org`로 좁히면 **법이 다른 부처로 이관된 순간 그 법이 질의 결과에서 통째로 빠져** H-29 9항(소관부처명 변경)을 원리적으로 못 잡는다. 부처 필터는 결과가 큰 W3(해수부 실측 54건)에만 쓴다.
- W1은 W2·W3와 상당부분 겹치지만(공포↔시행 관계상) 호출 1회짜리라 그대로 둔다. 중복은 `(법령ID, MST, 시행일자)`로 dedupe.
- **한계(명시)**: 세 질의 모두 "날짜 창"에 걸려야 잡힌다. 창 밖에서 이미 벌어진 과거 누락(= 지금 raw가 낡아 있는 것)은 이 스크립트의 대상이 아니다 — 그건 L-59의 `staleness_audit.py`/`staleness_correct.py` 담당이다. 다만 W3(시행예정 전수)만은 창과 무관한 전수라, 첫 실행에서 **아직 시행 안 된 개정 전량**을 백로그로 끌어온다.

### 행정규칙 질의

`target=admrul&org=<코드>&sort=ddes&display=100&page=N` 을 `발령일자 < 컷오프`가 나올 때까지 페이징(최대 10페이지 안전상한). `date` 파라미터는 범위를 지원하지 않음이 실측으로 확인돼 쓰지 않는다.

**개정 확정은 3단 게이트**(라이브 1회차에서 실제 오탐이 나와 추가한 순서 그대로):
1. 정규화 제목 일치(L-37) → **후보**
2. `행정규칙ID`(개정돼도 불변) 일치 → **동일 문서 확인**
3. `발령일자` 직접 비교로 신판이 더 최신(L-59) → **개정 확정**

2번이 없으면 `(한강유역환경청) 공공폐수처리시설 기본계획 통합고시`(행정규칙ID 65155)가 `(원주지방환경청) …통합고시`(61768)의 개정본으로 잘못 잡힌다 — 정규화가 지방청 접두어를 지우기 때문. 실제로 1회차에서 이 오탐 1건이 발생했고, 2번 게이트를 넣어 제거했다(나머지 4건은 행정규칙ID 동일 → 진짜 개정으로 확정).

---

## 7. 출력 스키마

### `law_change_baseline.json`

```json
{
  "snapshot_at": "2026-08-10T21:00:00+09:00",
  "law_count": 74,
  "ministries": { "1192000": "해양수산부", "1192300": "해양경찰청", ... },
  "laws": [
    { "slug": "항만법", "name": "항만법", "domain": "10_항만물류",
      "raw": "/…/raw/10_항만물류/항만법",
      "source": "audit12_groups.json",
      "h28": { "delegation_points": 2336, "mst": {"법률":"283707","시행령":"287353","시행규칙":"288183"} },
      "families": {
        "법률": { "MST":"283707", "법령ID":"001737", "법령명":"항만법",
                  "공포번호":"21415", "공포일자":"20260227", "시행일자":"20260227",
                  "소관부처명":"해양수산부", "소관부처코드":"1192000" }
      },
      "admruls": [ { "제목":"경인항 항만시설 운영세칙", "제목정규화":"경인항항만시설운영세칙", "ID":"2100000118676" } ]
    }
  ]
}
```

- 조회 인덱스(법령ID→법·층)는 감지 스크립트가 로드 시점에 만든다(파일에 중복 저장 안 함).
- `_admrul.json`에는 `발령일자`가 없다(제목·ID·위임근거만). 발령일자는 **후보가 잡힌 건에 대해서만** 그 자리에서 조회해 비교한다 — 617건 전체를 미리 백필하지 않는다(불필요한 API 617콜 회피).

### `law_change_queue.json` (H-29 5~7항이 그대로 소비할 스키마)

```json
{ "updated_at": "...", "scans": [ {"ran_at":"...","days":7,"queries":27,"matched":1} ],
  "items": [ {
    "id": "chg_20260810_a1b2c3",
    "dedupe_key": "law_pending|001486|285535|20261022",
    "detected_at": "2026-08-10T21:00:00+09:00",
    "kind": "law_pending",            // law_amended|law_pending|law_renamed|law_dept_changed|admrul_amended|admrul_unknown_new
    "law": { "slug":"수산업법", "name":"수산업법", "raw":"/…/raw/05_수산어업/수산업법" },
    "layer": "법률",
    "식별자": { "법령ID":"001486" },   // 행정규칙이면 {"행정규칙ID":..,"ID":..}
    "before": { "MST":"270747","법령명":"수산업법","공포번호":"20940","공포일자":"20250422","시행일자":"20260423","소관부처명":"해양수산부" },
    "after":  { "MST":"285535","법령명":"수산업법","공포번호":"21570","공포일자":"20260421","시행일자":"20261022","소관부처명":"해양수산부","현행연혁코드":"시행예정" },
    "공포일자": "20260421",
    "시행일자": "20261022",
    "changed_articles": [ {"조문번호":"8","조문가지번호":"","조문제목":"마을어업 등의 면허","조문제개정유형":"일부개정","조문시행일자":"20261022"} ],
    "ai_recommendation": null,        // H-29 3항 트리아지 슬롯(재수집 범위·영향 위키페이지·주의점)
    "status": "pending",              // pending→approved→scheduled→applied|ignored (5~7항)
    "scheduled_for": null,            // 승인 시 시행일자 기준 run_once_at 값이 들어갈 자리
    "evidence": { "query":"W3", "org":"1192000" }
  } ] }
```

누적 규칙: 기존 파일을 읽어 `dedupe_key`가 이미 있으면 **건너뛴다**(status를 되돌리지 않음). 새 항목만 append. `scans`에 실행 이력 1줄 추가.

---

## 8. 검증 가능한 성공 기준 (카파시 4)

1. `backfill_lawid.py` 실행 후 74법 `_meta.json`의 families 항목 중 MST가 있는 것 전부에 `법령ID`가 존재하고, 그 외 필드는 실행 전과 동일(diff가 `법령ID` 추가 라인만).
2. `build_change_baseline.py` 산출 baseline의 `laws` 수 = 74, 법령ID 미보유 층 = 0(또는 실패 사유가 로그에 남음).
3. `detect_law_changes.py` 라이브 1회 실행이 **유효 JSON**을 만들고, 광역질의가 HTTP 200 + `totalCnt` 정수를 돌려준다.
4. **재현 검증**: 수산업법 예고본(법령ID 001486 / MST 285535 / 공포 20260421 / 시행 20261022)이 `kind:"law_pending"`으로 큐에 잡히고 `changed_articles`에 제36조가 포함된다. 안 잡히면 원인을 규명해 고친다(추측 금지).
5. 실행 중 raw 원문·위키·기존 스캐너 파일이 **하나도 수정되지 않는다**(_meta.json의 `법령ID` 추가 제외).

## 9. ⚠경합위험 · 남은 결정

- **⚠경합위험**: `backfill_lawid.py`는 74개 `_meta.json`(공유 raw)에 **쓴다**. 법별 1:1 파일이지만 L-48/L-71 선례상 같은 부모 디렉토리 대량 동시쓰기는 사고 이력이 있다 → **단독(직렬) 실행 전용**. 병렬 디스패치 금지. 감지 스크립트(`detect_law_changes.py`)는 읽기 전용 + 자기 큐 파일만 쓰므로 안전.
- **후속 결정 필요(오케스트레이터/사용자)**:
  1. `legal_amendment_scanner.js`(MST 고정 조회라 개정 감지 불가, §1)를 H-29 광역질의 방식으로 교체할지 / 큐(`_amendments/queue.jsonl` ↔ `law_change_queue.json`)를 통합할지.
  2. 73법 vs 74법(자연유산법 포함) canonical 확정.
  3. 예고본 원문 사전수집(`_대기/`) 착수 시점 — 5~7항 승인방과 함께 갈지.
  4. 감지 주기(현재 스크립트는 `--days 7` 파라미터, 실행 주체는 미정 — Routine/cron 배선은 이번 범위 밖).
