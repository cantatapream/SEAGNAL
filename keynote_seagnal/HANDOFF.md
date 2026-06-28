# SEA:GNAL 작업 인수인계 (HANDOFF)

> 2026 해양경찰 AI 경진대회 본선 — 발표자료 · 나리 시연 · 앱 수정 · 폼보드(홍보물)
> 출품자: 제주해양경찰서 1505함 경사 신진섭 / 본선 26.7.9(목) 해양경찰청 대강당
> 이 문서는 **다른 세션에서 작업을 이어가기 위한 전체 요약**이다. (작업 디렉토리 `/home/user/SEAGNAL`)

---

## 0. 앱/프로젝트 핵심 사실 (코드 검증 완료)

- **앱 정체성**: SEA:GNAL "바다 : 그 날의 신호" — 해양정보 통합 + AI 비서 '나리'
- **문제**: 해양정보가 7개+ 공공기관에 분산(기상청·국립해양조사원·한국천문연구원·방재기상플랫폼·해양기상기후포털·해양수산부·지자체). 민간앱(윈디) 의존. 특보 시 파출소 문의 민원 반복.
- **AI 나리 작동 방식(코드 검증)**: ① 규칙으로 해역·의도 추출 → ② Gemini 2.5가 **16개 도구**(TOOL_CATALOG/TOOL_EXEC 실집계) 중 필요한 것만 자율 호출 → ③ 실데이터 수집 → ④ Gemini가 사람 말로 합성(직종 맞춤) → ⑤ 결정론적 폴백(키 없어도 실데이터). 멀티턴(history), 위치는 '내 근처' 질문 시에만 일시 서버 전송·미저장, 프로필/대화기억은 localStorage(단말).
- **연동 데이터 종류**: 특보·해상예보·해구시계열·중기예보·태풍 / 기상부이·파고부이·시정·조석물때·유향유속·수심·해무CCTV / 낚시·서핑·바다갈라짐 지수 / 위치기반.
- **운영 실적(제출 전 실값 재확인 필요)**: 2025.3.30 출시, 누적 이용자 1.5만+, 안드로이드 설치 1,351, 유지율 80.6%(주의: 코드상 '푸시 구독 유지율'이며 Play Console '설치 유지율' 아님), 특보 알림 24.8만+, 해양정보 1.1만+.

### ⚠️ 정확성 플래그 (절대 과장 금지 — 코드 미검증/미구현)
- 지식그래프 "978노드/1,232관계"·전문용어/데이터격차/선제규칙 노드 수 → **나리 덱에서 전부 제거함**(향후 계획으로만).
- "카카오 알림톡 발송", "핸즈프리 긴급신고", "443개 지점 물빠짐", "65% 절차감소/3회 터치" → 미구현/미검증 → 사용 자제 또는 향후로.
- 도구 수는 **16개**로 통일(20개 아님).
- AI 모델은 **Gemini 2.5(flash-lite)** — 'Pro' 등 과장 금지.

---

## 1. 발표 슬라이드 `keynote_seagnal/slide02_preview.html` (메인 덱, ~3.8MB·영상 base64 포함)

- 16개 상태(s0~s15) 상태머신. 좌/우 반 클릭 내비(좌=이전, 우=다음), s7 자동 건너뜀, 화살표키, 탭 하이라이트 제거.
- **배경 영상**: 해양경찰 1505함 야간 항행 영상(Veo 생성)을 base64 인라인. s1~s14 어둡게(brightness 0.5 + 오버레이 0.58), s0 톤 유지, s15(클로징) 숨김. z-index 0(콘텐츠 뒤).
- **클로징(s15)**: 일출 + 1505함 실루엣(SVG). 텍스트 "가장 복잡한 정보를 / 가장 단순한 신호로" → 손글씨 **"It's all you need"**(첨부 폰트 **White Angelica.ttf** base64 임베드, 흰색 58px, skew -8° 기울임) → "검증된 SEA:GNAL과 함께 갑시다." → 발표자 "제주해양경찰서 1505함 경사 신진섭".
- 모바일 풀스크린: PWA 메타 + 첫 탭 시 requestFullscreen + visibilitychange로 복귀 시 영상재생/풀스크린 재요청, PIP 차단.
- 카피 일관화: '흩어진/흩어져' → '분산된/분산되어'. s10 "앱 하나에 모든 바다 정보를"(마침표 제거). s14 "3단계 로드맵"(마침표 제거). s11 표 65%→재계산, "정보 획득 단계 축소".
- 브랜치: `claude/image-review-8rOWp` (발표자료 전용, 푸시됨).

## 2. 나리 소개 `keynote_seagnal/nari_intro.html` (2장, 시연 버튼용)

- **2페이지 구성**(4장에서 축소):
  - 1장: 정체성 + **4단계 흐름**(질문 → 두뇌 Gemini 2.5 → 도구 자율 호출 16개 → 맞춤 답변). 하단 연동 데이터 종류.
  - 2장: 신뢰 4박스 — 🔒위치(내 근처 질문에만 일시 사용·미저장) / 🧠대화기억 단말 / ⏱️발표주기 최신화 / 📡공식 공공데이터. (지식그래프·NEXT 박스 제거됨)
- '—' 대시 미사용. 미구현 항목 0건.
- **배포**: 시연 버튼은 `local_server/nari_intro.html`을 가로 전체화면 iframe으로 띄움.

## 3. 앱 코드 수정 (`local_server/`)

- **시연 버튼**: 관리자 AI 탭 "AI 비서" 우측 '시연' 버튼 → `nari_intro.html`을 landscape 전체화면 오버레이(ScreenOrientation 잠금, PopupStack 뒤로가기). `js/admin.js` (이미 main 병합됨).
- **직종 온보딩 재질문 수정**(`js/assistant.js`): 트리거를 `getProfile()===null` → **occupation 없으면 온보딩(skipped 제외)**. 건너뛰기는 `setProfile({skipped:true})`. 효과: 과거 빈 `{}` 프로필도 직종 다시 물어봄. (재설치/데이터삭제 후에도 안 묻던 원인 = localStorage가 안드로이드 백업으로 잔존 + 빈 `{}`가 트리거 차단)

## 4. 폼보드(홍보물) — 진행 중

### 양식: 4구획 세로 1페이지 (헤더 / 01 왜필요 / 02 무엇 / 03 어떻게 / 04 앞으로). 본청 인공지능전환팀이 디자인 → 우리는 콘텐츠+이미지 제공.

### 콘텐츠 텍스트/DOCX
- `formboard_content.md`, `formboard_content.docx` — 추천 본안(안1) + 정확성 체크리스트
- `formboard_options/formboard_안1~안10_*.docx` — 10개 방향 안
- 추천: 안1(현장공감·민원경감) 본안 + 안3(자율 에이전트)·안5(온디바이스 신뢰) 흡수

### 01 왜 필요한가 인포그래픽 (최신 = `formboard_why2.html`, 경량 CDN폰트 7KB)
3박스: ①해양 활동 인구 증가(큰 숫자 before→after) ②파편화 방사형 ③해경 부담.
- **검증 데이터(요소별 증가)**:
  - 낚시 인구: 850만(2018) → 1,000만(2024 예상) — 해양수산부
  - 수상레저 조종면허(누적): 11.1만(2011) → 28.7만(2021) — 해양경찰청
  - 해수욕장 이용객: 약 3,800만(2023) → 4,110만(2024, 개장기간·전년比 +8.2%) — 해양수산부
  - (관광객/방문객은 코로나 등락으로 '증가' 근거 부적합 → 해수욕장으로 대체함)
- 방사형: "해양정보" 중앙 + 6기관(기상청·국립해양조사원·한국천문연구원·지방자치단체·방재기상플랫폼·기타) 육각 균형. 컨테이너=SVG=노드 좌표계 460×430 고정으로 정렬.
- ⚠️ `formboard_why.html`(구버전)에는 "윈디 미연동/920만" 등 옛 문구 남아있음 — **최신은 `formboard_why2.html`**.

#### 🔧 01 미반영(다음 세션에서 적용할 사용자 요청)
1. 박스1 제목 "해양 활동 인구, 매년 증가" → **"해양 활동 인구는 매년 증가"**
2. 박스2 제목 "공공 정보**가** 여러 기관에 흩어져" → "공공 정보**는** 여러 기관에 흩어져"
3. 박스3 문구 → **"그 정보 제공은 고스란히 현장의 부담으로 작용하고 있습니다"** (+ 다음 줄 "(특보 및 기상정보 문의 민원 등)"). ※'짊어지는 중'보다 가벼운 표현 요청 → '현장의 부담'으로.

### 02 무엇을 만들었나 인포그래픽 (`formboard_what.html` — 에이전트 1차본 존재)
- 1차본: 3박스 흐름(API 통합 → AI+자체로직 → 통합 서비스) + 주요기능 6타일.
- **사용자 요청 레이아웃(미반영, 다음 세션)**: 
  ```
  [박스1] + [박스2] > [박스3]      (상단: + 와 > 로 연결)
            ↓ (큰 화살표)
  [           넓은 박스           ]  (하단: 주요 기능 나열)
  ```
  - 박스1 "공공기관 해양정보 API 통합", 박스2 "AI + 자체 개발 로직", 박스3 "통합 해양안전 서비스(채운 내용: 한 앱에서 보고·묻고·먼저 받는다)"
  - 한 줄 요약: "흩어진 공공 해양정보를 한곳에 모으고(API 통합), AI와 자체 로직으로 가공해, 누구나 쉽게 쓰는 해양안전 플랫폼으로 만들었습니다"
  - 하단 넓은 박스 주요 기능: 실시간 특보 알림 / 해양정보 시각화 / 위치기반 안전정보 / AI 비서 '나리' / 물때·조석 / 태풍 정보·행동요령

### 인포그래픽 JPG 렌더링 레시피 (재현용)
폰트 CDN이 프록시 SSL로 막혀 헤드리스 크로미움 렌더 시 Pretendard를 base64 임베드해야 함:
```bash
# /tmp/Pretendard.woff2 (없으면 재다운로드):
curl -fsSL -o /tmp/Pretendard.woff2 \
  "https://github.com/orioncactus/pretendard/raw/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"
# 임베드본 생성 + 렌더:
python3 -c "import base64;b=base64.b64encode(open('/tmp/Pretendard.woff2','rb').read()).decode();\
f='keynote_seagnal/formboard_X.html';h=open(f).read();\
L='<link href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css\" rel=\"stylesheet\">';\
open(f.replace('.html','_embed.html'),'w').write(h.replace(L,\"<style>@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,\"+b+\") format('woff2');font-weight:100 900;}</style>\"))"
/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,HEIGHT \
  --screenshot=keynote_seagnal/formboard_X.png "file://$PWD/keynote_seagnal/formboard_X_embed.html"
python3 -c "from PIL import Image;Image.open('keynote_seagnal/formboard_X.png').convert('RGB').save('keynote_seagnal/formboard_X.jpg','JPEG',quality=92)"
```
- HEIGHT는 콘텐츠 높이에 맞춰 조정(잘림 확인 후 재렌더). 채팅 전송은 **경량 CDN-폰트 HTML**로(임베드본·영상은 무겁다 → 32MB 한도 주의).

## 5. 시연 대본 (5번 = 나리, 최종본)

도입(TTS 양해) → 1 해역별 특보정보(공식 문구 형식) → 2 태풍 알림(예측=하늘색/관측=연두색) → 3 해양종합정보(VPASS 동일 구역·임의해점 종합·물빠짐) → 4 위치기반(GPS 내습·대피침로) → 5 나리.
- 나리 대본 핵심: Gemini 2.5 두뇌, **16개 도구** 자율 호출, 직종+관심해역 기억(첫 사용 시 질문), 휴대폰에만 저장, 위치는 '내 근처' 질문 시 일시 전송·미저장, 향후 지식그래프·선제알림.
- '설문'·'폴백' 문구는 제거함(정확성). 데모 스크립트 HTML은 삭제(불필요).

---

## 6. 브랜치 지도 (배포)

| 브랜치 | 용도 | 상태 |
|---|---|---|
| `claude/image-review-8rOWp` | 발표자료·나리덱·폼보드 작업(슬라이드/인포그래픽) | 활성, 푸시됨 |
| `claude/nari-intro-2page` | **시연 버튼용 나리 2장**(main 기준, `local_server/nari_intro.html`만) | 머지 대기(사용자가 머지) |
| `claude/admin-nari-demo` | 구버전(시연버튼+옛 4장) | ⚠️ 머지 금지(구버전) |
| `claude/nari-sigeon-onboarding` | 구버전(옛 4장+온보딩) | ⚠️ 머지 금지(구버전) |
| `main` | 시연 버튼(admin.js)·직종 온보딩 수정 이미 병합됨 | — |

- **배포 시 머지할 것 = `claude/nari-intro-2page`** (나리 2장). 직종 온보딩 수정은 이미 main에 있음.

---

## 7. 주요 산출물 파일 (`keynote_seagnal/`)

- `slide02_preview.html` — 메인 발표 덱(영상 포함, 3.8MB)
- `nari_intro.html` — 나리 2장(시연용 원본)
- `formboard_content.docx` / `.md` — 폼보드 콘텐츠·체크리스트
- `formboard_options/formboard_안1~10_*.docx` — 10개 안
- `formboard_why2.html` (+ .jpg) — 01 왜필요 최신 인포그래픽
- `formboard_what.html` (+ .jpg) — 02 무엇을 1차본
- `formboard_why_A/B/C.*` — 01 초기 3안(참고)
- White Angelica.ttf(클로징 손글씨)는 slide02에 base64 임베드됨. Pretendard는 `/tmp/Pretendard.woff2`.

## 8. 다음 세션 To-Do (우선순위)

1. **02 무엇을 만들었나** 레이아웃 재구성(A+B>C → ↓ → 넓은 박스 + 주요기능) 후 JPG.
2. **01 왜필요(`formboard_why2.html`)** 문구 3건 반영(는/는/현장의 부담) 후 JPG.
3. 03 어떻게 보이나 / 04 앞으로는 인포그래픽 제작(앱 스크린샷은 `local_server/assets/screenshots_upload/`).
4. 폼보드 운영 실적 수치 **실값·기준일 확정**(특히 유지율 지표 정의).
5. `claude/nari-intro-2page` 배포 머지(사용자). 구버전 2개 브랜치 정리.

---
(본 인수인계는 콘텐츠 시안·작업 상태 요약. 공식 제출 전 수치·표현은 재검증 필요.)
