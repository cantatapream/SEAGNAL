# K2 — focus.topic 신설 설계 (직전 주제 누적 → 후속 자동 연결)

> **상태**: 설계 (코드 수정 0). 본 문서는 hunk 의사코드만 제공.
> **목적**: 라이브에서 검증된 회귀 — "참돔 잡기 좋은 날씨?" → "그렇다면 보통 미끼는?" 이 *참돔 맥락을 잃고* 일반 낚시 미끼를 답한 문제를, focus 에 *주제(topic)* 라는 새 슬롯을 추가해 LLM 이 자율로 후속을 연결하도록 한다.
> **위험**: 2 (synth prompt 1 줄 + cleanAnswer 1 정규식 + deriveFocus 1 필드).
> **회귀 가드**: sentinel v2 결합 PASS, v5 run6 85%, cat5 비도메인 거절, 보안 5/5.

---

## 1. 배경 — 라이브에서 검증된 회귀

### Q1 → Q2 결합 시나리오 (참돔)
| 턴 | 질문 | 답 | focus 결과 |
|----|------|----|----|
| Q1 | "참돔 잡기 좋은 날씨?" | 좋은 답 — 광역 통상 답 + 풍속·파고 조건 안내 | `{zone:'전국', haegu:null, buoy:null, coords:null, rankedItems:[…], lastTools:['get_warning','get_weather_index'], originalLocToken:null}` |
| Q2 | "그렇다면 보통 미끼는?" | 답은 하지만 **참돔 맥락 잃음** — 일반 낚시 미끼 (지렁이/새우 일반론) | (focus 는 Q1 의 zone 만 이어받음 — *주제* 가 없음) |

### 진단
현 `focus` 구조 (`assistant.js:1473`):
```
{zone, haegu, buoy, coords, rankedItems, lastTools, originalLocToken}
```
- **zone/haegu/buoy/coords** → *지리적 대상* (어디)
- **lastTools** → *기능적 대상* (무엇으로 답했나)
- **originalLocToken** → *원어휘 인용* (사용자 표현)
- ❌ ***주제* 슬롯 없음** — "참돔" 같은 *대상 어종/활동/도메인 단어* 가 휘발

→ Q2 의 planQuery / synth 에 "참돔" 이 주입되지 않아 LLM 이 일반 낚시 답을 함.

---

## 2. focus.topic 필드 정의

### 2.1 타입
```
topic: string | null   // 1~3 단어, 직전 답의 핵심 주제
```

### 2.2 예시 (도메인 횡단)
| 도메인 | Q1 (현 턴) | topic 후보 |
|--------|-----------|----|
| 낚시 | "참돔 잡기 좋은 날씨?" | `"참돔 낚시"` |
| 운용 | "해양경찰 순찰 가능?" | `"해양경찰 순찰"` |
| 갯바위 | "흑산도 어때?" → 갯바위 답 | `"흑산도 갯바위"` |
| 수심 | "동해 평균 수심?" | `"동해 수심"` |
| 통신 | "VHF 채널 16?" | `"VHF 비상 통신"` |
| 태풍 | "제6호 태풍 위치?" | `"제6호 태풍"` |
| 특보 | "전국 풍랑특보 몇 건?" | `"전국 풍랑특보"` |

### 2.3 null 허용
- 추출 실패 시 (LLM 이 룰 무시·라벨 누락) `topic = null` — 후속 주입에서 자동 skip.
- 보안 거절·`securityRefusal` 응답은 `focus: null` (이미 그러함) — topic 도 함께 휘발.

---

## 3. 추출 방법 — 3 안 비교

| 안 | 방식 | 비용 | 정확도 | 결합도 |
|----|------|------|--------|--------|
| (가) | 응답 후 별도 Gemini 호출 ("이 답의 핵심 주제 2~3 단어:") | **+500ms / +200 토큰 / LLM 1회** | 높음 | 분리 |
| **(나)** | synth prompt 안에서 `[주제: …]` 1줄 동시 출력 → `cleanAnswer` 가 제거하며 capture | **0** (기존 호출 내) | 양호 (LLM 룰 따르면) | 통합 |
| (다) | 결정론 — 답 텍스트에서 명사·키워드 추출 (mecab/regex) | 0 | 낮음 (도메인 어휘 폭) | 분리 |

### 권고 — **(나) synth 동시 출력**
- 비용 0 + 정확도 양호 + 1 hunk 로 끝남.
- LLM 이 룰 무시할 가능성은 `topic = null` fallback 으로 안전.
- 라벨 라인 자체는 `cleanAnswer` 가 제거하므로 사용자에게 노출 0.

---

## 4. 의사코드 1 — synth prompt 1 hunk 추가

### 4.1 위치
`assistant.js:2179` 의 `const synth = \`…\`` 마지막 영역 (P7 보안·정정 뒤 + `[Few-shot 예시 1]` 앞).

### 4.2 추가 줄 (1 hunk, ~3 줄)
```
[원칙 P8 — 주제 라벨 (후속 연결 입력)]
응답 가장 마지막 줄에 [주제: ~~~] 형식으로 이 답의 핵심 주제를 2~3 단어로 1줄 출력하세요 (예: [주제: 참돔 낚시] / [주제: 해양경찰 순찰] / [주제: VHF 비상 통신]). 이 라벨은 다음 턴의 후속 질문 연결에만 쓰입니다 — 사용자에게는 자동 제거되어 보이지 않습니다. 주제를 정하기 어려우면 라벨을 생략해도 됩니다.
```

### 4.3 회귀 가드
- 기존 P1~P7 + 가드 G1~G4 무변경.
- Few-shot 예시 2 개에 `[주제: 동해 수심]` / `[주제: 흑산도 파고]` 1줄 추가 → LLM 모방.
- 라벨이 본문에 새는 위험 → §5 `cleanAnswer` 정규식이 100% 제거.

---

## 5. 의사코드 2 — cleanAnswer 정규식 확장

### 5.1 현 코드 (`assistant.js:2236`)
```js
const cleanAnswer = (s) => s
    .split('\n')
    .filter(line => !/^\s*\[(최근 대화|직전 확정 대상|수집 데이터 인벤토리|유사 관심사|질의에 가까운 도구 후보|사용자 직군|관심사 지식|사용자 프로필|개인화)\b/.test(line))
    .filter(line => !/^\s*(memory|focus|personal|profile|jikgun|sources?|thinking|reasoning)\s*[:：]/i.test(line))
    .join('\n')
    .trim();
```

### 5.2 확장 — capture + 제거 동시
```js
let extractedTopic = null;
const TOPIC_LABEL_RE = /^\s*\[주제\s*[:：]\s*(.+?)\]\s*$/;
const cleanAnswer = (s) => s
    .split('\n')
    .filter(line => {
        const m = line.match(TOPIC_LABEL_RE);
        if (m) {
            // 첫 매치만 보관 (LLM 이 여러 줄 내면 첫 1줄 우선)
            if (!extractedTopic) extractedTopic = m[1].trim().slice(0, 30);
            return false;   // 라벨 라인 제거
        }
        return true;
    })
    .filter(line => !/^\s*\[(최근 대화|직전 확정 대상|수집 데이터 인벤토리|유사 관심사|질의에 가까운 도구 후보|사용자 직군|관심사 지식|사용자 프로필|개인화)\b/.test(line))
    .filter(line => !/^\s*(memory|focus|personal|profile|jikgun|sources?|thinking|reasoning)\s*[:：]/i.test(line))
    .join('\n')
    .trim();
let finalAns = cleanAnswer(r.text);
```

### 5.3 가드
- `slice(0, 30)` — 토픽 길이 폭주 방지 (LLM 이 1 문장 출력해도 30자 컷).
- `extractedTopic` 은 `cleanAnswer` 호출 직후 scope 에 있으므로 `deriveFocus` 호출에 합류.

---

## 6. 의사코드 3 — deriveFocus 시그니처 + 객체 변경

### 6.1 시그니처 확장 (`assistant.js:1472`)
```js
function deriveFocus(plan, results, zoneName, query, topic) {
    const focus = {
        zone: zoneName || (plan && plan.zone) || null,
        haegu: null, buoy: null, coords: null,
        rankedItems: null,
        lastTools: (results || []).map(r => r.tool),
        originalLocToken: null,
        topic: topic || null,   // ★ NEW
    };
    // … 기존 로직 무변경 …
    return (focus.zone || focus.haegu || focus.buoy || focus.coords
            || focus.rankedItems || focus.originalLocToken
            || focus.topic) ? focus : null;   // ★ topic 도 keepalive
}
```

### 6.2 호출부 (`assistant.js:2167` / `2259`)
```js
return { …, focus: deriveFocus(plan, results, plan.zone, cq, extractedTopic) };
```
- web_search 폴백 경로 (L2167) 는 topic 없음 (web 답엔 라벨 안 시킴) → `null` 전달.
- 일반 synth 경로 (L2259) 는 `extractedTopic` 전달.

### 6.3 web_search 분기 topic 정책
- 옵션 A: web 답엔 topic 추출 안 함 (안전 — 외부 컨텐츠가 주제 추출 어려움).
- 옵션 B: web 답에도 동일 라벨 룰 적용.
- **권고 A** — 회귀 면적 최소. 다음 턴이 web 후속이면 자동으로 새 주제 재추출.

---

## 7. 의사코드 4 — runBrain/planQuery 후속 주입

### 7.1 planQuery 의 focusLine 확장 (`assistant.js:1553`)
```js
const focusLine = (focus && (focus.zone || focus.haegu || focus.buoy
                             || focus.coords || focus.originalLocToken
                             || focus.topic)) ?
`\n[직전 확정 대상] ${[
    focus.zone ? '해역=' + focus.zone : null,
    focus.haegu ? '해구=' + focus.haegu + '번' : null,
    focus.buoy ? '부이/지점=' + focus.buoy : null,
    focus.coords ? ('좌표=' + focus.coords.lat + ',' + focus.coords.lon) : null,
    (focus.rankedItems && focus.rankedItems.length) ? ('직전 랭킹 상위=' + …) : null,
    focus.originalLocToken ? '원어휘=' + focus.originalLocToken : null,
    focus.topic ? '주제=' + focus.topic : null,   // ★ NEW
].filter(Boolean).join(' · ')}
질문이 "그게/그 해구/그 해역/거기/방금/그건/위에서/그 중/그렇다면/그럼/저거" 등으로 대상을 가리키면 위 [직전 확정 대상]을 그대로 args 에 쓰세요. 특히 직전 주제가 있고 새 질문이 일반 후속 ("미끼는?/방법은?/절차는?/언제?/어디서?") 형태면, 그 주제를 유지한 채 답하세요 (예: 직전 주제="참돔 낚시", 새 질문="미끼는?" → "참돔 미끼는 …").` : '';
```

### 7.2 synth prompt 의 컨텍스트 격리 가드 G3 (`assistant.js:2190`)
- `[직전 확정 대상]` 안의 *사실은 사용 / 라벨 자체는 출력 금지* — 기존 G3 그대로.
- topic 도 같은 규칙 적용 — 별도 가드 불필요. (라벨 누설 방지는 G3 + cleanAnswer)

### 7.3 LLM 자율 위임 (룰 누적 ❌)
- 정규식으로 "그렇다면/그럼" 분기 만들지 ❌ — planQuery prompt 1 줄 (`예: 직전 주제="참돔 낚시", 새 질문="미끼는?" → "참돔 미끼는 …"`) 만으로 LLM 이 자율 연결.

---

## 8. 자동 일반화 검증 케이스 (네거티브 포함)

### 8.1 양성 (PASS 기대) — 도메인 횡단 4 케이스
| Q1 | Q1 topic 적재 | Q2 | Q2 기대 답 |
|----|---|----|----|
| "참돔 잡기 좋은 날씨?" | `"참돔 낚시"` | "그렇다면 보통 미끼는?" | "참돔 미끼는 청갯지렁이·크릴·새우…" |
| "해양경찰 순찰 가능?" | `"해양경찰 순찰"` | "그럼 어선 영향은?" | 해양경찰 순찰 맥락 이어 어선 영향 |
| "VHF 채널 16?" | `"VHF 비상 통신"` | "그럼 호출 절차는?" | "VHF Ch.16 호출 절차는 Mayday/Pan-Pan/Sécurité…" |
| "흑산도 어때?" | `"흑산도 기상"` | "갯바위는?" | "흑산도 갯바위는 …" (흑산도 한정) |

### 8.2 음성 (PASS 기대) — 회귀 가드
| 시나리오 | 기대 동작 |
|----|----|
| Q1 (단발) — "동해 수심?" → Q1 답 + `[주제: 동해 수심]` capture | 정상 답, focus.topic 적재 |
| Q1 보안 거절 (admin 질의) | synth 가 거절 응답 → topic 추출 안 함 → `focus: null` (기존) — 보안 5/5 보존 |
| Q1 cat5 비도메인 거절 ("환율 알려줘") | 거절 답엔 topic 없음 → focus.topic = null → 후속도 cat5 거절 |
| Q1 web_search 폴백 ("어제 뉴스") | topic 추출 안 함 (옵션 A) → focus.topic = null |

### 8.3 음성 — *주제* 가 *지리* 와 충돌하지 않을 것
- Q1 "동해 참돔" → topic=`"참돔 낚시"`, zone=`"동해"` 둘 다 적재.
- Q2 "그럼 서해는?" → planQuery 가 새 zone(`서해`) 으로 갱신하면서 topic 은 유지 → "서해 참돔 …" 답.
- **충돌 시 우선순위**: 새 질문이 명시한 zone 이 우선 (zone 갱신), topic 은 사용자가 명시 변경 ("미끼 말고 일기는?") 안 하면 유지.

---

## 9. 회귀 가드 (보존 보장)

| 기존 가드 | 영향도 | 보존 메커니즘 |
|---|---|---|
| sentinel v2 결합 PASS | 0 | synth prompt P1~P7 + G1~G4 무변경. P8 는 *추가* 만, 기존 룰 *수정 0*. |
| v5 run6 85% | 0 | 도구 선택·계획 로직 (planQuery/runBrain step 루프) 무변경. focus.topic 은 *주입 신호* 만 추가. |
| 비도메인 cat5 거절 | 0 | 거절 응답에 LLM 이 `[주제: …]` 낼 일 없음. 설사 내도 topic 적재만 되고 다음 턴 거절 룰 (cat5 정규식 / G4) 우선 발동. |
| 보안 5/5 | 0 | `securityRefusal` 경로는 이미 `focus: null` 반환 — topic 추출 미경유. admin 질의 → 거절 → topic 휘발. |
| 광역 통상 답 (P2-b) | 0 | P2-b 답에도 `[주제: 동해 수심]` 1 줄 추가될 뿐, 본문 자체는 무변경. cleanAnswer 가 라벨 제거 후 finalAns 동일. |
| 환각 금지 (G1) | 0 | topic 은 *분류 라벨* 일 뿐 답 본문 사실 변경 없음. LLM 이 topic 을 "참돔 낚시" 라 적어도 본문 수치는 G1 가드 그대로. |
| 컨텍스트 격리 (G3) | 0 | `[주제: …]` 도 G3 격리 룰 적용 — cleanAnswer 의 1 차 capture 후 본문 누락. 라벨 누설 0. |

---

## 10. 위험 평가 & rollback

### 10.1 위험 등급: **2 (낮음)**
- 코드 변경 면적: synth prompt 1 줄 (P8 + Few-shot 라벨 2 줄), cleanAnswer 1 정규식 + capture 6 줄, deriveFocus 1 필드 + 1 인자, focusLine 1 항목 + 1 문장. **총 ~15 줄 추가, 0 줄 수정.**
- 외부 의존성: 0 (Gemini 추가 호출 0, 신규 모듈 0).

### 10.2 실패 시 자동 fallback
- LLM 이 `[주제: …]` 라벨 안 내면 → `extractedTopic = null` → `focus.topic = null` → 후속 주입 skip → **기존 동작 100% 회복**.
- LLM 이 라벨을 본문 중간에 내면 → cleanAnswer 의 라인 분할에서 라벨 라인만 단독 → 정규식 미스 가능 → 본문에 노출. **mitigation**: 정규식을 `/^\s*\[주제\s*[:：]\s*(.+?)\]\s*$/m` 으로 (multiline + line-anchored) 확실히 라인 단위로 잡고, 추가로 `s.replace(TOPIC_LABEL_RE, '')` 안전망 1줄 (옵션).

### 10.3 rollback
- 1 hunk 단위 revert: P8 1 줄 + cleanAnswer 6 줄 + deriveFocus 1 인자/필드 + focusLine 1 항목.
- DB 마이그레이션 0, 클라이언트 변경 0, 캐시 무관.

---

## 11. 구현 순서 (별도 라운드 — 본 문서는 *설계만*)

1. synth prompt P8 1 줄 추가 + Few-shot 2 개에 `[주제: …]` 라벨 추가.
2. `cleanAnswer` 에 `TOPIC_LABEL_RE` capture/제거 6 줄 추가.
3. `deriveFocus` 시그니처에 `topic` 인자 1개 + 객체 필드 1 개 + keepalive 조건 추가.
4. `deriveFocus` 호출 2 곳 (L2167 web, L2259 synth) — synth 호출에만 `extractedTopic` 전달.
5. `planQuery` 의 `focusLine` 에 `주제=` 항목 1 개 + "그렇다면/그럼" 자율 연결 1 문장 추가.
6. 회귀 — sentinel v2 결합 PASS / v5 run6 / cat5 거절 / 보안 5/5 / §8.1 양성 4 케이스 + §8.2 음성 4 케이스 실행.

---

## 12. 핵심 추출 방법 — 한 줄

**synth 응답 마지막 줄에 `[주제: …]` 1 줄 동시 출력 → `cleanAnswer` 가 정규식 1개로 capture 후 제거 → `deriveFocus(…, extractedTopic)` 가 `focus.topic` 으로 보관 → 다음 턴 `planQuery` 의 `[직전 확정 대상]` 에 `주제=…` 1 항목 + "그렇다면/그럼 → 주제 유지" 1 문장 주입.**
