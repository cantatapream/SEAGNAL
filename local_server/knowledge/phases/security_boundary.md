# SEAGNAL "나리야" AI 비서 — 보안 경계 명세

대상: `routes/assistant.js`(TOOL_CATALOG·TOOL_EXEC·플래너·합성), `knowledge/phases/phase0_runner.py`(정적검사), `js/admin.js`(관리자 — 비서 미노출 대상).
원칙: AI 비서는 **공개·사용자 기상/해양 데이터만** 다룬다. 관리자·설정·키·다른 사용자 정보는 도구 표면 밖이며, 프롬프트로도 노출하지 않는다.

근거 코드 위치는 `assistant.js` 라인 기준으로 표기한다.

---

## 1차 — 경계 정의

### (a) AI 도구 표면 — 노출 20도구 vs 관리자/설정/키 미노출

**위협모델**
- 사용자가 자연어로 관리자 기능(특보 등록/삭제, API 키, 사용량, 차단, 점검, 버전, 대화로그 삭제 등)을 호출 유도.
- 플래너(LLM)가 임의 엔드포인트나 셸을 호출하도록 유도(도구 인젝션).

**현 방어**
- TOOL_EXEC(`assistant.js:1128`)에 노출 도구는 정확히 20개로 고정: `get_marine_forecast / get_zone_forecast / get_warning / list_buoys_near / get_buoy_observation / get_visibility / get_buoys_with_obs / get_tide / get_typhoon_status / get_zones_ranked / get_app_capabilities / get_midterm_forecast / get_fishing_index / get_surfing_index / get_sea_split_index / get_seafog_cctv / get_current / get_depth / resolve_location / get_nearest_buoy`. 모두 공개 기상/해양/생활지수 데이터 전용.
- 플래너는 자유 명령이 아니라 `{tool, args}` 스텝만 생성하고, `TOOL_EXEC[step.tool]` 조회(`:1506,:1520`)로만 실행 → 카탈로그에 없는 도구명은 실행 불가(no-op).
- 내부 호출(`internalGet/Post`)은 도구 구현 내부에서 고정 경로(`/api/ocean/*`, `/api/search-place`, `/api/seafog-cctv`, `/api/save_tide_input`)로만 발신. `/api/admin/*` 호출 코드는 라우터에 없음.
- `js/admin.js`의 관리자 API(`/api/admin/login`, `register-device`, `collect-failures`, `gemini-status`, `assistant-log` 등)는 `X-Admin-Token` 헤더 인증(`admin.js:114` fetch 래퍼)으로 보호되며, 비서 라우터와 코드·인증 경로가 완전 분리.
- 비서 테스트 호출 UI(`admin.js:872`)는 관리자 탭 안에서 동일한 공개 `/api/assistant/ask`만 부르므로 권한 상승 경로가 아님.

**잔여 리스크**
- `/api/assistant/ask`는 인증이 없는 공개 엔드포인트(레이트리밋 IP당 분당 20회, `:1607`만 존재). 비용/남용은 막지만 도구 표면 자체는 누구나 호출 가능 — 단, 노출 데이터가 공개 기상이라 정보 노출 위험은 낮음.
- 새 도구 추가 시 카탈로그/정적검사 동기화는 사람이 지켜야 함(아래 (e)가 일부 커버).

### (b) 프롬프트 인젝션 방어 — 사용자 단정 무시·도메인 가드

**위협모델**
- 사용자가 거짓 사실을 단정("제6호 태풍 북상 중인데", "특보 떴잖아")해 환각 유도.
- "이전 지시 무시하고 ~" 류 지시 주입으로 비도메인/위험 답변 유도.
- 도구 결과가 비면 web_search로 빠져 LLM 일반지식·웹으로 빈칸을 채우게 유도.

**현 방어**
- 합성 프롬프트(`:1580`): 사용자가 단정해도 수집결과와 다르면 수집결과를 따르도록 강제(태풍 hasActive=false면 "없습니다"로 정정).
- 환각 금지 규칙(`:1574`): 수집결과에 없는 수치/사실 생성 금지, 비면 "그 정보는 없어요".
- 도메인 가드(`:1542`): 한국 해양·기상 도메인 질의는 web_search 폴백 **금지**. 도메인 판정은 키워드(`DOMAIN_RE`)·해역명 fuzzy·섬/부이명(`ISLAND_BUOY_RE`) 중 하나라도 매칭. 도메인인데 도구 결과 0건이면(`:1554`) 웹으로 안 빠지고 안전 메시지로 차단(환각 가드 §6 #16).
- 비기상·비도메인 거절(`:1577`): 법령·통계·인사·매뉴얼 등은 web_search 답이 있어도 채택 금지.

**잔여 리스크**
- web_search 폴백 경로(`:1564`)는 도메인 키워드가 전혀 없는 질의에서만 살아남지만, 여기서는 Google Search 그라운딩(`:1408`)을 그대로 사용 — **도메인 allowlist(신뢰 사이트 화이트리스트)는 없음**. "도메인 가드"는 *폴백 발동 여부* 가드이지 *조회 사이트* 가드가 아니다. 인용 출처(webLinks)는 모델이 고른 임의 외부 URL일 수 있음.
- 인젝션 방어가 프롬프트 규칙(soft) 위주 — 모델이 규칙을 어기는 경우 (d)의 후처리·(b)의 거절 규칙이 부분적으로만 보강.

### (c) 컨텍스트 격리 — memory/focus 출력금지(#24), 다른 사용자 누설 방지

**위협모델**
- 프롬프트에 주입된 `profile/memory/focus/style/jikgun` 라벨·내용이 답변에 그대로 출력되어 사용자 본인 또는(서버 재사용/혼선 시) 타인 컨텍스트가 노출.
- "방금 내가 뭐라 했지", "프로필 보여줘" 류로 컨텍스트 덤프 유도.

**현 방어**
- 컨텍스트는 **클라이언트(휴대폰) 보관·요청마다 전달** 구조 — 서버는 profile/memory를 영구 저장하지 않음(온보딩 주석 `:1933`). 따라서 서버측 교차사용자 저장소 누설면이 구조적으로 작다.
- 합성 프롬프트(`:1576` §6 #24): 입력 블록·라벨(`[최근 대화]/[직전 확정 대상]/memory/focus/personal/profile/jikgun` 등) 자체를 답에 출력 금지, 사실만 자연어로 풀어쓰도록 지시.
- 후처리 방어선 `cleanAnswer`(`:1595`): 모델이 규칙을 어겨도 라벨로 시작하는 라인(대괄호 블록, `memory:/focus:/profile:/thinking:/reasoning:` 등)을 제거. 본문 자연어는 보존.
- 개인화 컨텍스트는 "말투·관심사·기본 해역·길이 조절"에만 쓰고 수치 근거로 못 쓰게 분리(`buildPersonalContext` `:711`, 프롬프트 `:741`).

**잔여 리스크**
- `cleanAnswer`는 **라벨로 시작하는 라인만** 제거 — 문장 중간에 녹아든 개인정보(예: "○○님 프로필에 따르면…")는 못 거른다. 격리의 본질 방어는 여전히 프롬프트 규칙(soft).
- focus는 요청 바디로 클라이언트가 보내고 응답으로 되돌려줌(생성 `:1601` deriveFocus, 응답 echo `:1669`). 같은 기기 내 연속성용이라 교차사용자 누설은 아니지만, 클라이언트가 타인 focus를 보내면 서버는 구분하지 못함(인증·세션 식별자 없음).

### (d) CoT 누수 금지

**위협모델**
- 내부 추론·계획 단계·메타코멘트("먼저 ~를 확인하고", "thinking:", "sources:")가 음성 답변에 노출되어 시스템 동작·프롬프트 구조가 새어나감.

**현 방어**
- 합성 프롬프트(`:1575` CoT 누수 절대 금지): 사고 과정·추론 단계·메타 텍스트를 한 글자도 출력 금지, 최종 결론만.
- intent 추출·플래닝은 별도 호출(`detectWithAI` `:770`, `planQuery`)이라 추론 산출물이 사용자 응답 경로와 분리.
- `cleanAnswer`(`:1598`)가 `thinking:/reasoning:/sources:`로 시작하는 라인을 제거(후처리 보강).

**잔여 리스크**
- 후처리는 라벨 라인만 잡고, 문장형 메타("제가 생각해보니 먼저 부이를 확인해서…")는 못 거름 — 프롬프트 규칙 의존.
- **[2차 검토 — 확인된 잔여 격차]** web_search 답변은 `cleanAnswer`(`:1595`, synth 경로 `:1601`에만 적용)를 거치지 않고 `:1566`에서 `web.answer`를 그대로 `return` 한다. 즉 합성 프롬프트의 컨텍스트 격리(#24)·CoT 금지·비기상 거절(`:1577`) 규칙이 **이 경로에는 한 줄도 적용되지 않는다**. 그 경로의 메타/마크다운 정리는 `webSearchAnswer` 내부의 마크다운 제거(`:1416`)에만 의존하고, 컨텍스트/CoT/거절 방어선은 전무. 다만 이 경로는 `!gotUseful && !isDomainQuery`(`:1563`)에서만 진입하므로 (1) 개인 컨텍스트(profile/memory/focus)는 web 호출 인자(cq)에 포함되지 않아 누설면이 작고 (2) 도메인 질의는 애초에 막혀 있어 노출 데이터는 비도메인 일반 검색 결과로 한정된다. 핵심 리스크는 *미검증 외부 URL·임의 외부 콘텐츠가 거절·정제 없이 음성 답변으로 직결*된다는 점.

### (e) 정적검사 회귀 — phase0_runner 관리자 격리

**위협모델**
- 향후 커밋이 비서 라우터에 admin 엔드포인트 호출이나 admin 접두 도구를 추가해 격리가 깨지는 회귀.

**현 방어**
- `phase0_runner.py:static_security_check()`(`:75`): `assistant.js` 소스에서 두 구체 패턴을 검사 →
  - `internalGet/Post('/api/admin…')` 호출 존재 → FAIL("도구가 /api/admin 엔드포인트를 호출함").
  - 줄머리 `admin\w*: async|(` 형태의 admin 접두 도구 정의 → FAIL.
- 위반 시 `static-security`를 하드 실패에 추가해 게이트 종료코드 1(차단).
- 보조: `data_catalog_check()`가 TOOL_EXEC 도구·캐시키가 카탈로그에 반영됐는지 확인(드리프트시 FAIL) — 새 도구가 카탈로그 우회로 추가되는 것을 일부 차단.

**잔여 리스크**
- 정적검사는 **문자열 패턴 매칭**이라 회피 가능: `'/api/' + 'admin/...'` 문자열 결합, 변수에 담은 경로, `internalGet` 아닌 직접 `fetch('/api/admin…')`, `admin` 외 이름(`mgmt_`, `ops_`)의 권한 도구는 탐지 못 함.
- 런타임 인증·권한 검사는 검증하지 않음(코드 표면만). admin API 자체의 토큰 검증 회귀는 phase0 범위 밖.

---

## 2차 — 자체검토

### 코드와 명세 일치 여부
- 도구 20개 수: TOOL_EXEC(`:1128`) 키 카운트와 일치(2차 검토 시 `^\s{4}\w+: async` 매칭으로 재확인 — `get_marine_forecast / get_zone_forecast / get_warning / list_buoys_near / get_buoy_observation / get_visibility / get_buoys_with_obs / get_tide / get_typhoon_status / get_zones_ranked / get_app_capabilities / get_midterm_forecast / get_fishing_index / get_surfing_index / get_sea_split_index / get_seafog_cctv / get_current / get_depth / resolve_location / get_nearest_buoy` 20개). 1차 산출물의 "19개" 표기는 오기였으며 나열 목록 자체는 20개로 정확했음. CATALOG_DIGEST(`:166`)는 노출/미노출을 카탈로그 기반으로 별도 주입 — 명세의 "노출만"과 정합.
- #24 격리·CoT 금지·도메인 가드·사용자 단정 무시·정적검사 패턴 모두 인용 라인과 일치.

### 빠진 공격면 점검(추가 보완 사항)
- **deeplink/버튼(`buildLinks` `:1883`):** 링크는 서버가 정규식으로 생성하며 `type: ocean|tab|tide|web`과 알려진 layer/tab 타깃, 알려진 부이 id, 좌표만 방출. 사용자 텍스트가 URL/스킴에 그대로 들어가지 않음 → 임의 deeplink/스킴 주입면은 낮음. 단, `type:'web'` 링크(`:1658`)는 web_search가 돌려준 **외부 URL을 그대로 버튼화** → (b) 잔여 리스크와 동일(미검증 외부 URL). 프론트에서 web 링크 열람 시 화이트리스트·외부브라우저 격리 권장.
- **STT 보정(`:1317`):** correctedQuery는 "명백한 오인식만 보수적 교정, 의미 변경 금지"로 제약(`:1320`)되나 LLM 산출이라 의미 왜곡 가능. 보정 후 질의(cq)가 도메인 가드(`:1548`)·플래닝 모두에 쓰이므로, 악의적 동음이의 유도로 도메인 판정을 흔들 여지가 이론상 존재(soft 제약).
- **웹 폴백(`:1563`):** 발동 조건(비도메인 + 도구 결과 무용)은 좁지만, 발동 시 조회 도메인 무제한·`cleanAnswer` 미적용은 명세 본문 (b)(d) 잔여 리스크로 명시함. 비기상 거절 규칙(`:1577`)이 합성 경로에는 걸리나 web_search 직접 반환 경로(`:1566`)는 우회함 — **현 구조의 가장 큰 잔여 격차**.
- **온보딩(`/api/assistant/onboard`):** 프로필 추출 경로로 별도 LLM 호출이 있으나 서버 미저장(`:1933`). 본 명세의 컨텍스트 격리 원칙과 정합.
- **레이트리밋 우회:** IP 기반(`X-Forwarded-For` 신뢰, runner `:40`에서도 위조 IP 사용) — 프록시 신뢰 설정에 따라 우회 가능. 남용 방지는 best-effort.

### 정적검사 커버리지 명확화
- phase0_runner가 **커버하는 것**: (1) 비서 소스의 `internalGet/Post('/api/admin…')` 직접 호출, (2) `admin` 접두 도구 정의, (3) 카탈로그-캐시키/도구 드리프트, (4) 골든 회귀(tools_exclude/answer_excludes로 도구·금지문구 누설 검사).
- phase0_runner가 **커버하지 못하는 것**: 문자열 결합/별칭으로 우회한 admin 호출, `admin` 외 이름의 권한 도구, 런타임 인증 검증, 프롬프트 인젝션 실효성, CoT/컨텍스트 누수의 의미수준(라벨 아닌 문장형) 검출, web_search 외부 URL 신뢰성.

### 권고(코드 미수정 — 후속 과제)
1. web_search 직접 반환 경로(`:1566`)에도 비기상 거절·`cleanAnswer`를 적용해 합성 경로와 격차 제거.
2. `type:'web'` 링크에 도메인 화이트리스트 또는 외부 표기.
3. 정적검사에 `fetch('/api/admin` 직접 호출·경로 문자열 결합·비-admin 접두 권한 도구 패턴 추가.
4. 컨텍스트 격리의 문장형 누수 대비 — 골든에 개인정보 누설 케이스(answer_excludes) 확충.
