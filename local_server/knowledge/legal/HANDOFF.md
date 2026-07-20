# 🔁 나리야 — 인계인수서 (HANDOFF) · 완전판 온보딩 문서

> **⚠️ 어떤 Claude 계정이든, 이 저장소(SEAGNAL)에서 작업을 시작하기 전에 이 파일을 처음부터 끝까지 정독한다.**
> 이 문서 하나로 "이 프로젝트가 뭔지 / 어떤 문서를 봐야 하는지 / 지금까지 뭘 했는지 / 지금 뭘 하는 중인지 / 다음에 뭘 해야 하는지 / 절대 하면 안 되는 실수가 뭔지"를 전부 파악할 수 있게 쓴다.
> **작업 규칙**: 착수 전 [작업 로그]에 착수 항목 append → 작업 후 완료 항목 append(진행률·다음). 도구: `python3 _dashboard/loop/handoff.py start "제목" "내용"` / `... done "제목" "내용"`.

---

## 0. 이 프로젝트가 무엇인가 (한눈에)

**SEAGNAL**은 해양 날씨·조석·특보 정보를 제공하는 앱이고, 그 안에 **"나리야"라는 AI 해양법률 챗봇**을 만드는 중이다. 나리야는 한국 해양 관련 **법률 70개**(선박안전법·수산업법·해양경비법 등)를 학습해, 사용자가 "낚싯배 탈 때 구명조끼 안 입으면 어떻게 돼?" 같은 질문을 하면 **정확한 조문·처벌·절차를 근거와 함께** 답한다.

핵심 설계 철학(카파시 가이드라인, `CLAUDE.md` 최상단): 코딩 전에 생각하고 추측하지 말 것, 최소 코드로 시킨 것만 할 것, 외과수술식으로 필요한 것만 고칠 것, 검증 가능한 목표를 세우고 통과할 때까지 반복할 것. **환각 0(hallucination zero)이 이 프로젝트의 최우선 불변식**이다 — 법률 정보는 틀리면 실제 피해로 이어지므로, 위키에 없는 내용은 "확인되지 않는다"고 정직하게 답하지 지어내지 않는다.

**저장소 구조**: `/home/user/SEAGNAL` 루트. 앱 코드는 `client/`(프론트엔드, 번들러 없음)와 `local_server/`(Express 백엔드). 나리야 법률 데이터·문서는 전부 `local_server/knowledge/legal/` 아래에 있다. 작업 브랜치는 `claude/llm-wiki-maritime-legal-4f05zo`.

---

## 1. 읽어야 할 문서 지도 (파일별 상세 — 반드시 순서대로)

### 1-1. 루트 `/home/user/SEAGNAL/CLAUDE.md` (가장 먼저, 항상 자동 로드됨)
모든 AI 작업의 최상위 지침. 이 세션 동안 계속 갱신됐다. 담긴 내용:
- **카파시 가이드라인 4원칙**(코딩 전 생각·단순함 우선·외과수술식 변경·목표기반 실행) — `.claude/skills/karpathy-guidelines/SKILL.md`에 상세.
- **★인계인수 규칙(최우선)**: 세션 시작 시 `HANDOFF.md`(이 파일) 먼저 정독 → 작업 전/후 로그 기록 필수. **여러 Claude 계정이 번갈아/함께 작업하기 때문에 생긴 규칙**.
- **★작업 착수 전 마크다운 정독 규칙**: `MASTER_PLAN.md`·`README.md`·`_SCHEMA.md`·`_CHATBOT.md`·`_LESSONS.md`를 먼저 읽어야 한다. **모델 정책도 여기 명시**: fable 모델은 사용자 명시 지시 전까지 금지, 검증류는 sonnet·medium.
- 배치 결정 트리(새 코드를 어디에 둘지), 파일 헤더·함수 주석 표준, 커밋 전 체크리스트.
- **시간 표기 규칙**: 사용자에게 시각을 알릴 땐 **항상 KST(UTC+9)**로. "14:00 KST" 형식.
- **MEMORY.md 자동 갱신 규칙**: `.claude/memory/MEMORY.md`를 세션 시작 시 읽고, 중요한 결정마다 한 줄 요약으로 갱신(폭발 방지: 최근 15개만, 원문 붙여넣기 금지).
- **대화→마크다운 수시 반영 규칙**: 대화에서 나온 새 요구사항·결정은 즉시 알맞은 문서에 반영(사용자가 시키지 않아도). 추가만 하고 기존 합의를 지우지 않음.
- **도구·방법론 결정 로그**: Superpowers 플러그인 도입 보류 결정 등.
- **병렬 작업 안전 규칙(★매우 중요, 아래 5절에서 상세)**: 공유파일 동시쓰기 경합 위험이 있는 작업은 절대 병렬 금지, 단독 직렬 처리.

### 1-2. `local_server/knowledge/legal/HANDOFF.md` (이 파일)
**계정 간 작업 연속성 전담 문서.** MASTER_PLAN이 "무엇을/왜"라면 이 파일은 "지금 어디까지/진행중/다음"이다. A절(현재 상태 스냅샷)은 항상 최신으로 덮어쓰기, 맨 아래 [작업 로그]는 append-only(지우지 않음, 최신이 위).

### 1-3. `local_server/knowledge/legal/MASTER_PLAN.md` (55KB, 가장 크고 중요)
로드맵의 진실원천. 구조: 비전/불변식 → 로드맵 대시보드(Phase A~G 단일 상태표) → 단계별 상세. **H절(H-0~H-19)이 최신 핵심 결정들**:
- **H-7**: 감사→통합수정→재감사 루프(구멍 재발 차단)
- **H-8**: ⚠REVIEW 데이터는 감사 채점 보류(사람검증 전 값을 정답/오답으로 채점 안 함)
- **H-9~H-11**: lint 자율루프 편입, 워크스페이스당 7법 배치
- **H-12**: ★3대 보완 — ①메타출처검증 ②draft→canonical 승인 이원화(이번 세션에 grounding 기준으로 정제됨) ③감사→수집 환류
- **H-13**: 비차단 원칙(자율루프는 에스컬레이션 있어도 안 멈춤, 로그만 누적)
- **H-14**: 시간대 스로틀(감사만 활용시간 1개/비활용 10개, 수정·lint·수집은 시간무관 병렬)
- **H-15~H-16**: 에스컬레이션 조치, H-12② 소급적용
- **E절(챗봇 엔진)**: 이번 세션에 **canonical 안전필터 선구축** 내용이 상세히 추가됨(취지·켜는 절차·함정) — 아래 4-6절 참조.
- **최상단에 "HANDOFF.md 먼저 읽어라"는 지시가 이번 세션에 추가됨.**

### 1-4. `local_server/knowledge/legal/README.md` (총괄)
문서 지도, 5층 구조 설명, 확정된 설계 결정 요약, **현황 표(Phase별 상태)**, 로드맵 요약, 유지보수 규칙. "5-1. 현황 추가 갱신(2026-07-20)"에 이번 세션 성과가 표로 정리돼 있다.

### 1-5. `local_server/knowledge/legal/_SCHEMA.md` (45KB)
위키 페이지를 어떻게 만드는지의 규격서. concept 페이지 구조, frontmatter 필드, 링킹 규칙, **5절 "통계·상태 태그"**가 핵심 — `status: canonical/draft/review-pending` 의미와 **이원화 승격 규칙**(이번 세션에 "grounding 기준"으로 정제: 원문 EXACT 인용이면 AI 승급 가능, 별표 이미지 OCR값·AI 추론매핑만 사람 필요). 6절은 REVIEW 플래그 포맷.

### 1-6. `local_server/knowledge/legal/_CHATBOT.md`
답변 엔진(Phase E) 설계 규칙. 프로필 필드, 점진적 공개 원칙, **3절 인용 규율(환각0)** — 이번 세션에 "검증된 canonical만 인용" 규칙이 추가됨. 4절 하이브리드 검색(직접매칭+glossary+임베딩+그래프홉), 5절 답변 경계.

### 1-7. `local_server/knowledge/legal/_LESSONS.md` (이번 세션 신설, ★반드시 읽을 것)
**시행착오 로그. 같은 실수를 반복하지 않기 위한 문서. L-1~L-12까지 기록됨:**
- L-1: 병렬 공유파일 경합으로 데이터 손실(2026-07-18)
- L-2: 자동승급 과보수 — "처벌 단어=무조건 draft"는 틀렸음. grounding으로 정제.
- L-3: 리뷰 카드 유형 무시 — 전부 수치입력란이었는데 실제론 0%가 수치형.
- L-4: 리뷰큐에 AI가 해결 가능한 것 대량 혼입 — 트리아지 필요.
- L-5: canonical 필터 부재 — 미검증 draft가 답변에 샐 위험.
- L-6: config POST가 다른 필드 덮어씀 — 머지 방식으로 수정.
- L-7: silent success — 0페이지 승격인데 ok:true 반환하던 버그.
- L-8: UI 오구현 — 지시와 다른 위치에 탭 생성.
- L-9: 감사 full률 하락을 회귀로 오해(실제론 난이도 상승 설계).
- L-10: 큰 워크플로 결과가 알림에서 잘림.
- L-11: main 머지 시 dirty tree로 checkout 실패 — fast-forward push로 해결.
- **L-12(★최신, 이번 세션): 모델 과다 사용으로 크레딧 소진** — fable5×high×70+에이전트로 draft 재검증 돌리다 크레딧 소진, 33법 미완. **교훈: 작업 성격에 모델을 right-size. 검증·재판정은 sonnet·medium이면 충분. fable은 사용자 명시 지시 전까지 금지.**

### 1-8. 기타
- `index.md`: 위키 목차(자동생성, `gen_index.py`로 재생성).
- `log.md`: 작업 일지(방대, 1.2MB) — 상세 이력이 필요할 때만 참조.
- `_dashboard/AUTO_RUN_LOG.md`: 자율루프(cron) 실행 기록.
- `_dashboard/AUTO_RUN_WATCHLIST.md`: 자율루프가 판단 못해 누적한 미보고 항목.
- `_dashboard/CHATBOT_UI_PLAN.md`: 챗봇 UI 설계안(요구사항 R1-R13).
- `_dashboard/human_workload.json`: 분야별 사람 검수량 집계 결과(기계가 읽는 데이터, 사람이 볼 땐 이 문서 4-8절 표 참조).

---

## 2. 세션 전체 연대기 (이번 세션에 무슨 일이 있었나, 순서대로)

이번 세션은 **compact 이전(요약으로 승계된 부분)**과 **compact 이후(이 대화에서 직접 진행된 부분)**로 나뉜다.

### 2-1. Compact 이전 요약 (이미 완료된 것)
- 나리야 챗봇 UI 목업 → 실제 구현(FAB, KakaoTalk 스타일 채팅, 캐릭터 아바타, 검토센터).
- 관리자 검토 시스템(B안): `routes/legal.js` 서버 API + `legal_review.html` 독립 리뷰 페이지 + 앱 내 AI탭 서브탭 배선.
- main 브랜치에 2회 머지(fast-forward push 방식, dirty tree 문제 회피).
- **핵심 발견**: 위키 923개 concept 중 86%(793개)가 draft(미승급) 상태 → 챗봇이 인용 가능한 canonical은 81개뿐. **이게 진짜 병목**이라는 걸 발견.
- auto_promote.js로 1차 자동승급 시도(보수적 — 처벌 단어 있으면 무조건 draft 유지) → canonical 81→208.

### 2-2. Compact 이후 (이 대화에서 진행) — 시간순
1. **사용자가 리뷰큐 스크린샷 11장 업로드** → 3가지 문제 지적: ①카드에 원 질문·판단근거·해결방법이 불명확 ②모든 카드가 수치 입력란(예:10)인데 실제론 해석형이 많아 안 맞음 ③"원문 미확보" 같은 게 AI가 처리할 수 있는데 왜 사람에게 넘겼는지.
2. **fable5로 리뷰큐 97건 전수 재검증** → HUMAN 32(33%) / AI_RECOLLECT 29 / AI_SELFVERIFY 36 (67%가 AI로 걸러짐, 수치입력이 맞는 건 0건).
3. 사용자 선택: **"자동 확정"**(질문형 AskUserQuestion으로 확인받음). 카드 UI를 유형별로 재설계(값형=값입력, 해석형=승인/기각+메모).
4. **review_resolve.js**(원문 grounding 재검증, 읽기전용 판정) 20그룹 병렬 실행 → resolved 31·needs_collect 12·human 54.
5. **apply_resolutions.py**로 단독 직렬 적용 → 리뷰큐 97→66건, canonical 208→240.
6. 사용자 지시: **"마스터플랜·관련 md 정독하여 현황 재정리 + 시행착오 기록 + 재발방지 규칙화"** → `_LESSONS.md` 신설(L-1~L-11), `_SCHEMA.md` 5절 정제, `CLAUDE.md`에 "작업 전 정독" 규칙 추가, `README.md` 현황 갱신.
7. 사용자 질문: **"draft 800여건도 동일 방식으로 검증해볼래?"** → 실측(draft 666건 중 별표OCR의존 83건뿐, 나머지는 원문인용형) → **draft_reverify.js** 작성(원문 grounding, promote/card/keep 3분류).
8. 사용자 지시: **"파일럿 없이 전체 한번에, 병렬 가능하면 병렬로"** → 70법 10그룹(fable5×high) 동시 실행.
9. 사용자 사이드 질문: **"canonical 안전필터 미리 코드만 짜두고 스위치는 나중에"** → `routes/legal.js`에 `answerCanonicalOnly` 스위치(기본 OFF) + `lint_index.py`에 status 색인 추가. MASTER_PLAN·_CHATBOT.md에 취지·절차 상세 기록.
10. 사용자 질문: **"미리 해둘 수 있는 작업 있나?"** → 서식(HWP/PDF) 원본 유실방지 매니페스트(`forms_manifest.json`, flSeq 280개) 생성.
11. **크레딧 소진 발생** — fable5×high×70+에이전트 실행 중 다수 에이전트가 "usage credits 소진"으로 실패. 37/70법만 성공(canonical 240→490).
12. 사용자 반복 지시(4회): **"모델이 과한지 판단해서 적절한 모델 사용"** + **"페이블 모델은 지시 없으면 사용하지 마"** → `review_resolve.js`·`draft_reverify.js`를 **fable→sonnet, high→medium**으로 교체. `_LESSONS.md`에 L-12 추가.
13. 사용자 지시: **"인계인수서 필요 — 계정 바뀌어도 연속성 유지"**(새 Claude 계정으로 GitHub 연결 예정) → **`HANDOFF.md` 신설** + `handoff.py` 헬퍼 + CLAUDE.md/MASTER_PLAN에 강제 지점 추가.
14. 미완 33법을 sonnet·medium으로 재개(2그룹) → 이후 사용자 지시로 **더 잘게 쪼개 6그룹(4법씩)**으로 병렬도 상향 → 순차 완료 알림 오는 대로 커밋 반복(에러 0, 안정적).
15. **[이 문서 작성 시점]** 사용자가 이 초상세 인수인계서를 요청함.

---

## 3. 사용자가 전체 대화에서 반복 강조한 핵심 원칙 (★★★ 절대 놓치면 안 됨)

1. **환각 0 / 정확성 최우선** — 법률 정보는 원문 grounding 없이 만들면 안 됨. "확인되지 않는다"고 정직하게 답하는 게 지어내는 것보다 낫다.
2. **작업 전 마크다운 정독** — 추측으로 진행 금지. 애매하면 조용히 고르지 말고 확인/명시.
3. **경합위험 작업은 병렬 절대 금지** — 공유파일(review_queue.md, raw/15 공용 타법, graph 허브) 동시쓰기는 데이터 손실 이력이 있음(L-1). 병렬은 **각자 자기 파일만 쓸 때만** 안전. 위험 작업은 md에 "⚠경합위험"으로 명시해 다음에도 자동으로 단독 처리되게.
4. **자동 실행·비차단** — 자율루프(H-13)는 에스컬레이션이 있어도 멈추지 않는다. 물어보지 말고 설계해서 진행하되, 안전하지 않은 결정은 사용자 승인 필요(예: exposure 기본 OFF).
5. **모델은 작업에 맞게 right-size** — 과하면 크레딧 낭비(실제로 발생), 부족하면 품질 저하. **fable 모델은 사용자가 명시 지시하지 않는 한 사용 금지**(이번 세션에 명확히 확정된 규칙). 검증류 작업은 sonnet·medium이 적합.
6. **시각은 항상 KST로 표기**.
7. **문서는 추가만, 삭제·재작성 금지**(오래된 상태 갱신은 예외) — 기존 합의와 상반되면 먼저 확인.
8. **UI/UX는 실사용자 관점에서 재검토** — 스크린샷 보여주며 "이 카드만 보고 판단할 수 있는가?"를 실제로 검증함. 사용자는 화면을 캡처해 보여주고 구체적으로 뭐가 이상한지 짚는 방식으로 피드백함.
9. **완료를 "성공"이라 말하기 전에 실제 효과로 검증** — 0건 처리인데 ok:true 반환하는 걸 문제 삼음(L-7). 적대적 리뷰(다른 에이전트가 반증 시도)로 검증하는 습관.
10. **미리 준비하되 안전장치와 함께** — canonical 필터처럼 "지금 켜면 위험한 기능"은 코드는 미리 짜되 스위치로 잠그고, 그 취지·켜는 절차·되돌리는 법을 문서에 상세히 남겨야 한다("미흡한 문제가 발생하면 안 되게").
11. **인계인수 철저** — 여러 Claude 계정이 이 저장소를 함께/번갈아 쓸 예정이므로, 어떤 계정이 접속해도 로그만 읽고 이어갈 수 있어야 한다. 작업 전/후 기록이 상세하고 누락 없어야 한다(바로 이 문서와 `handoff.py`가 그 결과물).
12. **분야별로 세세하게 보고** — "사람이 검수해야 하는 게 얼마나 되는지, 각 분야별로" 같은 요청처럼, 뭉뚱그린 숫자가 아니라 **카테고리별 분해**를 원함.

---

## 4. 안전장치·설계 결정 상세 (다음 세션이 반드시 이해해야 할 것)

### 4-1. 승급(draft→canonical) 판정 기준 — grounding
"처벌 조문이 있다"는 표면 신호가 아니라, **그 내용이 raw 원문과 grep로 EXACT 일치하는 인용인지**로 판정한다. 일치하면 AI가 자체 승급 가능(기계검증 가능). **진짜 사람이 필요한 건 딱 둘**: ①별표 스캔 이미지의 OCR 판독값(텍스트로 확증 불가) ②AI가 원문에 없는 걸 추론한 매핑·법리판단·유권해석·판례·입법연혁. (`_SCHEMA.md` 5절, `_LESSONS.md` L-2)

### 4-2. 리뷰큐 자동 트리아지
사람 검토 큐에 올리기 전에 AI가 먼저 원문 재대조해서 `resolved`(자동확정)/`needs_collect`(AI 수집 트랙)/`human`(진짜 필요)으로 분류. 무작정 사람에게 다 넘기지 않는다. (`review_resolve.js` → `apply_resolutions.py`)

### 4-3. canonical 안전필터 스위치 (★중요, 아직 OFF 상태)
- 위치: `routes/legal.js`의 `/api/legal/config`(GET/POST), 저장 파일 `nariya_config.json`.
- 필드: `answerCanonicalOnly`(boolean, 기본 **false**=현행 전체검색). `exposure`(off/admin/user, 기본 off)와 별개 필드, **머지 저장**(한 필드 갱신이 다른 필드를 안 지움 — L-6 교훈 반영).
- **켜는 절차(순서 반드시 지킬 것)**: ①canonical 커버리지 충분히 쌓임 확인 → ②`lint_index.py`로 **index.json 재빌드 필수**(status 필드 채우기 — 이거 안 하면 모든 concept이 필터에서 제외돼 **답변 0건**이 되는 함정 있음) → ③`POST /api/legal/config {answerCanonicalOnly:true}` → ④대표 질문셋으로 커버리지 확인 후 일반 노출.
- 되돌리기: `{answerCanonicalOnly:false}`로 즉시 무손실 복귀.
- 상세는 `MASTER_PLAN.md` E절, `_CHATBOT.md` 3절.

### 4-4. 신경망(graph.json)과 승급의 관계 — 자주 헷갈리는 부분
**승급(status 변경)은 본문·링크를 안 건드리므로 graph.json 재빌드가 필요 없다.** graph는 `[[링크]]`·「인용」에서 파생되는데 승급은 그걸 안 바꾼다. **재빌드가 필요한 유일한 것은 index.json**(status 색인, 가벼움). 신경망 자체의 밀도 개선(비대칭 링크갭 등)은 승급과 무관한 별개 백로그(H절 lint).

### 4-5. 모델 정책 (L-12, 이번 세션 확정)
- **fable 모델: 사용자 명시 지시 전까지 금지.**
- 검증·재판정(reverify·resolve류) = **sonnet·medium**. 부트/목록읽기 = sonnet·low 또는 haiku.
- effort는 기본 medium 이하, 정말 어려운 판정만 high.
- 전 70법 반복 패스 남발 금지 — 마커로 미완법만 추적해 재개.
- 한도/크레딧 실패는 마커를 안 남기므로 리셋 후 **미완만 자동 재개**.

### 4-5-1. 작업 스크립트별 모델 매핑표 (★2026-07-20 실측, `_dashboard/loop/*.js` grep 결과 — 코드의 진실을 문서화)
아래는 각 워크플로 스크립트가 실제로 쓰는 모델·effort다(하드코딩 확인). fable을 쓰는 스크립트는 없음(전부 sonnet으로 통일돼 있었음 — **크레딧 소진은 review_resolve·draft_reverify 최초 버전에만 fable을 썼기 때문**, 나머지 스크립트는 애초부터 sonnet이었다).

| 스크립트 | 용도 | 부트(목록읽기) | 본작업 |
|---|---|---|---|
| `audit_fix_cell.js` | 통합수정(감사gap→위키반영) | sonnet·low | sonnet·**high** |
| `audit_sim.js` | 감사(질문셋 시뮬레이션) | sonnet·low | sonnet·**high** |
| `auto_promote.js` | 1차 자동승급(비민감 draft) | sonnet·low | sonnet·**medium** |
| `collect_fix_cell.js` | DRF 재수집(원문 보강) | sonnet·low | sonnet·**high** |
| `collect_raw.js` | 원문 재수집 | sonnet·low | sonnet·**high** |
| `draft_reverify.js` | ★초안 grounding 재검증 | sonnet·low | sonnet·**medium**(원래 fable·high였다가 크레딧소진 후 교체) |
| `fix_cell.js` / `fix_wiki.js` | 위키 개별 수정 | sonnet·low | sonnet·**high** |
| `full_build.js` | 법 풀깊이 신규 빌드 | sonnet·low | sonnet·**high** |
| `lint_full.js` / `lint_xref.js` | 전수/보강 린트 | sonnet·low | sonnet·**medium** |
| `map_scope_cell.js` | 수집범위 확정 | sonnet·low | sonnet·**high** |
| `ocr_wiki.js` | 별표 이미지 OCR→위키 | sonnet·low | sonnet·**high** |
| `review_gen.js` | 리뷰 제안값 카드 생성 | sonnet·low | sonnet·**medium** |
| `review_resolve.js` | ★리뷰큐 grounding 재검증 | (그룹 자체가 부트 겸함) | sonnet·**medium**(원래 fable·high였다가 교체) |
| `shared_refs_cell.js` | 공용 타법 수집 | sonnet·low | sonnet·**high** |
| `stub_rules_cell.js` | 기술기준 스텁 전문화 | — | sonnet·**high** |
| `synth_lint.js` | 허브 lint 종합 | — | sonnet·**high** |
| `synth_scope.js` | 스코프 분류 | — | sonnet·**medium** |
| `sonnet_pilot.js` | 생성(sonnet)→심판(**opus**) 이원 | — | 생성 sonnet·high, 심판 **opus·high** |
| `byl_image_ocr_cell.js` / `tech_standard_wiki_cell.js` | 이미지OCR·기준법 위키 | — | `claude-sonnet-5`(모델ID 직접 지정) |

**패턴 요약**: 부트(목록 파싱)는 항상 `sonnet·low`. 본작업은 **원문 생성·감사·수집처럼 "새로 만들어내는" 작업 = high**, **재검증·린트·분류처럼 "판정만 하는" 작업 = medium**. **opus는 유일하게 sonnet_pilot의 "심판"(다른 에이전트 결과를 검증)에만 사용** — 가장 엄격한 판정이 필요한 자리. **fable은 애초 이 스크립트들에 없었고, 이번 세션에 review_resolve·draft_reverify를 fable로 새로 만들 때만 잠깐 썼다가 크레딧 소진 후 sonnet으로 되돌림(L-12).** 즉 "작업별 적합 모델"의 기존 확립된 관례는 **처음부터 sonnet 계열(부트=low, 판정=medium, 생성=high, 최종심판=opus)이었고, fable은 그 관례에서 벗어난 예외적 시도였다가 폐기됐다.**

### 4-6. 병렬/직렬 판단 기준 (반복 적용된 패턴)
- **병렬 안전**: 각 에이전트가 **자기 소유 파일만** 쓸 때(예: 법별 concept 파일, 법별 review_gen partial). 그룹을 잘게 쪼갤수록(예: 7법→4법) 동시성이 올라가 처리량 증가(단, 에이전트 수 총량과 크레딧 고려).
- **직렬 필수(⚠경합위험)**: review_queue.md(공유), raw/15_관련타부처(공유 타법), graph.json/comparisons(공유 허브), log.md(공유 로그). 이런 건 **여러 에이전트가 각자 판정만 반환**하고, **메인(나)이 한 곳에서 순서대로 적용**한다(예: `apply_resolutions.py`, `merge_review_gen.py`).

---

## 5. 현재 상태 스냅샷 (마지막 실측: 2026-07-20, 재검증 진행 중 — 아래 수치는 계속 갱신됨)

### 완료된 것
- 데이터층(A~D): 70법 수집·무결성검증 완료, concept 923개, 감사 5차(70/70).
- B안 관리자 검토 시스템: 서버 API + 리뷰페이지 + 앱 배선. main 머지 완료.
- 리뷰큐 자동 트리아지 1차: resolved 31 자동확정 적용됨.
- canonical 안전필터: 코드 완성, 스위치 OFF 대기.
- 서식 원본(flSeq 280개) 보존 완료.
- 인계인수 시스템(HANDOFF.md, handoff.py) 구축 완료.
- 모델정책(fable 금지, sonnet·medium) 스크립트 반영 완료.

### 진행 중 (완료 시 아래로 갱신 예정)
- **초안 재검증(draft_reverify.js)**: 70법 대상. 진행률은 커밋 로그·`_dashboard/fix3/reverify_*.done` 마커 개수로 확인(`ls _dashboard/fix3/reverify_*.done | wc -l`). **이 문서 작성 시점 기준 58/70, canonical 677, draft 222** — 계속 오르는 중. 남은 법들이 완료되면 **canonical이 최종적으로 더 크게 증가**할 것으로 예상(패턴상 법당 평균 5~10건 승급).
- 재검증이 만드는 **별표 OCR 수치카드**가 `_dashboard/review_gen/<slug>.md`에 계속 쌓이는 중 — 완료 후 `merge_review_gen.py`로 리뷰큐에 일괄 병합 필요(아직 안 함 또는 부분만 함, **재확인 필수**).

### 재검증 완료 후 반드시 실행해야 할 후속 (순서, 전부 로컬·모델 불필요)
1. `python3 _dashboard/loop/merge_review_gen.py` — 남은 OCR 수치카드 전부 리뷰큐에 병합(직렬, 이미 병합된 카드는 자동 스킵 — 멱등).
2. `python3 _dashboard/loop/lint_index.py` — index.json status 재빌드(canonical 필터 데이터 최신화).
3. `python3 _dashboard/loop/human_workload.py` — 최종 분야별 사람 검수량 재집계(아래 표는 재검증 완료 전 값이므로 **완료 후 반드시 재실행**해서 갱신할 것).
4. `needs_collect` 수집 트랙 착수(아래 6절).
5. 위 전부 끝나면 canonical 최종 수치·사람 검수 최종 수치를 사용자에게 보고.

---

## 6. 다음 할 일 (우선순위 순)

1. **[진행 중] 재검증 나머지 법 완료 대기** — 백그라운드 워크플로 완료 알림 올 때마다 커밋·마커 확인. 전부 끝나면 5절의 후속 파이프라인 실행.
2. **needs_collect 수집** — `collect_queue.json`의 `review_resolve_collect`(12건) + `holes`(86건) DRF 재수집. **⚠직렬 단독**(raw/15 공유 타법 파일 쓰기 — 경합위험). 도구: `collect_fix_cell.js` / `collect_admrul.py`(OC=hyoo1431). 수집 후 수집법만 `wiki_rebuild.js` 재빌드 → 그 법만 재검증.
3. **최종 분야별 사람 검수량 확정·보고** — `human_workload.py` 재실행 결과를 사용자에게.
4. **canonical 필터 ON 검토** — 4-3절 절차대로. canonical 수치가 충분한지(전체 concept 대비 비율) 판단 후 진행 여부 사용자와 상의(이건 사용자 답변 품질에 직접 영향이라 확인 필요할 수 있음).
5. **Phase E 답변엔진 착수** — `_CHATBOT.md` 설계대로 하이브리드 검색+되물음+다중법+점진공개. `local_server/services/legal_retriever.js`(신규 예정).
6. **Phase F 앱 UI 완성** — 관리자 목업 외 일반 사용자 노출 전환(exposure), 피드백(`_feedback`/`_candidates`) 배선.
7. **Phase G 운영** — 개정 diff 자동감지 스케줄러, 연쇄 dirty 전파(현재 미구축).
8. **H절 lint 밀도개선** — 비대칭 링크갭 1838건(2026-07-20 재빌드 시 측정치), 정의허브 공백 등. 승급과 무관한 별개 백로그.

---

## 7. 실행 방법 레퍼런스 (스크립트·인자)

- **재검증**: `Workflow(scriptPath='_dashboard/loop/draft_reverify.js', args={groupsPath, groupIndex})`. 미완법만 추리려면 python으로 임시그룹 json 생성(마커 `_dashboard/fix3/reverify_<slug>.done` 없는 법만) 후 groupsPath에 지정. **모델은 스크립트에 sonnet/medium으로 이미 반영됨 — 임의로 fable로 바꾸지 말 것.**
- **리뷰 트리아지**: `review_resolve.js`(args `{groups:{"0":[idx,...],...}}`, idx는 `pending_reviews.json` 기준) → 결과는 journal.jsonl에서 추출(알림이 잘릴 수 있음, L-10) → `apply_resolutions.py`로 직렬 적용.
- **카드 병합**: `python3 _dashboard/loop/merge_review_gen.py` (멱등, 중복 스킵).
- **index 재빌드**: `python3 _dashboard/loop/lint_index.py` (같은 스크립트가 graph.json·lint_report도 갱신).
- **사람검수 집계**: `python3 _dashboard/loop/human_workload.py`.
- **인계인수 로그**: `python3 _dashboard/loop/handoff.py start|done "제목" "내용"`.
- **법 목록**: `/tmp/.../scratchpad/all_laws.json`(70법 전체, **세션마다 scratchpad 경로가 바뀔 수 있으니 없으면 재생성 필요** — `local_server/knowledge/legal/_dashboard/scope/`나 raw 폴더 목록에서 재구성 가능). 그룹 분할 예시는 `audit7_groups.json`(10×7법).
- **git**: 브랜치 `claude/llm-wiki-maritime-legal-4f05zo`에서 작업. main 반영은 `git push origin claude/llm-wiki-maritime-legal-4f05zo:main`(fast-forward, checkout 없이 — dirty tree 문제 회피, L-11).

---

## 8. 분야별 사람 검수량 (★재검증 진행 중이라 잠정치 — 완료 후 `human_workload.py` 재실행 필수)

아래는 재검증 진행 중(58/70) 시점의 **잠정 스냅샷**이다. 최종 수치가 아니다.

| 분야 | 건수(잠정) | 성격 |
|---|---|---|
| 별표 OCR 값확정 | 66+ (계속 증가 중) | 원본 이미지/조문 대조 후 값 확정 — 진짜 사람 필요 |
| 법리·유권해석 | ~9 | 법제처 유권해석·실무 판단 |
| 판례 확인 | ~6 | 판례·해석례 필요 |
| 입법연혁(의도 vs 누락) | ~3 | 개정이유·입법공백 판단 |
| 제품설계 판단 | ~1 | 좌표매핑 등 |
| (수집대기) | ~25+12 | ※AI 수집 트랙 — 사람 몫 아님, 제외하고 집계 |
| 기타 해석 | ~22 | 재분류 필요(카테고리 세분화 여지 있음) |

**다음 세션은 반드시 `python3 _dashboard/loop/human_workload.py`를 재실행해서 위 표를 최신화한 뒤 사용자에게 보고할 것.** (사용자가 "각 분야별로 얼마나 되는지" 명시적으로 요청했음 — 3절 12번)

---

## 9. 절대 하면 안 되는 것 (체크리스트)

- [ ] fable 모델 사용 (사용자 명시 지시 없이) — **금지**
- [ ] review_queue.md·raw/15·graph.json에 여러 에이전트 동시 쓰기 — **금지, 반드시 단독 직렬**
- [ ] 별표 이미지 OCR값을 grounding 없이 canonical로 승급 — **금지, 반드시 사람 카드로**
- [ ] index.json 재빌드 없이 `answerCanonicalOnly:true` 켜기 — **답변 0건 함정, 반드시 재빌드 먼저**
- [ ] `.claude/` 디렉토리 읽기·쓰기(자율루프 규칙) — **금지**
- [ ] 사용자 승인 없이 canonical 필터를 일반 사용자에게 노출 — 확인 필요(exposure는 기본 off)
- [ ] git force-push, --no-verify, destructive 명령 — 사용자 명시 요청 없이 **금지**
- [ ] HANDOFF.md 작업 로그를 안 쓰고 진행 — **다음 계정이 맥락을 잃음, 반드시 기록**

---

## 작업 로그 (append-only · 최신이 위)
> 형식: `### [YYYY-MM-DD HH:MM KST] 🟢착수 / ✅완료 — 제목` + 무엇을·어떻게·진행률·다음.

### [2026-07-20] 🟢착수 — 초상세 인수인계서 작성 (완료 가정)
사용자 요청: 재검증 작업 완료를 가정하고, 다른 세션/다른 계정이 새 대화를 시작했을 때 읽어야 할 모든 것을 세세하게. 문서지도(각 md 내용)·세션 전체 연대기·사용자 반복강조 원칙(12개)·안전장치 상세(승급기준·트리아지·canonical필터·신경망관계·모델정책·병렬판단기준)·현재상태·다음할일·실행레퍼런스·분야별 검수량·금지체크리스트를 HANDOFF.md 최상단에 대폭 반영. 진행률: 재검증 58/70(canonical677) 시점 스냅샷. 다음: 재검증 완료 대기 → 후속 파이프라인(카드병합·index재빌드·집계) → needs_collect 수집 → canonical필터 검토.

### [2026-07-20 22:03 KST] 🟢착수 — 재검증 미완 24법 6그룹 분할 병렬 실행
4법씩 6그룹으로 쪼개 동시 launch(이전 7법×2그룹보다 병렬도 상향). sonnet/medium, fable 미사용. 각 법 자기파일만 써서 경합 없음.


### [2026-07-20 21:51 KST] ✅완료 — 자율fire(21시): 재검증 재개 대기
37/70·canonical491. 미완33법 중 2그룹 sonnet/medium 재개 in-flight. 비차단으로 완주 대기, 추가launch 자제(크레딧). 다음: 완료시 카드병합·index·나머지3그룹.


### [2026-07-20 21:49 KST] 🟢착수 — 재검증 미완 33법 재개 대기
크레딧 리셋(11:50 UTC) 후 sonnet/medium으로 draft_reverify 미완33법 재편성 실행 예정. fable 금지.


### [2026-07-20] ✅완료 — 인계인수 시스템 구축 + 모델정책 + 재검증 부분완료
- **한 일**: ①초안 재검증 10그룹 실행(canonical 240→490, 33법 크레딧 미완) ②OCR 수치카드 66 병합 ③index status 재빌드 ④모델정책(fable 금지·sonnet medium) 문서화·스크립트 반영 ⑤이 HANDOFF 시스템·`handoff.py`·CLAUDE.md 규칙 신설.
- **진행률**: 승급 대전환 ~진행중(재검증 37/70). 사람 검수 132건 확정.
- **다음**: 크레딧 리셋(11:50 UTC) 후 재검증 미완 33법 재개(sonnet/medium) → 후속 파이프라인 → 수집 트랙.
