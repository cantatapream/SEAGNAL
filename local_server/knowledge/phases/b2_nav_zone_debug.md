# B2 — NAV-2-01b "동해중부" zone-miss 정밀 디버그

라운드: 6차 (sentinel v2 일반 29/30, 잔존 1건)
대상: `NAV-2-01b` (jikgun=navy, cat=2, 후속 잇기)
판정: `zone-miss:동해중부` (D-HALLUC 1건)
선행 진단 (마스터플랜 §6 #36): "LLM plan.zone 변동성"
**본 문서의 결론: 위 진단은 빗나감.** 실원인은 `get_depth` 빈결과 + synth 빈결과 보고 룰 우선.

---

## 1. 매니페스트 — NAV-2-01a / 01b 정확 정의

`local_server/knowledge/phases/phase2b_sentinel_v2.jsonl` (line 23–24):

| 필드 | NAV-2-01a (선행) | NAV-2-01b (후속) |
|---|---|---|
| query | `"동해중부 파고"` | `"거기 수심?"` |
| profile | `{occupation:"해군"}` | `{occupation:"해군"}` |
| prev_id | — | `"NAV-2-01a"` |
| expect_tools_any | `[get_marine_forecast, get_warning, get_depth, get_buoy_observation]` | (없음) |
| expect_zone_match | (없음) | `"동해중부"` |
| expect_no_halluc | (없음) | `true` |
| 가중치 | 1.5 (cat=2) | 1.5 (cat=2) |

판정기 (`phase0_runner.py` line 231–234):
```python
if case.get("expect_zone_match"):
    zone = case["expect_zone_match"]
    if zone not in ans:
        fails.append("zone-miss:%s" % zone)
```
→ **단순 substring 검사**. 답에 "동해중부" 가 한 번도 등장하지 않으면 fail.

---

## 2. 수동 N=3 재현 실험 (BASE=http://127.0.0.1:3001)

NAV-2-01a → NAV-2-01b 연쇄(prev focus 전달) 를 3회 호출. profile=`{"occupation":"해군"}`, X-Forwarded-For 매회 다른 IP.

| 시행 | 01a tools | 01a focus.zone | 01b tools | 01b focus.zone | 01b 답변 (원본) | "동해중부" 포함 |
|---|---|---|---|---|---|---|
| T1 | `[get_marine_forecast]` | `동해중부앞바다` | `[get_depth]` | `동해중부앞바다` | `"그 정보는 없어요."` | **X** |
| T2 | `[get_marine_forecast]` | `동해중부앞바다` | `[get_depth]` | `동해중부앞바다` | `"그 정보는 없어요"` | **X** |
| T3 | `[get_marine_forecast]` | `동해중부앞바다` | `[get_depth]` | `동해중부앞바다` | `"그 정보는 없어요"` | **X** |

**zone 매칭률: 0/3** (= 100% 결정론적 실패 — 게이트 1회 운에 의존한 게 아니라 매 호출 재현).

### 부수적 관찰
- `plan.zone` 은 3회 모두 안정적으로 `"동해중부앞바다"` (변동성 0).
- `focus.zone` 은 후속 턴에도 안정 보존.
- 도구 선택 결정론적: 01a → `get_marine_forecast`, 01b → `get_depth` (R8 룰 정상).
- 01a 답은 `"동해중부앞바다 파고는 1~2미터입니다."` — 표준 해역명 명시 잘 됨.
- 01b 답만 **zone 미명시**.

---

## 3. 원인 추적 — synth 빈결과 보고 우선

### 3.1 raw API 검증

```bash
$ curl 'http://127.0.0.1:3001/api/ocean/depth?lat=37.5&lon=129.5'
{"success":false,"error":"해당 해역의 수심 데이터가 없습니다."}
```

→ 동해중부앞바다 좌표(37.5, 129.5) 의 수심 데이터는 **데이터셋에 부재** (DB/맵 미수록).

### 3.2 tool 어댑터 (`local_server/routes/assistant.js` line 1447–1452)

```js
get_depth: async ({ zone, lat, lon } = {}) => {
    const c = coordsFor(zone, lat, lon);
    if (!c) return { error: '좌표를 알 수 없습니다(해역명 또는 lat,lon 필요).' };
    const r = await internalGet(`/api/ocean/depth?lat=${c.lat}&lon=${c.lon}`);
    return Object.assign({ zone: zone || null }, r || {});
}
```

→ 반환 result = `{ zone: "동해중부앞바다", success: false, error: "해당 해역의 수심 데이터가 없습니다." }`.

→ deriveFocus(line 1486) 에서 `if (!v || typeof v !== 'object' || v.error) continue;` 로 **무시**되지만, plan.zone 이 살아 있어 focus.zone 은 보존됨 (focus 보존은 정상).

→ `results = [{ tool:'get_depth', result:{ zone, success:false, error:... } }]` 가 synth 로 전달.

### 3.3 synth prompt 룰 충돌 (line 2161 vs line 2174)

L2161 환각 금지 (빈-결과 보고):
> "수집결과가 비어 있으면 짧게 **'그 정보는 없어요'** 또는 '지금은 가져오지 못했어요'라고만 답하세요."

L2174 P36 후속 표기 규칙:
> "[직전 확정 대상] 에 명시된 해역명 ··· 가 있고 사용자가 후속(거기/그곳/그 해역) 으로 그 대상을 가리키면, **답변에 그 이름을 원형 그대로 1회 이상 명시**하세요."

→ 두 룰은 **명시적으로 우선순위가 정의되지 않음**.
→ LLM(Gemini, temperature=0.3) 의 해석: 빈결과 보고는 "짧게 ~라고만" 으로 강한 형식 강제 → P36 zone 명시 룰을 덮어버림.
→ 3/3 시행에서 일관적으로 **"그 정보는 없어요"** 만 응답. LLM 변동성 가설은 데이터로 부정.

### 3.4 §1.3 후속 표기 규칙 — synth prompt 의 P36 룰 인지 여부

assistant.js line 2174 에 P36 후속 표기 규칙은 **명확히 작성되어 있음** (`grep` 확인). 그러나:

1. 룰이 prompt 의 매우 긴 bullet 리스트 안 (행 길이 ~600 자) 에 묻혀 있음.
2. 빈결과 보고 (L2161) 가 prompt 앞쪽에 위치 + "짧게 ~라고만" 의 강한 어휘.
3. **빈결과 케이스에서 P36 가 적용되어야 한다는 명시적 예외 처리 부재.**

→ 룰 자체는 LLM 에 전달되지만, 우선순위 충돌에서 LLM 이 P36 을 무시.

### 3.5 plan.zone 변동성 가설 — 부정

마스터플랜 §6 #36 의 "NAV plan.zone 변동성" 가설(navy + cat=2 후속 시 LLM 이 "동해먼바다" 등 다른 표준명으로 plan.zone 박는 의심)을 검증:

| 시행 | 01b plan.zone 추정 (focus.zone 으로 관찰) | "동해먼바다" 출력 |
|---|---|---|
| T1 | 동해중부앞바다 | X |
| T2 | 동해중부앞바다 | X |
| T3 | 동해중부앞바다 | X |

→ **변동성 0**. NAV plan.zone 가설은 **반증됨**.
→ 후속 턴에서 plan.zone 결정은 deriveFocus 의 안정 보존(zone-arg 4단 + originalLocToken 보존) 으로 더 이상 흔들리지 않음.

---

## 4. 진정한 원인 (수정)

1. **데이터 가용성 원인** (1차): `get_depth(동해중부앞바다)` 가 실데이터 부재로 항상 `success:false` 반환.
2. **prompt 룰 충돌 원인** (2차): synth 빈결과 보고 룰이 P36 zone 명시 룰을 덮음.
3. **판정 로직 원인** (3차): `phase0_runner` 가 답 substring 만 보고 fail — 도구·focus 가 모두 정확해도 빈결과 거절문에는 zone 부분문자열 부재.

선행 진단의 "LLM plan.zone 변동성" 은 **틀린 가설** — 결정론적 데이터 부재가 본질.

---

## 5. 수정안 3개 + 위험·예상 효과

### (a) Synth prompt 강화 — 빈결과 보고에도 focus.zone 명시 의무

**위치**: `local_server/routes/assistant.js` L2161 (환각 금지 bullet) 또는 L2174 (P36 후속 표기).
**변경 안**:
- L2161 의 빈결과 보고 룰에 **예외 추가**: "단, [직전 확정 대상] focus.zone/buoy 가 있으면 그 이름을 1회 포함해 '동해중부앞바다 수심은 자료가 없어요' 처럼 답하세요."
- 또는 L2174 P36 에 명시적 우선화 한 줄 추가: "**빈결과 보고(/'그 정보는 없어요')에서도 이 규칙은 우선합니다** — 'X 정보는 없어요' 형태로 X 에 표준 해역명을 박으세요."

**위험**: 1 (낮음) — prompt 라인 1줄 추가 + 우선순위 명시. 다른 케이스 회귀 없음(빈결과 + focus 가 동시 충족돼야 발동).
**예상 효과**: NAV-2-01b 통과 확률 ~50% (LLM 이 룰을 따라줄 확률 의존). 다른 빈-결과 후속 케이스에도 정합 개선.

### (b) phase0_runner zone-miss 판정 완화 — 양방향 매칭

**위치**: `phase0_runner.py` L231–234.
**변경 안**:
```python
if case.get("expect_zone_match"):
    zone = case["expect_zone_match"]
    # 양방향 매칭: 답에 zone 부분문자열 OR focus.zone/standard 변형 OR originalLocToken
    candidates = [zone]
    f = (resp.get("focus") or {})
    if f.get("zone"): candidates.append(f["zone"])           # 표준 해역명
    if f.get("originalLocToken"): candidates.append(f["originalLocToken"])
    # zone 양방향: "동해중부" ↔ "동해중부앞바다" 부분 매칭 (zone in ans OR ans focus chain ok)
    if not any(c in ans for c in candidates):
        # 추가 안전판: focus 가 정확히 zone 의 광역 표준명이면 PASS (synth 빈결과 거절 허용)
        if f.get("zone") and zone in f["zone"]:
            pass  # 데이터 부재라도 focus chain 정확 → false fail 차단
        else:
            fails.append("zone-miss:%s" % zone)
```

**위험**: 1 (낮음~중간) — 판정기 완화 → false PASS 우려 (실제로 답이 다른 zone 으로 환각해도 PASS 처리될 위험). 단, `expect_no_halluc=true` 가 함께 걸려 있어 다른 가드로 차단됨.
**예상 효과**: NAV-2-01b 통과 ~80%. 게이트 의미가 "answer 에 zone 명시" 에서 "focus chain 정확" 으로 완화됨 — 판정 기준 약화 트레이드오프.

### (c) navy 직군 special handling — navy + cat=2 후속 시 prev focus.zone 강제 prompt 주입

**위치**: `assistant.js` synth prompt 빌더(L2153 부근) 또는 L2174 후속.
**변경 안**: jikgun=navy + isChainFollowup + (focus.zone 존재) 조건일 때 prompt 에 별도 라인:
```
**[NAV 후속 강제 명시 — Navy 직군 후속 turn 전용]**
답 첫 줄에 반드시 "[focus.zone]" 을 포함하세요. 빈결과여도 "[focus.zone] 수심은 자료가 없어요" 형태로 답하세요.
```

**위험**: 2 (중간) — 다른 직군에는 영향 없으나, NAV 케이스 내에서 답 형식 강제 → 자연어 다양성 저하. 다른 NAV 케이스(NAV-3-01, NAV-8-01 등) 가 이미 PASS 인데 답 톤 변화 우려. 또한 직군 분기 prompt 가 늘면 다른 직군에도 special block 요청이 누적될 토템폴 위험.
**예상 효과**: NAV-2-01b 통과 ~90%. 단 NAV 직군 다른 후속 케이스의 답 자연도가 약간 떨어질 수 있음(테스트 필요).

### 권고 우선순위

1. **(a) 우선 권고** — 위험 1, 효과 +50%, prompt 1줄. NAV-2-01b 외에 모든 직군의 빈결과 후속에 일관적 개선. P36 룰의 정합 강화이며 마스터플랜 의도 보존.
2. **(b) 보조** — (a) 만으로 부족하면 runner 측 양방향 매칭 추가. 단, "answer 가 zone 명시" 라는 게이트 의미가 약해진다는 점 의식.
3. **(c) 비권고** — 효과 90% 지만 직군별 special block 누적 위험 + 자연어 다양성 저하. 다른 직군 회귀 우려로 마지막 카드.

---

## 6. 보조 데이터: 데이터셋 보강 방향 (선택)

(a)/(b) 와 별개로 근본 해결책은 `/api/ocean/depth` 의 데이터 가용성 확장.
동해중부앞바다 좌표(37.5, 129.5) 외에도 다수 광역 zone 좌표에서 빈결과 가능성 — sentinel 외 운영 환경 사용자에게도 영향. 별도 트랙 권고.

---

## 결론

- **핵심 원인 한 줄**: `get_depth(동해중부앞바다)` 가 실데이터 부재 → synth 빈결과 보고 룰이 P36 후속 표기 룰을 덮어 답에 "동해중부" 가 등장하지 않음 (LLM 변동성 아님, 결정론적 3/3 재현).
- **권고 수정안 한 줄**: (a) synth prompt L2161 빈결과 보고 룰에 "단, focus.zone 이 있으면 그 이름을 1회 포함" 예외 1줄 추가 (위험 1, 효과 +50%, NAV-2-01b 외 빈결과 후속 일반 개선).
