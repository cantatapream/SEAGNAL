# SEAGNAL × KMA MMIS 통합 종합 문서

> 대상 저장소: `/home/user/SEAGNAL/`
> 작성일: 2026-06-01 (본문 §1~§7.5) · 통합 갱신: 2026-06-02 (§7.6 추가)
> 범위: MMIS (`marine.kma.go.kr`) 도입 시점부터 현재까지의 전체 메커니즘·시나리오·시행착오·현재 상태·표출 정책
> **통합본**: 별도로 작성됐던 `00_docs/MMIS_특보시스템_히스토리.md`(압축 종합본 + 최신 수정 §13)를 본 문서로 **흡수·일원화**(2026-06-02). 최신 수정(#823~#829)은 **§7.6** 참조. 이 파일이 MMIS 해양특보 시스템의 단일 권위 문서다.

---

# § 0. 이 문서를 읽는 법

## § 0.1 이 문서 소개

### 누구를 위한 문서인가

본 문서는 다음 다섯 부류 독자를 동시에 만족시키도록 설계된다.

1. **신규 합류 개발자** — 이 시스템을 처음 보는 사람이 30분 안에 "MMIS 가 무엇이고, 푸시가 어떻게 발사되며, 카드가 어떻게 그려지는지" 를 한 흐름으로 잡을 수 있어야 한다.
2. **운영/장애 대응자** — "broadcastAll 을 눌렀는데 침묵이다", "콜드부팅 직후 발효 푸시가 나갔다 vs 안 나갔다" 같은 진단을 곧바로 할 수 있는 가드·로그 표가 필요한 사람.
3. **표출/디자인 검토자** — 부모 카드, 자식 카드, 푸시 트레이, 상세 팝업, 지도 폴리곤 박스 다섯 출구의 시각 포맷·뱃지 정책·상대일자 라벨 정책을 한 곳에서 비교하려는 사람.
4. **PM/기획 — lifecycle 정책 결정자** — "예비 → 발효 전이 시점 발표시각은 그대로 유지인가" "자식만 단독 해제 시 푸시 발사인가" 같은 정책 결정을 본문에서 확인하려는 사람.
5. **회고/감사** — "5/22 ~ 6/1 사이 발생한 결정적 시행착오 20+ 건이 무엇이고, 각각 어떤 잘못된 가정에서 출발했는가" 의 시간순 추적을 원하는 사람.

각 부류가 어디부터 읽으면 좋은지는 § 0.3 의 "핵심 질문 10" 에서 안내한다.

### 어떻게 만들어졌는가 (4 초안 → 1 통합)

본 문서는 한 번에 작성된 단일 본문이 아니다. 작업 흐름은 다음과 같다.

1. **Phase 1 (병렬 4 초안)** — 4 명의 에이전트가 각자 다른 관점(데이터 모델 / 시나리오 상태머신 / 시행착오 인지심리 / 사용자 표출) 으로 동시에 초안을 작성. 결과는 `draft_1.md` (1,588 줄) + `draft_2.md` (3,838 줄) + `draft_3.md` (1,752 줄) + `draft_4.md` (1,245 줄) 총 8,423 줄.
2. **Phase 2 (단순 concat 실패)** — 4 초안을 단순 이어붙인 첫 통합본(8,503 줄) 은 "겹치는 거 제외, 비겹치는 것은 다 포함" 이라는 사용자 지침 8 을 정면 위배. § 2 ~ § 7 의 6 절이 각 4 번씩 중복 출현. 이는 `/tmp/mmis_review/compliance_report.md` 의 V1 [HIGH] 위배로 기록됨.
3. **Phase 3 (현재 — 본 문서)** — 5 명 에이전트 (§ 0+§ 1 / § 2+§ 3 / § 4 / § 5+§ 6 / § 7+§ 8) 가 각 절을 **단일 권위(canonical) 위치** 로 재분배해 작성. 중복은 cross-reference (§ X.Y) 로만 처리. 메인 에이전트가 5 절을 최종 조립.

### 통합본의 단일 구조

본 문서는 다음 9 절로 구성된다. **같은 사실은 단 한 곳에서만 권위 있게 다뤄진다.** 다른 절에서는 그 위치를 `→ § X.Y` 형식으로만 참조한다.

| 절 | 주제 | 권위 위치 |
|---|---|---|
| § 0 | 이 문서를 읽는 법 + Express Cheatsheet + 핵심 질문 + Cross-link 매트릭스 | (메타) |
| § 1 | 개요 — SEAGNAL 소개, 해상특보 lifecycle, MMIS 전환 동기 | 시스템 진입 |
| § 2 | MMIS 데이터 모델 — 엔드포인트·필드·envelope·인코딩 | 데이터 단일 출처 |
| § 3 | 데이터 흐름 — 1 분 cron pipeline, snapshot, diff, push 발사 | 파이프라인 권위 |
| § 4 | 시나리오별 동작 — 25+ S-* 카탈로그 (입력 → 처리 → 푸시 → 표시) | 케이스 권위 |
| § 5 | 사용자 표출 — `render.js` / `render_coastal.js`, 카드 정책, 시간 포맷 | UI 권위 |
| § 6 | 시행착오 timeline — 5/22 ~ 6/1 시간순 + 결정적 오판단 20+ 건 | 회고 권위 |
| § 7 | 현재 상태 — 안정 영역 / edge case / 오늘 (2026-06-01) fix | 운영 진단 |
| § 8 | 부록 — 단일 용어집·파일맵·환경변수·디버깅 가이드·deeplink·로그 grep | 참조 권위 |

### 처음 보는 사람이 30분 만에 전체를 잡으려면

다음 권장 트랙을 따른다.

- **5 분 트랙** — § 0.2 Express Cheatsheet 만 읽는다. 시스템 1 문단 요약 + 핵심 다이어그램 + 7 endpoint 표 + 25+ 시나리오 한 줄 카탈로그가 모두 들어 있다.
- **30 분 트랙** — § 1 (개요) → § 2.1 ~ § 2.4 (엔드포인트·envelope·필드) → § 3.1 ~ § 3.3 (파이프라인 단계) → § 4 의 핵심 5 시나리오 (S-COLD / S-NONE→PRELIM / S-PRELIM→ACTIVE / S-ACTIVE-YNCH / S-RELEASE) → § 7.1 (오늘의 안정 영역).
- **2 시간 트랙** — 위 + § 4 전체 + § 5 (사용자 표출) + § 6 의 결정적 시행착오 상위 10건.
- **회고/감사 트랙** — § 6 시행착오 timeline 전체 + § 8 부록의 git 히스토리 인덱스.

### 작성 원칙 (이 문서의 약속)

- **누락 없음** — "요약하자면", "간단히 말해" 같은 축약은 의도적으로 피했다. 길어도 모든 시행착오와 결정 근거를 보존한다.
- **단일 권위** — 같은 사실은 한 곳에서만 다룬다. 다른 곳에서는 `→ § X.Y` 로만 참조한다.
- **코드 인용** — 가능한 한 `파일경로:줄번호` 또는 `커밋해시` 인용. 검증 가능성을 우선시한다.
- **시간순** — 시행착오는 시간순. 시나리오는 lifecycle 순. 데이터 흐름은 cron 사이클 순.
- **한국어** — 본문은 한국어. 코드·필드명·커밋 해시·파일 경로만 영문 유지.
- **자격증명 보호** — `MARINE_USER_ID/MARINE_USER_PWD` 의 실제 값은 본 문서 어디에도 평문으로 노출되지 않는다 (지침 0-A).

---

## § 0.2 Express Cheatsheet (5 분 핵심)

### 시스템 1 문단 요약

SEAGNAL 은 한국 해상 종사자(어선·낚싯배·해경·항해사·해양 레저) 를 위한 모바일/웹 앱으로, 기상청 KMA 의 **해상 특보 (풍랑 V·태풍 T)** 와 해양 기상 정보를 사용자별 구독 해역에 맞춰 푸시·카드로 전달한다. 본 시스템의 백엔드는 1 분 주기로 KMA MMIS (`marine.kma.go.kr`) 의 7 endpoint 를 호출해 **부모/자식 zone × 발효중/예비/통보문** 의 9 축을 통합한 단일 snapshot 을 만들고, 직전 snapshot 과 diff 해 lifecycle 전이 (발표 / 발효 / 격상·격하 / 시각 변경 / 연장 / 해제예고 / 해제) 를 자동 분류해 사용자별 FCM 푸시를 발사하며, 같은 데이터를 `weather_alerts.json` 으로 디스크에 써 프론트가 폴링해 카드/지도/팝업으로 렌더한다.

### 핵심 다이어그램 — MMIS → 크롤러 → state → diff → push + UI

```
┌──────────────────────────────────────────────────────────────────┐
│                  KMA MMIS (외부, marine.kma.go.kr)                │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ 비로그인 6 endpoint (1분 cron)                              │ │
│  │   warn/list           — 부모 발효중                          │ │
│  │   warn/ready          — 부모 예비                            │ │
│  │   warn-sasc/list      — 자식 발효중                          │ │
│  │   warn-sasc/ready     — 자식 예비                            │ │
│  │   warn/latest         — 부모 가장 최근 통보문(해제 포함)     │ │
│  │   warn-sasc/latest    — 자식 가장 최근 통보문                │ │
│  │ 인증 endpoint (현재 사용 안 함)                              │ │
│  │   warn/ef/list        — 발효 timeline (JWT 필요)             │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────┬───────────────────────────────────────────┘
                      │ HTTPS GET (Node built-in https)
                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  local_server/services/marine_client.js                          │
│   - 200 ms rate-limit 게이트                                      │
│   - envelope 정규화 (`{payload}` / `{data}` 둘 다 흡수)           │
│   - fetchAllRealtimeEndpoints() — 4 endpoint Promise.allSettled  │
│   - 부분 실패 시 throw → 본 사이클 통째 skip (E-4 가드)          │
└─────────────────────┬───────────────────────────────────────────┘
                      ▼
┌──────────────────────────────────────────────────────────────────┐
│  local_server/marine_warning_crawler.js — 본체                    │
│                                                                    │
│   1 분 cron (scheduler.js:1605) → run()                           │
│                                                                    │
│   ① fetchAllRealtimeEndpoints()             [E-4 가드]            │
│   ② _buildSnapshotFromMarine()              → curr StateSnapshot  │
│   ③ _enrichSnapshotWithLatest()             ← warn/latest 보강    │
│   ④ E-1 콜드부팅 가드 (`isFirstLoad` 조건부 skip)                 │
│   ⑤ _applySuspiciousGuard()                 D-medium 의심 가드    │
│   ⑥ _applyChildReleaseDebounce()            자식 글리치 3분       │
│   ⑦ _applyAnnounceAnchor()                  발표시각 영구 고정    │
│   ⑧ _applyReleaseClrLogic()                 해제예정 hold/연장   │
│   ⑨ _applyUpcomingEfLogic()                 발효예정 hold/연장   │
│   ⑩ _debounceTimeValues()                   시각 진동 3분 디바운스 │
│   ⑪ _buildUserPushChanges(prev, curr)       → changes[]           │
│   ⑫ push_sender.processChanges(changes)     → POST /api/push-custom│
│   ⑬ _updateExtensionMemory(curr)                                   │
│   ⑭ _savePrevSnapshot(curr)                 → marine_warning_state │
│   ⑮ _writeWeatherAlertsJson(prev, curr)     → weather_alerts.json │
└───────────────┬──────────────────────────────────┬────────────────┘
                ▼                                  ▼
┌───────────────────────────┐       ┌───────────────────────────────┐
│ routes/push.js            │       │ data/weather_alerts.json       │
│ POST /api/push-custom     │       │ (디스크 — 프론트 폴링 대상)    │
│  - 구독자 zone 필터        │       └───────────────┬───────────────┘
│  - 야간 차단 토글          │                       │ HTTP GET
│  - generateMessage()       │                       ▼
│  - FCM admin.messaging()   │       ┌───────────────────────────────┐
│  - 만료 토큰 정리          │       │ 프론트 (js/render.js,         │
│  - history 기록            │       │         render_coastal.js,    │
└───────────────┬───────────┘       │         utils.js)              │
                ▼                    │  - 부모/자식 카드 렌더         │
        FCM / Web Push               │  - formatWarningTime           │
                ▼                    │  - 지도 폴리곤 색칠            │
       사용자 모바일 트레이          └───────────────────────────────┘
```

### 7 endpoint 한 줄 요약 표

| Endpoint | 인증 | 역할 | 본 시스템에서의 1분 cron 사용 |
|---|---|---|---|
| `warn/list` | 비로그인 | 현재 발효 중인 부모 zone | 매 사이클 호출 (필수) |
| `warn/ready` | 비로그인 | 예비 (부모+자식 혼재) | 매 사이클 호출 (필수) |
| `warn-sasc/list` | 비로그인 | 현재 발효 중인 자식 zone | 매 사이클 호출 (필수) |
| `warn-sasc/ready` | 비로그인 | 예비 자식 | 매 사이클 호출 (필수) |
| `warn/latest` | 비로그인 | 부모별 가장 최근 통보문 (해제·발표대기 포함, 정확시각 보강) | 매 사이클 호출 (보조) |
| `warn-sasc/latest` | 비로그인 | 자식별 가장 최근 통보문 | 매 사이클 호출 (보조) |
| `warn/ef/list` | **JWT** | 발효 timeline (영구 row) | 사용 안 함 (silent skip) |

자세한 필드 shape·envelope 형식·인코딩(58/59 범위코드 등) 은 → § 2.

### 25+ 시나리오 카탈로그 (이름·언제 발생·푸시 결과)

| 시나리오 ID | 언제 발생 | 푸시 결과 |
|---|---|---|
| S-COLD | 배포 직후 콜드 부팅 (빈 prev) | E-1 가드로 모두 skip (단, `isFirstLoad` 무특보→첫특보는 예외) |
| S-BASELINE | 관리자 장부 초기화 (broadcastAll) | 현재 발효 중인 모든 zone 을 "신규 발효" 푸시로 재발사 |
| S-NONE→PRELIM | 무특보 → 예비특보 발표 | 📢 풍랑 주의보 발표 |
| S-PRELIM-TIMECH | 예비 발효시각 변경 | 🕐 발효시각 변경 |
| S-PRELIM-EXTEND | 예비 발효시각 연장 (범위형 → 더 늦은 범위) | 🕐 발효 예정시각 연장 |
| S-PRELIM→ACTIVE | 예비 → 정식 발효 (자연 전이) | 🚨 풍랑 주의보 발효 |
| S-PRELIM-CANCEL | 예비특보 취소 (정식 발효 없이 사라짐) | ✅ 풍랑 예비특보 취소 (또는 무푸시) |
| S-NONE→ACTIVE | 무특보 → 정식 발효 (예비 없이 바로) | 🚨 풍랑 주의보 발효 |
| S-ACTIVE-YNCH | 발효중 해제예정시각 변경 | 🕐 해제시각 변경 |
| S-ACTIVE-YNEXTEND | 발효중 해제예정시각 연장 (범위→더 늦은 범위) | 🕐 해제 예정시각 연장 |
| S-LVL-UP | 등급 격상 (주의보 → 경보) | 🚨 풍랑 주의보→경보 격상 발효 |
| S-LVL-DOWN | 등급 격하 (경보 → 주의보) | 🚨 풍랑 경보→주의보 격하 발효 |
| S-TYPE-UP | 종류 격상 (풍랑경보 → 태풍주의보) | 📢 격상 발효 |
| S-TYPE-DOWN | 종류 격하 (태풍 → 풍랑) | 📢 격하 발효 |
| S-RELEASE | 정식 해제 | ✅ 풍랑 주의보 해제 |
| S-CHILD-ADD | 부모 유지 + 자식만 추가 발효 | 📢 풍랑 주의보 추가 발효 (자식 한정사 포함) |
| S-CHILD-RELEASE | 부모 유지 + 자식 일부 해제 | ✅ 풍랑 주의보 일부 해제 |
| S-CHILD-FULLRELEASE | 자식 전부 해제 (부모 유지) | ✅ 모든 연안바다 해제 |
| S-CHILD-EXTEND | 자식 단독 시각 연장 | 🕐 해제 예정시각 연장 (자식 한정사) |
| S-CHILD-BLINK | 자식 깜빡임 (단발 사라짐+복귀) | 푸시 0건 (3분 디바운스 가드) |
| S-CHILD-TIMECH | 자식만 시각 변경 (부모 불변) | 🕐 자식 시각 변경 |
| S-GAP-PARENT | 발표 발효대기 (warn/latest 만 보유, list 미도착) | (없음 — snapshot 보강만, 다음 cycle 본격 push) |
| S-GAP-CHILD | 발표 발효대기 자식 합성 | (없음 — snapshot 보강만) |
| S-HANDOFF | 예비→발표 핸드오프 공백 (1 사이클 prev 비어있음) | _extensionMemory 가교로 중복 발사 차단 |
| S-PARALLEL | 발효+공존 예비 병렬 표출 (upcoming snapshot 슬롯) | 별도 발사 |
| S-PARTIAL-FAIL | endpoint 부분 실패 (cycle skip) | 0 건 (E-4 가드) |
| S-SUSPICIOUS | mmis 빈 응답 의심 (3+ zone 사라짐) | 0 건 (D-medium 가드) |
| S-MM58 | KMA 분=58/59 범위코드 인식 (정확시각 표기 안에 숨은 범위) | 자동 — 6시간 블록으로 환원 |
| S-LATEST-BLINK | warn/latest 가짜 깜빡임 차단 | 0 건 (HOLD) |
| S-DEBOUNCE-VIBRATE | 시각값 진동 디바운스 차단 | 0 건 (3 분 디바운스) |

각 시나리오의 입력·처리·푸시 텍스트·카드 표시는 → § 4 의 해당 항목.

### 핵심 데이터 파일 5개

| 파일 (디스크) | 역할 | 핵심 쓰기 시점 | 비고 |
|---|---|---|---|
| `local_server/data/marine_warning_state.json` | prev StateSnapshot — 직전 사이클의 zone × 상태 영속화 | 매 사이클 끝 (⑭) | fly.io persistent volume; 재배포 시 복원되어 콜드부팅 0 회 보장. `marine_warning_crawler.js:637` |
| `local_server/data/weather_alerts.json` | 프론트가 폴링하는 사용자 표출 단일 진실 (부모/자식 zone 별 현재 상태 + lifecycle 메타) | 매 사이클 끝 (⑮) | `render.js`, `render_coastal.js`, 지도 폴리곤이 모두 이 파일을 읽음 |
| `local_server/data/custom_push_history.json` | 사용자 푸시 발사 이력 (zone × templateId × 발사 시각) | `routes/push.js` 발사 직후 | 중복 발사 차단·운영 진단·broadcastAll 회고에 사용 |
| `local_server/data/pending_pushes.json` | 발사 대기 큐 (야간 차단 / 디바운스로 지연된 항목) | `push_sender.js:18` | 야간 토글 OFF 사용자의 자정 시간대 푸시를 보류했다가 아침에 발사 |
| `local_server/data/marine_suspicious_state.json` | 의심 가드 (D-medium) 의 누적 상태 — 빈 응답 의심을 사이클 간 추적 | 의심 사이클마다 | `marine_warning_crawler.js:691` ; 재배포 시 복원되어 의심 카운트 유지 |

(또한 `push_subscriptions.json` 은 FCM 토큰·구독 해역·옵션 토글을 보관하지만 본 문서의 단일 진실 5 개 데이터 파일에는 포함하지 않는다 — 보안상 gitignore.)

### 핵심 가드 7개 (한 줄 설명)

| 가드 | 위치 (개념) | 한 줄 설명 |
|---|---|---|
| **E-1 콜드부팅 가드** | run() 입구 | prev 가 비어 있을 때 모든 zone 을 "신규" 로 잘못 발사하는 사고 방지. 단 `isFirstLoad` (서버 부팅 직후 1 회) 이고 무특보→첫특보 케이스는 예외적으로 통과 (→ § 4.S-COLD, § 6.5.17) |
| **E-2 prev 신선도 가드** | snapshot 저장 직후 | 같은 cycle 안에서 prev 가 갱신되어 같은 diff 가 두 번 발사되는 사고 방지 |
| **E-4 부분 실패 가드** | fetchAllRealtimeEndpoints | 4 실시간 endpoint 중 1 이상이 reject 면 본 cycle 통째 skip (해제 폭주 방지) |
| **D-medium 의심 가드** | _applySuspiciousGuard | 3 + zone 이 동시에 사라지면 MMIS 일시 응답 이상으로 판단, 본 cycle 의 해제 판정을 보류 (→ § 4.S-SUSPICIOUS) |
| **자식 디바운스 (3 분)** | _applyChildReleaseDebounce | 자식 zone 이 통보문 없이 사라진 경우 3 분 연속 부재 시에만 해제 확정 — 글리치 흡수 (→ § 4.S-CHILD-BLINK) |
| **HOLD (정확시각 anchor)** | _applyReleaseClrLogic / _applyUpcomingEfLogic | warn/latest 가 정확시각을 한 번 제공한 후 다음 cycle 에 범위형으로 깜빡여도 정확값을 유지 (→ § 4.S-LATEST-BLINK) |
| **시각 디바운스 (3 분)** | _debounceTimeValues | tm_ef / clr_ntc_tm 같은 시각 필드가 cycle 마다 진동할 때 3 분 연속 같은 값일 때만 변경 푸시 발사 (→ § 4.S-DEBOUNCE-VIBRATE) |

자세한 가드 동작과 그 가드가 도입된 시행착오는 → § 6.

### 오늘 (2026-06-01) 의 fix 3 건 요약

1. **E-1 콜드부팅 가드의 `isFirstLoad` 분기 추가** — 자정 무특보→첫특보 푸시 누락 사고를 fix. 콜드부팅 가드를 한 단계 더 세분화해, 서버 부팅 직후이고 무특보 → 첫특보 케이스는 예외적으로 통과시켜 신규 발효 푸시가 정상 발사되도록 함. 커밋 `6df054a`. (→ § 4.S-COLD, § 6.5.17)
2. **KMA 분=58/59 범위코드의 점·대시 형식 인식** — `tm_ef='2026.06.01 05:58'` 같이 정확시각 표기 안에 숨은 6 시간 블록 범위코드를 파서가 미인식하던 사고를 fix. 정규화 함수가 점 형식까지 흡수하도록 확장. 커밋 `8a9a798` → `b786ece`. (→ § 4.S-MM58, § 6.5.16)
3. **broadcastAll 시 발표시각 04 시 보존** — 관리자 장부 초기화 (broadcastAll) 시점에 발효 중인 특보의 발표시각이 "지금 시각" 으로 바뀌어 사용자에게 잘못된 정보가 가던 사고를 fix. broadcastAll 도 MMIS 의 `tm_fc` (원래 발표시각) 를 그대로 사용. (→ § 4.S-BASELINE, § 6.5.14)

---

## § 0.3 이 문서가 답하는 핵심 질문 10 개

신규 개발자가 가장 자주 묻는 질문들. 각 질문에 답하는 본 문서의 위치를 명시한다.

### Q1. MMIS 가 뭐고, 왜 도입했나?

MMIS 는 KMA (기상청) 가 운영하는 해양기상정보포털 (Marine Meteorological Information System) 의 약어이며, `marine.kma.go.kr/mmis_marine_api` 의 구조화된 JSON REST API 를 가리킨다. 이전 SEAGNAL 은 기상청 통보문 HTML 페이지를 정규식으로 파싱하던 방식이었지만, 자연어 어휘 변형·자식 해역 본문 매몰·시각 정밀도 부족·갱신 지연·발표대기(GAP) 케이스 미감지 등의 한계로 MMIS 로 전환했다. → § 1.3.

### Q2. 7 endpoint 각각의 역할은?

`warn/list` (부모 발효중), `warn/ready` (부모 예비), `warn-sasc/list` (자식 발효중), `warn-sasc/ready` (자식 예비), `warn/latest` (부모 가장 최근 통보문), `warn-sasc/latest` (자식 가장 최근 통보문), `warn/ef/list` (인증 필요 — 영구 timeline, 현재 사용 안 함) — 7 endpoint 의 정확한 path·인증·envelope·row shape·field 의미는 → § 2.1 ~ § 2.4.

### Q3. 푸시는 언제, 어떻게 발사되나?

매 1 분 cron 사이클에서 prev StateSnapshot 과 curr StateSnapshot 을 diff 해 lifecycle 전이를 자동 분류한 뒤, `_buildUserPushChanges()` 가 changes[] 를 만들고 `push_sender.processChanges()` 가 `POST /api/push-custom` 으로 발사한다. 각 시나리오의 발사 조건·텍스트는 → § 4 의 해당 시나리오, 푸시 그룹핑/페이지 분할/야간 차단 정책은 → § 3.3.

### Q4. 발효시각/해제시각 hold (HOLD) 가 뭐고 왜 필요한가?

`warn/latest` 응답은 같은 zone 의 cmd 가 cycle 마다 깜빡일 때가 있다 — 정확시각을 내려보내다가 다음 cycle 에 범위형으로 후퇴하기도 한다. 만약 그대로 따라가면 사용자 카드의 해제시각이 "01:00" ↔ "23일 새벽" 사이를 진동하고, 푸시는 "해제시각 변경" 을 매 cycle 반복 발사하게 된다. 그래서 한번 정확값이 잡힌 zone 의 해당 시각은 영구 고정 (HOLD) 하고, MMIS 가 같은 시각 윈도우 안에서 변경하더라도 무시한다. → § 4.S-ACTIVE-YNCH, § 6.5.6.

### Q5. 자식 카드는 왜 정확시각만 표시하는가?

자식 zone (연안바다·평수구역) 의 시각 정보는 부모와 같이 묶여 응답에 실리지만, 종종 `tm_ef` 가 부모와 달리 범위형 ("22일 21시~24시") 으로 늦게 들어오거나 통보문이 부모와 자식 사이에 시차를 두고 발행되어 잠시 부정확하다. 자식 카드가 "표시→사라짐→표시" 깜빡임을 일으키지 않도록, 자식 카드의 발효시각 행은 `isExactSingleTime(alert.tmEf)` 가 true 일 때만 (= 정확시각 일 때만) 렌더된다. 범위형이면 행 자체가 표시 안 됨. → § 5.3, § 6.5.3.

### Q6. 콜드부팅 시 E-1 가드는 어떻게 동작하나?

서버 재배포 직후 첫 cron 사이클에서는 `marine_warning_state.json` 이 비어 있을 수 있고, 그 상태에서 curr 만 있는 채로 diff 를 돌리면 모든 활성 zone 이 "신규" 로 잘못 분류되어 폭주 푸시가 나간다. 그래서 E-1 가드가 prev 가 비어 있는 첫 cycle 의 모든 발사를 skip 한다. 단 5/30 자정에 무특보→첫특보 케이스에서 정당한 신규 발효 푸시까지 막혀 사용자 신고가 들어왔고, `isFirstLoad` (서버 부팅 직후 1 회만 true) 조건을 추가해, 콜드부팅이면서 prev=빈 이면서 curr=신규 발효 인 경우는 예외적으로 통과시키도록 fix 됨 (커밋 `6df054a`). → § 4.S-COLD, § 6.5.17.

### Q7. 의심 가드 (D-medium) 는 어떤 경우 작동하나?

MMIS 가 일시적으로 빈 응답이나 부분 응답을 주는 경우가 있다 (KMA 서버 재시작·DB 갱신 중 등). 만약 그대로 따라가면 "갑자기 5 zone 의 특보가 모두 해제됨" 으로 분류되어 5 건의 해제 푸시가 잘못 발사된다. D-medium 의심 가드는 **3 zone 이상이 동시에 사라진** cycle 에 대해 해당 cycle 의 해제 판정을 보류하고, 다음 cycle 에서 zone 들이 돌아오는지 관찰한다. 돌아오면 가짜 해제로 무시, 계속 부재면 진짜 해제로 확정. → § 4.S-SUSPICIOUS, § 6.5.7.

### Q8. 디바운스 3 분 정책의 근거는?

KMA MMIS 의 시각 필드 (`tm_ef`, `clr_ntc_tm`) 는 같은 통보문에 대해 cycle 마다 미세하게 다른 값으로 응답할 때가 있다 (소스 데이터 갱신 타이밍 차이). 디바운스 없이 따라가면 푸시 트레이가 같은 zone 의 "시각 변경" 으로 5 분 사이 4 회 울릴 수 있다. 3 분 디바운스는 **시각 값이 같은 상태로 3 분(=3 cycle 이상) 연속 유지** 될 때만 변경 확정으로 분류한다. 3 분이라는 숫자는 KMA 운영 관측상 한 통보문의 갱신 안정화 시간이 약 2 분이고, 거기에 1 cycle 마진을 더한 것. → § 6.5.15.

### Q9. broadcastAll 을 눌렀는데 침묵 푸시가 발생하면 어디부터 진단하나?

다음 순서로 점검한다: ① `routes/admin.js` 의 `/api/admin/marine/reset` 가 200 으로 응답했는가 (관리자 페이지 로그) → ② `marine_warning_state.json` 이 비워졌는가 (forceBaseline 모드 진입) → ③ 다음 1 분 cron 에서 `forceBaselinePush=true` 로 진입했는가 (서버 로그 `[Marine] baseline push`) → ④ `_buildUserPushChanges()` 가 active zone 별로 changes 를 만들었는가 → ⑤ `POST /api/push-custom` 이 200 응답하고 FCM 전송 결과 (`successCount`) 가 양수인가 → ⑥ `custom_push_history.json` 에 기록되었는가 → ⑦ 만약 0 건이면 ADMIN_PUSH_ENABLED 토글이 꺼진 게 아닌가 (dmdw 채널은 비활성, 사용자 채널은 별도). → § 7.2.

### Q10. 새 시나리오를 추가하려면 어디부터 손대야 하나?

다음 6 단계 가이드를 따른다.

1. `marine_warning_crawler.js` 의 `DiffMatrix.compute` (약 413 줄 근처) 에서 새 분기를 추가해 changes 타입을 등록.
2. `services/push_helpers.js` 의 `generateMessage()` 에 새 templateId 분기 추가, 푸시 텍스트 골격 정의.
3. `js/render.js` (부모 카드) 또는 `js/render_coastal.js` (자식 카드) 에 표시 분기 추가.
4. § 4 에 새 S-* 시나리오 항목 추가 (입력 → 전제조건 → 단계별 처리 → 출력 → 카드 표시).
5. § 0.2 의 시나리오 카탈로그 표에 한 줄 추가.
6. 테스트: `local_server/test/` 에 fixture (`prev`, `curr` snapshot JSON 쌍) 를 만들고 `_buildUserPushChanges` 결과를 검증.

자세한 코드 위치 매트릭스는 → § 8.6.

---

## § 0.4 Cross-link 매트릭스 (시나리오 ↔ 섹션)

각 S-* 시나리오의 메인 정의 위치 (§ 4) / 표출 영향 (§ 5) / 시행착오 출처 (§ 6) / 부록 추가 자료 (§ 8) 를 한 표로 정리한다.

| 시나리오 ID | § 4 (메인) | § 5 (표출) | § 6 (시행착오) | § 8 (부록) |
|---|---|---|---|---|
| S-COLD | § 4.1 | § 5.10.1 | § 6.5.17 (`6df054a`) | § 8.5 디버깅 |
| S-BASELINE | § 4.2 | § 5.10.2 | § 6.5.14 (broadcastAll tmFc 보존) | § 8.5 디버깅 |
| S-NONE→PRELIM | § 4.3 | § 5.4.1 (예비 카드) | § 6.2 (5/22 첫 발사 채널 복원) | — |
| S-PRELIM-TIMECH | § 4.4 | § 5.5.2 (시각 변경 표시) | § 6.5.15 (3 분 디바운스) | — |
| S-PRELIM-EXTEND | § 4.5 | § 5.5.3 (연장 텍스트) | § 6.5.5 (범위형 연장 정책, `b411cea`) | § 8.7 페이지 분할 |
| S-PRELIM→ACTIVE | § 4.6 | § 5.4.2 → § 5.4.3 (자연 대체) | § 6.5.10 (발표시각 anchor, `451f48e`) | — |
| S-PRELIM-CANCEL | § 4.7 | § 5.4.1 → 무특보 | — | — |
| S-NONE→ACTIVE | § 4.8 | § 5.4.3 | — | — |
| S-ACTIVE-YNCH | § 4.9 | § 5.5.1 (해제예정 row) | § 6.5.6 (window memory `2866fe0`) | — |
| S-ACTIVE-YNEXTEND | § 4.10 | § 5.5.3 | § 6.5.5 | § 8.7 |
| S-LVL-UP | § 4.11 | § 5.4.4 (자연 대체) | § 6.5.10 (`_anchorLevel`) | — |
| S-LVL-DOWN | § 4.12 | § 5.4.4 | § 6.5.10 | — |
| S-TYPE-UP | § 4.13 | § 5.4.4 | — | — |
| S-TYPE-DOWN | § 4.14 | § 5.4.4 | — | — |
| S-RELEASE | § 4.15 | § 5.4.5 (안전 뱃지) | § 6.5.4 (warn-sasc/latest 도입) | — |
| S-CHILD-ADD | § 4.16 | § 5.3.1 (자식 카드 추가) | § 6.5.13 (자식 독립 데이터, `3705f4a`, `f499308`) | § 8.6 |
| S-CHILD-RELEASE | § 4.17 | § 5.3.2 | § 6.5.13 | — |
| S-CHILD-FULLRELEASE | § 4.18 | § 5.3.3 | § 6.5.11 (디바운스 3 분, `9d47ed3`) | — |
| S-CHILD-EXTEND | § 4.19 | § 5.3.4 | § 6.5.8 (`7821092`) | — |
| S-CHILD-BLINK | § 4.20 | § 5.3.5 (깜빡임 흡수) | § 6.5.11 | § 8.5 (glitch 로그) |
| S-CHILD-TIMECH | § 4.21 | § 5.3.6 | — | — |
| S-GAP-PARENT | § 4.22 | — | § 6.5.18 (GAP 보강) | — |
| S-GAP-CHILD | § 4.23 | — | § 6.5.18 | — |
| S-HANDOFF | § 4.24 | — | § 6.5.7 (`a7bc5c9` #1) | — |
| S-PARALLEL | § 4.25 | § 5.4.6 (병렬 표출) | § 6.5.10.3 (`5213c83`) | — |
| S-PARTIAL-FAIL | § 4.26 | — | § 6.5.1 (E-4 가드) | § 8.5 |
| S-SUSPICIOUS | § 4.27 | — | § 6.5.7 (D-medium) | § 8.5 |
| S-MM58 | § 4.28 | § 5.6 (시간 정규화) | § 6.5.16 (`8a9a798` → `b786ece`) | § 8.7 |
| S-LATEST-BLINK | § 4.29 | § 5.5.4 (정확값 고정) | § 6.5.6 (`b05ce1f`) | — |
| S-DEBOUNCE-VIBRATE | § 4.30 | § 5.5.5 | § 6.5.6.6 (`eb06efe`) | — |

(§ 5, § 6, § 8 의 정확한 항목 번호는 각 에이전트의 산출물과 최종 조립 단계에서 일치 검증되어야 한다 — 본 매트릭스는 메인 에이전트가 권위 cross-link 으로 정착시킨다.)

---

## § 0.5 핵심 파일 위치 + 브랜치

### 코드 cross-reference (모든 경로는 `/home/user/SEAGNAL/` 아래)

| 파일 (절대 경로) | 책임 | 본 문서의 권위 위치 |
|---|---|---|
| `local_server/services/marine_client.js` | MMIS HTTP 클라이언트 — 인증·rate limit·envelope `_unwrap` | § 2.1 ~ § 2.4 |
| `local_server/marine_warning_crawler.js` | 메인 크롤러 — snapshot 구축, diff, HOLD/디바운스, 사용자 push 발사 | § 3 전반, § 4 모든 시나리오 |
| `local_server/push_sender.js` | 사용자 푸시 발송 entry — FCM admin.messaging 호출 | § 3.3 |
| `local_server/services/push_helpers.js` | 푸시 메시지 빌더 — `PushBuilder`, `fmtTime`, `generateMessage`, `buildChildQualifier` | § 5.7 |
| `local_server/services/dmdw_push_sender.js` | 관리자(dmdw) 푸시 채널 — 현재 `ADMIN_PUSH_ENABLED=false` 로 silent | § 6.5.13 |
| `local_server/scheduler.js` | 1 분 cron 호출 (1605 줄 근처) | § 3.1 |
| `local_server/routes/push.js` | `/api/push-custom` 라우트 — zone 필터·야간 차단 토글 | § 3.3 |
| `local_server/routes/admin.js` | `/api/admin/marine/reset` (장부 초기화 + broadcastAll) | § 4.S-BASELINE |
| `local_server/js/utils.js` | 프론트 시각 포매터 `formatWarningTime` | § 5.6 |
| `local_server/js/render.js` | 사용자 앱 부모 카드 렌더 (`renderMainCard`, `formatAlertTime`) | § 5.2 |
| `local_server/js/render_coastal.js` | 사용자 앱 자식 카드 렌더 (`createCoastalElement`, `stripYearMonth`) | § 5.3 |
| `local_server/js/data.js` | 사용자 앱 데이터 정규화 (옛/신 구조 호환) | § 5.1 |
| `local_server/js/admin.js` | 관리자 페이지 UI (장부 초기화 / 전체 사용자 재발송 버튼) | § 4.S-BASELINE |
| `local_server/fix_popup_logic.js` | 푸시 도착 상세 팝업 시각 포맷 (`formatDateTime` → `window.formatWarningTime`) | § 5.5 |
| `local_server/data/marine_warning_state.json` | prev StateSnapshot 영속화 | § 3.5 |
| `local_server/data/weather_alerts.json` | 프론트 폴링 단일 진실 | § 3.5, § 5.1 |
| `local_server/data/custom_push_history.json` | 사용자 푸시 발사 이력 | § 7.2 |
| `local_server/data/pending_pushes.json` | 발사 대기 큐 (야간 차단·디바운스) | § 5.9 |
| `local_server/data/marine_suspicious_state.json` | 의심 가드 누적 상태 | § 4.S-SUSPICIOUS |

### 브랜치

- **본 문서 전용 (메타 브랜치)** — `claude/marine-mmis-history-doc` : 이 통합 문서만 들어있다. 코드 변경 없음.
- **코드 브랜치 (271 커밋 진행)** — `claude/kma-website-reference-KYLtf` : main 대비 +271 커밋. 본 문서가 추적하는 모든 시행착오·fix·정책 결정의 권위 소스. 큰 줄기 4 단계:
  - **A. 기반 전환** — legacy dmdw/weather_alerts crawler 비활성, marine MMIS 크롤러로 사용자 푸시 채널 복원 (`9651167`, `6fcbdb5`, `ff1fe17`)
  - **B. 자식 정보 통합** — `buildChildQualifier`, `PushBuilder`, `PushSplitter`, 자식 독립 푸시 (`95047ad`, `f499308`, `7821092`, `3705f4a`, `0049f2a`)
  - **C. 정확시각 고정** — 범위형 ↔ 정확시각 깜빡임 차단, 윈도우 기반 연장 판정 (`b05ce1f`, `5ded869`, `a7bc5c9`, `7c981d1`, `2866fe0`, `eb06efe`, `451f48e`, `5213c83`, `fe0bda5`)
  - **D. 표출 통일** — 월·시단위·상대일자·범위 보정, 푸시는 라벨 미사용, 야간 경계 일치, 58/59 레거시 코드 (`640fd12`, `2829a0e`, `0aa4ccd`, `5ea305b`, `a05c3d2`, `a0d8ba3`, `8a9a798`, `b786ece`, `f0477c6`)

자세한 git timeline 은 → § 8.4.

---

# § 1. 개요

## § 1.1 SEAGNAL 이란

### 누구를 위한 앱인가

SEAGNAL 은 한국 해상에서 활동하는 다섯 부류 사용자를 1 차 타겟으로 한다.

1. **어선 운영자 / 선장** — 출항 가부 판단에 풍랑·태풍 특보의 lifecycle 전 단계 (예비 → 발효 → 격상 → 해제예고 → 해제) 가 결정적. "내가 출항할 해역의 자식 zone (연안바다·평수구역) 까지" 의 정밀 정보가 필요하다.
2. **낚싯배 운영자 / 손님 안내자** — 같은 부모 앞바다 안에서도 연안바다만 발효 / 평수구역은 미발효 같은 부분 발효 상태가 영업 결정에 직결.
3. **해경 / 해상안전 종사자** — 광역 부모 해역 단위 + 자식 단위를 동시에 모니터링.
4. **항해사 / 화물선 운항자** — 발효예정 (예비) 시각의 정확도가 운항 스케줄에 직결.
5. **해양 레저 / 동호인** — 가벼운 사용자, 자기 자주 가는 해역 1~3 개만 구독.

이 다섯 부류는 모두 "내가 구독한 해역만, 지금 무슨 상태인지, 그리고 곧 무엇이 일어날 것인지" 를 원한다. SEAGNAL 의 핵심 가치 제안은 그것을 **사용자별 구독 필터 × 1 분 폴링 × FCM 푸시 × 카드/지도 시각화** 로 풀어내는 것이다.

### 핵심 가치

- **lifecycle 전 단계 추적** — 단순 "지금 발효 중" 만이 아니라 예비 → 발효 → (등급/시각/종류 변경) → 해제예고 → 해제 의 모든 전이를 푸시로 통지.
- **부모/자식 zone 별도 추적** — 같은 부모 앞바다 안에서도 연안바다·평수구역의 부분 발효/해제 상태를 별도 카드로 표시. 자식만 단독 해제도 푸시.
- **사용자 한정 필터** — 대분류 (남해서부) / 중분류 (남해서부 동쪽 먼바다) / 소분류 (제주도서부앞바다중북서연안바다) 혼재 구독 지원. "전체 해역 구독" 도 별도 옵션.
- **정확 시각 + 상대일자 라벨** — "내일 새벽 03 시" 같은 자연어 표기 + ISO 시각 (`2026.05.23 03:00`) 을 동시 제공. 푸시 본문은 정확값, 카드는 사용자 친화적 한글 표기.
- **야간 차단 토글** — 사용자 옵션으로 자정 시간대 푸시를 보류했다가 아침에 한꺼번에 발사 가능.
- **글리치 흡수** — KMA MMIS 응답이 cycle 마다 깜빡일 때 사용자가 그 깜빡임을 직접 보지 않도록 가드 7 종 다층화 (E-1, E-2, E-4, D-medium, 자식 디바운스, HOLD, 시각 디바운스).

### 사용자 규모 hint

대화 로그에서 발견된 단서:
- 5/30 broadcastAll (전체 사용자 재발송) 이벤트 당시 사용자 채널 발송 대상 약 **1,031 명** 수준 (compaction 요약 추정치). 정확한 일별 활성 사용자 (DAU) 는 본 문서의 권위 영역이 아니다 — 분석 도구는 별도.
- 구독 해역 수는 사용자 평균 2~5 개, 최대 "전체 구독" 토글로 모든 zone.

(사용자 규모는 본 문서의 핵심 주제가 아니므로 § 1.1 에서 1 문단으로 정리하고 종결.)

---

## § 1.2 해상 특보의 lifecycle

해상 특보는 단순한 "발효/해제" 두 상태로는 표현할 수 없는 다단계 lifecycle 을 가진다. 본 절은 KMA 가 정의하는 모델을 그대로 따라가되, SEAGNAL 의 내부 상태 모델 (StateSnapshot) 과 매핑한다.

### § 1.2.1 특보 종류 (V/T allowlist)

KMA 가 해상 특보로 분류해 발표하는 종류는 여러 가지이지만, SEAGNAL 이 대상으로 삼는 것은 사용자 관심도와 신호 대 잡음비를 고려하여 다음 **2 종 (allowlist)** 만이다.

- **풍랑 (風浪, Wind Wave)** — MMIS 실시간 endpoint 의 `warn_tp` 코드 `'V'`. 파도와 바람 결합 위험. 가장 자주 발표되는 해상 특보.
- **태풍 (颱風, Typhoon)** — `warn_tp = 'T'`. 풍랑보다 종류 가중치가 훨씬 높다 (TYPE_RANK: 태풍=100, 풍랑=10, `marine_warning_crawler.js:226` 근처).

다음은 의도적으로 **제외** 된다 (allowlist 정책).

- **폭풍해일 (O, Storm Surge)** — V8 이후 정책적으로 제외 (커밋 `69e9143` — "폭풍해일 특보 수집·표시 전면 중단"). 해상 특보 카테고리이지만 사용자 가치가 낮고, 발생 자체가 드물어 신호 대 잡음비가 낮음. 5/26 폐지 일정에 맞춤.
- **강풍 (W, Strong Wind)** — 본질적으로 육상 특보. MMIS 실시간 응답에서 풍랑과 같은 endpoint 로 섞여 내려오므로 정밀 필터링이 필요.
- **호우 / 대설 / 한파 (R / S / C 등)** — 모두 육상 특보. allowlist 가 자동 제외.

allowlist 의 코드 위치: `marine_warning_crawler.js:2016` 의 `REALTIME_TARGET_TP = new Set(['V', 'T'])`.

> ⚠️ **치명적 함정 1 — 실시간 vs ef/list 의 종류 코드 인코딩이 다르다**
>
> | 종류 | 실시간 (warn/list 등) | ef/list (timeline) |
> |---|---|---|
> | 풍랑 | `'V'` | `'6'` |
> | 태풍 | `'T'` | `'7'` |
> | 강풍 | `'W'` | `'1'` |
> | 폭풍해일 | `'O'` | `'5'` |
>
> 과거 V11 이전에는 "warn_tp === 5" 식으로 **숫자 코드 denylist** 를 썼다. 그러나 실시간 endpoint 는 **문자 코드 (V/T/W/O)** 를 쓴다. 그래서 한동안 강풍·폭풍해일이 푸시에 새어 나가는 버그가 있었다 — 커밋 `dbe2c6b` (V10) → `ff1fe17` (V11 allowlist 도입) 으로 해결. 자세히 → § 6.5.2.

### § 1.2.2 등급 (warn_lvl)

KMA 해상 특보는 2 단계 등급 + 사전 단계가 있다.

| 등급 | 한글 | MMIS 코드 (`warn_lvl`) | 의미 |
|---|---|---|---|
| 예비특보 | "예비" | (`warn/ready` endpoint 자체에 들어옴) | "지금 발효된 것은 아니지만 곧 발효될 가능성" |
| 주의보 | "주의보" | `'2'` | 1 차 발효 |
| 경보 | "경보" | `'5'` (LVL_RANK 점수와 같음 — 우연) | 2 차 발효, 주의보보다 심각 |
| 해제 | "해제" | `''` 또는 row 자체 부재 | 종결 |

> ⚠️ **치명적 함정 2 — `'예비특보'` vs `'예비'` 정규화**
>
> MMIS 실시간 응답은 예비특보를 `warn_lvl_nm = '예비특보'` 로 내려보내지만, SEAGNAL 내부 로직은 모두 `'예비'` 로 비교한다. 그래서 `_normLvlNm()` (`marine_warning_crawler.js:2002`) 가 `'예비특보' → '예비'` 로 정규화한다. 이걸 빠뜨리면 예비 판정이 전부 실패해 발표 푸시가 안 나간다 — V11 의 핵심 fix.

#### 점수 (score) 체계

SEAGNAL 의 격상/격하 판정은 다음 점수 체계를 따른다 (`marine_warning_crawler.js:_score` 부근).

```js
TYPE_RANK = { '태풍': 100, '풍랑': 10, '강풍': 10, ... }
LVL_RANK  = { '경보': 5, '주의보': 2, '예비': 2, '해제': 0, '': 0 }
score(type, lvl) = TYPE_RANK[type] + LVL_RANK[lvl]
```

핵심 함의:

- **예비 == 주의보 동률 (LVL_RANK 2 점)** — "예비특보가 발효되면 주의보가 되는 것" 이라는 현실 모델을 코드에 반영. 따라서 예비 → 주의보 전이는 `_score` 상 격상 아님 (= "level_upgrade" 푸시로 잘못 분류되지 않음). 대신 별도 분기로 `'active'` bucket 에 들어간다 (`DiffMatrix.compute` 의 "예비 → 정식 발효 전이" 처리, `marine_warning_crawler.js:413~420`).
- **종류 가중치는 등급보다 훨씬 크다** — 풍랑경보 (10+5=15) 보다 태풍주의보 (100+2=102) 가 위. 격상/격하 판정에 결정적.

### § 1.2.3 lifecycle 단계

전형적인 한 특보의 인생:

```
   [없음]
     │  (KMA 예보관이 통보문 발행, st_tm < now < tm_ef)
     │  → warn/ready 에 row 등장 (warn_lvl_nm = '예비특보')
     ▼
   예비특보 (UPCOMING)
     │  ─── 발효시각 도래 (tm_ef <= now) ───
     │  → warn/list 로 이동 (warn_lvl_nm = '주의보' or '경보')
     │  → warn/ready 에서 row 사라짐
     ▼
   주의보 발효 중 (ACTIVE)
     │
     ├─ 등급 격상 → 경보 발효중 (warn/list, warn_lvl 변경)
     ├─ 등급 격하 → 주의보 유지 또는 해제
     ├─ 종류 변경 → 태풍주의보 (warn/list, warn_tp 변경)
     ├─ 해제예고 등록 → clr_ntc_tm 추가
     ├─ 발효예정 변경/연장 → tm_ef 변동
     ├─ 해제예정 변경/연장 → tm_yn / clr_ntc_tm 변동
     │
     │  ─── 해제 통보문 (warn/latest cmd=해제) ───
     ▼
   [해제] = warn/list 에서 사라짐
              + warn/latest 에 cmd='해제' row 만 남음
```

### § 1.2.4 시각 4 종 (발표 / 발효 / 해제 / 해제예고) 의 정확한 구분

본 시스템에서 가장 자주 혼동되는 개념. 한 번에 정리한다.

| 시각 명칭 | MMIS 필드 | 의미 | 예시 | 누가/언제 결정 |
|---|---|---|---|---|
| **발표시각** | `tm_fc` (또는 `tmFc`) | 통보문이 KMA 에서 **발행된 시각** — 즉 "이 메시지가 만들어진 시점" | `2026.05.23 04:30` | KMA 예보관이 통보문 작성 시 자동 기록 |
| **발효시각** | `tm_ef` (또는 `tmEf`) | 특보가 **효력을 시작하는 시각** — 예비 단계에서는 미래, 발효 중에는 과거 | `2026.05.23 06:00` | 통보문 본문에 기재 |
| **해제시각** | `tm_yn` (또는 `tmYn`) — 또는 row 자체 부재 | 특보가 **효력을 종료한 시각** — 해제 통보문 발행 후 확정 | `2026.05.23 18:00` | 해제 통보문 발행 시점에 기재 |
| **해제예고시각** | `clr_ntc_tm` (또는 `clrNtcTm`) | 발효 중에 등록되는 "**이 시각에 해제될 예정**" — 정확 또는 범위형 | 정확: `2026.05.23 18:00` / 범위: `'23일 15시 ~ 18시'` | KMA 예보관이 후속 통보문에 추가 등록 |

#### 발표시각 anchor (가장 중요한 정책)

SEAGNAL 은 **발표시각을 lifecycle 한 단위 동안 영구 고정 (anchor)** 한다. 즉 예비 → 발효 → 해제예고 → 해제 전체 사이클 동안 사용자에게 표시되는 "발표시각" 은 처음 예비 통보문이 발행된 그 시각이다 — MMIS 가 cycle 중간에 다시 통보문을 발행해 `tm_fc` 가 후속 시각으로 갱신되어도 사용자 카드의 발표시각은 첫값 그대로 유지된다.

**예외**: 등급 격상 (`주의보` → `경보`) 또는 종류 격상 (`풍랑` → `태풍`) 이 발생하면 anchor 를 재설정한다 — "경보가 새로 발표된 그 시각" 으로. 이는 사용자 멘탈 모델 ("이번 격상이 언제 발표되었나?") 에 맞춘 것.

자세한 구현은 → § 3.7 (`_applyAnnounceAnchor`), 시행착오는 → § 6.5.10 (커밋 `451f48e`).

### § 1.2.5 부모 zone vs 자식 zone

KMA 의 해상 특보 zone 은 계층 구조이다.

- **부모 zone (S1xxxxxx)** — 광역 해역. 예: `남해서부동쪽먼바다 (S1322200)`, `제주도남쪽바깥먼바다`. `warn/list`, `warn/ready` 에 들어옴.
- **자식 zone — 2 종류**
  - **연안바다 (S3xxxxxx)** — 부모 앞바다 내부의 연안 구역. 예: `제주도서부앞바다중북서연안바다`.
  - **평수구역 (S2xxxxxx)** — 부모 앞바다 내부의 평수 (잔잔한) 구역.

자식은 `warn-sasc/list`, `warn-sasc/ready`, `warn-sasc/latest` 에 들어온다. 부모와 같은 응답 사이클에 묶여 도착하므로 race condition 없이 동기화된다 (legacy dmdw 방식의 핵심 문제 해결).

> **자식 독립 정책 (5/25 결정 — U-1)** — 자식 zone 은 부모 zone 의 종속이 아니라 **독립 데이터·표출·푸시** 대상이다. 단, 부모와 자식이 동시에 발효/해제될 때는 부모 메시지에 자식을 한정사 (`buildChildQualifier`) 로 묶어 단일 푸시로 발사. 자식만 단독으로 발효/해제 변경되면 자식 단독 푸시. 이 정책의 구현 시행착오는 → § 6.5.13.

---

## § 1.3 통보문 크롤링 → MMIS 전환

### § 1.3.1 옛 방식 — `weather_alerts_crawler.js` (HTML bulletin)

이전 SEAGNAL 은 다음 두 크롤러를 운영했다.

- **`weather_alerts_crawler.js`** — KMA 의 "특보 통보문" HTML 페이지 (`https://www.weather.go.kr/w/special-report/list.do?stn=108`) 를 직접 크롤링. 통보문 본문 텍스트를 **정규표현식** 으로 파싱해 발효 zone·등급·시각을 추출.
- **`dmdw_warn_crawler.js`** — 방재기상플랫폼 (dmdw, deprecated 시스템) 에서 자식 해역 (연안바다·평수구역) 정보를 추가 수집. 커밋 `de1ad1a` ~ `767b5bf` 가 그 흔적.

이 두 크롤러는 각자 다른 갱신 주기로 같은 `weather_alerts.json` 에 쓰면서 race condition 을 유발했다.

#### 옛 방식의 5 가지 한계

1. **자연어 파싱의 취약성** — 통보문 본문 텍스트는 매년 어휘가 조금씩 변한다. "해제하나" / "해제될" / "해제예정" / "해제하겠음" 같은 어휘 변형이 끊임없이 등장해 정규식이 깨졌다. 커밋 `dd5b1d9` (해제 정규식 V3 — 5 년 데이터 분석 기반 10 가지 어휘 변형 흡수) + `b5bf88b` (V2) 가 그 흔적.
2. **자식 해역 분리 안 됨** — 통보문은 부모 해역 중심이고 자식 해역은 "참고사항" 영역에 자연어로만 등장. 자식별 발효 상태를 따로 추출하려면 별도 파서가 필요했고, 그게 `dmdw_warn_crawler` 로 분리되며 출처가 이중화되었다. 부모·자식 동기화 문제가 상존.
3. **시각 정밀도 부족** — "23 일 3 시 ~ 6 시" 같은 6 시간 범위 텍스트가 통보문의 기본 단위였다. 정확 시각이 필요한 시나리오 (해제예정 변경 푸시·발효시각 변경 푸시 등) 에선 정확도가 떨어졌다.
4. **느린 반응성** — KMA 가 HTML 을 갱신하는 데도 몇 분 지연이 있고, 본문 파싱 자체가 무겁다. 1 분 cron 의 일정한 속도를 보장하기 어려웠다.
5. **GAP 케이스 미감지** — "발표는 났는데 발효시각이 아직 미래" 상태가 통보문 HTML 에는 잘 나타나지 않아 발표 직후 한참 동안 앱에 아무것도 안 보이는 문제. 신규 사용자가 "지금 특보 났다던데 왜 SEAGNAL 엔 없냐" 고 신고하는 일이 잦았다.

### § 1.3.2 MMIS 의 장점

`marine.kma.go.kr/mmis_marine_api/` 는 KMA 가 자기 자신의 해양기상정보포털 (MMIS — Marine Meteorological Information System) 을 운영하기 위해 내부적으로 쓰는 **구조화된 JSON API** 다. SEAGNAL 은 이 endpoint 를 직접 호출해 다음 5 가지 이점을 얻는다.

1. **구조화된 JSON** — 정규표현식 파싱 불필요. 필드명이 명확 (`warn_tp`, `warn_lvl_nm`, `tm_ef`, `clr_ntc_tm` 등). 정규식 V3 같은 5 년치 어휘 적응이 한 번에 사라짐.
2. **부모 + 자식 동시 제공** — `warn/list` (부모) + `warn-sasc/list` (자식) 가 같은 시점의 같은 모델 응답이라 출처 이중화·동기화 문제가 사라진다. legacy `dmdw_warn_crawler` 의 본질적 한계 해소.
3. **상태 단계가 endpoint 로 분리** — 예비는 `/ready`, 발효 중은 `/list`, 최신 통보문은 `/latest`. 폴링 방식이 단순. lifecycle 판정이 자연어 파싱 없이 endpoint 분류만으로 가능.
4. **정확 시각** — 해제 통보문이 발행되면 `warn/latest` 의 `tm_ef` 가 `"2026.05.23 01:00"` 같은 분 단위 정확값을 제공. 범위형 ("23 일 새벽") 으로 표시하던 한계 해소.
5. **빠른 갱신** — KMA 내부 시스템과 같은 데이터 소스이므로 통보문 HTML 보다 먼저 반영됨. 1 분 cron 의 정시 도착 보장.

### § 1.3.3 MMIS 의 비용 / 트레이드오프

공짜는 아니다.

- **자격증명이 필요한 endpoint 가 일부 있다** — `warn/ef/list` (영구 timeline) 는 JWT 인증 필요. 비로그인으로도 6 개 실시간 endpoint 는 호출 가능 (V9 정책 확정). 본 시스템은 인증 endpoint 를 silent skip 함으로써 secrets 관리 부담을 0 으로.
- **비공식 endpoint 이므로 KMA 가 명세를 바꾸면 깨질 수 있다** — 단일 모듈 `services/marine_client.js` 에 격리 + envelope 두 가지 (`{payload}` / `{data}`) 모두 흡수해 대비.
- **warn/latest 의 새로운 종류의 깜빡임** — 같은 zone 의 cmd 가 cycle 마다 다르게 응답하는 글리치가 새로 발견됨. 정확시각 ↔ 범위형 진동, 발표 vs 해제 cmd 진동 등. → HOLD·디바운스·윈도우 가드가 모두 이 새로운 글리치를 흡수하기 위한 대비책.
- **응답 envelope 두 종류 혼용** — `{status, payload}` 와 `{code, data}` 가 endpoint 별로 다름 → `_unwrap` layer 가 둘 다 흡수.

### § 1.3.4 전환 시점 (Phase 0 → Phase 1 → Phase 2)

전환은 점진적이었다.

- **Phase 0 — legacy** (~ v6 시기) : `weather_alerts_crawler` + `dmdw_warn_crawler` 두 크롤러가 사용자 푸시 채널을 점유. `report_alert_processor` 가 통보문 처리.
- **Phase 1 — v7 통합 베이스라인** (커밋 `082da8e` 부근) : `marine_warning_crawler.js` 가 새로 도입되어 MMIS endpoint 를 부분 호출. 그러나 사용자 푸시 채널은 여전히 legacy 가 보유. 신/구 시스템이 같은 데이터를 두 번 처리하던 일시적 이중화 시기.
- **Phase 2 — marine.kma.go.kr 단일 출처화** (5/22 ~ ; `9651167`, `6fcbdb5`, `ff1fe17` 일련의 머지) : legacy 두 크롤러의 사용자 푸시 채널을 절단. `marine_warning_crawler` 가 단독으로 사용자 푸시 채널 보유. 단 관리자 push 채널 (`dmdw_push_sender`) 은 잔존하다가 `ADMIN_PUSH_ENABLED=false` 로 silent disable. 본 시스템은 현재 Phase 2 운영 중.

Phase 1 → Phase 2 전환에서 가장 큰 시행착오는 **5/22 머지 직후 사용자 채널이 끊겨 침묵 푸시가 발생한 사건** (T-1). 자세한 진단은 → § 6.2.

---

## § 1.4 시스템 상위 아키텍처 다이어그램

본 문서의 다른 절들이 좁고 깊이 들어가기 전에, 신규 독자가 시스템 전체 그림을 한 번에 잡을 수 있는 상위 다이어그램을 제공한다. (§ 0.2 의 Cheatsheet 다이어그램을 더 자세히 풀어쓴 버전.)

### § 1.4.1 ASCII 전체 다이어그램

```
        ┌────────────────────────────────────────────────────────┐
        │   KMA MMIS (외부)                                       │
        │   marine.kma.go.kr/mmis_marine_api/v1/kma/              │
        │                                                          │
        │   비로그인 6 endpoint                                     │
        │    ├─ warn/list           (현재 발효 부모)                │
        │    ├─ warn/ready          (예비 부모+자식 혼재)           │
        │    ├─ warn/latest         (부모 가장 최근 통보문 — 해제·  │
        │    │                       발표대기 보강)                  │
        │    ├─ warn-sasc/list      (현재 발효 자식)                │
        │    ├─ warn-sasc/ready     (예비 자식)                     │
        │    └─ warn-sasc/latest    (자식 가장 최근 통보문)         │
        │                                                          │
        │   인증 endpoint (현재 사용 안 함 — silent skip)            │
        │    └─ warn/ef/list        (영구 timeline, JWT 필요)        │
        └──────────────────────────┬─────────────────────────────┘
                                   │ HTTPS GET (Node built-in https)
                                   │ rate limit 200 ms
                                   ▼
        ┌────────────────────────────────────────────────────────┐
        │ services/marine_client.js                                │
        │  - 200 ms rate-limit 게이트                               │
        │  - envelope 정규화 ({payload} / {data} 둘 다 흡수)        │
        │  - fetchAllRealtimeEndpoints() — 4 endpoint              │
        │    Promise.allSettled                                    │
        │  - 부분 실패 시 throw → 본 cycle 통째 skip (E-4)         │
        │  - 인증: login / refresh-token / JWT 30 분                │
        │    (인증 endpoint 만, secrets 비어있으면 silent disable)  │
        └──────────────────────────┬─────────────────────────────┘
                                   │
                                   ▼
        ┌────────────────────────────────────────────────────────┐
        │ marine_warning_crawler.js — 본체                          │
        │                                                          │
        │   매 1 분 cron (scheduler.js:1605) → run()                │
        │                                                          │
        │   ① fetchAllRealtimeEndpoints()      [E-4 가드]          │
        │   ② _buildSnapshotFromMarine()       → curr StateSnapshot │
        │   ③ _enrichSnapshotWithLatest()      ← warn/latest        │
        │      · 정확 해제시각 보강 (clr_ntc_tm)                    │
        │      · GAP 발표 발효대기 보강                              │
        │        (warn/list 에 없지만 통보문 있는 부모)              │
        │      · 자식 해제 통보문 집합 (_childReleaseNoticeSet)     │
        │   ④ E-1 콜드부팅 가드                                     │
        │      (isFirstLoad + empty prev + 무특보→첫특보 외 skip)   │
        │   ⑤ _applySuspiciousGuard()       — D-medium 의심 가드   │
        │   ⑥ _applyChildReleaseDebounce()  — 자식 글리치 3 분     │
        │   ⑦ _applyAnnounceAnchor()        — 발표시각 영구 고정    │
        │   ⑧ _applyReleaseClrLogic()       — 해제예정 hold/연장   │
        │   ⑨ _applyUpcomingEfLogic()       — 발효예정 hold/연장   │
        │   ⑩ _debounceTimeValues()         — 시각 변경 3 분 디바운스│
        │   ⑪ _buildUserPushChanges(prev,curr) → changes[]          │
        │   ⑫ push_sender.processChanges(changes)                   │
        │       → POST /api/push-custom                             │
        │   ⑬ _updateExtensionMemory(curr)                          │
        │   ⑭ _savePrevSnapshot(curr)                               │
        │       → data/marine_warning_state.json                    │
        │   ⑮ _writeWeatherAlertsJson(prev, curr)                   │
        │       → data/weather_alerts.json                          │
        └─────────────────┬───────────────────┬──────────────────┘
                          │                   │
                          ▼                   ▼
        ┌────────────────────────┐  ┌────────────────────────────┐
        │ routes/push.js          │  │ data/weather_alerts.json   │
        │ POST /api/push-custom   │  │ (디스크 — 사용자 앱        │
        │  - 구독자 zone 필터     │  │    폴링 대상)               │
        │  - 야간 차단 토글       │  └────────────────┬───────────┘
        │  - generateMessage()    │                   │ HTTP GET
        │    (push_helpers.js)    │                   │ (~10 초 폴링)
        │  - FCM admin.messaging  │                   ▼
        │  - 만료 토큰 정리        │  ┌────────────────────────────┐
        │  - history 기록         │  │ 프론트                      │
        │    (custom_push_history)│  │  - js/render.js             │
        └──────────┬──────────────┘  │    (부모 카드)               │
                   ▼                  │  - js/render_coastal.js     │
            FCM / Web Push            │    (자식 카드)               │
                   ▼                  │  - js/utils.js              │
          사용자 모바일 트레이         │    formatWarningTime         │
                   ▼                  │  - 지도 폴리곤 (ocean_warn_  │
              상세 팝업                │    active*.js)               │
              (fix_popup_logic.js)    │    색칠·클릭 박스             │
                                     └────────────────────────────┘
```

### § 1.4.2 다이어그램 읽는 법

- **위에서 아래로** — 외부 KMA 서버에서 사용자 화면까지의 데이터 흐름.
- **세로 점선** — 디스크 영속화 (재배포·서버 재시작에도 보존되는 단일 진실 5 개 데이터 파일은 → § 0.2).
- **이중 출구** — 사용자에게 도달하는 두 경로: ① FCM 푸시 (능동) ② weather_alerts.json 폴링 (수동). 두 경로는 같은 cycle 의 같은 데이터로부터 갈라지므로 항상 일관성 유지.
- **가드 7 종 위치** — 다이어그램의 ④~⑩ 단계에 모두 들어있다. 가드 7 종 한 줄 설명은 → § 0.2 ; 각 가드의 정확한 트리거 조건·동작·도입 시행착오는 → § 6.

### § 1.4.3 본 다이어그램이 보여주지 않는 것

다이어그램은 다음 항목들을 의도적으로 생략한다 (다른 절에서 다룸).

- **사용자 구독 매칭 알고리즘** — `routes/push.js` 의 zone 필터 (대분류/중분류/소분류 혼재 + "전체 구독" 토글) → § 3.4 에서 상술.
- **푸시 그룹핑 + 페이지 분할** — 같은 시각 같은 시나리오의 다수 zone 묶음 발사, 200 자 (정확히는 165 자) 한도 초과 시 1/2 2/2 분할 → § 3.3, § 8.7.
- **카드 렌더의 분기 (`isCoastal`, `isExactSingleTime` 등)** — § 5.
- **운영 진단 (broadcastAll 침묵 푸시·콜드부팅 false 양성 등)** — § 7.

---

(§ 1 끝)
# § 2. MMIS 데이터 모델

본 절은 **SEAGNAL 이 KMA marine.kma.go.kr (MMIS — 해양기상정보포털) API
로부터 받는 raw 데이터의 정확한 형태와, 그것을 내부 표상으로 가져올 때까지의
모든 정규화 규약**을 한 곳에 모은다. § 3 의 데이터 흐름이 "이 데이터가
어떻게 흐르는가" 라면, § 2 는 "흐르는 데이터의 정체가 무엇인가" 다.

설계 원칙:

1. **단일 권위 source 는 endpoint 응답 그 자체**다. 그러나 endpoint 응답은
   envelope·형식·인코딩에서 일관성이 부족하므로 (응답 봉투 2 종, 시각 표현
   5 종, 분=58/59 레거시 코드, HTML 엔티티 잔재 등), 내부에서 사용하기 전에
   **반드시 정규화 layer 를 통과**해야 한다.
2. **정규화는 단계적으로** 일어난다 — (a) `_unwrap` 으로 봉투 통일,
   (b) `_resolveZoneName` 으로 zone 명 해석, (c) `_normLvlNm` 으로 등급명
   통일, (d) `_isTargetRealtimeType` 으로 종류 allowlist, (e)
   `normalizeMmisTime` 으로 시각 한글화. 각 layer 의 위치·역할·실패 모드를
   정확히 추적해야 한다.
3. **"한 endpoint 만 봐서는 진실을 알 수 없다"** — 발효중·예비·통보문이
   별개 endpoint 로 분리되어 있어서, 한 zone 의 정확한 상태는 6 개 endpoint
   (warn/list · warn/ready · warn/latest · warn-sasc/list · warn-sasc/ready ·
   warn-sasc/latest) 의 매트릭스 교차 비교로만 얻을 수 있다.

§ 4 의 시나리오 처리와 § 5 의 표출 layer 는 본 § 2 의 데이터 모델 위에
얹혀 있다. § 6 의 시행착오 timeline 은 본 § 2 의 각 정규화 규약이
**왜 추가되었는지**를 시간순으로 풀어준다.

---

## § 2.1 endpoint 카탈로그

`local_server/services/marine_client.js:85~97` 의 `PATHS` 상수가 SEAGNAL 이
호출하는 모든 MMIS endpoint 의 단일 출처다. 호출은 매 1 분 cron
(§ 3.1) 안에서 일어난다.

| Path | 인증 | 호출 함수 | 호출 시점 | 역할 |
|------|------|-----------|-----------|------|
| `/v1/kma/warn/list` | 비로그인 | `fetchWarnList` | 매 1분 (실시간) | 현재 **발효 중인 부모** zone |
| `/v1/kma/warn/ready` | 비로그인 | `fetchWarnReady` | 매 1분 (실시간) | **예비특보** (부모+자식 혼재) |
| `/v1/kma/warn-sasc/list` | 비로그인 | `fetchWarnSascList` | 매 1분 (실시간) | 현재 **발효 중인 자식** zone |
| `/v1/kma/warn-sasc/ready` | 비로그인 | `fetchWarnSascReady` | 매 1분 (실시간) | **예비 자식** |
| `/v1/kma/warn/latest` | 비로그인 | `fetchWarnLatest` | 매 1분 (보강) | 부모별 **가장 최근 통보문** |
| `/v1/kma/warn-sasc/latest` | 비로그인 | `fetchWarnSascLatest` | 매 1분 (보강) | 자식별 **가장 최근 통보문** |
| `/v1/kma/warn/ef/list` | **로그인 필요** | `fetchWarnEfList` | 사이클당 1회 (gap 보강) | 발효 **timeline** (영구 row) |
| `/v1/kma/warn/ntfctn/list` | 로그인 필요 | (호출 안 함) | — | 통보문 목록 |

위 8 endpoint 중 SEAGNAL 운영의 핵심은 **비로그인 6 + 인증 1** = 7 개다.
`warn/ntfctn/list` 는 V11 까지 검증한 끝에 통보문 archive 가 다른 6 endpoint
의 조합으로 모두 도출 가능하다고 판명되어 호출하지 않는다.

비로그인 4 endpoint (`warn/list`, `warn/ready`, `warn-sasc/list`,
`warn-sasc/ready`) 는 `fetchAllRealtimeEndpoints()` 가 `Promise.allSettled`
로 묶어 동시 호출한다 (`marine_client.js:438~465`). 하나라도 reject 되면
`fetchAllRealtimeEndpoints` 자체가 throw 하여 호출 측(crawler.run)에서
**이번 cycle 통째로 skip** 한다 — 마지막 성공 state 를 유지하고 push 0회.
이를 **E-4 가드** (§ 3.2 ⑥) 라 부른다.

`warn/latest` 와 `warn-sasc/latest` 는 보강용이라 실패해도 graceful — 보강만
skip 하고 cycle 진행 (`marine_warning_crawler.js:2821~2829`).
`warn/ef/list` 도 보강용이며, 인증 미설정(`AUTH_ENABLED=false`) 이면 자동
skip ([] 반환) 이라 비로그인 운영도 가능하다.

### 2.1.1 `warn/list` — 발효 중인 부모 zone

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/list
```

**응답**: 봉투 `{ status: 200, payload: [...] }` 또는 `{ code: '0000', data: [...] }`
(§ 2.3.1 참조). row 배열 안에 **현재 효력 발생 중인 부모 zone** 만 들어온다.

```json
{
  "status": 200,
  "payload": [
    {
      "warn_zone_cd": "S1311100",
      "warn_zone_nm": "부산앞바다",
      "warn_tp": "V",
      "warn_tp_nm": "풍랑",
      "warn_lvl": "2",
      "warn_lvl_nm": "주의보",
      "tm_fc": "2026.06.01 04:30",
      "tm_ef": "2026.06.01 06:00",
      "tm_yn": "2026.06.01 23:58",
      "clr_ntc_tm": "01일 21시 ~ 24시"
    }
  ]
}
```

- 한 row = 한 부모 zone 의 현재 발효 상태 (zone 마다 최대 1 row).
- 같은 zone 에 풍랑+태풍이 동시 발효되어 있어도 응답에는 가장 우선되는
  특보 종류 하나만 나옴.
- `warn_lvl_nm` 은 `'주의보'` / `'경보'` — **예비특보는 여기 안 들어옴**.
- **이 endpoint 가 응답하는 사건**: 신규 발효(`S-PRELIM→ACTIVE`,
  `S-NONE→ACTIVE`), 발효중 등급 변경 (`S-LVL-UP/DOWN`), 발효중 종류 변경,
  해제 (해제 시 row 가 사라짐).
- **빈 응답 (`[]`)** 의미: "현재 발효 중인 부모 zone 이 0 개" — 정상 상태일
  수 있다 (계절적으로 무특보 기간). MMIS 장애가 아니라 정상 빈 응답이면
  `_unwrap` 이 `[]` 로 흡수, cycle 정상 진행. 빈 응답이 의심스러운 폭주
  (3+ zone 이 갑자기 사라짐) 는 § 3.2 ⑦ 의심 가드가 감지.

### 2.1.2 `warn/ready` — 예비특보 (부모/자식 혼재)

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/ready
```

**응답**: 같은 봉투. row 배열 안에 **예비특보** (발효시각이 아직 미래
이거나 KMA 가 사전 발표한 통보문) 가 들어온다.

```json
{
  "payload": [
    {
      "warn_zone_cd": "S2120400",
      "warn_zone_nm": "울산앞바다중연안바다",
      "warn_tp": "V",
      "warn_lvl_nm": "예비특보",
      "tm_fc": "2026.06.01 04:30",
      "tm_ef": "01일 18시 ~ 24시",
      "clr_ntc_tm": ""
    }
  ]
}
```

핵심 차이:

- `warn_lvl_nm = '예비특보'` 가 들어옴. SEAGNAL 내부 비교 로직은 `'예비'`
  를 쓰므로 `_normLvlNm` 이 `'예비특보' → '예비'` 정규화
  (`marine_warning_crawler.js:2165`).
- **하나의 배열 안에 부모 row 와 자식 row 가 혼재**. 부모는 `warn_zone_cd`
  가 `S1…`, 자식은 `S2…/S3…`. 이름 패턴으로도 구분 가능 — 자식은 `'중'` 을
  포함 (`'울산앞바다중연안바다'`). `_extractParent` (§ 2.6) 가 분리.
- **이 endpoint 가 응답하는 사건**: 예비특보 발표 (`S-NONE→PRELIM`), 예비
  발효시각 변경 (`S-PRELIM-TIMECH`), 예비 발효시각 연장 (`S-PRELIM-EXTEND`),
  예비특보 취소 (row 사라짐).
- **빈 응답** 의미: "예비특보 0건". 정상.

### 2.1.3 `warn/latest` — 부모별 가장 최근 통보문 (정확 시각 보강 핵심)

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/latest
```

V10 (commit `dbe2c6b`, § 6.3) 에서 도입된 endpoint. SEAGNAL 의 사용자
표출·푸시 정확도를 한 단계 끌어올린 결정타.

```json
{
  "payload": [
    {
      "warn_zone_cd": "S1311100",
      "warn_cmd_nm": "해제",
      "warn_tp": "V",
      "warn_lvl_nm": "해제",
      "tm_fc": "2026.06.01 04:30",
      "tm_ef": "2026.06.01 23:00"
    }
  ]
}
```

특이 필드: `warn_cmd_nm` (통보문 명령) — 가능한 값:

- `'발표'` — 신규 발표 통보문
- `'변경'` — 발효·해제 예정시각 변경
- `'연장'` — 효력 연장
- `'해제'` — 해제 통보문
- `'변경해제'` — 격상/격하 해제부 (드묾, 공존 격하 분기에만 사용)

**이 endpoint 가 응답하는 사건**:

1. **정확 해제시각 보강** — `warn/list` 의 `clr_ntc_tm` 은 "01일 21시 ~ 24시"
   같은 범위형이라 정확하지 않음. 해제 통보문이 발행되면 `warn_cmd_nm='해제'`
   + `tm_ef='2026.06.01 23:00'` 식으로 분 단위 정확값이 들어 있다.
   `_enrichSnapshotWithLatest` 가 이를 `snap.parents[zone].clrNtcTm` 에
   주입 (`marine_warning_crawler.js:2389~2398`).
2. **GAP (발표 발효대기) 보강** — § 2.7 참조. 통보문은 발행됐지만 발효시각이
   아직 미래라 `warn/list` 에도 `warn/ready` 에도 안 들어가는 중간 상태.
   `warn_cmd_nm='발표'/'변경'/'연장'` + 미래의 `tm_ef` 조합으로 잡힌다.

**빈 응답** 의미: 통보문 archive 가 비어 있음. 실제로는 거의 빈 적이 없다.
빈 응답이어도 cycle 은 진행 — `warn/list` + `warn/ready` 만으로 기본 처리.

### 2.1.4 `warn/ef/list` — 발효 통보문 timeline (인증)

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/ef/list?prdc_go=&warn_tp=&st_tm=&ed_tm=
```

JWT 인증 필요. `marine_client.js:483~510 fetchWarnEfList()`. 영구 timeline
이므로 발효 전 특보도 `ed_tm` 까지 계속 보유한다.

**용도**: `warn/latest` 가 통보문을 잠깐만 보유해 발표~발효 사이 (수시간)
의 GAP 보강 source 가 비는 경우 보강 (§ 2.7 의 핸드오프 공백, § 4.S-GAP-PARENT).
인증 미설정이면 자동 skip — 그래도 운영에 큰 지장 없음.

응답 row 의 `warn_tp` 가 **숫자 코드** (`'6'` 풍랑, `'7'` 태풍, `'1'`
강풍, `'5'` 폭풍해일) 라는 점에 주의 — 실시간 endpoint 의 문자 코드
(`V`/`T`/`W`/`O`) 와 다르다. § 2.3.2 참조.

### 2.1.5 `warn-sasc/list` — 발효 중인 자식 zone

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/list
```

자식 zone = 연안바다 (S3 코드) + 평수구역 (S2 코드). 부모와 별개 lifecycle
을 가질 수 있다 — 같은 부모 안에서도 자식별로 발효예정·해제예정 시각이
다르게 잡힐 수 있다.

```json
{
  "payload": [
    {
      "warn_zone_cd": "S2120400",
      "warn_zone_nm": "울산앞바다중연안바다",
      "warn_tp": "V",
      "warn_lvl_nm": "주의보",
      "tm_fc": "2026.06.01 04:30",
      "tm_ef": "2026.06.01 12:00",
      "clr_ntc_tm": "02일 03시 ~ 06시"
    }
  ]
}
```

자식 row 의 시각 필드 (`tm_fc`, `tm_ef`, `tm_yn`, `clr_ntc_tm`) 는
**부모 시각과 독립** 이다. 자식 표출 시 부모 fallback 을 쓰면 안 된다 —
commit `3705f4a` 에서 폐지 (§ 6 참조).

**빈 응답** 의미: 발효중 자식 zone 0개. 부모만 발효 중이고 자식은
미발효 가능.

### 2.1.6 `warn-sasc/ready` — 예비 자식

```
GET https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/ready
```

자식 예비특보. 응답 row 는 대개 강풍 (육상) 이라 SEAGNAL 의 풍랑(V)+태풍(T)
allowlist 에 거의 안 걸린다 — 사실상 운영중 row 가 들어오는 일은 드물다.
allowlist 통과 row 가 있으면 자식 예비로 등록.

### 2.1.7 `warn-sasc/latest` — 자식별 가장 최근 통보문 (수정A-3, commit `0049f2a`)

부모 `warn/latest` 의 자식 판. 각 자식의 개별
`warn_tp/warn_cmd_nm/tm_ef/clr_ntc_tm` 을 제공한다. **두 가지 목적**:

1. **자식 GAP 보강** — `warn-sasc/list` 에 아직 없지만 통보문이 발행된 자식
   (발표 발효대기) 을 예비 자식으로 미리 표출. 부모 zone 의 자식 3 개 중
   2 개만 발표된 경우 등 부분집합을 정확히 반영
   (`marine_warning_crawler.js:2334~2376`).
2. **자식 해제 통보문 집합** (`_childReleaseNoticeSet`) — `warn_cmd_nm='해제'`
   인 자식 fullName 을 모은 Set. 이 집합에 들어있는 자식이 사라지면
   "정상 해제" 로 즉시 인정 (디바운스 면제). 집합에 없는데 사라지면 글리치
   의심 → 3 분 디바운스. `_applyChildReleaseDebounce` 가 본다
   (§ 3.2 ⑧, § 4.S-CHILD-BLINK).

---

## § 2.2 row 핵심 필드 사전

내부 처리 함수 (`_rowToParentInfo`, `_rowToChildInfo`,
`marine_warning_crawler.js:2185~2209`) 가 MMIS row 를 내부 객체로 변환할 때
참조하는 표준 필드 목록.

### 2.2.1 식별·분류 필드

| MMIS 원본 | 내부 키 | 의미 | 예시값 | 비어있을 때 의미 |
|-----------|---------|------|--------|------------------|
| `warn_zone_cd` | (해석용 키) | **불변 zone 코드** — 8 자 영숫자 (`S1` 부모 / `S2`·`S3` 자식) | `'S1311100'` (부산앞바다), `'S2120400'` (울산앞바다중연안바다) | 매핑 불가 → `warn_zone_nm` fallback |
| `warn_zone_nm` | (해석 fallback) | KMA 표기 zone 이름 | `'부산앞바다'`, `'남해서부 동쪽'` (축약), `'울산앞바다중연안바다'` | 빈 row → skip |
| `kor_nm` | (자식 fullName) | 일부 응답에서 자식 fullName 별도 제공 | `'울산앞바다중연안바다'` | warn_zone_nm 으로 fallback |

**zone 코드 prefix 의미**:

- `S1xxxxxx` — 부모 zone (전체 약 43 개)
- `S2xxxxxx` — 평수구역 자식
- `S3xxxxxx` — 연안바다 자식 (현재 일부만 운용)

`warn_zone_cd` 가 **불변 식별자**라는 점이 가장 중요하다 —
`warn_zone_nm` 은 KMA 가 축약형 (`'남해서부 동쪽'` 등) 으로 내려보내거나,
`·` 표기 차이를 만들거나, 공백을 다르게 넣는 경우가 있다. zone 코드를
거치면 이 모든 표기 차이를 무력화할 수 있다 (§ 2.5 의 A 안).

### 2.2.2 종류 코드 필드

| MMIS 원본 | 내부 키 | 의미 | 예시값 | 비어있을 때 |
|-----------|---------|------|--------|-------------|
| `warn_tp` | `wrnTp` | **특보 종류 코드** (실시간 = 문자, ef/list = 숫자) | 실시간: `'V'` 풍랑, `'T'` 태풍, `'W'` 강풍, `'O'` 폭풍해일, `'C'` 한파 / ef/list: `'6'`, `'7'`, `'1'`, `'5'` | 빈 row → skip |
| `warn_tp_nm` | `wrnTpNm` | 종류 한글명 | `'풍랑'`, `'태풍'` | warn_tp 로 fallback |

**치명적 함정**: 실시간 endpoint 와 ef/list endpoint 의 종류 코드 인코딩이
다르다.

| 종류 | 실시간 (warn/list 등) | ef/list (timeline) |
|------|----------------------|---------------------|
| 풍랑 | `'V'` | `'6'` |
| 태풍 | `'T'` | `'7'` |
| 강풍 | `'W'` | `'1'` |
| 폭풍해일 | `'O'` | `'5'` |

전환 초기 (V8 까지) 에는 `warn_tp === '5'` (숫자 폭풍해일 제외) 만 가드
했는데, 실시간 응답의 문자 `'O'` 가 그대로 통과해 사용자에게 잘못된
폭풍해일 푸시가 발사된 사고가 있었다 (V11 fix, § 6). 현재는
`_isTargetRealtimeType()` (`marine_warning_crawler.js:2179~2182`) 가
`{'V', 'T'}` allowlist 만 통과시킨다.

```js
const REALTIME_TARGET_TP = new Set(['V', 'T']);
function _isTargetRealtimeType(warnTp) {
    return REALTIME_TARGET_TP.has(String(warnTp || '').toUpperCase());
}
```

### 2.2.3 등급 필드

| MMIS 원본 | 내부 키 | 의미 | 예시값 | 비어있을 때 |
|-----------|---------|------|--------|-------------|
| `warn_lvl` | `wrnLvl` | 등급 코드 | `'1'`, `'2'`, `'3'`, `'5'` (KMA 내부 코드) | 정규화 단계에서 보강 |
| `warn_lvl_nm` | `wrnLvlNm` | 등급 한글명 | `'예비특보'`, `'주의보'`, `'경보'`, `'해제'` | 빈 row → skip |

`_normLvlNm` (`marine_warning_crawler.js:2165~2168`) 가 `'예비특보' → '예비'`
로 정규화한다. 내부 비교 로직 (`info.wrnLvlNm === '예비'`) 이 전제로 한다.

내부 등급 비교 점수 (push_sender.js:26):

```js
const LVL_RANK = { '경보': 5, '주의보': 2, '예비': 2, '해제': 0 };
```

예비가 주의보와 같은 점수인 것이 의도적이다 — "예비 → 주의보로 자연 전이"
가 격상으로 오판되지 않게.

### 2.2.4 통보문 명령 필드 (warn/latest 전용)

| MMIS 원본 | 의미 | 가능값 | 사용처 |
|-----------|------|--------|--------|
| `warn_cmd_nm` | 통보문 명령 | `'발표'`, `'변경'`, `'연장'`, `'해제'`, `'변경해제'` | `_enrichSnapshotWithLatest` 의 분기 신호 |

`warn/list`·`warn/ready`·`warn-sasc/list`·`warn-sasc/ready` 응답에는
없다 — 이들은 "상태" 만 알려준다. 명령은 `warn/latest`·`warn-sasc/latest`
에만 있다.

### 2.2.5 시각 필드

| MMIS 원본 | 내부 키 | 의미 | 예시값 | 비어있을 때 의미 |
|-----------|---------|------|--------|------------------|
| `tm_fc` | `tmFc` | **발표시각** (통보문 발행 시각) | `'2026.06.01 04:30'`, `'202606010430'` | 메타 row → skip 대상 |
| `tm_ef` | `tmEf` | **발효시각** | 예비면 미래, 발효중이면 과거 | `st_tm` 으로 fallback |
| `tm_yn` | `tmYn` | 효력 종료 시각 (이론적) | `'2026.06.02 03:00'` | `ed_tm` fallback / 비어있어도 무관 |
| `clr_ntc_tm` | `clrNtcTm` | **해제예고시각** (예보관이 등록) | `'01일 21시 ~ 24시'` (범위형) 또는 `'2026.06.01 23:00'` (정확) | "해제예고 미등록" — 의심 가드 (§ 3.2 ⑦) 분기 핵심 |
| `st_tm` | (fallback) | 일부 응답에서 tm_ef 대신 | `'202606011200'` (12자리) | |
| `ed_tm` | (fallback) | 일부 응답에서 tm_yn 대신 | `'202606020300'` | |

**`tm_yn` vs `clr_ntc_tm` 의 의미 차이**:

- `tm_yn` = "이론적 해제예정" (통보문에 기재된 예정 종료 시각)
- `clr_ntc_tm` = "예보관이 등록한 해제예고" — 사용자 표출·푸시의 핵심 source

둘이 자주 같은 값이지만 의미상 구분된다. 두 값이 모두 있으면 `clr_ntc_tm`
우선, 비어 있으면 `tm_yn` fallback.

`tm_ef`·`tm_yn`·`clr_ntc_tm` 의 빈 값 패턴:

- `''` — 진짜 비어있음 (`!info.tmEf` 가 true)
- `'0'` 또는 `'000000000000'` — KMA 가 명시적으로 "데이터 없음" 표시
- `'일'` — 깨진 단일 문자 (드물지만 보고됨)

위 3 패턴 모두 `formatWarningTime` (utils.js:118) 이 `'정보 없음'` 으로
표시한다.

---

## § 2.3 KMA 인코딩 관습

MMIS 응답 데이터에는 KMA 의 legacy 인코딩이 상당량 남아 있어, 정규화
layer 가 이를 모두 흡수해야 한다.

### 2.3.1 응답 봉투 두 가지

`marine_client.js:380~386 _unwrap()` 가 둘 다 흡수:

```js
function _unwrap(j) {
    if (!j) return [];
    if (Array.isArray(j.payload)) return j.payload;  // 봉투 A
    if (Array.isArray(j.data)) return j.data;        // 봉투 B
    return [];
}
```

- **봉투 A**: `{ status: 200, payload: [...] }`
- **봉투 B**: `{ code: '0000', data: [...] }`

다운스트림은 항상 row 배열만 본다.

### 2.3.2 시각 표현 5 종 혼재

같은 시각이 다음 5 가지 형태로 등장한다:

1. **점 구분 정확형** — `"2026.06.01 04:30"`
2. **대시 구분 정확형** — `"2026-06-01 04:30"` 또는 `"2026-06-01T04:30:00"`
3. **12자리 압축형** — `"202606010430"`
4. **범위형 (6시간 블록)** — `"01일 21시 ~ 24시"` (시작·끝 시각만)
5. **연월일 포함 범위형** — `"2026.06.02 23~23시"` (warn/ready 발효예정)

이를 모두 통일하는 게 다음 4 함수의 임무 — 각각 다른 목적·다른 출력 형식:

| 함수 | 위치 | 출력 형식 | 용도 |
|------|------|-----------|------|
| `_timeKey` | `marine_warning_crawler.js:1180` | 정수 (월\*1000000+일\*10000+시\*100+분) | 비교용 |
| `normalizeMmisTime` | `marine_warning_crawler.js:1945` | 한글 (`"2026년 06월 01일 04시 30분"`) | weather_alerts.json 출력용 |
| `formatWarningTime` | `local_server/js/utils.js:118` | 한글 + 상대일자 (`"오늘 새벽(00시~06시)"`) | 프론트 표시용 |
| `formatWarnTimeKST` | `local_server/services/push_helpers.js:34` | 한글 (라벨 미사용) | 푸시 메시지용 |

세 표시 함수 (`normalizeMmisTime`, `formatWarningTime`, `formatWarnTimeKST`)
는 동일한 분기 로직을 가져야 한다 — 한 곳만 바뀌면 표시 일관성이 깨진다.
commit `8a9a798`, `b786ece` 에서 세 함수에 동기 적용 (§ 6 참조).

### 2.3.3 "분 = 58/59" — 6시간 범위 코드 (오늘 fix 의 핵심 발견)

본 통합의 가장 골치 아픈 발견. 원본 KMA 데이터에 다음과 같은 시각이 등장:

```
"2026.06.01 05:58"   ← 분이 58
"2026.06.01 11:59"   ← 분이 59
"202606010558"        ← 12자리에서도 같은 패턴
```

이는 **분 단위 정확값이 아니라 "이 시각이 속한 6시간 블록"** 을 의미하는
레거시 KMA 인코딩이다. 매핑 (`normalizeMmisTime` 의 분기,
`marine_warning_crawler.js:1982~1986`):

| 시(hour) 구간 | 분=58/59 일 때 의미 |
|--------------|-------------------|
| `00 ≤ h < 06` | `00시~06시` |
| `06 ≤ h < 9` | `06시~09시` |
| `09 ≤ h < 12` | `09시~12시` |
| `12 ≤ h < 18` | `12시~18시` |
| `18 ≤ h ≤ 23` | `18시~24시` |

따라서 `"2026.06.01 05:58"` 는 "정확히 6월 1일 5시 58분" 이 아니라
**"6월 1일 새벽 시간대(00시~06시)"** 를 의미한다. 이를 분 단위로 표시하면
사용자에게 "오늘 새벽 5시 58분 해제 예정" 으로 푸시되지만 실제는 "오늘
새벽 사이 언젠가 해제 예정" 인 셈이다.

해당 정책은 commit `8a9a798` (점·대시 형식) → `b786ece` (한글 형식 +
normalize 단계까지 보강) 으로 4 군데 (`_timeKey` 제외, 비교용은 정확값
유지) 모두 동기 적용. 자세한 시나리오 동작은 § 4.S-MM58.

### 2.3.4 빈 값·sentinel·HTML 엔티티

- **빈 값 sentinel**: `'0'`, `'000000000000'`, `'일'` — KMA 가 "데이터 없음"
  표시. 표시 함수들이 모두 `'정보 없음'` 으로 반환.
- **HTML 엔티티**: `&#40;` (괄호 열림), `&#41;` (괄호 닫힘), `&amp;` (`&`),
  `&nbsp;` (공백) 가 시각 문자열 안에 섞여 들어올 때가 있다. 모든 파서
  (`_timeKey` 등) 가 먼저 디코딩:

  ```js
  let s = String(str).replace(/&#40;/g, '(')
                     .replace(/&#41;/g, ')')
                     .replace(/&nbsp;/g, ' ').trim();
  ```

  (`marine_warning_crawler.js:1182`)

### 2.3.5 24 시 vs 다음날 00 시 정규화

`"21시~24시"` 의 끝 시각 `24` 와 `"27일 00시"` 는 같은 모멘트다. KMA 가
범위형 끝을 `24시` 로, 정확형을 다음날 `00시` 로 깜빡깜빡 흔드는데, 둘이
같은 것으로 인식되어야 가짜 시각변경 푸시가 안 나간다.

`_timeKey` (`marine_warning_crawler.js:1197`):
```js
if (hh === 24) { hh = 0; d += 1; }
```

이 정규화 덕분에 `_sameReleaseMoment("26일 21시~24시", "27일 00시")` 가
true 를 반환 — 같은 모멘트로 판정 (`marine_warning_crawler.js:1204~1208`).

---

## § 2.4 `normalizeMmisTime` — 서버 저장 단계 정규화

`marine_warning_crawler.js:1945~1991`. 한 사이클의 끝, 디스크에 weather_alerts.json
을 쓸 때 모든 시각 필드를 한글 형식으로 변환하는 단일 함수.

### 2.4.1 함수 시그니처와 분기

```js
function normalizeMmisTime(t) {
    if (!t) return '';
    const s = String(t).trim();

    // (a) 범위형: "22일 21시 ~ 24시" → "22일 밤(21시~24시)"
    const rangeMatch = s.match(/^(\d+)일\s*(\d+)시\s*[~∼]\s*(\d+)시$/);
    if (rangeMatch) {
        const startH = parseInt(rangeMatch[2], 10);
        const endH = parseInt(rangeMatch[3], 10);
        const period = _periodNameByHour(startH);
        return `${rangeMatch[1]}일 ${period}(${...padStart(2)}시~${...}시)`;
    }

    // (b) 연도 포함 범위형: "2026.06.02 23~23시" → "2026년 06월 02일 밤(23시~23시)"
    const ymdRange = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{1,2})\s*[~∼]\s*(\d{1,2})시$/);
    if (ymdRange) { ... }

    // (c) 이미 시간대 명칭 있는 범위형 → 그대로
    if (/[~∼]/.test(s)) return s;

    // (d) 정확형: "2026.05.21 06:00" → "2026년 05월 21일 06시 00분"
    //     + 분=58/59 레거시 코드는 6시간 블록 범위로 복원
    const m = s.match(/^(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2})$/);
    if (m) {
        const [, Y, M, D, h, mn] = m;
        const hh = parseInt(h, 10), mm = parseInt(mn, 10);
        if (mm === 58 || mm === 59) {
            const block = (hh >= 18) ? '18시~24시' : (hh >= 12) ? '12시~18시'
                        : (hh >= 9) ? '09시~12시' : (hh >= 6) ? '06시~09시' : '00시~06시';
            return `${Y}년 ${M}월 ${D}일 ${block}`;
        }
        return `${Y}년 ${M}월 ${D}일 ${h}시 ${mn}분`;
    }

    return s;
}
```

### 2.4.2 시간대 명칭 (`_periodNameByHour`)

`marine_warning_crawler.js:1935~1943`:

```js
function _periodNameByHour(h) {
    if (h >= 21) return '밤';              // 21~24시
    if (h >= 18) return '저녁';             // 18~21시
    if (h >= 15) return '늦은 오후';        // 15~18시
    if (h >= 12) return '낮';               // 12~15시
    if (h >= 9)  return '오전';             // 09~12시
    if (h >= 6)  return '아침';             // 06~09시
    return '새벽';                          // 00~06시
}
```

KMA 의 통보문 자유텍스트 표현 (`"21시~24시"`) 을 사용자가 한 번에 이해할
수 있도록 시간대 명칭을 부여 (`"밤(21시~24시)"`). 사용자 앱 표시
일관성을 위해 시각 영역 분기 boundary 도 동일 — 프론트 `formatWarningTime`,
푸시 `formatWarnTimeKST` 가 같은 boundary 를 가진다 (§ 5 참조).

### 2.4.3 왜 이 변환이 필요한가 (옛 dmdw 호환)

`normalizeMmisTime` 은 MMIS row 를 그대로 weather_alerts.json 에 내보내지
않고 **옛 dmdw 표기로 변환** 한다. 이유: 옛 시스템 (`dmdw_warn_crawler`,
`weather_alerts_crawler`) 시기에 정착한 사용자 앱 (`js/data.js:269` 등) 이
한글화된 시각 (`"2026년 05월 21일 06시 00분"`) 을 가정한다. MMIS 표기
(`"2026.05.21 06:00"`) 를 그대로 내보내면 프론트의 시각 파서가 다 깨진다.

다운스트림 호환성을 위해 zone tree 빌더 (`_buildZoneTreeFromSnapshot`,
`marine_warning_crawler.js:1993~`) 가 모든 시각 필드를 통과시킨다:

```js
const toBlock = (info) => ({
    ...
    tmFc: normalizeMmisTime(info.tmFc),
    tmEf: normalizeMmisTime(info.tmEf),
    tmYn: normalizeMmisTime(info.tmYn),
    tmCc: normalizeMmisTime(info.clrNtcTm),        // 옛 tmCc = mmis clrNtcTm
    clrNtcTm: normalizeMmisTime(info.clrNtcTm),    // 신규 필드 (양 형식 모두 지원)
    source: 'MARINE_MMIS'
});
```

(`marine_warning_crawler.js:2004~2022`)

### 2.4.4 부작용

- 한글 형식이 프론트 파서를 한 번 더 거친다 (`formatWarningTime` 이 한글
  표현을 다시 해석해서 "오늘 새벽" 같은 상대일자 라벨을 붙임). 즉
  `normalizeMmisTime` → `formatWarningTime` 의 2 단 파이프라인.
- 비교용 정확값 (`info.tmEf` 자체) 은 mmis 원형식 그대로 유지된다. 따라서
  `_timeKey` 의 비교는 한글화되기 전 값 기준으로 수행됨. 시각 변경
  판정과 표시 정규화가 분리된 구조.

---

## § 2.5 zone 코드 → 정식 해역명 매핑 (A 안)

### 2.5.1 동기

MMIS 의 `warn_zone_nm` 은 일부 zone 을 축약형으로 내려준다:

- `'남해서부 동쪽'` (실제 정식명: `'남해서부동쪽먼바다'`)
- `'동해남부'` (실제 정식명: `'동해남부남쪽안쪽먼바다'` 등 4 개 중 하나)

이름만 보고 매칭하면 SEAGNAL 내부 `PARENT_TO_CHILDREN` 키와 안 맞아
매칭 실패 → 자식이 안 붙거나, 푸시 zone 이 안 잡힌다.

### 2.5.2 A 안 — 코드 기반 매핑

`MMIS_CODE_TO_NAME` (`marine_warning_crawler.js:115~209`) 가 93 개 코드를
정식명으로 매핑. mmis archive ef2 1년치 (13만건) 에서 추출한 권위 source.

```js
const MMIS_CODE_TO_NAME = {
    'S1131100': '울산앞바다',
    'S1131200': '경북남부앞바다',
    'S1132110': '동해남부남쪽안쪽먼바다',
    ...
    'S2211100': '인천·경기남부앞바다중먼평수구역',
    'S2212200': '태안·서산북쪽평수구역',
    ...
    'S3xxxxxx': // 연안바다 자식들 (S2 평수구역과 같은 키 공간 유지)
};
```

특수 케이스 — 표기 보정:

- `S2211100` → `'인천·경기남부앞바다중먼평수구역'` — MMIS 표기
  `'인천경기...'` 에 `·` 없음. SEAGNAL 은 `·` 포함 사용. 코드 매핑이 보정.
- `S2212200` → `'태안·서산북쪽평수구역'` — 동일 이유로 보정.

### 2.5.3 `_resolveZoneName` — 해석 함수

`marine_warning_crawler.js:215~220`:

```js
function _resolveZoneName(row) {
    const cd = row.warn_zone_cd;
    if (cd && MMIS_CODE_TO_NAME[cd]) return MMIS_CODE_TO_NAME[cd];
    return (row.warn_zone_nm || row.kor_nm || '').trim().replace(/\s+/g, '');
}
```

정책:
1. `warn_zone_cd` 가 있고 매핑에 있으면 → 매핑값 (우선). 축약 무력화.
2. 없으면 `warn_zone_nm` 또는 `kor_nm` 으로 fallback (공백 제거).

이 매핑 적용은 commit `2c25c58` 에서 도입. 자세한 시행착오는 § 6.X 참조.

### 2.5.4 적용 위치

모든 endpoint 응답 row 가 `_resolveZoneName` 을 통과한다:

- `_buildSnapshotFromMarine` — warn/list, warn-sasc/list, warn/ready,
  warn-sasc/ready 의 4 endpoint (`marine_warning_crawler.js:2251, 2259,
  2267, 2286`).
- `_enrichSnapshotWithLatest` — warn/latest, warn-sasc/latest 의 2 endpoint
  (`marine_warning_crawler.js:2337, 2386`).
- `_enrichSnapshotWithEfList` — ef/list 보강 (`marine_warning_crawler.js:2679`).

따라서 zone 명 해석은 **6 endpoint 전체에 일관 적용**된다.

---

## § 2.6 자식 ↔ 부모 매핑

### 2.6.1 `PARENT_TO_CHILDREN` 구조

`marine_warning_crawler.js:75~105`. 28 개 부모 → 자식 리스트.

```js
const PARENT_TO_CHILDREN = {
    '울산앞바다':            ['울산앞바다중평수구역', '울산앞바다중연안바다'],
    '경북남부앞바다':         ['경북남부앞바다중평수구역', '경북남부앞바다중연안바다'],
    '강원북부앞바다':         ['강원북부앞바다중연안바다'],
    '동해중부안쪽먼바다':      ['울릉도울릉읍연안바다', '울릉도서면연안바다', '울릉도북면연안바다'],
    '인천·경기남부앞바다':    ['인천·경기남부앞바다중먼평수구역', '인천·경기남부앞바다중북부앞평수구역', '인천·경기남부앞바다중남부앞평수구역'],
    '충남북부앞바다':         ['천수만평수구역', '안면도서쪽평수구역', '당진평수구역', '태안·서산북쪽평수구역'],
    '부산앞바다':            ['부산앞바다중동부평수구역', '부산앞바다중서부평수구역', '부산앞바다중연안바다'],
    '제주도서부앞바다':       ['제주도서부앞바다중북서연안바다', '제주도서부앞바다중남서연안바다', '제주도서부앞바다중가파도연안바다'],
    '경남서부남해앞바다':     ['경남서부남해앞바다중동부평수구역', '경남서부남해앞바다중서부평수구역', '경남서부남해앞바다중남부평수구역', '경남서부남해앞바다중남해군연안바다'],
    ...
};
```

자식 fullName 패턴: `"부모이름 + '중' + 자식이름"` (`'부산앞바다중연안바다'`).
하지만 일부 zone (`'천수만평수구역'`, `'안면도서쪽평수구역'`,
`'당진평수구역'` 등) 은 `'중'` 패턴이 없는 자식 — 충남북부앞바다처럼.

### 2.6.2 `_extractParent` — 부모 추출

`marine_warning_crawler.js:2148~2157`:

```js
function _extractParent(korNm) {
    if (!korNm) return '';
    const s = String(korNm).trim().replace(/\s+/g, '');
    const idx = s.lastIndexOf('중');
    if (idx > 0) {
        const after = s.substring(idx + 1);
        if (after && after.length >= 2) return s.substring(0, idx);
    }
    return s;
}
```

분리 예:

```
'부산앞바다중연안바다'                → '부산앞바다' + '연안바다'
'경남서부남해앞바다중남해군연안바다'    → '경남서부남해앞바다' + '남해군연안바다'
'천수만평수구역'                      → (분리 안 됨) → '천수만평수구역' (= 부모로 취급)
'울릉도울릉읍연안바다'                 → (분리 안 됨) → '울릉도울릉읍연안바다'
'동해남부남쪽안쪽먼바다'               → (분리 안 됨) → '동해남부남쪽안쪽먼바다' (= 부모)
```

`lastIndexOf('중')` 을 쓰는 이유 — `'경남중부남해앞바다중연안바다'` 같이
부모 이름 안에 `'중'` 이 들어가는 경우 마지막 `'중'` 기준으로 잘라야
정확한 분리가 가능.

### 2.6.3 부모형 vs 자식형 row 식별

`_extractParent(name) === name` 분기로 구분:

- 같으면 → 부모형 row (분리 안 된 케이스)
- 다르면 → 자식형 row

이 분기가 `warn/ready` 의 부모/자식 혼재 응답을 분류할 때 핵심
(`marine_warning_crawler.js:2264~2280`):

```js
for (const row of (warnReady || [])) {
    if (!_isLiveRow(row)) continue;
    if (!_isTargetRealtimeType(row.warn_tp)) continue;
    const name = _resolveZoneName(row);
    if (!name) continue;
    const parent = _extractParent(name);
    if (parent === name) {
        // 부모형 row
        if (snap.parents.has(name)) {
            if (!snap.upcomings.has(name)) snap.upcomings.set(name, _rowToParentInfo(row));
            continue;
        }
        snap.parents.set(name, _rowToParentInfo(row));
    } else {
        addChild(name, row);    // 자식형 row
    }
}
```

### 2.6.4 자식 타입 분류 (`PARENT_CHILD_TYPE`)

`services/push_helpers.js` (별도 모듈). 부모별 자식 종류:

- `'connection'` — 연안바다만 (예: 강원북부앞바다)
- `'pyeongsu'` — 평수구역만 (예: 인천·경기북부앞바다)
- `'both'` — 평수구역+연안바다 둘 다 (예: 울산앞바다, 부산앞바다)

이 분류가 푸시 메시지 한정사 ("(연안바다 포함)", "(평수구역 미발효)" 등)
생성에 사용된다. 자세한 룰은 § 5 의 표출 layer 참조.

---

## § 2.7 GAP 상태 (발표대기)

### 2.7.1 GAP 의 정체

KMA 의 통보문 lifecycle 에 한 가지 흥미로운 중간 상태가 있다:

- 통보문이 **발행됐다** (예보관이 publish 액션 수행) — 따라서 `warn/latest`
  의 통보문 archive 에는 들어 있음.
- 하지만 **발효시각이 아직 미래** 다 (`tm_ef > now`).
- 따라서 `warn/list` (현재 발효) 에도 안 들어가고, `warn/ready` (예비)
  에도 잡히지 않는다.

이 중간 상태가 **GAP (발표 발효대기)** 다. SEAGNAL 초기에는 이 상태에서
zone 이 사용자 앱에서 통째로 사라지는 (그리고 "발효시각 변경" 푸시도
안 나가는) 결함이 있었다.

### 2.7.2 발견 경위 — V10 의 도입

`warn/list` + `warn/ready` 만으로 운영하던 시기, 사용자 제보로 "어제는
예비특보 뜨고 푸시도 왔는데, 오늘 새벽엔 그 zone 이 통째 사라졌다가 정오에
다시 발효로 뜸" 같은 보고가 들어왔다. 추적 결과:

1. `tm_fc=23:00` 에 통보문 발행 → `warn/ready` 에 잠깐 뜸
2. 발효 30분 전쯤 `warn/ready` 에서 빠짐 (KMA 가 발효 직전 row 를 제거)
3. 발효 모멘트가 되면 `warn/list` 로 인계
4. **2 와 3 사이 (수 시간) 가 GAP** — 사용자 앱에서 zone 이 안 보임

V10 (commit `dbe2c6b`) 에서 `warn/latest` 호출을 추가, "발행된 통보문이
있는데 발효시각이 미래" 인 row 를 별도로 끌어와 `snap.parents` 에 예비로
주입하는 보강 로직을 추가했다.

### 2.7.3 검출 조건

`_enrichSnapshotWithLatest` (`marine_warning_crawler.js:2383~2477`) 의 분기:

```js
for (const row of warnLatest) {
    if (!_isTargetRealtimeType(row.warn_tp)) continue;
    const cmd = String(row.warn_cmd_nm || '').trim();
    const name = _resolveZoneName(row);

    if (cmd === '해제') { /* 정확 해제시각 보강 */ continue; }

    const isPublishCmd = ['발표', '변경', '연장'].includes(cmd);
    if (!isPublishCmd && cmd !== '변경해제') continue;
    const tmEf = String(row.tm_ef || '').trim();
    if (!tmEf || !_isFutureExactTime(tmEf)) continue;  // 정확·미래 발효시각만 (= GAP)

    const parent = _extractParent(name);
    if (parent === name) {
        const info = _rowToParentInfo(row);
        info._realLvlNm = info.wrnLvlNm;   // [B] 실제 등급 보존
        info.wrnLvlNm = '예비';   // 발효 전 → 예비 취급
        info.wrnLvl = info.wrnLvl || '1';
        // [B] 발효중 zone 과 공존이면 upcomings 로 (격상/격하 발표)
        if (_tryAddCoexistingUpcoming(snap, name, info)) continue;
        if (!isPublishCmd) continue;
        if (snap.parents.has(name)) continue;
        snap.parents.set(name, info);
        // 자식 합성 — prev.children → 또는 PARENT_TO_CHILDREN 매핑
        ...
    }
}
```

조건 3 가지가 동시 만족하면 GAP 으로 인식:
1. `warn_cmd_nm ∈ {'발표', '변경', '연장'}` (publish 계열)
2. `tm_ef` 가 정확형 (`_isFutureExactTime` 검사, `marine_warning_crawler.js:2490~2495`)
3. `tm_ef > now` (미래)

검출되면 `wrnLvlNm = '예비'` 로 라벨링하여 `snap.parents` 에 주입.
표시·푸시 일관성을 위해 발효 전이지만 예비 단계로 통일.

### 2.7.4 GAP 자식 합성

`warn/latest` 는 자식 row 를 거의 주지 않으므로, GAP 부모가 생기면 그 자식도
표출되도록 합성해야 한다 — 안 그러면 화면에 "부모 발효예정, 자식 0개"
로 표출되어 부분집합이 깨진다.

**2 단계 합성** (`marine_warning_crawler.js:2433~2466`):

1. **prev.children 이어받기** (1순위) — 직전 사이클에 자식이 있었다면
   그대로 carry-over. 부모의 새 `tmEf` / `clrNtcTm` 을 자식에게 상속.
2. **`PARENT_TO_CHILDREN` 매핑 합성** (2순위) — prev 자식도 비어있으면
   매핑에서 자식 fullName 리스트를 가져와 합성. 부모 발효예정·해제예고
   상속.

수정A-3 (commit `0049f2a`) 이후로는 `warn-sasc/latest` 가 자식별 통보문을
제공하므로, 더 정확한 자식 보강은 그 endpoint 에서 (§ 2.1.7).

### 2.7.5 GAP 보강 fallback chain

GAP 보강 source 의 우선순위 (가장 정확 → 가장 fallback):

1. `warn-sasc/latest` 의 자식별 개별 통보문 (수정A-3)
2. `warn/latest` 의 부모 통보문 → prev.children 이어받기
3. `warn/latest` 의 부모 통보문 → `PARENT_TO_CHILDREN` 합성
4. `warn/ef/list` (인증) — `_enrichSnapshotWithEfList` 가 `warn/latest`
   가 통보문을 놓친 사이클에 메움 (`marine_warning_crawler.js:2837~2846`)
5. `_efListCache` (30분 TTL) — 인증 일시 실패 시 직전 성공분 재사용

이 fallback chain 이 V10 → V11 → 수정A-3 → ef/list 보강 의 4 단 보강
스택을 형성한다. 자세한 시나리오는 § 4.S-GAP-PARENT / § 4.S-GAP-CHILD /
§ 4.S-HANDOFF 참조.

---

# § 3. 데이터 흐름

본 절은 **한 사이클이 어떻게 흐르는가** 를 16 단계로 추적한다. § 2 가
"데이터의 정체" 였다면 § 3 은 "데이터의 운동" 이다.

`scheduler.js:1604~1614` 의 매 1 분 cron 에서 시작해, 6 endpoint fetch 가
한 `StateSnapshot` 으로 모이고, 8 단계의 가드·홀드·디바운스를 통과한 후
**(a) 사용자 푸시 발사** 와 **(b) weather_alerts.json 갱신** 의 두 출구로
분기되어 디스크에 영속화되는 전 과정.

각 단계는 try/catch 로 감싸 한 단계 실패가 전체를 막지 않도록 한다 — 단,
fetch 실패만은 cycle 통째로 skip (E-4, § 3.2 ⑥).

## § 3.1 매 1분 cron 흐름

`scheduler.js:1524~1614`. 1 분 주기 `setInterval` 안에서:

```js
setInterval(async () => {
    syncTime();   // 시계 NTP 보정
    ...
    if (!crawlPaused) {
        log('🌊 marine.kma 통합 크롤러 실행...');
        marineWarningCrawler.run().catch(err => log(`⚠️ [marine] 크롤러 오류: ${err.message}`));
    } else {
        log('⏸️ 기상특보 크롤링 일시정지 상태');
    }
    // 그 외 1분/10분/시간 단위 작업들 — 부이, 예보, 태풍 등
}, 60000);
```

(`scheduler.js:1610~1617`)

### 3.1.1 `crawlPaused` 토글

`scheduler.js:87`. admin UI 에서 토글 가능한 boolean 플래그:

- `false` (기본) — 매 분 `marineWarningCrawler.run()` 호출
- `true` — 호출 자체 skip (점검 모드 등에서 사용)

토글은 `setCrawlPaused()` (`scheduler.js:1723`) export 로 admin route 가
호출. 점검 모드의 `MAINTENANCE_FILE` 와는 별개 — 점검 모드는 push 만 차단,
크롤러는 계속 돈다. 반면 `crawlPaused=true` 는 크롤러 자체를 멈춘다.

### 3.1.2 `_runInProgress` 락

`marine_warning_crawler.js:2745, 2781`:

```js
let _runInProgress = false;

async function run(opts = {}) {
    if (_runInProgress) return [];   // 중복 실행 방지
    if (!marineClient) { ... skip ... }
    _runInProgress = true;
    try {
        ... (전 사이클)
    } finally {
        _runInProgress = false;
    }
}
```

한 사이클이 60 초보다 오래 걸리는 비상시 (MMIS 응답 지연, 네트워크 문제),
다음 cron 트리거가 새 사이클을 시작하지 않도록 보호. 락 해제는 `finally`
로 보장.

### 3.1.3 `fetchAllRealtimeEndpoints` 병렬 fetch

`marine_client.js:438~465`. 4 개 비로그인 endpoint 를 `Promise.allSettled`
로 동시 호출:

```js
async function fetchAllRealtimeEndpoints() {
    const settled = await Promise.allSettled([
        fetchWarnList(),
        fetchWarnSascList(),
        fetchWarnReady(),
        fetchWarnSascReady()
    ]);
    const labels = ['warnList', 'warnSascList', 'warnReady', 'warnSascReady'];
    const failed = [];
    for (let i = 0; i < settled.length; i++) {
        if (settled[i].status === 'rejected') {
            failed.push(`${labels[i]}: ${...}`);
        }
    }
    if (failed.length > 0) {
        const err = new Error('marine endpoint 부분 실패: ' + failed.join(' | '));
        err.partial = true;
        err.failedEndpoints = failed;
        throw err;
    }
    return {
        warnList: settled[0].value || [],
        warnSascList: settled[1].value || [],
        warnReady: settled[2].value || [],
        warnSascReady: settled[3].value || []
    };
}
```

`Promise.allSettled` 사용 이유: `Promise.all` 은 첫 reject 즉시 throw 라
나머지 endpoint 가 계속 진행되더라도 결과를 못 받는다. `allSettled` 는
모두 끝날 때까지 기다린 후 한꺼번에 검사 → 부분 실패 detect.

부분 실패 시 throw → `crawler.run` 이 catch 해서 cycle skip (E-4, § 3.2 ⑥).

`warn/latest`·`warn-sasc/latest` 는 별도로 호출 (`marine_warning_crawler.js:2822~2825`):

```js
const [warnLatest, warnSascLatest] = await Promise.all([
    marineClient.fetchWarnLatest(),
    marineClient.fetchWarnSascLatest().catch(() => [])  // 자식 실패 graceful
]);
```

이 2 endpoint 는 보강용이라 실패해도 graceful — 보강 skip 하고 cycle 진행.

---

## § 3.2 한 사이클 단계별 pipeline

`marine_warning_crawler.js:2780~2966 run()` 한 사이클의 16 단계.
**다른 무엇보다 이 표가 본 § 3 의 핵심 권위 source 다**:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          run() 한 사이클 (1분)                                │
└──────────────────────────────────────────────────────────────────────────────┘

[①] _runInProgress 락 + isFirstLoad 판정
   ↓
[②] prev snapshot lazy load (디스크 → 메모리, 첫 호출만)
   ↓
[③] fetchAllRealtimeEndpoints() — 4 endpoint Promise.allSettled
   ↓                                  ↓ 부분 실패
[④] _buildSnapshotFromMarine()        E-4 throw → cycle skip
    → curr StateSnapshot
   ↓
[⑤] fetchWarnLatest + fetchWarnSascLatest (보조)
    → _enrichSnapshotWithLatest()
       ├─ 발효중 zone 의 clrNtcTm 정확시각 보강 (V10)
       ├─ GAP("발표 발효대기") 자식·부모 합성
       └─ _childReleaseNoticeSet 채움
   ↓
[⑤-b] _fetchEfListForGap() (인증, graceful)
    → _enrichSnapshotWithEfList() — warn/latest 가 놓친 GAP 보강
    → _efListCache (30분 TTL fallback)
   ↓
[⑥] 빈 snapshot 가드 (E-1)
   ├─ isFirstLoad + prev empty + !forceBaseline → push skip
   └─ 자연 전이 (isFirstLoad=false) 는 통과
   ↓
[⑦] _applySuspiciousGuard(prev, curr)
    → 3+ zone 이 clrNtcTm 없이 사라지면 prev 정보로 복원
   ↓
[⑧] _applyChildReleaseDebounce(prev, curr)
    → 자식이 해제예고 없이 사라지면 3분 carry
   ↓
[⑧-b] _applyUpcomingCancelDebounce(prev, curr)
    → 예비취소 3분 carry (가짜취소 차단)
   ↓
[⑨] _applyAnnounceAnchor(prev, curr)
    → tmFc 를 현재 발효 등급의 최초 발표시각으로 고정
   ↓
[⑩] _applyReleaseClrLogic(prev, curr)
    → clrNtcTm 윈도우 안=정확값 고정, 윈도우 초과=연장 플래그
   ↓
[⑪] _applyUpcomingEfLogic(prev, curr)
    → 예비 tmEf 윈도우 hold + 연장
   ↓
[⑫] _debounceTimeValues(curr)
    → 새 tmEf/clrNtcTm 값이 3분 유지될 때만 확정 (진동 차단)
   ↓
[⑬] _buildUserPushChanges(prev, curr)
    → changes[] (8 종 type)
    → pushSender.processChanges(changes, { adminToken? })
       → /api/push-custom → FCM
   ↓
[⑭] _updateExtensionMemory(curr) — 6시간 retention
   ↓
[⑮] _prevSnapshot = curr; _savePrevSnapshot(curr)
    → marine_warning_state.json (atomic)
   ↓
[⑯] _writeWeatherAlertsJson(prevForDiff, curr)
    → weather_alerts.json (사용자 앱 표출용)
   ↓
[finally] _runInProgress = false
```

순서가 중요하다. 가드/홀드/디바운스의 각 단계는 앞 단계의 출력을
가정한다. 한 단계라도 순서가 깨지면 가정이 무너진다 — 예: ⑨ 의 발표시각
앵커는 ⑤ 의 enrich 가 끝난 curr 를 가정. ⑫ 의 디바운스는 ⑩·⑪ 의
hold 가 끝난 정확값을 가정.

### 3.2.1 ① 락 + isFirstLoad

`marine_warning_crawler.js:2781~2795`:

```js
if (_runInProgress) return [];
if (!marineClient) { console.warn(...); return []; }
_runInProgress = true;
try {
    const isFirstLoad = (_prevSnapshot === null);
    if (isFirstLoad) {
        _prevSnapshot = _loadPrevSnapshot();
    }
    ...
}
```

`isFirstLoad` 는 프로세스 시작 후 첫 호출 여부 판정. E-1 가드 (§ 3.2 ⑥)
의 결정적 분기 신호. `_prevSnapshot === null` 은 메모리 상태 — 디스크 load
는 한 번만 수행.

### 3.2.2 ② prev snapshot lazy load

`_loadPrevSnapshot()` (`marine_warning_crawler.js:641~655`):

```js
function _loadPrevSnapshot() {
    try {
        if (!fs.existsSync(_STATE_FILE)) return new StateSnapshot();
        const raw = fs.readFileSync(_STATE_FILE, 'utf8');
        const j = JSON.parse(raw);
        if (j && j.prev) {
            const snap = StateSnapshot.fromJSON(j.prev);
            return snap;
        }
    } catch (e) {
        console.error('[Marine] prev snapshot 복원 실패:', e && e.message);
    }
    return new StateSnapshot();
}
```

파일 없거나 파싱 실패 → 빈 StateSnapshot. 디스크 영속화 path:
`local_server/data/marine_warning_state.json` (§ 3.4 참조).

### 3.2.3 ③·④ fetch + curr 구축

`marine_warning_crawler.js:2801~2814`:

```js
let fetched;
try {
    fetched = await marineClient.fetchAllRealtimeEndpoints();
} catch (err) {
    console.warn('[Marine] endpoint 부분 실패 — cycle skip ...');
    return [];   // ← E-4 가드
}

const curr = _buildSnapshotFromMarine(
    fetched.warnList, fetched.warnSascList,
    fetched.warnReady, fetched.warnSascReady
);
```

`_buildSnapshotFromMarine` (`marine_warning_crawler.js:2236~2292`) 은
4 endpoint 응답 row 배열을 받아 `StateSnapshot` 으로 변환. 정책:

- **allowlist V/T 만**: `_isTargetRealtimeType` 통과 row 만 (§ 2.2.2)
- **발효 우선**: warn/list (발효) > warn/ready (예비). 같은 zone 이 양쪽에
  있으면 발효를 `parents` 에, 예비를 `upcomings` 에 (B 트랙 병렬 표출)
- **부모/자식 자동 분리**: `_extractParent` 로 분기

### 3.2.4 ⑤ warn/latest + warn-sasc/latest 보강

§ 2.7 의 GAP 보강 + 정확 해제시각 보강. 호출은 graceful try/catch.

### 3.2.5 ⑥ E-1 콜드부팅 가드 — **오늘 fix 로 isFirstLoad 한정**

`marine_warning_crawler.js:2848~2869`:

```js
const forceBaseline = !!opts.forceBaselinePush || _forceBaselinePending;
if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
    console.log('[Marine] 콜드 부팅 + 빈 prev — push skip, state 저장만');
    _prevSnapshot = curr;
    _savePrevSnapshot(curr);
    _writeWeatherAlertsJson(new StateSnapshot(), curr);
    return [];
}
if (forceBaseline && _isSnapshotEmpty(_prevSnapshot)) {
    console.log('[Marine] ⚠️ 강제 baseline 푸시 모드 — E-1 가드 우회, 현재 활성 특보를 신규로 발사');
}
_forceBaselinePending = false;
```

**의도**: Fly.io 배포 시마다 메모리 `_prevSnapshot` 휘발. 디스크 state 도
없으면 현재 활성 특보 N 개가 모두 "신규 발효" 로 오인되어 푸시 폭주.
이 가드가 콜드부팅 직후 push 0 회로 막음.

**오늘의 fix** (commit `6df054a`, § 6.X): 가드 조건에 `isFirstLoad` 를
추가. 이전엔 `_isSnapshotEmpty(_prevSnapshot)` 만 검사해서, **운영 중인
process 에서 무특보 → 신규특보 자연 전이도 같은 조건으로 걸려 push 가
안 가던 over-fire 버그** 가 있었다. 자연 전이는 `isFirstLoad=false` 라
이제 통과한다.

**forceBaseline 우회**: admin "장부 초기화 (테스트 푸시)" 버튼이 호출하는
경로. `_forceBaselinePending` 은 `resetState()` 가 예약하는 1회성 플래그
(`marine_warning_crawler.js:2767, 2769~2778`) — 리셋과 cron run 이 경합해도
강제 baseline 푸시를 1회 보장.

### 3.2.6 ⑦ 의심 가드 (`_applySuspiciousGuard`)

`marine_warning_crawler.js:774~862`. **mmis 빈 응답 폭주 차단**.

핵심 분류 (`_classifyReleases`, `marine_warning_crawler.js:730~764`):

- prev 에 발효중이었던 zone 이 curr 에서 사라짐
- 그 zone 의 prev 에 `clrNtcTm` (해제예고) 가 등록되어 있었나?
  - 등록 → **정상 해제** (normalReleases) — 통과
  - 미등록 → **의심** (suspiciousZones) — 가드 적용

의심 zone 이 `SUSPICIOUS_THRESHOLD` (= 3) 이상이면:
1. 새 의심 사례 — `_genCaseId()` 로 caseId 생성, currentCase 등록, 1차
   alert push (관리자 채널, 현재는 ADMIN_PUSH_ENABLED=false)
2. 기존 의심 사례 — cycleCount++, `PUSH_REINFORCE_INTERVAL` (10분) 경과 시 재push
3. **의심 zone 을 curr 에 prev 정보로 복원** — 이번 cycle 의 release 분기
   를 차단. 부모뿐 아니라 자식·upcomings 도 복원.

mmis 회복 (3 미만으로 떨어짐) 시 currentCase auto-reset, history 에 기록.

영속화 file: `local_server/data/marine_suspicious_state.json`
(`marine_warning_crawler.js:691~735`). schema:
```json
{ "currentCase": { "id", "firstSeenAt", "zones": [...], "cycleCount", "lastPushAt", "decisionPending" }, "history": [...] }
```

### 3.2.7 ⑧ 자식 해제 디바운스 (`_applyChildReleaseDebounce`)

`marine_warning_crawler.js:981~1031`. 자식의 글리치 깜빡임 차단.

알고리즘:
1. prev 에 있던 자식 중 curr 에 없는 것 검출
2. `_childReleaseNoticeSet` (warn-sasc/latest 의 해제 통보문, § 2.1.7)
   에 있으면 → **정상 해제** (즉시 허용)
3. 없으면 → 글리치 의심 → `_childReleasePending` 에 등록 (`firstMissingAt`)
4. 경과 시간 `< CHILD_RELEASE_DEBOUNCE_MS` (3 분) 이면 → prev 의 자식 정보를
   curr 에 carry-over (다른 단계가 가짜 release/add 로 인식 안 함)
5. ≥ 3 분 이면 → 진짜 해제로 확정 (carry 중단, diff 가 CHILD_RELEASE 발사)

관찰 중 자식이 복귀하면 → 깜빡임 확정 로그 + pending 정리.

### 3.2.8 ⑨ 발표시각 anchor (`_applyAnnounceAnchor`)

`marine_warning_crawler.js:1118~1165`. tmFc 변동 차단.

**문제**: warn/latest 가 변경·연장 통보문을 발행할 때마다 새 `tm_fc` 를
보내는데, 사용자 관점에서 "발표시각" 은 **그 특보 등급의 최초 발표시각**
이 자연스럽다. 변경/연장마다 tmFc 가 흔들리면 화면이 깜빡임.

알고리즘:
- prev 에 같은 zone·같은 종류 + (같은 등급 또는 prev='예비') 가 있으면
  → prev 의 tmFc 를 carry (앵커)
- 격상/격하 시: prev.upcomings (공존 예비) 의 tmFc 를 carry — 경보 예비 →
  경보 발효 시 경보의 최초 (예비) 발표시각이 유지
- 핸드오프 공백 (prev 체인 끊김) → `_extensionMemory` (5 분 retention)
  에서 복원

### 3.2.9 ⑩·⑪ 윈도우 hold + 연장 플래그

`_applyReleaseClrLogic` (`marine_warning_crawler.js:1313~1320`) +
`_applyUpcomingEfLogic` (`marine_warning_crawler.js:1321~1328`). 둘 다 공통
함수 `_applyTimeWindowHold` (`marine_warning_crawler.js:1234~1311`) 호출.

핵심 정책:
- **윈도우** = 처음 범위로 확립된 시각의 끝 시각. 범위로만 확립/확장.
- **윈도우 안**: 정확시각이 발표되면 그 값으로 고정 (held). 범위로 안
  되돌림.
- **윈도우 초과**: 새로운 (더 늦은) 모멘트 → 연장 플래그 (`_clrExtend`
  or `_efExtend`) 설정. winMap 갱신.
- **표시형 보존**: 비교용 정확값과 별개로 화면 표시는 통보문 범위형 우선
  (`info.tmEfDisp`, `info.clrNtcTmDisp` 등). 사용자 화면 깜빡임 방지.
- **자식 정확값 고정**: 자식도 직전 정확값으로 고정 (윈도우/연장 없음,
  표시 깜빡임 차단만).

### 3.2.10 ⑫ 시각 디바운스 (`_debounceTimeValues`)

`marine_warning_crawler.js:1340~`. 새 시각값이 3 분 (연속) 유지될 때만 변경/연장
푸시.

알고리즘:
- 새 값이 처음 보이면 `_tcPending[key] = { value, since: now }`
- since 후 < 3분 → 직전 확정값 (`_tcConfirmed[key]`) 로 되돌림 + 연장
  플래그도 제거
- ≥ 3 분 → 확정 (`_tcConfirmed[key] = value`)
- 최초값 (신규 발표) 은 즉시 수락 (디바운스 안 함)

진동 차단 (A→B→A) — warn/latest 가 값을 흔드는 잔여 오실레이션 완전 차단.

### 3.2.11 ⑬ 사용자 푸시 changes 빌드 + 발사

`marine_warning_crawler.js:1408~1555 _buildUserPushChanges(prev, curr)`. prev 와
curr 의 zone 별 diff 를 `push_sender` 가 이해하는 change 객체 배열로 변환.
8 종 change type:

| change.type | 의미 | 핵심 필드 |
|-------------|------|-----------|
| `UPCOMING_CHANGE` | 예비 블록 변화 (발표·변경·취소) | prev, curr, currentActive, childState |
| `CURRENT_CHANGE` | 발효 블록 변화 (발효·격상격하·해제·시각변경) | prev, curr, childState |
| `EF_EXTEND` | 발효예정 범위→더 늦은 범위 연장 | curr, oldTime, newTime |
| `YN_EXTEND` | 해제예정 범위→더 늦은 범위 연장 | curr, oldTime, newTime |
| `CHILD_ADD` | 자식만 추가 (부모 불변) | curr, childState |
| `CHILD_RELEASE` | 자식만 일부 해제 (부모 불변) | prev, childState |
| `CHILD_EF_EXTEND` | 자식 단독 발효예정 연장 | curr, oldTime, newTime |
| `CHILD_YN_EXTEND` | 자식 단독 해제예정 연장 | curr, oldTime, newTime |

발사:

```js
if (!opts.dryRun && pushSender && typeof pushSender.processChanges === 'function') {
    const userChanges = _buildUserPushChanges(prevForDiff, curr);
    const userOpts = opts.adminToken ? { adminToken: opts.adminToken } : {};
    await pushSender.processChanges(userChanges, userOpts);
}
```

(`marine_warning_crawler.js:2921~2933`)

`adminToken` 분기 — admin 의 "장부 초기화 (테스트 푸시)" 버튼이 자기
토큰만 지정해서 부르는 경로. 자세한 push_sender 동작은 § 3.5.

### 3.2.12 ⑭ 연장 메모리 갱신 (`_updateExtensionMemory`)

`marine_warning_crawler.js:1379~`. curr 의 각 zone 상태를 `_extensionMemory[zone]`
에 6 시간 retention 으로 저장. 다음 사이클의 핸드오프 공백 (1 사이클 prev
비어있음) 보강에 사용 (`EXTENSION_BRIDGE_MS=5분`). null gap 후 연장 재등장
시 "신규 발표" 오인 방지.

### 3.2.13 ⑮ prev = curr 저장

`marine_warning_crawler.js:2940~2942`:

```js
_prevSnapshot = curr;
_savePrevSnapshot(curr);
_savePushedPubs();   // 발송이력 dedup 영속화
```

`_savePrevSnapshot` (`marine_warning_crawler.js:657~`): atomic write
(`tmp → rename`):

```js
const dir = path.dirname(_STATE_FILE);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(_STATE_TMP, JSON.stringify({ prev: snap.toJSON(), updatedAt: new Date().toISOString() }, null, 2), 'utf8');
fs.renameSync(_STATE_TMP, _STATE_FILE);
```

### 3.2.14 ⑯ weather_alerts.json 갱신 (`_writeWeatherAlertsJson`)

`marine_warning_crawler.js:2086~`. 사용자 앱이 폴링하는 표출용 zone tree.
§ 3.4 의 schema 참조. 자세한 표출 layer 는 § 5.

---

## § 3.3 `StateSnapshot` 자료 구조

`marine_warning_crawler.js:238~299`. **한 사이클의 진실의 단일 표상**.

```js
class StateSnapshot {
    constructor(raw = {}) {
        this.parents = raw.parents instanceof Map ? raw.parents : new Map();
        this.children = raw.children instanceof Map ? raw.children : new Map();
        this.upcomings = raw.upcomings instanceof Map ? raw.upcomings : new Map();
    }
    ...
}
```

세 개의 Map:

- `parents: Map<zoneName, info>` — 발효중 부모 + 부모형 예비 (1 zone = 1 entry)
- `children: Map<parentName, Map<childFullName, info>>` — 자식 발효/예비
- `upcomings: Map<zoneName, info>` — **B 트랙**: 발효중 zone 의 공존 예비
  (병렬 표출용)

### 3.3.1 info shape (parents · upcomings · children 공통)

```js
{
    wrnTp: 'V',              // 종류 코드 ('V'/'T')
    wrnTpNm: '풍랑',          // 종류 한글
    wrnLvl: '2',             // 등급 코드 ('1'/'2'/'5')
    wrnLvlNm: '주의보',       // 등급 한글 ('예비'/'주의보'/'경보'/'해제')
    tmFc: '2026.06.01 04:30',     // 발표시각 (앵커 적용 후)
    tmEf: '2026.06.01 06:00',     // 발효시각 (hold 적용 후)
    tmYn: '2026.06.01 23:58',     // 해제예정 (이론적)
    clrNtcTm: '2026.06.01 23:00', // 해제예고 (정확값 보강 + hold)

    // 가드/홀드 단계가 추가하는 메타 필드 (선택적)
    _realLvlNm: '경보',      // GAP 공존 격상 발표 시 실제 등급 보존
    _efExtend: { oldTime, newTime },   // 발효예정 연장 플래그
    _clrExtend: { oldTime, newTime },  // 해제예정 연장 플래그
    tmEfDisp: '01일 21시 ~ 24시',     // 표시용 범위형 (비교는 tmEf 사용)
    clrNtcTmDisp: '01일 21시 ~ 24시'   // 표시용 범위형
}
```

### 3.3.2 헬퍼 메서드

```js
// zone 의 다가오는(예비): parents 가 예비면 그것, 아니면 upcomings.
getUpcoming(name) {
    const p = this.parents.get(name);
    if (p && p.wrnLvlNm === '예비') return p;
    return this.upcomings.get(name) || null;
}

// zone 의 발효중(active): parents 가 active(예비·해제 아님)면 그것.
getActive(name) {
    const p = this.parents.get(name);
    return (p && p.wrnLvlNm && p.wrnLvlNm !== '예비' && p.wrnLvlNm !== '해제') ? p : null;
}

getParent(name)         { return this.parents.get(name) || null; }
getActiveChildren(parent) {
    const m = this.children.get(parent);
    return m ? Array.from(m.keys()) : [];
}
```

### 3.3.3 JSON 영속화 (`toJSON` / `fromJSON`)

`marine_warning_crawler.js:252~279`. Map → plain object 변환:

```js
toJSON() {
    const obj = { parents: {}, children: {}, upcomings: {} };
    for (const [k, v] of this.parents) obj.parents[k] = v;
    for (const [parent, m] of this.children) {
        obj.children[parent] = {};
        for (const [k, v] of m) obj.children[parent][k] = v;
    }
    for (const [k, v] of this.upcomings) obj.upcomings[k] = v;
    return obj;
}
```

`fromJSON` 은 역변환. `marine_warning_state.json` 의 schema 와 일치.

---

## § 3.4 영속화 파일 4 종

`local_server/data/` 디렉토리에 위치한 사이클간 영속 file 들. 모두
atomic write (`tmp → rename`) 로 부분 쓰기 race 방지.

### 3.4.1 `marine_warning_state.json` — prev snapshot

| 항목 | 값 |
|------|-----|
| 경로 | `local_server/data/marine_warning_state.json` |
| 소유자 | `marine_warning_crawler.js:637 _STATE_FILE` |
| 쓰는 시점 | 매 사이클 끝 (§ 3.2 ⑮) |
| 읽는 시점 | 프로세스 시작 후 첫 cycle (§ 3.2 ②, lazy) |
| 용도 | 다음 cycle 의 diff 기준점 (재배포 후에도 prev 유지) |

schema:

```json
{
  "prev": {
    "parents": {
      "부산앞바다": { "wrnTp": "V", "wrnLvl": "2", "wrnLvlNm": "주의보", ... }
    },
    "children": {
      "부산앞바다": {
        "부산앞바다중연안바다": { "wrnTp": "V", ... }
      }
    },
    "upcomings": {
      "부산앞바다": { "wrnTp": "V", "wrnLvlNm": "예비", ... }
    }
  },
  "updatedAt": "2026-06-01T13:45:30.123Z"
}
```

### 3.4.2 `weather_alerts.json` — 표출용 zone tree

| 항목 | 값 |
|------|-----|
| 경로 | `local_server/data/weather_alerts.json` |
| 소유자 | `marine_warning_crawler.js:_writeWeatherAlertsJson` |
| 쓰는 시점 | 매 사이클 끝 (§ 3.2 ⑯) |
| 읽는 시점 | 프론트가 `/api/weather-alerts` polling |

schema (legacy 호환 zone 트리):

```json
{
  "updatedAt": "2026. 06. 01. 오후 10:35:42",
  "lastReportId": "<옛 통보문 ID, 보존>",
  "processedReportIds": [...],
  "pendingRetries": {...},
  "oneTimeBulletinWindowOverride": null,
  "previous": {
    "동해": {
      "동해남부해상": {
        "동해남부앞바다": {
          "울산앞바다": {
            "current": null,
            "upcoming": null,
            "history": [],
            "children": {}
          }
        }
      }
    }
  },
  "current": { /* curr StateSnapshot → zone tree */ }
}
```

- skeleton (4 sea — 해상 — 앞바다 — leaf) 는 `_createZoneSkeleton`
  (`marine_warning_crawler.js:1643~1738`) 가 만든다.
- leaf 의 `current` = 발효중 (wrnLvlNm ∈ {주의보, 경보})
- leaf 의 `upcoming` = 예비 — current 와 동시에 채워질 수 있음 (B 트랙)
- `children` = 자식 발효/예비
- 시각 필드는 `normalizeMmisTime` 으로 한글화 (§ 2.4)
- `history` = 디스크 기존 값 보존 (`_collectLeafZonesByName` 으로 머지)

### 3.4.3 `pending_pushes.json` — 실패 푸시 재시도 큐

| 항목 | 값 |
|------|-----|
| 경로 | `local_server/data/pending_pushes.json` |
| 소유자 | `push_sender.js:18 PENDING_PUSH_FILE` |
| 쓰는 시점 | API 호출 실패 시 (`push_sender.js:364~370`) |
| 읽는 시점 | 다음 cycle 의 `retryPendingPushes` (`push_sender.js:378~419`) |
| 만료 | 24 시간 (`age > 24 * 60 * 60 * 1000`) |
| 한도 | 최대 20 건 (오래된 건 폐기) |

schema:

```json
[
  {
    "payload": {
      "templateId": "publish",
      "typeName": "풍랑",
      "level": "예비",
      "items": [...]
    },
    "key": "publish_풍랑_예비",
    "failedAt": "2026-06-01T13:45:30.000Z"
  }
]
```

다음 사이클의 `processAndSendNotifications` 가 changes 가 0 건이어도
`retryPendingPushes` 를 호출하므로 (`push_sender.js:73`), 변동 없는 cycle
에도 retry 보장.

### 3.4.4 `marine_suspicious_state.json` — 의심 가드 상태

| 항목 | 값 |
|------|-----|
| 경로 | `local_server/data/marine_suspicious_state.json` |
| 소유자 | `marine_warning_crawler.js:691 _SUSPICIOUS_FILE` |
| 쓰는 시점 | 의심 가드가 currentCase 변경 시 (§ 3.2 ⑦) |
| 읽는 시점 | 의심 가드 첫 호출 (lazy) |

schema:

```json
{
  "currentCase": {
    "id": "case_20260601_135500",
    "firstSeenAt": 1717246500000,
    "zones": [
      { "name": "부산앞바다", "wrnTp": "V", "wrnTpNm": "풍랑", "wrnLvl": "2", "wrnLvlNm": "주의보", "tmFc": "...", "tmEf": "..." }
    ],
    "cycleCount": 3,
    "lastPushAt": 1717246800000,
    "decisionPending": true
  },
  "history": [
    {
      "id": "case_...",
      "firstSeenAt": ...,
      "decidedAt": ...,
      "decision": "auto-reset",
      "decidedBy": "system",
      "zones": ["..."],
      "elapsedMin": 8,
      "cycleCount": 8
    }
  ]
}
```

`history` 는 최대 `SUSPICIOUS_HISTORY_LIMIT` (= 20) 건 보존.

### 3.4.5 보조: `custom_push_history.json` — 푸시 발송 이력

| 항목 | 값 |
|------|-----|
| 경로 | `local_server/data/custom_push_history.json` |
| 소유자 | `local_server/routes/push.js:80 HISTORY_FILE` |
| 쓰는 시점 | `/api/push-custom` 의 끝 (`push.js:513`) |
| 한도 | 500 건 capped (admin UI 의 발송 이력 표시용) |

schema (1 row = 1 발송):

```json
[
  {
    "id": "...",
    "templateId": "publish",
    "typeName": "풍랑",
    "level": "예비",
    "title": "[풍랑 예비특보] 부산앞바다",
    "body": "...",
    "sentAt": "2026-06-01T13:45:30.123Z",
    "successCount": 42,
    "failCount": 0,
    "items": [...]
  }
]
```

500 건 capped 라 누적 카운터는 별도 `push_counter` 모듈
(`local_server/services/push_counter.js`) 에서 영속.

---

## § 3.5 push_sender → `/api/push-custom` → FCM

§ 3.2 ⑬ 의 마지막 단계 — change 들이 실제 푸시 알림으로 어떻게 사용자에게
도달하는가.

### 3.5.1 push_sender 의 그룹핑

`push_sender.js:100~330 processAndSendNotifications`. 8 종 change 를 받아
**templateId 로 분류** 후 그룹핑.

```js
function addToGroup(groups, templateId, typeName, level, itemData) {
    const key = `${templateId}_${typeName}_${level}`;
    if (!groups[key]) {
        groups[key] = {
            templateId, typeName, level,
            items: [],
            prevTypeName: itemData.prevTypeName || null,
            prevLevel: itemData.prevLevel || null
        };
    }
    groups[key].items.push(itemData);
}
```

(`push_sender.js:425~439`)

같은 (templateId, typeName, level) 키의 zone 들은 한 그룹에 모인다.
예: 한 사이클에 부산앞바다·울산앞바다 둘 다 풍랑 예비 발표 → 그룹
`"publish_풍랑_예비"` 에 zone 2 개. 한 푸시에 콤마 결합으로 묶임
(`a057b7f` 커밋).

**templateId 종류**:

- `publish` — 신규 예비 발표
- `active` — 신규 발효
- `release` — 부모+자식 동시 해제
- `prelim_cancel` — 예비특보 취소 (정식 발효 없이 사라짐)
- `level_upgrade_publish`, `level_upgrade_active` — 예비/발효 단계 격상
- `level_downgrade_publish`, `level_downgrade_active` — 격하
- `type_upgrade_publish`, `type_upgrade_active` — 종류 격상 (풍랑 → 태풍)
- `type_downgrade_publish`, `type_downgrade_active` — 종류 격하
- `time_ef_change` — 발효시각 변경
- `time_yn_change` — 해제시각 변경
- `additional_active` — 자식 추가 발효
- `partial_release` — 자식 일부 해제
- `ef_extend`, `yn_extend` — 시각 연장

### 3.5.2 점검 모드 체크

`push_sender.js:76~90`:

```js
if (fs.existsSync(MAINTENANCE_FILE)) {
    const config = JSON.parse(fs.readFileSync(MAINTENANCE_FILE, 'utf8'));
    if (config.active && config.blockPush !== false) {
        console.log('[PushSender] 점검 모드 활성화 중 → 푸시 발송 차단');
        return false;
    }
}
```

`local_server/data/maintenance_config.json` 의 `{ active: true, blockPush: true }`
가 켜져 있으면 발송 자체를 skip — `crawlPaused` 와 별개로 push 만 차단.

### 3.5.3 `sendToApi` — HTTP POST

`push_sender.js:446~478`. 자기 자신의 `http://localhost:3001/api/push-custom`
으로 POST:

```js
const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        isManualGroupSend: true,
        type: 'auto',
        payload: payload,
        adminToken: adminToken || undefined
    })
});
```

실패 시 (HTTP non-200 또는 네트워크 오류) → `failedPayloads` 에 누적 →
사이클 끝에 `pending_pushes.json` 에 저장.

### 3.5.4 `/api/push-custom` 라우트

`local_server/routes/push.js:240~`. 각 사용자 구독자에 대해:

#### 3.5.4.1 adminToken 분기 (테스트 모드 vs 전체 발송)

`push.js:262~269`:

```js
if (adminToken) {
    const originalCount = subs.length;
    subs = subs.filter(s => s.type === 'fcm' && s.token === adminToken);
    console.log(`🔧 [Push] 관리자 테스트 모드: ${originalCount}명 중 관리자 토큰 매칭 ${subs.length}명`);
    if (subs.length === 0) {
        return res.json({ success: true, successCount: 0, ... });
    }
}
```

`adminToken` 이 있으면 해당 토큰 (관리자 기기) 으로만 발송 — admin "장부
초기화 (테스트 푸시)" 버튼의 출구.

#### 3.5.4.2 FCM 배치 발송 (100명씩)

`push.js:275~`:

```js
const BATCH_SIZE = 100;
for (let i = 0; i < subs.length; i += BATCH_SIZE) {
    const batch = subs.slice(i, i + BATCH_SIZE);
    const batchPromises = batch.map(async (user) => {
        // 1. 마스터 토글 체크
        if (user.options && user.options.master === false) return;

        // 2. 해역 교집합
        if (isManualGroupSend && payload) {
            userFilteredItems = getMatchedZones(user.zones, payload.items, user.options || {});
            if (!userFilteredItems || userFilteredItems.length === 0) return;

            // 3. 자식 토글
            const showChildZones = !(user.options && user.options.childZones === false);
            const generated = generateMessage({ ...payload, items: userFilteredItems, showChildZones });
            ...
        }

        // 4. 시나리오별 토글 (announce / active / release)
        ...

        // 5. 야간 토글 (KST 23:00~07:00)
        ...

        // 6. admin.messaging().send 또는 webpush.sendNotification
        ...
    });
    await Promise.all(batchPromises);
}
```

100 명씩 끊는 이유 — 메모리 절약 + FCM rate limit 보호.

#### 3.5.4.3 구독자 매칭·필터링 8 단계

각 사용자 user 에 대해:

1. **마스터 토글** (`user.options.master === false` → skip)
2. **해역 교집합** — `getMatchedZones(user.zones, payload.items, user.options)`
   (`services/push_helpers.js:189`). 사용자가 구독한 해역 (대/중/소분류
   혼재) 을 소분류로 확장 후 교집합.
3. **자식 토글** — `user.options.childZones === false` 면 부모명 옆 한정사
   `(연안바다 포함)` 등을 안 붙임.
4. **메시지 생성** — `generateMessage(payload)` 가 templateId 별 다른 본문.
5. **시나리오별 토글** (`push.js:325~355`):
   - `opts.announce === false` → publish, level_upgrade_publish,
     level_downgrade_publish, time_ef_change, ef_extend 차단
   - `opts.active === false` → active, level_upgrade_active,
     level_downgrade_active, time_yn_change, additional_active, yn_extend 차단
   - `opts.release === false` → release, prelim_cancel, partial_release 차단
   - `opts.childZones === false` → additional_active, partial_release 차단 (자식 전용)
6. **야간 토글** — `KST 23:00 ~ 07:00` 발송 차단 (`opts.night`).
7. **FCM/Web Push 전송** — `admin.messaging().send` 또는
   `webpush.sendNotification`.
8. **dead token 정리** — `messaging/registration-token-not-registered` 등
   에러 시 `_isDead` 마킹 → 사이클 끝에 `push_subscriptions.json` 에서 제거.

#### 3.5.4.4 history 기록

`push.js:486~513`. `custom_push_history.json` 에 1 row 추가 (500 capped).
admin UI 의 "발송 이력" 페이지가 이 파일을 읽어 표시.

500 한도가 차서 잘려도 누적 카운터는 `services/push_counter.js` 의 별도
영속 file 에 유지 — admin UI 의 "총 발송 건수" 표시용.

### 3.5.5 발송 결과 경로 요약

성공: `successCount++`, history 추가, response 200.
실패 (HTTP 4xx/5xx 또는 네트워크 오류): `pending_pushes.json` 에 큐잉 →
다음 cycle 의 `retryPendingPushes` 가 재시도 (24 시간 만료, § 3.4.3).
dead token (만료): subs 에서 자동 제거.

---

# 부록 — § 2/§ 3 cross-reference 색인

| 키워드 | 위치 |
|--------|------|
| endpoint 카탈로그 | § 2.1 |
| row 필드 사전 | § 2.2 |
| KMA 인코딩 (5 종 시각 + 58/59) | § 2.3 |
| `normalizeMmisTime` | § 2.4 |
| `MMIS_CODE_TO_NAME` (A 안) | § 2.5 |
| `PARENT_TO_CHILDREN` + `_extractParent` | § 2.6 |
| GAP 보강 (V10) | § 2.7 |
| 1분 cron + `_runInProgress` 락 | § 3.1 |
| 16 단계 pipeline | § 3.2 |
| E-1 콜드부팅 가드 (오늘 fix) | § 3.2 ⑥ |
| E-4 부분 실패 cycle skip | § 3.2 ③ |
| 의심 가드 (3+ zone 사라짐) | § 3.2 ⑦ |
| 자식 해제 디바운스 (3 분) | § 3.2 ⑧ |
| 발표시각 anchor | § 3.2 ⑨ |
| 시각 윈도우 hold + 연장 | § 3.2 ⑩·⑪ |
| 시각변경 3 분 디바운스 | § 3.2 ⑫ |
| 8 종 change type | § 3.2 ⑬ / § 3.5.1 |
| `StateSnapshot` 자료 구조 | § 3.3 |
| 영속화 파일 4 종 | § 3.4 |
| push_sender 그룹핑 | § 3.5.1 |
| `/api/push-custom` 8 단 필터 | § 3.5.4.3 |
| FCM 배치 (100 명씩) | § 3.5.4.2 |

상세 시나리오 동작은 § 4, 사용자 표출 layer 는 § 5, 시행착오 timeline 은
§ 6 에서 다룬다.
# § 4. 시나리오별 동작

본 절은 SEAGNAL × KMA MMIS 통합이 다루는 **모든 lifecycle 시나리오**를 한 곳에서 권위적으로 정의한다. 이전 8,503줄 단순 concat 문서에서 시나리오 카탈로그가 Part A/B/D 세 곳에 분산되어 같은 케이스를 세 번 다른 모양으로 정의했는데, 본 통합본에서는 시나리오 1건당 **모든 측면(트리거·MMIS 입력·처리 단계·change event·푸시 텍스트·카드 표시)**을 단일 entry 안에 묶고, 다른 § 에서는 cross-link 만 한다.

§ 4 의 책임은 "**무엇이 일어나면, 코드가 어떻게 분기하고, 사용자에게 어떤 메시지가 어떤 모양으로 도달하는가**" 의 사실관계 정리다. 시간순 시행착오(왜 그렇게 되었는가)는 § 6 에서, 카드/팝업 표출 정책의 일반 규칙은 § 5 에서, 사용된 가드/전처리/디바운스의 메커니즘 deep-dive 는 § 2~3 에서 다룬다.

---

## § 4.0 시나리오 카탈로그 (개요)

### § 4.0.1 시나리오 ID 명명 규칙

본 절의 시나리오 ID 는 `S-` 접두사 + 영문 토큰 형태이며, 세 가지 명명 패턴 중 하나를 따른다.

1. **상태 명사 단독** — 시나리오의 핵심 사건을 단어 1개로 부른다.
   - `S-COLD`(콜드 부팅), `S-BASELINE`(장부 초기화), `S-RELEASE`(정식 해제), `S-HANDOFF`(예비→발표 핸드오프), `S-PARALLEL`(발효+예비 병렬), `S-BROADCAST`(전체 사용자 재발송).

2. **상태 전이 화살표** — `STATE_FROM → STATE_TO` 의 양상으로 부른다.
   - `S-NONE→PRELIM`(무특보 → 예비), `S-NONE→ACTIVE`(무특보 → 정식 발효, 예비 없이 바로), `S-PRELIM→ACTIVE`(예비 → 정식 발효, 자연 전이).

3. **객체-동작** — 대상 객체 (`PRELIM`/`ACTIVE`/`CHILD`/`LATEST`) + 동작 (`TIMECH`/`EXTEND`/`YNCH`/`ADD`/`RELEASE`/`FULLRELEASE`/`BLINK`/`EXTEND`/`TIMECH`).
   - `S-PRELIM-TIMECH`(예비 발효시각 변경), `S-PRELIM-EXTEND`(예비 발효시각 연장), `S-PRELIM-CANCEL`(예비 취소).
   - `S-ACTIVE-YNCH`(발효중 해제예정 변경), `S-ACTIVE-YNEXTEND`(해제예정 연장).
   - `S-LVL-UP` / `S-LVL-DOWN` / `S-LVL-UP-PUBLISH` / `S-LVL-DOWN-PUBLISH`, `S-TYPE-UP` / `S-TYPE-DOWN`.
   - `S-CHILD-ADD`, `S-CHILD-RELEASE`, `S-CHILD-FULLRELEASE`, `S-CHILD-BLINK`, `S-CHILD-EXTEND`, `S-CHILD-TIMECH`.
   - `S-GAP-PARENT`, `S-GAP-CHILD`(`GAP` = warn/list·warn/ready 에는 없고 warn/latest 에만 있는 발표대기 상태).
   - `S-PARTIAL-FAIL`, `S-SUSPICIOUS`, `S-MM58`(KMA 분=58/59 범위코드), `S-LATEST-BLINK`(warn/latest 깜빡임), `S-DEBOUNCE-VIBRATE`(시각값 진동 디바운스).

### § 4.0.2 각 시나리오 entry 의 표준 포맷

본 절의 각 시나리오 entry 는 다음 6개 슬롯을 가진다.

1. **트리거** — 어떤 MMIS 변화로 발생하는가. 1~2문장.
2. **MMIS 입력** — 어느 endpoint(warn/list · warn/ready · warn/latest · warn-sasc/list · warn-sasc/ready · warn-sasc/latest) 가 어떤 row 를 어떤 모양으로 반환하는가. prev 측 상태도 함께 명시.
3. **처리 단계** — `marine_warning_crawler.js:run()` 의 어느 단계(snapshot → enrich → guards → diff → push) 에서 무엇이 일어나는가. 순서와 함수명을 함께 인용.
4. **Change event** — `_buildUserPushChanges` 가 내보내는 객체 (`type`/`zone`/`prev`/`curr`/`childState`/`currentActive`/...).
5. **푸시 메시지** — `push_sender.processChanges` → `push_helpers.generateMessage` 가 생성하는 templateId, 제목(title), 본문(body) 의 실제 텍스트 예시. 야간 차단·자식 토글 등 발사 조건 포함.
6. **카드 표시** — `weather_alerts.json` 의 zone tree 가 어떻게 변하고, 부모 카드(`js/render.js`)·자식 카드(`js/render_coastal.js`) 에 어떻게 그려지는가.

추가로 각 entry 끝에 **관련 시행착오** (§ 6 의 어느 항목), **관련 가드** (§ 2/§ 3 의 어느 절), **관련 코드 라인** 으로 cross-link 한다.

### § 4.0.3 시나리오 인덱스 표

| ID | 한 줄 요약 | 빈도 | 관련 § |
|---|---|---|---|
| `S-COLD` | 콜드 부팅 (E-1 가드, 빈 prev) | 배포 시마다 1회 | § 4.1 |
| `S-COLD-ACTIVE` | 콜드 부팅 + 활성 특보 (재배포 직후 폭주 방지) | 배포 시 | § 4.2 |
| `S-COLD-EMPTY` | 콜드 부팅 + 무특보 (조용한 시작) | 배포 시 | § 4.3 |
| `S-BASELINE` | 관리자 장부 초기화 + 강제 baseline 푸시 | 테스트 시 | § 4.4 |
| `S-BROADCAST` | `broadcastAll` 전체 사용자 재발송 | 운영 비상시 | § 4.5 |
| `S-NONE→PRELIM` | 무특보 → 예비특보 발표 (publish) | 신규 lifecycle 시작 | § 4.6 |
| `S-NONE→ACTIVE` | 무특보 → 정식 발효 (예비 없이 바로, active) | 드묾 | § 4.7 |
| `S-PRELIM→ACTIVE` | 예비 → 정식 발효 (자연 전이) | 핵심 | § 4.8 |
| `S-PRELIM-CANCEL` | 예비특보 취소 (정식 발효 없이 사라짐) | 가끔 | § 4.9 |
| `S-RELEASE` | 정식 해제 (release) | 자주 | § 4.10 |
| `S-PRELIM-TIMECH` | 예비 발효시각 변경 (time_ef_change, 3분 디바운스) | 자주 | § 4.11 |
| `S-ACTIVE-YNCH` | 발효중 해제예정시각 변경 (time_yn_change) | 자주 | § 4.12 |
| `S-PRELIM-EXTEND` | 예비 발효시각 연장 (ef_extend, 범위→더 늦은 범위) | 자주 | § 4.13 |
| `S-ACTIVE-YNEXTEND` | 해제예정 연장 (yn_extend) | 자주 | § 4.14 |
| `S-LVL-UP` | 등급 격상 (주의보 → 경보, level_upgrade_active) | 가끔 | § 4.15 |
| `S-LVL-DOWN` | 등급 격하 (level_downgrade_active) | 가끔 | § 4.16 |
| `S-LVL-UP-PUBLISH` | 예비 단계 격상 (level_upgrade_publish) | 가끔 | § 4.17 |
| `S-LVL-DOWN-PUBLISH` | 예비 단계 격하 | 드묾 | § 4.18 |
| `S-TYPE-UP` / `S-TYPE-DOWN` | 종류 변경 (풍랑 → 태풍 등) | 드묾 | § 4.19 |
| `S-CHILD-ADD` | 부모 유지 + 자식만 추가 발효 (additional_active) | 자주 | § 4.20 |
| `S-CHILD-RELEASE` | 부모 유지 + 자식 일부 해제 (partial_release) | 자주 | § 4.21 |
| `S-CHILD-FULLRELEASE` | 모든 자식 한꺼번에 해제 (부모는 유지) | 가끔 | § 4.22 |
| `S-CHILD-BLINK` | 자식 깜빡임 (3분 디바운스, 글리치) | 빈발(가드됨) | § 4.23 |
| `S-CHILD-EXTEND` | 자식 단독 시각 연장 | 가끔 | § 4.24 |
| `S-CHILD-TIMECH` | 자식만 시각 변경 (부모 불변) | 가끔 | § 4.25 |
| `S-GAP-PARENT` | 발표 발효대기 부모 (warn/latest 만 보유) | 가끔 | § 4.26 |
| `S-GAP-CHILD` | 발표 발효대기 자식 (warn-sasc/latest 합성) | 가끔 | § 4.27 |
| `S-HANDOFF` | 예비→발표 1사이클 prev 공백 | 가끔 | § 4.28 |
| `S-PARALLEL` | 발효 + 공존 예비 병렬 표출 | 드묾 | § 4.29 |
| `S-PARTIAL-FAIL` | endpoint 부분 실패 (E-4 가드, cycle skip) | 운영 이슈 | § 4.30 |
| `S-SUSPICIOUS` | mmis 빈 응답 의심 (3+ zone 사라짐, D-medium) | 운영 이슈 | § 4.31 |
| `S-MM58` | KMA 범위코드 (분=58/59) 인식 | 빈발(자동) | § 4.32 |
| `S-LATEST-BLINK` | warn/latest 깜빡임 가짜 푸시 차단 | 자동 가드 | § 4.33 |
| `S-DEBOUNCE-VIBRATE` | 시각값 진동 디바운스 차단 (3분) | 자동 가드 | § 4.34 |

### § 4.0.4 시나리오 그룹 (의미적 분류)

- **lifecycle 시작/종료** — § 4.1 ~ § 4.10: 콜드 부팅·장부 초기화·발표·발효·해제까지의 큰 흐름.
- **시각 변경** — § 4.11 ~ § 4.14: 같은 단계 안에서 tmEf/clrNtcTm 의 값만 바뀌는 경우.
- **등급/종류 변경** — § 4.15 ~ § 4.19: 격상/격하/종류 전환.
- **자식** — § 4.20 ~ § 4.25: 부모는 유지되고 자식 set 만 변하거나 자식만 시각 변하는 경우.
- **GAP / 핸드오프 / 병렬** — § 4.26 ~ § 4.29: warn/list·warn/ready 와 warn/latest 사이의 불일치를 보강하는 시나리오들.
- **가드 / 운영** — § 4.30 ~ § 4.34: endpoint 실패, 의심 가드, KMA 인코딩 흡수, 깜빡임/진동 디바운스.

### § 4.0.5 공통 trigger 모델

본 절의 모든 시나리오는 공통적으로 `marine_warning_crawler.run({ forceBaselinePush?, adminToken? })` 한 사이클 안에서 일어난다. 사이클의 골격은 다음 9 단계다 (§ 3.1 참조).

```
[1] prev = _loadPrevSnapshot()                       ← 디스크 영속화 복원
[2] fetched = await marineClient.fetchAllRealtimeEndpoints()   ← 4 endpoint 동시 호출
[3] curr = _buildSnapshotFromMarine(fetched)
[4] _enrichSnapshotWithLatest(curr, prev, fetched)   ← warn/latest, warn-sasc/latest 보강
[5] _applySuspiciousGuard(prev, curr)                ← D-medium
[6] _applyChildReleaseDebounce(prev, curr)           ← 자식 깜빡임 가드
[7] _applyAnnounceAnchor(prev, curr)                 ← 발표시각 고정
[8] _applyUpcomingEfLogic(prev, curr) / _applyReleaseClrLogic(prev, curr)
    _debounceTimeValues(prev, curr)                  ← 시각 변경 3분 디바운스
[9] diffMatrix = DiffMatrix.compute(prev, curr)      ← 관리자 채널 buckets
[10] userChanges = _buildUserPushChanges(prev, curr) ← 사용자 채널 changes
[11] pushSender.processChanges(userChanges, { adminToken })
[12] _writeWeatherAlertsJson(prev, curr)             ← 앱 표출 JSON
[13] _savePrevSnapshot(curr)
[14] _updateExtensionMemory(curr)                    ← 5분 / 6시간 기억
```

각 시나리오 entry 의 "처리 단계" 슬롯은 위 14 단계 중 해당 시나리오에 의미 있는 부분만 인용한다.

### § 4.0.6 본 절이 다루지 않는 것

- 시각 표시 포맷의 일반 규칙 (월·상대일자·시단위·범위 보정) — § 5.
- 관리자 채널의 buildAdminTitle / formatGroupedMessage / 콤마결합 양식 — § 5.
- 자식 카드 클릭 비활성 / detail box 정책 / 지도 폴리곤 표출 — § 5.
- 각 fix 의 시간순 흐름과 의도 — § 6.
- StateSnapshot · DiffMatrix · childState 의 구조체 정의 — § 8 (부록).

---

## § 4.1 S-COLD — 콜드 부팅 (E-1 가드)

### 트리거
fly.io 재배포 직후 process 가 막 시작되어, 메모리상의 `_prevSnapshot` 이 아직 한 번도 채워지지 않았다. 디스크의 `data/marine_warning_state.json` 이 존재하지 않거나 손상되어 빈 `StateSnapshot` 으로 복원된 상태.

### MMIS 입력
- prev: 빈 `StateSnapshot` (`parents`/`children`/`upcomings` 모두 empty Map).
- curr 측은 4 endpoint 응답이 정상 — 현재 활성 특보가 N개 있을 수 있고 0개일 수도 있다.

### 처리 단계
1. `[1]` `prev = _loadPrevSnapshot()` → 디스크 파일 없음 → 빈 `StateSnapshot` 반환.
2. `[2]~[3]` curr 정상 빌드.
3. `[4]` enrich 단계의 GAP/clrNtcTm 보강은 거의 효과 없음 (prev 자체가 비어 비교 대상이 없음).
4. E-1 가드 (`marine_warning_crawler.js:2434~2443`):

```js
if (_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad) {
    console.log('[Marine] 콜드 부팅 + 빈 prev — push skip, state 저장만 ...');
    _prevSnapshot = curr;
    _savePrevSnapshot(curr);
    _writeWeatherAlertsJson(new StateSnapshot(), curr);
    return [];
}
```

5. `isFirstLoad` 는 진입 시 `_prevSnapshot === null` 여부로 결정 — 한 번 호출되면 메모리에 빈 snapshot 이라도 들어가서 다음 호출엔 `false` 가 된다 (§ 4.7 의 자연 전이가 이 가드에 걸리지 않도록 하는 핵심 조건).

### Change event
없음. `_buildUserPushChanges` 호출 자체가 일어나지 않음 (가드 통과 시 `return []`).

### 푸시 메시지
**없음.** 콜드 부팅 직후 현재 활성 특보 N개를 모두 "신규 발표" 로 오인해 사용자에게 알림 폭주하는 회귀를 차단한다.

### 카드 표시
앱의 `weather_alerts.json` 은 즉시 갱신된다 (`_writeWeatherAlertsJson(new StateSnapshot(), curr)`). 사용자가 앱을 열면 현재 활성 특보가 정상 표출된다. 단, 푸시는 안 간다 — 이 시나리오의 핵심 트레이드오프.

### 관련 시행착오
- → § 6.E-1 ("E-1 가드의 콜드부팅 한정 — 커밋 `6df054a`"): 처음엔 `_isSnapshotEmpty(prev)` 단독 조건이라 자연 전이도 차단했다. `isFirstLoad` 추가로 콜드 부팅 1회만 차단하도록 좁힘.
- → § 6.GAP ("E-1/E-2/E-4 운영 안전성 보강 — 커밋 `baf34fa`"): 가드 도입의 최초 커밋.

### 관련 가드
- → § 2.E-1 (E-1 가드 정의), § 3 cron 진입.

### 관련 코드
- `marine_warning_crawler.js:2434~2443` (E-1 가드 본체).
- `marine_warning_crawler.js:_isSnapshotEmpty` (Map.size 합산이 0 인지 검사).
- `marine_warning_crawler.js:isFirstLoad` 변수 (run 함수 진입 시 결정).

---

## § 4.2 S-COLD-ACTIVE — 콜드 부팅 + 활성 특보

### 트리거
재배포 직후 (S-COLD 상황) 인데 현재 KMA 가 발효 중인 특보 N개를 보유하고 있다.

### MMIS 입력
- prev: 빈 `StateSnapshot`.
- curr: `parents` Map 에 발효중 zone 들 (예: `울산앞바다`/`부산앞바다`/`제주도서부앞바다`).

### 처리 단계
S-COLD 의 E-1 가드가 그대로 적용된다. `forceBaseline=false`, `isFirstLoad=true` 이므로 **push 0건 + state 저장만**.

만약 E-1 가드가 없거나 `forceBaseline=true` 면, `_buildUserPushChanges` 가 모든 zone 을 신규로 인지 → `CURRENT_CHANGE { prev:null, curr:{...} }` N건이 발생 → 사용자에게 `🚨 풍랑 주의보 발효` 푸시가 동시에 N건 발사된다. 이것이 "재배포 직후 폭주" 의 정체다.

### Change event
없음. 단 메모리·디스크에는 curr 가 저장되어 다음 사이클부터는 정상 diff 가 가능하다.

### 푸시 메시지
**없음** (E-1 가드 효과).

### 카드 표시
즉시 정상. weather_alerts.json 의 leaf 트리에 발효중 부모/자식이 모두 채워져, 앱을 새로 띄우면 현재 활성 특보가 보인다.

### 관련 시행착오
- → § 6.E-1 (`baf34fa`).
- → § 6.E-1-NARROW (`6df054a` 의 `isFirstLoad` 조건 추가).

### 관련 코드
- 동일 (§ 4.1).

---

## § 4.3 S-COLD-EMPTY — 콜드 부팅 + 무특보

### 트리거
재배포 직후 + KMA 에 활성 특보 0건.

### MMIS 입력
- prev: 빈 `StateSnapshot`.
- curr: 빈 `StateSnapshot` (모든 endpoint 가 빈 list).

### 처리 단계
- `_isSnapshotEmpty(curr) === true`.
- E-1 가드: `_isSnapshotEmpty(_prevSnapshot) && !forceBaseline && isFirstLoad` → true → push skip + state 저장.
- 사실상 noop. 아무 일도 안 일어난 채로 다음 사이클로 넘어간다.

### Change event
없음.

### 푸시 메시지
없음.

### 카드 표시
weather_alerts.json 은 빈 트리. 사용자 앱은 "관심해역 특보 없음" (`js/render.js:725-801`, status-badge safe, opacity 0.6) 으로 표시.

### 관련 코드
- 동일.

---

## § 4.4 S-BASELINE — 관리자 장부 초기화 (강제 baseline 푸시)

### 트리거
관리자가 어드민 페이지의 **"장부 초기화(테스트 푸시)"** 버튼을 클릭. `POST /api/admin/marine/reset` body `{ testPush:true, adminToken }`. 또는 자동 테스트 시나리오.

### MMIS 입력
- prev: `resetState()` 가 호출되어 빈 `StateSnapshot` + `_forceBaselinePending = true` 예약.
- curr: 즉시 호출되는 `run({ forceBaselinePush:true, adminToken })` 에서 현재 활성 특보를 그대로 가져옴.

### 처리 단계
1. `routes/admin.js:177~208`:
   ```js
   marineWarningCrawler.resetState();
   await marineWarningCrawler.run({ forceBaselinePush: true, adminToken });
   ```
2. E-1 가드:
   ```js
   forceBaseline === true → E-1 가드 우회
   log('⚠️ 강제 baseline 푸시 모드 — E-1 가드 우회, 현재 활성 특보를 신규로 발사');
   _forceBaselinePending = false;   // 1회 소비
   ```
3. `[10]` `_buildUserPushChanges`: prev 가 비어있고 curr 에 N개 zone → 모두 신규 → `UPCOMING_CHANGE { prev:null, curr:{예비} }` 또는 `CURRENT_CHANGE { prev:null, curr:{주의보} }` 가 zone 별 발사.
4. `pushSender.processChanges(userChanges, { adminToken })`:
   - `adminToken` 이 있으면 그 토큰 1명만 발송 (테스트용).
   - 없으면 전체 사용자 (= S-BROADCAST 와 합쳐짐 — § 4.5).

### Change event
zone 별로 다음 두 가지가 섞여 발사된다.

```js
{ type: 'UPCOMING_CHANGE', zone, prev: null,
  curr: { wrnTp:'풍랑', wrnLvl:'예비', tmFc, tmEf, ... },
  currentActive: null, childState }
{ type: 'CURRENT_CHANGE', zone, prev: null,
  curr: { wrnTp:'풍랑', wrnLvl:'주의보', tmFc, tmEf, tmYn:clrNtcTm, ... },
  childState }
```

### 푸시 메시지
- 예비 zone → templateId `publish`:
  ```
  📢 풍랑 주의보 발표
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 발효예정 : 5월 25일(내일) 18시
  ```
- 발효 zone → templateId `active`:
  ```
  🚨 풍랑 주의보 발효
  ㅇ부산앞바다(모든 연안바다 포함)
     - 해제예정 : 5월 26일(모레) 03시~06시
  ```
- 발사 대상: `adminToken` 만 있을 때 해당 기기 1명, 없을 때 전체 사용자. 야간 토글·자식 토글 등 정상 라우팅 규칙 그대로 적용.

### 카드 표시
즉시 갱신 — 강제 baseline 이라 사실상 "사용자에게 다시 한번 push 로 환기" 의 의미. 카드 자체는 평소와 동일.

### 관련 시행착오
- → § 6.E-1-NARROW (커밋 `6df054a`): 콜드 부팅 1회 한정 + admin reset 의 `broadcastAll` 플래그 추가.
- → § 6.ADMIN-RESET (커밋 `5ea305b`): `_forceBaselinePending` 도입으로 리셋 경합 차단.
- → § 6.ADMIN-UI (커밋 `6ba1a95`): admin 페이지에 장부 초기화 버튼 + 특정관리해역 토글 기본 ON.
- → § 6.ADMIN-CHILD-WINDOW (커밋 `0f2d419`, `ec57794`): 자식 리셋에 윈도우 드롭다운(0~72h, 6h 간격), 자식 해역만 리셋하는 admin 버튼.

### 관련 코드
- `routes/admin.js:177~208` (reset endpoint).
- `marine_warning_crawler.js:2365~2374` (`resetState`).
- `marine_warning_crawler.js:2433~2448` (`forceBaselinePush` 분기).

---

## § 4.5 S-BROADCAST — 전체 사용자 재발송

### 트리거
관리자 어드민 UI 의 **"전체 사용자 재발송"** 버튼 (커밋 `c94ea5e`). `POST /api/admin/marine/reset` body `{ testPush:true, broadcastAll:true }`.

### MMIS 입력
S-BASELINE 과 동일. 차이는 `adminToken` 무시 + 전체 사용자 대상.

### 처리 단계
1. `routes/admin.js`: body 에 `broadcastAll === true` 가 있으면 `adminToken` 파라미터를 인지하더라도 무시하고 전체 사용자로 발송.
2. `marineWarningCrawler.run({ forceBaselinePush:true })`:
   - E-1 우회.
   - 현재 활성 특보 + 예비 → 모든 zone 이 신규 → publish/active 그룹 형성.
3. `pushSender.processChanges(changes)` (adminToken 미전달) → routes/push.js 의 `addToGroup` 이 user filter 적용 → 등록 토큰 전체로 FCM 발송.

### Change event
S-BASELINE 과 동일 구조.

### 푸시 메시지
S-BASELINE 의 publish/active 메시지가 전체 사용자에게 발사된다. 각 사용자의 토글(`announce`/`active`/`release`/`childZones`/`night`/`master`) 이 그대로 적용된다.

### 카드 표시
변화 없음 (앱 데이터는 이미 정상).

### 관련 시행착오
- → § 6.BROADCAST (커밋 `c94ea5e` "관리자 UI 에 '전체 사용자 재발송' 버튼").
- → § 6.SILENT (S-BASELINE 후 푸시 미수신 문제 — broadcastAll 이 그 해결책).

### 관련 코드
- `routes/admin.js` reset 라우트.
- `routes/push.js` `/api/push-custom` 라우트.

---

## § 4.6 S-NONE→PRELIM — 무특보 → 예비특보 발표

### 트리거
KMA 가 새 예비특보를 발표. `warn/ready` 에 새 row 가 등장 (이전 사이클엔 없었음).

### MMIS 입력
- prev: 해당 zone 이 `parents`/`upcomings` 어디에도 없음.
- curr (warn/ready 의 row):
  ```
  warn_zone_cd: 'S1131100',
  warn_tp:      'V',         // 풍랑
  warn_tp_nm:   '풍랑',
  warn_lvl:     '1',
  warn_lvl_nm:  '예비특보',
  tm_fc:        '2026.05.20 06:00',
  tm_ef:        '20일 18시~24시',  // 범위형
  clr_ntc_tm:   ''
  ```

### 처리 단계
1. `[3]` `_buildSnapshotFromMarine`:
   - `_normLvlNm('예비특보') → '예비'` (내부 정규화 — `1870784` "사용자 앱 UI 회귀 차단").
   - `_isTargetRealtimeType('V') === true` (allowlist V/T 통과, 폭풍해일 O 차단).
   - `_resolveZoneName('S1131100') → '울산앞바다'`.
   - `snap.parents.set('울산앞바다', { wrnTpNm:'풍랑', wrnLvlNm:'예비', tmFc:'2026.05.20 06:00', tmEf:'20일 18시~24시', ... })`.
2. `[4]` enrich: warn/latest 의 cmd='발표' 같은 row 가 있을 수 있으나, parents 에 이미 예비가 있으므로 GAP 보강 skip.
3. `[7]` `_applyAnnounceAnchor`: prev 에 같은 종류 예비 없음 → tmFc 그대로 유지 (현재 통보문이 anchor).
4. `[8]` `_applyUpcomingEfLogic`: prev 에 정확값 없음 → 윈도우 `_efWindowEnd['울산앞바다'] = _timeKey('20일 18시~24시', 5)` (범위 끝 키 = 21일 00시 = 210000).
5. `[8]` `_debounceTimeValues`: 최초 수락 → `_tcConfirmed['울산앞바다|tmEf'] = '20일 18시~24시'`. 디바운스 없음.
6. `[10]` `_buildUserPushChanges`:
   - `pUp = null`, `cUp = {...예비}`, `pAct = null`, `cAct = null`.
   - `upcomingChanged = true`.
   - `efExtend = null` (prev 없음, 메모리도 없음).
7. `[11]` `pushSender.processChanges`:
   - `UPCOMING_CHANGE` + `prev === null` → scenario `publish`.
   - `addToGroup(groups, 'publish', '풍랑', '예비', { tmEf:'20일 18시~24시', ... })`.

### Change event
```js
{ type: 'UPCOMING_CHANGE',
  zone: '울산앞바다',
  prev: null,
  curr: { wrnTp:'풍랑', wrnLvl:'예비', tmFc:'2026.05.20 06:00',
          tmEf:'20일 18시~24시', tmYn:'', ... },
  currentActive: null,
  childState: { all:[...], active:[], added:[], released:[] } }
```

### 푸시 메시지
- templateId: `publish`.
- 제목 (`push_helpers.js:292-296`):
  - `effectiveLevel = (level === '예비') ? '주의보' : level` (한 단계 격상한 듯한 표기). 사용자에게 "예비특보" 라고 그대로 말하지 않고 "주의보 발표" 로 보낸다 — 의사결정에 직결되는 메시지로 한 칸 격상.
  - 제목: `📢 풍랑 주의보 발표`.
- 본문 (자식 한정사 ON):
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 발효예정 : 5월 20일(오늘) 18시~24시
  ```
- 본문 (자식 한정사 OFF):
  ```
  ㅇ울산앞바다
     - 발효예정 : 5월 20일(오늘) 18시~24시
  ```
- 발사 대상: 해당 zone 구독자 + `announce !== false` 토글 사용자. 야간 차단(`night === false` + KST 23~07시) 적용. → § 5.토글 매트릭스.
- 시각 포맷: `formatWarnTimeKST` (푸시 전용, 상대일자 라벨 없음. → § 5).

### 카드 표시
- weather_alerts.json: `leaf['울산앞바다'].upcoming = { wrnTp:'V', wrnLvl:'예비', tmFc, tmEf, ... }`.
- 부모 카드 (`js/render.js`):
  - 뱃지: `풍랑 예비` (status-badge preliminary, 주황 #ffb74d 계열).
  - 발표시각: `5월 20일(오늘) 06시` (tmFc).
  - 발효시각: `5월 20일(오늘) 18시~24시` (범위형 그대로 표출).
  - 해제예정: `정보 없음` (순수 예비는 clrNtcTm 없음. `js/render.js:884-892`).
  - [다가오는 특보] 헤더가 표시될 수도 있으나 첫번째 자체가 upcoming 이라 헤더 생략 (`render.js:863-879`).
- 자식 카드 (`js/render_coastal.js`):
  - 부모만 예비라 자식 row 는 `소속 부모 예비 — 자식 미발효` 라벨 정책 (§ 5).
  - 자식 자신의 tmEf 가 범위형이므로 `isExactSingleTime(tmEf) === false` → 발효시각 row 미표시 (`render_coastal.js:401-406`).

### 관련 시행착오
- → § 6.YEBI ("예비특보 푸시 부활 — 커밋 `ff1fe17`"): 초기엔 warn/ready 를 스냅샷에 안 병합해 예비 푸시 전무. `_extractParent` 도입.
- → § 6.NORM ("등급명 정규화 — `_normLvlNm`"): mmis 가 '예비특보' 로 내려주나 내부는 '예비' 비교라 변환 필요.
- → § 6.PUSH-RESTORE ("9651167 사용자 푸시 채널 복원"): legacy 비활성화 후 사용자 푸시 0건 → `pushSender.processChanges` 호출 부활.

### 관련 코드
- `marine_warning_crawler.js:2100~2118` (warn/ready 분기).
- `push_sender.js:104~143` (UPCOMING_CHANGE 분기).
- `push_helpers.js:292~296` (publish 메시지).

---

## § 4.7 S-NONE→ACTIVE — 무특보 → 정식 발효 (예비 없이 바로)

### 트리거
KMA 가 예비 단계를 거치지 않고 바로 발효. `warn/list` 에 row 직접 등장. 긴급 발효 / SEAGNAL 가동 후 이미 발효 중인 특보를 첫 인지하는 경우 등.

### MMIS 입력
- prev: 해당 zone 없음.
- curr (warn/list 의 row):
  ```
  warn_zone_cd: 'S1311100',
  warn_tp: 'V', warn_tp_nm: '풍랑',
  warn_lvl: '2', warn_lvl_nm: '주의보',
  tm_fc: '2026.05.20 18:00',
  tm_ef: '2026.05.20 18:00',     // 발효 = 통보문 시각
  tm_yn 또는 clr_ntc_tm: '21일 06시~09시'
  ```

### 처리 단계
1. `_buildSnapshotFromMarine`: `snap.parents.set('부산앞바다', { wrnLvlNm:'주의보', tmFc, tmEf, tmYn:clrNtcTm... })`.
2. `_isSnapshotEmpty(prev)` 가 일반적으로는 false (운영중인 process 의 자연 전이). E-1 가드는 `isFirstLoad === false` 라 통과.
3. `[9]` DiffMatrix:
   ```js
   if (!pPrev && pCurr && pCurr.wrnLvlNm !== '해제') {
     isPublish = (pCurr.wrnLvlNm === '예비')  // false
     matrix.add('active', { parent, time: pCurr.tmYn, childState })
   }
   ```
4. `[10]` `_buildUserPushChanges`: `CURRENT_CHANGE { prev:null, curr:{주의보} }`.
5. `pushSender.processChanges`:
   - `CURRENT_CHANGE` + `prev === null` + `curr.wrnLvl !== '예비'` → scenario `active`.
   - `addToGroup(groups, 'active', '풍랑', '주의보', { tmYn: clrNtcTm, ... })`.

### Change event
```js
{ type: 'CURRENT_CHANGE',
  zone: '부산앞바다',
  prev: null,
  curr: { wrnTp:'풍랑', wrnLvl:'주의보', tmFc, tmEf,
          tmYn:'21일 06시~09시', ... },
  childState: { ... } }
```

### 푸시 메시지
- templateId: `active`.
- 제목: `🚨 풍랑 주의보 발효`.
- 본문 (자식 한정사 ON):
  ```
  ㅇ부산앞바다(평수구역 포함)
     - 해제예정 : 5월 21일(내일) 새벽(06시~09시)
  ```
- 본문 (자식 한정사 OFF):
  ```
  ㅇ부산앞바다
     - 해제예정 : 5월 21일(내일) 06시~09시
  ```
- `해제예정` 시각: `tmYn || tmCc` (`push_sender.js:189`). 범위형이면 `formatWarnTimeKST` 가 시간대 명칭 매핑 적용 (`새벽` 등).

### 카드 표시
- weather_alerts.json: `leaf['부산앞바다'].current = { wrnTp:'V', wrnLvl:'주의보', tmFc, tmEf, tmYn:clrNtcTm, ... }`.
- 부모 카드 (`js/render.js`):
  - 뱃지: `풍랑 주의보` (status-badge warning, 빨강 #ff6b6b 계열).
  - 발표시각: `5월 20일(오늘) 18시`.
  - 발효시각: `5월 20일(오늘) 18시`.
  - 해제예정: `5월 21일(내일) 새벽(06시~09시)` (범위형은 시간대 명칭 매핑 + 괄호 보존 — § 5).
- 자식 카드: 자식이 같은 시점에 함께 발효중이면 `풍랑 주의보` 빨강 뱃지. 자식 자신의 시각 데이터(range 형이면) 발효시각 row 미표시.

### 차이점 — S-PRELIM→ACTIVE 와의 비교
- 두 시나리오 모두 출력 푸시는 `🚨 풍랑 주의보 발효` 로 동일.
- **차이는 발표시각 anchor**:
  - S-PRELIM→ACTIVE (§ 4.8) 는 직전 예비 단계의 tmFc 가 anchor (— `_applyAnnounceAnchor` 가 carry).
  - S-NONE→ACTIVE 는 현재 발효 row 의 tm_fc 가 그대로 anchor (carry 할 prev 없음).
- 즉 사용자가 보는 발표시각이 다르다 — S-PRELIM→ACTIVE 는 옛 예비 시각으로 고정되고, S-NONE→ACTIVE 는 발효 통보문 시각이 그대로 보인다.

### 관련 시행착오
- → § 6.A ("발표시각 anchor — 커밋 `451f48e`").

### 관련 코드
- `marine_warning_crawler.js:372~386` (DiffMatrix 신규 분기).
- `push_sender.js:180~193` (CURRENT_CHANGE active 분기).
- `push_helpers.js:298~301` (active 메시지).

---

## § 4.8 S-PRELIM→ACTIVE — 예비 → 정식 발효 (자연 전이)

### 트리거
이전 사이클에서 예비특보였던 zone 이 이번 사이클에 정식 발효. warn/ready 에서 사라지고 warn/list 에 등장 — KMA 가 단계를 전환한 정상 lifecycle.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'예비', tmFc:'2026.05.20 06:00', tmEf:'2026.05.20 18:00' }`.
- curr (warn/list 의 row):
  ```
  warn_lvl_nm: '주의보',
  tm_fc:       '2026.05.20 18:00',   // 발효 시점의 새 통보문 시각
  tm_yn 또는 clr_ntc_tm: '21일 06시~09시'
  ```
- curr 의 warn/ready 에서는 사라짐.

### 처리 단계
1. `_buildSnapshotFromMarine`: `curr.parents['울산앞바다'] = { wrnLvlNm:'주의보', ... }`.
2. `[7]` `_applyAnnounceAnchor`:
   - `carry(prev_예비, curr_주의보)`:
     - 종류 같음, 등급은 `_anchorLevel('예비')` vs `_anchorLevel('주의보')` 의 비교를 거치는데 예비는 정식의 전구체로 동급 취급 → carry 통과.
     - `info.tmFc = prev.tmFc` (예비 단계의 최초 발표시각 유지).
   - 또는 prev.upcomings 에 같은 예비가 있으면 그것의 tmFc 이어받기.
3. `[9]` DiffMatrix 의 특별 분기 (커밋 `5213c83`, 라인 413~):
   ```js
   if (pPrev.wrnLvlNm === '예비' && pCurr.wrnLvlNm !== '예비' && pCurr.wrnLvlNm !== '해제') {
       matrix.add('active', { parent, time: pCurr.tmYn, childState }, ...)
   }
   ```
   - 일반 격상 분기에 안 걸리는 이유: `_score` 상 예비==주의보 동률 (`LVL_RANK['예비'] === LVL_RANK['주의보'] === 2`).
4. `[10]` `_buildUserPushChanges`:
   - 두 change 가 동시에 생성:
     ```js
     { type:'UPCOMING_CHANGE', prev:{예비}, curr:null, ... }   // 예비 사라짐
     { type:'CURRENT_CHANGE',  prev:null,   curr:{주의보}, ... } // 주의보 등장
     ```
5. `pushSender.processChanges`:
   - 첫 change: `UPCOMING_CHANGE` 인데 `curr === null` → 일반적으로 별 처리 없음.
   - 두번째 change: `CURRENT_CHANGE` + `prev === null` → scenario `active`.
6. **핸드오프 보강** (`fe0bda5`): prev 가 잠시 비어서 두번째 change 의 prev 가 null 인 cycle 의 직전이 GAP 이라면, `_extensionMemory.upcoming` 으로 prev 를 복원해 "신규 발표" 오인을 차단. → § 4.28 (S-HANDOFF) 와 결합.

### Change event
S-NONE→ACTIVE 와 거의 동일하나 `_applyAnnounceAnchor` 가 작동해 `curr.tmFc` 가 예비 시점의 시각으로 고정된다.

### 푸시 메시지
- templateId: `active`.
- 제목: `🚨 풍랑 주의보 발효`.
- 본문:
  ```
  ㅇ울산앞바다(평수구역 포함)
     - 해제예정 : 5월 21일(내일) 새벽(06시~09시)
  ```
- 시간 anchor: 본문에는 해제예정만 나가고 발표시각은 안 나가므로, anchor 의 효과는 카드 표시(아래)에서 보인다.

### 카드 표시
- 부모 카드:
  - 뱃지: `풍랑 주의보` 빨강.
  - 발표시각: **`5월 20일(오늘) 06시`** ← 예비 단계의 tmFc 가 그대로 유지 (커밋 `451f48e`).
  - 발효시각: `5월 20일(오늘) 18시`.
  - 해제예정: `5월 21일(내일) 새벽(06시~09시)`.
- 자식 카드: 자식이 함께 발효 진입했으면 빨강 뱃지로 전환.

### 핵심 fix
- → § 6.HANDOFF (커밋 `fe0bda5`): "예비→발표 핸드오프 공백 보강 — 발표 오인 → 발효시각 변경". 1사이클 prev 가 비어 새 발표로 오인되던 버그를 `_extensionMemory.upcoming` 으로 prev 채워 발효시각 변경으로 보정.
- → § 6.A (커밋 `451f48e`): 발표시각 anchor 가 격상/격하 시점에 새 등급의 첫 통보문 시각으로 재설정.

### 관련 시행착오
- → § 6.GAP-SERIES (`adab23e`, `f9e4340`, `0049f2a`).
- → § 6.A (`451f48e`).
- → § 6.HANDOFF (`fe0bda5`, `a7bc5c9`).

### 관련 코드
- `marine_warning_crawler.js:413~420` (DiffMatrix 예비→정식 분기).
- `marine_warning_crawler.js:_applyAnnounceAnchor` (커밋 `451f48e`).
- `marine_warning_crawler.js:1373~1386` (`_extensionMemory` prev 복원).

---

## § 4.9 S-PRELIM-CANCEL — 예비특보 취소 (정식 발효 없이 사라짐)

### 트리거
KMA 가 예비특보를 취소. warn/ready 에서 사라졌고 warn/list 에도 등장하지 않음. warn/latest 에 cmd='해제' 같은 통보문이 있을 수 있으나 그것이 GAP 보강 대상은 아님 (발효시각이 미래여야만 GAP 으로 살아남는다).

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'예비' }` 또는 `upcomings['울산앞바다'] = {...}`.
- curr: 해당 zone 어디에도 없음 (또는 `wrnLvlNm === '해제'`).

### 처리 단계
1. `_applySuspiciousGuard` (D-medium): "예비 zone 이 사라지는 건 의심 아님" 가드 ([수정B], `_classifyReleases` 라인 1351):
   ```js
   if (info.wrnLvlNm === '예비') continue;   // 예비는 의심 분류 제외
   ```
2. `[9]` DiffMatrix:
   ```js
   if (pPrev && (!pCurr || pCurr.wrnLvlNm === '해제' || !pCurr.wrnLvlNm)) {
       if (pPrev.wrnLvlNm === '예비') matrix.add('prelim_cancel', ...)
       else                            matrix.add('release', ...)
   }
   ```
3. `[10]` `_buildUserPushChanges`: `UPCOMING_CHANGE { prev:{예비}, curr:null }`.
4. `pushSender.processChanges`:
   - `UPCOMING_CHANGE` 에 `curr === null` → 본 코드의 publish/release 분기 어디에도 안 들어감.
   - 즉, **사용자 채널은 기본적으로 취소 푸시 미발사** — yebi-push 옵션 B (커밋 `5f62ebb`) 로 별도 처리되어, 옵션 B 가 활성화된 경우만 사용자에게 알린다.

### Change event
```js
{ type:'UPCOMING_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'예비', tmFc, tmEf, ... },
  curr:null, currentActive:null, childState }
```

### 푸시 메시지
- 기본: 없음 (관리자 채널의 `prelim_cancel` 그룹은 `ADMIN_PUSH_ENABLED=false` 라 비활성).
- 옵션 B 활성 시 (`5f62ebb`):
  - templateId: `prelim_cancel`.
  - 제목: `✅ 풍랑 예비특보 해제`.
  - 본문: `ㅇ울산앞바다` (한정사 없음 — `push_helpers.js:575` `eventType === 'prelim_cancel'` 분기).

### 카드 표시
- weather_alerts.json: `leaf['울산앞바다'].upcoming` 이 제거됨.
- 부모 카드: 발효중 zone 도 없고 upcoming 도 없음 → `관심해역 특보 없음` 표시 (또는 다른 활성 zone 만 표시).

### 관련 시행착오
- → § 6.YEBI (커밋 `5f62ebb`, `dd5b1d9`, `526cc7c`, `e1077ac`, `6027f9d`, `f74c326`): 예비 해제 알림 옵션 B, 정규식 V1~V3 의 진화.
- → § 6.SUSPICIOUS-FIX ([수정B] 가드): 예비 zone 사라짐이 의심으로 분류되던 회귀.

### 관련 코드
- `marine_warning_crawler.js:393~407` (DiffMatrix prelim_cancel 분기).
- `push_helpers.js:575` (buildChildQualifier prelim_cancel 분기).

---

## § 4.10 S-RELEASE — 정식 해제

### 트리거
KMA 가 정식 발효중인 특보를 해제. warn/list 에서 해당 zone 이 사라지고, warn/latest 에 cmd='해제' + tm_ef (정확값) 가 등장 (해제 통보문 발행).

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보', clrNtcTm:'21일 06시~09시' }`.
- curr (warn/list): 해당 zone 없음.
- curr (warn/latest):
  ```
  warn_cmd_nm:  '해제',
  warn_zone_cd: 'S1131100',
  tm_ef:        '2026.05.21 06:00'   // 정확값 (실제 해제 시점)
  ```

### 처리 단계
1. `[4]` `_enrichSnapshotWithLatest`:
   - warn/latest 의 cmd='해제' 발견 → snap.parents 에 해당 zone 이 있으면 clrNtcTm 갱신. 이미 사라진 zone 은 갱신 안 함 (curr 에서 사라졌으므로 — 정상).
2. `[5]` `_applySuspiciousGuard`:
   - `_classifyReleases(prev, curr)`:
     ```js
     for ([name, info] of prev.parents) {
       if (curr.parents.has(name)) continue;
       if (info.wrnLvlNm === '예비') continue;       // 예비는 prelim_cancel
       if (info.clrNtcTm) normalReleases.push(name);
       else suspiciousZones.push(name);
     }
     ```
   - `info.clrNtcTm` 이 등록되어 있었으면 → 정상 해제 (`normalReleases`). 등록 안 되어 있었으면 → 의심 (§ 4.31).
3. `[9]` DiffMatrix:
   ```js
   if (pPrev && (!pCurr || pCurr.wrnLvlNm === '해제' || !pCurr.wrnLvlNm)) {
       if (pPrev.wrnLvlNm === '예비') matrix.add('prelim_cancel', ...);
       else                            matrix.add('release', ...);
   }
   ```
4. `[10]` `_buildUserPushChanges`: `CURRENT_CHANGE { prev:{주의보}, curr:null }`.
5. `pushSender.processChanges`:
   - `CURRENT_CHANGE` + `!curr` → scenario `release`.
   - `addToGroup(groups, 'release', '풍랑', '주의보', { zones:['울산앞바다'], childState })`.

### Change event
```js
{ type:'CURRENT_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', tmFc, tmEf, tmYn:'21일 06시~09시', ... },
  curr:null, childState }
```

### 푸시 메시지
- templateId: `release`.
- 제목: `✅ 풍랑 주의보 해제`.
- 본문 (`push_helpers.js:308`):
  ```
  ㅇ울산앞바다
  ```
- **자식 한정사 없음** — `buildChildQualifier(parent, childState, 'release') === ''` (`push_helpers.js:572`). 정책: "부모+자식 동시 해제는 부모명만, 한정사 없음 (S13)".
- 시각 라인 없음 (`TIME_LABEL_BY_EVENT.release = null` — `push_helpers.js:472`).
- 발사 대상: `release !== false` 토글 사용자. 야간 차단 적용.

### 카드 표시
- weather_alerts.json: `leaf['울산앞바다'].current` 제거됨.
- 부모 카드: zone 자체가 leaf 트리에서 사라짐. "관심해역 특보 없음" 표시 (`js/render.js:795-800`, opacity 0.6 녹색).
- 자식 카드: 모두 사라짐 (`render_coastal.js`).

### 관련 시행착오
- → § 6.V10 (커밋 `dbe2c6b`): "warn/latest 엔드포인트 추가로 정확한 해제시각 보강".
- → § 6.LATEST-BLINK (커밋 `7c981d1`): warn/latest 깜빡임 가짜 해제시각 변경 푸시 차단 (→ § 4.33).

### 관련 코드
- `marine_warning_crawler.js:393~407` (DiffMatrix release 분기).
- `marine_warning_crawler.js:2226~2235` (V10 enrich).
- `push_sender.js:193~197` (release 분기).
- `push_helpers.js:304~308` (release 메시지).

---

## § 4.11 S-PRELIM-TIMECH — 예비 발효시각 변경 (3분 디바운스)

### 트리거
이미 발표된 예비특보의 tmEf 가 KMA 측에서 변경되어 warn/ready 의 같은 row 가 다른 tmEf 로 등장.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'예비', tmEf:'20일 18시~24시' }` (또는 `upcomings`).
- `_tcConfirmed['울산앞바다|tmEf'] === '20일 18시~24시'`.
- `_efWindowEnd['울산앞바다'] === 210000` (21일 00시 키).
- curr (warn/ready 의 같은 row 가 다른 tmEf 로 등장):
  - 케이스 A: `tm_ef='20일 21시~24시'` (범위 → 좁은 범위, 같은 윈도우 안).
  - 케이스 B: `tm_ef='2026.05.20 20:00'` (범위 → 정확시각).

### 처리 단계 — 케이스 A (범위 → 좁은 범위)
1. `[8]` `_applyUpcomingEfLogic`:
   - `incKey = _timeKey('20일 21시~24시', 5) = 210000`.
   - `winEnd = _efWindowEnd['울산앞바다'] = 210000`.
   - `incKey <= winEnd` → 연장 아님 (`_efExtend` 미설정).
   - `held = prev.tmEf` (범위형) → null → 변형 없음.
   - `info.tmEf = '20일 21시~24시'`.
2. `[8]` `_debounceTimeValues`:
   - 새 후보 `'20일 21시~24시' !== _tcConfirmed`.
   - `_tcPending = { value:'20일 21시~24시', since:now }`.
   - `info.tmEf` 를 `_tcConfirmed` (옛값 `'20일 18시~24시'`) 로 되돌림 → 푸시·표출 억제.
3. 3분 후 같은 값 유지:
   - `_tcConfirmed = '20일 21시~24시'` 로 갱신.
   - `_buildUserPushChanges`: `currUpcoming.tmEf !== prevUpcoming.tmEf` → `upcomingChanged = true`. `efExtend = null` (윈도우 안).
   - push: `{ type:'UPCOMING_CHANGE', prev:{tmEf:옛범위}, curr:{tmEf:새범위} }`.
4. `pushSender`:
   - `prev.wrnLvl === curr.wrnLvl` (둘 다 '예비'), `prev.tmEf !== curr.tmEf` → scenario `time_ef_change`.

### 처리 단계 — 케이스 B (범위 → 정확시각, 같은 모멘트가 아님)
- `incoming` 이 정확시각 → `isRange = false`. `held = prev.tmEf` (범위) → null. 변형 없음. info.tmEf 정확시각 그대로.
- `_debounceTimeValues` 3분 디바운스.
- 3분 후: `_sameReleaseMoment` 체크 — 정확시각이 옛 범위의 끝과 같은 모멘트면 push 0건 (J-1b). 아니면 push 발사.

### Change event
```js
{ type:'UPCOMING_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'예비', tmEf:'20일 18시~24시', ... },
  curr:{ wrnTp:'풍랑', wrnLvl:'예비', tmEf:'20일 21시~24시', ... },
  currentActive:null, childState }
```

### 푸시 메시지
- templateId: `time_ef_change`.
- 제목: `🕐 발효시각 변경`.
- 본문 (3분 후 확정 시):
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 발효예정 : 5월 20일(오늘) 21시~24시
  ```
- 정확시각으로 결정된 경우 (`tmEf='2026.05.20 20:00'`):
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 발효예정 : 5월 20일(오늘) 20시
  ```
- 발사 대상: `announce !== false` 토글 사용자.

### 카드 표시
- 부모 카드: 발효시각 row 가 즉시 갱신 (디바운스는 푸시만 막고 표출은 그대로). 실제로는 `_tcConfirmed` 까지 푸시·표출이 같이 동기화 — 운영 정책상 푸시가 안 가면 표출도 옛값 유지.
- 자식 카드: 자식 tmEf 가 범위형이면 발효시각 row 자체 미표시 (V3.1 정책).

### 4 가지 하위 케이스 (J-1)
- **J-1a 범위 → 더 좁은 범위**: 위 케이스 A.
- **J-1b 범위 → 같은 끝의 정확시각**: `_sameReleaseMoment` 흡수 → push 0건 (J-1b).
- **J-1c 범위 → 윈도우 안의 정확시각** (모멘트 다름): push 발사 (`time_ef_change`).
- **J-1d 정확시각 → 범위** (S-LATEST-BLINK 의 특수 케이스): held(정확) 로 되돌림 → push 0건.

### 관련 시행착오
- → § 6.HOLD-SERIES (`b05ce1f` → `5ded869` → `a7bc5c9` → `7c981d1` → `eb06efe`).
- → § 6.DEBOUNCE (`eb06efe`).

### 관련 코드
- `marine_warning_crawler.js:1209~1216` (`_applyUpcomingEfLogic`).
- `marine_warning_crawler.js:_debounceTimeValues` (`eb06efe`).
- `push_sender.js:160~162` (`time_ef_change` 분기).
- `push_helpers.js:353~356` (메시지).

---

## § 4.12 S-ACTIVE-YNCH — 발효중 해제예정시각 변경

### 트리거
정식 발효중인 zone 의 `clrNtcTm` (해제예정시각) 이 KMA 측에서 변경.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 06시~09시' }`.
- `_clrWindowEnd['울산앞바다']` = 21일 09시 키.
- curr: `clrNtcTm: '21일 09시~12시'` 또는 정확시각.

### 처리 단계
거울 구조 — § 4.11 의 모든 로직이 `_applyReleaseClrLogic` / `_clrWindowEnd` / `_clrExtend` 로 미러된다.

```js
_applyReleaseClrLogic:
  _applyTimeWindowHold(prev, curr, {
    field: 'clrNtcTm', phase: 'active',
    winMap: _clrWindowEnd, flag: '_clrExtend',
    matchParent: (i) => i.wrnLvlNm 가 발효중 (예비/해제 아님),
    matchChild:  같음,
    includeUpcomings: false
  });
```

같은 3분 디바운스 적용.

### Change event
```js
{ type:'CURRENT_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', tmYn:'21일 06시~09시', clrNtcTm:'21일 06시~09시', ... },
  curr:{ wrnTp:'풍랑', wrnLvl:'주의보', tmYn:'21일 09시~12시', clrNtcTm:'21일 09시~12시', ... },
  childState }
```

### 푸시 메시지
- templateId: `time_yn_change`.
- 제목: `🕐 해제시각 변경`.
- 본문 (윈도우 안에서 더 짧아진 경우):
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 해제예정 : 5월 21일(내일) 09시~12시
  ```
- 윈도우 초과 (= 더 늦은 범위) 의 경우는 § 4.14 (S-ACTIVE-YNEXTEND) 로 분기.

### 카드 표시
- 부모 카드: 해제예정 row 갱신. 시간대 명칭 매핑 적용 (`아침(09시~12시)` 등 → § 5).

### 관련 시행착오
- → § 6.LATEST-BLINK (`7c981d1`).
- → § 6.HOLD (`b05ce1f`).
- → § 6.DEBOUNCE (`eb06efe`).
- → § 6.A7BC5C9 (`a7bc5c9` — 자식 정확시각 고정 보강).

### 관련 코드
- `marine_warning_crawler.js:1201~1208` (`_applyReleaseClrLogic`).
- `push_sender.js:258~260` (time_yn_change 분기).
- `push_helpers.js:359~362` (메시지).

---

## § 4.13 S-PRELIM-EXTEND — 예비 발효시각 연장 (범위 → 더 늦은 범위)

### 트리거
예비특보의 발효시각이 **더 늦은 범위형** 으로 변경. 단순 시각 변경이 아니라 시간이 뒤로 늘어남.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'예비', tmEf:'20일 18시~24시' }`.
  - 윈도우 끝 = 21일 00시 = 키 `210000`.
- curr: `tmEf: '21일 03시~09시'` (더 늦은 범위).
  - 새 키 = 21일 09시 = `210900`.

### 처리 단계
1. `[8]` `_applyUpcomingEfLogic`:
   ```js
   incKey  = _timeKey('21일 03시~09시', 5) = 210900;
   winEnd  = _efWindowEnd['울산앞바다']    = 210000;
   if (incKey > winEnd) {
     info._efExtend = { oldTime: prev.tmEf, newTime: '21일 03시~09시' };
     _efWindowEnd['울산앞바다'] = 210900;   // 윈도우 갱신
   }
   ```
2. `[8]` `_debounceTimeValues`: 같은 값 3분 유지될 때까지 옛값으로 되돌림.
3. 3분 후 `_buildUserPushChanges`:
   - `efExtend` 우선 분기:
     ```js
     const bothRange = _isRangeTime(oldEf) && _isRangeTime(currUpcoming.tmEf);
     if (kn > ko && sameType && sameLevel && bothRange) {
       efExtend = { oldTime, newTime };
     }
     ```
   - 또는 `cUpInfo._efExtend` 가 있어도 set.
   - push: `{ type:'EF_EXTEND', zone, oldTime, newTime, curr:{...} }`.
4. `pushSender`:
   - `addToGroup('ef_extend', '풍랑', '예비', { oldTime, newTime, zones:['울산앞바다'], childState })`.

### Change event
```js
{ type:'EF_EXTEND', zone:'울산앞바다',
  oldTime:'20일 18시~24시',
  newTime:'21일 03시~09시',
  curr:{ wrnTp:'풍랑', wrnLvl:'예비', tmEf:'21일 03시~09시', ... },
  childState }
```

### 푸시 메시지
- templateId: `ef_extend`.
- 제목: `🕐 풍랑 주의보 발효 예정시각 연장`.
- 본문 (`push_helpers.js:381~389`):
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 기존    : 5월 20일(오늘) 18시~24시
     - 변경 후 : 5월 21일(내일) 03시~09시
  ```
- 발사 대상: `announce !== false` 토글 사용자.

### 카드 표시
- 부모 카드: 발효시각 row 가 `5월 21일(내일) 03시~09시` 로 갱신.

### **중요 정책** — 정확시각으로 바뀌면 연장 아님 (`2866fe0`)
- `bothRange` 조건 — 범위→범위만 연장으로 본다.
- 범위→정확시각 또는 정확→정확 은 `time_ef_change` 로 분류 (S-PRELIM-TIMECH).
- 같은 등급일 때만 연장 (등급 다르면 격상/격하 — `b411cea` "연장 감지 등급 가드").

### 관련 시행착오
- → § 6.EXTEND (`374923d` "발효/해제 예정시각 연장 푸시 — 신규 발표 오인 방지").
- → § 6.EXTEND-RANGE (`2866fe0` "연장은 범위형→더 늦은 범위형일 때만").
- → § 6.EXTEND-EXACT (`5ded869` "발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장").
- → § 6.EXTEND-GUARD (`b411cea` "연장 감지 등급 가드 + 연장기억 upcomings").

### 관련 코드
- `marine_warning_crawler.js:1396~1425` (`_buildUserPushChanges` efExtend 분기).
- `push_helpers.js:381~389` (ef_extend 메시지).
- `push_sender.js:302~308` (ef_extend 분기).

---

## § 4.14 S-ACTIVE-YNEXTEND — 해제예정시각 연장

### 트리거
정식 발효중인 zone 의 해제예정시각이 **더 늦은 범위형** 으로 변경.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 06시~09시' }`. 윈도우 끝 = 21일 09시.
- curr: `clrNtcTm:'21일 09시~12시'` (더 늦은 범위).

### 처리 단계
거울 구조 — § 4.13 의 모든 로직이 `_applyReleaseClrLogic` 와 `ynExtend` 분기로 미러된다.

```js
_applyReleaseClrLogic:
  if (incKey > winEnd) {
    info._clrExtend = { oldTime, newTime };
    _clrWindowEnd[zone] = newKey;
  }

_buildUserPushChanges (라인 1427~1457):
  const bothRange = _isRangeTime(oldYn) && _isRangeTime(currActive.tmYn);
  if (kn > ko && sameType && sameLevel && bothRange) {
    ynExtend = { oldTime, newTime };
  }
```

### Change event
```js
{ type:'YN_EXTEND', zone:'울산앞바다',
  oldTime:'21일 06시~09시',
  newTime:'21일 09시~12시',
  curr:{ wrnTp:'풍랑', wrnLvl:'주의보', tmYn:'21일 09시~12시', clrNtcTm:'21일 09시~12시', ... },
  childState }
```

### 푸시 메시지
- templateId: `yn_extend`.
- 제목: `🕐 풍랑 주의보 해제 예정시각 연장`.
- 본문:
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 기존    : 5월 21일(내일) 06시~09시
     - 변경 후 : 5월 21일(내일) 09시~12시
  ```
- 발사 대상: `active !== false` 토글 사용자.

### 카드 표시
- 부모 카드: 해제예정 row 갱신.

### 관련 시행착오
- → § 6.EXTEND (`374923d`, `2866fe0`, `5ded869`, `b411cea`).
- → § 6.HOLD (`b05ce1f`).

### 관련 코드
- `marine_warning_crawler.js:1427~1457` (`_buildUserPushChanges` ynExtend).
- `push_helpers.js:381~389` (yn_extend 메시지).

---

## § 4.15 S-LVL-UP — 등급 격상 (주의보 → 경보)

### 트리거
같은 종류 + 같은 zone 에서 등급만 격상. 발효중에서 일어남 (예비 단계의 격상은 § 4.17).

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }`.
- curr: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }`.
- `_score(prev) = 10 + 2 = 12`, `_score(curr) = 10 + 5 = 15`.

### 처리 단계
1. `[7]` `_applyAnnounceAnchor`:
   - `carry`: `_anchorLevel('주의보') = '주의보'`, `_anchorLevel('경보') = '경보'` → 다름 → carry 안 함.
   - `info.tmFc` 는 새 등급의 첫 통보문 시각이 anchor (커밋 `451f48e`).
   - 또는 prev.upcomings 에 같은 등급 경보 예비가 있었으면 그것 이어받기 (`5213c83` 병렬 표출).
2. `[9]` DiffMatrix:
   ```js
   typeChanged = false, lvlChanged = true,
   cScore = 15, pScore = 12, isUp = true,
   phase = (pCurr.wrnLvlNm === '예비') ? 'publish' : 'active'  // 'active'
   bucket = 'level_upgrade_active'
   matrix.add(bucket, { parent, time: pCurr.tmYn, childState },
              { wrnTpNm:'풍랑', wrnLvlNm:'경보', prevWrnLvlNm:'주의보' });
   ```
3. `[10]` `_buildUserPushChanges`: `CURRENT_CHANGE` + prev/curr wrnLvl 다름.
4. `pushSender`:
   - `prev.wrnLvl !== curr.wrnLvl`, `prevScore < currScore` → scenario `level_upgrade_active`.
   - `addToGroup('level_upgrade_active', '풍랑', '경보', { zones, tmYn, prevTypeName:'풍랑', prevLevel:'주의보', childState })`.

### Change event
```js
{ type:'CURRENT_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', ... },
  curr:{ wrnTp:'풍랑', wrnLvl:'경보',   ... },
  childState }
```

### 푸시 메시지
- templateId: `level_upgrade_active`.
- 제목 (`push_helpers.js:318~322`):
  - `prevLvl = prevLevel || '주의보'`, `effectiveLevel = level` = '경보'.
  - `🚨 풍랑 주의보→경보 격상 발효`.
- 본문:
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 해제예정 : 5월 21일(내일) 09시~12시
  ```
- 발사 대상: `active !== false` 토글 사용자.

### 카드 표시
- 부모 카드:
  - 뱃지: `풍랑 경보` 빨강 (status-badge warning).
  - 발표시각: **새 등급(경보)의 첫 통보문 시각** 으로 reset (`451f48e`).
  - 발효시각: 변경 안 됨 (이미 발효중).
  - 해제예정: 갱신 가능.

### 관련 시행착오
- → § 6.A (`451f48e` 발표시각 anchor 재설정).
- → § 6.B (`5213c83` 다가오는 특보 병렬 표출 — 공존 예비 보존).
- → § 6.EXTEND-GUARD (`b411cea` 격상이 연장으로 오분류 안 되도록).

### 관련 코드
- `marine_warning_crawler.js:442~454` (DiffMatrix lvlChanged 분기).
- `push_sender.js:233~236` (level_upgrade_active scenario).
- `push_helpers.js:318~322` (메시지).

---

## § 4.16 S-LVL-DOWN — 등급 격하 (경보 → 주의보)

### 트리거
같은 종류 + 같은 zone 에서 등급만 격하. 발효중에서.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }`.
- curr: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'주의보' }`.
- `cScore = 12 < pScore = 15`, `isUp = false`.

### 처리 단계
대칭. `bucket = 'level_downgrade_active'`, push scenario `level_downgrade_active`.

### Change event
```js
{ type:'CURRENT_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'경보', ... },
  curr:{ wrnTp:'풍랑', wrnLvl:'주의보', ... },
  childState }
```

### 푸시 메시지
- templateId: `level_downgrade_active`.
- 제목 (`push_helpers.js:332~336`):
  - 사용자 채널 이모지: `🚨` (관리자 양식은 `🔻`).
  - `🚨 풍랑 경보→주의보 격하 발효`.
- 본문:
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 해제예정 : 5월 21일(내일) 09시~12시
  ```
- 발사 대상: `active !== false` 토글.

### 카드 표시
- 부모 카드: 뱃지가 `풍랑 주의보` 로 다운그레이드. 발표시각은 새 등급(주의보)의 첫 통보문 시각으로 reset (anchor 정책).

### 관련 시행착오
- → § 6.A (anchor).

### 관련 코드
- `push_sender.js:233~236`.
- `push_helpers.js:332~336`.

---

## § 4.17 S-LVL-UP-PUBLISH — 예비 단계 격상

### 트리거
**예비** 단계 안에서 등급이 격상. 예: `풍랑 주의보 예비` → `풍랑 경보 예비`.

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'예비' }` + (논리 등급 = 주의보).
- curr: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'예비' }` + (논리 등급 = 경보).
- `_score` 가 예비 단계의 등급을 어떻게 다루느냐에 따라 분기 — 일반적으로 등급은 발표시각 anchor 의 `_anchorLevel` 로 비교.

### 처리 단계
1. `[9]` DiffMatrix: 예비 → 예비 전이지만 등급이 변함 → 라인 392 ~ 의 `level_upgrade_publish` bucket.
   ```js
   typeChanged = false, lvlChanged = true (논리 등급),
   cScore > pScore,
   phase = 'publish' (curr.wrnLvlNm === '예비')
   bucket = 'level_upgrade_publish'
   ```
2. `pushSender`:
   - `UPCOMING_CHANGE` 분기 (`push_sender.js:114~143`):
     ```js
     if (!prev || (prev.wrnLvl !== curr.wrnLvl && !isPreToAdvisory)) {
         if (prev && (curScore !== newScore)) {
             scenario = curScore < newScore ? 'level_upgrade_publish' : 'level_downgrade_publish';
         } else {
             scenario = 'publish';
         }
     }
     ```

### Change event
```js
{ type:'UPCOMING_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', ... },     // 예비를 effectiveLevel 로 본
  curr:{ wrnTp:'풍랑', wrnLvl:'경보', ... },
  currentActive:null, childState }
```

### 푸시 메시지
- templateId: `level_upgrade_publish`.
- 제목 (`push_helpers.js:311~315`):
  - `📢 풍랑 주의보→경보 격상 발표`.
- 본문:
  ```
  ㅇ울산앞바다(평수구역/연안바다 미발효)
     - 발효예정 : 5월 26일(모레) 00시
  ```

### 카드 표시
- 부모 카드: 뱃지 `풍랑 예비` 그대로 (예비 단계 유지). [다가오는 특보] 헤더 본문은 `풍랑 경보 예정` 로 격상 표시.

### 관련 시행착오
- → § 6.A (anchor).
- → 실측상 드문 케이스. draft_1 § 4.4 ⚠️ 라고 표기되어 있음.

### 관련 코드
- `marine_warning_crawler.js:442~454` (DiffMatrix lvlChanged → publish phase).
- `push_sender.js:115~130`.
- `push_helpers.js:311~315`.

---

## § 4.18 S-LVL-DOWN-PUBLISH — 예비 단계 격하

### 트리거
예비 단계에서 등급 격하. 실측상 매우 드물다.

### 처리 단계
대칭 — `bucket = 'level_downgrade_publish'`, push scenario `level_downgrade_publish`.

### 푸시 메시지
- templateId: `level_downgrade_publish`.
- 제목 (`push_helpers.js:325~329`): `📢 풍랑 경보→주의보 격하 발표`.

### 관련 코드
- `push_sender.js:121~123`.
- `push_helpers.js:325~329`.

---

## § 4.19 S-TYPE-UP / S-TYPE-DOWN — 종류 변경

### 트리거
같은 zone 에서 종류(wrnTp) 가 변경. 예: 풍랑경보 → 태풍주의보 (격상), 태풍주의보 → 풍랑경보 (격하).

### MMIS 입력
- prev: `parents['울산앞바다'] = { wrnTpNm:'풍랑', wrnLvlNm:'경보' }`. `_score = 10 + 5 = 15`.
- curr: `parents['울산앞바다'] = { wrnTpNm:'태풍', wrnLvlNm:'주의보' }`. `_score = 100 + 2 = 102`.

### 처리 단계
1. `[9]` DiffMatrix:
   ```js
   typeChanged = true, cScore !== pScore,
   isUp = (cScore > pScore),
   bucket = `type_${isUp?'upgrade':'downgrade'}_${phase}`
   add(...,  prevWrnTpNm:'풍랑', prevWrnLvlNm:'경보')
   ```
2. `pushSender` (`push_sender.js:148~152`):
   - UPCOMING_CHANGE 의 typeChanged 분기:
     ```js
     const scenario = prevScore < currScore
         ? 'type_upgrade_publish' : 'type_downgrade_publish';
     ```
   - CURRENT_CHANGE 의 typeChanged 분기 (`push_sender.js:231~236`):
     ```js
     const scenario = typeChanged
         ? (prevScore < currScore ? 'type_upgrade_active' : 'type_downgrade_active')
         : ...;
     ```

### Change event
```js
{ type:'CURRENT_CHANGE', zone:'울산앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'경보', ... },
  curr:{ wrnTp:'태풍', wrnLvl:'주의보', ... },
  childState }
```

### 푸시 메시지
- templateId: `type_upgrade_active` (또는 `_publish`/`_downgrade_`).
- 제목 (`push_helpers.js:340~350`):
  - `from = prevTypeName + prevLevel` = `풍랑경보`.
  - `to = typeName + effectiveLevel` = `태풍주의보`.
  - 사용자 채널 이모지: `🚨` (active) 또는 `📢` (publish).
  - `🚨 풍랑경보→태풍주의보 격상 발효`.
- 본문:
  ```
  ㅇ울산앞바다(모든 연안바다 포함)
     - 해제예정 : 5월 21일(내일) 12시~15시
  ```

### 카드 표시
- 부모 카드: 뱃지 `태풍 주의보` 로 변경. 발표시각은 새 종류·등급의 첫 통보문 시각으로 reset (anchor).

### 관련 시행착오
- → § 6.A.

### 관련 코드
- `marine_warning_crawler.js:429~441` (DiffMatrix typeChanged 분기).
- `push_sender.js:148~152, 231~236`.
- `push_helpers.js:340~350`.

---

## § 4.20 S-CHILD-ADD — 부모 유지 + 자식만 추가 발효

### 트리거
부모 발효중 상태에서 자식 set 에 새 자식이 추가. 예: `제주도서부앞바다` 발효중인데 `가파도연안바다` 자식이 새로 발효.

### MMIS 입력
- prev: `parents['제주도서부앞바다'] = {풍랑 주의보}`, `children['제주도서부앞바다'] = Map { '제주도서부앞바다중북서연안바다' → {...} }`.
- curr: 같은 부모 + `children Map = { '제주도서부앞바다중북서연안바다' → {...}, '제주도서부앞바다중가파도연안바다' → {...} }` (추가).
- 자식 row 는 `warn-sasc/list` 에 등장.

### 처리 단계
1. `[3]` `_buildSnapshotFromMarine` (`_extractParent` 분기로 부모 zone 추출 → `children` Map 에 추가).
2. `[9]` DiffMatrix:
   ```js
   childState.added = ['제주도서부앞바다중가파도연안바다'];
   부모 unchanged && childState.added.length > 0:
     matrix.add('additional_active', { parent, time:pCurr.tmYn, childState }, ...);
   ```
3. `[10]` `_buildUserPushChanges` (라인 1497~1506):
   ```js
   if (!upcomingChanged && !activeChanged && c) {
       if (addedChildren.length > 0) {
           push { type:'CHILD_ADD', zone:'제주도서부앞바다',
                  curr: childToBlock(자식 자신의 데이터),
                  childState: { all, active, added:[...], released:[] } };
       }
   }
   ```
4. **자식 종류·등급은 부모 fallback 제거** (`f499308`): 자식 자신의 데이터로만 메시지 구성.
5. **이중 발사 방지** (Followup Major-3): 자식 set 변화 동시 발생 시 부모 시각 변경 push 억제 (`marine_warning_crawler.js:464~465`).
6. `pushSender`:
   - `CHILD_ADD` → scenario `additional_active`.
   - `addToGroup('additional_active', curr.wrnTp, curr.wrnLvl, { zones:['제주도서부앞바다'], tmYn, childState })`.

### Change event
```js
{ type:'CHILD_ADD', zone:'제주도서부앞바다',
  curr:{ wrnTp:'풍랑', wrnLvl:'주의보',
         tmEf:'2026.05.25 18:00', tmYn:'5월 26일 03시~06시', ... },
  childState:{ all:[...], active:['...북서','...가파도'], added:['...가파도'], released:[] } }
```

### 푸시 메시지
- templateId: `additional_active`.
- 제목 (`push_helpers.js:366~369`): `📢 풍랑 주의보 추가 발효`.
- 본문:
  - `buildChildQualifier('제주도서부앞바다', childState, 'additional_active')`:
    - `added = ['제주도서부앞바다중가파도연안바다']`.
    - `shown = ['가파도연안바다']` (prefix 제거 — `_stripParentPrefix`).
    - return `'(가파도연안바다 추가 발효)'`.
  - 본문:
    ```
    ㅇ제주도서부앞바다(가파도연안바다 추가 발효)
       - 해제예정 : 5월 26일(모레) 03시~06시
    ```
- **자식 토글 OFF 사용자 (`options.childZones === false`)**: `routes/push.js:346~348` 에서 `additional_active` 자체 필터링 → 미수신.
- 일반적으로 `active !== false` 토글 사용자에게도 발사. `childZones === true` 인 사용자만 실수신.

### 카드 표시
- 부모 카드: 변화 없음 (부모 발효중 유지).
- 자식 카드 (`render_coastal.js`): `가파도연안바다` 가 카드 리스트에 추가. 뱃지 `풍랑 주의보`. 발효시각이 정확값이면 row 표시, 범위형/시간대명이면 미표시 (§ 5).
- 자식 카드 정렬: 특보 있는 자식이 위로 (`js/render.js:930~936`).

### 관련 시행착오
- → § 6.F499308 (`f499308` "자식 독립 푸시 + 자식 종류·등급 부모 fallback 제거").
- → § 6.3705F4A (`3705f4a` "자식 해역 표출을 자식 개별 데이터에 기인").
- → § 6.MAJOR3 (Followup Major-3 — 자식 set 변화 동시 시각 변경 push 억제).

### 관련 코드
- `marine_warning_crawler.js:519~524` (DiffMatrix additional_active).
- `marine_warning_crawler.js:1497~1506` (사용자 CHILD_ADD).
- `push_sender.js:280~283` (additional_active 분기).
- `push_helpers.js:366~369` (메시지).
- `push_helpers.js:601~607` (buildChildQualifier additional_active).
- `routes/push.js:346~348` (childZones 필터).

---

## § 4.21 S-CHILD-RELEASE — 부모 유지 + 자식 일부 해제

### 트리거
부모 발효중 + 자식 일부가 해제. warn-sasc/list 에서 해당 자식이 사라지고 warn-sasc/latest 에 cmd='해제' 통보문이 있음.

### MMIS 입력
- prev: `children['제주도서부앞바다'] = Map { 자식A, 자식B, 자식C }`.
- curr: `children['제주도서부앞바다'] = Map { 자식A, 자식B }` (자식C 사라짐).
- curr (warn-sasc/latest): 자식C 의 cmd='해제' 통보문 있음.

### 처리 단계
1. `[4]` `_enrichSnapshotWithLatest`:
   ```js
   for row in warnSascLatest:
     if (row.warn_cmd_nm === '해제') {
       _childReleaseNoticeSet.add(자식C fullName);
     }
   ```
2. `[6]` `_applyChildReleaseDebounce(prev, curr)`:
   - 자식C 가 `_childReleaseNoticeSet` 에 있음 → 디바운스 면제, 즉시 해제로 처리.
   - `delete _childReleasePending[key]`.
3. `[9]` DiffMatrix:
   ```js
   childState.released = ['제주도서부앞바다중자식C'];
   부모 unchanged && childState.released.length > 0:
     matrix.add('partial_release', { parent, time:pCurr.tmYn, childState }, ...);
   ```
4. `[10]` `_buildUserPushChanges`:
   ```js
   if (!upcomingChanged && !activeChanged && c) {
       if (releasedChildren.length > 0) {
           push { type:'CHILD_RELEASE', zone:'제주도서부앞바다',
                  prev: childToBlock(prev 의 자식C),
                  childState: { ..., released:['...자식C'], allReleased } };
       }
   }
   ```
5. `pushSender`:
   - `CHILD_RELEASE` → scenario `partial_release`.

### Change event
```js
{ type:'CHILD_RELEASE', zone:'제주도서부앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', ... },
  childState:{ all:[...], active:[자식A, 자식B], released:[자식C], allReleased:false } }
```

### 푸시 메시지
- templateId: `partial_release`.
- 제목 (`push_helpers.js:373~377`): `✅ 풍랑 주의보 일부 해제`.
- 본문:
  - `buildChildQualifier(parent, childState, 'partial_release')` (`push_helpers.js:578~587`):
    - `released = ['제주도서부앞바다중자식C']`.
    - `released.length === all.length` 인가? 아니라면:
    - return `'(자식C 만 해제)'`.
  - 본문:
    ```
    ㅇ제주도서부앞바다(가파도연안바다만 해제)
    ```
- 시각 라인 없음 (`TIME_LABEL_BY_EVENT.partial_release = null`).
- **자식 토글 OFF 사용자**: 미수신.

### 카드 표시
- 부모 카드: 변화 없음.
- 자식 카드: 자식C 카드가 사라짐. `_writeWeatherAlertsJson` 가 즉시 갱신.

### 관련 시행착오
- → § 6.F499308.
- → § 6.CHILD-DEBOUNCE (`9d47ed3` — 자식 해제 디바운스).

### 관련 코드
- `marine_warning_crawler.js:526~531` (DiffMatrix partial_release).
- `marine_warning_crawler.js:1508~1515` (사용자 CHILD_RELEASE).
- `push_sender.js:290~292` (partial_release 분기).
- `push_helpers.js:373~377` (메시지).
- `push_helpers.js:578~587` (buildChildQualifier partial_release).

---

## § 4.22 S-CHILD-FULLRELEASE — 모든 자식 한꺼번에 해제 (부모 유지)

### 트리거
부모는 발효중인데 모든 자식이 한꺼번에 해제. 일반적으론 부모도 해제되어야 일관성 있지만, 자식만 먼저 해제되는 케이스가 KMA 실측에 존재.

### MMIS 입력
- prev: `children['제주도서부앞바다'] = Map { 자식A, 자식B, 자식C }` (all = 3).
- curr: `children['제주도서부앞바다'] = Map {}` (모두 사라짐).
- curr (warn-sasc/latest): 각 자식의 cmd='해제' 모두 있음.

### 처리 단계
1. `_applyChildReleaseDebounce`: 모든 자식이 `_childReleaseNoticeSet` 에 있음 → 디바운스 면제, 즉시 해제.
2. DiffMatrix:
   ```js
   childState.released = [자식A, 자식B, 자식C];
   childState.allReleased = true;   // 또는 released.length === all.length 로 계산
   matrix.add('partial_release', ...);
   ```
3. `_buildUserPushChanges`: `CHILD_RELEASE` 1건 (zone 단위).

### Change event
```js
{ type:'CHILD_RELEASE', zone:'제주도서부앞바다',
  prev:{ wrnTp:'풍랑', wrnLvl:'주의보', ... },
  childState:{ all:[자식A,B,C], active:[], released:[자식A,B,C], allReleased:true } }
```

### 푸시 메시지
- templateId: `partial_release`.
- 제목: `✅ 풍랑 주의보 일부 해제`.
- 본문:
  - `buildChildQualifier`:
    ```js
    if (safe.allReleased || released.length === all.length && all.length > 0) {
        return `(모든 ${label} 해제)`;
    }
    ```
  - 본문:
    ```
    ㅇ제주도서부앞바다(모든 연안바다 해제)
    ```

### 카드 표시
- 부모 카드: 변화 없음 (부모 발효중 유지).
- 자식 카드: 모두 사라짐.

### 관련 코드
- `push_helpers.js:579~581` (buildChildQualifier allReleased 분기).

---

## § 4.23 S-CHILD-BLINK — 자식 깜빡임 (3분 디바운스)

### 트리거
자식이 데이터에서 일시 사라졌다 다시 등장. warn-sasc/latest 에 해제 통보문이 **없는** 채로 사라지는 글리치.

### MMIS 입력
- prev: `children['제주도서부앞바다'] = Map { 자식A, 자식B }`.
- T 사이클 curr: `children = Map { 자식A }` (자식B 사라짐).
- 자식B 의 해제 통보문 없음 (warn-sasc/latest 에 cmd='해제' 없음).
- T+1~T+2 사이클 동안 같은 상태.
- T+3 사이클: 자식B 가 복귀 (글리치 확정).

### 처리 단계 (`_applyChildReleaseDebounce`, 라인 976~1026)
1. T 사이클:
   ```js
   for each (parent, prevKids, childName) in prev.children:
     if curr 에 같은 자식 있음 → skip;
     else:    // 자식B 사라짐
       if (_childReleaseNoticeSet.has(자식B)) {
         delete _childReleasePending[key];
         log('자식 정상 해제(해제예고 있음): ...');
         → 즉시 해제로 처리 (carry 안 함);
       } else {
         if (!_childReleasePending[key]) {
           _childReleasePending[key] = { firstMissingAt: now };
           log('자식 해제 디바운스 시작: ... 3분 관찰');
         }
         elapsed = now - firstMissingAt;
         if (elapsed < 3min) {
           curr.children.get(parent).set(자식B, prevInfo);   // carry
         } else {
           log('자식 해제 확정(디바운스 3분 경과, 해제예고 없음)');
           delete _childReleasePending[key];
         }
       }
   ```
2. T+1 ~ T+2: 같은 carry 반복. push 0건.
3. T+3 사이클 자식B 가 curr 에 다시 등장 → "stillPending" 에 없으므로:
   ```js
   delete _childReleasePending[key];
   elapsedSec = ...;
   log('자식 깜빡임 감지(글리치), X초 만에 복귀, 가짜 해제 억제됨');
   ```
4. 3분 경과 후에도 안 돌아오면: § 4.21 (S-CHILD-RELEASE) 의 정상 분기로 진입.

### Change event
글리치 흡수 케이스: change 발생 안 함 (carry 로 인해 prev 와 curr 가 같아짐).

### 푸시 메시지
**없음** (디바운스 안에서 흡수).

### 카드 표시
- 자식 카드: 변화 없음 (carry 덕분에 사용자는 사라짐을 인지하지 못함).

### 관련 시행착오
- → § 6.CHILD-DEBOUNCE (커밋 `9d47ed3` "자식 해제 디바운스 3분 — 해제예고 없는 소멸 글리치 차단 + 관찰 로그").

### 관련 코드
- `marine_warning_crawler.js:976~1026` (`_applyChildReleaseDebounce`).
- `marine_warning_crawler.js:_childReleaseNoticeSet` (J-6 의 정밀 의미).

---

## § 4.24 S-CHILD-EXTEND — 자식 단독 시각 연장

### 트리거
부모는 시각 변화 없음 + 자식 일부만 tmEf 또는 clrNtcTm 가 **더 늦은 범위형** 으로 변경.

### MMIS 입력
- prev: 부모 unchanged. `children` 의 자식A: `tmEf='20일 18시~24시'`.
- curr: 부모 unchanged. 자식A: `tmEf='21일 03시~09시'` (더 늦은 범위).

### 처리 단계 (`_buildUserPushChanges`, 라인 1517~1551)
```js
for cn in currChildren:
  if !prevChildren.includes(cn) continue;
  pi = childInfoOf(prev, zone, cn);
  ci = childInfoOf(curr, zone, cn);
  if pi.wrnLvlNm !== ci.wrnLvlNm continue;        // 등급 변하면 연장 아님
  isUp = (ci.wrnLvlNm === '예비');
  oldT = isUp ? pi.tmEf : (pi.clrNtcTm || pi.tmYn);
  newT = isUp ? ci.tmEf : (ci.clrNtcTm || ci.tmYn);
  조건: range→range, kn > ko, sameType, sameLevel;
  bucket = isUp ? efKids : ynKids;
  key = oldT + '||' + newT;                        // 같은 (기존,변경후) 쌍 묶음
  bucket[key].names.push(cn);

각 그룹별 push:
  { type:'CHILD_EF_EXTEND' or 'CHILD_YN_EXTEND',
    zone, curr:childToBlock(ci),
    oldTime:g.oldTime, newTime:g.newTime,
    childState: { all, active, extended:g.names } };
```

### Change event
```js
{ type:'CHILD_EF_EXTEND', zone:'제주도서부앞바다',
  curr:{ wrnTp:'풍랑', wrnLvl:'예비',
         tmEf:'21일 03시~09시', ... },
  oldTime:'20일 18시~24시',
  newTime:'21일 03시~09시',
  childState:{ all:[...], active:[...], extended:['제주도서부앞바다중가파도연안바다'] } }
```

### 푸시 메시지
- `pushSender`:
  - `CHILD_EF_EXTEND` → `addToGroup('ef_extend', ...)` (부모 단독 연장과 같은 scenario, 단 childState.extended 가 있음).
  - `CHILD_YN_EXTEND` → `addToGroup('yn_extend', ...)`.
- templateId: `ef_extend` / `yn_extend`.
- 제목: `🕐 풍랑 주의보 발효 예정시각 연장` / `🕐 풍랑 주의보 해제 예정시각 연장`.
- `buildChildQualifier` 의 `ef_extend|yn_extend` + `childState.extended` 분기 (`push_helpers.js:592~598`):
  ```js
  if (extended.length > 0) {
    const shown = extended.map(c => _stripParentPrefix(parent, c));
    return `(${shown.join(', ')})`;
  }
  ```
- 본문 (자식 단독 연장):
  ```
  ㅇ제주도서부앞바다(가파도연안바다)
     - 기존    : 5월 20일(오늘) 18시~24시
     - 변경 후 : 5월 21일(내일) 03시~09시
  ```
- **자식 토글 OFF 사용자**: 부모명만 나가면 오해 가능 → 미수신 (`push_helpers.js:372~378`):
  ```js
  items.filter(it => !(it.childState
                       && Array.isArray(it.childState.extended)
                       && it.childState.extended.length > 0));
  ```

### 카드 표시
- 자식 카드: 자식A 의 발효시각 row 갱신 (정확값이면 표시, 범위형이면 미표시 — § 5).

### 관련 시행착오
- → § 6.CHILD-EXTEND (커밋 `7821092` "자식 단독 연장 푸시 — 부모와 동일하게 독립 감지/발송").

### 관련 코드
- `marine_warning_crawler.js:1517~1551` (자식 단독 연장 efKids/ynKids).
- `push_helpers.js:592~598` (buildChildQualifier extended).
- `push_helpers.js:372~378` (자식 토글 OFF 필터).

---

## § 4.25 S-CHILD-TIMECH — 자식만 시각 변경 (부모 불변)

### 트리거
부모 tmEf/clrNtcTm 변화 없음 + 자식 어느 하나의 tmEf 또는 tmYn 만 변경 (연장 아닌 단순 시각 변경).

### MMIS 입력
- prev: 부모 unchanged. 자식A: `tmEf='2026.05.25 18:00'`.
- curr: 부모 unchanged. 자식A: `tmEf='2026.05.25 21:00'` (윈도우 안의 정확시각 변경).

### 처리 단계 (DiffMatrix.compute, 라인 484~)
```js
childTimeChanged = [...];           // 변경된 자식 목록
childEfChanged   = Set { 자식A };
childYnChanged   = Set { };

if (pPrev.tmEf === pCurr.tmEf && childEfChanged && !setChanged) {
    cs = Object.assign({}, childState, {
        parentTimeUnchanged: true,
        timeChanged: childTimeChanged.slice()
    });
    matrix.add('time_ef_change', { ..., childState: cs }, {...});
}
```

(자식 set 변화 동시 발생 시 시각 변경 push 억제 — Major-3 정책)

### Change event
```js
{ type:'UPCOMING_CHANGE' or 'CURRENT_CHANGE',
  zone, prev, curr,    // prev/curr 부모는 동일
  childState:{ all, active, parentTimeUnchanged:true, timeChanged:[자식A] } }
```

### 푸시 메시지
- templateId: `time_ef_change` (또는 `time_yn_change`).
- 제목: `🕐 발효시각 변경` / `🕐 해제시각 변경`.
- `buildChildQualifier` 의 `time_ef_change|time_yn_change` + `parentTimeUnchanged === true` + `active.length > 0` 분기 (`push_helpers.js:622~626`):
  ```js
  return `(${label}만 시각 변경)`;
  ```
- 본문:
  ```
  ㅇ제주도서부앞바다(연안바다만 시각 변경)
     - 발효예정 : 5월 25일(오늘) 21시
  ```

### 카드 표시
- 부모 카드: 자체 시각 row 는 변화 없음.
- 자식 카드: 자식A 의 발효시각 row 갱신.

### 관련 시행착오
- → § 6.CRIT2 (커밋 `95047ad` "자식 시각 변경 분기 Critical-2").

### 관련 코드
- `marine_warning_crawler.js:484~515` (DiffMatrix 자식만 시각 변경).
- `push_helpers.js:622~626` (buildChildQualifier parentTimeUnchanged).

---

## § 4.26 S-GAP-PARENT — 발표 발효대기 (warn/latest 만 보유)

### 트리거
KMA 가 발표 통보문은 발행했으나 발효시각이 미래라 warn/list·warn/ready 에는 없는 상태. warn/latest 에만 cmd='발표' (또는 '변경','연장') + tm_ef (미래 정확시각) 가 있음. 발효 전 공백 시간대.

### MMIS 입력
- warn/list, warn/ready: 해당 zone 없음.
- warn/latest 의 row:
  ```
  warn_zone_cd: 'S1131100',
  warn_cmd_nm:  '발표',
  warn_tp:      'V',
  tm_ef:        '2026.05.21 18:00'    // 미래 정확시각 (현재는 21일 12시)
  ```

### 처리 단계 (`_enrichSnapshotWithLatest`, 라인 2238~2296)
```js
for row in warnLatest:
  if (cmd !== '해제' && _isTargetRealtimeType(warn_tp)) {
    if (_isFutureExactTime(tm_ef)) {
      info.wrnLvlNm = '예비';                       // 발효 전 → 예비 취급
      snap.parents.set(name, info);                  // GAP 부모 보강
      gapAdded++;
      if (!snap.children.get(name)) {
        if (prev.children.get(name) 자식 있음) {
          snap.children.set(name, prev.children.get(name));   // prev carry
        } else {
          // PARENT_TO_CHILDREN 매핑으로 합성 (synth)
          for c in PARENT_TO_CHILDREN[name]:
            snap.children.get(name).set(c, 부모 상속 info);
        }
      }
    }
  }
```

이후:
- `_buildUserPushChanges` 가 이 새 예비를 정상 예비로 인지.
- prev 가 비어있으면 → `UPCOMING_CHANGE { prev:null, curr:{예비} }` → publish push.
- prev 에 같은 종류·동급 예비가 있었으면 → `time_ef_change`.

### Change event
일반적으로 `UPCOMING_CHANGE` 와 동일 (S-NONE→PRELIM 또는 S-PRELIM-TIMECH).

### 푸시 메시지
- prev 가 비어있을 때 (전혀 새로운 발표대기): `publish` 메시지 (S-NONE→PRELIM 과 동일).
- prev 에 예비가 있었던 핸드오프 케이스: `time_ef_change` 또는 `ef_extend` (§ 4.28 S-HANDOFF 와 결합).

### 카드 표시
- 부모 카드: `풍랑 예비` 뱃지 + 발효예정 `5월 21일(내일) 18시`.
- 자식 카드:
  - prev carry 케이스: 직전 예비 단계의 자식들이 그대로 보존.
  - synth 케이스: PARENT_TO_CHILDREN 매핑으로 합성된 모든 자식들이 표시.

**중요**: GAP 보강 이전엔 발표 후 발효 전까지 사용자 앱에 아무것도 안 보였다. 사용자는 GAP 동안에도 "발효예정 6월 2일 12시" 가 정확하게 보이게 됨.

### 관련 시행착오
- → § 6.V10 (커밋 `dbe2c6b` "warn/latest 엔드포인트 추가").
- → § 6.GAP (커밋 `2a21b9c` "발표 발효대기 GAP 누락 보강 — warn/latest 에서 예비로 추가").
- → § 6.GAP-SYNTH (커밋 `f9e4340` "GAP 발표대기 자식 합성 fallback").
- → § 6.GAP-COMBO (커밋 `adab23e` "예비→발표 단체전이 GAP 복합버그 4건 수정").
- → § 6.GAP-CHILD-EXT (커밋 `5a9e111` "GAP 보강을 자식해역까지 확장").

### 관련 코드
- `marine_warning_crawler.js:2238~2296` (`_enrichSnapshotWithLatest` 부모 GAP).
- `marine_warning_crawler.js:_isFutureExactTime`.
- `marine_warning_crawler.js:PARENT_TO_CHILDREN` (자식 합성 매핑).

---

## § 4.27 S-GAP-CHILD — 발표 발효대기 자식 (warn-sasc/latest 개별 통보문)

### 트리거
자식 단독으로 발표 통보문이 났으나 발효 전. warn-sasc/latest 에 자식 row 가 cmd='발표' + 미래 정확 tm_ef 로 등장.

### MMIS 입력
- warn-sasc/list, warn-sasc/ready: 해당 자식 없음.
- warn-sasc/latest:
  ```
  warn_zone_cd: '...자식코드...',
  warn_cmd_nm:  '발표',
  tm_ef:        '2026.05.21 18:00'    // 미래
  ```
- 부모는 발효중일 수도, 발효예정일 수도, 무특보일 수도.

### 처리 단계 (`_enrichSnapshotWithLatest`, 라인 2161~2213, 커밋 `0049f2a`)
```js
_childReleaseNoticeSet 채움 (cmd='해제' 인 자식만 — 디바운스 면제 신호).

for row in warnSascLatest:
  if (cmd === '해제') { (위에서 처리) }
  if (cmd in ['발표','변경','연장'] && _isFutureExactTime(tm_ef)) {
    이미 snap.children 에 있으면 → 자식 개별 clrNtcTm 보강만;
    없으면 → snap.children.set 으로 추가 (wrnLvlNm='예비');
  }
```

### Change event
일반적으로 `CHILD_ADD` 와 유사. 부모는 변화 없는데 자식 set 에 새 자식이 추가된 모양.

### 푸시 메시지
- 부모 변화 없음 + 자식 추가 → `additional_active` 메시지 (S-CHILD-ADD 동일).
- 단 자식의 등급이 '예비' 이므로 `effectiveLevel` 보정이 적용.

### 카드 표시
- 자식 카드: 새 자식이 카드 리스트에 추가. 뱃지 `풍랑 예비` (`render_coastal.js`).

### 관련 시행착오
- → § 6.SASC-LATEST (커밋 `0049f2a` "GAP 자식을 warn-sasc/latest 개별 통보문으로 정확히 표출").

### 관련 코드
- `marine_warning_crawler.js:2161~2213` (warn-sasc/latest 자식 GAP).

---

## § 4.28 S-HANDOFF — 예비→발표 1사이클 prev 공백

### 트리거
KMA 가 예비특보를 거두고 (1사이클 공백) 발표 통보문을 새로 등록하는 핸드오프. 우리 prev 가 1사이클 비어 "신규 발표" 로 오인 위험.

### MMIS 입력
- T-1 사이클: warn/ready 에 예비 zone 있음, prev 에 저장.
- T 사이클: warn/ready 에 사라짐 (KMA 가 발표대기로 인계). warn/list 에도 아직 없음. warn/latest 의 cmd='발표' tm_ef 미래 → GAP 으로 예비 재등장.
- 우리 prev (메모리상) 가 비어있음 — `_buildUserPushChanges` 에서 prevUpcoming === null.

### 처리 단계 (`_buildUserPushChanges`, 라인 1376~1386)
```js
const EXTENSION_BRIDGE_MS = 5 * 60 * 1000;    // 5분

if (!prevUpcoming && currUpcoming) {
    mem = _extensionMemory[zone].upcoming;
    if (mem
        && mem.wrnTpNm === currUpcoming.wrnTp
        && (Date.now() - mem.lastSeenAt) < EXTENSION_BRIDGE_MS) {
        prevUpcoming = {
            wrnTp:  mem.wrnTpNm,
            wrnLvl: mem.wrnLvlNm,
            tmFc:   mem.tmFc,
            tmEf:   mem.tmEf,
            tmYn:   mem.clrNtcTm
        };
    }
}
```

이후 정상 비교:
- `prev.tmEf vs curr.tmEf` 가 다르면 → `time_ef_change`.
- `prev.tmEf vs curr.tmEf` 가 같고 다른 필드만 다르면 → `blockEqual=true` → push 없음.

**발표시각 anchor 도 동일 패턴** (`_applyAnnounceAnchor`, 라인 1059~):
- `mem` 에 tmFc 있으면 그것으로 `info.tmFc` 고정 → 발표시각이 새로 갱신되어 `🕐 발효시각 변경` 이 `📢 발표` 로 오인되지 않게 함.

### Change event
- 정상 비교 후: `time_ef_change` 또는 `ef_extend` 또는 push 없음.

### 푸시 메시지
- `time_ef_change` → `🕐 발효시각 변경`.
- 더 늦으면 `ef_extend` → `🕐 풍랑 주의보 발효 예정시각 연장`.
- 핵심: **`📢 풍랑 주의보 발표` 가 잘못 한 번 더 나가지 않는다.**

### 카드 표시
- 부모 카드: 예비 단계 유지 (정확값 anchor 덕분에 발표시각이 흔들리지 않음).

### `_extensionMemory` 의 구조 (J-5)
```
_extensionMemory[zone] = {
  active:   { wrnTpNm, wrnLvlNm, tmFc, tmEf, clrNtcTm, lastSeenAt },
  upcoming: { 같은 필드 ... }
}
```
- 만료 정책: `now - lastSeenAt > 6h` 면 삭제.
- 기록 시점: `_updateExtensionMemory(curr)` — `_buildUserPushChanges` 이후, `_savePrevSnapshot` 직전.
- 용도: 핸드오프 공백 보강 / null gap 연장 판정 / 발표시각 anchor fallback.

### 관련 시행착오
- → § 6.HANDOFF (커밋 `fe0bda5` "예비→발표 핸드오프 공백 보강 — 발표 오인 → 발효시각 변경").
- → § 6.HANDOFF-CHILD (커밋 `a7bc5c9` "정확시각 고정 보강 — 핸드오프 공백(#1) + 자식 해역(#2)").

### 관련 코드
- `marine_warning_crawler.js:1373~1386` (`_buildUserPushChanges` mem 보강).
- `marine_warning_crawler.js:1059~1066` (`_applyAnnounceAnchor` mem fallback).
- `marine_warning_crawler.js:_updateExtensionMemory`.

---

## § 4.29 S-PARALLEL — 발효 + 공존 예비 병렬 표출

### 트리거
같은 zone 에 발효중인 특보 + 같은 종류·다른 등급의 예비특보가 동시 존재. 예: 풍랑 주의보 발효중 + 풍랑 경보 예비 (다음 단계 예고).

### MMIS 입력
- warn/list: `'울산앞바다'` 풍랑 주의보.
- warn/ready: 같은 zone 의 풍랑 경보 예비.

### 처리 단계 (`_buildSnapshotFromMarine`, 라인 2110~)
```js
// 발효중 (snap.parents.set 으로 먼저 등록)
warn/list 처리: snap.parents.set('울산앞바다', { wrnLvlNm:'주의보', ... });

// warn/ready 처리 시 — parents 덮어쓰지 않고 upcomings 에 분리
warn/ready 처리:
  if (snap.parents.has(name)) {
    if (!snap.upcomings.has(name)) {
      snap.upcomings.set(name, _rowToParentInfo(row));
    }
    continue;       // ← 핵심: parents 는 보존
  }
```

표출 (`_buildZoneTreeFromSnapshot`, 라인 1872~):
```js
leaf.current  = { 풍랑 주의보 };
leaf.upcoming = { 풍랑 경보 예비 };
```
→ 사용자 앱 한 zone 에 발효 + 예고 모두 노출.

diff 처리:
- `_buildUserPushChanges` 의 `getUp`/`getAct` 가 parents 와 upcomings 양쪽에서 추출:
  - `cUp = curr.upcomings.get(zone) || curr.parents.get(zone)` (예비일 경우).
  - `cAct = curr.parents.get(zone)` (예비 아닐 때).
- `upcomingChanged`, `activeChanged` 모두 독립 발사 가능.

### Change event
독립 두 건 가능:
```js
// 새 예비 등장
{ type:'UPCOMING_CHANGE', zone:'울산앞바다',
  prev: null, curr:{ 풍랑 경보 예비 }, currentActive:{ 풍랑 주의보 } }
// 발효중은 그대로
```

### 푸시 메시지
- 새 예비 등장 시 → `publish` 또는 `level_upgrade_publish` (현재 활성 등급 대비).
- 본문:
  ```
  📢 풍랑 경보 발표
  ㅇ울산앞바다(모든 연안바다 포함)
     - 발효예정 : 5월 26일(모레) 00시
  ```

### 카드 표시
- 부모 카드:
  - 뱃지: 빨강 `풍랑 주의보` (현재 발효).
  - [다가오는 특보] 헤더: `풍랑 경보 예정` (예비 → 주의보/경보 치환).
  - 상세에 두 row 분리: 현재 발효 (`풍랑 주의보`) + 다가오는 특보 (`풍랑 경보 예정`).

격상/격하 발효 시 직전 공존 예비의 `tmFc` 인계 → 새 발효 등급에서도 발표시각이 끊김 없이 표시됨.

### 관련 시행착오
- → § 6.B (커밋 `5213c83` "다가오는 특보 병렬 표출 (B) — 발효+예비 공존 보존").

### 관련 코드
- `marine_warning_crawler.js:2107~2113` (`_buildSnapshotFromMarine` upcomings 분기).
- `marine_warning_crawler.js:1872~1879` (`_buildZoneTreeFromSnapshot` 병렬 표출).

---

## § 4.30 S-PARTIAL-FAIL — endpoint 부분 실패 (E-4 가드)

### 트리거
`fetchAllRealtimeEndpoints()` 의 4 endpoint (warn/list · warn/ready · warn-sasc/list · warn-sasc/ready) 중 하나라도 HTTP 4xx/5xx/timeout/network error 로 실패.

### MMIS 입력
- 4 endpoint 중 1~3개가 정상 응답, 나머지는 실패.

### 처리 단계
`marine_client.js`:
```js
async function fetchAllRealtimeEndpoints() {
    const results = await Promise.allSettled([...4 calls]);
    const failed = results.filter(r => r.status === 'rejected');
    if (failed.length > 0) {
        const err = new Error(`marine endpoint 부분 실패: ${failed.map(...).join(', ')}`);
        err.partial = true;
        err.failedEndpoints = failed.map(...);
        throw err;
    }
    return results.map(r => r.value);
}
```

`marine_warning_crawler.js:run()` 라인 2398~:
```js
try {
    fetched = await marineClient.fetchAllRealtimeEndpoints();
} catch (err) {
    console.warn('[Marine] endpoint 부분 실패 — cycle skip (이번 1분 발사 0):', err.message);
    return [];      // ← 본 cycle 통째로 skip
}
```

결과:
- prev snapshot 그대로 유지 → 다음 cycle 도 같은 prev 로 diff.
- push 0건, state 갱신 0건.
- **마지막 성공 state 유지 → release 폭주 방지** (의심 가드의 외부 layer).

### Change event
없음.

### 푸시 메시지
없음.

### 카드 표시
변화 없음 (`_writeWeatherAlertsJson` 도 호출 안 됨).

### 관련 시행착오
- → § 6.E (커밋 `baf34fa` "E-1/E-2/E-4 운영 안전성 보강").
- E-4 = 4 endpoint 묶음 호출 + 부분 실패 시 throw.

### 관련 코드
- `marine_client.js:fetchAllRealtimeEndpoints`.
- `marine_warning_crawler.js:2397~2404` (catch block).

---

## § 4.31 S-SUSPICIOUS — mmis 빈 응답 의심 (D-medium 가드)

### 트리거
prev 에 발효중 zone 이 있는데 curr 에서 3개 이상 zone 이 동시 사라짐 + 사라진 zone 들에 `clr_ntc_tm` 등록이 없음 (해제예고 없는 소멸). MMIS 가 일부 응답을 빠뜨렸을 가능성 (의심).

### MMIS 입력
- prev: `parents` 에 5개 zone — 그중 4개가 `clr_ntc_tm = ''` (미등록).
- curr: `parents` 에 1개 zone 만 (등록된 zone 만 남음). 즉 미등록 4개 zone 이 동시에 사라짐.

### 처리 단계 (`_applySuspiciousGuard`)
1. `_classifyReleases(prev, curr)`:
   ```js
   for ([name, info] of prev.parents) {
     if (curr.parents.has(name)) continue;
     if (info.wrnLvlNm === '예비') continue;    // [수정B] 예비는 의심 아님
     if (info.clrNtcTm) normalReleases.push(name);
     else suspiciousZones.push(name);
   }
   // suspiciousZones.length = 4 ≥ SUSPICIOUS_THRESHOLD(3) → 의심 가동
   ```
2. currentCase 관리:
   ```js
   if (!currentCase) {
       currentCase = { id, firstSeenAt, zones, cycleCount:1, lastPushAt:now, decisionPending:true };
       _enqueueSuspiciousAlert(currentCase);    // 관리자 1차 push (현재 비활성)
   } else {
       cycleCount++;
       if (10분 경과) { lastPushAt 갱신 + 재 push; }
   }
   ```
3. 의심 zone 을 curr 에 복원 (release push 발사 차단):
   ```js
   curr.parents.set(name, prev.info);
   curr.children.set(name, prev.kids);
   curr.upcomings.set(name, prev.upcomings);    // 공존 예비도 복원
   ```
4. 회복 시: `suspiciousZones.length < THRESHOLD` → 자동 reset, history 에 `auto-reset` 기록.
5. 관리자 결정 (admin endpoint):
   - `decideSuspiciousCase('normal', decidedBy)`: history 기록 + `_pendingImmediateRelease` 등록 + 즉시 release push 발사.
   - `decideSuspiciousCase('invalid', decidedBy)`: currentCase 유지, lastPushAt 만 갱신 (10분 카운터 reset).

### Change event
- 의심 동안: release change 없음 (복원되어 prev/curr 동일).
- 결정 시: `_pendingImmediateRelease` 가 release change 를 즉시 발사 (J-7 의 의미).

### 푸시 메시지
- 사용자 채널: 결정 후 release push 발사 (S-RELEASE 와 동일 메시지).
- 관리자 채널 (`ADMIN_PUSH_ENABLED=false` 라 현재 비활성): D-medium 의심 알림 + 결정 UI.

### 카드 표시
- 의심 동안: 사용자 앱은 평소처럼 발효중으로 표시 (복원 덕분).
- 결정 후: 정상 해제 흐름.

### 디스크 영속화
- `data/marine_suspicious_state.json` (재배포 후에도 currentCase 보존).

### 관련 시행착오
- → § 6.D-MEDIUM (커밋 `c761225` "Must-fix fmtTime dot 패턴 + D-medium 의심 가드 (옵션 C)").
- → § 6.D-MEDIUM-UI (커밋 `8998037` "D-medium 인터랙티브 결정 + 통합관리자센터 UI 정리").
- → § 6.D-MEDIUM-DEDUP (커밋 `abf8c57` "D-medium 의심 사례 reinforce push silent dedup 차단").
- → § 6.SUSPICIOUS-RECOVER (커밋 `b411cea` "의심가드 복원").

### 관련 코드
- `marine_warning_crawler.js:_applySuspiciousGuard`.
- `marine_warning_crawler.js:_classifyReleases`.
- `marine_warning_crawler.js:_enqueueImmediateRelease` (J-7).

---

## § 4.32 S-MM58 — KMA 범위코드 (분=58/59) 인식

### 트리거
KMA 의 6시간 블록 인코딩이 분=58 또는 59 로 표기됨. 예: `tm_ef='2026.06.01 05:58'` → 분=58 → 사실은 "00시~06시" 범위.

### MMIS 입력
- row 의 시각 필드가 `mm===58` 또는 `mm===59` 인 모든 형식:
  - `202606010558` (12자리 raw).
  - `2026.06.01 05:58` (점·대시).
  - `06월 01일 05시 58분` (한글).

### 처리 단계 (`normalizeMmisTime`, `formatWarningTime`, `formatWarnTimeKST`)
```js
// 정규식 매치 후
hh, mm 추출;
if (mm === 58 || mm === 59) {
    timeStr = (hh >= 18) ? '18시~24시'
            : (hh >= 12) ? '12시~18시'
            : (hh >=  9) ? '09시~12시'
            : (hh >=  6) ? '06시~09시'
            : '00시~06시';      // hh < 6 (예: 5시)
}
```

각 함수의 보강 단계:
- `normalizeMmisTime` (mmis 진입 직후 정규화) → `'2026년 06월 01일 00시~06시'`.
- `formatWarningTime` (앱 카드 표출).
- `formatWarnTimeKST` (푸시 본문).
- 모두 동일 분기로 통일.

### Change event
정규화된 값으로 변환되어 일반 시나리오 흐름.

### 푸시 메시지
일반 시나리오의 본문에 "06월 01일 00시~06시" 형식으로 표출.

### 카드 표시
부모 카드/자식 카드 모두 "범위형" 으로 인지되어 동일한 6시간 블록 표시.

### 단계적 fix 의 4단계 (커밋 별)
| 단계 | 입력 형식 | 출력 | 커밋 |
|---|---|---|---|
| 1차 | `202606010558` (12자리 raw) | `00시~06시` | (기반) |
| 2차 | `2026.06.01 05:58` (점·대시) | `00시~06시` | `8a9a798` |
| 3차 | `06월 01일 05시 58분` (한글) | `00시~06시` | `b786ece` (utils + push_helpers) |
| 4차 | `normalizeMmisTime` 단계 | `2026년 06월 01일 00시~06시` | `b786ece` |

**왜 4단계나?** `normalizeMmisTime` 이 점·대시 → 한글 변환을 먼저 하면 다운스트림(formatWarningTime/formatWarnTimeKST) 의 12자리/점·대시 분기를 거치지 않고 한글 분기로 직행 → mm=58 그대로 남아 `05시 58분` 으로 표출되던 회귀. `b786ece` 가 모든 단계에서 방어 깊이 확보.

### 관련 시행착오
- → § 6.MM58-DOT (커밋 `8a9a798`).
- → § 6.MM58-KOR (커밋 `b786ece` 한글 + normalize).

### 관련 코드
- `marine_warning_crawler.js:normalizeMmisTime`.
- `services/utils.js:formatWarningTime`.
- `services/push_helpers.js:formatWarnTimeKST`.

---

## § 4.33 S-LATEST-BLINK — warn/latest 깜빡임 가짜 푸시 차단

### 트리거
warn/list 의 zone clrNtcTm 이 범위형. warn/latest 가 같은 zone 의 cmd='해제' 정확값을 줘서 enrich 가 clrNtcTm 을 정확값으로 갱신. 다음 cycle 에 warn/latest 가 깜빡여 cmd='해제' 가 사라짐 → enrich 가 갱신 안 함 → list 의 범위값으로 복귀할 위험.

### MMIS 입력
- prev: `clrNtcTm = '2026.05.21 09:00'` (정확값 hold 중).
- curr (warn/list): `clrNtcTm = '21일 06시~09시'` (range — latest 가 사라져 list 값으로 복귀).

### 처리 단계 (`_applyReleaseClrLogic` + `_applyTimeWindowHold`)
```js
held = prev.clrNtcTm (정확값);
isRange(held) === false → held 값 유지;
incoming = curr.clrNtcTm = '21일 06시~09시' (range);
win = _clrWindowEnd[zone];    // 21일 09시 키
incKey = _timeKey(incoming, 5) = 21일 09시 키;
incKey <= win → 연장 아님;

if (held && isRange(incoming)) {
    info.clrNtcTm = held;     // ← 정확값으로 되돌림
}
```

→ curr.clrNtcTm = prev.clrNtcTm → `blockEqual === true` → upcomingChanged/activeChanged = false → push 0건.

### 추가 안전망 — `_sameReleaseMoment` (`blockEqual` 의 확장)
```js
function _sameReleaseMoment(a, b) {
    // '범위형 끝 시각' 과 '정확시각' 이 같은 모멘트면 같은 것으로 본다.
    // 예: '26일 21시~24시' 의 끝 24시 = '27일 00시' → 같은 모멘트
    ka = _timeKey(a, 5);    // 범위 끝 사용
    kb = _timeKey(b, 5);
    return ka === kb;
}
```

`blockEqual` 에서:
```js
const blockEqual = (a.tmYn === b.tmYn || _sameReleaseMoment(a.tmYn, b.tmYn));
```
조건으로 흡수.

### Change event
없음 (blockEqual 흡수).

### 푸시 메시지
**없음** (정확값 hold + sameReleaseMoment 가 가짜 변경 차단).

### 카드 표시
- 부모 카드: 해제예정 row 가 정확값 (`5월 21일 09시`) 으로 유지 — MMIS 가 깜빡거려도 흔들리지 않는다.

### 관련 시행착오
- → § 6.LATEST-BLINK (커밋 `7c981d1` "warn/latest 깜빡임에 의한 가짜 해제시각변경 푸시 차단").
- → § 6.HOLD-EF (커밋 `5ded869` "발효시각도 정확값 고정+같은모멘트 무푸시+범위초과 연장").
- → § 6.EXTEND-RANGE (커밋 `2866fe0` "연장은 범위형→더 늦은 범위형일 때만").

### 관련 코드
- `marine_warning_crawler.js:_applyReleaseClrLogic`.
- `marine_warning_crawler.js:_applyTimeWindowHold` (`a7bc5c9` 의 통합 헬퍼).
- `marine_warning_crawler.js:_sameReleaseMoment`.

---

## § 4.34 S-DEBOUNCE-VIBRATE — 시각값 진동 디바운스 차단

### 트리거
KMA 가 같은 필드를 짧은 시간 안에 다른 값들로 흔들어 보냄. 또는 MMIS 가 5분+ 공백 후 옛값으로 복귀.

### MMIS 입력
시각값 진동 패턴:
- T-2 cycle: `clrNtcTm = A`.
- T-1 cycle: `clrNtcTm = B`.
- T   cycle: `clrNtcTm = A` 다시.

### 처리 단계 (`_debounceTimeValues`)
```js
_tcConfirmed[zone|field] = A;   // 확정값

// T-1 cycle:
cur = B;
if (B !== _tcConfirmed) {
    _tcPending = { value: B, since: T-1 };
    info.field = _tcConfirmed;      // 되돌림
    // 연장 플래그도 제거
}

// T cycle:
cur = A;
if (A === _tcConfirmed) {
    delete _tcPending;              // pending 취소
    info.field = A;                 // 그대로
    // blockEqual 통과 → push 0건
}
```

### 진동이 멈추고 새 값 B 가 3분 유지되는 경우 (정상 변경)
```js
// T+3min:
cur = B;
if (cur === pending.value && (now - pending.since) >= 3min) {
    _tcConfirmed = B;
    info.field = B;
    // 변경 push 발사 (time_ef_change / time_yn_change / ef_extend / yn_extend)
}
```

### Change event
- 진동 흡수: 없음.
- 3분 후 확정: 일반 시각 변경 change.

### 푸시 메시지
- 진동 동안: 없음.
- 3분 후 확정: 일반 시각 변경 메시지 (`🕐 발효시각 변경` 등).

### 카드 표시
- 진동 동안: 옛값 유지.
- 확정 후: 새값으로 갱신.

### 관련 시행착오
- → § 6.DEBOUNCE (커밋 `eb06efe` "발효/해제 예정시각 변경 3분 디바운스 — 잔여 진동 푸시 차단").

### 관련 코드
- `marine_warning_crawler.js:_debounceTimeValues`.
- `marine_warning_crawler.js:_tcConfirmed`, `_tcPending`.

---

## § 4.35 시나리오 간 상호작용 정리

본 절은 위 시나리오들이 같은 사이클에 동시 발생할 때의 우선순위/충돌 해소를 정리한다.

### § 4.35.1 자식 set 변화 + 부모 시각 변화 동시 발생 (J-4)

```
prev:
  parents['제주도서부앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 06~09시' }
  children['제주도서부앞바다'] = Map { 자식A }

curr:
  parents['제주도서부앞바다'] = { wrnLvlNm:'주의보', clrNtcTm:'21일 09~12시' }   ← 시각 변화
  children['제주도서부앞바다'] = Map { 자식A, 자식B }                            ← 자식B 추가

DiffMatrix.compute:
  setChanged = (childState.added.length > 0 || childState.released.length > 0) = true;
  if (pPrev.clrNtcTm !== pCurr.clrNtcTm && !setChanged):
      matrix.add('time_yn_change', ...);    ← skip (setChanged=true)

  if (childState.added.length > 0):
      matrix.add('additional_active', { parent, time:pCurr.tmYn, childState }, ...);
      ← 이 push 의 time 으로 새 clrNtcTm 도 자연스럽게 전달
```

→ 시각 변경 push 는 발사 안 함. 추가 발효 push 1건으로 통합. 사용자가 추가 발효 push 메시지에서 새 해제예정 시각을 함께 확인.

**[Followup Major-3]** 자식 set 변화 동시 발생 시 시각 변경 push 억제. 사용자가 같은 부모에 대해 2건의 푸시를 받지 않게 함.

### § 4.35.2 격상 + 자식 추가 동시 발생

격상 분기가 우선. 자식 추가는 격상 메시지에 한정사로 포함되어 표현 (`(가파도연안바다 포함)` 등).

### § 4.35.3 연장 + 등급 변경 동시 발생

`b411cea` "연장 감지 등급 가드": 등급 다르면 연장 분기에 들어가지 않음 (격상/격하 분기 우선). 등급 변경이 연장으로 오분류되지 않도록.

### § 4.35.4 발효 진입 + 자식 추가 동시 발생 (S-PRELIM→ACTIVE + S-CHILD-ADD)

발효 진입 분기 (active) 가 우선. 자식 추가는 한정사로 포함.

### § 4.35.5 의심 가드 + 일부 정상 해제 혼재

`_classifyReleases` 가 `normalReleases` 와 `suspiciousZones` 를 분리. 정상 해제는 release push 발사, 의심은 보류.

### § 4.35.6 디바운스 + 연장 동시 발생

`_debounceTimeValues` 가 연장 플래그(`_efExtend`/`_clrExtend`) 도 임시 제거. 3분 후 확정 시 연장 플래그도 다시 set 되어 정상 연장 push 발사.

---

## § 4.36 푸시 라우팅 흐름 (각 시나리오 공통)

본 절은 어떤 시나리오의 change 가 발생하든 `pushSender.processChanges` → `/api/push-custom` → FCM 까지의 공통 라우팅을 정리.

### § 4.36.1 그룹핑 (push_sender.js:addToGroup)

```js
function addToGroup(groups, templateId, typeName, level, itemData) {
    const key = `${templateId}_${typeName}_${level}`;
    if (!groups[key]) {
        groups[key] = { templateId, typeName, level, items: [] };
    }
    groups[key].items.push(itemData);
}
```

→ 같은 templateId × 종류 × 등급 의 변화는 한 푸시로 묶임.

### § 4.36.2 메시지 생성

`push_helpers.generateMessage(filteredPayload)` 가 templateId 별로 분기:
- `publish`, `active`, `release`.
- `level_upgrade_publish`, `level_upgrade_active`, `level_downgrade_publish`, `level_downgrade_active`.
- `type_upgrade_publish`, `type_upgrade_active`, `type_downgrade_publish`, `type_downgrade_active`.
- `time_ef_change`, `time_yn_change`.
- `ef_extend`, `yn_extend`.
- `additional_active`, `partial_release`.
- `prelim_cancel` (옵션 B 활성 시).

→ § 5 (사용자 표출) 에서 자세히.

### § 4.36.3 사용자 필터 (`routes/push.js`)

```
master: false → 전체 차단
night:  false + KST 23~07시 → 차단
announce: false → publish/level_upgrade_publish/level_downgrade_publish/time_ef_change/ef_extend 차단
active:   false → active/level_upgrade_active/level_downgrade_active/time_yn_change/additional_active/yn_extend 차단
release:  false → release/partial_release 차단
childZones: false → additional_active/partial_release/자식 단독 ef_extend/yn_extend 차단
```

→ § 5.토글 매트릭스 표.

### § 4.36.4 발송 + retry

- `sendToApi(payload, adminToken)` 가 FCM 호출.
- 실패 시 `failedPayloads.push({payload, key, failedAt})` → `loadPendingPushes()` 와 머지 (최대 20건).
- 다음 cycle 에 changes=[] 이면 `retryPendingPushes()` 호출.
- 24시간 경과 시 폐기 (J-8).

### § 4.36.5 발송 결과 → history

`history` 파일 (`data/marine_push_history.json`) 에 시각·templateId·zones·result 기록. 관리자 페이지에서 조회.

→ § 7 (현재 상태) 에서 자세히.

---

## § 4.37 시나리오별 코드 라인 인덱스

(부록 K 의 사본 — 다른 § 에서 참조하기 쉽도록 본 § 안에 보관.)

| 시나리오 | 파일 | 라인 |
|---|---|---|
| S-COLD | marine_warning_crawler.js | 2434~2443 (E-1 가드) |
| S-COLD-ACTIVE | 동일 | 2434~2443 |
| S-COLD-EMPTY | 동일 | 2434~2443 |
| S-BASELINE | marine_warning_crawler.js | 2365~2374 (resetState), 2433~2448 (force) |
| S-BROADCAST | routes/admin.js | reset endpoint (broadcastAll 분기) |
| S-NONE→PRELIM | marine_warning_crawler.js | 2100~2118 (warn/ready 분기) |
| S-NONE→ACTIVE | marine_warning_crawler.js | 372~386 (DiffMatrix 신규 분기) |
| S-PRELIM→ACTIVE | marine_warning_crawler.js | 409~420 (DiffMatrix 예비→정식) + 1059~1066 (anchor) |
| S-PRELIM-CANCEL | marine_warning_crawler.js | 393~407 (DiffMatrix prelim_cancel) |
| S-RELEASE | marine_warning_crawler.js | 393~407 + 2226~2235 (V10 enrich) |
| S-PRELIM-TIMECH | marine_warning_crawler.js | 1209~1216 (_applyUpcomingEfLogic) |
| S-ACTIVE-YNCH | marine_warning_crawler.js | 1201~1208 (_applyReleaseClrLogic) |
| S-PRELIM-EXTEND | marine_warning_crawler.js | 1396~1425 (efExtend) |
| S-ACTIVE-YNEXTEND | marine_warning_crawler.js | 1427~1457 (ynExtend) |
| S-LVL-UP | marine_warning_crawler.js | 442~454 (lvlChanged) + push_sender.js:233~236 |
| S-LVL-DOWN | 동일 | |
| S-LVL-UP-PUBLISH | marine_warning_crawler.js | 442~454 + push_sender.js:115~130 |
| S-LVL-DOWN-PUBLISH | 동일 | |
| S-TYPE-UP / DOWN | marine_warning_crawler.js | 429~441 + push_sender.js:148~152, 231~236 |
| S-CHILD-ADD | marine_warning_crawler.js | 519~524 (DiffMatrix) + 1498~1507 (CHILD_ADD) |
| S-CHILD-RELEASE | marine_warning_crawler.js | 526~531 + 1508~1515 (CHILD_RELEASE) |
| S-CHILD-FULLRELEASE | marine_warning_crawler.js | 365~369 (allReleased) + push_helpers.js:579~581 |
| S-CHILD-BLINK | marine_warning_crawler.js | 976~1026 (_applyChildReleaseDebounce) |
| S-CHILD-EXTEND | marine_warning_crawler.js | 1517~1551 (efKids/ynKids) + push_helpers.js:592~598 |
| S-CHILD-TIMECH | marine_warning_crawler.js | 484~515 + push_helpers.js:622~626 |
| S-GAP-PARENT | marine_warning_crawler.js | 2238~2296 |
| S-GAP-CHILD | marine_warning_crawler.js | 2161~2213 |
| S-HANDOFF | marine_warning_crawler.js | 1373~1386 + 1059~1066 |
| S-PARALLEL | marine_warning_crawler.js | 2107~2113 + 1872~1879 |
| S-PARTIAL-FAIL | marine_client.js:fetchAllRealtimeEndpoints + marine_warning_crawler.js:2397~2404 |
| S-SUSPICIOUS | marine_warning_crawler.js | _applySuspiciousGuard + _classifyReleases + _enqueueImmediateRelease |
| S-MM58 | marine_warning_crawler.js:normalizeMmisTime + utils.js:formatWarningTime + push_helpers.js:formatWarnTimeKST |
| S-LATEST-BLINK | marine_warning_crawler.js | _applyReleaseClrLogic + _applyTimeWindowHold + _sameReleaseMoment |
| S-DEBOUNCE-VIBRATE | marine_warning_crawler.js | _debounceTimeValues |

---

## § 4.38 cross-link 종합표

본 절은 § 4 의 각 시나리오가 다른 § 의 어디로 연결되는지를 한눈에 볼 수 있게 정리.

| 시나리오 | § 2/§ 3 가드 | § 5 표출 | § 6 시행착오 (대표 커밋) |
|---|---|---|---|
| S-COLD | E-1 가드 | 콜드부팅 후 첫 polling | `baf34fa`, `6df054a` |
| S-COLD-ACTIVE | E-1 가드 | 즉시 표출 | `6df054a` |
| S-COLD-EMPTY | E-1 가드 | 특보 없음 표시 | — |
| S-BASELINE | E-1 우회 | publish/active 메시지 | `5ea305b`, `6ba1a95`, `0f2d419`, `ec57794`, `c94ea5e` |
| S-BROADCAST | adminToken 무시 | 전체 사용자 발송 | `c94ea5e` |
| S-NONE→PRELIM | 정규화 (`_normLvlNm`) | 예비 뱃지 + 발효예정 | `ff1fe17`, `1870784` |
| S-NONE→ACTIVE | DiffMatrix 신규 | 발효 뱃지 + 해제예정 | — |
| S-PRELIM→ACTIVE | `_applyAnnounceAnchor` | 발표시각 anchor 유지 | `451f48e`, `fe0bda5` |
| S-PRELIM-CANCEL | [수정B] 의심 가드 제외 | upcoming 사라짐 | `5f62ebb`, `dd5b1d9` |
| S-RELEASE | D-medium 통과 | "관심해역 특보 없음" | `dbe2c6b`, `7c981d1` |
| S-PRELIM-TIMECH | 3분 디바운스 | 발효시각 row 갱신 | `eb06efe`, `b05ce1f`, `5ded869` |
| S-ACTIVE-YNCH | 3분 디바운스 | 해제예정 row 갱신 | `7c981d1`, `eb06efe`, `a7bc5c9` |
| S-PRELIM-EXTEND | 윈도우 확장 | 발효시각 row 갱신 | `374923d`, `2866fe0`, `5ded869`, `b411cea` |
| S-ACTIVE-YNEXTEND | 윈도우 확장 | 해제예정 row 갱신 | `374923d`, `b05ce1f` |
| S-LVL-UP / DOWN | anchor 재설정 | 뱃지 색상 변경 | `451f48e`, `5213c83`, `b411cea` |
| S-LVL-UP-PUBLISH | anchor | [다가오는] 헤더 격상 | `451f48e`, `5213c83` |
| S-LVL-DOWN-PUBLISH | anchor | — | — |
| S-TYPE-UP / DOWN | DiffMatrix typeChanged | 뱃지 종류 변경 | — |
| S-CHILD-ADD | childToBlock, 부모 fallback 제거 | 자식 카드 추가 + 정렬 | `f499308`, `3705f4a`, Major-3 |
| S-CHILD-RELEASE | `_childReleaseNoticeSet` 면제 | 자식 카드 제거 | `f499308`, `9d47ed3` |
| S-CHILD-FULLRELEASE | allReleased | "모든 연안바다 해제" | — |
| S-CHILD-BLINK | 3분 carry | 표출 변화 없음 | `9d47ed3` |
| S-CHILD-EXTEND | 자식 efKids/ynKids | 자식 시각 row 갱신 | `7821092` |
| S-CHILD-TIMECH | parentTimeUnchanged | 자식 시각 row 갱신 | `95047ad` |
| S-GAP-PARENT | `_isFutureExactTime` + prev carry/synth | 예비 뱃지 + 자식 표시 | `dbe2c6b`, `2a21b9c`, `f9e4340`, `adab23e`, `5a9e111` |
| S-GAP-CHILD | warn-sasc/latest 개별 | 자식 카드 추가 | `0049f2a` |
| S-HANDOFF | `_extensionMemory` (5분) | 발표시각 흔들림 차단 | `fe0bda5`, `a7bc5c9` |
| S-PARALLEL | upcomings Map 분리 | 발효 + [다가오는] 동시 | `5213c83` |
| S-PARTIAL-FAIL | E-4 cycle skip | 변화 없음 | `baf34fa` |
| S-SUSPICIOUS | D-medium + currentCase | 발효 유지 (복원) | `c761225`, `8998037`, `abf8c57`, `b411cea` |
| S-MM58 | normalizeMmisTime + formatters | "00시~06시" 등 6시간 블록 | `8a9a798`, `b786ece` |
| S-LATEST-BLINK | `_sameReleaseMoment` + held | 정확값 유지 | `7c981d1`, `5ded869`, `2866fe0` |
| S-DEBOUNCE-VIBRATE | `_tcConfirmed`/`_tcPending` | 옛값 유지 (확정 전) | `eb06efe` |

---

## § 4.39 본 § 의 한계와 cross-link 정책

본 § 은 "시나리오 카탈로그" 라는 명확한 책임 분담을 갖는다. 다음 사항들은 **본 § 에서 의도적으로 다루지 않는다** — 다른 § 에서 다룬다.

1. **시각 표시 포맷의 일반 규칙** (월·상대일자·시간대 명칭·범위 보정) — § 5. 본 § 의 푸시 본문 예시에 등장하는 `5월 20일(오늘) 18시~24시` 같은 텍스트의 변환 규칙은 § 5 에서 자세히.
2. **자식 카드 정책** (`isCoastal` 분기, detail box, 클릭 비활성, 폴리곤) — § 5.
3. **푸시 도착 상세 팝업** (`fix_popup_logic.js`) — § 5.
4. **부모 카드 뱃지 색상 / opacity / [다가오는 특보] 헤더** 의 상세 규칙 — § 5.
5. **사용자 토글의 정책적 결정** (왜 `childZones` 기본 ON?, 왜 야간 23시?) — § 6.
6. **각 fix 의 시간순 흐름** (Phase 0 → Phase 1 → Phase 2 → … → 현재) — § 6.
7. **현재 운영중인 흐름 요약** — § 7.
8. **알려진 edge case** (EC-1~EC-10) — § 7.
9. **`StateSnapshot` / `DiffMatrix.buckets` / `Changes` / `childState` 의 자료구조 상세** — § 8 (부록).
10. **디버깅 가이드** (로그 키워드, admin endpoint, 한 cycle 따라가기) — § 8.

본 § 의 entry 가 위 항목을 언급할 때는 **반드시 cross-link** 만 한다 (예: "→ § 5.토글 매트릭스", "→ § 6.HANDOFF (커밋 `fe0bda5`)").

이로써 시나리오 카탈로그는 단일 권위 source 로 유지되고, 다른 § 들은 시나리오에 의존할 때 본 § 의 ID 를 인용한다.

---

## § 4.40 절 마무리

본 § 4 는 34 개의 표준 시나리오와 § 4.35 의 상호작용 규칙으로 SEAGNAL × KMA MMIS 통합의 모든 lifecycle 동작을 단일 권위적으로 정의했다. 각 시나리오는 트리거·MMIS 입력·처리 단계·change event·푸시 메시지·카드 표시의 6 슬롯 표준 포맷을 따랐고, 모든 측면이 한 entry 안에 묶여 있어 cross-link 없이도 한 시나리오를 통째로 이해할 수 있다.

다음 § 5 (사용자 표출) 에서는 본 § 의 시나리오들이 사용자에게 어떤 모양의 카드·팝업·푸시 텍스트로 보여지는지를 일반 규칙(formatter, 토글, 야간 차단, 자식 카드 정책) 의 관점에서 정리한다. § 6 (시행착오 timeline) 에서는 본 § 에서 cross-link 한 각 fix 가 어떤 순서로, 어떤 동기로, 어떤 회귀를 거쳐 현재 모양에 도달했는지를 시간순으로 풀어낸다.
# § 5. 사용자 표출

> 본 절은 **SEAGNAL 사용자가 실제로 무엇을 보는가** 를 권위적으로 정리한다.
> 사용자가 부딪치는 표출 출구는 5개이며, 모두 같은 `formatWarningTime` 골격을
> 통과하되 푸시 메시지만 "상대일자 라벨 미사용" 으로 의도적으로 갈라진다.
> 5개 출구 각각의 데이터 소스 → 변환 사슬 → 최종 텍스트를 끝까지 따라간다.

---

## 5.1 사용자가 보는 5개 표출 출구

SEAGNAL 의 사용자 인터페이스에서 특보 정보가 노출되는 출구는 다음 5개다.

| 출구 | 코드 위치 | 핵심 함수 | 데이터 소스 | 상대일자 라벨 |
|---|---|---|---|---|
| ① 부모 카드 (해역별 특보현황 아코디언) | `js/render.js:725~893` | `renderMainCard` / `formatAlertTime` | `weather_alerts.json` 의 `current` zone tree | ✔ 사용 |
| ② 자식 카드 (연안바다·평수구역, 부모 아래 펼쳐짐) | `js/render_coastal.js:241~480` | `createCoastalElement` / `stripYearMonth` | 부모 zone tree 의 `children` 슬롯 | ✔ 사용 |
| ③ 푸시 트레이 알림 (FCM/WebPush 본문) | `services/push_helpers.js:34~91` | `formatWarnTimeKST` (`fmtUserKMA` 옛 명칭) | `change.curr` (StateSnapshot 의 zone leaf) | ✘ **미사용** |
| ④ 푸시 도착 상세 팝업 (앱 내) | `fix_popup_logic.js` | `formatDateTime` → `window.formatWarningTime` | 푸시 `data.url` 의 쿼리스트링 | ✔ 사용 |
| ⑤ 지도 폴리곤 클릭 박스 | `js/ocean_warn_active5.js` 의 `_renderAlertBlock` / `_showChildBox` | `_fmtTime` → `formatWarningTime` 위임 | 동일 zone tree | ✔ 사용 |

### 5.1.1 변환 사슬 — MMIS row → 사용자 텍스트

각 출구의 데이터가 어디서 와서 어떻게 변환되는지를 5 줄로 압축하면:

```
MMIS endpoint (warn/list, warn/ready, warn-sasc/list, warn-sasc/ready, warn/latest, warn-sasc/latest)
  ↓ marine_client.js : Promise.allSettled + _unwrap (envelope 흡수)
  ↓ marine_warning_crawler.js : normalizeMmisTime (mm=58/59 / 점·대시 / 범위형 → 한글)
  ↓ _buildSnapshotFromMarine + _enrichSnapshotWithLatest + _applyAnnounceAnchor + _applyTimeWindowHold + _debounceTimeValues
  ↓ DiffMatrix.compute (prev vs curr) → 16 bucket
  ↓ ① 카드 출력 : weather_alerts.json 영속 → render.js / render_coastal.js → formatWarningTime
  ↓ ③ 푸시 출력 : _buildUserPushChanges → push_sender.processChanges → /api/push-custom → generateMessage → formatWarnTimeKST
```

핵심: **같은 raw 시각 문자열** (예: `"2026.06.01 05:58"`) 이 **다섯 출구 모두에서 같은 결과** (`"00시~06시"`) 로 보이도록 4 단계의 변환 (서버 normalize + 프론트 format + 푸시 format + 한글 경로 보강) 모두에 동일 정책이 적용되어 있다 (§ 6.16 참조).

### 5.1.2 같은 푸시 — 5 출구에서 보이는 모습

같은 한 사이클에 발사된 푸시 (예: 풍랑주의보 발효 진입) 가 각 출구에서 어떻게 보이는지:

```
① 부모 카드 (앱 내)
   🔴 풍랑 주의보  [발효 중]
   발표시각  5월 25일(오늘) 11시
   발효시각  5월 25일(오늘) 18시
   해제예정  5월 26일(내일) 03시~06시

② 자식 카드 (부모 아코디언 안)
   ● 북서연안바다   🔴 풍랑 주의보
     발표시각  5월 25일(오늘) 11시
     (발효시각 줄 자체 미표시 — 범위형이라 isExactSingleTime false)
     해제예정  5월 26일(내일) 03시~06시

③ 푸시 트레이
   🚨 풍랑 주의보 발효
   ㅇ제주도서부앞바다(모든 연안바다 포함)
      - 해제예정 : 5월 26일 03시~06시
   ← (오늘) (내일) 같은 상대일자 라벨이 없음을 주목

④ 푸시 도착 상세 팝업 (③번 푸시를 탭한 직후)
   풍랑 주의보 발효
   대상해역  제주도서부앞바다
   발표시각  5월 25일(오늘) 11시   ← 상대일자 라벨 복원
   발효시각  5월 25일(오늘) 18시
   해제예정  5월 26일(내일) 03시~06시

⑤ 지도 박스 (제주도서부앞바다 폴리곤 클릭)
   풍랑 주의보
   발효시각  5월 25일(오늘) 18시
   해제예정  5월 26일(내일) 03시~06시
   ▶ 북서연안바다(자식) — 풍랑 주의보  해제예정 5월 26일(내일) 03시~06시
```

라벨 차이는 ③ 출구만 의도적으로 다르다 (이유는 § 5.10).

---

## 5.2 부모 카드 (`js/render.js:725~893`)

### 5.2.1 줄별 구성

부모 카드는 두 영역으로 나뉜다.

**상단 헤더 (`render.js:725~801`):**
- 좌측: 부모 zone 이름 (예: `제주도서부앞바다`)
- 우측: 뱃지 1~N개
  - 발효중 있음 → 빨강 뱃지 1개 (`풍랑 주의보`)
  - 발효중 없음 + 예비 있음 → 주황 뱃지 (`풍랑 예비`)
  - 둘 다 없음 → 녹색 옅은 뱃지 (`관심해역 특보 없음`, opacity 0.6)
- 발효 + 다가오는 예비 공존 시 [다가오는 특보] 헤더 추가 (5213c83, B 시나리오)

**하단 상세 영역 (`render.js:854~895`):**
다음 3 row 가 등장. 행 라벨은 회색(`#8b949e`), 값은 화이트(`#e6edf3`) 단, 해제예정만 녹색(`#69f0ae`).

```
발표시각   formatAlertTime(alert.tmFc)
발효시각   formatAlertTime(alert.tmEf)
해제예정   formatAlertTime(rawRelease) || '정보 없음'
            where rawRelease = (alert.tmCc || alert.tmYn || alert.tmEd).trim()
            condition: length > 2 && !== '일'
```

`formatAlertTime` 은 `formatWarningTime(timeStr)` 의 wrapper (`render.js:848~852`).

### 5.2.2 발효중 + 다가오는 특보 병렬 (5213c83)

```html
🔴 풍랑 주의보
발표시각  5월 25일(오늘) 11시
발효시각  5월 25일(오늘) 18시
해제예정  5월 26일(내일) 03시~06시
-----  [다가오는 특보] 풍랑 경보 예정  ← idx > 0 일 때만 헤더 표시
발표시각  5월 25일(오늘) 16시
발효시각  5월 26일(내일) 00시
해제예정  5월 26일(내일) 12시
```

`render.js:863~879` 의 `[다가오는 특보]` 헤더는 `idx === 0` 일 땐 생략, `idx > 0` 일 때만 출력. 이유: 발효 없이 다가오는 특보만 있는 경우 헤더 없이 단순 예비 카드로 표출.

### 5.2.3 발표시각 anchor 효과 (451f48e)

발표시각 row 의 가장 큰 정책은 "한 특보의 생애주기 동안 **최초 발표시각으로 고정**". 통보문이 변경/연장 통보문으로 갱신될 때마다 `tmFc` 가 새 값으로 덮어써지지 않는다.

- 풍랑주의보 발효 후 시각 변경 5회 → 발표시각 row 는 **최초 발표시각 1개만** 표시
- 격상/격하/종류 변경 시점에만 새 등급의 발표시각으로 재설정

구현: `_applyAnnounceAnchor(prev, curr)` (`marine_warning_crawler.js`) 가 직전 cycle 에 같은 종류·동급(예비는 정식의 전구체로 동급 취급) 이 있으면 그 `tmFc` 를 이어받음. 한계: 콜드스타트로 예비를 못 본 채 발효부터 관측하면 그때 tmFc 가 앵커 (best-effort).

### 5.2.4 뱃지 색상 정책

| 상태 | 라벨 | 색상 | 코드 |
|---|---|---|---|
| 발효중 (warn_lvl_nm = 주의보) | `풍랑 주의보` | 빨강 `#ff6b6b` | `render.js:780~795` |
| 발효중 (warn_lvl_nm = 경보) | `풍랑 경보` | 진한 빨강 `#d32f2f` | 동일 |
| 예비 (발표대기 또는 순수 예비) | `풍랑 예비` | 주황 `#ffb74d` | `render.js:761~776` |
| 특보 없음 | `관심해역 특보 없음` | 옅은 녹색 (opacity 0.6) | `render.js:795~800` |

### 5.2.5 보정 — API 파싱 오류 방어 (`render.js:734~749`)

같은 데이터의 중복 해석이 들어왔을 때:

```js
if (publishEntry && currentInView) {
    if (pubLvl.includes('예비') && !curLvl.includes('경보')) {
        if (publishEntry.tmFc === currentInView.tmFc) {
            currentInView = null;   // 같은 데이터의 중복 해석으로 보고 제거
        }
    }
}
```

발표시각이 같은 발효+예비 쌍은 같은 통보문의 중복 해석이라고 판단 → 발효 측을 제거. (단 발효가 경보면 정상 격상 시나리오이므로 제거 안 함.)

### 5.2.6 자식 한정 메타 ("연안바다 포함" / "미발효")

부모 카드의 줄에는 들어가지 않으나, 같은 부모를 가리키는 **푸시 메시지** 의 부모명 뒤 괄호로는 (`(모든 연안바다 포함)` / `(연안바다 미발효)` / `(가파도연안바다만 해제)`) 가 붙는다. `buildChildQualifier` (`push_helpers.js:557`) 의 출력이며, 부모 카드 자체는 별도 자식 카드 영역으로 자식 정보를 분리해 표현한다.

---

## 5.3 자식 카드 (`js/render_coastal.js`)

### 5.3.1 isCoastal 분기의 핵심 정책

자식 카드는 부모 카드와 달리 **정확값만 신뢰** 한다. 구체적으로 발효시각 row 는 `isExactSingleTime(alert.tmEf)` 가 `true` 일 때만 노출되며 `false` 면 row 자체가 미표시된다.

`_isExactSingleTime()` (`render_coastal.js:385~398`):

```js
function isExactSingleTime(s) {
    if (s === null || s === undefined) return false;
    const str = String(s).trim();
    if (!str) return false;
    if (str.indexOf('(') !== -1 || str.indexOf('~') !== -1) return false;   // 범위형
    if (/(오전|오후|새벽|밤|저녁|아침)/.test(str)) return false;            // 시간대 명칭 단독
    if (/\d{4}\s*년\s*\d{1,2}\s*월\s*\d{1,2}\s*일\s*\d{1,2}\s*시\s*\d{1,2}\s*분/.test(str)) return true;
    if (/\d{4}\.\d{1,2}\.\d{1,2}\.\d{1,2}:\d{1,2}/.test(str)) return true;
    return str.replace(/[^0-9]/g, '').length === 12;
}
```

판정 표:

| 입력 예 | 결과 | 자식 발효시각 표출 |
|---|---|---|
| `"2026.05.25 18:00"` | true | `5월 25일(오늘) 18시` |
| `"202605251800"` | true | `5월 25일(오늘) 18시` |
| `"2026년 05월 25일 18시 00분"` | true | `5월 25일(오늘) 18시` |
| `"25일 18시 ~ 24시"` (`~` 있음) | false | row 자체 미표시 |
| `"25일 밤(21시~24시)"` (`(` 있음) | false | row 자체 미표시 |
| `"25일 새벽"` (시간대명 단독) | false | row 자체 미표시 |
| `""` (빈 값) | false | row 자체 미표시 |

### 5.3.2 정책 차이 — 부모 카드 vs 자식 카드

| 입력 형태 | 부모 카드 | 자식 카드 |
|---|---|---|
| 정확값 `"2026.05.25 18:00"` | 표출 | 표출 |
| 범위형 `"25일 21시~24시"` | **표출** ("5월 25일 21시~24시") | **미표출** (row 삭제) |
| 시간대명 단독 `"25일 밤"` | 표출 | 미표출 |
| 빈 값 | "정보 없음" | row 삭제 |

부모 카드는 모든 형태를 표출(읽을 만한 값이 있으면 보여줌), 자식 카드는 정확값만 표출(노이즈 차단). 이유: 자식 카드는 화면 공간이 좁고, 사용자가 발효시각·해제예정의 정확성에 의존하는 경우가 많아 "확실하지 않은 시각" 을 숨기는 보수적 정책이 유리.

### 5.3.3 V3 → V3.1 → V3.2 → V3.3 시리즈

이 정책은 점진적으로 확장되었다.

- **V3 (`57eae43`)**: 자식 메타 정확화 — 빈 시각 값은 row 자체 미표시. 발표시각 = 첫 수집 시점 - 1분 보정을 영구 유지.
- **V3.1 (`e20ddf6`)**: 범위형 tmEf 발효 전 처리 — 자식 카드 범위형 발효시각 미표시.
- **V3.2 (`7a09572`)**: 자식 발효 전 라벨 `'예비'` 통일 + `'예정'` 표기 제거. 이전엔 `'풍랑 주의보 예정'` 등 혼란.
- **V3.3 (`3c2d0aa`)**: 범위형 tmEf digit fallback 오인 차단. `_parseBulletinTimeToMs` 의 digit-only fallback 이 "2026년 05월 21일 오전(06시~12시)" 같은 범위형의 앞 12자리 (`202605210612`) 만 잘라 5/21 06:12 로 오인 파싱하던 회귀 차단.

### 5.3.4 자식 카드 클릭 비활성 (정책 결정)

`render_coastal.js:339~344, 459~462` 의 명시적 정책:

> 자식 해역(연안바다/평수구역) 카드는 클릭에 반응하지 않는다.
> - dmdw 머지 자식: 통보문이 없어 펼침으로 보여줄 추가 정보 0.
> - 부모 상속 자식: detail box 정보가 부모 카드와 동일해 가치 0.
> → cursor 도 default 로 두어 클릭 가능한 듯한 시각적 단서 제거.

사용자 학습 비용 감소 + 정보 중복 제거 의도. detailBox 자체는 DOM 에 생성되지만 (`display: none`) 영원히 펼쳐지지 않는다.

### 5.3.5 자식 라벨 '예비' 통일 (V3.2)

발효 전 단계의 라벨은 한 가지로 통일된다 (`render_coastal.js:426~430`):

```js
const isPrelim = alert.isPreliminary || (alert.rawTmEf && getKfTime() < alert.rawTmEf.replace(/[^0-9]/g, ''));
const displayLevel = isPrelim ? '예비' : alert.level;
```

- 발효 전(`isPrelim === true`) → `풍랑 예비`
- 발효 후 → `풍랑 주의보` / `풍랑 경보` (자식 자기 등급 그대로)

### 5.3.6 자식 카드 정렬 (`render.js:930~936`)

```js
const sortedCoastal = [...coastalZones].sort((a, b) => {
    const alertA = findCoastalAlert(a.fullName);
    const alertB = findCoastalAlert(b.fullName);
    if (alertA && !alertB) return -1;
    if (!alertA && alertB) return 1;
    return 0;
});
```

특보 있는 자식이 위로 정렬. 사용자가 부모 아코디언 펼쳤을 때 발효 자식이 즉시 보이도록.

---

## 5.4 격상/격하 UI 정책 — "화살표 미표시"

### 5.4.1 사용자 명시 요구

> "화살표 불필요. 사후흔적 불필요."

격상(예: 주의보 → 경보) / 격하(경보 → 주의보) 가 발생해도:
- 카드는 새 등급으로 **단순 대체**.
- 직전 등급의 흔적 표시 없음 (`주의보 → 경보` 같은 화살표 X, "직전 주의보" 같은 사후 흔적 X).
- 부모 카드 뱃지가 그냥 `풍랑 경보` 로 바뀜.

### 5.4.2 푸시 메시지는 예외 — 한 줄 텍스트로 격상 알림

푸시 메시지는 사용자가 트레이에서 한 번에 정보를 받아야 하므로 격상/격하 사실을 텍스트로 명시:

```
📢 풍랑 주의보→경보 격상 발표
ㅇ제주도서부앞바다(모든 연안바다 포함)
   - 발효예정 : 5월 26일 00시
```

`push_helpers.js:312` 에서 `prevLevel + "→" + newLevel + " 격상 발표"` 로 조합. `prevLevel` 출처: `change.currentActive.wrnLvl`. null 일 때 fallback `'주의보'`.

### 5.4.3 templateId 매핑

| 시나리오 | templateId | 푸시 텍스트 | 카드 변경 |
|---|---|---|---|
| 격상 (예비 단계) | `level_upgrade_publish` | `📢 풍랑 주의보→경보 격상 발표` | 다가오는 특보 추가 |
| 격상 (발효 단계) | `level_upgrade_active` | `🚨 풍랑 주의보→경보 격상 발효` | 뱃지 단순 대체 |
| 격하 (예비 단계) | `level_downgrade_publish` | `📢 풍랑 경보→주의보 격하 발표` | 다가오는 특보 추가 |
| 격하 (발효 단계) | `level_downgrade_active` | `🚨 풍랑 경보→주의보 격하 발효` | 뱃지 단순 대체 |

### 5.4.4 점수 기반 판정 — getAlertScore (`push_sender.js:23~32`)

```js
TYPE_RANK = { 태풍: 100, 풍랑: 10, 강풍: 10, 해일: 10, ... }
LVL_RANK  = { 경보: 5, 주의보: 2, 예비: 2, 해제: 0 }
score = TYPE_RANK[type] + LVL_RANK[lvl]
```

- `prevScore < currScore` → 격상
- `prevScore > currScore` → 격하
- 같은 점수 → "발효" 또는 "시각 변경" (등급 변화 아님)

### 5.4.5 한계 — 사후흔적 부재의 trade-off

격상 직후 사용자가 앱을 열면 그냥 `풍랑 경보` 카드만 보이고 "방금 주의보에서 격상되었음" 을 알 수 없다. 푸시를 못 본 사용자에게는 정보 손실. 그러나 사용자 명시 요구로 채택된 정책.

---

## 5.5 시간 포맷 함수 비교표 (`utils.js`, `push_helpers.js`)

표출 사슬의 모든 단계에서 같은 raw 시각이 들어가도 같은 결과가 나오도록 4 단계의 정규화·포맷 함수가 직렬로 배치되어 있다.

### 5.5.1 4개 함수 비교 매트릭스

| 항목 | `normalizeMmisTime` | `formatWarningTime` | `formatDate` | `formatWarnTimeKST` (옛 `fmtUserKMA`) |
|---|---|---|---|---|
| 위치 | `marine_warning_crawler.js:1799~1835` | `js/utils.js:118~213` | `js/utils.js:52~114` | `services/push_helpers.js:34~91` |
| 실행 환경 | 서버 (Node) | 프론트 (브라우저) | 프론트 | 서버 (Node, 푸시 본문 생성 시) |
| 사용처 | snapshot 의 모든 시각 필드 (tmFc/tmEf/tmYn/clrNtcTm) 정규화 | 부모 카드 / 자식 카드 / 지도 박스 / 푸시 도착 상세 팝업 | 옛 dmdw 통보문 시각, AFSO 등 일부 | 푸시 트레이 본문 (제목·본문 시각 라인) |
| 주 입력 형식 | `"2026.05.25 18:00"`, `"22일 21시 ~ 24시"`, `"05:58"` | 12자리, 점·대시, 한글, `"D일 H시 ~ H시"` 모두 | 12자리, `"YYYY.MM.DD.HH:MM"` 등 | 12자리, 점·대시, 한글 모두 |
| 주 출력 형식 | `"2026년 05월 25일 18시 00분"`, `"22일 밤(21시~24시)"`, `"2026년 06월 01일 00시~06시"` | `"5월 25일(오늘) 18시"`, `"5월 26일(내일) 03시~06시"` | `"05/25 오후 6시"` (오전/오후) | `"5월 25일 18시"` (라벨 없음) |
| mm=58/59 처리 | ✔ (변환 시점에 6시간 블록으로) | ✔ (3 경로 모두: 12자리, HH:MM, H시 M분) | ✘ (dotMatch 분기 — 변환 안 함) | ✔ (3 경로 모두) |
| 상대일자 라벨 (오늘/내일/...) | N/A | ✔ 사용 | 부분 사용 (오전/오후 라벨) | ✘ **의도적 미사용** |
| 범위 끝 0→24 정규화 | ✔ | ✔ | ✘ | ✔ |
| degenerate (시작=끝) → 6h 블록 스냅 | N/A | ✔ | ✘ | ✔ |
| 월 표시 | ✔ ("YYYY년 MM월 DD일") | ✔ ("M월 D일") | ✔ ("MM/DD") | ✔ ("M월 D일") |
| year 추론 ("일" 만 있는 입력) | N/A | ✔ (가장 가까운 미래 날짜) | ✘ | ✔ (라벨 없이 월만) |

### 5.5.2 normalizeMmisTime 3가지 변환 케이스 (`marine_warning_crawler.js:1799~1835`)

```
A. 범위형  "22일 21시 ~ 24시"
   → "22일 밤(21시~24시)"
       시간대 명칭 `_periodNameByHour(21)` → "밤" 가져오기

B. 점·대시 "2026.05.21 06:00"
   → "2026년 05월 21일 06시 00분"

C. mm=58/59 레거시 코드  "2026.06.01 05:58"
   → "2026년 06월 01일 00시~06시"
       분=58 이면 hh 가 속한 6시간 블록으로 변환
       (00~06, 06~09, 09~12, 12~18, 18~24)
```

### 5.5.3 formatWarningTime 의 5 분기 (`utils.js:152~205`)

입력 형식별 분기:

| 입력 패턴 | 분기 | 처리 |
|---|---|---|
| `YYYY[년/./-]MM[월/./-]DD일? rest` | A | Y/Mo/D 추출 + rest 별도 파싱 |
| 12자리 raw `YYYYMMDDHHMM` | B | mm=58/59 분기 + 정확값 분기 |
| `D일 rest` | C | year 추론 + rest 별도 파싱 |
| 그 외 | D | rest 그대로 |
| 빈 값 / `'0'` / `'000000000000'` | (early return) | `'정보 없음'` |

`rest` 의 4 분기:

| rest 패턴 | 처리 |
|---|---|
| `H시?~H시` | `fmtRange` → "00시~06시" |
| `HH:MM` | mm=58/59 분기 + 그 외 `fmtExact` → "06시 30분" |
| `H시 [M분]` | mm=58/59 분기 + 그 외 `fmtExact` |
| 그 외 | 원본 그대로 |

### 5.5.4 formatWarnTimeKST 의 의도적 단순화 (`push_helpers.js:34~91`)

`formatWarningTime` 과 거의 동일하지만 `dateLabel` 만 단순화:

```js
// formatWarningTime
const dateLabel = (y, mo, d) => {
    const l = relLabel(y, mo, d);
    return `${mo}월 ${d}일${l ? '(' + l + ')' : ''}`;
};

// formatWarnTimeKST (푸시 전용)
const dateLabel = (y, mo, d) => `${mo}월 ${d}일`;   // 라벨 미사용
```

이 한 줄 차이가 사용자 트레이 vs 앱 카드의 표시 차이를 만든다.

### 5.5.5 왜 4단계의 mm=58/59 처리가 필요했나 (방어 깊이)

`normalizeMmisTime` 단계에서 점·대시 → 한글 변환을 먼저 한 결과 다운스트림(`formatWarningTime` / `formatWarnTimeKST`)의 12자리/점·대시 분기를 거치지 않고 한글 분기로 직행 → mm=58 그대로 남아 "05시 58분" 으로 표출. `b786ece` 가 모든 단계 (서버 normalize + 프론트 H시 M분 경로 + 푸시 H시 M분 경로) 에 동일 분기를 추가하여 방어 깊이 확보.

### 5.5.6 그 외 보조 함수

| 함수 | 위치 | 역할 |
|---|---|---|
| `_periodNameByHour(h)` | `marine_warning_crawler.js:1789~1797` | 시간대 명칭 (새벽/아침/오전/낮/늦은 오후/저녁/밤) |
| `formatDate(dateStr)` | `js/utils.js:52~114` | AFSO 시각 표시. `YYYY.MM.DD.HH:MM` → `"MM/DD 오전 H시"`. 한글 시간대 있으면 그대로. 그 외 → `formatWarningTime` 위임 |
| `fmt` (generateMessage 내부) | `push_helpers.js:252~256` | `formatWarnTimeKST` 위임 |
| `fmtTime` (buildSplitPushes) | `push_helpers.js:780~790` | `formatWarnTimeKST` 위임 (관리자 분할 푸시) |
| `formatDateTime` | `fix_popup_logic.js` | `window.formatWarningTime` 위임 (푸시 도착 상세 팝업) |
| `_fmtTime` | `js/ocean_warn_active5.js` | `formatWarningTime` 위임 (지도 박스) |
| `formatBuoyTime` | `js/render_coastal.js:231` | 부이 관측시간 전용 — `"MM/DD HH:MM"` |

---

## 5.6 상대일자 라벨 (오늘/내일/모레/글피/그글피)

### 5.6.1 동작 정의 (`utils.js:129~137`)

```js
const relLabel = (y, mo, d) => {
    if (!y || !mo || !d) return '';
    const now = new Date(Date.now() + 9 * 3600000); // KST 달력일
    const diff = Math.round(
        (Date.UTC(y, mo - 1, d) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / 86400000
    );
    if (diff < 0) return '';
    return ['오늘', '내일', '모레', '글피', '그글피'][diff] || '';
};
```

### 5.6.2 라벨 매트릭스

| diff (KST 일수) | 라벨 |
|---|---|
| 0 | 오늘 |
| 1 | 내일 |
| 2 | 모레 |
| 3 | 글피 |
| 4 | 그글피 |
| 5+ | (라벨 없음, 월·일만) |
| < 0 (과거) | (라벨 없음) |

### 5.6.3 KST 기준 계산 이유

`new Date(Date.now() + 9 * 3600000)` 로 기기 TZ 무관하게 KST 달력일을 얻는다. 서버가 UTC 인 경우, 사용자 단말이 미국 시간대인 경우 등 모두 한국 사용자 기준 "오늘/내일" 이 일치.

### 5.6.4 적용 출구

- ① 부모 카드 / ② 자식 카드 / ④ 푸시 도착 상세 팝업 / ⑤ 지도 박스 → 라벨 사용
- ③ 푸시 트레이 → **라벨 미사용** (§ 5.10 의 이유)

### 5.6.5 5일 cap 의 이유

해상특보의 발효·해제예고가 4~5일 이상 앞을 가리키는 경우는 거의 없고, "다음주 화요일" 같은 라벨은 사용자가 직관적으로 헤아리기 어려움. 5일 이후는 라벨 없이 월·일 (`"6월 7일 18시"`) 만 표시.

---

## 5.7 시간대 명칭 (새벽/아침/오전/낮/늦은 오후/저녁/밤)

### 5.7.1 매핑 (`marine_warning_crawler.js:1789~1797`)

```js
function _periodNameByHour(h) {
    if (h >= 0 && h < 6) return '새벽';
    if (h >= 6 && h < 9) return '아침';
    if (h >= 9 && h < 12) return '오전';
    if (h >= 12 && h < 15) return '낮';
    if (h >= 15 && h < 18) return '늦은 오후';
    if (h >= 18 && h < 21) return '저녁';
    return '밤';
}
```

| 시작 시각 (h) | 명칭 |
|---|---|
| 00~06 | 새벽 |
| 06~09 | 아침 |
| 09~12 | 오전 |
| 12~15 | 낮 |
| 15~18 | 늦은 오후 |
| 18~21 | 저녁 |
| 21~24 | 밤 |

### 5.7.2 왜 "오후" 아닌 "늦은 오후"?

`6fcbdb5` (DMDW 실측 보강) 시점에 5년치 본문 + 시각 역산에서 "오후" 단독 미관측이 확인됨. 옛 코드: `12~18 오후` 가 단일 분기였으나 실측 결과 "오후" 라는 단어 자체가 KMA 통보문에 등장하지 않음. 표준 어휘:

- "낮" (12~15)
- "늦은 오후" (15~18)

`Agent A` 분석에서 "늦은 오후" 52건 / "오후" 5건. 다수결로 "늦은 오후" 채택.

### 5.7.3 야간 경계 분기 (a0d8ba3 와 일치)

`'밤'` 의 범위가 옛 코드 `18~24` 였으나 실측 본문과 맞추기 위해 `21~24` 로 좁힘 (`6fcbdb5 P4`). 그 결과 `'저녁'(18~21)` 신규 분기. 이는 사용자 토글 "야간 23:00~07:00" 의 라벨 (`a0d8ba3`) 과 별개의 차원이지만, 둘 다 "현장 표준 어휘에 맞춤" 이라는 동일 원칙.

### 5.7.4 사용 경로

범위형 시각 normalize 시점에만 사용:

```
"22일 21시 ~ 24시"
   → _periodNameByHour(21) = '밤'
   → "22일 밤(21시~24시)"
```

이 한글화는 `normalizeMmisTime` 의 A 분기에서 일어나며, 이후 `formatWarningTime` / `formatWarnTimeKST` 는 "D일 밤(21시~24시)" 형태를 받아 그대로 출력하거나 부분 파싱한다.

---

## 5.8 평균 유의파고·풍속 표출

### 5.8.1 표출 위치

부모 카드의 하단에 zone 별 부이 데이터 평균이 두 row 추가됨:

```
평균 유의파고  0.9m
평균 풍속      4.7m/s
```

### 5.8.2 출처

KMA 부이 API (별도 endpoint). zone 단위 (28 부모 zone 별) 로 부이 매핑이 있어 그 zone 안의 부이들의 직전 1시간 평균을 표출.

### 5.8.3 자식 카드 미표시

자식(연안바다·평수구역) 단위로는 부이 매핑이 없거나 부이가 1개도 없는 경우가 다수라 자식 카드에는 보통 미표시. 부이가 매핑된 일부 연안바다만 부이 라벨이 표시된다.

### 5.8.4 부이 시간 포맷

부이 관측시간은 `formatBuoyTime` (`render_coastal.js:231`) 으로 `"MM/DD HH:MM"` 형식. 특보 시각과 별도의 시각 표현 시스템 (관측 시점 정확성이 더 중요).

---

## 5.9 자식 한정사 토글 (`buildChildQualifier`)

### 5.9.1 옵션 키 — `user.options.childZones`

- 기본값: `true` (ON) — `6ba1a95` 에서 OFF→ON 전환
- 마이그레이션 정책: 키 자체가 없는 기존 구독자도 `childZones !== false` 로 기본 ON

### 5.9.2 ON 시 한정사 표시

`buildChildQualifier(parent, childState, eventType)` (`push_helpers.js:557~630`):

| 케이스 | 출력 |
|---|---|
| 부모 + 모든 자식 발효 | `(모든 연안바다 포함)` |
| 부모 + 모든 자식 발효 (자식 1개짜리 부모) | `(평수구역 포함)` |
| 부모 + 자식 일부 발효 | `(북서연안바다, 남서연안바다 포함)` |
| 부모만, 자식 미발효 | `(연안바다 미발효)` |
| 추가 발효 (자식 추가) | `(가파도연안바다 추가 발효)` |
| 일부 해제 | `(가파도연안바다만 해제)` |
| 모든 자식 해제 | `(모든 연안바다 해제)` |
| 자식 단독 시각 변경 | `(연안바다만 시각 변경)` |
| 자식 단독 연장 | `(가파도연안바다)` |
| 부모 매트릭스 미등록 (먼바다 등) | `''` (한정사 없음) |

### 5.9.3 OFF 시

- 한정사 자체를 생략 — 푸시 본문에 부모명만 (`ㅇ제주도서부앞바다`)
- 자식 단독 푸시 (additional_active / partial_release / 자식 단독 연장) 는 미수신
- 카드 표시는 영향 없음 (옵션은 푸시에만 적용)

### 5.9.4 토글 변천사 (378d64a → 6ba1a95)

| 시점 | 기본값 | UI 라벨 |
|---|---|---|
| `378d64a` (5/24) | OFF | "특정관리해역 푸시 알림 허용" |
| `6ba1a95` (5/24) | ON | "연안바다, 평수구역 특보 정보 표출" |

OFF→ON 으로 바꾼 이유: 자식 정보가 정보 노이즈 보다 가치가 크다는 판단. 예) 제주도서부앞바다 발효중일 때 "(가파도연안바다 포함)" 인지 "(북서연안바다 포함)" 인지가 사용자 의사결정 (어떤 항로를 피할지) 에 직결.

### 5.9.5 settings.js 의 fallback (`5ea305b`)

```js
options.childZones = el.childZones?.checked ?? true;   // 옛: ?? false
```

UI 요소가 누락된 마이그레이션 경로에서도 의도(ON)가 유지되도록 fallback 을 `false → true` 로 수정.

---

## 5.10 푸시 메시지 vs 앱 팝업 — 의도적 차이

### 5.10.1 차이 매트릭스

| 항목 | 푸시 트레이 (③) | 앱 카드/팝업/지도 (①②④⑤) |
|---|---|---|
| 함수 | `formatWarnTimeKST` | `formatWarningTime` |
| 상대일자 라벨 | **미사용** | 사용 |
| dateLabel 출력 | `"5월 26일 03시"` | `"5월 26일(내일) 03시"` |
| 의도 | 트레이 잔존 시점 부정확 방어 | 실시간 표시 정확 |

### 5.10.2 푸시가 라벨을 안 쓰는 이유

푸시 메시지는 **트레이에 남아 한참 후 열람** 될 수 있다. 푸시 발사 시점은 "5월 25일 23:50" 이고 라벨은 "오늘", 본문 시각은 "(내일) 03시". 그런데 사용자가 다음날 06:00 에 트레이를 보면 "내일 03시" 가 "어제 03시" 가 되어 혼란.

`2829a0e` 의 의도:

> 푸시 메시지 시각에서 상대일자 라벨(오늘/내일/모레) 제거.

라벨 없는 절대 날짜 (`"5월 26일 03시"`) 는 트레이에 며칠을 남아 있어도 모호하지 않음.

### 5.10.3 푸시 도착 상세 팝업은 라벨 사용 (a05c3d2)

```
[③ 푸시 트레이]
🚨 풍랑 주의보 발효
ㅇ제주도서부앞바다
   - 해제예정 : 5월 26일 03시

[④ 앱 내 팝업 — 같은 푸시를 탭한 직후]
풍랑 주의보 발효
대상해역  제주도서부앞바다
해제예정  5월 26일(내일) 03시   ← 라벨 복원
```

이유: 사용자가 푸시를 탭하는 시점 = 푸시 발사 직후일 가능성이 높음 (트레이 누적 X). 즉시 열람에는 라벨이 더 직관적.

`fix_popup_logic.js` 의 `formatDateTime` 이 `window.formatWarningTime` 에 위임하므로 라벨 사용. `a05c3d2` 가 "C5 누락 보완" 으로 적용됨.

### 5.10.4 한계

푸시 트레이에서 본 본문과 앱 팝업의 본문이 미세하게 다르다 ("오늘/내일" 유무). 사용자가 비교하면 "다른 정보인가?" 의심할 수 있음. 그러나 같은 절대 시각이라 의미는 동일.

---

## 5.11 야간 차단 정책

### 5.11.1 정책 정의

사용자 옵션 `night: false` 인 경우 KST 23:00 ~ 07:00 푸시 차단.

`routes/push.js:362~368`:

```js
if (opts.night === false) {
    const kstHour = (new Date().getUTCHours() + 9) % 24;
    if (kstHour >= 23 || kstHour < 7) return;
}
```

### 5.11.2 UI 라벨과 일치 (a0d8ba3)

| 시점 | 차단 시간대 | UI 라벨 | 라벨 일치? |
|---|---|---|---|
| `a0d8ba3` 이전 | `>= 22 || < 7` | "야간 23:00~07:00" | ✘ (22~23시 차단 누락) |
| `a0d8ba3` 이후 | `>= 23 || < 7` | "야간 23:00~07:00" | ✔ |

22~23시 푸시가 사용자 옵션 라벨 기대와 달리 차단되던 불일치 수정.

### 5.11.3 야간 토글 ON 의 의미 (해상 종사자 새벽 출항)

야간 토글이 ON 이면 23:00~07:00 사이에도 푸시가 발사된다. 해상 종사자가 새벽 출항을 준비하려면 새벽 4~5시에 도착하는 풍랑경보 푸시가 매우 중요. 사용자가 명시적으로 토글 ON 한 경우에만 발사 (기본값은 ON).

### 5.11.4 적용 시점 — 발사 직전

야간 차단은 `routes/push.js` 의 `/api/push-custom` 엔드포인트 안, 사용자별 처리 루프에서 발사 직전에 체크. zone 매칭·만료 토큰 정리는 야간이라도 정상 실행, 발사만 skip.

### 5.11.5 master 토글과의 관계

`master: false` → 모든 푸시 차단 (야간 토글과 무관). 야간 토글은 master 통과한 사용자에게만 적용. `master` 가 더 큰 게이트.

---

# § 6. 시행착오 Timeline

> 본 절은 271 커밋 (`main..claude/kma-website-reference-KYLtf`) 의 시행착오를
> 단일 권위 timeline 으로 흡수한다. 시간 단위 (몇 분/몇 시간/며칠 간격) 와
> "같은 문제 반복" 패턴을 추적한다.
> 시나리오 deep-dive 는 § 4 에 있으므로 cross-link.

---

## 6.1 시간순 timeline (5/22 ~ 6/1)

날짜·시각은 commit author date (UTC). T-1 = 5/22 사용자 푸시 채널 끊김부터 카운트.

### 6.1.1 5/22 — 머지 직후의 침묵과 v7 통합 (T-1)

| 시각 (UTC) | 커밋 | 사건 | 영향 |
|---|---|---|---|
| 03:13 | `082da8e` | v7 통합 활성화 (followup base) — marine.kma 단일 출처 | legacy 두 크롤러 비활성화 |
| 03:22 | `baf34fa` | E-1/E-2/E-4 운영 안전성 (빈 prev 가드) | 빈 snapshot 푸시 skip |
| ~04:00 | (관측) | **사용자 푸시 채널 끊김 발견** — 사용자에게 단 1건도 안 감 | 침묵 푸시 사고 |
| 05:07 | `a515853` | D-1/D-2/D-6 시간 형식 + 자식 부모 fallback | (자식 fallback 은 후일 폐기) |
| 06:07 | `c761225` | Must-fix fmtTime dot + D-medium 의심 가드 옵션 C | 의심 cycle 3개 임계 |
| 06:22 | `64cba8a` | merge — D-medium 인프라 | |
| 06:34 | `8998037` | D-medium 인터랙티브 전환 | 10분 자동 release 폐기 |
| 06:50 | `abf8c57` | D-medium silent dedup 차단 (B-2) | reinforce push 1차 회복 |
| 07:47 | `1870784` | 사용자 앱 UI 회귀 차단 — 옛 데이터 구조 호환 | wrnTp/wrnLvl 한글 우선 |
| 08:14 | `f0477c6` | 해제예고 범위형 시간대 명칭 변환 | "21~24시" → "밤(21시~24시)" |
| 08:23 | `9651167` | **[핵심] 사용자 푸시 채널 복원** — push_sender 호출 추가 | T-1 해결 (4시간) |
| 08:42 | `6fcbdb5` | 사용자 push 보강 4건 (UPCOMING_CHANGE 복원, 시간대 매핑) | 침묵 직후 20분 |
| 15:31 | `dbe2c6b` | **[V10] warn/latest endpoint 추가** | 정확 해제시각 보강 |

### 6.1.2 5/24 — 예비특보 부활과 표출 통일

| 시각 (UTC) | 커밋 | 사건 |
|---|---|---|
| 13:21 | `ff1fe17` | 예비특보 푸시 부활 + V/T allowlist + 미발효 한정사 버그 |
| 13:34 | `378d64a` | 자식 한정사 토글 (childZones 기본 OFF) |
| 13:35 | `a057b7f` | 관리자 푸시 콤마결합 양식 통일 |
| 13:39 | `a0d8ba3` | 야간 경계 22→23시 라벨 일치 |
| 14:35 | `640fd12` | **[표출] 시각 표시 통일** — 월·시단위·상대일자·범위 |
| 14:42 | `5ea305b` | 관리자 푸시 시각 통일 + 리셋 경합 `_forceBaselinePending` |
| 15:19 | `aeae518` | 관리자 알림 푸시 전면 비활성 (ADMIN_PUSH_ENABLED=false) |
| 15:37 | `2c25c58` | 코드기반 해역명 매핑 (A안, 93개) |

### 6.1.3 5/25 — GAP 4건 + 자식 독립화

| 시각 (UTC) | 커밋 | 사건 |
|---|---|---|
| 09:07 | `2a21b9c` | "발표 발효대기" GAP 누락 보강 (warn/latest 에서 예비로 추가) |
| 12:50 | `5a9e111` | GAP 보강을 자식까지 확장 |
| 13:19 | `adab23e` | **[GAP 4건 일괄]** 예비→발표 단체전이 복합버그 |
| 13:33 | `f9e4340` | GAP 발표대기 자식 합성 fallback (PARENT_TO_CHILDREN) |
| 13:40 | `0049f2a` | GAP 자식을 warn-sasc/latest 개별 통보문으로 표출 |
| 13:59 | `3705f4a` | **[원칙 확립]** 자식 표출은 자식 개별 데이터에 기인 |
| 14:21 | `f499308` | 자식 독립 푸시 (additional_active/partial_release) |
| 14:39 | `9d47ed3` | 자식 해제 3분 디바운스 |
| 15:33 | `374923d` | 발효/해제 예정시각 **연장** 푸시 |
| (~) | `7821092` | 자식 단독 연장 푸시 |

### 6.1.4 5/26 — 정확시각 고정 + 윈도우 (HOLD 시리즈)

| 시각 (UTC) | 커밋 | 사건 |
|---|---|---|
| 01:10 | `451f48e` | **[A]** 발표시각 = 최초 발표시각 고정 |
| 01:16 | `5213c83` | **[B]** 다가오는 특보 병렬 표출 |
| 01:48 | `b411cea` | 2중 검토 — 연장 감지 등급 가드 + upcomings 복원 |
| 02:22 | `fe0bda5` | 예비→발표 핸드오프 GAP — "발표" 오인 → "발효시각 변경" |
| 13:16 | `2866fe0` | **[원칙 확립]** 연장은 범위→더 늦은 범위 |
| 14:17 | `7c981d1` | warn/latest 깜빡임 가짜 푸시 차단 |
| 14:45 | `b05ce1f` | 정확 해제시각 HOLD + 해제윈도우 |
| 15:01 | `5ded869` | 발효시각도 동일 정책 |
| 15:16 | `a7bc5c9` | 정확시각 고정 보강 — 핸드오프 공백 + 자식 |
| 15:26 | `eb06efe` | 3분 디바운스 |

5/26 하루에 **8커밋** 누적. 한 층의 안전망을 추가할 때마다 다른 코너 케이스가 노출됨.

### 6.1.5 5/30 — mm=58/59 발견 + E-1 가드 재정의

| 시각 (UTC) | 커밋 | 사건 |
|---|---|---|
| 22:15 | `8a9a798` | mm=58/59 점·대시 형식 (`"05:58"` → `"00시~06시"`) |
| 22:33 | `6df054a` | E-1 가드를 콜드부팅 1회로 한정 (자연 전이 복원) |
| 22:36 | `c94ea5e` | 관리자 UI '전체 사용자 재발송' 버튼 |
| 22:46 | `b786ece` | **mm=58/59 한글 형식 + normalize 단계** 보강 (방어 깊이) |

5/30 22:15 → 22:46 까지 **31분 안에 4 커밋** — 같은 mm=58/59 fix 가 형식별로 3차에 걸쳐 확장됨.

### 6.1.6 6/1 — 종합 히스토리 작성

| 날짜 | 사건 |
|---|---|
| 6/1 | `8aad5c8` — SEAGNAL × KMA MMIS 통합 종합 히스토리 (4 에이전트 병렬) |
| 6/1 | (관측) E-1 가드 over-fire 발견 (오늘) |
| 6/1 | (관측) mm=58/59 한글 형식 fix 누락 발견 (오늘) |
| 6/2 | 본 통합 히스토리 (5 에이전트 병렬 권위본) |

### 6.1.7 같은 문제 반복 — 시간 단위 추적

| 패턴 | 1차 시점 | 2차 시점 | 3차 시점 | 4차 시점 | 누적 기간 |
|---|---|---|---|---|---|
| mm=58/59 처리 | 5/30 22:15 (점·대시) | 5/30 22:46 (한글) | 5/30 22:46 (normalize) | 6/1 (`b786ece` 추가 보강) | 30분 → 1일 |
| 정확시각 고정 | 5/26 14:17 (`7c981d1`, latest 깜빡임) | 5/26 14:45 (해제 HOLD) | 5/26 15:01 (발효 HOLD) | 5/26 15:16 (자식 HOLD) | 60분 |
| E-1 가드 | 5/22 03:22 (V1) | 5/22 05:07 (V2 제거) | 5/30 22:33 (V3 재추가) | — | 8일 |
| 자식 독립성 | 5/22 05:07 (D-6 fallback) | 5/25 13:59 (`3705f4a` fallback 제거) | 5/25 14:21 (`f499308` 푸시도 독립) | 5/25 15:33 (자식 연장) | 3일 |
| 자식 표출 정확화 | V3 (`57eae43`) | V3.1 (`e20ddf6`) | V3.2 (`7a09572`) | V3.3 (`3c2d0aa`) | — |

---

## 6.2 결정적 시행착오 23건

각 항목은 다음 8 단계 구조:
**[발견 경위] · [잘못된 가정] · [진짜 원인] · [교정] · [결과] · [후속 파급] · [인지 추론 패턴] · [관련 시나리오]**

### § 6.2.1 [5/22 04:00 ~ 08:23] 사용자 푸시 채널 끊김 (T-1)

**[발견 경위]**: `082da8e` 로 marine v7 통합을 활성화하고 hours 단위로 운영 중. 관리자 채널 (dmdw_push_sender) 은 정상 동작 — 발효/해제/격상 등 로그가 관리자 알림으로는 들어오는데, **FCM 으로 일반 사용자에게 단 한 건도 안 감** 을 관측.

**[잘못된 가정]**:
- A: FCM 토큰 만료/구독자 정리 시점 문제로 의심
- B: 관심해역 필터가 너무 좁아 매칭 0건일 것으로 의심

`routes/push.js` 에 토큰·구독자 수·필터 로그를 추가했으나 **호출 자체가 없었다**.

**[진짜 원인]** (`9651167` 커밋 메시지):
- 옛 시스템: `weather_alerts_crawler.js` + `report_alert_processor.js` 가 `push_sender.processChanges()` 호출 → 사용자 푸시 발사
- marine v7 통합 시 legacy 두 크롤러 비활성화 → push_sender 호출 경로 끊김
- `marine_warning_crawler` 는 `dmdwPush`(관리자) 만 호출, push_sender 누락
- 즉 push 채널이 **두 개** (관리자 + 사용자) 라는 사실을 한쪽만 옮긴 것

**[교정]** (`9651167`, marine_warning_crawler.js):
- `pushSender = require('./push_sender')` (graceful fallback)
- `_buildUserPushChanges(prev, curr)` 헬퍼 신설 — CURRENT_CHANGE 형식 변환
- `run()` dispatch 후 `pushSender.processChanges(changes, opts)` 호출
- try/catch 격리 → 사용자 push 실패해도 관리자 push 영향 없음

**[결과]**: T-1 해결 (4시간 23분 소요). 사용자 푸시 채널 부활.

**[후속 파급]** (`6fcbdb5`, 20분 후):
- P1: `_buildUserPushChanges` 가 `CURRENT_CHANGE` 만 발사하고 `UPCOMING_CHANGE` (예비 발표/시각변경) 가 빠져 있던 결함 → 복원
- P2: `processChanges` 를 `userChanges.length > 0` 조건으로 가드했더니 변화 없는 cycle 에 `pendingPushes.json` 재시도 안 되는 문제 → 가드 제거
- P3: `CURRENT_CHANGE` 의 dead field `currentActive` → 정리
- P4: 시간대 매핑 갱신 (DMDW 실측 보강)

**[인지 추론 패턴]**: **"부분 검증 편향"** — "관리자 알림이 잘 가니까 시스템 전체가 동작한다" 라는 단편적 검증. 채널이 두 개라는 시스템 지식이 코드 리뷰에서 빠져 있었음.

**[관련 시나리오]**: § 4 의 모든 사용자 푸시 시나리오의 전제조건.

---

### § 6.2.2 [5/22 05:07 → 5/25 13:59] 자식 시각 부모 fallback 폐기 (T-3)

**[발견 경위]**: 라이브 운영 중 `5a9e111`, `0049f2a`, `3705f4a` 일련의 작업에서 반례 누적:
- 부모 발효 중인 zone 의 자식 1개만 해제예고가 와있음
- 부모 발효 중에 자식 2개는 발효, 자식 1개는 추가발효(미래)
- 같은 부모 밑 자식 3개가 각각 다른 정확 해제시각

**[잘못된 가정]** (5/22 D-6 B): "mmis warn-sasc/list 자식 응답에 시간 필드 없음. 자식 tmFc/tmEf/tmYn/clrNtcTm 을 부모값으로 fallback."

당시 가정: "자식은 부모와 같은 시각 일정을 공유하므로 부모값을 상속해도 무방."

**[진짜 원인]**: `3705f4a` 커밋 메시지의 결정적 진단:
> 라이브 e2e: 제주도남부앞바다중연안바다 자식이 발효예정 + 해제예정(26일 21~24시) 를 **자기 데이터로** 표출 확인. 과거 D-6(B) 의 "자식 시간필드 없음" 가정은 **실측상 오류** — 자식이 부모와 동일 스키마로 개별 제공함.

**[교정]** (`3705f4a` → `f499308`, 22분 차이):
- 원칙: "모든 특보 표출 필드는 각 부모/자식이 개별 제공하는 데이터에만 기인"
- `_rowToChildInfo`: 자식 고유 `clr_ntc_tm` 보존
- warn-sasc/latest 보강: 발효중 자식도 자기 통보문의 clr 로 보강
- `_buildZoneTreeFromSnapshot`: 자식 직렬화의 부모값 fallback 전면 제거
- `f499308`: 자식 종류·등급도 부모 fallback 제거

**[결과]**: 자식 표출이 정확해짐. 부모 발효중인데 자식 일부만 다른 등급/시각 케이스가 정확 반영.

**[후속 파급]**:
- 자식 단독 푸시 (`CHILD_ADD` / `CHILD_RELEASE`) 가능 → § 4.10, § 4.11
- 자식 단독 연장 푸시 (`7821092`)
- 자식 지도 팝업 해제예정 표시 복원 (`a9cba9c`)

**[인지 추론 패턴]**: **"공급자 친절도 추정"** — "API 설계자가 자식에 시간 필드를 안 줄 거라" 는 가정. 첫 관찰이 GAP 케이스(원본 부재) 였는데 다른 케이스에서는 자식이 자기 시각을 제공한다는 사실을 발견하기까지 3일 걸림.

**[관련 시나리오]**: § 4.10 (additional_active), § 4.11 (partial_release), § 4.13 (자식 카드).

---

### § 6.2.3 [5/22 15:31] warn/list 만으로 정확 해제시각 못 구함 → V10

**[발견 경위]**: 운영 중 동해남부북쪽바깥먼바다 같은 zone 에서 **해제예정 표시가 범위형 "23일 3시 ~ 6시"** 로 나가는데, KMA 사이트는 **정확 시각 "2026.05.23 01:00"** 으로 표출.

**[잘못된 가정]**: "한 API endpoint 만 호출하면 모든 정보를 얻는다" (단일 진리원 가정).

**[진짜 원인]** (`dbe2c6b`):
- `warn/list` = 현재 상태 (snapshot view) — 정확 해제시각 없음
- `warn/latest` = 통보문 view — 해제 통보문이면 tm_ef 에 정확 시각

즉 **endpoint 가 두 층**.

**[교정]**:
- `marine_client.js`: `fetchWarnLatest`, `fetchWarnSascLatest` 추가 (비로그인)
- `marine_warning_crawler.js`: `_enrichSnapshotWithLatest` 신규
- `run()`: list/ready fetch 후 latest 호출 → 보강

**[결과]**: "23일 3시 ~ 6시" → "2026.05.23 01:00" 갱신 확인.

**[후속 파급]**: V10 이 정확값을 보강했지만 **warn/latest 응답 들쭉날쭉** → 깜빡임 가짜 푸시 → § 6.2.5 (`7c981d1`) 로 차단 → § 6.2.6 (HOLD 시리즈) 로 정확값 자체 고정.

**[인지 추론 패턴]**: "단일 진리원 가정" — 같은 zone 의 정보가 endpoint 별로 다른 view 라는 점을 처음에 인지하지 못함.

**[관련 시나리오]**: § 4 의 해제예정 시각 표출 전체.

---

### § 6.2.4 [5/26 13:16] "연장 = 더 늦은 시각" 오류 → 범위→범위 한정

**[발견 경위]**: `374923d` (5/25) 의 초기 연장 푸시가 운영에 들어간 후, **범위형 → 정확형 확정** 까지 연장으로 잡혀 가짜 푸시.

예: 예비 발효예정 "26일 21시~24시" → 정확 "27일 00시" 는 같은 모멘트 (24시=다음날 00시) 인데 "기존보다 늦음" 으로 연장 처리.

**[잘못된 가정]**: "기존보다 늦어짐(kn>ko)" 만으로 연장 판정. (자연어 직관 — "사용자 지각 = 늦어지면 연장")

**[진짜 원인]**: `2866fe0` 커밋 메시지:
> 정확시각이 나온 건 특보 **확정·명확화** 이지 기간 연장이 아니므로 "해제/발효 시각 변경" 이 맞다.

정보이론적으로 "더 늦어짐" vs "불확실성 감소" 는 다른 사건.

**[교정]** (`2866fe0`):
- `_isRangeTime()` 헬퍼: `~` 포함 여부로 범위형 판별
- 연장 조건: 기존도 범위형, 변경 후도 범위형, 그리고 더 늦음
- 정확시각이 끼면 연장 제외 → `CURRENT/UPCOMING_CHANGE` (시각 변경) 로 분류

**[결과]**: 범위→정확 케이스가 "시각 변경" 으로 정확 분류.

**[후속 파급]** (`b411cea`, 32분 후):
- 검토 2 가 발견: 연장 감지가 종류만 보고 등급은 안 봐서 **격상/격하 발효인데** 해제예정/발효예정이 더 늦으면 "연장"으로 오분류 → 격상/격하 푸시가 사라지던 문제
- `ynExtend`/`efExtend`/자식연장에 **동급(level) 가드** 추가
- 등급 다르면 `CURRENT_CHANGE`(격상/격하) 로 처리

**[인지 추론 패턴]**: "이벤트 우선순위 평탄화" — 연장 판정이 다른 더 중요한 이벤트 (격상/격하) 를 먹어버리는 부작용. 의미론적으로 연장 ⊂ 시각 변경이지만, **이벤트 분류는 동급으로 두면 안 됨** — 더 중요한 이벤트 우선.

**[관련 시나리오]**: § 4.12 (ef_extend / yn_extend), § 4.5 (level_upgrade_active).

---

### § 6.2.5 [5/26 14:17] warn/latest 깜빡임 가짜 푸시

**[발견 경위]**: V10 정확값 보강 후 한 사이클이라도 latest 가 안 오면 warn/list 의 범위형으로 되돌아가 "해제시각 변경" 가짜 푸시 반복.

**[잘못된 가정]**: "prev 와 curr 가 다르면 변경 푸시 발사" — 단순 비교 정책.

**[진짜 원인]**: latest 응답이 들쭉날쭉 → 같은 모멘트 (범위 끝 = 정확값) 가 prev/curr 사이를 오가며 변경으로 오인.

**[교정]** (`7c981d1`):
- `_timeKey`: 범위형은 일관되게 끝 시각 사용 + `24시 = 다음날 00시` 정규화
- `_sameReleaseMoment()`: 범위↔정확이 같은 모멘트인지 판별
- `blockEqual(해제예정)`: 같은 모멘트면 동일로 봄 → `CURRENT_CHANGE` 가짜 푸시 차단
- `_applyAnnounceAnchor`: 직전 정확값이 같은 모멘트면 범위로 되돌리지 않음

**[결과]**: 깜빡임 가짜 푸시 0건.

**[후속 파급]**: 깜빡임만 막은 게 아니라 **정확값 자체를 HOLD** 해야 한다는 더 큰 요구 발견 → § 6.2.6 (`b05ce1f`) 로 윈도우 개념 도입.

**[인지 추론 패턴]**: "format ≠ moment" — 같은 시각을 다른 형식으로 표현해도 같은 사건. 키 정규화 필요.

**[관련 시나리오]**: § 4.9 (time_yn_change), § 4.8 (time_ef_change).

---

### § 6.2.6 [5/26 14:45] 해제시각 HOLD + 윈도우 (b05ce1f)

**[발견 경위]**: `7c981d1` 직후, 다음 케이스 발견:
- 범위 "23일 3시~6시" → 정확 "23일 01시" (변경 1회)
- latest 빠짐 → list 범위로 되돌아감 → 가짜 깜빡임
- 새 범위 "23일 6시~9시" 발표 → 진짜 연장

같은 zone 의 시각 변화를 어떻게 분류할 것인가?

**[잘못된 가정]**: 직전 스냅샷과의 비교만으로 충분.

**[진짜 원인]**: MMIS 가 같은 정보를 다른 형식으로 깜빡이는 노이즈를 다루려면 **상태 메모리** 가 필요.

**[교정]** (`b05ce1f`):
- `_clrWindowEnd`: zone 별 해제 윈도우 끝 시각키 추적 (처음 확립된 범위 끝)
- `_applyReleaseClrLogic`:
  - 윈도우 안 = 정확값 고정 (깜빡임/되돌림 방지)
  - 윈도우 초과 = `_clrExtend` 플래그 (연장)
  - 해제 시 윈도우 정리
- `_buildUserPushChanges`: `_clrExtend` → `YN_EXTEND`

**[결과]**: 정확값 자체가 HOLD 되어 가짜 푸시 0건, 진짜 연장만 발사.

**[후속 파급]** (5/26 15:01 ~ 15:26, 41분간 4커밋):
- `5ded869`: 발효시각도 동일 정책 (`_applyUpcomingEfLogic`)
- `a7bc5c9`: 핸드오프 공백 보강 + 자식 HOLD (`_extensionMemory` 5분 창 참조)
- `eb06efe`: 3분 디바운스 (HOLD 못 막는 잔여 진동 대비)

**[인지 추론 패턴]**: **"메모리 다층화"** — 한 층의 안전망 (윈도우) 추가 → 다른 코너 케이스 노출 → 다음 층 (HOLD 핸드오프) → 또 다음 (디바운스). "5/26 8커밋" 의 핵심.

**[관련 시나리오]**: § 4.8, § 4.9, § 4.12.

---

### § 6.2.7 [5/26 15:01] 발효시각도 동일 정책 (5ded869)

**[발견 경위]**: 사용자 지적 — "해제시각에 적용한 정책을 발효시각에도 동일하게 적용. 동일한 깜빡임/가짜푸시 문제가 발효시각에서도 가능."

**[잘못된 가정]**: 해제시각만 HOLD 가 필요할 것.

**[진짜 원인]**: 발효시각도 같은 메커니즘 — MMIS 가 예비/발표대기 단계의 `tmEf` 도 범위↔정확 깜빡임 발생.

**[교정]** (`5ded869`):
- `_applyUpcomingEfLogic`: 예비/발표대기 `tmEf` 윈도우 추적
- `blockEqual`: tmEf 도 같은 모멘트(범위끝=정확)면 동일로 봄
- 후속: `_applyTimeWindowHold` 공통 함수로 통합 (a7bc5c9)

**[결과]**: 발효시각 깜빡임 가짜 푸시 0건.

**[인지 추론 패턴]**: 정책 대칭성 — 동일 메커니즘이면 같은 정책 적용.

**[관련 시나리오]**: § 4.8 (time_ef_change).

---

### § 6.2.8 [5/26 02:22] 핸드오프 공백 (fe0bda5)

**[발견 경위]**: MMIS 가 예비에서 빼고(잠깐 공백) 발표로 다시 넣는 핸드오프 과정에서 우리 스냅샷에서도 해역이 잠깐 사라졌다 재등장 → prev 가 비어 **"신규 발표"로 오인**. 사용자에게 `📢 풍랑 주의보 발표` 가 한 번 더 나갈 수 있음.

**[잘못된 가정]**: 예비 → 발표 전이는 1사이클 안에 일어남.

**[진짜 원인]**: MMIS endpoint 들이 한 시점에 일관된 상태를 보여주지 않음 — list/ready/latest 가 시각적으로 약간씩 어긋남.

**[교정]** (`fe0bda5`):
- `_extensionMemory` 에 직전 예비의 `tmFc`/`tmEf` 5분 보관
- `_buildUserPushChanges`: 예비가 최근(5분 내) 기억에 있는데 prev 가 비면 직전 예비를 복원 → push_sender 가 `time_ef_change` 로 발송
- `_applyAnnounceAnchor`: prev 체인이 끊겨도 최근 기억의 발표시각으로 고정 유지

**[결과]**: 핸드오프 시 사용자 경험: "예비 발표" 1번 + "발효시각 변경" 1번 (자연스러움). 이전: "예비 발표" + "주의보 발표" (이중 발표).

**[관련 시나리오]**: § 4.3 (예비 → 주의보 핸드오프).

---

### § 6.2.9 [5/22 06:50] 의심 가드 D-medium 의 silent dedup (abf8c57)

**[발견 경위]**: D-medium 의심 사례 reinforce push (10분 주기) 의 첫 회가 dedupKey 충돌로 silent skip.

**[잘못된 가정]**: dedup 키가 매번 새로 생성될 것.

**[진짜 원인]** (`abf8c57`):
- `_enqueueSuspiciousAlert` 가 동기적으로 dedupKey 빌드 시 옛 lastPushAt 사용
- 새 case 의 1차 push 가 `_sentKeys` (24h TTL) 에 박힌 키와 충돌

**[교정]**: `lastPushAt = now` 갱신을 `_enqueueSuspiciousAlert` 호출 앞으로 swap.

**[결과]**: reinforce push 1차 회복.

**[후속 파급]**: 후일 `aeae518` 로 관리자 채널 전면 비활성. 의심 가드 로직은 데이터 안전장치로 유지.

**[인지 추론 패턴]**: "silent dedup" — dedup 키가 의도하지 않은 충돌을 일으켜 push 가 사라짐. dedup 키 생성 시 의존 변수의 갱신 순서가 미묘.

---

### § 6.2.10 [5/25 14:39] 자식 깜빡임 디바운스 (9d47ed3)

**[발견 경위]**: 자식이 **해제예고 없이** 데이터에서 사라지는 케이스 관측. "일부 해제" → "추가 발효" 가짜 푸시 쌍 발사.

**[잘못된 가정]**: "데이터에서 사라짐 = 사실로 사라짐" (현재성 가정).

**[진짜 원인]**: 데이터 사라짐 ⊂ {진짜 해제, 글리치, GAP} 3-fold 분기.

**[교정]** (`9d47ed3`):
- `_applyChildReleaseDebounce(prev, curr)`: 3분간 직전 자식을 carry
- `_enrichSnapshotWithLatest`: `_childReleaseNoticeSet` (해제 통보문 자식) 수집 → 즉시 해제
- 로그: 디바운스 시작 / 깜빡임 감지(글리치) / 해제 확정 / 정상 해제(해제예고)

**[결과]**: 3분 내 복귀하면 가짜 푸시 0건. 진짜 해제는 3분 지연되어 발사 (글리치 vs 해제 구분 가능).

**[인지 추론 패턴]**: **N분 디바운스 + 직교 검증 신호** (해제 통보문 = 즉시 해제). 디바운스 단독은 진짜 해제까지 3분 늦추는 비용이 있지만 통보문 신호로 우회.

**[관련 시나리오]**: § 4.11 (partial_release).

---

### § 6.2.11 [5/25 13:19] GAP 발표대기 누락 (adab23e)

**[발견 경위]**: 5/25 오전 제주 zones 가 단체로 예비→발표 전이. GAP 동안 다중 결함 4건 동시 노출.

**[잘못된 가정]**: warn/list / warn/ready / warn/latest 가 한 zone 에 대해 일관된 상태를 보여줄 것.

**[진짜 원인]**: GAP = MMIS 의 endpoint 4 종 어디에서도 해당 zone 이 잠시 사라지는 구간. 그 사이 warn/latest 가 "부모만" 주고 자식 행이 없어 자식 누락.

**[교정]** (`adab23e`, 일괄 4건):
- A. GAP 자식 prev 이어받기: `_enrichSnapshotWithLatest` 가 prev (예비 때) 자식을 발표대기로 carry
- B. 예비 의심 제외: 예비 zone 사라지는 건 정상 (취소/발표전이) 이므로 의심 cycle 에서 제외
- C. 의심 가드 자식 복원: 부모만 복원하던 것 → prev.children 도 복원
- D. 발표대기 해제예정 표시: 발효 전 (isPreliminary) 이면 무조건 숨기던 것 → 실제 해제예고 값 있으면 표시

**[결과]**: 단체 전이 GAP 시 자식 정보·해제예정 모두 정확 표출.

**[후속 파급]**:
- `f9e4340`: prev 비어있는 경우 PARENT_TO_CHILDREN 매핑으로 합성
- `0049f2a`: warn-sasc/latest 1순위 격상 (개별 통보문)

**[인지 추론 패턴]**: "원자성 가정" — endpoint 간 분산 상태를 다루는 방법은 cross-fill + 시간 메모리 다층.

**[관련 시나리오]**: § 4 의 GAP 시나리오 일체.

---

### § 6.2.12 [5/26 01:10] 발표시각 anchor (451f48e)

**[발견 경위]**: 발표시각 (tmFc) 이 통보문마다 갱신되고 있었음. 사용자가 "왜 발표시각이 자꾸 바뀌지?" 혼란.

**[잘못된 가정]**: 매 통보문이 새 "발표" 사건.

**[진짜 원인]**: 변경/연장 통보문도 `tm_fc` 를 자기 발행 시점으로 채워 옴 → 직전 통보문의 tmFc 가 덮어써짐.

**[교정]** (`451f48e`):
- `_applyAnnounceAnchor(prev, curr)`: 직전 cycle 에 같은 종류·동급이 있으면 그 tmFc 이어받음
- 신규/격상격하/종류변경이면 현재 tmFc 가 새 앵커
- 부모·자식 모두 적용. 스냅샷 체인에 영속.

**[결과]**: 풍랑주의보 발효 후 시각 변경 5회 → 발표시각 row 는 최초 발표시각 1개만 표시. 격상/격하/종류 변경 시점에만 새 등급의 발표시각으로 재설정.

**[한계]**: 콜드스타트로 예비를 못 본 채 발효부터 관측하면 그때 tmFc 가 앵커 (best-effort).

**[인지 추론 패턴]**: "사용자 시점의 데이터 의미 vs API 시점의 데이터 의미". API 는 매 통보문을 갱신하지만, 사용자는 "이 특보의 처음 발표 시점" 을 알고 싶음. 시점 의미를 보존하려면 메모리 필요.

**[관련 시나리오]**: § 5.2.3.

---

### § 6.2.13 [5/26 01:16] 다가오는 특보 병렬 표출 (5213c83)

**[발견 경위]**: 발효중 해역에 다른 등급/종류의 예비특보가 와도 "발효 우선" 으로 드롭. 주의보 발효중 + 경보 예비 동시 진행 → 사용자는 경보 예비를 못 봄.

**[잘못된 가정]**: 한 zone 의 phase = 발효 또는 예비 단일 상태.

**[진짜 원인]**: zone 당 phase 가 2 개 병렬 가능 (발효 주의보 + 예비 경보 같이).

**[교정]** (`5213c83`):
- `StateSnapshot.upcomings` Map 신설 (+ JSON 영속)
- `_buildSnapshotFromMarine`: 발효중 zone 의 공존 예비를 드롭 대신 upcomings 에 보관
- `_buildZoneTreeFromSnapshot`: leaf.current(발효) + leaf.upcoming(공존 예비) 동시 채움
- `_buildUserPushChanges`: 공존 예비도 UPCOMING_CHANGE 푸시 (발효는 재발사 안 함)
- `_applyAnnounceAnchor`: 격상/격하 발효 시 직전 공존 예비의 발표시각을 새 발효 등급에 인계

**[결과]** (사용자 효과):
- 부모 카드 뱃지: 빨강 `풍랑 주의보` + [다가오는 특보] 헤더 + `풍랑 경보 예정`
- 상세에 두 row 분리 (현재 발효 + 다가오는 특보)
- 새 푸시: `📢 풍랑 경보 발표`

**[인지 추론 패턴]**: 모델 확장 — "같은 zone 의 같은 특보 종류라도 등급/phase 가 여럿 가능".

**[관련 시나리오]**: § 5.2.2.

---

### § 6.2.14 [5/24 15:19] ADMIN_PUSH_ENABLED=false 결정 (aeae518)

**[발견 경위]**: 5/24 작업2 (`378d64a`) 로 사용자 푸시에 자식 한정사 토글이 포함된 후, 관리자(dmdw) 채널이 **중복** 상태가 됨. 관리자 폰에 사용자 push + dmdw push 가 이중으로 도착.

**[잘못된 가정]**: 양 채널은 다른 정보를 전달해야 한다고 가정.

**[진짜 원인]**: 자식 한정사가 사용자 푸시에 통합되어 두 채널이 사실상 동일 정보 전달.

**[교정]** (`aeae518`):
- `ADMIN_PUSH_ENABLED = false` 게이트 도입
- `runDiffAndPush` 호출 skip
- `_enqueueSuspiciousAlert` early return
- `_enqueueImmediateRelease` 의 dmdw 발사 skip (prev 정리는 유지)
- **의심 가드 로직 자체는 유지** (데이터 안전장치)

**[결과]**: 관리자 폰 중복 알림 종료. 단 의심 데이터 가드는 작동 지속.

**[인지 추론 패턴]**: § 6.2.1 의 반대 케이스 — 한쪽 채널 누락 (T-1) vs 양쪽 모두 발사 (이번). 채널 정책 관리의 양면.

---

### § 6.2.15 [5/30 22:15] mm=58/59 KMA 범위 인코딩 발견 (8a9a798)

**[발견 경위]**: MMIS `warn/ready` 의 발효예정 `tm_ef` 가 `"2026.06.01 05:58"` 처럼 정확시각 형식으로 옴. 그러나 사용자 카드는 `"05시 58분"` 으로 표시 — KMA 사이트는 `"00시~06시"`.

**[잘못된 가정]**: API 가 정확한 시간 데이터를 줄 것 (API 신뢰 가정).

**[진짜 원인]**: KMA 가 legacy 시스템과 호환을 위해 **분=58/59 = 6시간 블록 끝** 이라는 알게 모르게 끼워둔 인코딩 컨벤션을 유지. 12자리 형식엔 처리가 있었으나 점·대시 형식엔 없었음.

**[교정]** (`8a9a798`, V1):
- `formatWarningTime` (utils.js): HH:MM 분기에서 mm=58/59 면 hh 가 속한 6시간 블록 범위로 표출
- `formatWarnTimeKST` (push_helpers.js): 동일

**[결과]**: 점·대시 형식 인식. `"05:58"` → `"00시~06시"`.

**[후속 파급]**: 30분 후 § 6.2.16 의 한글 형식 누락 발견.

**[인지 추론 패턴]**: "API 신뢰 가정" — 신규 API 도 legacy 컨벤션을 유지하는 경우가 있음.

---

### § 6.2.16 [5/30 22:46] mm=58/59 한글 형식 + normalize 단계 보강 (b786ece)

**[발견 경위]**: V1 (`8a9a798`) 적용 30분 후 같은 증상 재발견. 사용자 푸시 트레이에 `"6월 1일 05시 58분"` 표시.

**[잘못된 가정]**: V1 이 모든 경로를 잡았을 것.

**[진짜 원인]**: 서버 `normalizeMmisTime` 이 `"2026.06.01 05:58"` → `"2026년 06월 01일 05시 58분"` 으로 변환하면서 분=58 유지 → 프론트 `formatWarningTime` 의 **한글 시각 경로** (H시 M분) 에서 `fmtExact` 가 실행되어 `"6월 1일(내일) 05시 58분"` 으로 표시.

V1 의 결함: 변환 사슬의 첫 단계 (normalize) 와 다른 분기 (한글 경로) 가 패치되지 않음.

**[교정]** (`b786ece`, 3층 방어):
- `marine_warning_crawler.js normalizeMmisTime`: 분=58/59 감지 시 그 시점에 6시간 블록 범위로 변환
- `js/utils.js formatWarningTime` (H시 M분 경로): 동일 보강
- `services/push_helpers.js formatWarnTimeKST` (H시 M분 경로): 동일 보강

**[결과]**: 4 단계 (서버 normalize + 12자리 + 점·대시 + 한글) 모두 동일 정책으로 통일.

**[인지 추론 패턴]**: **"방어 깊이 (defense in depth)"** — 한 단계만 패치하면 다른 경로로 회귀. 동일 정책은 모든 변환 단계에 적용해야 함.

**[trade-off]**: KMA 가 실분=58/59 를 의도해 쓰는 경우 (운영 미관측) 가 있다면 6시간 블록으로 오표시. 그러나 실측상 그런 케이스 없어 수락.

**[관련]**: § 5.5.5.

---

### § 6.2.17 [6/1 오늘] E-1 가드 over-fire 발견 → 6df054a 의 후속 검증

**[발견 경위]**: 장기간 무특보 후 새 특보 발효 시 "첫 부팅 — push skip" 가드가 **정상 발표 푸시까지 차단**. 사용자가 침묵.

**[잘못된 가정]** (`a515853` V2 5/22): "빈 snapshot 가드 조건에서 isFirstLoad 제거" — E-4 partial fail 후 빈 snapshot 으로 lazy set 된 케이스도 폭주 위험. 그래서 isFirstLoad 조건을 풀어 "빈 prev 면 무조건 skip".

**[진짜 원인]**: 장기간 무특보 = prev 가 텅 빈 상태로 누적된 상태에서, 어느 사이클에 새 특보가 발효되면 가드가 이를 "첫 부팅" 으로 오해.

**[교정]** (`6df054a` V3, 5/30):
- `isFirstLoad` 조건 다시 추가 — `isFirstLoad && _isSnapshotEmpty(prev)` 일 때만
- 재배포/장부 초기화 직후 콜드 부팅 1회만 차단
- 자연 전이 (이미 가동 중 프로세스에서 무특보→신규특보) 는 통과

**[결과]**: 자연 전이 푸시 복원. 콜드부팅 폭주 차단 유지.

**[보강]** (동일 시점, `c94ea5e`):
- 관리자 UI '전체 사용자 재발송' 버튼 (broadcastAll)
- 가드 우회 명시적 액션 제공

**[인지 추론 패턴]**: **"방어막이 정상 신호도 막는 false positive"** — 단순화한 가드 (V2) 가 보수적이었지만 운영적으로는 부정확. 두 조건의 conjunction (V3) 으로 정밀화.

같은 가드의 V1 → V2 → V3 가 9일에 걸쳐 두 번 뒤집힘 → 운영 실측 없이는 어떤 가드도 안정화 불가.

---

### § 6.2.18 [5/30 22:36] broadcastAll endpoint + UI 버튼 (c94ea5e)

**[발견 경위]**: E-1 가드를 V3 로 정밀화한 후에도 "이미 가동 중 + 새 특보 발생" 자연 전이가 잘 동작하는지 명시적으로 검증할 수단이 필요.

**[교정]**:
- `/api/admin/marine/reset` 의 `broadcastAll` 플래그
- 관리자 UI 빨간 버튼 (2단계 confirm)
- adminToken 무시 + 전체 사용자 강제 발송

**[결과]**: 관리자가 직접 트리거 가능. 가드 우회 안전망.

**[관련]**: § 4.21 (관리자 테스트 푸시).

---

### § 6.2.19 [5/30 ~ 6/1] broadcastAll 후 침묵 푸시 진단

**[발견 경위]**: `broadcastAll=true` 호출 후에도 일부 사용자가 푸시를 못 받는 케이스.

**[잘못된 가정]**: broadcastAll 이 모든 게이트를 우회할 것.

**[진짜 원인]**:
- 야간 토글 OFF 인 사용자는 22~07시 차단
- master 토글 OFF 인 사용자는 전체 차단
- `night/master` 게이트는 broadcastAll 과 무관하게 작동
- 또한 announce/active/release 등 시나리오 토글도 적용

**[교정]**: 명시 — broadcastAll 은 콜드부팅 가드만 우회. 사용자별 토글은 정상 작동. 운영 매뉴얼에 기재.

**[인지 추론 패턴]**: "전체 발송" 의미 모호성. broadcastAll = "콜드부팅 가드 우회" 이지 "모든 사용자 게이트 우회" 가 아님.

---

### § 6.2.20 [5/26 15:26] 3분 시각변경 디바운스 (eb06efe)

**[발견 경위]**: HOLD 시리즈 적용 후에도 잔여 진동 푸시 발사.

**[잘못된 가정]**: HOLD 만으로 모든 깜빡임 차단.

**[진짜 원인]**: HOLD 가 직전 정확값을 유지하지만, MMIS 가 값 자체를 흔들거나 5분+ 공백 시 HOLD 메모리가 빠짐.

**[교정]** (`eb06efe`):
- `_debounceTimeValues(curr)`: zone|field 별 확정값/펜딩 추적
- 새 시각값이 3분 (연속) 유지될 때만 변경/연장 푸시 발송
- 그 전엔 직전 확정값으로 되돌려 표출·푸시·연장플래그 모두 보류
- 값이 진동(A→B→A) 하면 확정 안 되어 푸시 0건
- 최초값(신규 발표/발효) 은 즉시 수락
- `_sameReleaseMoment` 로 형식 차이는 변경으로 안 봄

**[결과]**: 잔여 진동 푸시 0건. 진짜 변경 시 3분 지연 발사 (안정성 우선).

**[인지 추론 패턴]**: HOLD (정확값 고정) + 디바운스 (시간 지연 확정) = 메모리 다층의 마지막 펜스.

**[관련 시나리오]**: § 4.8, § 4.9.

---

### § 6.2.21 [5/24 14:35] 표출 통일 시리즈 (640fd12)

**[발견 경위]**: 앱과 푸시의 발표/발효/해제 시각이 각자 다른 포맷 — `"18:00:00"` (초까지), `"2026-05-26 18:00"` (ISO), `"5월 26일(내일) 18시"` (자연어), 범위 끝 `"00시"` vs `"24시"`.

**[잘못된 가정]**: 각 출구가 자기 포맷 유지해도 무방.

**[진짜 원인]**: 출구가 5개라는 사실이 사용자에게 보이지 않음. 사용자는 "왜 푸시는 24시인데 카드는 00시야?" 식의 미세 불일치를 인지.

**[교정]** (`640fd12` + 5 후속):
- `formatWarningTime` 재작성 (utils.js) — 분·초 제거, 월 포함, 상대일자 라벨, 범위 끝 0→24, degenerate 6h 스냅
- `js/render.js` / `js/render_coastal.js` / `js/ocean_warn_active5.js` / `services/push_helpers.js` 모두 위임
- `5ea305b`: 관리자 푸시도 통일
- `a05c3d2`: 푸시 도착 상세 팝업도 통일 (C5 누락 보완)
- `0aa4ccd`: 해제예정 "일" 만 있는 값 — 월·라벨 추론 + 시·분 2자리 패딩
- `2829a0e`: 푸시 전용 라벨 제거

**[결과]**: 5 출구 모두 같은 골격 통과. 푸시만 라벨 차이.

**[인지 추론 패턴]**: "통일 = 단일 함수 + 출구별 분기 옵션". 모든 출구를 한 함수에 위임 + 출구별 차이는 옵션(라벨 유무) 으로.

**[관련]**: § 5.5, § 5.10.

---

### § 6.2.22 [5/22 ~ 5/24] V/T allowlist 정책 강제 (ff1fe17)

**[발견 경위]**: 강풍(W) 16건·폭풍해일(O) 0건 유입 확인 — 라이브 데이터.

**[잘못된 가정]**: `'warn_tp===5'` (숫자 폭풍해일 제외) denylist 가 동작할 것.

**[진짜 원인]** (이중 결함):
- 숫자 비교 (`===5`) 는 MMIS 의 문자 코드 (`'V'`/`'T'`/`'W'`/`'O'`) 에 무력
- denylist 구조라 정의되지 않은 새 코드는 다 통과

**[교정]** (`ff1fe17`):
- `REALTIME_TARGET_TP = new Set(['V', 'T'])` allowlist
- 풍랑(V), 태풍(T) 만 통과. 강풍(W), 폭풍해일(O) 차단

**[결과]**: 강풍/폭풍해일 유입 0건.

**[인지 추론 패턴]**: "이관 무결성 가정" — 옛 시스템의 가드 (`warn_tp===5`) 가 새 시스템에서도 작동할 것이라는 잘못된 가정. 데이터 형식 변화 (숫자→문자) + 정책 구조 변화 (denylist→allowlist) 동시 검토 필요.

---

### § 6.2.23 [5/24 14:35 이후 ~ 6/1] formatWarningTime 의 보조 분기 추가 (a05c3d2, 0aa4ccd)

**[발견 경위]**: `640fd12` 표출 통일 후에도 일부 케이스 누락:
- 푸시 도착 상세 팝업이 옛 포맷 유지 (C5)
- 해제예정 "일" 만 있는 값이 "정보 없음" 으로 처리되어 표시 안 됨

**[교정]**:
- `a05c3d2`: `fix_popup_logic.js formatDateTime` 가 `window.formatWarningTime` 위임
- `0aa4ccd`: `formatWarningTime` 의 `D일 rest` 분기 — 가장 가까운 미래 날짜로 year/month 추론 + 시·분 2자리 패딩

**[결과]**: 5 출구 모두 동일 함수 통과 + edge case (월 누락 입력) 도 적절 표시.

---

## 6.3 같은 문제 반복 패턴

### 6.3.1 mm=58/59 fix 의 4 단계 확장

| 단계 | 입력 형식 | 출력 | 커밋 | 시간 간격 |
|---|---|---|---|---|
| 1차 | `202606010558` (12자리 raw) | "00시~06시" | (기반) | — |
| 2차 | `2026.06.01 05:58` (점·대시) | "00시~06시" | `8a9a798` | 31분 후 |
| 3차 | `06월 01일 05시 58분` (한글) | "00시~06시" | `b786ece` (utils + push_helpers) | — |
| 4차 | `normalizeMmisTime` 단계까지 | "2026년 06월 01일 00시~06시" | `b786ece` | (동일 커밋) |

**패턴**: 동일 정책이 변환 사슬의 각 단계마다 별도로 적용되어야 함. 한 단계만 패치 시 다른 경로로 회귀. **"방어 깊이"** 원칙.

### 6.3.2 정확값 고정이 해제 → 발효 → 핸드오프로 확장

| 시점 | 작업 | 범위 |
|---|---|---|
| 5/26 14:17 | `7c981d1` | warn/latest 깜빡임 가짜 푸시 차단 |
| 5/26 14:45 | `b05ce1f` | 해제 HOLD + 윈도우 |
| 5/26 15:01 | `5ded869` | 발효 HOLD (대칭) |
| 5/26 15:16 | `a7bc5c9` | 핸드오프 공백 보강 + 자식 HOLD |
| 5/26 15:26 | `eb06efe` | 3분 디바운스 (잔여 진동) |

**패턴**: 한 안전망 추가 → 다른 코너 케이스 노출 → 다음 안전망. "메모리 다층화" 의 누적 — 5/26 하루 8커밋 / 70분.

### 6.3.3 자식 독립이 데이터 → 시각 → 메타 → 영구 유지로 확장

| 시점 | 작업 | 범위 |
|---|---|---|
| 5/22 05:07 | D-6 (B) | 자식 → 부모 fallback (가정 1) |
| 5/25 13:19 | `adab23e` | GAP 자식 prev carry |
| 5/25 13:33 | `f9e4340` | PARENT_TO_CHILDREN 합성 fallback |
| 5/25 13:40 | `0049f2a` | warn-sasc/latest 1순위 |
| 5/25 13:59 | `3705f4a` | 부모 fallback 전면 제거 (원칙) |
| 5/25 14:21 | `f499308` | 자식 종류·등급도 독립 |
| 5/25 14:39 | `9d47ed3` | 자식 디바운스 3분 |
| 5/25 15:33 | `374923d` | 자식 단독 연장 |

**패턴**: "자식 = 부모의 종속" 가정에서 출발 → 모든 영역에서 자식 독립으로 전환. 3일에 걸쳐 1 원칙 확립 → 데이터 → 푸시 → 안전망 순서로 확장.

### 6.3.4 자식 표출 정확화 V3 시리즈

| 단계 | 커밋 | 누락 사례 | 핵심 변경 |
|---|---|---|---|
| V3 | `57eae43` | 빈 값 row 자체 미표시 | 발표 시각 = 첫 수집 - 1분 영구 유지 |
| V3.1 | `e20ddf6` | 범위형 tmEf | isPrelim 강제 + 발효시각 row 미표시 |
| V3.2 | `7a09572` | "예정" 표기 | 발효 전 라벨 '예비' 통일 |
| V3.3 | `3c2d0aa` | digit fallback 오인 | 범위형 가드 |

**패턴**: 점진적 정확화. 매 단계마다 직전 단계가 남긴 작은 결함을 후속이 잡아냄. V3 → V3.3 의 6단계 진화는 "느슨한 파서" 의 silent 통과 위험 사례.

### 6.3.5 같은 가드의 두 번 재정의 — E-1

| 시점 | 정의 |
|---|---|
| V1 (`baf34fa` 5/22 03:22) | `isFirstLoad + 빈 prev` |
| V2 (`a515853` 5/22 05:07) | `빈 prev` (isFirstLoad 제거) |
| V3 (`6df054a` 5/30 22:33) | `isFirstLoad + 빈 prev` (V1 복귀 + 정밀화) |

**패턴**: 가드 강화 (V1→V2) 가 false positive 유발 → 정밀화 (V2→V3). 9일에 걸쳐 두 번 뒤집힘. 운영 실측 없이는 어떤 가드도 안정화 불가.

---

## 6.4 인지 패턴 카탈로그

### 6.4.1 단일 출처화 후 인접 시스템 단절 검증 누락

`082da8e` v7 통합 → 사용자 푸시 채널 끊김 (4시간 침묵). 큰 머지 직후 인접 시스템 (다른 push 채널, 옛 데이터 구조 호환 등) e2e 검증이 누락되기 쉬움.

**해결**: 큰 머지 직후 30분간 모든 채널 1건씩 e2e 발사 확인.

### 6.4.2 범위 vs 정확값 의미론 혼동

연장 정의에서 "더 늦은 시각" 만 보고 범위→정확 확정도 연장으로 잡음. 정보이론적으로 "더 늦어짐" ≠ "불확실성 감소".

**해결**: 모멘트 동치성 (`_sameReleaseMoment`) + 형식별 분류 + 의미별 분기.

### 6.4.3 한 가드에 두 책임 부여 (콜드부팅 + 빈 prev)

E-1 가드가 "빈 prev 면 무조건 skip" 으로 단순화되면서 콜드부팅 + 자연 전이 둘 다 차단. 두 책임을 분리해야 함.

**해결**: 조건의 conjunction (`isFirstLoad && _isSnapshotEmpty(prev)`).

### 6.4.4 버그 표면화 시 데이터 글리치로 오인

자식 디바운스 3분 케이스 — 자식 깜빡임이 진짜 해제인지 글리치인지 구분 불가했던 초기. 데이터 사라짐 ⊂ {진짜, 글리치, GAP} 3-fold 인데 처음엔 진짜만 가정.

**해결**: 직교 검증 신호 (해제 통보문 = 즉시 해제) + 시간 디바운스.

### 6.4.5 기본값 보존 가정 깨짐 — prev_snapshot 콘텐츠 상태

핸드오프 케이스 — 직전 cycle 의 prev 가 빈 채로 들어옴 (1사이클 공백) → "신규" 오인. prev 의 콘텐츠 상태를 "최근 일정 시간의 메모리" 로 보강해야 함.

**해결**: `_extensionMemory` 5분 창 + `_applyAnnounceAnchor` 메모리 참조.

### 6.4.6 채널 통합 후 중복 전송

T-1 (한쪽 채널 누락) 의 반대 케이스 — `aeae518` 의 양쪽 모두 발사. 채널 정책은 통합되면 한쪽을 전면 비활성하는 결정이 필요.

**해결**: 명시적 게이트 (`ADMIN_PUSH_ENABLED = false`) + 안전망 로직만 분리 유지.

### 6.4.7 표시와 로직의 silent 어긋남

야간 22 vs 23, 자식 정확값 vs 범위형, mm=58/59 등. 사용자가 보는 라벨/숫자와 코드의 실제 동작이 silent 로 어긋나면 신뢰 손상.

**해결**: UI 라벨과 코드 상수의 1:1 매핑 검증. 변환 사슬의 모든 단계에 동일 정책 적용.

### 6.4.8 느슨한 파서의 silent 통과

V3.3 의 digit fallback 케이스 — 범위형 입력 "2026년 05월 21일 오전(06시~12시)" 의 앞 12자리만 잘라 잘못 파싱. silent 한 잘못된 통과는 후속 회귀 위험.

**해결**: 입력 형식 가드 (`_isExactSingleTime`) + fail-loud 정책.

### 6.4.9 이관 무결성 가정

옛 시스템에서 잘 되던 가드 (`warn_tp===5` 숫자 비교) 가 새 시스템 (문자 코드) 에서도 작동할 것이라는 잘못된 가정. denylist→allowlist 의 정책 변경도 동시 필요.

**해결**: 이관 시 데이터 형식 + 정책 구조 두 차원 동시 검토.

### 6.4.10 단일 진리원 가정 vs 분산 상태

warn/list + warn/latest 의 관계 발견 (V10) — 한 API 호출로 모든 정보를 얻는다는 가정의 깨짐. 같은 zone 의 정보가 endpoint 별로 다른 view.

**해결**: cross-fill (각 endpoint 의 정보를 보강), 명시적 source 표시.

### 6.4.11 방어막이 정상 신호 차단 (false positive)

E-1 V2 의 "빈 prev = 무조건 skip" — 보수적이지만 정상 자연 전이까지 막음. 방어막 정밀화 필요.

**해결**: 조건 conjunction + 명시적 우회 경로 (broadcastAll).

### 6.4.12 N분 디바운스의 비용

자식 해제 디바운스 3분, 시각 변경 디바운스 3분 — 진짜 변경/해제까지 3분 늦춰지는 비용 발생. 직교 검증 신호 (해제 통보문) 로 일부 우회.

**해결**: 디바운스 + 직교 신호 병행. 신호 강한 케이스는 즉시 처리.

### 6.4.13 점진적 정확화 (V1 → V2 → V3 ...)

mm=58/59 (4 단계), 자식 표출 (V3 → V3.3), HOLD 시리즈 (8 커밋), E-1 가드 (V1→V2→V3) 등. 매 단계마다 직전이 남긴 코너 케이스를 후속이 잡아냄.

**해결**: 운영 실측 + 점진적 패치. 한 번에 완벽 해결 가정하지 않음.

### 6.4.14 dedup 키의 silent 충돌

D-medium reinforce push silent skip — dedup 키 생성 시 의존 변수의 갱신 순서가 미묘하면 push 가 사라짐.

**해결**: 키 생성 직전 의존 변수 명시적 갱신 + 로그.

### 6.4.15 트레이 vs 즉시 열람 시점 차이

푸시 본문에 상대일자 라벨 미사용 — 트레이에 며칠 남아 있으면 "오늘/내일" 이 부정확. 출구별 시점 가정을 인식하고 포맷을 분기.

**해결**: 출구별 dateLabel 함수 분리 (formatWarningTime vs formatWarnTimeKST).

---

## 6.5 § 5 ↔ § 6 cross-link

표출 정책은 시행착오의 결과물이다. 표 형식으로 매핑:

| § 5 의 정책 | § 6 의 시행착오 |
|---|---|
| 5.1 5 출구 통일 | 6.2.21 표출 통일 시리즈 (640fd12) |
| 5.2.3 발표시각 anchor | 6.2.12 발표시각 anchor (451f48e) |
| 5.2.2 다가오는 특보 병렬 | 6.2.13 병렬 표출 (5213c83) |
| 5.3.1 isCoastal 분기 (isExactSingleTime) | 6.3.4 자식 표출 V3.1~V3.3 |
| 5.3.4 자식 카드 클릭 비활성 | (사용자 정책 결정 — § 6 에 별도 표면화 없음) |
| 5.4 화살표 미표시 | (사용자 정책 결정) |
| 5.5.5 mm=58/59 4 단계 | 6.2.15 V1 + 6.2.16 V2 + 6.3.1 |
| 5.6 상대일자 라벨 | 6.2.21 (640fd12) |
| 5.7 시간대 명칭 | 6.2.1 P4 (6fcbdb5 DMDW 실측) |
| 5.9 자식 한정사 토글 | 6.2.2 (3705f4a, f499308) |
| 5.10 푸시 vs 팝업 라벨 차이 | 6.2.21 (2829a0e, a05c3d2) |
| 5.11 야간 차단 | 6.2.1 + 6.4.7 (a0d8ba3 라벨 일치) |

---

## 6.6 271 커밋의 분포

본 브랜치 (`main..claude/kma-website-reference-KYLtf`) 의 272 커밋을 카테고리별로 분류:

| 카테고리 | 비중 | 대표 커밋 |
|---|---|---|
| Phase 0/1 (legacy 통보문, dmdw, subregion) | ~80건 | `2b39615`, `1743a3e`, `de1ad1a` |
| Phase 2 marine 통합 핵심 | ~50건 | `082da8e`, `9651167`, `dbe2c6b`, `ff1fe17` |
| HOLD/디바운스 시리즈 (5/26) | 8커밋 | `7c981d1`, `b05ce1f`, `5ded869`, `a7bc5c9`, `eb06efe`, `451f48e`, `5213c83`, `fe0bda5` |
| 자식 독립화 (5/25) | 10커밋 | `adab23e`, `f9e4340`, `0049f2a`, `3705f4a`, `f499308`, `9d47ed3`, `374923d`, `7821092`, `2a21b9c`, `5a9e111` |
| 표출 통일 시리즈 | ~10건 | `640fd12`, `5ea305b`, `a05c3d2`, `0aa4ccd`, `2829a0e` |
| 자식 표출 V3 시리즈 | 6커밋 | `57eae43`, `e20ddf6`, `7a09572`, `3c2d0aa` |
| mm=58/59 시리즈 | 4커밋 | `8a9a798`, `b786ece` |
| 정규식 진화 (예비 해제) | 4커밋 | `5f62ebb`, `526cc7c`, `e1077ac`, `dd5b1d9` |
| 의심 가드 시리즈 | 5커밋 | `c761225`, `8998037`, `abf8c57`, `aeae518` |
| 지도 폴리곤 시리즈 | 8커밋 | `f70b961`, `5391d10`, `03d74e7`, `e83d8d8`, `0f15a3a`, `3e886d9` 등 |
| UI/관리자 페이지 | ~30건 | `6ba1a95`, `253ae97`, `c94ea5e`, `0a1cf5c` 등 |
| 종합 히스토리 문서 | 2커밋 | `8aad5c8`, (본 작업) |
| 기타 (test, docs, chore) | 나머지 | |

---

## 6.7 끝맺음 — 시행착오에서 얻은 3 핵심 통찰

1. **표출 정책은 변환 사슬 모든 단계에 동일하게 적용해야 한다.** mm=58/59 의 4 단계 fix, 자식 정확값 정책의 V3 → V3.3 진화가 이를 보여준다. 한 단계만 패치하면 다른 경로로 회귀.

2. **상태 메모리는 다층으로 필요하다.** HOLD (직전 정확값) + 윈도우 (범위 끝) + 5분 메모리 (`_extensionMemory`) + 3분 디바운스. MMIS 의 endpoint 간 분산 상태와 노이즈를 다루려면 한 층의 안전망으로 부족.

3. **자식 독립 원칙이 표출 정확성의 기반.** 부모 fallback 가정 폐기 (5/25) 가 자식 단독 푸시, 자식 정확 시각, 자식 단독 연장 모두를 가능하게 함. 부모/자식의 데이터 출처 분리가 모든 후속 정확화의 전제.

# § 7. 현재 상태

본 § 는 **2026-06-02 시점**의 MMIS 통합 시스템 현재 상태를 정리한다. 안정적으로 동작하는 영역, 직전 세션(2026-05-30, "오늘") 에 적용된 fix 3건과 그 영향, 알려진 edge case, 진단·운영 메타, 향후 개선 후보의 5 절로 구성된다.

용어 정의는 모두 § 8.1 단일 용어집을 참조하라 (본 § 7 내에서 용어 정의는 하지 않는다).

---

## § 7.1 안정적으로 동작하는 부분

본 시스템에서 **운영 실측으로 검증되었고, 가드/디바운스/HOLD 가 정상 신호를 보호하고 있는** 영역을 정리한다. 4 초안의 §6 안정 영역 합집합이다.

### § 7.1.1 정상 lifecycle 푸시 흐름 (예비 → 발효 → 해제)

- **무엇이 안정적인가**: warn/ready 에 예비 등장 → 1분 cron 에서 publish 푸시 → warn/list 로 이동 시 active 푸시 → warn/list 에서 사라지고 clrNtcTm 정상 등록 시 release 푸시.
- **보호 가드/디바운스**:
  - `_applyAnnounceAnchor` (`marine_warning_crawler.js`) — tmFc 를 lifecycle 동안 고정 (커밋 `451f48e`). → § 8.1 anchor
  - `_debounceTimeValues` 3분 디바운스 — 시각값 진동 흡수 (커밋 `eb06efe`). → § 8.1 debounce
  - `_applyTimeWindowHold` / `_applyReleaseClrLogic` / `_applyUpcomingEfLogic` — 정확값 HOLD + 윈도우 연장 판별 (커밋 `b05ce1f`, `5ded869`, `a7bc5c9`). → § 8.1 HOLD, window
- **검증 테스트**: 5/22~5/30 운영 실측 (Part C § 5 시행착오 히스토리 참조). 풍랑 V 의 예비-발효-해제 전체 lifecycle 이 침묵 fix(`9651167`) 이후 안정 작동.

### § 7.1.2 자식 추가 발효 / 일부 해제 독립 발사

- **무엇이 안정적인가**: 부모 zone 발효 상태가 변하지 않은 채 자식 zone 만 추가 발효 시 `CHILD_ADD` push (templateId `additional_active`). 마찬가지로 일부 자식만 해제 시 `CHILD_RELEASE` push (templateId `partial_release`).
- **보호 가드**:
  - `_extractParent(name)` — 부모/자식 row 혼재 응답에서 분리.
  - `PARENT_TO_CHILDREN` 정적 매핑 — 자식 한정사 빌더 입력 검증. → § 8.1 PARENT_TO_CHILDREN
  - `buildChildQualifier` (`services/push_helpers.js:533-630`) — 자식 한정사 9 분기. → § 8.1 buildChildQualifier
- **검증**: 5/25 머지 (`f499308` 자식 독립 push, `3705f4a` 부모 종속 제거) 직후 운영 실측. Part D § 4.10/§ 4.11 참조.

### § 7.1.3 warn/latest 깜빡임 HOLD 차단

- **무엇이 안정적인가**: warn/latest 가 같은 zone 의 정확 해제시각을 줬다가 다음 cycle 에 빈 값을 주는 깜빡임이 와도, 한 번 잡힌 정확값은 유지된다.
- **보호 가드**: `_applyReleaseClrLogic` 의 정확값 HOLD (커밋 `b05ce1f`). 같은 모멘트 무푸시 정책 (`7c981d1`).
- **검증**: Part C § 5.6 (해제시각 HOLD 와 윈도우 개념) 의 5/26 14:17 fix 이후 안정.

### § 7.1.4 시각변경 3분 디바운스 잔여 진동 흡수

- **무엇이 안정적인가**: tmEf/tmYn/clrNtcTm 이 짧은 시간 안에 두 값 사이를 왕복하는 진동이 와도, 3분 연속 유지된 값만 확정으로 인정해 가짜 push 차단.
- **보호 가드**: `_debounceTimeValues` (커밋 `eb06efe`).
- **검증**: 5/26 15:26 fix 이후 운영. Part C § 5.6 참조.

### § 7.1.5 자식 글리치 vs 진짜 해제 디바운스 (3분)

- **무엇이 안정적인가**: 자식 zone 이 warn-sasc 응답에서 사라져도 3분간 carry. 3분 내 복귀 시 `⚡ 자식 깜빡임 감지(글리치)` 로그 후 가짜 해제 차단. 3분 경과 후에도 부재 시 진짜 해제로 확정.
- **보호 가드**: `_applyChildReleaseDebounce` (커밋 `9d47ed3`). 단, `_childReleaseNoticeSet.has(child)` (해제 통보문 신호) 인 경우 즉시 발사.
- **검증**: 5/25 14:39 fix 이후 운영. Part A § S-CHILD-FULLRELEASE / § S-CHILD-BLINK, Part C § 5.11 참조.

### § 7.1.6 의심 가드 정상 해제 보호 (D-medium)

- **무엇이 안정적인가**: clrNtcTm 없이 3+ zone 이 동시에 사라지면 release push 를 발사하지 않고 보류, 관리자 결정 대기. 한편 mmis 응답이 회복되면 `currentCase auto-reset` 으로 정상 복귀.
- **보호 가드**: `_applySuspiciousGuard` (커밋 `c761225`, `8998037`, `abf8c57`).
- **검증**: 5/22 06:07 도입 후 5/22 06:50 silent dedup 차단 fix 까지 누적 안정화.

### § 7.1.7 E-1 가드 콜드부팅 + 활성 특보 폭주 차단

- **무엇이 안정적인가**: 재배포 직후 prev 가 빈 상태에서 활성 특보 다수가 한꺼번에 신규로 분류되는 폭주를 차단한다. (`6df054a` fix 이후) **콜드 부팅 1회**에 한정되어 자연 전이는 막지 않는다.
- **보호 가드**: `_isSnapshotEmpty(prev) && isFirstLoad` 조건 — 한 cycle 만 발동.
- **검증**: 2026-05-30 22:33 fix 이후 운영. 무특보 → 신규특보 전이 push 복원 완료. § 7.2.1 참조.

### § 7.1.8 E-4 부분 fetch 실패 cycle skip

- **무엇이 안정적인가**: 4 endpoint(`warn/list`, `warn/ready`, `warn-sasc/list`, `warn-sasc/ready`) 중 일부만 실패하면 한 cycle 통째로 skip하여 직전 prev 상태를 그대로 유지. 부분 데이터로 false-release push 가 발사되는 것을 막는다.
- **보호 가드**: `fetchAllRealtimeEndpoints` 의 allSettled + `endpoint 부분 실패 — cycle skip` (커밋 `baf34fa`). → § 8.1 E-4 가드
- **검증**: 5/22 03:22 도입 후 운영 실측 다수.

### § 7.1.9 mm=58/59 KMA 범위코드 3 경로 모두 흡수

- **무엇이 안정적인가**: tm_ef 의 분 부분이 58 또는 59 인 경우는 KMA 의 레거시 6시간 범위 인코딩(00~06시 / 06~12시 / 12~18시 / 18~24시)으로 해석. 점·대시·콜론 형식 모두 인식.
- **보호 가드 (3층)**:
  - `normalizeMmisTime` (`marine_warning_crawler.js:1799`) — 서버측 정규화
  - `formatWarningTime` (`js/utils.js:118`) — 프론트 표시
  - `formatWarnTimeKST` / `fmtUserKMA` (`services/push_helpers.js:34`) — 푸시 본문
- **검증**: 2026-05-30 fix 3건 (`8a9a798` 점·대시 인식, `b786ece` normalize 보강) 이후. § 7.2.3 참조.

### § 7.1.10 GAP 보강 (warn/latest 1순위)

- **무엇이 안정적인가**: 통보문은 발행됐으나 발효시각이 미래라 warn/list / warn/ready 어디에도 없는 "발표 발효대기" 상태를 warn/latest 의 발표 통보문으로 예비 슬롯에 합성.
- **보호 가드**: `_enrichSnapshotWithLatest` 의 GAP 분기 (`2a21b9c`, `5a9e111`, `adab23e`, `f9e4340`, `0049f2a`). → § 8.1 GAP
- **검증**: 5/25 09:07~13:40 fix 누적 후 운영 안정.

### § 7.1.11 디스크 영속화 5 파일

- **무엇이 안정적인가**: fly.io 재배포 후에도 prev snapshot, 의심 가드 상태, 사용자 표출 데이터, pending push, push 이력이 영속.
- **보호**: 모두 atomic write (tmp 파일 + rename). → § 8.4 영속화 데이터 파일 5종

### § 7.1.12 사용자 옵션 토글 5종

- **무엇이 안정적인가**: `master`/`announce`/`active`/`release`/`night`/`childZones`/`zones`/`target` 옵션 모두 `routes/push.js` 의 사용자별 필터에서 정상 작동.
- **보호**: `getMatchedZones` + `expandToMinorZones` (`services/push_helpers.js`).
- **검증**: 5/24 13:34 야간 경계 22→23 fix (`a0d8ba3`) 이후 안정.

---

## § 7.2 오늘 (2026-05-30) 의 fix 3건 + 영향

본 § 는 직전 세션 (2026-05-30, "오늘") 에 적용된 3 commit 의 발견 경위, 변경 위치, 효과, 회귀 위험 평가를 정리한다.

### § 7.2.1 `6df054a` — E-1 가드 isFirstLoad 한정 (무특보 → 신규 전이 푸시 복원)

- **발견 경위**: 5/30 새벽, "어제 자정 무특보 → 첫 특보 발생 시 푸시가 안 왔다" 는 사용자 보고로 진단 시작. log grep 결과 `[Marine] 콜드 부팅 + 빈 prev — push skip` 가 모든 무특보→신규 전이에서 발동되고 있었음. 정상 전이도 차단하는 over-broad 가드 발견.
- **변경 위치**: `marine_warning_crawler.js` 의 E-1 가드 조건. 기존 `!isSnapshotEmpty(curr) && isSnapshotEmpty(prev)` → 신규 `isFirstLoad && isSnapshotEmpty(prev) && !isSnapshotEmpty(curr)`. → § 8.1 isFirstLoad
- **효과**:
  - 무특보 → 신규특보 자연 전이 push 발사 복원.
  - 재배포 직후 콜드 부팅 + 다수 활성 특보 폭주 차단은 그대로 유지 (isFirstLoad 가 보장).
  - 5/30 이전까지 침묵하던 자정 전이가 다시 정상 발사.
- **회귀 위험 평가**: **안전**. isFirstLoad 가 한 cycle 만 true 이므로 폭주 윈도우는 정확히 1회. 다음 cycle 부터 prev 가 채워지면 정상 diff 발동.

### § 7.2.2 `c94ea5e` — broadcastAll UI 버튼 + endpoint

- **발견 경위**: § 7.2.1 fix 후 미수신 사용자에게 "현재 활성 특보를 다시 한번 발사" 할 수단이 필요. 기존 `resetState` 는 관리자 토큰 받은 디바이스에만 발사. **전체 구독자 대상 escape hatch** 가 비어 있었음.
- **변경 위치**:
  - `routes/admin.js` — `/api/admin/marine/reset` 의 `broadcastAll=true` 분기 추가. `adminToken=undefined` 로 처리해 모든 구독자 대상.
  - `js/admin.js:3197` — 빨간 "전체 사용자 재발송" 버튼 + 2단계 confirm.
- **효과**:
  - 관리자가 명시 클릭 시 모든 구독자에게 현재 활성 특보 baseline 재발사.
  - 디버깅·복구·테스트용 escape hatch 확보.
- **회귀 위험 평가**: **안전**. 2단계 confirm + 빨간색 + 명시 메시지로 의도적 클릭만 통과. `_forceBaselinePending` 플래그가 cycle 경합 방어 (`5ea305b` 의 race 보호). 다만 § 7.3 의 "침묵 푸시 이슈" edge case 는 잔존.

### § 7.2.3 `b786ece` — mm=58/59 한글 형식 + normalize 보강 (3층 방어)

- **발견 경위**: `8a9a798` 로 점·대시 형식의 mm=58/59 인식을 한 번 패치했으나, 일부 사용자 화면에 여전히 `"5시 58분"` 으로 표시됨이 보고. 분기를 추적하니 `normalizeMmisTime` 직전 단계의 한글 형식 입력 (예: `"5월 30일 05시 58분"`) 이 별도 경로로 통과하고 있었음.
- **변경 위치**:
  - `marine_warning_crawler.js:1799` — `normalizeMmisTime` 의 mm=58/59 한글 분기 추가.
  - `js/utils.js:118` — `formatWarningTime` 의 한글 케이스 mm=58/59 → 6시간 블록 변환.
  - `services/push_helpers.js:34` — `formatWarnTimeKST` 의 같은 분기.
- **효과**:
  - 모든 입력 형식 (점·대시·콜론·한글) 에서 mm=58/59 → 6시간 블록 ("00시~06시") 통일.
  - 이미 디스크에 잘못 저장된 zone 은 다음 cycle 에 자연 덮어쓰기.
- **회귀 위험 평가**: **안전**. 단 § 7.3 의 mm=58/59 트레이드오프 (실제 정확시각이 58/59 분인 케이스) 는 정책상 잔존.

---

## § 7.3 알려진 edge case

본 § 는 운영 중 인지되어 있으며 향후 개선 후보 또는 정책적 trade-off 인 케이스를 정리한다.

### § 7.3.1 mm=58/59 트레이드오프

- **현상**: KMA 의 실제 발효시간이 우연히 HH:58 또는 HH:59 분인 경우, 본 시스템은 무조건 범위코드로 해석하므로 정확시각이 6시간 블록으로 오표시됨.
- **빈도**: 운영 실측상 정상 KMA 통보문은 정시(00분) 또는 30분 단위만 사용한다는 가정에 의존. 5년치 archive 분석에서 mm=58/59 가 실분으로 사용된 사례는 발견되지 않음.
- **방어**: `normalizeMmisTime` / `formatWarningTime` / `fmtUserKMA` 3층 모두에 같은 분기. 한 곳을 끄려면 명시적 토글 필요.
- **참조**: § 7.5.3, Part B § 4.22, Part C § 5.16.

### § 7.3.2 침묵 푸시 이슈 — broadcastAll 후 push 미수신

- **증상**: 관리자 UI 의 빨간 "전체 사용자 재발송" 클릭 후 `success` 응답을 받고도 사용자 기기에 푸시가 안 도착하는 사례.
- **잠정 분석** (확정 아님, MMIS transient empty 응답 가설 포함):
  1. **현재 활성 특보가 없는 경우** — `forceBaseline` 모드에서도 curr 가 비어 있으면 diff 도 비어 있어 push 그룹 자체가 안 만들어진다. `_buildUserPushChanges` 가 0 건 반환 → 침묵 통과.
  2. **MMIS 일시 공백 응답** — broadcastAll 후 다음 cycle 에 MMIS 가 transient empty 응답을 주면 위 (1) 과 같은 침묵. 다음 cycle 부터 정상 복귀하지만 그 사이 사용자는 "버튼 눌렀는데 안 옴" 으로 느낌.
  3. **사용자가 해당 zone 미구독** — `getMatchedZones` 가 교집합 빈 결과 → `userFilteredItems.length === 0` → 그 사용자 skip (`routes/push.js:292`).
  4. **야간 토글 OFF** — `user.options.night === false` + 현재 KST 23~07시 → 그 사용자 skip (`routes/push.js:362~368`). broadcast 라도 이 게이트는 적용됨.
  5. **점검 모드** — `MAINTENANCE_FILE.active=true && blockPush !== false` → `processAndSendNotifications` 가 false 반환. forceBaselinePush 경로도 maintenance 체크를 우회하지 않음.
  6. **FCM dead token** — 앱 재설치 등으로 토큰 무효화. `admin.messaging().send` 가 `messaging/registration-token-not-registered` 에러 → 사이클 끝에 정리.
  7. **pendingPushes 쌓임 + dedup** — 직전 사이클 실패 그룹이 남아 있는데 같은 templateId 의 새 그룹이 생기면 silent skip 가능성 (이론적, 추가 분석 필요).
- **권장 후속 조치**: admin reset 응답에 `pushedZoneCount` / `actualSentCount` 포함, maintenance mode 일 때 admin UI 경고 표시.

### § 7.3.3 자식 종합기상 텍스트 출처만일 때 tmEf 빈값

- **증상**: 자식 zone 의 정보 출처가 warn-sasc 의 종합기상 텍스트뿐인 경우 tmEf 가 빈 값 → 자식 카드에 발효시각 줄 미표시.
- **원인**: V3.1 의 `isExactSingleTime` (render_coastal.js:385) 정책 — 정확 단일 시각만 발효시각 row 표시. 범위형 / 시간대명 / 빈값 모두 미표시.
- **부작용**: 사용자에 따라 "발효시각이 없네?" 오해 가능. 부모 카드는 정상 표시되므로 그쪽 확인 필요.

### § 7.3.4 야간 차단 토글 OFF 사용자에게 자정 시간대 발효 미발사

- **증상**: `user.options.night === false` 사용자에게는 KST 23~07시 사이의 모든 발사가 차단됨. 자정 시간대 신규 발효 시 미수신.
- **원인**: 정책적 의도 (사용자 수면 보호).
- **참조**: 5/24 `a0d8ba3` 야간 경계 22→23 fix 이후 안정. Part C § 5.12.

### § 7.3.5 콜드부팅 1사이클 + admin reset 경합

- **증상**: 콜드 부팅 직후 첫 cycle 과 admin reset 호출이 매우 짧은 간격으로 겹치면 manual run 이 early-return 될 수 있음.
- **방어**: `_forceBaselinePending` 플래그가 다음 cycle 까지 살아있어 1회 보장 (`5ea305b` 의 리셋 경합 방어).
- **잔존 위험**: 이론적 race 잔존. 다만 운영 실측에서 발생 사례 없음.

### § 7.3.6 자식 디바운스 3분의 누적 비용

- **증상**: 진짜 해제 케이스 (해제 통보문이 안 와있는 경우) 는 항상 3분 지연 발사. 4분짜리 글리치는 가짜 푸시 발생 가능.
- **방어**: 관리자 사전등록 해제 (해제 통보문 신호) 는 즉시 발사 — `_childReleaseNoticeSet.has(child)` 우회 분기.
- **trade-off 인정**: 5/25 디자인 시점에 사용자가 명시한 정책 (3분 단위).

### § 7.3.7 E-1 partial fail 잔존 폭주 위험

- **증상**: 재배포 직후 한 cycle 안에 E-4 partial fail 이 겹치면 빈 snapshot 이 prev 로 저장되는 케이스. 그러나 isFirstLoad 는 cycle 마다 false 이므로 다음 cycle 에 가드 미발동 → push 폭주 가능?
- **분석**: 실제로는 다음 cycle 의 prev 가 비어있는 게 아니라 직전 cycle 의 (빈) snapshot 임 → `_isSnapshotEmpty(prev)` true 지만 `isFirstLoad=false` 라 가드 미발동. **이 경우 폭주 위험 잔존**.
- **빈도**: 운영 실측 미관측. 이론적 케이스.

### § 7.3.8 warn/latest 미응답 시 정확값 미보유

- **증상**: V10 의 효용은 warn/latest 가 안정적으로 응답할 때 최대. 응답 결측 시 HOLD 가 보완하지만 정확값이 처음 들어오기 전이라면 범위형으로 표시.
- **방어**: 다음 정상 응답 시 즉시 정확값 갱신.

### § 7.3.9 PARENT_TO_CHILDREN 매핑 미등록 zone

- **증상**: `MMIS_CODE_TO_NAME` 매핑 미등록 zone 은 `warn_zone_nm` fallback 으로 처리되지만 표기 차이가 있으면 매핑 실패 → `PARENT_TO_CHILDREN` 도 못 찾아 자식 한정사가 빈 값으로 나갈 수 있음.
- **방어**: 신규 자식 zone 이 KMA 측에서 추가되면 매핑 갱신 필요. 부모 코드와 자식 코드는 archive 분석으로 유지.

### § 7.3.10 warn/ef/list 미사용 — history 탭 불완전

- **현상**: `warn/ef/list` 의 timeline diff 가 없어 사용자 앱의 history 탭은 불완전.
- **원인**: 자격증명 secrets 가 비어 있는 환경에서 인증 endpoint skip. 주 기능은 정상이지만 timeline 보강은 불가 (`marine_client.js:51` `AUTH_ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED`).
- **대응**: weather_alerts.json 의 `history` 필드를 디스크에서 보존만 한다.

### § 7.3.11 showChildZones=false 사용자의 자식 단독 연장

- **증상**: 토글 OFF 사용자에게 자식 단독 연장 발생 시 부모명만 나가 오해 → 의도적 미발송 (`push_helpers.js:372-378`).
- **trade-off**: 사용자가 자식 연장 정보를 못 보게 됨 (토글 OFF 의 의도된 정책).

### § 7.3.12 pushSender 의 type 변경 (S-TYPE-UP/DOWN) 분기 누락 의심

- **현상**: `push_sender.js` 의 CURRENT_CHANGE 분기는 `prev.wrnLvl != curr.wrnLvl` 만 격상격하로 처리. wrnTp 가 다른 경우의 분기 부족 — 일반 active 로 fallback 될 가능성.
- **상태**: 관리자 채널은 type_upgrade/downgrade 별도 처리되지만 사용자 채널은 검증 필요. 현재 ADMIN_PUSH_ENABLED=false 라 관리자 채널 비활성.

### § 7.3.13 Followup Major-3 가드의 우선순위

- **현상**: 자식 set 변화 + 시각 변경 동시 발생 시 → 시각 변경 푸시 억제 (자식 set 변화 우선).
- **trade-off**: 두 변화가 모두 정보가치 있을 때 시각 변경 정보 손실 가능.

---

## § 7.4 진단·운영 메타

### § 7.4.1 로그 grep 패턴 카탈로그 (관제용)

| 패턴 | 의미 | 대응 모드 |
|---|---|---|
| `[Marine] 통합 크롤러 실행` | 매 분 cron 시작 | 정상 |
| `[Marine] ⚠️ 강제 baseline 푸시 모드` | forceBaseline 진입 (E-1 가드 우회) | broadcastAll 직후 / admin reset |
| `[Marine] 콜드 부팅 + 빈 prev — push skip` | E-1 가드 발동 | 콜드 부팅 1회 |
| `[Marine] endpoint 부분 실패 — cycle skip` | E-4 발동 | 부분 fetch 실패 |
| `[Marine] 의심 사례 신규 발생 caseId=…` | D-medium 의심 | 3+ zone 동시 사라짐 + clrNtcTm 없음 |
| `[Marine] mmis 회복 — currentCase auto-reset` | 의심 자동 회복 | 정상 복귀 |
| `[Marine] 자식 해제 디바운스 시작` | 자식 글리치 의심 carry 시작 | 3분 관찰 진입 |
| `[Marine] ⚡ 자식 깜빡임 감지(글리치)` | 가짜 해제 차단 | 3분 내 자식 복귀 |
| `[Marine] 자식 해제 확정(디바운스 … 경과)` | 3분 후 진짜 해제 | 정상 |
| `[Marine] warn/latest 보강: N zone clrNtcTm 갱신` | V10 정확값 갱신 | 정상 |
| `[Marine] warn/latest GAP 보강: N 부모 발표 발효대기 → 예비로 추가` | GAP 합성 | 정상 |
| `[Marine] HOLD …` | 정확값 고정 진행 | 정상 |
| `[Marine] 디바운스 …` | 3분 펜딩 | 정상 |
| `[PushSender] N건의 변경사항 분석 중` | push 발사 진입 | 정상 |
| `[PushSender] 점검 모드 활성화 중 → 푸시 발송 차단` | maintenance | maintenance ON |
| `[PushSender] 발송 실패 → pending 저장` | FCM 실패 → 재시도 큐 | dead token / 네트워크 |
| `[PushSender] ✅ 발송 성공: [scenario] 풍랑 주의보 (N개 구역, M명 발송)` | FCM 응답 OK | 정상 |
| `[PushSender] retry pending push group=…` | pending 재시도 | 다음 cycle |

### § 7.4.2 침묵 푸시 진단 절차

다음 순서로 확인:

1. **푸시 발사 됐는지 확인** — `local_server/data/custom_push_history.json` grep. 발사 entry 없으면 service 가 발사 자체 안 한 것.
2. **changes 빌드 결과 확인** — `[Marine] _buildUserPushChanges → N 건` 로그. 0 건이면 diff 가 비어 있음 (§ 7.3.2 의 1, 2, 3 케이스).
3. **prev snapshot 상태 확인** — `cat local_server/data/marine_warning_state.json | jq '.prev.parents'`. 콜드부팅 + 빈 prev 라면 E-1 가드 발동 가능성.
4. **MMIS 응답 상태 확인** — raw fetch 로그. transient empty 응답이라면 다음 cycle 까지 대기.
5. **사용자별 zone 필터 확인** — `routes/push.js` 의 `getMatchedZones` 결과 로그. 교집합 빈 결과면 해당 사용자 skip.
6. **야간 토글 확인** — `subscriptions.json` 의 `user.options.night` 와 현재 KST 시각 비교.
7. **maintenance 모드 확인** — `data/maintenance_config.json` 의 `active` 값.
8. **fly.io 로그 grep** — `fly logs --app seagnal-server | grep -E "(broadcast|forceBaseline|점검|push 발송 차단)"`.

### § 7.4.3 한 cycle 통째로 따라가는 절차 (재현)

1. `local_server/data/marine_warning_state.json` 백업 (prev).
2. fixed `warn_*` JSON 4세트를 marine_client 모킹.
3. `marineWarningCrawler.run({ dryRun: true })` 호출.
4. 콘솔 로그 추적 (각 단계 keyword) + 반환된 changes[] 검사.

### § 7.4.4 시나리오별 테스트 호출 스니펫

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

### § 7.4.5 의심 케이스 결정 호출

```bash
curl https://seagnal-server.fly.dev/api/admin/marine/suspicious        # 현재 case 조회
curl -X POST -d '{"decision":"normal"}' \
  -H 'Content-Type: application/json' \
  https://seagnal-server.fly.dev/api/admin/marine/suspicious/decide    # 정상 해제 결정
```

### § 7.4.6 장부 초기화 + 전체 재발송

```bash
curl -X POST -d '{"broadcastAll":true}' \
  -H 'Content-Type: application/json' \
  https://seagnal-server.fly.dev/api/admin/marine/reset
```

### § 7.4.7 점검 모드 해제

```bash
# local_server/data/maintenance_config.json 의 active 를 false 로
```

---

## § 7.5 향후 개선 후보

본 § 는 운영 실측에서 인지된 잠재적 개선 영역을 정리한다. 우선순위 없음 (참고).

### § 7.5.1 진단 로그 추가 (사용자 push 분석 시점)

`_buildUserPushChanges` 의 분기 진입 / fallback / skip 사유를 상세 로그로 출력해 침묵 푸시 진단 시간을 단축. 현재는 changes 개수만 로그.

### § 7.5.2 broadcastAll 의 race condition 보강

`_forceBaselinePending` 와 cron 의 미세 경합 시점을 명시적 lock (mutex) 으로 보강. 운영 실측 미관측이지만 이론적 race 잔존 (§ 7.3.5).

### § 7.5.3 mm=58/59 실제 발효시각 구분

KMA 가 정책 변경으로 58/59 분을 실분으로 쓰기 시작하면 즉시 회귀. 전후 통보문 비교로 실제 발효시각인지 범위코드인지 자동 판별하는 휴리스틱 추가.

### § 7.5.4 E-1 가드의 partial fail 후 빈 snapshot 케이스 정밀화

§ 7.3.7 의 잔존 위험 해소. 빈 snapshot 을 prev 로 저장하지 않는 가드 추가.

### § 7.5.5 warn/latest 의 자식판 sparse 처리

반복 결측 시 latest 결과 우선순위 명시화.

### § 7.5.6 강풍(W) 지원 추가 시 다층 분기 점검 가이드

V/T allowlist 정책 강제 (§ 8.1 V, T). 만약 사용자 요청으로 강풍을 추가하려면 `REALTIME_TARGET_TP` 만 수정. 단, 자식해역 매핑 / 표시 라벨 / 푸시 메시지 분기에 "풍랑/태풍" 하드코딩이 다수라 전수 점검 필요.

### § 7.5.7 PARENT_TO_CHILDREN 매핑 자동 갱신

KMA archive 비교로 신규 자식 zone 자동 등록.

### § 7.5.8 의심 가드 알림 채널 사용자 선택

현재 ADMIN_PUSH_ENABLED 단일 게이트. 의심 가드 알림을 별도 채널로 노출.

### § 7.5.9 admin reset 응답 메타 강화

`pushedZoneCount` / `actualSentCount` 포함해 즉시 디버깅. maintenance 모드 진입 시 admin UI 경고.

---

## § 7.6 후속 수정 타임라인 (2026-06-01 ~ 06-02) — #823 ~ #829

> 본 문서 본문(§1~§7.5)은 2026-06-01 작성본 기준이다. 이 § 는 그 이후(6/1~6/2)에 발견·수정한 내용으로, **흡수·폐지된 별도 문서 `00_docs/MMIS_특보시스템_히스토리.md`(§13)의 내용을 이 종합 문서로 통합**한 것이다. 모두 사용자 푸시·표출 정확화이며, 각 항은 독립 에이전트 검토를 거쳤다. 관련 시나리오: §4.15~4.19(격상/격하), §4.9(예비취소), §4.26~4.27(GAP), §4.21~4.22(자식 해제), §5.9(자식 한정사).

### § 7.6.1 표시 = 확정값 전환 — 범위 sticky 폐지 (#823)
- **시행착오**: 초기 설계의 "표시용 `*Disp` 범위형 sticky"가, 운영 중 **확정된 정확 시각이 옛 범위에 가려 갱신 안 되는** 문제를 드러냈다.
  - 실측: 남해동부안쪽먼바다가 ef/list상 실제 발효시각 `6/2 00시`인데 화면은 옛 `06~12시`로 고착. 푸시("발효시각 변경 00시")는 정상인데 화면만 stale → **푸시값(`tmEf`)과 표시값(`tmEfDisp`)이 분리돼 어긋남**.
  - 1차 보정(sticky 유지): 정확값이 범위 [시작,끝] 밖이면(앞당김/연장) 폐기 + **앞당김 시 `winMap`도 동기 폐기**(stale 윈도우發 가짜 "연장" 차단).
  - **근본 정정(사용자 지적)**: "명확한 시각이 나오면 발효 확정인데 왜 범위를 유지하나?" → 깜빡임의 진짜 원인(`:58` 코드↔범위)은 이미 `normalizeMmisTime`의 :58→범위 변환이 해결하므로 **범위 sticky 자체가 불필요·유해**.
  - **해결**: 표출을 **`info.tmEf`(비교/푸시용 확정값)** 로 단순화(`_writeWeatherAlertsJson`). 확정이면 정확, 예측이면 범위, 코드면 범위가 자연 표출되고 깜빡임은 `info.tmEf`의 held·디바운스가 방지. 표시·푸시값 일치.
- **교훈**: 깜빡임 방지를 위해 표시 전용 상태를 따로 둔 게 과설계. 비교값이 이미 안정(held+디바운스)되어 있으면 표시는 그걸 그대로 쓰는 게 가장 단순·정확.

### § 7.6.2 종류 격상/격하(풍랑→태풍) 사용자 푸시 누락 (#824)
- **증상**: 남해동부바깥먼바다가 풍랑경보→태풍경보(종류 격상, 등급은 둘 다 '경보')인데 푸시가 "🚨 격상"이 아니라 **"🕐 해제시각 변경 · 미정"**으로 나감.
- **원인(독립 조사 2건 일치)**: ①`push_sender` CURRENT/UPCOMING_CHANGE의 격상 판정이 **등급 문자열(`wrnLvl`)만 비교** → 등급이 같은 종류격상(경보→경보)을 못 잡고 `time_yn_change`로 빠짐. ②사용자 경로 `generateMessage`에 **`type_upgrade` 문구 부재**(관리자 `buildAdminTitle`에만 있고 `ADMIN_PUSH_ENABLED=false`로 비활성).
- **해결**: 격상 판정을 **점수(`getAlertScore`: 태풍100>풍랑10) 기반**으로 확장(`prev.wrnTp!==curr.wrnTp`면 `type_upgrade/downgrade`), `generateMessage`에 종류격상 문구 추가("풍랑경보→태풍경보 격상 발효"). 핵심은 "태풍주의보 건너뛴 점프"가 아니라 **"같은 등급에서 종류만 올라간 것을 못 잡은 것"**.

### § 7.6.3 #821~#824 통합 + 예비취소 토글 보강 (#825)
- 추가 수정 4건(#821 예비취소 제목·#822 문서·#823 표시·#824 종류격상)을 단일 PR **#825**로 통합 머지.
- 독립 검토 2건 반영: 예비취소(`prelim_cancel`)가 어떤 콘텐츠 토글에도 안 걸려 무조건 발송되던 비대칭을 **✅ 해제 계열로 보고 `release` 토글에 연동**(`routes/push.js`), 제목 `typeName` 누락 방어 폴백 `'특보'` 추가.

### § 7.6.4 예비취소 글리치 가짜발사 차단 — `_applyUpcomingCancelDebounce` (#826)
- **증상/위험**: 예비특보가 통보문 깜빡임(글리치)으로 **한 사이클 잠깐 사라졌다 재등장**하면, 사라진 사이클에 가짜 "✅ 예비취소"가 즉시 발사될 수 있었다(예비 소멸엔 디바운스·의심가드 보호 없었음 — `_classifyReleases`가 예비 소멸 제외).
- **설계(독립 에이전트 3건 만장일치)**: 검증된 `_applyChildReleaseDebounce` 패턴 이식. 예비가 **실시간·ef/list 양쪽에서 사라진 사이클**에 한해 직전 예비를 `curr`로 **3분 carry** → `currUpcoming`이 채워져 `UPCOMING_CANCEL` 분기(`!currUpcoming`)가 성립 안 함 → 가짜취소 원천 억제. **푸시 판정부 무수정.** 3분 안 재등장 시 흡수, 3분 연속 부재면 carry 중단 → 진짜취소 1회.
- **부작용 없음**: ef/list 보강·의심가드·자식 디바운스 직후 호출 → "둘 다 놓친 사이클"만 대상, 발효 승격은 `currActive` 차서 비대상. carry 블록=prev 예비 그대로 → `blockEqual` 무변화 → 다른 푸시 무영향.
- **호출 순서**: `_applySuspiciousGuard` → `_applyChildReleaseDebounce` → **`_applyUpcomingCancelDebounce`** → `_applyAnnounceAnchor` → … → `_buildUserPushChanges`.

### § 7.6.5 발효중 해역의 공존 격상/격하 "발표" 누락 — `_tryAddCoexistingUpcoming` (#826/#827)
- **증상**: 제주도남동쪽안쪽먼바다가 **풍랑주의보 발효중**에서 **풍랑경보로 격상(09시 발표, 11시 발효예정)**됐는데, **09시 "격상 발표"(다가오는 경보) 푸시가 안 오고** 11시 발효 푸시만 도착. "다가오는 특보" 표출도 비어 있었다.
- **원인(독립 조사 2건 일치)**: 발표대기 보강(ef/list `_enrichSnapshotWithEfList`·warn/latest GAP)이 모두 **`if (snap.parents.has(name)) continue;`** 가드로 **발효중 해역에 공존하는 상위(경보) 발표대기 통보문을 통째로 skip** → `UPCOMING_CHANGE` 미발생. 함정: ①격상 ef cmd가 `변경해제`라 cmd 필터에도 걸림, ②`LVL_RANK`에서 `예비`=`주의보`=2 **동점**이라 격상 산출 안 됨.
- **해결(안전 설계)**: 새 헬퍼 **`_tryAddCoexistingUpcoming`** — 발효중 active와 **등급/종류가 다른** 발표대기면 `parents`를 안 덮고 **`upcomings`에 병렬 추가**. `wrnLvlNm='예비'` **유지**(매처/디바운스/dedup/표시 정책 무수정), 실제 등급은 신규 **`wrnLvlReal`**에 보존. 푸시·표출 toBlock만 `wrnLvlReal` 우선 → active(주의보=12) 대비 신규(경보=15)를 **격상 산출** → `📢 풍랑 주의보→경보 격상 발표`(`level_upgrade_publish`), 화면 `다가오는 풍랑경보 예정`. **격하 대칭**. cmd 필터에 `변경해제` 추가(신규 GAP 부모는 publish 계열만), 공존 upcoming에 `_efBridged`로 dedup 1회.
- **영향 격리 2건(독립 검토 반영)**: ①cmd 셀렉션 분리(publish용 `latestByZone` 기존 동일 + 공존용 `coexistByZone` 가산), ②dedup skip 범위 축소(`suppressUpcoming` — 발효중 active의 독립 변화 푸시 보존, B-5).
- **회귀 29항 통과**. 독립 에이전트 2건 검토 — 표출 PASS, 기존기능 무영향(B-5만 지적되어 즉시 반영).

### § 7.6.6 발표대기 GAP 자식 맹목 합성 — '연안바다 제외'가 '포함'으로 뒤집힘 (제외 자식 게이트, #829)
- **증상(2026-06-02 제주도북부앞바다)**: MMIS 통보문(제06-17호, 11:30)은 **"제주도북부앞바다(연안바다 제외)"** 발효 13:30 + 참고사항 "제주도북부연안바다 해제". 그런데 우리 푸시는 ①11:32 발표·13:30 발효 모두 **"(연안바다 포함)"**(통보문과 반대), ②13:35 "일부 해제(모든 연안바다 해제)"가 발효와 분리·지연 발사.
- **원인(독립 조사 2건 + MMIS 로그인 실측 — MMIS 정상, 100% 우리 로직)**: MMIS는 자식 포함/제외를 **per-child 정확히** 줌(warn-sasc/list 발효 자식=풀 행, **제외 자식=`warn_lvl:"0"` 빈 메타행** S2320400, ef/list 자식 행 없음). 그러나 11:30 발표는 발효(13:30) 미래라 부모가 warn/latest GAP으로 들어오고, 자식이 비면 `PARENT_TO_CHILDREN` 매핑으로 **무조건 '예비' 합성** → MMIS level-0(제외) 미확인 → **유령 연안바다** → `buildChildQualifier` "(연안바다 포함)"(문제1). 그 유령이 13:30 발효 후 사라지며 `_applyChildReleaseDebounce`(3분) 거쳐 13:35 `partial_release` 분리 발사(문제2). 부가: marine 크롤러는 **ntfctn/list(통보문)를 안 읽음**(경로 상수만) — 단 warn-sasc/list level-0 신호만으로 제외 판정 가능.
- **해결(제외 자식 게이트)**: `_buildSnapshotFromMarine`에서 warn-sasc/**list**의 `warn_lvl='0'` 자식명을 `snap.excludedChildren`(일시 필드, 미영속)에 모은 뒤, GAP의 **PARENT_TO_CHILDREN '무조건 합성' 분기에서만** 스킵(`_enrichSnapshotWithLatest`·`_addGapParentFromEf`). 유령 미생성으로 문제1(포함→미발효)·문제2(지연 일부해제) 동시 해결.
- **착오사항(검토로 교정된 2건)** ⭐: 최초 제안은 ①소스 "list+latest", ②합성·carry 둘 다 게이트하려 했으나 독립 검토 2건이 MMIS 실데이터로 교정 — **(교정1) 소스는 `warn-sasc/list` 단독**(latest는 발효중 정상 자식까지 전부 level-0라 정상 자식 오제외 회귀), **(교정2) 합성 분기만 게이트**(carry/디바운스는 글리치 방어라 무수정).
- **부작용 없음**: 정상 포함 자식은 list 풀 행(`warn_lvl≠0`)이라 게이트에 안 걸림. 자식이 list에 없던 기존 GAP 합성도 그대로(명시적 level-0만 제외). **회귀 15항 통과**.

### § 7.6.7 후속 시행착오 요약표
| 문제 | 원인 | 해결 |
|---|---|---|
| 정확 시각 확정인데 화면이 옛 범위로 고착 | 표시용 범위 sticky가 확정값을 가림 | 표시를 확정값(`info.tmEf`)로 단순화 (#823) |
| 발효시각 앞당김 시 표시 미갱신 + 가짜 연장 | sticky가 늦어짐만 폐기·`winMap` stale | 앞당김 시 범위·`winMap` 동기 폐기 (#823) |
| 풍랑경보→태풍경보 종류격상이 "해제시각 변경"으로 | 격상 판정이 등급 문자열만 비교 + 사용자 `type_upgrade` 문구 부재 | 점수 기반 종류격상 감지 + `generateMessage` 문구 (#824) |
| 예비취소가 토글 무시·무조건 발송 | `release`/`announce` 토글 미매핑 | `release` 토글에 `prelim_cancel` 연동 (#825) |
| 예비 글리치로 가짜 "예비취소" 발사 | 예비 소멸에 디바운스 없음 | `_applyUpcomingCancelDebounce`(3분 carry) (#826) |
| 발효중 해역 격상(주의보→경보) "발표" 푸시 누락 | 발표대기 보강이 `parents.has` 가드로 공존 격상 skip + `예비`=`주의보` 동점 | `_tryAddCoexistingUpcoming`(upcomings 병렬+`wrnLvlReal`) (#826/#827) |
| '연안바다 제외'가 '포함'으로 + 발효/해제 시간차 | GAP 자식 맹목 합성(`PARENT_TO_CHILDREN`)이 MMIS level-0(제외) 미확인 → 유령 자식 → 13:30 후 디바운스로 분리해제 | 제외 자식 게이트(`snap.excludedChildren`, warn-sasc/**list** level-0, 합성 분기만) (#829) |

---

## § 7.7 통보문 버튼 — 해역별 통보문 이력 (ef/list + 관할 지방청 PDF + 자식 통보문 매칭)

> 본 § 는 2026-06-03 대화로 추가된 기능을 기록한다. 특보 구역명 옆 📋 버튼을 "해역별 통보문 이력 → 원문 PDF 열람"으로 재구현했다(#831 + 자식 매칭 후속). MMIS 통보문 데이터의 구조적 한계와 그 우회 설계를 함께 남긴다.

### § 7.7.1 死버튼 진단 — 옛 weather.go.kr 크롤러 의존
- 📋 버튼은 `data.history`(옛 weather.go.kr 통보문 크롤러)에 묶여 있었는데, 그 크롤러가 비활성화되며 `history`가 항상 빈 배열 → **신규 특보엔 버튼이 안 뜨고, 과거 이력이 남은 일부 해역에만 표시**됐다(사용자가 본 "어떤 해역엔 있고 없고"의 원인).
- 누르면 열리던 팝업도 옛 `/api/bulletin-cache`(`collect_cache/`, 현재 0개)에 의존 — 완전히 끊긴 死기능이었다.
- **해결**: `render.js` 버튼 게이트를 `data.history` 의존에서 분리(`zoneNameStr` 존재 시 표시) → 모든 특보 해역에 일관 표시. 옛 `showAlertHistoryPopup`/`bulletin-cache`는 미사용으로 남겨 무영향.

### § 7.7.2 MMIS 통보문 데이터 구조 (3 엔드포인트의 한계)
| 엔드포인트 | 제공 | 한계 |
|---|---|---|
| `warn/ef/list` (auth) | 부모(S1) 행: `tm_fc`·종류/등급/cmd·`prdc_go`·`file_nm`(PDF) | **자식(S2/S3) 행 없음** |
| `warn-sasc/list·latest·ready` (no-auth) | 자식 행 `{warn_zone_cd, warn_lvl, kor_nm}` | **시간·PDF 없음**(등급만) |
| `warn/ntfctn/list` (auth) | 관서별 통보문 `{tm_fc, file_nm(PDF), warn_title}` | **해역 식별자 없음** |
- 통보문 PDF: `marine.kma.go.kr` + `file_nm` 무인증 공개·iframe 가능. `file_nm` 형식 `KTKO50_<YYYYMMDDHHMM>_<prdc_go>_<seq>.pdf`. (`tm_fc`는 UTC ISO라 표시는 `file_nm`의 KST 타임스탬프로 정규화.)

### § 7.7.3 전국(본청) vs 지방청 통보문 — 관할 지방청 PDF 우선
- **실측 확정**: 같은 발효라도 **전국(본청 108) 통보문 PDF엔 연안바다/평수구역이 없고**(부모 해역만), **관할 지방청 PDF엔 연안/평수까지 포함**된다(예: 제주도북부앞바다 11:30 발표 — 108 PDF엔 '연안바다' 없음, 184(제주) PDF엔 "제주도북부앞바다(연안바다 제외)" 포함).
- **해결**: 사용자에게 **관할 지방청 통보문을 우선 링크**(연안/평수 포함), 지방청 PDF가 없을 때만 전국(108) 폴백((전국) 표식). 관할 지방청은 **PDF 내용검증으로 만든 정적 매핑 `ZONE_HOME_OFFICE`**(`config/zone_home_office.js`)로 결정 — ef/list 빈도만으로는 동률 해역(예: 울산앞바다 143:2·159:2)에서 그 해역이 없는 인접청 PDF를 고를 위험이 있어, 후보 청 PDF에 해역명이 실제 들어있는 청만 채택했다. 발효 단위 dedup(`file_nm`)으로 전국+지방청 중복 누적 방지.

### § 7.7.4 자식-only 통보문 매칭 (이벤트 기반)
- **문제**: ef/list가 부모만 담아, **자식(연안/평수)만 바뀌는 통보문**(부모 불변)은 부모 ef 행이 없어 목록에서 누락된다.
- **핵심 통찰**: 통보문 PDF는 "MMIS에 데이터가 기록된 시점"이 아니라 **"그 통보문 자신의 발표시각"** 에 업로드된다(데이터가 발효보다 일찍 기록되는 경우도 있어, 감지 시점 기준 고정 풀링창은 근본적으로 어긋난다).
- **설계(이벤트 기반 + 매칭까지 개방)** — `services/child_bulletin.js`:
  1. 기존 디바운스·의심가드를 통과한 **확정 자식 변동**(실제 자식 푸시 신호 `childState.added/released`)에만 "펜딩 매칭" 등록 — 글리치성 가짜 등록 방지(새 글리치 로직 없이 기존 통과분에 얹음).
  2. 펜딩이 열린 동안에만 **그 부모의 관할 지방청 1곳 `ntfctn/list`만** 조회 → 새 PDF만 파싱(`file_nm` 단위 캐시, PDF 불변) → 본문에 **부모명 + 자식명** 매칭(축약형 `제주도북부연안바다` 등 후보 생성, `<후보>제외` 직후만 배제하는 정밀 false-positive 가드).
  3. 매칭 시 자식 통보문 `{time, title, pdfUrl, file_nm}` 영속 저장 → 펜딩 종료.
  4. `/api/zone-bulletins`가 **ef/list 부모 통보문 ∪ 저장된 자식 통보문**을 `file_nm` dedup·최신순 병합(자식-only는 `〔연안/평수〕` 표식).
- **안전망(매달림 방지)**: ①고정 시간창 없이 매칭까지 개방(지연 업로드 대응) ②글리치성 반전은 상류 `_applyChildReleaseDebounce`(3분)에서 흡수돼 **확정 변동만 등록**(가짜 펜딩 원천 차단), 동일 변동 재확정 시 캡 리셋 + 부모당 펜딩 수 상한 ③하드 캡(≈6h) 도달 시 graceful 포기 ④평상시(변동 없음) `ntfctn` 호출 0회.
- **잘못 수집된 데이터로 안 올 통보문을 무한 대기할 위험**은 ②(상류 디바운스 통과분에만 등록)로 가짜 펜딩을 원천 차단하고, ③(하드 캡)으로 상한을 둬 해소 — 포기해도 결과는 "그 통보문만 목록에 없음"(무해). ("반전 시 강제 폐기"는 진짜 짧은 해제의 통보문을 잃을 수 있어 두지 않음.)

### § 7.7.5 UI 흐름
```
특보 구역 [📋] ─클릭→ 팝업(발표시각+제목 리스트; 살아있는 특보만; 자식-only는 〔연안/평수〕)
                         └항목 클릭→ openKmaIframeModal →
                              ├ 발효 통보문(PDF 있음)  → 원문 통보문 PDF(관할 지방청, gview)
                              └ 예비특보(PDF 없음)      → 날씨누리 딥링크(stn=관할지방청&kind=pwn&date=발표일)
```
- 리스트는 **현재 살아있는 특보**만(해제·만료 제외). 판정 로직 → § 7.7.10.

### § 7.7.6 한계
- 자식 행이 ef/list에 없어 **부모 해역 단위**로 통보문을 모은다(자식 통보문은 부모의 지방청 PDF에 포함). 부모와 같은 PDF로 발표된 자식 변경은 dedup으로 부모 항목에 통합된다(정상).
- 통보문 PDF 텍스트 추출이 부분적일 수 있어, 자식명 매칭 실패 시 캡 내 다음 사이클 재시도. `ntfctn/list`는 최신 N건만 반환하나 매 사이클(~1분) 폴링으로 발표 직후 포착. 미등록·108폴백 해역은 자식 보강 대상에서 보수적으로 제외.

### § 7.7.7 통보문 자식명 표기 변형 대응 (지방청별 실측 조사)
자식 통보문 매칭의 최대 변수는 **지방청마다 PDF에서 자식해역을 다르게 표기**한다는 점이다. 8개 지방청(105·109·133·143·146·156·159·184) 통보문 PDF를 각각 실측 조사한 결과:
- **표준은 괄호형** `부모명( 자식꼬리[, 자식꼬리2 …] )` 이다 — 예: `경북남부앞바다(평수구역)`, `부산앞바다( 동부평수구역 , 연안바다 )`, `인천·경기남부앞바다(먼평수구역, 북부앞평수구역)`, `제주도서부앞바다( 북서연안바다 , 가파도연안바다 )`. (대구143·부산159·제주184·충청133·인천109이 이 형식. 광주156·강원105·전북146은 자식 통보를 발행하지 않아 부모 단위만 — 매칭 대상 없음.)
- MMIS 정식명의 `중`은 PDF에 안 나오고, 부모는 `~앞바다`로 유지된 채 자식꼬리만 괄호 안에 들어간다. 발효 시 빠지는 자식은 괄호 안 `자식꼬리 제외` 로 표기.
- 일부 청은 참고사항에 축약형(`제주도북부연안바다`)을 별도 병기.
- **구분자 불일치**: 정식명 `태안.서산`·`인천.경기`(마침표) vs 통보문 `태안·서산`·`인천·경기`(가운뎃점).

이에 매처(`_childNameCandidates`/`_matchInText`)를 보강했다:
- **① `lastIndexOf('중')` 분할** — `강원중부앞바다중연안바다`처럼 부모명에 `중`이 들어간 자식이 첫 `중`에 걸려 후보가 깨지던 버그 수정.
- **② 괄호 그룹 매칭** — `부모명(그룹)`을 찾아 그룹을 콤마 토큰으로 나눠 자식꼬리와 *정확 일치* 검사(부분일치 오탐 방지: `먼평수구역` 안의 `평수구역` 오매칭 차단), 토큰이 `…제외`면 배제. 일반어 자식꼬리(`연안바다`/`평수구역`)도 부모 괄호 그룹 안에서는 변별 가능.
- **③ 구분자 정규화** — `_norm`이 공백과 함께 `·`·`.`를 제거해 정식명·통보문 표기를 일치시킴.

실측 검증: 5개 청의 실제 누락 PDF(제주 남부연안바다·부산 서부평수/울산평수·충청 태안·서산/일반평수·인천 북부평수/남부먼평수)가 보강 후 전부 매칭, 타부모·`제외` 케이스는 null 유지.

**태풍·폭풍 성수기 재조사(2025-07~11, 서해·동해·제주 3권역)**로 두 가지를 추가 확인했다:
- **표기는 계절 무관 항상 괄호형** — 읽을 수 있는 전 표본에서 **풀네임(`부모앞바다중연안바다`)은 단 한 번도 등장하지 않았다**(괄호형이 표준, 참고사항에 드물게 축약형). "태풍기엔 풀네임으로 적지 않을까"라는 우려는 데이터상 근거 없음. (단 MMIS 해상 통보문엔 2025 성수기에도 `태풍` 종류 0건 — 풍랑/강풍/해일로만 발표.)
- **PDF 폰트 인코딩의 시기차(중요 운영 사실)** — **약 2025-11 이전** 통보문 PDF는 ToUnicode CMap 없는 CID 서브셋 폰트라 `pdf-parse`로 한글이 0자 추출(판독 불가)된다. **2025-12 이후(현재 포함)는 정상 추출**된다. 자식 매칭은 실시간(현재) 통보문만 보므로 운영엔 영향 없으나, 만약 KMA가 과거 방식으로 되돌리면 매칭이 침묵할 수 있어 `_getPdfText`에 한글 0 감지 시 경고·skip 가드를 두었다. (과거 PDF 본문 텍스트가 필요해지면 ToUnicode 복원/OCR이 별도 필요.)
- 부가로 2글자 지명(부산·울산)의 부모 존재 게이트가 너무 엄격하던 것(`core ≥ 3`)을 `≥ 2`로 완화.

**겨울 폭풍기 재확인(2025-12~2026-02, 판독 가능)** — 태풍기 PDF는 판독 불가이나, **태풍급 풍랑을 양 해안에 일으키는 겨울 폭풍**기는 정상 판독된다. 이 시기 동해(대구 `경북남부앞바다(평수구역)`·부산 `부산앞바다(동부평수구역, 서부평수구역, 연안바다)`)·서해(충청 `충남북부앞바다(천수만 평수구역)`)·제주(`제주도동부앞바다(북동연안바다)`) **양 해안 모두 괄호형, 풀네임 0건**을 재확인했다. → "동해/서해 태풍 내습 시 표기가 다를까"라는 우려도 (동일 양식 템플릿이므로) 해소.

**해역 매핑 보완** — 위 겨울 폭풍기 조사에서 봄 조사창엔 비활성이라 누락됐던 **남해 연안 5개**(거제시동부앞바다·경남서부/중부남해앞바다·전남동부/서부남해앞바다)가 ef/list 부모(44개)에 있으나 `ZONE_HOME_OFFICE`(39개)에 없음을 발견 → 추가(경남·거제 3개 159 내용검증 확정, 전남 2개 156 지리·빈도 기반). 이제 44/44.

### § 7.7.8 자식 통보문 표기 전수 검증 (52개 자식 · 8개 지방청)
판독 가능 전 기간(2025-12~2026-06)을 **지방청별 전수 스캔**해, warn-sasc 기준 **자식 해역 52개 전부**의 통보문 표기와 매처(`_matchInText`) 매칭을 1:1 점검했다.

| 지방청 | 매처 PASS | 자료부족(미발행) |
|---|---|---|
| 제주184 | 9 | 0 |
| 부산159 | 12 | 0 |
| 충청133 | 5 | 1 (가로림만·당진=통보문엔 `당진 평수구역`으로 표기) |
| 인천109 | 4 | 2 (경기북부앞바다중먼/앞평수구역 = 라이브 전용, 통보문은 `인천·경기북부`로만) |
| 대구143 | 2 | 4 (경북북부연안=미발효, 울릉읍/면 3=세분 미표기) |
| 전북146 | 0 | 2 |
| 강원105 | 0 | 3 (연안 미표기, `동해중부앞바다(강원X부앞바다)` 부모 단위만) |
| 광주156 | 0 | 8 (`서해남부앞바다(전남X부서해앞바다)` 부모 단위만) |
| **합계** | **32** | **20** |

- **실제 발표되는 자식 32개 = 전부 괄호형 → 매처 PASS. 풀네임 0건.**
- **자료부족 20개 = 그 청이 자식을 세분 표기하지 않고 부모 단위로만 발표(`서해남부앞바다(전남북부서해앞바다,…)`·`동해중부앞바다(강원중부앞바다)` 처럼 괄호 안에 *부모급 하위구역명*만)하거나 점검 기간 미발효.** 그 부모는 ef/list가 처리하므로 **자식-only 통보문 자체가 없어 매칭 대상 부재(매처 결함 아님).**
- **실질 FAIL(자식이 발표됐는데 매처가 못 잡음) = 0개.**
- ToUnicode 부재 구폰트 PDF는 전부 2025-11~12중순에 몰려 있고 이후는 정상 판독 → 표본이 가려진 정황 없음.

결론: **자식을 실제 발표하는 통보문은 전 지방청 괄호형이고 매처가 전수 커버**한다. 미발행 자식은 통보 자체가 없어 누락이 아니다.

### § 7.7.9 실제 태풍 통보문 OCR 실측 (2022 힌남노 · 양 해안)
판독 가능 기간만으로는 실제 태풍 내습 시기를 못 봐서, **2022-09 힌남노**(아카이브에 남은 유일한 해상 태풍 통보문, 태풍 205건) 통보문을 **렌더+OCR**(mupdf 렌더 → tesseract.js 한국어)로 직접 읽어 확인했다. (그 시기 PDF는 ToUnicode 없는 폰트라 텍스트추출 불가이나, 글리프 outline은 정상이라 OCR로 판독 가능.)
- **동해/남해(부산159)**: `풍랑주의보 해제 : 남해동부앞바다( 거제시동부앞바다 , 부산앞바다 ), 동해남부앞바다( 울산앞바다 )`
- **서해(충청133)**: `풍랑주의보 해제 : 서해중부앞바다( 충남남부앞바다 , 충남북부앞바다 )`
- **실측 결론**: 태풍 절정기엔 통보문이 **부모(앞바다) 단위**로, 상위 묶음명 괄호 안에 *부모 구역명*을 나열한다 — **평수구역/연안바다 자식은 개별로 등장하지 않는다.** 그 부모 경보는 ef/list가 처리한다. **풀네임(`부모중자식`)은 태풍 통보문에도 0건.** 자식 괄호형(`충남북부앞바다( 천수만 평수구역 )`)은 평상시 풍랑 통보문(자식 개별 변동 시)에만 나오며 매처가 이미 커버. → **태풍기에도 새 표기 형태 없음, 매처 추가 보강 불필요.**

### § 7.7.10 살아있는 특보만 표출 — 해제·만료 통보문 제거 + 예비특보 정확 딥링크 (2026-06-06)

3개 독립 원인분석 에이전트(MMIS 실로그인 + 코드 분석)가 합의한 두 버그 수정. 위치: `routes/weather.js` `_getZoneBulletinData` / `/api/zone-bulletins`. 커밋 `4997050`.

**버그 A — 해제된 풍랑주의보가 목록에 잔존**
- 증상: 제주도남쪽바깥먼바다가 예비특보만 살아있는데, 이미 해제된 `제06-21호 풍랑주의보 변경`(06-03)이 리스트에 남음.
- 원인: 살아있음 판정이 `isRelease=/해제/.test(title)` — 즉 ef/list `warn_cmd_nm` 으로 만든 title 의 '해제' 문자열에만 의존. 그런데 제06-21호는 **다중 해역 해제 통보문**이며, ef/list가 이 해역 행을 `warn_cmd_nm='변경'(code 2)` 으로 코딩 → '해제'로 인식 못 함. 또한 `ed_tm`(발효구간 종료, 06-03 06:00) 만료·`warn/list` 현재발효 여부를 전혀 안 봄.
- 핵심 사실: **ef/list 의 per-zone `warn_cmd_nm` 은 다중해역 통보문에서 해역별로 '변경'으로 코딩될 수 있어 해제 판정에 신뢰 불가.** 같은 file_nm 의 `ntfctn/list warn_title`("…/ 풍랑주의보 해제") 이 진실. PDF 원문도 "풍랑주의보 해제(제6-21호)".
- 수정:
  1. **발효중 게이트(권위)** — `warn/list`(현재 발효 부모 zone)의 `warn_zone_cd`(lvl≠0) 집합 `effectiveCodes` 를 `_getZoneBulletinData` 에서 캐시. ef 발효 통보문은 그 `warn_zone_cd` 가 effectiveCodes 에 있어야(=지금 발효중) alive. 해제·만료된 통보문은 warn/list 에서 빠지므로 자동 제외.
  2. **해제 판정 보강** — `isRelease` 가 title 뿐 아니라 ntfctn 원제목(`reportTitle`)의 '해제' 도 검사.
  3. **폴백** — warn/list 조회 실패 시에만 `ed_tm < 현재시각(KST)` 인 만료 통보문을 제외.
  4. **현재 cycle 컷 유지** — `effectiveCodes` 는 시각 무관(코드 매칭)이라, 발효중 zone의 30일 이력 누적 방지를 위해 "가장 최근 해제 이후"(`lastRelease`) 컷 병행.
- 판정 우선순위(`alive` 필터): `prelim`(예비) → 항상 표시 / `isRelease` → 제외 / 과거 cycle → 제외 / `childOnly` → 표시 / ef 발효 → `effectiveCodes` 발효중일 때만.

**버그 B — 예비특보 클릭 시 무관한 통보문(날씨해설) 표출**
- 증상: `풍랑 예비특보 발표` 클릭 → iframe에 `[해설] 제06-29호 날씨해설` 표출.
- 원인: 예비특보 항목 `webUrl` 이 파라미터 없는 `https://www.weather.go.kr/w/special-report/list.do` → 페이지가 **종류무관 최신 1건**(마침 날씨해설 cmt 제06-29호)을 디폴트 표출.
- 핵심 사실: **해상 예비특보는 MMIS·날씨누리 어디에도 PDF 통보문이 없다.** `warn/ready` 응답에 `file_nm` 필드 자체가 없음(실검증). 날씨누리 특보 통보문 페이지의 예비특보(`kind=pwn`)는 **발표일(date=tm_fc) 컨텍스트** 필수(오늘 날짜로는 "발표된 자료 없음").
- 수정: 예비특보 webUrl 을 `list.do?stn=<관할 지방청>&kind=pwn&date=<발표일>` 딥링크로 구성(`tm_fc` 에서 발표일 파싱). 라이브 검증: stn=184 → `풍랑 예비특보 / 제주도남쪽바깥먼바다`(reportId `pwn:202606051600:3`) 정확 표출.

> **정정(2026-06-06)** — 초기 원인분석(에이전트 B)은 "예비특보는 본청(stn=108)에만 게시"라 판단했으나 이는 **잘못된 date 파라미터(오늘 날짜)** 때문이었다. 발표일(`date=tm_fc`)로 정확히 맞추면 **지방청 stn(184 제주·159 부산경남 …)에 전국본(108)과 별개의 지방청 예비특보 통보문이 존재**한다(seq 상이: 184=3, 108=7). 따라서 **발효 통보문 PDF 와 동일하게 관할 지방청(`home = ZONE_HOME_OFFICE[z]`)을 따라가도록** stn 을 고정 108 → `home || 108` 로 수정. 이유: 전국본엔 연안바다/평수구역(자식)이 안 보이고, **자식 특보 발효 여부는 지방청 통보문에서만** 확인 가능(발효 PDF 와 동일 원리). → § 7.7.3 관할 지방청 우선 원칙과 일치.

**표출 방식 결정 — PDF vs 링크 (우리 프로그램 기준)**
| 종류 | MMIS PDF | 앱 표출 | 근거 |
|---|---|---|---|
| 발효 통보문(ef/list) | 있음(`file_nm`) | **PDF** (gview iframe) | 정확·기존 동작 유지 |
| 예비특보(warn/ready) | **없음** | **정확 딥링크**(stn=관할지방청&kind=pwn&date) | PDF 부재 → 링크가 유일·정확. stn 은 발효 PDF 와 동일하게 관할 지방청 |

원칙: **PDF 있으면 PDF, 없는 예비특보만 딥링크.** 둘 다 **관할 지방청**을 따라간다(전국본엔 자식 연안/평수 미표시). iframe 따라가기 검증: weather.go.kr 은 X-Frame-Options/CSP 없음 → 임베드 가능. 체인: 서버 `webUrl` → `alert_history.js`(webUrl 우선) → `openKmaIframeModal`(`<iframe src>` 직접 로드). 메인 '통보문' 버튼과 동일 메커니즘.

라이브 MMIS 검증 결과(제주도남쪽바깥먼바다): merged 9건 중 alive=`풍랑 예비특보 발표` 1건만 남고, 해제된 `풍랑주의보 변경(제06-21호)` + 과거 8건 전부 제거.

**버그 C — 발효 통보문이 일부 해역에서 전국(108)본으로 빠짐**
- 증상: 강원 앞바다(남부·중부·북부) 발효 통보문이 지방청이 아닌 **전국(108)본**으로 연결(연안/평수 자식 안 보임). 사용자 요구: 발표/발효/예비 **모든 통보문이 지방청을 따라가야** 한다(지방청 통보문에만 자식 발효 여부 표시).
- 원인: `pick` 1순위가 `home && cands.find(prdc_go===home)` 인데, 강원 앞바다는 `ZONE_HOME_OFFICE='108'`(이름이 105 PDF에 안 보여 내용검증상 108 폴백)이라 home=108 → **ef/list 에 강원청(105) 행이 있는데도** 1순위가 108 행을 집어 전국본 선택.
- 핵심 사실: 강원 앞바다 이벤트의 ef/list 후보엔 실제로 `prdc_go=105`(강원청) 행이 존재(`KTKO50_..._105_NN.pdf`). 전국(108)은 진짜 최후 폴백이어야 한다.
- 수정: `regionalOffice` 도입 — 정적 매핑이 **실제 지방청(≠108)이면 그것**, 아니면(108 폴백/미등록) **ef/list 빈도 휴리스틱(`homeByZone`)으로 실제 발행 지방청 복원**(강원→105). `pick` 1순위를 `regionalOffice(≠108)` 로, 예비특보 `prelimStn` 도 `regionalOffice` 로 통일. → 발표/발효/격상/격하/예비 **전부 지방청 통보문**.
- 라이브 검증: 30일 ef 이벤트 **114건 전부 지방청 PDF(전국 폴백 0건)**, 강원남부앞바다 `regionalOffice=105`.

### § 7.7.11 "중부" 해역 예비특보 누락 — `_extractParent` 의 '중' 오분할 (2026-06-19)

증상: 기상청이 풍랑 예비특보를 40개 부모 해역에 발표했는데 앱은 **33개만 표출**. 누락 7개가 **전부 이름에 "중부" 포함**: 강원중부앞바다·동해중부안쪽/바깥먼바다·전남중부서해앞바다·서해중부안쪽/바깥먼바다·경남중부남해앞바다. (비-중부 해역은 누락 0.)

- 원인: `marine_warning_crawler.js` `_buildSnapshotFromMarine` 의 warn/ready(예비, 부모+자식 혼재) 분류가 **이름 기반**(`_extractParent(name) === name` 이면 부모, 아니면 자식)이었다. `_extractParent` 는 `lastIndexOf('중')` 로 부모/자식을 가르는데(자식 표기 `부모중자식`), **부모명에 '중'이 든 "중**부**" 권역**(강원**중**부앞바다 등)은 그 '중'에 걸려 `_extractParent("강원중부앞바다") = "강원"` → `"강원" ≠ "강원중부앞바다"` → **부모인데 자식으로 오분류** → `snap.parents` 에서 누락 → leaf `upcoming` 미설정 → 화면 누락.
- 핵심 사실: MMIS warn/ready 원본엔 7개 모두 **부모 코드 S1…**(S1151200 강원중부앞바다 등)로 정상 존재. 부모=`S1…`, 마린 자식(연안/평수)=`S2…`·`S3…` 로 **코드 접두사가 불변 분류자**(실측 부모 40 / 자식 40 깔끔 분할). 이름 '중부' 함정과 무관.
- 수정: 부모/자식 분류를 이름 대신 **warn_zone_cd 코드 기반**(`_isChildZoneCode`: `^S[23]`=자식, `^S1`=부모, 코드 부재 시에만 이름 폴백)으로 전환. warn/ready·warn-sasc/ready 두 혼재 루프에 적용. `_extractParent` 는 (실제 자식의) 부모명 추출 용도로만 유지(자식은 마지막 '중'이 구분자라 정상).
- 라이브 검증: 수정 후 `_buildSnapshotFromMarine` 의 `snap.parents` = **40개**(7개 중부 전부 `풍랑 예비` 부모로 등록), 기상청 발표 40 부모와 일치.

#### § 7.7.11.1 종합 보강 (독립 5중 검토 후 — 2026-06-19)

1차 수정(warn/ready·warn-sasc/ready 분류만 코드 기반 전환) 후, **2개 독립 원인검토 + 2개 독립 수정·회귀검토 + 1개 메타검토**를 거쳐 다음 3개 보완을 추가했다. 핵심: 이번 변경들은 **MD에 이미 명문화된 설계**(§ 2.3 `warn_zone_cd`: `S1`=부모/`S2·S3`=자식, § 1 자식 독립 표출 정책 U-1)를 코드가 못 따르던 빈틈을 정렬한 것이며, 새 규칙을 만든 것이 아니다.

- **(보완1) 분류 코드 기반 전수 통일** — 같은 `_extractParent(name)===name` 이름 분류가 `_enrichSnapshotWithLatest`(warn-sasc/latest·warn/latest)·`_enrichSnapshotWithEfList`(ef GAP) 보강 경로에도 남아 있었다. 중부 부모가 warn/list·warn/ready 없이 latest/ef 로만 들어오는 발표대기(GAP) 타이밍에 동일 누락이 재발할 수 있어, 이 경로들도 `_isChildZoneCode` 로 통일.
- **(보완2) 자식 부모키 역인덱스(`CHILD_TO_PARENT`)** — 이름에 '중' 구분자가 없는 자식(`울릉도울릉읍/서면/북면연안바다`→`동해중부안쪽먼바다`, `천수만/안면도서쪽/당진/태안·서산북쪽평수구역`→`충남북부앞바다`)은 `_extractParent`가 자기 이름을 부모키로 반환해 **self-key 고아**가 되어 부모 트리에 자식이 안 붙었다(U-1 위반). `PARENT_TO_CHILDREN` 역인덱스(`_parentKeyForChild`)로 진짜 부모키를 산출해 정상 부착.
- **(보완3) 재배포 1회성 가짜 취소 가드** — prev 스냅샷(구코드: 위 self-key 자식이 부모로 저장)과 신코드 디프 시 배포 첫 사이클에 거짓 `prelim_cancel`(울릉도 등)이 발사될 수 있다. `DiffMatrix.compute` 루프 선두에 `CHILD_TO_PARENT[parent] && !curr.parents.has(parent)` 면 제외하는 1회성 가드 추가(정상 부모는 이 키가 아니므로 정상 해제/예비취소를 삼키지 않음 — 부모키∩자식fullName=∅ 검증).

회귀 검토(12 시나리오): 발효/해제/격상·격하·예비공존·자식변동·콜드부팅 푸시가드·`PARENT_TO_CHILDREN` 합성·`excludedChildren` 게이트·프론트 표출 전부 무영향(PASS). 라이브 재검증: `snap.parents=40`(중부 7/7), 울릉도 3 자식이 `동해중부안쪽먼바다` 아래 정상 부착, self-key 고아 0, 배포 디프 가짜취소 0·정상 publish 7 보존.

### § 7.7.12 자식(연안/평수) 단독 예비특보가 "추가 발효"로 오발송 — 자식 발표(예비) 개념 신설 (2026-06-19)

증상: 자식 해역(연안바다·평수구역)이 **예비특보(발표·미발효)**인데 푸시가 **"풍랑주의보 추가 발효"**로 발송됨(관측: `동해중부안쪽먼바다(울릉도울릉읍연안바다 추가 발효)` — 울릉도 연안바다는 예비). § 7.7.11.1 보완2가 자식을 부모에 정상 부착하면서 이 잠재 문제가 드러남.

- **핵심 발견(독립 2+메타 검토)**: 푸시 경로와 화면 트리는 **별개 데이터원**이다.
  - 푸시 diff·dedup 은 `StateSnapshot`(`_rowToChildInfo`)으로만 동작하며 자식 `wrnLvlNm='예비'`를 **보존**한다.
  - `_buildZoneTreeFromSnapshot` 의 자식 `예비→주의보` 정규화(주석 "푸시 dedup 정책")는 **화면(weather_alerts.json) 전용**이며 푸시·dedup 에 무관(실측·grep 확정). "dedup 정책" 주석은 실체 없는 오해.
- 실제 오발송 원인: `_buildUserPushChanges` 가 신규 자식을 **등급 무시하고 일괄 `CHILD_ADD`** 로 분류 → `push_sender` 가 `CHILD_ADD → additional_active`("추가 발효")로 무조건 매핑. 자식의 '예비'가 묻힘. 부모는 `upcoming`/`current` 분리로 발표/발효를 구분하지만 자식엔 그 개념이 없었던 것.
- 수정(독립 2개 구현 → 메타 종합, 4파일 +113/-16):
  1. `_buildUserPushChanges` — 신규 자식을 등급 분기: **예비→신규 `CHILD_PRELIM_ADD`**, 발효(주의보/경보)→기존 `CHILD_ADD`. **예비→발효 전이 감지(`nowActivated`)** 시 그 순간 `CHILD_ADD`("추가 발효") 발사(실제 발효될 때 비로소 발효 통지).
  2. `push_sender` — `CHILD_PRELIM_ADD → child_prelim` 템플릿(시각=발효예정 `tmEf`).
  3. `push_helpers` — `child_prelim` 문구("📢 …발표", 한정사 "(…발표 예정)").
  4. `routes/push.js` — `child_prelim` 을 **발표(announce)+자식(childZones) 양쪽 토글로 게이트**(발효 토글만 끈 사용자는 예비와 무관하므로 정상 수신). 부모 발표(`publish`)·자식 추가발효(`additional_active`) 기존 토글 동작 불변.
  5. `_buildZoneTreeFromSnapshot` — 자식 `예비` 보존(정규화 제거) → 화면이 시간추정 대신 명시적 '예비'로 표출.
  (admin 채널 DiffMatrix 도 일관성 위해 `child_prelim` 버킷 분리 — `ADMIN_PUSH_ENABLED=false`라 현재 비활성.)
- 검증(라이브 + 회귀): 자식 단독 예비 → "발표"(예비, 오발사 0), 자식 예비→발효 전이 → "추가 발효", 자식 직접 발효 → "추가 발효", 일부 해제·혼합·연장·무변화·콜드부팅 가드·부모 7종 전부 불변(PASS). 부모+자식 동시 발표 = **단일 푸시**(중복 없음). 트리 자식 예비 40/40 보존.

### § 7.7.13 예비특보 전체취소가 "주의보 일부해제"+"예비특보 취소" 2건으로 분리 (2026-06-19)

증상: 기상청이 풍랑 **예비특보를 전체 한 번에 취소**(제06-15호)했는데, 앱 푸시가 **2건으로 분리** — 06:00 "✅ 풍랑주의보 일부 해제"(자식 평수/연안) + 06:01 "✅ 풍랑 예비특보 취소"(부모). 기대는 **"예비특보 취소" 1건**.

- 원인(독립 2 + 검토 1 + 수정 1 + 검증 1 = 5에이전트): § 7.7.12(PR #991)가 자식 **발표(add)** 측만 `CHILD_PRELIM_ADD`/`CHILD_ADD`로 등급 분기하고 **해제(release) 측은 비대칭으로 미수정**. `_buildUserPushChanges` 의 `CHILD_RELEASE`(자식 해제)가 prev 자식 등급 무관하게 발사 → 예비 자식 소멸도 `partial_release`("주의보 일부 해제", `push_helpers` 예비→주의보 보정) 로 나가고, 부모 예비 소멸은 다른 사이클에 `UPCOMING_CANCEL`→`prelim_cancel`("예비특보 취소") 로 나가 templateId 상이 + 비동기 소멸(자식블록 게이트 `!upcomingChanged`)로 2건 분리.
- MD 의도성: **의도 아님.** § 7.7.12는 발표측만 수정 명시(해제측 빈틈), U-1(§1 "동시 해제는 단일 푸시")·S-PRELIM-CANCEL(§4.9 "예비 취소 1건")이 정답.
- 수정: `_buildUserPushChanges` 자식 해제 분기를 **prev 자식 등급으로 분기** — prev 자식이 '예비'인 소멸은 **무푸시**(부모 단일 `UPCOMING_CANCEL`이 대표), 발효중(주의보/경보) 자식 소멸만 기존 `CHILD_RELEASE`→`partial_release` 유지. 메타 불명('')은 보수적으로 기존 유지(누락 푸시 방지). (1지점, +15/-3)
- 검증(라이브): 61개 실전이 전수 비교 → 차이 21건 전부 "예비 자식 소멸 → 무푸시"(정상), 나머지 40건 완전 동일. 발효중 자식 일부해제·부모 lifecycle·디바운스·콜드부팅·dedup 불변(PASS).

### § 7.7.14 통보문 "연안바다 제외"인데 예비엔 "포함"→발효 시 "일부해제" 오발송 — 제외 자식 사후정리 (2026-06-19)

증상: 통보문(제06-34호)은 처음부터 **제주도북부앞바다(연안바다 제외)** 07시 발효인데, 앱이 05:06 "발효시각 변경 …제주도북부앞바다**(연안바다 포함)**" → 07:03 "✅ 풍랑주의보 일부 해제 …**(모든 연안바다 해제)**" 발송. § 7.6.6(#829)에서 같은 패턴을 고쳤는데 **재발**.

- 원인(독립 2 + 검토 1 + 수정 1 + 검증 1 = 5에이전트): § 7.6.6의 제외 게이트(`excludedChildren`, warn-sasc/list `warn_lvl=0`)가 **synth(맹목 합성) 분기에만** 있고, **`prev.children` carry(이어받기)·`_applyChildReleaseDebounce` 등 3경로는 무게이트**. 제외메타는 *현재 사이클* 신호인데 carry는 *영속 prev*라, 메타가 1사이클만 늦어 synth가 유령 자식을 1회 시드하면 게이트 ON 이후에도 carry가 무한 영속 → "(연안바다 포함)" 표기, 발효 시 자식 소멸 → "(모든 연안바다 해제)".
- MD 의도성: § 7.6.6 교정2("carry/디바운스 무게이트는 글리치 방어라 의도적")의 **암묵 가정("유령은 carry 전 차단된다")이 오늘 재발로 반증**. carry의 "글리치 방어"와 "제외 차단"은 별개 역할.
- 수정: 개별 carry 게이트 대신 **단일 사후정리 `_purgeExcludedChildren(snap)`** — 모든 보강·디바운스 직후, `snap.children` 에서 **(warn-sasc/list level-0 명시 ∩ 이번 사이클 라이브 근거 없음)** 인 유령만 제거.
  - **핵심 보강(실데이터 반증)**: "level-0 = 제외"는 거짓 — `warn_lvl=0`은 "미포함(제외)"뿐 아니라 **"아직 미발효(예비)"**도 의미(진짜 예비특보 자식도 list에선 level-0). 그래서 비영속 `liveChildren`(이번 사이클 실 row 근거) 화이트리스트를 도입해, level-0 ∩ live 인 진짜 자식(라이브 21건, 그중 예비 7건)을 **보존**하고 유령(level-0 ∩ ¬live)만 제거.
  - 게이트 소스는 warn-sasc/list 단독(교정1), 글리치(row 부재≠level-0) 방어 보존(교정2와 양립). (+56/-1)
- 검증(라이브): 진짜 예비 자식 7/7 보존, level-0∩live 21건 전부 보존, 유령 주입 시 정확히 1건 제거(형제·부모 보존). liveChildren add 지점 4곳이 라이브 자식 전 출처 커버(누락 경로 0). 콜드부팅·dedup·일부해제 무영향(PASS).

### § 7.7.15 자식 한정사 문구 2건 + 자식 단독 시각/해제예고 푸시 누락 (2026-06-20)

자식(연안/평수) 푸시 문구·로직 3건을 다중 에이전트 교차검증(독립 구현 4 + 메타 종합 1)으로 수정. 파일: `push_helpers.js`·`marine_warning_crawler.js`·`push_sender.js`·`routes/push.js`·`child_bulletin.js`.

- **#1 (문구) child_prelim "발표 예정" 모순 → "추가 발표"로 통일** — 자식 단독 예비특보 발표 시 한정사가 `(연안바다 발표 예정)`. 제목 "📢 …발표"와 모순. 이 케이스는 **부모가 이미 특보중일 때 자식이 새로 예비로 추가**되는 상황(=`additional_active` "추가 발효"와 대칭)이므로, **"추가 발표"**로 통일: 제목 `📢 풍랑주의보 추가 발표`, 한정사 `(연안바다 추가 발표)`(다자식이면 나열, `additional_active`와 동일 형식), 시각은 **발효예정**(추가 발효의 해제예정과 구분). "추가"라는 동사로 "부모까지 발표된 것"이라는 오해도 제거.
- **#2 (문구) "미발효" vs "미발표" 단계 미구분** — "부모만, 자식 미포함" 한정사가 단계 무관하게 `(연안바다 미발효)` 고정. 부모가 **발표(예비) 단계면 "미발표"**, **발효 단계면 "미발효"**. → `TIME_KEY_BY_EVENT`(단일 출처) 기준: `tmEf`(발효예정) 계열(publish·time_ef_change)→"미발표", `tmYn`(해제예정) 계열(active·time_yn_change)→"미발효". (도달 eventType 4종 전수 확인.)
- **#3 (로직) 자식만 해제예고/시각변경 시 푸시 누락** — 통보문이 **자식 해역만 해제예고**(예: 제06-37호 제주도동부앞바다중북동연안바다·제주도서부앞바다중북서연안바다 해제 17시, 부모 불변)인데 푸시 안 나감(앱 표시·데이터는 정상).
  - 원인: 발송경로 `_buildUserPushChanges` 의 자식 독립 블록이 **자식 set 변화만** 처리하고 **자식 단독 시각/해제예고(tmEf/clrNtcTm) 변경 emit 이 전무**. 시각변경은 부모 기준만 계산 → 부모 불변·자식만 해제예고면 무푸시. **MD §4.25/S-CHILD-TIMECH("🕐 자식 시각 변경") 명세인데 사용자 경로 미구현**(비활성 admin DiffMatrix 에만 존재) — 명세-코드 모순.
  - 수정: `_buildUserPushChanges` 에 자식 단독 시각/해제예고 검출 → 신규 `CHILD_TIME_EF_CHANGE`/`CHILD_TIME_YN_CHANGE`(자식 전용 templateId `child_time_ef_change`/`child_time_yn_change`) 1건 발사. 자식 해제예고 필드는 실측상 `clr_ntc_tm` 우선.
  - **정합 4관문(과다발송 방지)**: ① 부모 불변일 때만 ② 자식 set 변화 동반 시 억제(Major-3) ③ 범위↔정확 깜빡임·연장 중복은 `_sameReleaseMoment`/HOLD/연장Set 흡수 ④ 의미있는 변경(없음→값/값→다른모멘트)만. childZones OFF 는 라우트 토글+빈본문 2중 미수신.
  - 자식 전용 templateId 채택: 부모 `time_*_change` 재사용 시 `addToGroup` 그룹키 충돌·혼합 발사·토글 미게이트 위험 → 분리 키로 차단.
  - (정제) #1 은 후속 커밋에서 `(연안바다)` → **"추가 발표"**(제목·한정사)로 통일 — 위 #1 항목이 최종.

검증(라이브 MMIS): #1 `(연안바다 추가 발표)`, #2 publish→미발표/active→미발효, #3 자식만 해제예고 신규(부모불변)→정확 1건 "🕐 해제시각 변경 (…만 시각 변경)" / 부모동반→미발사 / set동반→억제 / 깜빡임→0 / self-diff=0. 회귀 전수(한정사 전 분기·부모 lifecycle·예비취소·release·연장·콜드부팅·excludedChildren·dedup·단일푸시) 보존. §4.25 모순 해소.

---

### § 7.7.16 분할/단건 푸시 미도착의 진짜 원인 — 조각 전송 침묵 실패 + 무재시도, 그리고 인앱 서버로그 뷰어 (2026-06-22)

배경: "(1/2)만 도착, (2/2) 미도착" 및 "서버는 발송 성공인데 내 기기엔 안 옴"을 다중 에이전트로 재분석. (참고: collapse 가설로 만든 #995는 효과 없어 #996으로 revert됨.)

- **원인 (독립 4-에이전트, 4/4 일치)**: "(1/2) 생존 / (2/2) 소멸"은 **collapse 시그니처와 정반대**다. collapse(덮어쓰기)는 규격상 항상 *나중*((2/2))이 살아남아야 한다(오프라인 collapse_key 보관·온디바이스 tag·sw.js tag 모든 레이어 동일). 관측은 *먼저*((1/2)) 생존 → collapse 기각.
  - 진짜 원인 = **두 번째 조각의 `admin.messaging().send()` 가 일시적 FCM 오류로 throw** 됐는데(`messaging/internal-error`·`server-unavailable`·`message-rate-exceeded` = HTTP 500/503/429; firebase-admin 13.6.0 규격 대조 확정), `routes/push.js` 발송 catch 가 **토큰무효 2종 외 모든 예외를 로그·재시도 없이 삼킴** → 영구 소멸. 분할 생성(`paginateByZoneBlocks`)은 node 재현으로 **무결**.
  - **공범**: 상위 `push_sender.js sendToApi` 가 **HTTP 200이면 failCount 무시하고 성공 처리** → 상위 재시도까지 차단. 이 침묵 catch 는 **단건 푸시의 토큰별 실패도 가려** "발송 성공 N명인데 내 기기엔 안 옴"의 동일 공범.
- **수정 1 (발송 신뢰성·관측성, `routes/push.js`)**:
  - `_sendFcmPart`/`_sendWebPushPart` 헬퍼: 일시적 오류만 250/500ms 지수 backoff 최대 2회(총 3회) 재시도. 토큰무효(FCM token-not-registered/invalid, web 404/410)는 **재시도 없이 즉시 dead**(기존 동작 보존). 비일시 오류는 무재시도 기록.
  - 토큰별·조각별 결과 로깅: 성공 시 `[Push/send] OK … msgId=<FCM messageId>`(접수 증거), 실패 시 `FAIL … code=<err.code>`, `DEAD-TOKEN`, 종료 시 `[Push/summary] success/fail`. 토큰은 `_maskTok`(앞6·뒤4)로 PII 최소화.
  - (collapse 고유키는 **제외** — 진짜 원인이 전송실패임이 입증됐고 #995 revert 존중. 추후 로그가 "접수됐는데 미도착"을 보이면 그때 근거 갖고 추가.)
- **수정 2 (인앱 서버로그 뷰어 — fly.io 로그 대체)**: 통합관리자센터 > **점검 > "서버로그"** 하위탭 신설.
  - `services/server_logger.js`: `console.*` 를 가로채(원래 출력 유지) KST 타임스탬프+레벨 붙여 영속 볼륨(`data/server_logs/YYYY-MM-DD.log`, fly `seagnal_data`)에 일별 기록. **2일 보관**(초과 자동삭제), 일자별 12MB 상한(볼륨 보호), 1초 버퍼 flush, 절대 throw 안 함. `server.js` 최상단 `init()`.
  - `GET /api/admin/server-log?from&to&level&q&limit`(`requireAdminToken` 자동 보호): 기간(분 단위)·레벨·검색 필터, 최대 5000줄.
  - UI(`js/admin.js`): 시작/끝 datetime-local(기본 최근 30분), 레벨/검색, "푸시만/에러만" 퀵필터, **조회·복사** 버튼, 모노스페이스 출력. → 휴대폰에서 바로 `[Push/send]` 결과 확인.
- 검증: mock 단위테스트(일시오류 재시도/dead 즉시종료/비일시 무재시도/마스킹), server_logger 기록·기간/레벨/검색 조회, 4개 파일 `node -c`·모듈 로드. data/ 는 gitignore라 런타임 로그 미커밋.

---

### § 7.7.17 §7.7.16 변경의 회귀검토 후속 수정 4건 (다단계 에이전트 파이프라인, 2026-06-22)

§7.7.16(발송 재시도/로깅 + 서버로그 뷰어)을 4개 독립 에이전트로 회귀검토한 결과 위험 4건 발견 → **독립 구현 2 → 병합 1 → 회귀검토 1 → 총합/보고** 파이프라인으로 수정. 변경 파일: `services/server_logger.js`·`routes/push.js`·`server.js`.

- **#1 [심각] 시그널 핸들러 충돌 — graceful shutdown 무력화 (회귀)**: `server_logger.init()` 이 `server.js` 최상단에서 먼저 실행되며 `process.on('SIGINT'/'SIGTERM', ()=>{…process.exit(0)})` 를 등록 → Node 가 시그널 리스너를 등록순으로 호출하므로, **나중에 등록된 `server.js`의 `_gracefulShutdown`(tideBedConfig flush·visitQueue/usageQueue flushSync·build-gzip 자식 정리)이 영영 실행 안 됨**(server_logger 가 먼저 `process.exit(0)` 동기 호출). Fly 재배포 SIGTERM 마다 최대 5초치 통계·설정 유실.
  - 수정: server_logger 가 **SIGINT/SIGTERM 핸들러를 등록하지 않음**. 잔여 버퍼 flush 는 `process.on('exit', onExit)` 로 보장(`_gracefulShutdown` 의 `process.exit(0)` → 'exit' 동기 발화 → 동기 `_flush`). 종료 주도권을 server.js 로 일원화.
- **#2 [권장] 로그 용량 상한 도달 시 ERROR 유실 방지**: 기존엔 일자 12MB 초과 시 그날 **모든** 로그 생략 → 정작 장애 ERROR 가 안 남음. → **2단계 상한**: 소프트(`MAX_DAY_BYTES`=12MB) 초과 시 **INFO 만 생략, WARN/ERROR 는 계속 기록**; 하드(`HARD_MAX_DAY_BYTES`=24MB) 초과 시 전부 중단. 각 마커 1회. 레벨은 버퍼 항목에 동봉(`{day,level,line}`), `_flush` 는 라인 단위 누적 바이트로 경계 정확 판정. getLogs 포맷 불변.
- **#4 [권장] 태풍 자동푸시 경로에도 재시도+로깅 적용**: `/api/push-typhoon` 발송 루프가 §7.7.16 의 헬퍼를 안 타고 옛 침묵 catch 그대로였음 → `_sendFcmPart`/`_sendWebPushPart` 적용(단건이라 part `1/1`). dead 정리·옵트인·master-off·카운터(이중계상 없음) 보존. custom push 경로는 불변.
- **#5 [경미] 주석 정정**: `server.js` "3일 보관" → "2일 보관".
- (#3 재시도 backoff 의 발송 지연은 **구글 FCM 전면장애 가정**이라 의도적으로 미적용 — 평상시 영향 없음.)
- 검증(병합본 재현): #1 종료 시 'exit' flush + graceful shutdown 정상 실행, #2 소프트→INFO만 컷·WARN/ERROR 보존/하드→전체중단·무한증가 없음(delta=0), #4 재시도/dead/이중계상 없음, custom push 바이트 동일. `node -c` 3파일. 회귀검토 종합판정 "진행 가능".

---

### § 7.7.18 fly 볼륨 ENOSPC(디스크 풀) — 조석 곡선 파일 무한누적 + 자동 retention (2026-06-24)

증상: 프로덕션 로그에 `ENOSPC: no space left on device, write` 다발 → `weather_alerts.json`·`prev snapshot`·`precompute_tide_field`·`KHOA 캐시 백업` 저장 실패 → **특보 데이터 갱신 멈춤**. (메모리 아님 — fly 영속 볼륨 `seagnal_data` 포화.)

- **원인 (전수 매핑)**: `data/tide_field/curves/{anchorId}_{YYYYMMDD}.json` 곡선 파일이 **날짜별로 매일 생성되는데 과거 날짜 파일을 지우는 로직이 전무**(`clearCurves`는 rebuild 시 전량삭제만). 시스템은 윈도우(오늘~+2일, `WINDOW_DAYS=3`) 날짜만 읽으므로 과거 파일은 死데이터인데 영구 잔존 → 앵커수×매일 누적(수백 MB~수 GB)으로 볼륨 포화. `precompute_tide_field.js:writeFileSync` ENOSPC 는 *피해자*(곡선이 공간을 채워 frames.bin 쓸 자리 없음).
  - **무혐의 확정**: server_logger(2일 로그)는 소프트12/하드24MB 상한+purge 가 실효 → 최대 48MB, 주범 아님. frames.bin 은 단일 덮어쓰기(누적 아님). 해무 CCTV 스틸컷은 디스크 미저장(메모리 캐시). (uploads/reports 제보이미지는 무정리지만 트래픽 의존 2차요인.)
- **수정 (`tide_field_collector.js`·`server.js`)**: `purgeStaleCurves()` 신설 — 파일명 날짜(mtime 아님)가 `windowDatesKST(WINDOW_DAYS)` 밖이면 삭제(곡선 형식 `_(\d{8})\.json$` 만 대상, 그 외 보존, 절대 throw 안 함). ① **서버 startup(bootstrap 전, ensureBuilt 쓰기 시도 전에 먼저)** 호출 → 볼륨이 꽉 차도 *삭제는 공간 불필요*하므로 **배포 즉시 디스크 회복** ② **수집 사이클마다(spawnPrecompute 직후)** 호출 → 곡선이 영구히 3일치(앵커수×3 ≈ 30~45MB)로 고정, 재발 방지.
- 검증: 임시 디렉토리 재현 — 윈도우(오늘·+1) 곡선 보존, 과거날짜(20200101/20191231) 삭제, 비곡선(grid_meta 등) 보존. `node -c` 통과.

---

# § 8. 부록

본 § 는 시스템의 단일 권위 참조 자료를 한 곳에 모은다. 이전 8,503 줄 단순 concat 문서에서 용어집이 § 1965, § 5276, § 6917, § 8261 의 4 곳에 중복돼 있던 것을 **본 § 8.1 한 곳으로 통일**한다. 다른 § 에서 용어 사용 시 "→ § 8.1 anchor" 식으로 cross-link 한다.

---

## § 8.1 단일 용어집

**본 § 가 유일한 권위. 다른 곳에 용어 정의 없음.** 알파벳 → 한글 순.

### A

- **anchor (발표시각 앵커)** — 한 특보의 lifecycle 동안 최초로 잡힌 tmFc 를 등급 변경 전까지 고정시키는 메모리. 격상/격하 / 종류 변경 시에만 갱신. 구현: `_applyAnnounceAnchor` (`marine_warning_crawler.js`). 도입 커밋: `451f48e` (2026-05-26).

- **active (발효)** — warn/list 응답에 등장하는 현재 효력을 가진 특보 상태. wrnLvlNm = '주의보' 또는 '경보'. templateId 매핑: `active` (🚨). → upcoming 의 대비.

### B

- **baseline (강제)** — resetState 후 prev 를 빈 상태로 두고 현재 활성 특보를 신규로 분류해 push 발사. `_forceBaselinePending=true` 플래그가 1 cycle 보장. E-1 가드 우회. 도입: `5ea305b`.

- **broadcastAll** — baseline + adminToken=undefined 조합. 모든 구독자 대상 발사. 관리자 UI 의 빨간 버튼. 2단계 confirm. 도입 커밋: `c94ea5e` (2026-05-30). → § 7.2.2.

- **buildChildQualifier** — 자식 한정사 `(가파도연안바다)` `(모든 연안바다 해제)` 등의 출력 빌더. 9 분기. 위치: `services/push_helpers.js:533-630`.

### C

- **CHILD_ADD** — change event type. 부모 zone 발효 상태 불변 + 자식 zone 만 추가 발효. → templateId `additional_active` 📢.

- **CHILD_RELEASE** — change event type. 부모 zone 유지 + 자식 zone 일부/전부 해제. → templateId `partial_release` ✅.

- **CHILD_EF_EXTEND / CHILD_YN_EXTEND** — 자식 단독 시각 연장. 부모는 불변. 도입: `7821092`.

- **childState** — change event 에 첨부되는 자식 zone 메타. 키: `all, active, added, released, allReleased, extended, parentTimeUnchanged, timeChanged`. buildChildQualifier 입력.

- **clrNtcTm (해제예고시각)** — mmis 의 정식 필드명. 발효 중에 "이때 해제될 예정" 사전 등록. 옛 dmdw 표기 `tmCc` 와 동의. → § 4.6.

- **콜드 부팅** — 재배포 또는 장부 초기화 직후 prev 가 비어있는 1회 cycle. E-1 가드 발동 조건. 도입 커밋: `6df054a`.

### D

- **debounce (3분 시각변경)** — `_debounceTimeValues`. tmEf/tmYn/clrNtcTm 의 진동을 3분 연속 유지된 값만 확정으로 인정. 도입: `eb06efe` (2026-05-26).

- **decorateZone** — zone 옆 자식 한정사 부착. 위치: `push_helpers.js:240`.

- **DMDW** — Disaster Management Data Warehouse. 옛 KMA 통보문 기반 시스템. 현재 미사용 (Phase 1 폐기). `dmdw_warn_crawler.js`, `services/dmdw_push_sender.js` 잔존하나 `ADMIN_PUSH_ENABLED=false` 라 호출 안 됨.

- **DiffMatrix** — 옛 v7 관리자 푸시 경로의 버킷 분류 (publish, active, additional_active, prelim_cancel, partial_release, release, level_upgrade_publish, level_upgrade_active, level_downgrade_publish, level_downgrade_active, type_upgrade_publish, type_upgrade_active, type_downgrade_publish, type_downgrade_active, time_ef_change, time_yn_change). 현재 `runDiffAndPush` 미호출. 사용자 푸시는 `_buildUserPushChanges` 가 별도 경로.

- **dual-view** — MMIS 의 list(상태) vs latest(통보문) 이중 view. § 5.4 참조.

### E

- **E-1 가드** — 콜드 부팅 + 빈 prev 한정으로 push skip. 현재 정밀화: `isFirstLoad && _isSnapshotEmpty(prev) && !_isSnapshotEmpty(curr)`. 도입 커밋: `baf34fa` → `6df054a` 로 isFirstLoad 한정.

- **E-2 가드** — weather_alerts.json 쓰기 실패 가드. `baf34fa`.

- **E-4 가드** — endpoint 부분 fetch 실패 시 cycle 통째로 skip. `baf34fa`.

- **ef_extend / yn_extend** — change event type. 범위형 → 더 늦은 범위형 의 시각 연장. templateId `ef_extend` / `yn_extend` (🕐).

- **extension memory** — `_extensionMemory`. 5분 (핸드오프 복원) / 6시간 (연장 판별) 직전 특보 메모리.

### F

- **FCM** — Firebase Cloud Messaging. 사용자 푸시 발송 채널. `/api/push-custom` 의 발송 endpoint. WebPush(VAPID) 와 분기 (`routes/push.js:395-441`).

- **forceBaselinePush** — E-1 가드 우회 + 현재 활성 특보를 신규로 감지. `marine_warning_crawler.run({ forceBaselinePush: true })`.

- **fmtUserKMA** — 옛 함수명. 실제 함수는 `formatWarnTimeKST` (`push_helpers.js:34`). 주석 잔재.

- **formatWarnTimeKST** — 푸시 본문 시각 포맷 (상대일자 라벨 없음, 의도적). 위치: `push_helpers.js:34`.

- **formatWarningTime** — 프론트 카드/팝업/지도 시각 포맷 (상대일자 라벨 있음). 위치: `js/utils.js:118`.

### G

- **GAP (발표대기)** — warn/latest cmd='발표' + tm_ef 미래 → list/ready 어느 endpoint 에도 등장 안 함. 1~수 사이클 공백. warn/latest 로 예비 슬롯에 합성. 도입 커밋: `2a21b9c` ~ `0049f2a`.

- **글리치** — MMIS 데이터의 일시적 잘못된 결측 또는 깜빡임. 디바운스로 흡수.

### H

- **HOLD (정확값 고정)** — `_applyTimeWindowHold`. 한 번 정확값으로 잡힌 시각을 범위형으로 되돌리지 않고 유지. 도입: `b05ce1f`.

- **핸드오프 (handoff)** — 예비 → 발표 또는 발효 → 해제 사이 한쪽 endpoint 에서 다른 endpoint 로 데이터 이동. GAP 발생 가능.

### I

- **isCoastal** — 자식 zone 의 type 분류. coastal (연안바다) vs pyeongsu (평수구역). PARENT_CHILD_TYPE 에서 `connection` / `pyeongsu` / `both` 로 매핑.

- **isExactSingleTime** — 자식 카드 발효시각 row 표시 여부 판정. 범위형 / 시간대명 / 빈값 차단. 위치: `render_coastal.js:385`. (V3.1)

- **isFirstLoad** — E-1 가드 정밀화의 핵심 조건. cycle 마다 reset, 첫 cycle 만 true. 도입: `6df054a`.

### K

- **KMA** — 기상청 (Korea Meteorological Administration).

- **KMA 범위코드 (분=58/59)** — 레거시 인코딩 관습. tm_ef 의 분 부분이 58 또는 59 이면 정확시각이 아니라 6시간 범위 (00~06 / 06~12 / 12~18 / 18~24) 를 의미. 도입 시점: § 5.16. 인식 패치: `8a9a798` → `b786ece`.

### L

- **level_upgrade_active / level_upgrade_publish** — 등급 격상 templateId. 주의보 → 경보. 발표(publish) 와 발효(active) 분리. 마찬가지로 `level_downgrade_*` 존재.

- **lifecycle** — 특보가 거치는 단계. 예비 → 발효 → (변경/연장/격상격하) → 해제.

### M

- **MMIS** — Marine Meteorological Information System. marine.kma.go.kr 의 mmis_marine_api 백엔드. KMA 의 구조화된 marine 특보 API. (Phase 2 — 5/22 도입).

### N

- **normalizeMmisTime** — 모든 시각 필드 정규화 (서버측). mmis → 옛 dmdw 한글 표기. mm=58/59 범위코드 보정 포함. 위치: `marine_warning_crawler.js:1799`.

### P

- **PARENT_CHILD_TYPE** — 부모 zone 의 자식 타입 분류 (connection / pyeongsu / both). 위치: `push_helpers.js:417-456`. 28개 부모 분류.

- **PARENT_TO_CHILDREN** — 부모 zone → 자식 zone 정적 매핑. GAP 시 자식 합성에 사용. 신규 자식 등장 시 갱신 필요.

- **pendingPushes** — 발송 실패 그룹의 재시도 큐. `data/pending_pushes.json`. 24h 후 자동 폐기.

- **publish (templateId)** — 발표 통보문 발사 (📢). UPCOMING_CHANGE 신규.

- **PushBuilder / PushSplitter** — 푸시 본문 조립기. 시간그룹 · 콤마결합 · 165자 분할. 위치: `push_helpers.js`.

### R

- **range vs exact (범위 vs 정확값)** — 시각 표기 두 형태. 범위형: "20일 18시~24시". 정확값: "2026.05.20 18:00". HOLD / window 정책의 핵심 구분.

- **release (templateId)** — 정식 해제 발사 (✅). CURRENT_CHANGE curr 없음.

### S

- **StateSnapshot** — 한 cycle 의 정규형 상태. `{ parents, children, upcomings }`. 직렬화 형식. 영속화: `marine_warning_state.json`.

- **suspicious 가드 (D-medium)** — clrNtcTm 없는 3+ zone 동시 사라짐. 인터랙티브 결정 (normal / invalid). `_applySuspiciousGuard`. 도입: `c761225` → `8998037`.

### T

- **T (태풍)** — wrnTp 코드. wrnTpNm '태풍'. allowlist 통과.

- **time_ef_change / time_yn_change** — change event type. tmEf 또는 tmYn 시각만 변경. templateId 동명 (🕐). 범위형 → 정확값 같은 윈도우 내, 또는 정확값 → 정확값 (같은 윈도우 내).

- **tmCc** — 옛 dmdw 표기. mmis 의 `clrNtcTm` 동의.

- **tmEf** — 발효시각 (effective time). 한 특보가 효력을 갖기 시작하는 시각.

- **tmFc** — 발표시각 (announce time). 통보문 발행 시각. anchor 의 입력.

- **tmYn** — 해제예정 (yn = expiry next, warn/list). 이론적 종료 시각.

### U

- **upcoming (예비)** — warn/ready 응답 → leaf.upcoming. wrnLvlNm = '예비' (또는 '예비특보' → 정규화). StateSnapshot.upcomings 슬롯. → active 의 대비.

- **UPCOMING_CHANGE / CURRENT_CHANGE** — change event type. 각각 예비 슬롯 / 발효 슬롯의 변화.

### V

- **V (풍랑)** — wrnTp 코드. wrnTpNm '풍랑'. allowlist 통과.

- **V/T allowlist** — `REALTIME_TARGET_TP = ['V', 'T']`. 강풍(W), 폭풍해일(O) 등 영구 제외. 정책 강제.

- **V10** — warn/latest 정확 해제시각 보강. 도입 커밋: `dbe2c6b`.

- **V11** — 예비 병합 + allowlist. 5/24 정책.

### W

- **warn/list** — 현재 발효 특보 endpoint.

- **warn/ready** — 예비 특보 endpoint.

- **warn/latest** — 가장 최근 통보문 endpoint. GAP 보강 / 정확 해제시각 / 깜빡임 입력.

- **warn-sasc/list, warn-sasc/ready, warn-sasc/latest** — 자식(평수구역·연안바다) 의 동일 endpoint 3종.

- **warn/ef/list** — 시계열 timeline endpoint. 현재 미사용 (인증 필요, 자격증명 부재 환경에서 skip).

- **WI** — Warning Info. 옛 dmdw 통보문 단위.

- **window (해제·발효 윈도우)** — 처음 확립된 범위형의 끝 시각. 윈도우 안 정확값 = 변경, 초과 = 연장. 도입: `b05ce1f`.

- **wrnLvl / wrnLvlNm** — 등급 코드 (1/2/5) / 등급명 (예비/주의보/경보).

- **wrnTp / wrnTpNm** — 종류 코드 (V/T) / 종류명 (풍랑/태풍).

- **wrnZoneCd** — zone 코드. `MMIS_CODE_TO_NAME` 매핑.

### Z

- **zone (부모 zone) vs child (자식 zone)** — 부모: 앞바다·먼바다 (28개). 자식: 연안바다·평수구역.

### 한글 용어

- **연안바다 / 평수구역** — 자식 zone 의 두 분류. 부모 zone 의 PARENT_CHILD_TYPE 으로 결정.

- **발표시각** — tmFc. § 8.1 anchor.

- **발효시각** — tmEf.

- **해제예정** — tmYn (이론값) 또는 clrNtcTm (사전등록 예고).

- **해제시각** — 실제 해제가 일어난 시각.

- **예비** — wrnLvlNm = '예비' 또는 '예비특보'. → § 8.1 upcoming.

- **주의보** — 1차 발효 등급. wrnLvl='1'.

- **경보** — 2차(심각) 발효 등급. wrnLvl='2'.

- **통보문** — KMA 의 1 회 발표 단위. 발표/변경/연장/해제/변경해제 cmd 가짐.

- **시간대명** — 새벽 / 아침 / 낮 / 저녁 / 밤 등의 한글 명칭. `_periodNameByHour` (`marine_warning_crawler.js:1789`).

---

## § 8.2 파일별 책임 매트릭스

| 파일 | 절대경로 | 줄수 | 역할 | 핵심 함수 |
|---|---|---|---|---|
| 메인 크롤러 | `/home/user/SEAGNAL/local_server/marine_warning_crawler.js` | 2577 | snapshot, diff, push 호출, weather_alerts 저장 | `run`, `_buildSnapshotFromMarine`, `_enrichSnapshotWithLatest`, `_buildUserPushChanges`, `_applyXxxGuard`, `_writeWeatherAlertsJson`, `resetState`, `_applyAnnounceAnchor`, `_applyChildReleaseDebounce`, `_debounceTimeValues`, `_applyTimeWindowHold`, `_applyReleaseClrLogic`, `_applyUpcomingEfLogic`, `_applySuspiciousGuard`, `normalizeMmisTime`, `decideSuspiciousCase`, `getSuspiciousState` |
| MMIS HTTP 클라이언트 | `/home/user/SEAGNAL/local_server/services/marine_client.js` | 529 | MMIS API 클라이언트, 인증 세션, rate limit, envelope 정규화, E-4 | `fetchAllRealtimeEndpoints`, `fetchWarnLatest`, `fetchWarnSascLatest`, `fetchWarnEfList`, `_unwrap`, `login` |
| 사용자 push | `/home/user/SEAGNAL/local_server/push_sender.js` | 450 | change → templateId 그룹핑 + /api/push-custom POST | `processChanges`, `sendToApi`, `addToGroup`, `retryPendingPushes` |
| 푸시 메시지 헬퍼 | `/home/user/SEAGNAL/local_server/services/push_helpers.js` | 963 | 메시지 텍스트 포맷, 구역 매칭, 자식 한정사 | `formatWarnTimeKST`, `expandToMinorZones`, `getMatchedZones`, `generateMessage`, `buildChildQualifier`, `PushBuilder`, `PushSplitter`, `_stripParentPrefix` |
| 관리자 푸시 (비활성) | `/home/user/SEAGNAL/local_server/services/dmdw_push_sender.js` | — | 관리자 채널 (ADMIN_PUSH_ENABLED=false 라 호출 안 됨) | `sendPreliminaryRelease`, `enqueueLevelUpgrade`, `forgetChild` |
| Firebase Admin | `/home/user/SEAGNAL/local_server/services/firebase_admin_lazy.js` | — | Firebase Admin lazy init | `getMessaging` |
| 프론트 시간 포맷 | `/home/user/SEAGNAL/local_server/js/utils.js` | 262 | 카드/팝업/지도 시각 포맷 | `formatWarningTime`, `formatDate`, `getKfTime`, `appState` |
| 부모 카드 렌더 | `/home/user/SEAGNAL/local_server/js/render.js` | 1140 | 메인 아코디언, 부모 zone | `formatAlertTime`, `createRow` |
| 자식 카드 렌더 | `/home/user/SEAGNAL/local_server/js/render_coastal.js` | 538 | 연안바다 / 평수구역 카드 | `formatWarningTimeLocal`, `stripYearMonth`, `isExactSingleTime` |
| 사용자 앱 데이터 정규화 | `/home/user/SEAGNAL/local_server/js/data.js` | — | processSingleAlert, isPreliminary 판정 | `processSingleAlert`, `_isExactSingleTime` |
| 푸시 도착 팝업 | `/home/user/SEAGNAL/local_server/fix_popup_logic.js` | — | 푸시 도착 상세 팝업 | `formatDateTime` |
| 지도 폴리곤 박스 | `/home/user/SEAGNAL/local_server/js/ocean_warn_active5.js` | — | 지도 폴리곤 클릭 박스 | `_fmtTime` |
| 부이 시간 | `/home/user/SEAGNAL/local_server/js/render_coastal.js:231` | — | 부이 관측시간 | `formatBuoyTime` |
| /api/push-custom | `/home/user/SEAGNAL/local_server/routes/push.js` | 774 | FCM/WebPush 발송, 만료 정리, history 기록 | route handler |
| admin endpoint | `/home/user/SEAGNAL/local_server/routes/admin.js` | 1840 | reset, suspicious, children-reset, weather-alerts-json | route handler |
| cron orchestrator | `/home/user/SEAGNAL/local_server/scheduler.js` | 1721 | 60초 cron → `marineWarningCrawler.run()` | scheduler loop |
| 서버 진입점 | `/home/user/SEAGNAL/local_server/server.js` | — | Express 부트 | `app.listen` |

---

## § 8.3 환경 변수 + 자격증명

본 § 의 모든 자격증명은 **환경 변수로만 다룬다 (평문 노출 절대 금지)**. 사용자 명시 지침 U-17.

### § 8.3.1 환경 변수 카탈로그

| 변수 | 효과 | 위치 |
|---|---|---|
| `MARINE_USER_ID` | MMIS 로그인 ID | `services/marine_client.js:48` |
| `MARINE_USER_PWD` | MMIS 로그인 PWD | `services/marine_client.js:49` |
| `MARINE_DISABLE` | '1' 이면 강제 비활성 (디버깅용) | `services/marine_client.js:50` |
| `KMA_DMDW_USER_ID` | legacy dmdw 자격증명 (현재 미사용) | `dmdw_warn_crawler.js` |
| `KMA_DMDW_PWD` | legacy dmdw 자격증명 (현재 미사용) | `dmdw_warn_crawler.js` |
| `KMA_DMDW_DISABLE` | legacy dmdw 비활성 토글 | `dmdw_warn_crawler.js` |
| `NODE_ENV` | 환경 (production / development) | 전역 |
| `PORT` | 서버 포트 (3001) | `server.js` |
| `FCM_PROJECT_ID` | FCM 인증 | Firebase Admin |
| `FCM_PRIVATE_KEY` | FCM 인증 | Firebase Admin |
| `FCM_CLIENT_EMAIL` | FCM 인증 | Firebase Admin |
| `ADMIN_PASSWORD` | 관리자 로그인 비밀번호 | `routes/admin.js` |
| `ADMIN_TOKEN_SECRET` | admin token HMAC 키 | `routes/admin.js` |
| `VAPID_PUBLIC_KEY` | WebPush 공개키 | `routes/push.js` |
| `VAPID_PRIVATE_KEY` | WebPush 비공개키 | `routes/push.js` |
| `VAPID_SUBJECT` | WebPush 식별 이메일 | `routes/push.js` |

### § 8.3.2 자격증명 위치

- **로컬 개발**: `.env.example` 참고 (`.env` 는 gitignore).
- **fly.io 배포**: `fly secrets set MARINE_USER_ID=... MARINE_USER_PWD=...`.
- **자격증명 부재 시**: `AUTH_ENABLED = !!USER_ID && !!USER_PWD && !FORCE_DISABLED` (`marine_client.js:51`). 비로그인 endpoint 는 그대로 동작.

### § 8.3.3 보조 자격증명 파일

- **Firebase admin SDK 키**: `local_server/serviceAccountKey.json` (gitignore). 백업: `serviceAccountKey_Backup.json`.
- **VAPID 공개키**: `app_config.json` 또는 frontend `config.js`.
- **API 설정**: `local_server/data/api_config.json`.

### § 8.3.4 자격증명 보안 정책

- 평문 노출 절대 금지. 어떤 산출물 (commit, PR 본문, MD 문서, 로그) 에도 실제 값 기록 금지.
- env 파일 위치: `.env`, `local_server/.env`.
- fly.io secrets 만 사용 운영.

---

## § 8.4 영속화 데이터 파일 5종

| 파일 | 절대경로 | schema | 갱신 시점 | 사용처 |
|---|---|---|---|---|
| `marine_warning_state.json` | `/home/user/SEAGNAL/local_server/data/marine_warning_state.json` | `{ prev: { parents, children, upcomings } }` StateSnapshot 직렬화 | 매 cron 끝 (atomic tmp + rename) | `run()` lazy load → `_loadPrevSnapshot` |
| `weather_alerts.json` | `/home/user/SEAGNAL/local_server/data/weather_alerts.json` | zone 트리 (current / previous / history) — legacy 호환 | 매 cron 끝 | 프론트 폴링 (`/api/weather-alerts`) |
| `custom_push_history.json` | `/home/user/SEAGNAL/local_server/data/custom_push_history.json` | 500 entry capped 발송 이력 | `/api/push-custom` 성공 시 | 관리자 UI 이력 표시 |
| `pending_pushes.json` | `/home/user/SEAGNAL/local_server/data/pending_pushes.json` | failed payload + retry meta | `sendToApi` 실패 시 | `retryPendingPushes` (다음 cycle) |
| `marine_suspicious_state.json` | `/home/user/SEAGNAL/local_server/data/marine_suspicious_state.json` | `{ currentCase, history }` D-medium 의심 상태 | 의심 가드 fire 시 / 결정 시 | 관리자 결정 대기 (`/api/admin/marine/suspicious`) |

### § 8.4.1 보조 영속화 파일

| 파일 | 절대경로 | 역할 |
|---|---|---|
| `subscriptions.json` | `local_server/data/subscriptions.json` | FCM/WebPush 구독자 + options |
| `maintenance_config.json` | `local_server/data/maintenance_config.json` | 점검 모드 토글 `{ active, blockPush }` |
| `weather_alerts.json` `history` 필드 | (위 파일 일부) | 표출용 시계열 (warn/ef/list 미사용 대체) |
| `active_lifecycle.json` | `local_server/data/active_lifecycle.json` | (보조) lifecycle 메타 |
| `warnings.json` | `local_server/data/warnings.json` | 옛 legacy 특보 데이터 (호환) |

### § 8.4.2 직렬화 형식 — StateSnapshot

```javascript
class StateSnapshot {
    parents: Map<zoneName, {
        wrnZoneCd, korNm, wrnTp, wrnTpNm, wrnLvl, wrnLvlNm,
        warnCmdNm, tmFc, tmEf, tmYn, clrNtcTm, prdcGo
    }>
    children: Map<parentName, Map<childFullName, {
        ...같은 구조 + parentName
    }>>
    upcomings: Map<zoneName, {
        ...예비 정보 — 발효중 zone 의 공존 예비
    }>
    // 직렬화: Map → Object 로 JSON 화
}
```

### § 8.4.3 change event types (`_buildUserPushChanges` 출력)

```typescript
type Change =
  | { type: 'UPCOMING_CHANGE',   zone, prev, curr, currentActive, childState }
  | { type: 'CURRENT_CHANGE',    zone, prev, curr, childState }
  | { type: 'EF_EXTEND',         zone, curr, oldTime, newTime, childState }
  | { type: 'YN_EXTEND',         zone, curr, oldTime, newTime, childState }
  | { type: 'CHILD_ADD',         zone, curr, childState }
  | { type: 'CHILD_RELEASE',     zone, prev, childState }
  | { type: 'CHILD_EF_EXTEND',   zone, curr, oldTime, newTime, childState }
  | { type: 'CHILD_YN_EXTEND',   zone, curr, oldTime, newTime, childState }
```

### § 8.4.4 childState

```typescript
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

---

## § 8.5 admin endpoint 카탈로그

| Method | Path | Body | 효과 |
|---|---|---|---|
| POST | `/api/admin/login` | `{ password, longTerm }` | 토큰 발급 |
| POST | `/api/admin/marine/reset` | `{ testPush, adminToken, broadcastAll }` | 장부 초기화 (resetState) + forceBaselinePush. broadcastAll=true → 모든 구독자. adminToken 있으면 그 디바이스만 |
| POST | `/api/admin/alerts-reset` | `{ testMode }` | 옛 legacy 특보 장부 초기화 |
| POST | `/api/admin/children-reset` | `{ windowHours }` | 자식 zone 만 리셋 (윈도우 6~72h) |
| GET | `/api/admin/marine/suspicious` | — | 현재 D-medium 의심 case 조회 |
| POST | `/api/admin/marine/suspicious/decide` | `{ decision: 'normal' \| 'invalid' }` | 의심 case 결정 |
| GET | `/api/admin/weather-alerts-json` | — | 장부 미리보기 |
| POST | `/api/admin/push/broadcast-all` | — | 전체 사용자 재발송 (별도 경로) |
| GET | `/api/admin/health` | — | 서버 상태 |
| POST | `/api/admin/maintenance` | `{ active, blockPush }` | 점검 모드 토글 |
| GET | `/api/admin/custom-push-history` | — | 발송 이력 조회 |
| POST | `/api/admin/push-custom` | (full payload) | 임의 푸시 (관리자) |

### § 8.5.1 사용자 푸시 API

| Method | Path | Body | 효과 |
|---|---|---|---|
| POST | `/api/push-custom` | `{ isManualGroupSend, type, payload, adminToken }` | FCM/WebPush 발송 (사용자별 필터 적용) |
| POST | `/api/push/subscribe` | `{ token, options, zones }` | 구독 등록 |
| POST | `/api/push/unsubscribe` | `{ token }` | 구독 해제 |
| GET | `/api/push/options` | — | 현재 사용자 옵션 |
| POST | `/api/push/options` | `{ options }` | 사용자 옵션 갱신 |

### § 8.5.2 weather_alerts API

| Method | Path | Body | 효과 |
|---|---|---|---|
| GET | `/api/weather-alerts` | — | 현재 zone 트리 (current/previous/history) |
| GET | `/api/weather-alerts/zone/:name` | — | 특정 zone 만 |

---

## § 8.6 새 시나리오 추가 가이드

신규 개발자가 새 시나리오 (예: 강풍 W 지원, 새 templateId) 를 추가하려면 다음 순서로 진행:

### § 8.6.1 단계별 절차

1. **§ 4 (시나리오) 카탈로그에 새 S-* 항목 추가** — 트리거 / 입력 (어느 endpoint row) / 처리 / 푸시 발사 / 카드 표시 5단 구조.
2. **`push_sender.js` 의 templateId 분기에 새 케이스** — `processChanges` 의 그룹핑.
3. **`services/push_helpers.js` `generateMessage` 에 메시지 텍스트 분기** — 본문 양식 (이모지 + 제목 + 시각 라벨 + 자식 한정사).
4. **`js/admin.js` 에 발송 이력 탭 분기** — 관리자 UI 의 이력 표시 (templateId → 한글 라벨).
5. **`marine_warning_crawler.js` 의 diff 로직에 새 change event 타입 (필요 시)** — `_buildUserPushChanges` 의 분기.
6. **카드 표시 분기** — `js/render.js` (부모) / `js/render_coastal.js` (자식) 의 표시 양식.
7. **시각 포맷 분기 (필요 시)** — `normalizeMmisTime` / `formatWarningTime` / `formatWarnTimeKST` 3층 모두.
8. **§ 6 시행착오 항목 추가 (사후)** — 운영 실측 후 발견된 issue 와 fix.
9. **테스트** — § 7.4.3 의 cycle 재현 절차로 dryRun.

### § 8.6.2 강풍(W) 추가 시 점검 항목

- `REALTIME_TARGET_TP = ['V', 'T']` → `['V', 'T', 'W']` 추가.
- `wrnTpNm` 한글 매핑 추가 ('강풍').
- `PARENT_CHILD_TYPE` / `PARENT_TO_CHILDREN` 강풍 zone 검증.
- `push_helpers.js` 의 `"풍랑"` / `"태풍"` 하드코딩 grep → 전부 분기 추가.
- `js/render.js` / `js/render_coastal.js` 의 색상/아이콘 분기.
- `routes/push.js` 의 사용자 옵션 검증.
- 테스트 발사 (테스트 모드).

### § 8.6.3 새 templateId 추가 시 점검 항목

- `push_sender.js` 의 templateId enum.
- `push_helpers.js` 의 `generateMessage` 분기 + 제목 양식 + 이모지.
- `js/admin.js` 발송 이력 라벨.
- 사용자 옵션 (`announce` / `active` / `release`) 어느 토글에 묶일지 결정.
- 야간 차단 적용 여부.

---

## § 8.7 디버깅 가이드

### § 8.7.1 침묵 푸시 진단 (§ 7.4.2 참조)

확인 순서:
1. **푸시 발사 됐는지** — `custom_push_history.json` grep.
2. **changes 빌드 결과** — `_buildUserPushChanges` 출력 (로그).
3. **prev snapshot 상태** — `marine_warning_state.json`.
4. **MMIS 응답 상태** — raw fetch 로그.
5. **사용자 zone 필터** — `getMatchedZones` 결과.
6. **야간 토글** — `subscriptions.json` `user.options.night`.
7. **maintenance 모드** — `maintenance_config.json`.
8. **fly.io 로그 grep** — § 7.4.1 패턴.

### § 8.7.2 시각 표시 이상 진단

- 범위형 vs 정확형: `_isRangeTime(str)` 결과.
- mm=58/59 케이스: `normalizeMmisTime` 결과 확인.
- `formatWarningTime` 의 어느 분기 진입했나 (HH:MM / 한글시각 / 12자리 / 범위).
- 푸시는 `fmtUserKMA` 경로 — 별도 확인.

### § 8.7.3 자식 표출 누락 진단

- warn-sasc/latest 응답에 해당 자식 있나.
- warn-sasc/list/ready 어느 endpoint 에도 없나 (GAP).
- PARENT_TO_CHILDREN fallback 진입 로그.
- `_applyChildReleaseDebounce` 의 carry 로그 (⚡ 깜빡임 감지).

### § 8.7.4 가짜 푸시 의심 진단

- 로그 grep: `[Marine] HOLD` (정확값 고정).
- 로그 grep: `[Marine] 디바운스` (3분 펜딩).
- extension memory 5분 내 발표시각 복원 로그.
- `_clrExtend` / `_efExtend` 플래그 발사 로그.

### § 8.7.5 broadcastAll 후 사용자에게 안 갈 때

- `_forceBaselinePending=true` 상태 확인 (재호출 안 됐는지).
- 다음 cycle 의 push_sender.processChanges 호출 로그.
- `forceBaseline=true` 분기 진입 로그: `강제 baseline 푸시 모드 — E-1 가드 우회`.
- 사용자별 관심해역 필터 (`getMatchedZones`).
- § 7.3.2 의 7 케이스 순차 점검.

### § 8.7.6 디스크 상태 직접 확인

```bash
jq . local_server/data/marine_warning_state.json    # 현재 prev snapshot
jq . local_server/data/weather_alerts.json          # 프론트 표출 데이터
jq . local_server/data/marine_suspicious_state.json # 의심 가드 상태
jq . local_server/data/pending_pushes.json          # 재시도 큐
jq . local_server/data/custom_push_history.json     # 발송 이력
jq . local_server/data/subscriptions.json           # 구독자
jq . local_server/data/maintenance_config.json      # 점검 모드
```

### § 8.7.7 콘솔에서 marine 상태 즉시 확인

```javascript
// node REPL 또는 admin API
const crawler = require('./local_server/marine_warning_crawler');
crawler.getSuspiciousState();   // D-medium 현재 사례
```

```
GET /api/admin/weather-alerts-json
```

### § 8.7.8 raw MMIS 호출

```bash
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/list
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/ready
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn/latest
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/list
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/ready
curl https://marine.kma.go.kr/mmis_marine_api/v1/kma/warn-sasc/latest
```

(인증 불필요 — V9 정책. warn/ef/list 만 인증 필요)

---

## § 8.8 FCM deeplink 파라미터 카탈로그

푸시 알림 클릭 시 진입할 deeplink 양식. `routes/push.js` 의 `data.url` 필드.

| Deeplink | 도착 화면 | 사용처 |
|---|---|---|
| `/?tab=weather-alert-section&popup=true&alertType=풍랑주의보&status=publish&tmFc=...&tmEf=...&tmYn=...&zones=...` | 특보 알림 탭 + 상세 팝업 | 푸시 알림 클릭 |
| `/?tab=weather-alert-section` | 특보 알림 탭 | 일반 진입 |
| `/?tab=ocean-section` | 해양종합정보 탭 | 해양 정보 |
| `/?tab=tide-section` | 조석 탭 | 조석 정보 |
| `/?tab=forecast-section` | 예보 탭 | 일반 예보 |
| `/?tab=weather-alert-section&zone=부산앞바다` | 특정 zone 강조 | zone 별 진입 |
| `/?popup=admin` | 관리자 진입 | admin |

### § 8.8.1 deeplink 파라미터 의미

| 파라미터 | 의미 | 예 |
|---|---|---|
| `tab` | 진입 탭 | `weather-alert-section`, `ocean-section` |
| `popup` | 상세 팝업 자동 열기 | `true` |
| `alertType` | 특보 종류 + 등급 | `풍랑주의보`, `태풍경보` |
| `status` | templateId | `publish`, `active`, `release`, `ef_extend`, `yn_extend`, `additional_active`, `partial_release` |
| `tmFc` | 발표시각 | `2026.06.01 04:00` |
| `tmEf` | 발효시각 | `2026.06.01 12:00` |
| `tmYn` | 해제예정 | `2026.06.02 06:00` |
| `zones` | zone 목록 (콤마 구분) | `부산앞바다,울산앞바다` |
| `oldTime` | (연장만) 기존 시각 | `5월 25일 18시~24시` |
| `newTime` | (연장만) 변경 후 시각 | `5월 26일 00시~06시` |

### § 8.8.2 deeplink 트리거 처리

도착 후: `fix_popup_logic.js` 가 URL params 파싱 → 알림 상세 팝업 자동 열기 (`popup=true` 일 때만).

---

## § 8.9 cross-link 매트릭스 (시나리오 ↔ 코드 ↔ 커밋)

본 § 는 시나리오 ID → 핵심 코드 위치 (파일경로 + 함수) + 관련 커밋 해시 매트릭스.

| 시나리오 ID | 코드 위치 | 관련 커밋 | 비고 |
|---|---|---|---|
| S-COLD | `marine_warning_crawler.js:E-1 가드` | `baf34fa`, `6df054a` | isFirstLoad 한정 |
| S-BASELINE | `routes/admin.js:reset`, `marine_warning_crawler.js:_forceBaselinePending` | `5ea305b`, `c94ea5e` | broadcastAll |
| S-NONE→PRELIM | `marine_warning_crawler.js:_buildUserPushChanges:UPCOMING_CHANGE` | `9651167`, `ff1fe17` | 사용자 채널 복원 |
| S-PRELIM-TIMECH | `marine_warning_crawler.js:_buildUserPushChanges:time_ef_change` | `b411cea` | 시각 변경 |
| S-PRELIM-EXTEND | `marine_warning_crawler.js:_buildUserPushChanges:EF_EXTEND` | `374923d`, `2866fe0` | 범위→범위 |
| S-PRELIM→ACTIVE | `marine_warning_crawler.js:_buildUserPushChanges:CURRENT_CHANGE` | `9651167` | 자연 전이 |
| S-PRELIM-CANCEL | `services/dmdw_push_sender.js:sendPreliminaryRelease` | `5f62ebb`, `e1077ac`, `dd5b1d9` | 정규식 V1→V3 |
| S-NONE→ACTIVE | `marine_warning_crawler.js:_buildUserPushChanges:CURRENT_CHANGE` | `9651167` | 예비 없이 바로 |
| S-ACTIVE-YNCH | `marine_warning_crawler.js:_buildUserPushChanges:time_yn_change` | — | 해제예정 변경 |
| S-LVL-UP | `push_sender.js:level_upgrade_active` | — | wrnLvl 격상 |
| S-LVL-DOWN | `push_sender.js:level_downgrade_active` | — | wrnLvl 격하 |
| S-TYPE-UP / S-TYPE-DOWN | `push_sender.js:type_*` (관리자 채널 비활성) | `aeae518` | 풍랑→태풍 |
| S-RELEASE | `marine_warning_crawler.js:_buildUserPushChanges:CURRENT_CHANGE (curr=null)` | — | 정식 해제 |
| S-CHILD-ADD | `marine_warning_crawler.js:_buildUserPushChanges:CHILD_ADD`, `push_helpers.js:buildChildQualifier` | `f499308`, `3705f4a` | 부모 종속 제거 |
| S-CHILD-RELEASE | `marine_warning_crawler.js:_buildUserPushChanges:CHILD_RELEASE` | `f499308` | 일부 해제 |
| S-CHILD-FULLRELEASE / S-CHILD-BLINK | `marine_warning_crawler.js:_applyChildReleaseDebounce` | `9d47ed3` | 3분 디바운스 |
| S-CHILD-EXTEND | `marine_warning_crawler.js:_buildUserPushChanges:CHILD_EF_EXTEND` | `7821092` | 자식 단독 연장 |
| S-CHILD-TIMECH | `marine_warning_crawler.js:_buildUserPushChanges` | — | 자식만 시각 변경 |
| S-GAP-PARENT | `marine_warning_crawler.js:_enrichSnapshotWithLatest:GAP` | `2a21b9c`, `adab23e` | 발표 발효대기 |
| S-GAP-CHILD | `marine_warning_crawler.js:_enrichSnapshotWithLatest:GAP_CHILD` | `5a9e111`, `0049f2a` | 자식 합성 |
| S-HANDOFF | `marine_warning_crawler.js:_extensionMemory` | `fe0bda5`, `a7bc5c9` | 예비→발표 GAP |
| S-PARALLEL | `marine_warning_crawler.js:StateSnapshot.upcomings` | `5213c83` | 발효+예비 공존 |
| S-PARTIAL-FAIL | `services/marine_client.js:fetchAllRealtimeEndpoints` | `baf34fa` | E-4 |
| S-SUSPICIOUS | `marine_warning_crawler.js:_applySuspiciousGuard` | `c761225`, `8998037`, `abf8c57` | D-medium |
| S-MM58 | `marine_warning_crawler.js:normalizeMmisTime`, `js/utils.js:formatWarningTime`, `push_helpers.js:formatWarnTimeKST` | `8a9a798`, `b786ece` | 3층 패치 |
| S-LATEST-BLINK | `marine_warning_crawler.js:_applyReleaseClrLogic` | `7c981d1`, `b05ce1f` | HOLD |
| S-DEBOUNCE-VIBRATE | `marine_warning_crawler.js:_debounceTimeValues` | `eb06efe` | 3분 디바운스 |

### § 8.9.1 핵심 전환점 커밋 (별★)

| 커밋 | 시점 (UTC) | 의미 |
|---|---|---|
| `095047ad` | 2026-05-21 16:51 | StateSnapshot 베이스 구조 |
| `082da8e` | 2026-05-22 03:13 | v7 통합 활성화 (Phase 2 시작) |
| `baf34fa` | 2026-05-22 03:22 | E-1 + E-2 + E-4 가드 도입 |
| `9651167` | 2026-05-22 08:23 | **사용자 푸시 채널 복원** (침묵 fix) |
| `dbe2c6b` | 2026-05-22 15:31 | V10 warn/latest 정확 해제시각 |
| `ff1fe17` | 2026-05-24 13:21 | 예비 push 부활 + V/T allowlist |
| `aeae518` | 2026-05-24 15:19 | 관리자 push 전면 비활성 |
| `2c25c58` | 2026-05-24 15:37 | A안 코드 매핑 93개 |
| `f499308` | 2026-05-25 14:21 | 자식 독립 push (CHILD_ADD/RELEASE) |
| `3705f4a` | 2026-05-25 13:59 | 자식 표출 부모 종속 제거 |
| `9d47ed3` | 2026-05-25 14:39 | 자식 해제 3분 디바운스 |
| `451f48e` | 2026-05-26 01:10 | tmFc 발표시각 anchor |
| `5213c83` | 2026-05-26 01:16 | 다가오는 특보 병렬 표출 |
| `2866fe0` | 2026-05-26 13:16 | 연장 = 범위→더 늦은 범위 |
| `b05ce1f` | 2026-05-26 14:45 | 정확 해제시각 HOLD + 윈도우 |
| `eb06efe` | 2026-05-26 15:26 | 3분 시각 디바운스 |
| `8a9a798` | 2026-05-30 22:15 | mm=58/59 점·대시 인식 |
| `6df054a` | 2026-05-30 22:33 | **E-1 콜드부팅 1회 한정 + broadcastAll** |
| `c94ea5e` | 2026-05-30 22:36 | 전체 사용자 재발송 빨간 버튼 |
| `b786ece` | 2026-05-30 22:46 | mm=58/59 normalize 보강 |

### § 8.9.2 사용자 요구 (U-*) ↔ 통합본 위치

| 요구 ID | 항목 | 통합본 위치 |
|---|---|---|
| U-1 | 자식 독립 데이터 | § 4 (시나리오), § 5.13 (시행착오) |
| U-2 | 자식 독립 푸시 + 부모와 함께 묶음 | § 4 S-CHILD-ADD/RELEASE |
| U-3 | 자식 해제 디바운스 3분 | § 4 S-CHILD-FULLRELEASE, § 7.1.5 |
| U-4 | 깜빡임 로그 | § 7.4.1 로그 카탈로그 |
| U-5 | 연장 = 범위→범위 만 | § 4 S-PRELIM-EXTEND |
| U-6 | 연장 푸시 양식 | § 4 푸시 텍스트 카탈로그 |
| U-7 | 묶음 + 1/2 2/2 분할 | § 8.5 push_helpers PushSplitter |
| U-8 | 자식 단독 연장 push | § 4 S-CHILD-EXTEND |
| U-9 | 발표시각 anchor | § 7.1.1, § 8.1 anchor |
| U-10 | 다가오는 특보 병렬 표출 | § 4 S-PARALLEL |
| U-11 | UI 화살표 불필요 | (디자인 결정, 문서에 코멘트만) |
| U-12 | broadcastAll | § 7.2.2 |
| U-13 | E-1 가드 isFirstLoad | § 7.2.1 |
| U-14 | 발표시각 04시 보존 | § 8.1 anchor (anchor 의 핵심) |
| U-15 | mm=58/59 점·대시 | § 7.2.3, § 7.1.9 |
| U-16 | 종합 히스토리 MD 작성 | 본 통합본 자체 |
| U-17 | 자격증명 평문 노출 금지 | § 8.3.4 |

---

## § 8.10 검토 보고서 요약

본 § 는 `/tmp/mmis_review/completeness_report.md` (완성도 95/100) 와 `/tmp/mmis_review/compliance_report.md` (지침 준수 74/100) 의 결과를 요약하고, 본 통합본에서 보강 적용한 내역을 정리한다.

### § 8.10.1 직전 통합본 (8,503 줄) 의 완성도 검토 결과

- **점수**: 95/100
- **PASS 영역**:
  - 4 부 구성 안내 + 권장 읽기 순서 모두 보존.
  - 시나리오 카탈로그 21개 + 추가 (S-LATEST-BLINK, S-DEBOUNCE-VIBRATE, S-PARALLEL) 모두 커버.
  - 결정적 시행착오 20건 + 잔여 10+ 건 모두 시간순 인덱싱.
  - MMIS 7 endpoint 모두 다룸 (warn/list, warn/ready, warn/latest, warn/ef/list, warn-sasc/list, warn-sasc/ready, warn-sasc/latest).
  - row 필드 (warn_tp, warn_cmd_nm, tm_ef, clr_ntc_tm, tm_fc, st_tm, ed_tm) 모두 정리.
  - 자격증명 평문 노출 없음 (변수명만 언급).
- **누락 없음**: 사용자 명시 요구 21건 중 21건 커버.

### § 8.10.2 직전 통합본의 지침 준수 검토 결과

- **점수**: 74/100
- **위배 (HIGH)**: **단순 concat** — 8,503 줄 ≈ 4 초안 합 8,423 줄 + 통합 헤더 80 줄.
- **위배 사례**:
  - "MMIS 데이터 모델" 섹션 4번 중복 등장 (줄 176, 4152, 5591, 7310).
  - 용어집 4 곳 중복 (줄 1965, 5276, 6917, 8261).
  - "현재 상태" 4 Part 분산.
  - 부록 (Part A 의 A~LL, Part B 의 7.x, Part C 의 7.x + 부록 Y/Z, Part D 의 7.x) 의 중복.
- **시간순 timeline 통일 부분 위배** — Part A § 5 (Phase 0~2) 와 Part C § 5.1 (5/22~6/1) 와 Part D § 5 가 별도 시간순.

### § 8.10.3 본 통합본의 보강 적용 (목표 99/100)

본 통합본은 다음 보강을 통해 지침 준수를 99/100 으로 목표한다:

1. **단일 용어집** — § 8.1 한 곳만. 다른 § 에서 용어 사용 시 "→ § 8.1 anchor" 식 cross-link. **4 중복 → 1로 통일**.
2. **단일 현재 상태** — § 7 한 곳만. 4 Part 분산 → 본 § 7 단일 흡수.
3. **단일 부록** — § 8 한 곳만. Part A 부록 A~LL 의 내용 일부는 § 4 시나리오 본문으로 이관, 부록은 § 8 의 8.1~8.10 단일 구조.
4. **시나리오 ↔ 코드 cross-link 매트릭스** — § 8.9 한 곳만.
5. **시행착오 단일 timeline** — § 5 한 곳만 (에이전트 3 의 책임 영역).
6. **데이터 모델 단일 § 2** — 한 곳만 (에이전트 1 의 책임 영역).
7. **시나리오 단일 § 4** — 한 곳만 (에이전트 2 의 책임 영역).

### § 8.10.4 보강 후 잔여 위배 가능성

- **시간순 timeline**: Phase 0~2 (5/22 이전 → MMIS 도입) 와 5/22~6/1 fine-grained 두 척도가 § 5 안에 공존. 사용자 의도상 통일된 한 척도가 바람직하나 운영 실측 구분상 두 척도 모두 유지.
- **코드 ↔ 시나리오 cross-link 의 완전성**: § 8.9 의 매트릭스 26 행. 일부 minor 시나리오 누락 가능성. 추가 발견 시 갱신.

### § 8.10.5 검토 보고서 핵심 인용

- 완성도 보고서 (§ 1.1): "Part A — 시나리오 상태머신 + Lifecycle 도식화 / Part B — MMIS 엔드포인트 메커니즘 / Part C — 시행착오 Timeline / Part D — 사용자 표출 + 푸시 텍스트 + 카드 UI"
- 지침 준수 보고서 (§ 1, 지침 8): "가장 심각한 위배. 통합본 8,503 줄 ≈ 4 초안 합 8,423 줄 + 통합 헤더 80 줄. **사실상 단순 concat**."
- 추가지침-A: "자격증명 평문 노출 금지 (보안) — 통합본 검증 결과: **준수** (변수명만 5382 줄에서 언급, 실제 값은 없음)."

---

**§ 7 + § 8 끝.**

본 § 의 § 7 은 현재 운영 상태의 단일 권위 source 이다. § 8 은 용어집 / 파일 책임 / 환경 변수 / 영속화 / admin endpoint / 새 시나리오 가이드 / 디버깅 가이드 / FCM deeplink / cross-link 매트릭스 / 검토 보고서 요약의 10 절 단일 부록이다. 다른 § (0~6) 에서 본 § 의 항목을 참조할 때 "→ § 7.X.Y" 또는 "→ § 8.X.Y" 형식 cross-link 를 사용한다.
