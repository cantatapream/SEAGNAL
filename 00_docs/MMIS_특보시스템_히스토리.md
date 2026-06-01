# SEA:GNAL — MMIS 해양특보 시스템 히스토리 (종합본)

> 이 문서는 4개의 독립 작성본(A: 데이터 전달 메커니즘 · B: 앱 아키텍처/run 단계 · C: 시나리오 전수 · D: 히스토리/시행착오)을 하나로 종합한 것이다.
> 작성일: 2026-06-01.
>
> 대상 독자: 처음 보는 사람도 SEA:GNAL(한국 해양기상 앱)이 기상청 해양기상정보포털(MMIS, `marine.kma.go.kr`)로부터 해상 특보(풍랑·태풍)를 받아 → 가공 → 사용자 앱 화면/푸시까지 전달하는 전 과정을 이해할 수 있게 쓴 완결형 기술 문서.
> 모든 서술은 실제 코드(`local_server/marine_warning_crawler.js`, `services/marine_client.js`, `scheduler.js`, `push_sender.js`, `routes/push.js`, `services/push_helpers.js`, `js/utils.js`)와 git 로그·PR 메타데이터를 읽고 검증·인용했다.

---

## 목차

1. [개요 / 목표](#1-개요--목표)
2. [배경 — 통보문 크롤링에서 MMIS 단일출처로](#2-배경--통보문-크롤링에서-mmis-단일출처로)
3. [MMIS 엔드포인트와 데이터 전달 방식](#3-mmis-엔드포인트와-데이터-전달-방식)
4. [특보 생애주기 (엔드포인트 이동)](#4-특보-생애주기-엔드포인트-이동)
5. [우리 앱 처리 파이프라인 (run 14단계 · 가드 · 푸시 · 표출)](#5-우리-앱-처리-파이프라인)
6. [시각 표시 규칙 (범위형/정확형/:58·:59)](#6-시각-표시-규칙-범위형정확형5859)
7. [시나리오별 작동 전수 표](#7-시나리오별-작동-전수-표)
8. [시행착오와 의사결정 (오판 → 정정)](#8-시행착오와-의사결정-오판--정정)
9. [PR 연혁](#9-pr-연혁)
10. [현재 상태와 남은 과제](#10-현재-상태와-남은-과제)
11. [용어 사전](#11-용어-사전)
12. [부록 — 주요 파일·함수 색인](#12-부록--주요-파일함수-색인)

---

## 1. 개요 / 목표

SEA:GNAL은 기상청 MMIS의 **구조화 JSON API** 를 단일출처로 삼아, 한국 연근해 특보(우리 앱 대상: **풍랑(V)·태풍(T)** 두 종류) 의 상태를 **1분 주기**로 추적하고 두 가지를 산출한다.

1. 상태가 바뀐 zone에 대해 **사용자 푸시**(FCM/Web Push)를 발송한다.
2. 프론트엔드가 읽는 **`weather_alerts.json`** 트리를 항상 최신으로 유지한다.

핵심 난제는 MMIS 실시간 엔드포인트가 **휘발성·범위형 텍스트·발표↔발효 사이 공백(GAP)** 등 불완전한 표면을 노출한다는 점이다. 파이프라인의 대부분은 이 불완전함을 길들이는 "가드/디바운스/시각고정" 로직이다. 즉 이 시스템의 본질은 **"불완전·휘발성 MMIS 표면 → 안정적 상태(StateSnapshot) → 두 출력(푸시·표출)" 변환**이다.

### 구현 목표 (요약)
1. **단일출처 신뢰성**: MMIS 구조화 API 하나로 부모·자식·생애주기 단계를 일관되게 처리.
2. **누락 없는 표출**: "발표됐으나 발효시각이 미래"라 공개 엔드포인트에 안 잡히는 특보도 앱 리스트에서 사라지지 않게.
3. **정확한 푸시**: 발표/발효/해제/예비취소 각 모멘트에 **빠짐 없이, 그러나 중복 없이** 푸시.
4. **통보문과 동일한 시각 표출**: 통보문이 "새벽(00시~06시)" 같은 범위형이면 화면도 범위형으로(불일치 제거).
5. **운영 안전**: 콜드부팅/재배포/일시 장애에서 "전부 신규로 오인한 푸시 폭주"나 "재푸시"가 없도록.

---

## 2. 배경 — 통보문 크롤링에서 MMIS 단일출처로

### 2.1 과거 (레거시): 통보문 텍스트 크롤링 시대

초기 SEA:GNAL은 기상청이 발표하는 **통보문(자연어 텍스트)** 을 크롤링하고 AI/규칙 파서로 해석했다. 관련 모듈: `weather_alerts_crawler.js`, `dmdw_warn_crawler.js`, `report_alert_processor.js`, `ai_report_parser.js`. 구조적 한계:

| 문제 | 내용 |
|---|---|
| 자연어 파싱 취약성 | "새벽(00시~06시)", "오늘 밤늦게", 축약 해역명("남해서부 동쪽"), 가운뎃점 `·`, 공백 변형에 취약. |
| 출처 이중화 | `weather_alerts_crawler.js`(특보 본문)와 `dmdw_warn_crawler.js`(자식 해역=세부구역)가 **서로 다른 출처**를 긁어 부모/자식 정보의 시점·내용이 어긋남. 같은 특보가 이중 수집됨. |
| 발표/발효/해제 단계 모호 | 통보문은 "발표"와 "발효예정"이 한 문서에 섞여 있어 푸시·표출 경계가 흐릿. |
| 상태 일관성 | 텍스트가 사라졌다 나타나면 "해제됐는지 / 일시 누락인지" 구분 불가. |

### 2.2 현재 (v7): MMIS 구조화 API 단일출처 전환

`scheduler.js` 주석이 전환 의도를 명시한다(실제 코드):

```
// [Followup Critical-3] marine.kma 단일 출처 전환 (v7) — legacy 비활성화.
//   weather_alerts_crawler + dmdw_warn_crawler 의 출처 이중화를 종식하고
//   marine_warning_crawler 단일 출처로 통합. 본체 파일은 rollback 대비 보존.
//   rollback: 아래 주석 해제 + marineWarningCrawler.run() 호출 제거.
```

**왜 구조화 JSON이 유리한가**: 텍스트 파싱 없이 `warn_zone_cd`(불변 코드)로 해역을 정확히 식별하고, 종류·등급·발효시각·해제시각을 필드로 직접 받는다. 표기 변형에 영향받지 않고, 부모(앞바다/먼바다)와 자식(세부 해역)을 한 출처(`warn-sasc/*` 포함)에서 받아 이중화를 종식한다. 발표/예비/발효/해제 단계가 엔드포인트로 분리되어 상태기계로 다룰 수 있다.

- 레거시 크롤러는 `scheduler.js`에서 **호출 라인 주석 비활성**(삭제 아님 — rollback 대비 본체 보존, 안전한 전환 원칙).
- 실가동 크롤러는 **`local_server/marine_warning_crawler.js` 단 하나**. `scheduler.js`의 1분 마스터 `setInterval`(`scheduler.js:1524`)이 매 분 `marineWarningCrawler.run()`을 호출.

검증 — `scheduler.js:1610-1617`:
```js
if (!crawlPaused) {
    // log('🔎 기상특보 크롤러 실행...');
    // weatherAlertsCrawler.run().catch(...);          // ← 레거시 주석 비활성 (1612)
    log('🌊 marine.kma 통합 크롤러 실행...');
    marineWarningCrawler.run().catch(err => log(`⚠️ [marine] 크롤러 오류: ${err.message}`));  // (1614 실가동)
}
```
dmdw 자식 크롤러도 `scheduler.js:1627-1629`에서 주석 처리됨.

---

## 3. MMIS 엔드포인트와 데이터 전달 방식

호스트 `marine.kma.go.kr`, 베이스 경로 `/mmis_marine_api` (`marine_client.js:82-83`). 경로 상수는 `PATHS`(`marine_client.js:85-97`).

### 3.1 엔드포인트 9종

| 키 / 경로 | 인증 | 무엇을 주나 | 우리 쓰임 |
|---|---|---|---|
| `LOGIN` `/api/auth/login` | — | JWT 세션 발급 | ef/list 인증 |
| `REFRESH` `/api/auth/refresh-token` | JWT | 25분 주기 토큰 갱신 | 세션 유지 |
| `WARN_LIST` `/v1/kma/warn/list` | 비로그인 | **현재 발효중 부모**(앞바다·먼바다), `clr_ntc_tm`은 범위형 텍스트 | 발효 부모 snapshot |
| `WARN_SASC_LIST` `/v1/kma/warn-sasc/list` | 비로그인 | **현재 발효중 자식**(연안바다/평수구역) | 발효 자식 snapshot |
| `WARN_READY` `/v1/kma/warn/ready` | 비로그인 | **예비특보**(부모 S1·자식 S2/S3 혼재, 발효예정 범위형) | 예비 snapshot (`upcomings`/parents) |
| `WARN_SASC_READY` `/v1/kma/warn-sasc/ready` | 비로그인 | 예비 자식 (강풍 육상 등은 allowlist 자동 제외) | 예비 자식 |
| `WARN_LATEST` `/v1/kma/warn/latest` | 비로그인 | 부모 **"가장 최근 통보문"** (휘발성 브릿지) | GAP 보강 + 해제 정확시각 |
| `WARN_SASC_LATEST` `/v1/kma/warn-sasc/latest` | 비로그인 | 자식 최신 통보문 | 자식 GAP + 자식 해제예고 + `_childReleaseNoticeSet` |
| `WARN_EF_LIST` `/v1/kma/warn/ef/list` | **로그인** | **발효 타임라인** — 발효 전 특보도 발효시각과 함께 영구 보유. **권위출처**. | 발표대기 보강(`_efBridged`) |
| `WARN_NTFCTN_LIST` `/v1/kma/warn/ntfctn/list` | 로그인 | 통보문 목록(제목/PDF) | 현재 미사용 |

> 핵심 통찰: **공개 엔드포인트만으로는 "발표됐지만 발효시각이 미래"인 특보(발표대기 GAP)를 못 본다.** 그 구간을 안정적으로 보유하는 건 로그인 엔드포인트 `ef/list` 뿐이다(§8-B에서 입증됨).

### 3.2 인증·세션 (`marine_client.js`)

- **로그인**(`login` `:231`): `POST /api/auth/login` body `{ mmbrId, mmbrPassword, rememberMe:false }` → 응답 헤더 `accesstoken`(JWT 30분)/`refreshtoken`(60분) + `Set-Cookie: JSESSIONID` 회수. ID는 로그에서 `hy***`로 마스킹.
- **자격증명**(`CRED_LIST` `:64`): 환경변수 `MARINE_USER_ID`/`MARINE_PWD` **우선**, 미설정 시 코드 고정 기본값. 1차 `hyoo14312`, 1차 로그인 실패 시 2차 `hyoo1431`으로 폴백(비번 `zaqxsw12!`, 커밋 `169f998`).
  ```js
  const DEFAULT_USER_ID   = 'hyoo14312';   // 1차
  const DEFAULT_USER_ID_2 = 'hyoo1431';    // 2차 (1차 로그인 실패 시 폴백)
  const USER_ID   = process.env.MARINE_USER_ID   || DEFAULT_USER_ID;     // 환경변수 우선
  ```
- **토큰 유지**(`ensureAuth` `:333`): 25분 경과 시 `refresh-token`, 실패 시 재로그인. ef/list가 401이면 재로그인 후 1회 재시도(`fetchWarnEfList:497`).
- **비로그인 4종은 자격증명 없이도 동작**, `ef/list`만 인증 필요. 인증 미설정/실패 시 ef/list만 skip되고 나머지 비로그인 cycle은 정상 진행.

### 3.3 묶음 수집 — `fetchAllRealtimeEndpoints` (`marine_client.js:438`)

`warn/list`·`warn-sasc/list`·`warn/ready`·`warn-sasc/ready`를 `Promise.allSettled`로 동시 호출. **하나라도 rejected면 throw** → `run()`이 잡아 **이번 사이클 통째 skip**(마지막 성공 state 유지, push 0회 — 부분 누락이 "전부 해제"로 오인되어 push 폭주하는 사고 차단). 정상 빈 응답(`[]`)은 정상 흐름으로 흡수.

### 3.4 응답 봉투 형식 — `_unwrap` (`marine_client.js:380-386`)

MMIS 응답은 **두 가지 봉투가 혼용**된다: `{ status, payload }` 또는 `{ code, data }`. `_unwrap`이 둘 다 흡수해 **항상 row 배열**만 반환한다(둘 다 없거나 비면 `[]`):
```js
function _unwrap(j) {
    if (!j) return [];
    if (Array.isArray(j.payload)) return j.payload;
    if (Array.isArray(j.data)) return j.data;
    return [];
}
```
따라서 크롤러 상위 로직은 envelope를 신경 쓸 필요 없이 `row[]`만 다룬다.

### 3.5 핵심 필드 사전

| MMIS 필드 | 의미 | 비고 |
|---|---|---|
| `warn_zone_cd` | 해역 **코드**(불변, 예 `S1323200`) | 표기 변형 무력화의 핵심. `MMIS_CODE_TO_NAME`(93개)으로 정식명 해석 |
| `warn_zone_nm` / `kor_nm` | 해역 **이름**(축약될 수 있음) | 코드 매핑 없을 때만 폴백 |
| `warn_tp` | 특보 **종류 코드** | 실시간=문자(`V`=풍랑,`T`=태풍,`W`=강풍,`O`=폭풍해일…) / ef·통보문=숫자(`6`=풍랑,`7`=태풍,`1`=강풍,`5`=폭풍해일) |
| `warn_tp_nm` | 종류 한글명("풍랑"/"태풍") | |
| `warn_lvl` / `warn_lvl_nm` | **등급** 코드/한글명("주의보"/"경보"/"예비특보"/"해제") | `예비특보`는 내부에서 `예비`로 정규화(`_normLvlNm`) |
| `warn_cmd_nm` | 통보 **명령**("발표"/"변경"/"연장"/"해제") | `warn/latest`·`ef/list`에서 생애주기 판정에 사용 |
| `tm_fc` | **발표시각**(통보문 발행시각) | |
| `tm_ef` | **발효시각**(특보 효력 시작) | `warn/latest`에선 정확시각, list에선 `st_tm`로 올 수 있음 |
| `st_tm` | 시작시각 | **`ef/list`에서 = 발표시각**(`tm_fc`와 동일) |
| `ed_tm` | 종료시각 | **`ef/list`에서 = 발효(예정)시각** (검증됨, `_efRowToInfo:2456` 주석) |
| `tm_yn` | 해제(예정)시각 | list 계열 |
| `clr_ntc_tm` | **해제예고시각** | 범위형 텍스트일 수 있음 → latest로 정확화 |
| `tm_seq` | 통보 시퀀스(같은 발표시각 내 순번) | ef/list 최신 행 선택용 |

> **주의 — 종류코드 이원화**: 실시간 endpoint(`warn/list`·`ready`·`latest`·`sasc/*`)는 **문자 코드**(V/T/W/O…)를, `warn/ef/list`는 **숫자 코드**(6=풍랑 등)와 `warn_tp_nm` 한글명을 준다. 앱은 두 체계 모두를 `풍랑(V)`·`태풍(T)`으로만 좁혀 받는다 (`REALTIME_TARGET_TP = new Set(['V','T'])`, `marine_warning_crawler.js:2067`).

### 3.6 엔드포인트별 성격 보충

- **`warn/list`** — "지금 이 순간 효력이 살아있는" 부모만. 발효시각이 도래해야 나타나고 해제되면 사라진다. **현재 상태(스냅샷)만** 줄 뿐 과거/미래 통보문은 없다. 해제예고(`clr_ntc_tm`)는 종종 **범위형 텍스트**("23일 3시~6시")로만 온다.
- **`warn-sasc/list`** — 자식별 `tm_fc/tm_ef/tm_yn/clr_ntc_tm`를 **개별 제공**한다(과거 "자식 응답에 시간 필드 없음" 가정과 달리 실측 확인됨 → 표출 시 부모값으로 fallback하지 않음, `marine_warning_crawler.js:1932-1937`).
- **`warn/ready`** — 부모(S1코드)와 자식(S2·S3코드)이 한 응답에 혼재 → `_extractParent`로 분기. 발효예정이 범위형("2일 새벽(00시~06시)").
- **`warn/latest` (휘발성 브릿지)** — 부모별 "가장 최근 통보문". `warn_cmd_nm`이 핵심:
  - `해제` 통보문이면 `tm_ef`에 **정확한 해제시각**이 있어 `warn/list`의 범위형 해제예고를 정확화.
  - `발표/변경/연장`인데 `tm_ef`가 미래면 = "발표는 됐는데 발효 전"(**발표대기/GAP**).
  - **휘발성**: 최신 통보문을 "잠깐만" 보유하고 곧 비어버린다(`[]`). 그래서 보강 소스로만 쓰고, 이게 비면 `ef/list`로 메운다.
- **`warn/ef/list`** — 발효 전 특보도 발효시각(`ed_tm`)과 함께 계속 보유. `warn/latest`가 휘발하는 동안에도 발표대기 특보를 안정적으로 포착하는 영구·권위 소스.

---

## 4. 특보 생애주기 (엔드포인트 이동)

특보 하나가 발생→소멸하며 **어느 엔드포인트에 나타나는가**가 단계마다 다르다. 이것이 이 시스템의 가장 어려운 본질이다.

```
   [단계]            warn/ready   warn/latest      ef/list        warn/list
                     (예비)       (휘발 브릿지)    (영구 타임라인) (발효중)
 ─────────────────────────────────────────────────────────────────────────
 1) 예비특보 발표      ●(범위형)     ─               ●(있을수도)     ─
    "2일 새벽(00~06시)"

 2-a) 직접 발표(주의보)  ─           ●(잠깐, 정확)    ●(계속)        ─   ← 발표대기(GAP)
      발효시각 미래

 2-b) GAP 중 latest     ─           ─ ([] 비어버림)  ●(계속)        ─   ← latest가 휘발해도
      휘발 후                                                            ef/list가 메움 ★

 3) 발효시각 도래        ─           ─               ●              ●(+sasc/list 자식)
                                                                    ← 발효중

 4) 해제                ─           ●(해제통보문,    ●(해제행)       ─  ← list에서 사라짐
                                     정확 해제시각)

 5) 예비취소            ─ (사라짐)   ─               ─               ─  ← 발효 없이 소멸
    (UPCOMING_CANCEL)
 ─────────────────────────────────────────────────────────────────────────
   ● = 나타남   ─ = 없음
```

생애주기 5단계 요약:

| 단계 | 어디에 나타나나 | 우리 처리 |
|---|---|---|
| ① **예비특보** | `warn/ready` (발효예정 범위형). 자식은 `warn-sasc/ready` | upcoming(예비) |
| ② **발표대기(GAP)** | 직접발표됐으나 발효시각 미래 → `warn/list`엔 없음(발효전), `warn/ready`엔 없음(예비아님). `warn/latest`가 잠깐 보유 + `ef/list`가 계속 보유 | `_efBridged`/GAP로 **예비 취급** 보강 |
| ③ **발효** | `warn/list` + `warn-sasc/list`. 이때 `_efBridged` 표식 없음 → 정식 발효 푸시 | active(주의보/경보) |
| ④ **해제** | `warn/list`에서 사라짐 + `warn/latest` cmd=해제로 정확 해제시각 | release |
| ⑤ **예비취소** | 예비가 **발효 없이** `warn/ready`에서 사라짐 | prelim_cancel (발효 미경유 소멸) |

> 핵심: **한 특보가 동시에 여러 엔드포인트에 다른 형식으로 존재**하며, 어디에도 없는 "사각지대(GAP)"가 존재한다. 우리 앱은 list → latest → ef/list 순으로 **겹쳐 메워** 사각지대를 없앤다. ("앞바다" = 부모, "연안바다/평수구역" = 자식.)

---

## 5. 우리 앱 처리 파이프라인

`run()`(`marine_warning_crawler.js:2604`) 한 사이클의 흐름. 매 1분 cron. 진입 시 `_runInProgress` 락으로 중복 실행 방지(2605). 첫 호출이면 `_prevSnapshot = _loadPrevSnapshot()`로 디스크에서 직전 상태 복원(2616-2619).

### 5.1 run() 14단계

```
[run() 시작]
  1 fetchAllRealtimeEndpoints() ──(부분 실패)──▶ cycle skip, return []   (2627-2632)
  │   (warn/list, warn-sasc/list, warn/ready, warn-sasc/ready)
  2 curr = _buildSnapshotFromMarine(...)                  (2635-2638)  ← StateSnapshot 생성
  3 _enrichSnapshotWithLatest(curr, warnLatest, prev, warnSascLatest)  (2645-2653)
  │   (발표대기 GAP 부모/자식 추가 + 발효중 해제예고 정확화 + _childReleaseNoticeSet 세팅)
  4 efRows = _fetchEfListForGap(); _enrichSnapshotWithEfList(curr, efRows, prev)  (2661-2670)
  │   (ef/list 발표대기 보강 _efBridged; 인증 실패 시 30분 TTL 캐시 fallback)
  5 [E-1 빈prev 가드] _isSnapshotEmpty(prev) && !forceBaseline && isFirstLoad  (2678-2693)
  │   → push skip, baseline 저장, weather_alerts.json 기록, return [] (forceBaseline 이면 우회)
  6 _applySuspiciousGuard(prev, curr)                     (2701)
  7 _applyChildReleaseDebounce(prev, curr)                (2707)
  8 _applyAnnounceAnchor(prev, curr)                      (2711)
  9 _applyReleaseClrLogic(prev, curr)  (2715) ┐ 둘 다 _applyTimeWindowHold
    _applyUpcomingEfLogic(prev, curr)  (2718) ┘ (윈도우/정확값고정/연장 + *Disp)
 10 _debounceTimeValues(curr)                             (2722)
 11 runDiffAndPush(prev, curr) ── ADMIN_PUSH_ENABLED=false → SKIP  (2727-2732)
 12 userChanges = _buildUserPushChanges(prev, curr)       (2742)
 13 pushSender.processChanges(userChanges, userOpts)      (2748) → /api/push-custom → generateMessage → FCM
    _updateExtensionMemory(curr)                          (2756)
    _prevSnapshot = curr; _savePrevSnapshot(curr); _savePushedPubs()  (2759-2761)
 14 _writeWeatherAlertsJson(prev, curr)                   (2766)  ← weather_alerts.json 갱신
[run() 끝]
```

| # | 함수 / 라인 | 역할 | 왜 필요한가 |
|---|---|---|---|
| 1 | `fetchAllRealtimeEndpoints` (marine_client.js:438) | 비로그인 4종 동시 호출, 하나라도 실패면 throw → run() return | 부분 누락이 "전부 해제" 오인 push 폭주 차단. 마지막 성공 state 유지 |
| 2 | `_buildSnapshotFromMarine` (2124) | 발효(list)+예비(ready)를 allowlist(V/T)로 거른 StateSnapshot 구축 | 모든 다운스트림이 읽는 "이번 사이클의 진실". 예비를 버리지 않음 |
| 3 | `_enrichSnapshotWithLatest` (2207) | (a) 발표대기 GAP 부모/자식을 예비로 추가(정확 tm_ef) (b) 발효중 zone 해제예고 정확화 (c) `_childReleaseNoticeSet` 세팅 | warn/list는 현재 발효·범위형만 줌. latest가 정확시각 통보문 제공. GAP 메움 |
| 4 | `_enrichSnapshotWithEfList` (2503) + `_fetchEfListForGap` (2544) | ef/list로 "warn/latest 창마저 놓친" 발표대기를 메움. `_efBridged=true` 표식 | warn/latest 휘발 → 발표~발효 무음 누락. ef/list는 발효 전도 계속 보유. 실패 시 30분 캐시(2667) |
| 5 | E-1 가드 (2678-2693) | 콜드부팅 직후 prev 빔일 때만 push skip + baseline 저장 | 재배포로 활성 특보가 "전부 신규" 오인되는 폭주 차단. `6df054a`로 콜드부팅 1회 한정(`isFirstLoad`), forceBaseline(관리자 버튼)은 우회 |
| 6 | `_applySuspiciousGuard` (774) | clr_ntc_tm 없이 발효 부모 3개↑ 동시 소멸 시 curr에 prev 복원(release 보류) | MMIS 일시 누락의 대량 가짜 해제 차단. 예비 소멸은 제외 |
| 7 | `_applyChildReleaseDebounce` (976) | 해제예고 없이 사라진 자식 3분 관찰, 그동안 prev 자식 carry | 글리치성 자식 깜빡임 가짜 "일부 해제"/"추가 발효" 방지. `_childReleaseNoticeSet`이면 즉시 해제 |
| 8 | `_applyAnnounceAnchor` (1040) | 발표시각(tmFc)을 현재 발효등급의 최초 발표시각으로 고정 | 통보문마다 흔들리는 tmFc로 "발표시각 변경" 가짜 푸시 방지 + dedup 키 안정화 |
| 9 | `_applyReleaseClrLogic`(1220)/`_applyUpcomingEfLogic`(1228) | 둘 다 `_applyTimeWindowHold`(1156): 윈도우 안=정확값 고정(비교용), 표시는 범위형 sticky(`*Disp`), 초과=연장 | 범위↔정확 깜빡임에서 비교·푸시는 안정, 표출은 통보문 원형 유지 |
| 10 | `_debounceTimeValues` (1247) | 발효/해제예정 새 값이 3분 연속 유지될 때만 변경/연장 확정. 최초값 즉시 | 값 오실레이션(A→B→A)까지 차단해 푸시 억제 |
| 11 | `runDiffAndPush` (613) | 관리자(dmdw) 채널 diff+dispatch. **`ADMIN_PUSH_ENABLED=false`(52)라 호출 자체 skip** | 사용자 푸시에 이미 자식 한정사 포함 → 관리자 채널 중복이라 OFF. DiffMatrix/EventDispatcher는 rollback 대비 코드 보존 |
| 12 | `_buildUserPushChanges` (1315) | 부모 단위 변화를 changes 배열로 변환 | 사용자 푸시 채널의 입력 생성 |
| 13 | `pushSender.processChanges` (push_sender.js:70) | changes를 (template,type,level)별 그룹핑 → `POST /api/push-custom` | 사용자에게 실제 알림. 변화 0건이어도 호출(pending retry 보장) |
| 14 | `_writeWeatherAlertsJson` (1974) | current/previous 트리 생성 후 atomic write | 프론트 표출 갱신. push와 독립 |

> 보조: 12와 14 사이 `_updateExtensionMemory(curr)`(1286, 호출 2756) — zone별 active/upcoming 기억을 갱신해 **다음** 사이클의 null-gap 연장·핸드오프 판정에 쓴다. 반드시 `_buildUserPushChanges` 이후 호출(직전 값이 비교 기준).

### 5.2 StateSnapshot 자료구조 (`marine_warning_crawler.js:238`)

한 사이클의 상태를 담는 핵심 객체. 디스크 영속(`marine_warning_state.json`, `toJSON`/`fromJSON`). 3개의 Map을 가진다:

```
StateSnapshot
├── parents:   Map<부모zone명, info>            ← 발효중/발표대기/예비 부모(앞바다·먼바다)
├── children:  Map<부모zone명, Map<자식명, info>>  ← 부모에 속한 자식(연안바다·평수구역)
└── upcomings: Map<부모zone명, info>            ← 발효중 부모에 "공존하는 예비"(병렬 표출용)
```

`info` 객체 스키마(`_rowToParentInfo`/`_rowToChildInfo` `:2073`/`:2086`):
```js
{ wrnTp, wrnTpNm, wrnLvl, wrnLvlNm, tmFc, tmEf, tmYn, clrNtcTm,
  // 가공 단계가 덧붙이는 플래그:
  tmEfDisp, clrNtcTmDisp,   // 범위형 표시 보존(9단계)
  _clrExtend, _efExtend,    // 연장 플래그(9단계)
  _efBridged }              // ef/list 보강분 표식(4단계)
```
- `tmEf = row.tm_ef || row.st_tm`, `tmYn = row.tm_yn || row.ed_tm`.
- `_normLvlNm`(2053): MMIS의 `'예비특보'`를 내부 비교용 `'예비'`로 정규화. 이걸 안 맞추면 모든 예비 판정 실패.
- **부모/자식 분기** `_extractParent`(2036): 이름에 `…중…` 패턴(2자 이상 뒤꼬리)이 있으면 자식(예 "울산앞바다**중**연안바다" → 부모 "울산앞바다").
- **해역명 해석** `_resolveZoneName`(215): `warn_zone_cd` → `MMIS_CODE_TO_NAME`(93개, `:115`) 정식명. 없으면 `warn_zone_nm` 폴백(공백제거).
- **발효 추출** `getActive`(288): parents entry가 예비·해제 아닌 경우. **예비 추출** `getUpcoming`(282): parents가 예비면 그것, 아니면 upcomings.
- **upcomings의 존재 이유**: 발효중 부모에 새 예비가 공존하면(병렬), 발효를 우선 드롭하던 과거와 달리 예비를 별도 트랙에 보관해 **발효+예비 병렬 표출/푸시**(2159-2164).

매핑 결과(`_buildSnapshotFromMarine`): `warn/list`→`parents`, `warn-sasc/list`→`children[부모]`, `warn/ready` 부모형은 발효중이면 `upcomings` 아니면 `parents`, `warn/ready` 자식형+`warn-sasc/ready`→`children`. 모든 행은 두 게이트 통과: `_isLiveRow`(2100, 메타행 제외), `_isTargetRealtimeType`(2068, 풍랑V·태풍T allowlist).

### 5.3 보강(enrich) 3종 요약

| 보강 | 함수 | 목적 | 표식 |
|---|---|---|---|
| warn/latest 부모 GAP | `_enrichSnapshotWithLatest` (2207) | 발표대기 부모를 예비로 추가(정확 tm_ef), 자식은 prev carry 또는 `PARENT_TO_CHILDREN` 합성(2314-2347) | `wrnLvlNm='예비'` |
| warn/latest 해제 보강 | 〃 (cmd='해제') | 발효중 zone의 `clrNtcTm`을 latest 정확 `tm_ef`로 갱신 | 정확 해제시각 |
| warn-sasc/latest | 〃 | 자식별 통보문으로 부분집합 정확 반영 + 자식 해제예고 보강 | `_childReleaseNoticeSet` 채움 |
| ef/list 발표대기 | `_enrichSnapshotWithEfList` (2503) | warn/latest 창을 놓친 발표대기를 `ed_tm`과 함께 예비로 추가. 실시간이 이미 커버하면 skip(2522-2524) | **`_efBridged=true`** |

`_isFutureExactTime()`: "YYYY.MM.DD HH:MM"이 현재(KST)보다 미래일 때만 발표대기로 인정(발효시각 경과분 자동 제외 → 유령특보 방지).

### 5.4 가드·변형 로직 6종 (상세)

모두 `_buildUserPushChanges`(diff)와 `_writeWeatherAlertsJson`(표출) **이전**에 curr를 in-place 변형해 **푸시와 화면이 항상 같은 진실**을 본다.

1. **E-1 빈 prev 가드** (run() 인라인, 2678-2693): 콜드부팅 직후 prev가 비어 활성 특보 전부가 "신규"로 diff되는 push 폭주를 막음. 조건 `_isSnapshotEmpty(prev) && !forceBaseline && isFirstLoad`. `isFirstLoad`(2616) 덕에 첫 호출에만 작동(`6df054a`로 좁힘). 자연 전이(가동 중 무특보→신규)는 통과. `forceBaseline`(관리자 장부 초기화)이면 우회. `resetState`가 `_forceBaselinePending` 예약(2591)해 cron과 겹쳐도 다음 사이클 baseline 보장.
2. **의심 가드** `_applySuspiciousGuard` (774): clr_ntc_tm 없이 발효 부모가 `SUSPICIOUS_THRESHOLD(=3)`개↑ 동시 소멸 시 의심 → curr에 prev 정보 복원(부모+자식+공존예비, 824-838)해 release 보류. 분류 `_classifyReleases`(745): clr 있으면 정상해제, 없으면 의심(**예비 소멸은 제외**, 756). 관리자 `decideSuspiciousCase('normal'|'invalid')`(890) 전까지 자동 처리 X, 10분(`PUSH_REINFORCE_INTERVAL`)마다 재알림. `marine_suspicious_state.json` 영속. (알림 push는 `ADMIN_PUSH_ENABLED=false`라 OFF, **가드 로직은 유지** — 869.)
3. **자식 해제 디바운스** `_applyChildReleaseDebounce` (976): 해제예고 없이 사라진 자식을 `CHILD_RELEASE_DEBOUNCE_MS(=3분)` 관찰, 그동안 prev 자식 carry(1002-1005). `_childReleaseNoticeSet`(3단계 세팅, 해제 통보문 있는 자식)이면 면제·즉시 해제(989-993). 3분 경과 시 carry 중단 → CHILD_RELEASE 발사.
4. **발표시각 고정(anchor)** `_applyAnnounceAnchor` (1040): 현재 발효등급의 **최초 발표시각**을 고정. 예비→발표→발효→해제 동안 불변, 격상/격하·종류변경·해제 시에만 재설정. 이어받기: ① prev 동급(예비는 모든 등급의 전구체) → ② 공존 예비 tmFc(1054) → ③ `_extensionMemory`(5분 핸드오프 공백, 1061).
5. **시각 윈도우 고정 + 연장** `_applyTimeWindowHold` (1156): 9단계 공통 엔진. **윈도우**(`_clrWindowEnd`/`_efWindowEnd`)=처음 확립된 범위의 끝 시각키. **윈도우 안**=정확시각 발표되면 그 값으로 고정(prev에 없으면 `_extensionMemory`에서, 1166-1169). **윈도우 초과**=연장 플래그(`_clrExtend`/`_efExtend`) + 윈도우 갱신. **`*Disp` 표시형 보존**(1181-1192): 비교용 `info[field]`는 정확값, 화면 표출용 `info[fieldDisp]`는 KMA 통보문과 동일한 범위형 sticky. 자식도 직전 정확값 고정 + `*Disp` 보존(윈도우/연장 판정은 부모만, 1201-1214).
6. **시각 변경 디바운스** `_debounceTimeValues` (1247): `TIME_CHANGE_DEBOUNCE_MS(=3분)` 연속 유지 시에만 확정(`_tcConfirmed`). 미확정 시 직전 확정값으로 되돌리고(1269) 연장 플래그 제거(1270). **최초값은 즉시 수락**(1257). `_sameReleaseMoment`로 범위↔정확 동일 모멘트는 변화 아님으로 흡수(1258).

> 보조 기억 `_extensionMemory` (1098, TTL 6시간 / 핸드오프 브릿지 5분): zone별 active/upcoming 직전값 보관. 4·5·12의 "prev 체인이 끊긴 공백"을 메우는 공유 자원.

### 5.5 사용자 푸시 경로

**푸시 두 갈래**:
1. **사용자 채널 (켜짐)** — `_buildUserPushChanges` → `push_sender.processChanges` → `/api/push-custom`(routes/push.js) → `generateMessage` → FCM/WebPush.
2. **관리자 채널 (꺼짐)** — `runDiffAndPush`(DiffMatrix/EventDispatcher) → `dmdw_push_sender`. `ADMIN_PUSH_ENABLED=false`(52)라 11단계에서 호출 자체 skip. 코드·가드 로직은 rollback/감사 대비 보존.
> **결과**: 사용자 푸시는 `_buildUserPushChanges`+`push_sender` 경로만 동작. **종류 격상/격하(`type_*`)는 DiffMatrix(관리자 채널)에만 버킷이 있어 사용자 경로로는 발사되지 않음**. 풍랑↔태풍 전환은 등급 동반 변동 시 `level_*`로만 처리됨.

#### `_buildUserPushChanges(prev, curr)` (1315) → change 종류

| type | 트리거 조건(요약) | templateId 매핑 |
|---|---|---|
| `UPCOMING_CHANGE` | 예비(upcoming) 블록 변화. `currentActive` 동봉(격상/격하 판정) | `publish`/`time_ef_change`/`level_*_publish` |
| `UPCOMING_CANCEL` | 예비가 사라졌고 발효 승격도 아님(`!currUpcoming && prevUpcoming && !currActive`) | `prelim_cancel` |
| `CURRENT_CHANGE` | 발효(active) 블록 변화(신규/해제/격상격하/시각변경) | `active`/`release`/`level_*_active`/`time_yn_change` |
| `EF_EXTEND` | 예비 발효예정(tmEf)이 더 늦은 **범위→범위** 연장 | `ef_extend` |
| `YN_EXTEND` | 발효 해제예정(tmYn)이 더 늦은 범위→범위 연장, **동급일 때만** | `yn_extend` |
| `CHILD_ADD` | 부모 불변, 자식만 추가 | `additional_active` |
| `CHILD_RELEASE` | 부모 불변, 자식만 해제 | `partial_release` |
| `CHILD_EF_EXTEND`/`CHILD_YN_EXTEND` | 부모 불변, 자식만 연장 (childState.extended) | `ef_extend`/`yn_extend` |

- **블록 동등성** `blockEqual`(1347): wrnTp/wrnLvl 일치 + tmEf/tmYn이 같거나 `_sameReleaseMoment`(범위 끝↔정확 동일). warn/latest 깜빡임 가짜 푸시 흡수.
- **핸드오프 공백**(1409-1419): 예비가 잠깐 사라졌다 재등장하면 prev 빔 → "신규 발표" 오인 → `_extensionMemory`(5분)로 prev 복원 → "변경/연장"으로 처리.
- **연장 vs 격상/격하 분리**: 연장은 **동급 + 범위→범위**일 때만(1475, 1564). 등급 다르면 격상/격하 푸시.
- **`_efBridged` 발송이력 dedup** (1391-1399, PR #820): ef/list로만 잡힌 발표대기는 — 발송이력(`_pushedPubs`, 키 `_pubKey="zone|종류|tmFc"`, `:2434`)에 **있으면 skip**(이미 발표 푸시됨), **없으면 1회 발송 + 기록**(발표 순간을 통째 놓쳐 ef/list가 최초 포착). 이력은 `data/marine_pushed_pubs.json`에 **7일 TTL** 영속(**첫 발송 시 런타임 생성**). 발효시각 도래로 `warn/list` 승격 시엔 `_efBridged`가 아니므로 정식 발효 푸시 정상 발사.

#### `/api/push-custom` (routes/push.js:240) — 구독자별 필터

구독자(`SUBS_FILE`)마다: ① 마스터 OFF(`user.options.master===false`) skip → ② zone 매칭(`getMatchedZones`, 교집합 없으면 skip) → ③ 자식 한정사 토글(`showChildZones = !(options.childZones===false)`, 기본 ON) → ④ 본문 생성(`generateMessage`, 비면 미발송) → ⑤ 시나리오 토글 필터 → ⑥ FCM(`admin.messaging().send`, 395) 또는 Web Push(419). 죽은 토큰은 `_isDead` 표시 후 제거. 연장은 본문 길면 `paginateByZoneBlocks` (n/N) 분할. 점검 모드(`maintenance_config.json`)면 차단. 실패 건은 `pending_pushes.json`(최대 20건, 24h 만료) 재시도.

#### `generateMessage` (push_helpers.js:224) — 본문 생성
- templateId별 제목/본문(§6 표 참조). `decorateZone`(240): `showChildZones` 켜졌고 childState 있으면 부모명 옆에 `buildChildQualifier`(533) 한정사 부착.
- 시각은 `formatWarnTimeKST`(34)로 포맷(푸시는 상대일자 라벨 미사용).
- **`buildChildQualifier`**: 자식 없는 부모(먼바다 등 `PARENT_CHILD_TYPE` 미등록)는 빈 한정사(539, 과거 "(연안바다 미발효)" 오표시 버그 수정). `release`/`prelim_cancel`→없음.

### 5.6 표출 경로 — `_writeWeatherAlertsJson` (1974) → 프론트

- `_buildZoneTreeFromSnapshot`(1887)이 스냅샷을 zone 트리로 변환(legacy 호환): `wrnTp`/`wrnLvl` 한글 우선(MMIS V/2 → "풍랑"/"주의보", 1899-1901), `tmCc=clrNtcTm`(옛 필드명, 1907), **시각 = `normalizeMmisTime(*Disp || 원본)`**(표시형 범위 우선, 1905-1908). 예비→`leaf.upcoming`, 발효→`leaf.current`, 공존 예비→`leaf.upcoming` 병렬(1923-1930), 자식→`leaf.children`(예비는 표출용 '주의보'로 정규화, 1944-1957).
- `data/weather_alerts.json` 구조: `{ updatedAt, lastReportId, previous, current }`. atomic write(tmp→rename). 디스크의 history/메타(`lastReportId`, `processedReportIds`, `pendingRetries`, leaf history)는 **보존**하고 current/previous만 덮어씀(1996-2019).
- 프론트 `js/data.js`(155)가 `rootData.current` 순회 → `js/utils.formatWarningTime`(utils.js:118)이 최종 한글 시각 렌더(상대일자 "오늘/내일/모레/글피", 범위 6시간 블록 스냅, :58/:59 재복원). **즉 시각은 서버 `normalizeMmisTime` → 프론트 `formatWarningTime` 2단계로 정규화**되며, 서버가 `*Disp`(범위형)를 우선 기록한 덕에 통보문 원형이 화면까지 일관 전달된다.

### 5.7 상태 영속 파일 (`local_server/data/`)

| 파일 | 역할 |
|---|---|
| `marine_warning_state.json` | prev 스냅샷(다음 사이클 비교 기준, 재배포에도 유지) |
| `marine_suspicious_state.json` | 의심 가드 상태 |
| `marine_pushed_pubs.json` | 발송이력(7일 TTL). **첫 발송 시 런타임 생성** |
| `pending_pushes.json` | 발송 실패 재시도 큐 |

---

## 6. 시각 표시 규칙 (범위형/정확형/:58·:59)

### 6.1 범위형 vs 정확형
- **범위형**: "22일 21시 ~ 24시", "2일 새벽(00시~06시)", "2026.06.02 23~23시". 예비특보·발효예정·해제예고처럼 **불확실한 미래 시각**(6시간 블록 등)에 사용.
- **정확형**: "2026.05.23 01:00" 또는 12자리 "YYYYMMDDHHmm". 발효/해제가 확정된 시각(통보문 `tm_ef`). 통상 **분의 일의자리가 0**(00/10/…/50).

우리 앱의 표시 정책은 두 단계를 거쳐 정착했다(상세 §13):
- **(구) 표시용 범위형 sticky** (`tmEfDisp`/`clrNtcTmDisp`, `_applyTimeWindowHold`): 같은 모멘트면 정확값이 와도 범위로 표시해 깜빡임을 막으려 했으나, **확정된 정확 시각까지 옛 범위로 가려** 발효시각이 갱신 안 되는 문제(§13-A) 발생.
- **(현) 표시 = 확정값** (`info.tmEf`): 표출을 비교/푸시용 값 `info.tmEf`로 단순화(`_writeWeatherAlertsJson`). `info.tmEf`는 (a)정확시각이 오면 그 시각, (b)범위만 오면 범위, (c)정확값을 본 뒤엔 그 값으로 고정(held), (d):58/:59 코드는 `normalizeMmisTime`이 범위로 변환 — 즉 **"확정이면 정확, 예측이면 범위"**가 자연스럽게 표출되고, 깜빡임은 `info.tmEf`의 held/디바운스(3분)가 이미 방지한다. 연장 판정용 윈도우(`_efWindowEnd`)만 유지하되 앞당김 시 동기 폐기(가짜 연장 방지, §13-A).

### 6.2 :58 / :59 — KMA 6시간 블록 범위 코드

정확형 시각의 **분이 58 또는 59**이면 진짜 분이 아니라 **시간대(6시간 블록) 범위 코드**다. 해당 블록 범위로 복원한다.

> ⚠️ 이는 **검증된 절대 규칙이 아니라 기존 관례·통상적 경향**이다(§8-D 정정 참고). 안전장치로 이 처리는 **표시에만 적용**되며 비교/푸시는 정확값을 쓰므로, 설령 진짜 :58/:59에 발효되는 특보가 나와도 푸시 오발송은 없다.

서버 — `normalizeMmisTime`(`marine_warning_crawler.js:1876-1880`):
```js
if (mm === 58 || mm === 59) {
    const block = (hh >= 18) ? '18시~24시' : (hh >= 12) ? '12시~18시'
                : (hh >= 9)  ? '09시~12시' : (hh >= 6)  ? '06시~09시' : '00시~06시';
    return `${Y}년 ${M}월 ${D}일 ${block}`;
}
```
복원 깊이 3곳(이중·삼중 안전망): `normalizeMmisTime`(서버) + `js/utils.js formatWarningTime`(:160/:186/:195) + `services/push_helpers.js fmtUserKMA`.

`normalizeMmisTime` 전체 변환 규칙(시간대 명칭: 00~06=새벽, 06~09=아침, 09~12=오전, 12~15=낮, 15~18=늦은 오후, 18~21=저녁, 21~24=밤):
| 입력 | 출력 |
|---|---|
| `"22일 21시 ~ 24시"` | `"22일 밤(21시~24시)"` |
| `"2026.06.02 23~23시"` | `"2026년 06월 02일 밤(23시~23시)"` |
| 이미 `~` 포함 | 그대로 통과 |
| `"2026.05.21 06:00"` | `"2026년 05월 21일 06시 00분"` (정확형) |
| `"2026.06.01 05:58"` | `"2026년 06월 01일 00시~06시"` (:58 → 블록) |

### 6.3 예비특보 vs 직접발표
- **예비특보**: 발효 가능성을 미리 알림 → `warn/ready`. `warn_lvl_nm='예비특보'`를 `_normLvlNm`(2053)이 `예비`로 정규화.
- **직접발표**: 주의보/경보를 곧바로 발표. 발효시각이 미래면 §4-②의 GAP. GAP/예비 모두 내부적으로 `wrnLvlNm='예비'`로 취급하되, 화면 배지·표시는 `wrnLvl`로 구분(표시용 '주의보' 보정).

---

## 7. 시나리오별 작동 전수 표

표기: 정상 = 통상 흐름 / 주의 = 가드 개입 / 엣지 = 특수상황. "prev→curr"는 부모 zone 상태 전이.

| # | 시나리오 | 등급 | ① KMA 데이터/엔드포인트 | ② 우리 보강·가드·로직 | ③ 화면 표시 | ④ 푸시 (templateId / 미발송) |
|---|---|---|---|---|---|---|
| 1 | **예비특보 신규 발표** | 정상 | `warn/ready`에 예비 부모 등장(prev 없음) | `_buildSnapshotFromMarine`→예비, anchor가 tmFc 신규 앵커 | upcoming(예비), 발효예정 범위형 | `publish` — `📢 풍랑 주의보 발표`(예비→주의보 보정) |
| 2 | **직접발표(발표대기) 신규** | 주의 | warn/list엔 없음(발효전), `warn/latest`가 잠깐 보유 | `_enrichSnapshotWithLatest` GAP→예비 추가, 자식 carry/합성 | upcoming(예비), 발효예정 **정확시각** | `publish`(warn/latest 즉시 포착 시) |
| 3 | **발표 순간 통째누락 → ef/list 최초포착** | 엣지 | latest 창 놓침, `ef/list`만 ed_tm으로 보유 | `_enrichSnapshotWithEfList`→`_efBridged`. 이력에 **없으면 1회 발송+기록** | upcoming(예비) | `publish` **1회**(이력 dedup, #820) |
| 4 | **재배포/공백 후 재발견(이미 발송됨)** | 주의 | ef/list가 같은 통보문 재공급 | `_efBridged` + 이력에 **있음** → diff 루프 `continue` | 유지 | **미발송**(재푸시 방지) |
| 5 | **발표대기 → 발효 전환** | 정상 | 발효시각 도래 → warn/list·sasc/list로 인계 | 예비→active, `_efBridged` 아님(실시간 승격) | upcoming 사라지고 current | `active` — `🚨 풍랑 주의보 발효` |
| 6 | **발효중 유지(무변화)** | 정상 | warn/list 동일 | `blockEqual`로 동일 판정 | current 유지 | **미발송** |
| 7 | **해제(부모+자식 동시)** | 정상 | warn/list에서 사라짐 + `warn/latest` cmd=해제 정확시각 | latest가 정확 해제시각 보강, clr 등록돼 의심 미해당 | current 사라짐 | `release` — `✅ 풍랑 주의보 해제` |
| 8 | **예비취소(발효 없이 소멸)** | 정상 | 예비가 warn/ready에서 사라짐, active 승격 X | `!currUpcoming && prevUpcoming && !currActive` → `UPCOMING_CANCEL` → `prelim_cancel`. 의심가드는 예비 제외 | upcoming 사라짐 | `prelim_cancel` — **`✅ 풍랑 예비특보 취소`** (PR #821로 수정 완료, §8-F) |
| 9 | **격상(주의보→경보) 발효** | 정상 | warn/list 등급 변화 | `prev.wrnLvl!==curr.wrnLvl` + score↑ → `level_upgrade_active`, anchor 재설정 | current 등급 갱신 | `level_upgrade_active` — `🚨 풍랑 주의보→경보 격상 발효` |
| 10 | **격상 발표(예비 단계)** | 정상 | warn/ready 예비 등급↑ + 발효 동반 | UPCOMING_CHANGE + currentActive score 비교 → `level_upgrade_publish` | upcoming 갱신 | `level_upgrade_publish` — `📢 풍랑 주의보→경보 격상 발표` |
| 11 | **격하(경보→주의보)** | 정상 | warn/list 등급↓ | score↓ → `level_downgrade_active`/`_publish` | current/upcoming 갱신 | `level_downgrade_active` — `🚨 풍랑 경보→주의보 격하 발효` |
| 12 | **발효시각 변경(예비)** | 정상 | latest/ready tmEf가 다른 모멘트로 변경 | `_applyUpcomingEfLogic` 윈도우 안 + `_debounceTimeValues` 3분 확정 | 발효예정 갱신 | `time_ef_change` — `🕐 발효시각 변경` |
| 13 | **해제예정 시각 변경(발효)** | 정상 | warn/list/latest clrNtcTm/tmYn 변경 | `_applyReleaseClrLogic` 윈도우 안 + 3분 디바운스 | 해제예정 갱신 | `time_yn_change` — `🕐 해제시각 변경` |
| 14 | **발효예정 연장(예비)** | 정상 | tmEf가 더 늦은 범위형(윈도우 초과) | `_efExtend` + EF_EXTEND, 동급·범위→범위만 | 발효예정 늦춰짐 | `ef_extend` — `🕐 풍랑 주의보 발효 예정시각 연장`(기존/변경후 병기) |
| 15 | **해제예정 연장(발효)** | 정상 | clrNtcTm/tmYn 더 늦은 범위형 | `_clrExtend` + YN_EXTEND, **동급일 때만** | 해제예정 늦춰짐 | `yn_extend` — `🕐 풍랑 주의보 해제 예정시각 연장` |
| 16 | **자식만 추가 발효** | 정상 | warn-sasc/list에 자식 추가, 부모 불변 | `!upcomingChanged && !activeChanged && c` + addedChildren → `CHILD_ADD` | current에 자식 추가 | `additional_active` — `📢 풍랑 주의보 추가 발효` `(○○연안바다 추가 발효)` |
| 17 | **자식만 일부 해제** | 정상 | warn-sasc/list에서 자식 사라짐(부모 유지) + 해제통보문 | 디바운스: `_childReleaseNoticeSet`에 있으면 즉시 → `CHILD_RELEASE` | 해당 자식 제거 | `partial_release` — `✅ 풍랑 주의보 일부 해제` `(○○만 해제)` |
| 18 | **자식 단독 시각 연장** | 정상 | 자식 tmEf/tmYn 더 늦은 범위형, 부모 불변 | `CHILD_EF_EXTEND`/`CHILD_YN_EXTEND`, childState.extended | 자식 시각 늦춰짐 | `ef_extend`/`yn_extend`. **childZones OFF면 본문 비어 미발송** |
| 19 | **범위형↔정확 깜빡임** | 주의 | latest가 범위↔정확 번갈아 줌 | `_sameReleaseMoment` 동일 모멘트 + `*Disp` sticky + 3분 디바운스 | 범위형으로 **안정**(깜빡임 없음) | **미발송**(가짜 변경 차단) |
| 20 | **:58/:59 범위코드** | 엣지 | tm 분이 58/59 | `normalizeMmisTime`이 6시간 블록 복원 | `00시~06시` 등 블록 표시 | 표시만 영향(비교는 정확값) |
| 21 | **무특보 → 신규특보 (가동중)** | 정상 | 가동 중, prev 일부 비었으나 cold 아님 | E-1 가드 `isFirstLoad`만 막음 → **통과** | 신규 표시 | 정상 발사. 6df054a 수정 핵심 |
| 22 | **콜드부팅 첫 사이클에 특보 존재** | 주의 | 부팅 직후 prev 빔 + 발효/예비 다수 | E-1 가드: push skip + baseline 저장 + weather_alerts.json만 갱신 | 즉시 fresh | **미발송 1회**(폭주 방지). 이후 정상 |
| 23 | **콜드부팅 + 강제 baseline(테스트)** | 엣지 | 관리자 "장부 초기화(테스트 푸시)" | `forceBaselinePush`/`_forceBaselinePending`로 E-1 우회. adminToken이면 관리자 기기에만 | 동일 | 활성 특보 **전부 신규 발사**(adminToken 기기 한정) |
| 24 | **MMIS 빈응답(부분 실패)** | 주의 | 실시간 4종 중 하나 rejected | `fetchAllRealtimeEndpoints` throw → cycle 통째 skip | 직전 상태 유지 | **미발송**(이번 1분 0회) |
| 25 | **MMIS 누락으로 발효부모 3개↑ 동시소멸** | 주의 | clr 없이 발효부모 다수 사라짐 | 의심가드: curr에 prev 복원 → release 보류, 10분 재push(관리자 채널 꺼짐) | 발효 유지(위장) | **미발송**(관리자 결정 대기) |
| 26 | **자식 글리치 깜빡임** | 주의 | warn-sasc/list 자식 잠깐 누락 | 자식해제디바운스 3분 carry, 복귀 시 정리 | 자식 유지 | **미발송** |
| 27 | **야간(night 토글 OFF)** | 정상 | 어떤 변화든 발생 | 가드 정상 → changes 생성 | 표시 갱신 | **KST 23~07시면 전건 미발송**(routes/push.js) |
| 28 | **ef/list 인증 실패** | 주의 | 로그인 1·2차 모두 실패 | ef/list만 skip, 30분 캐시 fallback, 비로그인 cycle 정상 | 표시 정상 | 정상(ef 보강만 빠짐) |

### 7.1 엣지 케이스 심화

| 상황 | 메커니즘 | 결과 |
|---|---|---|
| 예비 + 발효 **공존** | `upcomings` Map에 예비 별도 보관, `_buildUserPushChanges`가 병렬 처리 | 발효+예비 둘 다 표시·푸시 가능 |
| 발표대기 자식 부분집합(3개 중 1개만) | `warn-sasc/latest`가 자식별 통보문 제공 → 실제 발표 자식만 추가 | 정확한 부분집합 표시 |
| 예비 잠깐 이탈 후 연장 재등록 | `_extensionMemory`(6h retention, 5분 bridge)로 복원 → "신규 발표" 오인 방지 | `time_ef_change` 또는 `ef_extend` |
| 발효시각 경과한 ef/list 행 | `_isFutureExactTime` false → 보강 제외 | 유령특보 방지(미발송) |
| 자식 set 변화 + 시각 변화 동시 | 사용자 경로는 부모블록 변화 우선, 부모 불변일 때만 자식 독립 푸시 | 푸시 1회로 통합(중복 방지) |
| `decideSuspiciousCase('normal')` | prev에서 해당 zone 제거 → 다음 cycle 정상 해제 유도 | 정상 해제 처리 |
| 종류 변경(풍랑↔태풍) | DiffMatrix `type_*` 버킷은 관리자 채널 꺼짐. 사용자 경로는 등급 동반 시 level_*로만 | 사용자엔 type_* 미발사 |
| 점검(maintenance) 모드 | `push_sender`가 `maintenance_config.json` 확인, active면 차단 | 전건 미발송 |
| 발송 실패 | `pending_pushes.json`(최대 20건, 24h 후 폐기), 다음 cycle 재시도 | 재시도 발송 |

### 7.2 푸시 templateId 전체 목록과 문구

`generateMessage()`(사용자 경로, push_helpers.js)가 만드는 제목. `effectiveLevel`: '예비'→'주의보' 표시 보정.

| templateId | 제목 | 본문 시각 | 비고 |
|---|---|---|---|
| `publish` | `📢 {종류} {등급} 발표` | 발효예정 | 예비특보 발표 |
| `active` | `🚨 {종류} {등급} 발효` | 해제예정 | 발효 |
| `release` | `✅ {종류} {등급} 해제` | (없음) | 부모+자식 동시 해제 |
| `level_upgrade_publish` | `📢 {종류} {이전}→{이후} 격상 발표` | 발효예정 | |
| `level_upgrade_active` | `🚨 {종류} {이전}→{이후} 격상 발효` | 해제예정 | |
| `level_downgrade_publish` | `📢 {종류} {이전}→{이후} 격하 발표` | 발효예정 | |
| `level_downgrade_active` | `🚨 {종류} {이전}→{이후} 격하 발효` | 해제예정 | (관리자판은 🔻) |
| `time_ef_change` | `🕐 발효시각 변경` | 발효예정 | announce 계열 |
| `time_yn_change` | `🕐 해제시각 변경` | 해제예정 | active 계열 |
| `additional_active` | `📢 {종류} {등급} 추가 발효` | 해제예정 | 자식만 추가 |
| `partial_release` | `✅ {종류} {등급} 일부 해제` | (없음) | 자식만 해제 |
| `ef_extend` | `🕐 {종류} {등급} 발효 예정시각 연장` | 기존/변경후 병기 | announce 계열 |
| `yn_extend` | `🕐 {종류} {등급} 해제 예정시각 연장` | 기존/변경후 병기 | active 계열 |
| `prelim_cancel` | `✅ {종류} 예비특보 취소` | (없음) | **PR #821로 사용자 경로 제목 분기 추가 완료**(push_helpers.js:395) |

자식 한정사(`buildChildQualifier`, childZones ON일 때만): `(연안바다 미발효)`/`(모든 연안바다 포함)`/`(○○연안바다 포함)`/`(○○ 추가 발효)`/`(○○만 해제)`/`(모든 연안바다 해제)`/`(연안바다 격상 없음)`/`(연안바다만 시각 변경)` 등. `release`/`prelim_cancel`은 한정사 없음.

### 7.3 사용자 토글 필터 (routes/push.js, 없으면 기본 ON)

| 토글 OFF | 차단되는 templateId |
|---|---|
| `master=false` | **전부** |
| `announce=false` | `publish`, `level_*_publish`, `time_ef_change`, `ef_extend` |
| `active=false` | `active`, `level_*_active`, `time_yn_change`, `additional_active`, `yn_extend` |
| `release=false` | `release`, `partial_release` |
| `childZones=false` | `additional_active`, `partial_release` + 자식 단독 연장(본문 비어 미발송) |
| `night=false` | **KST 23:00~07:00 전건 차단** |

### 7.4 라이브 실측 워크스루 (2026-06-01 제주 앞바다)

제주 **동/남/서부 앞바다**에 풍랑주의보 **18:00 직접 발표**(예비특보 아님), 발효예정 **20:00**. 제주 앞바다는 **부모**(연안바다 자식 보유), 먼바다는 별개 부모.

| 시각 | warn/ready | warn/latest | ef/list | warn/list | 앱 표출 |
|---|---|---|---|---|---|
| 18:00 발표 직후 | 없음 | ●(잠깐, 정확 20:00) | ● | 없음 | 발표대기(예비)로 표출 |
| **19:36** | 없음 | **[] (휘발됨)** | **●(계속)** | 없음 | **ef/list 덕에 유지** ★ |
| 20:55 (발효 도래) | 없음 | ─ | ● | **● 등장** | 발효중으로 전환(정식 발효 푸시) |

19:36 시점에 `warn/list`·`ready`·`latest` **어디에도 없고** `ef/list`에만 남아 있었다. 과거엔 이 순간 앱에서 특보가 **사라져 보였다**(§8-B의 핵심 사건). 현재는 `_enrichSnapshotWithEfList`가 메워 끊김 없이 유지.

---

## 8. 시행착오와 의사결정 (오판 → 정정)

각 문제를 증상 → 원인 → 해결로 정리하되, 특히 **우리가 틀린 판단을 한 지점과 바로잡은 과정**을 솔직히 남긴다.

### 종합 시행착오 표

| 문제 | 원인 | 해결 |
|---|---|---|
| 발표~발효 사이 특보가 앱에서 사라짐 | `warn/latest`가 통보문을 잠깐만 보유(휘발) | `ef/list`(영구 타임라인) 보강 추가 |
| ef/list 보강분이 재푸시됨 | 경로(latest↔ef/list)·재배포로 동일 통보문 재발견 | `_efBridged` 표식 + 디스크 발송이력 dedup |
| 발효/해제예정 시각이 깜빡임 | latest가 정확↔범위 값을 흔듦 | 비교용 정확값 고정 + 표시용 `*Disp` 범위 sticky + 3분 디바운스 |
| 콜드 부팅 시 푸시 폭주 | 빈 prev → 현재 특보 전부 "신규" 오인 | E-1 빈 prev 가드(콜드부팅 1회 한정) |
| 강풍·폭풍해일 유입 | 기존 `warn_tp===5` 숫자 가정 + denylist | 문자코드 allowlist `{V,T}`로 전환 |
| 예비특보 푸시 누락 | `warn/ready`를 통째로 버림 | ready 병합 + `예비특보`→`예비` 정규화 |
| 해제예고가 범위형이라 부정확 | `warn/list`는 현재 상태만 줌 | `warn/latest` 해제 통보문의 정확 `tm_ef`로 보강 |
| 자식이 부모값에 종속 표출 | "자식 응답에 시간 필드 없음" 가정 | 실측 결과 자식 개별 제공 확인 → 부모 fallback 제거(1932-1937) |
| 자식 글리치성 가짜 해제 | mmis 일시 누락으로 자식 깜빡임 | 3분 자식 해제 디바운스(`_childReleaseNoticeSet` 면제) |
| 격상/격하 vs 연장 혼동 | 연장 판정이 등급 변동을 흡수 | 연장은 동급+범위→범위일 때만(1475,1564) |
| 자식 없는 부모 한정사 버그 | 먼바다에 "(연안바다 미발효)" 오표시 | `PARENT_CHILD_TYPE` 미등록 시 빈 한정사(539) |
| 예비취소 푸시 무음 | 사용자 경로 generateMessage에 prelim_cancel 제목 분기 없음 | **PR #821로 분기 추가(아래 F)** |

### A. 특보 푸시 미발송 + 발효시각 표출 불일치 (복합 증상)
증상: ① 특보 푸시가 안 나감 ② 발효시각이 통보문은 범위형("새벽 00~06시")인데 앱은 정확형("05시 58분")으로 표출. 단일 원인이 아니라 **여러 원인의 복합**으로 판단 → B(누락), C(GAP 보강), D(표출), G(콜드부팅 가드), E/H(재푸시)로 분해해 각각 해결.

### B. 제주 앞바다 소멸 — "실제 해제" 오판 → "로직 문제" 정정 ⭐
- 증상: 제주 동/남/서부 앞바다가 앱 리스트에서 사라짐(먼바다는 유지).
- **오판**: 독립 에이전트 2명이 정반대 결론. 메인(과 에이전트2)은 "**실제 해제(정상)**"라 판단 → **틀림**. 이유: warn/list·ready·latest(공개 엔드포인트)에 안 보이니 "없는 게 맞다"고 봤으나, 이 엔드포인트들이 **발표대기(발효 전) 특보를 보유하지 않는다**는 사실을 간과.
- **정정**: 로그인해서 권위출처 `ef/list`를 직접 확인 + 통보문 대조 → 해당 특보는 **6/1 18:00 발표·발효예정 20:00의 실재하는 "발표대기" 특보**였다. "실제 해제"가 아니라 **발표~발효 사이 GAP에서 공개 엔드포인트가 못 보던 로직 누락**.
- **교훈**: 공개 엔드포인트만으로는 부족하다. 발표대기 구간의 진실은 권위출처(ef/list)에만 있다. "안 보이니 없다"는 추론은 데이터 소스의 한계를 모를 때 위험하다.

### C. 해결책 — ef/list로 발표대기 GAP 메우기
B의 깨달음대로 `_enrichSnapshotWithEfList(snap, efRows, prev)` 신설(커밋 `fb93b28`). 조건: 풍랑/태풍만, `warn_cmd_nm` 발표/변경/연장(해제 제외), `_isFutureExactTime(ed_tm)`(발효시각 미래만), 실시간이 이미 커버하면 skip. `_efRowToInfo(row)`: `wrnLvlNm='예비'`, `tmEf=ed_tm`, **`_efBridged:true`**. warn/latest 보강 직후 호출, 예외 시 30분 TTL 캐시 fallback. 자식은 prev 이어받기 또는 `PARENT_TO_CHILDREN` 합성.

### D. 시각 표출 — 비교용/표시용 분리, ":58 검증됨" 단정 오류 정정 ⭐
- 증상/원인: `warn/latest`가 같은 모멘트를 범위↔정확으로 깜빡여 가짜 푸시·깜빡임 발생 → 이를 막으려 `_applyTimeWindowHold`가 **표시값까지 정확값으로 고정**해 버림.
- 해결: **비교·푸시용** `tmEf`/`clrNtcTm`=정확값 고정, **표시용** `tmEfDisp`/`clrNtcTmDisp`=범위형 보존(신설, 커밋 `9a0df5f`). 같은 모멘트면 기억된 범위형 sticky, 윈도우 초과(연장)면 범위 폐기.
- **오판과 정정**: 처음 ":58은 **검증된(절대) 범위코드**"라 단정 → **틀림**. 사용자가 "그건 절대 규칙이 아니라 **통상적 경향(관례)**"이라 정정. 문구·근거를 관례 기반으로 낮추고(#819 PR 본문에 "⚠️ 검증된 절대 규칙이 아니라 기존 관례" 명시), **표시 전용 + 푸시 무영향** 안전장치로 오판 비용을 0으로 만듦(커밋 `4cd8ea4`/`b786ece`).

### E. 재푸시 방지 — "_efBridged 무조건 억제" 과함 → 발송이력 dedup 정교화 ⭐
- 1차(과함): `_efBridged`를 **무조건 푸시 억제**(커밋 `9eccae3`). 의도는 배포/공백 복귀 시 중복 방지.
- 문제: "처음부터 `_efBridged`면 무조건 막는다"는 규칙은 **발표 순간을 통째 놓쳐 ef/list로만 최초 포착되는 진짜 신규 특보**까지 막는다(→H). 신규인데 미발송.
- 2차(정교화, 커밋 `d825e2e`/#820): 영속 이력 `data/marine_pushed_pubs.json`(7일 TTL). 키 `_pubKey = zone|종류|tmFc`(anchor 고정으로 경로·사이클 무관 동일 통보문이면 같은 키). `_buildUserPushChanges`에서 `_efBridged && known`→skip, `!known`→1회 발송+기록, 실시간 발표→이력 기록.

| 상황 | 1차(무조건 억제) | 2차(발송이력 dedup) |
|---|---|---|
| 정상 발표(latest 포착) | 발송 ✅ | 발송 ✅ (+이력 기록) |
| 배포/공백 후 ef 재발견 | 억제 ✅ | 억제 ✅(이력 기준) |
| **발표순간 통째 누락 → ef 최초 포착** | **미발송 ❌** | **1회 발송 ✅** |
| 다른 통보문(다른 tmFc) | — | 별개 발송 ✅ |

### F. 예비특보 취소 무음 — 발견된 버그였고 #821로 수정됨 ⭐
- 증상: 예비특보가 발효 없이 취소되면 화면에서는 사라지나 취소 푸시가 안 감.
- 1차 해결(커밋 `b3821b7`): `_buildUserPushChanges`에서 **`UPCOMING_CANCEL`** 이벤트를 만들어(예비가 사라졌는데 발효 승격도 아니면 → 취소) 사용자 경로(`prelim_cancel`)로 연결.
- **발견된 버그(C 문서 지적)**: 그러나 사용자 경로 `generateMessage()`(push_helpers.js)에 `prelim_cancel` **전용 제목 분기가 없어**, `EVENT_TIME_FIELD` 맵엔 `prelim_cancel:null`로 등록돼 있었지만 제목/본문 생성 분기가 없어 한때 **Fallback `📢 {종류} 알림`**으로 발사됐다(`✅ 예비특보 취소` 문구는 관리자 전용 `buildAdminTitle`에만 존재). 다만 diff/그룹화/토글 분기는 정상이라 **푸시 자체는 발사**됐다(제목만 일반 형태).
- **수정 완료(PR #821, 커밋 `08185b9`)**: `generateMessage`에 prelim_cancel 분기 추가(push_helpers.js:395) → 이제 **`✅ {종류} 예비특보 취소`로 정상 발사**. 발효 승격과는 정확히 구분(승격이면 `currActive`가 차므로 발효 푸시로 처리).

### G. 무특보 → 신규특보 미발송 (E-1 빈-prev 가드)
- 증상: 장기 무특보였다가 새 특보가 발효됐는데 푸시가 안 나감.
- 원인: E-1 가드가 prev 빔이면 **매 사이클** push skip → 장기 무특보 후 자연 발생한 정상 발표까지 차단.
- 해결(커밋 `6df054a`): 가드를 **콜드부팅 1회로 한정**(`isFirstLoad = (_prevSnapshot === null)` 조건 추가). 재배포/장부 초기화 직후 1회만 차단, 가동 중 자연 전이는 통과. 부수: `/api/admin/marine/reset`에 `broadcastAll` 플래그 추가.

### H. 발표순간 통째 누락 (드묾)
- 증상: warn/latest 짧은 노출 창을 서버가 통째로 놓치면(다운/배포/사이클 스킵) ready에도 없고 한참 뒤 ef/list로만 최초 포착.
- 해결: E의 발송이력 dedup(#820). 이력에 없으면 1회 발송으로 이 좁은 공백을 메움.

---

## 9. PR 연혁

| PR | 제목 요지 | 상태 | 비고 |
|---|---|---|---|
| #810 | 데모 특보 단계 + 시간 ±1h 버튼 | 머지 | 운영 문구(generateMessage) 일치 |
| #811~#814 | 음성 비서(Vosk) + 평가 인프라 | 머지 | 본 주제와 별개 트랙 |
| #815 | KMA website reference | 머지 | |
| **#816** | :58/:59 한글 형식 + normalize 보강 (`b786ece`) | **머지** | D의 기반 |
| **#817** | ef/list 발표대기 GAP 보강 + 자격증명 고정 | **닫힘(머지 안 함)** | #819로 통합 |
| **#818** | 발효/해제 시각 표시형 보존(범위/확정형) | **닫힘(머지 안 함)** | #819로 통합 |
| **#819** | 오늘 수정분 5가지 **통합**(ef/list 보강 + 재푸시 방지 + 시각 표출 + :58 범위 + 예비취소 사용자 푸시) | **main 머지** (06-01 11:42, `960d9c5`) | #817·#818 대체. 머지충돌(marine_warning_crawler.js)은 main의 b786ece/6df054a와 겹쳐 → **main 버전 채택**해 해소 |
| **#820** | 발송이력 dedup (`d825e2e`, `data/marine_pushed_pubs.json`) | **main 머지** (06-01 12:08, `58998ca`) | E/H 최종 해결 |
| **#821** | prelim_cancel 사용자 경로 제목 수정 (`08185b9`) | **닫힘** → #825로 통합 | F 버그 수정 — generateMessage에 분기 추가 |
| **#822** | MMIS 히스토리 문서(본 문서) | **닫힘** → #825로 통합 | |
| **#823** | 표시=확정값(범위 sticky 폐지) + 앞당김 갱신 + 가짜연장 방지 | **닫힘** → #825로 통합 | §13-A |
| **#824** | 종류 격상/격하(풍랑→태풍) 푸시 감지·문구 | **닫힘** → #825로 통합 | §13-B |
| **#825** | **위 4건(#821·#822·#823·#824) 통합** + 예비취소 release 토글 연동·typeName 폴백 | **main 머지** (`03a750c`) | §13-C |
| **#826** | 예비취소 글리치 가짜발사 차단(`_applyUpcomingCancelDebounce`) | **열림 — 머지 가능(충돌 없음)** | §13-D |

main 기존 커밋: `b786ece`(:58 normalize), `6df054a`(E-1 콜드부팅 한정 + broadcastAll). 통합·충돌 해소 내러티브: ef/list 보강(#817)과 시각 표출(#818)을 처음엔 별도 PR로 진행했으나 같은 날 묶어 머지하는 게 명확해 #819로 통합하고 #817·#818은 닫음. 이후 추가 수정(#821~#824)도 같은 방식으로 #825 단일 PR로 통합 머지했고, 마지막 글리치 디바운스(#826)만 별도로 열려 있다(머지 시 오늘 작업 전부 반영). 머지 충돌은 이미 검증된 main 버전을 채택해 해소(정교화 보존).

---

## 10. 현재 상태와 남은 과제

### 도달 상태
- **단일출처**: 가동 크롤러는 `marine_warning_crawler.js` 하나, 1분 cron. 레거시 전부 주석 비활성.
- **사각지대 해소**: `warn/list`(발효중) → `warn/latest`(휘발 브릿지) → `ef/list`(영구 타임라인) 겹쳐 메워 발표~발효 GAP에서 특보가 사라지던 문제 해결.
- **표시 = 확정값**(§13-A): 표출을 `info.tmEf`로 단순화 — 확정 시각이 나오면 그 시각, 예측이면 범위, :58/:59는 범위. (이전 범위 sticky가 확정 시각을 가리던 문제 폐지. 깜빡임은 held/디바운스가 방지.) 앞당김 시 윈도우 동기 폐기로 가짜 연장도 차단.
- **재푸시 방지**: `_efBridged` 표식 + 디스크 발송이력(`marine_pushed_pubs.json`, 7일 TTL, 첫 발송 시 생성)으로 배포/공백 복귀 시 중복 차단, 발표순간 통째 누락도 1회 복구.
- **예비취소**: 사용자에게 `✅ {종류} 예비특보 취소` 정상 발사(제목 #821, release 토글 연동·typeName 폴백 #825). **글리치 가짜발사는 `_applyUpcomingCancelDebounce`(3분 carry, #826)로 차단** — 예비가 한 사이클 깜빡여도 가짜 취소 안 나감.
- **종류 격상/격하**(§13-B): 사용자 경로가 격상을 **점수(태풍>풍랑) 기반**으로 판정 → 같은 등급 종류격상(풍랑경보→태풍경보)도 `🚨 풍랑경보→태풍경보 격상 발효`로 정상 발사(#824).
- **운영 안전**: 콜드부팅 1회만 push skip, 자연 전이는 정상 푸시.
- **대상 한정**: 풍랑(V)·태풍(T)만 처리, 강풍·폭풍해일은 allowlist에서 자동 제외.
- **관리자 푸시 비활성**(`ADMIN_PUSH_ENABLED=false`) — 사용자 채널만 가동. (이전엔 종류격상도 사용자 경로 미발사였으나 #824로 사용자 경로에 이식됨.) 의심 "가드 로직"은 데이터 안전장치라 유지(알림만 OFF).
- **배포 상태**: #819·#820·**#825 main 머지 완료**(오늘 수정분 대부분 반영). **#826(예비취소 글리치 디바운스)만 열림 — 충돌 없음, 머지 시 오늘 작업 100% 반영.**

### 남은 과제
- **#826 머지**: 머지하면 오늘 작업 전부 main 반영(누락 없음). 그 전까지는 (드문) 예비 글리치 시 가짜 취소가 나갈 여지.
- **콜드부팅 첫 사이클과 발표가 정확히 겹치는 극히 드문 케이스**(이력 없는 첫 사이클 흡수)는 이론상 남으나, dedup의 "이력 없으면 1회 발송"이 대부분 커버.
- 관리자 채널은 OFF지만 코드·가드 로직은 보존되어 rollback/감사 여지를 남김.

---

## 11. 용어 사전

- **parents / children / upcomings**: StateSnapshot의 3 Map. 부모 발효 / 자식 발효 / (발효중 부모에) 공존하는 예비.
- **GAP(발표대기)**: 발표됐으나 발효시각 미래 → 실시간 endpoint 어디에도 없는 중간 상태. 우리 시스템은 예비로 취급.
- **`_efBridged`**: ef/list로만 보강된 발표대기 표식. 사용자 푸시 dedup 대상.
- **anchor(tmFc 고정)**: 발표시각을 생애주기 동안 고정해 통보문 식별·dedup 키 안정화.
- **윈도우(window)**: 처음 확립된 범위형 시각의 끝 시각키. 초과하면 연장으로 판정.
- **`*Disp`**: 표시 전용 범위형 문자열(비교용 정확값과 분리).
- **`_childReleaseNoticeSet`**: 이번 사이클 해제 통보문이 있는 자식 집합(디바운스 면제).
- **score(getAlertScore)**: 종류(태풍100/풍랑10) + 등급(경보5/주의보·예비2/해제0). 격상/격하 판별용.
- **prev/curr**: 직전 사이클(디스크 영속) / 이번 사이클 스냅샷.
- **E-1 가드**: 콜드부팅 첫 사이클 빈 prev에서 푸시 폭주 방지(6df054a로 콜드부팅 1회 한정).
- **ed_tm / st_tm (ef/list)**: ed_tm=발효(예정)시각, st_tm=발표시각.

---

## 12. 부록 — 주요 파일·함수 색인

- `local_server/services/marine_client.js` — `CRED_LIST`(:64), `PATHS`(:85), `login`(:231), `ensureAuth`(:333), `_unwrap`(:380), `fetchAllRealtimeEndpoints`(:438), `fetchWarnEfList`(:483)
- `local_server/marine_warning_crawler.js` — `ADMIN_PUSH_ENABLED`(:52), `PARENT_TO_CHILDREN`(:75), `MMIS_CODE_TO_NAME`(:115), `_resolveZoneName`(:215), `StateSnapshot`(:238)/`getUpcoming`(:282)/`getActive`(:288), `runDiffAndPush`(:613), `_classifyReleases`(:745), `_applySuspiciousGuard`(:774), `_applyChildReleaseDebounce`(:976), `_applyAnnounceAnchor`(:1040), `_extensionMemory`(:1098), `_applyTimeWindowHold`(:1156), `_applyReleaseClrLogic`(:1220)/`_applyUpcomingEfLogic`(:1228), `_debounceTimeValues`(:1247), `_buildUserPushChanges`(:1315), `normalizeMmisTime`(:1839)/`:1876-1880` :58 복원, `_buildZoneTreeFromSnapshot`(:1887), `_writeWeatherAlertsJson`(:1974), `_extractParent`(:2036)/`_normLvlNm`(:2053)/`REALTIME_TARGET_TP`(:2067)/`_isTargetRealtimeType`(:2068)/`_rowToParentInfo`(:2073)/`_isLiveRow`(:2100), `_buildSnapshotFromMarine`(:2124), `_enrichSnapshotWithLatest`(:2207), `_pubKey`(:2434)/`_efRowToInfo`(:2448), `_enrichSnapshotWithEfList`(:2503)/`_fetchEfListForGap`(:2544), `run`(:2604)
- `local_server/scheduler.js` — 1분 마스터 `setInterval`(:1524), legacy 주석(:1612), marine `run()` 호출(:1614), dmdw 주석(:1627)
- `local_server/push_sender.js` — `processChanges`(:70), `addToGroup`(:404), `/api/push-custom` POST
- `local_server/routes/push.js` — `/api/push-custom`(:240), 구독자 필터(:281-368)
- `local_server/services/push_helpers.js` — `formatWarnTimeKST`(:34), `generateMessage`(:224)/`prelim_cancel` 분기(:395), `buildChildQualifier`(:533), `buildAdminTitle`(:785, 관리자 전용)
- `local_server/js/utils.js` — `formatWarningTime`(:118), :58/:59 복원(:160,:186,:195)

---

## 13. MD 작성 이후 추가 수정 (시각 표시·종류격상·예비취소 보강)

본 문서 초안(§1~§12) 작성 이후 추가로 발견·수정한 내용. 이 절은 §6·§8·§10을 보강한다.

### A. 시각 표시 정책 전환 — 범위 sticky 폐지 → 표시 = 확정값 (#823)
- **시행착오**: §8-D에서 "표시용 `*Disp` 범위형 sticky"를 도입했으나, 운영 중 **확정된 정확 시각이 옛 범위에 가려 갱신 안 되는** 문제가 드러났다.
  - 실측 사례: 남해동부안쪽먼바다가 ef/list상 실제 발효시각 `6/2 00시`인데 화면은 옛 `06~12시`로 고착. 푸시("발효시각 변경 00시")는 정상인데 화면만 stale → **푸시값(`tmEf`)과 표시값(`tmEfDisp`)이 분리돼 어긋남**.
  - 1차 보정(sticky 유지): 정확값이 범위 [시작,끝] 밖이면(앞당김/연장) 폐기하도록 보강. 추가로 **앞당김 시 `winMap`도 동기 폐기**해 stale 윈도우發 가짜 "연장" 푸시를 막음.
  - **근본 정정(사용자 지적)**: "명확한 시각이 나오면 그 시각에 발효 확정인데 왜 범위를 유지하나?" → 타당. 깜빡임의 진짜 원인(`:58` 코드↔범위)은 이미 `normalizeMmisTime`의 :58→범위 변환이 해결하므로 **범위 sticky 자체가 불필요·유해**였다.
  - **해결**: 표출을 **`info.tmEf`(비교/푸시용 확정값)** 로 단순화(`_writeWeatherAlertsJson`). 확정이면 정확, 예측이면 범위, 코드면 범위가 자연 표출되고 깜빡임은 `info.tmEf`의 held·디바운스가 방지. 표시·푸시값이 일치해 일관성도 향상.
- **교훈**: 깜빡임 방지를 위해 표시 전용 상태를 따로 둔 게 과설계였다. 비교값이 이미 안정(held+디바운스)되어 있으면 표시는 그걸 그대로 쓰는 게 가장 단순·정확하다.

### B. 종류 격상/격하(풍랑→태풍) 사용자 푸시 누락 (#824)
- **증상**: 남해동부바깥먼바다가 풍랑경보→태풍경보(종류 격상, 등급은 둘 다 '경보')로 올라갔는데 푸시가 "🚨 격상"이 아니라 **"🕐 해제시각 변경 · 미정"**으로 나감.
- **원인(독립 조사 2건 일치)**: ①`push_sender` CURRENT/UPCOMING_CHANGE의 격상 판정이 **등급 문자열(`wrnLvl`)만 비교** → 등급이 같은 종류격상(경보→경보)을 못 잡고 시각변경(`time_yn_change`)으로 빠짐. ②사용자 경로 `generateMessage`에 **`type_upgrade` 문구 부재**(관리자 `buildAdminTitle`에만 있고 `ADMIN_PUSH_ENABLED=false`로 비활성).
- **해결**: 격상 판정을 **점수(`getAlertScore`: 태풍100>풍랑10) 기반**으로 확장(`prev.wrnTp!==curr.wrnTp`면 `type_upgrade/downgrade`), `generateMessage`에 종류격상 문구 추가(기존 `buildAdminTitle` 양식 그대로 "풍랑경보→태풍경보 격상 발효"). "태풍주의보를 건너뛴 점프"가 원인이 아니라 **"같은 등급에서 종류만 올라간 것을 못 잡은 것"**이 핵심.

### C. #821~#824 통합 + 예비취소 토글 보강 (#825)
- 추가 수정 4건(#821 제목·#822 문서·#823 표시·#824 종류격상)을 단일 PR **#825**로 통합 머지.
- 독립 검토 2건 지적 반영: 예비취소(`prelim_cancel`)가 어떤 콘텐츠 토글에도 안 걸려 무조건 발송되던 비대칭을 **✅ 해제 계열로 보고 `release` 토글에 연동**(`routes/push.js`), 제목 `typeName` 누락 방어 폴백 `'특보'` 추가.

### D. 예비취소 글리치 가짜발사 차단 — `_applyUpcomingCancelDebounce` (#826)
- **증상/위험**: 예비특보가 통보문 깜빡임(글리치)으로 **한 사이클 잠깐 사라졌다 재등장**하면, 사라진 사이클에 가짜 "✅ 예비취소"가 즉시 발사될 수 있었다(예비 소멸엔 디바운스·의심가드 보호가 없었음 — `_classifyReleases`가 예비 소멸을 제외, line 756).
- **설계(독립 에이전트 3건 만장일치)**: 검증된 `_applyChildReleaseDebounce` 패턴 이식. 예비가 **실시간·ef/list 양쪽에서 사라진 사이클**에 한해 직전 예비를 `curr`로 **3분 carry** → `currUpcoming`이 채워져 `_buildUserPushChanges`의 `UPCOMING_CANCEL` 분기(`!currUpcoming`)가 성립 안 함 → 가짜취소 원천 억제. **푸시 판정부 무수정.** 3분 안 재등장 시 흡수, 3분 연속 부재면 carry 중단 → 진짜취소 1회.
- **부작용 없음 근거**: ef/list 보강·의심가드·자식 디바운스 직후에 호출 → "둘 다 놓친 사이클"만 대상(ef 살린 사이클은 비대상), 발효 승격은 `currActive` 차서 비대상. carry 블록=prev 예비 그대로(`_efBridged` 미포함) → `blockEqual` 무변화 → 발표/변경/연장/격상/자식 등 다른 푸시 무영향. 비영속이라도 carry 특성상 재시작 시 가짜취소·누락 없음(타이머 리셋=지연만).
- **호출 순서**: `_applySuspiciousGuard` → `_applyChildReleaseDebounce` → **`_applyUpcomingCancelDebounce`** → `_applyAnnounceAnchor` → … → `_buildUserPushChanges`.

### 추가 시행착오 요약 (§8 보강)
| 문제 | 원인 | 해결 |
|---|---|---|
| 정확 시각 확정인데 화면이 옛 범위로 고착 | 표시용 범위 sticky가 확정값을 가림 | 표시를 확정값(`info.tmEf`)로 단순화 (#823) |
| 발효시각 앞당김 시 표시 미갱신 + 가짜 연장 | sticky가 늦어짐만 폐기·`winMap` stale | 앞당김 시 범위·`winMap` 동기 폐기 (#823) |
| 풍랑경보→태풍경보 종류격상이 "해제시각 변경"으로 | 격상 판정이 등급 문자열만 비교 + 사용자 `type_upgrade` 문구 부재 | 점수 기반 종류격상 감지 + `generateMessage` 문구 (#824) |
| 예비취소가 토글 무시·무조건 발송 | `release`/`announce` 토글 미매핑 | `release` 토글에 `prelim_cancel` 연동 (#825) |
| 예비 글리치로 가짜 "예비취소" 발사 | 예비 소멸에 디바운스 없음 | `_applyUpcomingCancelDebounce`(3분 carry) (#826) |
