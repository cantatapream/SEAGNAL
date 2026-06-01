# SEAGNAL 해상특보 시스템 — MMIS 통합 종합 히스토리

> **이 문서는 SEAGNAL 의 KMA MMIS (marine.kma.go.kr) API 통합 전체 메커니즘과 시행착오를 한 곳에 정리한 종합본입니다.**
>
> 처음 보는 사람이 이 한 문서만 보고 시스템 전체를 이해할 수 있도록, 4명의 독립 에이전트가 각자 다른 각도(엔드포인트 메커니즘 / 시나리오 상태머신 / 시행착오 timeline / 사용자 표출)로 작성한 초안을 모은 통합본입니다.
>
> 분량이 크므로 중복이 일부 존재할 수 있으나, 같은 사실을 여러 관점으로 교차 확인할 수 있도록 의도적으로 보존했습니다.

---

## 0. 이 문서를 읽는 법

이 문서는 4개의 독립 초안을 통합한 4부 구성입니다:

| 부 | 강조 영역 | 줄 수 | 가장 잘 다루는 주제 |
|---|---|---|---|
| **Part A** | 시나리오 상태머신 + lifecycle 도식화 | ~3,838 | 모든 lifecycle 케이스 (S-COLD, S-PRELIM, S-GAP, S-HANDOFF 등)의 입력→처리→출력 정형화 |
| **Part B** | MMIS 엔드포인트 메커니즘 + 데이터 모델 | ~1,588 | warn/list, warn/ready, warn/latest 등 엔드포인트별 역할과 데이터 shape |
| **Part C** | 시행착오 timeline + 판단 오류 추적 | ~1,752 | 5월 22일~6월 1일의 결정적 시행착오 5건 + 인지 추론 패턴 |
| **Part D** | 사용자 표출 + 푸시 텍스트 + 카드 UI | ~1,245 | 푸시 메시지 텍스트 카탈로그, 부모/자식 카드 표시 정책 |

**권장 읽기 순서**:
1. 시스템 개요만 빠르게 → Part A 의 § 1 + § 2 + § 3
2. 특정 시나리오 동작이 궁금하면 → Part A 의 § 4 (S-* 카탈로그)
3. 왜 이렇게 만들었는지 궁금하면 → Part C 의 시행착오 timeline
4. 사용자가 실제 보는 화면/푸시 텍스트 → Part D
5. 엔드포인트별 raw 데이터 shape → Part B 의 § 2

**핵심 파일 위치 (cross-reference)**:
- `/home/user/SEAGNAL/local_server/marine_warning_crawler.js` — 메인 크롤러 (~2,600줄)
- `/home/user/SEAGNAL/local_server/marine_client.js` — MMIS API 클라이언트
- `/home/user/SEAGNAL/local_server/push_sender.js` — 사용자 푸시 모듈
- `/home/user/SEAGNAL/local_server/services/push_helpers.js` — 푸시 메시지 포맷
- `/home/user/SEAGNAL/local_server/js/utils.js` — 프론트 시간 포맷
- `/home/user/SEAGNAL/local_server/js/render.js` — 부모 zone 렌더
- `/home/user/SEAGNAL/local_server/js/render_coastal.js` — 자식 zone 렌더
- `/home/user/SEAGNAL/local_server/routes/push.js` — `/api/push-custom`
- `/home/user/SEAGNAL/local_server/routes/admin.js` — admin endpoint
- `/home/user/SEAGNAL/local_server/scheduler.js` — cron orchestrator

**브랜치**: `claude/kma-website-reference-KYLtf` (main 보다 271 커밋 앞섬)

---


---

# Part A — 시나리오 상태머신 + Lifecycle 도식화

*독립 에이전트 #2 가 시나리오별 입력→처리→출력 정형화에 집중하여 작성한 초안.*


> 본 문서는 SEAGNAL(한국 해상기상 앱)이 기상청 통보문(HTML bulletin)
> 크롤링 방식에서 **MMIS(marine.kma.go.kr) 구조화 API** 방식으로 전환한 시점부터
> 현재까지의 모든 메커니즘 · 시행착오 · 시나리오 · 현재 상태를 정리한다.
> 신규 개발자가 본 문서 한 편으로 시스템 전체를 이해할 수 있는 것이 목표다.
>
> 작성 범위(Agent 2 담당):
>
> - 시나리오별 상태 머신(state machine) · lifecycle 도식
> - 케이스별 입력 → 전제조건 → 단계별 처리 → 출력 → 표출 정형화
> - state diagram (ASCII art) 위주 시각화
> - 데이터 흐름과 시행착오 히스토리를 시나리오 관점에서 재해석

---

## 목차

1. 개요
2. MMIS 데이터 모델
3. 데이터 흐름 (1분 cron → push + JSON 까지)
4. 시나리오별 동작 — 전체 lifecycle 케이스
5. 시행착오 히스토리 (시간순, 커밋 인용)
6. 현재 상태와 알려진 edge case
7. 부록 (용어 / 파일맵 / 구조체 / 디버깅)

---

# 1. 개요

## 1-1. SEAGNAL 의 사용자와 사명

SEAGNAL 은 한국 해상에서 활동하는 어선 · 낚시 · 해경 · 항해사 · 해양 레저 사용자에게
**기상청(KMA) 해상 특보(풍랑 · 태풍)** 와 해상 기상 예보 · 부이 관측 · 조석 데이터를
"제때, 정확히, 누락 없이" 전달하는 PWA(Progressive Web App) 형태의 모바일 앱이다.

핵심 차별점은 다음과 같다.

- **특보 lifecycle 전 단계 추적**: 예비 → 발효 → (변경/연장/격상/격하) → 해제예고 → 해제
  를 한 화면에 시각화하고, 단계 전환마다 사용자에게 push 알림을 발사한다.
- **자식 해역(연안바다 · 평수구역) 별도 추적**: 같은 부모 앞바다 안에서도 연안바다만
  주의보가 켜진 경우, 평수구역 일부만 해제된 경우 등 부분 발효/해제 상태를
  정확히 표시한다.
- **사용자 한정 필터**: 사용자가 구독한 해역(대분류 · 중분류 · 소분류 혼재) 만
  추려서 push 발사. "전체 해역 구독" 도 지원.

## 1-2. 해상 특보 lifecycle 의 본질

해상 특보는 단순한 "발효/해제" 두 상태로는 표현할 수 없는 다단계 lifecycle 을 가진다.

```
                         ┌──────────────────────────────────────────┐
                         │   특보 LIFECYCLE STATE MACHINE (전체)     │
                         └──────────────────────────────────────────┘

           (없음)
              │
              │   예비특보 발표 (KMA 통보문 발행)
              │   → warn/ready 에 row 등장 (warn_lvl_nm='예비특보')
              ▼
         ┌─────────┐
         │  예비   │   ◄──── 발효시각 변경 / 연장
         │ (UPCOM) │
         └─────────┘
              │
              │   발효시각 도달 (또는 사전등록된 발효 통보문 발행)
              │   → warn/list 로 이동 (warn_lvl_nm='주의보' or '경보')
              ▼
         ┌─────────┐
         │  발효   │   ◄──── 해제예정시각 변경 / 연장 / 격상 / 격하 / 종류전환
         │ (ACTIVE)│
         └─────────┘
              │
              │   해제예고시각 등록 (clr_ntc_tm) → 해제 통보문 발행
              │   → warn/list 에서 제거, warn/latest 에 cmd='해제' 남음
              ▼
           (없음)
```

**주요 등급/종류**
- 등급: `예비` (= 예비특보) / `주의보` / `경보` / `해제`
- 종류: `풍랑` (V) / `태풍` (T) ← SEAGNAL allowlist 대상
  - 그 외: `강풍` (W) / `폭풍해일` (O) / `한파` (C) / `대설` / `호우` ← 본 앱 대상 외

**중요한 비정형 케이스**
- "예비 → 정식 발효 없이 사라짐" = 예비특보 취소 (정식 해제와 분리)
- "발표 발효대기" = 통보문은 발행됐으나 발효시각이 아직 미래 → GAP
- "발효 도중 해제예고 후 연장" = clr_ntc_tm 이 범위형이었다가 더 늦은 시각으로 갱신
- "격상/격하" = 종류 또는 등급이 동시에 변경 (풍랑주의보 → 풍랑경보)
- "자식 일부만 발효/해제" = 부모는 유지, 자식 set 만 변화

## 1-3. MMIS 전환의 동기와 효과

### 전환 전 (legacy 시기)
- `weather_alerts_crawler` 가 `marine.kma.go.kr/letterRetrieve.do` 등 HTML
  통보문 페이지를 크롤링 → 본문 텍스트(예: "23일 03시~06시") 파싱.
- `dmdw_warn_crawler` 가 방재기상플랫폼(dmdw)에서 자식 해역(연안바다·평수구역) 추가 수집.
- **출처 이중화**: 두 크롤러가 각각 다른 갱신 주기로 같은 `weather_alerts.json` 파일에
  쓰면서 race condition · 표출 깜빡임 · 누락이 빈발.
- **본문 파싱 의존**: 시각이 "내일 새벽", "23일 늦은 오후" 같은 자연어로만 등장 →
  정확한 시각 추출 어려움. 정규식 수십 개로 5년치 변형 흡수가 필요했다.

### 전환 후 (MMIS)
- 단일 출처: `marine.kma.go.kr/mmis_marine_api` 의 구조화된 JSON endpoint.
- 4개 실시간 endpoint(부모/자식 × 발효/예비) + warn/latest, warn-sasc/latest,
  warn/ef/list 등 보조 endpoint.
- `warn_zone_cd` (불변 코드) 로 해역 식별 → 이름 축약·표기 차이 무력화.
- `clr_ntc_tm` 필드로 사전등록된 해제예고시각을 직접 받음.
- `warn/latest` 로 해제 통보문 발행 후 **정확한 해제시각**(`2026.05.23 01:00`)을
  범위형("23일 3시~6시") 대신 직접 회수.

### 효과
- 깜빡임 격감(legacy 대비 ~80% 감소).
- 정확한 시각 표시: 범위형 → 정확값 자동 전환.
- 부모/자식이 같은 응답에 실려 race 종결.
- 의심 가드(D-medium) · 디바운스 · 윈도우 hold 등 데이터 안전망을 한 곳에서 일관 적용 가능.

### 비용
- KMA 자격증명(MARINE_USER_ID/PWD) 발급 필요.
- warn/latest 가 매우 휘발성(같은 zone 의 cmd 가 cycle 마다 깜빡임) → 새로운 종류의
  글리치 발생 → 별도 가드(고정·디바운스·윈도우 hold) 필요.
- 응답 envelope 가 `{status, payload}` 와 `{code, data}` 혼용 → unwrap layer 필요.

---

# 2. MMIS 데이터 모델

## 2-1. Endpoint 일람

`local_server/services/marine_client.js` 의 `PATHS` 상수가 단일 출처:

| Path | 인증 | 용도 | 응답 row 의미 |
|---|---|---|---|
| `/api/auth/login` | — | 로그인 (JWT 30분) | accesstoken/refreshtoken 헤더 |
| `/api/auth/refresh-token` | JWT | 25분 주기 갱신 | 새 access/refresh |
| `/v1/kma/warn/list` | 비인증 | **현재 발효 부모** | warn_lvl_nm = '주의보'/'경보' |
| `/v1/kma/warn/ready` | 비인증 | **예비특보(부모+자식 혼재)** | warn_lvl_nm = '예비특보' |
| `/v1/kma/warn-sasc/list` | 비인증 | **현재 발효 자식**(연안바다·평수구역) | 같은 스키마 (자식 fullName) |
| `/v1/kma/warn-sasc/ready` | 비인증 | **예비 자식** | (활성은 대개 강풍 육상 — allowlist 로 제외) |
| `/v1/kma/warn/latest` | 비인증 | **최근 통보문(부모)** | cmd='발표'/'변경'/'연장'/'해제' |
| `/v1/kma/warn-sasc/latest` | 비인증 | **최근 통보문(자식)** | 자식별 개별 cmd |
| `/v1/kma/warn/ef/list` | JWT | 발효 timeline (영구 row) | st_tm/ed_tm 시간 범위 |

> 1분 cron 의 **핵심 실시간 4 endpoint** 는 `fetchAllRealtimeEndpoints()` 가
> `Promise.allSettled` 로 묶어 동시 호출하며, 하나라도 reject 면 throw 하여
> 본 사이클 통째로 skip (마지막 성공 state 유지) → release 폭주 방지.
> `warn/latest`, `warn-sasc/latest` 는 보조 보강용 — 실패해도 graceful.

## 2-2. 응답 envelope 두 종류 (혼용)

```javascript
// 형태 A: { status, payload }
{
  "status": 200,
  "payload": [ { warn_zone_cd: "S1131100", ... }, ... ]
}

// 형태 B: { code, data }
{
  "code": "0000",
  "data": [ { warn_zone_cd: "S1131100", ... }, ... ]
}
```

`marine_client.js` `_unwrap()` 가 두 형태를 모두 흡수 → 항상 row 배열 반환(빈 응답은 `[]`).

## 2-3. row 필드 의미

| 필드 | 형태 | 의미 |
|---|---|---|
| `warn_zone_cd` | "S1131100", "S2120400" 등 | 해역 코드(불변, S1=부모, S2=평수구역 자식, S3=연안바다 자식) |
| `warn_zone_nm` | "울산앞바다" | 해역 이름(축약 가능 — 코드로 정식 해석 필요) |
| `kor_nm` | "울산앞바다중연안바다" | 자식 fullName (자식 응답) |
| `warn_tp` | "V"/"T"/"O"/"W"/"C" | 종류 코드(실시간) — V=풍랑, T=태풍, O=폭풍해일, W=강풍 |
| `warn_tp_nm` | "풍랑"/"태풍" | 종류 한글명 |
| `warn_lvl` | "1"/"2"/"5" | 등급 코드 |
| `warn_lvl_nm` | "예비특보"/"주의보"/"경보"/"해제" | 등급 한글명 |
| `warn_cmd_nm` | "발표"/"변경"/"연장"/"해제" | 통보문 명령 (warn/latest 전용) |
| `tm_fc` | "2026.05.20 06:00" | 발표시각 (통보문 발행 시각) |
| `tm_ef` | "2026.05.20 12:00" 또는 "20일 12시~18시" | 발효(예정) 시각 |
| `tm_yn` | 비슷한 형태 | 해제(예정) 시각 (예전 필드) |
| `clr_ntc_tm` | 범위형 또는 정확형 | **사전등록된 해제예고시각** (핵심) |
| `st_tm`/`ed_tm` | "YYYYMMDDHHmm" 12자리 | timeline (ef/list) 의 시작/끝 |

## 2-4. 종류 코드 차이 — 실시간 vs ef/list

치명적 함정: 두 endpoint 의 `warn_tp` 인코딩이 다르다.

| 종류 | 실시간(warn/list 등) | ef/list (timeline) |
|---|---|---|
| 풍랑 | "V" | "6" |
| 태풍 | "T" | "7" |
| 강풍 | "W" | "1" |
| 폭풍해일 | "O" | "5" |

→ 전환 초기에 `warn_tp === 5` (숫자 폭풍해일 제외) 만 가드했더니 실시간 응답의
   문자 코드 "O"(폭풍해일) 가 그대로 유입되어 사용자에게 잘못된 푸시가 발사되던
   사고가 있었다(V11 fix). 현재는 `_isTargetRealtimeType()` 로 `{V, T}`
   allowlist 만 통과시킨다.

## 2-5. KMA 인코딩 관습 — 분=58/59 범위코드

KMA 가 **5년치 통보문 분석** 결과 자주 등장하는 비표준 인코딩:

```
"2026.06.01 05:58"  →  실제 의미: 00시~06시 (해당 6시간 블록)
"2026.06.01 11:59"  →  실제 의미: 06시~12시
"2026.06.01 17:58"  →  실제 의미: 12시~18시
"2026.06.01 23:59"  →  실제 의미: 18시~24시
```

분(MM)이 58 또는 59 이면 "정확시각이 아니라 해당 6시간 블록 전체" 를 의미한다.
이 규약을 모르면 사용자에게 "05시 58분 해제예정" 같은 무의미한 시각이 표출된다.

- `normalizeMmisTime()` (marine_warning_crawler.js) → 한글 형식으로 변환할 때
  "00시~06시" 블록으로 복원.
- `formatWarningTime()` (js/utils.js) → 프론트에서 표시할 때 동일 복원.
- `formatWarnTimeKST()` (services/push_helpers.js) → 푸시 메시지에서 동일 복원.

세 곳 모두 같은 분기 로직을 가져야 함 (커밋 b786ece, 8a9a798 에서 일괄 보강).

## 2-6. warn_zone_cd → 정식 해역명 매핑

`marine_warning_crawler.js` 의 `MMIS_CODE_TO_NAME` 상수 (93개 entry).

```javascript
const MMIS_CODE_TO_NAME = {
    'S1131100': '울산앞바다',
    'S1131200': '경북남부앞바다',
    ...
    'S2120800': '울릉도울릉읍연안바다',
    ...
    'S2211100': '인천·경기남부앞바다중먼평수구역',  // '·' 표기 보정
    'S2212200': '태안·서산북쪽평수구역',
    ...
};
```

`_resolveZoneName(row)` 함수:
1. row.warn_zone_cd 가 있으면 코드 매핑 우선 (축약 무력화).
2. 매핑 없으면 row.warn_zone_nm 폴백 (공백 제거).

> 이전엔 이름 기반 매칭으로 "남해서부 동쪽" vs "남해서부서쪽먼바다" 처럼
> 응답의 축약형 이름이 PARENT_TO_CHILDREN 키와 안 맞아 매칭 실패하는
> 경우가 있었다. 코드 매핑(A안, 커밋 2c25c58) 으로 해결.

## 2-7. 부모 ↔ 자식 매핑

`PARENT_TO_CHILDREN` (marine_warning_crawler.js 상단, 28개 부모):

```javascript
const PARENT_TO_CHILDREN = {
    '울산앞바다':           ['울산앞바다중평수구역', '울산앞바다중연안바다'],
    '경북남부앞바다':        ['경북남부앞바다중평수구역', '경북남부앞바다중연안바다'],
    ...
    '제주도서부앞바다':      ['제주도서부앞바다중북서연안바다',
                            '제주도서부앞바다중남서연안바다',
                            '제주도서부앞바다중가파도연안바다'],
    '경남서부남해앞바다':    ['경남서부남해앞바다중동부평수구역',
                            '경남서부남해앞바다중서부평수구역',
                            '경남서부남해앞바다중남부평수구역',
                            '경남서부남해앞바다중남해군연안바다']
};
```

자식 fullName 은 "부모이름 + '중' + 자식이름" 형식. `_extractParent(childName)`
는 `lastIndexOf('중')` 로 분리.

`PARENT_CHILD_TYPE` (push_helpers.js) 가 부모별 자식 종류를 분류:
- `'connection'`: 연안바다만 (강원북부앞바다 등)
- `'pyeongsu'`:   평수구역만 (인천·경기북부앞바다 등)
- `'both'`:       평수구역+연안바다 둘 다 (울산앞바다, 부산앞바다 등)

이 분류가 push 메시지 한정사("(연안바다 포함)", "(평수구역 미발효)" 등) 생성에 사용된다.

---

# 3. 데이터 흐름

## 3-1. 1분 cron orchestrator

`scheduler.js` (~line 1515 setInterval) 가 1분 주기로:

```
매분:
  syncTime()                       // 시계 NTP 보정
  if (!crawlPaused):
      marineWarningCrawler.run()   // 본 시스템의 진입점
  (그 외 1분/10분/시간 단위 작업들 — 부이, 예보 등)
```

`run()` 내부 흐름:

```
┌──────────────────────────────────────────────────────────────────┐
│                       run() FLOW                                  │
└──────────────────────────────────────────────────────────────────┘

[0] _runInProgress 락 (중복 실행 방지)
[1] prev snapshot lazy load (디스크 → 메모리, 첫 호출만)
[2] fetchAllRealtimeEndpoints()
    → warn/list, warn-sasc/list, warn/ready, warn-sasc/ready
    → 부분 실패 시 throw → cycle 통째 skip (마지막 state 유지)
[3] _buildSnapshotFromMarine(...)
    → curr = StateSnapshot(parents, children, upcomings)
[4] fetchWarnLatest + fetchWarnSascLatest (보강용, 실패 graceful)
    → _enrichSnapshotWithLatest(curr, latest, prev, sascLatest)
       ├─ 발효중 zone 의 clrNtcTm 을 정확시각으로 갱신 (V10)
       ├─ GAP("발표 발효대기") 자식·부모 합성
       └─ _childReleaseNoticeSet 채움 (디바운스 면제 신호)
[5] 빈 snapshot 가드 (E-1)
    ├─ 콜드 부팅 + 빈 prev → push skip, state 저장만
    └─ forceBaseline 옵션 → 우회 (관리자 "장부 초기화" 버튼)
[6] _applySuspiciousGuard(prev, curr)
    → mmis 빈 응답 폭주 차단 (clr_ntc_tm 없이 3+ zone 사라지면 의심)
[7] _applyChildReleaseDebounce(prev, curr)
    → 해제예고 없이 사라진 자식 3분 관찰
[8] _applyAnnounceAnchor(prev, curr)
    → 발표시각(tmFc) 고정 (현 발효 등급의 최초 발표시각)
[9] _applyReleaseClrLogic / _applyUpcomingEfLogic
    → 윈도우 hold(범위→정확 고정) + 윈도우 초과 연장 플래그
[10] _debounceTimeValues(curr)
    → 발효/해제 예정시각 변경 3분 디바운스 (진동 차단)
[11] runDiffAndPush(prev, curr)  ← 관리자 채널 (현재 비활성)
[12] _buildUserPushChanges(prev, curr) → pushSender.processChanges(...)
     ← 사용자 채널
[13] _updateExtensionMemory(curr)
     → null gap 보강용 직전 특보 기억 (6h retention)
[14] _prevSnapshot = curr; _savePrevSnapshot(curr)
     → 디스크 영속화 (Fly.io persistent volume)
[15] _writeWeatherAlertsJson(prev, curr)
     → 사용자 앱 표출용 zone tree 갱신
[16] finally: _runInProgress = false
```

각 단계는 try/catch 로 감싸 한 단계 실패가 전체를 막지 않도록 한다.

## 3-2. snapshot → enrich → guards → diff → push + JSON 의 데이터 변환

```
RAW  ┌──────────────────────────────────────────────────────────┐
     │  4 endpoint JSON rows (warn_zone_cd 무가공)              │
     └──────────────────────────────────────────────────────────┘
                          │
                          │  _buildSnapshotFromMarine
                          │  (_normLvlNm: '예비특보' → '예비')
                          │  (_isTargetRealtimeType: V/T allowlist)
                          ▼
SNAP ┌──────────────────────────────────────────────────────────┐
     │  StateSnapshot {                                          │
     │    parents:    Map<parentName, info>                      │
     │    children:   Map<parentName, Map<childName, info>>      │
     │    upcomings:  Map<parentName, info>  ← 발효+공존 예비    │
     │  }                                                        │
     └──────────────────────────────────────────────────────────┘
                          │
                          │  _enrichSnapshotWithLatest
                          │  + warn/latest 의 정확 해제시각
                          │  + GAP(발표 발효대기) 자식 합성
                          │  + _childReleaseNoticeSet (해제예고 신호)
                          ▼
ENR  ┌──────────────────────────────────────────────────────────┐
     │  curr (보강된 snapshot)                                   │
     └──────────────────────────────────────────────────────────┘
                          │
                          │  _applySuspiciousGuard (clrNtcTm 미예고 사라짐 의심)
                          │  _applyChildReleaseDebounce (3분 관찰)
                          │  _applyAnnounceAnchor (tmFc 고정)
                          │  _applyReleaseClrLogic (해제예정 정확값 hold)
                          │  _applyUpcomingEfLogic (발효예정 정확값 hold)
                          │  _debounceTimeValues (3분 진동 차단)
                          ▼
GRD  ┌──────────────────────────────────────────────────────────┐
     │  curr (가드 후 — 가짜 변화 억제, 깜빡임 제거)              │
     └──────────────────────────────────────────────────────────┘
                          │
                          │  _buildUserPushChanges(prev, curr)
                          ▼
DIF  ┌──────────────────────────────────────────────────────────┐
     │  changes[] (UPCOMING_CHANGE / CURRENT_CHANGE /            │
     │             CHILD_ADD / CHILD_RELEASE /                   │
     │             EF_EXTEND / YN_EXTEND /                       │
     │             CHILD_EF_EXTEND / CHILD_YN_EXTEND)            │
     └──────────────────────────────────────────────────────────┘
                          │
                          ├──► pushSender.processChanges (사용자 push)
                          │
                          └──► _writeWeatherAlertsJson (앱 표출 JSON)
```

## 3-3. 디스크 영속화 파일들

| 파일 | 역할 |
|---|---|
| `data/marine_warning_state.json` | prev snapshot (다음 cycle 의 diff 기준점) |
| `data/marine_suspicious_state.json` | D-medium 의심 가드 상태 (caseId, 결정 대기 여부) |
| `data/weather_alerts.json` | 사용자 앱 표출용 zone tree (current/previous/history) |
| `data/pending_pushes.json` | 발송 실패 push 재시도 큐 (24h 만료) |
| `data/maintenance_config.json` | 점검 모드 (active, blockPush) |

모두 atomic write (`tmp → rename`). 읽기 실패는 빈 상태 폴백.

---

# 4. 시나리오별 동작

본 절이 본 문서의 핵심. 모든 lifecycle 케이스를 다음 5칸으로 정형화한다.

```
[시나리오 ID]
├─ 입력         : 무엇이 들어왔는가 (endpoint row, prev 상태)
├─ 전제조건     : 어떤 prev/메모리 상태에서 의미가 있는가
├─ 단계별 처리   : 함수 호출 순서 + 분기
├─ 출력         : changes[] 항목 + state 갱신
└─ 표출         : 사용자 앱 / push 메시지 어떻게 보이나
```

## 시나리오 카탈로그

다음 표는 본 절에서 다루는 모든 케이스다.

| ID | 한줄 요약 | 빈도 |
|---|---|---|
| S-COLD | 콜드 부팅 (빈 prev 가드) | 배포 시 |
| S-BASELINE | 관리자 장부 초기화 (forceBaseline) | 테스트 시 |
| S-NONE→PRELIM | 무특보 → 예비특보 발표 | 신규 lifecycle 시작 |
| S-PRELIM-TIMECH | 예비 발효시각 변경 | 자주 |
| S-PRELIM-EXTEND | 예비 발효시각 연장 (범위형) | 자주 |
| S-PRELIM→ACTIVE | 예비 → 정식 발효 (자연 전이) | 핵심 |
| S-PRELIM-CANCEL | 예비특보 취소 (정식 발효 없이 사라짐) | 가끔 |
| S-NONE→ACTIVE | 무특보 → 정식 발효 (예비 없이 바로) | 드묾 |
| S-ACTIVE-YNCH | 발효중 해제예정시각 변경 | 자주 |
| S-ACTIVE-YNEXTEND | 발효중 해제예정시각 연장 (범위→더 늦은 범위) | 자주 |
| S-LVL-UP | 등급 격상 (주의보 → 경보) | 가끔 |
| S-LVL-DOWN | 등급 격하 (경보 → 주의보) | 가끔 |
| S-TYPE-UP | 종류 격상 (풍랑경보 → 태풍주의보) | 드묾 |
| S-TYPE-DOWN | 종류 격하 (태풍 → 풍랑) | 드묾 |
| S-RELEASE | 정식 해제 | 자주 |
| S-CHILD-ADD | 부모 유지 + 자식만 추가 발효 | 자주 |
| S-CHILD-RELEASE | 부모 유지 + 자식만 일부 해제 | 자주 |
| S-CHILD-FULLRELEASE | 자식 전부 해제 (부모 유지) | 가끔 |
| S-CHILD-EXTEND | 자식 단독 시각 연장 | 가끔 |
| S-CHILD-BLINK | 자식 깜빡임(글리치) | 빈발 (가드됨) |
| S-CHILD-TIMECH | 자식만 시각 변경 (부모 불변) | 가끔 |
| S-GAP-PARENT | 발표 발효대기 (warn/latest 만 보유) | 가끔 |
| S-GAP-CHILD | 발표 발효대기 자식 합성 | 가끔 |
| S-HANDOFF | 예비→발표 핸드오프 공백 (1사이클 prev 비어있음) | 가끔 |
| S-PARALLEL | 발효+공존 예비 병렬 표출 | 드묾 |
| S-PARTIAL-FAIL | endpoint 부분 실패 (cycle skip) | 운영 이슈 |
| S-SUSPICIOUS | mmis 빈 응답 의심(3+ zone 사라짐) | 운영 이슈 |
| S-MM58 | KMA 범위코드(분=58/59) 인식 | 빈발(자동) |
| S-LATEST-BLINK | warn/latest 깜빡임 가짜 푸시 차단 | 자동 가드 |
| S-DEBOUNCE-VIBRATE | 시각값 진동 디바운스 차단 | 자동 가드 |

---

## S-COLD: 콜드 부팅 (빈 prev 가드)

```
┌─────────────────────────────────────────────────────────────────┐
│ INPUT                                                            │
├─────────────────────────────────────────────────────────────────┤
│  prev: 디스크에 marine_warning_state.json 없음 또는 비어있음.   │
│  curr: 현재 활성 특보가 N개 있을 수 있음 (또는 0개).             │
└─────────────────────────────────────────────────────────────────┘

전제조건:
  isFirstLoad (process 시작 후 첫 run() 호출) 이며,
  _isSnapshotEmpty(_prevSnapshot) 가 true.
  forceBaseline 옵션 없음.

단계별 처리:
  [1] prev = _loadPrevSnapshot() → 빈 StateSnapshot
  [2] fetch 4 endpoint, curr 빌드
  [3] enrich (이번엔 GAP/clrNtcTm 보강 효과 거의 없음 — prev 비어있음)
  [4] guard:
        if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad):
            console.log('콜드 부팅 + 빈 prev — push skip, state 저장만')
            _prevSnapshot = curr
            _savePrevSnapshot(curr)
            _writeWeatherAlertsJson(빈, curr)   ← 사용자 앱은 즉시 fresh
            return []
  [5] (이후 단계 skip)

출력:
  changes[] = []  (push 0건)
  state 파일 갱신 (다음 cycle 부터 정상 diff)

표출:
  사용자 앱: weather_alerts.json 의 current 트리가 현재 발효를 즉시 보여줌.
  push: 없음.

이 가드의 의도:
  Fly.io 배포 시마다 메모리 _prevSnapshot 휘발 → 이 가드 없으면
  현재 활성 특보 N개가 모두 "신규 발효" 로 오인되어 사용자에게 푸시 폭주.

[E-1 fix, 커밋 6df054a]
  '빈-prev' 가드를 '콜드부팅 1회'(isFirstLoad)로 한정.
  운영중인 process 에서 무특보→신규특보 자연 전이가 이 가드에 걸려
  push 가 안 가던 버그를 막음 (자연 전이는 isFirstLoad=false 라 통과).
```

---

## S-BASELINE: 관리자 장부 초기화 (forceBaselinePush)

```
INPUT:
  관리자가 어드민 페이지 "장부 초기화(테스트 푸시)" 또는
  "전체 사용자 재발송(broadcastAll)" 버튼 클릭.
  → resetState() 호출 → _prevSnapshot = 빈 + _forceBaselinePending = true.
  → 다음 run() 또는 즉시 호출되는 run({forceBaselinePush:true, adminToken})

전제조건:
  prev 빈 + forceBaseline 플래그 set.

단계별 처리:
  [4] guard:
        forceBaseline = true → E-1 가드 우회
        log('⚠️ 강제 baseline 푸시 모드 — E-1 가드 우회, 현재 활성 특보를 신규로 발사')
        _forceBaselinePending = false (1회 소비)
  [11] runDiffAndPush (관리자 채널 — 현재 비활성)
  [12] _buildUserPushChanges → 모든 현 zone 이 "신규" 로 진단
        → pushSender.processChanges(userChanges, { adminToken })
        → adminToken 이 있으면 그 기기에게만 발송 (테스트용)

출력:
  현재 발효/예비 zone 전체에 대한 publish/active push (테스트 모드면 관리자만).

[관련 커밋]
  - 5ea305b: 재검토 피드백 — 리셋 경합/기본값 보강 (_forceBaselinePending 도입)
  - 6ba1a95: feat(admin) 장부 초기화 버튼 + 특정관리해역 토글 기본 ON
  - 0f2d419: feat(admin) 자식 리셋에 윈도우 드롭다운(0~72h, 6h 간격)
  - ec57794: feat(admin) 자식 해역만 리셋하는 admin 버튼
  - c94ea5e: 관리자 UI 에 '전체 사용자 재발송' 버튼 (broadcastAll)
```

---

## S-NONE→PRELIM: 무특보 → 예비특보 발표

```
INPUT:
  warn/ready 에 새 row 등장:
    {
      warn_zone_cd: 'S1131100',
      warn_tp: 'V', warn_tp_nm: '풍랑',
      warn_lvl: '1', warn_lvl_nm: '예비특보',
      tm_fc: '2026.05.20 06:00',
      tm_ef: '20일 18시~24시'   ← 범위형 (정확시각 미정)
      clr_ntc_tm: ''
    }
  prev: 해당 zone 없음.

전제조건:
  prev 비-empty (콜드 부팅 가드 통과).
  _isTargetRealtimeType('V') = true.

단계별 처리:
  [3] _buildSnapshotFromMarine:
        _normLvlNm('예비특보') → '예비'
        snap.parents.set('울산앞바다', { wrnLvlNm:'예비', tmEf:'20일 18시~24시', ... })
  [4] enrich: warn/latest 에 cmd='발표' 가 같은 시각으로 있을 수 있음 →
        GAP 보강은 발효중/예비가 이미 있으므로 skip.
  [8] _applyAnnounceAnchor:
        prev 에 같은 종류 예비/주의보 없음 → tmFc 그대로 유지(현재 시각이 앵커).
  [9] _applyUpcomingEfLogic:
        prev 에 정확값 없음 → 윈도우 _efWindowEnd['울산앞바다'] = (범위 끝 키)
        info.tmEf 변형 없음.
  [10] _debounceTimeValues:
        최초 수락 — _tcConfirmed['울산앞바다|tmEf'] = '20일 18시~24시'
        디바운스 없음.
  [12] _buildUserPushChanges:
        pUp=null, cUp={...}, pAct=null, cAct=null
        prevUpcoming=null, currUpcoming={...}
        upcomingChanged = true
        efExtend = null (prev 없음, 메모리도 없음)
        push:
          { type: 'UPCOMING_CHANGE', zone:'울산앞바다',
            prev:null, curr:{wrnTp:'풍랑',wrnLvl:'예비',tmEf:'20일 18시~24시',...},
            currentActive: null, childState }
  pushSender 분기:
    UPCOMING_CHANGE + prev=null → scenario='publish'
    addToGroup(groups, 'publish', '풍랑', '예비', { tmEf: '20일 18시~24시', ... })
  generateMessage(publish):
    title = '📢 풍랑 주의보 발표'   (effectiveLevel: 예비 → 주의보)
    body  = 'ㅇ울산앞바다\n   - 발효예정 : 5월 20일 18시~24시'

출력 (사용자 push):
  ┌──────────────────────────────────┐
  │ 📢 풍랑 주의보 발표               │
  │ ㅇ울산앞바다                      │
  │    - 발효예정 : 5월 20일 18시~24시│
  └──────────────────────────────────┘

표출 (사용자 앱):
  weather_alerts.json 의 leaf['울산앞바다'].upcoming = {풍랑 예비 ...}
  지도/리스트에 "다가오는 특보" 배지.
```

---

## S-PRELIM-TIMECH: 예비 발효시각 변경

```
INPUT:
  warn/ready 의 같은 row 가 tm_ef 만 바뀌어 등장.
  예: prev '20일 18시~24시'  →  curr '20일 21시~24시' (시간 좁아짐 = 연장 아님)
  또는 '20일 18시~24시' → '2026.05.20 20:00' (정확시각으로 결정)

전제조건:
  prev.upcomings 에 같은 종류·동급 row.
  _tcConfirmed['울산앞바다|tmEf'] = '20일 18시~24시'.

단계별 처리 (범위 → 범위 좁아짐):
  [9] _applyUpcomingEfLogic:
        _efWindowEnd['울산앞바다'] 윈도우 안 (incKey <= win) → 연장 아님.
        held = prev.tmEf (범위형이라 held = null) → 정확값 고정 안 함.
        info.tmEf 그대로 '20일 21시~24시'.
  [10] _debounceTimeValues:
        새 후보 '20일 21시~24시' → _tcPending = { value, since:now }
        info.tmEf 를 _tcConfirmed (옛값 '20일 18시~24시') 으로 되돌림.
        ※ 3분 유지되면 다음 cycle 에서 _tcConfirmed 갱신 + 변경 push 발사.

  3분 후 같은 새값이 유지된 경우:
    [10] _tcConfirmed = '20일 21시~24시' 갱신
    [12] _buildUserPushChanges:
          currUpcoming.tmEf != prevUpcoming.tmEf → upcomingChanged = true
          efExtend = null (kn < ko 또는 정확값으로 변화 — 범위 더 늦지 않음)
          push: { type:'UPCOMING_CHANGE', prev:{tmEf:옛범위}, curr:{tmEf:새범위} }
    pushSender:
      prev.wrnLvl === curr.wrnLvl ('예비'=='예비'), prev.tmEf != curr.tmEf
      → scenario = 'time_ef_change'
    generateMessage:
      title = '🕐 발효시각 변경'
      body  = 'ㅇ울산앞바다\n   - 발효예정 : 5월 20일 21시~24시'

단계별 처리 (범위 → 정확시각 도착):
  [9] _applyUpcomingEfLogic:
        incKey 가 윈도우 안. held = prev.tmEf (범위형) → null.
        하지만 incoming 이 정확시각이라 isRange = false → 윈도우 갱신 안 함.
        info.tmEf 그대로 정확시각.
  [10] _debounceTimeValues: 새 후보 → 3분 디바운스 (위와 동일).

  3분 후:
    [12] 'UPCOMING_CHANGE' → scenario='time_ef_change'
    title='🕐 발효시각 변경'
    body='ㅇ울산앞바다\n   - 발효예정 : 5월 20일 20시 00분'   (시단위 보존)
```

---

## S-PRELIM-EXTEND: 예비 발효시각 연장 (범위 → 더 늦은 범위)

```
INPUT:
  prev tm_ef '20일 18시~24시' (윈도우 끝 = 20일 24시 = 21일 00시 키)
  curr tm_ef '21일 03시~09시' (더 늦음)

전제조건:
  prev/메모리 모두 같은 종류·동급('예비') 의 upcoming.
  _efWindowEnd['울산앞바다'] 가 옛 범위 끝 키로 설정되어 있음.

단계별 처리:
  [9] _applyUpcomingEfLogic:
        incKey = _timeKey('21일 03시~09시') = (21 * 10000 + 9 * 100) = 210900
        winEnd = _timeKey('20일 18시~24시', 5) = ... (21일 00시 = 210000)
        incKey > winEnd → 연장 플래그 set:
          info._efExtend = { oldTime: held||prev.tmEf, newTime: '21일 03시~09시' }
        _efWindowEnd['울산앞바다'] = 210900  (윈도우 갱신)
  [10] _debounceTimeValues: 디바운스 3분 (같은 값 유지).

  3분 후:
    [12] _buildUserPushChanges:
          efExtend 우선 분기:
            oldEf = prev.tmEf, sameType, sameLevel,
            bothRange = true, kn>ko → efExtend = {oldTime, newTime}
          또는 cUpInfo._efExtend 가 있어도 set.
          push: { type:'EF_EXTEND', oldTime:'...', newTime:'...', curr:{...} }

  pushSender:
    addToGroup('ef_extend', '풍랑', '예비', { oldTime, newTime, zones:['울산앞바다'] })
  generateMessage(ef_extend):
    title = '🕐 풍랑 주의보 발효 예정시각 연장'
    body = 'ㅇ울산앞바다
            - 기존 : 5월 20일 18시~24시
            - 변경 후 : 5월 21일 03시~09시'

[관련 커밋]
  - 374923d: feat 발효/해제 예정시각 연장 푸시 — 신규 발표 오인 방지
  - 2866fe0: fix 연장은 "범위형→더 늦은 범위형"일 때만 — 정확시각 전환은 시각 변경
  - 5ded869: feat 발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장
  - b411cea: fix 2중 검토 반영 — 연장 감지 등급 가드 + 연장기억 upcomings
```

---

## S-PRELIM→ACTIVE: 예비 → 정식 발효 (자연 전이)

```
INPUT:
  prev: parents['울산앞바다'] = { wrnLvlNm:'예비', tmEf:'2026.05.20 18:00' }
  curr: warn/list 에 row 등장:
        { warn_lvl_nm:'주의보', tm_yn:'21일 06시~09시' (해제예고), tm_fc:변경됨 }
        warn/ready 에서는 사라짐.

전제조건:
  _score 상 예비==주의보 동률 (LVL_RANK['예비'] === LVL_RANK['주의보']) →
  level_upgrade 분기에 들어가지 못함. 별도 분기 필요.

단계별 처리:
  [3] _buildSnapshotFromMarine:
        curr.parents['울산앞바다'] = { wrnLvlNm:'주의보', ... }
  [8] _applyAnnounceAnchor:
        carry(prev_예비, curr_주의보) → prev.wrnLvlNm === '예비' 라 통과 (예비는
        정식의 전구체) → info.tmFc = prev.tmFc (예비 단계의 최초 발표시각 유지)
        ※ 또는 prev.upcomings 에 같은 예비가 있으면 그것의 tmFc 이어받기.
  [12] DiffMatrix.compute 의 별도 분기 (commit 5213c83 라인 413~):
        if (pPrev.wrnLvlNm === '예비' && pCurr.wrnLvlNm !== '예비' && !=='해제'):
            matrix.add('active', { parent, time: pCurr.tmYn, ... })

  사용자 채널 (pushSender):
    UPCOMING_CHANGE 분기:
      isPreToAdvisory = (prev.wrnLvl === '예비' && curr.wrnLvl === '주의보') = true
      scenario = 'time_ef_change' ... 가 아니라
      isPreToAdvisory 분기를 거쳐 발효시각 변경으로 들어감 — 하지만 별도로
      CURRENT_CHANGE 도 fire 됨 (예비가 사라지고 주의보가 새로 등장).
    CURRENT_CHANGE 분기:
      prev = null, curr = {풍랑 주의보} → scenario = 'active'

    실제로 push_sender 에 들어가는 changes 는:
      [{ type: 'UPCOMING_CHANGE', prev:{예비}, curr:null, ...},
       { type: 'CURRENT_CHANGE',  prev:null,   curr:{주의보,...}, ...}]
    의 형태. UPCOMING 이 curr=null 이면 그냥 사라진 것 → 별 처리 없음.
    CURRENT_CHANGE active 로 push 발사.

  generateMessage(active):
    title = '🚨 풍랑 주의보 발효'
    body  = 'ㅇ울산앞바다\n   - 해제예정 : 5월 21일 06시~09시'

[핵심 fix]
  - fe0bda5: 예비→발표 핸드오프 공백 보강 — "발표" 오인 → "발효시각 변경"
    1사이클 prev 가 비어 새 발표로 오인되던 버그를
    _extensionMemory.upcoming 으로 prev 채워 발효시각 변경으로 보정.
```

---

## S-PRELIM-CANCEL: 예비특보 취소 (정식 발효 없이 사라짐)

```
INPUT:
  prev: parents['울산앞바다'] = { wrnLvlNm:'예비' }
  curr: warn/list 에도 없음, warn/ready 에도 없음.
  warn/latest 에 cmd='발표' 같은 게 남아있을 수 있으나 발효시각이
  미래여야만 GAP 보강이 들어간다. 그것도 없으면 진짜 취소.

전제조건:
  pPrev 존재, pCurr 부재 또는 wrnLvlNm 빈 값.
  pPrev.wrnLvlNm === '예비'.

단계별 처리:
  DiffMatrix.compute 분기 (라인 393~):
    if (pPrev && (!pCurr || pCurr.wrnLvlNm === '해제' || !pCurr.wrnLvlNm)):
        if (pPrev.wrnLvlNm === '예비'):
            matrix.add('prelim_cancel', ...)
        else:
            matrix.add('release', ...)

  관리자 채널 (현재 비활성): enqueuePrelimCancel
  사용자 채널: UPCOMING_CHANGE { prev:{예비}, curr:null } → push_sender 에서
    prev.wrnLvl !== curr.wrnLvl, isPreToAdvisory=false → publish 분기에 들어가지
    않음. 일반적으로 별도 처리 없음 (취소 push 는 yebi-push 옵션 B 로 처리).

[관련 커밋]
  - 5f62ebb: feat(yebi-push) 예비특보 해제 알림 push 추가 (옵션 B — 부모만 명시)
  - dd5b1d9: feat(yebi) 해제 정규식 V3 — 5년 데이터 분석 기반 10가지 어휘 변형
  - 526cc7c, e1077ac: 해제 정규식 V1, V2 (점진 보강)
  - 6027f9d: resolveTargets 에 ZONE_GROUP_MAP 활용 — 조부모 단독 표기 안전 처리
  - f74c326: fix(yebi) 참고사항 처리에서 폭풍해일 제외 — 운영 정책 일관성
  - 수정B 가드 (marine_warning_crawler.js): 예비 zone 이 사라지는 건
    의심(suspicious)이 아님 — 정상.
```

---

## S-NONE→ACTIVE: 무특보 → 정식 발효 (예비 없이 바로)

```
INPUT:
  prev: 해당 zone 없음
  curr: warn/list 에 row 직접 등장 (warn_lvl_nm='주의보')

전제조건:
  drop-in active. KMA 가 예비특보 단계를 거치지 않고 바로 발효하는 경우
  (긴급 발효 / SEAGNAL 가동 후 이미 발효 중인 특보가 첫 인지 등).

단계별 처리:
  DiffMatrix:
    if (!pPrev && pCurr && pCurr.wrnLvlNm !== '해제'):
        isPublish = (pCurr.wrnLvlNm === '예비') → false
        matrix.add('active', { parent, time: pCurr.tmYn, childState })

  사용자 push:
    CURRENT_CHANGE { prev:null, curr:{주의보} } → scenario='active'
    title='🚨 풍랑 주의보 발효'

이 케이스는 S-PRELIM→ACTIVE 와 출력 동일하지만, S-PRELIM→ACTIVE 의
경우 tmFc (발표시각) 가 이전 예비 단계의 시각으로 고정되는 반면
S-NONE→ACTIVE 는 현재 발효 row 의 tm_fc 가 그대로 앵커가 된다.
```

---

## S-ACTIVE-YNCH: 발효중 해제예정시각 변경

```
INPUT:
  prev: parents['울산앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 06시~09시' }
  curr: clrNtcTm: '21일 09시~12시' (정상 범위 안 또는 더 늦은 범위)

전제조건:
  같은 종류·동급 발효 유지.
  _clrWindowEnd['울산앞바다'] 윈도우 설정되어 있음.

단계별 처리:
  [9] _applyReleaseClrLogic:
        win = _clrWindowEnd['울산앞바다'] = (21일 09시 키)
        incKey = (21일 12시 키)
        incKey > win → _clrExtend 플래그 set (연장)
        _clrWindowEnd 갱신.

  [10] _debounceTimeValues:
        새 값 후보 → 3분 디바운스. 옛 _tcConfirmed 로 되돌림.
        _clrExtend 플래그도 임시 제거.

  3분 후:
    [12] _buildUserPushChanges:
          if cActInfo._clrExtend → ynExtend 분기
          (또는 prev clrNtcTm vs curr 비교에서 kn > ko)
          push: { type:'YN_EXTEND', oldTime, newTime, childState }

  pushSender:
    addToGroup('yn_extend', '풍랑', '주의보', { oldTime, newTime })
  generateMessage:
    title = '🕐 풍랑 주의보 해제 예정시각 연장'
    body  = 'ㅇ울산앞바다
              - 기존 : 5월 21일 06시~09시
              - 변경 후 : 5월 21일 09시~12시'

윈도우 안에서 더 짧아진 경우는 'YN_EXTEND' 아님 → 일반 time_yn_change.
title = '🕐 해제시각 변경'

[관련 커밋]
  - 7c981d1: fix warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단 (정확값 고정)
  - b05ce1f: feat 정확 해제시각 고정 + 해제윈도우 기반 연장 판별
  - eb06efe: feat 발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단
  - a7bc5c9: fix 정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)
```

---

## S-LVL-UP: 등급 격상 (주의보 → 경보)

```
INPUT:
  prev: parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }
  curr: parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }

전제조건:
  같은 종류, 등급만 다름. _score 비교: 12 → 15 (10+2 vs 10+5).

단계별 처리:
  DiffMatrix:
    typeChanged=false, lvlChanged=true, cScore=15, pScore=12 → isUp=true
    phase = (pCurr.wrnLvlNm === '예비') ? 'publish' : 'active' = 'active'
    bucket = 'level_upgrade_active'
    add(bucket, {parent, time:pCurr.tmYn, childState},
        {wrnTpNm:'풍랑', wrnLvlNm:'경보', prevWrnLvlNm:'주의보'})

  사용자 push:
    CURRENT_CHANGE prev != curr (wrnLvl 다름):
      prevScore = 12, currScore = 15 → scenario = 'level_upgrade_active'
      addToGroup('level_upgrade_active', '풍랑', '경보',
                 { zones:['울산앞바다'], tmYn:'...', prevTypeName:'풍랑', prevLevel:'주의보' })
  generateMessage(level_upgrade_active):
    prevLvl = prevLevel || '주의보' = '주의보'
    title = '🚨 풍랑 주의보→경보 격상 발효'
    body = 'ㅇ울산앞바다\n   - 해제예정 : 5월 21일 09시~12시'

격상이 예비 단계에서 발생하면(prev='예비', curr='경보' 예비) :
  bucket = 'level_upgrade_publish'
  generateMessage: '📢 풍랑 주의보→경보 격상 발표'

[관련 커밋]
  - 5213c83: feat 다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존
  - 451f48e: feat 발표시각을 현재 발효등급의 최초 발표시각으로 고정 (A)
    (격상 시점에서 발표시각 anchor 재설정 — 새 등급의 첫 통보문 시각)
  - b411cea: 연장 감지 등급 가드 — 등급 변경을 연장으로 오분류하지 않도록
```

---

## S-LVL-DOWN: 등급 격하 (경보 → 주의보)

```
대칭. cScore < pScore → bucket = 'level_downgrade_{publish|active}'
title = '🔻 풍랑 경보→주의보 격하 발효' (관리자 양식)
       또는 '🚨 ...' (사용자 양식, push_helpers.js generateMessage)
```

---

## S-TYPE-UP / S-TYPE-DOWN: 종류 격상 / 격하

```
INPUT:
  prev: { wrnTpNm:'풍랑', wrnLvlNm:'경보' }   _score = 15
  curr: { wrnTpNm:'태풍', wrnLvlNm:'주의보' } _score = 102

DiffMatrix:
  typeChanged=true, cScore != pScore → isUp = (cScore > pScore)
  bucket = 'type_upgrade_active'
  add(...,  prevWrnTpNm:'풍랑', prevWrnLvlNm:'경보')

관리자 title (buildAdminTitle):
  '📢 풍랑경보→태풍주의보 격상 발효' (공백 없이 종류+등급 결합)

사용자 push 는 별도 처리 부족 — push_sender 가 type_change 분기를 별도로 안
가지고 있어 generateMessage 의 Fallback 으로 갈 가능성. 검증 필요.
```

---

## S-RELEASE: 정식 해제

```
INPUT:
  prev: parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }
  curr: 해당 zone 없음 또는 wrnLvlNm='해제'
  warn/latest 에 cmd='해제' (clr_ntc_tm 정확값) — 해제 통보문 발행.

전제조건:
  pPrev 존재 + pPrev.wrnLvlNm !== '예비'.
  의심 가드(D-medium) 통과 — clr_ntc_tm 등록되어 있거나 의심 threshold 미만.

단계별 처리:
  [4] enrich: warn/latest cmd='해제' → snap.parents 의 clrNtcTm 갱신
        (이미 사라진 zone 은 갱신 안 됨 — 정상)
  [6] _applySuspiciousGuard:
        if (info.clrNtcTm 등록):
            normalReleases.push(name)
        else:
            suspiciousZones.push(name)
            (threshold 미만이면 정상 처리)
  DiffMatrix:
    if (pPrev && (!pCurr || pCurr.wrnLvlNm === '해제' || !pCurr.wrnLvlNm)):
        if (pPrev.wrnLvlNm === '예비'): prelim_cancel
        else:                            release

  사용자 push:
    CURRENT_CHANGE prev={주의보}, curr=null → scenario='release'
    title='✅ 풍랑 주의보 해제'
    body ='ㅇ울산앞바다'
    (한정사 없음 — buildChildQualifier eventType='release' → '')

[관련 커밋]
  - dbe2c6b: feat(marine) V10 — warn/latest 엔드포인트 추가로 정확한 해제시각 보강
  - 9f11b9f, 7c981d1: warn/latest 깜빡임 가짜 해제시각변경 푸시 차단
```

---

## S-CHILD-ADD: 부모 유지 + 자식만 추가 발효

```
INPUT:
  prev: parents['제주도서부앞바다'] = {풍랑 주의보}
        children['제주도서부앞바다'] = Map { '제주도서부앞바다중북서연안바다' → {...} }
  curr: 같은 부모 + children Map = {
        '제주도서부앞바다중북서연안바다' → {...},   ← 유지
        '제주도서부앞바다중남서연안바다' → {...}    ← 추가
        }

전제조건:
  부모 active 변화 없음. childState.added.length > 0.

단계별 처리:
  DiffMatrix:
    childState.added = ['제주도서부앞바다중남서연안바다']
    부모 unchanged 분기에서:
      if (childState.added.length > 0):
          matrix.add('additional_active', { parent, time:pCurr.tmYn, childState }, ...)

  사용자 push (_buildUserPushChanges):
    !upcomingChanged && !activeChanged && c (부모 존재):
        if (addedChildren.length > 0):
            push { type:'CHILD_ADD', zone:'제주도서부앞바다',
                   curr: childToBlock(자식 자신의 데이터),
                   childState: { all, active, added:[...], released:[] } }

  pushSender CHILD_ADD:
    scenario = 'additional_active'
    addToGroup('additional_active', curr.wrnTp, curr.wrnLvl, {...})

  generateMessage(additional_active):
    title = '📢 풍랑 주의보 추가 발효'
    decorateZone('제주도서부앞바다') with childState:
      buildChildQualifier(parent, childState, 'additional_active'):
        added = ['제주도서부앞바다중남서연안바다']
        shown = ['남서연안바다'] (prefix 제거)
        return '(남서연안바다 추가 발효)'
    body = 'ㅇ제주도서부앞바다(남서연안바다 추가 발효)
              - 해제예정 : ...'

  ※ 토글(options.childZones===false) 사용자에겐 additional_active push 자체
    필터링 (push.js 라인 346) — 자식 전용 알림은 받지 않음.

[관련 커밋]
  - f499308: feat 자식 독립 푸시 (추가 발효/일부 해제) + 자식 종류·등급 부모 fallback 제거
  - 3705f4a: fix 자식 해역 표출을 자식 개별 데이터에 기인 (부모 종속 제거)
```

---

## S-CHILD-RELEASE: 부모 유지 + 자식 일부 해제

```
대칭. childState.released > 0 → matrix.add('partial_release', ...)
사용자 push: CHILD_RELEASE → scenario='partial_release'
title = '✅ 풍랑 주의보 일부 해제'
한정사: buildChildQualifier (partial_release):
  released = ['제주도서부앞바다중가파도연안바다']
  return '(가파도연안바다만 해제)'
body = 'ㅇ제주도서부앞바다(가파도연안바다만 해제)'

childState.allReleased (모든 자식이 한꺼번에 해제, 부모는 유지):
  return '(모든 연안바다 해제)'
```

---

## S-CHILD-FULLRELEASE / S-CHILD-BLINK: 글리치 vs 진짜 해제 구분

```
INPUT:
  prev.children['제주도서부앞바다'] = Map { 자식1, 자식2 }
  curr.children['제주도서부앞바다'] = Map { 자식1 }       ← 자식2 사라짐
  부모는 유지.

전제조건:
  warn-sasc/latest 에 자식2 의 cmd='해제' 통보문 있나? (해제예고 등록)

단계별 처리:
  [4] enrich _childReleaseNoticeSet:
        if (warn-sasc/latest row.warn_cmd_nm === '해제'):
            _childReleaseNoticeSet.add(자식2 fullName)

  [7] _applyChildReleaseDebounce(prev, curr):
        for each (parent, prevKids, childName) in prev.children:
            if curr 에 같은 자식 있음 → skip (변화 없음)
            else:  ← 자식2 사라짐
                if (_childReleaseNoticeSet.has(자식2)):
                    delete _childReleasePending[key]
                    log('자식 정상 해제(해제예고 있음): ...')
                    → 즉시 해제로 처리 (carry 안 함)
                else:
                    if (!_childReleasePending[key]):
                        _childReleasePending[key] = { firstMissingAt: now }
                        log('자식 해제 디바운스 시작: ... 3분 관찰')
                    elapsed = now - firstMissingAt
                    if (elapsed < 3min):
                        curr.children.get(parent).set(자식2, prevInfo)   ← carry
                    else:
                        log('자식 해제 확정(디바운스 3분 경과, 해제예고 없음)')
                        delete _childReleasePending[key]

  관찰 중 자식2 가 복귀(글리치 확정):
        elapsedSec = ... 'X초 만에 복귀, 가짜 해제 억제됨'
        delete _childReleasePending[key]
        → push 0회, 표출 깜빡임 없음.

  3분 경과 후 진짜 해제 확정:
        → CHILD_RELEASE 정상 분기 (위 S-CHILD-RELEASE 와 동일)

[관련 커밋]
  - 9d47ed3: feat 자식 해제 디바운스 3분 — 해제예고 없는 소멸 글리치 차단 + 관찰 로그
```

---

## S-CHILD-EXTEND: 자식 단독 시각 연장

```
INPUT:
  prev: 부모 unchanged.
  prev.children 의 자식 A: tmEf(또는 clrNtcTm)='20일 18시~24시'
  curr.children 의 자식 A: '21일 03시~09시' (더 늦은 범위)

전제조건:
  부모 변화 없음 (!upcomingChanged && !activeChanged && c).
  자식 prev/curr 양쪽 존재 + 등급 동일.
  oldT, newT 모두 범위형 + kn > ko.

단계별 처리 (_buildUserPushChanges):
  for cn in currChildren:
    if !prevChildren.includes(cn): continue
    pi=childInfoOf(prev,zone,cn), ci=childInfoOf(curr,zone,cn)
    if pi.wrnLvlNm !== ci.wrnLvlNm: continue  ← 등급 변하면 연장 아님
    isUp = (ci.wrnLvlNm === '예비')
    oldT = (isUp) ? pi.tmEf : (pi.clrNtcTm || pi.tmYn)
    newT = (isUp) ? ci.tmEf : (ci.clrNtcTm || ci.tmYn)
    조건: range→range, kn>ko
    bucket = isUp ? efKids : ynKids
    key = oldT + '||' + newT  → 같은 (기존,변경후) 쌍 묶음
    bucket[key].names.push(cn)

  각 그룹별 push:
    { type:'CHILD_EF_EXTEND' or 'CHILD_YN_EXTEND',
      zone, curr:childToBlock(ci),
      oldTime:g.oldTime, newTime:g.newTime,
      childState: { all, active, extended:g.names } }

pushSender:
  CHILD_EF_EXTEND → addToGroup('ef_extend', ...)
  CHILD_YN_EXTEND → addToGroup('yn_extend', ...)

generateMessage(ef_extend|yn_extend):
  childZones OFF 사용자 필터: childState.extended.length>0 → 제외
  buildChildQualifier(ef_extend|yn_extend):
    extended.length > 0 → '(가파도연안바다)' (자식만 나열, "만 해제" 아님)
  title = '🕐 풍랑 주의보 해제 예정시각 연장'
  body = 'ㅇ제주도서부앞바다(가파도연안바다)
            - 기존 : ...
            - 변경 후 : ...'

[관련 커밋]
  - 7821092: feat 자식 단독 연장 푸시 — 부모와 동일하게 독립 감지/발송
```

---

## S-CHILD-TIMECH: 자식만 시각 변경 (부모 불변)

```
INPUT:
  부모 tmEf/clrNtcTm 변화 없음.
  자식 어느 하나의 tmEf 또는 tmYn 만 변화.

전제조건:
  pPrev.tmEf === pCurr.tmEf 그리고 자식만 변경.

단계별 처리:
  DiffMatrix.compute (라인 484~):
    childTimeChanged 배열 채움. childEfChanged / childYnChanged set.
    if (pPrev.tmEf === pCurr.tmEf && childEfChanged && !setChanged):
        cs = Object.assign({}, childState, {
            parentTimeUnchanged: true,
            timeChanged: childTimeChanged.slice()
        })
        matrix.add('time_ef_change', { ..., childState:cs }, {...})

  generateMessage(time_ef_change):
    buildChildQualifier(time_ef_change):
      parentTimeUnchanged && active.length > 0 → '(연안바다만 시각 변경)'
    title = '🕐 발효시각 변경'
    body  = 'ㅇ제주도서부앞바다(연안바다만 시각 변경)
              - 발효예정 : ...'
```

---

## S-GAP-PARENT: 발표 발효대기 (warn/latest 만 보유)

```
INPUT:
  warn/list, warn/ready 둘 다 해당 zone 없음.
  warn/latest 에 cmd='발표' (또는 '변경','연장') + tm_ef 가 미래 정확시각.
  예: tm_ef='2026.05.21 18:00' 인데 현재 시각은 21일 12시.

전제조건:
  _isTargetRealtimeType(warn_tp) = true.
  _isFutureExactTime(tm_ef) = true.

단계별 처리 (_enrichSnapshotWithLatest):
  for row in warnLatest:
    cmd = '발표'/'변경'/'연장' (해제 아님)
    parent === name (부모형)
    snap.parents.set(name, info) ← wrnLvlNm = '예비'로 강제
    gapAdded++
    snap.children.get(name) 없으면:
        if (prev.children.get(name) 자식 있음): carry (이어받기)
        else: PARENT_TO_CHILDREN 매핑으로 합성 (synth)

  이후 _buildUserPushChanges 가 이 새 예비를 정상 예비로 인지.
  prev 가 비어있으면 → UPCOMING_CHANGE prev=null,curr={예비}
                    → publish push
  prev 에 같은 종류·동급 예비가 있었으면 → time_ef_change

[관련 커밋]
  - 2a21b9c: fix "발표 발효대기" GAP 누락 보강 — warn/latest 에서 예비로 추가
  - f9e4340: fix GAP 발표대기 자식 합성 fallback — prev 비어있어도 연안바다 표출
  - adab23e: fix 예비→발표 단체전이 GAP 복합버그 4건 수정
    (자식누락 / 미발효 / 의심오판 / 해제예정숨김)
  - 5a9e111: feat GAP 보강을 자식해역까지 확장 (일부 발효 + 추가발표)
```

---

## S-GAP-CHILD: 발표 발효대기 자식 합성

```
INPUT:
  warn-sasc/latest 에 자식 row cmd='발표', tm_ef 미래 정확시각.
  부모는 발효중일 수도, 발효예정일 수도, 무특보일 수도.

전제조건:
  _isFutureExactTime(child.tm_ef) = true.
  snap.children 에 아직 그 자식 없음.

단계별 처리 (_enrichSnapshotWithLatest 라인 2170~):
  _childReleaseNoticeSet 채움 (cmd='해제' 인 자식만, 디바운스 면제 신호).
  for row in warnSascLatest:
    if cmd === '해제': (위에서 처리)
    if cmd in ['발표','변경','연장'] && tm_ef 미래 정확:
      이미 snap.children 에 있으면 → 자식 개별 clrNtcTm 보강만
      없으면 → snap.children.set 으로 추가 (wrnLvlNm='예비')

[관련 커밋]
  - 0049f2a: feat GAP 자식을 warn-sasc/latest 개별 통보문으로 정확히 표출
```

---

## S-HANDOFF: 예비→발표 핸드오프 공백 (1사이클 prev 비어있음)

```
INPUT:
  T-1 사이클: warn/ready 에 예비 zone 있음, prev 에 저장.
  T 사이클: warn/ready 에 사라짐 (KMA 가 발표대기로 인계). warn/list 에도 아직 없음.
           warn/latest 의 cmd='발표' tm_ef 미래 → GAP 으로 예비 재등장.
  하지만 prev 가 비어있어 "새 발표"로 오인 위험.

전제조건:
  _extensionMemory['울산앞바다'].upcoming 에 최근(5분 내) 기억 있음:
    { wrnTpNm, wrnLvlNm:'예비', tmFc, tmEf, lastSeenAt }

단계별 처리 (_buildUserPushChanges 라인 1376~):
  if (!prevUpcoming && currUpcoming):
      mem = _extensionMemory[zone].upcoming
      if (mem && mem.wrnTpNm === currUpcoming.wrnTp &&
          (Date.now() - mem.lastSeenAt) < EXTENSION_BRIDGE_MS):  // 5분
          prevUpcoming = { wrnTp:mem.wrnTpNm, wrnLvl:mem.wrnLvlNm,
                           tmFc:mem.tmFc, tmEf:mem.tmEf, tmYn:mem.clrNtcTm }

  → 이제 upcomingChanged 비교가 정확함:
    prev.tmEf vs curr.tmEf 가 다르면 → 'time_ef_change' (발효시각 변경)
    prev.tmEf vs curr.tmEf 가 같고 다른 필드만 다르면 → blockEqual=true → push 없음

[발표시각 고정도 동일 패턴 — _applyAnnounceAnchor 라인 1059~]:
  mem 에 tmFc 있으면 그것으로 info.tmFc 고정 → 발표시각이 새로 갱신되어
  "🕐 발효시각 변경" 이 "📢 발표" 로 오인되지 않게 함.

[관련 커밋]
  - fe0bda5: fix 예비→발표 핸드오프 공백 보강 — "발표" 오인 → "발효시각 변경"
  - a7bc5c9: fix 정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)
```

---

## S-PARALLEL: 발효 + 공존 예비 병렬 표출

```
INPUT:
  warn/list 에 '울산앞바다' 풍랑 주의보 (발효중)
  warn/ready 에 같은 zone 의 풍랑 경보 예비 (다음 단계 예고)

전제조건:
  같은 zone 이 두 endpoint 에 모두 등장.

단계별 처리 (_buildSnapshotFromMarine 라인 2110~):
  발효중 (snap.parents.set 으로 먼저 등록).
  warn/ready 처리 시:
    if (snap.parents.has(name)):
        if (!snap.upcomings.has(name)):
            snap.upcomings.set(name, _rowToParentInfo(row))
        continue  ← parents 는 덮어쓰지 않고 upcomings 에 분리

  표출 (_buildZoneTreeFromSnapshot 라인 1872~):
    leaf.current = {풍랑 주의보}
    leaf.upcoming = {풍랑 경보 예비}
  → 사용자 앱 한 zone 에 발효 + 예고 모두 노출.

  diff 처리:
    _buildUserPushChanges getUp/getAct 가 parents 와 upcomings 양쪽에서 추출:
      cUp = curr.upcomings.get(zone) 또는 curr.parents.get(zone)(예비일 경우)
      cAct = curr.parents.get(zone) (예비 아닐 때)
    upcomingChanged, activeChanged 모두 독립 발사 가능.

[관련 커밋]
  - 5213c83: feat 다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존
```

---

## S-PARTIAL-FAIL: endpoint 부분 실패 (cycle skip)

```
INPUT:
  fetchAllRealtimeEndpoints() 의 4개 중 하나라도 timeout/HTTP 4xx/5xx.

전제조건:
  Promise.allSettled 중 하나라도 rejected.

단계별 처리 (marine_client.js fetchAllRealtimeEndpoints):
  failed[] 채움 → throw new Error('marine endpoint 부분 실패: ...')
                  err.partial = true; err.failedEndpoints

  run() 라인 2398~:
    try { fetched = await marineClient.fetchAllRealtimeEndpoints() }
    catch (err):
        console.warn('endpoint 부분 실패 — cycle skip (이번 1분 발사 0):', ...)
        return []   ← 본 cycle 통째로 skip

  결과:
    prev snapshot 그대로 유지 → 다음 cycle 도 같은 prev 로 diff.
    push 0건, state 갱신 0건.

[관련 커밋]
  - baf34fa: fix(marine) E-1/E-2/E-4 운영 안전성 보강
  - E-4 = 4 endpoint 묶음 호출 + 부분 실패 시 throw
```

---

## S-SUSPICIOUS: mmis 빈 응답 의심 (3+ zone 사라짐)

```
INPUT:
  prev: parents 에 5개 zone (clr_ntc_tm 미등록 4개 + 등록 1개).
  curr: parents 에 1개 zone (등록된 zone 만 남음).
  즉: 미등록 4개 zone 이 동시에 사라짐 (의심).

전제조건:
  SUSPICIOUS_THRESHOLD = 3 이상 미예고 사라짐.

단계별 처리 (_applySuspiciousGuard):
  _classifyReleases(prev, curr):
    for [name, info] in prev.parents:
      if (curr.parents.has(name)) continue
      if (info.wrnLvlNm === '예비') continue  ← [수정B] 예비는 의심 아님
      if (info.clrNtcTm): normalReleases.push(name)
      else: suspiciousZones.push(name)
    → suspiciousZones.length = 4 ≥ 3 → 의심 가동

  if (!currentCase):
    새 currentCase = { id, firstSeenAt, zones, cycleCount:1, lastPushAt:now, decisionPending:true }
    _enqueueSuspiciousAlert(currentCase)  ← 관리자 1차 push (현재 비활성)
  else:
    cycleCount++
    if (10분 경과): lastPushAt 갱신 + 재 push

  의심 zone 을 curr 에 복원:
    curr.parents.set(name, prev.info)        ← release push 안 나가게
    curr.children.set(name, prev.kids)       ← 자식도 복원
    curr.upcomings.set(name, prev.upcomings) ← 공존 예비도 복원

  결과: 이번 cycle release push 보류.

  mmis 회복 시:
    suspiciousZones.length < THRESHOLD → 자동 reset
    history.unshift({ id, ..., decision:'auto-reset', decidedBy:'system' })
    currentCase = null

  관리자 결정 (admin endpoint):
    decideSuspiciousCase('normal', decidedBy):
      → history 기록 + _pendingImmediateRelease 등록 + 즉시 release push 발사
    decideSuspiciousCase('invalid', decidedBy):
      → currentCase 유지, lastPushAt 만 갱신 (10분 카운터 reset)

[관련 커밋]
  - c761225: fix(marine) Must-fix fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)
  - 8998037: fix(marine) D-medium 인터랙티브 결정 + 통합관리자센터 UI 정리
  - abf8c57: fix(marine) D-medium 의심 사례 reinforce push silent dedup 차단 (B-2)
  - b411cea: 의심가드 복원 (recovery from regression)
```

---

## S-MM58: KMA 범위코드 (분=58/59) 인식

```
INPUT:
  row.tm_ef = '2026.06.01 05:58'  ← 분 = 58, KMA 범위코드

처리 (normalizeMmisTime):
  '^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$' 매치.
  hh=5, mm=58 → 범위 블록 결정:
    hh>=18 → '18시~24시'
    hh>=12 → '12시~18시'
    hh>=9  → '09시~12시'
    hh>=6  → '06시~09시'
    else   → '00시~06시'   ← hh=5
  반환: '2026년 06월 01일 00시~06시'

표시 (formatWarningTime, formatWarnTimeKST):
  YYYYMMDDHHMM 12자리 형식:
    if (mm===58||59): rest = '00~06시'/'06~09시'/.../'18~24시'
  점·대시 형식 ("2026.06.01 05:58"):
    HH:MM 매치 후 mm===58/59 분기:
      timeStr = '00시~06시' 등
  한글 형식 ("06월 01일 05시 58분"):
    같은 분기.

[관련 커밋]
  - b786ece: fix KMA 레거시 범위코드(분=58/59) 한글 형식 + normalize 단계까지 보강
  - 8a9a798: fix KMA 레거시 범위코드(분=58/59) 점·대시 형식에도 인식
    → "05:58" → "00시~06시"
```

---

## S-LATEST-BLINK: warn/latest 깜빡임 가짜 푸시 차단

```
INPUT:
  warn/list 에서 zone 의 clrNtcTm 이 범위형 '21일 06시~09시'.
  warn/latest 에 같은 zone 의 cmd='해제' tm_ef='2026.05.21 09:00' (정확시각).
  → enrich 가 clrNtcTm 을 '2026.05.21 09:00' 로 갱신.
  다음 cycle 에서 warn/latest 가 다시 깜빡여 cmd='해제' 가 사라짐.
  → enrich 가 갱신 안 함 → clrNtcTm 은 여전히 range '21일 06시~09시'?
  실제로는 enrich 보다 _applyReleaseClrLogic 단계가 정확값 hold.

전제조건:
  prev.clrNtcTm = '2026.05.21 09:00' (정확값 고정됨)
  curr.clrNtcTm = '21일 06시~09시' (range — latest 가 사라져 list 값으로 복귀)

단계별 처리 (_applyReleaseClrLogic + _applyTimeWindowHold):
  held = prev.clrNtcTm (정확값) → !isRange → held = '2026.05.21 09:00'
  incoming = curr.clrNtcTm = '21일 06시~09시' (range)
  win = _clrWindowEnd[zone] (= 21일 09시 키)
  incKey = 21일 09시 키. incKey <= win → 연장 아님.
  if (held && isRange(incoming)): info.clrNtcTm = held  ← 정확값으로 되돌림

  → curr.clrNtcTm = prev.clrNtcTm → blockEqual → upcomingChanged/activeChanged=false
  → push 0건.

추가 안전망 (blockEqual):
  _sameReleaseMoment(a, b):
    '범위형 끝 시각' 과 '정확시각' 이 같은 모멘트면 같은 것으로 본다.
    (예: '26일 21시~24시' 의 끝 24시 = '27일 00시' → 같은 모멘트)
  blockEqual 에서 (a.tmYn === b.tmYn || _sameReleaseMoment) 조건으로 흡수.

[관련 커밋]
  - 7c981d1: fix warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단 (정확값 고정)
  - 2866fe0: fix 연장은 범위형→더 늦은 범위형일 때만 — 정확시각 전환은 시각 변경
  - 5ded869: feat 발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장
```

---

## S-DEBOUNCE-VIBRATE: 시각값 진동 디바운스 차단

```
INPUT:
  T-2 cycle: clrNtcTm = A
  T-1 cycle: clrNtcTm = B
  T   cycle: clrNtcTm = A 다시
  (KMA 가 값을 흔들거나, mmis 가 5분+ 공백 후 복귀 등)

처리 (_debounceTimeValues):
  _tcConfirmed[zone|field] = A (확정값).
  T-1: cur=B != A → _tcPending = {value:B, since:T-1}.
       info.field = A (되돌림). 연장 플래그 제거.
  T:   cur=A, A === _tcConfirmed → delete pending. info.field 그대로 A.
       blockEqual 통과 → push 0건.

  진동이 멈추고 B 가 3분 유지된 경우:
    T+3min: cur=B, pending.value === B, (now - pending.since) >= 3min
            → _tcConfirmed = B. info.field 그대로 B. 변경 push 발사.

[관련 커밋]
  - eb06efe: feat 발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단
```

---

# 5. 시행착오 히스토리 (시간순, 커밋 인용)

본 절은 MMIS 도입부터 현재까지의 모든 fix · refactor 를 시간순으로 정렬.
각 항목은 **동기 → 실패/회귀 → 교정 → 현재 상태** 의 4단 구조로 정리한다.

## Phase 0 (전환 직전): 통보문 기반 시스템의 한계

### 기상자료 5년치 전수 분석 (2026-04 초)
- 커밋: `2b39615 docs(subregion): 기상자료개방포털 [특보] 5년치 전수 분석`
- 커밋: `00fe69f docs(subregion): 예비특보 발표 후 해제(취소) 통보문 형식 분석`
- 커밋: `b5d43b0 docs(subregion): 기상청 통보문 자식해역 키워드 스캔 결과`

5년치 통보문에서 "해제" 표현이 10가지 변형으로 등장 ('해제하나', '해제하며',
'해제한 후', '해제될 예정' 등). 정규식이 한 변형을 놓치면 zone 이 누락되거나
오해제 push 가 나가는 위험.

### 자식해역(subregion) 시스템 도입 (1차 시도)
- 커밋: `1743a3e feat(subregion): 1단계 — 분리 인프라 구축`
- 커밋: `662bf19 feat(subregion): 2단계 — 데이터 파일 준비`
- 커밋: `0015f47 feat(subregion): 3단계 — 백엔드 모듈 작성`
- 커밋: `aea97bf feat(subregion): 4단계 — 프론트엔드 표출`
- 커밋: `af9cc28 feat(subregion): 5단계 — 통합 및 어드민`

기존 통보문 크롤러 위에 자식해역 분석을 얹는 형태. LOGIC 12 (upcoming 슬롯 +
시각 도달 자동 승격), 9 광역 병렬 수집, children 객체 구조 등 다층.

### Subregion 1차 시도 rollback (2026-04 중)
- 커밋: `2defcf8 revert(subregion): 자식해역(연안바다·평수구역) 분석 코드 일괄 롤백 — 문서 보존`

본문 파싱 의존도가 높고 정규식 변형이 끝없이 발견되어 maintenance 부담.
**MMIS API 로 전환하기로 결정**.

---

## Phase 1 (MMIS 전환 — dmdw 단계 일시 도입)

### dmdw_warn_crawler 신규 모듈 (S1~S5)
- 커밋: `de1ad1a feat(dmdw): 자식 해역 특보 크롤러 신규 모듈 (S1)`
- 커밋: `5d45dd2 feat(dmdw): 1분 주기 호출 + API 머지 + 프론트 분기 (S2~S4)`
- 커밋: `b5bf88b feat(dmdw): 자식 해역 카드 클릭 비활성화 (S5)`

방재기상플랫폼 (dmdw) 의 다른 endpoint 로 자식해역 특보만 추가 수집.
부모는 여전히 통보문 기반, 자식은 dmdw → **출처 이중화**.

### dmdw 운영 보강 (S6~S10)
- 커밋: `767b5bf feat(dmdw): 관리자 푸시 알림 통합 (S6)`
- 커밋: `9476366 fix(admin): 특보 수집 오류 탭바 항상 표시 (S7)`
- 커밋: `a41ba52 feat(dmdw): 오류 기록 모듈 + 크롤러 통합 + 관리자 API (S8 A/B/C)`
- 커밋: `362c815 feat(dmdw): 관리자 페이지 "dmdw 오류" 하위 탭 추가 (S8-D)`
- 커밋: `6c0ab18 feat(dmdw): presentInLastFc + 1일 백필 + 머지 게이트 (S9 A/B/C)`
- 커밋: `f70b961 feat(map): 자식 폴리곤 독립 색칠 + 자식 클릭 박스 (S9 D/E)`
- 커밋: `5acafbe feat: 활성 특보 모드에서도 자식해역 라벨 표출 (오프셋 동일 적용)`
- 커밋: `8fa88b0 fix(dmdw): HIGH 3건 — presentInLastFc 보존 + 백필 락 race + 백필 실패 보정 (S10 A/B/C)`
- 커밋: `0191c56 fix(perf): 하이브리드 캐싱 + 안정성 보강 3건 (S10 D/E/F)`

S9-A 의 `presentInLastFc` 는 "직전 fc 사이클에 있던 자식인지" 플래그로
백필과 실시간의 머지 게이트 역할.

### dmdw 자식 push 모듈 베이스 (S11)
- 커밋: `aea561f feat(dmdw): 자식 해역 푸시 발송 모듈 베이스 (S11-baseline)`
- 커밋: `998ed88 feat(dmdw): 자식 해역 푸시 알림 최종 통합 (S11)`

자식 해역에 대한 push 알림 발송 — 부모와 별도 채널로.

### dmdw 시간대 / 백필 push 보강
- 커밋: `478c74f fix(dmdw): 시간대 + 백필 푸시 정책 + 안전망 통지 (종합)`
- 커밋: `edd53f8 feat(dmdw): 백필 push self-clear + 파싱 실패 알림 (최종 종합)`
- 커밋: `9be4649 fix(dmdw): 시간대 + 백필 푸시 정책 + 안전망 통지 (종합)`
- 커밋: `fcfe696 feat(dmdw): 백필 push self-clear + 파싱 실패 알림 (최종 종합)`
- 커밋: `0a1cf5c fix(dmdw-push): _sentKeys 디스크 영속화 + 자식리셋 시 dedup 정리`

dmdw 백필이 24h 데이터를 한꺼번에 재구성하는데, 그 사이 push 가 폭주하지
않도록 self-clear 정책. _sentKeys 디스크 영속화로 재배포 시 dedup 보존.

### 종합기상 텍스트 기반 자식 발표 푸시 (V1 → V3.3)
- 커밋: `1d7a565 feat(child-push): 종합기상 텍스트 기반 발표 푸시 트리거 (최종 종합본)`
- 커밋: `c5280a6 feat(child-push): 종합기상 텍스트 기반 발표 푸시 V2 (최종 종합본)`
- 커밋: `57eae43 feat(child-push): V3 — 자식 메타 정확화 + 시각 영구 유지 (최종)`
- 커밋: `e20ddf6 fix(child-push): V3.1 — 범위형 tmEf 발효 전 처리 (X1)`
- 커밋: `7a09572 fix(child-push): V3.2 — 자식 발효 전 라벨 '예비' 통일 + '예정' 표기 제거`
- 커밋: `3c2d0aa fix(child-push): V3.3 — 범위형 tmEf digit fallback 오인 차단`

자식 push 의 단계적 정확화. V3.2 에서 발효 전 단계는 모두 '예비' 라벨로
통일하여 사용자 혼란 감소. V3.3 에서 범위형 tm_ef 가 digit fallback 으로
잘못 인식되던 케이스 차단.

---

## Phase 2 (marine.kma 통합 — v7)

### marine_client + crawler 신규 모듈 (Critical-1)
- 커밋: `082da8e fix(marine): v7 통합 활성화 및 boundary 보강 (followup base)`
- 커밋: `baf34fa fix(marine): E-1/E-2/E-4 운영 안전성 보강`

marine.kma.go.kr MMIS endpoint 기반 부모/자식 통합 크롤러 도입.

- E-1: 빈 prev snapshot 가드 (콜드 부팅 push 폭주 차단).
- E-2: weather_alerts.json zone tree 갱신 (사용자 앱 fresh 유지).
- E-4: 4 endpoint 묶음 호출 + 부분 실패 시 throw → cycle skip.

### legacy 비활성화 (Critical-3)
- scheduler.js 라인 1604:
  - `weatherAlertsCrawler.run()` 호출 주석 처리.
  - `dmdwWarnCrawler.run()` 호출 주석 처리.
  - `marineWarningCrawler.run()` 만 유지.

→ **단일 출처 (marine.kma)** 로 전환 완료.

### Must-fix: fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)
- 커밋: `c761225 fix(marine): Must-fix fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)`

mmis 가 빈 응답을 줄 때 release 폭주 차단.
- 옵션 C = 인터랙티브 결정 (관리자가 normal/invalid 선택).
- 임계값 SUSPICIOUS_THRESHOLD = 3.

### D-1/D-2/D-6 시간 형식 + 가드 보강
- 커밋: `a515853 fix(marine): D-1/D-2/D-6 시간 형식 변환 + 가드 보강`

D-1: 시간 형식 변환 `2026.05.20 06:00` → `2026년 05월 20일 06시 00분`.
D-6 (A): `_periodNameByHour` (새벽/아침/오전/낮/늦은 오후/저녁/밤).
   - 변경 사항(P4): '오후' 단독 미관측 → '늦은 오후'(15~18시), '저녁'(18~21시),
     '밤'(21~24시) 으로 좁힘 (5년치 본문 분석 기반).
D-6 (B): 자식 응답에 시간 필드 없을 때 부모 fallback (이후 제거 — 자식이
   개별 시간 줌이 확인되어 종속 표출 금지로 정책 변경).

### D-medium 인터랙티브 결정 인프라
- 커밋: `8998037 fix(marine): D-medium 인터랙티브 결정 + 통합관리자센터 UI 정리`

`decideSuspiciousCase()` API + 관리자 페이지에서 normal/invalid 결정 UI.

### D-medium 의심 사례 reinforce push silent dedup 차단 (B-2)
- 커밋: `abf8c57 fix(marine): D-medium 의심 사례 reinforce push silent dedup 차단 (B-2)`

10분 경과 후 재 push 시 dedupKey 가 옛 timestamp 로 빌드되어 _sentKeys 와
충돌 → silent dedup 으로 push 가 안 나가던 버그. lastPushAt 을 push 호출
**앞에서** 갱신하도록 수정.

### push 카운터 별도 영속화 (admin 500 한도 우회)
- 커밋: `253ae97 fix(admin): push 카운터 별도 영속화 (500 한도 우회)`

### 사용자 앱 UI 회귀 차단
- 커밋: `1870784 fix(marine): 사용자 앱 UI 회귀 차단 — 옛 데이터 구조 호환`

`_buildZoneTreeFromSnapshot` 의 `toBlock` 이 옛 dmdw 구조와 호환되도록
한글 우선 + 신규 필드 병기. `data.js:269` 가 한글 wrnTp 가정.

### 해제예고 범위형 시간대 명칭 변환
- 커밋: `f0477c6 fix(marine): 해제예고 범위형 시간대 명칭 변환`

`normalizeMmisTime` 의 range 분기에서 `_periodNameByHour(startH)` 호출:
`"22일 21시 ~ 24시"` → `"22일 밤(21시~24시)"`.

### 사용자 푸시 채널 복원
- 커밋: `9651167 fix(marine): 사용자 푸시 채널 복원 (push_sender 호출 추가)`

marine v7 통합 시 legacy `weather_alerts_crawler` 비활성화 →
`push_sender.processChanges` 호출이 끊김 → 사용자 푸시 채널 끊김.
`_buildUserPushChanges` 신규 추가 + `pushSender.processChanges(userChanges, opts)` 직접 호출.

### 사용자 푸시 보강 4건
- 커밋: `6fcbdb5 fix(marine): 사용자 푸시 보강 4건 (예비특보 + retry + 시간대 매핑)`

### V10 — warn/latest 엔드포인트 추가
- 커밋: `dbe2c6b feat(marine): V10 — warn/latest 엔드포인트 추가로 정확한 해제시각 보강`

`fetchWarnLatest()` + `_enrichSnapshotWithLatest()` 추가.
warn/list 의 범위형 clr_ntc_tm 을 warn/latest 의 cmd='해제' tm_ef 정확시각으로 덮어쓰기.
- 갱신 조건:
  1. snap.parents 에 있는 zone (발효중)
  2. warn/latest row.warn_cmd_nm === '해제'
  3. row.tm_ef 존재
  4. _isTargetRealtimeType(V/T) 통과

### V11 — 예비 병합 + allowlist (구멍 ①③④ 동시 해소)
- 커밋: `ff1fe17 fix(marine): 예비특보 푸시 부활 + 특보종류 allowlist + 미발효 한정사 버그`

3개 버그 동시 해결:
- ① warn/ready 가 통째로 버려져 예비특보 push 가 안 나가던 버그.
- ② `_normLvlNm('예비특보') → '예비'` 정규화 부재로 예비 판정 실패.
- ③ `warn_tp === 5` (숫자 폭풍해일 제외) → 실시간 문자 코드 'O', 'W' 가 그대로 유입.
- ④ allowlist 가 아니라 denylist 였어서 강풍 등도 유입.

→ `REALTIME_TARGET_TP = new Set(['V','T'])` allowlist + `_normLvlNm`.

### 코드기반 해역명 매핑 (A안)
- 커밋: `2c25c58 feat(marine): 코드기반 해역명 매핑(A안) + 테스트푸시 관리자전용 + UI 정리`

`MMIS_CODE_TO_NAME` (93개) 도입. warn_zone_nm 축약·표기차이 무력화.

### 관리자 알림 푸시 전면 비활성 (수정1)
- 커밋: `aeae518 fix(marine): 관리자 알림 푸시 전면 비활성 (수정1)`

`ADMIN_PUSH_ENABLED = false`. 작업2 통합으로 사용자 푸시에 이미 자식 한정사가
포함되므로 관리자 채널은 중복. 단 "의심 가드 로직" (데이터 안전장치) 은 유지.

### 사용자 푸시 자식해역 한정사 토글 (작업2a+2b)
- 커밋: `378d64a feat(push): 사용자 푸시 자식해역 한정사 토글 (작업2a+2b)`

`options.childZones` 토글에 따라 "(연안바다 포함)" 같은 한정사 부착.

### 관리자 푸시 콤마결합 양식 통일 (작업2c)
- 커밋: `a057b7f feat(push): 관리자 푸시 콤마결합 양식 통일 (작업2c)`

`PushBuilder.renderTimeGroups` 가 부모를 ㅇ 줄마다 나누지 않고 ", " 로 결합.
예: "ㅇ제주도서부앞바다(연안바다 포함), 인천·경기북부앞바다(평수구역 포함)"

### 야간 경계 라벨 일치 + dead code 정리
- 커밋: `a0d8ba3 fix(push): 검증 피드백 반영 — 야간 경계 라벨 일치 + dead code 정리`

`_periodNameByHour` 의 야간 경계 (21시 vs 22시) 통일.

### 푸시 도착 상세 팝업 시각 포맷 통일 (C5)
- 커밋: `a05c3d2 fix(display): 푸시 도착 상세 팝업 시각 포맷 통일 (C5 누락 보완)`

### 특보 시각 표시 통일 (월·시단위·상대일자·범위 보정)
- 커밋: `640fd12 feat(display): 특보 시각 표시 통일 — 월·시단위·상대일자·범위 보정`

`formatWarningTime` 통일:
- 월 포함 (예: '5월 20일')
- 상대일자 라벨 (오늘/내일/모레/글피/그글피)
- 시단위 (분·초 제거)
- 범위 3h/6h 보존, degenerate 만 6시간 블록 스냅
- 끝 0시 → 24시 정규화

### 푸시 메시지 시각에서 상대일자 라벨 제거
- 커밋: `2829a0e fix(push): 푸시 메시지 시각에서 상대일자 라벨(오늘/내일/모레) 제거`

푸시는 트레이에 남아 나중에 열람될 수 있어 (오늘)/(내일) 라벨이 부정확해질 위험.
앱 팝업과 의도적 차이.

### 발송 이력 시각변경 분류
- 커밋: `3cbfba2 fix(alert-push): 발송 이력 시각변경 필터가 빈 결과를 보이던 문제`
- 커밋: `a30eef9 fix(alert-push): 사용자 알림 페이지 시각변경 탭에 '연장' 포함`
- 커밋: `2f6c729 revert(alert-push): a30eef9 의 사용자 알림 페이지 분류 변경 원복`
- 커밋: `3c6282b feat: 발송 이력 "시각변경" 하위 탭 신규 추가`

### 자식 독립 푸시
- 커밋: `f499308 feat: 자식 독립 푸시 (추가 발효/일부 해제) + 자식 종류·등급 부모 fallback 제거`
- 커밋: `3705f4a fix: 자식 해역 표출을 자식 개별 데이터에 기인 (부모 종속 제거)`

자식의 wrnTp/wrnLvl/시각을 모두 자식 자신의 데이터에서. 부모 fallback 제거.

### 자식 해제 디바운스 3분
- 커밋: `9d47ed3 feat: 자식 해제 디바운스 3분 — 해제예고 없는 소멸 글리치 차단 + 관찰 로그`

`_applyChildReleaseDebounce` + `_childReleaseNoticeSet`.

### 자식 해역 지도 팝업 해제예정 시각 표출
- 커밋: `a9cba9c fix: 자식 해역 지도 팝업에 해제예정 시각 표출 (active5 옛 dmdw 로직 제거)`

### 발효/해제 예정시각 연장 푸시
- 커밋: `374923d feat: 발효/해제 예정시각 연장 푸시 — 신규 발표 오인 방지`

기존엔 시각이 더 늦어지면 "신규 발표" 로 잘못 발사. 같은 종류·동급에서
범위→더 늦은 범위면 "연장" 으로 별도 처리.

### 자식 단독 연장 푸시
- 커밋: `7821092 feat: 자식 단독 연장 푸시 — 부모와 동일하게 독립 감지/발송`

### 발표시각 고정 (A)
- 커밋: `451f48e feat: 발표시각을 현재 발효등급의 최초 발표시각으로 고정 (A)`

`_applyAnnounceAnchor`. 예비→발표→발효→해제 동안 tmFc 불변
(변경/연장에도 안 바뀜). 격상/격하·종류변경·해제 시에만 재설정.

### 다가오는 특보 병렬 표출 (B)
- 커밋: `5213c83 feat: 다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존`

`StateSnapshot.upcomings` 도입. 부모 active 인 zone 의 예비를 별도 트랙으로 보관.

### 2중 검토 반영 (격상격하 가드 + upcomings 연장 기억)
- 커밋: `b411cea fix: 2중 검토 반영 — 연장 감지 등급 가드 + 연장기억 upcomings + 의심가드 복원`

등급 변경을 연장으로 오분류하지 않도록 sameLevel 가드 추가.
_extensionMemory 에 upcomings (B 트랙 공존 예비) 도 기록.

### 예비→발표 핸드오프 공백 보강
- 커밋: `fe0bda5 fix: 예비→발표 핸드오프 공백 보강 — "발표" 오인 → "발효시각 변경"`

_extensionMemory.upcoming 으로 prev 보강 (S-HANDOFF 시나리오).

### 연장 규칙 — 범위→범위만
- 커밋: `2866fe0 fix: 연장은 "범위형→더 늦은 범위형"일 때만 — 정확시각 전환은 시각 변경`

`_isRangeTime(oldEf) && _isRangeTime(currUpcoming.tmEf)` 가드.

### warn/latest 깜빡임 정확값 고정
- 커밋: `7c981d1 fix: warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단 (정확 해제시각 고정)`
- 커밋: `b05ce1f feat: 정확 해제시각 고정 + 해제윈도우 기반 연장 판별`
- 커밋: `5ded869 feat: 발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장 (해제시각과 동일)`
- 커밋: `a7bc5c9 fix: 정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)`

`_applyReleaseClrLogic`, `_applyUpcomingEfLogic`, `_applyTimeWindowHold`,
`_clrWindowEnd`, `_efWindowEnd`. `_sameReleaseMoment` 도입.

### 3분 디바운스
- 커밋: `eb06efe feat: 발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단`

`_debounceTimeValues`, `_tcConfirmed`, `_tcPending`. TIME_CHANGE_DEBOUNCE_MS = 3 * 60 * 1000.

### E-1 빈-prev 가드 콜드부팅 1회 한정
- 커밋: `6df054a fix: E-1 빈-prev 가드를 콜드부팅 1회로 한정 — 무특보→신규특보 자연 전이 푸시 복원`

기존 가드가 너무 강해 운영중 자연 전이도 막던 문제 → `isFirstLoad` 조건 추가.

### KMA 범위코드 (분=58/59) 인식
- 커밋: `8a9a798 fix: KMA 레거시 범위코드(분=58/59) 점·대시 형식에도 인식 — "05:58" → "00시~06시"`
- 커밋: `b786ece fix: KMA 레거시 범위코드(분=58/59) 한글 형식 + normalize 단계까지 보강`

`normalizeMmisTime`, `formatWarningTime`, `formatWarnTimeKST` 3곳 동기.

### GAP 자식 — warn-sasc/latest 개별 통보문
- 커밋: `0049f2a feat: GAP 자식을 warn-sasc/latest 개별 통보문으로 정확히 표출`

자식 자신의 cmd/tm_ef/clr_ntc_tm 으로 GAP 처리 — 부모로부터 단순 상속하던
방식의 한계 (자식 3개 중 2개만 발표 같은 케이스 표현 불가) 해결.

### GAP 합성 fallback (prev 비어있을 때)
- 커밋: `f9e4340 fix: GAP 발표대기 자식 합성 fallback — prev 비어있어도 연안바다 표출`

prev.children 비어있으면 PARENT_TO_CHILDREN 매핑으로 합성 (synth).

### 예비→발표 단체전이 GAP 복합버그 4건
- 커밋: `adab23e fix(marine): 예비→발표 단체전이 GAP 복합버그 4건 수정 (자식누락/미발효/의심오판/해제예정숨김)`

GAP 상태에서 발생하던 4종 버그 일괄 fix.

### GAP 보강을 자식해역까지 확장
- 커밋: `5a9e111 feat(marine): GAP 보강을 자식해역까지 확장 (일부 발효 + 추가발표 케이스)`

### 폭풍해일 특보 수집·표시 전면 중단
- 커밋: `69c913b feat(alerts): 폭풍해일 특보 수집·표시 전면 중단`
- 커밋: `9fe6143 chore(alerts): 폭풍해일 제거 후속 — 죽은 CSS·주석 정리`

V8 정책: 풍랑(V) + 태풍(T) 만. allowlist 강화.

### 사용자 푸시 메시지 시각변경 라벨 통합
- 커밋: `0aa4ccd fix(display): 해제예정 월·상대일자 라벨 보강 + 시각 2자리 패딩`

### 좀비 자식해역 제거
- 커밋: `52f0ab8 fix(subregion): 좀비 자식해역 '인천·경기북부앞바다중연안바다' 제거`

PARENT_TO_CHILDREN 에 잘못 등록된 자식해역 제거.

### 존재하지 않는 zone 제거
- 커밋: `e0bed16 fix(mappings): 존재하지 않는 '경기북부앞바다' zone 제거`

### Followup Major-1: 경남서부남해앞바다
- `PARENT_TO_CHILDREN` 의 `'경남서부남해앞바다'` 항목.
- `PARENT_CHILD_TYPE` 에 `'both'` 추가.
- 평수구역 3 + 연안바다 1.

### Yebi V2/V3 — 해제 정규식 변형 흡수
- 커밋: `526cc7c feat(yebi): 해제 정규식에 '해제하나' 변형 흡수`
- 커밋: `e1077ac feat(yebi): 해제 정규식 V2 — 5년 데이터 분석 기반 5가지 변형 흡수`
- 커밋: `dd5b1d9 feat(yebi): 해제 정규식 V3 — 5년 데이터 분석 기반 10가지 어휘 변형 흡수`
- 커밋: `f74c326 fix(yebi): 참고사항 처리에서 폭풍해일 제외 — 운영 정책 일관성`

### Yebi push (옵션 B)
- 커밋: `5f62ebb feat(yebi-push): 예비특보 해제 알림 push 추가 (옵션 B — 부모만 명시)`
- 커밋: `6027f9d feat(yebi): resolveTargets 에 ZONE_GROUP_MAP 활용 — 조부모 단독 표기 안전 처리`

### Agent-B 옵션 C
- 커밋: `ad90bf0 [Agent-B] 옵션 C — 참고사항 해제·연장 처리 + 자식 자동 해제`
- 커밋: `517b566 Merge: [예비] 통보문 참고사항 해제·연장 처리 (Agent B 베이스)`

---

# 6. 현재 상태와 알려진 edge case

## 6-1. 현재 운영중인 흐름 요약

- 1분 cron 마다 `marineWarningCrawler.run()` 호출.
- 4 endpoint 묶음 호출 + warn/latest + warn-sasc/latest 보강.
- 9단계 가드 (콜드부팅 → 의심 → 자식 디바운스 → 발표시각 고정 → 해제시각 hold
  → 발효시각 hold → 3분 디바운스 → diff → push).
- 사용자 push 만 활성 (관리자 dmdw push 채널 OFF).
- `weather_alerts.json` 갱신으로 사용자 앱 표출.
- D-medium 의심 가드는 데이터 안전망으로만 유지 (관리자 푸시 알림은 OFF, 결정 API 는 ON).

## 6-2. 알려진 edge case

### EC-1: 콜드부팅 시 push skip
- 빈 prev 상태에서 부팅하면 첫 cycle 의 모든 active 가 push 되지 않음.
- 의도된 동작. 사용자 앱은 weather_alerts.json 으로 fresh.

### EC-2: warn/latest 가 zone 별로 1개만 줌
- 같은 zone 의 발표 + 해제 통보문이 둘 다 있어도 latest 가 그 중 하나만 반환.
- 대개는 가장 최근. 깜빡임 가드 (`_applyReleaseClrLogic` 의 정확값 hold) 로 흡수.

### EC-3: 자식 응답에서 부모와 자식 row 혼재 (warn/ready)
- `_extractParent(name)` 으로 분리. 부모형은 parents 에, 자식형은 children 에.

### EC-4: ef/list endpoint 의 종류 코드가 다름
- 실시간 V/T 와 ef/list 6/7. 현재 ef/list 는 사용 안 함 (timeline diff 비활성).
- 자격증명 부재 시 fetchWarnEfList 는 [] 반환 → silent disable.

### EC-5: warn_zone_cd 매핑에 없는 새 zone 등장
- 폴백: warn_zone_nm (공백 제거) 사용.
- 매핑 누락 시 PARENT_TO_CHILDREN 와 불일치하면 자식 매핑 X.
- 정기 점검 필요.

### EC-6: 같은 cycle 에 자식 set 변화 + 부모 시각 변화 동시 발생
- Followup Major-3 으로 자식 set 변화 우선 (additional_active/partial_release).
- 시각 변화 push 는 억제 (한 cycle 1 push 로 통합).

### EC-7: 분 = 58/59 가 진짜 정확시각인 경우 (이론상)
- 현재는 무조건 범위코드로 해석.
- KMA 통보문에서 분=58/59 가 진짜 정확시각인 사례는 발견되지 않음 (5년치 분석).
- 만약 발생하면 잘못 표시될 가능성.

### EC-8: 의심 가드 caseId 가 자정 경계에 분단
- caseId = "YYYYMMDD-HHMM" KST. 자정 넘기는 의심 사례는 같은 case 가 id 변경 X
  (firstSeenAt 으로 고정).

### EC-9: 사용자 토큰 만료 시 push API 실패 → pending 큐 적재
- 24h 후 자동 폐기. 만료 토큰은 'expired' 기록 후 정리.

### EC-10: pushSender 의 type 변경 (S-TYPE-UP/DOWN) 분기 누락 의심
- push_sender.js 의 CURRENT_CHANGE 분기는 prev.wrnLvl != curr.wrnLvl 만 격상격하로
  처리. wrnTp 가 다른 경우의 분기 부족 — 일반 active 로 fallback 될 가능성.
- 관리자 채널은 type_upgrade/downgrade 별도 처리되지만 사용자 채널은 검증 필요.

---

# 7. 부록

## 7-1. 용어

- **MMIS**: marine.kma.go.kr 의 mmis_marine_api (Marine Meteorological Information System).
- **부모/자식**: 부모(parent) = 앞바다/먼바다 등 28개. 자식(child) = 연안바다·평수구역 등.
- **lifecycle**: 특보가 거치는 단계 (예비/발효/변경/연장/격상격하/해제).
- **GAP**: warn/latest 의 발표 통보문은 있으나 발효시각이 미래라 list/ready 에 없는 중간 상태.
- **윈도우(window)**: 처음 확립된 범위형 시각의 끝. 정확값 → 범위로 안 되돌리는 기준.
- **앵커(anchor)**: 발표시각(tmFc) 의 고정값.
- **디바운스(debounce)**: 시각값 진동 차단 (3분 유지 시 확정).
- **의심사례(suspicious case)**: clr_ntc_tm 없이 3+ zone 사라짐.

## 7-2. 파일 맵

```
local_server/
├── marine_warning_crawler.js     ← 메인 크롤러 (2577줄)
├── push_sender.js                ← 사용자 push 채널 (450줄)
├── scheduler.js                  ← 1분 cron (1721줄)
├── services/
│   ├── marine_client.js          ← MMIS HTTP 클라이언트 (528줄)
│   ├── push_helpers.js           ← 푸시 메시지 포맷 (963줄)
│   ├── dmdw_push_sender.js       ← 관리자 push (현재 비활성)
│   ├── firebase_admin_lazy.js    ← Firebase Admin lazy init
│   └── ...
├── routes/
│   ├── push.js                   ← /api/push-custom (774줄)
│   ├── admin.js                  ← admin endpoint (1840줄)
│   └── ...
├── js/
│   ├── utils.js                  ← 프론트 시간 포맷 (262줄)
│   ├── render.js                 ← 부모 zone 렌더 (1140줄)
│   ├── render_coastal.js         ← 자식 zone 렌더 (538줄)
│   └── ...
├── data/                         ← 디스크 영속화
│   ├── marine_warning_state.json
│   ├── marine_suspicious_state.json
│   ├── weather_alerts.json
│   └── pending_pushes.json
└── ...
```

## 7-3. 구조체

### StateSnapshot
```javascript
{
  parents: Map<parentName, ParentInfo>,
  children: Map<parentName, Map<childFullName, ChildInfo>>,
  upcomings: Map<parentName, ParentInfo>   // 발효 + 공존 예비 별도 트랙
}

ParentInfo = {
  wrnTp:    'V'|'T',
  wrnTpNm:  '풍랑'|'태풍',
  wrnLvl:   '1'|'2'|'5',
  wrnLvlNm: '예비'|'주의보'|'경보',
  tmFc:     '2026.05.20 06:00',
  tmEf:     '2026.05.20 12:00' or '20일 18시~24시',
  tmYn:     ...,
  clrNtcTm: ...   // 사전등록된 해제예고
}

ChildInfo = ParentInfo 와 동일 스키마.
```

### DiffMatrix.buckets
```
publish, active, additional_active, prelim_cancel, partial_release, release,
level_upgrade_publish, level_upgrade_active, level_downgrade_publish,
level_downgrade_active, type_upgrade_publish, type_upgrade_active,
type_downgrade_publish, type_downgrade_active, time_ef_change, time_yn_change
```

### Changes (사용자 push 입력)
```
UPCOMING_CHANGE { zone, prev, curr, currentActive, childState }
CURRENT_CHANGE  { zone, prev, curr, childState }
CHILD_ADD       { zone, curr, childState:{added} }
CHILD_RELEASE   { zone, prev, childState:{released} }
EF_EXTEND       { zone, curr, oldTime, newTime, childState }
YN_EXTEND       { zone, curr, oldTime, newTime, childState }
CHILD_EF_EXTEND { zone, curr, oldTime, newTime, childState:{extended} }
CHILD_YN_EXTEND { zone, curr, oldTime, newTime, childState:{extended} }
```

### childState
```
{
  all:      string[],   // 매핑상 전체 자식 (PARENT_TO_CHILDREN[parent])
  active:   string[],   // 현재 발효중 자식
  added:    string[],   // 이번 cycle 추가 (additional_active 용)
  released: string[],   // 이번 cycle 해제 (partial_release 용)
  extended: string[],   // 시각 연장된 자식 (child_*_extend 용)
  allReleased: boolean, // 모든 자식 동시 해제 (부모는 유지)
  parentTimeUnchanged: boolean,  // 자식만 시각 변경 표시용
  timeChanged: string[]          // 시각 변경된 자식 목록
}
```

## 7-4. 디버깅 가이드

### 디스크 영속화 파일 들여다보기
```bash
cat local_server/data/marine_warning_state.json | jq '.prev.parents'
cat local_server/data/marine_suspicious_state.json | jq
cat local_server/data/weather_alerts.json | jq '.current["동해"]["동해남부해상"]["동해남부앞바다"]["울산앞바다"]'
```

### 로그 키워드
- `[Marine] 콜드 부팅 + 빈 prev` — E-1 가드 작동
- `[Marine] ⚠️ 강제 baseline 푸시 모드` — forceBaseline 우회
- `[Marine] 의심 사례 신규 발생 caseId=...` — D-medium 의심 감지
- `[Marine] mmis 회복 — currentCase auto-reset` — 자동 회복
- `[Marine] 자식 해제 디바운스 시작` — 자식 글리치 의심
- `[Marine] ⚡ 자식 깜빡임 감지(글리치)` — 자식 복귀로 가짜 해제 억제
- `[Marine] 자식 해제 확정(디바운스 ... 경과)` — 3분 후 진짜 해제
- `[Marine] warn/latest 보강: N zone clrNtcTm 갱신` — V10 정확값 갱신
- `[Marine] warn/latest GAP 보강: N 부모 발표 발효대기 → 예비로 추가`
- `[Marine] endpoint 부분 실패 — cycle skip` — E-4 부분실패 가드
- `[PushSender] ✅ 발송 성공: [scenario] 풍랑 주의보 (N개 구역, M명 발송)` — push 성공

### 관리자 endpoint
- `GET /admin/marine/suspicious` — 의심 사례 조회.
- `POST /admin/marine/suspicious/decide` — normal/invalid 결정.
- `POST /admin/marine/reset` — 장부 초기화 (force baseline).
- `POST /admin/marine/reset-children` — 자식만 리셋 (윈도우 6~72h).
- `POST /admin/push/broadcast-all` — 전체 사용자 재발송.

### 한 cycle 통째로 따라가는 법
1. `local_server/data/marine_warning_state.json` 백업 (prev).
2. fixed `warn_*` JSON 4세트를 marine_client 모킹.
3. `marineWarningCrawler.run({ dryRun: true })` 호출.
4. 콘솔 로그 추적 (각 단계 keyword) + 반환된 changes[] 검사.

### 시나리오별 테스트 호출
```javascript
const m = require('./marine_warning_crawler');
const prev = m._loadPrevSnapshot();
const curr = m._buildSnapshotFromMarine(warnList, warnSascList, warnReady, warnSascReady);
m._enrichSnapshotWithLatest(curr, warnLatest, prev, warnSascLatest);
m._applyChildReleaseDebounce(prev, curr);
m._applyAnnounceAnchor(prev, curr);
m._applyReleaseClrLogic(prev, curr);
m._applyUpcomingEfLogic(prev, curr);
m._debounceTimeValues(curr);
const changes = m._buildUserPushChanges(prev, curr);
console.log(JSON.stringify(changes, null, 2));
```

---

# 부록 A: 시나리오 종합 state diagram

```
              ┌────────────────────────────────────────────────────┐
              │      SEAGNAL × MMIS — 종합 state diagram           │
              └────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │                            [없음]                                │
  └─────────────────────────────────────────────────────────────────┘
                  │                       │
   warn/ready 등장 │                       │ warn/list 직접 (긴급)
   (예비특보)     ▼                       ▼
       ┌──────────────────┐         ┌──────────────────┐
       │   [예비 (UPCOM)]  │         │  [발효 (ACTIVE)]  │◄────┐
       │                  │         │                  │     │
       │  발효시각(tmEf)   │         │  해제예정(clrNtc) │     │ 연장
       │  +범위형 윈도우    │ 발효시각 │  +범위형 윈도우    │     │ /변경
       │  +정확값 hold     │ 도달 →  │  +정확값 hold     │─────┘
       │  +3분 디바운스     │────────▶│  +3분 디바운스     │
       │  +발표시각 anchor │         │  +발표시각 anchor │
       └──────────────────┘         └──────────────────┘
            │      │                   │      │  │
   예비취소 │      │ 예비특보 사라짐      │      │  │ 격상격하/종류전환
   (정식발효│      │ (warn/ready 에서   │      │  │
    없이)  │      │  사라지고 list 도   │      │  │
         │      │  없음, latest 미발효)│      │  │
         ▼      │                   │      │  ▼
    ┌─────────┐ │                   │      │ ┌──────────────────┐
    │  취소    │ │                   │      │ │ [발효(다른 등급/  │
    │  ✅      │ │                   │      │ │   종류)]         │
    └─────────┘ │                   │      │ │  새 anchor 재설정 │
                                    │      │ └──────────────────┘
   [GAP 발표대기]                    │      │           │
   warn/latest cmd='발표', tm_ef 미래│      │           │ 해제예고+해제
                ▼                   │      ▼           ▼
       ┌──────────────────┐         │  ┌──────────────────┐
       │  [예비(GAP합성)]  │         │  │      [해제]      │
       │   wrnLvlNm='예비'│         │  │       ✅         │
       │   자식 carry/synth│         │  └──────────────────┘
       └──────────────────┘         │           │
                │                   │           ▼
                └───────────────────┘     [없음] (clr_ntc_tm 등록 →
                                                 의심가드 통과)
                                          또는
                                          [의심사례]
                                          (clr_ntc_tm 미등록 +
                                           3+ zone 동시 사라짐)
                                          → 관리자 결정 대기
                                          → normal: release push
                                          → invalid: 유지
                                          → 회복: auto-reset
```

# 부록 B: 자식해역 state diagram

```
                 ┌─────────────────────────────────────────┐
                 │     [자식 (CHILD) — 부모와 독립]         │
                 └─────────────────────────────────────────┘

   부모 발효중           [없음]
   같은 cycle 자식 등장   ▼
   (warn-sasc/list 에서)  │
                       │
                       ▼
              ┌──────────────────────┐
              │  [자식 발효 (active)] │
              │   - 자식 자신의 tm_*  │
              │   - 부모 비종속       │
              └──────────────────────┘
                       │
                       │ warn-sasc 응답에서 사라짐
                       │
       ┌───────────────┴─────────────────────┐
       │                                     │
       │ _childReleaseNoticeSet.has(child)   │
       │ (warn-sasc/latest cmd='해제' 자식)   │
       │                                     │
       ▼                                     ▼
 [즉시 해제]                          [3분 관찰 (디바운스)]
 push CHILD_RELEASE                   │
                                      │
                       ┌──────────────┴───────────────┐
                       │                              │
                       ▼                              ▼
              3분 내 복귀(글리치)              3분 경과 (진짜 해제)
              → carry 중단                    → push CHILD_RELEASE
              → 깜빡임 로그
              → push 0건


   부모 발효중에 자식 set 변화:

        prev.children                 curr.children
        {A, B}              ─────►    {A, B, C}      → CHILD_ADD (C 추가)
        {A, B}              ─────►    {A}            → CHILD_RELEASE (B 해제)
        {A, B}              ─────►    {}             → CHILD_RELEASE (allReleased)


   자식 단독 시각 연장:

        prev 자식 A: tmEf '20일 18~24시'
        curr 자식 A: tmEf '21일 03~09시'    (등급 동일, 범위→범위, kn>ko)
        → CHILD_EF_EXTEND

        같은 (old,new) 쌍의 자식들 묶음 → childState.extended = [...]
        한정사: '(가파도연안바다)'
```

# 부록 C: 시각 표현 변환 파이프라인

```
┌─────────────────────────────────────────────────────────────────┐
│ raw mmis 시각                                                    │
│                                                                  │
│  - "2026.05.20 06:00"  (정확시각 점·대시)                         │
│  - "20일 18시~24시"     (범위형 한글)                              │
│  - "20일 18시 ~ 24시"   (공백 포함)                                │
│  - "202605200600"      (YYYYMMDDHHmm 12자리)                     │
│  - "2026.06.01 05:58"  (분=58/59 KMA 범위코드)                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ marine_warning_crawler.normalizeMmisTime
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ weather_alerts.json 에 저장되는 한글 형식                          │
│                                                                  │
│  - "2026년 05월 20일 06시 00분"                                   │
│  - "20일 밤(21시~24시)"   ← _periodNameByHour 적용                 │
│  - "2026년 06월 01일 00시~06시" ← 범위코드 복원                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ 사용자 앱 표출
                              ├─► js/utils.js formatWarningTime
                              │   → "5월 20일(내일) 06시"
                              │   → "5월 20일(오늘) 18시~24시"
                              │
                              │ 푸시 메시지
                              └─► services/push_helpers.js formatWarnTimeKST
                                  → "5월 20일 06시" (상대일자 라벨 X)
                                  → "5월 20일 18시~24시"

                              ※ 세 곳 모두 mm=58/59 범위코드 분기 동일 로직.
                                 변경 시 일괄 동기 필요.
```

# 부록 D: gimbal — 9단계 가드 파이프라인 호출 순서

```
                   run()
                     │
                     ▼
       fetchAllRealtimeEndpoints()
                     │
                     ▼
       _buildSnapshotFromMarine
       (V11 allowlist + _normLvlNm)
                     │
                     ▼
       fetchWarnLatest + fetchWarnSascLatest
                     │
                     ▼
       _enrichSnapshotWithLatest
       (V10 정확 해제시각 + GAP 보강 + _childReleaseNoticeSet)
                     │
                     ▼
       [Gate 1] E-1 빈 snapshot 가드
       └─ 콜드부팅 + 빈 prev → push skip, return
                     │
                     ▼
       [Gate 2] _applySuspiciousGuard (D-medium)
       └─ clrNtcTm 미등록 3+ zone 사라짐 → curr 에 prev 정보 복원
                     │
                     ▼
       [Gate 3] _applyChildReleaseDebounce
       └─ 해제예고 없이 사라진 자식 3분 carry
                     │
                     ▼
       [Gate 4] _applyAnnounceAnchor
       └─ 발표시각(tmFc) 을 현 발효 등급의 최초 시각으로 고정
                     │
                     ▼
       [Gate 5] _applyReleaseClrLogic
       └─ 해제예정 정확값 hold + 윈도우 초과 → 연장 플래그
                     │
                     ▼
       [Gate 6] _applyUpcomingEfLogic
       └─ 발효예정 정확값 hold + 윈도우 초과 → 연장 플래그
                     │
                     ▼
       [Gate 7] _debounceTimeValues
       └─ 새 시각값 3분 유지 안 되면 옛 _tcConfirmed 로 되돌림
                     │
                     ▼
       [Gate 8] runDiffAndPush (관리자 — 현재 비활성)
                     │
                     ▼
       [Gate 9] _buildUserPushChanges → pushSender.processChanges
                     │
                     ▼
       _updateExtensionMemory (다음 cycle 의 null gap 보강용)
                     │
                     ▼
       _prevSnapshot = curr; _savePrevSnapshot(curr)
                     │
                     ▼
       _writeWeatherAlertsJson(prev, curr)
                     │
                     ▼
                   return changes
```

---

# 부록 E: 시나리오 ↔ 데이터 흐름 추적표

다음 표는 각 시나리오가 어느 endpoint row 변화로부터 시작되어 어떤 push 로 끝나는지를 정리.

| 시나리오 | 시작 신호 | 영향받는 snap 필드 | diff/Change 유형 | push title 양식 |
|---|---|---|---|---|
| S-NONE→PRELIM | warn/ready 신규 row | parents (예비) | UPCOMING_CHANGE prev=null | 📢 풍랑 주의보 발표 |
| S-PRELIM-TIMECH | warn/ready tm_ef 변화 | parents.tmEf | UPCOMING_CHANGE tmEf 변화 | 🕐 발효시각 변경 |
| S-PRELIM-EXTEND | warn/ready tm_ef 더 늦은 범위 | parents._efExtend | EF_EXTEND | 🕐 풍랑 주의보 발효 예정시각 연장 |
| S-PRELIM→ACTIVE | warn/ready 사라짐 + warn/list 등장 | parents wrnLvlNm 전환 | CURRENT_CHANGE prev=null | 🚨 풍랑 주의보 발효 |
| S-PRELIM-CANCEL | warn/ready 사라짐 (latest 도 없음) | parents 삭제 | (없음 또는 yebi-push) | ✅ 풍랑 예비특보 취소 |
| S-NONE→ACTIVE | warn/list 신규 row | parents (active) | CURRENT_CHANGE prev=null | 🚨 풍랑 주의보 발효 |
| S-ACTIVE-YNCH | warn/list clr_ntc_tm 변화 | parents.clrNtcTm | CURRENT_CHANGE tmYn 변화 | 🕐 해제시각 변경 |
| S-ACTIVE-YNEXTEND | warn/list clr_ntc_tm 더 늦은 범위 | parents._clrExtend | YN_EXTEND | 🕐 풍랑 주의보 해제 예정시각 연장 |
| S-LVL-UP | warn/list warn_lvl 격상 | parents.wrnLvl | CURRENT_CHANGE level_upgrade_active | 🚨 풍랑 주의보→경보 격상 발효 |
| S-LVL-DOWN | warn/list warn_lvl 격하 | parents.wrnLvl | CURRENT_CHANGE level_downgrade_active | 🚨 풍랑 경보→주의보 격하 발효 |
| S-TYPE-UP | warn/list warn_tp 격상 | parents.wrnTp | type_upgrade_active (관리자) | 📢 풍랑경보→태풍주의보 격상 발효 |
| S-TYPE-DOWN | warn/list warn_tp 격하 | parents.wrnTp | type_downgrade_active (관리자) | 📢 태풍...→풍랑... 격하 발효 |
| S-RELEASE | warn/list 사라짐 + clr_ntc_tm 있음 | parents 삭제 | CURRENT_CHANGE curr=null | ✅ 풍랑 주의보 해제 |
| S-CHILD-ADD | warn-sasc/list 자식 추가 | children Map 자식 추가 | CHILD_ADD | 📢 풍랑 주의보 추가 발효 |
| S-CHILD-RELEASE | warn-sasc/list 자식 사라짐 | children Map 자식 삭제 | CHILD_RELEASE | ✅ 풍랑 주의보 일부 해제 |
| S-CHILD-FULLRELEASE | 자식 전부 사라짐, 부모 유지 | children Map 비움 | CHILD_RELEASE allReleased | ✅ 풍랑 주의보 일부 해제 (모든 연안바다 해제) |
| S-CHILD-EXTEND | warn-sasc/list 자식 시각 늦어짐 | children.tmEf or .clrNtcTm | CHILD_EF/YN_EXTEND | 🕐 풍랑 주의보 해제 예정시각 연장 |
| S-CHILD-BLINK | 자식 깜빡임 (단발 사라짐+복귀) | (carry 로 무변화) | (없음 — 디바운스) | 푸시 0건 |
| S-CHILD-TIMECH | 자식만 시각 변화 (부모 불변) | children.tmEf/clrNtcTm | time_ef/yn_change parentTimeUnchanged=true | 🕐 시각 변경 (X만 시각 변경) |
| S-GAP-PARENT | warn/latest cmd=발표 tm_ef 미래 | parents (예비, GAP) | UPCOMING_CHANGE | 📢 또는 🕐 |
| S-GAP-CHILD | warn-sasc/latest cmd=발표 tm_ef 미래 | children (예비, GAP) | CHILD_ADD 또는 표출만 | 📢 추가 발효 등 |
| S-HANDOFF | prev 1cycle 비어있다 재등장 | (prev 보강) | 정상 분기로 처리 | (오인 차단) |
| S-PARALLEL | warn/list + warn/ready 같은 zone | parents + upcomings | UPCOMING_CHANGE + CURRENT_CHANGE | 각각 발사 |
| S-PARTIAL-FAIL | endpoint 한 개 fetch 실패 | (cycle skip) | (없음) | 푸시 0건 |
| S-SUSPICIOUS | clr_ntc_tm 미등록 3+ 사라짐 | curr 복원 | (release 보류) | (관리자 결정 대기) |
| S-MM58 | tm_* 의 분 = 58 또는 59 | (변환 자동) | (정상 분기) | 푸시는 '00시~06시' 범위로 표시 |
| S-LATEST-BLINK | warn/latest 가 cycle 마다 깜빡임 | (정확값 hold) | blockEqual → push 0건 | (가드됨) |
| S-DEBOUNCE-VIBRATE | tm_* 가 A↔B 진동 | (3분 디바운스) | _tcConfirmed 로 되돌림 | (가드됨) |

---

# 부록 F: lifecycle 시간선 예시

```
실제 풍랑 주의보 한 lifecycle 의 시간선 (예시):

T0       T+3min   T+30min      T+90min   T+150min  T+200min   T+260min
│         │         │            │         │         │          │
│ 예비 발표 │ 시각변경 │ 예비→발효   │ 등급격상  │ 해제예고  │ 시각연장   │ 해제
│ ┌───┐   │ ┌───┐   │  ┌──────┐ │ ┌─────┐ │ ┌─────┐ │ ┌─────┐  │  ┌───┐
│ │📢│   │ │🕐│   │  │  🚨   │ │ │ 🚨  │ │ │ 🕐  │ │ │ 🕐  │  │  │✅│
│ │발 │   │ │시 │   │  │발효   │ │ │격상 │ │ │해제 │ │ │해제 │  │  │해│
│ │표 │   │ │간 │   │  │       │ │ │발효 │ │ │예정 │ │ │예정 │  │  │제│
│ │  │   │ │변 │   │  │       │ │ │     │ │ │시각 │ │ │시각 │  │  │  │
│ │  │   │ │경 │   │  │       │ │ │     │ │ │변경 │ │ │연장 │  │  │  │
│ └───┘   │ └───┘   │  └──────┘ │ └─────┘ │ └─────┘ │ └─────┘  │  └───┘

내부 state 변화:

T0 :   parents={}                        + warn/ready 신규 row
       → parents['울산앞바다']={예비 풍랑, tmEf:'20일 18~24시'}

T+3 :  parents['울산앞바다'].tmEf 변경 (디바운스 3분 통과 후 push)
       → push 'time_ef_change' (🕐 발효시각 변경)

T+30 : warn/ready 에서 사라짐, warn/list 에 등장
       parents['울산앞바다']={주의보 풍랑, clrNtcTm:'21일 06~09시'}
       _applyAnnounceAnchor 가 prev 예비의 tmFc 이어받기
       → push 'active' (🚨 풍랑 주의보 발효)

T+90 : warn_lvl 1 → 2 (주의보 → 경보) 격상
       parents['울산앞바다'].wrnLvlNm = '경보'
       _applyAnnounceAnchor 가 새 등급(경보)의 tmFc 로 재설정
       → push 'level_upgrade_active' (🚨 풍랑 주의보→경보 격상 발효)

T+150: warn/list 에 clr_ntc_tm '21일 09~12시' (새 해제예고)
       _applyReleaseClrLogic 윈도우 안 (기존 12시 키 미초과 아니라 같음)
       _debounceTimeValues 3분 대기
       → 3분 후 push 'time_yn_change' (🕐 해제시각 변경)

T+200: clr_ntc_tm '21일 12~15시' (더 늦은 범위)
       _applyReleaseClrLogic 윈도우 초과 → _clrExtend 플래그 set
       _debounceTimeValues 3분 대기
       → 3분 후 push 'yn_extend' (🕐 풍랑 경보 해제 예정시각 연장)

T+260: warn/list 에서 사라짐, _childReleaseNoticeSet 에 자식들도 있음
       (clr_ntc_tm 등록되어 있어 정상 해제)
       → push 'release' (✅ 풍랑 경보 해제)
```

# 부록 G: V10 enrich 동작 상세

```
warn/latest 응답 (가상 예시):

[
  { warn_zone_cd:'S1131100', warn_tp:'V',
    warn_cmd_nm:'해제',
    tm_ef:'2026.05.21 09:00',
    warn_inpt_tm:'2026.05.20 18:00', ... },

  { warn_zone_cd:'S1311100', warn_tp:'V',
    warn_cmd_nm:'발표',
    tm_ef:'2026.05.22 06:00',     // 미래 정확시각 → GAP
    clr_ntc_tm:'23일 03~06시', ... },

  { warn_zone_cd:'S1251100', warn_tp:'O',   // 폭풍해일 → 제외
    warn_cmd_nm:'해제', ... }
]

_enrichSnapshotWithLatest 처리:

[1] warn-sasc/latest 먼저 처리 → _childReleaseNoticeSet 채우기
    + GAP 자식 추가 (sascChildAdded++).

[2] for row in warnLatest:
      [2-1] 'S1131100' 풍랑 cmd='해제':
            name='울산앞바다'
            snap.parents.has(name) ? (발효중인가)
              YES → info.clrNtcTm = '2026.05.21 09:00' (정확시각)
                    enriched++
              NO  → skip (이미 사라진 zone 은 보강 안 함)

      [2-2] 'S1311100' 풍랑 cmd='발표':
            name='부산앞바다'
            tmEf='2026.05.22 06:00', _isFutureExactTime → true
            parent === name (부모형)
            snap.parents.has(name) ?
              YES → skip (이미 발효중이면 GAP 처리 불필요)
              NO  → info = _rowToParentInfo(row), wrnLvlNm='예비', wrnLvl='1'
                    snap.parents.set(name, info)
                    gapAdded++
                    snap.children.has(name) ?
                      NO →
                        prev.children.get(name) 있음 ? → carry (gapChildCarried)
                        없음 ? → PARENT_TO_CHILDREN[name] 매핑으로 synth (gapChildSynth)

      [2-3] 'S1251100' 폭풍해일:
            _isTargetRealtimeType('O') = false → continue

[3] 로그:
    [Marine] warn/latest 보강: 1 zone clrNtcTm 갱신
    [Marine] warn/latest GAP 보강: 1 부모 발표 발효대기 → 예비로 추가
    [Marine] GAP 자식 합성(매핑): N 자식 발표대기로 추가
```

# 부록 H: 1 cycle 의 전형적 로그 시퀀스 (정상)

```
[14:35:01.234] 🌊 marine.kma 통합 크롤러 실행...
[Marine] (이전 cycle 의 디바운스 pending 정리)
[Marine] warn/latest 보강: 2 zone clrNtcTm 갱신
[PushSender] 0건의 변경사항 분석 중... (대부분 cycle)
[PushSender] 0개 그룹 발송 시작:
[PushSender] 신규 변경사항은 없지만 미발송 건 있으면 재시도... (pending 큐)
[14:35:02.567] (run() 완료, _runInProgress=false)
```

# 부록 I: 1 cycle 의 비정상 — 의심 감지

```
[14:42:01.345] 🌊 marine.kma 통합 크롤러 실행...
[Marine] endpoint 부분 실패는 아님 (정상 응답)
[Marine] warn/latest 보강: 0 zone clrNtcTm 갱신
[Marine] 의심 사례 신규 발생 caseId=20260521-1442
        zones=울산앞바다, 경북남부앞바다, 부산앞바다, 전남남부서해앞바다
[Marine] (의심 가드: 위 4 zone 을 curr 에 복원 — release push 보류)
[PushSender] 0건의 변경사항 분석 중...
[14:42:02.890] (run() 완료)

10분 후 — 미복구 / 미결정 상태:
[14:52:03.123] 🌊 marine.kma 통합 크롤러 실행...
[Marine] 의심 사례 재push caseId=20260521-1442 cycleCount=10
[Marine] (관리자 알림 푸시는 비활성 — 콘솔 로그만)

15분 후 — mmis 회복:
[14:57:01.456] 🌊 marine.kma 통합 크롤러 실행...
[Marine] mmis 회복 — currentCase auto-reset caseId=20260521-1442
[Marine] history 에 auto-reset 기록 추가
[14:57:02.789] (run() 완료)
```

---

(end of draft_2.md)

---

# 부록 J: 시나리오별 상세 — 추가 케이스

본 부록은 본문 4절의 시나리오들을 더 정밀하게 파고든다. 본문에서 간략히 다룬
케이스를 코드 라인까지 짚어 설명한다.

## J-1. S-PRELIM-TIMECH 의 4가지 하위 케이스

### J-1a. 범위 → 더 좁은 범위

```
prev.tmEf = '20일 18시~24시'   (윈도우 끝 = 21일 00시 키 = 210000)
curr.tmEf = '20일 21시~24시'   (윈도우 끝 = 21일 00시 키 = 210000)  ← 같음

_applyUpcomingEfLogic:
  incKey = 210000, win = 210000
  incKey <= win → 연장 아님 (_efExtend 미설정)
  held = prev.tmEf (범위) → null
  변형 없음 → info.tmEf = '20일 21시~24시'

_debounceTimeValues:
  cur '20일 21시~24시' != _tcConfirmed '20일 18시~24시' (값 다름)
  _tcPending = {value: '20일 21시~24시', since: now}
  info.tmEf = _tcConfirmed (옛값) → 푸시·표출 억제

3분 후 같은 값 유지:
  _tcConfirmed = '20일 21시~24시'
  push: time_ef_change → '🕐 발효시각 변경'
```

### J-1b. 범위 → 같은 끝의 정확시각 (수렴)

```
prev.tmEf = '20일 18시~24시'   (윈도우 끝 키 = 210000)
curr.tmEf = '2026.05.21 00:00' (정확시각, 키 = 210000)

_applyUpcomingEfLogic:
  incoming 이 정확시각 → isRange = false
  held = prev.tmEf (범위) → null
  변형 없음.

_debounceTimeValues:
  cur != _tcConfirmed 값 → 디바운스 3분.
  3분 후 _tcConfirmed = 정확시각으로 확정.

_buildUserPushChanges:
  upcomingChanged 여부 = blockEqual(prev, curr) = ?
  blockEqual 조건: (a.tmEf === b.tmEf || _sameReleaseMoment(a.tmEf, b.tmEf))
  _sameReleaseMoment('20일 18시~24시', '2026.05.21 00:00'):
    ka = _timeKey('20일 18시~24시') = 210000 (24시 → 다음날 00시 정규화)
    kb = _timeKey('2026.05.21 00:00') = 210000
    ka === kb → true
  → blockEqual = true → push 0건

  의도: 범위형의 끝 시각과 정확시각이 같은 모멘트면 같은 것으로 봄 →
        warn/latest 깜빡임 시 가짜 변경 푸시 차단.
```

### J-1c. 범위 → 윈도우 안의 정확시각

```
prev.tmEf = '20일 18시~24시'   (윈도우 끝 = 210000)
curr.tmEf = '2026.05.20 21:00' (정확시각, 키 = 202100)

_applyUpcomingEfLogic:
  incoming 정확시각 → isRange = false
  held = prev.tmEf (범위) → null (held 없음)
  변형 없음 — info.tmEf = 정확시각 그대로
  하지만 윈도우 _efWindowEnd 는 그대로 유지 (범위로만 확립/확장)

_debounceTimeValues: 3분 디바운스.
3분 후:
  blockEqual:
    a.tmEf = '20일 18시~24시', b.tmEf = '2026.05.20 21:00'
    _sameReleaseMoment:
      ka = 210000 (24시)
      kb = 202100 (21시)
      ka !== kb → false
    → blockEqual = false → upcomingChanged = true
  efExtend = null (k_new < k_old 면 더 늦은 것이 아님)
  push: time_ef_change → '🕐 발효시각 변경'
```

### J-1d. 정확시각 → 범위 (warn/latest 깜빡임)

```
prev.tmEf = '2026.05.20 21:00' (정확시각, hold 중)
curr.tmEf = '20일 18시~24시'   (warn/latest 가 사라져 list 값으로 복귀)

_applyUpcomingEfLogic:
  incoming 범위 → isRange = true
  held = prev.tmEf (정확) → '2026.05.20 21:00'
  if (held && isRange(incoming)): info.tmEf = held  ← 정확값으로 되돌림

_debounceTimeValues: 변형 없음 (값이 옛 _tcConfirmed 와 같음).

_buildUserPushChanges:
  blockEqual = true → push 0건.

  의도: 정확값으로 한번 확립되면 범위로 안 되돌림 (S-LATEST-BLINK 가드).
```

## J-2. S-ACTIVE-YNCH 의 4가지 하위 케이스 (J-1 의 거울)

같은 4 케이스가 clrNtcTm 필드에 대해서도 동일 로직.
`_applyReleaseClrLogic` 가 `_applyUpcomingEfLogic` 과 같은 헬퍼
(`_applyTimeWindowHold`) 를 다른 cfg 로 호출.

```javascript
_applyReleaseClrLogic:
  _applyTimeWindowHold(prev, curr, {
    field: 'clrNtcTm', phase: 'active', winMap: _clrWindowEnd, flag: '_clrExtend',
    matchParent: (i) => i.wrnLvlNm 가 발효중 (예비/해제 아님),
    matchChild:  같음,
    includeUpcomings: false
  });

_applyUpcomingEfLogic:
  _applyTimeWindowHold(prev, curr, {
    field: 'tmEf', phase: 'upcoming', winMap: _efWindowEnd, flag: '_efExtend',
    matchParent: (i) => i.wrnLvlNm === '예비',
    matchChild:  같음,
    includeUpcomings: true
  });
```

## J-3. 등급 격상 시 발표시각 anchor 재설정

```
prev: parents['울산앞바다'] = { wrnLvlNm:'주의보', tmFc:'2026.05.20 06:00' }
curr: parents['울산앞바다'] = { wrnLvlNm:'경보',   tmFc:'2026.05.20 12:00' }

_applyAnnounceAnchor:
  carry(prev, curr):
    prev.wrnTpNm === curr.wrnTpNm ('풍랑'=='풍랑') OK
    prev.wrnLvlNm === '예비' ? NO ('주의보')
    _anchorLevel(prev) === _anchorLevel(curr) ?
      _anchorLevel({wrnLvlNm:'주의보'}) = '주의보'
      _anchorLevel({wrnLvlNm:'경보'})  = '경보'
      '주의보' !== '경보' → false
    → carry = false → info.tmFc 그대로 (새 등급의 최초 발표시각 유지)

  → prev.upcomings 에 같은 등급 경보 예비가 있었으면 그것 이어받기.
     없으면 현재 row 의 tm_fc 가 새 anchor.

[관련 커밋]
  - 451f48e: feat 발표시각을 현재 발효등급의 최초 발표시각으로 고정 (A)
  - 5213c83: feat 다가오는 특보 병렬 표출 (B) — 격상격하 발효 시 prev 공존 예비 활용
```

## J-4. 자식 set 변화 + 시각 변화 동시 발생

```
prev:
  parents['제주도서부앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 06~09시' }
  children['제주도서부앞바다'] = Map { 자식A }

curr:
  parents['제주도서부앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 09~12시' } ← 변화
  children['제주도서부앞바다'] = Map { 자식A, 자식B } ← 자식B 추가

DiffMatrix.compute:
  setChanged = (childState.added.length > 0 || childState.released.length > 0)
             = true (B 추가)
  if (pPrev.clrNtcTm !== pCurr.clrNtcTm && !setChanged):  ← !setChanged 라 skip
    matrix.add('time_yn_change', ...)  ← 안 들어감

  if (childState.added.length > 0):
    matrix.add('additional_active', { parent, time:pCurr.tmYn, childState }, ...)
    ← 이 push 의 time 으로 새 clrNtcTm 도 자연스럽게 전달됨

→ 시각 변경 push 는 발사 안 함. 추가 발효 push 1건으로 통합.
   사용자가 추가 발효 push 메시지에서 새 해제예정 시각을 함께 확인.

[Followup Major-3] 자식 set 변화 동시 발생 시 시각 변경 push 억제.
```

## J-5. _extensionMemory 의 역할과 만료

```
_extensionMemory[zone] = {
  active:   { wrnTpNm, wrnLvlNm, tmFc, tmEf, clrNtcTm, lastSeenAt },
  upcoming: { 같은 필드 ... }
}

용도:
  [1] 핸드오프 공백 보강 (S-HANDOFF):
      prev 가 비어있어도 EXTENSION_BRIDGE_MS(5분) 내 기억으로 prev 채움.

  [2] null gap 연장 판정:
      _buildUserPushChanges 에서 prev 가 비어있으면
      _extensionMemory.upcoming 또는 .active 에서 oldEf/oldYn 가져와
      연장 판정 (kn > ko 비교).

  [3] 발표시각(tmFc) 고정의 fallback:
      _applyAnnounceAnchor 가 prev 도 prev.upcomings 도 비었으면
      _extensionMemory 의 tmFc 로 고정 (5분 안에 기억 있을 때만).

만료 정책 (run() 마지막 단계):
  if (now - lastSeenAt > EXTENSION_MEMORY_TTL_MS [6h]):
    delete _extensionMemory[zone][phase]
  if (Object.keys(_extensionMemory[zone]).length === 0):
    delete _extensionMemory[zone]

기록 시점:
  _updateExtensionMemory(curr) — _buildUserPushChanges 이후, _savePrevSnapshot 직전.
  zone 별로 phase 따로 보관:
    parents[zone].wrnLvlNm === '예비' → phase = 'upcoming'
    그 외(주의보/경보)               → phase = 'active'
    upcomings[zone]                  → phase = 'upcoming' (B 트랙)
```

## J-6. _childReleaseNoticeSet 의 정밀한 의미

```
_childReleaseNoticeSet (set of child fullName):
  이번 사이클 warn-sasc/latest 에 cmd='해제' 통보문이 있는 자식 집합.
  의미: "관리자가 미리 넣어둔 해제 데이터(해제예고) 가 존재" 신호.

채우는 시점: _enrichSnapshotWithLatest 시작부 (warn-sasc/latest 루프).

활용 시점: _applyChildReleaseDebounce.
  if (_childReleaseNoticeSet.has(childName)):
    → 이 자식이 사라져도 디바운스 안 함, 즉시 해제로 처리.
  else:
    → 3분 관찰 (carry).

매 cycle 새로 만듦 (let _childReleaseNoticeSet = new Set() — global state).
→ "이번 cycle 의 정보" — cross-cycle 누적되지 않음.
```

## J-7. _pendingImmediateRelease 의 역할

```
_pendingImmediateRelease (배열):
  decide('normal') 시 즉시 release push 를 발사할 zone 들.

decideSuspiciousCase('normal') 흐름:
  [1] _suspiciousState.currentCase.zones 를 _pendingImmediateRelease 에 복사.
  [2] _suspiciousState.currentCase = null.
  [3] _saveSuspiciousState.
  [4] _enqueueImmediateRelease(_pendingImmediateRelease).
       └─ prev.parents 에서 해당 zone 제거 (다음 cycle 재트리거 차단).
       └─ wrnTp+wrnLvl 별 groups 으로 묶어 dmdwPush.enqueueParentRelease 호출.
       └─ ADMIN_PUSH_ENABLED=false 면 dmdw 발사 skip (prev 정리만).
       └─ dmdwPush.flushParent (cycleId, {}) await.
  [5] _pendingImmediateRelease = null.

  의도: 다음 cycle 까지 안 기다리고 즉시 push.
```

## J-8. processChanges 의 retry 동작

```
처음 push 시도:
  for (key of groupKeys):
    success = await sendToApi(payload, adminToken)
    if (!success): failedPayloads.push({payload, key, failedAt:ISO})

실패 건 처리:
  existing = loadPendingPushes()
  merged = [...failedPayloads, ...existing].slice(0, 20)   ← 최대 20건
  savePendingPushes(merged)

다음 cycle (변경사항 없음 + pending 있음):
  changes=[] → retryPendingPushes() 호출.
  for (item of pending):
    if (Date.now() - failedAt > 24h): 폐기.
    success = await sendToApi(item.payload).
    if (!success): stillPending.push(item).
  savePendingPushes(stillPending) 또는 clearPendingPushes() (전부 성공).

→ 사용자 push 채널의 신뢰성 보장.
```

---

# 부록 K: 시나리오별 코드 라인 인덱스

본 절은 각 시나리오의 핵심 로직이 어느 파일·어느 라인에 있는지 정리.

| 시나리오 | 파일 | 라인 |
|---|---|---|
| S-COLD | marine_warning_crawler.js | 2434~2443 (E-1 가드) |
| S-BASELINE | marine_warning_crawler.js | 2365~2374 (resetState), 2433~2448 (force) |
| S-NONE→PRELIM | marine_warning_crawler.js | 2100~2118 (_buildSnapshotFromMarine warn/ready 분기) |
| S-PRELIM-TIMECH | marine_warning_crawler.js | 1209~1216 (_applyUpcomingEfLogic) |
| S-PRELIM-EXTEND | marine_warning_crawler.js | 1396~1425 (_buildUserPushChanges efExtend) |
| S-PRELIM→ACTIVE | marine_warning_crawler.js | 409~420 (DiffMatrix 예비→정식 분기) |
| S-PRELIM-CANCEL | marine_warning_crawler.js | 393~407 (DiffMatrix release/prelim_cancel 분기) |
| S-NONE→ACTIVE | marine_warning_crawler.js | 372~386 (DiffMatrix 신규 분기) |
| S-ACTIVE-YNCH | marine_warning_crawler.js | 1201~1208 (_applyReleaseClrLogic) |
| S-ACTIVE-YNEXTEND | marine_warning_crawler.js | 1427~1457 (_buildUserPushChanges ynExtend) |
| S-LVL-UP / DOWN | marine_warning_crawler.js | 442~454 (DiffMatrix lvlChanged 분기) |
| S-TYPE-UP / DOWN | marine_warning_crawler.js | 429~441 (DiffMatrix typeChanged 분기) |
| S-RELEASE | marine_warning_crawler.js | 393~407 (release 분기) + 2226~2235 (V10 enrich) |
| S-CHILD-ADD | marine_warning_crawler.js | 519~524 (DiffMatrix additional_active) + 1498~1507 (사용자 CHILD_ADD) |
| S-CHILD-RELEASE | marine_warning_crawler.js | 526~531 (DiffMatrix partial_release) + 1508~1515 (사용자 CHILD_RELEASE) |
| S-CHILD-FULLRELEASE | marine_warning_crawler.js | 365~369 (childState.allReleased) + push_helpers.js 555 (buildChildQualifier) |
| S-CHILD-EXTEND | marine_warning_crawler.js | 1517~1551 (자식 단독 연장 efKids/ynKids) |
| S-CHILD-BLINK | marine_warning_crawler.js | 976~1026 (_applyChildReleaseDebounce) |
| S-CHILD-TIMECH | marine_warning_crawler.js | 484~515 (DiffMatrix 자식만 시각 변경) + push_helpers.js 599 |
| S-GAP-PARENT | marine_warning_crawler.js | 2238~2296 (_enrichSnapshotWithLatest 부모 GAP) |
| S-GAP-CHILD | marine_warning_crawler.js | 2161~2213 (warn-sasc/latest 자식 GAP) |
| S-HANDOFF | marine_warning_crawler.js | 1373~1386 (_buildUserPushChanges mem 보강) + 1059~1066 (anchor) |
| S-PARALLEL | marine_warning_crawler.js | 2107~2113 (_buildSnapshotFromMarine upcomings 분기) + 1872~1879 (zone tree) |
| S-PARTIAL-FAIL | services/marine_client.js | 405~432 (fetchAllRealtimeEndpoints) + marine_warning_crawler.js 2397~2404 |
| S-SUSPICIOUS | marine_warning_crawler.js | 691~936 (전체 의심 가드 인프라) |
| S-MM58 | marine_warning_crawler.js | 1826~1830 (normalizeMmisTime) + push_helpers.js 52~54, 71~74, 80~82 + utils.js 160~162, 186~188, 195~197 |
| S-LATEST-BLINK | marine_warning_crawler.js | 1126~1130 (_sameReleaseMoment) + 1151~1199 (_applyTimeWindowHold) |
| S-DEBOUNCE-VIBRATE | marine_warning_crawler.js | 1228~1263 (_debounceTimeValues) |

---

# 부록 L: 발효시각/해제시각 hold 의 시나리오 매트릭스

`_applyTimeWindowHold` 의 동작을 표로 정리:

| held | incoming | isRange(incoming) | win | win 비교 | 처리 |
|---|---|---|---|---|---|
| 없음 (prev/mem 모두 없음) | 정확시각 | false | 없음 | — | 그대로. 윈도우 미확립. |
| 없음 | 범위형 | true | 없음 | — | 그대로. 윈도우 확립 (winMap[zone]=incKey). |
| 정확시각 | 정확시각 (같음) | false | 있음 | 안 비교 | 그대로. |
| 정확시각 | 정확시각 (다름) | false | 있음 | incKey > win → 연장 / 안 그러면 그대로 | held 우선 적용 안 함 (held&&isRange 조건 X). |
| 정확시각 | 범위형 (윈도우 안) | true | 있음 | incKey ≤ win | info[field] = held (정확값 hold). |
| 정확시각 | 범위형 (윈도우 초과) | true | 있음 | incKey > win | **연장 플래그 set**. winMap 갱신. held 적용 안 함. |
| 범위형 | 정확시각 | false | 있음 | — | 정확시각 그대로. held 적용 안 함. |
| 범위형 | 범위형 (윈도우 안) | true | 있음 | incKey ≤ win | 그대로. |
| 범위형 | 범위형 (윈도우 초과) | true | 있음 | incKey > win | **연장 플래그 set**. winMap 갱신. |

자식해역의 경우:
- 부모와 같은 정확값 hold 만 적용 (윈도우/연장은 부모만).
- 자식 윈도우 따로 안 둠 → 자식 단독 연장은 `_buildUserPushChanges`
  CHILD_*_EXTEND 분기에서 prev 자식 vs curr 자식 직접 비교.

---

# 부록 M: 등급 점수 (LVL_RANK / TYPE_RANK) 매트릭스

```
TYPE_RANK = { 태풍: 100, 풍랑: 10, 강풍: 10, 해일: 10, 호우: 10, 대설: 10, 기타: 0 }
LVL_RANK  = { 경보: 5, 주의보: 2, 예비: 2, 해제: 0, 기타: 0, '': 0 }

_score(typeName, lvlName):
  if (!lvlName || lvlName === '해제') return 0
  t = TYPE_RANK[typeName] || (typeName.includes('태풍') ? 100 : 10)
  l = LVL_RANK[lvlName] || 0
  return t + l

점수 매트릭스:
  태풍 경보   = 105
  태풍 주의보 = 102
  태풍 예비   = 102 (주의보와 동률)
  풍랑 경보   =  15
  풍랑 주의보 =  12
  풍랑 예비   =  12 (주의보와 동률)
  해제 / 빈값 =   0

전이별 점수 비교:
  풍랑 예비 → 풍랑 주의보:   12 → 12 (동률) → _score 격상 분기 NO
    → 별도 분기 (라인 413~) 가 active bucket 으로 보냄.
  풍랑 주의보 → 풍랑 경보:   12 → 15 → 격상.
  풍랑 경보 → 태풍 주의보:   15 → 102 → 격상 (type_upgrade).
  태풍 경보 → 풍랑 경보:     105 → 15 → 격하 (type_downgrade).
  풍랑 경보 → 풍랑 주의보:   15 → 12 → 격하 (level_downgrade).
```

예비 == 주의보 동률 정책은 의도된 것으로, "예비특보" 가 "주의보 예고" 의
의미라 같은 등급으로 보는 것이 의미적으로 맞다.

---

# 부록 N: 사용자 push 메시지 조립 순서

```
[1] processAndSendNotifications(changes, options):
    changes = [{type, zone, prev, curr, childState, currentActive?, ...}, ...]
    options = { adminToken: string | null }

[2] 점검 모드 체크: data/maintenance_config.json 의 active && blockPush.

[3] groups = {} (templateId_typeName_level 키)
    for each change:
      type 별 분기 → scenario 결정
      addToGroup(groups, scenario, typeName, level, itemData)
        itemData = { zones:[zone], childState, tmFc, tmEf, tmYn, oldTime?, newTime?, ... }

[4] for each group key:
      payload = { templateId, typeName, level, items, prevTypeName, prevLevel }
      sendToApi(payload, adminToken) → POST /api/push-custom

[5] routes/push.js (라인 240~):
      각 구독자 user 별:
        userFilteredItems = getMatchedZones(user.zones, payload.items, opts)
        showChildZones = !(user.options && user.options.childZones === false)
        generated = generateMessage({ ...payload, items:userFilteredItems, showChildZones })
        if (generated.title === '') skip   ← 자식 단독 연장 + childZones OFF
        if (자식 전용 templateId && childZones OFF): skip

[6] generateMessage:
      childStateByZone 인덱스 생성.
      decorateZone(zone) = showChildZones ? zone + buildChildQualifier(...) : zone.
      templateId 분기:
        publish, active, release, level_upgrade_*, level_downgrade_*,
        time_ef_change, time_yn_change, additional_active, partial_release,
        ef_extend, yn_extend, Fallback.
      각 분기 별로 title + body 조립 (formatGroupedMessage).

[7] body 조립:
      formatGroupedMessage(groups, timeLabel):
        Object.entries(groups).map(([time, zones]) =>
          'ㅇ' + zones.map(decorateZone).join(', ') +
          '\n   - ' + timeLabel + ' : ' + fmt(time)
        ).join('\n')

      예: 'ㅇ울산앞바다, 부산앞바다
              - 발효예정 : 5월 20일 18시~24시'
```

---

# 부록 O: 자식 한정사(buildChildQualifier) 매트릭스

`buildChildQualifier(parent, childState, eventType)` 의 결과를 매트릭스로:

| eventType | 조건 | 결과 |
|---|---|---|
| release | (항상) | `''` (한정사 없음 — 부모+자식 동시 해제 정책) |
| prelim_cancel | (항상) | `''` (부모만) |
| partial_release | allReleased == true 또는 released.length == all.length | `(모든 ${label} 해제)` |
| partial_release | released.length > 0 | `(${released names...}만 해제)` |
| partial_release | (none above) | `''` |
| ef_extend / yn_extend | extended.length > 0 (자식 단독) | `(${extended names...})` |
| ef_extend / yn_extend | (부모 동반) | 아래 일반 로직 |
| additional_active | added.length > 0 | `(${added names...} 추가 발효)` |
| level/type _upgrade_* | active.length == 0 | `(${label} 격상 없음)` |
| level/type _downgrade_* | active.length == 0 | `(${label} 격하 없음)` |
| time_ef_change/time_yn_change | parentTimeUnchanged == true && active.length > 0 | `(${label}만 시각 변경)` |
| 그 외 (publish/active/시각변경 부모포함) | active.length == 0 | `(${label} 미발효)` |
| 그 외 | all.length == active.length > 0, all.length == 1 | `(${label} 포함)` |
| 그 외 | all.length == active.length > 0, all.length > 1 | `(모든 ${label} 포함)` |
| 그 외 | active.length > 0 (부분) | `(${active names...} 포함)` |

label 은 PARENT_CHILD_TYPE[parent] 에 따라:
- 'connection' → '연안바다'
- 'pyeongsu' → '평수구역'
- 'both' → '평수구역/연안바다'
- (매핑 없음 = 자식 없는 부모) → 한정사 자체 미부착.

자식 fullName 의 표시는 `_stripParentPrefix(parent, child)` 로 처리:
- "제주도서부앞바다중북서연안바다" → "북서연안바다"
- "천수만평수구역" → "천수만평수구역" (prefix 없음)

---

# 부록 P: weather_alerts.json 의 구조 (사용자 앱 표출)

```json
{
  "updatedAt": "2026. 5. 20. 오후 2:35:01",
  "lastReportId": ...,
  "processedReportIds": [...],
  "pendingRetries": {...},
  "oneTimeBulletinWindowOverride": null,
  "previous": {
    "동해": { ... },
    "서해": { ... },
    "남해": { ... },
    "제주도": { ... }
  },
  "current": {
    "동해": {
      "동해남부해상": {
        "동해남부앞바다": {
          "울산앞바다": {
            "current": {
              "wrnTp": "풍랑",
              "wrnTpNm": "풍랑",
              "wrnLvl": "주의보",
              "wrnLvlNm": "주의보",
              "tmFc": "2026년 05월 20일 06시 00분",
              "tmEf": "2026년 05월 20일 12시 00분",
              "tmYn": "21일 06시~09시",
              "tmCc": "21일 06시~09시",
              "clrNtcTm": "21일 06시~09시",
              "source": "MARINE_MMIS"
            },
            "upcoming": null,
            "history": [...],
            "children": {
              "울산앞바다중평수구역": {
                "source": "MARINE_MMIS",
                "wrnTp": "풍랑",
                "wrnTpNm": "풍랑",
                "wrnLvl": "주의보",
                "wrnLvlNm": "주의보",
                "tmFc": "...",
                "tmEf": "...",
                "tmYn": "...",
                "tmCc": "...",
                "clrNtcTm": "..."
              },
              "울산앞바다중연안바다": null
            }
          },
          "경북남부앞바다": { ... },
          "경북북부앞바다": { ... }
        },
        "동해남부먼바다": { ... }
      },
      "동해중부해상": { ... }
    },
    ...
  }
}
```

루트의 4 sea (동해/서해/남해/제주도) → 해상(중부/남부/...) → 앞바다 → leaf zone.
leaf zone 마다 { current, upcoming, history, children } 4 필드.

- `current`: 발효중 (주의보/경보) — 객체, 아니면 null.
- `upcoming`: 예비특보 — 객체, 아니면 null. (B 트랙으로 발효+공존 예비도 들어감)
- `history`: 본 cycle 에선 손대지 않음. 디스크 값 보존.
- `children`: skeleton 의 자식 키별로 active 면 객체, 비활성이면 null.

`_writeWeatherAlertsJson`:
1. 디스크 read → history / 메타 보존.
2. `_buildZoneTreeFromSnapshot(currSnap)` → newCurrent.
3. `_buildZoneTreeFromSnapshot(prevSnap)` → newPrevious.
4. 머지: history 는 디스크값 보존.
5. atomic write (tmp → rename).

다운스트림:
- `routes/weather.js`: `/api/weather-alerts` 응답.
- `services/cache_manager.js`: mtime 기반 캐시 무력화.
- 사용자 앱 `js/render.js`, `js/render_coastal.js`: 지도/리스트 표출.

---

# 부록 Q: render.js / render_coastal.js 의 표출 분기

부모 zone 렌더:
- `current` 객체가 있으면 발효중 색칠 + 배지.
- `upcoming` 객체가 있으면 "다가오는 특보" 별도 배지 (current 가 있어도 병렬 표출).
- `children` 의 각 자식이 active 면 자식 폴리곤 색칠.

자식 zone 렌더 (render_coastal.js):
- `leaf.children[fullName]` 이 객체면 활성.
- 자식 자신의 wrnTp/wrnLvl/시각 표시 (부모 비종속).
- 지도 팝업에 해제예정 시각 표출 (a9cba9c).
- 활성 특보 모드에서도 자식 라벨 표출 (5acafbe).

표출 회귀 차단:
- 옛 dmdw 구조 호환 보존 (1870784).
- 자식 클릭 박스 + 폴리곤 hole-punching (S13, ac57427).

---

# 부록 R: 시나리오 — 부모 zone 단독 변화 vs 자식 동반 변화 매트릭스

| 부모 변화 | 자식 변화 | DiffMatrix 결과 | 사용자 push |
|---|---|---|---|
| 신규 발효 (없음→주의보) | 자식 set 변화 무관 | `active` | 🚨 풍랑 주의보 발효 (한정사: 자식 active set 기준) |
| 신규 예비 발표 | (자식 set 무관) | `publish` | 📢 풍랑 주의보 발표 (한정사: 자식 active set 기준) |
| 예비 → 정식 발효 | (자식 set 무관) | `active` (별도 분기) | 🚨 발효 |
| 등급 격상 | (자식 set 무관) | `level_upgrade_active` | 🚨 격상 발효 |
| 부모 유지 + clrNtcTm 변화 + 자식 set 무변화 | 없음 | `time_yn_change` | 🕐 해제시각 변경 |
| 부모 유지 + clrNtcTm 변화 + 자식 set 변화 | 추가 발효 OR 일부 해제 | setChanged 우선 → `additional_active` or `partial_release` (시각 변경 push 억제) | 📢 추가 발효 또는 ✅ 일부 해제 |
| 부모 유지 + clrNtcTm 무변 + 자식 set 변화 | 추가 발효 OR 일부 해제 | `additional_active` or `partial_release` | 📢 추가 발효 또는 ✅ 일부 해제 |
| 부모 유지 + 자식만 시각 변화 (set 무변) | 자식만 시각 변경 | `time_ef/yn_change` parentTimeUnchanged=true | 🕐 시각 변경 (X만 시각 변경) |
| 부모 해제 (정식) | (자식 다 사라짐 동반) | `release` (한정사 X) | ✅ 해제 |
| 부모 해제 (자식 일부 남음 — 비정상) | 자식 일부 살아있음 | `release` (부모) + `partial_release` (자식)? | 정책 모호 — 검증 필요 |
| 부모 예비 취소 | (자식도 예비였으면 동반) | `prelim_cancel` | (옵션 B yebi-push) |

---

# 부록 S: 시나리오 — KMA 통보문 cmd 매트릭스 (warn/latest)

| cmd | 의미 | enrich 동작 |
|---|---|---|
| 발표 | 새 특보 발효 (예비 → 정식 또는 즉시 정식) | tm_ef 가 미래면 GAP 보강 (예비로 추가). 발효중이면 skip. |
| 변경 | 발효중 특보의 시각·시간 변경 | tm_ef 가 미래면 GAP 보강 (변경된 발효시각). 발효중이면 skip. |
| 연장 | 발효 시간 연장 | tm_ef 가 미래면 GAP 보강. 발효중이면 skip. |
| 해제 | 특보 종료 | snap.parents 의 zone clrNtcTm = tm_ef 정확값 갱신 (V10). |
| 그 외 | — | 무시 (allowlist 외) |

---

# 부록 T: 등급명·등급코드·종류명·종류코드 인코딩 표

```
warn_lvl (실시간):
  '1' → '예비특보' → _normLvlNm → '예비'
  '2' → '주의보'
  '5' → '경보'

warn_lvl_nm (실시간):
  '예비특보' → 정규화 → '예비'
  '주의보'
  '경보'
  '해제'

warn_tp (실시간):
  'V' → '풍랑' (allowlist 대상)
  'T' → '태풍' (allowlist 대상)
  'O' → '폭풍해일' (V8 정책 제외)
  'W' → '강풍' (육상 — 제외)
  'C' → '한파' (제외)
  그 외 → 제외

warn_tp_nm (실시간):
  '풍랑', '태풍', '폭풍해일', '강풍', '한파', ...

warn_tp (ef/list timeline):
  '6' → '풍랑'
  '7' → '태풍'
  '1' → '강풍'
  '5' → '폭풍해일'
  → 실시간과 다른 인코딩 — 절대 혼용 금지.

warn_cmd_nm (latest):
  '발표', '변경', '연장', '해제', (그 외)
```

---

# 부록 U: 부모 zone 28개 ↔ 자식 그룹 매트릭스

```
(A) connection (연안바다만, 11개):
  강원북부앞바다     → 강원북부앞바다중연안바다
  강원중부앞바다     → 강원중부앞바다중연안바다
  강원남부앞바다     → 강원남부앞바다중연안바다
  경북북부앞바다     → 경북북부앞바다중연안바다
  거제시동부앞바다    → 거제시동부앞바다중연안바다
  제주도북부앞바다    → 제주도북부앞바다중연안바다
  제주도남부앞바다    → 제주도남부앞바다중연안바다
  동해중부안쪽먼바다  → 울릉도울릉읍연안바다, 울릉도서면연안바다, 울릉도북면연안바다
  남해서부서쪽먼바다  → 남해서부서쪽먼바다중추자도연안바다
  제주도동부앞바다    → 북동연안바다, 남동연안바다, 우도연안바다
  제주도서부앞바다    → 북서연안바다, 남서연안바다, 가파도연안바다

(B) pyeongsu (평수구역만, 13개):
  인천·경기북부앞바다  → 평수구역
  인천·경기남부앞바다  → 먼평수구역, 북부앞평수구역, 남부앞평수구역
  전북북부앞바다      → 평수구역
  전북남부앞바다      → 평수구역
  전남북부서해앞바다   → 평수구역
  전남중부서해앞바다   → 먼평수구역, 앞평수구역
  전남남부서해앞바다   → 평수구역
  전남서부남해앞바다   → 평수구역
  전남동부남해앞바다   → 서부평수구역, 동부평수구역
  충남북부앞바다      → 천수만, 안면도서쪽, 당진, 태안·서산북쪽 평수구역
  충남남부앞바다      → 평수구역
  서해남부남쪽안쪽먼바다 → 조도부근평수구역

(C) both (평수구역 + 연안바다, 5개 — Followup Major-1 포함):
  울산앞바다          → 평수구역, 연안바다
  경북남부앞바다      → 평수구역, 연안바다
  경남중부남해앞바다  → 평수구역, 연안바다
  부산앞바다          → 동부평수구역, 서부평수구역, 연안바다
  경남서부남해앞바다  → 동부평수구역, 서부평수구역, 남부평수구역, 남해군연안바다
```

자식 없는 부모 (먼바다 등) 는 PARENT_CHILD_TYPE 미등록 → 한정사 미부착.

---

# 부록 V: KMA endpoint 응답 row 의 안티패턴

다음은 mmis 응답에서 종종 마주치는 특수 케이스:

### V-1. 발효중인데 발효시각이 미래
- `warn_lvl_nm='주의보'` + `tm_ef` 가 미래 시각.
- 보통 직전 cycle 에 발효 통보문이 발행되고 이번 cycle 에 정식 list 로 이동한 경우.
- 정상 처리됨 (active 분기).

### V-2. 같은 zone 이 list 와 ready 양쪽에 (B 트랙)
- list 에 주의보, ready 에 경보 예비.
- `_buildSnapshotFromMarine` 가 upcomings 별도 트랙 보존 (S-PARALLEL).

### V-3. 자식 응답이 부모 응답보다 적음
- warn-sasc/list 에 자식 0개, warn/list 에 부모 발효중.
- 자식이 아직 발효 안 함. 부모만 표출.

### V-4. 자식 응답이 부모 응답보다 많음 (오류)
- 이론적으로 발생 어려움. 발생 시 _extractParent 가 부모 식별 후 children 에 등록.
- 부모 발효 없으면 표출 안 됨 (사용자 앱 leaf 가 children 만 보지는 않음).

### V-5. clr_ntc_tm 이 과거 시각
- KMA 데이터 오류. 거의 발생 안 함.
- 가드 없음 → 그대로 표출 (사용자가 "잘못된 데이터" 로 인지).

### V-6. tm_ef 가 9999/0000 같은 sentinel
- formatWarningTime 의 `tmEf === '0' || tmEf === '000000000000'` 분기로 '정보 없음' 처리.

### V-7. warn_zone_cd 와 warn_zone_nm 불일치
- 거의 발생 안 함. 발생 시 코드 매핑 우선이라 안전.

### V-8. 동일 zone 의 여러 종류 동시 (풍랑 + 강풍)
- 풍랑만 allowlist 통과 → 강풍 무시. 사용자 입장에서 강풍 누락이지만 정책 (V8).

---

# 부록 W: D-medium 의심 가드의 의사 결정 흐름

```
                  매 cycle 호출: _applySuspiciousGuard(prev, curr)
                         │
                         ▼
              _classifyReleases(prev, curr)
                         │
                         ▼
         ┌──────────────────────────────┐
         │  suspiciousZones.length      │
         └──────────────────────────────┘
                  │           │
                  │ < 3       │ ≥ 3
                  │           │
                  ▼           ▼
       ┌───────────────┐   ┌──────────────────────────┐
       │ mmis 회복      │   │  의심 가드 가동           │
       │ 또는 의심 없음  │   │                          │
       └───────────────┘   └──────────────────────────┘
              │                       │
              │                       ├─ currentCase 없음? → 신규 생성
              │                       │      + 1차 push (관리자 — 비활성)
              │                       │      + decisionPending=true
              │                       │      + _saveSuspiciousState
              │                       │
              │                       └─ currentCase 있음? → cycleCount++
              │                              + 10분 경과? → 재 push + lastPushAt 갱신
              │                              + _saveSuspiciousState
              │                       │
              │                       └─ 의심 zone 을 curr 에 prev 정보로 복원
              │                              (parents, children, upcomings)
              │
              ├─ currentCase 있음? (회복) → auto-reset
              │    history 에 기록 + currentCase=null
              │
              └─ currentCase 없음? → no-op

────────────────────────────────────────────────
관리자 결정 API: decideSuspiciousCase(decision, decidedBy):
   - 'normal':  → history 기록 + _pendingImmediateRelease 설정
                + currentCase=null + 즉시 release push 발사
                  (단 ADMIN_PUSH_ENABLED=false 라 prev 정리만)
   - 'invalid': → currentCase 유지, lastPushAt=now (10분 카운터 reset)
```

---

# 부록 X: ASCII timeline — 의심 사례 7일 시나리오

```
Day 1 (T0):
  prev = { 울산앞바다 주의보, 부산앞바다 주의보, 경북남부 주의보, 전남남부 주의보 }
  curr = {} (mmis 빈 응답)

  suspiciousZones = ['울산', '부산', '경북남부', '전남남부']  (4개, 3+)

  _applySuspiciousGuard:
    currentCase 생성 caseId='20260520-0900'
    cycleCount=1, lastPushAt=T0
    1차 push 발사 (관리자 채널 비활성이라 콘솔 로그만)
    curr 에 4 zone 복원 (release 보류)

  [PushSender] 0건의 변경사항 분석 중...

Day 1 (T0 + 10min):
  여전히 mmis 빈 응답.
  _applySuspiciousGuard:
    cycleCount=11
    lastPushAt + 10min < now → 재 push 발사 (관리자 채널 비활성)
    lastPushAt = now

Day 1 (T0 + 30min):
  관리자가 admin 페이지에서 normal 결정.
  decideSuspiciousCase('normal', 'admin1'):
    history.unshift({id, decision:'normal', decidedBy:'admin1', elapsedMin:30, ...})
    _pendingImmediateRelease = [4 zones]
    currentCase = null
    _enqueueImmediateRelease(...):
      prev.parents 에서 4 zone 제거
      (ADMIN_PUSH_ENABLED=false → dmdw 발사 skip)

Day 1 (T0 + 31min):
  다음 cycle.
  prev 에 4 zone 없음 → curr 비어있어도 release 분기 트리거 안 됨.
  → push 0건 (사용자 채널은 정책상 release 안 보내는 게 맞음 — 의심 해소 후 후속 처리).

────────────────────────────────────────────────────────
다른 시나리오: mmis 회복

Day 2 (T1):
  prev = { 울산앞바다 주의보 (복원된 상태), ... 4개 }
  curr = { 울산앞바다 주의보, 부산앞바다 주의보, 경북남부 주의보, 전남남부 주의보 }
       ← mmis 회복 — 같은 zone 다시 등장

  suspiciousZones = []  (회복)

  _applySuspiciousGuard:
    currentCase 있음 → auto-reset
    history.unshift({id, decision:'auto-reset', decidedBy:'system', ...})
    currentCase = null

  diff 분석:
    parents 변화 없음 → push 0건.
```

---

# 부록 Y: V10 enrich 의 corner case

### Y-1. 발효중인 zone 의 latest 가 cmd='발표' 인 경우
- list 에 active row 있음 → snap.parents 에 등록됨.
- latest 가 같은 zone 의 cmd='발표' → tm_ef 가 과거 (발효 이전 발표시각).
- `_isFutureExactTime(tm_ef) = false` → GAP 보강 skip.
- 영향 없음.

### Y-2. 해제 통보문이 발효 row 보다 먼저 발견
- list 에 active row, latest 에 cmd='해제' tm_ef='미래 시각'.
- `_enrichSnapshotWithLatest` 가 cmd='해제' 분기로 들어가 clrNtcTm 갱신.
- 이미 발효중이라 GAP 분기 트리거 안 됨.

### Y-3. 다른 zone 의 latest 가 발견됨
- prev 도 curr 에도 없는 zone 의 latest cmd='해제' 발견.
- `snap.parents.has(name) = false` → skip.
- 영향 없음.

### Y-4. 한 zone 의 latest 가 여러 row
- 보통 latest 가 zone 별 1개만 주는데, 만약 여러 개 발견되면 마지막 매칭이 우선.
- 이론상 발생 어려움.

---

# 부록 Z: warn-sasc/latest 의 cmd='해제' 처리

```
for row in warnSascLatest:
  if _isTargetRealtimeType(row.warn_tp) === false: skip
  cname = _resolveZoneName(row)
  parent = _extractParent(cname)
  if parent === cname: skip (부모형 행)
  cmd = row.warn_cmd_nm

  if cmd === '해제':
    [a] _childReleaseNoticeSet.add(cname)
        ← 디바운스 면제 신호 (S-CHILD-BLINK 와 구분)
    [b] 발효중 자식의 정확한 해제예고시각 보강:
        m = snap.children.get(parent)
        if (m && m.has(cname)):
          ci = m.get(cname)
          t = String(row.tm_ef || '').trim()
          if t:
            ci.clrNtcTm = t  ← 자식 개별 정확값
            sascChildEnriched++
    continue
```

자식 해제 통보문이 있으면:
1. 디바운스 우회 (즉시 해제 처리).
2. 자식의 clrNtcTm 을 정확 시각으로 갱신.
   → 사용자 앱 지도 팝업에 정확한 해제예정 시각 표시 (a9cba9c).

---

# 부록 AA: weather_alerts.json 표출의 옛 dmdw 호환

`_buildZoneTreeFromSnapshot` 의 `toBlock`:

```javascript
const toBlock = (info) => ({
    wrnTp: info.wrnTpNm || info.wrnTp || '',       // 한글 우선 (data.js:269 호환)
    wrnTpNm: info.wrnTpNm || '',
    wrnLvl: info.wrnLvlNm || info.wrnLvl || '',    // 한글 우선
    wrnLvlNm: info.wrnLvlNm || '',
    tmFc: normalizeMmisTime(info.tmFc),
    tmEf: normalizeMmisTime(info.tmEf),
    tmYn: normalizeMmisTime(info.tmYn),
    tmCc: normalizeMmisTime(info.clrNtcTm),        // 옛 tmCc = mmis clrNtcTm
    clrNtcTm: normalizeMmisTime(info.clrNtcTm),    // 신규 필드 (양 형식 모두 지원)
    source: 'MARINE_MMIS'
});
```

배경:
- 옛 dmdw 시스템은 `wrnTp` 에 한글 ('풍랑') 을, mmis 는 'V' 코드를 사용.
- 사용자 앱 frontend (js/data.js:269 등) 가 옛 한글 가정.
- 호환 위해 한글 우선 + 신규 필드 병기.
- `tmCc` 와 `clrNtcTm` 둘 다 채움 (frontend 가 어느 필드를 읽을지 모름).

자식 zone 정규화:
```javascript
const lvlNmNorm = info.wrnLvlNm === '예비' ? '주의보' : info.wrnLvlNm;
```
- 예비는 푸시 dedup 정책 상 '주의보' 로 정규화.
- 배지에는 wrnLvl 별도 보존 가능.

---

# 부록 BB: 시나리오 — 자식 단독 연장 디테일

```
prev:
  parents['제주도서부앞바다'] = { wrnLvlNm:'주의보' } — 부모 발효 유지
  children['제주도서부앞바다'] = Map {
    '북서연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 09시~12시' },
    '남서연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 09시~12시' },
    '가파도연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 12시~15시' }
  }

curr:
  parents 변화 없음
  children = Map {
    '북서연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 12시~15시' },     ← 늦어짐
    '남서연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 12시~15시' },     ← 늦어짐
    '가파도연안바다': { wrnLvlNm:'주의보', clrNtcTm:'21일 15시~18시' }   ← 더 늦어짐
  }

_buildUserPushChanges (라인 1517~1551):
  부모 unchanged. !upcomingChanged && !activeChanged && c → 자식 단독 분기.

  for cn in currChildren:
    북서: oldT='21일 09~12시', newT='21일 12~15시'
          isUp = false (주의보)
          oldT, newT 모두 범위 + kn>ko → 연장
          key = oldT + '||' + newT = '21일 09시~12시||21일 12시~15시'
          ynKids[key] = { oldTime, newTime, names:['북서연안바다'], block }

    남서: 같은 (oldT, newT) → 같은 key → ynKids[key].names.push('남서연안바다')
          → ['북서연안바다', '남서연안바다']

    가파도: oldT='21일 12~15시', newT='21일 15~18시'
            다른 key → ynKids[key2] = { ..., names:['가파도연안바다'] }

  결과 push 2건:
    [1] { type:'CHILD_YN_EXTEND', zone:'제주도서부앞바다',
          curr: block,
          oldTime:'21일 09시~12시', newTime:'21일 12시~15시',
          childState: { all, active, extended:['북서연안바다','남서연안바다'] } }

    [2] { type:'CHILD_YN_EXTEND', zone:'제주도서부앞바다',
          curr: block,
          oldTime:'21일 12시~15시', newTime:'21일 15시~18시',
          childState: { all, active, extended:['가파도연안바다'] } }

pushSender:
  각 push → addToGroup('yn_extend', '풍랑', '주의보', { zones:['제주도서부앞바다'],
      childState, oldTime, newTime })
  → 그룹 key 같음 (yn_extend_풍랑_주의보) → items 2개로 묶임.

generateMessage(yn_extend):
  childZones OFF 사용자 필터:
    items[0].childState.extended.length>0 → 제외 candidate
    items[1] 같음 → 제외 candidate
    extItems = [] → return { title:'', body:'' } → push 미발송.

  childZones ON 사용자:
    그룹 oldTime||newTime 별로 다시 분할:
      group1 = { oldTime:'21일 09~12시', newTime:'21일 12~15시', zones:['제주도서부앞바다'] }
      group2 = { oldTime:'21일 12~15시', newTime:'21일 15~18시', zones:['제주도서부앞바다'] }
    each group:
      zStr = '제주도서부앞바다(extended names)' via decorateZone
        buildChildQualifier(yn_extend):
          extended = items[i].childState.extended
          → '(북서연안바다, 남서연안바다)' / '(가파도연안바다)'
    body:
      'ㅇ제주도서부앞바다(북서연안바다, 남서연안바다)
          - 기존 : 5월 21일 09시~12시
          - 변경 후 : 5월 21일 12시~15시
       ㅇ제주도서부앞바다(가파도연안바다)
          - 기존 : 5월 21일 12시~15시
          - 변경 후 : 5월 21일 15시~18시'
    title: '🕐 풍랑 주의보 해제 예정시각 연장'
```

---

# 부록 CC: 시나리오 — 발효 다중 zone 동시 격상

```
prev:
  parents['울산앞바다']    = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }
  parents['경북남부앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }
  parents['부산앞바다']    = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }

curr (같은 cycle 에 3개 zone 동시 격상):
  parents['울산앞바다']    = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }
  parents['경북남부앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }
  parents['부산앞바다']    = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }

DiffMatrix (관리자 채널 비활성):
  3 zone 모두 level_upgrade_active bucket.
  같은 meta key '풍랑|경보' → 한 group entries=[3개]
  enqueueLevelUpgrade(cycleId, '풍랑', '주의보', '경보', entries, 'active', info)

_buildUserPushChanges 사용자 채널:
  3 CURRENT_CHANGE push:
    [{type:'CURRENT_CHANGE', zone:'울산앞바다',    prev:{주의보}, curr:{경보}, childState1},
     {type:'CURRENT_CHANGE', zone:'경북남부앞바다', prev:{주의보}, curr:{경보}, childState2},
     {type:'CURRENT_CHANGE', zone:'부산앞바다',    prev:{주의보}, curr:{경보}, childState3}]

pushSender:
  각 change 처리 → addToGroup('level_upgrade_active', '풍랑', '경보',
                              { zones:[zone], childState, tmYn, prevTypeName:'풍랑', prevLevel:'주의보' })
  같은 group key → items = 3개

generateMessage(level_upgrade_active):
  title = '🚨 풍랑 주의보→경보 격상 발효'
  groupByTime(items, 'tmYn'):
    같은 tmYn 이면 한 그룹, 다르면 분할.
    예: 모두 '21일 12시~15시' 같으면:
      groups = { '21일 12시~15시': ['울산앞바다', '경북남부앞바다', '부산앞바다'] }
  formatGroupedMessage:
    body = 'ㅇ울산앞바다, 경북남부앞바다, 부산앞바다
              - 해제예정 : 5월 21일 12시~15시'

  각 zone 의 childState 한정사:
    decorateZone 가 각 zone 별로 buildChildQualifier('level_upgrade_active') 호출.
    childState.active 가 비었으면 '(연안바다 격상 없음)' / '(평수구역 격상 없음)' / '(평수구역/연안바다 격상 없음)'
    있으면 일반 매트릭스 ('(연안바다 포함)' 등).

  최종 body (childZones ON 사용자):
    'ㅇ울산앞바다(평수구역/연안바다 포함), 경북남부앞바다(연안바다 포함), 부산앞바다(평수구역/연안바다 격상 없음)
        - 해제예정 : 5월 21일 12시~15시'
```

---

# 부록 DD: PushSplitter 의 200자 한도 분할

```
조건: PushSplitter.MAX_BODY = 200, EFFECTIVE_MAX = 165
(나머지 35자는 제목 + (n/N) 마진)

PushSplitter.feed(groupBody):
  현재 buffer + 새 groupBody 가 165 자 이내면 누적.
  넘으면 현재 buffer flush → 새 buffer 로 시작.
  groupBody 자체가 165 자 초과면 줄 단위 분할:
    parentLines (ㅇ 줄) 와 timeLine (   - ...) 분리.
    timeLine 은 각 분할 청크에 반복 부착.

예시:
  대량 zone (10+) 격상 발효 같은 경우 한 push 가 200자 넘음 →
  3~4 개 push 로 분할 (1/4, 2/4, ...).
  관리자 채널 buildSplitPushes 가 이 로직 사용.
  사용자 채널 (generateMessage) 는 별도 분할 없이 routes/push.js 에서
  paginateByZoneBlocks 호출.
```

---

# 부록 EE: 시나리오 — 같은 zone 의 종류 변경 (풍랑 → 태풍)

```
prev: parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }   _score=15
curr: parents['울산앞바다'] = { wrnTpNm:'태풍', wrnLvlNm:'주의보' } _score=102

DiffMatrix.compute:
  typeChanged = true, cScore > pScore → isUp = true
  phase = '주의보' !== '예비' → 'active'
  bucket = 'type_upgrade_active'
  add(bucket, {parent, time:pCurr.tmYn, childState},
      {wrnTpNm:'태풍', wrnLvlNm:'주의보', prevWrnTpNm:'풍랑', prevWrnLvlNm:'경보'})

관리자 채널 (현재 비활성):
  enqueueTypeUpgrade(cycleId,
    {wrnTpNm:'풍랑', wrnLvlNm:'경보'},   ← from
    {wrnTp:'T', wrnLvl:'2', wrnTpNm:'태풍', wrnLvlNm:'주의보'},   ← to
    entries, 'active', info)
  buildAdminTitle:
    type_upgrade_active: () => `📢 ${prevTp+prevLvl}→${tp+effLevel} 격상 발효`
    title = '📢 풍랑경보→태풍주의보 격상 발효'
    (공백 없이 결합 — spec 예시)

사용자 채널:
  CURRENT_CHANGE { prev:{풍랑경보}, curr:{태풍주의보} }
  pushSender 의 분기:
    prev.wrnLvl !== curr.wrnLvl ('경보' !== '주의보') → 격상격하 분기 들어감.
    prevScore = getAlertScore('풍랑', '경보') = 15
    currScore = getAlertScore('태풍', '주의보') = 102
    prevScore < currScore → scenario = 'level_upgrade_active'
    addToGroup('level_upgrade_active', '태풍', '주의보',
               { zones:['울산앞바다'], childState, tmYn,
                 prevTypeName:'풍랑', prevLevel:'경보' })
  generateMessage(level_upgrade_active):
    prevLvl = '경보'
    title = '🚨 태풍 경보→주의보 격상 발효'
                ^^^^^^^^ ⚠️ 잘못된 표기!
                실제는 풍랑 → 태풍 종류 격상인데 사용자 채널은 type_change 별도
                handler 가 없어 level 격상으로 fallback. 종류 변경 정보 손실.

→ 사용자 채널의 type_upgrade/downgrade 처리는 검증·보강 필요한 영역.
```

---

# 부록 FF: 운영시 모니터링 권장 지표

| 지표 | 값 | 설명 |
|---|---|---|
| run() per minute | 1.0 ± 0.05 | 정상 1분 주기 |
| endpoint fail rate | < 1% | E-4 부분 실패 비율 |
| suspicious case count | 평소 0, 의심 시 1~N | history 누적 |
| auto-reset rate | history 의 80%+ | 자동 회복 정상성 |
| child blink count | cycle 마다 0~5 | 자식 깜빡임 디바운스 작동 빈도 |
| latest enrich count | 발효 zone 별 0~1 | V10 갱신 비율 |
| user push send rate | 변경 cycle 마다 1+ | 사용자 채널 정상성 |
| pending pushes count | < 5 | 재시도 큐 누적 |
| weather_alerts.json mtime | 1분마다 갱신 | 표출 fresh 보장 |

---

# 부록 GG: SLA 와 운영 정책

- **신선도**: 매 cycle = 1분, 응답 fresh ≈ 30초 (1분 cron + ~30초 처리).
- **정확성**: V10 으로 정확 해제시각 보강 시 ±1분 (warn/latest 갱신 주기).
- **안정성**: E-4 가 부분실패를 cycle skip 으로 흡수 → 잘못된 release push 0건 보장.
- **회복성**: 의심 가드 + 자동 reset 으로 운영자 개입 최소화.
- **확장성**: 28 부모 + 93 자식 정량 — 매핑 표 확장 시 코드 변경 필요.

---

# 부록 HH: 운영자 매뉴얼 (핵심 절차)

### 의심 사례 처리
1. 관리자 페이지 → "특보 수집 오류" 탭 진입.
2. currentCase 의 zones 확인.
3. KMA 통보문 사이트(marine.kma.go.kr) 에서 해당 zone 의 실제 해제 여부 검증.
4. 결정:
   - 정상 해제 → "normal" → 즉시 release push 발사.
   - 수집 오류 → "invalid" → 가드 유지 (10분 카운터 reset).

### 장부 초기화 (재배포 후 사용자 푸시 누락 의심)
1. 관리자 페이지 → "장부 초기화" 버튼.
2. resetState() 호출 → prev 비움.
3. forceBaselinePush + adminToken 으로 run() 호출 → 관리자 기기에만 테스트 push.
4. 정상 작동 확인 후 일반 cycle 자연 재개.

### 전체 사용자 재발송 (긴급 알림)
1. 관리자 페이지 → "전체 사용자 재발송" 버튼.
2. broadcastAll API 호출 → 등록된 모든 토큰에 같은 메시지.
3. 사용자 push 채널 의도적 우회 — 일회성.

### 자식 해역만 리셋
1. 관리자 페이지 → "자식 리셋" 버튼.
2. 윈도우 드롭다운 선택 (0~72h, 6h 간격).
3. 해당 윈도우 내 자식 history 만 clear.

### 점검 모드
1. 관리자 페이지 → "점검 모드 켜기".
2. data/maintenance_config.json 갱신: active=true, blockPush=true (기본).
3. push 발사 차단. 크롤러는 계속 돌지만 사용자에게 알림 안 감.

---

# 부록 II: 자주 묻는 질문 (FAQ)

**Q1. 왜 colored 부팅 시 push 가 안 가나요?**
A. E-1 가드. Fly.io 재배포 후 첫 cycle 에 메모리 prev 가 비어있으면
모든 활성 특보가 "신규 발효" 로 오인됨 → push 폭주 차단.

**Q2. 자식 깜빡임 디바운스가 항상 작동하나요?**
A. 해제예고가 등록(`_childReleaseNoticeSet`) 된 자식은 디바운스 없이 즉시 해제.
미등록 자식만 3분 관찰.

**Q3. warn/latest 가 항상 정확값을 주나요?**
A. cmd='해제' 통보문이 있는 zone 만. 발효 직후라 해제 통보문이 아직 없으면
list 의 범위형이 그대로 표출.

**Q4. 예비특보가 사라지면 항상 취소(prelim_cancel) 인가요?**
A. 아니오. warn/latest 에 발표 통보문이 있고 tm_ef 가 미래면 GAP 보강으로
다시 예비로 추가됨. 둘 다 없으면 진짜 취소.

**Q5. 자식 단독 시각 연장 push 는 모든 사용자에게 가나요?**
A. 아니오. `options.childZones === false` 인 사용자는 자식 단독 연장 push
제외 (generateMessage 의 extItems 필터).

**Q6. 자식이 부모와 다른 종류의 특보를 가질 수 있나요?**
A. 이론상 가능 (자식 응답에서 warn_tp 가 부모와 다를 수 있음). 현재 정책은
자식 wrnTp/wrnLvl 을 자식 자신의 데이터에서 가져옴 (f499308, 3705f4a).
사용자 push 도 자식 자신의 종류·등급으로 발사.

**Q7. 분 = 58/59 가 정확시각인 KMA 통보문이 있나요?**
A. 5년치 분석 기준 없음. 현재 무조건 범위코드로 해석.
만약 발생하면 잘못 표시될 수 있음 (edge case).

**Q8. 같은 zone 의 발효 + 예비가 동시에 가능한가요?**
A. 가능 (S-PARALLEL). 발효 도중 다음 단계 (격상 예고 등) 예비가 발표될 수 있음.
upcomings 별도 트랙으로 보존 + leaf.current + leaf.upcoming 병렬 표출.

**Q9. ef/list 는 왜 사용 안 하나요?**
A. timeline diff 는 push 발사 정책상 거의 필요 없음. 실시간 4 endpoint 로 충분.
ef/list 는 자격증명 필요해서 부담. 향후 history 보강용으로 활용 가능.

**Q10. 폭풍해일이 갑자기 다시 켜질 수 있나요?**
A. V8 정책. `REALTIME_TARGET_TP = new Set(['V','T'])` 상수 변경 필요.
allowlist 확장하려면 푸시 메시지 양식·UI 변경도 동반.

---

# 부록 JJ: 향후 개선 후보 (참고)

1. **사용자 채널 type_upgrade/downgrade 정밀 처리**: 현재 fallback 으로 level 격상격하로 처리되는 문제 (부록 EE).
2. **ef/list timeline diff 활용**: history 보강 (사용자 알림 페이지 정확도 향상).
3. **분=58/59 진짜 정확시각 케이스 대응**: 통보문 cmd 또는 다른 신호로 구분.
4. **caseId 자정 경계 처리**: 1개 case 가 여러 날에 걸칠 때 표시 일관성.
5. **D-medium threshold 동적 조정**: 평소 trafic 기반 자동 보정.
6. **warn/latest 캐싱**: 동일 응답 반복 fetch 줄이기.
7. **사용자 push retry 정책 정밀화**: 24h 만료 외 다른 폐기 조건.
8. **자식 응답 부모 wrnTp 불일치 시 정책**: 부모는 풍랑이고 자식은 강풍인 비정상 케이스.

---

# 부록 KK: 변경 이력 (commits chronological by topic)

## 1. MMIS 인프라 도입 (Phase 2 시작점)
- `082da8e fix(marine): v7 통합 활성화 및 boundary 보강 (followup base)`
- `baf34fa fix(marine): E-1/E-2/E-4 운영 안전성 보강`
- `c761225 fix(marine): Must-fix fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)`
- `64cba8a merge: marine v7 + Must-fix fmtTime + D-medium 인프라`

## 2. 사용자 채널 복원
- `9651167 fix(marine): 사용자 푸시 채널 복원 (push_sender 호출 추가)`
- `6fcbdb5 fix(marine): 사용자 푸시 보강 4건`
- `1870784 fix(marine): 사용자 앱 UI 회귀 차단 — 옛 데이터 구조 호환`

## 3. 시간 형식
- `a515853 fix(marine): D-1/D-2/D-6 시간 형식 변환 + 가드 보강`
- `f0477c6 fix(marine): 해제예고 범위형 시간대 명칭 변환`
- `640fd12 feat(display): 특보 시각 표시 통일`
- `2829a0e fix(push): 푸시 메시지 시각에서 상대일자 라벨 제거`
- `a05c3d2 fix(display): 푸시 도착 상세 팝업 시각 포맷 통일`
- `0aa4ccd fix(display): 해제예정 월·상대일자 라벨 보강 + 시각 2자리 패딩`
- `8a9a798 fix: KMA 레거시 범위코드(분=58/59) 점·대시 형식 인식`
- `b786ece fix: KMA 레거시 범위코드(분=58/59) 한글 형식 + normalize`

## 4. V10 warn/latest
- `dbe2c6b feat(marine): V10 — warn/latest 엔드포인트 추가`
- `7c981d1 fix: warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단`
- `2866fe0 fix: 연장은 "범위형→더 늦은 범위형"일 때만`
- `b05ce1f feat: 정확 해제시각 고정 + 해제윈도우 기반 연장 판별`
- `5ded869 feat: 발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장`
- `a7bc5c9 fix: 정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)`

## 5. V11 예비 병합 + allowlist
- `ff1fe17 fix(marine): 예비특보 푸시 부활 + 특보종류 allowlist + 미발효 한정사 버그`

## 6. 코드 매핑 (A안)
- `2c25c58 feat(marine): 코드기반 해역명 매핑(A안) + 테스트푸시 관리자전용`
- `e0bed16 fix(mappings): 존재하지 않는 '경기북부앞바다' zone 제거`
- `52f0ab8 fix(subregion): 좀비 자식해역 '인천·경기북부앞바다중연안바다' 제거`

## 7. 관리자 푸시 비활성
- `aeae518 fix(marine): 관리자 알림 푸시 전면 비활성 (수정1)`

## 8. 자식 한정사 토글
- `378d64a feat(push): 사용자 푸시 자식해역 한정사 토글 (작업2a+2b)`
- `a057b7f feat(push): 관리자 푸시 콤마결합 양식 통일 (작업2c)`
- `a0d8ba3 fix(push): 검증 피드백 반영 — 야간 경계 라벨 일치 + dead code`

## 9. 자식 독립 푸시
- `f499308 feat: 자식 독립 푸시 (추가 발효/일부 해제) + 자식 종류·등급 부모 fallback 제거`
- `3705f4a fix: 자식 해역 표출을 자식 개별 데이터에 기인 (부모 종속 제거)`

## 10. 자식 디바운스
- `9d47ed3 feat: 자식 해제 디바운스 3분 — 해제예고 없는 소멸 글리치 차단 + 관찰 로그`
- `a9cba9c fix: 자식 해역 지도 팝업에 해제예정 시각 표출 (active5 옛 dmdw 로직 제거)`

## 11. GAP 보강
- `2a21b9c fix(marine): "발표 발효대기" GAP 누락 보강`
- `f9e4340 fix: GAP 발표대기 자식 합성 fallback`
- `adab23e fix(marine): 예비→발표 단체전이 GAP 복합버그 4건 수정`
- `5a9e111 feat(marine): GAP 보강을 자식해역까지 확장`
- `0049f2a feat: GAP 자식을 warn-sasc/latest 개별 통보문으로 정확히 표출`

## 12. 시각 연장
- `374923d feat: 발효/해제 예정시각 연장 푸시 — 신규 발표 오인 방지`
- `7821092 feat: 자식 단독 연장 푸시 — 부모와 동일하게 독립 감지/발송`
- `b411cea fix: 2중 검토 반영 — 연장 감지 등급 가드 + 연장기억 upcomings + 의심가드 복원`

## 13. 발표시각 고정 + 병렬 표출
- `451f48e feat: 발표시각을 현재 발효등급의 최초 발표시각으로 고정 (A)`
- `5213c83 feat: 다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존`

## 14. 핸드오프 공백
- `fe0bda5 fix: 예비→발표 핸드오프 공백 보강 — "발표" 오인 → "발효시각 변경"`

## 15. 디바운스
- `eb06efe feat: 발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단`

## 16. E-1 가드 완화
- `6df054a fix: E-1 빈-prev 가드를 콜드부팅 1회로 한정 — 무특보→신규특보 자연 전이 푸시 복원`

## 17. 의심가드 디테일
- `8998037 fix(marine): D-medium 인터랙티브 결정 + 통합관리자센터 UI 정리`
- `abf8c57 fix(marine): D-medium 의심 사례 reinforce push silent dedup 차단`
- `253ae97 fix(admin): push 카운터 별도 영속화 (500 한도 우회)`
- `5ea305b fix: 재검토 피드백 반영 — 관리자 푸시 시각 통일 + 리셋 경합/기본값 보강`
- `6ba1a95 feat(admin): 장부 초기화(테스트 푸시) 버튼 + 특정관리해역 토글 기본 ON`

## 18. 알림 페이지 UX
- `3cbfba2 fix(alert-push): 발송 이력 시각변경 필터가 빈 결과를 보이던 문제`
- `a30eef9 fix(alert-push): 사용자 알림 페이지 시각변경 탭에 '연장' 포함`
- `2f6c729 revert(alert-push): a30eef9 원복`
- `3c6282b feat: 발송 이력 "시각변경" 하위 탭 신규 추가`

## 19. Yebi 처리
- `5f62ebb feat(yebi-push): 예비특보 해제 알림 push 추가 (옵션 B)`
- `526cc7c, e1077ac, dd5b1d9 feat(yebi): 해제 정규식 V1~V3`
- `f74c326 fix(yebi): 참고사항 처리에서 폭풍해일 제외`
- `6027f9d feat(yebi): resolveTargets 에 ZONE_GROUP_MAP 활용`
- `ad90bf0 [Agent-B] 옵션 C — 참고사항 해제·연장 처리 + 자식 자동 해제`
- `517b566 Merge: [예비] 통보문 참고사항 해제·연장 처리`

## 20. 폭풍해일 제거
- `69c913b feat(alerts): 폭풍해일 특보 수집·표시 전면 중단`
- `9fe6143 chore(alerts): 폭풍해일 제거 후속 — 죽은 CSS·주석 정리`

## 21. 관리자 UI
- `c94ea5e feat: 관리자 UI 에 '전체 사용자 재발송' 버튼 추가 — broadcastAll 호출`
- `0f2d419 feat(admin): 자식 리셋에 윈도우 드롭다운 1회용 적용`
- `ec57794 feat(admin): 자식 해역만 리셋하는 admin 버튼 추가`

---

# 부록 LL: 최종 cheatsheet

```
[run() 호출 가드 순서]
  1. _runInProgress 락
  2. marine_client 4 endpoint allSettled (부분실패 = cycle skip)
  3. _buildSnapshotFromMarine (V11 allowlist + 정규화)
  4. _enrichSnapshotWithLatest (V10 정확값 + GAP 보강)
  5. E-1 빈 prev 가드 (콜드 부팅만)
  6. _applySuspiciousGuard (D-medium)
  7. _applyChildReleaseDebounce (3분)
  8. _applyAnnounceAnchor (tmFc 고정)
  9. _applyReleaseClrLogic (clrNtcTm 윈도우 hold)
  10. _applyUpcomingEfLogic (tmEf 윈도우 hold)
  11. _debounceTimeValues (3분 진동 차단)
  12. runDiffAndPush (관리자 — 비활성)
  13. _buildUserPushChanges → pushSender.processChanges
  14. _updateExtensionMemory
  15. _savePrevSnapshot
  16. _writeWeatherAlertsJson

[중요 상수]
  CHILD_RELEASE_DEBOUNCE_MS         = 3 * 60 * 1000
  TIME_CHANGE_DEBOUNCE_MS           = 3 * 60 * 1000
  EXTENSION_MEMORY_TTL_MS           = 6 * 60 * 60 * 1000
  EXTENSION_BRIDGE_MS               = 5 * 60 * 1000
  SUSPICIOUS_THRESHOLD              = 3
  PUSH_REINFORCE_INTERVAL           = 10 * 60 * 1000
  SUSPICIOUS_HISTORY_LIMIT          = 20
  HTTP_TIMEOUT_MS                   = 15000
  RATE_LIMIT_GAP_MS                 = 200
  REFRESH_INTERVAL_MS               = 25 * 60 * 1000
  TOKEN_TTL_MS                      = 30 * 60 * 1000

[allowlist]
  REALTIME_TARGET_TP = Set(['V', 'T'])      // 풍랑, 태풍만

[디스크 파일 5개]
  data/marine_warning_state.json
  data/marine_suspicious_state.json
  data/weather_alerts.json
  data/pending_pushes.json
  data/maintenance_config.json
```

---

(end of draft_2.md — supplementary appendices)

---

# Part B — MMIS 엔드포인트 메커니즘 + 데이터 모델

*독립 에이전트 #1 이 엔드포인트별 raw 데이터 shape 와 인코딩 관습에 집중하여 작성한 초안.*


> 본 초안은 "데이터 모델 + 엔드포인트 메커니즘" 관점에서 SEAGNAL 의 KMA MMIS
> (marine.kma.go.kr) 특보 시스템 통합 히스토리·내부 메커니즘·시나리오·시행착오·
> 현재 상태를 신규 개발자가 단독으로 이해할 수 있도록 정리한 문서다.
> 4 개 병렬 에이전트 중 1 번째 초안. 별도 에이전트가 4 개 초안을 머지할 예정.

대상 저장소: `/home/user/SEAGNAL/`
브랜치: `claude/kma-website-reference-KYLtf` (main 대비 271 커밋 앞섬)

---

## 목차

1. 개요 — SEAGNAL 과 해상 특보
2. MMIS 데이터 모델 — 7 endpoint 의 역할과 필드
3. 데이터 흐름 — 1 분 cron 부터 FCM 발송까지
4. 시나리오별 동작 — 22 케이스의 입력·처리·출력
5. 시행착오 히스토리 — 시간 순 변천사
6. 현재 상태 — 안정·취약·오늘 fix
7. 부록 — 용어집·파일별 책임·환경 변수·디버깅

---

## 1. 개요

### 1.1 SEAGNAL 이란

SEAGNAL 은 한국 해양 사용자(어선·낚싯배·연안 조업자·해양레저 동호인 등)
를 대상으로, 기상청(KMA)이 발표하는 **해상 특보(marine warning)** 와
관련 해양 기상 정보(부이·예보·조석·CCTV 등)를 단일 모바일/웹 앱에 묶어
"내가 구독한 해역" 만 푸시로 받아 보고, 지도 위에서 해역 색·아이콘으로
한눈에 확인할 수 있게 해 주는 서비스다.

- **프론트엔드**: Capacitor 기반 하이브리드 (Android APK + Web). `local_server/index2.html`
  + `local_server/js/*.js`. PWA 도 가능.
- **백엔드**: Node.js + Express, `local_server/server.js` + `local_server/scheduler.js`
  가 메인 엔트리. fly.io 에 배포(`fly.toml`, `Dockerfile`).
- **푸시**: FCM (Firebase Cloud Messaging) + Web Push (VAPID, web-push 라이브러리).
  사용자 구독 정보는 `local_server/data/push_subscriptions.json` (gitignore).
- **데이터 영속화**: fly.io persistent volume 의 `local_server/data/*.json`.

본 문서가 다루는 범위는 그 중 **해상 특보 수집·diff·푸시 + 표출** 파이프라인이다.

### 1.2 해상 특보의 종류·등급·생애주기

#### 1.2.1 특보 종류

KMA 가 해상 특보로 분류해 발표하는 종류는 여러 가지이지만, SEAGNAL 이 대상으로
삼는 것은 사용자 관심도와 신호 대 잡음비를 고려하여 다음 2 종 (allowlist) 만이다:

- **풍랑(風浪, Wind Wave)** — MMIS 실시간 endpoint 의 `warn_tp` 코드 `'V'`.
  파도/바람 결합 위험. 가장 자주 발표되는 해상 특보.
- **태풍(颱風, Typhoon)** — `warn_tp = 'T'`. 풍랑보다 점수 가중치가 훨씬 높다
  (TYPE_RANK: 태풍=100, 풍랑=10 — `marine_warning_crawler.js:226`).

다음은 의도적으로 **제외** 된다(allowlist 정책):

- **폭풍해일(O, Storm Surge)** — V8 이후 정책적으로 제외 (commit `69e9143` —
  "폭풍해일 특보 수집·표시 전면 중단"). 해상 특보 카테고리이지만 사용자 가치 낮음.
- **강풍(W, Strong Wind)** — 본질적으로 육상 특보. MMIS 실시간 응답에서 풍랑과
  같은 엔드포인트로 섞여 내려오므로 정밀 필터링이 필요.
- **호우/대설/한파(R/S/C 등)** — 모두 육상 특보. allowlist 가 자동 제외.

allowlist 는 `marine_warning_crawler.js:2016` 의 `REALTIME_TARGET_TP = new Set(['V', 'T'])`
에 정의되어 있다.

> ⚠️ 주의: 과거 V11 이전에는 "warn_tp === 5" 식으로 **숫자 코드 denylist** 를 썼다.
> 그러나 실시간 endpoint(`warn/list` 등) 는 **문자 코드(V/T/W/O)** 를 쓰고
> 인증 endpoint(`warn/ef/list`) 만 숫자 코드(6=풍랑/7=태풍/1=강풍/5=폭풍해일)
> 를 쓴다는 사실이 한참 뒤에야 발견되었다. 그래서 한동안 강풍·폭풍해일이
> 푸시에 새어 나가는 버그가 있었고, 이는 commit `dbe2c6b` (V10) → `ff1fe17`
> (V11 allowlist 도입) 으로 해결되었다.

#### 1.2.2 등급(level)

KMA 해상 특보는 2 단계 등급 + 사전 단계가 있다.

| 등급 | 한글 | MMIS 코드(`warn_lvl`) | 비고 |
|------|------|--------------------|------|
| 예비특보 | 예비 | (예비는 `warn/ready` endpoint 자체에 들어옴) | "지금 발효된 것은 아니지만 곧 발효될 가능성" |
| 주의보 | 주의보 | `2` | 1차 발효 |
| 경보 | 경보 | `5` (`LVL_RANK` 점수와 같음 — 우연) | 2차 발효, 주의보보다 심각 |
| 해제 | 해제 | `''` 또는 row 자체 부재 | 종결 |

⚠️ MMIS 실시간 응답은 예비특보를 `warn_lvl_nm = '예비특보'` 로 내려보내지만,
내부 로직은 모두 `'예비'` 로 비교한다. 그래서 `_normLvlNm()`
(`marine_warning_crawler.js:2002`) 가 `'예비특보' → '예비'` 로 정규화한다.
이걸 빠뜨리면 예비 판정이 전부 실패해 발표 푸시가 안 나간다 — V11 의 핵심 fix.

점수(score) 체계 (`marine_warning_crawler.js:_score`):

```js
TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, ... }
LVL_RANK  = { '경보': 5, '주의보': 2, '예비': 2, '해제': 0, '': 0 }
score(type, lvl) = TYPE_RANK[type] + LVL_RANK[lvl]
```

- **예비 == 주의보 동률(2점)** — "예비특보가 발효되면 주의보가 되는 것" 이라는
  현실 모델을 코드에 반영. 따라서 예비→주의보 전이는 `_score` 상 격상 아님
  (= "level_upgrade" 푸시로 잘못 분류되지 않음). 대신 별도 분기로 `'active'`
  bucket 에 들어간다(`DiffMatrix.compute` 의 "예비 → 정식 발효 전이" 처리,
  `marine_warning_crawler.js:413~420`).
- 종류 가중치는 등급보다 훨씬 크다 — 풍랑경보(15) 보다 태풍주의보(102) 가 위.
  격상/격하 판정에 결정적.

#### 1.2.3 생애주기(lifecycle)

전형적인 한 특보의 인생:

```
   [없음]
     │  (예보관 통보문 발행, st_tm < now < tm_ef)
     ▼
  예비특보 (warn/ready)
     │  ─── 발효시각 도래 (tm_ef <= now) ───
     ▼
  주의보 발효중 (warn/list)
     │
     ├─ 등급 격상 → 경보 발효중 (warn/list, level 변경)
     ├─ 등급 격하 → 주의보 유지 또는 해제
     ├─ 종류 변경 → 태풍주의보 (warn/list, type 변경)
     ├─ 해제예고 등록 → clr_ntc_tm 추가
     ├─ 발효예정 변경/연장 → tm_ef 변동
     ├─ 해제예정 변경/연장 → tm_yn / clr_ntc_tm 변동
     │
     │  ─── 해제 통보문 (warn/latest cmd=해제) ───
     ▼
  [해제] = warn/list 에서 사라짐
```

각 단계에서 KMA 가 사용하는 endpoint·필드는 다르다 — 다음 절에서 상술.

### 1.3 왜 통보문 크롤링에서 MMIS 로 전환했나

#### 1.3.1 옛 방식 — `weather_alerts_crawler.js` (HTML bulletin)

이전 SEAGNAL 은 KMA 의 "특보 통보문" HTML 페이지 (`https://www.weather.go.kr/w/special-report/list.do?stn=108`)
를 직접 크롤링하여, 통보문 본문 텍스트를 **정규표현식** 으로 파싱해 발효 zone/등급/시각
을 추출하는 방식이었다. 이는 commit `weather_alerts_crawler.js` 의 흔적과
`scheduler.js:1602~1603` 의 주석 처리된 옛 호출에 흔적이 남아 있다.

문제점:

1. **자연어 파싱의 취약성** — 발표문 텍스트는 매년 어휘가 조금씩 변한다.
   "해제하나" / "해제될" / "해제예정" 등의 변형이 끊임없이 등장해 정규식이
   터졌다. commit `dd5b1d9` (해제 정규식 V3 — 5년 데이터 분석 기반 10 가지
   어휘 변형 흡수) 가 그 흔적.
2. **자식 해역(연안바다·평수구역) 분리 안 됨** — 통보문은 부모 해역 중심이고
   자식 해역은 "참고사항" 영역에 자연어로만 나온다. 자식별 발효 상태를
   따로 추출하려면 또 다른 파서가 필요했고, 그것이 `dmdw_warn_crawler.js`
   (자식 해역 크롤러, commit `de1ad1a` ~ `767b5bf`) 로 별도 모듈화되었다.
   즉 출처가 이중화되었고 동기화 문제가 항상 따라다녔다.
3. **시각 정밀도 부족** — "23일 3시~6시" 같은 6시간 범위 텍스트가 통보문의
   기본 단위였다. 정확 시각이 필요한 시나리오(해제예정 변경 푸시·발효시각
   변경 푸시 등) 에선 정확도가 떨어졌다.
4. **느린 반응성** — KMA 가 HTML 을 갱신하는 데도 몇 분 지연이 있고, 본문
   파싱 자체가 무겁다.
5. **GAP 케이스** — "발표는 났는데 발효시각이 아직 미래" 상태가 통보문에는
   잘 나타나지 않아 발표 직후 한참 동안 앱에 아무것도 안 보이는 문제.

#### 1.3.2 MMIS 의 장점

`marine.kma.go.kr/mmis_marine_api/` 는 KMA 가 자기 자신의 해양기상정보포털
(MMIS — Marine Meteorological Information System) 을 운영하기 위해 내부적으로
쓰는 JSON API 다. SEAGNAL 은 이 endpoint 를 직접 호출해 다음 이점을 얻는다:

1. **구조화된 JSON** — 정규표현식 파싱 불필요. 필드명이 명확
   (`warn_tp`, `warn_lvl_nm`, `tm_ef`, `clr_ntc_tm` 등).
2. **부모 + 자식 동시 제공** — `warn/list`(부모) + `warn-sasc/list`(자식)
   가 같은 시점의 같은 모델 응답이라 동기화 문제가 사라진다.
3. **상태 단계가 endpoint 로 분리** — 예비는 `/ready`, 발효중은 `/list`,
   최신 통보문은 `/latest`. 폴링 방식이 단순.
4. **정확 시각** — 해제 통보문이 발행되면 `warn/latest` 의 `tm_ef` 가
   `"2026.05.23 01:00"` 같은 분 단위 정확값을 제공.
5. **빠른 갱신** — KMA 내부 시스템과 같은 데이터 소스이므로 통보문 HTML
   보다 먼저 반영됨.

비용:

- 자격증명이 필요한 endpoint 가 일부 있다(`warn/ef/list` 같은 timeline).
  비로그인으로도 4 개 실시간 endpoint 는 호출 가능(V9 정책).
- 비공식 endpoint 이므로 KMA 가 명세를 바꾸면 깨질 수 있다 → 단일 모듈
  (`services/marine_client.js`) 에 격리 + envelope 두 가지(`payload` / `data`)
  모두 흡수.

### 1.4 시스템 전체 상위 다이어그램

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              KMA 서버                                    │
│  marine.kma.go.kr/mmis_marine_api/v1/kma/                                │
│   ├─ warn/list       (현재 발효 부모)                                    │
│   ├─ warn/ready      (예비 부모+자식 혼재)                               │
│   ├─ warn/latest     (가장 최근 통보문 — 부모, 정확 해제시각 제공)        │
│   ├─ warn-sasc/list  (현재 발효 자식)                                    │
│   ├─ warn-sasc/ready (예비 자식)                                         │
│   ├─ warn-sasc/latest (자식 통보문)                                      │
│   └─ warn/ef/list    (인증 필요, timeline)                               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │ HTTPS GET (Node built-in https)
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  services/marine_client.js                                              │
│   - rate limit 게이트 (200 ms 간격)                                      │
│   - envelope 정규화 (payload | data → 행 배열)                          │
│   - fetchAllRealtimeEndpoints() — 4 endpoint Promise.allSettled         │
│   - 부분 실패 시 throw → run() 이 통째 skip (E-4 가드)                   │
│   - 인증: login/refresh-token/JWT 30분 (인증 endpoint 만)               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  marine_warning_crawler.js — 본체                                       │
│                                                                          │
│   매 1분 cron (scheduler.js:1605) → run()                               │
│                                                                          │
│   ① fetchAllRealtimeEndpoints() (E-4 가드)                              │
│   ② _buildSnapshotFromMarine() → curr StateSnapshot                     │
│   ③ _enrichSnapshotWithLatest() ← warn/latest + warn-sasc/latest        │
│     · 정확 해제시각 보강 (clr_ntc_tm)                                    │
│     · GAP 발표 발효대기 보강 (warn/list 에 없지만 통보문 있는 부모)        │
│     · 자식 해제 통보문 집합 (_childReleaseNoticeSet)                     │
│   ④ E-1 콜드부팅 가드 (isFirstLoad + empty prev 시 push skip)            │
│   ⑤ _applySuspiciousGuard() — D-medium 의심 가드                        │
│   ⑥ _applyChildReleaseDebounce() — 자식 글리치 3분 디바운스             │
│   ⑦ _applyAnnounceAnchor() — 발표시각 영구 고정                          │
│   ⑧ _applyReleaseClrLogic() — 해제예정 윈도우 hold/연장                  │
│   ⑨ _applyUpcomingEfLogic() — 발효예정 윈도우 hold/연장                  │
│   ⑩ _debounceTimeValues() — 시각 변경 3분 디바운스                       │
│   ⑪ _buildUserPushChanges(prev, curr) → changes[]                       │
│   ⑫ push_sender.processChanges(changes) → POST /api/push-custom         │
│   ⑬ _updateExtensionMemory(curr)                                         │
│   ⑭ _savePrevSnapshot(curr) → data/marine_warning_state.json            │
│   ⑮ _writeWeatherAlertsJson(prev, curr) → data/weather_alerts.json      │
└─────────────────────────────────────────────────────────────────────────┘
                │                                       │
                ▼                                       ▼
┌────────────────────────────┐         ┌───────────────────────────────────┐
│ routes/push.js             │         │ data/weather_alerts.json          │
│ POST /api/push-custom      │         │ (디스크 — 사용자 앱 폴링 대상)     │
│  - 구독자 필터 (해역·옵션)    │         └───────────────────────────────────┘
│  - generateMessage()        │                          │
│  - FCM admin.messaging()    │                          │ HTTP GET
│  - dead token 정리          │                          ▼
│  - history 기록             │         ┌───────────────────────────────────┐
└────────────────────────────┘         │ 프론트 (js/render.js,              │
                │                       │         render_coastal.js,         │
                ▼                       │         utils.js)                  │
        FCM/Web Push                    │  - 카드 렌더 (부모/자식)            │
                │                       │  - formatWarningTime               │
                ▼                       │  - 지도 폴리곤 색칠                 │
       사용자 모바일 트레이               └───────────────────────────────────┘
```

---

## 2. MMIS 데이터 모델

본 절은 본 문서의 핵심이다. 다른 에이전트들이 시나리오·UI·이력 측면을 더 깊이
다룰 것이므로, 1 번 에이전트는 **endpoint 별 정확한 역할·shape·필드·예외**
를 가장 자세히 다룬다.

### 2.1 endpoint 개요 (`services/marine_client.js:67~79`)

| Endpoint | 인증 | 역할 | 호출 시점 |
|----------|------|------|-----------|
| `warn/list` | 비로그인 | 현재 발효 중인 부모 zone | 매 1분 |
| `warn/ready` | 비로그인 | 예비 (부모+자식 혼재) | 매 1분 |
| `warn-sasc/list` | 비로그인 | 현재 발효 중인 자식 zone | 매 1분 |
| `warn-sasc/ready` | 비로그인 | 예비 자식 | 매 1분 |
| `warn/latest` | 비로그인 | 부모별 가장 최근 통보문 (해제·발표대기 포함) | 매 1분 |
| `warn-sasc/latest` | 비로그인 | 자식별 가장 최근 통보문 | 매 1분 |
| `warn/ef/list` | **로그인 필요** | 발효 timeline (영구 row) | 사용 안 함 (skip) |
| `warn/ntfctn/list` | **로그인 필요** | 통보문 목록 (이력) | 사용 안 함 |

> 현재 SEAGNAL 은 인증 endpoint 를 호출하지 않는다 — `MARINE_USER_ID/PWD` secrets
> 가 비어 있으면 `marine_client` 가 silent disable 하고 비로그인 6 endpoint
> 만으로 모든 운영 시나리오를 커버한다. `warn/ef/list` 는 과거에 timeline diff
> 보강용으로 고려되었으나 실시간 4+2 endpoint 만으로 충분함이 V10·V11 에서
> 검증되었다.

### 2.2 응답 envelope — 두 가지 형식이 혼재

KMA MMIS 는 endpoint 별로 응답 봉투(envelope) 형식이 다르다. 어떤 endpoint 는
`{ status: 200, payload: [...] }` 를 쓰고, 어떤 endpoint 는 `{ code: ..., data: [...] }`
를 쓴다. `services/marine_client.js:_unwrap` 이 둘 다 흡수:

```js
function _unwrap(j) {
    if (!j) return [];
    if (Array.isArray(j.payload)) return j.payload;
    if (Array.isArray(j.data)) return j.data;
    return [];
}
```

다운스트림은 항상 row 배열만 본다.

### 2.3 부모 응답 (`warn/list`) 의 row shape

전형적인 row (필드명·의미·예시) — `marine_warning_crawler.js:_rowToParentInfo` 에서
내부 상태 객체로 변환된다:

| MMIS 원본 필드 | 내부 키 | 의미 | 예시 |
|------|------|------|------|
| `warn_zone_cd` | (해석용) | 8자리 zone 코드 — 불변 식별자 | `S1311100` (부산앞바다), `S2120400` (울산앞바다중연안바다) |
| `warn_zone_nm` | (해석용 fallback) | KMA 표기 zone 이름 — 일부 축약·공백 차이 | `'부산앞바다'`, `'남해서부 동쪽'` |
| `warn_tp` | `wrnTp` | 특보 종류 코드 | `'V'`=풍랑, `'T'`=태풍, `'W'`=강풍, `'O'`=폭풍해일 |
| `warn_tp_nm` | `wrnTpNm` | 특보 종류 한글 | `'풍랑'`, `'태풍'` |
| `warn_lvl` | `wrnLvl` | 등급 코드 | `'2'`=주의보, `'5'`=경보, `''`=예비/해제 |
| `warn_lvl_nm` | `wrnLvlNm` | 등급 한글 | `'주의보'`, `'경보'`, `'예비특보'` → `'예비'` 로 정규화 |
| `tm_fc` | `tmFc` | **발표시각** (통보문 발행 시각) | `'2026.05.23 04:30'` 또는 12자리 `'202605230430'` |
| `tm_ef` | `tmEf` | **발효시각** (특보가 효력 시작) | 예비면 미래, 발효중이면 이미 지난 시각 |
| `tm_yn` | `tmYn` | 효력 종료 시각 (개념상 ed_tm) | 일부 row 만 채워짐 |
| `clr_ntc_tm` | `clrNtcTm` | **해제예고시각** — 발효 중에 "이때 해제될 예정" 등록 | `'23일 3시 ~ 6시'` (범위형) 또는 `'2026.05.23 01:00'` (정확) |
| `st_tm`, `ed_tm` | fallback | 일부 응답에서 tm_ef/tm_yn 대신 사용 | |

KMA 가 같은 시각을 표현하는 형식이 **다섯 가지** 정도 혼재한다:

1. `"2026.05.23 04:00"` — 정확 (점 구분)
2. `"2026-05-23 04:00"` — 정확 (대시 구분)
3. `"202605230400"` — 12자리 정확
4. `"23일 03시~06시"` — 범위형 (해제예고 6시간 블록)
5. `"23일"` — 시각 미지정 (드물지만 등장)

이를 모두 통일하는 게 `_timeKey()`·`normalizeMmisTime()`·`formatWarningTime()`·
`formatWarnTimeKST()` 들의 임무이며, 각각이 다음 4 군데에 흩어져 있다:

- `marine_warning_crawler.js:1102` `_timeKey` — 비교용 정수키 변환
- `marine_warning_crawler.js:1799` `normalizeMmisTime` — JSON 출력용 한글 형식
- `local_server/js/utils.js:118` `formatWarningTime` — 프론트 표시용
- `local_server/services/push_helpers.js:34` `formatWarnTimeKST` — 푸시 메시지용

### 2.4 KMA 레거시 인코딩 — "분 = 58/59" 이 6시간 범위 코드

본 통합의 가장 골치 아픈 발견. 원본 KMA 데이터에는 다음과 같은 시각이 등장한다:

```
"2026.06.01 05:58"   ← 분이 58
"2026.06.01 11:59"   ← 분이 59
"202606010558"        ← 12자리 형식에서도 같은 패턴
```

이는 분 단위 정확값이 아니라, **"이 시각이 속한 6시간 블록"** 을 의미하는
레거시 KMA 인코딩이다. 매핑은:

| 시(hour) 구간 | 분이 58/59 일 때 의미 |
|--------------|--------------------|
| 00시 ≤ h < 06 | `00시~06시` |
| 06 ≤ h < 09 | `06시~09시` |
| 09 ≤ h < 12 | `09시~12시` |
| 12 ≤ h < 18 | `12시~18시` |
| 18 ≤ h ≤ 23 | `18시~24시` |

따라서 `"2026.06.01 05:58"` 는 "정확히 6월 1일 5시 58분" 이 아니라
"6월 1일 새벽 시간대(00시~06시)" 를 의미한다. 이를 분 단위 정확값으로 표시하면
사용자에게 잘못된 정보가 전달된다(예: "오늘 05시 58분에 해제 예정" 으로 푸시되지만
실제는 "오늘 새벽 사이 언젠가 해제 예정").

해당 정책은 commit `8a9a798` (점·대시 형식) → `b786ece` (한글 형식 + normalize
단계까지 보강) 으로 4 군데 모두 동기 적용되었다.

### 2.5 자식 응답 (`warn-sasc/list`) 의 row shape

자식 응답은 부모 응답과 **거의 같은 스키마** 를 사용한다.
다른 점은 zone 코드 패턴이 `S2…` (평수구역) 또는 `S2…00` 형태이고,
`warn_zone_nm` 이 `"부산앞바다중연안바다"` 처럼 부모명 + `중` + 자식명
구조를 띤다는 것이다.

자식 row 도 자기 자신의 `tm_fc`, `tm_ef`, `tm_yn`, `clr_ntc_tm` 을 가진다.
**자식 시각은 부모 시각과 다를 수 있다** — 같은 부모 zone 안에서도 자식별로
발효예정·해제예정 시각이 다르게 잡힐 수 있다.

> 과거 D-6 (B) 시점에는 "자식 응답에 시간 필드가 없으니 부모에서 fallback 하자"
> 는 가정으로 코드를 작성했었다. 실측 결과 그것이 틀렸음이 확인되어
> commit `3705f4a` 에서 부모 종속 제거 — "모든 자식 표출 필드는 자식 자신의
> 데이터에만 기인한다" 가 현재 원칙이다.

#### 자식 → 부모 추출

`_extractParent()` (`marine_warning_crawler.js:1985`) 가 `'중'` 의 마지막 위치
기준으로 부모/자식을 분리:

```
'부산앞바다중연안바다' → '부산앞바다' + '연안바다'
'경남서부남해앞바다중남해군연안바다' → '경남서부남해앞바다' + '남해군연안바다'
'천수만평수구역' → (분리 안 됨) → '천수만평수구역' (= 부모로 취급)
```

### 2.6 zone 코드 → 정식 해역명 매핑

MMIS 의 `warn_zone_nm` 은 일부 zone 을 축약한다(`'남해서부 동쪽'` 등). 이를
앱의 정식 명칭과 매칭하려면 `warn_zone_cd` (8자리 코드) 를 거쳐야 한다.
`MMIS_CODE_TO_NAME` (`marine_warning_crawler.js:115~209`) 가 93 개 코드를
정식명으로 매핑한다(2026년 4월 mmis archive ef2 1년치로 추출).

`_resolveZoneName()` (`marine_warning_crawler.js:215~220`) 이 row 의 zone 명을
해석:

```js
function _resolveZoneName(row) {
    const cd = row.warn_zone_cd;
    if (cd && MMIS_CODE_TO_NAME[cd]) return MMIS_CODE_TO_NAME[cd];
    return (row.warn_zone_nm || row.kor_nm || '').trim().replace(/\s+/g, '');
}
```

특수 케이스:
- `S2211100` → `'인천·경기남부앞바다중먼평수구역'` — KMA 표기 `'인천경기...'`
  에는 `·` 가 없지만 SEAGNAL 은 `·` 가 포함된 정식 명칭을 사용. 코드 매핑이
  이 표기 차이를 보정.
- `S2212200` → `'태안·서산북쪽평수구역'` — 동일 이유로 보정.

### 2.7 예비 응답 (`warn/ready`) — 부모/자식 혼재

`warn/ready` 응답은 **하나의 array 안에 부모 row 와 자식 row 가 섞여** 들어온다.
이를 `_buildSnapshotFromMarine` (`marine_warning_crawler.js:2073~2129`) 가
`_extractParent` 로 다시 분류한다:

```js
for (const row of (warnReady || [])) {
    ...
    const name = _resolveZoneName(row);
    const parent = _extractParent(name);
    if (parent === name) {
        // 부모 row
        if (snap.parents.has(name)) {
            // 이미 발효중 — 예비를 upcomings 에 따로 보관 (병렬 표출)
            snap.upcomings.set(name, _rowToParentInfo(row));
            continue;
        }
        snap.parents.set(name, _rowToParentInfo(row));
    } else {
        // 자식 row
        addChild(name, row);
    }
}
```

### 2.8 `warn/latest` — 정확 해제시각·GAP 보강의 핵심

V10 (commit `dbe2c6b`) 에서 추가된 endpoint. `warn/list` 의 "현재 발효 상태"
만으로는 다음 두 가지가 불가능했다:

1. **정확 해제시각** — `warn/list` 의 `clr_ntc_tm` 은 "23일 3시 ~ 6시" 같은
   범위형이라 정확하지 않음. 해제 통보문이 발행된 직후 `warn/latest` 의 행에는
   `warn_cmd_nm = '해제'` + `tm_ef = '2026.05.23 01:00'` 식으로 분 단위 정확값
   이 들어 있다.
2. **GAP (발표 발효대기)** — 통보문은 발행됐지만 발효시각이 아직 미래라
   `warn/list` (현재 발효) 에도 `warn/ready` (예비) 에도 안 들어가는 중간 상태.
   `warn/latest` 의 `warn_cmd_nm = '발표'/'변경'/'연장'` + 미래의 `tm_ef`
   조합으로 잡힌다. 자세한 처리는 §4.14.

#### `warn/latest` 응답의 `warn_cmd_nm` 값

- `'발표'` — 신규 발표 통보문
- `'변경'` — 발효시각·해제시각 변경
- `'연장'` — 효력 연장
- `'해제'` — 해제 통보문
- `'변경해제'` — 드물지만 한 통보문에 변경+해제가 같이 (현재는 publish 계열로만 처리)

### 2.9 `warn-sasc/latest` — 자식 통보문 (수정A-3, commit `0049f2a`)

부모 `warn/latest` 의 자식 판. 각 자식의 개별 `warn_tp/warn_cmd_nm/tm_ef/clr_ntc_tm`
을 제공한다. 두 가지 목적으로 쓰인다:

1. **자식 GAP 보강** — `warn-sasc/list` 에 아직 없지만 통보문은 발행된 자식
   (발표 발효대기) 을 예비 자식으로 미리 표출. 부모 zone 의 자식 3 개 중 2 개만
   발표된 경우 등 부분집합을 정확히 반영.
2. **자식 해제 통보문 집합(`_childReleaseNoticeSet`)** — `warn_cmd_nm = '해제'`
   인 자식 fullName 을 모은 Set. 이 집합에 들어있는 자식이 사라지면 "정상 해제"
   로 즉시 인정(디바운스 면제). 집합에 없는데 사라지면 글리치 의심 → 3 분
   디바운스. `_applyChildReleaseDebounce` 가 이 신호를 본다 (§4.13).

### 2.10 어떤 사건이 어떤 endpoint 에 어떻게 반영되나

매트릭스 — 한 zone 의 lifecycle 동안 endpoint 별 반영:

| 사건 | warn/list | warn/ready | warn/latest | warn-sasc/list | warn-sasc/ready | warn-sasc/latest |
|------|:--------:|:---------:|:-----------:|:-------------:|:--------------:|:----------------:|
| 예비특보 발표 (st_tm < now < tm_ef) | — | **+row** | +row (cmd=발표) | — | (자식 있으면 +row) | (자식 있으면 +row) |
| 발표 발효대기 (통보문은 났는데 발효 전) | — | — | **+row (cmd=발표, future tm_ef)** | — | — | (자식 있으면 +row) |
| 발효시각 도래 (예비 → 주의보 발효) | **+row** | -row | +row (cmd=발효 or 마지막 발표 유지) | (자식이 있으면 +row) | -row | +row |
| 등급 격상 (주의보 → 경보) | row.warn_lvl 변경 | — | +row (cmd=변경 or 발표) | (자식 동반 시) | — | +row |
| 종류 변경 (풍랑 → 태풍) | row.warn_tp 변경 | — | +row | — | — | — |
| 해제예고 등록 | row.clr_ntc_tm 추가 | — | (변경 통보문은 +row) | (자식 동반 시 추가) | — | — |
| 해제예고 변경 | row.clr_ntc_tm 갱신 | — | +row (cmd=변경/연장) | — | — | — |
| 해제 (tm_yn 도래) | **-row (사라짐)** | — | **+row (cmd=해제, 정확 tm_ef)** | -row | — | +row (cmd=해제) |
| 자식 일부 해제 | (부모는 유지) | — | — | -해당 row | — | +row (cmd=해제) |
| MMIS 일시 장애 | -row (혹은 빈 응답) | -row | -row | -row | -row | -row |

이 매트릭스를 보면, **"한 endpoint 만 봐서는 진실을 알 수 없다"** 는 게
명확하다. 특히:

- 해제는 `warn/list` 에서 사라지는 것 + `warn/latest` 의 해제 통보문 = 둘 다
  봐야 정확 시각을 얻는다.
- GAP 은 `warn/latest` 가 유일한 단서.
- 자식 글리치 vs 진짜 해제는 `warn-sasc/latest` 의 해제 통보문 유무로 구분.
- MMIS 부분 장애는 4 개 endpoint Promise.allSettled 로 통째 skip (E-4 가드).

### 2.11 그 외 KMA 레거시 인코딩 함정

- `tmEf = '0'` 또는 `'000000000000'` — 데이터 없음 표시. `formatWarningTime` 이
  `'정보 없음'` 반환.
- `tmEf = '일'` 한 글자 — 깨진 데이터. `formatDate` 가 `'정보 없음'` 반환.
- HTML 엔티티 `&#40;`, `&#41;`, `&nbsp;` 가 시각 문자열 안에 섞여 있을 때가
  있어 모든 파서가 먼저 디코딩.
- `tm_yn` 과 `clr_ntc_tm` 은 자주 같은 값이지만 의미상 구분된다 — `tm_yn` 은
  "이론적 해제예정", `clr_ntc_tm` 은 "예보관이 등록한 해제예고". 둘 중 후자가
  우선이며 후자가 비어 있을 때 전자가 fallback.

---

## 3. 데이터 흐름

### 3.1 매 1 분 cron 진입

`scheduler.js:1515` 의 `setInterval(async () => { ... }, 60000)` 안에서:

```js
if (!crawlPaused) {
    log('🌊 marine.kma 통합 크롤러 실행...');
    marineWarningCrawler.run().catch(err => log(`⚠️ [marine] 크롤러 오류: ${err.message}`));
}
```

`crawlPaused` 는 admin UI 에서 토글 가능한 플래그. 점검 모드 등에서 사용.

### 3.2 `run()` 한 사이클 (`marine_warning_crawler.js:2376~2529`)

전체 흐름 (15 단계):

```
async function run(opts = {}) {
    if (_runInProgress) return [];          // 중복 실행 방지
    _runInProgress = true;
    try {
        const isFirstLoad = (_prevSnapshot === null);
        if (isFirstLoad) _prevSnapshot = _loadPrevSnapshot();    // 디스크 복원

        // ① 4 endpoint fetch (E-4 가드)
        let fetched;
        try {
            fetched = await marineClient.fetchAllRealtimeEndpoints();
        } catch (err) {
            console.warn('[Marine] endpoint 부분 실패 — cycle skip ...');
            return [];
        }

        // ② curr snapshot 구축 (V11 — 발효+예비, allowlist V/T)
        const curr = _buildSnapshotFromMarine(
            fetched.warnList, fetched.warnSascList,
            fetched.warnReady, fetched.warnSascReady
        );

        // ③ warn/latest + warn-sasc/latest 로 정확시각·GAP·자식해제통보문 보강
        try {
            const [warnLatest, warnSascLatest] = await Promise.all([
                marineClient.fetchWarnLatest(),
                marineClient.fetchWarnSascLatest().catch(() => [])
            ]);
            _enrichSnapshotWithLatest(curr, warnLatest, _prevSnapshot, warnSascLatest);
        } catch (e) { ... }

        // ④ E-1 콜드부팅 가드 — isFirstLoad + prev empty 시 push skip
        const forceBaseline = !!opts.forceBaselinePush || _forceBaselinePending;
        if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
            _prevSnapshot = curr;
            _savePrevSnapshot(curr);
            _writeWeatherAlertsJson(new StateSnapshot(), curr);
            return [];
        }
        _forceBaselinePending = false;

        // ⑤ D-medium 의심 가드
        const prevForDiff = _prevSnapshot;
        _applySuspiciousGuard(prevForDiff, curr);

        // ⑥ 자식 해제 디바운스 3분
        _applyChildReleaseDebounce(prevForDiff, curr);

        // ⑦ 발표시각 anchor
        _applyAnnounceAnchor(prevForDiff, curr);

        // ⑧ 해제예정 윈도우 hold/연장
        _applyReleaseClrLogic(prevForDiff, curr);

        // ⑨ 발효예정 윈도우 hold/연장
        _applyUpcomingEfLogic(prevForDiff, curr);

        // ⑩ 시각변경 3분 디바운스
        _debounceTimeValues(curr);

        // ⑪+⑫ 사용자 푸시 발사
        if (!opts.dryRun && pushSender) {
            const userChanges = _buildUserPushChanges(prevForDiff, curr);
            const userOpts = opts.adminToken ? { adminToken: opts.adminToken } : {};
            await pushSender.processChanges(userChanges, userOpts);
        }

        // ⑬ 연장 메모리 갱신
        _updateExtensionMemory(curr);

        // ⑭ prev 디스크 저장
        _prevSnapshot = curr;
        _savePrevSnapshot(curr);

        // ⑮ weather_alerts.json 갱신
        _writeWeatherAlertsJson(prevForDiff, curr);

        return sent;
    } finally {
        _runInProgress = false;
    }
}
```

### 3.3 `StateSnapshot` 자료 구조

핵심 자료 구조 — 한 사이클의 "지금 무엇이 발효/예비 중인가" 의 정규형.

```js
class StateSnapshot {
    parents:   Map<parentName, { wrnTp, wrnTpNm, wrnLvl, wrnLvlNm, tmFc, tmEf, tmYn, clrNtcTm }>
    children:  Map<parentName, Map<childFullName, { ...같은 shape }>>
    upcomings: Map<parentName, { ...같은 shape }>  // 발효중인 zone 의 공존 예비
}
```

- `parents` 키: 부모 zone 정식명 (`'부산앞바다'` 등)
- `children` 키: 부모명. 그 값은 다시 `자식 fullName → info` Map.
- `upcomings`: B 트랙 — 이미 부모가 발효 중인데 별도 예비 통보문이 등록된 경우
  ("발효 + 다가오는 예비 병렬 표출", commit `5213c83`).

JSON 직렬화·역직렬화 (`StateSnapshot.fromJSON/toJSON`) 가 있어
`data/marine_warning_state.json` 으로 영속화 가능.

### 3.4 7 단계 가드/홀드/디바운스의 의미

⑤ ~ ⑩ 단계는 각각 다른 "노이즈/오류" 를 막는다. 한 사이클 안에서 순서대로:

| 단계 | 함수 | 역할 | 막는 대상 |
|-----|------|------|----------|
| ⑤ | `_applySuspiciousGuard` | clr_ntc_tm 없이 3+ zone 사라지면 prev 정보로 복원 | MMIS 빈 응답 → release 폭주 |
| ⑥ | `_applyChildReleaseDebounce` | 자식이 해제예고 없이 사라지면 3분 carry | 자식 글리치 깜빡임 |
| ⑦ | `_applyAnnounceAnchor` | tmFc 를 현재 발효 등급의 최초 발표시각으로 고정 | 변경/연장 시 발표시각이 흔들리는 것 |
| ⑧ | `_applyReleaseClrLogic` | clrNtcTm: 윈도우 안=정확값 고정, 윈도우 초과=연장 플래그 | 범위↔정확 깜빡임 → 가짜 시각변경 푸시 |
| ⑨ | `_applyUpcomingEfLogic` | 예비 tmEf: 위와 동일 정책의 발효시각판 | 발효시각 범위↔정확 깜빡임 |
| ⑩ | `_debounceTimeValues` | 새 tmEf/clrNtcTm 값이 3분 유지될 때만 확정 | 잔여 진동 (A→B→A) |

순서가 중요하다. ⑤(가드) → ⑥(자식) → ⑦(앵커) → ⑧·⑨(윈도우) → ⑩(디바운스) →
diff. 이 순서가 깨지면 각 단계의 가정이 무너진다.

### 3.5 `_buildUserPushChanges` (`marine_warning_crawler.js:1296~1555`)

prev vs curr 의 zone 별 변화를 `push_sender` 가 이해하는 change array 로 변환한다.
출력 타입은 다음 8 가지:

| change.type | 의미 | 부가 필드 |
|-------------|------|-----------|
| `UPCOMING_CHANGE` | 예비 블록 변화 (발표·변경·취소) | prev, curr, currentActive, childState |
| `CURRENT_CHANGE` | 발효 블록 변화 (발효·격상격하·해제·시각변경) | prev, curr, childState |
| `EF_EXTEND` | 발효예정 범위→더 늦은 범위 연장 | curr, oldTime, newTime |
| `YN_EXTEND` | 해제예정 범위→더 늦은 범위 연장 | curr, oldTime, newTime |
| `CHILD_ADD` | 자식만 추가 (부모 불변) | curr, childState |
| `CHILD_RELEASE` | 자식만 일부 해제 (부모 불변) | prev, childState |
| `CHILD_EF_EXTEND` | 자식 단독 발효예정 연장 | curr, oldTime, newTime, childState.extended |
| `CHILD_YN_EXTEND` | 자식 단독 해제예정 연장 | curr, oldTime, newTime, childState.extended |

`push_sender.processChanges` 가 각 타입을 보고 `templateId` 로 분류하여 그룹핑·
발송한다 (§3.7).

### 3.6 `push_sender.processChanges` → `/api/push-custom`

`push_sender.js:processAndSendNotifications` 는 changes 를 받아:

1. 점검 모드 체크 (`MAINTENANCE_FILE`) — 활성이면 발송 중단.
2. changes 를 templateId 로 그룹핑(같은 종류·등급은 한 그룹) — `addToGroup`.
3. 그룹마다 `sendToApi(payload)` 호출 — 자기 자신의 localhost:3001/api/push-custom 으로
   POST.
4. 발송 실패 그룹은 `data/pending_pushes.json` 에 저장 → 다음 사이클에서 재시도.

`templateId` 종류 (`push_sender.js` 의 `addToGroup` 호출 기준):

- `publish` — 신규 예비 발표
- `active` — 신규 발효
- `release` — 부모+자식 동시 해제
- `level_upgrade_publish`, `level_upgrade_active` — 예비/발효 단계의 격상
- `level_downgrade_publish`, `level_downgrade_active` — 격하
- `time_ef_change` — 발효시각 변경
- `time_yn_change` — 해제시각 변경
- `additional_active` — 자식 추가 발효
- `partial_release` — 자식 일부 해제
- `ef_extend`, `yn_extend` — 시각 연장

### 3.7 `/api/push-custom` 라우트 (`routes/push.js:240~`)

각 사용자 구독자에 대해:

1. **마스터 토글 체크** — `user.options.master === false` 면 skip.
2. **해역 교집합** — `getMatchedZones(user.zones, payload.items, user.options)` 로
   사용자가 구독한 해역(대/중/소분류 혼재)을 소분류로 확장 후 교집합.
3. **자식 토글** — `user.options.childZones === false` 면 부모명 옆 한정사
   `(연안바다 포함)` 등을 안 붙임.
4. **메시지 생성** — `generateMessage(payload)` 가 templateId 별 다른 본문 생성.
5. **시나리오 토글** — `opts.announce/active/release/night` 등 사용자별 세부 토글.
6. **야간 토글** — `KST 23:00 ~ 07:00` 발송 차단.
7. **FCM/Web Push 전송** — `admin.messaging().send` 또는 `webpush.sendNotification`.
8. **dead token 정리** — `messaging/registration-token-not-registered` 등 에러
   시 `_isDead` 마킹 → 사이클 끝에 `push_subscriptions.json` 에서 제거.
9. **history 기록** — `custom_push_history.json` 에 1 row 추가.

### 3.8 `_writeWeatherAlertsJson` — 프론트 표출 데이터

매 사이클 끝에 `data/weather_alerts.json` 갱신:

```json
{
  "updatedAt": "2026. 06. 01. 오후 10:35:42",
  "lastReportId": "<옛 통보문 ID, 보존>",
  "processedReportIds": [...],
  "pendingRetries": {...},
  "oneTimeBulletinWindowOverride": null,
  "previous": {  // prev StateSnapshot → zone tree
    "동해": { "동해남부해상": { "동해남부앞바다": { "울산앞바다": {
      "current": null, "upcoming": null, "history": [], "children": {...}
    }}}}
  },
  "current": { /* curr StateSnapshot → zone tree */ }
}
```

- skeleton (4 sea — 해상 — 앞바다 — leaf) 는 `_createZoneSkeleton`
  (`marine_warning_crawler.js:1643~1738`) 가 만든다.
- 각 leaf 의 `current`·`upcoming` 은 toBlock 변환된 부모 정보, `children` 은
  자식 정보. 시각은 `normalizeMmisTime()` 으로 한글화.
- `history` 는 디스크 기존 값 보존(`_collectLeafZonesByName` 으로 머지).
- atomic write (`tmp → rename`) 로 부분 쓰기 race 방지.

### 3.9 프론트 폴링 (`local_server/js/data.js` + `render*.js`)

프론트는 `/api/weather-alerts` (서버는 weather_alerts.json 캐시 응답) 를 일정
간격으로 polling 하여 `appState.alerts` + `appState.coastalAlerts` 에 반영.
`render.js:renderApp` 가 부모 카드, `render_coastal.js` 가 자식 카드를 그린다.
시간 표시는 `formatWarningTime` (utils.js:118) 호출.

---

## 4. 시나리오별 동작

본 절은 22 케이스를 다룬다. 각 케이스: **입력 데이터 → 처리 단계 → 푸시 종류 →
표시 형식**.

### 4.1 신규 예비특보 발표 (publish)

**입력**: `warn/ready` 응답에 새 row 등장 — `warn_zone_cd=S1311100`(부산앞바다),
`warn_tp='V'`, `warn_lvl_nm='예비특보'`, `tm_ef='2026.06.02 12:00'`, `tm_fc='2026.06.01 09:30'`.

**처리**:
1. `_normLvlNm('예비특보') → '예비'`.
2. `_isTargetRealtimeType('V')` 통과.
3. `_resolveZoneName` → `'부산앞바다'`.
4. `snap.parents.set('부산앞바다', {wrnTpNm: '풍랑', wrnLvlNm: '예비', tmEf: '...', ...})`.
5. `DiffMatrix.compute`: `pPrev=null, pCurr=풍랑예비` → `publish` bucket.
6. `_buildUserPushChanges`: prevUpcoming=null, currUpcoming=풍랑예비 → `UPCOMING_CHANGE`.
7. `push_sender`: prev=null + currLvl='예비' → templateId=`publish`.

**푸시** (자식 토글 ON 사용자):
```
📢 풍랑 주의보 발표
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 발효예정 : 6월 2일(내일) 12시
```

(주의: 예비는 본문에서 `effectiveLevel = '주의보'` 로 보정해 표시 —
`push_helpers.js:285`).

**표시** (앱 카드): 부산앞바다 카드 좌하단에 "📢 다가오는 풍랑 주의보 — 6월 2일 12시 발효 예정"
배지. weather_alerts.json 의 `current['부산앞바다'].upcoming` 채워짐.

### 4.2 예비 → 발효 전이 (active)

**입력**: 직전 prev 에 `'부산앞바다' = 풍랑/예비`, curr 에 `'부산앞바다' = 풍랑/주의보`.

**처리**:
1. `DiffMatrix.compute`: `pPrev.wrnLvlNm === '예비'` && `pCurr.wrnLvlNm === '주의보'`
   → 점수 동률(예비=2, 주의보=2)이라 격상으로 가지 못함. 별도 분기
   (`marine_warning_crawler.js:413~420`) 가 `active` bucket 으로.
2. `_buildUserPushChanges`: prevActive=null, currActive=풍랑주의보 → `CURRENT_CHANGE`.
3. `push_sender`: prev=null + curr=풍랑주의보 → templateId=`active`.
4. `_applyAnnounceAnchor`: 직전 cycle 의 예비 tmFc (또는 `_extensionMemory.upcoming.tmFc`)
   를 이어받아 `info.tmFc` 고정 → 푸시 본문의 발효시각이 흔들리지 않음.

**푸시**:
```
🚨 풍랑 주의보 발효
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 해제예정 : 미정
```

### 4.3 발효중 등급 변경 (격상 — level_upgrade_active)

**입력**: prev `풍랑/주의보` → curr `풍랑/경보` (같은 zone, 같은 종류).

**처리**:
1. `DiffMatrix.compute`: `pScore=12 (풍랑+주의보)`, `cScore=15 (풍랑+경보)`,
   `cScore > pScore` && `pCurr.wrnLvlNm !== '예비'` → `level_upgrade_active` bucket.
2. `_buildUserPushChanges`: `currActive.wrnLvl !== prevActive.wrnLvl` →
   `CURRENT_CHANGE`.
3. `push_sender`: prev=주의보, curr=경보 → templateId=`level_upgrade_active`.

**푸시**:
```
🚨 풍랑 주의보→경보 격상 발효
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 해제예정 : 미정
```

### 4.4 예비 단계 등급 변경 (level_upgrade_publish)

**입력**: prev `풍랑/예비` (그러나 격상은 별도 통보문으로 등급 변경 가능),
curr 에서 `warn_lvl_nm` 이 다른 값으로.

⚠️ 실측상 예비 단계에서 등급이 변하는 케이스는 드물지만 `DiffMatrix.compute`
의 `level_upgrade_publish`/`level_downgrade_publish` bucket 이 그를 처리한다.

### 4.5 종류 변경 (type_upgrade_publish/active)

**입력**: prev `풍랑/경보` → curr `태풍/경보` (등급은 같고 종류만 변경).

**처리**:
1. `_score`: `pScore=15 (풍랑경보), cScore=105 (태풍경보)`, `typeChanged=true`,
   `cScore !== pScore` → `type_upgrade_active` bucket
   (`marine_warning_crawler.js:429~441`).
2. `_buildUserPushChanges`: `currActive.wrnTp !== prevActive.wrnTp` (블록 비교 후)
   → `CURRENT_CHANGE`.
3. `push_sender`: 종류 변경은 등급 변경 분기와 별도로 처리되지 않고 일반
   `CURRENT_CHANGE` 의 `level_upgrade_active` 와 비슷한 코드 경로를 탄다
   (실제 메시지는 push_helpers `buildAdminTitle` 의 `type_upgrade_*` 가 처리).

**푸시(관리자)**:
```
🚨 풍랑경보→태풍경보 격상 발효
ㅇ부산앞바다(연안바다 포함)
   - 해제예정 : 미정
```

> 사용자 채널(push_sender + generateMessage)에는 종류 변경 전용 분기가 없고
> `level_upgrade_active` 분기로 fallback 한다. 관리자 채널이 비활성 (`ADMIN_PUSH_ENABLED = false`)
> 이라 현재는 사실상 사용자 채널만 동작한다.

### 4.6 해제예고 등록 (clrNtcTm 신규 추가)

**입력**: prev `풍랑/주의보, clrNtcTm=''` → curr 에서 `clr_ntc_tm = '23일 3시~6시'` 추가.

**처리**:
1. `DiffMatrix.compute`: `pPrev.clrNtcTm !== pCurr.clrNtcTm` && `!setChanged` →
   `time_yn_change` bucket.
2. `_buildUserPushChanges`: `currActive.tmYn` (= clrNtcTm fallback) 가 prev 와
   달라짐 → `CURRENT_CHANGE`.
3. `_debounceTimeValues`: 새 값이 3 분 안에 안정화돼야 확정. 그렇지 않으면 prev
   값으로 되돌려 푸시 억제.
4. `push_sender`: templateId=`time_yn_change`.

**푸시**:
```
🕐 해제시각 변경
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 해제예정 : 6월 23일(내일) 새벽(03시~06시)
```

### 4.7 해제 (정상 — release)

**입력**: prev `풍랑/주의보` 존재 → curr 에서 해당 zone 사라짐 +
`warn/latest` 에 `cmd='해제', tm_ef='2026.05.23 01:00'` 행이 있음.

**처리**:
1. `_enrichSnapshotWithLatest`: snap.parents 에 해당 zone 이 없으므로 (사라졌으므로)
   해제 행은 무시되지 않고 그냥 새 정보가 안 추가. (보강은 발효중인 zone 한정)
2. `_applySuspiciousGuard`: 해제예고가 등록되어 있었으면 `normalReleases` 에 분류
   → 정상 해제 인정. 없었으면 `suspiciousZones` → 의심 가드 발동 (§4.10).
3. `DiffMatrix.compute`: `pPrev && (!pCurr || pCurr.wrnLvlNm === '해제')` →
   `release` bucket (`marine_warning_crawler.js:393~407`).
4. `_buildUserPushChanges`: prevActive=풍랑주의보, currActive=null →
   `CURRENT_CHANGE` (`curr=null`).
5. `push_sender`: `!curr` 분기 → templateId=`release`.

**푸시**:
```
✅ 풍랑 주의보 해제
ㅇ부산앞바다
```

(해제는 자식 한정사 없음 — `buildChildQualifier` 가 `release` 일 때 `''` 반환,
`push_helpers.js:548`.)

### 4.8 해제예고 없이 사라짐 (D-medium 의심 가드)

**입력**: prev 에 3 개 이상 zone 이 `clrNtcTm=''` 인 채로 발효중 → curr 에서
일제히 사라짐.

**처리**:
1. `_classifyReleases`: 3 개 모두 `info.clrNtcTm` 없음 → `suspiciousZones` 분류.
2. `_applySuspiciousGuard`: `suspiciousZones.length >= 3` →
   - `_suspiciousState.currentCase` 생성 (case ID = `20260601-1035`).
   - prev 정보를 curr 에 복원(parents/children/upcomings 전부) — 다음
     diff 단계에서 release 가 발사되지 않음.
   - `_enqueueSuspiciousAlert` 호출 (현재는 `ADMIN_PUSH_ENABLED=false` 라 noop).
3. 다음 사이클들에서 zone 이 계속 안 보이면 10분마다 재푸시 — 관리자 결정
   대기.
4. 관리자가 admin UI 에서 `decision='normal'` 결정 →
   `_enqueueImmediateRelease(case.zones)` → release 푸시 즉시 발사 +
   prev 에서 해당 zone 제거.
5. 관리자가 `decision='invalid'` 결정 → currentCase 유지, 10분 카운터만 리셋.
6. MMIS 회복(zone 재등장 또는 의심 zone 수 미달) → 자동 reset, history 에 기록.

**디스크 영속화**: `data/marine_suspicious_state.json` (재배포 후에도 currentCase 보존).

### 4.9 발효예정시각 변경 (time_ef_change, 3분 디바운스)

**입력**: prev 예비 `tmEf='2026.06.02 12:00'` → curr `tmEf='2026.06.02 15:00'`.

**처리**:
1. `_applyUpcomingEfLogic`: 윈도우(범위)가 없으면 정확값 고정만 유효.
2. `_debounceTimeValues`: 새 값이 3분 안 유지되면 확정 안 되고 prev 값으로 되돌림.
3. `DiffMatrix.compute`: `pPrev.tmEf !== pCurr.tmEf` && `!setChanged` →
   `time_ef_change` bucket. (자식 set 변화 동시 발생 시 그것 우선 — Major-3 정책)
4. `_buildUserPushChanges`: `prevUpcoming.tmEf !== currUpcoming.tmEf` →
   `UPCOMING_CHANGE`.
5. `push_sender`: prev/curr 같은 등급 + 시각만 다름 → templateId=`time_ef_change`
   (`push_sender.js:144`).

**푸시** (3분 후 확정 시):
```
🕐 발효시각 변경
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 발효예정 : 6월 2일(내일) 15시
```

### 4.10 해제예정시각 변경 (time_yn_change)

§4.6 과 동일 메커니즘. 발효 중 zone 의 `clr_ntc_tm` 변경 시.

### 4.11 발효예정 연장 (EF_EXTEND, 범위→더 늦은 범위)

**입력**: prev 예비 `tmEf='2일 12시~18시'` (범위) → curr `tmEf='2일 18시~24시'` (더 늦은 범위).

**처리**:
1. `_isRangeTime` 둘 다 true.
2. `_timeKey` 계산: 범위형은 끝 시각 사용 (`rangeUseStart=false`). 이전 키 < 새 키.
3. `_buildUserPushChanges` 의 `efExtend` 분기 (`marine_warning_crawler.js:1397~1426`):
   `bothRange && kn > ko && sameType && sameLevel` → `EF_EXTEND` change.
4. `push_sender`: templateId=`ef_extend`.

**푸시**:
```
🕐 풍랑 주의보 발효 예정시각 연장
ㅇ부산앞바다(평수구역/연안바다 미발효)
   - 기존 : 6월 2일(내일) 12시~18시
   - 변경 후 : 6월 2일(내일) 18시~24시
```

⚠️ **연장은 "범위형 → 더 늦은 범위형" 일 때만** (commit `2866fe0`). 정확시각으로
바뀌면 연장이 아니라 시각 변경(time_ef_change) 로 분류. 같은 등급일 때만 연장
(등급이 다르면 격상/격하 — commit `b411cea`).

### 4.12 해제예정 연장 (YN_EXTEND)

§4.11 과 동일하지만 발효 단계 + `clr_ntc_tm` 대상. `_applyReleaseClrLogic` 가
윈도우 추적, `_buildUserPushChanges` 가 `ynExtend` 분기.

### 4.13 자식 추가 발효 (CHILD_ADD → additional_active)

**입력**: prev `'부산앞바다' = {children: [부산앞바다중연안바다]}` → curr 가
`[부산앞바다중연안바다, 부산앞바다중동부평수구역]` (자식 추가).

**처리**:
1. `_buildUserPushChanges`: 부모 블록 불변 + 자식 set 변화 → `CHILD_ADD` change
   (`marine_warning_crawler.js:1497~1506`).
2. 변경된 자식 정보(`childToBlock(curr 의 그 자식 info)`) 가 curr 필드에 들어감
   — 부모 비종속.
3. `push_sender`: `CHILD_ADD` → templateId=`additional_active`.

**푸시**:
```
📢 풍랑 주의보 추가 발효
ㅇ부산앞바다(동부평수구역 추가 발효)
   - 해제예정 : 미정
```

### 4.14 자식 일부 해제 (CHILD_RELEASE → partial_release)

**입력**: prev `자식 = [A, B, C]` → curr `자식 = [A, B]` (C 사라짐) + C 의
해제 통보문이 `warn-sasc/latest` 에 있음.

**처리**:
1. `_enrichSnapshotWithLatest`: `_childReleaseNoticeSet.add('...C...')`.
2. `_applyChildReleaseDebounce`: C 가 `_childReleaseNoticeSet` 에 있으므로 디바운스
   면제 → 즉시 해제로 인정.
3. `_buildUserPushChanges`: 부모 블록 불변 + `releasedChildren = [C]` →
   `CHILD_RELEASE`.
4. `push_sender`: templateId=`partial_release`.

**푸시**:
```
✅ 풍랑 주의보 일부 해제
ㅇ부산앞바다(서부평수구역만 해제)
```

(`buildChildQualifier` 의 `partial_release` 분기, `push_helpers.js:554~563`.)

### 4.15 자식 깜빡임 (3분 디바운스, 글리치 차단)

**입력**: prev 자식 `[A, B, C]` → curr 가 (MMIS 글리치로) `[A, B]` 로 일시 누락
→ 1 분 후 다시 `[A, B, C]` 복귀. C 의 해제 통보문 **없음** (`_childReleaseNoticeSet`
밖).

**처리**:
1. 1 분차: `_applyChildReleaseDebounce` 가 `_childReleasePending['부산앞바다 ...C']`
   에 `firstMissingAt` 기록. prev 의 C 정보를 curr 에 carry. **푸시 발사 안 됨**.
2. 2~3 분차: 같은 상태 유지(여전히 안 보임) → 계속 carry, push 억제.
3. 4 분차에 복귀: `stillPending` 에 없으므로 `delete _childReleasePending[key]`,
   "자식 깜빡임 감지(글리치)" 로그.
4. 3 분 디바운스 안에 안 돌아오면: `delete _childReleasePending[key]` 후
   다음 cycle 에서 carry 안 됨 → diff 가 `CHILD_RELEASE` 정상 발사.

### 4.16 GAP (warn/latest 에만 있는 발표대기, V10/V11)

**입력**: `warn/list` 에 없음, `warn/ready` 에도 없음, 그러나 `warn/latest` 에
`cmd='발표', tm_ef='2026.06.02 12:00'` (미래) 행 있음.

**처리**:
1. `_buildSnapshotFromMarine`: `warn/list`/`warn/ready` 결과 → snap 에 부모 없음.
2. `_enrichSnapshotWithLatest`:
   - `_isFutureExactTime(tmEf) === true` 확인.
   - `info.wrnLvlNm = '예비'` (발효 전 → 예비 취급).
   - `snap.parents.set(name, info)` — GAP 부모 보강.
   - 자식 보강 1순위: `prev.children.get(name)` 이어받기 (예비 단계의 자식 보존).
   - 자식 보강 2순위: prev 도 비어 있으면 `PARENT_TO_CHILDREN[name]` 으로 합성
     (부모 발효예정·해제예고 상속).
3. diff: prev 와 동일하면 변화 없음. 새 GAP 등장이면 publish 푸시(또는 직전 예비가
   사라졌다 GAP 으로 재등장하면 핸드오프 보강 분기 — §4.21).

**중요**: 사용자는 GAP 동안에도 "발효예정 6월 2일 12시" 가 정확하게 보인다.
GAP 보강 이전엔 발표 후 발효 전까지 앱에 아무것도 안 보였다.

### 4.17 콜드 부팅 (E-1 가드)

**입력**: fly.io 재배포 직후 process 시작. `data/marine_warning_state.json` 이
디스크에 있어 prev 가 복원됨 — 따라서 prev 비어있지 않음. 이 경우 E-1 가드 우회.

만약 `marine_warning_state.json` 자체가 없거나 손상되면 prev 가 빈 StateSnapshot 으로
복원됨 → `_isSnapshotEmpty(prev) === true` + `isFirstLoad === true` →
**push skip + state 저장만** (`marine_warning_crawler.js:2434~2443`):

```js
if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
    console.log('[Marine] 콜드 부팅 + 빈 prev — push skip, state 저장만 ...');
    _prevSnapshot = curr;
    _savePrevSnapshot(curr);
    _writeWeatherAlertsJson(new StateSnapshot(), curr);
    return [];
}
```

이로써 재배포 직후 "현재 활성 특보가 전부 신규" 로 오인되어 푸시 폭주하는 문제
차단.

### 4.18 강제 baseline 푸시 (admin 리셋, broadcastAll)

관리자 UI 의 "장부 초기화 + 전체 재발송" 버튼 (commit `c94ea5e`).

**입력**: `POST /api/admin/marine/reset` body `{ broadcastAll: true }`.

**처리** (`routes/admin.js:177~208`):
1. `marineWarningCrawler.resetState()` — prev 메모리·디스크 초기화 +
   `_forceBaselinePending = true` 예약.
2. `marineWarningCrawler.run({ forceBaselinePush: true })`:
   - `forceBaseline === true` 이므로 E-1 가드 우회.
   - 빈 prev vs 현재 활성 특보 + 예비 → 모든 zone 이 신규로 감지.
   - `_buildUserPushChanges` 가 모두 `UPCOMING_CHANGE`(예비) 또는
     `CURRENT_CHANGE`(발효) 로 발사 → publish/active 그룹 형성 → FCM 발송.
3. `adminToken` 미지정 → 전체 사용자 대상.

### 4.19 무특보 → 신규특보 자연 전이 (오늘 fix)

⚠️ **오늘 세션의 fix #3** (commit `6df054a`).

**문제**: 이미 가동 중인 fly.io 프로세스에서 prev 가 비어 있는 상태(즉 무특보
상태) 에서 새 특보가 나타나면, 옛 E-1 가드는 `_isSnapshotEmpty(prev) === true`
만 보고 push skip 했었다. 그러나 이 시점은 콜드 부팅이 아니라 정상 자연 전이.

**fix**: 가드 조건에 `isFirstLoad` 추가 (`marine_warning_crawler.js:2434`):

```js
if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
    // 콜드 부팅 1회만 skip
}
```

`isFirstLoad` 는 `run()` 진입 시 `_prevSnapshot === null` 여부로 결정. 첫 호출
이후엔 메모리에 빈 snapshot 이 들어가지만 `null` 이 아니므로 다음 호출에선
false → 자연 전이 통과.

### 4.20 MMIS 부분 실패 (E-4 가드)

**입력**: 4 endpoint 중 1 개가 HTTP 5xx/timeout/network error.

**처리** (`marine_client.js:fetchAllRealtimeEndpoints` + `marine_warning_crawler.js:2397~2404`):
1. `Promise.allSettled` 로 4 개 동시 호출.
2. 하나라도 `rejected` 면 `marine_client` 가 `throw new Error('marine endpoint 부분 실패: ...')`
   + `err.partial = true`, `err.failedEndpoints = [...]`.
3. `run()` 의 try/catch 가 그것을 잡아 console.warn 후 `return []` — 이번 사이클
   통째 skip.
4. 마지막 성공 state 유지 → release 폭주 방지.

### 4.21 핸드오프 공백 (예비 → 발표대기 1 사이클 공백 보강)

⚠️ commit `fe0bda5` + `a7bc5c9` (오늘 fix #5).

**문제**: 예비특보가 발효시각 도래 전에 잠시 데이터에서 사라졌다가 발표대기
(GAP) 로 재등장하는 케이스가 있었다. 이때 prev 가 비어 "신규 발표"로 오인되어
잘못된 푸시("📢 풍랑 주의보 발표")가 나갔다.

**fix**: `_extensionMemory` (직전 5분 기억) 에서 같은 종류·등급의 예비 정보를
복원 → prev 를 임시로 채움 → `push_sender` 가 "발표" 가 아니라 "발효시각 변경"
또는 (정말 더 늦으면) "연장" 으로 분류.

코드: `_buildUserPushChanges` 의 prevUpcoming 복원
(`marine_warning_crawler.js:1376~1386`).

### 4.22 mm=58/59 KMA 레거시 범위코드 (오늘 fix #4)

⚠️ commit `8a9a798` (점·대시) + `b786ece` (한글 + normalize) — 오늘 세션의
가장 큰 fix.

**문제**: §2.4 의 KMA 레거시 인코딩이 4 군데 파서 중 한두 군데에만 적용되어
있어, 어떤 경로로 표시되느냐에 따라 같은 시각이 다르게 보였다. 특히
`normalizeMmisTime` 단계는 누락되어 weather_alerts.json 의 자식 표시는 정확값
("05:58") 으로, 푸시 메시지는 6시간 범위로 표시되는 불일치가 발생.

**fix**: 4 군데(`marine_warning_crawler.js:_timeKey` + `normalizeMmisTime` +
`utils.js:formatWarningTime` + `push_helpers.js:formatWarnTimeKST`) 모두에 같은
변환 규칙 적용:

```js
if (mm === 58 || mm === 59) {
    timeStr = (hh >= 18) ? '18시~24시' : (hh >= 12) ? '12시~18시'
            : (hh >= 9) ? '09시~12시' : (hh >= 6) ? '06시~09시' : '00시~06시';
}
```

3 가지 입력 형식 모두 처리:
1. 점·대시 형식 (`05:58`) — commit `8a9a798`.
2. 한글 형식 (`5시 58분`) — commit `b786ece`.
3. 12자리 형식 (`...0558`) — 이전부터 처리됨.

---

## 5. 시행착오 히스토리 (시간 순)

### 5.1 최초 MMIS 도입 — Phase 1 + v7 통합 (5/13 ~ 5/19)

**계기**: dmdw 자식 해역 시스템 (subregion) 도입 (commits `1743a3e` ~ `0015f47`,
5월 13 ~ 14일) 후 통보문/HTML/dmdw 출처가 3 군데로 갈라져 동기화 문제가 폭발.
"단일 출처" 가 필요하다는 판단.

**조치**: marine.kma.go.kr MMIS endpoint 발견 → 단일 출처화. 핵심 commits:

- `082da8e` — "v7 통합 활성화 및 boundary 보강 (followup base)"
- `baf34fa` — "E-1/E-2/E-4 운영 안전성 보강" (콜드부팅 가드·weather_alerts 갱신·E-4 부분실패)
- `a515853` — "D-1/D-2/D-6 시간 형식 변환 + 가드 보강"
- `c761225` — "Must-fix fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)"
- `64cba8a` — "merge: marine v7 + Must-fix fmtTime + D-medium 인프라"
- `8998037` — "D-medium 인터랙티브 결정 + 통합관리자센터 UI 정리"

이 시점에서 legacy `weather_alerts_crawler` + `dmdw_warn_crawler` 가 `scheduler.js`
에서 주석 처리됨(`scheduler.js:1597~1605`).

### 5.2 자식 해역 분리·표출 시행착오

문제 1: 자식 응답이 자체 시간 필드를 안 줄 거라고 가정하고 부모로부터 fallback
하던 D-6 (B) 시점의 코드 → 실제로 자식이 개별 시간을 줌 → 부모 종속 제거
(commit `3705f4a` "fix: 자식 해역 표출을 자식 개별 데이터에 기인").

문제 2: 자식 종류·등급도 부모에서 fallback 하던 코드가 잘못 — 자식 자체의
종류·등급이 부모와 다를 수 있음 → fallback 제거 (commit `f499308` 의 일부).

문제 3: 자식 정보가 부모 푸시 본문에 "(연안바다 포함)" 등 한정사로 들어가야 함 →
`buildChildQualifier` 도입 (commit `8fe21ea`, `767b5bf` 등). 자식 토글
(`options.childZones`) 도입 (commit `378d64a`).

### 5.3 GAP 발표대기 발견 → warn/latest 도입 (V10)

**문제**: 발표 통보문이 났지만 발효시각이 미래라 `warn/list`/`warn/ready` 어디에도
없는 시간대 발견. 사용자 앱에 아무것도 안 보임.

**해결**: `warn/latest` endpoint 도입.

- commit `dbe2c6b` — "V10 — warn/latest 엔드포인트 추가로 정확한 해제시각 보강"
  (해제 정확시각 보강이 1차 목적, GAP 보강은 부가).
- commit `ff1fe17` — "V11 — 예비특보 푸시 부활 + 특보종류 allowlist + 미발효
  한정사 버그". V11 에서 `_normLvlNm('예비특보') → '예비'` 정규화 + `_isTargetRealtimeType`
  allowlist (V/T) 도입. 이전엔 강풍·폭풍해일까지 새어 나가던 버그 해소.

GAP 보강은 commits 로 흩어져 발전:

- `2a21b9c` — "fix: '발표 발효대기' GAP 누락 보강 — warn/latest 에서 예비로 추가"
- `5a9e111` — "feat: GAP 보강을 자식해역까지 확장 (일부 발효 + 추가발표 케이스)"
- `adab23e` — "fix: 예비→발표 단체전이 GAP 복합버그 4건 수정"
- `f9e4340` — "fix: GAP 발표대기 자식 합성 fallback — prev 비어있어도 연안바다 표출"
- `0049f2a` — "feat: GAP 자식을 warn-sasc/latest 개별 통보문으로 정확히 표출"

### 5.4 예비/발효 병렬 표출 (B feature)

commit `5213c83` — "feat: 다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존".

**배경**: 이미 발효 중인 zone 에 미래의 다른 특보가 예비로 예고되는 케이스
(예: 풍랑주의보 발효 중인데 며칠 후 태풍경보 예비특보 발효 예정). 옛 코드는
"발효 우선" 으로 예비를 드롭했었다.

**조치**: `StateSnapshot.upcomings` 별도 Map 추가. `_buildSnapshotFromMarine`
이 예비 row 가 발효 중 부모를 가지면 `parents` 에 덮어쓰지 않고 `upcomings` 에
별도 저장. `_buildUserPushChanges` 의 `getUp/getAct` 가 두 트랙을 분리해 비교 →
"발효 + 다가오는" 모두 푸시 가능.

### 5.5 발표시각 anchor (A feature)

commit `451f48e` — "feat: 발표시각을 현재 발효등급의 최초 발표시각으로 고정 (A)".

**문제**: KMA 가 변경/연장 통보문을 발행할 때마다 `tm_fc` 값이 바뀐다. 그러면
사용자가 "이 특보는 언제 처음 발표됐는가" 를 정확히 알 수 없다.

**해결**: `_applyAnnounceAnchor` 가 직전 cycle 의 같은 종류·등급 tmFc 를
이어받아 고정. 격상/격하·종류 변경·해제 시에만 새 등급의 발표시각으로 재설정.

복잡한 케이스: 예비 → 발효 전이 시 직전 사이클의 upcomings 에서 발표시각 이어받기
(`marine_warning_crawler.js:1054~1058`). 핸드오프 공백 후 복원 시 `_extensionMemory`
의 5 분 기억 사용 (`:1061~1066`).

### 5.6 해제·발효 정확값 고정 + 같은 모멘트 무푸시

problem: warn/latest 가 휘발성이 있어 같은 모멘트인데 표현만 다르게 깜빡임 →
가짜 시각 변경 푸시.

- commit `7c981d1` — "fix: warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단
  (정확 해제시각 고정)".
- commit `b05ce1f` — "feat: 정확 해제시각 고정 + 해제윈도우 기반 연장 판별".
- commit `5ded869` — "feat: 발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장
  (해제시각과 동일)".

핵심: `_sameReleaseMoment(a, b)` 가 `_timeKey` 동일 여부로 판정. 범위형 끝 시각
24시 = 정확형 다음날 00시 같은 모멘트로 인식.

### 5.7 핸드오프 공백 + 자식 정확값 고정 보강

commit `a7bc5c9` — "fix: 정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)".

- #1: 직전 스냅샷 1 사이클 공백 시 `_extensionMemory` 의 정확값 이어받기.
- #2: 자식 해역도 직전 정확값으로 고정 (윈도우/연장은 부모만, 자식은 표출
  깜빡임 방지 한정).

### 5.8 시각 변경 3분 디바운스

commit `eb06efe` — "feat: 발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단".

`_debounceTimeValues` (`marine_warning_crawler.js:1228~1263`). 새 값이 3 분
유지될 때만 확정. 최초 값은 즉시 수락 (`if (conf == null) ...`).

### 5.9 mm=58/59 레거시 코드 발견

오늘 세션의 가장 큰 발견. 한 사용자 zone 에 "5월 23일 05:58 해제예정" 푸시가
간 것이 발단. 분석 결과 KMA 가 이 분 값을 "06시 이전 새벽 시간대" 로 의도한 것.

- commit `8a9a798` — 점·대시 형식 fix
- commit `b786ece` — 한글 형식 + normalize 단계까지 보강

### 5.10 E-1 over-fire 발견 (오늘)

- commit `6df054a` — "fix: E-1 빈-prev 가드를 콜드부팅 1회로 한정 — 무특보→
  신규특보 자연 전이 푸시 복원".

가드가 정상 자연 전이까지 막아 한동안 자연 발생 특보 푸시가 안 나가던 문제.
`isFirstLoad` 조건 추가로 해결.

### 5.11 admin 전체 재발송 버튼

- commit `c94ea5e` — "feat: 관리자 UI 에 '전체 사용자 재발송' 버튼 추가 —
  broadcastAll 호출". `routes/admin.js:179` 의 `broadcastAll` 옵션.

---

## 6. 현재 상태

### 6.1 안정적으로 동작

- 4 + 2 endpoint 의 1 분 주기 폴링 — 안정.
- 부모 zone publish/active/release 푸시 — 안정.
- 자식 zone CHILD_ADD/CHILD_RELEASE 푸시 + 부모 한정사 결합 — 안정.
- 시각 정확/범위/한글/12자리/58분 케이스 모두 통일 변환.
- GAP 보강 — 부모 + 자식 양쪽 표시 정상.
- E-4 부분 실패 시 통째 skip — 마지막 state 유지.
- D-medium 의심 가드 — 빈 응답 폭주 차단 + 관리자 결정 인프라.
- 디스크 영속화 — fly.io 재배포 후에도 state 보존.
- 야간 발송 차단 + 사용자 옵션 토글 (announce/active/release/childZones/night).

### 6.2 알려진 edge case

- **`warn/ef/list` 미사용** — timeline diff 가 없어 history 탭은 불완전.
  현재는 weather_alerts.json 의 `history` 필드를 디스크에서 보존만 한다.
- **자격증명 secrets 가 비어 있는 환경** — 인증 endpoint skip 만 되므로
  주 기능은 정상이지만 timeline 보강은 불가. (`marine_client.js:51`
  `AUTH_ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED`)
- **`MMIS_CODE_TO_NAME` 매핑 미등록 zone** — `warn_zone_nm` fallback 으로
  처리되지만 표기 차이가 있으면 매핑 실패 → `PARENT_TO_CHILDREN` 도 못 찾아
  자식 한정사가 빈 값으로 나갈 수 있음.
- **타이밍 race** — `_runInProgress` 가 중복 실행 방지하지만, admin reset 직후
  cron 과 manual run 이 매우 짧은 간격으로 겹치면 manual 이 early-return 될 수
  있다. 그래서 `_forceBaselinePending` 플래그가 1 사이클 보장한다.
- **자식 디바운스 3분 동안** prev 와 동일한 자식 정보가 carry 되므로,
  사용자 앱은 그동안 "여전히 발효" 로 표시. 진짜 빠른 해제 시 약간의 지연.

### 6.3 오늘 세션의 3가지 fix 와 영향

1. **mm=58/59 한글 형식 + normalize 단계 보강** (commit `b786ece`)
   - 영향: weather_alerts.json 의 자식 표시가 "5시 58분" → "00시~06시" 로
     교정. 이미 디스크에 잘못 저장된 zone 은 다음 cycle 에 자연 덮어쓰기됨.

2. **E-1 가드 콜드부팅 1회 한정** (commit `6df054a`)
   - 영향: 무특보 상태에서 새 특보 발생 시 자연 푸시 발사 복원. 콜드 부팅
     폭주 방지는 그대로.

3. **관리자 전체 재발송 버튼** (commit `c94ea5e`)
   - 영향: admin 이 임의 시점에 현재 활성 특보를 모든 구독자에게 강제 재전송
     가능. 디버깅·복구·테스트용. 보안: admin 인증(`adminToken`) 통과 필수.

### 6.4 침묵 푸시 이슈 — broadcastAll 후 푸시 미수신

**증상**: 관리자 UI 에서 `broadcastAll=true` 로 reset 호출 후, `success` 응답을
받고도 사용자 기기에 푸시가 안 도착하는 사례.

**잠정 분석** (확정 아님):

1. **현재 활성 특보가 없는 경우** — `forceBaseline` 모드에서도 curr 가 비어
   있으면 diff 도 비어 있어 push 그룹 자체가 안 만들어진다. 정상 동작이지만
   사용자 입장에선 "버튼 눌렀는데 안 옴". `success: true, pushed: true` 응답이
   오해를 부른다.

2. **현재 활성 특보가 있어도 사용자가 해당 zone 미구독** — `getMatchedZones`
   가 교집합 빈 결과 → `userFilteredItems.length === 0` → 그 사용자 skip
   (`routes/push.js:292`). 사용자가 본인 zone 이 빠져 있는 걸 모르면 미수신처럼
   느낌.

3. **야간 토글** — `user.options.night === false` + 현재 KST 23~07시 → 그 사용자
   skip (`routes/push.js:362~368`). broadcast 라도 이 게이트는 적용됨.

4. **점검 모드** — `MAINTENANCE_FILE` 의 `active=true && blockPush !== false`
   면 `processAndSendNotifications` 가 false 반환하고 발송 0건. 그런데
   `forceBaselinePush` 경로는 `pushSender.processChanges` 를 직접 호출하므로
   maintenance 체크를 우회하지 않고 그대로 통과한다 — 즉 점검 모드면 정상적으로
   막힘. 사용자가 점검 모드 켜둔 채 reset 누르면 미발송.

5. **FCM dead token** — 사용자가 앱 재설치 등으로 토큰이 무효화된 경우.
   `admin.messaging().send` 가 `messaging/registration-token-not-registered`
   에러 → 사이클 끝에 정리. 정리되기 전 한 cycle 은 push 0 건.

6. **pendingPushes 쌓임 + retry 실패** — 직전 사이클에 발송 실패한 그룹이
   `data/pending_pushes.json` 에 남아 있는데, 같은 templateId 의 새 그룹이
   생기면 기존 pending 과 dedup 되어 silent skip 될 가능성. 다만 `push_sender`
   의 dedup 키는 (template, type, level) 만이라 같은 그룹이 신규 변화로 들어와도
   다른 entries 가 들어가야 한다 → 이론적으로 silent skip 발생하기 어려움 (분석 필요).

권장 후속 조치:
- admin reset 응답에 `pushedZoneCount` / `actualSentCount` 를 포함시켜 즉시 디버깅.
- maintenance mode 일 때 admin UI 에 경고.

---

## 7. 부록

### 7.1 용어집

| 용어 | 정의 |
|------|------|
| 특보 | KMA 가 발표하는 기상 경보의 총칭 |
| 예비특보 | 발효시각이 미래인 통보문. 곧 발효 예정. MMIS `warn/ready`. |
| 주의보 | 1차 발효 등급 |
| 경보 | 2차(심각) 발효 등급 |
| 통보문 | KMA 의 1 회 발표 단위. 발표·변경·연장·해제·변경해제 cmd 가짐. |
| 발표(tm_fc) | 통보문 발행 시각 |
| 발효(tm_ef) | 특보 효력 시작 시각 |
| 해제(tm_yn / clr_ntc_tm) | 효력 종료 시각. tm_yn 은 이론값, clr_ntc_tm 은 예고. |
| 해제예고 | 발효 중에 "이때 해제될 예정" 미리 등록 |
| GAP / 발표대기 | 발표는 했지만 발효시각 미래 — warn/list 와 warn/ready 모두 없는 상태 |
| 부모 zone | 앞바다·먼바다 (예: 부산앞바다) |
| 자식 zone | 평수구역·연안바다 (예: 부산앞바다중연안바다) |
| StateSnapshot | 한 사이클의 정규형 상태 — parents/children/upcomings |
| change | _buildUserPushChanges 의 출력 단위. type 으로 분류. |
| templateId | push_sender 의 그룹화 키. publish/active/release 등. |
| childState | 자식 한정사 빌더 입력 — { all, active, added, released, allReleased, extended } |

### 7.2 파일별 책임 매트릭스

| 파일 | 책임 |
|------|------|
| `services/marine_client.js` | MMIS HTTP 클라이언트 — 인증/rate limit/envelope 정규화/E-4 |
| `marine_warning_crawler.js` | 메인 — snapshot 빌드/diff/가드/홀드/디바운스/푸시 발사/state 영속/weather_alerts 갱신 |
| `push_sender.js` | 사용자 푸시 발사 — changes → templateId 그룹 → /api/push-custom POST |
| `services/push_helpers.js` | 메시지 생성 — generateMessage/formatWarnTimeKST/buildChildQualifier/zone hierarchy |
| `routes/push.js` | `/api/push-custom` — 구독자 필터·옵션·FCM/WebPush 발송·history |
| `routes/admin.js` | `/api/admin/marine/reset`, `/api/admin/marine/suspicious/*`, `/api/admin/children-reset` |
| `scheduler.js` | 1분 cron orchestrator — `marineWarningCrawler.run()` 호출 |
| `js/utils.js` | 프론트 — `formatWarningTime`, `appState`, `getKfTime` |
| `js/render.js` | 프론트 — 부모 zone 카드 렌더 |
| `js/render_coastal.js` | 프론트 — 자식 zone 카드 렌더 |
| `data/marine_warning_state.json` | prev StateSnapshot 영속 |
| `data/marine_suspicious_state.json` | 의심 가드 currentCase + history 영속 |
| `data/weather_alerts.json` | 프론트 표출용 zone tree (current/previous) |
| `data/pending_pushes.json` | 발송 실패 재시도 큐 |
| `data/custom_push_history.json` | admin 발송 이력 |
| `data/push_subscriptions.json` | FCM/WebPush 구독자 |

### 7.3 주요 데이터 구조

#### StateSnapshot
```ts
{
  parents:   Map<string, ParentInfo>
  children:  Map<string, Map<string, ChildInfo>>
  upcomings: Map<string, UpcomingInfo>
}
ParentInfo = { wrnTp, wrnTpNm, wrnLvl, wrnLvlNm, tmFc, tmEf, tmYn, clrNtcTm }
ChildInfo  = same shape
```

#### change event types (`_buildUserPushChanges` 출력)
```ts
type Change =
  | { type: 'UPCOMING_CHANGE', zone, prev, curr, currentActive, childState }
  | { type: 'CURRENT_CHANGE', zone, prev, curr, childState }
  | { type: 'EF_EXTEND', zone, curr, oldTime, newTime, childState }
  | { type: 'YN_EXTEND', zone, curr, oldTime, newTime, childState }
  | { type: 'CHILD_ADD', zone, curr, childState }
  | { type: 'CHILD_RELEASE', zone, prev, childState }
  | { type: 'CHILD_EF_EXTEND', zone, curr, oldTime, newTime, childState }
  | { type: 'CHILD_YN_EXTEND', zone, curr, oldTime, newTime, childState }
```

#### childState
```ts
{
  all:      string[]   // PARENT_TO_CHILDREN[zone]
  active:   string[]   // 현재 발효/예비 자식
  added:    string[]   // 이번 cycle 추가
  released: string[]   // 이번 cycle 해제
  allReleased?: boolean
  extended?: string[]  // CHILD_*_EXTEND 시
  parentTimeUnchanged?: boolean
  timeChanged?: string[]
}
```

#### DiffMatrix bucket 종류
```
publish, active, additional_active, prelim_cancel,
partial_release, release,
level_upgrade_publish, level_upgrade_active,
level_downgrade_publish, level_downgrade_active,
type_upgrade_publish, type_upgrade_active,
type_downgrade_publish, type_downgrade_active,
time_ef_change, time_yn_change
```

⚠️ DiffMatrix 는 옛 v7 관리자 푸시 경로용. 현재 `ADMIN_PUSH_ENABLED=false`
이라 `runDiffAndPush` 는 호출되지 않는다. 사용자 푸시는
`_buildUserPushChanges` 가 별도 경로로 처리.

### 7.4 환경 변수·자격증명

- `MARINE_USER_ID` — MMIS 로그인 ID (fly.io secrets, 평문 절대 금지)
- `MARINE_USER_PWD` — MMIS 로그인 PWD
- `MARINE_DISABLE=1` — 강제 비활성 (디버깅용)
- `KMA_DMDW_USER_ID/PWD` — legacy dmdw 크롤러용 (현재 미사용)

자격증명 위치:
- 로컬: `.env.example` 참고 (`.env` 는 gitignore).
- 배포: `fly secrets set MARINE_USER_ID=... MARINE_USER_PWD=...`.

Firebase admin SDK 키: `local_server/serviceAccountKey.json` (gitignore +
보조 `serviceAccountKey_Backup.json`).

VAPID 공개키: `app_config.json` 또는 frontend `config.js` 참고.

### 7.5 디버깅 팁

#### 한 cycle 의 흐름 추적

```bash
# fly.io logs
fly logs --app seagnal-server

# 키워드
🌊 marine.kma 통합 크롤러 실행          → run() 시작
[Marine] prev snapshot 디스크 복원 완료  → 콜드 부팅 후 첫 cycle
[Marine] endpoint 부분 실패              → E-4 가드
[Marine] 콜드 부팅 + 빈 prev — push skip → E-1 가드
[Marine] 의심 사례 신규 발생 caseId=...  → D-medium 의심
[Marine] 자식 해제 디바운스 시작         → 3분 carry
[Marine] ⚡ 자식 깜빡임 감지(글리치)      → carry 후 복귀
[Marine] warn/latest 보강: N zone        → 정확 해제시각
[Marine] warn/latest GAP 보강            → 발표대기
[PushSender] N건의 변경사항 분석 중       → push 그룹화
[PushSender] ✅ 발송 성공: [...]          → FCM 응답
```

#### 디스크 상태 직접 확인

```bash
jq . local_server/data/marine_warning_state.json   # 현재 prev snapshot
jq . local_server/data/weather_alerts.json         # 프론트 표출 데이터
jq . local_server/data/marine_suspicious_state.json # 의심 가드 상태
jq . local_server/data/pending_pushes.json         # 재시도 큐
jq . local_server/data/custom_push_history.json    # 발송 이력
```

#### 의심 케이스 결정

```bash
curl https://seagnal-server.fly.dev/api/admin/marine/suspicious        # 현재 case 조회
curl -X POST -d '{"decision":"normal"}' \
  -H 'Content-Type: application/json' \
  https://seagnal-server.fly.dev/api/admin/marine/suspicious/decide    # 정상 해제 결정
```

#### 장부 초기화 + 전체 재발송

```bash
curl -X POST -d '{"broadcastAll":true}' \
  -H 'Content-Type: application/json' \
  https://seagnal-server.fly.dev/api/admin/marine/reset
```

#### 점검 모드 해제 (push 차단 해제)

```bash
# local_server/data/maintenance_config.json 의 active 를 false 로
```

#### 자식 디바운스 상태 메모리 덤프 (개발용)

`marine_warning_crawler.js` 의 `_childReleasePending` 객체. 운영 중에는 직접
조회 불가. 디버깅 시 `module.exports._childReleasePending` 임시 노출.

#### `warn/list`·`warn/ready` 직접 호출

```bash
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/list
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/ready
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/latest
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/list
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/ready
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/latest
```

(인증 불필요 — V9 정책.)

---

## 끝

본 초안의 강점은 §2 (데이터 모델·endpoint 메커니즘) 와 §3 (전체 데이터 흐름)
의 구체성이다. 다른 에이전트들이 §4 시나리오·§5 시행착오 이력·§6 현재 상태를
더 풍부히 채워 주리라 기대하며, 1 번 초안은 데이터 레이어의 견고한 토대를 제공한다.

주요 인용 파일:
- `/home/user/SEAGNAL/local_server/services/marine_client.js`
- `/home/user/SEAGNAL/local_server/marine_warning_crawler.js`
- `/home/user/SEAGNAL/local_server/push_sender.js`
- `/home/user/SEAGNAL/local_server/services/push_helpers.js`
- `/home/user/SEAGNAL/local_server/routes/push.js`
- `/home/user/SEAGNAL/local_server/routes/admin.js`
- `/home/user/SEAGNAL/local_server/scheduler.js`
- `/home/user/SEAGNAL/local_server/js/utils.js`
- `/home/user/SEAGNAL/local_server/js/render.js`
- `/home/user/SEAGNAL/local_server/js/render_coastal.js`
- `/home/user/SEAGNAL/local_server/data/marine_warning_state.json`
- `/home/user/SEAGNAL/local_server/data/weather_alerts.json`

---

# Part C — 시행착오 Timeline + 판단 오류 추적

*독립 에이전트 #3 이 "왜 처음에 X 라고 생각했나 → 어떤 신호가 가정을 깼나 → 어떻게 Y 로 옮겨갔나" 의 인지 추론 패턴에 집중하여 작성한 초안.*


> 본 문서는 SEAGNAL (한국 해상기상 앱) 의 KMA MMIS (`marine.kma.go.kr`) API
> 전환 시점부터 현재(2026-06-01) 까지의 **모든 시행착오·교정·시나리오**를
> 신규 개발자가 한 문서로 이해할 수 있도록 정리한 종합 보고서이다.
>
> Draft 3 의 강점은 **시행착오·판단 오류·교정의 인지심리적 추적**이다.
> "왜 처음에 X 라고 생각했나" → "어떤 신호가 그 가정을 깼나" →
> "그래서 Y 로 어떻게 옮겨갔나" 의 패턴을 모든 결정적 커밋에서 명시한다.
>
> - 저장소: `/home/user/SEAGNAL/`
> - 브랜치: `claude/kma-website-reference-KYLtf` (main +271 커밋)
> - 작성일: 2026-06-01
> - 범위: MMIS 전환 시점 (`082da8e` v7 통합 활성화) ~ 최신 커밋 (`b786ece`)

---

## 목차

1. [개요](#1-개요)
2. [MMIS 데이터 모델 (endpoint·필드·envelope)](#2-mmis-데이터-모델)
3. [데이터 흐름 (cron → snapshot → diff → push + UI)](#3-데이터-흐름)
4. [시나리오별 동작 (모든 lifecycle 케이스)](#4-시나리오별-동작)
5. [**시행착오 히스토리 — 시간선과 인지심리적 추적**](#5-시행착오-히스토리)
6. [현재 상태와 알려진 edge case](#6-현재-상태와-알려진-edge-case)
7. [부록 — 용어집·파일별 책임·데이터 구조·디버깅 팁](#7-부록)

---

# 1. 개요

## 1.1 전환 배경 (왜 MMIS 로 갔나)

SEAGNAL 은 본래 KMA "통보문 HTML 페이지" (legacy 시스템) 를 크롤링하여
풍랑·태풍·강풍 특보 데이터를 추출하던 구조였다. 이 시스템의 모듈명은
`weather_alerts_crawler.js` + `report_alert_processor.js` + `dmdw_warn_crawler.js`
이고, 본문 텍스트의 **자연어 파싱** (정규식) 으로 발효·해제·연장을 식별했다.

문제는 다음과 같았다.

1. **자식해역(연안바다·평수구역)** 은 부모 통보문 본문에 자연어로만 묻혀
   있어 어휘 변형마다 정규식이 깨졌다. 5년치 archive 분석에서만 V1→V2→V3
   로 정규식이 세 번 갱신되었고, 그조차도 누락 잔존.
2. 발효·해제 **정확 시각**(YYYY.MM.DD HH:MM) 이 통보문 헤더에 자유 텍스트로
   섞여 있어 파싱 안정성이 낮았다.
3. 격상·격하·시각변경·연장 같은 **상태 전이** 가 통보문 간 비교가 아니라
   본문 어휘로만 판정되어 노이즈가 컸다.

KMA 가 별도로 운영하는 **MMIS (해양기상정보포털, `marine.kma.go.kr`)** 는
같은 정보를 **구조화된 REST API** 로 제공한다. 부모/자식이 별도 row 로
구분되고, `warn_zone_cd`(코드), `warn_tp`(종류 코드), `warn_lvl`(등급 코드),
`tm_ef`(발효 시각), `tm_yn`(해제 시각), `clr_ntc_tm`(해제예고) 등 필드가
모두 정형이다.

전환은 점진적이었다. 처음 v6/v7 통합본을 만든 뒤 (`082da8e` 베이스),
legacy 두 크롤러(`weather_alerts_crawler`, `report_alert_processor`) 의
push 채널을 잘라내고 marine_warning_crawler 로 이관하는 과정에서
폭주·누락·왜곡이 수십 차례 발생했다. **본 문서 §5 가 그 전체를 추적한다.**

## 1.2 시스템 이름·약어

| 약어 | 풀이 |
|---|---|
| MMIS | Marine Meteorological Information System (해양기상정보포털) |
| KMA | Korea Meteorological Administration (기상청) |
| zone | 특보 해역 단위. 부모(S1xxx) + 자식(S2xxx/S3xxx) |
| 부모 zone | 광역 해역. 예: `남해서부동쪽먼바다` (코드 S1322200) |
| 자식 zone | 연안바다·평수구역. 부모명 뒤 "중…연안바다" 형태. 예: `제주도서부앞바다중북서연안바다` |
| 발효 (active) | 현재 시각에 특보가 효력 발생 중 |
| 예비 (upcoming/preliminary) | 발표는 났으나 발효 시각이 아직 미래 |
| 해제 (release) | 효력 종료 |
| 격상/격하 (upgrade/downgrade) | 등급 변화 (주의보 ↔ 경보) |
| 연장 (extend) | 발효/해제 예정 시각이 더 늦은 시각으로 이동 |
| GAP | 예비→발표 핸드오프 구간의 1~수 사이클 공백 |
| HOLD | 한번 정확값이 잡힌 시각을 깜빡임에도 되돌리지 않고 고정 |
| 디바운스 (debounce) | N분 연속 유지 시에만 확정 |
| baseline | resetState 직후 활성 특보를 "신규로" 재발사하는 모드 |
| dmdw | legacy 시스템 (deprecated) — 관리자 푸시 채널명으로만 잔존 |
| ef | 발효 (effective) |
| yn | 해제 (yourno/end) |
| tmFc | 통보문 발표 시각 (announce timestamp) |

## 1.3 코드 위치 핵심 파일

| 파일 | 책임 |
|---|---|
| `local_server/services/marine_client.js` | MMIS HTTP 클라이언트 (인증·rate limit·envelope 정규화) |
| `local_server/marine_warning_crawler.js` | 메인 크롤러 — snapshot 구축, diff, HOLD/디바운스, 사용자 push 발사 |
| `local_server/push_sender.js` | 사용자 푸시 발송 entry (FCM 호출) |
| `local_server/services/push_helpers.js` | 푸시 메시지 빌더 (PushBuilder, fmtTime, generateMessage, buildChildQualifier) |
| `local_server/services/dmdw_push_sender.js` | 관리자(dmdw) 푸시 채널 (현재 `ADMIN_PUSH_ENABLED=false` 로 비활성) |
| `local_server/js/utils.js` | 프론트 시각 포매터 `formatWarningTime` |
| `local_server/js/render.js` | 사용자 앱 부모 카드 렌더 |
| `local_server/js/render_coastal.js` | 사용자 앱 자식 카드 렌더 |
| `local_server/js/data.js` | 사용자 앱 데이터 정규화 (옛/신 구조 호환) |
| `local_server/routes/push.js` | `/api/push-custom` 사용자 푸시 라우트 (zone 필터·옵션 토글 적용) |
| `local_server/routes/admin.js` | `/api/admin/marine/reset` 장부 초기화 + broadcastAll |
| `local_server/js/admin.js` | 관리자 페이지 UI (장부 초기화 / 전체 사용자 재발송 버튼) |
| `local_server/scheduler.js` | 1분 주기 cron 호출 |

---

# 2. MMIS 데이터 모델

## 2.1 endpoint 목록

`local_server/services/marine_client.js` 67~79 줄 `PATHS` 객체 참조.

| 키 | path | 인증 | 의미 |
|---|---|---|---|
| `WARN_LIST` | `/v1/kma/warn/list` | 비로그인 | **부모 발효 중** 모든 zone |
| `WARN_SASC_LIST` | `/v1/kma/warn-sasc/list` | 비로그인 | **자식 발효 중** zone |
| `WARN_READY` | `/v1/kma/warn/ready` | 비로그인 | **부모 예비** zone (발표는 났으나 미발효) |
| `WARN_SASC_READY` | `/v1/kma/warn-sasc/ready` | 비로그인 | **자식 예비** zone |
| `WARN_LATEST` | `/v1/kma/warn/latest` | 비로그인 | 부모 zone "**가장 최근 통보문**" (해제 통보문 포함) |
| `WARN_SASC_LATEST` | `/v1/kma/warn-sasc/latest` | 비로그인 | 자식 "가장 최근 통보문" |
| `WARN_EF_LIST` | `/v1/kma/warn/ef/list` | 로그인 | 발효 timeline (영구 row 보존) |
| `WARN_NTFCTN_LIST` | `/v1/kma/warn/ntfctn/list` | 로그인 | 통보문 원문 list |
| `LOGIN` | `/api/auth/login` | — | mmbrId/mmbrPassword → JWT |
| `REFRESH` | `/api/auth/refresh-token` | 토큰 | access/refresh 30분/60분 갱신 |

## 2.2 인증 흐름

`marine_client.js` §5 `login` / `refreshToken` / `ensureAuth`:

1. `POST /api/auth/login` body `{mmbrId, mmbrPassword, rememberMe:false}`
   → 응답 헤더 `accesstoken` (30분), `refreshtoken` (60분), Set-Cookie JSESSIONID.
2. **25분마다** `POST /api/auth/refresh-token` (token TTL 30분 대비 안전 여유).
3. 401 → `login()` 으로 fallback + 1회 재시도.
4. 자격증명은 `process.env.MARINE_USER_ID` / `MARINE_USER_PWD` (fly.io secrets).
   둘 다 없으면 `AUTH_ENABLED=false` — 비로그인 endpoint 만 호출 가능.
5. 로그 마스킹: ID 의 앞 2자 + `***` ("hy\*\*\*"). 토큰·비밀번호 평문 출력 금지.

## 2.3 응답 envelope 정규화

MMIS 는 endpoint 별로 envelope 가 두 가지 — `{status, payload}` 또는
`{code, data}`. `marine_client.js:347 _unwrap()` 이 둘 다 흡수해서
항상 **row 배열** 로 반환한다. 비어있으면 `[]`.

## 2.4 row 핵심 필드 (warn/list, warn/ready)

| 필드 | 의미 | 예시 |
|---|---|---|
| `warn_zone_cd` | 해역 코드 (불변) | `S1322200` |
| `kor_nm` | 해역 한글명 (축약될 수 있음) | `"남해서부 동쪽"` |
| `warn_tp` | 특보 종류 코드 | `V`=풍랑, `T`=태풍, `W`=강풍, `O`=폭풍해일 |
| `warn_tp_nm` | 특보 종류 한글명 | `"풍랑"` |
| `warn_lvl` | 등급 코드 | `2`=주의보, `5`=경보, ''=예비 |
| `warn_lvl_nm` | 등급 한글명 | `"주의보"` / `"경보"` / `"예비특보"` |
| `warn_cmd_nm` | 통보문 명령 | `"발표"` / `"해제"` / `"변경"` / `"연장"` |
| `tm_fc` | 통보문 발표 시각 | `"2026.05.26 13:00"` |
| `tm_ef` | 발효 시각 (정확 또는 범위형) | `"2026.05.26 18:00"` 또는 `"26일 21시 ~ 24시"` |
| `tm_yn` | 해제 시각 | 동상 |
| `clr_ntc_tm` | 해제예고 시각 | 동상 |
| `prdc_go` | 관할 관서 코드 | `"108"` |

## 2.5 종류 allowlist (V8 + V11 정책)

SEAGNAL 정책: **풍랑(V) + 태풍(T) 만** 통과시킨다.

- 강풍(W): UI 미표시 — 해상 운항에 직접 영향 적음
- 폭풍해일(O): V8 정책으로 **전면 수집·표시 중단** (`69e163b`)

allowlist 구현: `marine_warning_crawler.js:2016 REALTIME_TARGET_TP = Set(['V','T'])`,
`_isTargetRealtimeType(warnTp)` 헬퍼. 모든 row 처리 진입부에서 가드.

## 2.6 zone 코드 ↔ 정식명 매핑 (A안, `2c25c58`)

MMIS 실시간 endpoint 가 일부 zone 이름을 **축약** 해서 준다
(예: `kor_nm = "남해서부 동쪽"`). 우리 앱 표기는 `남해서부동쪽먼바다`.
`warn_zone_cd` 는 불변이므로 **코드 기반 매핑**으로 해결.

- `MMIS_CODE_TO_NAME` 객체 (93개) — archive ef2 1년치(13만건)에서 추출.
- `_resolveZoneName(row)` 헬퍼가 `MMIS_CODE_TO_NAME[warn_zone_cd] || kor_nm`.
- 부모 43개는 앱 표기와 100% 일치 검증. 표기 불일치 2건(S2211100/S2212200)은 보정.

## 2.7 부모 → 자식 매핑 (`PARENT_TO_CHILDREN`)

`marine_warning_crawler.js:75` — 부모 zone 별 자식 리스트 정적 매핑.
GAP 시 fallback 합성, childQualifier 표시 등에 사용.

---

# 3. 데이터 흐름

```
                ┌──────────────────────────────────────────────────────────┐
                │  scheduler.js  cron(1분)                                 │
                └────────────────────┬─────────────────────────────────────┘
                                     ↓
                ┌──────────────────────────────────────────────────────────┐
                │  marine_warning_crawler.run()                            │
                │                                                          │
                │  1) fetchAllRealtimeEndpoints() ←── warn/list+ready×2    │
                │     - allSettled, 부분 실패 → cycle skip (E-4)          │
                │  2) _buildSnapshotFromMarine() → curr (parents+children) │
                │     - allowlist V/T 필터, _resolveZoneName, _normLvlNm   │
                │  2-B) warn/latest + warn-sasc/latest 병렬               │
                │       → _enrichSnapshotWithLatest() (V10)                │
                │       · 해제 통보문의 정확 tm_ef 로 clrNtcTm 보강       │
                │       · 발표 발효대기 GAP zone 예비로 추가                │
                │       · 자식 GAP 추가발효 zone 자식로 추가                │
                │  3) E-1 가드 — 콜드부팅 + 빈 prev 면 push skip          │
                │  4) _applySuspiciousGuard() — D-medium 의심 보류         │
                │  4-B) _applyChildReleaseDebounce() — 자식 3분 디바운스   │
                │  4-C) _applyAnnounceAnchor() — 최초 발표시각 고정        │
                │  4-D) _applyReleaseClrLogic() — 해제시각 HOLD/연장      │
                │  4-E) _applyUpcomingEfLogic() — 발효시각 HOLD/연장      │
                │  4-F) _debounceTimeValues() — 3분 변경 디바운스          │
                │  5) (관리자 push 비활성)                                 │
                │  5-B) _buildUserPushChanges(prev, curr)                  │
                │       → push_sender.processChanges(changes)              │
                │  5-C) _updateExtensionMemory(curr) — 6h retention        │
                │  6) _savePrevSnapshot(curr) → marine_warning_state.json  │
                │  7) _writeWeatherAlertsJson() → weather_alerts.json     │
                └────────────────────┬─────────────────────────────────────┘
                                     ↓
                ┌──────────────────────────────────────────────────────────┐
                │  push_sender.processChanges()                            │
                │  ↘ push_helpers.generateMessage()                        │
                │      ↘ PushBuilder / buildChildQualifier / fmtTime       │
                │      ↘ FCM 발송 (routes/push.js → /api/push-custom)     │
                └────────────────────┬─────────────────────────────────────┘
                                     ↓
                ┌──────────────────────────────────────────────────────────┐
                │  사용자 앱  (index.html → js/data.js → js/render.js +    │
                │                           js/render_coastal.js)          │
                │  - weather_alerts.json 폴링                              │
                │  - formatWarningTime 으로 시각 표출 통일                  │
                └──────────────────────────────────────────────────────────┘
```

## 3.1 두 영속 파일

1. `local_server/data/marine_warning_state.json` — **prev snapshot**
   다음 cycle 의 diff 기준. StateSnapshot 객체 (parents/children/upcomings Map JSON 직렬).
2. `local_server/data/weather_alerts.json` — **사용자 앱이 폴링**하는 표출 트리.
   `_writeWeatherAlertsJson` 가 매 cycle 끝에 atomic tmp → rename. legacy 시스템과
   동일 키 셋(동/서/남/제주 4 sea + 해상 + 앞바다 + leaf) 유지 — 다운스트림 호환.

## 3.2 의심 가드 상태 파일

`local_server/data/marine_suspicious_state.json` — D-medium 의심 사례 영속화
(currentCase + history). 재배포 후에도 복원.

## 3.3 cron 주기

`scheduler.js` 가 marine_warning_crawler.run() 을 **1분 주기**로 호출. dmdw 자식
크롤러도 같은 1분 주기.

---

# 4. 시나리오별 동작

다음 표는 lifecycle 전 케이스의 push 분류 + 표출 결과이다.
`marine_warning_crawler.js:_buildUserPushChanges` 의 분기 + `push_sender` 의
이벤트 코드 + `push_helpers.generateMessage` 의 메시지 템플릿을 모두 종합.

| # | 시나리오 | 트리거 조건 | push 코드 / 라벨 | 메시지 예시 |
|---|---|---|---|---|
| S1 | 신규 발표 (예비) | prev 무, curr 예비 등장 | `UPCOMING_CHANGE` → `publish` (예비) | `📢 풍랑 예비특보 발표 — ㅇ남해서부동쪽먼바다` |
| S2 | 신규 발표 (직접 발효) | prev 무, curr 발효 등장 | `CURRENT_CHANGE` → `publish` | `📢 풍랑 주의보 발표 — ㅇ…` |
| S3 | 예비 → 발효 전이 | prev 예비, curr 발효 동일등급 | `CURRENT_CHANGE` → `active` | `🌊 풍랑 주의보 발효 — ㅇ…` |
| S4 | 발효 → 해제 | prev 발효, curr 무, clrNtcTm 있음 | `CURRENT_CHANGE` → `release` | `✅ 풍랑 주의보 해제 — ㅇ…` |
| S5 | 격상 (주의보 → 경보) | prev 발효 주의보, curr 발효 경보 | `CURRENT_CHANGE` → `level_upgrade` | `⬆️ 풍랑 경보 격상 — ㅇ… (주의보→경보)` |
| S6 | 격하 | prev 경보, curr 주의보 | `CURRENT_CHANGE` → `level_downgrade` | `⬇️ 풍랑 주의보 격하 — ㅇ… (경보→주의보)` |
| S7 | 종류 변경 | prev 풍랑, curr 태풍 (같은 zone) | `CURRENT_CHANGE` → `type_change` | `🔄 특보 종류 변경 — ㅇ… (풍랑→태풍)` |
| S8 | 발효 예정시각 변경 | prev/curr 둘 다 예비, tm_ef 다른 모멘트, 둘 중 하나는 정확시각 | `UPCOMING_CHANGE` → `time_ef_change` | `🕐 풍랑 예비 발효시각 변경 — ㅇ… 기존 …→변경 후 …` |
| S9 | 해제 예정시각 변경 | prev/curr 둘 다 발효, clrNtcTm 다른 모멘트, 둘 중 하나는 정확시각 | `CURRENT_CHANGE` → `time_yn_change` | `🕐 풍랑 해제시각 변경 — ㅇ…` |
| S10 | 발효 예정시각 **연장** | 둘 다 예비, tm_ef 둘 다 범위형, curr 가 더 늦음, **동일 등급** | `EF_EXTEND` → `ef_extend` | `🕐 풍랑 예비 발효시각 연장 — ㅇ… (기존,변경 후)` |
| S11 | 해제 예정시각 **연장** | 둘 다 발효, clrNtcTm 둘 다 범위형, curr 더 늦음, 동일 등급 | `YN_EXTEND` → `yn_extend` | `🕐 풍랑 해제시각 연장 — ㅇ…` |
| S12 | 자식만 추가 발효 | 부모 불변, 자식 set added | `CHILD_ADD` → `additional_active` | `📢 풍랑 주의보 추가 발효 — ㅇ제주도서부앞바다(가파도연안바다)` |
| S13 | 자식만 일부 해제 | 부모 불변, 자식 set released | `CHILD_RELEASE` → `partial_release` | `✅ 풍랑 주의보 일부 해제 — ㅇ…(가파도연안바다)` |
| S14 | 자식 단독 연장 | 부모 불변, 자식 시각만 더 늦음 | `CHILD_EF_EXTEND`/`CHILD_YN_EXTEND` | (한정사: 연장된 자식만) |
| S15 | 예비 → 해제 (취소) | prev 예비, curr 무, "발표 가능성 낮아져 해제" | `dmdw.sendPreliminaryRelease` (per-parent dedup) | `✅ 풍랑 예비특보 해제 — ㅇ…` |
| S16 | 공존 (발효+다른등급 예비) | 발효 중 zone 에 다른 등급 예비 동시 | `UPCOMING_CHANGE` (병렬, 발효는 재발사 안 함) | 부모 카드에 upcoming/current 동시 표출 |
| S17 | 핸드오프 GAP | 예비 → 발표 사이 1~수 사이클 공백 | (보류) extension memory 5분 내면 `time_ef_change` 로 분류, 5분 초과면 `publish` | — |
| S18 | 자식 깜빡임 (글리치) | 자식이 해제예고 없이 사라졌다 3분 내 복귀 | (보류) 3분 디바운스 ⚡ 로그만 | — |
| S19 | 시각 진동 (A→B→A) | 발효/해제시각이 3분 내 왔다갔다 | (보류) `_debounceTimeValues` 직전값 복원 | — |
| S20 | 발효 시각 도래 (예비→자동발효) | tm_ef 도달 → list 로 이관 | `CURRENT_CHANGE` → `active` (S3 와 동일) | — |
| S21 | endpoint 부분 실패 | 4 endpoint 중 1개라도 reject | cycle skip (E-4) — 마지막 state 유지, push 0 | — |
| S22 | 의심 사례 (mmis 빈 응답) | clrNtcTm 미등록 3+ zone 동시 사라짐 | curr 에 prev 복원 + 관리자 의심 알림 (현재 비활성) | — |
| S23 | 콜드 부팅 빈 prev | 재배포 직후 prev 없음 | E-1 가드, push skip 1회 (forceBaseline=true 시 우회) | — |
| S24 | 전체 사용자 재발송 (broadcastAll) | 관리자 UI 빨간 버튼 | resetState + forceBaseline + adminToken 없음 → 활성 특보 신규로 전 구독자 푸시 | — |
| S25 | 발표 발효대기 GAP | warn/list/ready 양쪽 모두 없고 warn/latest 만 있음 | `_enrichSnapshotWithLatest` 가 예비로 추가, 발효시각 도래 시 정상 active | — |
| S26 | mm=58/59 KMA 레거시 범위 | tm_ef 분 = 58 또는 59 | 6시간 블록 범위로 변환 ("00시~06시") | — |

---

# 5. 시행착오 히스토리

> **본 §5 가 Draft 3 의 핵심.**
> 시간선·인지심리적 추적·교정 패턴을 모두 기록.

## 5.1 시간선 (timeline) 한눈에 보기

날짜는 commit author date (UTC). 핵심 이벤트만.

```
2026-05-21 ─┬─ 16:51  95047ad  [BASE] push 부모+자식 통합 + 분할 (synthesis Q)
            │         · StateSnapshot/DiffMatrix/EventDispatcher 클래스 구조 채택
            │         · TITLE_DISPATCH 테이블 dispatch
            │         · S1~S26 시나리오 27/27 PASS 시점
            │
            ├─ 13:28  dd5b1d9  yebi 해제 정규식 V3 (10가지 어휘 변형)
            ├─ 13:15  e1077ac  yebi V2 (5가지)
            ├─ 07:23  5f62ebb  yebi 해제 push 추가 (옵션 B — 부모만)
            └─ 06:32  ad90bf0  Agent-B 옵션 C — 참고사항 해제/연장

2026-05-22 ─┬─ 03:13  082da8e  v7 통합 활성화 (followup base)
            ├─ 03:22  baf34fa  [E-1/E-2/E-4] 운영 안전성
            │         · E-1 빈 snapshot push skip
            │         · E-2 weather_alerts.json 매 cycle 갱신
            │         · E-4 4 endpoint 부분 실패 → cycle skip
            ├─ 05:07  a515853  [D-1/D-2/D-6] 시간 형식 변환 + 가드
            │         · D-1 가드에서 isFirstLoad 제거 (※ 나중에 재추가됨 → 30일 6df054a)
            │         · D-2 legacy refreshFn 차단
            │         · D-6 normalizeMmisTime 한글 형식 변환 + 자식 fallback (※ 후일 fallback 제거됨)
            ├─ 06:07  c761225  [Must-fix] fmtTime dot + D-medium 의심 가드 (옵션 C)
            ├─ 06:22  64cba8a  merge — D-medium 인프라
            ├─ 06:34  8998037  D-medium 인터랙티브 결정 + UI 정리
            │         · MAX_SUSPICIOUS_CYCLES 자동 처리 폐기 (인터랙티브로 전환)
            ├─ 06:50  abf8c57  D-medium reinforce silent dedup 차단 (B-2)
            ├─ 07:47  1870784  사용자 앱 UI 회귀 차단 (옛 데이터 구조 호환)
            │         · wrnTp/wrnLvl 한글 우선, tmCc=clrNtcTm 병기
            ├─ 08:14  f0477c6  해제예고 범위형 시간대 명칭 ("21~24시" → "밤(21시~24시)")
            ├─ 08:23  9651167  [핵심] 사용자 푸시 채널 복원 (push_sender 호출 누락)
            ├─ 08:42  6fcbdb5  사용자 push 보강 4건 (P1: UPCOMING_CHANGE 복원, P4: 시간대 매핑)
            └─ 15:31  dbe2c6b  [V10] warn/latest 엔드포인트 추가 — 정확 해제시각 보강

2026-05-24 ─┬─ 13:21  ff1fe17  예비특보 푸시 부활 + V/T allowlist + 미발효 한정사 버그
            │         · warn/ready·warn-sasc/ready 가 snapshot 에 병합 안 되던 구멍
            │         · '예비특보'→'예비' 정규화
            │         · denylist → V/T allowlist
            ├─ 13:34  378d64a  사용자 푸시 자식 한정사 토글 (childZones 기본 OFF)
            ├─ 13:35  a057b7f  관리자 푸시 콤마결합 양식 통일
            ├─ 13:39  a0d8ba3  야간 경계 22→23시 라벨 일치
            ├─ 14:35  640fd12  [표출] 특보 시각 표시 통일 (월·시단위·상대일자·범위)
            ├─ 14:42  5ea305b  관리자 푸시 시각 통일 + 리셋 경합 _forceBaselinePending
            ├─ 15:19  aeae518  관리자 푸시 전면 비활성 (ADMIN_PUSH_ENABLED=false)
            └─ 15:37  2c25c58  코드기반 해역명 매핑 (A안, 93개) + 테스트푸시 관리자전용

2026-05-25 ─┬─ 09:07  2a21b9c  "발표 발효대기" GAP 누락 보강 (warn/latest 에서 예비로 추가)
            ├─ 12:50  5a9e111  GAP 보강을 자식까지 확장
            ├─ 13:19  adab23e  [GAP 4건 일괄] 예비→발표 단체전이 복합버그
            │         · A) GAP 자식 prev 이어받기
            │         · B) 예비 zone 의심 제외 (clrNtcTm 없는 게 정상)
            │         · C) 의심 가드 자식 복원
            │         · D) 발표대기 해제예정 표시
            ├─ 13:33  f9e4340  GAP 발표대기 자식 합성 fallback (PARENT_TO_CHILDREN)
            ├─ 13:40  0049f2a  GAP 자식을 warn-sasc/latest 개별 통보문으로 표출
            ├─ 13:59  3705f4a  [원칙 확립] 자식 표출은 자식 개별 데이터에 기인 (부모 종속 제거)
            ├─ 14:21  f499308  자식 독립 푸시 (CHILD_ADD/CHILD_RELEASE) + 부모 fallback 제거
            ├─ 14:39  9d47ed3  자식 해제 3분 디바운스 (글리치 차단)
            ├─ 15:33  374923d  발효/해제 예정시각 **연장** 푸시 (신규 발표 오인 방지)
            └─ ……    7821092  자식 단독 연장 푸시

2026-05-26 ─┬─ 01:10  451f48e  [A] 발표시각 = 현재 발효 등급의 최초 발표시각 고정
            ├─ 01:16  5213c83  [B] 다가오는 특보 병렬 표출 (발효+공존 예비)
            ├─ 01:48  b411cea  2중 검토 반영 — 연장 감지 등급 가드 + upcomings 복원
            ├─ 02:22  fe0bda5  예비→발표 핸드오프 GAP — "발표" 오인 → "발효시각 변경"
            ├─ 13:16  2866fe0  [원칙 확립] 연장은 **범위형→더 늦은 범위형**일 때만
            │         · 정확시각 전환은 "시각 변경" 이 맞음
            ├─ 14:17  7c981d1  warn/latest 깜빡임 가짜 해제시각변경 차단 (정확값 고정)
            ├─ 14:45  b05ce1f  정확 해제시각 HOLD + 해제윈도우 기반 연장 판별
            ├─ 15:01  5ded869  발효시각도 동일 정책 (HOLD + 같은모멘트 무푸시 + 범위초과 연장)
            ├─ 15:16  a7bc5c9  정확시각 고정 보강 — 핸드오프 공백 + 자식 HOLD
            └─ 15:26  eb06efe  3분 디바운스 — 잔여 진동 푸시 차단

2026-05-30 ─┬─ 22:15  8a9a798  KMA 레거시 범위코드 mm=58/59 인식 (점·대시 형식)
            ├─ 22:33  6df054a  E-1 빈-prev 가드를 **콜드부팅 1회로 한정** (자연 전이 복원)
            ├─ 22:36  c94ea5e  관리자 UI '전체 사용자 재발송' 버튼 (broadcastAll)
            └─ 22:46  b786ece  mm=58/59 normalize 단계까지 보강 (방어 깊이)
```

## 5.2 결정적 시행착오 1: "사용자 푸시 채널 끊김" (5/22 — 머지 직후의 침묵)

### 5.2.1 발견 경위

`082da8e` 로 marine v7 통합을 활성화하고 hours 단위로 운영하던 도중,
**사용자에게 단 한 건의 푸시도 가지 않는 침묵 사고**가 관측되었다.
관리자 채널(dmdw_push_sender) 은 정상 동작 — 발효/해제/격상 등 변화 로그가
관리자 알림으로는 들어오는데, FCM 으로 일반 사용자에게는 안 나갔다.

### 5.2.2 잘못된 가정

처음에는 다음 두 가지를 의심했다.

- 잘못된 가정 A: "FCM 토큰 만료/구독자 정리 시점"
- 잘못된 가정 B: "관심해역 필터가 너무 좁다"

검증을 위해 routes/push.js 에서 토큰·구독자 수·필터 로그를 본 결과 **호출 자체가 없었다**.

### 5.2.3 진짜 원인

`9651167 fix(marine): 사용자 푸시 채널 복원` 커밋 메시지가 진단을 정확히 적었다.

> 옛 시스템: weather_alerts_crawler.js + report_alert_processor.js 가
> push_sender.processChanges() 호출 → 사용자 푸시 발사
> marine v7 통합 시 legacy 두 크롤러 비활성화 → push_sender 호출 경로 끊김
> marine_warning_crawler 가 dmdwPush (관리자) 만 호출, push_sender 누락

즉 V7 통합 시 push 의 **두 채널**(관리자 dmdw + 사용자 push_sender)이 있다는
사실을 한쪽만 옮긴 것이다. 관리자가 잘 가니까 잘 되는 줄 알았다.

### 5.2.4 교정

- `pushSender` require 추가 (graceful fallback)
- `_buildUserPushChanges(prev, curr)` 헬퍼 신설
  - 부모 zone 단위만 (V15 호환, 자식 정보 X — 후일 5/25 에 확장)
  - 변화 없는 zone skip
  - wrnTp/wrnLvl 한글 우선 (기존 push_sender 호환)
- `run()` dispatch 후 `pushSender.processChanges(changes)` 호출
- try/catch 격리 → 사용자 push 실패해도 관리자 push 영향 없음
- dryRun 모드 skip

### 5.2.5 후속 파급

이 커밋(8:23)이 떨어진 직후 20분 안에 `6fcbdb5`(8:42) 가 따라붙는다.
사용자 push 가 살아나자 **다음 결함**이 보이기 시작한 것이다.

- P1: `_buildUserPushChanges` 가 `CURRENT_CHANGE` 만 발사하고
  `UPCOMING_CHANGE` (예비 발표/시각변경) 가 빠져 있었다.
  → 옛 `weather_alerts_crawler.detectChanges` 패턴 (UPCOMING + CURRENT 양종) 복원.
- P2: `processChanges` 를 `userChanges.length > 0` 조건으로 가드했더니
  변화 없는 cycle 에 `pendingPushes.json` 재시도가 안 도는 문제.
  → 가드 제거, 빈 배열도 호출.
- P3: `CURRENT_CHANGE` 에 동봉되던 `currentActive` 가 dead field 였다 → 정리.
- P4: 시간대 매핑이 옛 통보문 어휘에 맞춰져 있었음 →
  DMDW 실측 (4 Agent 분석) 결과로 갱신.
  ```
  00~06 새벽 / 06~09 아침 / 09~12 오전 / 12~15 낮
  15~18 늦은 오후 / 18~21 저녁 / 21~24 밤
  ```

### 5.2.6 인지 추론 패턴

> "관리자 알림이 잘 가니까 시스템 전체가 동작한다" 라는 **부분 검증 편향**이
> 머지 직후 침묵의 직접 원인. 채널이 두 개라는 시스템 지식을 보유한 사람이
> 코드 리뷰에서 빠져 있었다.

**교훈**: V7 통합 같은 큰 머지 직후 30분간은 두 채널 모두 e2e 발사 1건씩
확인할 것. 후속 V11~V12 에서 사용자 push 의 회귀가 종종 다시 잡힌다.

## 5.3 결정적 시행착오 2: "자식 시간 필드 부모 fallback" (5/22 → 5/25 폐기)

### 5.3.1 처음의 가정 (D-6, `a515853` 5/22 05:07)

D-6 (B) 항목으로 다음과 같이 적혀있다.

> mmis warn-sasc/list 자식 응답에 시간 필드 없음.
> 자식 tmFc/tmEf/tmYn/clrNtcTm 을 **부모 값으로 fallback**.
> 자식 popup 시간 빈 칸 → 부모 시간 (범위형 포함) 표시.

당시 가정: "자식은 부모와 같은 시각 일정을 공유하므로 부모값을 상속해도 무방."

### 5.3.2 가정을 깬 신호 (5/25)

`5a9e111` (자식 GAP 보강), `0049f2a` (warn-sasc/latest), `3705f4a`
일련의 커밋에서 **반례** 가 누적되었다.

- 부모 발효 중인 zone 의 자식 1개만 해제예고가 와있음
- 부모 발효 중에 자식 2개는 발효, 자식 1개는 추가발효(미래)
- 같은 부모 밑 자식 3개가 각각 다른 정확 해제시각

특히 `3705f4a` 커밋 메시지의 결정적 진단:

> 라이브 e2e: 제주도남부앞바다중연안바다 자식이 발효예정 + 해제예정
> (26일 21~24시) 를 **자기 데이터로** 표출 확인.
> 과거 D-6(B) 의 "자식 시간필드 없음" 가정은 **실측상 오류** — 자식이 부모와
> 동일 스키마로 개별 제공함.

### 5.3.3 교정 (3705f4a → f499308)

**원칙**: 모든 특보 표출 필드는 각 부모/자식이 개별 제공하는 데이터에만
기인하고, 상속(종속)에 의존하지 않는다.

- `_rowToChildInfo`: 자식 고유 `clr_ntc_tm` 보존
- warn-sasc/latest 보강: 발효중 자식도 자기 통보문의 clr 로 보강
- `_buildZoneTreeFromSnapshot`: 자식 직렬화의 부모값 fallback 전면 제거
- `f499308`: 자식 종류·등급도 부모 fallback 제거 (자식 자기 데이터만)

### 5.3.4 후속 파급

- 자식 단독 푸시(`CHILD_ADD`/`CHILD_RELEASE`) 가 가능해짐 → S12/S13 시나리오.
- 자식 단독 연장 푸시(`CHILD_EF_EXTEND`/`CHILD_YN_EXTEND`) 까지 확장 (`7821092`).
- 자식 지도 팝업의 해제예정 표시 복원 (`a9cba9c`).

### 5.3.5 인지 추론 패턴

> "API 설계자가 자식에 시간 필드를 안 줄 거라" 라는 **공급자 친절도 추정**이
> 가정의 뿌리. 첫 관찰에서 자식이 빈값이라고 본 게 GAP 케이스(원본 부재)였는데,
> 다른 케이스에서는 자식이 자기 시각을 제공한다는 사실을 발견하기까지 3일 걸림.

**교훈**: 표출 필드의 출처 원칙은 **"항상 자신의 데이터를 우선, 없으면
명시적 합성"**. fallback chain 자체가 부정확성의 진원지가 될 수 있음.

## 5.4 결정적 시행착오 3: "warn/list 만으로 정확 해제시각 못 구함" → V10 (5/22)

### 5.4.1 발견

운영 중 동해남부북쪽바깥먼바다(`S1324010`?) 같은 zone 에서
**해제예정 표시가 범위형 "23일 3시 ~ 6시"** 로 나가는데, KMA 사이트는
**정확 시각 "2026.05.23 01:00"** 으로 표출하고 있었다.

### 5.4.2 진단

`dbe2c6b feat(marine): V10` 커밋 메시지:

> mmis 의 warn/list 응답은 "현재 발효 상태" 만 제공하므로 해제예고가
> 범위형 텍스트("23일 3시 ~ 6시") 로만 노출되고 정확한 해제시각은 빠진다.
> 반면 warn/latest 응답은 같은 zone 에 대한 "가장 최근 통보문" 을 제공하며,
> 해제 통보문 발행 시 tm_ef 에 정확한 시각이 들어있다 (사전등록까지 포함).

즉 **endpoint 가 두 층**이라는 것을 처음 발견.

- `warn/list` = 현재 상태 (snapshot view) — 정확 해제시각 없음
- `warn/latest` = 통보문 view — 해제 통보문이면 tm_ef 에 정확 시각

### 5.4.3 교정

- `marine_client.js`: `fetchWarnLatest`, `fetchWarnSascLatest` 추가 (비로그인)
- `marine_warning_crawler.js`: `_enrichSnapshotWithLatest` 신규
  - 해제 통보문이 있으면 parent zone 의 `clrNtcTm` 갱신 (정확 시각)
- `run()`: list/ready fetch 후 latest 호출 → 보강
- 실패 시 graceful — 기존 cycle 흐름 영향 없음

검증: "23일 3시 ~ 6시" → "2026.05.23 01:00" 갱신 확인.

### 5.4.4 V10 가 만든 새 문제 — 깜빡임 (5/26)

V10 이 정확 해제시각을 보강했지만 **warn/latest 응답이 들쭉날쭉**.
한 사이클이라도 latest 가 안 오면 warn/list 의 범위형으로 되돌아가
**"해제시각 변경" 가짜 푸시가 반복**.

`7c981d1` 가 이를 잡았다:

- `_timeKey`: 범위형은 일관되게 끝 시각 사용 + `24시 = 다음날 00시` 정규화
- `_sameReleaseMoment()`: 범위↔정확이 같은 모멘트인지 판별
- `blockEqual(해제예정)`: 같은 모멘트면 동일로 봄 → `CURRENT_CHANGE` 가짜 푸시 차단
- `_applyAnnounceAnchor`: 직전 정확값이 같은 모멘트면 범위로 되돌리지 않음

그러나 깜빡임만 막은 게 아니라 **정확값 자체를 HOLD** 해야 한다는 더 큰
요구가 발견되었고, `b05ce1f` 에서 **해제윈도우** 개념을 도입한다 (§5.5).

### 5.4.5 인지 추론 패턴

> "API 한 종류만 호출하면 모든 정보를 얻는다" 라는 **단일 진리원 가정**.
> 실제로는 endpoint 별 view 가 다르다는 점을 처음에 인지하지 못함.
> **MMIS 의 list = 상태, latest = 통보문** 이라는 dual-view 가 핵심 통찰.

## 5.5 결정적 시행착오 4: "연장 = 더 늦은 시각" 의 오류 (5/26)

### 5.5.1 처음의 정의

`374923d feat: 발효/해제 예정시각 연장 푸시` (5/25) 의 초기 구현:

> "기존보다 늦어짐(kn>ko)" 만으로 연장 판정

이 정의는 직관적이지만 **범위형 → 정확형 확정**까지 연장으로 잡았다.
예: 예비 발효예정 "26일 21시~24시" → 정확 "27일 00시" 는 같은 모멘트(24시=다음날 00시)
인데도 "기존보다 늦음" 으로 연장 처리.

### 5.5.2 가정을 깬 신호

`2866fe0 fix: 연장은 "범위형→더 늦은 범위형"일 때만` 커밋 메시지:

> 정확시각이 나온 건 특보 **확정·명확화**이지 기간 연장이 아니므로
> "해제/발효 시각 변경"이 맞다.

### 5.5.3 교정 (원칙 확립)

- `_isRangeTime()` 헬퍼: `~` 포함 여부로 범위형 판별
- **연장 조건**: 기존도 범위형, 변경 후도 범위형, 그리고 더 늦음
- **정확시각이 끼면 연장 제외** → `CURRENT/UPCOMING_CHANGE` (시각 변경) 로 분류

### 5.5.4 2차 교정 (등급 가드 추가, b411cea)

검토관 2 가 발견:

> 연장 감지가 종류만 보고 등급은 안 봐서, **격상/격하 발효인데** 해제예정
> /발효예정이 더 늦으면 "연장"으로 오분류 → 격상/격하 푸시가 사라지던 문제.

수정:

- `ynExtend`/`efExtend`/자식연장에 **동급(level) 가드** 추가
- 등급 다르면 `CURRENT_CHANGE`(격상/격하) 로 처리
- `_extensionMemory` 가 parents 만 기억하던 것을 phase(active/upcoming) 분리 +
  upcomings 기록 + wrnLvlNm 저장

### 5.5.5 인지 추론 패턴

> 첫 정의가 "사용자 지각 = 늦어지면 연장" 이라는 자연어 직관에 기댐.
> 그러나 **범위→정확** 은 시간이 늦어진 게 아니라 **불확실성이 줄어든** 것.
> 정보이론적으로 다른 사건이다.
>
> 또 격상/격하 케이스는 **연장 판정이 다른 더 중요한 이벤트를 먹어버리는**
> 부작용을 가짐. **이벤트 우선순위**를 동급으로 분류하면 안 됨.

## 5.6 결정적 시행착오 5: "해제시각 HOLD 와 윈도우 개념" (5/26)

### 5.6.1 문제

V10 정확값 보강 후 깜빡임은 §5.4.4 에서 막았으나, 다음 케이스가 남았다.

- 범위 "23일 3시~6시" → 정확 "23일 01시" (변경 1회)
- 그 후 latest 가 빠짐 → list 범위로 되돌아감 → 가짜 깜빡임
- 또 누군가 새 범위 "23일 6시~9시" 로 KMA가 실제 연장 발표 → 진짜 연장

**같은 zone 의 시각 변화를 어떻게 분류할 것인가?**

### 5.6.2 해결 — 윈도우 개념 (b05ce1f)

> 정확 해제시각이 발표되면 MMIS 해제 신호 전까지 그 값을 고정(범위형으로 안
> 되돌림). "해제 윈도우"(처음 확립된 범위 끝)를 추적해 — 윈도우 안의 정확시각은
> 고정(해제시각 변경 1회), 윈도우를 넘어선 해제시각은 연장으로 판별한다.

구현:

- `_clrWindowEnd`: zone 별 해제 윈도우 끝 시각키 추적
- `_applyReleaseClrLogic`:
  - 윈도우 안 = 정확값 고정 (깜빡임/되돌림 방지)
  - 윈도우 초과 = `_clrExtend` 플래그 (연장)
  - 해제 시 윈도우 정리
- `_buildUserPushChanges`: `_clrExtend` → `YN_EXTEND`

### 5.6.3 발효시각도 동일 정책 (5ded869)

사용자 지적:

> 해제시각에 적용한 정책을 발효시각에도 동일하게 적용 — 동일한 깜빡임/가짜푸시 문제가
> 발효시각에서도 가능하므로.

- `_applyUpcomingEfLogic`: 예비/발표대기 발효예정의 윈도우 추적
- `blockEqual`: tmEf 도 같은 모멘트(범위끝=정확)면 동일로 봄
- 후속: `_applyTimeWindowHold` 공통 함수로 통합 (a7bc5c9)

### 5.6.4 핸드오프 공백 보강 (a7bc5c9 #1)

> HOLD 가 직전 스냅샷만 봐서, 1사이클 공백으로 해역이 사라지면 고정 기준을 잃고
> 범위로 되돌아가 가짜 "발효/해제시각 변경" 푸시가 날 수 있던 문제.

- HOLD 가 직전 스냅샷에 정확값이 없으면 **최근(5분) 기억 `_extensionMemory`** 도 참조

### 5.6.5 자식 HOLD 추가 (a7bc5c9 #2)

> 발효/해제 예정시각 고정 로직이 부모에만 적용돼 자식은 범위↔정확 표출 깜빡임 가능.
> → 자식도 직전 정확값으로 고정(표출 안정화). 윈도우/연장은 부모만(자식 연장은 기존 CHILD_*_EXTEND).

### 5.6.6 추가 안전망 — 3분 디바운스 (eb06efe)

HOLD 가 막지 못하는 잔여 오실레이션 (MMIS 가 값 자체를 흔들거나 5분+ 공백) 대비:

> 발효/해제예정 새 시각값이 3분(연속) 유지될 때만 변경/연장 푸시 발송.
> 그 전엔 직전 확정값으로 되돌려 표출·푸시·연장플래그 모두 보류.
> 값이 진동(A→B→A)하면 확정 안 되어 푸시 0건. 최초값(신규 발표/발효)은 즉시 수락.

- `_debounceTimeValues(curr)`: zone|field 별 확정값/펜딩 추적
- `_sameReleaseMoment` 로 형식 차이는 변경으로 안 봄
- `run()` 4-F (HOLD 직후, diff 전) 호출

### 5.6.7 인지 추론 패턴

> 처음에는 "단순 비교 (prev vs curr)" 만으로 모든 변화를 잡으려 했음.
> 그러나 **MMIS 가 같은 정보를 다른 형식으로 깜빡이는** 노이즈를 다루려면
> **상태 메모리**(윈도우, HOLD, 5분 메모리, 3분 디바운스) 가 다층으로 필요.
>
> 이 시리즈 (7c981d1 → b05ce1f → 5ded869 → a7bc5c9 → eb06efe) 가
> **5/26 하루 동안 8커밋** 으로 누적된 이유: 한 층의 안전망을 추가할 때마다
> **다른 코너 케이스**가 노출됨. 마지막 디바운스가 "메모리 다층화의
> 마지막 펜스".

## 5.7 결정적 시행착오 6: "예비 → 발표 GAP" (5/25 ~ 5/26)

### 5.7.1 발견 — 5/25 단체 전이

5/25 오전 제주 zones 가 단체로 예비→발표 전이를 했는데 그 과정에 **GAP** 이
발생. GAP = MMIS 의 endpoint 4 종 어디에서도 해당 zone 이 잠시 사라지는 구간.

증상 복합 4건 (`adab23e`):

1. **자식 누락**: warn/latest 가 "부모만" 주고 자식 행은 없어 자식이 사라짐 →
   "특보 없음" 표출, 푸시 본문 "(연안바다 미발효)"
2. **미발효 라벨**: 예비를 발표대기로 carry 못해 부모도 사라짐
3. **의심 오판**: 예비 zone 이 사라지는 건 정상(취소/발표전이) 인데
   clrNtcTm 없어 의심으로 오분류 → 단체 이탈 시 의심 가드 폭주
4. **해제예정 숨김**: 발효 전(isPreliminary) 이면 무조건 해제예정 숨기던 것 →
   실제 해제예고 값(clrNtcTm)이 있어도 미표시

### 5.7.2 교정 4건

- [A] GAP 자식 prev 이어받기: `_enrichSnapshotWithLatest` 가 warn/latest 에
      자식행이 없으면 prev (예비 때) 자식을 발표대기로 carry
- [B] 예비 의심 제외: `_classifyReleases` 에서 '예비'는 의심 대상 제외
- [C] 의심 가드 자식 복원: `_applySuspiciousGuard` 가 prev.children 도 복원
- [D] 발표대기 해제예정 표시: render.js / render_coastal.js 가 isPreliminary 여도
      clrNtcTm 값이 있으면 표시

### 5.7.3 후속 보강 — fallback chain

`f9e4340` 에서 prev 가 비어있는 경우(이미 GAP에서 자식을 잃은 케이스) 의
**2순위 fallback**:

- `PARENT_TO_CHILDREN` 매핑으로 자식 합성 (부모 발효예정/해제예고 상속, 예비)
- MMIS 가 GAP 에서 자식을 부모로부터 상속해 표출하는 동작과 동일

`0049f2a` 에서 **1순위로 격상** — warn-sasc/latest endpoint 가 자식판
"가장 최근 통보문" 을 줘서 각 자식의 개별 warn_tp/cmd/tm_ef/clr_ntc_tm 보유:

- `_enrichSnapshotWithLatest` 에 `warnSascLatest` 처리 추가
- 부분집합 정확 반영 ("자식 3개 중 2개만 발표" 같은)
- PARENT_TO_CHILDREN 합성은 sasc/latest 미커버 시 최후 fallback

### 5.7.4 발표 자체의 GAP — `2a21b9c`

> 예비→발표 전환(또는 예비 없이 직접 발표) 시, 발표시각은 지났으나 발효시각이
> 아직 미래인 "발표 발효대기" zone 은 warn/list(발효중)·warn/ready(예비) 어디에도
> 없고 **warn/latest 에만 존재** → 우리 크롤러가 누락.

수정: `_enrichSnapshotWithLatest` 확장 — 발표/변경/연장 + 정확·미래 발효시각 +
미존재 부모는 **예비로 추가** (정확한 tm_ef 보존).

### 5.7.5 부모 GAP "발표" 오인 — `fe0bda5`

> MMIS 가 예비에서 빼고(잠깐 공백) 발표로 다시 넣는 핸드오프 과정에서 우리
> 스냅샷에서도 해역이 잠깐 사라졌다 재등장 → prev 가 비어 **"신규 발표"로 오인**.

교정:

- `_extensionMemory` 에 발표시각(tmFc) 저장
- `_buildUserPushChanges`: 예비가 최근(5분 내) 기억에 있는데 prev 가 비면 직전
  예비를 복원 → push_sender 가 발표 대신 `time_ef_change` 로 발송
- `_applyAnnounceAnchor`: prev 체인이 끊겨도 최근 기억의 발표시각으로 고정 유지

### 5.7.6 인지 추론 패턴

> "MMIS 의 endpoint 가 같은 시각엔 일관된 상태를 보여준다" 라는 **원자성 가정**.
> 실제로는 list/ready/latest 가 **시각적으로 약간씩 어긋나는** 분산 상태.
> 한 endpoint 의 zone 등장 ≠ 다른 endpoint 의 zone 등장.
>
> 이를 다루는 방법은 **endpoint 간 cross-fill + 시간 메모리** 다층.
> §5.6 의 HOLD/디바운스 와 같은 맥락. **5/25~5/26 양일은 GAP 와 HOLD 가
> 거의 모든 커밋의 동기**.

## 5.8 결정적 시행착오 7: "E-1 가드의 두 번 재정의" (5/22 → 5/30)

### 5.8.1 V1 — `baf34fa` (5/22 03:22)

> [E-1] 첫 cycle 가드 (push skip + state 저장만)
> - isFirstLoad + _loadPrevSnapshot 결과 empty → diff/dispatch 모두 skip.

원래는 **첫 부팅 + 빈 prev** 양쪽이 다 충족돼야 가드 발동.

### 5.8.2 V2 — `a515853` D-1 (5/22 05:07)

> [D-1 (가드 완화)]: 빈 snapshot 가드 조건에서 isFirstLoad 제거
> - 첫 부팅 + endpoint 부분 실패 후 빈 snapshot 으로 lazy set 된 케이스도
>   push skip + state 저장만 동작

이유: E-4 partial fail 후 빈 snapshot 으로 prev 가 lazy set 된 케이스도
폭주 위험. 그래서 isFirstLoad 조건을 풀어 **빈 prev 면 무조건 skip** 으로 변경.

### 5.8.3 V2 가 만든 새 문제

`6df054a` 커밋 (5/30):

> 기존 가드는 prev 가 비어있으면 매 사이클 fire → **장기간 무특보 후 새 특보 발효 시
> "첫 부팅 — push skip" 으로 정상 발표 푸시까지 차단**.

장기간 무특보 = prev 가 텅 빈 상태로 누적된 상태에서, 어느 사이클에 새 특보가
실제로 발효되면 E-1 가드가 이를 "첫 부팅" 으로 오해해서 푸시를 막아버린 것.

### 5.8.4 V3 — `6df054a` (5/30)

`isFirstLoad` 조건을 **다시 추가** — `isFirstLoad && _isSnapshotEmpty(prev)` 일 때만.

> 재배포/장부 초기화 직후 콜드 부팅 1회만 차단하도록 정밀화.
> 자연 전이(이미 가동 중인 프로세스에서 무특보→신규특보)는 통과시켜 정상 push.

### 5.8.5 인지 추론 패턴

> 5/22 D-1 의 "E-4 partial fail 후 빈 snapshot" 케이스를 막으려고 가드를 강화했더니
> "정상 자연 전이" 까지 막아버렸다. 이는 **방어막이 정상 신호도 막는 false positive**.
>
> 해결책은 V3 처럼 "prev 의 비어있음 + 이번 cycle 이 진짜 콜드부팅인가" 라는
> **두 조건의 conjunction** 으로 정밀화. V2 의 "isFirstLoad 제거" 단순화가
> 보안적으로는 보수적이었지만 **운영적으로는 부정확**했음.
>
> 같은 가드의 V1 → V2 → V3 가 약 9일에 걸쳐 두 번 뒤집힌 것은 운영 실측
> 없이는 어떤 가드도 안정화될 수 없음을 보여주는 표본 사례.

## 5.9 결정적 시행착오 8: "예비 → 발효 전이 누락" (V/T allowlist + '예비특보' 정규화)

### 5.9.1 발견 — `ff1fe17` (5/24)

운영 중 **예비특보 푸시가 전혀 발사되지 않는** 구멍이 발견됨.

진단:

> warn/ready, warn-sasc/ready 를 스냅샷에 병합하지 않음 (기존엔 fetch만 하고 버려져
> 예비특보 푸시가 전혀 발사되지 않던 구멍).

즉 5/22 의 v7 통합본은 `warn/ready` 를 호출은 했지만 snapshot 에 합치지 않고
**그냥 버렸다**. 이유: 예비 처리 로직이 legacy 코드에 있고 marine 통합에서
누락됨.

### 5.9.2 동시 발견 — 등급명 정규화

> 등급명 정규화: mmis 실시간은 '예비특보' 로 내려주나 내부 로직은 '예비' 비교라
> 판정 실패하던 문제 → `_normLvlNm` 으로 '예비특보'→'예비'.

이는 legacy 와 MMIS 의 어휘 차이. MMIS 는 `warn_lvl_nm = "예비특보"` 로 주고
내부 로직은 `"예비"` 로 비교. 단어 끝 "특보" 하나 차이로 발견까지 며칠 걸림.

### 5.9.3 동시 발견 — denylist 결함

> 특보종류 allowlist 전환: 실시간 endpoint 는 문자코드(V풍랑/T태풍/W강풍/O폭풍해일)
> 인데 기존 'warn_tp===5'(숫자) 제외라 무력 + denylist 구조라 강풍/폭풍해일이
> 유입되던 결함 → V/T 만 통과하는 allowlist 로 교체.

이중 결함:

- `'warn_tp===5'` (숫자) 비교는 MMIS 가 문자 코드(`'V'`/`'T'`)를 주므로 무력
- denylist 구조라 정의되지 않은 새 코드는 다 통과 → 폭풍해일(O)/강풍(W) 유입

라이브 데이터 검증: 강풍(W) 16건·폭풍해일 0건 유입 → allowlist 차단.

### 5.9.4 동시 발견 — 자식 한정사 버그

> [작업1] 자식 없는 먼바다에 "(연안바다 미발효)" 가 잘못 붙던 버그
> - `buildChildQualifier`: `PARENT_CHILD_TYPE` 미등록 부모는 빈 한정사 반환.

자식이 정의되지 않은 먼바다 zone(예: `남해서부동쪽**먼바다**`) 에까지
"(연안바다 미발효)" 한정사가 붙던 표시 버그.

### 5.9.5 인지 추론 패턴

> "옛 시스템에서 잘 되던 것이 새 시스템에서도 잘 될 것" 이라는 **이관 무결성 가정**.
> 실제로는 endpoint 의 데이터 형태 변화 (숫자→문자 코드, 한글 어휘 차이)와
> 처리 로직의 분기 (denylist→allowlist) 양쪽에서 silent 결함이 가능.

## 5.10 결정적 시행착오 9: "발표시각이 매 사이클 덮어써짐" (5/26 451f48e)

### 5.10.1 발견

발표시각(tmFc)이 통보문마다 갱신되고 있었다. 사용자 시점에서는 "이 특보의
처음 발표 시점" 이 무엇인지 알고 싶은데, 변경/연장 통보문이 올 때마다
tmFc 가 그 시점으로 바뀜.

### 5.10.2 교정 (A — anchor)

> 발표시각을 **현재 발효등급의 최초 발표시각으로 고정**.
> 격상/격하·종류 변화 시에만 새 등급의 발표시각으로 재설정.

- `_applyAnnounceAnchor(prev, curr)`: 직전 cycle 에 같은 종류·동급이 있으면
  그 tmFc 를 이어받음.
- 신규/격상격하/종류변경이면 현재 tmFc 가 새 앵커.
- 부모·자식 모두 적용.
- 스냅샷 체인에 영속 — 별도 저장소 불필요.

한계 명시: 콜드스타트로 예비를 못 본 채 발효부터 관측하면 그때 tmFc 가
앵커 (best-effort).

### 5.10.3 동시 — 다가오는 특보 병렬 표출 (B — 5213c83)

> 발효중 해역에 다른 등급/종류의 예비특보가 와도 "발효 우선"으로 드롭되어
> 병렬 표출이 안 되던 문제.

- StateSnapshot 에 `upcomings Map` 추가 (+JSON 영속)
- `_buildSnapshotFromMarine`: 발효중 zone 의 공존 예비를 드롭 대신 upcomings 에 보관
- `_buildZoneTreeFromSnapshot`: leaf.current(발효) + leaf.upcoming(공존 예비) 동시 채움
- `_buildUserPushChanges`: 공존 예비도 UPCOMING_CHANGE 푸시 (발효는 재발사 안 함)
- `_applyAnnounceAnchor`: 격상/격하 발효 시 직전 공존 예비의 발표시각을 새 발효 등급에 인계

### 5.10.4 인지 추론 패턴

> 처음 모델은 "각 zone 에 하나의 (발효 또는 예비) 상태" 라는 단일 상태 가정.
> 실제는 zone 당 phase 가 **2 개 병렬 가능** (발효 주의보 + 예비 경보 같이).
>
> 이 발견은 §5.5.4 등급 가드 (b411cea) 와 함께 패치되었음.
> "같은 zone 의 같은 특보 종류라도 등급/phase 가 여럿 가능" 이라는 모델 확장.

## 5.11 결정적 시행착오 10: "자식 글리치 디바운스 3분" (9d47ed3)

### 5.11.1 문제

자식이 **해제예고 없이** 데이터에서 사라지는 케이스가 관측됨. 이는 두 가지일 수 있다:

1. **진짜 해제** (관리자 사전 미등록)
2. **글리치** — MMIS 의 데이터 깜빡임으로 잠시 빠짐

V/V 가 구분 못 하면 "일부 해제" → "추가 발효" 가짜 푸시 쌍이 날아간다.

### 5.11.2 교정 (9d47ed3)

> 자식이 "해제예고(해제 통보문) 없이" 데이터에서 사라지면 글리치로 의심하여
> **3분간 직전 자식을 이어받기(carry)**. 3분 내 복귀하면 가짜 "일부 해제"/
> "추가 발효" 푸시와 화면 깜빡임을 억제하고 "⚡ 깜빡임 감지(글리치)" 로그를
> 남긴다. 3분 경과 후에도 없으면 진짜 해제로 확정 발사. 단, warn-sasc/latest
> 에 해제 통보문(cmd=해제)이 있는 자식은 관리자 사전등록 해제로 보고 즉시 해제.

- `_applyChildReleaseDebounce(prev, curr)`: curr 변형(이어받기) → diff·표출 양쪽 반영
- `_enrichSnapshotWithLatest`: `_childReleaseNoticeSet` (해제 통보문 자식) 수집
- `run()`: 의심 가드 직후 호출
- 로그: 디바운스 시작 / 깜빡임 감지(글리치) / 해제 확정 / 정상 해제(해제예고)

### 5.11.3 인지 추론 패턴

> "데이터 사라짐 = 사실로 사라짐" 이라는 **현재성 가정**.
> 실제는 **데이터 사라짐 ⊂ {진짜 해제, 글리치, GAP}** 의 3-fold 분기.
>
> 해결책: **N분 디바운스 + 직교 검증 신호** (해제 통보문 = 즉시 해제 신호).
> 디바운스 단독은 진짜 해제까지 3분 늦추는 비용이 있지만 통보문 신호로 우회.

## 5.12 결정적 시행착오 11: "야간 경계 라벨 22 vs 23" (a0d8ba3)

### 5.12.1 문제

UI 라벨에는 `야간 23:00~07:00` 으로 표시되는데 실제 차단 로직은 `>=22` 였다.
22~23시 푸시가 라벨 기대와 달리 차단됨.

### 5.12.2 교정

야간 수신거부 경계를 22시 → 23시로 수정.

### 5.12.3 인지 추론 패턴

> 표시와 로직의 silent 어긋남 — 사용자 신뢰 손상의 미세 균열.
> 작은 1시간 차이지만 "맞게 표시되어 있을 줄 알고 푸시 받는 사용자" 의
> 22시대 푸시가 모두 차단된 셈.

## 5.13 결정적 시행착오 12: "관리자 푸시 비활성" (aeae518, ADMIN_PUSH_ENABLED=false)

### 5.13.1 문제

5/24 작업2 (`378d64a`) 로 사용자 푸시에 자식 한정사 토글이 포함된 후, 관리자
(dmdw) 채널이 **중복**되는 상태가 됨. 관리자 폰에 사용자 push 와 dmdw push 가
이중으로 도착.

### 5.13.2 교정

`ADMIN_PUSH_ENABLED=false` 게이트로:

- `runDiffAndPush` (정상 발표/발효/해제 관리자 푸시) 호출 skip
- `_enqueueSuspiciousAlert` (의심사례 알림) early return
- `_enqueueImmediateRelease` 의 dmdw 발사 skip (prev 정리는 유지)

**중요**: 의심 가드 로직(`_applySuspiciousGuard` 해제 보류)은 데이터 안전장치라
**그대로 유지** — 알림 푸시만 끔.

### 5.13.3 인지 추론 패턴

> 채널 통합 후 **중복 전송**이라는 새 결함이 발생.
> 해결책은 한쪽 채널 전면 비활성 + 안전장치 로직만 분리 보존.
> 이는 5/22 §5.2 의 "한쪽 채널만 옮긴" 실수의 반대 케이스 — **양쪽 모두 발사하는** 실수.

## 5.14 결정적 시행착오 13: "사용자 앱 UI 데이터 구조 호환" (1870784)

### 5.14.1 문제 — 머지 후 사용자 앱

- 뱃지 "V 주의보" 표시 (한글 "풍랑" 대신 mmis 코드 노출)
- 지도 특보구역 ON 안 됨 ("특보 없음")
- 자식 popup 해제예정 "정보 없음" (clrNtcTm 미인식)

### 5.14.2 원인

사용자 앱 (`js/data.js:269`, `ocean_warn_active*.js` 등) 이 옛 dmdw 구조 가정:

- `wrnTp` 가 한글 "풍랑" (mmis 는 "V" 코드)
- `wrnLvl` 이 한글 "주의보" (mmis 는 "2" 코드)
- `tmCc` 가 해제예고 (mmis 는 `clrNtcTm` 만 줌)

marine 시스템이 mmis raw 구조 그대로 저장 → 다운스트림 불일치.

### 5.14.3 교정

`_buildZoneTreeFromSnapshot` 에서 옛 구조 호환 변환:

- `wrnTp = wrnTpNm || wrnTp` (한글 우선)
- `wrnLvl = wrnLvlNm || wrnLvl` (한글 우선)
- `tmCc = clrNtcTm` (옛 필드 병기)
- `clrNtcTm` 도 보존 (신규 코드 호환)
- 부모 + 자식 entry 모두 동일 처리
- 다운스트림 코드 무수정으로 회귀 차단

### 5.14.4 인지 추론 패턴

> "백엔드 데이터 모델은 raw 가 깔끔하다" vs "다운스트림(앱)은 옛 모델에 의존".
> 두 진리원이 충돌. 해결책은 **출력층에서 dual-field 어댑팅** —
> 옛 필드와 신 필드 양쪽을 동시에 채워 다운스트림 무수정으로 회귀 차단.

## 5.15 결정적 시행착오 14: "시각 표시 통일" (640fd12)

### 5.15.1 문제 — 표시 일관성 부족

앱과 푸시의 발표/발효/해제 시각이 각자 다른 포맷:

- `"18:00:00"` (초까지)
- `"2026-05-26 18:00"` (ISO)
- `"5월 26일(내일) 18시"` (자연어)
- 범위 끝 `"00시"` vs `"24시"`
- 예비 발효예정 `"23~23시"` (degenerate)

### 5.15.2 교정 — 통일 규칙

> - 분·초 제거 → 시단위 ("18:00:00" → "18시")
> - 월 포함 ("5월 24일 18시")
> - 상대일자 라벨: 오늘/내일/모레/글피/그글피, 그 이후·과거는 라벨 없음
> - 범위 끝 0시 → 24시 ("18~00시" → "18시~24시")
> - 명시적 3h/6h 범위는 그대로 보존 (해제예고 "21시~24시" 등)
> - degenerate(시작==끝, 예비 발효예정 "23~23시")만 6시간 블록 스냅 → "18시~24시"
>   (예비특보는 최근 1개월 전부 6시간 단위 확인 — mmis API degenerate값 보정)

적용:

- `js/utils.js formatWarningTime`: 핵심 표시 포맷터 재작성
- `js/render.js formatAlertTime` / `js/render_coastal.js stripYearMonth`: 월 제거 폐지
- `services/push_helpers.js`: `formatWarnTimeKST` 추가, generateMessage fmt 통일
  (브라우저/노드 두 런타임이라 로직 복제 — 변경 시 동기화 주석 명시)

### 5.15.3 후속 — 관리자 푸시도 통일 (5ea305b)

> 관리자 푸시 경로가 시각 표시 통일에서 빠져 옛 포맷("25일 18:00") 유지
> - `push_helpers.fmtTime` → `formatWarnTimeKST` 위임
> - `dmdw_push_sender.fmtTime` → `push_helpers.formatWarnTimeKST` 위임

### 5.15.4 후속 — 콤마결합 (a057b7f)

> 관리자 푸시도 사용자 푸시처럼 부모해역을 ㅇ 줄마다 나누지 않고
> 단일 ㅇ 아래 ", " 로 결합한다. 자식 한정사는 각 부모 옆 괄호로 유지.

### 5.15.5 후속 — 푸시 시각에서 상대일자 라벨 제거 (2829a0e)

푸시 메시지에서 "오늘/내일/모레" 라벨 제거 (앱 표출에만 유지).

## 5.16 결정적 시행착오 15: "KMA 레거시 분=58/59 범위 인코딩" (8a9a798 → b786ece)

### 5.16.1 발견

MMIS `warn/ready` 의 발효예정 tm_ef 가 `"2026.06.01 05:58"` 처럼 정확시각
형식으로 오는데, **분(mm)=58/59 는 KMA 레거시 범위 인코딩**으로 "해당 6시간
블록의 끝" 을 의미한다는 사실 발견.

### 5.16.2 V1 — 8a9a798 (5/30 22:15)

12자리 형식엔 변환 처리가 있었으나 점·대시 형식에는 없어서 `"05시 58분"`
정확형으로 잘못 표출되던 문제.

- `formatWarningTime` (utils.js): HH:MM 분기에서 mm=58/59 면 hh 가 속한
  6시간 블록 범위("00시~06시" 등) 로 표출
- `formatWarnTimeKST` (push_helpers.js): 동일

### 5.16.3 V2 — b786ece (5/30 22:46)

V1 의 결함: 서버 `normalizeMmisTime` 이 `"2026.06.01 05:58"` →
`"2026년 06월 01일 05시 58분"` 으로 변환하면서 분=58 그대로 유지 →
프론트 `formatWarningTime` 의 **한글 시각 경로**(H시 M분)에서 `fmtExact` 가
실행되어 `"6월 1일(내일) 05시 58분"` 으로 표시됨.

수정 — 3층 방어:

- `marine_warning_crawler.js normalizeMmisTime`: 분=58/59 감지 시 그 시점에
  6시간 블록 범위로 변환
- `js/utils.js formatWarningTime` (H시 M분 경로): 동일 보강 (방어 깊이)
- `services/push_helpers.js fmtUserKMA` (H시 M분 경로): 동일 보강 (푸시 메시지)

### 5.16.4 인지 추론 패턴

> "신규 API 가 정확한 시간 데이터를 줄 것" 이라는 **API 신뢰 가정**.
> 실제로는 KMA 가 legacy 시스템과 호환을 위해 **분=58/59 = 6시간 블록 끝**
> 이라는 알게 모르게 끼워둔 인코딩 컨벤션을 그대로 유지.
>
> V1 → V2 의 30분 시차 교정은 **방어 깊이(defense in depth)** 원칙의 사례 —
> normalize/format 양쪽에서 모두 패치해야 한 곳의 회귀를 막을 수 있음.
>
> 또한 이 케이스는 **트레이드오프**가 있음: 실제 발효시각이 정말 58/59분인
> KMA 케이스가 있다면 6시간 블록으로 오표시. 그러나 운영 실측상 KMA 가
> 실분=58/59 를 의도해서 쓰는 경우는 없다고 판단해 트레이드오프 수락.

## 5.17 결정적 시행착오 16: "D-medium 의심 가드 자동 처리 → 인터랙티브 전환" (c761225 → 8998037)

### 5.17.1 V1 — c761225 (옵션 C)

> mmis 빈 응답 시 release 푸시 폭주 위험 방어
> - clr_ntc_tm 등록 zone 은 정상 해제로 인정 (사전 예고)
> - clr_ntc_tm 미등록 zone 이 3개 이상 사라지면 의심 cycle
> - 10 cycles (10분) 지속 시 강제 해제 인정 (시간 제한)
> - 디스크 영속화 (marine_suspicious_state.json)

### 5.17.2 V1 의 한계

> MAX_SUSPICIOUS_CYCLES 10 cycles 강제 release 로직 — 자동 처리.
> 실제 mmis 가 10분 넘게 빈 응답인 경우 결국 release 폭주 가능.

또한 진짜 해제인지 글리치인지 자동 결정은 위험 — 잘못 자동 release 하면
사용자에게 "특보 해제 알림" 가짜 푸시.

### 5.17.3 V2 — 8998037 (인터랙티브)

> [D-medium 인터랙티브 — 10분 자동 처리 폐기]
> - MAX_SUSPICIOUS_CYCLES 10 cycles 강제 release 로직 제거
> - SUSPICIOUS_THRESHOLD=3 + PUSH_REINFORCE_INTERVAL=10분 유지
> - 새 의심 사례 → currentCase 생성 + 1차 push 즉시 발사
> - 10분 경과 cycle → 재push + lastPushAt 갱신 (자동 처리 X)
> - decideSuspiciousCase('normal') → release push 즉시 발사 + currentCase 리셋
> - decideSuspiciousCase('invalid') → currentCase 유지 + lastPushAt 만 리셋
> - mmis 회복 시 auto-reset + history 기록 (최근 20건)

`/api/admin/marine/suspicious` 조회 API + `/decide` 결정 API.
관리자 페이지에 결정 UI 카드 + 결정 이력 카드.

### 5.17.4 V2 의 부작용 — silent dedup (abf8c57)

> 의심 사례 reinforce push (10분 주기) 의 첫 회가 dedupKey 충돌로 silent skip
> - `_enqueueSuspiciousAlert` 가 동기적으로 dedupKey 빌드 시 옛 lastPushAt 사용
> - 새 case 의 1차 push 가 _sentKeys (24h TTL) 에 박힌 키와 충돌

수정: `lastPushAt = now` 갱신을 `_enqueueSuspiciousAlert` 호출 앞으로 swap.

### 5.17.5 V3 — aeae518 (전면 비활성)

관리자 채널 전면 비활성 정책으로 의심 알림도 끔. 의심 가드 **로직은 그대로 유지**
(데이터 안전장치).

### 5.17.6 인지 추론 패턴

> 자동화 vs 사람 결정의 갈등.
> V1 (자동 10분 강제 release) → V2 (인터랙티브) → V3 (push 자체 끔) 의 V3 단계는
> **인프라가 안정화되어 의심 사례가 거의 발생하지 않게 되었다**는 운영적 판단의 결과.
>
> 의심 가드 로직 자체는 데이터 보호 장치로 영구 유지. UI/UX 만 진화.

## 5.18 결정적 시행착오 17: "예비특보 해제 (취소)" (5f62ebb → V2/V3 정규식 진화)

### 5.18.1 문제

KMA `[예비] 통보문`에서 **"발표 가능성이 낮아져 해제합니다"** 로 예비특보가
취소되는 케이스 (예비 → 해제, 발효 못 감). 사용자에게 push 알림 없음.

### 5.18.2 V1 — 5f62ebb (5/21)

`sendPreliminaryRelease(wrnTp, parents)` 신규.

- Title: `"✅ {wrnTp} 예비특보 해제 알림"`
- Body: `"ㅇ{parent}\n..."`  (부모만, 자식 미명시 — 옵션 B)
- dedup: per-parent 키 `"prelim_release|{wrnTp}|{parent}"`
- 디스크 영속 dedup
- 본문 200자 한도 분할

### 5.18.3 정규식 진화 — V1 → V2 → V3

| 버전 | 커밋 | 누락 사례 | 핵심 변경 |
|---|---|---|---|
| V1 | 5f62ebb | 기준 | `낮아져 해제` |
| V1.1 | 526cc7c | "해제하나" 변형 | `해제(?:합니다|함\.?|하나)` |
| V2 | e1077ac | 3년 archive 분석 — 5가지 변형 누락 42건 | `(?:낮아져|적어져)`, 격조사 `(?:의|에)`, "예비" 생략, 종결부 반복, `(?:는|를)` |
| V3 | dd5b1d9 | 5년 archive 분석 — 추가 5종 | `(?:낮아|적어)(?:져)?` (-져 생략), `해제하였으나`, `해제하며`, `해제 합니다` (공백), `(?:발표|발효)` (오기) |

### 5.18.4 [Agent-B] 옵션 C — 통보문 참고사항 해제·연장 (ad90bf0)

`parseReferenceSection` / `applyReferenceUpdates`:

- 풍랑·폭풍해일·태풍 한정 (※ 폭풍해일은 후속 정책으로 제외됨, f74c326)
- 해제 시 `upcoming=null` + `children[*]=null` + `dmdwPushSender.forgetChild`
- 연장 시 `upcoming.tmEf` 와 자식 객체 tmEf 갱신
- previous tree 동기화로 detectChanges 가 차이를 잡지 않게 → 부모 push 무영향

### 5.18.5 인지 추론 패턴

> 자연어 정규식은 **5년치 archive 분석**조차도 완벽 흡수 불가.
> V3 까지 패치되어도 "격조사 완전 생략" 같은 케이스는 false positive 위험으로 의도적 제외.
>
> **MMIS API 로 가는 진정한 동기**: 자연어 파싱의 본질적 불완전성을 우회.
> 그러나 예비특보 해제(취소)는 MMIS endpoint 에 명시적 표현이 없어 결국
> 통보문 정규식이 잔존.

## 5.19 결정적 시행착오 18: "자식 푸시 발표 트리거 V1 → V3" (1d7a565 ~ 3c2d0aa)

### 5.19.1 V1 — 종합기상 텍스트 기반 자식 발표 푸시 (1d7a565 ~ c5280a6)

- weather_alerts_crawler 의 종합기상 통보문 텍스트에서 자식 발표 후보 추출
- `collectBulletinPublishCandidates` / `dispatchBulletinPublishPushes`
- `_parseBulletinTimeToMs(s)` — parseKmaTime + digits-only 2-step 파서
- 시간 필터 12h 윈도우

### 5.19.2 V2 — 시간필터 단독 정책

- bulletinPushBootstrapDone 제거 (재배포 후에도 안정)
- prev/curr 키 Set 합집합 순회 (curr 빠진 'Y'→null 케이스 회수)
- reject 사유 breakdown (staleTmFc / pastTmEf / parseFailedFc)

### 5.19.3 V3 — 자식 메타 정확화 + 시각 영구 유지 (57eae43)

> V2 까지는 자식 종류·등급을 부모 통보문에서 상속하고 자식 발표 시각을 부모 tmFc
> 로 사용했으나, 부모와 자식이 다른 단계일 수 있는 케이스(부모 풍랑 경보·자식 풍랑
> 예비 등) 와 발표 시각의 출처 불일치 문제가 있었음.

- `parseChildWarnings` 반환 타입을 `Set` → `Map<자식fullName, {wrnTp, wrnLvl}>`
- 자식별 정확한 종류·등급 추출 (경보>주의보>예비 순)
- 발표 시각 = **첫 수집 시점 - 1분 보정을 영구 유지**

### 5.19.4 V3.1 — 범위형 tmEf 발효 전 처리 (e20ddf6, X1)

> data.js: `_isExactSingleTime` 헬퍼 신규.
> 정확하지 않은 tmEf 또는 미래 정확 tmEf 면 isPrelim 강제 true.
> render_coastal.js: 자식 카드 발효시각 줄 표시 조건 강화.

### 5.19.5 V3.2 — '예비' 라벨 통일 (7a09572)

> V3.1 까지: isPrelim → '풍랑 주의보 예정' / '풍랑 경보 예정'
> V3.2: isPrelim → **'풍랑 예비'** (등급 강제 변환), "예정" 텍스트 폐지

### 5.19.6 V3.3 — 범위형 tmEf digit fallback 오인 차단 (3c2d0aa)

> 종합기상 부모 통보문의 tmEf 가 범위형("2026년 05월 21일 오전(06시~12시)") 일 때
> `_parseBulletinTimeToMs` 의 **digit-only fallback** 이 앞쪽 12자리만 잘라
> 5/21 06:12 로 오인 파싱.
> 현재 시각이 07:10 이면 pastTmEf 로 판정되어 그 부모 밑 자식들이 자식리셋 +
> 재푸시 경로에서 통째로 누락.

수정: `_isExactSingleTime` 가드 추가. 범위형이면 null → 보수적 통과.

### 5.19.7 인지 추론 패턴

> V1 → V2 → V3 → V3.1 → V3.2 → V3.3 의 6단계 진화는 **점진적 정확화** 의 표본.
> 매 단계마다 직전 단계가 남긴 작은 결함을 후속이 잡아냄.
> V3.3 의 digit fallback 오인은 **느슨한 파서**가 silent silent 로 잘못 통과시키는
> 위험한 경로의 사례.

## 5.20 결정적 시행착오 19: "자식 reset 윈도우" (0f2d419, ec57794)

### 5.20.1 문제

자식 해역의 dedup 키가 누적되어 새 발표가 silent skip 되는 경우.

### 5.20.2 V1 — 자식 reset (ec57794)

`/api/admin/children-reset` 신규 — 자식 해역만 재초기화.

### 5.20.3 V2 — 윈도우 드롭다운 (0f2d419)

> 자식 리셋에 윈도우 드롭다운(0~72h, 6h 간격) 1회용 적용.
> 선택한 시간 윈도우 안의 자식만 관리자 푸시 발송.

### 5.20.4 인지 추론 패턴

> dedup 의 본래 의도(반복 차단) 와 운영 의도(특정 시점에 새 발사) 의 갈등.
> 관리자가 윈도우 조작으로 해결 — 안전망 + 운영 유연성.

## 5.21 결정적 시행착오 20: "자식 폴리곤 부모 색칠 겹침" (S13, 5391d10)

### 5.21.1 문제

자식 폴리곤이 부모 폴리곤 위에 그려질 때 부모색이 자식 영역에 뚫고 나오는 시각 결함.

### 5.21.2 V1 — hole-punching + clipToParent (e83d8d8)

> [Synthesis] hole-punching (B) + clipToParent (C) + 런타임 S13 보존

### 5.21.3 V2 — _onlyFill geometry override 손실 (5391d10)

> _onlyFill 이 geometry override (holedGeom) 손실 — 부모-자식 색 겹침 진짜 원인

V1 의 hole-punching 이 _onlyFill 옵션 분기에서 `holedGeom` (원본 polygon 에서
자식 polygon 차감) 을 잃어버리던 silent 회귀.

### 5.21.4 인지 추론 패턴

> 시각 결함은 코드 경로 분기에서 silent 회귀로 누적되기 쉬움.
> V1 → V2 의 2일 시차는 **표면적으로 잘 보이지만 실제로는 작동 안 함** 의 사례.

## 5.22 그 외 작은 시행착오 모음

### 5.22.1 push 카운터 500 한도 우회 (253ae97)

`fix(admin): push 카운터 별도 영속화 (500 한도 우회)`

### 5.22.2 폭풍해일 전면 제거 (69e163b)

`feat(alerts): 폭풍해일 특보 수집·표시 전면 중단`

후속 정리: `9fe6143 chore(alerts): 폭풍해일 제거 후속 — 죽은 CSS·주석 정리`

### 5.22.3 발송 이력 시각변경 탭 (3c6282b)

발송 이력에 "시각변경" 하위 탭 신규 추가.

### 5.22.4 발송 이력 시각변경 필터 빈 결과 버그 (3cbfba2)

### 5.22.5 사용자 알림 페이지 시각변경 탭에 '연장' 포함 → 원복 (a30eef9 → 2f6c729)

5/30 의 한 시도. '연장' 을 '시각변경' 탭에 넣으려다 원복.

> 사용자에게 두 이벤트는 의미가 다르므로 분리 유지.

### 5.22.6 발송 이력 시각변경 캐시 신선도 (0ff3311)

그룹 발송 무효화 + 30초 TTL + scroll 교체.

### 5.22.7 자식 폴리곤 클릭 강조 (03d74e7)

자식 클릭 시 자식 테두리 강조.

### 5.22.8 GeoJSON 캐시 max-age=86400 → no-cache (069553f)

자식 매핑 갱신이 1일 캐시로 인해 사용자 앱에 반영 지연되던 문제.

### 5.22.9 _sentKeys 디스크 영속화 (0a1cf5c)

dmdw-push: 자식리셋 시 dedup 키 정리 + 디스크 영속.

### 5.22.10 admin 토큰 디스크 영속화 (e1d9d63)

배포 후에도 자동 로그인 유지.

---

# 6. 현재 상태와 알려진 edge case

## 6.1 오늘 (5/30) 세션의 3 commit 효과

| 커밋 | 효과 |
|---|---|
| `8a9a798` | mm=58/59 점·대시 형식 인식 (formatter 2층) |
| `6df054a` | E-1 가드 정밀화 (자연 전이 push 복원) + broadcastAll route 옵션 |
| `c94ea5e` | 관리자 UI "전체 사용자 재발송" 빨간 버튼 (2단계 confirm) |
| `b786ece` | mm=58/59 normalize 단계까지 보강 (3층 방어) |

이 4커밋의 종합:

1. **5/30 이전**까지 mm=58/59 케이스는 일부 사용자에게 `"05시 58분"` 으로
   표시되고 있었음 → "00시~06시" 6시간 블록으로 통일.
2. **5/30 이전**까지 E-1 가드가 너무 강해 무특보 → 신규특보 자연 전이 push 가
   막혀 있었음 → 콜드부팅 1회로 한정해 복원.
3. **broadcastAll 빨간 버튼**: 관리자가 명시적으로 "현재 활성 특보를 모든 구독자에게
   재발사" 할 수 있는 escape hatch.

## 6.2 침묵 푸시 이슈 (broadcastAll 후 push 미수신)

`c94ea5e` 의 `rebroadcastToAllUsers` 함수:

```javascript
body: JSON.stringify({ testPush: true, broadcastAll: true })
```

`routes/admin.js` 의 처리:

```javascript
const { testPush, adminToken, broadcastAll } = req.body || {};
marineWarningCrawler.resetState();
const targetAll = broadcastAll === true || (!adminToken && testPush !== false);
// ...
forceBaselinePush: true,
adminToken: (broadcastAll === true) ? undefined : (adminToken || undefined)
```

즉 `broadcastAll=true` 이면 `adminToken=undefined` → 모든 구독자 대상.
`marine_warning_crawler.run({forceBaselinePush:true})` 가 다음 1분 cycle 에 호출되어
**E-1 가드 우회 + 빈 prev vs 현재 활성 특보 diff** → 전부 신규로 분류 → push 발사.

**알려진 edge case**:

- broadcastAll 직후 1분 안에 cron 이 돌아야 함. 그 사이 endpoint 실패 시 cycle skip → push 지연.
- `_forceBaselinePending` 플래그가 다음 cycle 까지 살아있어 1회 보장 (5ea305b 의 리셋 경합 방어).
- pendingPushes.json 잔존이 있으면 그쪽도 함께 발사 → 사용자 입장에서 중복 가능.

## 6.3 mm=58/59 fix 의 트레이드오프

실제 발효시각이 정말 KMA 측에서 58/59 분으로 의도된 케이스가 있다면
**오표시**. 운영 실측상 정상 KMA 통보문은 정시(00분) 또는 30분 단위만 사용한다는
가정에 의존.

만약 KMA 가 정책 변경으로 58/59 분을 실분으로 쓰기 시작하면 즉시 회귀 가능.
방어: `normalizeMmisTime` / `formatWarningTime` / `fmtUserKMA` 3층에 모두 패치되어
있어 한 곳을 끄려면 명시적 토글 필요.

## 6.4 E-1 가드의 새 범위

V3 (`6df054a`) 적용 후:

- 가드 발동: **콜드 부팅 + 빈 prev** 양쪽 충족
- 가드 통과: 진행 중 프로세스에서 prev 가 자연스럽게 비어있는 상태 (장기 무특보)
- forceBaseline 옵션: 가드 우회 1회

**남은 edge case**: 재배포 직후 한 cycle 안에 E-4 partial fail 이 겹치면
빈 snapshot 이 prev 로 저장되는 케이스. 그러나 isFirstLoad 는 cycle 마다 false
이므로 다음 cycle 에 가드 미발동 → push 폭주 가능?
실제로는 다음 cycle 의 prev 가 비어있는 게 아니라 직전 cycle 의 (빈) snapshot 임 →
`_isSnapshotEmpty(prev)` true 지만 `isFirstLoad=false` 라 가드 미발동. **이 경우 폭주 위험 잔존**.

## 6.5 broadcastAll 의 안전망 (2단계 confirm, 빨간 버튼)

`admin.js:3197` 의 빨간 버튼 + `rebroadcastToAllUsers` 함수:

```javascript
const ok1 = confirm('⚠️ 전체 사용자에게 푸시를 발송합니다.\n\n장부를 초기화하고 ...');
if (!ok1) return;
const ok2 = confirm('정말로 전체 사용자에게 발송하시겠습니까?\n(되돌릴 수 없습니다)');
if (!ok2) return;
```

2단계 confirm + 빨간색 + 명시 메시지. 의도적 클릭이 아니면 발사 불가.

## 6.6 자식 디바운스 3분의 누적 비용

진짜 해제 케이스 (해제 통보문이 안 와있는) 는 3분 지연 발사.
관리자 사전등록 해제는 즉시 발사 (해제 통보문 신호).

## 6.7 V/T allowlist 의 정책 강제

강풍(W), 폭풍해일(O) 은 영구 제외. 만약 사용자 요청으로 강풍을 추가하려면
`REALTIME_TARGET_TP` 만 수정. 단, 자식해역 매핑 / 표시 라벨 / 푸시 메시지 분기에
"풍랑/태풍" 하드코딩이 다수라 전수 점검 필요.

## 6.8 warn/latest 깜빡임 의존성

V10 의 효용은 warn/latest 가 안정적으로 응답할 때 최대. 응답 결측 시 HOLD 가
보완하지만 정확값이 처음 들어오기 전이라면 범위형으로 표시.

## 6.9 PARENT_TO_CHILDREN 매핑의 정합성

GAP 시 자식 합성에 사용되는 정적 매핑. 신규 자식 zone 이 KMA 측에서 추가되면
이 매핑도 갱신 필요. 부모 코드와 자식 코드는 archive 분석으로 유지.

---

# 7. 부록

## 7.1 용어집 (확장)

| 용어 | 정의 |
|---|---|
| anchor (앵커) | 발표시각을 등급 변경 전까지 고정시키는 메모리. `_applyAnnounceAnchor`. |
| HOLD | 정확값으로 잡힌 시각을 범위형으로 되돌리지 않고 유지. `_applyTimeWindowHold`. |
| 윈도우 (window) | 처음 확립된 범위형의 끝 시각. 윈도우 안 정확값 = 변경, 초과 = 연장. |
| 디바운스 (debounce) | N분 연속 유지 후 확정. `_debounceTimeValues` (3분), `_applyChildReleaseDebounce` (3분). |
| 핸드오프 (handoff) | 예비→발표 또는 발효→해제 사이 한쪽 endpoint 에서 다른 endpoint 로 데이터 이동. GAP 가능. |
| GAP | 핸드오프 도중 어느 endpoint 에도 zone 이 등장하지 않는 1~수 사이클 공백. |
| 글리치 (glitch) | MMIS 데이터의 일시적 잘못된 결측 또는 깜빡임. 디바운스로 흡수. |
| baseline | 활성 특보를 마치 신규처럼 prev=비어있음 대조해서 푸시 발사. resetState 후 옵션. |
| broadcastAll | baseline + adminToken 없음 → 모든 구독자 대상. |
| extension memory | 5분 (핸드오프 복원) / 6시간 (연장 판별) 직전 특보 메모리. `_extensionMemory`. |
| 의심 (suspicious) | clrNtcTm 없는 3+ zone 이 동시에 사라진 케이스 — D-medium. 인터랙티브 결정. |
| dual-view | MMIS 의 list(상태) vs latest(통보문) 이중 view. |

## 7.2 파일별 책임 (상세)

### `local_server/services/marine_client.js`

- HTTPS 요청 추상화
- 인증 세션 메모리 (`session`)
- rate limit (200ms gap)
- envelope 정규화 `_unwrap`
- `fetchAllRealtimeEndpoints`: 4 endpoint allSettled, 부분 실패 throw

### `local_server/marine_warning_crawler.js`

- StateSnapshot 클래스 (parents/children/upcomings Map)
- `_buildSnapshotFromMarine`: list+ready 병합, allowlist V/T
- `_enrichSnapshotWithLatest`: warn/latest + warn-sasc/latest 보강 (V10, GAP)
- `_classifyReleases`: '예비' 제외
- `_applySuspiciousGuard`: D-medium 의심 보류
- `_applyChildReleaseDebounce`: 자식 3분 디바운스
- `_applyAnnounceAnchor`: tmFc 고정
- `_applyTimeWindowHold` / `_applyReleaseClrLogic` / `_applyUpcomingEfLogic`:
  HOLD + 윈도우 + 연장 플래그
- `_debounceTimeValues`: 3분 시각 디바운스
- `_buildUserPushChanges`: prev vs curr diff → push 코드 (CURRENT/UPCOMING/EF_EXTEND/...)
- `_updateExtensionMemory`: 6h retention
- `_savePrevSnapshot` / `_loadPrevSnapshot`: marine_warning_state.json
- `_writeWeatherAlertsJson`: weather_alerts.json
- `run()`: 전체 cycle 오케스트레이션
- `resetState()` + `_forceBaselinePending`: 리셋 경합 방어
- `decideSuspiciousCase()` / `getSuspiciousState()`: admin route 노출

### `local_server/push_sender.js`

- `processChanges(changes, opts)`: 변화 배열 → FCM 발사 entry
- pendingPushes.json 재시도
- adminToken 옵션 → 특정 기기만 발송

### `local_server/services/push_helpers.js`

- `generateMessage(itemData, showChildZones)`: 시나리오별 본문
- `PushBuilder` / `PushSplitter`: 시간그룹·콤마결합·165자 분할
- `buildChildQualifier`: 자식 한정사 ("(가파도연안바다)" 등)
- `buildAdminTitle` / `buildSplitPushes`: 관리자 양식
- `formatWarnTimeKST` / `fmtUserKMA`: 시각 포맷터 (브라우저/노드 양쪽)
- `_stripParentPrefix`: 자식명에서 부모 접두 제거

### `local_server/services/dmdw_push_sender.js`

- 관리자 채널 (현재 ADMIN_PUSH_ENABLED=false 로 호출 안 됨)
- `sendPreliminaryRelease`: 예비 해제 알림 (현재도 사용)
- `enqueueLevelUpgrade`/`Downgrade` 등 V7 양식 잔존
- `forgetChild`: dedup 키 정리 (자식 리셋 시 사용)

### `local_server/js/utils.js`

- `formatWarningTime(s)`: 사용자 앱 표시 포맷터
  - 분·초 제거
  - 월 포함, 상대일자 라벨
  - 범위 끝 24시 정규화
  - mm=58/59 6시간 블록 보정 (b786ece)

### `local_server/js/render.js`

- 부모 카드 렌더
- `formatAlertTime`: formatWarningTime 위임
- 발표대기 해제예정 표시 (adab23e D)

### `local_server/js/render_coastal.js`

- 자식 카드 렌더
- 빈 시각 값 줄 미표시 (V3)
- 정확 단일 시각만 발효시각 표시 (V3.1)
- '예비' 라벨 통일 (V3.2)

### `local_server/js/data.js`

- `processSingleAlert`: 사용자 앱 데이터 정규화
- 옛 dmdw 구조 호환 (wrnTp/wrnLvl 한글 우선, tmCc=clrNtcTm)
- `_isExactSingleTime`: 범위형/한글시간대/빈값 차단
- isPreliminary 판정

### `local_server/routes/push.js`

- `/api/push-custom`: FCM 발송 라우트
- 사용자별 zone 필터 (`getMatchedZones`)
- options 토글 (childZones, 야간, 발표/발효/해제 등)
- adminToken 필터 (테스트 푸시)

### `local_server/routes/admin.js`

- `/api/admin/marine/reset`: resetState + 테스트/broadcastAll
- `/api/admin/children-reset`: 자식만 + 윈도우 드롭다운
- `/api/admin/marine/suspicious` + `/decide`: D-medium 결정
- `/api/admin/alerts-reset`: 장부 전체 리셋
- `/api/admin/weather-alerts-json`: 장부 미리보기

### `local_server/scheduler.js`

- cron 1분 주기로 `marine_warning_crawler.run()` 호출
- `cycleId` 생성 (Date.now)

## 7.3 데이터 구조 (StateSnapshot)

```javascript
class StateSnapshot {
    parents: Map<zoneName, {
        wrnZoneCd, korNm, wrnTp, wrnTpNm, wrnLvl, wrnLvlNm,
        warnCmdNm, tmFc, tmEf, tmYn, clrNtcTm, prdcGo
    }>
    children: Map<childFullName, {
        ...같은 구조 + parentName
    }>
    upcomings: Map<zoneName, {  // (5/26 5213c83 추가)
        ...예비 정보 — 발효중 zone 의 공존 예비
    }>
    // 직렬화: parents/children/upcomings 를 Object 로 JSON 화
}
```

## 7.4 디버깅 팁

### 7.4.1 사용자 push 가 안 나갈 때

1. `local_server/data/marine_warning_state.json` 확인 — prev snapshot 채워졌나
2. `weather_alerts.json` mtime 신선한가
3. `pendingPushes.json` 에 무한 재시도 항목 있나
4. 로그 grep: `[Marine] 콜드 부팅 + 빈 prev` (E-1 가드 발동)
5. 로그 grep: `endpoint 부분 실패 — cycle skip` (E-4)
6. 로그 grep: `[Marine] 의심` (D-medium)

### 7.4.2 시각 표시가 이상할 때

1. 범위형 vs 정확형: `_isRangeTime(str)` 결과
2. mm=58/59 케이스: `normalizeMmisTime` 결과 확인
3. `formatWarningTime` 의 어느 분기 진입했나 (HH:MM / 한글시각 / 12자리 / 범위)
4. 푸시는 `fmtUserKMA` 경로 — 별도 확인

### 7.4.3 자식 표출이 비어있을 때

1. warn-sasc/latest 응답에 해당 자식 있나
2. warn-sasc/list/ready 어느 endpoint 에도 없나 (GAP)
3. PARENT_TO_CHILDREN fallback 진입 로그
4. `_applyChildReleaseDebounce` 의 carry 로그 (⚡ 깜빡임 감지)

### 7.4.4 가짜 푸시 의심

1. 로그 grep: `[Marine] HOLD` (정확값 고정)
2. 로그 grep: `[Marine] 디바운스` (3분 펜딩)
3. extension memory 5분 내 발표시각 복원 로그
4. `_clrExtend` / `_efExtend` 플래그 발사 로그

### 7.4.5 broadcastAll 후 사용자에게 안 갈 때

1. `_forceBaselinePending=true` 상태 확인 (재호출 안 됐는지)
2. 다음 cycle 의 push_sender.processChanges 호출 로그
3. `forceBaseline=true` 분기 진입 로그: `강제 baseline 푸시 모드 — E-1 가드 우회`
4. 사용자별 관심해역 필터 (`getMatchedZones`)

### 7.4.6 콘솔에서 marine 상태 즉시 확인

```javascript
// node REPL 또는 admin API
const crawler = require('./local_server/marine_warning_crawler');
crawler.getSuspiciousState();   // D-medium 현재 사례
```

```
GET /api/admin/weather-alerts-json
```

## 7.5 향후 (잠재) 작업 후보

- mm=58/59 트레이드오프 토글 (KMA 정책 변경 대비)
- E-1 가드의 partial fail 후 빈 snapshot 케이스 정밀화
- warn/latest 의 자식판 sparse 처리 (반복 결측 시 latest 결과 우선순위)
- 강풍(W) 지원 추가 시 다층 분기 점검 가이드
- PARENT_TO_CHILDREN 매핑 자동 갱신 (KMA archive 비교)
- 의심 가드 알림 채널 사용자 선택 (현재 ADMIN_PUSH_ENABLED 단일 게이트)

---

# 부록 Z. 깃 히스토리 핵심 커밋 인덱스

| 시점 (UTC) | 커밋 | 분류 | 한 줄 요약 |
|---|---|---|---|
| 2026-05-21 16:51 | `95047ad` | feat/base | 부모+자식 통합 push (synthesis Q) — StateSnapshot 클래스 구조 베이스 |
| 2026-05-21 13:15 | `e1077ac` | feat/yebi | 예비 해제 정규식 V2 (5변형) |
| 2026-05-21 13:28 | `dd5b1d9` | feat/yebi | V3 (10변형) |
| 2026-05-21 07:23 | `5f62ebb` | feat/yebi | 예비 해제 push 추가 (옵션 B) |
| 2026-05-21 06:32 | `ad90bf0` | feat/yebi | 참고사항 해제/연장 (Agent-B 옵션 C) |
| 2026-05-22 03:13 | `082da8e` | base | v7 통합 활성화 |
| 2026-05-22 03:22 | `baf34fa` | fix/safety | E-1 (push skip) + E-2 (weather_alerts.json) + E-4 (cycle skip) |
| 2026-05-22 05:07 | `a515853` | fix/format | D-1 (가드 완화) + D-2 (legacy 차단) + D-6 (normalize) |
| 2026-05-22 06:07 | `c761225` | fix/safety | Must-fix fmtTime dot + D-medium 옵션 C |
| 2026-05-22 06:34 | `8998037` | feat/UI | D-medium 인터랙티브 + UI 정리 |
| 2026-05-22 06:50 | `abf8c57` | fix/dedup | 의심 reinforce silent dedup 차단 |
| 2026-05-22 07:47 | `1870784` | fix/compat | 사용자 앱 옛 데이터 구조 호환 |
| 2026-05-22 08:14 | `f0477c6` | fix/display | 해제예고 범위형 시간대 명칭 |
| 2026-05-22 08:23 | `9651167` | **fix/critical** | 사용자 푸시 채널 복원 (push_sender 호출 누락) |
| 2026-05-22 08:42 | `6fcbdb5` | fix/push | UPCOMING_CHANGE 복원 + 시간대 매핑 |
| 2026-05-22 15:31 | `dbe2c6b` | **feat/V10** | warn/latest 정확 해제시각 보강 |
| 2026-05-24 13:21 | `ff1fe17` | **fix/critical** | 예비 push 부활 + V/T allowlist + 한정사 |
| 2026-05-24 13:34 | `378d64a` | feat/UX | 자식 한정사 토글 (기본 OFF) |
| 2026-05-24 13:35 | `a057b7f` | feat/UX | 관리자 푸시 콤마결합 |
| 2026-05-24 13:39 | `a0d8ba3` | fix/UX | 야간 경계 22→23 |
| 2026-05-24 14:35 | `640fd12` | feat/display | 시각 표시 통일 |
| 2026-05-24 14:42 | `5ea305b` | fix/race | 리셋 경합 _forceBaselinePending |
| 2026-05-24 15:19 | `aeae518` | feat/policy | 관리자 push 전면 비활성 |
| 2026-05-24 15:37 | `2c25c58` | **feat/A안** | 코드기반 해역명 매핑 93개 |
| 2026-05-25 09:07 | `2a21b9c` | fix/GAP | "발표 발효대기" warn/latest 예비로 추가 |
| 2026-05-25 12:50 | `5a9e111` | feat/GAP | GAP 자식 확장 |
| 2026-05-25 13:19 | `adab23e` | **fix/GAP** | 단체전이 복합 4건 일괄 |
| 2026-05-25 13:33 | `f9e4340` | fix/GAP | PARENT_TO_CHILDREN fallback |
| 2026-05-25 13:40 | `0049f2a` | **feat/GAP** | warn-sasc/latest 1순위 |
| 2026-05-25 13:59 | `3705f4a` | **fix/principle** | 자식 표출 부모 종속 제거 |
| 2026-05-25 14:21 | `f499308` | feat/push | 자식 독립 push (CHILD_ADD/RELEASE) |
| 2026-05-25 14:39 | `9d47ed3` | feat/debounce | 자식 해제 3분 디바운스 |
| 2026-05-25 15:33 | `374923d` | feat/push | 발효/해제 예정시각 연장 push |
| 2026-05-25 …    | `7821092` | feat/push | 자식 단독 연장 push |
| 2026-05-26 01:10 | `451f48e` | feat/anchor | tmFc 최초 발표시각 고정 (A) |
| 2026-05-26 01:16 | `5213c83` | feat/parallel | 다가오는 특보 병렬 표출 (B) |
| 2026-05-26 01:48 | `b411cea` | fix/guard | 연장 등급 가드 + upcomings 복원 |
| 2026-05-26 02:22 | `fe0bda5` | fix/handoff | 예비→발표 GAP "발표" 오인 차단 |
| 2026-05-26 13:16 | `2866fe0` | **fix/principle** | 연장 = 범위→더 늦은 범위 |
| 2026-05-26 14:17 | `7c981d1` | fix/V10 | 깜빡임 가짜 해제시각 변경 차단 |
| 2026-05-26 14:45 | `b05ce1f` | **feat/HOLD** | 정확 해제시각 HOLD + 윈도우 연장 |
| 2026-05-26 15:01 | `5ded869` | feat/HOLD | 발효시각도 동일 정책 |
| 2026-05-26 15:16 | `a7bc5c9` | fix/HOLD | 핸드오프 공백 + 자식 HOLD |
| 2026-05-26 15:26 | `eb06efe` | **feat/debounce** | 3분 시각 디바운스 (잔여 진동) |
| 2026-05-30 22:15 | `8a9a798` | fix/format | mm=58/59 점·대시 인식 |
| 2026-05-30 22:33 | `6df054a` | **fix/guard** | E-1 콜드부팅 1회 한정 + broadcastAll |
| 2026-05-30 22:36 | `c94ea5e` | feat/UI | 전체 사용자 재발송 빨간 버튼 |
| 2026-05-30 22:46 | `b786ece` | fix/format | mm=58/59 normalize 단계 보강 |

> 별표(★)/굵게 표시는 **시스템 전환점**이 된 결정적 커밋.

---

# 부록 Y. 시행착오 메타 패턴 — 인지심리적 정리

본 시스템의 시행착오에서 반복적으로 나타나는 패턴.

## Y.1 "두 채널/두 view 가정 실패"

- §5.2 사용자 push 채널 누락 (관리자 채널만 있다고 믿음)
- §5.4 warn/list 만으로 충분하다고 믿음 → warn/latest 발견
- §5.13 채널 통합 후 중복 전송

**교훈**: 시스템에 N 채널이 있다는 사실을 명시 문서화. 머지 시 N 채널 모두 e2e 확인.

## Y.2 "데이터 모델 가정 vs 실측"

- §5.3 자식이 시간 필드 없음 가정 → 실제 자기 데이터 줌
- §5.9 warn_tp 가 숫자 가정 → 실제 문자 코드
- §5.16 mm=58/59 = 실분 가정 → 실제 KMA 레거시 범위 인코딩

**교훈**: API 응답 raw 를 archive 로 1년+ 모아서 전수 검사. 가정은 즉시 반증 시도.

## Y.3 "단일 진리원 가정 vs 분산 상태"

- §5.4 list vs latest 의 dual view
- §5.7 endpoint 4 종이 시각적으로 어긋남 (GAP)
- §5.6 같은 값이 형식 다르게 깜빡임

**교훈**: 분산 상태를 cross-fill + 메모리 다층으로 흡수.

## Y.4 "방어막이 정상 신호 차단"

- §5.8 E-1 V2 의 자연 전이 차단
- §5.5 연장 조건이 격상/격하 사라뜨림

**교훈**: 가드 조건은 "이상 케이스"와 "정상 케이스"의 conjunction 으로 정밀화.

## Y.5 "정확화 단계 V1 → V3+"

- §5.18 yebi 정규식 V1→V1.1→V2→V3
- §5.19 자식 푸시 V1→V2→V3→V3.1→V3.2→V3.3
- §5.6 HOLD 시리즈 5단계
- §5.17 D-medium V1→V2→V3

**교훈**: 첫 패치는 60-70% 흡수가 정상. 운영 실측이 누락 사례를 매번 노출.
완벽주의보다 **패치 가능성**을 코드 구조에 내장 (정규식 분리, 가드 conjunction, 헬퍼 함수화).

## Y.6 "표시와 로직의 silent 어긋남"

- §5.12 야간 22 vs 23
- §5.14 wrnTp 한글 vs 코드
- §5.21 polygon hole-punching geometry override 누락

**교훈**: UI 라벨/표시 변경 시 로직 분기 어휘도 동시 점검. dead code 정리는 "silent 회귀 예방".

## Y.7 "느슨한 파서의 silent 통과"

- §5.19 V3.3 digit fallback 이 범위형을 5/21 06:12 로 오인
- yebi 정규식의 격조사 완전 생략 false positive 위험

**교훈**: 파서 진입부에 **가드** (형식 검증) 를 두고, 모호한 입력은 null 반환 + 호출자 측 보수적 처리.

## Y.8 "이관 무결성 가정"

- §5.9 예비 처리 로직이 legacy 에만 있고 marine 통합에서 누락
- §5.2 push_sender 호출 자체가 누락

**교훈**: 큰 머지 직후 "옛 코드가 하던 모든 호출" 의 체크리스트 작성.

---

(문서 끝)

---

# Part D — 사용자 표출 + 푸시 텍스트 + 카드 UI

*독립 에이전트 #4 가 "사용자가 실제로 무엇을 보는가" — 푸시 메시지 텍스트와 카드 표시 정책에 집중하여 작성한 초안.*


> Agent 4 / 사용자가 실제로 보는 푸시 텍스트와 카드 표시에 집중한 종합본
> 저장소: `/home/user/SEAGNAL`  /  브랜치: `claude/kma-website-reference-KYLtf`
> 대상: 코드 처음 보는 신규 개발자가 이 한 문서로 시스템을 이해

---

## 목차

1. 개요 — SEAGNAL 의 특보 표출/푸시 구조
2. MMIS 데이터 모델 — 원본·정규화·앱 호환 구조
3. 데이터 흐름 — 4 endpoint → 스냅샷 → diff → 푸시·카드
4. 시나리오별 동작 — 푸시 텍스트와 카드 표시 (실제 예시)
5. 시행착오 히스토리 — 표출/푸시 관점
6. 현재 상태와 알려진 표출 edge case
7. 부록 — 용어집 / 시각 포맷 함수 비교표 / templateId 카탈로그

---

## 1. 개요

### 1.1 SEAGNAL 이 KMA 통보문 → MMIS 로 전환한 이유

기존 SEAGNAL 은 KMA(기상청) 의 **자유텍스트 통보문(html bulletin)** 을 정기적으로 크롤링하여 한글 텍스트를 정규식으로 파싱하는 방식이었다. 코드상으로는 `dmdw_warn_crawler.js`, `report_alert_processor.js`, `weather_alerts_crawler.js` 등이 그 잔재다. 단점은 명확했다.

- 한글 자유문장 → 어휘 변형(“해제하나”, “해제될”, “해제하겠음” 등) 마다 정규식 추가가 필요했고 (b5bf88b · dd5b1d9 의 V2/V3 정규식이 그 흔적)
- 자식 해역(연안바다·평수구역) 정보가 본문 안에 묻혀 있어 부모와 자식의 시각·등급을 한 번에 추출하기 어려웠다
- 해제 통보문이 “해제예고(범위형)” 인지 “정확 해제시각” 인지를 본문에서 구별하기 어려웠다

이런 한계로 SEAGNAL 은 KMA 의 **MMIS (marine.kma.go.kr) — 해양기상정보포털 API** 로 전환했다.
구조화된 JSON 응답으로 부모·자식 zone 별 `warn_zone_cd / wrn_tp / wrn_lvl / tm_fc / tm_ef / tm_yn / clr_ntc_tm` 가 명시되어 있고, 4개 실시간 endpoint 와 2개 인증 endpoint 로 “지금 발효중 / 예비 / 가장 최근 통보문” 3축을 모두 커버한다.

### 1.2 본 문서의 범위

본 문서는 **사용자가 무엇을 보는가** 에 집중한다.
- 푸시 알림 트레이의 **제목 1줄 + 본문 2~6줄** 의 실제 텍스트
- 부모 카드의 **뱃지 / 발표시각 / 발효시각 / 해제예정** 4 row
- 자식 카드의 **이름 + 뱃지 + (선택적) 상세 row**
- 푸시를 탭해서 열리는 **상세 팝업** 의 시각 포맷
- 시간 표시의 한글화 규칙 (오늘/내일/모레/글피/그글피, 새벽/아침/오전/낮/늦은 오후/저녁/밤)

### 1.3 사용자가 실제로 보는 출구 5개

1. **푸시 트레이** — `services/push_helpers.js` `generateMessage()` 출력 (사용자 푸시, FCM/WebPush 모두 같은 본문)
2. **푸시 도착 상세 팝업** — `fix_popup_logic.js` `formatDateTime()` (`window.formatWarningTime` 위임)
3. **부모 카드 (해역별 특보현황 아코디언)** — `js/render.js` `renderMainCard()` / `formatAlertTime()`
4. **자식 카드 (연안바다/평수구역)** — `js/render_coastal.js` `createCoastalElement()` / `stripYearMonth()`
5. **지도 폴리곤 클릭 박스** — `js/ocean_warn_active*.js` `_renderAlertBlock`, `_showChildBox`

다섯 출구는 **모두 같은 `formatWarningTime()` 골격** 을 통과한다 (푸시 본문만 “상대일자 라벨 미사용” 차이). 이 통일 작업이 본 브랜치의 가장 큰 표출 정비였다 (640fd12).

### 1.4 본 브랜치의 전반적 위치

`git log main..claude/kma-website-reference-KYLtf` — 약 271 커밋. 큰 줄기는 4 단계.

- **A. 기반 전환** — legacy dmdw/weather_alerts crawler 비활성, marine MMIS 크롤러로 사용자 푸시 채널 복원 (9651167, 6fcbdb5, ff1fe17)
- **B. 자식 정보 통합** — `buildChildQualifier`, `PushBuilder`, `PushSplitter`, 자식 독립 푸시 (95047ad, f499308, 7821092, 3705f4a, 0049f2a)
- **C. 정확시각 고정** — 범위형 ↔ 정확시각 깜빡임 차단, 윈도우 기반 연장 판정 (b05ce1f, 5ded869, a7bc5c9, 7c981d1, 2866fe0, eb06efe, 451f48e, 5213c83, fe0bda5)
- **D. 표출 통일** — 월·시단위·상대일자·범위 보정, 푸시는 라벨 미사용, 야간 경계 일치, 58/59 레거시 코드 (640fd12, 2829a0e, 0aa4ccd, 5ea305b, a05c3d2, a0d8ba3, 8a9a798, b786ece, f0477c6)

---

## 2. MMIS 데이터 모델

### 2.1 4 실시간 endpoint + 2 보조 + 1 인증

`services/marine_client.js:67-79` 의 `PATHS`:

```
WARN_LIST           /v1/kma/warn/list           — 부모: 현재 발효중
WARN_READY          /v1/kma/warn/ready          — 부모: 예비특보 (발표 통보문)
WARN_SASC_LIST      /v1/kma/warn-sasc/list      — 자식: 현재 발효중
WARN_SASC_READY     /v1/kma/warn-sasc/ready    — 자식: 예비특보
WARN_LATEST         /v1/kma/warn/latest         — 부모: 가장 최근 통보문(해제 포함)
WARN_SASC_LATEST    /v1/kma/warn-sasc/latest    — 자식: 가장 최근 통보문
WARN_EF_LIST        /v1/kma/warn/ef/list        — 인증 필요: 영구 timeline
```

비로그인 4 endpoint 는 `_getNoAuth()` 로 직접 호출. `ef/list` 만 JWT 인증이 필요하다 (`services/marine_client.js:213-264 login()`).

### 2.2 응답 envelope

`services/marine_client.js:347 _unwrap()` 가 두 형식을 모두 흡수:
```js
{ status, payload: [...] }   // 또는
{ code, data: [...] }
```

### 2.3 한 row 의 핵심 필드

| MMIS 필드 | 의미 | 옛 dmdw 호환명 | 비고 |
|---|---|---|---|
| `warn_zone_cd` | 해역 코드 (S1131100 등 8자) | (없음) | 이름 축약·표기 차이 무력화 — A안의 핵심 |
| `warn_zone_nm` | 해역 이름 | (zone name) | 일부 축약 ("남해서부 동쪽") — 이름만 보면 위험 |
| `wrn_tp` | 특보종류 코드 (V풍랑/T태풍/W강풍/O폭풍해일) | `wrnTp` | V/T 만 allowlist 통과 (ff1fe17) |
| `wrn_tp_nm` | 종류 한글 ("풍랑") | `wrnTp` (한글) | `data.js:269` 호환 |
| `wrn_lvl` | 등급 코드 ("1"/"2"/"3"/"5") | `wrnLvl` | |
| `wrn_lvl_nm` | 등급 한글 ("예비/주의보/경보/해제") | `wrnLvl` (한글) | |
| `tm_fc` | 발표시각 | `tmFc` | "최초 발표시각" 으로 고정됨 (451f48e) |
| `tm_ef` | 발효시각 (예비는 발효예정) | `tmEf` | 범위형 / 정확형 모두 |
| `tm_yn` | 해제예정 | `tmYn` | warn/list 응답에 들어옴 |
| `clr_ntc_tm` | 해제예고 시각 | `tmCc` (옛 명칭) | warn/latest 의 정확값으로 보강 |
| `warn_cmd_nm` | 통보문 명령 ("발표"/"해제"/"변경") | (없음) | warn/latest 의 분기 신호 |

### 2.4 정규화 (`normalizeMmisTime`) — 옛 dmdw 표기로 변환

크롤러는 MMIS row 를 그대로 노출하지 않고 옛 dmdw 표기로 변환해 다운스트림 호환성을 유지한다. `marine_warning_crawler.js:1799-1835 normalizeMmisTime()`.

3가지 변환 케이스:

```
A. 범위형  "22일 21시 ~ 24시"
   → "22일 밤(21시~24시)"
B. 점·대시 "2026.05.21 06:00"
   → "2026년 05월 21일 06시 00분"
C. 58/59 레거시 코드  "2026.06.01 05:58"
   → "2026년 06월 01일 00시~06시"   (분=58/59 = KMA 6시간 블록 끝)
```

A 의 시간대 분기는 `_periodNameByHour(h)` (`marine_warning_crawler.js:1789-1797`). 시각 명칭과 범위는 후술 (§4.7).

이 한 함수가 모든 시각 필드를 통과한다 (`tmFc`, `tmEf`, `tmYn`, `clrNtcTm`).

### 2.5 zone 트리 (옛 dmdw 구조와 호환)

`marine_warning_crawler.js:1837-1910 _buildZoneTreeFromSnapshot()` 가 한 leaf 당:

```js
{
  current:  { wrnTp, wrnLvl, tmFc, tmEf, tmYn, tmCc, clrNtcTm, source: 'MARINE_MMIS' },
  upcoming: { wrnTp, wrnLvl, tmFc, tmEf, tmYn, tmCc, clrNtcTm, source: 'MARINE_MMIS' },
  children: { '제주도서부앞바다중북서연안바다': { wrnTp, wrnLvl, tmFc, tmEf, tmYn, tmCc, clrNtcTm } },
  history:  [...]    // 디스크에서 이어받음
}
```

- `current` = 발효중 (wrnLvlNm ∈ {주의보, 경보})
- `upcoming` = 예비 (wrnLvlNm = '예비')
- 둘은 **동시에 채워질 수 있다** (5213c83 — 발효+예비 병렬 표출)

### 2.6 코드 기반 이름 매핑 (A안) — 축약 zone 방어

`marine_warning_crawler.js:115` `MMIS_CODE_TO_NAME` (93개). MMIS 실시간 endpoint 의 `warn_zone_nm` 은 일부 축약("남해서부 동쪽") 으로 내려오지만 `warn_zone_cd` 는 불변이므로 코드 → 정식명("남해서부동쪽먼바다") 으로 해석. 표기 불일치(`·`, 공백) 도 무력화. 2c25c58 — archive ef2 1년치 13만건으로 추출, 부모 43개는 앱과 100% 일치 확인.

---

## 3. 데이터 흐름

### 3.1 한 사이클 (1분 주기)

`scheduler.js` 가 60초마다 `marineWarningCrawler.run()` 호출. 한 사이클 내부:

```
1) marineClient.fetchAllRealtimeEndpoints()           — 4 endpoint Promise.allSettled
   └ 부분 실패 시 throw → cycle 통째 skip (release 폭주 방지, services/marine_client.js:405-432)
2) marineClient.fetchWarnLatest() + fetchWarnSascLatest()  — 보조 보강
3) _buildSnapshotFromMarine()        — 부모/자식 정규화 + 한글화
4) _enrichSnapshotWithLatest()       — warn/latest 의 정확 해제시각 주입
5) _applyAnnounceAnchor()            — 발표시각(tmFc) 최초값 고정 (451f48e)
6) _applyTimeWindowHold()            — 정확시각 고정 + 윈도우 (a7bc5c9, 5ded869, b05ce1f)
7) _debounceTimeValues()             — 3분 디바운스 (eb06efe)
8) _applyChildReleaseDebounce()      — 자식 해제 3분 글리치 차단 (9d47ed3)
9) DiffMatrix.compute(prev, curr)   — 16종 bucket 분류
10) EventDispatcher.dispatch()        — dmdwPush.enqueue* (관리자 채널 — 현재 OFF)
11) _buildUserPushChanges(prev, curr) — 사용자 푸시용 changes 배열 생성
12) pushSender.processChanges(changes) — 사용자 푸시 발사
13) _writeWeatherAlertsJson(prev, curr) — 디스크 영속 (history 보존)
```

### 3.2 변화 객체 (changes)

`marine_warning_crawler.js:1460-1551 _buildUserPushChanges()` 가 push_sender 에 넘기는 객체 형식:

```js
{
  type: 'UPCOMING_CHANGE' | 'CURRENT_CHANGE'
      | 'CHILD_ADD' | 'CHILD_RELEASE'
      | 'EF_EXTEND' | 'YN_EXTEND'
      | 'CHILD_EF_EXTEND' | 'CHILD_YN_EXTEND',
  zone: '제주도서부앞바다',
  prev: { wrnTp, wrnLvl, tmFc, tmEf, tmYn, tmCc } | null,
  curr: { wrnTp, wrnLvl, tmFc, tmEf, tmYn, tmCc } | null,
  childState: { all: [...], active: [...], added: [...], released: [...], extended: [...] },
  oldTime / newTime  (연장 케이스)
  currentActive      (UPCOMING_CHANGE 의 격상/격하 판정용)
}
```

### 3.3 푸시 그룹핑

`push_sender.js:100-296` 가 change → templateId 분류 후 `(templateId, typeName, level)` 키로 그룹화. 같은 그룹의 zone 은 한 푸시에 콤마결합으로 묶인다 (a057b7f).

### 3.4 사용자 매칭 / 권한 / 만료

`routes/push.js:240` `/api/push-custom`:

1. **adminToken** 있으면 → 해당 토큰의 fcm subscriber 1명으로 한정 (관리자 테스트 모드)
2. `user.options.master === false` → 전체 알림 OFF
3. `getMatchedZones(user.zones, payload.items, opts)` — 구독 zone 과 타겟 zone 교집합 (`services/push_helpers.js:189`)
4. `showChildZones = !(user.options.childZones === false)` — 기본 ON. `false` 명시한 사용자만 자식 한정사 미표시 (378d64a / 6ba1a95)
5. **시나리오별 토글** — announce / active / release / night / childZones (`routes/push.js:325-369`)
6. **야간** — KST 23:00–07:00 차단 (a0d8ba3 — 라벨과 일치하도록 22→23 수정)
7. fail token (`messaging/registration-token-not-registered` 등) → `_isDead` 마크 → `subscribers.json` 정리, `recordSubscriberEvent('expired', N)` 기록

### 3.5 발송 결과 → history

`HISTORY_FILE` 에 최대 500 건 보존 (`routes/push.js:511`). 별도 `pushCounter.incrementSend(N)` 로 누적 카운터 영속 (253ae97 — history 500 한도 우회).

---

## 4. 시나리오별 동작 — 푸시 텍스트와 카드 표시

### 4.0 표기 규칙

본 절의 예시는 실제 코드 분기와 zone 매핑에 따른 **합성 예시**. 실제 운영 시 zone 이름과 시각은 그날의 MMIS 응답에 따른다.

- 부모 zone 예시: `제주도서부앞바다`, `인천·경기북부앞바다`, `동해남부북쪽안쪽먼바다`
- 자식 예시: `제주도서부앞바다중북서연안바다` (full), `북서연안바다` (표기 — prefix 제거)
- 시각 예시: `202605251800`, `2026.05.25 18:00`, `25일 21시~24시`

### 4.1 [신규 발표] 예비특보 신규 — `templateId='publish'`

**조건** (`push_sender.js:104-143`):
- change.type = `UPCOMING_CHANGE`
- prev 없음 또는 prev.wrnLvl ≠ curr.wrnLvl (단 예비→주의보 핸드오프는 제외)
- currentActive 없거나 currentActive 와 동급

**메시지 생성** (`push_helpers.js:292-296`):
```
genTitle = `📢 ${typeName} ${effectiveLevel} 발표`     // '예비' → '주의보' 치환
genBody  = ㅇ{zones, decorateZone 적용}
           - 발효예정 : {tmEf 포맷}
```

**실제 예시 — 풍랑주의보 예비 발표 (자식 한정사 ON):**

```
📢 풍랑 주의보 발표
ㅇ제주도서부앞바다(모든 연안바다 포함), 인천·경기북부앞바다(평수구역 포함)
   - 발효예정 : 5월 25일 18시
```

`(모든 연안바다 포함)` 은 `buildChildQualifier()` (`push_helpers.js:533-630`) 가 `childState.active.length === childState.all.length` 일 때 붙임. 자식 1개짜리 부모(인천·경기북부앞바다 = 평수구역 1)는 `(평수구역 포함)` (push_helpers.js:611-615).

**같은 푸시 — 자식 한정사 OFF 사용자:**
```
📢 풍랑 주의보 발표
ㅇ제주도서부앞바다, 인천·경기북부앞바다
   - 발효예정 : 5월 25일 18시
```

**부모 카드 표시 (예비 발표 시):**
- 뱃지: `풍랑 예비` (status-badge preliminary, 주황 #ffb74d 계열)
- 발표시각: `5월 25일(오늘) 11시` ← `tmFc` 포맷
- 발효시각: `5월 25일(오늘) 18시`
- 해제예정: `정보 없음` (순수 예비는 clrNtcTm 없음. `js/render.js:884-892`)

부모 카드의 표시 출처는 `js/render.js:854` `formatAlertTime()` → `formatWarningTime()`.

**자식 카드 (북서연안바다 — 부모와 함께 예비 들어옴):**
- 이름: `북서연안바다`
- 뱃지: `풍랑 예비` (`render_coastal.js:304-313`)
- 발효시각 행: **표시 안 됨** — `isExactSingleTime(alert.tmEf)` 가 범위형/시간대 표기를 false 처리 (`render_coastal.js:401-406`). 자식 카드 정책은 §4.13 에서 상세.

### 4.2 [발효 진입] — `templateId='active'`

**조건** (`push_sender.js:180-193`):
- prev 없음 + curr 있음 + curr.wrnLvl != '예비'
- 또는 `DiffMatrix.compute` 의 "예비 → 정식 발효 전이" 분기 (95047ad — Critical-1)

**제목**:
```
🚨 풍랑 주의보 발효
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 해제예정 : 5월 26일 03시~06시
```

`해제예정` 시각은 `tmYn || tmCc` (`push_sender.js:189`). 범위형이 그대로 들어오면 `formatWarnTimeKST` 가 "M월 D일 Hs시~He시" 출력. 정확값이면 "M월 D일 H시".

**부모 카드 (발효중):**
- 뱃지: `풍랑 주의보` (status-badge warning, 빨강 #ff6b6b 계열)
- 발표시각: 직전 예비 발표 때 `tmFc` 가 그대로 유지 (451f48e — _applyAnnounceAnchor)
- 발효시각: 정확값. 예: `5월 25일(오늘) 18시`
- 해제예정: 범위형 또는 정확값. 예: `5월 26일(내일) 03시~06시`

### 4.3 [핸드오프] 예비 → 주의보 (특수: `time_ef_change` 로 처리)

**왜 발표 아닌 시각 변경인가** (fe0bda5 의 핵심):
MMIS 가 “예비” 통보문을 거두고 “발표” 통보문을 새로 등록하는 핸드오프 사이에 1사이클 공백이 생긴다. 우리 prev 가 비어버려 “신규 발표 (`📢 풍랑 주의보 발표`)” 가 잘못 나갈 수 있다. 이미 예비 단계에서 “발표” 메시지가 한 번 나갔으므로, 핸드오프는 사용자에게 **"발효시각 변경"** 으로 보내는 게 맞다.

가드:
1. `_extensionMemory` 에 직전 예비의 `tmFc/tmEf` 저장 (5분 창)
2. `_buildUserPushChanges` 가 예비 기억 발견 + prev 빈 발효 = 직전 예비를 prev 로 복원 → push_sender 가 `time_ef_change` 또는 `ef_extend` 로 분류

**push_sender.js 의 `isPreToAdvisory`** (`push_sender.js:112`):
```js
const isPreToAdvisory = (prev && prev.wrnLvl === '예비' && curr.wrnLvl === '주의보');
```

**메시지:**
```
🕐 발효시각 변경
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 발효예정 : 5월 25일 18시
```

`generateMessage` 의 분기 `templateId === 'time_ef_change'` (`push_helpers.js:339-343`).

### 4.4 [해제] — `templateId='release'`

**조건** (`push_sender.js:163-177`):
- type = `CURRENT_CHANGE`, prev 있음, curr 없음

**메시지:**
```
✅ 풍랑 주의보 해제
ㅇ제주도서부앞바다, 인천·경기북부앞바다
```

해제는 시각 라인 없음 (`TIME_LABEL_BY_EVENT.release = null` — push_helpers.js:472).

**부모 카드:**
- 뱃지: `관심해역 특보 없음` (status-badge safe, opacity 0.6 — `js/render.js:795-800`)
- 상세 영역은 빈 상태 (currentInView 없음, upcomingFromApi 비어있음)

### 4.5 [격상 발표] — `level_upgrade_publish`

**조건**: UPCOMING_CHANGE + curScore < newScore. `getAlertScore` 는 `TYPE_RANK + LVL_RANK` (`push_sender.js:23-32`):
```
TYPE_RANK = { 태풍: 100, 풍랑: 10, 강풍: 10, 해일: 10, ... }
LVL_RANK  = { 경보: 5, 주의보: 2, 예비: 2, 해제: 0 }
```

**예시 — 주의보 발효중 → 경보 예비:**
```
📢 풍랑 주의보→경보 격상 발표
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 발효예정 : 5월 26일 00시
```

prevLevel 출처: `change.currentActive.wrnLvl` (`push_sender.js:128`). null 일 때 fallback `'주의보'` (`push_helpers.js:312`).

### 4.6 [격상 발효] — `level_upgrade_active`

CURRENT_CHANGE + prev.wrnLvl != curr.wrnLvl + prevScore < currScore (`push_sender.js:196-211`).

```
🚨 풍랑 주의보→경보 격상 발효
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 해제예정 : 5월 26일 12시
```

### 4.7 [격하] — `level_downgrade_publish` / `level_downgrade_active`

격상의 반대. 이모지 `📢` (발표) / `🔻` (관리자 분기 — `push_helpers.js:791`). 사용자 채널은 `🚨` 동일 (`push_helpers.js:332-336`).

```
🚨 풍랑 경보→주의보 격하 발효
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 해제예정 : 5월 25일 21시~24시
```

### 4.8 [시각 변경 — 발효시각] — `time_ef_change`

UPCOMING_CHANGE + 같은 등급/타입 + `prev.tmEf !== curr.tmEf` (`push_sender.js:144-152`).

```
🕐 발효시각 변경
ㅇ제주도서부앞바다
   - 발효예정 : 5월 25일 21시
```

[중요] **같은 모멘트** (범위 끝 = 정확값) 는 변경으로 안 봄 (`blockEqual`, 7c981d1 / 5ded869). 예:
- 직전: `25일 18시~24시` (범위형, 끝=24시)
- 현재: `25일 24시` ⇒ 정확값
→ 같은 모멘트로 인식, 푸시 0건, 표출은 정확값으로 고정 (3시간 블록 안에서)

### 4.9 [시각 변경 — 해제시각] — `time_yn_change`

CURRENT_CHANGE + 같은 등급/타입 + `prev.clrNtcTm !== curr.clrNtcTm || prev.tmYn !== curr.tmYn` (`marine_warning_crawler.js:473-478`, `push_sender.js:222-234`).

```
🕐 해제시각 변경
ㅇ동해남부북쪽바깥먼바다
   - 해제예정 : 5월 23일 1시
```

### 4.10 [추가 발효] — `additional_active` (자식 독립)

f499308 의 핵심 시나리오. 부모는 발효중 상태 그대로인데 자식이 추가됨 (예: 제주도서부앞바다 발효중인데 가파도연안바다만 새로 추가).

**조건** (`marine_warning_crawler.js:1497-1506`):
- 부모 prev/curr block 동일 (upcomingChanged=false, activeChanged=false)
- currChildren \ prevChildren = added

**메시지** (`push_helpers.js:352-356`):
```
📢 풍랑 주의보 추가 발효
ㅇ제주도서부앞바다(가파도연안바다 추가 발효)
   - 해제예정 : 5월 26일 03시~06시
```

`buildChildQualifier` 의 `eventType === 'additional_active'` 분기 (`push_helpers.js:577-583`) — `added` 자식만 나열, prefix `제주도서부앞바다중` 제거.

**사용자 필터:** `childZones === false` 사용자는 미수신 (routes/push.js:346-348).

### 4.11 [일부 해제] — `partial_release` (자식 독립)

부모 발효중 + 자식 일부 사라짐.

**조건** (`marine_warning_crawler.js:1508-1515`):
- 부모 변화 없음 + prevChildren \ currChildren = released

**메시지** (`push_helpers.js:359-364`):
```
✅ 풍랑 주의보 일부 해제
ㅇ제주도서부앞바다(가파도연안바다만 해제)
```

`buildChildQualifier` 의 `eventType === 'partial_release'` 분기 (`push_helpers.js:554-563`):
- `allReleased` 또는 `released.length === all.length` → `(모든 연안바다 해제)`
- 일부 → `(가파도연안바다만 해제)`

**자식 디바운스 (9d47ed3):** 해제예고(해제 통보문)가 없는 채로 자식이 데이터에서 사라지면 3분간 직전 자식을 이어받기 → 가짜 일부 해제 푸시 차단. 단 `warn-sasc/latest` 에 `cmd=해제` 통보문이 있는 자식은 즉시 해제 (관리자 사전등록).

### 4.12 [연장] — `ef_extend` / `yn_extend`

374acode (374acode 는 ?) / 7821092: 같은 등급·종류 + 범위형 → 더 늦은 범위형. **정확시각 전환은 연장 아님** (2866fe0).

판정 (`marine_warning_crawler.js:1430-1457`):
```js
const bothRange = _isRangeTime(oldYn) && _isRangeTime(currActive.tmYn);
if (kn > ko && sameType && sameLevel && bothRange) ynExtend = { oldTime, newTime };
```

**메시지** (`push_helpers.js:367-389`):
```
🕐 풍랑 주의보 해제 예정시각 연장
ㅇ제주도서부앞바다
   - 기존    : 5월 26일 03시~06시
   - 변경 후 : 5월 26일 06시~09시
```

자식 단독 연장 (7821092): 부모 불변 + 자식만 연장. `buildChildQualifier` 의 `ef_extend/yn_extend` 분기에서 `childState.extended` 가 있으면 그 자식만 표기 (`push_helpers.js:568-574`):
```
🕐 풍랑 주의보 해제 예정시각 연장
ㅇ제주도서부앞바다(가파도연안바다)
   - 기존    : 5월 26일 03시~06시
   - 변경 후 : 5월 26일 06시~09시
```

`childZones === false` 사용자에게 **자식 단독 연장은 미발송** (부모명만 나가 오해되므로) — `push_helpers.js:372-378`.

본문이 길면 `paginateByZoneBlocks(baseTitle, body)` 로 (n/N) 다건 분할 (`routes/push.js:391-393`).

### 4.13 자식 카드 표시 정책 (isCoastal 분기)

`render_coastal.js:241-480` `createCoastalElement()`.

**[정책 — 사용자 명시 요구]**
- 자식 카드는 **클릭 비활성** (`item.style.cursor = 'default'`, render_coastal.js:344). 클릭해도 detailBox 펼치지 않음 (render_coastal.js:459-462).
- 이유: dmdw 머지 자식은 통보문이 없어 펼침으로 보여줄 정보 0. 부모 상속 자식은 detail box 정보가 부모 카드와 동일해 가치 0.

**뱃지 분기 (render_coastal.js:271-313):**
1. `activeAlertFromLedger`(발효중) 있음 → 그것만 표시 (`풍랑 주의보`)
2. 없고 `pendingAlert`(예비/대기) 만 → `풍랑 예비` (등급에 "예비" 중복 방지: `replace(/주의보|경보/g, '')`)
3. 둘 다 없음 → 폴백 forEach (배지 0건 방지)
4. 특보 자체 없음 → `특보 없음` 녹색 뱃지 + opacity 0.7

**상세 row (detailBox) 정책:**
```
발표시각  ←  alert.tmFc        (formatWarningTime 통과)
발효시각  ←  alert.tmEf        ★ 범위형/시간대명/한글 표기면 미표시 (V3.1)
해제예정  ←  alert.tmCc || alert.tmEd  (값 길이>2 일 때만)
```

★ 정책의 핵심 — `isExactSingleTime()` (render_coastal.js:385-396):
```js
if (str.indexOf('(') !== -1 || str.indexOf('~') !== -1) return false;     // 범위형
if (/(오전|오후|새벽|밤|저녁|아침)/.test(str)) return false;              // 시간대 명칭 단독
if (/...년...월...일.../) return true;
if (/^.*\.\d{2}\.\d{2}\.\d{2}:\d{2}$/.test(str)) return true;
return str.replace(/[^0-9]/g, '').length === 12;                          // 12자리 raw
```

자식(`alert.isCoastal === true`) 의 tmEf 가 범위형/시간대명이면 빈 문자열 처리 → 발효시각 row 자체 미표시 (render_coastal.js:401-406).

**왜 이렇게 되었나** (V3 / V3.1 / V3.2 / V3.3 의 흐름):
- V3 (57eae43): 자식 메타 정확화 — 빈 시각 값은 row 자체 미표시
- V3.1 (e20ddf6): 범위형 tmEf 발효 전 처리 — 자식 카드 범위형 발효시각 미표시
- V3.2 (7a09572): 자식 발효 전 라벨 '예비' 통일 + '예정' 표기 제거
- V3.3 (3c2d0aa): 범위형 tmEf digit fallback 오인 차단

자식 카드 라벨 "예비" 통일 (render_coastal.js:426-430):
```js
const isPrelim = alert.isPreliminary || (alert.rawTmEf && getKfTime() < alert.rawTmEf.replace(/[^0-9]/g, ''));
const displayLevel = isPrelim ? '예비' : alert.level;
```

### 4.14 부모 카드 표시 정책 (자식과의 차이)

`js/render.js:725-893`.

**뱃지 (render.js:725-801):**
- `currentInView` 있음 → `풍랑 주의보` 빨강 뱃지 (이건 유일하게 표시되는 뱃지)
- 없고 `publishEntry` 있음 → `풍랑 예비` 주황
- 둘 다 없으면 추가 upcomingFromApi 들 다 예비 뱃지
- 모두 없으면 `관심해역 특보 없음` opacity 0.6 녹색

**보정** (render.js:734-749) — API 파싱 오류 방어:
```js
if (publishEntry && currentInView) {
    if (pubLvl.includes('예비') && !curLvl.includes('경보')) {
        if (publishEntry.tmFc === currentInView.tmFc) {
            currentInView = null;   // 같은 데이터의 중복 해석으로 보고 제거
        }
    }
}
```

**상세 row** (render.js:859-893) — 부모 카드는 자식과 달리 **모든 값 표시 (월·라벨 포함)**:
```
발표시각  ←  formatAlertTime(alert.tmFc)          (= formatWarningTime)
발효시각  ←  formatAlertTime(alert.tmEf)
해제예정  ←  formatAlertTime(rawRelease)          if (length>2 && !=='일')
              else '정보 없음'
```

[다가오는 특보] 헤더 (render.js:863-879):
```html
<i class="fa-solid fa-clock-rotate-left"></i> [다가오는 특보] 풍랑 주의보 예정
```
'예비' → '주의보' 치환 (render.js:872-874). 0번째가 _isUpcoming 일 땐 헤더 생략, idx>0 일 때만 표시.

### 4.15 푸시 도착 상세 팝업

`fix_popup_logic.js` 의 `formatDateTime` 이 `window.formatWarningTime` 에 위임 (a05c3d2). 같은 포맷 통과:
```
5월 25일(내일) 18시          (정확값)
5월 26일(모레) 21시~24시      (범위형)
```

### 4.16 시간 표시 포맷 — 통합 규칙 (640fd12)

**상대일자 라벨 (utils.js:128-141):**
```
오늘 / 내일 / 모레 / 글피 / 그글피
그 이후 또는 과거 → 라벨 없음
```

KST 기준 계산:
```js
const now = new Date(Date.now() + 9 * 3600000);
const diff = Math.round((Date.UTC(y,mo-1,d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000);
```

**범위 표기 (utils.js:144-149):**
- 끝 0시 → 24시 ("18~00시" → "18시~24시")
- 명시적 3h/6h 범위는 그대로 ("21시~24시")
- degenerate(시작==끝, 예비 발효예정 "23~23시") → 6시간 블록 스냅 → "18시~24시"

**정확시각:**
```
H시 [M분]   (mm===0 이면 시만, 그 외 분 포함)
모두 2자리 패딩 (0aa4ccd): "04시", "00시~06시"
```

**58/59 레거시 코드:**
- HH:58/HH:59 → 6시간 블록 범위 (8a9a798)
- "H시 58분" 한글 경로도 보강 (b786ece)
- `normalizeMmisTime` 단계에서 이미 변환되도록 보강 (b786ece)

### 4.17 시간대 명칭 매핑 (`_periodNameByHour`)

`marine_warning_crawler.js:1789-1797` (V/P4 — 6fcbdb5):

| 시작 시각 | 명칭 |
|---|---|
| 00~06 | 새벽 |
| 06~09 | 아침 |
| 09~12 | 오전 |
| 12~15 | 낮 |
| 15~18 | 늦은 오후 |
| 18~21 | 저녁 |
| 21~24 | 밤 |

**왜 "오후" 아닌 "늦은 오후"?**
6fcbdb5: DMDW 실측 본문 + 시각 역산에서 "오후" 단독 미관측, "늦은 오후"가 표준 (Agent A 52건 / D 5건). "저녁" 18~21시 신규 분기 (Agent A 6건). "밤" 18~24 → 21~24 좁힘 (Agent A/D 본문 일치).

### 4.18 푸시 vs 앱 팝업 — 의도적 차이

| 출구 | 함수 | 상대일자 라벨 | 비고 |
|---|---|---|---|
| 푸시 본문 | `formatWarnTimeKST` | **없음** | 트레이에 남아 다음날 열람 시 (오늘) 오해 방지 (2829a0e) |
| 부모 카드 | `formatWarningTime` | **있음** | 실시간 표시 |
| 자식 카드 | `formatWarningTime` (stripYearMonth wrap) | **있음** | range/시간대명은 발효시각 row 미표시 (V3.1) |
| 푸시 상세 팝업 | `formatWarningTime` | **있음** | 푸시 탭한 시점에 보는 화면 (a05c3d2) |
| 지도 박스 | `formatWarningTime` (ocean_warn_active5.js) | **있음** | a9cba9c 로 자식 박스 해제예정 표출 추가 |

### 4.19 푸시 야간 차단 정책

`routes/push.js:362-368`:
```js
if (opts.night === false) {
    const kstHour = (new Date().getUTCHours() + 9) % 24;
    if (kstHour >= 23 || kstHour < 7) return;
}
```

UI 라벨: **"야간 23:00 ~ 07:00"**. a0d8ba3 가 22→23 으로 수정 (이전 코드는 22 였으나 라벨 기대와 어긋남).

### 4.20 시나리오별 토글 매핑

`routes/push.js:325-369`:

| user.options 키 | 차단 templateId 들 |
|---|---|
| `announce: false` | publish, level_upgrade_publish, level_downgrade_publish, time_ef_change, ef_extend |
| `active: false` | active, level_upgrade_active, level_downgrade_active, time_yn_change, additional_active, yn_extend |
| `release: false` | release, partial_release |
| `childZones: false` | additional_active, partial_release, 자식 단독 ef_extend/yn_extend |
| `night: false` | KST 23–07 모든 푸시 차단 |
| `master: false` | 전체 차단 |

### 4.21 관리자 테스트 푸시 (`/api/admin/marine/reset`)

`routes/admin.js:177-208`:
- body: `{ testPush, adminToken, broadcastAll }`
- `testPush !== false` (기본 true) 이면 강제 baseline cycle:
  - `marineWarningCrawler.run({ forceBaselinePush: true, adminToken: ... })`
- `forceBaselinePush=true` → E-1 빈-prev 가드 우회 (6df054a 가 콜드부팅 1회로 한정한 가드)
- `broadcastAll=true` → adminToken 무시 (전체 사용자 발송)
- `adminToken` 만 있음 → 그 토큰 1명만 수신

**메시지:** 위의 모든 시나리오와 동일 (현재 활성 특보를 신규로 감지).

**UI** (6ba1a95): 관리자센터 장부 탭에 "장부 초기화 (테스트 푸시)" + "전체 사용자 재발송" (c94ea5e) 두 버튼.

### 4.22 자식 정보 통합 발송 분리

f499308 의 핵심 — 자식 독립 푸시는 **부모와 함께 이동하지 않을 때만** 별도 1건. 부모와 자식이 같은 시점에 발표/발효되면 부모 푸시 1건에 자식 한정사("(모든 연안바다 포함)") 로 묶여 나간다.

이중 발사 방지:
- `_buildUserPushChanges` 의 `if (!upcomingChanged && !activeChanged && c)` 가드 (marine_warning_crawler.js:1497)
- DiffMatrix 의 `setChanged` 가드 (Followup Major-3, marine_warning_crawler.js:464-465) — 자식 set 변화 동시 발생 시 시각 변경 푸시 억제

### 4.23 자식 카드 정렬

`js/render.js:930-936`:
```js
const sortedCoastal = [...coastalZones].sort((a, b) => {
    const alertA = findCoastalAlert(a.fullName);
    const alertB = findCoastalAlert(b.fullName);
    if (alertA && !alertB) return -1;   // 특보 있는 자식이 위
    if (!alertA && alertB) return 1;
    return 0;
});
```

---

## 5. 시행착오 히스토리 — 표출/푸시 관점

### 5.1 옛 dmdw → 신규 MMIS 데이터 구조 호환 충돌

**[9651167] 사용자 푸시 채널 복원 — push_sender 호출 추가**

증상: marine v7 머지 후 사용자 푸시 0건. 발효/해제/격상 등 모든 부모 zone 변화 시 일반 사용자에게 알림 안 감 (관리자 푸시는 정상).

원인:
- 옛 시스템: `weather_alerts_crawler.js` + `report_alert_processor.js` 가 `push_sender.processChanges()` 호출 → 사용자 푸시 발사
- marine v7 통합 시 legacy 두 크롤러 비활성화 → push_sender 호출 경로 끊김
- `marine_warning_crawler` 가 `dmdwPush`(관리자) 만 호출, push_sender 누락

수정: `pushSender = require('./push_sender')` (graceful fallback), `_buildUserPushChanges(prev, curr)` 헬퍼 추가 → CURRENT_CHANGE 형식 변환, run() dispatch 후 `pushSender.processChanges(changes)` 호출.

**[1870784] 사용자 앱 UI 회귀 차단 — 옛 데이터 구조 호환**

`_buildZoneTreeFromSnapshot` 의 toBlock 변환에서 `wrnTp`/`wrnLvl` 을 mmis 의 코드("V"/"2") 가 아닌 한글("풍랑"/"주의보") 우선으로 채움 — `js/data.js:269` 의 옛 가정 보존 (marine_warning_crawler.js:1849-1851).

**[ff1fe17] 예비특보 푸시 부활**
- 작업0의 첫 결함: `warn/ready`, `warn-sasc/ready` 를 스냅샷에 병합하지 않아 예비특보 푸시 전무
- `warn/ready` 는 부모(S1)와 마린 자식(S2·S3, 이름에 '중…연안바다')이 혼재 → `_extractParent` 로 분기
- 발효중 우선: 같은 zone 이 발효+예비 양쪽에 있으면 발효 유지 (이후 5213c83 에서 병렬 표출로 정책 변경)
- 등급명 정규화: mmis 실시간은 '예비특보' 로 내려주나 내부 로직은 '예비' 비교 → `_normLvlNm` 으로 '예비특보'→'예비'
- 특보종류 allowlist: 실시간은 문자코드(V/T/W/O)인데 기존 `'warn_tp===5'`(숫자) 제외라 무력 → V/T allowlist 로 교체. 폭풍해일(O) 차단

### 5.2 normalizeMmisTime 의 한글 변환 부작용

**[f0477c6] 해제예고 범위형 시간대 명칭 변환**

증상: 사용자 앱 해제예정에 "22일 21시 ~ 24시" 형식 노출 (시간대 명칭 누락). 옛 시스템은 "22일 밤(21시~24시)" 였음.

수정: `normalizeMmisTime` 에 범위형 분기 (`marine_warning_crawler.js:1805-1814`):
```
mmis "DD일 HH시 ~ HH시" → "DD일 <시간대>(HH시~HH시)"
```

**[6fcbdb5 P4] 시간대 매핑 — DMDW 실측 보강**

- 옛 코드: 0-6 새벽 / 6-9 아침 / 9-12 오전 / 12-15 낮 / 15-18 오후 / 18-21 저녁 / 21-24 밤
- 실측 결과: "오후" 단독 미관측 → "늦은 오후" 표준. "밤" 18~24 → 21~24 좁힘.

이 P4 보강 이후 푸시·앱 모두 동일 시간대 명칭으로 표출.

### 5.3 푸시 야간 경계 라벨 일치

**[a0d8ba3] 야간 22→23 수정**

UI 라벨: "야간 23:00~07:00". 실제 차단 로직은 `>=22` 였음. 22~23시 푸시가 라벨 기대와 달리 차단되던 불일치.

수정: `routes/push.js:365` `kstHour >= 23 || kstHour < 7`.

### 5.4 자식 한정사 토글 (childZones)

**[378d64a → 6ba1a95]**

378d64a — 사용자 설정 "특정관리해역 푸시 알림 허용" 토글 추가 (기본 OFF 로 시작). 켠 사용자만 자식 한정사 "(연안바다 포함)" 표시.

6ba1a95 — 기본 ON 으로 변경. UI 라벨도 "연안바다, 평수구역 특보 정보 표출" 로 변경.

5ea305b — `settings.js saveNotificationUI` 의 fallback `?? false` → `?? true` (요소 누락 시 의도 유지).

**왜 OFF→ON?** 자식 한정사가 정보 노이즈 보다는 가치가 크다는 판단 (제주도서부앞바다 발효중이라도 "(가파도연안바다 포함)" 인지 "(북서연안바다 포함)" 인지가 사용자 의사결정에 직결).

### 5.5 자식 카드 범위형 발효시각 미표시 정책

**[V3 → V3.1 → V3.2 → V3.3]**

자식 카드는 화면 공간이 작아 정보 밀도를 낮춰야 한다. 그래서 `isExactSingleTime()` 가 범위형/시간대명 표기를 false 처리 → 발효시각 row 자체 미표시.

- V3 (57eae43): 빈 시각 값은 row 미표시
- V3.1 (e20ddf6): 범위형 tmEf 발효 전 처리
- V3.2 (7a09572): 자식 발효 전 라벨 '예비' 통일, '예정' 표기 폐지
- V3.3 (3c2d0aa): 범위형 tmEf digit fallback 오인 차단 — `rawTmEf` 가 범위형인데 자릿수만 보고 정확시각으로 오인하던 회귀 차단

**부모 카드는 이 규칙 적용 안 함** (모든 값 표시).

### 5.6 mm=58/59 표시 fix 의 단계적 확장

KMA 의 6시간 블록 인코딩은 분=58 또는 59 로 표기되는 레거시 코드. 각 입력 형식마다 보강을 추가했다.

| 단계 | 입력 형식 | 출력 | 커밋 |
|---|---|---|---|
| 1차 | `202606010558` (12자리 raw) | "00시~06시" | (기반) |
| 2차 | `2026.06.01 05:58` (점·대시) | "00시~06시" | 8a9a798 |
| 3차 | `06월 01일 05시 58분` (한글) | "00시~06시" | b786ece (utils + push_helpers 양쪽) |
| 4차 | `normalizeMmisTime` 단계까지 | "2026년 06월 01일 00시~06시" | b786ece |

**왜 4단계나?** `normalizeMmisTime` 이 점·대시 → 한글 변환을 먼저 하면 다운스트림 (formatWarningTime / formatWarnTimeKST) 의 12자리/점·대시 분기를 거치지 않고 한글 분기로 직행 → mm=58 그대로 남아 "05시 58분" 으로 표출. b786ece 가 모든 단계에서 방어 깊이 확보.

### 5.7 발표시각 anchor 의 사용자 효과

**[451f48e] 발표시각을 현재 발효등급의 최초 발표시각으로 고정**

증상: 통보문이 변경/연장될 때마다 `tmFc` 가 최신값으로 덮어써져 사용자가 "왜 발표시각이 자꾸 바뀌지?" 혼란.

해결: `_applyAnnounceAnchor(prev, curr)` 가 직전 cycle 에 같은 종류·동급(예비는 정식의 전구체로 동급 취급) 이 있으면 그 `tmFc` 를 이어받아 고정.

**사용자가 보는 효과:**
- 풍랑주의보 발효 후 시각 변경 5회 → 발표시각 row 는 최초 발표시각 1개만 표출
- 격상/격하/종류 변경 시점에만 새 등급의 발표시각으로 재설정

**한계:** 콜드스타트로 예비를 못 본 채 발효부터 관측하면 그때 tmFc 가 앵커 (best-effort).

### 5.8 B 병렬 표출의 사용자 경험

**[5213c83] 다가오는 특보 병렬 표출**

증상: 발효중 해역에 다른 등급/종류의 예비특보가 와도 "발효 우선" 으로 드롭. 예) 주의보 발효중 + 경보 예비 동시 진행 → 사용자는 경보 예비를 못 봄.

해결: `StateSnapshot.upcomings` Map 신설 → `leaf.current`(발효) + `leaf.upcoming`(공존 예비) 동시 채움. UPCOMING_CHANGE 푸시만 발사 (발효 재발사 X).

**사용자가 보는 효과:**
- 부모 카드 뱃지: 빨강 `풍랑 주의보` 옆에 [다가오는 특보] 헤더 + `풍랑 경보 예정` 표출
- 상세에 두 row 분리: 현재 발효 (`풍랑 주의보`) + 다가오는 특보 (`풍랑 경보 예정`)
- 새 푸시: `📢 풍랑 경보 발표`

격상/격하 발효 시 직전 공존 예비의 `tmFc` 인계 → 새 발효 등급에서도 발표시각이 끊김 없이 표시.

### 5.9 정확시각 고정 + 윈도우 시리즈 (b05ce1f → 5ded869 → a7bc5c9 → 7c981d1 → eb06efe)

가장 사용자 영향이 컸던 시리즈. 한 줄로: **"발효/해제 시각이 한 번 정확값으로 발표되면, MMIS 가 다시 범위형으로 깜빡거려도 정확값을 유지한다."**

**[b05ce1f] 정확 해제시각 고정 + 해제윈도우**
- `_clrWindowEnd` zone 별 추적 (처음 확립된 범위 끝)
- 윈도우 안의 정확시각 = 고정 (해제시각 변경 1회만 푸시), 윈도우 초과 = 연장
- 해제 시 윈도우 정리

**[5ded869] 발효시각 동일 정책**
- `_applyUpcomingEfLogic` (예비/발표대기 `tmEf` 윈도우)
- 범위↔정확 깜빡임 무시, 범위 초과 시 `_efExtend` 플래그 → "발효 예정시각 연장"

**[a7bc5c9] 정확시각 고정 보강 — 핸드오프 공백 + 자식**
- HOLD 가 직전 스냅샷에 정확값 없으면 `_extensionMemory` (5분 창) 참조
- 자식도 직전 정확값으로 고정
- 윈도우는 범위로만 확립 (정확시각으로 윈도우 안 함)
- `_applyTimeWindowHold` 통합 (발효+해제 같은 정책)

**[7c981d1] warn/latest 깜빡임 가짜 푸시 차단**
- `_timeKey` 범위 끝 사용 + 24시=다음날 00시 정규화
- `_sameReleaseMoment` (범위↔정확 같은 모멘트 판별)
- 범위↔정확 깜빡임에 CURRENT_CHANGE 가짜 푸시 안 나감
- 진짜 시각 변경 (다른 모멘트)·연장은 그대로 발송

**[2866fe0] 연장은 "범위형→더 늦은 범위형" 일 때만**
- 정확시각 전환은 연장 아닌 시각 변경 (특보 명확화로 해석)

**[eb06efe] 3분 디바운스**
- HOLD 로 못 막는 잔여 진동 (값 자체 흔들림 / 5분+ 공백) 대비
- 새 시각값이 3분 연속 유지될 때만 변경/연장 푸시
- 진동(A→B→A) 시 푸시 0건

**사용자가 보는 효과 (시리즈 전체):**
- 풍랑주의보 발효 — 해제예정 "26일 03~06시" 표출
- 한 사이클 후 MMIS 가 "26일 03:00" 정확값 발표 → 푸시 1회 (`🕐 해제시각 변경`) → 표출 "5월 26일 03시"
- 그 후 MMIS 가 범위↔정확 깜빡 → **푸시 0건**, 표출 정확값 유지
- 진짜 더 늦은 범위 ("26일 06~09시") 발표 → 푸시 1회 (`🕐 풍랑 주의보 해제 예정시각 연장`)

배포 직후·재시작 직후에도 가짜 푸시 0건. 사용자 시각으로는 "특보 시각이 자꾸 바뀐다" 는 불만이 사라짐.

### 5.10 핸드오프 공백 (fe0bda5)

§4.3 의 배경. MMIS 가 예비에서 빼고 (잠깐 공백) 발표로 다시 넣는 핸드오프 과정에서 우리 스냅샷에서도 해역이 잠깐 사라졌다 재등장 → prev 가 비어 "신규 발표" 오인 → "📢 풍랑 주의보 발표" 가 한 번 더 나갈 수 있음.

해결: `_extensionMemory` 에 직전 예비의 `tmFc`/`tmEf` 5분 보관. prev 빈데 5분 내 기억 있으면 직전 예비 복원 → push_sender 가 `time_ef_change` (또는 더 늦으면 `ef_extend`) 로 분류.

### 5.11 E-1 가드의 콜드부팅 한정 (6df054a)

증상: prev 가 비어있으면 매 사이클 fire 하는 "첫 부팅 — push skip" 가드가 장기간 무특보 후 새 특보 발효 시에도 정상 발표 푸시를 차단.

수정: `isFirstLoad` 조건 추가 — 재배포/장부 초기화 직후 콜드 부팅 1회만 차단.

추가: `/api/admin/marine/reset` 에 `broadcastAll` 플래그 — 명시적 전체 사용자 재발송.

### 5.12 GAP 시리즈 (단체전이 복합버그)

**[adab23e] 예비→발표 단체전이 GAP 복합버그 4건**

제주 zones 가 단체로 예비→발표 전이하며 발생. warn/latest 가 GAP 동안 "부모만" 주고 자식 행 없어 여러 증상이 겹침.

A. GAP 자식 prev 이어받기: `_enrichSnapshotWithLatest` 가 prev(예비 때) 자식을 발표대기로 carry. 부모 발효예정/해제예고 상속.
B. 예비 의심 제외: 예비 zone 사라지는 건 정상(취소/발표전이) 인데 의심으로 오분류 → 제외.
C. 의심 가드 자식 복원: 부모만 복원하던 것 → prev.children 도 복원.
D. 발표대기 해제예정 표시: 발효 전(isPreliminary) 이면 무조건 숨기던 것 → 실제 해제예고 값(clrNtcTm)이 있으면 표시.

**[f9e4340] GAP 발표대기 자식 합성 fallback**

A 의 prev-carry 가 동작 안 하는 경우 (prev 도 자식 비어있음) → PARENT_TO_CHILDREN 매핑으로 자식 합성. 부모 발효예정/해제예고 상속, 예비 라벨.

**[0049f2a] warn-sasc/latest 개별 통보문**

warn-sasc/latest 가 warn/latest 의 자식판 발견. 자식별 개별 통보문 제공. 합성/상속 대신 1순위로 사용 → "자식 3개 중 2개만 발표" 같은 부분집합 정확 반영.

### 5.13 자식 부모 종속 제거 (3705f4a, f499308)

원칙: **모든 특보 표출 필드는 각 부모/자식이 개별 제공하는 데이터에만 기인하고 상속(종속)에 의존하지 않는다.**

3705f4a: `_buildZoneTreeFromSnapshot` 의 자식 직렬화에서 부모값 fallback 전면 제거 (tmFc/tmEf/tmYn/clrNtcTm/wrnTp).

f499308: 자식 독립 푸시 (additional_active/partial_release) 시 자식 종류·등급도 부모 fallback 제거. 자식 자신의 데이터로만 메시지 구성.

### 5.14 표출 통일 시리즈 (640fd12 → 5ea305b → a05c3d2 → 0aa4ccd → 2829a0e)

월 포함 + 상대일자 라벨(앱만) + 시단위 + 범위 보정의 단일 규칙으로 모든 출구 통일.

- **640fd12** — `formatWarningTime` 재작성. `js/render.js / js/render_coastal.js / js/ocean_warn_active5.js / services/push_helpers.js` 적용.
- **5ea35b** — 관리자 푸시 경로 (buildSplitPushes 의 fmtTime, dmdw_push_sender 의 fmtTime) 도 `formatWarnTimeKST` 위임. 모든 푸시가 같은 규칙.
- **a05c3d2** — 푸시 도착 상세 팝업 (`fix_popup_logic.js formatDateTime`) 도 위임 — "C5 누락" 보완.
- **0aa4ccd** — 해제예정 (`clrNtcTm`) 이 "일" 만 있는 범위형 → 가장 가까운 미래 날짜로 연/월 추론 → 월+상대일자 라벨 부여. 시·분 모두 2자리 패딩.
- **2829a0e** — 푸시 전용 `formatWarnTimeKST` 의 `dateLabel` 만 단순화 ("M월 D일" — 라벨 미사용). 의도적 차이.

### 5.15 자식 카드 지도 팝업 표출 (a9cba9c)

증상: 자식(연안바다) 지도 폴리곤 클릭 → 팝업에 해제예정 안 나옴. `ocean_warn_active5.js _showChildBox` 가 옛 dmdw 가정("자식 해제시각 미제공") 으로 tmCc 무시하고 presentInLastFc 일 때만 시각 없는 "해제 예정" 텍스트만 표시.

수정: mmis warn-sasc/* 는 자식별 clr_ntc_tm(tmCc) 을 개별 제공하므로 부모 박스 (`_renderAlertBlock`) 와 동일하게 자식 자신의 해제예고시각 표출.

### 5.16 자식 디바운스 (9d47ed3)

자식이 "해제예고(해제 통보문) 없이" 데이터에서 사라지면 글리치로 의심 → 3분간 직전 자식 이어받기. 3분 내 복귀하면 가짜 "일부 해제"/뒤따르는 "추가 발효" 푸시와 화면 깜빡임 억제. "⚡ 깜빡임 감지(글리치)" 로그.

단, warn-sasc/latest 에 해제 통보문(cmd=해제) 있는 자식은 관리자 사전등록 해제로 보고 즉시 해제.

### 5.17 코드 기반 해역명 매핑 (2c25c58)

MMIS 실시간이 일부 zone 이름 축약 ("남해서부 동쪽") → archive ef2 1년치 13만건으로 추출한 93개 매핑으로 `warn_zone_cd` → 정식명 해석. 표기 불일치(`·`, 공백) 무력화.

사용자 영향:
- 이름 잘림 해소 — 카드와 푸시에 정식명 "남해서부동쪽먼바다" 표출
- 사용자 필터 불일치 자동 해소 (필터는 정식명 기준이므로 잘린 이름은 매치 실패하던 것)

### 5.18 자식 시각 변경 분기 (95047ad Critical-2)

부모 시각은 그대로인데 자식 시각이 변한 경우 — `buildChildQualifier` 의 `(X만 시각 변경)` 분기 호출 위해 별도 이벤트. `parentTimeUnchanged` 플래그.

```
🕐 해제시각 변경
ㅇ제주도서부앞바다(연안바다만 시각 변경)
   - 해제예정 : 5월 26일 03시
```

### 5.19 자식 폴리곤 시각화 시리즈 (3e886d9, 5391d10, 03d74e7, f70b961)

지도 위 자식 폴리곤의 색칠/테두리 정책 (사용자 카드와는 별개 출구).
- 자식 폴리곤 독립 색칠 (S9 D/E — f70b961)
- 활성 모드에서도 자식 라벨 표출 (5acafbe)
- 자식 클릭 시 자식 테두리 강조 (03d74e7)
- hole-punching + clipToParent 정밀 분리 (e83d8d8, 0f15a3a 종합본)
- onlyFill 이 geometry override 손실 — 부모-자식 색 겹침 진짜 원인 (5391d10)

이 표출은 본 문서 범위(카드·푸시) 보다 지도 표출에 가깝지만, 자식 표출 정책 일관성 측면에서 카드와 통일됨.

### 5.20 자식 카드 클릭 비활성 (정책 결정)

`render_coastal.js:339-344` 의 명시적 정책 주석:
> 자식 해역(연안바다/평수구역) 카드는 클릭에 반응하지 않는다.
> • dmdw 머지 자식: 통보문이 없어 펼침으로 보여줄 추가 정보가 없음
> • 부모 상속 자식: detail box 정보가 부모 카드와 동일해 가치 0
> → cursor 도 default 로 두어 클릭 가능한 듯한 시각적 단서 제거.

사용자 학습 비용 감소 / 정보 중복 제거 의도.

### 5.21 토글 변경 사례 — 특정관리해역 기본 ON

378d64a 에서 OFF 로 추가 → 6ba1a95 에서 ON 으로 변경. 마이그레이션 정책: 키 자체가 없는 기존 구독자도 `childZones !== false` 로 기본 ON.

### 5.22 관리자 푸시 콤마결합 통일 (a057b7f)

이전: 부모마다 `ㅇ` 줄 분리.
이후: 같은 시간그룹의 부모는 `ㅇ` 1개에 콤마결합 (자식 한정사는 각 부모 옆 괄호 유지).

```
ㅇ제주도서부앞바다(모든 연안바다 포함), 인천·경기북부앞바다(평수구역 포함)
   - 발효예정 : 25일 23시
```

사용자/관리자 푸시 모두 같은 양식.

### 5.23 push counter 별도 영속 (253ae97)

`HISTORY_FILE` 은 500 한도. 관리자 통계 (총 발송 수) 가 500 건 cap 에 가려 0/소수로 보이던 회귀 → `pushCounter` 별도 파일에 누적.

### 5.24 V10 — warn/latest endpoint 추가 (dbe2c6b)

전환의 결정타. warn/list 가 "현재 발효 상태" 만 제공하므로 해제예고는 범위형 텍스트("23일 3시~6시") 로만 노출. warn/latest 는 가장 최근 통보문 → 해제 통보문 발행 시 tm_ef 에 정확 시각 ("2026.05.23 01:00") 포함.

`_enrichSnapshotWithLatest` 가 parent zone 의 `clrNtcTm` 갱신.

실제 케이스: 동해남부북쪽바깥먼바다 — "23일 3시 ~ 6시" → "2026.05.23 01:00" 정확 시각으로 갱신.

### 5.25 retry / pending push (6fcbdb5 P2)

`processChanges` 호출에 있던 `userChanges.length > 0` 가드 제거. push_sender 는 빈 배열을 받으면 `pendingPushes.json` 재시도 트리거. 변화 없는 cycle 에서도 호출 → 미발송 건 재시도 보장.

`pending_pushes.json` 의 최대 보존: 20건 (push_sender.js:335). 24시간 이상 지난 건은 폐기 (push_sender.js:365-369).

### 5.26 _sentKeys 디스크 영속화 (0a1cf5c)

자식 푸시 dedup 키가 메모리 only 였던 회귀 → `dmdw_push_sender._sentKeys` 디스크 영속화. 자식리셋 시 `forgetChild` 호출하여 메모리·디스크 dedup 이력 정리. 이렇게 해야 자식 재등재 시 publish push 재발송.

---

## 6. 현재 상태와 알려진 표출 edge case

### 6.1 현재 활성 정책 요약

- **관리자 알림 푸시: OFF** (aeae518). `ADMIN_PUSH_ENABLED=false`. 작업2 통합으로 사용자 푸시에 이미 자식 한정사 포함 → 관리자 채널 중복.
- **의심 가드 로직: ON** (데이터 안전장치). 알림 푸시만 끔.
- **자식 한정사 기본: ON** (6ba1a95).
- **야간 시간: 23:00–07:00** (KST, a0d8ba3).
- **사용자 푸시 채널: 활성** (9651167 복원).
- **3분 디바운스: 시각 변경/연장** (eb06efe), 3분 디바운스: 자식 해제 (9d47ed3).
- **연장 판정: 범위→범위 + 더 늦은 모멘트만** (2866fe0).
- **발표시각: 최초값 고정** (451f48e), 격상격하/종류 변경 시만 갱신.
- **병렬 표출: 발효+예비 공존 보존** (5213c83).
- **푸시 본문 라벨: 미사용** (2829a0e), 앱 카드/팝업/지도: 라벨 사용.
- **푸시 분할: ef_extend/yn_extend 만 (n/N) 페이지네이션** (`routes/push.js:391-393`), 그 외 단건.

### 6.2 알려진 edge case

**[E-1 ↔ broadcastAll]** prev 비어있는 콜드부팅 1사이클 + 동시 cron + admin reset 경합 가능성. `_forceBaselinePending` 1회성 플래그 (5ea305b) 로 보강했으나, 동시에 자동 cron 이 진입 시 이론적 race 잔존.

**[자식 카드 발효시각 미표시]** 자식 정책상 범위형/시간대명 발효시각은 row 자체 미표시 (V3.1). 사용자에 따라 "발효시각이 없네?" 오해 가능. 부모 카드는 정상 표시되므로 그쪽 확인 필요.

**[부모 카드 [다가오는 특보] 헤더 조건]** publishEntry 가 idx=0 일 때는 헤더 표시 안 함 (render.js:863-879). 현재 발효 없이 다가오는 특보만 있는 경우 헤더 생략 의도.

**[푸시 본문 길이]** 1건 한도 EFFECTIVE_MAX=165자 (push_helpers.js:696). 한 부모의 자식 한정사가 너무 길 때 — admin 채널만 부모 한 줄 boundary 분할 (Followup Major-2, push_helpers.js:828-880). **사용자 채널은 일부러 분할 안 함** — 콤마결합 (`PushBuilder.renderTimeGroups` — push_helpers.js:660-664)으로 1줄 길이가 길어질 수 있음.

**[58/59 + 범위형 혼합]** mm=58 + 범위형 입력 ("DD일 HH:58 ~ HH:58") 케이스는 명시 보장 없음. 실측 미관측.

**[자식 디바운스의 3분 창]** 3분 내 복귀 못 하면 진짜 해제 확정. 4분짜리 글리치는 가짜 푸시 발생 가능.

**[showChildZones=false 사용자의 자식 단독 연장]** 부모명만 나가 오해 → 의도적 미발송 (push_helpers.js:372-378). 사용자가 자식 연장 정보를 못 보게 됨 (토글 OFF 의 trade-off).

**[격상 발효 시 직전 공존 예비 인계]** 5213c83 의 정책. 한계로 콜드스타트로 예비를 못 본 채 격상 발효 관측 시 직전 발표시각 인계 불가능.

**[warn/latest 자식형 row]** 일부 응답에서 자식 row 도 포함 → `_enrichSnapshotWithLatest` 의 GAP 분기로 처리 (5a9e111 — Followup Major-2 케이스). 응답 형식 변화 시 잠재적 회귀 위험.

**[fmtUserKMA 명칭]** 옛 함수명 `fmtUserKMA` 가 일부 주석에 남아 있으나 (b786ece 메시지) 실제 함수는 `formatWarnTimeKST` (push_helpers.js:34). 주석 잔재.

**[Followup Major-3 가드의 우선순위]** 자식 set 변화 + 시각 변경 동시 → 시각 변경 푸시 억제 (자식 set 변화 우선). 두 변화가 모두 정보가치 있을 때 시각 변경 정보 손실 가능.

### 6.3 검증되지 않은 영역

- **태풍 시나리오** — `TYPE_RANK.태풍 = 100` 으로 풍랑/강풍/해일과 별 등급. 실제 태풍특보 진입 시 격상 발표/발효 푸시 텍스트는 시나리오 코드상 정상이나 운영 검증은 풍랑 위주.
- **자식 단독 격상/격하** — `buildChildQualifier` 에 `(연안바다 격상/격하 없음)` 분기는 있으나 자식 단독 격상 코드 경로는 명시적 케이스 없음.
- **WebPush(VAPID) vs FCM** — `routes/push.js:395-441` 양쪽 분기 분리. 메시지 본문 자체는 동일.

---

## 7. 부록

### 7.1 용어집

| 용어 | 의미 |
|---|---|
| **MMIS** | marine.kma.go.kr 의 해양기상정보포털 백엔드. KMA 의 구조화된 marine 특보 API |
| **부모 zone** | 28개 — 제주도서부앞바다, 인천·경기북부앞바다 등 (warn/list 의 단위) |
| **자식 zone** | 연안바다 / 평수구역 (warn-sasc/list 의 단위) |
| **tmFc** | 발표시각 (announce time) |
| **tmEf** | 발효시각 (effective time) |
| **tmYn** | 해제예정 (yn = expiry next, warn/list) |
| **tmCc** | 해제예고 (옛 dmdw 표기. mmis 의 `clrNtcTm` 동의) |
| **clrNtcTm** | 해제예고 시각 (mmis 정식 필드명) |
| **현재 발효** | warn/list 응답 → leaf.current |
| **예비** | warn/ready 응답 → leaf.upcoming. 등급 wrnLvlNm = '예비'(또는 '예비특보' → 정규화) |
| **발표대기** | 정식 발표(통보문 발행) 됐으나 발효시각 아직 미래 |
| **GAP** | 예비→발표 사이의 1사이클 공백. warn/latest 로 보강 |
| **anchor (발표시각)** | 한 특보의 생애주기 동안 최초 발표시각으로 고정된 tmFc (451f48e) |
| **윈도우 (해제/발효)** | 처음 확립된 범위 끝. 내부 정확값은 고정, 외부 = 연장 (b05ce1f) |
| **HOLD** | 정확시각 고정 정책 (a7bc5c9) |
| **디바운스** | 3분 미만 진동은 변경 안 본 정책 (eb06efe) |
| **콜드부팅** | 재배포/장부 초기화 직후 prev 가 비어있는 1회 (6df054a) |
| **isExactSingleTime** | 자식 카드 발효시각 row 표시 여부 판정 (render_coastal.js:385) |
| **decorateZone** | zone 옆 자식 한정사 부착 (push_helpers.js:240) |
| **showChildZones** | 사용자 옵션 `childZones` 의 inverse (push_helpers.js:225) |
| **broadcastAll** | 관리자 reset 의 전체 발송 모드 (6df054a) |
| **forceBaselinePush** | E-1 가드 우회 + 현재 활성 특보를 신규로 감지 |
| **prelim_cancel** | 예비 → (발효 거치지 않고) 소멸 → "✅ 예비특보 취소" 푸시 (관리자 분기) |

### 7.2 시각 포맷 함수 비교표

| 함수 | 위치 | 사용처 | 상대일자 라벨 | 비고 |
|---|---|---|---|---|
| `normalizeMmisTime` | `marine_warning_crawler.js:1799` | 모든 시각 필드 정규화 (서버) | N/A | mmis → 옛 dmdw 한글 표기 |
| `formatWarningTime` | `js/utils.js:118` | 부모 카드 / 자식 카드 / 지도 박스 / 푸시 상세 팝업 | **있음** | 핵심 표시 포맷터 |
| `formatDate` | `js/utils.js:52` | YYYYMMDDHHMM → "MM/DD 오전 H시" 변환 (AFSO·기타) | (오전/오후) | formatWarningTime 위임 분기 있음 |
| `formatWarnTimeKST` | `services/push_helpers.js:34` | 푸시 본문 텍스트 (사용자/관리자 공통) | **없음** | 의도적 차이 — 트레이 열람 시점 오해 방지 |
| `fmt` (generateMessage 내부) | `push_helpers.js:252` | generateMessage 의 row 시각 | (위 위임) | formatWarnTimeKST 위임 |
| `fmtTime` | `push_helpers.js:757` | buildSplitPushes (관리자 분할 푸시) | (위 위임) | 5ea305b 로 위임 통일 |
| `formatDateTime` | `fix_popup_logic.js` | 푸시 도착 상세 팝업 | **있음** | a05c3d2 로 formatWarningTime 위임 |
| `_periodNameByHour` | `marine_warning_crawler.js:1789` | 시간대 명칭 (새벽/아침/.../밤) | N/A | 범위형 시간 → 한글 명칭 |
| `_fmtTime` (active5) | `js/ocean_warn_active5.js` | 지도 폴리곤 클릭 박스 | (위임) | 640fd12 로 formatWarningTime 위임 |
| `formatBuoyTime` | `js/render_coastal.js:231` | 부이 관측시간 ("MM/DD HH:MM") | N/A | 부이 전용 |

### 7.3 푸시 templateId 카탈로그

| templateId | 이모지 | 제목 형식 | 시각 라벨 | 시각 출처 | 발생 조건 | UI 매핑 토글 |
|---|---|---|---|---|---|---|
| `publish` | 📢 | `풍랑 주의보 발표` | 발효예정 | tmEf | UPCOMING_CHANGE 신규/등급차 | announce |
| `active` | 🚨 | `풍랑 주의보 발효` | 해제예정 | tmYn || tmCc | CURRENT_CHANGE 신규 / 예비→정식 | active |
| `release` | ✅ | `풍랑 주의보 해제` | (없음) | — | CURRENT_CHANGE curr 없음 | release |
| `level_upgrade_publish` | 📢 | `풍랑 주의보→경보 격상 발표` | 발효예정 | tmEf | curScore < newScore (예비) | announce |
| `level_upgrade_active` | 🚨 | `풍랑 주의보→경보 격상 발효` | 해제예정 | tmYn | prevScore < currScore | active |
| `level_downgrade_publish` | 📢 | `풍랑 경보→주의보 격하 발표` | 발효예정 | tmEf | curScore > newScore (예비) | announce |
| `level_downgrade_active` | 🚨 | `풍랑 경보→주의보 격하 발효` | 해제예정 | tmYn | prevScore > currScore | active |
| `time_ef_change` | 🕐 | `발효시각 변경` | 발효예정 | tmEf | UPCOMING tmEf 변경 / 예비→주의보 핸드오프 | announce |
| `time_yn_change` | 🕐 | `해제시각 변경` | 해제예정 | tmYn || clrNtcTm | CURRENT clrNtcTm 변경 | active |
| `additional_active` | 📢 | `풍랑 주의보 추가 발효` | 해제예정 | tmYn | CHILD_ADD (부모 불변 + 자식 추가) | active + childZones |
| `partial_release` | ✅ | `풍랑 주의보 일부 해제` | (없음) | — | CHILD_RELEASE (부모 유지 + 자식 일부 해제) | release + childZones |
| `ef_extend` | 🕐 | `풍랑 주의보 발효 예정시각 연장` | 기존/변경 후 | oldTime, newTime | EF_EXTEND (범위→더 늦은 범위) | announce |
| `yn_extend` | 🕐 | `풍랑 주의보 해제 예정시각 연장` | 기존/변경 후 | oldTime, newTime | YN_EXTEND (범위→더 늦은 범위) | active |

**관리자 전용 (현재 OFF — aeae518):**
| templateId | 비고 |
|---|---|
| `prelim_cancel` | 예비 → (발효 거치지 않고) 소멸. 사용자 채널엔 분기 없음 |
| `type_upgrade_publish` / `type_upgrade_active` | 풍랑→태풍 등 종류 격상 |
| `type_downgrade_publish` / `type_downgrade_active` | 태풍→풍랑 등 종류 격하 |

### 7.4 자식 한정사 매트릭스 (buildChildQualifier)

`push_helpers.js:533-630`. 입력: `parent`, `childState`, `eventType`. 출력: `(...)` 문자열.

| 케이스 | 조건 | 출력 예 |
|---|---|---|
| 부모 매트릭스 미등록 (먼바다 등) | `PARENT_CHILD_TYPE[parent]` 없음 | `''` (한정사 없음) |
| 부모 해제 / 예비 취소 | eventType ∈ {release, prelim_cancel} | `''` |
| 모든 자식 해제 | partial_release + allReleased | `(모든 연안바다 해제)` |
| 일부 자식 해제 | partial_release + released > 0 | `(가파도연안바다만 해제)` |
| 자식 단독 연장 | ef_extend/yn_extend + extended | `(가파도연안바다)` |
| 추가 발효 | additional_active + added > 0 | `(가파도연안바다 추가 발효)` |
| 격상/격하 — 자식 미발효 | level/type _up/_down + active.length=0 | `(연안바다 격상 없음)` / `(연안바다 격하 없음)` |
| 자식만 시각 변경 | time_*_change + parentTimeUnchanged | `(연안바다만 시각 변경)` |
| 부모만, 자식 미발효 | (위 분기 모두 통과) + active.length=0 | `(연안바다 미발효)` |
| 부모 + 모든 자식 | active.length === all.length | `(모든 연안바다 포함)` (또는 `(평수구역 포함)` if all=1) |
| 부모 + 자식 일부 | active > 0 | `(북서연안바다, 남서연안바다 포함)` |

### 7.5 PARENT_CHILD_TYPE 분류 (28 부모)

`push_helpers.js:417-456`.

| 타입 | 라벨 | 부모 수 | 부모 예 |
|---|---|---|---|
| `connection` | 연안바다 | 11 | 강원북부앞바다, 제주도북부앞바다, 동해중부안쪽먼바다, 남해서부서쪽먼바다 등 |
| `pyeongsu` | 평수구역 | 12 | 인천·경기북부앞바다, 전북북부앞바다, 충남북부앞바다 등 |
| `both` | 평수구역/연안바다 | 5 | 울산앞바다, 경북남부앞바다, 경남중부남해앞바다, 부산앞바다, 경남서부남해앞바다 |

자식이 1개인 부모 (예: 인천·경기북부앞바다 = 평수구역 1) 는 `(평수구역 포함)` 단수 표기 (push_helpers.js:611-615).

### 7.6 사용자 옵션 키 (구독자 user.options)

| 키 | 기본값 | 효과 |
|---|---|---|
| `master` | true | false 면 전체 알림 차단 |
| `announce` | true | false 면 publish/upgrade_publish/downgrade_publish/time_ef_change/ef_extend 차단 |
| `active` | true | false 면 active/upgrade_active/downgrade_active/time_yn_change/additional_active/yn_extend 차단 |
| `release` | true | false 면 release/partial_release 차단 |
| `night` | true | false 면 KST 23:00–07:00 차단 |
| `childZones` | true (마이그레이션 ON) | false 면 자식 한정사 미표시 + 자식 단독 푸시 미수신 |
| `target` | (없음) | 'all' 이면 구독 zone 무시하고 전 zone 수신 |
| `zones` | [] | 구독 zone 목록 (대/중/소 혼재 가능) |

### 7.7 zone 계층 (services/push_helpers.js:97-142 ZONE_HIERARCHY)

```
동해
  ├ 동해중부해상
  │   ├ 강원북부앞바다 / 강원중부앞바다 / 강원남부앞바다
  │   └ 동해중부안쪽먼바다 / 동해중부바깥먼바다
  └ 동해남부해상
      ├ 울산앞바다 / 경북남부앞바다 / 경북북부앞바다
      └ 동해남부남쪽안쪽먼바다 / 바깥먼바다 / 북쪽안쪽 / 북쪽바깥

서해
  ├ 서해중부해상
  │   ├ 인천·경기북부앞바다 / 인천·경기남부앞바다
  │   ├ 충남북부앞바다 / 충남남부앞바다
  │   └ 서해중부안쪽먼바다 / 바깥먼바다
  └ 서해남부해상
      ├ 전북북부앞바다 / 전북남부앞바다
      ├ 전남북부서해앞바다 / 전남중부서해앞바다 / 전남남부서해앞바다
      └ 서해남부 (안쪽/바깥 × 북쪽/남쪽 = 4)

남해
  ├ 남해서부해상
  │   ├ 전남서부남해앞바다 / 전남동부남해앞바다
  │   └ 남해서부서쪽먼바다 / 동쪽먼바다
  └ 남해동부해상
      ├ 부산앞바다 / 경남서부남해앞바다 / 경남중부남해앞바다 / 거제시동부앞바다
      └ 남해동부안쪽먼바다 / 바깥먼바다

제주
  └ 제주해역
      ├ 제주도북부앞바다 / 제주도남부앞바다 / 제주도동부앞바다 / 제주도서부앞바다
      └ 제주도남서쪽안쪽먼바다 / 남동쪽안쪽먼바다 / 남쪽바깥먼바다
```

대분류로 구독한 사용자는 `expandToMinorZones()` 가 모든 소분류로 확장 (`services/push_helpers.js:153-180`).

### 7.8 핵심 파일 인덱스 (절대경로)

| 파일 | 줄 | 역할 |
|---|---|---|
| `/home/user/SEAGNAL/local_server/marine_warning_crawler.js` | 2577 | 메인 크롤러 (snapshot, diff, dispatch) |
| `/home/user/SEAGNAL/local_server/services/marine_client.js` | 529 | MMIS HTTP 클라이언트 (login, fetch*) |
| `/home/user/SEAGNAL/local_server/push_sender.js` | 450 | 사용자 푸시 — change → templateId 분류 + 그룹핑 + 발사 |
| `/home/user/SEAGNAL/local_server/services/push_helpers.js` | 963 | generateMessage (사용자) + buildChildQualifier + buildSplitPushes (관리자) |
| `/home/user/SEAGNAL/local_server/services/dmdw_push_sender.js` | (관리자 전용 enqueue/flush) |
| `/home/user/SEAGNAL/local_server/routes/push.js` | 774 | /api/push-custom (FCM/WebPush 발송, 만료 정리, history 기록) |
| `/home/user/SEAGNAL/local_server/routes/admin.js` | 1840 | /api/admin/marine/reset 등 관리자 액션 |
| `/home/user/SEAGNAL/local_server/scheduler.js` | 1721 | 60초 cron — run() 호출 |
| `/home/user/SEAGNAL/local_server/js/utils.js` | 262 | formatWarningTime, formatDate, getKfTime |
| `/home/user/SEAGNAL/local_server/js/render.js` | 1140 | 부모 카드 (메인 아코디언) |
| `/home/user/SEAGNAL/local_server/js/render_coastal.js` | 538 | 자식 카드 |
| `/home/user/SEAGNAL/local_server/js/ocean_warn_active5.js` | 지도 폴리곤 클릭 박스 |
| `/home/user/SEAGNAL/local_server/fix_popup_logic.js` | 푸시 도착 상세 팝업 |
| `/home/user/SEAGNAL/local_server/data/weather_alerts.json` | (런타임) | current/previous/history 영속 |
| `/home/user/SEAGNAL/local_server/data/marine_warning_state.json` | (런타임) | prev StateSnapshot 영속 |
| `/home/user/SEAGNAL/local_server/data/pending_pushes.json` | (런타임) | 미발송 재시도 큐 |
| `/home/user/SEAGNAL/local_server/data/subscribers.json` | (런타임) | FCM/WebPush 구독자 |
| `/home/user/SEAGNAL/local_server/data/push_history.json` | (런타임) | 발송 이력 (500 cap) |

### 7.9 주요 환경변수

| 변수 | 효과 | 위치 |
|---|---|---|
| `MARINE_USER_ID` | MMIS 로그인 ID (fly.io secrets) | services/marine_client.js:48 |
| `MARINE_USER_PWD` | MMIS 로그인 PWD | services/marine_client.js:49 |
| `MARINE_DISABLE` | '1' 이면 강제 비활성 | services/marine_client.js:50 |

자격증명 부재 시 `AUTH_ENABLED=false` → ef/list 호출 시 throw. 비로그인 endpoint 는 그대로 동작.

### 7.10 푸시 발송 통신 양식 (API → push.js → FCM/WebPush)

`push_sender.js:419-430` 가 `/api/push-custom` 으로 POST:
```json
{
  "isManualGroupSend": true,
  "type": "auto",
  "payload": {
    "templateId": "publish",
    "typeName": "풍랑",
    "level": "주의보",
    "items": [
      {
        "zones": ["제주도서부앞바다"],
        "childState": { "all": [...], "active": [...] },
        "tmFc": "...", "tmEf": "...", "tmYn": "..."
      }
    ],
    "prevTypeName": null,
    "prevLevel": null
  },
  "adminToken": "...(option)"
}
```

`/api/push-custom` 이 사용자별로 `generateMessage()` 호출 → FCM message:
```json
{
  "token": "<user FCM token>",
  "notification": { "title": "📢 풍랑 주의보 발표", "body": "ㅇ..." },
  "data": { "url": "https://seagnal-server.fly.dev/?tab=weather-alert-section&popup=true&alertType=풍랑주의보&status=publish&tmFc=...&tmEf=...&tmYn=...&zones=제주도서부앞바다" },
  "android": { "priority": "high" },
  "apns": { "headers": { "apns-priority": "10" } }
}
```

`data.url` 의 딥링크가 사용자 탭 시 알림 상세 팝업 트리거 (`fix_popup_logic.js`).

---

## 끝맺음

본 문서는 SEAGNAL 의 MMIS 통합에서 **사용자가 무엇을 보는가** 를 중심으로, push_sender·push_helpers·utils·render·render_coastal·routes/push·routes/admin·marine_warning_crawler·marine_client 의 9 모듈을 잇는 변환 사슬을 시나리오별로 정리했다.

핵심 인사이트는 3가지.
1. **출구 5개 (푸시 본문 / 부모 카드 / 자식 카드 / 푸시 상세 팝업 / 지도 박스) 가 모두 같은 `formatWarningTime` 골격을 통과한다**, 단 푸시 본문만 상대일자 라벨 미사용.
2. **자식 표출은 부모 종속 없이 자식 자신의 데이터에만 기인**한다 — 3705f4a, f499308, 0049f2a 시리즈의 결과.
3. **정확시각 고정 시리즈 (b05ce1f → 5ded869 → a7bc5c9 → 7c981d1 → eb06efe)** 가 사용자 가짜 푸시 폭주를 막은 가장 큰 정비.

새 개발자가 이 문서를 다 본 다음에는, 시나리오 추가 시 §4 의 표 패턴대로 templateId / generateMessage 분기 / 카드 표시 분기 / 토글 매핑 / decorateZone (한정사) 5개를 세트로 작업하면 된다.

---

## 부록: 문서 통계

- Part A (시나리오): ~3,838 줄
- Part B (엔드포인트): ~1,588 줄
- Part C (시행착오): ~1,752 줄
- Part D (표출/푸시): ~1,245 줄
- 총: ~8,423 줄 (헤더·구분선 포함 시 ~8,500 줄)

**작성**: 4 개 독립 에이전트 병렬 작성 → 통합 헤더+구분선으로 병합 ()
