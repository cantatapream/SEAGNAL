# 나리야 AI 챗봇 — 앱 UI 구현 계획 (사용자 요구 원장)

> 목적: 2026-07-20 세션에서 사용자가 구두로 요구한 "AI 챗봇 탭 + 방(Room) 인터페이스 + 관리자 리뷰 승인 연계 + 노출 토글 + 카톡형 대화창" 요구사항을 **누락 없이** 기록한다. 세션 대화가 길어져 컨텍스트가 롤오버돼도 이 문서만 읽으면 전체 요구가 복원되도록 한다.
> **상태: 설계안 텍스트 제시 → 사용자 승인 → HTML 목업 구현** 순서(사용자 확정). 승인 전 HTML 구현 착수 금지.
> ⚠ 이 문서는 추가·갱신만 한다(삭제·재작성 금지). 새 요구가 나오면 아래 "요구 항목"에 이어 붙인다.

---

## A. 사용자 요구 항목 (원문 취지 그대로, 번호는 안정 식별자)

### R1. AI 챗봇 탭 — 방(Room) 선택 = **버튼식**(드롭다운 아님)
- AI 챗봇 탭에 들어가면 지식베이스의 각 "방"이 있고, 각 방을 **버튼**으로 선택한다(드롭다운 금지).
- 방 = 지식베이스의 성격별 분류(원문/위키/비교허브/리뷰/그래프 등). §D 참조.

### R2. 방 버튼의 **N 뱃지**(공지 N 뱃지와 동일 방식)
- 새 정보가 들어오거나(신규 수집), 사용자(관리자)가 검토해야 할 것이 생기면, 그 방 버튼 **우측 상단**에 뱃지가 붙는다.
- 뱃지는 앱 메인 공지사항에 새 공지가 올라올 때 붙는 영문 "N"(new) 뱃지와 **동일한 스타일·위치 방식**을 재사용한다.
- 버튼만 보고도 "이 방에 새 게 등록됐다"를 알 수 있어야 한다.

### R3. 방 버튼 클릭 → 그 방 성격에 맞는 **리스트업**
- 버튼을 누르면 그 방이 가진 항목이 방 성격에 맞는 목록으로 내부에 리스트업된다.
- **RAW(원문) 방 예시**: 누르면 그 방이 가진 **모든 원문 파일을 법령별로** 보여준다.
  - **아코디언 형식**: 법령별로 접힌 아코디언이 쭉 나열, 누르면 아래로 펼쳐지며 그 원문을 스크롤로 본다.
  - 아코디언 **제목 옆에 시행일자**(가장 최신 개정이 언제였는지) 표기.
  - 원문뿐 아니라 그 안의 **별표·별지(별표)까지 함께 확인·다운로드** 가능해야 한다.
  - 요컨대 원문도 확인하고 내용도 확인하고 별표/별지도 확인·다운로드하는 기능이 반영.

### R4. 리뷰(관리자 검토) 방 — **승인 → 자동 반영 연계**
- 관리자가 리뷰해야 하는 항목(⚠REVIEW·review-pending)의 **실제 리뷰 목록**이 반영돼 있어야 한다.
- 관리자가 리뷰 건을 **승인**하면, 그 승인한 건이 **자동으로 연계되어 위키에 반영**(draft/review-pending → canonical 승격)되도록 한다.
- (근거: H-12② 승인 이원화 — AI 자체승격 금지, 처벌·안전·REVIEW 값은 사람 승인 게이트. §E 참조.)

### R5. 지금은 **틀(프레임워크)만** — 자율점검 기능은 설계 전
- 자율적으로 점검하는 기능(자율 감사/린트 등)은 아직 앱 관점 설계를 하지 않았으니 지금 구현하지 않는다.
- 다만 그 **틀 자체는 앱 내부에 만들어져** 있어야 한다(자리·골격 확보).

### R6. 기존 앱 **스타일과 어우러지게**
- 기존 앱에 반영된 스타일·요소(색·폰트·탭바·카드·뱃지·버튼)를 분석해 잘 어우러지게 만든다.

### R7. 관리자 센터 **노출 토글(3-state)**
- 관리자 센터에 AI 챗봇 탭을 **①사용자 노출 / ②관리자 전용 / ③미표출** 중 무엇으로 할지 선택하는 버튼을 둔다.
- **지금은 테스트 버전 → 기본값 "관리자 전용"**(사용자에게 노출 금지). 관리자만 관리.
- 여기서 "노출"의 의미(R8) = 메인 화면의 챗봇 진입 버튼 노출 여부.

### R8. 메인 화면 **우측 하단 원형 AI 버튼** → **카톡형 팝업 대화창**
- (노출 시) 메인 화면 우측 하단에 작고 동그란 AI 챗봇 버튼을 둔다.
- 누르면 팝업창이 켜지며 **카카오톡 대화창처럼** 대화가 이어진다.
- 테스트 중이라 지금 당장 노출되면 안 되므로 R7 토글로 잠근다.

### R9. 대화창 **실시간 사고 과정 표시 + 스켈레톤**
- 사용자가 질문하면 AI가 사고하는 과정을, 지금 무엇을 하고 있는지 실시간으로 보여준다.
  - 예: "생각하고 있습니다…", "구조를 확인하고 있습니다…", "관련 법령을 찾고 있습니다…" 등 단계별 상태 문구.
- 목적: 사용자가 답답함을 느끼지 않도록.
- 생성 중 말풍선은 **스켈레톤 형식**(지금 생성 중이라는 시각적 느낌)으로 표시.

### R10. 진행 절차(사용자 확정)
- ① 구조를 **텍스트로 설명** → ② 구조별 내용 설명 → ③ **사용자 승인** → ④ 그 다음에 **HTML 목업 구현**.
- 승인 전 HTML 착수 금지.

### R11. 전수 대조 확인
- 대화 처음부터 지금까지의 내역 + 각종 마크다운(로드맵·MASTER_PLAN·_CHATBOT·_SCHEMA·README·MEMORY)을 **누락 없이** 확인해, 내가 요구한 사항이 챗봇 AI UI에 제대로 녹아 있는지 검증한다.

---

## B. 진행 절차 규칙 (R10 상세)
1. 설계안은 **채팅 텍스트**로 먼저 제시(구조 → 구조별 내용).
2. 사용자 **명시 승인** 후에만 HTML 목업 파일 생성.
3. HTML 목업은 **client/ 하위(앱 프런트)** 에만 만든다 — 지식베이스(`local_server/knowledge/legal/`)와 파일 분리(경합 없음).
4. 지금 구현 대상 = **구현 가능한 부분 + 골격**. 자율점검 로직(R5)은 자리만.

---

## C. 앱 스타일 그라운딩 (기존 앱과 어우러지도록 — R6) — 2026-07-20 프런트 분석 확정
> 테마: "Premium Midnight Blue" 다크·모바일 우선. 목업은 **`client/style.css` 토큰**을 따른다(assistant.html 프로토타입 팔레트 아님).
- **메인 HTML 셸**: `client/index2.html`(5,581줄, 페이지 CSS 상당수 인라인 `<style>` + 공용 `client/style.css`). 앱 컨테이너 `.app-container` `max-width:600px` 중앙정렬.
- **탭바**: 하단 고정 `nav#bottom-tab-bar.main-tabs.bottom-main-tabs`. 현재 4탭(**특보정보 / 해양종합정보 / 해양생활 / 공지사항**), AI 탭 없음. 버튼 = 아이콘(fa-solid) 위 라벨. 전환 = `window.switchMainTab(targetId)`(core/index2_patch.js 268행 래핑), `body[data-active-tab]` + `.tab-content.active` 토글. 높이 `--main-tab-height:68px`. z-index 60.
  - **AI 탭 추가법**: `#bottom-tab-bar`에 `<button class="tab-btn" data-target="ai-chat-section"><i class="fa-solid fa-robot tab-btn-icon"></i><span class="tab-btn-label">AI 챗봇</span></button>` + `<section id="ai-chat-section" class="tab-content">` 추가 후 switchMainTab로 연결.
- **디자인 토큰**(`client/style.css` :root 24–60행):
  - 배경 그라디언트 `--bg-grad-start:#080a0f · --bg-grad-mid:#1c2640 · --bg-grad-end:#080a0f`, body `#0a101f`.
  - 카드 `--card-bg:#161b2d` / hover `#1f263b` / 섹션 `#111525` / 섹션헤더 `#1a2238`. 헤더 글래스 `rgba(15,20,35,0.85)`.
  - 텍스트 `--text-main:#fff` / `--text-sub:#94a3b8`.
  - **액센트(주 인터랙션 = 파랑) `--accent-blue:#448aff`**, 위험 `--accent-red:#ff5252`, 성공 `--accent-green:#69f0ae`, 경고 `--accent-yellow:#ffd740`.
  - 보더 `rgba(255,255,255,0.1)`. 폰트 `'Inter','Noto Sans KR',sans-serif`(+브랜딩 Nanum Pen Script, 숫자 Roboto Mono). 라운드 6/8/10–12/20(pill)px. 그림자 `--shadow-soft/-card`. 아이콘 Font Awesome(self-host).
- **공지 "N" 뱃지(R2 재사용 원천)** — `client/style.css` `.new-badge`(3868행~) + `client/js/notice/board/promo.js`(209–252행):
  - CSS: `background:linear-gradient(135deg,#ff6b6b,#f03e3e); color:#fff; font:800 10px Inter; border-radius:6px; padding:0 4px; height:16px; min-width:16px; margin-left:4px; box-shadow:0 2px 4px rgba(240,62,62,.4); animation:badgePulse 2s infinite;` (@keyframes badgePulse: scale 1→1.05 + 링 확산).
  - HTML: `<span class="new-badge">N</span>`.
  - JS 패턴(방 버튼에 그대로): `btn.querySelector('.new-badge')?.remove(); if(hasNew[room]){const b=document.createElement('span');b.className='new-badge';b.textContent='N';btn.appendChild(b);}` — **2행 탭 버튼은 `.tab-btn-label` 안에 append**(안 그러면 3번째 flex 컬럼 되어 깨짐), pill 버튼은 직접 append. CSS-only 변형 `.tphn-n-badge`(::after content:'N')도 존재.
- **방 선택 버튼 = pill(`.promo-tab-btn`) 재사용**(R1): `.promo-tabs`(가로 스크롤 flex, gap 8px) 안에 `.promo-tab-btn`(padding 8/16, radius 20, 비활성 `rgba(255,255,255,.05)`/`#94a3b8`, 활성 `rgba(68,138,255,.2)`+`#448aff`). **공지에서 이미 이 pill에 N뱃지가 붙어 있음** → R2 그대로 이식.
- **아코디언(R3 원문 리스트)** = `.sea-section`/`.sea-header`/`.alert-list`(style.css 305–395) 또는 리치형 `.main-accordion-header/body`(1080–1300, radius 12). 토글 = `.open` 클래스 → `max-height` 트랜지션 + chevron 180° 회전. 상태 그라디언트 변형(alert/safe/marine/slate) 있음.
- **버튼**: `.admin-btn`(radius 6) + `.btn-save`(#2563eb 주)/`.btn-delete`(#dc2626)/`.btn-cancel`(#475569). 아이콘버튼 36px/radius 8. 카운트칩 `.count-badge`(주황 그라디언트, `.zero` 변형).
- **모달**: `.modal`(inset 0, `rgba(0,0,0,.7)`)/`.modal-content`(card-bg, radius 12, max 500px/90%)/`.modal-header`/`.modal-close`. **z-index 사다리**: 탭 60 < 팝업/모달 999–1000 < 관리자 10000 < 시스템경보 40000. 새 오버레이는 60 위.
- **반응형**: viewport `viewport-fit=cover`, 안전영역 `env(safe-area-inset-bottom)`, 브레이크포인트 768/480px, `clamp()` 유동 타이포, Capacitor 안드로이드 WebView.
- **기존 나리야(주의)**: `client/assistant.html`+`client/js/assistant/*`에 **음성비서 나리야 프로토타입**이 별도 존재(웨이크워드 STT/TTS, `/api/assistant/ask|tts|transcribe|style-digest`, on-device `window.SeagnalMemory`). **단, 자체 팔레트(청록 #38bdf8)를 써서 메인 앱과 안 맞음** → 목업은 메인 style.css 토큰을 따를 것. 답변 출처칩 `.badge.ai`("AI") 존재. deeplink(`assistant_deeplink.js`)로 답변→앱내 이동.

---

## D. 방(Room) 택소노미 — 실제 디스크 기준 (2026-07-20 확인)
> 기존 기획: `_dashboard/STATUS_ROOMS_PLAN.md`(10 방, 다수 골격). 아래는 물리적 실재+실카운트.

| 방 | 실재 | 위치 | 실카운트 | 성격 |
|---|---|---|---|---|
| **RAW 원문** | ✅ | `raw/` | 15도메인·**7,203 txt** | 법령센터 원문(불변). 법률/시행령/시행규칙/부칙/별표/행정규칙(고시). |
| **위키 개념** | ✅ | `wiki/concepts/` | **919 md** | 챗봇 답변 근거 개념 페이지. |
| **법령 페이지** | ✅ | `wiki/statutes/` | **73 md** | 법별 허브(70 기본법 + 교차참조 몇). |
| **비교허브** | ✅ | `wiki/comparisons/` | **26 md** | 교차법 비교(형사절차·음주운항·폐기물 등). |
| **별표/서식** | ✅ | `wiki/annexes/` | **98 md** | 별표·서식 정리본. |
| **리뷰 대기** | ✅ | §E | **99 큐 + 77 review-pending + 369 ⚠REVIEW 파일** | 사람 승인 게이트. |
| **지식그래프** | ✅ | `wiki/graph.json` | 1 (노드=법, 엣지=인용/링크) | 신경망 시각화. |
| **수집대기(관리자)** | ✅ | `_dashboard/collect_queue.json` | holes 목록 | 재수집 대상(공개방 아님). |

- **시행일 출처(R3)**: 법 단위 = `raw/<도메인>/<법>/_meta.json`의 `시행일`(YYYYMMDD). 조문 단위 = 각 txt 헤더 `(시행 YYYYMMDD · 제정/일부개정)` — 정규식 `\(시행\s*(\d{8})\s*·\s*([^)]+)\)`. **법률/시행령/시행규칙 각각 시행일이 다름** → 아코디언은 파일별 시행일 표기.
- **별표 다운로드(R3)**: `raw/<법>/별표/_links.json` → 별표별 `HWP`·`이미지` 실제 다운로드 URL(law.go.kr flDownload). 인앱 미리보기는 `별표/*.txt`. 이미지 고시는 `행정규칙/_이미지/<id>.png`(+OCR `.txt`).

---

## E. 리뷰 승인 → 자동 반영 메커니즘 (R4 근거·설계) — MASTER_PLAN Phase F / _SCHEMA §5 / H-12②·H-16
### E-0. 2상태 모델(_SCHEMA §5)
- `canonical` = 승인됨, **챗봇 인용 가능**. `draft` = 사서작성·미승인, **챗봇 인용 금지**. `review-pending` = REVIEW 플래그, 사람승인 대기.
- **승인 이원화(H-12②)**: 처벌·과태료·형량·금액·안전수치·⚠REVIEW **없는** 순수 정의/절차/서술 페이지 → AI 자체 draft→canonical 승격 허용(감사통과+변경이력 근거). 이 값들을 **포함**하면 → **Phase F 관리자 검증 UI 승인 필수**(AI 자체승격 금지).
- **H-16 소급 완료**: 처벌·안전·REVIEW 포함 canonical **83개를 review-pending으로 소급 강등**(챗봇 인용 차단, 관리자 승인 대기). 순수 좌표/주파수/인증 참조표 **8개만 canonical** 잔존.

### E-1. 관리자 검토 센터 = 1탭 + 5 서브탭(사용자 확정, UI만 통합·데이터 방은 분리)
5개 리뷰 스트림이 **같은 게이트**(관리자 검토→승인/반려→위키 반영)를 공유하므로 UI는 한 탭에 통합, 데이터 폴더는 분리 유지:
1. **초안승인**(`draft` 842) 2. **피드백처리**(`_feedback` 👍/👎) 3. **새지식후보**(`_candidates`) 4. **개정검토**(`_amendments`) 5. **⚠수치검증**(REVIEW 큐).

### E-2. 리뷰 목록 원천(열거 대상)
- **정본 목록**: `_dashboard/review_queue.md` — "승인 대기(REVIEW)" **99건**, `### REVIEW-<법>-NN:` + 대상 위키페이지 + 근거(감사 리포트) + `- 승인: [ ] 대기` 체크박스.
- **⚠수치검증 큐**(Phase F 핵심): 별표 이미지 판독 수치 **408건** + 조번호재편 **35건** 등, `_이미지/<id>.png`(원본)·`<id>.txt`(AI추출)·`【이미지판독 N】(⚠REVIEW)` 집계. 리스트 항목 = {법·별표번호, ①원본이미지, ②AI추출, 승인/반려, REVIEW사유}. 항목 클릭 → **원본이미지 vs AI추출 나란히**, 이미지 클릭 → 전체화면 핀치줌 + 국가법령정보센터 출처링크(`flDownload.do?flSeq=<id>`)+조문위치.
- **보조 신호(뱃지용)**: frontmatter `status:` draft 842 / review-pending 77 / canonical. 인라인 `⚠REVIEW` 369파일·`편입예정` 75파일. H-15 소관부서 `⚠REVIEW(출처미확인)` 113+파일. H-17 타법연결 미링크(전수린트로 대부분 해소).

### E-3. **승인 시 자동 전파 체인(R4 핵심)** — Phase F/G DoD
관리자가 한 건 승인 → 아래가 자동으로 흐른다:
1. `review_queue.md` 해당 항목 `- 승인: [x] (관리자, YYYY-MM-DD)` 마킹.
2. ⚠수치 승인이면 **값 확정·플래그 해제**(반려면 재OCR/수정 큐로). 페이지 승격이면 frontmatter `status: review-pending → canonical`(+변경이력 근거).
3. 인라인 `⚠REVIEW` → "사람승인 <날짜>" 주석 치환.
4. **승인분만 main 머지**(특히 처벌·금액) → **임베딩 재생성 + 검색/그래프 인덱스 자동 재빌드** → 챗봇 인용 가능.
5. (H-8 연동) 그 값에 의존해 **채점 보류(review_pending)**했던 감사 질문들이 승인 후 감사에 재편입됨.
- **승인 이력 보존**. ⚠경합위험: `review_queue.md`·공유 인덱스 동시쓰기면 단독 처리(병렬 금지).

---

## F. 대화창 동작 (R8·R9 설계)
- 진입: 메인 우측 하단 원형 버튼(노출 토글 R7이 허용할 때만 표시) → 카톡형 팝업.
- 사고 과정: 답변 생성 전/중 하단에 단계 상태 문구 스트리밍("구조를 확인하고 있습니다…" 등). 생성 말풍선 = 스켈레톤.
- 리트리버(근거): 멀티홉 그래프 순회 + 점진공개(통상 1차 → 되물음 → 확장). (MASTER_PLAN H-4/H-3.)

---

## G. 미해결/승인 대기
- [ ] C절 앱 스타일 토큰·공지 N 뱃지 마크업 확정(프런트 분석 반영)
- [ ] 설계안 텍스트 최종본 제시 후 **사용자 승인**(R10) → HTML 목업 착수
- [ ] 승인 반영 자동화(E절 ②③④)의 서버 연계 방식 확정(지금은 UI 골격만)

## H. 승인·수정 이력
- 2026-07-20: **1화면 목업 스타일 사용자 승인**("이런 식으로 만들면 될 것 같고"). client/mockups/ai_chat_rooms.html.
  - 수정 R6-a: **원문 아코디언 법명 왼쪽 아이콘(⚓🚢 등) 제거**(사용자 요청). 이후 화면들도 법명 앞 아이콘 없이 텍스트로.
- 다음 화면(승인된 스타일로 이어감): D 카톡 대화창(사고과정+스켈레톤) → B 관리자 검토센터(5서브탭+승인연계) → C 노출토글.
