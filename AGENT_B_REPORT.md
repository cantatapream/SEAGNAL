# Agent-B Report — 옵션 C [예비] 통보문 참고사항 해제·연장 처리

## 변경 요약

`local_server/weather_alerts_crawler.js` 에 다음 함수·로직 추가 (기존 함수는 무수정).

| 추가 함수 | 역할 |
|---|---|
| `parseReferenceSection(html)` | 참고사항 섹션을 HTML 에서 추출 후 해제·연장 케이스를 정규식으로 수집. `{ releases, extensions }` 반환. |
| `_extractSeaGroupsFromSubject(subject)` | 주어부 텍스트에서 "부모(자식1, 자식2)" 또는 "부모" 단독 패턴의 해상 부모 그룹들을 추출. "앞바다"·"먼바다"·"전해상" 접미어로 식별. 육상 케이스 ("경기도(연천, 파주)") 자동 제거. |
| `applyReferenceUpdates(form, previous, parsed)` | zone tree 의 zone leaf 들에 해제·연장 반영. 해제 시 `upcoming=null + children[*]=null + dmdwPushSender.forgetChild(...)`. 연장 시 `upcoming.tmEf` 와 자식 객체 `tmEf` 동시 갱신. **R8 보장을 위해 `previous` tree 도 동일하게 동기화** → `detectChanges` 가 차이를 잡지 않아 부모 push 트리거 없음. |
| `SEA_WRN_TYPES` 상수 | `['풍랑', '폭풍해일', '태풍']` — R6 한정. |

`run()` 함수 흐름에 단 1곳 추가:
```
mapDataToForm(...)              // 기존
→ parseReferenceSection(html)   // 신규
  + applyReferenceUpdates(...)
→ dispatchBulletinPublishPushes // 기존
```
호출은 `try-catch` 흡수 → 본체 흐름 무영향.

## 정규식 핵심

```js
// 해제
RE_RELEASE = /([^.\n]*?)의\s*(풍랑|폭풍해일|태풍)\s*예비\s*특보는?\s*발표\s*가능성이?\s*낮아져\s*해제(?:합니다|함\.?)/g

// 연장 (병렬 케이스 흡수 — "...으로, 다른의 풍랑 예비특보는 ...으로 연장하여 발표합니다")
RE_EXTEND_2 = /([^,\n]*?)의\s*(풍랑|폭풍해일|태풍)\s*예비\s*특보(?:는|를)?\s*([^,\n]*?)(?:으로|로)(?=\s*(?:,|연장(?:하여)?\s*발표))/g
```

## RESEARCH_DATA 자체 검증 결과

### 해제 13건 (해상 풍랑 2건 / 육상 11건)
| 케이스 | 결과 |
|---|---|
| 남해동부바깥먼바다 풍랑 (부산) | ✓ 매칭 |
| 남해서부서쪽먼바다 + 제주도앞바다(북부,서부) + 남쪽바깥먼바다 + 남서쪽안쪽먼바다 풍랑 (제주) | ✓ 매칭 (4개 부모 모두 추출) |
| 육상 11건 (호우/강풍 — 경기도/제주도 등) | ✓ 11/11 무시 (R6) |

**해상 매칭율: 2/2 = 100%**
**육상 false-positive: 0/11**

### 연장 9건 (해상 풍랑 5건 / 육상 4건)
| 케이스 | 결과 | tmEf 추출 |
|---|---|---|
| 남해서부서쪽먼바다 + 제주도북부앞바다 풍랑 (본청, 5/3) | ✓ | "오늘 밤(18~24시)" |
| 동해남부남쪽먼바다 + 남해동부안쪽먼바다 풍랑 (부산, 병렬) | ✓ 두 절 모두 | "오늘 밤(18~24시)" / "내일(22일) 새벽(00~06시)" |
| 남해서부동쪽먼바다 풍랑 (광주) | ✓ | "내일(22일) 오전(06~12시)" |
| 제주도앞바다(동부,남부) + 남동쪽안쪽먼바다 풍랑 (제주) | ✓ | "내일(22일) 오전(06~12시)" |
| 남해서부서쪽먼바다 + 제주도북부앞바다 풍랑 (제주, 5/3) | ✓ | "오늘 밤(18~24시)" |
| 육상 4건 (호우 — 경기도/강원도, 강풍 — 거문도) | ✓ 4/4 무시 (R6) |

**해상 매칭율: 5/5 = 100%**
**육상 false-positive: 0/4**

### False positive 가드 (4건)
| 케이스 | 결과 |
|---|---|
| "한편, 호우예비특보는 해제하나..." 안내 문장 | ✓ 무매치 (종결사 강제 + 해제하나 패턴 가드) |
| "(1) 강풍 예비특보" 본문 list 헤더 | ✓ 무매치 |
| "(2) 풍랑 예비특보" 본문 list 헤더 | ✓ 무매치 |
| "o 05월 21일 오후(...) : 동해남부남쪽안쪽먼바다, ..." 발표 list | ✓ 무매치 |

**FP 가드: 4/4 통과**

## V1~V7 검증

| # | 항목 | 결과 | 근거 |
|---|---|---|---|
| **V1** | 본문 list 처리 회귀 0 | ✓ | `parseChildWarnings` 무수정. `git diff` 결과 본문 list 관련 라인 변경 없음. |
| **V2** | 해제 정규식 정확도 | ✓ 13/13 (해상 2 매칭 + 육상 11 무시), FP 0 | RESEARCH_DATA 13건 + FP 4건 검증 통과 (위 표). |
| **V3** | 연장 정규식 정확도 + 시각 파싱 | ✓ 9/9 (해상 5 매칭 + 육상 4 무시) | 병렬 케이스(부산 5/21) 두 절 모두 추출 성공. |
| **V4** | 자식 자동 해제 (R2) | ✓ | "제주도앞바다(제주도북부앞바다, 제주도서부앞바다)" 추출 후 두 leaf 의 `upcoming = null`, `children[X] = null` 확인. |
| **V5** | forgetChild 호출 보장 (R3) | ✓ | 테스트에서 `forgetChild('제주도북부앞바다', '연안바다')`, `forgetChild('제주도서부앞바다', '북서연안바다')`, `forgetChild('남해서부서쪽먼바다', '추자도연안바다')` 호출 확인. |
| **V6** | 육상 종류 무시 (R6) | ✓ | 정규식 wrnTp 캡처를 `SEA_WRN_TYPES` 한정. 검증에서 호우·강풍 케이스 모두 무시. |
| **V7** | 부모 푸시 영향 X (R8) | ✓ | `applyReferenceUpdates` 가 `previous` tree 도 동기화 → `detectChanges` 의 `prev`/`curr` 가 같아져 `UPCOMING_CHANGE`/`CURRENT_CHANGE` 가 잡히지 않음. 따라서 `pushSender.processChanges` 가 부모에 대해 빈 changes 만 받음. 추가 푸시 트리거 없음. |

## R1~R8 충족 매트릭스

| # | 명세 | 충족 | 비고 |
|---|---|---|---|
| R1 | 해제 문구 파싱 → `upcoming = null` | ✓ | `applyReferenceUpdates` |
| R2 | 자식도 함께 null | ✓ | `children[childName] = null` 일괄 |
| R3 | `forgetChild` 호출 | ✓ | `dmdwPushSender.forgetChild(parentZone, displayName)` |
| R4 | 연장 → `upcoming.tmEf` 갱신 | ✓ | 원본 시각 문자열 그대로 저장 (예: "내일(22일) 오전(06~12시)") |
| R5 | 자식 `tmEf` 동시 갱신 | ✓ | 자식 객체 spread 후 tmEf 만 덮어쓰기 |
| R6 | 풍랑·폭풍해일·태풍 한정 | ✓ | `SEA_WRN_TYPES` 검사 |
| R7 | `parseChildWarnings` 보존 | ✓ | 0 라인 변경 |
| R8 | 부모 푸시 무영향 | ✓ | previous 동기화 |

## 알려진 한계

1. **시각 표현 정규화 미수행**: tmEf 는 KMA 원문 ("오늘 밤(18~24시)", "내일(22일) 오전(06~12시)") 그대로 저장. `_isExactSingleTime` (line 597) 가 이를 단일 정확 시각으로 인식하지 않아 `_publishCandidateRejectReason` 는 보수적 통과 처리 → 즉 신규 자식 발표 푸시는 차단하지 않음 (예비 단계 정책과 일치). 하지만 `parseKmaTime` 기반의 발효시각 도달 판정 (line 462 `resolvePendingStatuses`) 은 이 형식을 파싱하지 못하므로, 연장된 upcoming 의 자동 발효 전환은 정확한 KMA 정형 시각 ("2026년 05월 21일 06시 00분") 이 들어와야만 발동. 본 작업 범위 밖.

2. **연장 케이스의 부모 컨테이너 처리**: "제주도앞바다(제주도동부앞바다, 제주도남부앞바다)" 같은 경우, "제주도앞바다" 자체는 leaf 가 아니므로 괄호 안 자식들 (`제주도동부앞바다`, `제주도남부앞바다`) 의 leaf 만 갱신. 괄호 없는 "제주도앞바다" 단독 등장 시엔 prefix 매치로 4개 sub-leaf 모두 갱신 — 의도된 동작이지만 KMA 실문에선 그런 케이스 미관찰.

3. **`해제하나` 가드 정책**: 해당 키워드가 문장 어디에든 있으면 해제 매치 자체를 skip. 매우 드물게 진짜 해제와 안내가 한 문장에 섞이면 누락 가능. RESEARCH_DATA 68건엔 그런 케이스 없음.

4. **자식 그룹화 정규식 한계**: 자식 이름이 "앞바다/먼바다/전해상" 으로 끝나지 않으면 인식 불가. 현행 시스템의 leaf 이름과 일치하므로 문제 없으나, 향후 KMA 가 다른 표기 사용 시 보강 필요.

## 산출물

- `local_server/weather_alerts_crawler.js` — `parseReferenceSection`, `_extractSeaGroupsFromSubject`, `applyReferenceUpdates` 추가 + `run()` 한 줄 호출. parseChildWarnings 무변경.
- `AGENT_B_REPORT.md` — 본 문서.

## 커밋

```
[Agent-B] 옵션 C — 참고사항 해제·연장 처리 + 자식 자동 해제
```
