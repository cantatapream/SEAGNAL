# SEAGNAL 리팩토링 상세 작업 로그

> 모든 시간은 대한민국 표준시(KST, UTC+9) 기준

---

## 2026-02-24

### [기능 확장] 특보 히스토리 팝업 기능 추가

#### 배경:
- 특보 카드에서 해당 해역의 통보문 발표 이력을 확인할 수 있는 기능 요청
- 예비특보 → 주의보 → 경보 등 특보 진행 과정을 추적 가능하게 함

#### 작업 내용:

1. **data.js 수정** - `processSingleAlert()`에서 `alertItem.history` 필드 추가
   - 기존: history는 격상/격하 판별에만 사용되고 프론트엔드에 전달되지 않음
   - 변경: alertItem 객체에 `history: history || []` 추가하여 프론트엔드에서 접근 가능
   - 영향: 기존 로직 변경 없음 (속성 추가만)

2. **routes/weather.js 수정** - `/api/bulletin-cache/:reportId` 엔드포인트 추가
   - collect_cache 디렉토리의 통보문별 AI 분석 캐시를 조회하는 API
   - reportId를 파일명으로 변환하여 JSON 응답
   - 영향: 기존 라우트와 완전 독립

3. **js/alert_history.js 신규 생성** - 특보 히스토리 팝업 모달 컴포넌트
   - `showAlertHistoryPopup(zoneName, history)`: 팝업 표시
   - `closeAlertHistoryPopup()`: 팝업 닫기
   - 각 통보문 항목을 아코디언 형태로 표시
   - 아코디언 펼침 시 `/api/bulletin-cache` API로 AI 분석 결과 조회
   - 해당 해역(zoneName) 관련 이벤트만 필터링하여 표시
   - 캐시 미존재 시 fallback으로 history 항목 기본 정보 표시
   - 기존 다크테마 UI 패턴 준수 (z-index: 10001, ESC 닫기, 오버레이 클릭 닫기)

4. **js/render.js 수정** - `createAlertElement()`에 히스토리 아이콘 버튼 추가
   - 해역명(.zone-name)과 뱃지(.alert-badges) 사이에 시계 아이콘 버튼 삽입
   - history 배열이 비어있으면 버튼 미표시
   - 버튼 클릭 시 `showAlertHistoryPopup()` 호출
   - `e.stopPropagation()`으로 카드 아코디언 토글 방지
   - 카드 클릭 핸들러에 `.alert-history-btn` 예외 추가

5. **index.html 수정** - `alert_history.js` 스크립트 태그 등록
   - render.js 다음, render_coastal.js 이전에 배치

#### 기존 기능 영향 분석:
| 항목 | 영향 | 비고 |
|------|------|------|
| 특보 카드 렌더링 | 없음 | 버튼 추가만, 기존 뱃지/상세정보 로직 미변경 |
| 카드 아코디언 토글 | 없음 | stopPropagation + closest 예외 처리 |
| 연안바다 카드 | 없음 | createCoastalElement에서 history 미참조 |
| 격상/격하 판별 | 없음 | history 참조 로직 미변경 |
| 특보 해제 시 히스토리 초기화 | 정상 동작 | report_alert_processor.js의 `value.history = []` 유지 |
| API 라우트 | 없음 | 신규 엔드포인트만 추가, 기존 라우트 미변경 |

#### 변경 파일:
- `local_server/js/data.js` (1줄 수정)
- `local_server/routes/weather.js` (19줄 추가)
- `local_server/js/alert_history.js` (신규, ~340줄)
- `local_server/js/render.js` (~50줄 추가)
- `local_server/index.html` (1줄 추가)

---

## 2026-02-19

### [09:00 KST] Phase 1 시작 - 스테이징 인프라 구축

#### 작업 내용:
1. **프로젝트 분석 완료**
   - server.js (2,758줄): Express 라우트 41개, 크론잡 4개, 외부 서비스 5개 연동
   - app.js (12,077줄): 프론트엔드 전체 기능 (특보, 해구별, 부이, 조석, 관리자, 통계 등)
   - 기존 모듈 파일 21개 분석 (seaZones.js, tide.js, scheduler.js 등)

2. **리팩토링 계획 수립**
   - Phase 1: 스테이징 인프라 구축
   - Phase 2: 문서화 기반 설정
   - Phase 3: 서버 리팩토링 (server.js → config/ + routes/ + services/)
   - Phase 4: 프론트엔드 리팩토링 (app.js → js/ 하위 13개 모듈 그룹)
   - Phase 5: 최종 검증 및 프로덕션 전환

3. **결정사항**
   - 스테이징 앱 이름: seagnal-staging
   - 프론트엔드 모듈 방식: Script 태그 유지 (가장 안전)
   - 리팩토링 순서: 설정 → 유틸 → 핵심기능 → 관리자 → 푸시알림(마지막)

#### 생성 파일:
- `fly.staging.toml` - 스테이징 서버 Fly.io 설정
- `.github/workflows/deploy-staging.yml` - 스테이징 자동 배포 워크플로우
- `00_docs/REFACTORING_STATUS.md` - 리팩토링 종합 현황
- `00_docs/REFACTORING_LOG.md` - 상세 작업 로그 (본 파일)

#### 폴더 구조 생성:
```
local_server/
├── config/          (서버 설정)
├── routes/          (API 라우트)
├── services/        (비즈니스 로직)
└── js/              (프론트엔드 모듈)
    ├── 00_config/   ├── 01_core/    ├── 02_alerts/
    ├── 03_marine/   ├── 04_buoy/    ├── 05_windy/
    ├── 06_settings/ ├── 07_admin/   ├── 08_promo/
    ├── 09_analytics/├── 10_ui/      ├── 11_geo/
    ├── 12_status/   └── 13_push/
```

#### 사용자 직접 실행 필요 사항:
```bash
# 1. flyctl 설치
curl -L https://fly.io/install.sh | sh

# 2. 로그인
flyctl auth login

# 3. 스테이징 앱 생성
flyctl apps create seagnal-staging

# 4. 볼륨 생성
flyctl volumes create seagnal_staging_data --region sin --size 1 --app seagnal-staging

# 5. 환경변수 설정 (프로덕션과 동일한 시크릿)
flyctl secrets list --app seagnal-server
flyctl secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... --app seagnal-staging

# 6. 초기 배포
flyctl deploy --config fly.staging.toml --remote-only
```

---

### [계속 작업 중] Phase 3 시작 - 서버 리팩토링

(Phase 3~5 리팩토링 완료. 아래 기능 확장 작업 기록 계속)

---

## 2026-02-21

### [기능 확장] 설문조사 기능 구현

> 리팩토링 Phase 5 완료 이후, 기존 모듈 구조를 따르는 신규 기능 추가 작업

---

### [14:00 KST] 구현 계획 수립 - 설문조사 기능

#### 요구사항 분석:
- 관리자가 설문을 생성/관리/분석하는 기능
- 사용자에게 앱 접속 시 자동으로 설문 팝업 표시
- **핵심 요구**: 완료한 설문은 다시 표시되지 않도록 하여 사용자 불편 방지
- 설문 결과를 차트로 시각화 + CSV 다운로드

#### 구현 계획:
1. **백엔드 API** (routes/survey.js) - 설문 CRUD, 응답 수집, CSV 다운로드
2. **관리자 UI** (js/admin_survey.js) - 설문 생성/현황/결과/이력 4개 서브탭
3. **사용자 팝업** (js/survey_user.js) - 접속 시 자동 팝업 + localStorage 완료 기록
4. **기존 파일 수정** - server.js, config, admin.js, index.html 최소 수정

#### 설계 결정사항:
- 재표시 방지: localStorage `seagnal_survey_done_{surveyId}` 키 사용
- 서버 이중 방어: deviceId 기반 중복 응답 체크
- 질문 유형 5종: 단일선택, 복수선택, 주관식, 별점평가, 드롭다운
- 데이터 저장: surveys.json(메타) + survey_responses_{id}.json(응답 별도)

---

### [14:30 KST] 백엔드 API 구현 - routes/survey.js (361줄)

#### 작업 내용:
1. **파일 생성**: `local_server/routes/survey.js`
2. **API 엔드포인트 10개 구현**:
   - `GET /api/surveys` - 전체 설문 목록 (상태 자동 업데이트 + 응답 수 포함)
   - `GET /api/surveys/active` - 사용자용 활성 설문 목록
   - `POST /api/surveys` - 설문 생성 (title, description, questions, 기간, 옵션)
   - `PUT /api/surveys/:id` - 설문 수정 (부분 업데이트 지원)
   - `DELETE /api/surveys/:id` - 설문 삭제 (응답 파일도 함께 삭제)
   - `POST /api/surveys/:id/close` - 조기 마감 (status → 'closed')
   - `POST /api/surveys/:id/duplicate` - 복제 (제목에 '(복사본)' 추가, draft로 생성)
   - `GET /api/surveys/:id/responses` - 응답 목록 조회
   - `POST /api/surveys/:id/respond` - 응답 제출 (deviceId 중복 체크)
   - `GET /api/surveys/:id/csv` - CSV 다운로드 (BOM 포함, 한글 엑셀 호환)
3. **헬퍼 함수**: readSurveys(), writeSurveys(), kstNow(), autoUpdateStatus()
4. **기한 자동 마감**: endDate 경과 시 자동으로 status를 'closed'로 변경

#### 생성 파일:
- `local_server/routes/survey.js` (361줄)

---

### [15:00 KST] 관리자 UI 구현 - js/admin_survey.js (679줄)

#### 작업 내용:
1. **파일 생성**: `local_server/js/admin_survey.js`
2. **서브탭 4개 구현**:
   - **설문 생성 탭**: 제목/설명/기간/익명/중복응답 설정, 질문 동적 추가/삭제/순서변경
     - 질문 유형: radio(단일선택), checkbox(복수선택), text(주관식), rating(별점), dropdown
     - 선택지 동적 추가/삭제, 필수 여부 토글, 별점 최대점수 설정
     - 초안 저장 또는 즉시 발행 가능
   - **진행 현황 탭**: 활성/초안 설문 카드 목록
     - 기간 프로그레스 바, 응답 수 표시
     - 결과보기/마감/수정 (활성), 발행/수정/삭제 (초안) 액션 버튼
   - **결과/분석 탭**: 설문 선택 → 질문별 차트 시각화
     - 단일선택: 도넛 차트, 복수선택: 가로 막대 차트
     - 별점: 평균 별 표시 + 점수 분포 세로 막대 차트
     - 주관식: 최근 10건 목록 표시, CSV 다운로드 버튼
   - **이력 관리 탭**: 월별 그룹화, 상태 아이콘, 복제/삭제/CSV 액션
3. **Chart.js 연동**: 도넛/가로막대/세로막대 차트 생성 함수 3개
4. **_surveyCharts 배열**: 탭 전환 시 기존 차트 destroy() 후 재생성 (메모리 누수 방지)

#### 생성 파일:
- `local_server/js/admin_survey.js` (679줄)

---

### [15:30 KST] 사용자 팝업 구현 - js/survey_user.js (362줄)

#### 작업 내용:
1. **파일 생성**: `local_server/js/survey_user.js`
2. **IIFE 패턴**: 즉시실행함수로 감싸 전역 스코프 오염 방지
3. **3개 화면 구현**:
   - **화면 1 (초대 팝업)**: 설문 제목/설명/문항 수/마감일 표시, 참여하기/나중에 버튼
   - **화면 2 (설문 진행)**: 스텝 방식(한 질문씩), 프로그레스 바, 이전/다음/제출 버튼
     - radio/dropdown: 선택지 카드 UI (터치 최적화)
     - checkbox: 다중 선택 카드 UI
     - rating: 별 터치 UI (★☆)
     - text: textarea + 글자수 카운터
   - **화면 3 (완료)**: 체크 아이콘 바운스 애니메이션, 감사 메시지
4. **재표시 방지 로직 (핵심)**:
   - `isSurveyDone(id)`: localStorage에서 'seagnal_survey_done_{id}' === 'true' 확인
   - `markSurveyDone(id)`: 제출 성공 시에만 localStorage에 기록
   - `initSurveyCheck()`: 앱 로딩 3초 후 active 설문 조회 → 미완료 설문만 팝업
   - "나중에" 클릭 시: 아무것도 저장하지 않음 → 다음 접속 시 재표시
5. **기기 식별**: deviceId를 localStorage에 생성/저장하여 서버 측 중복 체크에 활용

#### 생성 파일:
- `local_server/js/survey_user.js` (362줄)

---

### [16:00 KST] 기존 파일 수정 (최소 변경)

#### 작업 내용:
1. **config/server_config.js** (1줄 추가)
   - FILES 객체에 `SURVEYS: path.join(DATA_DIR, 'surveys.json')` 추가
   - 기존 6개 경로 유지, 7번째로 SURVEYS 추가

2. **server.js** (2줄 추가)
   - `app.use(require('./routes/survey'));` 라우터 등록 (admin 다음)
   - 로그 메시지에 'survey' 추가

3. **js/admin.js** (2개소 수정)
   - tabs 배열에 `{ id: 'survey', name: '설문조사', icon: 'fa-clipboard-list' }` 추가
   - 탭 전환 분기에 `else if (tabId === 'survey') renderUnifiedSurveyContent(body);` 추가

4. **index.html** (2줄 추가)
   - `<script src="js/admin_survey.js"></script>` (admin_collect.js 다음)
   - `<script src="js/survey_user.js"></script>` (admin_survey.js 다음)

5. **data/surveys.json** (신규 생성)
   - 빈 배열 `[]`로 초기화

#### 수정 파일 목록:
| 파일 | 변경 내용 | 변경량 |
|------|----------|--------|
| config/server_config.js | FILES.SURVEYS 추가 | +1줄 |
| server.js | survey 라우터 등록 + 로그 | +2줄 |
| js/admin.js | 탭 배열 + 분기 추가 | +2줄 |
| index.html | script 태그 2개 추가 | +2줄 |
| data/surveys.json | 빈 배열로 초기화 | 신규 |

#### 기존 기능 영향도:
- **영향 없음**: 기존 라우트, 프론트엔드 모듈 로직 변경 없음
- admin.js의 tabs 배열에 1개 항목 추가만으로 관리자 탭에 자연스럽게 통합

---

### [16:30 KST] 지침 준수 검토 및 문서 보강

#### 검토 결과:
| 지침 | 상태 | 조치 |
|------|------|------|
| 1. 파일명 대표성 | ✅ | survey.js, admin_survey.js, survey_user.js |
| 2. 1000줄 미만 | ✅ | 361줄, 679줄, 362줄 |
| 3. 기존 기능 유지 | ✅ | 기존 코드 로직 무변경 |
| 5. 기능별 분할 | ✅ | API/관리자UI/사용자팝업 3파일 분리 |
| 8. 파일 헤더 주석 | ⚠️→✅ | 초보자용 상세 설명으로 보강 완료 |
| 6. 타임스탬프 기록 | ⚠️→✅ | REFACTORING_LOG.md 업데이트 (본 기록) |
| 9. 진행현황 문서 | ⚠️→✅ | REFACTORING_STATUS.md 업데이트 |
| 10. 상세 작업 내역 | ⚠️→✅ | 본 로그에 상세 기록 완료 |

#### 보강 작업:
- routes/survey.js 헤더: 시스템 흐름도, 연계 파일 6개 명시, API 목록 정리
- admin_survey.js 헤더: 서브탭 4개 설명, 전역 함수 목록, 로딩 순서 명시
- survey_user.js 헤더: 동작 원리 7단계, 재표시 방지 메커니즘 상세, 화면 3개 설명
