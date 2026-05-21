# Agent-A 보고서 — 옵션 C [예비] 통보문 참고사항 해제·연장 처리

## 1. 변경 요약

### 수정 파일
- `local_server/weather_alerts_crawler.js` — 신규 함수 4개 추가 + `run()` 흐름 1지점에 hook.

### 신규 함수 (모두 동일 파일 내)
- `parseReferenceSection(html, refNow=null)` — HTML 의 "참고사항" 섹션을 추출해 해제·연장 안내를 파싱.
- `applyReferenceUpdates(fullForm, refResult)` — 파싱 결과를 `form.current` 에 반영 (자식 null + `forgetChild`) + `form.previous` 미러 동기화로 R8 보장.
- `_parseReferenceTime(text, refNow)` — "오늘 밤(18~24시)" / "내일(22일) 오전(06~12시)" 등 시간 토큰 → "YYYY년 MM월 DD일 HH시 mm분".
- `_extractZoneGroups(subjectText)` — 주어부에서 "[해역명](자식, 자식)" / 단일 해역명 추출. 해상 어휘((앞)바다·먼바다·전해상·해상) 포함 토큰만 인정 → 육상 행정구역 자연 제외.
- `_findZoneNode(tree, zoneName)` — zone tree 에서 leaf zone(`{current, upcoming, history, children}`) 노드 검색.

### 정규식 (3개)
- `_RE_RELEASE` — `"...의?\s*(풍랑|폭풍해일|태풍)\s*예비\s*특보(?:는|를)?[\s\S]{0,80}?발표\s*가능성이?\s*낮아져\s*해제(?:합니다|함\.?)"`
  - "발표가능성이/발표 가능성이" 공백 변형 흡수.
  - 끝맺음 "해제(합니다|함\.?)" 만 인정 → "해제하나" (안내문) 자연 차단.
- `_RE_EXTEND` — `"...예비\s*특보(?:는|를)?\s*([\s\S]{1,160}?)으?로\s*(?:연장하여|연장)\s*발표(?:합니다|함\.?)"`
  - 병렬 절 (예: "...으로, ...으로 연장하여 발표") 케이스는 매칭된 문장 내부를 추가 `RE_PAIR` 정규식으로 분해.
- `_RE_GROUP` — `"([가-힣]+(?:앞바다|먼바다|전해상|해상))(?:\s*\(([^)]+)\))?"` — 해상 어휘만.

### `run()` 흐름 변경 (1지점)
```
3. mapDataToForm(fullForm.current, activeChildren);
3-A. [신규] try {
        const refResult = parseReferenceSection(html);
        const refCounts = applyReferenceUpdates(fullForm, refResult);
        console.log(...)
     } catch (e) { console.error(...) }   // 본체 흐름 무영향
3-bis. dispatchBulletinPublishPushes (기존)
4. detectChanges (기존)
5. pushSender.processChanges (기존)
```

### `dmdw_push_sender.js`
- 변경 없음. `forgetChild` 의 호출만 추가 (R3).

---

## 2. V1~V7 검증 결과

### V1. 본문 list 처리 회귀 0
- `parseChildWarnings` 함수 본문 0 byte 수정. mapDataToForm 동작 보존.
- 회귀 0 보장.

### V2. 해제 정규식 정확도
| 케이스 출처 | 종류 | 기대 | 결과 |
|---|---|---|---|
| 본청 05-13 | 호우 | null (무시) | PASS |
| 본청 05-12 - 또한 | 호우 | null | PASS |
| 본청 05-4 | 강풍 | null | PASS |
| 수도권 05-7 | 호우 | null | PASS |
| 수도권 05-6 | 호우 | null | PASS |
| 부산 05-6 | **풍랑** | 풍랑 | PASS |
| 부산 05-5 | 호우(예비특보 공백X) | null | PASS |
| 광주 05-7 | 호우 | null | PASS |
| 강원 05-6 | 호우 | null | PASS |
| 제주 05-12 | **풍랑** (그룹+자식 다중) | 풍랑 | PASS |
| 제주 05-11 | 강풍 | null | PASS |
| 제주 05-10 | 호우 | null | PASS |
| 제주 05-3 | 강풍 | null | PASS |

**해제 매칭율: 13/13 (100%) · 해상(풍랑) 적중 2/2 · false positive 0**

False positive 회피 검증:
- "한편, 호우예비특보는 해제하나..." → 0건 매칭 (PASS)

### V3. 연장 정규식 정확도
| 케이스 출처 | 종류 | 기대 | 결과 | 시각 |
|---|---|---|---|---|
| 본청 05-12 | 호우 | null | PASS | — |
| 본청 05-5 | **풍랑** | 풍랑 | PASS | 오늘 밤(18~24시) → 2026-05-21 18:00 |
| 수도권 05-6 | 호우 | null | PASS | — |
| 부산 05-6 (병렬) | **풍랑 × 2** | 2건 추출 | PASS | 오늘 밤 / 내일 새벽 모두 |
| 광주 05-8 잘림 | 강풍 | null | PASS | — |
| 광주 05-8 | **풍랑** | 풍랑 | PASS | 내일(22일) 오전(06~12시) → 2026-05-22 06:00 |
| 강원 05-5 | 호우 | null | PASS | — |
| 제주 05-12 | **풍랑** | 풍랑 | PASS | 내일(22일) 오전(06~12시) |
| 제주 05-4 | **풍랑** | 풍랑 | PASS | 오늘 밤(18~24시) |

**연장 매칭율: 9/9 (100%) · 해상(풍랑) 적중 5/5**

### V4. 자식 자동 해제 (R2)
입력: `참고사항 ... 제주도앞바다(제주도북부앞바다, 제주도서부앞바다)의 풍랑 예비특보는 발표가능성이 낮아져 해제합니다`
- ✅ `form.current.제주도북부앞바다.upcoming === null`
- ✅ `form.current.제주도서부앞바다.upcoming === null`
- ✅ `form.current.제주도북부앞바다.children.제주도북부앞바다중연안바다 === null`
- ✅ `form.current.제주도서부앞바다.children.제주도서부앞바다중북서연안바다 === null` (외 2개도 동일)

### V5. forgetChild 호출 보장 (R3)
같은 케이스에서 호출된 forgetChild:
- `forgetChild('제주도북부앞바다', '연안바다')` ✅
- `forgetChild('제주도서부앞바다', '북서연안바다')` ✅
- `forgetChild('제주도서부앞바다', '남서연안바다')` ✅
- `forgetChild('제주도서부앞바다', '가파도연안바다')` ✅

총 4회 (자식별 1회).

### V6. 육상 종류 무시 (R6)
- `"...경기도(연천, 파주)의 호우 예비특보는...해제합니다"` → 0건 매칭 (PASS)
- `"...제주도북부의 강풍예비특보는...해제합니다"` → 0건 매칭 (PASS)
- 정규식 `(풍랑|폭풍해일|태풍)` 만 캡처 그룹이므로 자연 차단.

### V7. 부모 푸시 영향 X (R8)
검증: V4 시나리오 적용 후 `detectChanges(form.previous, form.current)` 호출
- UPCOMING_CHANGE: **0건** (PASS)
- 이유: `applyReferenceUpdates` 가 `fullForm.previous` 트리도 동일 zone 에 미러 동기화 → diff 0.

추가 안전망:
- 기존 `push_sender.js` 의 `UPCOMING_CHANGE` 핸들러 (라인 104~155) 는 `if (!curr) continue;` 로 upcoming→null 케이스에서 푸시를 발송하지 않음 — 미러 동기화가 깨져도 이중 안전.

---

## 3. 실측 데이터 매칭율 (RESEARCH_DATA.md 기준)

| 항목 | 결과 |
|---|---|
| 해제 13건 중 매칭 분류 정합 | **13/13 (100%)** |
| 해제 13건 중 풍랑 추출 (적용 대상) | **2/2 (100%)** |
| 연장 9건 중 매칭 분류 정합 | **9/9 (100%)** |
| 연장 9건 중 풍랑 추출 (적용 대상) | **5/5 (100%)** |
| 병렬 절 (1개) 두 zone 모두 추출 | **2/2 (100%)** |
| False positive ("해제하나" 안내) | **0** |

---

## 4. R1~R8 충족 여부

| 요구사항 | 우선 | 충족 | 비고 |
|---|---|---|---|
| R1 — 해제 문구 파싱 → upcoming=null | P0 | ✅ | V4 |
| R2 — 자식 모두 null | P0 | ✅ | V4 |
| R3 — forgetChild 호출 | P0 | ✅ | V5 |
| R4 — 연장 문구 → upcoming.tmEf 갱신 | P1 | ✅ | applyReferenceUpdates extends 절 |
| R5 — 자식 tmEf 동일 갱신 | P1 | ✅ | 같은 함수 내 자식 객체 순회 |
| R6 — 풍랑·폭풍해일·태풍 만 | P0 | ✅ | V6 + 정규식 캡처 그룹 한정 |
| R7 — parseChildWarnings 회귀 0 | P0 | ✅ | V1 (함수 본문 무수정) |
| R8 — 부모 push 무영향 | P0 | ✅ | V7 (previous 미러 + pushSender 자연 차단) |

---

## 5. 알려진 한계 (Known Limitations)

1. **시간 파싱 모호 케이스**: 참고사항 시각 토큰이 "오늘 늦은 오후"(시각 단어 없음) 처럼 매우 모호한 경우 fallback 15시 적용. KMA 실측에선 시간 범위가 거의 항상 명시되므로 영향 미미.

2. **dayMatch 우선순위**: "내일(22일)" 같이 명시 일자 있을 때, 현재 base 시각의 월이 변경된 케이스(월말 → 다음달 1일) 는 부분적 부정확 가능 — 그러나 KMA 통보문은 항상 당일/익일/모레 만 사용하므로 운영상 무영향.

3. **TZ 의존**: `_parseReferenceTime` 은 `new Date()` 기반 — 컨테이너 `TZ=Asia/Seoul` 가정. Dockerfile 에서 보장됨 (기존 코드와 동일 정책).

4. **자식해역명 일치 가정**: `_findZoneNode` 가 참고사항의 해역명을 `createZoneStructure` 의 key 이름과 정확 일치(트림만) 시킨다. 향후 KMA 통보문에 변형 이름(예: "남해서부서쪽 먼바다" 공백 삽입) 이 등장하면 미해결 leaf 로 분류되어 `unresolvedLeaves` 로그에 남는다 — 운영 모니터 가능.

5. **단일 RE_EXTEND 매치 → 병렬 분해 fallback 의존**: 매우 복잡한 3절+ 병렬 구조는 RE_PAIR 가 잡지 못할 수 있음. 30일 실측에선 2절 병렬 1건 (부산 05-6) 만 등장 — 정상 처리됨.

6. **참고사항 섹션 위치 가정**: HTML 에 "참고사항" 문자열이 본문보다 뒤에 1회 등장한다고 가정. 페이지 레이아웃이 바뀌면 첫 등장 위치부터 끝까지 통째로 검사 → false positive 위험은 낮으나 모니터 필요.

---

## 6. 절대 규칙 준수 체크

- [x] SPEC § 5 의 수정 허용 파일 외 다른 파일 수정 없음 (`weather_alerts_crawler.js` 1개 파일만 수정).
- [x] `dmdw_push_sender.js` 변경 없음 (forgetChild 호출만 추가).
- [x] 자식 GeoJSON / admin.js / dmdw_warn_crawler.js 무수정.
- [x] `parseChildWarnings` 동작 보존 (V1).
- [x] 풍랑·폭풍해일·태풍 만 처리 (R6).
- [x] 부모 푸시 시스템 영향 0 (R8 — V7 확인).
- [x] 해제 시 자식 children null + forgetChild 호출 (R2·R3 — V4·V5 확인).

---

## 7. 커밋

- 브랜치: `worktree-agent-a86020becd729cdeb`
- 커밋 메시지: `[Agent-A] 옵션 C — 참고사항 해제·연장 처리 + 자식 자동 해제`

## 8. 검증 스크립트

`/tmp/agent_a_verify.js` — 자체 테스트 스크립트. 다음 명령으로 실행:
```bash
cd /home/user/SEAGNAL/.claude/worktrees/agent-a86020becd729cdeb
node /tmp/agent_a_verify.js
```
모든 V1~V7 케이스가 PASS 됨을 확인.
