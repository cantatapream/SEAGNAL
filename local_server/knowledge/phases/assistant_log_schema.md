# 운영 로그(assistant_log) 표준화 스키마 설계안

> 상태: **설계만**. 코드 미수정. 본 문서는 스키마·정책·마이그레이션 지침만 제공한다.
> 작성: 2026-06-03 · 대상: "나리야" AI 비서 운영 로그 표준화 + 회귀 데이터 자동 축적.

---

## 0. 목적

`POST /api/assistant/ask` 의 모든 응답을 **단일 표준 레코드**로 기록해
(1) 운영 관측(관리자 AI 탭), (2) 회귀 평가셋 자동 보강, (3) 환각/오류 캡처를
한 스키마로 충족한다. 프라이버시 불변식(개인정보 미저장)을 스키마 차원에서 강제한다.

---

## 1. 현황 (입력 분석)

### 1.1 응답 객체 (`routes/assistant.js`)
경로별로 필드 집합이 다르다. 주요 응답 형태:

| 경로 | 주요 필드 |
|------|-----------|
| 두뇌(brain) `res.json` L1666 | `ok, zone, intent:'brain', answer, data:{toolsUsed}, aiUsed:true, links, tideSearch, corrected, focus` |
| 최근접 부이 L1684 | `ok, zone:null, intent:'nearest_buoy', answer, data:{nearest,observation}, aiUsed:false` |
| 해역 미탐지 L1734 | `ok, zone:null, intent, answer, data:null, aiUsed:false, links, tideSearch` |
| 부이 목록 L1748 | `ok, zone, intent, answer, data:{buoys}, aiUsed, zoneFromProfile` |
| 결정론/AI 합성 L1765 | `ok, zone, intent, answer, data:{forecast,warning}, aiUsed, zoneFromProfile, links, tideSearch` |

→ 응답 필드: `answer / zone / intent / aiUsed / corrected / focus / data.toolsUsed`.

### 1.2 현 로그 기록 (`services/assistant_log.js`)
인메모리 링버퍼(`LOG[]`, `MAX=300`, 재시작 시 소멸). `push(entry)` 가 저장하는 필드:

```
{ ts, query(≤300), answer(≤600), zone, intent, aiUsed, tools }
```

기록 트리거: `routes/assistant.js` L1636 `res.json` 래핑 → `obj.answer` 있을 때 1회
push (`query, answer, zone, intent, aiUsed, tools: obj.data?.toolsUsed`).

### 1.3 조회 (`routes/admin.js`)
- `GET  /api/admin/assistant-log?n=` → `{ ok, entries: getRecent(n) }` (최신순, 기본 100)
- `DELETE /api/admin/assistant-log` → `clear()`

### 1.4 현 스키마의 한계
- `latencyMs / engine / tokenUsage / focus / corrected / error` **미기록**.
- 인메모리 전용 → 재시작 시 소멸, 회귀 데이터 축적 불가.
- `tools` 가 두뇌 경로에서만 채워짐(다른 경로는 null).
- 프라이버시는 "코멘트로만" 보장 — 스키마 강제 없음.

---

## 2. (1차) 표준 로그 레코드 스키마

### 2.1 JSON Schema (Draft-07)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "seagnal.assistant_log.record.v1",
  "title": "AssistantLogRecord",
  "type": "object",
  "additionalProperties": false,
  "required": ["ts", "query", "answer", "tools", "aiUsed", "engine"],
  "properties": {
    "schemaVersion": { "type": "integer", "const": 1 },
    "ts":            { "type": "integer", "description": "기록 시각(epoch ms, Date.now())" },
    "sessionId":     {
      "type": ["string", "null"],
      "pattern": "^[a-f0-9]{16}$",
      "description": "비식별 세션 해시. 원본 식별자 금지 — HMAC(서버시크릿, deviceId+UTC일자) 앞 16자. 일자 회전으로 장기추적 차단. 없으면 null."
    },
    "query":   { "type": "string",  "maxLength": 300, "description": "사용자 질문(절단). PII 스크럽 후 저장." },
    "answer":  { "type": "string",  "maxLength": 600, "description": "비서 답변(절단)." },
    "corrected": { "type": ["string", "null"], "maxLength": 300, "description": "STT 오인식 교정문(원문과 다를 때만). 없으면 null." },
    "tools":   { "type": "array", "items": { "type": "string" }, "description": "사용 도구명 배열. 도구 미사용 시 []." },
    "zone":    { "type": ["string", "null"], "description": "해역명(특보구역). 미탐지 시 null." },
    "intent":  {
      "type": ["string", "null"],
      "enum": ["marine_weather", "warning", "both", "buoy_list", "nearest_buoy", "brain", null]
    },
    "aiUsed":  { "type": "boolean", "description": "AI(Gemini) 합성 여부. false=결정론 폴백." },
    "focus": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "description": "직전 턴 주목 대상(연속성). 개인 GPS 원좌표는 저장 금지 — 반올림/구역화만.",
      "properties": {
        "zone":   { "type": ["string", "null"] },
        "haegu":  { "type": ["string", "null"] },
        "buoy":   { "type": ["string", "null"] },
        "coords": {
          "type": ["object", "null"],
          "properties": {
            "lat": { "type": "number" },
            "lon": { "type": "number" }
          },
          "description": "직전 도구 결과(부이/해구/랭킹1위)의 좌표 — 사용자 GPS 원좌표가 아님. 그래도 0.1도 단위 반올림 권장(위치 정밀도 제거)."
        },
        "lastTools": { "type": "array", "items": { "type": "string" } }
      },
      "comment": "주의: 실제 deriveFocus(routes/assistant.js L1271)가 만드는 obj.focus 에는 rankedItems(직전 도구결과 상위 5행 원본, 위도/경도·지점ID 포함)도 들어있다. 로그에는 rankedItems 를 저장하지 않거나(권장), 저장 시 좌표 반올림·식별자 제거 후 저장한다(아래 I3 참조). 그래서 focus 스키마에 rankedItems 를 의도적으로 미정의(저장 금지)로 둔다."
    },
    "latencyMs": { "type": ["integer", "null"], "minimum": 0, "description": "요청 수신→응답 직전 경과(ms)." },
    "tokenUsage": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "description": "향후(token_metering_design.md 연계). 미계측 시 null.",
      "properties": {
        "input":  { "type": "integer", "minimum": 0 },
        "output": { "type": "integer", "minimum": 0 },
        "cached": { "type": "integer", "minimum": 0 },
        "total":  { "type": "integer", "minimum": 0 }
      }
    },
    "engine": {
      "type": "string",
      "enum": ["gemini-2.5-flash-lite", "gemini-2.5-flash", "deterministic", "web_search", "unknown"],
      "description": "답변 생성 엔진. aiUsed=false ↔ 'deterministic'. 두뇌/합성은 gemini-2.5-flash-lite(BRAIN_MODEL L871), 검색 그라운딩 경로만 gemini-2.5-flash(L1406)."
    },
    "error": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "description": "실패/폴백 사유. 정상 시 null.",
      "properties": {
        "stage": { "type": "string", "enum": ["plan", "tool", "synth", "intent", "web", "other"] },
        "code":  { "type": "string" },
        "message": { "type": "string", "maxLength": 200 }
      }
    },
    "labels": {
      "type": ["object", "null"],
      "additionalProperties": false,
      "description": "회귀/평가 메타(자동·수동 태깅).",
      "properties": {
        "hallucinationSuspect": { "type": "boolean", "description": "환각 의심 자동 플래그(아래 §4.2)." },
        "evalCandidate":        { "type": "boolean", "description": "평가셋 후보로 선정됨." },
        "category":             { "type": ["string", "null"], "description": "자유변칙/정량/연속성 등 분류." }
      }
    }
  }
}
```

### 2.2 필드 출처 매핑 (응답 → 레코드)

| 레코드 필드 | 출처 |
|-------------|------|
| `ts` | `Date.now()` (push 시) |
| `query` | 핸들러 `query` (PII 스크럽 후) |
| `answer` | `obj.answer` |
| `corrected` | `obj.corrected` |
| `tools` | `obj.data?.toolsUsed ?? []` (브레인 외 경로는 빈 배열) |
| `zone` | `obj.zone` |
| `intent` | `obj.intent` |
| `aiUsed` | `obj.aiUsed` |
| `focus` | `obj.focus` 에서 zone/haegu/buoy/coords/lastTools 만 추림(`rankedItems` 제거) + coords 0.1도 반올림 후 |
| `latencyMs` | 핸들러 진입 `t0`와 push 시각 차 (신규 계측) |
| `tokenUsage` | `obj.data?.usage` (token_metering v2 적용 후) |
| `engine` | `aiUsed ? (toolsUsed.includes('web_search')?'web_search':'gemini-2.5-flash-lite') : 'deterministic'`. 주: 'web_search' 경로의 실제 모델은 gemini-2.5-flash(L1406)지만, 도구 기준으로 엔진을 'web_search'로 라벨링해 무방. |
| `error` | 두뇌/도구 단계 캐치에서 전달(현재 미전파 — 신규) |

---

## 3. 프라이버시 (불변식)

비서는 어선/항해 안전용이라 위치·소속이 민감하다. 다음을 **스키마·코드 양쪽**에서 강제.

- **I1 (PII 미저장)**: `profile`, `memory`, `location`(원 GPS), `deviceId` 원본을 레코드에
  **절대 저장하지 않는다**. 스키마 `additionalProperties:false` 로 미정의 필드 차단.
- **I2 (세션 비식별)**: `sessionId` 는 원본 식별자가 아닌 `HMAC(secret, deviceId+UTC일자)`
  앞 16자. **일자 회전**으로 동일 단말의 장기 추적 불가. secret 부재 시 `null`.
- **I3 (좌표 일반화)**: `focus.coords` 는 0.1도(~11km) 반올림. 개인 정밀 위치 제거.
- **I4 (텍스트 스크럽)**: `query`/`answer` 저장 전 정규식 스크럽 — 전화번호, 선박번호/호출부호,
  주민번호류, 이메일 패턴 마스킹(`***`). 절단(query≤300, answer≤600)은 현행 유지.
- **I5 (보안 노출 차단)**: 합성 단계에서 이미 컨텍스트 라벨(memory/profile/focus)이
  답변에 누설되지 않도록 필터링됨(L1576, L1598). 로그도 동일하게 누설 답변을 그대로
  저장하지 않도록 스크럽 적용.
- **I6 (접근통제)**: 조회는 `/api/admin/*` 관리자 전용 유지.

---

## 4. 회귀 데이터 자동 축적 활용

### 4.1 평가셋 보강 파이프라인
표준 레코드는 기존 평가 러너(`phase2b_eval_runner.py`, `phase0_golden.jsonl` 등)의
입력 포맷과 호환되게 설계한다(질문→기대도구/해역/의도). 운영 로그를 주기적으로
필터링해 **평가 후보(`labels.evalCandidate`)** 로 승격:

- `tools`/`zone`/`intent` 가 명확하고 `error=null` 인 레코드 → 회귀 골든 후보.
- `corrected≠null` 인 레코드 → STT 보정 회귀 케이스(오인식→교정 매핑) 자동 축적.
- 신규 직군/자유변칙 카테고리(`labels.category`) 커버리지가 낮은 케이스 우선 수집.

### 4.2 환각 캡처
- `aiUsed=true` 이고 `tools=[]` 이며 답변에 정량 수치(파고/풍속 N m·m/s)가 포함된
  레코드 → `labels.hallucinationSuspect=true` 자동 플래그(데이터 근거 없는 수치 의심).
- `error.stage='synth'` 폴백 레코드 → 합성 실패 회귀 케이스.
- `halluc_cot_capture.py` 와 연계해 의심 레코드를 별도 검토 큐로 라우팅.

### 4.3 비용 관측
`tokenUsage` 채워지면(token_metering v2) 케이스별 p50/p95·추정비용 집계 가능
(`token_metering_design.md` (d) 러너와 동일 소스).

---

## 5. 보존·로테이션 정책

| 항목 | 정책 |
|------|------|
| 인메모리(현행) | 링버퍼 유지(운영 관측용). `MAX` 300→예: 1000 상향 검토. 재시작 시 소멸. |
| 영구 저장(신규) | 일자별 NDJSON(`logs/assistant/YYYY-MM-DD.ndjson`), 1줄=1레코드. append-only. |
| 보존기간 | **운영 로그 30일** 후 자동 삭제. 단, 평가 후보로 승격(`evalCandidate=true`)된 건은 **비식별 상태로** 평가셋(`phases/*.jsonl`)에 복사 후 원본은 동일 30일 규칙 적용. |
| 로테이션 | 일자 단위 파일 회전 + 30일 초과 파일 삭제(cron/기동 시 정리). 단일 파일 비대화 방지. |
| sessionId 회전 | UTC 일자 기준 매일 회전(I2) — 보존기간 내에도 장기추적 불가. |
| 삭제 트리거 | `DELETE /api/admin/assistant-log` 는 인메모리 clear + (옵션) 당일 파일 제외 전체 영구 로그 purge. |

---

## 6. (2차 — 자체검토)

### 6.1 현 필드와의 차이 / 마이그레이션
| 필드 | 현행 | 표준안 | 마이그레이션 |
|------|------|--------|--------------|
| `ts, query, answer, zone, intent, aiUsed` | 있음 | 동일 | 그대로. `tools:null`→`[]` 정규화. |
| `tools` | `data.toolsUsed`만, null 가능 | 항상 배열 | push 시 `?? []`. |
| `corrected` | 없음 | 추가 | push 호출부에 `obj.corrected` 전달(코드 1줄). |
| `focus` | 없음 | 추가(좌표 반올림) | `obj.focus` 전달 + coords 0.1도 반올림. |
| `latencyMs` | 없음 | 추가 | 핸들러 진입 `t0` 저장 → push 시 차. |
| `engine` | 없음 | 추가 | `aiUsed`/`toolsUsed`에서 파생(저장 없이 계산 가능). |
| `tokenUsage` | 없음 | 추가(향후) | token_metering v2 이후 `data.usage` 연결. 그 전엔 null. |
| `error` | 없음 | 추가 | 두뇌/도구 캐치에서 사유 전파(현재 silent catch → 사유만 캡처). |
| `schemaVersion` | 없음 | `1` | 신규 필드. 구레코드는 버전 부재=암묵적 v0 → 읽기 시 v1 기본값 채움. |

**호환 전략**: v1 은 v0 의 상위집합(superset)이므로 기존 조회 화면은 그대로 동작.
신규 필드는 옵셔널/널 허용이라 **점진 도입 가능**(코드 한 곳 `push` 페이로드만 확장).

### 6.2 프라이버시 불변식 재확인
- profile/memory/location 원본은 핸들러에 들어오나(L1619~1628) **현행 push 페이로드(L1639~1642)에 미포함**(query/answer/zone/intent/aiUsed/tools 6종만 전달) → I1 충족.
- 표준안 신규 필드 중 위치성 데이터: `focus.coords` **및 `obj.focus.rankedItems`(직전 도구결과 상위 5행 원본 — 위도/경도·지점ID 포함, deriveFocus L1281)**. coords 는 0.1도 반올림(I3), **rankedItems 는 로그 미저장(또는 좌표 반올림·식별자 제거 후 저장)으로 강제** → focus 스키마는 `additionalProperties:false` 라 rankedItems 미정의 = 검증 단계에서 자동 차단(반드시 push 전 strip 필요).
- `query`/`answer` 텍스트에 사용자가 직접 PII 발화 가능 → §3 I4 스크럽으로 보강(현행 미비점 보완).
- `sessionId` 는 옵션이며 비식별 해시·일자회전 → 추가해도 개인 미식별(I2).
- 결론: 표준안 적용 후에도 **"개인정보 미저장" 불변식 유지**. 오히려 텍스트 스크럽으로 강화.

### 6.3 용량 추정
- 레코드 1건: query 300 + answer 600 + 메타(~300) ≈ **1.2KB** (NDJSON, UTF-8 한글 가중).
- 가정 1,000 req/일 → 약 **1.2MB/일**, 30일 보존 ≈ **36MB**. 무시 가능 수준.
- 인메모리 `MAX=1000` → ~1.2MB 상주. 현행 300 대비 증가 미미.
- 평가셋 승격분은 별도 `jsonl` 누적이나 선별 저장이라 증가 완만.

---

## 7. 변경 지점 요약 (구현 시 참고 — 본 문서는 설계만)

| # | 파일 | 위치 | 변경 |
|---|------|------|------|
| (a) | `services/assistant_log.js` | `push()` L15~28 | 페이로드를 v1 스키마로 확장 + `tools ?? []` + PII 스크럽 + (옵션) NDJSON append. |
| (b) | `routes/assistant.js` | L1636 `res.json` 래퍼 | `corrected, focus, latencyMs(t0차), engine` 전달. focus 는 `rankedItems` 제거 후 전달(좌표 반올림 포함). 핸들러 진입(L1619 부근)에 `t0=Date.now()` 추가. |
| (c) | `routes/assistant.js` | 두뇌/도구 catch(L1672 등) | silent catch → `error{stage,code,message}` 캡처해 push 경로로 전달. |
| (d) | `services/assistant_log.js` | 신규 정리 잡 | 기동/주기 시 30일 초과 NDJSON 삭제 + sessionId 일자회전. |
| (e) | `routes/admin.js` | `/api/admin/assistant-log` | 응답 entries 는 v1 스키마 그대로 노출(추가 작업 불필요). |

> 라인은 현행 기준 근사값. 구현 시 함수명으로 재확인할 것.
