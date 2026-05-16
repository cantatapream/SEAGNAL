# SUBREGION_ALERT 작업 크로스체크 보고서 (2026-05-16)

브랜치: `claude/analyze-weather-alerts-api-4xFjy`
검토 대상: 2026-05-16 commit 13개 (`cd9c46d` ~ `a023c86`)
검토자: 별도 Claude 인스턴스 (작업자와 다른 세션)

---

## 섹션 1 — 합의 사항 누락 검토 (18개)

| # | 합의 사항 | 평가 | 근거 / 비고 |
|---|---|---|---|
| 1 | 9 광역 병렬 수집 (충북·전국 제외) | 잘 구현됨 | `report_alert_processor.js:21` `STN_CODES = [105,109,133,143,146,156,159,184]` (8개). 정책에는 "9 광역"이라 표기되지만 실제는 8 광역. **표현 불일치** (정책 문서 vs 코드) |
| 2 | 1분 사이클 (병렬 호출) | 잘 구현됨 | `scheduler.js:1437` `weatherAlertsCrawler.run()` 매 1분 호출, list.do는 `Promise.allSettled` 병렬 (`report_alert_processor.js:261`) |
| 3 | children 객체 구조 (`{status, tmFc, ...}`) | 잘 구현됨 | `subregion_ledger.js:79 makeChildObject`, 점진적 마이그레이션 (`getChildStatus` 헬퍼) |
| 4 | `source: "inherit" \| "report"` 분리 | 잘 구현됨 | `weather_alerts_crawler.js:243-249` inherit 명시. `routes/admin.js:967` 수동 수정 시 `'report'` 기본값 |
| 5 | 부모 시각 변경 시 inherit 자식 자동 동기화 | 부분 구현 | `subregion_ledger.js:121 syncInheritChildren` 함수는 작성되어 있으나, **실제 호출하는 곳이 없음**. `mapDataToForm` 은 매 사이클 inherit 자식을 새로 만들어 덮어쓰므로 결과적으로 동기화는 되지만, 함수 자체는 dead code |
| 6 | 부모 해제 시 모든 자식 강제 null | 잘 구현됨 | `weather_alerts_crawler.js:212 cascadeRelease` + `mapDataToForm` |
| 7 | 사용자 원칙: 부모 없이 자식 단독 발효 불가 | 잘 구현됨 | `child_alert_validator.js:36-44`, `routes/admin.js:940-957`. 수동 수정 시 차단 + 케이스 ④ 발송 |
| 8 | 자식해역 라이프사이클 전체 추적 | 부분 구현 | `detectChildChanges` (`subregion_ledger.js:177`) 작성됨. **실제 호출 어디서도 없음**. 자식 라이프사이클 알림은 케이스 ①·②·⑥ 만 발송. 격상/격하·연장은 추적 코드 부재 |
| 9 | 단계 건너뛰기 허용 | 잘 구현됨 | `updateZoneStatus` 의 발효·해제·예비 분기는 기존 그대로. P2 단독 발효도 케이스 ①로 발송 |
| 10 | 범위형/정확형 시각 처리 | 잘 구현됨 | `subregion_ledger.js:44 isExactTime` + `checkMonotonicity`, `js/data.js:216 rangeMatch` 클라이언트 처리 |
| 11 | AI + 정규식 Dual Validation | 잘 구현됨 | `subregion_cross_check.js:77 crossCheck`, `report_alert_processor.js:604 runCrossCheck` 호출 |
| 12 | 자식해역 푸시 X (부모만 발송) | 잘 구현됨 | 사용자 푸시는 `push_sender.js processChanges` 만 호출하며 children 비교 안 함. 자식 수정 API 도 사용자 푸시 차단 명시 (`routes/admin.js:867`) |
| 13 | 9 광역 일괄 푸시 (광역별 즉시 발송 X) | 부분 구현 | 자식해역 관련 9 케이스는 통보문 1건마다 즉시 발송 (`report_alert_processor.js:623-659`). 빈도 제어로 폭주는 방지되지만 "광역별 일괄 묶음" 정책과 다소 어긋남 |
| 14 | index2 자식해역 아코디언 활성화 | 잘 구현됨 | `js/data.js:298-327` `coastalMap[childName].push(childAlert)` — `appState.coastalAlerts` 채움. `render_coastal.js` 가 이를 사용 |
| 15 | 예비특보 자연어 해제 → review_needed.json | 부분 구현 | `report_alert_processor.js:676 sendPrelimNaturalCancel` 호출은 있으나, **review_needed.json 에 저장하지는 않음**. 푸시만 발송. 정책 04 의 "review_needed.json 결합" 미반영 |
| 16 | 광역 사이드바 + 3개 탭 통일 | 잘 구현됨 | 인라인(`admin.js:2720`)·모달(`admin_collect.js:70`) 둘 다 3 탭. 사이드바 `ATM_STN_LIST` 9개(전체 포함) |
| 17 | 자식해역 수동 수정 + 체크박스 다중 선택 | 잘 구현됨 | `admin.js:1045 toggleSelectAllChildren`, `routes/admin.js:1011 /bulk` |
| 18 | 통보문 사람 친화 표기 | 잘 구현됨 | `subregion_admin_push.js:41 formatReportLabel` 동작 검증 |

**누락/부분 구현 요약**: 18개 중 ✅ 13개 / ⚠️ 5개 / ❌ 0개

⚠️ 부분 구현된 항목 5개:
- (1) "9 광역" vs 실제 8 광역 — 표현 불일치
- (5) `syncInheritChildren` dead code (결과적 동작은 OK)
- (8) `detectChildChanges` dead code, 자식 라이프사이클 알림은 ①·②·⑥만
- (13) 자식 케이스 ①·②·⑥ 즉시 발송 (빈도제어로 폭주 방지)
- (15) 예비특보 자연어 해제 시 review_needed.json 저장 누락

---

## 섹션 2 — 기존 기능 회귀 위험

### 2-A. 통보문 수집 흐름

| 항목 | 평가 | 비고 |
|---|---|---|
| 전국(108) → 9 광역 전환 | 정상 | 9 광역 합집합 + `seenReportIds` dedup (`report_alert_processor.js:286`). 전국 동일 통보문 dedup OK |
| `processedReportIds` 관리 | 영향 없음 | dedup 로직 unchanged. `pageReports` 단위에서만 정리 |
| 페이지네이션 1→3 | 정상 | `MAX_PAGES_PER_STN = 3`. 광역당 최대 3페이지. 평소 1페이지로 충분 |
| `pendingRetries` (429 재시도) | 영향 없음 | 기존 로직 그대로 `report` 단위 — stn 무관 |

**위험도 LOW**. 단, 호출량 ↑ (9 광역 × 3 페이지 = 27 호출/사이클 → 27 × 60 = 1620 호출/시간) — 기상청 서버에 부담 우려는 작업자도 기록 (`c325ea2` commit 메시지).

### 2-B. 통보문 본문 fetch — **HIGH RISK**

| 항목 | 평가 | 비고 |
|---|---|---|
| `fetchReportDetail(reportId, {stn})` 추가 | 정상 | options.stn 없으면 fallback 108 (`report_alert_processor.js:79`) |
| 9 광역 수집 시 stn 전달 | 정상 | `report.stn` 모든 호출에 전달 (3개 위치) |
| **기존 routes/admin.js 호출자** | **HIGH RISK** | `routes/admin.js:306, 666, 1180` 의 `fetchReportDetail(reportId)` 호출은 stn 없이 호출 → fallback stn=108 사용. **KMA 서버는 stn=108 이고 reportId 광역과 불일치 시 최신 통보문만 반환** (작업자가 정책 01 에 명시한 사항). 즉 `/api/admin/report-collect`, `/api/admin/pending-retries/:reportId/raw`, `/api/admin/reports-collect-all` 가 깨질 수 있음 |
| HTML 엔티티 추가 디코딩 | 정상 | 추가만 함, 기존 디코딩(`&nbsp;`)은 보존 |

**위험도 HIGH**: 어드민 패널의 단일 수집/원문 조회/일괄 수집 3개 API가 광역별 통보문은 본문이 비거나 잘못된 본문을 받아올 가능성 있음. 사용자에게 보이는 변화는 없지만 어드민 기능 회귀.

### 2-C. weather_alerts.json 장부

| 항목 | 평가 | 비고 |
|---|---|---|
| `"Y"` 문자열 ↔ 객체 혼재 | 정상 | `getChildStatus` 헬퍼로 양쪽 처리. 다른 코드에 직접 `=== 'Y'` 비교 거의 없음 (`js/data.js:304` 하나뿐, 자체 정규화) |
| `mapDataToForm` EXCLUDED 보존 | 정상 | `weather_alerts_crawler.js:236, 259` `existingStatus === 'EXCLUDED'` 분기로 보존 |
| 기존 파일 마이그레이션 | 자동 점진적 | 기존 `"Y"` 값은 그대로 유효, 새 통보문 처리 시점부터 객체로 전환. **데이터 무손실** |
| `cascadeRelease` 동작 | 정상, 단 **신경 쓸 점** 1개 | `subregion_ledger.cascadeRelease` 는 객체 → null 로 강제. `child_alert_validator.cascadeParentRelease` 는 객체의 status만 null, 메타 보존. 둘 다 존재하지만 사용 위치는 `subregion_ledger.cascadeRelease` 만 (`weather_alerts_crawler.js:212`). 보존 vs null 정책 불일치 — 후자는 dead code 가능성 |

**위험도 LOW**: 호환성 헬퍼 잘 설계됨.

### 2-D. 사용자 화면 (index2)

| 항목 | 평가 | 비고 |
|---|---|---|
| `processSingleAlert` 자식 객체 처리 | 정상 | `js/data.js:298` 신·구 형식 분기. `tmFc/tmEf/tmCc` 자식 우선 |
| `render_coastal.js` detailBox | 정상 | `alert.tmFc`, `alert.tmEf` 사용 (`render_coastal.js:515-516`) — data.js 가 이미 객체 시각 풀어둠 |
| EXCLUDED 자식 표시 | 표시 안 됨 | `js/data.js:304` `if (childStatus !== 'Y') continue` — EXCLUDED는 coastalMap 미진입. 사용자에게 보이지 않음. 정책 02 (§3 EXCLUDED는 발효 X, 표시 X) 와 일관됨 |

**위험도 LOW**.

### 2-E. 어드민 패널 (admin.js)

| 항목 | 평가 | 비고 |
|---|---|---|
| `buildZoneAccordion` 자식 영역 추가 | 정상 | `admin.js:957 ${buildChildZoneSection(zoneName)}` — 부모 아코디언 펼침 시에만 보임 |
| 자식 모달 vs 부모 모달 충돌 | 정상 | id 다름 (`child-alert-edit-modal` vs 기존 `alert-edit-modal`), z-index `10001` 로 위쪽 |
| `openAddAlertModal`, `openManualPushModal` | 영향 없음 | 라인 1503·1861 — 자식 코드는 별도 함수로 분리 |
| **`buildChildZoneSection` 의존성** | **MEDIUM RISK** | `COASTAL_MAPPING` 전역에 의존. 부모 키가 매핑에 없으면 자식 영역 렌더 X. **mappings.js 의 `경기북부앞바다`** 같이 카탈로그에 없는 부모는 자식 표시되지만 백엔드 검증에서 차단될 수 있음 |
| 자식 상태 표시 미반영 | 누락 | `status-${childId}` span 에 `ⓘ 미발효` 정적 표시 — 실제 장부 status (`Y`/`EXCLUDED`/null) 동적 반영 누락. 모달 열 때 상태 확인 가능하나 카드에서는 표시 X |

**위험도 MEDIUM**: 부모 모달 회귀는 없으나, 자식 영역의 상태 표시가 정적 — 관리자가 현재 status 모름.

### 2-F. 어드민 특보 수집 테스트

| 항목 | 평가 | 비고 |
|---|---|---|
| 인라인 전망 수집 탭 추가 | 정상 | `admin.js:2720`, `switchAlertTestTab` 는 `admin_collect.js:133` 에 정의 (전역) — 모달·인라인 공유 |
| 광역 사이드바 (모달·인라인 둘 다) | 정상 | `admin_collect.js:228 renderATMCollect` 가 양쪽에서 사용됨 |
| **`atmFetchReports` stn 필터링** | **검토 필요** | 현재 코드는 `stn` 파라미터를 보내지 않음 (`admin_collect.js:436` `fetch('/api/admin/reports?date=' + date)`) — 백엔드는 미지정 시 9 광역 합산. 사이드바에서 광역 선택 시 `atmSelectStn` 이 클라이언트 측 필터링만 수행 (`_atmReports.filter(r => r.stn === stn)`). 정상 동작이지만 광역별 호출 X (백엔드 비효율) |

**위험도 LOW**: 이중 호출 대신 클라이언트 필터링 — 더 효율적인 선택.

### 2-G. 관리자 푸시 (admin_push)

| 항목 | 평가 | 비고 |
|---|---|---|
| 9 케이스 추가 | 정상 | `subregion_admin_push.js` 각 케이스마다 `shouldSend(key, minIntervalMs)` 빈도제어 내장 (1초 ~ 24시간) |
| **케이스 ③ 즉시 발송 (1초 간격)** | **검토 필요** | `subregion_cross_check.js:147 if (!shouldSend(key, 1000))` — 1초 간격은 같은 reportId 에 대해서만 차단. 다른 reportId 시 1초마다 발송 가능. 정상 흐름에서는 reportId 당 1회만 발생하므로 문제 없음 |
| 기존 `sendAdminPush` 호출자 영향 | 영향 없음 | `gemini_client.js:91`, `admin_push.js:28` 시그니처 유지 |
| `data/admin_push_throttle.json` 자동 생성 | 정상 | `subregion_admin_push.js:79 saveThrottle` 가 없을 때 fs.writeFileSync 로 생성 |

**위험도 LOW**.

### 2-H. API 라우트 (routes/admin.js)

| 항목 | 평가 | 비고 |
|---|---|---|
| 신규 자식해역 4개 API | 정상 | path 충돌 없음 (`/manual-child-alert`, `/check-child-principle`) |
| 신규 `/reports-stats` | 정상 | 광역별 카운트만 |
| **`/reports` stn 파라미터** | **검토 필요** | 미지정 시 9 광역 합산. 기존 호출자가 stn 없이 호출하면 9 광역 합산 결과를 받음. 페이지네이션 1→3 으로 변경 — **응답 크기 증가**. 클라이언트(`admin_collect.js`)는 기존과 동일하게 처리 가능 |
| **단일/일괄 수정에서 stn=null** | 정상 | `routes/admin.js:948, 982, 1038, 1070` `stn: null` 명시. `formatReportLabel` 은 stn=null 시 광역 약칭 생략. 코드 OK |

**위험도 LOW-MEDIUM**: `/reports` 응답 크기 증가로 페이지 로딩 약간 느려질 수 있음.

### 2-I. 자식해역 파서·정규식

| 항목 | 평가 | 비고 |
|---|---|---|
| P1·P2 정규식 | 정상 | `subregion_parser.js:24 PARENT_PAREN_RE` — 5년 CSV 검증. 미래 형식 변경 시 파서 실패 → 케이스 ⑤ 자동 알림 (단, ⑤ 발송하는 코드는 미확인) |
| 자연어 해제 정규식 | 정상 | `PRELIM_CANCEL_NATURAL_RE` — "낮[아어]져 해제" 범위 좁음, false-positive 가능성 낮음 |
| 명칭 정규화 폴백 | 정상 | `subregion_normalizer.js:65 normalizedInput = appName.replace(/\s+/g, '')` 공백 무시 매칭 |
| **신규 자식 명칭 등장 시** | 정상 | 케이스 ⑥ `sendUnknownChildName` 자동 발송 (`report_alert_processor.js:629`) — 카탈로그에 없는 자식 발견 시 1일 1회 푸시 |
| **케이스 ⑤ 파서 실패** | **누락** | 코드 grep 결과 `sendParserFailure` 호출처 0건. 정의는 되어 있으나 호출되지 않음 — dead code |

**위험도 LOW**: 케이스 ⑤ 미사용은 정책 누락이지만 실제 회귀 위험은 없음 (그냥 알림이 안 옴).

### 2-J. 통합 흐름

| 항목 | 평가 | 비고 |
|---|---|---|
| 1분 사이클 다른 작업 영향 | 정상 | 자식해역 처리는 `applyNewReports` 내부에서만, 다른 setInterval 무관 |
| AI 토큰 비용 | 영향 없음 | 자식 추출은 정규식만 (`subregionParser.extractChildrenFromBody`) |
| 9 광역 ↔ 부이/해상기상 | 정상 | list.do 9 광역 호출만, marine.kma.go.kr 등 다른 API 영향 없음 |
| **`scheduler.js` setInterval 부담** | LOW | 1분당 추가 27회 HTTPS 호출 — 기존 200~300회 사이클에 9% 증가 |

**위험도 LOW**.

---

## 섹션 3 — 권장 후속 조치

### HIGH 위험 (즉시 조치)

#### 3-1. `routes/admin.js` 3개 API 의 `fetchReportDetail` 호출에 stn 누락 — **HIGH**
- **위치**: `routes/admin.js:306` (`/report-collect`), `:666` (`/pending-retries/:reportId/raw`), `:1180` (`/reports-collect-all`)
- **증상**: 어드민이 수동으로 통보문을 재수집/원문 조회할 때 fallback stn=108 사용 → KMA 서버가 reportId 무시 후 최신 통보문 반환할 가능성
- **권장 조치**: 호출자가 `report.stn` 을 받아서 `fetchReportDetail(reportId, { stn })` 형태로 전달. 클라이언트 측 `admin_collect.js` `atmCollectOne` 도 `report.stn` 을 함께 보내야 함
- **소요**: 4~6 줄 변경

### MEDIUM 위험 (운영 중 관찰)

#### 3-2. 자식해역 카드 상태 표시 정적 — **MEDIUM**
- **위치**: `js/admin.js:998` `<span id="status-${childId}">ⓘ 미발효</span>`
- **증상**: 어드민이 부모 카드 열어도 자식 status(`Y`/`EXCLUDED`/null) 실시간 미반영
- **권장 조치**: `buildChildZoneSection` 호출 시 fullForm 또는 alerts 에서 자식 status 조회 후 동적 표시
- **소요**: 10~20 줄

#### 3-3. 자식 케이스 ①·②·⑥ 통보문당 즉시 발송 — **MEDIUM**
- **위치**: `report_alert_processor.js:623-659`
- **증상**: "9 광역 일괄 묶음 푸시" 정책 13과 일치하지 않음. 빈도제어 내장으로 폭주 방지는 됨
- **권장 조치**: 1 사이클 종료 후 모아서 광역별 1회 발송하는 큐 방식으로 변경. 현재 상태로도 운영은 가능
- **소요**: 30~50 줄

### LOW 위험 (무시 가능 / 후속 정리)

#### 3-4. 정책-코드 표현 불일치 ("9 광역" vs 실제 8 광역) — **LOW**
- **위치**: 정책 문서 전반 ("9 광역") vs `STN_CODES` 배열 (8개)
- **증상**: 전국(108)을 9 번째로 카운트한 듯 보이지만 실제 코드는 stn=108 제외
- **권장 조치**: 정책 문서를 "8 광역" 으로 통일하거나 코드 주석에 "전국 108 제외" 명시 (이미 명시되어 있긴 함)

#### 3-5. dead code 정리 — **LOW**
- `subregion_ledger.syncInheritChildren` (호출처 없음)
- `subregion_ledger.detectChildChanges` (호출처 없음)
- `subregion_admin_push.sendParserFailure` (케이스 ⑤, 호출처 없음)
- `child_alert_validator.cascadeParentRelease` (호출처 없음 — `subregion_ledger.cascadeRelease` 만 사용)
- **권장 조치**: 정책에 명시된 기능을 실제로 호출하거나, 호출 위치 명시. 미사용이면 주석으로 "예비" 표기

#### 3-6. 예비특보 자연어 해제 review_needed.json 미저장 — **LOW**
- **위치**: `report_alert_processor.js:676 sendPrelimNaturalCancel` 호출 시 푸시만 발송, review_needed 저장 X
- **증상**: 정책 04 의 "review_needed.json 결합" 흐름 부분 누락
- **권장 조치**: 자연어 해제 매칭 시 review_needed.json 에 항목 추가 (다른 케이스에서 하는 방식과 동일)
- **소요**: 10 줄

#### 3-7. weather_alerts.json 자동 마이그레이션 검증 — **LOW**
- 기존 `"Y"` 값은 그대로 유지되어 영향 없음. 새 통보문 도착 시 객체로 자동 전환
- **권장 조치**: 운영 시작 후 일주일 내 weather_alerts.json 백업 → children 값 분포 모니터링

#### 3-8. `/api/admin/reports` 응답 크기 증가 — **LOW**
- 페이지네이션 1→3 + 9 광역 dedup 으로 응답 크기 증가 가능
- **권장 조치**: 클라이언트 측 페이지네이션 또는 응답 압축 검토 (현재로도 무리 없을 듯)

---

## 종합 평가

- 18개 합의 사항 중 **5개 부분 구현** (1개 표현 불일치, 4개 누락 또는 dead code)
- 회귀 위험 영역 10개 중 **HIGH 1건** (admin API `fetchReportDetail` stn 미전달), **MEDIUM 2건**, 나머지 LOW
- 신규 모듈 4개·기존 파일 보강 6개 — 모두 syntax OK
- 사용자 화면(`index2`) 회귀 위험 없음 (data.js 호환성 충분)
- 가장 시급한 조치: **3-1 (admin API stn 전달)** — 4~6 줄 수정으로 해결 가능

### 검토 절차

1. git log 13개 commit `git show --stat` 확인 — 변경 라인 추적
2. 신규 모듈 4개 (subregion_*) 및 child_alert_validator + subregion_parser 직접 Read
3. `report_alert_processor.js` (1075 줄) 부분 Read — 9 광역 수집·자식 파서 통합 흐름
4. `weather_alerts_crawler.js` (521 줄) mapDataToForm·createZoneStructure 검증
5. `routes/admin.js` (1798 줄) 신규 API 4개·수정된 `/reports` 검증
6. `js/data.js` processSingleAlert · `js/admin.js` buildChildZoneSection · `js/admin_collect.js` 사이드바
7. grep 으로 18개 합의 사항 각 키워드 검증 + 호출처 추적 (dead code 검출)
