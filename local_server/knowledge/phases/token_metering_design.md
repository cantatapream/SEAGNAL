# 토큰 계측 v2 설계안 (Token Metering)

> 상태: **설계만**. 코드 미수정. 본 문서는 변경 지점·스니펫·체크리스트만 제공한다.
> 작성: 2026-06-03 · 대상: 비용 SLO 측정 인프라 부재 해소.

## 0. 목적

Gemini 응답의 `usageMetadata`(입력/출력/캐시 토큰)를 수집·기록해
케이스별 토큰 집계 + p50/p95 + 추정비용($)을 산출, 비용 SLO 베이스라인을 만든다.

---

## 1. 변경 지점 요약

| # | 파일 | 함수/위치(라인 근사) | 변경 |
|---|------|---------------------|------|
| (a) | `services/gemini_client.js` | `callGeminiRaw` 반환부 L169~172 | 이미 `response`(=`result`) 전체를 반환 중 → `usageMetadata`는 `result.usageMetadata`로 이미 접근 가능. 추가 가공 불필요. |
| (b) | `services/gemini_client.js` | `callGemini` L196~204 | 반환객체에 `usage` 필드 추가(`extractUsage(r.response)`). |
| (b') | `services/gemini_client.js` | 신규 헬퍼 `extractUsage()` + 일일 토큰 카운터 | `usage` 인메모리 카운터에 `tokens` 누적(`getUsageStats`에 노출). |
| (c) | `routes/assistant.js` | `runBrain` L1440~ / synth L1590 / plan L1393 / web L1405 | 단계별 `usage`를 누적 → `brain` 객체에 `usage` 반환 → 응답 JSON에 `data.usage` (옵션, 기본 off). |
| (d) | `knowledge/phases/phase2b_eval_runner.py` | `ask` 반환·main 집계 L43~163 | 응답의 `data.usage`를 수집 → 케이스별 토큰 집계 + p50/p95 + 추정비용 출력. |
| (e) | (본 문서) | — | 단가표. |

> **주의**: 위 라인은 v1 기준 근사값이며, 실제 적용 시 함수명으로 재확인할 것.

---

## 2. (a)(b) gemini_client.js — usage 노출

### 현황
`callGeminiRaw`는 성공 시 SDK 원응답을 `response`로 그대로 반환한다(L169~172). 따라서
`r.response.usageMetadata`는 **이미 접근 가능**하다. `callGemini`(L196~204)는 `text`만
뽑아 반환하므로 토큰 정보가 소실된다 → 여기서 `usage`를 노출한다.

### before (L196~204)
```js
async function callGemini(args) {
    const r = await callGeminiRaw(args);
    if (r.success) {
        let text = null;
        try { text = r.response.text; } catch (e) { text = null; }
        return { success: true, text, error: null, isRateLimited: false, keyLabel: r.keyLabel };
    }
    return { success: false, text: null, error: r.error, isRateLimited: r.isRateLimited, keyLabel: r.keyLabel };
}
```

### after
```js
// SDK usageMetadata → 표준 형태로 정규화. 필드 부재/이름차 대비 방어적 추출.
// ⚠ thoughts(사고 토큰): gemini-2.5 계열은 thinking 기본 ON(본 서버는 thinkingConfig
//   미설정 → 기본값 사용). thoughtsTokenCount 는 candidatesTokenCount 에 포함되지 않지만
//   *출력 단가로 과금*되며 totalTokenCount 에 합산된다. 따라서 output 에 thoughts 를 더해
//   비용 과소계상을 막는다. (SDK 문서: total = prompt + candidates + toolUsePrompt + thoughts)
function extractUsage(response) {
    try {
        const m = response && response.usageMetadata;
        if (!m) return null;
        const input    = m.promptTokenCount        ?? 0;
        const cands     = m.candidatesTokenCount    ?? 0;
        const thoughts  = m.thoughtsTokenCount      ?? 0; // 사고 토큰(출력 단가로 과금)
        const toolIn    = m.toolUsePromptTokenCount ?? 0; // 도구 결과 재투입분(입력 단가)
        const output   = cands + thoughts;                // 과금 기준 출력 = 후보 + 사고
        const cached   = m.cachedContentTokenCount  ?? 0; // 캐시 히트분(promptTokenCount 에 포함)
        const total    = m.totalTokenCount          ?? (input + cands + thoughts + toolIn);
        return { input, output, cached, thoughts, total };
    } catch (e) { return null; }
}

async function callGemini(args) {
    const r = await callGeminiRaw(args);
    if (r.success) {
        let text = null;
        try { text = r.response.text; } catch (e) { text = null; }
        const usage = extractUsage(r.response);
        if (usage) bumpTokens(usage, args && args.caller);   // 일일 카운터 누적
        return { success: true, text, usage, error: null, isRateLimited: false, keyLabel: r.keyLabel };
    }
    return { success: false, text: null, usage: null, error: r.error, isRateLimited: r.isRateLimited, keyLabel: r.keyLabel };
}
```

### (b') 일일 토큰 카운터 (기존 `usage` 인메모리 구조 확장, L45~59 근처)
```js
// _ensureUsage() 초기 객체에 tokens 추가:
//   usage = { date, requests, apiCalls, success, rateLimited, byCaller,
//             tokens: { input:0, output:0, cached:0, thoughts:0, total:0 } }
function bumpTokens(u, caller) {
    const t = _ensureUsage();
    if (!t.tokens) t.tokens = { input: 0, output: 0, cached: 0, thoughts: 0, total: 0 };
    t.tokens.input    += u.input    || 0;
    t.tokens.output   += u.output   || 0;  // output = candidates + thoughts(과금 기준)
    t.tokens.cached   += u.cached   || 0;
    t.tokens.thoughts += u.thoughts || 0;  // 사고 토큰 별도 가시화(thinking 영향 추적용)
    t.tokens.total    += u.total    || 0;
    // (옵션) caller별 토큰: t.byCaller 와 별도로 t.tokensByCaller[caller] 누적 가능.
}
// getUsageStats() 는 Object.assign 이라 tokens 자동 포함 → 관리자 AI 탭에 그대로 노출됨.
```

> `callGeminiRaw` 사용처(web/TTS/STT)에서도 토큰을 잡으려면 `callGeminiRaw`
> 성공 반환부(L169)에 `usage: extractUsage(result)`를 추가해 동일하게 노출 가능.
> 본 v2 1차는 `callGemini` 경로(plan/synth)만 필수, `callGeminiRaw`는 옵션.

---

## 3. (c) assistant.js — 누적 usage 응답 노출 (옵션)

`runBrain`은 plan(L1393)·synth(L1590)·web(L1405) 등 여러 번 Gemini를 부른다.
각 호출 결과의 `r.usage`를 합산해 `brain.usage`로 올리고, 최종 응답 JSON의
`data.usage`로 노출한다. **기본 비활성(쿼리/헤더 또는 env 플래그로 on)** 하여
일반 사용자 응답 페이로드를 늘리지 않는다.

### plan/synth 호출부 (예: L1590)
```js
// before
const r = await gemini.callGemini({ model: BRAIN_MODEL, contents: synth, config: { temperature: 0.3 }, caller: 'Assistant-Synth' });
if (!r.success || !r.text) return null;

// after — 누적기 갱신(runBrain 스코프 상단에
//   const acc = {input:0,output:0,cached:0,thoughts:0,total:0};)
const r = await gemini.callGemini({ model: BRAIN_MODEL, contents: synth, config: { temperature: 0.3 }, caller: 'Assistant-Synth' });
if (!r.success || !r.text) return null;
if (r.usage) { acc.input+=r.usage.input; acc.output+=r.usage.output; acc.cached+=r.usage.cached; acc.thoughts+=r.usage.thoughts||0; acc.total+=r.usage.total; }
```
→ `runBrain` 반환객체(L1601)에 `usage: acc` 추가.

### 응답 빌드 (L1666~1670)
```js
// after — usage 는 플래그가 켜졌을 때만 포함(없으면 미포함)
const exposeUsage = req.query.usage === '1' || process.env.EXPOSE_TOKEN_USAGE === '1';
return res.json({
    ok: true, zone: brain.zone, intent: 'brain', answer: brain.answer,
    data: { toolsUsed: brain.toolsUsed, ...(exposeUsage && brain.usage ? { usage: brain.usage } : {}) },
    aiUsed: true, zoneFromProfile: false,
    links, tideSearch, corrected: brain.corrected || null, focus: brain.focus || null
});
```

> 러너는 로컬 자동평가이므로 `?usage=1`을 붙여 호출하거나 `EXPOSE_TOKEN_USAGE=1`로 켠다.

---

## 4. (d) phase2b_eval_runner.py — 토큰 집계·p50/p95·추정비용

v1은 지연만 잰다(L22 "토큰/내부 지연은 v2 에서 ... 노출 예정"). 응답의 `data.usage`를
수집해 케이스별 토큰 집계 + 분위수 + 추정비용을 출력한다.

### `ask()` 호출 시 usage 노출 켜기 (L40)
```python
URL  = f"http://127.0.0.1:{PORT}/api/assistant/ask?usage=1"
```

### 수집 (L126~129 근처)
```python
usage = (data.get("data") or {}).get("usage") or None
if usage:
    in_tok  = usage.get("input", 0);  out_tok = usage.get("output", 0)  # out = candidates + thoughts
    cached  = usage.get("cached", 0)
    tokens_all.append({"in": in_tok, "out": out_tok, "cached": cached})
    case_tok.append(in_tok + out_tok)
```

### 단가표 + 비용 추정 헬퍼 (모듈 상단)
```python
# 단가: USD / 1M tokens. 캐시 히트분(cached)은 입력 단가의 ~25%로 가정(보수적 근사).
PRICING = {
    "gemini-2.5-flash-lite": {"in": 0.10, "out": 0.40, "cache_factor": 0.25},  # plan/synth/brain 기본
    "gemini-2.5-flash":      {"in": 0.30, "out": 2.50, "cache_factor": 0.25},  # web/STT
    "claude-opus":           {"in": 15.0, "out": 75.0, "cache_factor": 0.10},  # 참고(에이전트/오케스트레이션)
}
# out_tok 은 이미 candidates + thoughts(사고 토큰) 합 → 출력 단가로 일괄 과금.
# cached_tok 은 in_tok(=promptTokenCount)에 포함된 부분집합 → 입력에서 빼고 캐시 단가로 재계산.
def est_cost(in_tok, out_tok, cached_tok, model="gemini-2.5-flash-lite"):
    p = PRICING.get(model, PRICING["gemini-2.5-flash-lite"])
    billable_in = max(0, in_tok - cached_tok)
    return ((billable_in * p["in"]) + (cached_tok * p["in"] * p["cache_factor"])
            + (out_tok * p["out"])) / 1_000_000
```

### 요약 출력 (L156~158 뒤에 추가)
```python
if tokens_all:
    ins  = [t["in"]  for t in tokens_all]
    outs = [t["out"] for t in tokens_all]
    tot  = [t["in"] + t["out"] for t in tokens_all]
    total_cost = sum(est_cost(t["in"], t["out"], t["cached"]) for t in tokens_all)
    print(f"토큰 SLO  in:p50={percentile(ins,0.5)} p95={percentile(ins,0.95)}  "
          f"out:p50={percentile(outs,0.5)} p95={percentile(outs,0.95)}  "
          f"합계:p50={percentile(tot,0.5)} p95={percentile(tot,0.95)} 토큰/호출")
    print(f"비용 추정  총 ${total_cost:.4f}  (호출당 평균 ${total_cost/len(tokens_all):.5f}, "
          f"1k호출당 ${total_cost/len(tokens_all)*1000:.2f}) [flash-lite 단가 가정]")
```

---

## 5. (e) 단가표 (USD / 1M tokens)

| 모델 | 용도(본 서버) | 입력 | 출력 | 캐시 입력(근사) |
|------|--------------|------|------|----------------|
| gemini-2.5-flash-lite | plan·synth·brain·style(기본) | $0.10 | $0.40 | 입력×0.25 |
| gemini-2.5-flash | webSearch 그라운딩·STT | $0.30 | $2.50 | 입력×0.25 |
| gemini-2.5-flash-preview-tts | TTS 합성 | (오디오 출력 별도 과금) | — | — |
| claude-opus (참고) | 에이전트/오케스트레이션 비교용 | $15.00 | $75.00 | 입력×0.10 |

> 단가는 **추정·가정값**이며 청구 정확값이 아니다. 적용 전 공식 가격표로 갱신 필수.
> 캐시 단가 계수는 보수적 근사. TTS는 토큰이 아닌 오디오 단위 과금이라 본 계측 범위 밖.

---

## 6. 러너 출력 예시 (after)

```
=== Phase 2b 품질 평가 + 지연 SLO (12케이스 × N=3회 다수결) ===

[PASS] buoy_obs_basic            [baseline]   3/3          med= 820ms  last_tools=buoy_obs
        tokens in=1240 out=210 cost=$0.00021
...
------ 요약 ------
PASS 11 / FAIL 1 / 총 12 (다수결 N=3)
지연 SLO  p50=910ms  p95=2180ms  평균=1050ms  min=540ms  max=2600ms  n=34 호출
토큰 SLO  in:p50=1180 p95=2640  out:p50=190 p95=520  합계:p50=1370 p95=3010 토큰/호출
비용 추정  총 $0.0182  (호출당 평균 $0.00054, 1k호출당 $0.54) [flash-lite 단가 가정]
```

---

## 7. 2차 자체검토

- **SDK 응답 구조(검증 완료)**: 설치된 `@google/genai` **v1.47.0**의
  `dist/genai.d.ts` 확인 결과 `GenerateContentResponseUsageMetadata` 에 필드명
  (`promptTokenCount` / `candidatesTokenCount` / `cachedContentTokenCount` /
  `thoughtsTokenCount` / `toolUsePromptTokenCount` / `totalTokenCount`) **실재 확인**.
  SDK 문서 주석상 `totalTokenCount = prompt + candidates + toolUsePrompt + thoughts`,
  `promptTokenCount` 는 `cachedContentTokenCount` 를 **포함**(부분집합)한다.
  `callGeminiRaw` 가 `response: result`(SDK 원응답)를 그대로 반환하므로
  `r.response.usageMetadata` 접근 가능 — **코드로 재확인됨**(추정 아님).
  버전 업 시 필드 차에 대비해 `extractUsage()`는 여전히 **방어적 추출(?? 0, try/catch)**.
- **사고 토큰(thoughts) 누락 보정**: gemini-2.5 계열은 thinking 기본 ON이고
  본 서버는 `thinkingConfig`/`thinkingBudget` 미설정(코드 확인) → 사고 토큰이
  발생할 수 있다. `thoughtsTokenCount` 는 `candidatesTokenCount` 에 **불포함**이나
  *출력 단가로 과금*되므로, `output = candidates + thoughts` 로 잡아 비용 과소계상을
  막았다. `total` 폴백도 `in+candidates+thoughts+toolIn` 으로 정정.
- **프라이버시**: 수집 대상은 **토큰 개수(정수)**뿐. 프롬프트/응답 본문 미저장 →
  비식별. 인메모리 일일 카운터는 KST 자정 리셋(기존 `usage`와 동일). 로그/응답에
  본문 미포함. OK.
- **성능 영향**: `extractUsage`는 이미 메모리에 있는 객체 필드 읽기 + 정수 덧셈.
  네트워크/IO 없음 → 호출당 수 μs. **거의 0**.
- **회귀위험**: (b) `callGemini` 반환에 **필드 추가만**(기존 `success/text/error/...`
  계약 불변). (c) 응답 `data.usage`는 **플래그 off가 기본** → 일반 응답 페이로드
  불변. (d) 러너는 `usage` 부재 시 집계 스킵(조건부). 기존 PASS/FAIL·지연 로직
  불변. **회귀위험 낮음.**

---

## 8. 적용 체크리스트

- [ ] 실응답 1건으로 `usageMetadata` 실제 값 확인(필드명은 SDK v1.47.0 d.ts 로 확정됨)
      — 특히 `thoughtsTokenCount` 가 0 초과로 잡히는지(thinking 기본 ON) 확인.
- [ ] `gemini_client.js`: `extractUsage()` + `bumpTokens()` 추가, `_ensureUsage`에 `tokens` 필드, `callGemini` 반환에 `usage` 추가.
- [ ] (옵션) `callGeminiRaw` 성공 반환부에 `usage` 추가(web/STT 계측).
- [ ] `assistant.js`: `runBrain`에 `acc` 누적기 + 각 호출부 합산, 반환에 `usage`, 응답 빌드에 플래그 기반 `data.usage`.
- [ ] `EXPOSE_TOKEN_USAGE` env(또는 `?usage=1`) 동작 확인.
- [ ] `phase2b_eval_runner.py`: URL `?usage=1`, `PRICING`/`est_cost`, 수집·요약 출력 추가.
- [ ] 공식 가격표로 `PRICING` 단가 갱신.
- [ ] 관리자 AI 탭에서 `getUsageStats().tokens` 노출 확인(자동 — Object.assign).
- [ ] 단위 점검: 키 없음/실패 시 `usage=null`이라도 흐름 정상인지.
