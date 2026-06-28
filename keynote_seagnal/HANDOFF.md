# SEA:GNAL 작업 인수인계 (완전판 · 코드 포함)

> 2026 해양경찰 AI 경진대회 본선 출품작 **SEA:GNAL("바다 : 그 날의 신호")**
> 출품자: 제주해양경찰서 1505함 경사 신진섭 · 본선 26.7.9(목) 해양경찰청 대강당
> 작업 디렉토리: `/home/user/SEAGNAL` · 본 문서는 **새 세션에서 그대로 이어가기 위한 전체 기록(코드 포함)**.

## 어떻게 이어서 작업하나
1. 새 대화 세션에서 이 `HANDOFF.md`를 첨부하고 "이 인수인계 기준으로 이어서 작업하자"라고 시작.
2. 모든 코드/산출물은 git 브랜치에 있음 → 아래 §5 브랜치 지도 참고.
3. 인포그래픽 JPG 렌더가 필요하면 §4의 '렌더링 레시피' 사용(Pretendard base64 임베드 → chromium headless).

## 목차
1. 발표 슬라이드 (slide02_preview.html) — 구조·CSS·HTML·JS 전체
2. AI 비서 나리 소개 덱 (nari_intro.html) — 전체 코드
3. 앱 코드 수정 (local_server/) — 시연 버튼·직종 온보딩·나리 동작 코드
4. 폼보드(홍보물) — 콘텐츠·10안·01/02 인포그래픽 코드·데이터·렌더링
5. 시연 대본 · 정확성 검증 · 브랜치 지도 · 다음 작업(To-Do)

---
## 1. 발표 슬라이드 (slide02_preview.html)

### 1.1 개요

발표 메인 덱. 단일 HTML 파일(`/home/user/SEAGNAL/keynote_seagnal/slide02_preview.html`, 약 3.82MB / 1,306줄)에 모든 리소스가 base64로 인라인되어 오프라인·단일파일로 완전히 동작한다. 1920×1080 고정 스테이지를 화면 크기에 맞춰 `transform: scale()`로 축소(`fit()`)하는 키노트형 상태머신이다.

- 폰트: Pretendard(CDN), 클로징 손글씨용 White Angelica(`@font-face`로 base64 TTF 임베드, ~40,180 bytes).
- 배경: 바다 영상(`#bg-sea-video`, base64 MP4 ~2,797,612 bytes)을 전 슬라이드 배경으로 깔고, 솔루션/앱 화면 splash JPEG(`#ap-splash`, base64 ~870KB)를 s10 폰 목업에 표시.
- 메타: `viewport-fit=cover`, `apple-mobile-web-app-capable`, `theme-color #000` 등 홈화면 추가 시 주소창 없는 풀스크린 PWA 실행을 위한 헤더 포함(라인 1–13).

### 1.2 전체 구조 — 16개 상태(s0~s15)

상태는 `#wrap`의 클래스(`.s0`~`.s15`)로 표현되며, JS `setState(n)`가 클래스를 교체한다. 각 상태의 의미(JS `labels` 배열, `slide02_preview.html:988` 기준):

| 상태 | 클래스 | 라벨 / 내용 |
|---|---|---|
| s0 | `.s0` | 타이틀 — SEA:GNAL 로고, "바다 : 그 날의 신호", 발표자 |
| s1 | `.s1` | 좌측 강조·어르신 민원 (카톡 패널 선명 / 동료 패널 블러 + 우측 오버레이) |
| s2 | `.s2` | 우측 강조·동료 대화 (동료 패널 선명 / 카톡 블러 + 좌측 오버레이) |
| s3 | `.s3` | 결론·출발점 ("이 작은 불편함이 SEA:GNAL의 출발점") |
| s4 | `.s4` | 흩어져 있는 정보들 (분자형 7출처 그래프, 선명) |
| s5 | `.s5` | 단계① 수요(세로) — 그래프 블러배경 + 어업인/낚시인/관광객 카운트업 |
| s6 | `.s6` | 단계② 신호 정리 안 됨·낙수 흐름 |
| s7 | `.s7` | 단계③ 7개+ 기관·민간앱 의존 (압축 문제 밴드) — **네비게이션에서 자동 건너뜀** |
| s8 | `.s8` | "그래서 만들었습니다" (가운데 크게) — 0.5초 후 자동으로 s9 |
| s9 | `.s9` | 두 가지 원칙 (한 앱에 / 3회 터치 이내) 좌·우 카드 |
| s10 | `.s10` | 한 앱에, 모든 바다 정보 (폰 목업 + 떠다니는 기능 칩) |
| s11 | `.s11` | 정보 획득 단계 축소 (9행 비교표 + 평균 -65% 카운트업) |
| s12 | `.s12` | 시연 안내 ("지금부터 주요 기능을 시연하겠습니다") |
| s13 | `.s13` | 이미 운영 중 (Traction — 3개월/1개월 지표 + 사용자 후기) |
| s14 | `.s14` | 추진계획 (단기·중기·장기 3단계 로드맵) |
| s15 | `.s15` | 클로징 (일출 + "가장 복잡한 정보를 / 가장 단순한 신호로" + It's all you need) |

> 주의: 라벨 인덱스상 s7이 "단계③ 7개+·민간 압축"이고 s8이 "그래서 만들었습니다"인데, CSS에서는 s6에 problem-band가 크게 등장(`#wrap.s6 #problem-band`)하고 s7에서 축소되는 구조다(아래 CSS 참조). 네비게이션은 s6→s8로 건너뛴다(`nextState`가 `n===7`이면 8로 점프).

### 1.3 `<style>` 전체 CSS

base64 폰트만 생략 표기. 그 외 전부 포함(`slide02_preview.html:14–507`).

```css
<style>
  @font-face{font-family:'White Angelica';src:url(data:font/ttf;base64,…(base64 생략, ~40,180 bytes 폰트)…) format('truetype');font-display:swap;}

  html,body{margin:0;padding:0;background:#000;font-family:'Pretendard',sans-serif;-webkit-font-smoothing:antialiased;color:#fff;overflow:hidden;height:100%;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}
  *:focus{outline:none;}
  #wrap, #wrap *{-webkit-tap-highlight-color:transparent;}
  *{box-sizing:border-box;}
  #stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;}
  #wrap{position:relative;width:1920px;height:1080px;flex:none;transform-origin:center center;background:#000;overflow:hidden;cursor:pointer;}

  /* ===== 배경 영상 (s0~s14, s15에서 숨김) ===== */
  #bg-sea-video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;
    filter:brightness(0.5) saturate(0.75) blur(0px);transition:opacity 0.7s ease;}
  /* z-index:0 으로 콘텐츠(z:auto) 아래에 깔리도록 */
  #bg-sea-overlay{position:absolute;inset:0;z-index:0;background:rgba(0,0,0,0.4);pointer-events:none;transition:background 0.6s ease, opacity 0.7s ease;}
  /* s0(타이틀)은 현재 톤 유지, s1 이후는 함정·파도가 차분히 비치는 톤 */
  #wrap:not(.s0) #bg-sea-overlay{background:rgba(0,0,0,0.58);}
  #wrap:not(.s0) #bg-sea-video{filter:brightness(0.5) saturate(0.7) blur(0px);}
  #wrap.s15 #bg-sea-video,#wrap.s15 #bg-sea-overlay{opacity:0;}

  /* --- TITLE SLIDE (state 0) --- */
  #title{position:absolute;inset:0;background:transparent;z-index:100;display:flex;flex-direction:column;justify-content:center;padding-left:120px;padding-right:120px;transition:opacity 0.7s ease,transform 0.7s ease;}
  #title .tchap{color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;position:absolute;top:96px;left:120px;}
  #title .logo{color:#FFFFFF;font-size:147px;font-weight:700;letter-spacing:-0.04em;line-height:1;margin-top:-40px;}
  #title .taccent{width:80px;height:6px;background:#FF6B35;margin-top:36px;}
  #title .ttitle{color:#FFFFFF;font-size:64px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;margin-top:32px;}
  #title .tsub{color:rgba(255,255,255,0.65);font-size:32px;font-weight:300;letter-spacing:-0.01em;line-height:1.3;margin-top:18px;}
  #title .tfoot{position:absolute;left:120px;bottom:60px;color:rgba(255,255,255,0.5);font-size:20px;font-weight:500;letter-spacing:0.04em;}
  #title .tpresenter{position:absolute;right:120px;bottom:54px;color:#fff;font-size:33px;font-weight:600;letter-spacing:-0.005em;line-height:1.35;text-align:right;}
  @keyframes pulse{0%,100%{opacity:1;}50%{opacity:0.55;}}
  #wrap:not(.s0) #title{opacity:0;transform:scale(0.96);pointer-events:none;}

  /* --- HEADER (states 1+) --- */
  .chap{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease;}
  .headline{position:absolute;left:120px;top:140px;width:1680px;color:#FFFFFF;font-size:56px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;opacity:0;transition:opacity 0.7s ease 0.1s;}
  .headline .em{color:#FF6B35;}
  .accent{position:absolute;left:120px;top:260px;width:80px;height:6px;background:#FF6B35;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.4s,opacity 0.4s ease 0.4s;}

  #wrap.s1 .chap, #wrap.s2 .chap, #wrap.s3 .chap{opacity:1;}
  #wrap.s1 .headline, #wrap.s2 .headline, #wrap.s3 .headline{opacity:1;}
  #wrap.s1 .accent, #wrap.s2 .accent, #wrap.s3 .accent{opacity:1;transform:scaleX(1);}

  /* --- PANELS --- */
  .panel{position:absolute;opacity:0;transform:translateY(24px);transition:opacity 0.7s ease,transform 0.7s ease,filter 0.6s ease;will-change:filter,opacity;}
  #wrap.s1 .panel, #wrap.s2 .panel, #wrap.s3 .panel{opacity:1;transform:translateY(0);}

  /* Blur states */
  #wrap.s1 #coworker{filter:blur(5px) grayscale(0.5);opacity:0.62;}
  #wrap.s2 #kakao{filter:blur(5px) grayscale(0.5);opacity:0.62;}
  #wrap.s3 #kakao, #wrap.s3 #coworker{filter:blur(8px) grayscale(0.85);opacity:0.28;}

  /* LEFT: KakaoTalk */
  #kakao{left:120px;top:310px;width:780px;height:740px;background:#a4b8c5;border-radius:18px;padding:22px 22px;overflow:hidden;}
  .kheader{display:flex;align-items:center;justify-content:space-between;padding-bottom:10px;border-bottom:1px solid rgba(0,0,0,0.1);margin-bottom:14px;}
  .kheader .name{color:#000;font-size:26px;font-weight:600;letter-spacing:-0.005em;}
  .kheader .meta{color:rgba(0,0,0,0.5);font-size:18px;font-weight:400;}
  .msg{display:flex;align-items:flex-end;margin-bottom:10px;gap:8px;}
  .msg.theirs{justify-content:flex-start;}
  .msg.mine{justify-content:flex-end;}
  .avatar{width:52px;height:52px;border-radius:50%;background:#FFD180;color:#5D4037;display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;flex-shrink:0;}
  .col{display:flex;flex-direction:column;max-width:520px;}
  .col .who{font-size:18px;color:#444;margin-bottom:3px;}
  .bubble{padding:15px 19px;border-radius:18px;font-size:26px;line-height:1.35;font-weight:400;}
  @keyframes pulseScale{0%,100%{transform:scale(1);}50%{transform:scale(1.08);}}
  .pulse{display:inline-block;animation:pulseScale 1s ease-in-out infinite;transform-origin:center center;}
  /* 채팅 말풍선 강조 — 패널이 명확한 상태일 때만 펄스 */
  .pulse-kakao,.pulse-coworker{display:inline-block;transform-origin:center center;}
  #wrap.s1 .pulse-kakao{animation:pulseScale 1s ease-in-out infinite;}
  #wrap.s2 .pulse-coworker{animation:pulseScale 1s ease-in-out infinite;}
  .theirs .bubble{background:#fff;color:#000;border-top-left-radius:6px;}
  .mine .bubble{background:#FFEB33;color:#000;border-top-right-radius:6px;}
  .time{font-size:14px;color:rgba(0,0,0,0.4);align-self:flex-end;margin:0 4px 3px;}

  /* RIGHT: Coworker */
  #coworker{left:1020px;top:310px;width:780px;height:740px;border-radius:18px;border:1px solid rgba(255,255,255,0.3);padding:24px 22px;background:rgba(255,255,255,0.08);overflow:hidden;}
  .cheader{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid rgba(255,255,255,0.1);margin-bottom:24px;}
  .cheader .scene{color:rgba(255,255,255,0.85);font-size:27px;letter-spacing:0.12em;font-weight:500;}
  .cheader .meta{color:rgba(255,255,255,0.4);font-size:21px;}
  .stage-area{position:relative;height:640px;}
  .person{position:absolute;width:120px;text-align:center;}
  .person .head{width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,0.06);border:2px solid rgba(255,255,255,0.2);display:flex;align-items:center;justify-content:center;font-size:70px;}
  .person .body{width:100px;height:40px;background:rgba(255,255,255,0.04);border:2px solid rgba(255,255,255,0.18);border-bottom:none;border-radius:60px 60px 0 0;margin:6px auto 0;}
  .person .label{color:rgba(255,255,255,0.55);font-size:22px;margin-top:10px;letter-spacing:0.04em;}
  .person.left{left:10px;top:30px;}
  .person.right{right:10px;top:30px;}
  .pbubble{position:absolute;background:#fff;color:#000;padding:18px 22px;border-radius:18px;font-size:30px;line-height:1.4;max-width:480px;box-shadow:0 6px 18px rgba(0,0,0,0.3);font-weight:400;}
  .pbubble .who{display:block;font-size:18px;color:#888;margin-bottom:6px;letter-spacing:0.04em;}
  .pbubble.fl{border-top-left-radius:4px;}
  .pbubble.fl::before{content:'';position:absolute;left:-9px;top:18px;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-right:11px solid #fff;}
  .pbubble.fr{border-top-right-radius:4px;}
  #pb3{font-size:36px;line-height:1.35;max-width:560px;font-weight:500;white-space:nowrap;}
  #pb3 b{font-weight:700;}

  .pbubble.fr::before{content:'';position:absolute;right:-9px;top:18px;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:11px solid #fff;}
  #pb1{left:170px;top:0px;}
  #pb2{right:170px;top:135px;}
  #pb3{left:170px;top:280px;}
  #pb4{right:170px;top:420px;}
  .pbubble .thought{display:block;font-size:21px;color:rgba(0,0,0,0.5);font-style:italic;margin-top:8px;letter-spacing:-0.005em;}

  /* --- OVERLAY TEXT ON BLURRED PANELS --- */
  .panel-overlay{position:absolute;display:flex;align-items:center;justify-content:center;text-align:center;border-radius:18px;background:rgba(0,0,0,0.55);color:#FFFFFF;font-size:50px;font-weight:600;line-height:1.6;letter-spacing:-0.02em;padding:40px;opacity:0;pointer-events:none;transition:opacity 0.6s ease 0.4s;z-index:15;}
  .panel-overlay .em{color:#FF6B35;}
  .panel-overlay .ln{display:block;}
  .panel-overlay .ln + .ln{margin-top:14px;}

  #overlay-right{left:1020px;top:310px;width:780px;height:740px;}
  #overlay-left{left:120px;top:310px;width:780px;height:740px;}

  /* Show right overlay when LEFT clear (s1) */
  #wrap.s1 #overlay-right{opacity:1;}
  /* Show left overlay when RIGHT clear (s2) */
  #wrap.s2 #overlay-left{opacity:1;}

  /* --- CENTER CONCLUSION (s3) --- */
  #concl-center{position:absolute;left:120px;right:120px;top:50%;transform:translate(0,-50%);text-align:center;color:#FFFFFF;font-size:64px;font-weight:600;letter-spacing:-0.025em;line-height:1.35;padding:60px 80px;opacity:0;pointer-events:none;transition:opacity 0.8s ease 0.3s,transform 0.8s ease 0.3s;z-index:20;}
  #concl-center .pre{color:rgba(255,255,255,0.7);font-size:46px;font-weight:300;letter-spacing:-0.01em;line-height:1.4;margin-bottom:36px;}
  #concl-center .punch{font-size:104px;font-weight:600;letter-spacing:-0.03em;line-height:1.25;}
  #concl-center .em{color:#FF6B35;font-weight:700;}
  #wrap.s3 #concl-center{opacity:1;}

  /* ============ S4 · 분자형 그래프 (흩어져 있는 정보들) ============ */
  .chap-b{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease;}
  .headline-b{position:absolute;left:120px;top:140px;width:1680px;color:#FFFFFF;font-size:64px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;opacity:0;transition:opacity 0.7s ease 0.1s;}
  .headline-b .em{color:#FF6B35;}
  .accent-b{position:absolute;left:120px;top:260px;width:80px;height:6px;background:#FF6B35;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.4s,opacity 0.4s ease 0.4s;}

  /* 그래프 레이어 (s4 선명 → s5~s7 블러 배경) */
  #graph-layer{position:absolute;inset:0;z-index:5;opacity:0;transition:opacity 0.8s ease 0.4s, filter 0.9s ease, transform 0.9s ease;will-change:filter,transform,opacity;}
  #wrap.s4 #graph-layer, #wrap.s5 #graph-layer, #wrap.s6 #graph-layer, #wrap.s7 #graph-layer{opacity:1;}
  #wrap.s5 #graph-layer, #wrap.s6 #graph-layer, #wrap.s7 #graph-layer{filter:blur(11px);opacity:0.42;transform:scale(1.08);}

  #graph-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;}

  .gnode{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;border-radius:50%;font-weight:600;line-height:1.2;letter-spacing:-0.015em;will-change:transform,left,top;}

  #graph-center{
    width:230px;height:230px;
    background:radial-gradient(circle at 32% 30%, #FF9866 0%, #FF6B35 55%, #C9430E 100%);
    color:#FFFFFF;
    font-size:42px;
    font-weight:700;
    letter-spacing:-0.02em;
    box-shadow:0 0 70px rgba(255,107,53,0.45), inset 0 0 30px rgba(255,255,255,0.18);
    z-index:20;
    left:960px;top:638px;
    transform:translate(-50%,-50%);
  }
  #graph-center::after{
    content:'';position:absolute;inset:-8px;border-radius:50%;
    border:1px solid rgba(255,107,53,0.35);
    animation:halo 4s ease-in-out infinite;
  }
  @keyframes halo{0%,100%{transform:scale(1);opacity:0.55;}50%{transform:scale(1.08);opacity:0.2;}}

  .gnode.outer{
    width:190px;height:190px;
    background:radial-gradient(circle at 32% 30%, rgba(255,107,53,0.22), rgba(255,107,53,0.04));
    border:1.5px solid rgba(255,107,53,0.55);
    color:#FFFFFF;
    font-size:18px;
    z-index:10;
    padding:10px;
  }
  .gnode.outer .nname{display:block;font-weight:600;line-height:1.2;font-size:36px;}
  .gnode.outer .ndesc{display:block;font-size:21px;color:rgba(255,255,255,0.65);font-weight:400;margin-top:8px;letter-spacing:-0.04em;white-space:nowrap;}

  #wrap.s4 .chap-b, #wrap.s4 .headline-b{opacity:1;}
  #wrap.s4 .accent-b{opacity:1;transform:scaleX(1);}

  /* ============ S5~S7 · 블러 배경 + 헤드라인 + 단계별 수치 ============ */
  #info-overlay{position:absolute;inset:0;z-index:30;
    background:linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.42) 45%, rgba(0,0,0,0.62) 100%);
    opacity:0;pointer-events:none;transition:opacity 0.8s ease 0.35s;}
  #wrap.s5 #info-overlay, #wrap.s6 #info-overlay, #wrap.s7 #info-overlay{opacity:1;}

  /* 헤더 */
  .io-chap{position:absolute;left:120px;top:96px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;}
  /* 헤드라인+액센트 그룹 — s5 에서 크게·왼쪽 중앙, s6/s7 에서 작아지며 상단 정위치 */
  #io-head{position:absolute;left:120px;top:152px;transform-origin:left top;transition:transform 0.8s cubic-bezier(0.33,0,0.2,1);}
  #wrap.s5 #io-head{transform:translateY(250px) scale(1.5);}
  .io-headline{width:1100px;color:#FFFFFF;font-size:68px;font-weight:600;letter-spacing:-0.028em;line-height:1.2;}
  .io-line1{color:#FFFFFF;}
  .io-line2{display:inline-block;color:#FF6B35;transition:filter 0.7s ease,opacity 0.7s ease;}
  #wrap.s5 .io-line2{filter:blur(10px);opacity:0.32;}   /* 단계① : 두 번째 줄 블러 */
  .io-accent{width:80px;height:6px;background:#FF6B35;margin-top:34px;}

  /* 공통 수치 스타일 */
  .num{font-weight:700;letter-spacing:-0.035em;line-height:1;font-variant-numeric:tabular-nums;color:#FFFFFF;}
  .num .u{color:rgba(255,255,255,0.65);font-weight:600;}
  .cap{color:rgba(255,255,255,0.6);font-weight:400;}

  /* ── 단계① : 우측 세로 수요 수치 (s5) ── */
  #demand-vert{position:absolute;left:1030px;top:430px;width:840px;
    opacity:0;transform:translate(-360px,160px) scale(0.55);
    transition:opacity 0.7s ease,transform 0.75s cubic-bezier(0.4,0,0.2,1);}
  #wrap.s5 #demand-vert{opacity:1;transform:translate(0,0) scale(1);}
  .dv-row{display:flex;align-items:baseline;gap:26px;margin-bottom:34px;}
  .dv-row .num{font-size:88px;}
  .dv-row .num .u{font-size:40px;margin-left:2px;}
  .dv-row .cap{font-size:26px;}

  /* ── 단계②③ : 좌측 하단 가로 수요 밴드 (s6,s7) ── */
  #demand-horiz{position:absolute;left:120px;top:520px;width:980px;opacity:0;transition:opacity 0.5s ease;}
  #wrap.s6 #demand-horiz, #wrap.s7 #demand-horiz{opacity:1;}
  #wrap.s6 #demand-horiz{animation:popGrow 0.75s cubic-bezier(0.34,1.45,0.5,1);}
  @keyframes popGrow{0%{transform:scale(0.68);}55%{transform:scale(1.12);}100%{transform:scale(1);}}
  #demand-horiz .dh-label{color:rgba(255,255,255,0.82);font-size:23px;font-weight:400;letter-spacing:-0.01em;margin-bottom:24px;}
  #demand-horiz .dh-label .q{color:rgba(255,255,255,0.45);font-size:19px;}
  .dh-stats{display:flex;gap:40px;align-items:flex-end;}
  .dh-stat .num{font-size:72px;}
  .dh-stat .num .u{font-size:34px;margin-left:2px;}
  .dh-stat .cap{font-size:19px;margin-top:12px;}

  /* ── 단계② : 우측 낙수 흐름 (s6) ── */
  #waterfall{position:absolute;left:1020px;top:392px;width:800px;
    opacity:0;transform:translate(70px,150px) scale(0.5);transform-origin:center top;
    transition:opacity 0.6s ease,transform 0.7s cubic-bezier(0.4,0,0.2,1);}
  /* waterfall step removed by request */
  .wf-node{position:relative;}
  .wf-node .wf-main{color:#FFFFFF;font-size:34px;font-weight:600;letter-spacing:-0.02em;line-height:1.25;}
  .wf-node .wf-sub{color:rgba(255,255,255,0.55);font-size:19px;font-weight:300;margin-top:6px;line-height:1.35;}
  .wf-node.final .wf-main{color:#FF6B35;font-weight:700;}
  .wf-arrow{color:rgba(255,107,53,0.7);font-size:26px;line-height:1;margin:14px 0 14px 4px;}
  .wf-arrow .lbl{color:rgba(255,255,255,0.75);font-size:21px;font-weight:400;margin-left:14px;letter-spacing:-0.01em;}

  /* ── 단계③ : 우측 컴팩트 문제 밴드 (s7) ── */
  #problem-band{position:absolute;left:1030px;top:560px;width:800px;
    opacity:0;transform:scale(0.82);transform-origin:center;
    transition:opacity 0.55s ease 0.3s,transform 0.6s cubic-bezier(0.34,1.3,0.5,1) 0.3s;}
  #wrap.s6 #problem-band{opacity:1;transform:translate(0,-170px);}
  /* s6 LARGE 폰트 (2배 가까이) — 박스 위치는 우측 그대로 */
  #wrap.s6 #problem-band .pb-label{font-size:34px;margin-bottom:36px;line-height:1.4;}
  #wrap.s6 #problem-band .pb-stats{gap:60px;}
  #wrap.s6 #problem-band .pb-stat .num{font-size:132px;}
  #wrap.s6 #problem-band .pb-stat .num .u{font-size:58px;}
  #wrap.s6 #problem-band .pb-stat .cap{font-size:30px;margin-top:26px;line-height:1.4;}
  #wrap.s7 #problem-band{opacity:1;transform:translate(0,-80px);}
  #problem-band .pb-label{color:#fff;font-size:23px;font-weight:500;letter-spacing:-0.01em;margin-bottom:26px;line-height:1.4;transition:font-size 0.6s ease, margin-bottom 0.6s ease;}
  #problem-band .pb-label .q{color:rgba(255,255,255,0.45);font-size:19px;}
  .pb-stats{display:flex;gap:48px;align-items:flex-start;transition:gap 0.6s ease;}
  .pb-stat .num{font-size:72px;color:#FF6B35;transition:font-size 0.6s ease;}
  .pb-stat .num .u{font-size:34px;margin-left:2px;color:rgba(255,107,53,0.7);transition:font-size 0.6s ease;}
  .pb-stat .cap{font-size:19px;margin-top:12px;line-height:1.35;transition:font-size 0.6s ease, margin-top 0.6s ease;}

  /* ============ S8~S9 · 그래서 만들었습니다 (두 가지 원칙) ============ */
  #sol{position:absolute;inset:0;z-index:35;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s8 #sol, #wrap.s9 #sol{opacity:1;}

  .sol-chap{position:absolute;left:120px;top:96px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease 0.5s;}
  #wrap.s9 .sol-chap{opacity:1;}

  /* 헤드라인 블록 — s8: 가운데 크게 / s9: 좌상단 정위치로 축소·이동 */
  #sol-head{position:absolute;left:120px;top:152px;transform-origin:left top;transition:transform 0.85s cubic-bezier(0.33,0,0.2,1);}
  #wrap.s8 #sol-head{transform:translate(300px,300px) scale(1.5);}
  #wrap.s9 #sol-head{transform:translate(0,0) scale(1);}
  .sh-main{color:#FFFFFF;font-size:68px;font-weight:600;letter-spacing:-0.028em;line-height:1.2;}
  .sh-sub{color:rgba(255,255,255,0.78);font-size:38px;font-weight:300;letter-spacing:-0.015em;line-height:1.3;margin-top:16px;}
  .sh-sub .em{color:#FF6B35;font-weight:600;}
  /* 주황선 — 가운데(s8)엔 없음, 좌상단 이동(s9) 시 생성 */
  .sh-accent{width:80px;height:6px;background:#FF6B35;margin-top:34px;opacity:0;transform:scaleX(0);transform-origin:left;transition:opacity 0.45s ease 0.55s,transform 0.6s ease 0.55s;}
  #wrap.s9 .sh-accent{opacity:1;transform:scaleX(1);}

  /* 두 가지 원칙 — s9에서 등장 */
  #sol-points{position:absolute;left:120px;top:430px;width:1680px;display:flex;gap:60px;}
  .spt{flex:1;padding:50px 52px;border:1px solid rgba(255,255,255,0.18);border-radius:16px;display:flex;flex-direction:column;justify-content:center;min-height:380px;
    opacity:0;transform:translateY(28px);transition:opacity 0.7s ease,transform 0.7s cubic-bezier(0.34,1.2,0.5,1);}
  .spt.left, .spt.right{border-color:rgba(255,107,53,0.45);background:rgba(255,107,53,0.05);}
  #wrap.s9 .spt{opacity:1;transform:translateY(0);}
  #wrap.s9 .spt.left{transition-delay:0.7s;}
  #wrap.s9 .spt.right{transition-delay:0.9s;}
  .spt-no{color:#FF6B35;font-size:26px;letter-spacing:0.2em;font-weight:600;}
  .spt-title{color:#FFFFFF;font-size:64px;font-weight:700;letter-spacing:-0.03em;line-height:1.1;margin-top:24px;}
  .spt-desc{color:rgba(255,255,255,0.62);font-size:26px;font-weight:300;letter-spacing:-0.01em;line-height:1.4;margin-top:24px;}
  .spt-desc .em{color:rgba(255,255,255,0.92);font-weight:500;}

  .sol-foot{position:absolute;left:120px;bottom:56px;right:120px;color:rgba(255,255,255,0.5);font-size:22px;font-weight:500;letter-spacing:0.02em;opacity:0;transition:opacity 0.6s ease 1.1s;}
  #wrap.s9 .sol-foot{opacity:1;}
  .sol-foot .em{color:#FF6B35;font-weight:600;}


  /* ============ S10 · 한 앱에, 모든 바다 기능 ============ */
  #appone{position:absolute;inset:0;z-index:40;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s10 #appone{opacity:1;}
  #appone::before{content:'';position:absolute;left:50%;top:62%;transform:translate(-50%,-50%);width:1400px;height:1400px;background:radial-gradient(circle,rgba(255,107,53,0.18) 0%,rgba(255,107,53,0.04) 35%,transparent 60%);pointer-events:none;z-index:1;}

  .ap-chap{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;z-index:20;opacity:0;transition:opacity 0.6s ease 0.2s;}
  .ap-head{position:absolute;left:120px;top:140px;color:#fff;font-size:60px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;z-index:20;opacity:0;transition:opacity 0.7s ease 0.3s;}
  .ap-head .em{color:#FF6B35;}
  .ap-acc{position:absolute;left:120px;top:230px;width:80px;height:6px;background:#FF6B35;z-index:20;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.55s,opacity 0.4s ease 0.55s;}
  .ap-sub{position:absolute;left:120px;top:270px;color:rgba(255,255,255,0.65);font-size:24px;font-weight:300;z-index:20;opacity:0;transition:opacity 0.6s ease 0.7s;}
  .ap-foot{position:absolute;left:120px;bottom:50px;color:rgba(255,255,255,0.55);font-size:22px;letter-spacing:0.04em;font-weight:500;z-index:20;opacity:0;transition:opacity 0.6s ease 1s;}
  #wrap.s10 .ap-chap, #wrap.s10 .ap-head, #wrap.s10 .ap-sub, #wrap.s10 .ap-foot{opacity:1;}
  #wrap.s10 .ap-acc{opacity:1;transform:scaleX(1);}

  #ap-phone{position:absolute;left:50%;top:62%;transform:translate(-50%,-50%) scale(0.9);width:300px;height:534px;border:3px solid rgba(255,255,255,0.85);border-radius:38px;background:#0a0e1a;overflow:hidden;box-shadow:0 0 100px rgba(255,107,53,0.55),0 0 30px rgba(0,0,0,0.8),inset 0 2px 0 rgba(255,255,255,0.08);z-index:15;opacity:0;transition:opacity 0.8s ease 0.5s,transform 0.9s cubic-bezier(0.34,1.2,0.5,1) 0.5s;}
  #wrap.s10 #ap-phone{opacity:1;transform:translate(-50%,-50%) scale(1);}
  #ap-phone::before{content:'';position:absolute;left:50%;top:12px;transform:translateX(-50%);width:110px;height:20px;background:#000;border-radius:14px;z-index:2;}
  #ap-phone::after{content:'';position:absolute;inset:0;border-radius:38px;box-shadow:inset 0 0 40px rgba(0,0,0,0.5);pointer-events:none;z-index:3;}
  #ap-splash{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;}

  #ap-chips{position:absolute;inset:0;z-index:10;opacity:0;transition:opacity 0.8s ease 0.85s;}
  #wrap.s10 #ap-chips{opacity:1;}
  .apchip{position:absolute;border-radius:20px;font-weight:500;letter-spacing:-0.01em;background:rgba(255,107,53,0.1);border:1px solid rgba(255,107,53,0.45);color:#fff;white-space:nowrap;box-shadow:0 3px 10px rgba(0,0,0,0.4);transform:translate(-50%,-50%);will-change:transform;}
  .apchip.t0{opacity:1;font-weight:600;font-size:15px;padding:9px 15px;background:rgba(255,107,53,0.2);border-color:rgba(255,107,53,0.7);box-shadow:0 3px 18px rgba(255,107,53,0.32);}
  .apchip.t1{opacity:0.85;font-size:13px;padding:7px 13px;}
  .apchip.t2{opacity:0.55;font-size:12px;padding:6px 11px;background:rgba(255,255,255,0.05);border-color:rgba(255,255,255,0.22);}
  .apchip.t3{opacity:0.32;font-size:11px;padding:5px 10px;background:rgba(255,255,255,0.04);border-color:rgba(255,255,255,0.15);}
  /* 큰 진폭·1.5배 빠른 모션 — 배치 마진에 진폭 반영 */
  @keyframes apFloatY{0%,100%{transform:translate(-50%,-50%) translateY(-11px);}50%{transform:translate(-50%,-50%) translateY(11px);}}
  @keyframes apFloatX{0%,100%{transform:translate(-50%,-50%) translateX(-10px);}50%{transform:translate(-50%,-50%) translateX(10px);}}
  @keyframes apFloatXY{0%{transform:translate(-50%,-50%) translate(-9px,-9px);}25%{transform:translate(-50%,-50%) translate(11px,-8px);}50%{transform:translate(-50%,-50%) translate(9px,10px);}75%{transform:translate(-50%,-50%) translate(-10px,8px);}100%{transform:translate(-50%,-50%) translate(-9px,-9px);}}
  @keyframes apFloatD{0%,100%{transform:translate(-50%,-50%) translate(-8px,7px);}50%{transform:translate(-50%,-50%) translate(8px,-7px);}}


  /* ============ S11 · 접속 단계 축소 ============ */
  #stepcut{position:absolute;inset:0;z-index:45;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s11 #stepcut{opacity:1;}

  .sc-chap{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease 0.2s;}
  .sc-note{position:absolute;right:732px;top:306px;color:rgba(255,255,255,0.42);font-size:16px;letter-spacing:-0.005em;font-weight:400;opacity:0;transition:opacity 0.7s ease 0.65s;text-align:right;white-space:nowrap;}
  #wrap.s11 .sc-note{opacity:1;}
  .sc-head{position:absolute;left:120px;top:140px;color:#fff;font-size:72px;font-weight:700;letter-spacing:-0.028em;line-height:1.1;opacity:0;transition:opacity 0.7s ease 0.3s;}
  .sc-head .em{color:#FF6B35;}
  .sc-acc{position:absolute;left:120px;top:250px;width:80px;height:6px;background:#FF6B35;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.55s,opacity 0.4s ease 0.55s;}
  .sc-foot{position:absolute;left:120px;bottom:50px;color:rgba(255,255,255,0.55);font-size:22px;letter-spacing:0.02em;font-weight:500;opacity:0;transition:opacity 0.6s ease 1.1s;}
  #wrap.s11 .sc-chap, #wrap.s11 .sc-head, #wrap.s11 .sc-foot{opacity:1;}
  #wrap.s11 .sc-acc{opacity:1;transform:scaleX(1);}

  /* 표 컨테이너 */
  #sc-table{position:absolute;left:120px;top:330px;width:1080px;box-sizing:border-box;opacity:0;transform:translateY(20px);transition:opacity 0.7s ease 0.65s, transform 0.7s ease 0.65s;border:1px solid transparent;border-radius:24px;}
  #wrap.s11 #sc-table{opacity:1;transform:translateY(0);}
  .sc-row{display:grid;grid-template-columns:1.6fr 1fr 1fr 0.7fr;align-items:center;padding:18px 12px;border-bottom:1px solid rgba(255,255,255,0.08);font-size:26px;box-sizing:border-box;}
  .sc-row.head{color:rgba(255,255,255,0.55);font-size:18px;letter-spacing:0.14em;font-weight:500;text-transform:uppercase;border-bottom:1px solid rgba(255,255,255,0.22);padding-bottom:14px;}
  .sc-row.head .sg{color:#FF6B35;}
  .sc-row .feat{color:#fff;font-weight:500;letter-spacing:-0.01em;}
  .sc-row .prev{color:rgba(255,255,255,0.7);font-weight:400;}
  .sc-row .sg{color:#FF6B35;font-weight:600;}
  .sc-row .delta{color:rgba(255,255,255,0.85);font-weight:500;text-align:right;font-variant-numeric:tabular-nums;}
  .sc-row .delta.unify{color:rgba(255,107,53,0.85);}

  /* 평균 효과 박스 */
  #sc-avg{position:absolute;right:60px;top:330px;width:600px;height:660px;padding:0;border:1px solid rgba(255,107,53,0.5);border-radius:24px;background:linear-gradient(155deg,rgba(255,107,53,0.12),rgba(255,107,53,0.03));box-shadow:0 0 60px rgba(255,107,53,0.18);box-sizing:border-box;overflow:hidden;display:flex;flex-direction:column;opacity:0;transform:translateX(20px) scale(0.96);transition:opacity 0.8s ease 0.8s, transform 0.85s cubic-bezier(0.34,1.25,0.5,1) 0.8s;}
  #wrap.s11 #sc-avg{opacity:1;transform:translateX(0) scale(1);}
  /* 위·아래 정확히 반 분할 + 각 섹션 내부 세로 중앙 정렬 */
  .sc-avg-section{flex:1;display:flex;flex-direction:column;justify-content:center;padding:0 36px;}
  .sc-avg-label{color:#fff;font-size:28px;font-weight:600;letter-spacing:-0.005em;}
  .sc-avg-big{color:#FF6B35;font-size:132px;font-weight:700;letter-spacing:-0.04em;line-height:1;margin-top:14px;font-variant-numeric:tabular-nums;}
  .sc-avg-big .u{font-size:66px;color:#fff;font-weight:600;}
  .sc-avg-big .avg-note{font-size:22px;color:rgba(255,255,255,0.48);font-weight:400;letter-spacing:-0.005em;margin-left:10px;vertical-align:0;}
  .sc-avg-suffix{color:rgba(255,255,255,0.72);font-size:30px;font-weight:400;margin-top:16px;letter-spacing:-0.01em;}
  .sc-avg-sep{flex:none;height:1px;background:rgba(255,255,255,0.22);margin:0 36px;}
  .sc-avg-row{color:#fff;font-size:35px;font-weight:700;letter-spacing:-0.02em;line-height:1.1;}
  .sc-avg-row + .sc-avg-row{margin-top:6px;font-size:105px;letter-spacing:-0.03em;line-height:1;}
  .sc-avg-row .em{color:#FF6B35;}
  .sc-avg-sub{color:rgba(255,255,255,0.72);font-size:30px;font-weight:400;margin-top:14px;letter-spacing:-0.01em;}


  /* ============ S12 · 시연 안내 ============ */
  #demo{position:absolute;inset:0;z-index:50;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.8s ease;}
  #wrap.s12 #demo{opacity:1;}
  #demo::before{content:'';position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:1400px;height:1400px;background:radial-gradient(circle,rgba(255,107,53,0.18) 0%,rgba(255,107,53,0.04) 38%,transparent 62%);pointer-events:none;}
  .demo-text{position:relative;text-align:center;color:#fff;font-size:88px;font-weight:700;letter-spacing:-0.03em;line-height:1.32;}
  .demo-text .em{color:#FF6B35;}
  .demo-text .ln{display:block;opacity:0;transform:translateY(16px);transition:opacity 0.7s ease, transform 0.7s ease;}
  #wrap.s12 .demo-text .ln{opacity:1;transform:translateY(0);}
  #wrap.s12 .demo-text .ln:nth-child(1){transition-delay:0.35s;}
  #wrap.s12 .demo-text .ln:nth-child(2){transition-delay:0.65s;}
  #wrap.s12 .demo-text .ln:nth-child(3){transition-delay:0.95s;}


  /* ============ S12 · 이미 운영 중 (Traction) ============ */
  #traction{position:absolute;inset:0;z-index:48;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s13 #traction{opacity:1;}

  .tr-chap{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease 0.2s;}
  .tr-head{position:absolute;left:120px;top:140px;color:#fff;font-size:60px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;opacity:0;transition:opacity 0.7s ease 0.3s;}
  .tr-head .em{color:#FF6B35;}
  .tr-acc{position:absolute;left:120px;top:230px;width:80px;height:6px;background:#FF6B35;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.55s,opacity 0.4s ease 0.55s;}

  /* 사용자 후기 (응원/검증) */
  .tr-quotes{position:absolute;left:120px;right:120px;top:760px;display:flex;gap:30px;align-items:stretch;}
  .tr-quote{flex:1;padding:22px 26px;border:1px solid rgba(255,255,255,0.13);border-left:3px solid rgba(255,107,53,0.6);border-radius:14px;background:linear-gradient(140deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01));box-sizing:border-box;opacity:0;transform:translateY(14px);transition:opacity 0.6s ease,transform 0.6s ease;}
  #wrap.s13 .tr-quote{opacity:1;transform:translateY(0);}
  #wrap.s13 .tr-quote:nth-child(1){transition-delay:1.34s;}
  #wrap.s13 .tr-quote:nth-child(2){transition-delay:1.46s;}
  .tr-quote-text{color:rgba(255,255,255,0.92);font-size:22px;font-weight:400;line-height:1.55;letter-spacing:-0.01em;display:inline;}
  .tr-quote-text::before{content:'“';color:rgba(255,107,53,0.7);font-size:34px;font-weight:700;line-height:0;margin-right:4px;vertical-align:-5px;}
  .tr-quote-text::after{content:'”';color:rgba(255,107,53,0.7);font-size:34px;font-weight:700;line-height:0;margin-left:5px;vertical-align:-12px;}
  .tr-quote-text b{color:#FF6B35;font-weight:600;}
  .tr-quote-meta{color:rgba(255,255,255,0.6);font-size:22px;font-weight:500;letter-spacing:-0.005em;margin-top:18px;display:block;}

  .tr-foot{position:absolute;left:120px;bottom:50px;color:rgba(255,255,255,0.55);font-size:22px;letter-spacing:0.04em;font-weight:500;opacity:0;transition:opacity 0.6s ease 1.2s;}
  #wrap.s13 .tr-chap, #wrap.s13 .tr-head, #wrap.s13 .tr-foot{opacity:1;}
  #wrap.s13 .tr-acc{opacity:1;transform:scaleX(1);}

  .tr-grid{position:absolute;left:120px;right:120px;top:360px;display:flex;gap:30px;height:380px;}
  .tr-section{display:flex;flex-direction:column;}
  .tr-3m{flex:4.2;}
  .tr-1m{flex:1;}
  .tr-header{padding:22px 28px;border:1px solid rgba(255,107,53,0.45);border-radius:18px;background:linear-gradient(140deg,rgba(255,107,53,0.12),rgba(255,107,53,0.03));margin-bottom:24px;display:flex;flex-direction:column;justify-content:center;min-height:90px;box-sizing:border-box;opacity:0;transform:translateY(14px);transition:opacity 0.6s ease 0.6s,transform 0.6s ease 0.6s;}
  .tr-1m .tr-header{transition-delay:0.72s;}
  #wrap.s13 .tr-header{opacity:1;transform:translateY(0);}
  .tr-period{color:#fff;font-size:30px;font-weight:700;letter-spacing:-0.02em;line-height:1;}
  .tr-since{color:rgba(255,255,255,0.55);font-size:20px;font-weight:300;margin-top:6px;letter-spacing:-0.005em;}
  .tr-boxes{display:flex;gap:20px;flex:1;}
  .tr-box{flex:1;padding:24px 22px;border:1px solid rgba(255,255,255,0.16);border-radius:18px;background:linear-gradient(140deg,rgba(255,255,255,0.045),rgba(255,255,255,0.015));display:flex;flex-direction:column;justify-content:center;min-height:180px;opacity:0;transform:translateY(20px);transition:opacity 0.65s ease,transform 0.65s cubic-bezier(0.34,1.2,0.5,1);box-sizing:border-box;}
  .tr-box.highlight{border-color:rgba(255,107,53,0.55);background:linear-gradient(140deg,rgba(255,107,53,0.18),rgba(255,107,53,0.04));box-shadow:0 0 40px rgba(255,107,53,0.18);}
  #wrap.s13 .tr-box{opacity:1;transform:translateY(0);}
  #wrap.s13 .tr-3m .tr-boxes .tr-box:nth-child(1){transition-delay:0.82s;}
  #wrap.s13 .tr-3m .tr-boxes .tr-box:nth-child(2){transition-delay:0.92s;}
  #wrap.s13 .tr-3m .tr-boxes .tr-box:nth-child(3){transition-delay:1.02s;}
  #wrap.s13 .tr-3m .tr-boxes .tr-box:nth-child(4){transition-delay:1.12s;}
  #wrap.s13 .tr-1m .tr-boxes .tr-box{transition-delay:1.22s;}
  .tr-big{color:#fff;font-size:68px;font-weight:700;letter-spacing:-0.035em;line-height:1;font-variant-numeric:tabular-nums;display:flex;align-items:baseline;flex-wrap:wrap;}
  .tr-big .u{font-size:34px;color:rgba(255,255,255,0.65);font-weight:600;margin-left:3px;letter-spacing:-0.01em;}
  .tr-label{color:rgba(255,255,255,0.78);font-size:26px;font-weight:500;margin-top:22px;letter-spacing:-0.01em;line-height:1.3;}


  /* ============ S14 · 추진계획 (시기별 구현 방향) ============ */
  #roadmap{position:absolute;inset:0;z-index:52;background:rgba(0,0,0,0.55);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s14 #roadmap{opacity:1;}

  .rm-chap{position:absolute;left:120px;top:80px;color:#FF6B35;font-size:22px;letter-spacing:0.32em;font-weight:600;opacity:0;transition:opacity 0.6s ease 0.2s;}
  .rm-head{position:absolute;left:120px;top:140px;color:#fff;font-size:60px;font-weight:600;letter-spacing:-0.025em;line-height:1.2;opacity:0;transition:opacity 0.7s ease 0.3s;}
  .rm-head .em{color:#FF6B35;}
  .rm-acc{position:absolute;left:120px;top:240px;width:80px;height:6px;background:#FF6B35;opacity:0;transform:scaleX(0);transform-origin:left;transition:transform 0.6s ease 0.55s,opacity 0.4s ease 0.55s;}
  .rm-sub{position:absolute;left:120px;top:280px;color:rgba(255,255,255,0.65);font-size:24px;font-weight:300;letter-spacing:-0.01em;opacity:0;transition:opacity 0.6s ease 0.65s;}
  .rm-foot{position:absolute;left:120px;bottom:36px;color:rgba(255,255,255,0.5);font-size:20px;letter-spacing:0.04em;font-weight:500;opacity:0;transition:opacity 0.6s ease 1.6s;}
  #wrap.s14 .rm-chap, #wrap.s14 .rm-head, #wrap.s14 .rm-sub, #wrap.s14 .rm-foot{opacity:1;}
  #wrap.s14 .rm-acc{opacity:1;transform:scaleX(1);}

  .rm-stack{position:absolute;left:120px;right:120px;top:344px;display:flex;flex-direction:column;gap:14px;}
  .rm-phase{display:flex;align-items:stretch;border-radius:16px;border:1px solid rgba(255,255,255,0.16);background:linear-gradient(140deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01));overflow:hidden;opacity:0;transform:translateY(20px);transition:opacity 0.7s ease, transform 0.7s cubic-bezier(0.34,1.2,0.5,1);}
  #wrap.s14 .rm-phase{opacity:1;transform:translateY(0);}
  #wrap.s14 .rm-phase.short{transition-delay:0.7s;}
  #wrap.s14 .rm-phase.mid{transition-delay:0.95s;}
  #wrap.s14 .rm-phase.long{transition-delay:1.2s;}

  /* ============ S15 · 클로징 (Sunrise) ============ */
  #closing{position:absolute;inset:0;z-index:55;background:linear-gradient(180deg,#000 0%,#000814 40%,#0a1830 70%,#1a2840 90%,#000 100%);opacity:0;pointer-events:none;transition:opacity 0.7s ease;}
  #wrap.s15 #closing{opacity:1;}
  #closing::before{content:'';position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:1700px;height:600px;background:radial-gradient(ellipse at center bottom,rgba(255,107,53,0.55) 0%,rgba(255,107,53,0.18) 25%,transparent 55%);pointer-events:none;animation:cGlow 5s ease-in-out infinite;}
  @keyframes cGlow{0%,100%{opacity:0.9;}50%{opacity:1;transform:translateX(-50%) scale(1.04);}}
  #closing .c-horizon{position:absolute;left:0;right:0;bottom:120px;height:2px;background:linear-gradient(90deg,transparent,rgba(255,200,120,0.85),transparent);box-shadow:0 0 30px rgba(255,140,60,0.6);}
  #closing .c-sun{position:absolute;left:50%;bottom:118px;transform:translateX(-50%);width:240px;height:120px;background:radial-gradient(ellipse at center bottom,#FFEAB0 0%,#FF8C3D 50%,transparent 80%);border-top-left-radius:120px;border-top-right-radius:120px;animation:cSunPulse 4s ease-in-out infinite;}
  /* 일출 안 함정 실루엣 (역광) — 일출과 함께 처음부터 표시 */
  #closing .c-vessel{position:absolute;left:50%;bottom:115px;transform:translate(-50%,0);width:180px;height:60px;z-index:4;pointer-events:none;
    filter:drop-shadow(0 0 4px rgba(0,0,0,0.5));}
  @keyframes cSunPulse{0%,100%{opacity:0.95;}50%{opacity:1;filter:brightness(1.1);}}
  /* 텍스트: 기본 opacity 0 + 아래 30px → 떠오르며 등장 */
  #closing .c-line1{position:absolute;left:50%;top:285px;color:#FFFFFF;font-size:104px;font-weight:700;letter-spacing:-0.035em;line-height:1.15;text-align:center;opacity:0;transform:translate(-50%, 30px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  #closing .c-line2{position:absolute;left:50%;top:415px;color:#FF6B35;font-size:104px;font-weight:700;letter-spacing:-0.035em;line-height:1.15;text-align:center;text-shadow:0 0 30px rgba(255,107,53,0.4);opacity:0;transform:translate(-50%, 30px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  #closing .c-accent{position:absolute;left:50%;top:575px;width:100px;height:5px;background:#FF6B35;box-shadow:0 0 20px rgba(255,107,53,0.6);opacity:0;transform:translate(-50%, 30px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  #closing .c-hand{position:absolute;left:50%;top:628px;font-family:'White Angelica','Nanum Pen Script',cursive;font-size:58px;color:#FFFFFF;line-height:1;letter-spacing:0.01em;text-align:center;white-space:nowrap;text-shadow:0 0 18px rgba(255,255,255,0.28);opacity:0;transform:translate(-50%, 30px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  #closing .c-hand span{display:inline-block;transform:skewX(-8deg);}
  #closing .c-cta{position:absolute;left:50%;top:720px;color:#FFFFFF;font-size:46px;font-weight:600;letter-spacing:-0.015em;text-align:center;opacity:0;transform:translate(-50%, 30px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  #closing .c-cta .em{color:#FF6B35;font-weight:700;}
  /* 발표자 (우측 하단, 흰색) */
  #closing .c-presenter{position:absolute;right:60px;bottom:30px;color:#fff;font-size:33px;font-weight:500;letter-spacing:-0.005em;z-index:30;opacity:0;transform:translateY(16px);transition:opacity 0.9s ease, transform 0.9s cubic-bezier(0.22,1,0.36,1);}
  /* s15 진입 시 순차 fade-up */
  #wrap.s15 #closing .c-line1{opacity:1;transform:translate(-50%, 0);transition-delay:0.35s;}
  #wrap.s15 #closing .c-line2{opacity:1;transform:translate(-50%, 0);transition-delay:0.7s;}
  #wrap.s15 #closing .c-accent{opacity:1;transform:translate(-50%, 0);transition-delay:1.0s;}
  #wrap.s15 #closing .c-hand{opacity:1;transform:translate(-50%, 0);transition-delay:1.25s;}
  #wrap.s15 #closing .c-cta{opacity:1;transform:translate(-50%, 0);transition-delay:1.5s;}
  #wrap.s15 #closing .c-presenter{opacity:1;transform:translateY(0);transition-delay:1.65s;}


  .rm-badge{flex:0 0 188px;background:linear-gradient(140deg,rgba(255,107,53,0.18),rgba(255,107,53,0.05));border-right:1px solid rgba(255,107,53,0.32);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px;}
  .rm-badge .term{color:#fff;font-size:34px;font-weight:700;letter-spacing:-0.02em;line-height:1;}
  .rm-badge .period{color:rgba(255,255,255,0.65);font-size:16px;font-weight:400;margin-top:8px;letter-spacing:-0.005em;}
  .rm-content{flex:1;padding:22px 28px;display:flex;flex-direction:column;justify-content:center;}
  .rm-title{color:#FF6B35;font-size:24px;font-weight:600;letter-spacing:-0.015em;margin-bottom:14px;}
  .rm-items{display:grid;grid-template-columns:1fr 1fr;column-gap:34px;row-gap:10px;}
  .rm-items.single{grid-template-columns:1fr;}
  .rm-item{color:rgba(255,255,255,0.86);font-size:19px;font-weight:400;letter-spacing:-0.01em;line-height:1.5;}
  .rm-item .pri{color:#FF6B35;font-weight:700;margin-right:4px;}
  .rm-item .lbl{font-weight:600;color:#fff;}
  .rm-item .tag{display:inline-block;margin-left:6px;padding:2px 8px;border-radius:10px;font-size:14px;font-weight:600;letter-spacing:-0.005em;vertical-align:1px;}
  .rm-item .tag.done{color:#7CD992;background:rgba(124,217,146,0.13);border:1px solid rgba(124,217,146,0.32);}
  .rm-item .tag.ing{color:#FF8A50;background:rgba(255,107,53,0.16);border:1px solid rgba(255,107,53,0.45);}
  .rm-item .desc{color:rgba(255,255,255,0.6);font-size:16px;margin-left:6px;}

  .rm-arrow{text-align:center;color:rgba(255,107,53,0.65);font-size:22px;line-height:1;margin:-4px 0;letter-spacing:0.4em;}

  /* Progress hint */
  #steps{display:none;}
</style>
```

### 1.4 `<body>` HTML 구조

각 슬라이드 마크업 전체. base64 src(영상·splash 이미지)는 생략 표기, 클로징의 함정 SVG는 인라인 벡터라 전체 포함(`slide02_preview.html:509–982`).

```html
<body>
<div id="stage"><div id="wrap" class="s0">
  <video id="bg-sea-video" autoplay muted loop playsinline preload="auto" disablepictureinpicture disableremoteplayback x-webkit-airplay="deny" controlslist="nodownload nofullscreen noremoteplayback">
    <source src="data:video/mp4;base64,…(base64 생략, ~2,797,612 bytes 배경영상)…" type="video/mp4">
  </video>
  <div id="bg-sea-overlay"></div>

  <!-- TITLE SLIDE (state 0) -->
  <div id="title">
    <div class="tchap">SEA:GNAL · 바다 : 그 날의 신호</div>
    <div class="logo">SEA:GNAL</div>
    <div class="taccent"></div>
    <div class="ttitle">바다 : 그 날의 신호</div>
    <div class="tsub">분산된 공공의 바다 정보를 한 화면으로</div>
    <div class="tfoot">해양경찰청 AI 경진대회 · 개발 및 활용 부문</div>
    <div class="tpresenter">제주해양경찰서<br>1505함 경사 신진섭</div>
  </div>

  <!-- HEADER -->
  <div class="chap">왜 만들었나 · 불편함, 번거로움에서 시작</div>
  <div class="headline">선배님들, <span class="em">다들 이런 경험 있으시죠?</span></div>
  <div class="accent"></div>

  <!-- LEFT PANEL: KakaoTalk -->
  <div class="panel" id="kakao">
    <div class="kheader">
      <div class="name">📞 고령의 선장님 · 기상특보 발효 중</div>
      <div class="meta">파출소 안내 통화</div>
    </div>
    <div class="msg theirs">
      <div class="avatar">민</div>
      <div class="col">
        <div class="who">민원인</div>
        <div class="bubble">제주도 북부 앞바다,<br>특보 언제 해제돼요?</div>
      </div>
      <div class="time">14:02</div>
    </div>
    <div class="msg mine">
      <div class="time">14:03</div>
      <div class="col" style="align-items:flex-end;">
        <div class="bubble">저희도 기상청 정보 보고<br>알려드리는 거예요.<br>혹시 기상청 홈페이지<br>확인해 보셨어요?</div>
      </div>
    </div>
    <div class="msg theirs">
      <div class="avatar">민</div>
      <div class="col">
        <div class="bubble">…어떻게 하는데요?</div>
      </div>
      <div class="time">14:04</div>
    </div>
    <div class="msg mine">
      <div class="time">14:05</div>
      <div class="col" style="align-items:flex-end;">
        <div class="bubble">아 — 네이버에서<br>'날씨누리' 검색하시고<br><span style="color:rgba(0,0,0,0.4);">…(중얼중얼 설명 생략)</span></div>
      </div>
    </div>
    <div class="msg theirs">
      <div class="avatar">민</div>
      <div class="col">
        <div class="bubble">그냥 그때그때 전화할게요.<br><b class="pulse-kakao" style="font-size:27px;">우리는 그런거 못해~</b></div>
      </div>
      <div class="time">14:06</div>
    </div>
  </div>

  <!-- RIGHT PANEL: Coworker dialog -->
  <div class="panel" id="coworker">
    <div class="cheader">
      <div class="scene">파출소 인계인수 직후</div>
      <div class="meta">선배 → 나</div>
    </div>
    <div class="stage-area">
      <div class="person left">
        <div class="head">👨</div>
        <div class="body"></div>
        <div class="label">선배</div>
      </div>
      <div class="person right">
        <div class="head">🧑</div>
        <div class="body"></div>
        <div class="label">순경 신진섭</div>
      </div>
      <div class="pbubble fl" id="pb1">
        <span class="who">선배</span>
        조석 정보 좀 업데이트해 놔라.
      </div>
      <div class="pbubble fr" id="pb2">
        <span class="who">순경 신진섭</span>
        혹시… 어디서 확인합니까?
      </div>
      <div class="pbubble fl" id="pb3">
        <span class="who">선배</span>
        <b class="pulse-coworker">바다타임 어플 깔아서 확인해 봐.</b>
      </div>
      <div class="pbubble fr" id="pb4">
        <span class="who">순경 신진섭</span>
        네.
        <span class="thought">(왜 민간 어플을 사용해야만 하는 거지…?)</span>
      </div>
    </div>
  </div>

  <!-- OVERLAY TEXTS (on blurred panels) -->
  <!-- s1: 좌측 카톡 명확 / 우측 동료 블러 → 우측 위에 '특보 발표 때마다 같은 민원 반복' -->
  <div class="panel-overlay" id="overlay-right">
    <div>
      <span class="ln">특보 때마다 걸려오는</span>
      <span class="ln"><span class="em">같은 통화를</span></span>
      <span class="ln">언제까지 반복해야 하는걸까?</span>
    </div>
  </div>
  <!-- s2: 우측 동료 명확 / 좌측 카톡 블러 → 좌측 위에 '왜 민간 어플을 이용해야만' -->
  <div class="panel-overlay" id="overlay-left">
    <div>
      <span class="ln"><span class="em">민간 어플</span>을 이용해야만</span>
      <span class="ln">확인할 수 있는걸까?</span>
    </div>
  </div>

  <!-- CENTER CONCLUSION (s3) -->
  <div id="concl-center">
    <div class="pre">이런 작은 불편함과 매번 들었던 의문이</div>
    <div class="punch"><span class="em">SEA:GNAL</span>의 출발점입니다.</div>
  </div>

  <!-- ============ S4 · 분자형 그래프 ============ -->
  <div class="chap-b">왜 만들었나 · 분산되어 있는 정보들</div>
  <div class="headline-b">정보는 있습니다. <span class="em">분산되어 있을 뿐…</span></div>
  <div class="accent-b"></div>

  <div id="graph-layer">
    <svg id="graph-svg" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice">
      <line id="line0" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line1" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line2" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line3" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line4" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line5" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
      <line id="line6" stroke="rgba(255,255,255,0.22)" stroke-width="1.4"/>
    </svg>

    <div class="gnode" id="graph-center">해양 정보</div>

    <div class="gnode outer" id="gnode0"><span class="nname">기상청</span><span class="ndesc">(날씨 · 태풍 등)</span></div>
    <div class="gnode outer" id="gnode1"><span class="nname">국립<br>해양조사원</span><span class="ndesc">(조석 · 유향속 등)</span></div>
    <div class="gnode outer" id="gnode2"><span class="nname">한국<br>천문연구원</span><span class="ndesc">(일출몰 등)</span></div>
    <div class="gnode outer" id="gnode3"><span class="nname">해양기상<br>기후포털</span><span class="ndesc">(예측정보)</span></div>
    <div class="gnode outer" id="gnode4"><span class="nname">방재기상<br>플랫폼</span><span class="ndesc">(과거 정보)</span></div>
    <div class="gnode outer" id="gnode5"><span class="nname">지자체<br>정보</span><span class="ndesc">(해안가 등)</span></div>
    <div class="gnode outer" id="gnode6"><span class="nname">etc.</span></div>
  </div>

  <!-- ============ S5~S7 · 블러 배경 위 헤드라인 + 단계별 수치 ============ -->
  <div id="info-overlay">
    <div class="io-chap">왜 만들었나 · 수요는 큰데, 신호는 흩어져</div>
    <div id="io-head">
      <div class="io-headline"><span class="io-line1">바다의 시대는 왔는데,</span><br><span class="io-line2">신호는 정리되지 않았습니다.</span></div>
      <div class="io-accent"></div>
    </div>

    <!-- 단계① : 우측 세로 수요 -->
    <div id="demand-vert">
      <div class="dv-row"><span class="num"><span class="cu" data-to="9">0</span><span class="u">만</span></span><span class="cap">어업인</span></div>
      <div class="dv-row"><span class="num"><span class="cu" data-to="920">0</span><span class="u">만</span></span><span class="cap">낚시인</span></div>
      <div class="dv-row"><span class="num">연 <span class="cu" data-to="1012" data-comma="1">0</span><span class="u">만</span></span><span class="cap">관광객 (연간)</span></div>
    </div>

    <!-- 단계②③ : 좌측 하단 가로 수요 밴드 -->
    <div id="demand-horiz">
      <div class="dh-label">바다에 사람은 이렇게 많은데 <span class="q">(수요)</span></div>
      <div class="dh-stats">
        <div class="dh-stat"><div class="num">9<span class="u">만</span></div><div class="cap">어업인</div></div>
        <div class="dh-stat"><div class="num">920<span class="u">만</span></div><div class="cap">낚시인</div></div>
        <div class="dh-stat"><div class="num">연 1,012<span class="u">만</span></div><div class="cap">관광객 (연간)</div></div>
      </div>
    </div>

    <!-- 단계② : 우측 낙수 흐름 -->
    <div id="waterfall">
      <div class="wf-node">
        <div class="wf-main">양질의 공공 데이터는 있습니다</div>
        <div class="wf-sub">기상청 · 국립해양조사원 · 천문연구원 · 포털 · 플랫폼…</div>
      </div>
      <div class="wf-arrow">▼<span class="lbl">그런데 7개+ 기관에 흩어져 있어</span></div>
      <div class="wf-node">
        <div class="wf-main">어디서 봐야 할지 모릅니다</div>
        <div class="wf-sub">출처마다 형식·주소가 달라 — 찾고 맞추기 어렵다</div>
      </div>
      <div class="wf-arrow">▼<span class="lbl">결국</span></div>
      <div class="wf-node final">
        <div class="wf-main">민간 앱에 의존하게 됩니다</div>
        <div class="wf-sub">Windy 등 · 한국 특보 연동 없음 · 유료·광고</div>
      </div>
    </div>

    <!-- 단계③ : 우측 컴팩트 문제 밴드 -->
    <div id="problem-band">
      <div class="pb-label">양질의 정보는 흩어져 있어,<br>사람들은 민간 앱을 사용하게 됩니다.</div>
      <div class="pb-stats">
        <div class="pb-stat">
          <div class="num">7<span class="u">개+</span></div>
          <div class="cap">분산된<br>해양정보 제공기관</div>
        </div>
        <div class="pb-stat">
          <div class="num">민간<span class="u">앱</span></div>
          <div class="cap">Windy 등 의존<br>한국 특보 연동 없음</div>
        </div>
      </div>
    </div>
  </div>

  <!-- ============ S8~S9 · 그래서 만들었습니다 (두 가지 원칙) ============ -->
  <div id="sol">
    <div class="sol-chap">그래서 만들었습니다 · 두 가지 원칙</div>
    <div id="sol-head">
      <div class="sh-main">그래서 만들었습니다.</div>
      <div class="sh-sub">다음과 같은 <span class="em">두 가지 원칙</span>으로.</div>
      <div class="sh-accent"></div>
    </div>
    <div id="sol-points">
      <div class="spt left">
        <div class="spt-no">원칙 ①</div>
        <div class="spt-title"><span style="color:#FF6B35;">한 개</span>의 앱에</div>
        <div class="spt-desc"><span class="em pulse">분산되어 있는 해양정보</span>를<br>하나의 화면에 모두 담는다.</div>
      </div>
      <div class="spt right">
        <div class="spt-no">원칙 ②</div>
        <div class="spt-title"><span style="color:#FF6B35;">3회</span> 터치 이내</div>
        <div class="spt-desc">원하는 정보까지<br><span class="em pulse">3번 안에</span> 닿게 한다.</div>
      </div>
    </div>
    <div class="sol-foot">복잡한 바다 정보를 <span class="em">가장 단순한 신호로.</span></div>
  </div>


  <!-- ============ S10 · 한 앱에, 모든 바다 기능 ============ -->
  <div id="appone">
    <div class="ap-chap">바다의 모든 것을 · 앱 하나로</div>
    <div class="ap-head"><span class="em">앱 하나</span>에 모든 바다 정보를</div>
    <div class="ap-acc"></div>
    <div class="ap-sub">분산 되어있는 공공 데이터를 통합하여 편리하게.</div>

    <div id="ap-phone">
      <img id="ap-splash" src="data:image/jpeg;base64,…(base64 생략, ~870KB 앱 splash)…" alt="SEA:GNAL 앱 화면">
    </div>

    <div id="ap-chips"></div>

    <div class="ap-foot">바다에 관련된 모든 정보를 한 화면, 한 손에.</div>
  </div>


  <!-- ============ S11 · 접속 단계 축소 ============ -->
  <div id="stepcut">
    <div class="sc-chap">정보 획득 단계 축소</div>
    <div class="sc-note">* 기존 사이트 단계 카운트는 PC로 접속 시를 기준으로 자체 집계한 결과임</div>
    <div class="sc-head"><span class="em">3회 이내</span>로 끝납니다.</div>
    <div class="sc-acc"></div>

    <div id="sc-table">
      <div class="sc-row head">
        <div>기능</div>
        <div>기존 사이트</div>
        <div class="sg">SEA:GNAL</div>
        <div style="text-align:right;">감소</div>
      </div>
      <div class="sc-row"><div class="feat">해상 기상 전망</div><div class="prev">6 단계</div><div class="sg">2 단계</div><div class="delta">−67%</div></div>
      <div class="sc-row"><div class="feat">해상특보</div><div class="prev">4 단계</div><div class="sg">2 단계</div><div class="delta">−50%</div></div>
      <div class="sc-row"><div class="feat">기상예보</div><div class="prev">7 단계</div><div class="sg">2 단계</div><div class="delta">−71%</div></div>
      <div class="sc-row"><div class="feat">기상부이 조회</div><div class="prev">6 단계</div><div class="sg">2 단계</div><div class="delta">−67%</div></div>
      <div class="sc-row"><div class="feat">유향·유속</div><div class="prev">7 단계</div><div class="sg">2 단계</div><div class="delta">−71%</div></div>
      <div class="sc-row"><div class="feat">해구별 기상전망</div><div class="prev">10 단계</div><div class="sg">2 단계</div><div class="delta">−80%</div></div>
      <div class="sc-row"><div class="feat">천기 전망</div><div class="prev">8 단계</div><div class="sg">2 단계</div><div class="delta">−75%</div></div>
      <div class="sc-row"><div class="feat">임의 해점 종합</div><div class="prev">3 단계</div><div class="sg">2 단계</div><div class="delta">−33%</div></div>
      <div class="sc-row"><div class="feat">CCTV 조회</div><div class="prev">6 단계</div><div class="sg">2 단계</div><div class="delta">−67%</div></div>
    </div>

    <div id="sc-avg">
      <div class="sc-avg-section">
        <div class="sc-avg-label">기존 접속방법 대비</div>
        <div class="sc-avg-big"><span id="sc-num">0</span><span class="u">%</span><span class="avg-note">(전체 평균)</span></div>
        <div class="sc-avg-suffix">절차 감소</div>
      </div>
      <div class="sc-avg-sep"></div>
      <div class="sc-avg-section">
        <div class="sc-avg-row">평균</div>
        <div class="sc-avg-row"><span class="em">2회</span> 이내</div>
        <div class="sc-avg-sub">원하는 정보에 도달</div>
      </div>
    </div>

    <div class="sc-foot">고령 사용자도 부담 없는 직관적 접근 — SEA:GNAL의 핵심 설계 원칙.</div>
  </div>


  <!-- ============ S12 · 이미 운영 중 (Traction) ============ -->
  <div id="traction">
    <div class="tr-chap">이미 운영 중인 실서비스</div>
    <div class="tr-head">기획이 아닙니다. <span class="em">이미 검증됐습니다.</span></div>
    <div class="tr-acc"></div>

    <div class="tr-grid">
      <div class="tr-section tr-3m">
        <div class="tr-header">
          <div class="tr-period">3개월</div>
          <div class="tr-since">2025. 3. 30. 출시</div>
        </div>
        <div class="tr-boxes">
          <div class="tr-box">
            <div class="tr-big"><span class="tr-cu" data-target="1.5" data-dec="1">0.0</span><span class="u">만+</span></div>
            <div class="tr-label">누적 이용자</div>
          </div>
          <div class="tr-box">
            <div class="tr-big"><span class="tr-cu" data-target="1351" data-comma="1">0</span><span class="u">명</span></div>
            <div class="tr-label">안드로이드 앱 설치 수<br><span style="font-size:24px;color:rgba(255,255,255,0.6);letter-spacing:-0.06em;white-space:nowrap;">(해양경찰 자유게시판 홍보 2회)</span></div>
          </div>
          <div class="tr-box">
            <div class="tr-big"><span class="tr-cu" data-target="80.6" data-dec="1">0.0</span><span class="u">%</span></div>
            <div class="tr-label">설치 유지율</div>
          </div>
          <div class="tr-box">
            <div class="tr-big"><span class="tr-cu" data-target="24.8" data-dec="1">0.0</span><span class="u">만+</span></div>
            <div class="tr-label">특보 알림 발송</div>
          </div>
        </div>
      </div>

      <div class="tr-section tr-1m">
        <div class="tr-header">
          <div class="tr-period">1개월</div>
          <div class="tr-since">5. 27.부터 집계</div>
        </div>
        <div class="tr-boxes">
          <div class="tr-box">
            <div class="tr-big"><span class="tr-cu" data-target="1.1" data-dec="1">0.0</span><span class="u">만+</span></div>
            <div class="tr-label">해양 정보 제공</div>
          </div>
        </div>
      </div>
    </div>

    <div class="tr-quotes">
      <div class="tr-quote">
        <span class="tr-quote-text">윈디보다 <b>100배 나은 국산 어플</b> 개발하신다고 고생하십니다!</span>
        <span class="tr-quote-meta">사용자(넓은조개959) 댓글 (‘26. 5. 3.)</span>
      </div>
      <div class="tr-quote">
        <span class="tr-quote-text">현재버전으로도 <b>충분히 만족</b>하고 사용중입니다. <b>업무에 엄청 많은 도움</b>이 되고 있어요!!<br>진심 감사드립니다. 급한게 아니니까 제 의견은 뒷전으로 미뤄두셔도 되겠습니다.<br><span style="letter-spacing:-0.05em;">커피한잔이라도 후원해드리고 싶은데 후원방법도 나중에 한번 고려해보세요 감사합니다^^</span></span>
        <span class="tr-quote-meta">사용자 1:1 문의 (‘26. 6. 11.)</span>
      </div>
    </div>

    <div class="tr-foot">Google Play Store · '바다 그 날' 검색 · 무료</div>
  </div>

  <!-- ============ S13 · 시연 안내 ============ -->
  <div id="demo">
    <div class="demo-text">
      <span class="ln">지금부터</span>
      <span class="ln"><span class="em">주요 기능</span>을</span>
      <span class="ln">시연하겠습니다.</span>
    </div>
  </div>

  <!-- ============ S14 · 추진계획 (시기별 구현 방향) ============ -->
  <div id="roadmap">
    <div class="rm-chap">추진계획 · 시기별 구현 방향</div>
    <div class="rm-head">단기 · 중기 · 장기 — <span class="em">3단계 로드맵</span></div>
    <div class="rm-acc"></div>
    <div class="rm-sub">기존 인프라 재활용 → 지식기반 고도화 → 예측·플랫폼화. 추가 기능 발굴 병행.</div>

    <div class="rm-stack">
      <div class="rm-phase short">
        <div class="rm-badge">
          <div class="term">단기</div>
        </div>
        <div class="rm-content">
          <div class="rm-title">기존 인프라 재활용 — 즉시 체감 단계</div>
          <div class="rm-items">
            <div class="rm-item"><span class="pri">①</span><span class="lbl">위치 기반 태풍 내습 알림</span><span class="tag done">개발 완료</span></div>
            <div class="rm-item"><span class="pri">②</span><span class="lbl">위치 기반 특보정보 및 대피 침로·속력 안내</span><span class="tag done">개발 완료</span></div>
            <div class="rm-item"><span class="pri">③</span><span class="lbl">AI · 데이터 기반 특보예측 시스템</span><span class="tag ing">개발 중</span></div>
            <div class="rm-item"><span class="pri">④</span><span class="lbl">iOS용 어플리케이션 개발</span><span class="desc">— Android 외 iOS 출시로 사용자 확대</span></div>
            <div class="rm-item"><span class="pri">⑤</span><span class="lbl">능동 안전 브리핑</span><span class="desc">— 매일·특보 변동 시 선제 음성 알림</span></div>
            <div class="rm-item"><span class="pri">⑥</span><span class="lbl">자연어 앱 제어</span><span class="desc">— "○○해역 파고만 켜줘" 음성 명령</span></div>
            <div class="rm-item"><span class="pri">⑦</span><span class="lbl">RAG 1단계</span><span class="desc">— 어선안전조업법·출항통제 출처 기반 답변</span></div>
            <div class="rm-item"><span class="pri">⑧</span><span class="lbl">핸즈프리 긴급신고</span><span class="desc">— "나리야 신고" 시 GPS·선박·기상 자동 전송</span></div>
          </div>
        </div>
      </div>

      <div class="rm-arrow">▼</div>

      <div class="rm-phase mid">
        <div class="rm-badge">
          <div class="term">중기</div>
        </div>
        <div class="rm-content">
          <div class="rm-title">지식기반 · 개인화 고도화 단계</div>
          <div class="rm-items">
            <div class="rm-item"><span class="lbl">지식그래프 / 온톨로지</span><span class="desc">— 직군별 맞춤 조언 (어선·양식·낚시·해경)</span></div>
            <div class="rm-item"><span class="lbl">양방향 개인화</span><span class="desc">— AI가 먼저 관심사·활동해역을 되묻고 보정</span></div>
            <div class="rm-item"><span class="lbl">멀티홉 복합 추론</span><span class="desc">— "5톤 어선 60시간 후 조업 가능?" 등 종합 응답</span></div>
            <div class="rm-item"><span class="lbl">자연 음성 · 다국어</span><span class="desc">— TTS 적용 + 외국인 선원 다국어 응답</span></div>
          </div>
        </div>
      </div>

      <div class="rm-arrow">▼</div>

      <div class="rm-phase long">
        <div class="rm-badge">
          <div class="term">장기</div>
        </div>
        <div class="rm-content">
          <div class="rm-title">예측 · 자동대응 · 플랫폼화 단계</div>
          <div class="rm-items">
            <div class="rm-item"><span class="lbl">조난 표류 예측</span><span class="desc">— 마지막 위치 + 표류예측 → 구조세력 제공</span></div>
            <div class="rm-item"><span class="lbl">센서 연동 자동 SOS</span><span class="desc">— 스마트워치·선박센서 전복·익수 자동 신고</span></div>
            <div class="rm-item"><span class="lbl">GraphRAG 고도화</span><span class="desc">— 추론 본격화로 "해양안전 의사결정 플랫폼" 확장</span></div>
          </div>
        </div>
      </div>
    </div>

    <div class="rm-foot">단기 우선순위 ①②는 본 대회 발표 시점 기준 기능. 추가 기능 발굴 병행 진행.</div>
  </div>

  <!-- ============ S15 · 클로징 (Sunrise) ============ -->
  <div id="closing">
    <div class="c-line1">가장 복잡한 정보를</div>
    <div class="c-line2">가장 단순한 신호로</div>
    <div class="c-accent"></div>
    <div class="c-hand"><span>It's all you need</span></div>
    <div class="c-cta">검증된 <span class="em">SEA:GNAL</span>과 함께 갑시다.</div>
    <div class="c-presenter">제주해양경찰서 1505함 경사 신진섭</div>
    <div class="c-sun"></div>
    <svg class="c-vessel" viewBox="0 0 240 80" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      <g fill="#000">
        <!-- Hull -->
        <path d="M14,60 L26,67 L214,67 L228,60 L228,55 L14,55 Z"/>
        <!-- Main superstructure (long, mid-deck) -->
        <rect x="52" y="44" width="118" height="11"/>
        <!-- Bridge tower (forward) -->
        <rect x="66" y="32" width="40" height="12"/>
        <!-- Bridge upper -->
        <rect x="74" y="24" width="22" height="8"/>
        <!-- Mast vertical -->
        <rect x="83" y="4" width="3" height="20"/>
        <!-- Radar crossbar -->
        <rect x="76" y="11" width="17" height="2"/>
        <rect x="79" y="8" width="11" height="1.5"/>
        <!-- Antenna tip -->
        <rect x="83.7" y="0" width="1.6" height="4"/>
        <!-- Funnel (with cap) -->
        <rect x="124" y="36" width="14" height="19"/>
        <rect x="122" y="34" width="18" height="2"/>
        <!-- Aft helideck (slightly lower) -->
        <rect x="158" y="47" width="52" height="6"/>
        <!-- Stern flagpole (subtle) -->
        <rect x="212" y="48" width="1.5" height="9"/>
      </g>
    </svg>
    <div class="c-horizon"></div>
  </div>


</div></div>

<div id="steps">1 / 4 · 타이틀 · CLICK 으로 다음</div>
```

### 1.5 `<script>` JS 전체

상태머신·내비게이션·풀스크린/PIP·fit·분자그래프·카운트업·traction·s10 칩 패킹 전부(`slide02_preview.html:983–1304`).

```javascript
<script>
  const wrap = document.getElementById('wrap');
  const steps = document.getElementById('steps');
  let state = 0;
  const total = 16;
  const labels = ['타이틀', '좌측 강조 · 어르신 민원', '우측 강조 · 동료 대화', '결론 · 출발점', '흩어져 있는 정보들', '단계① 수요(세로)', '단계② 신호 정리안됨·낙수', '단계③ 7개+·민간 압축', '그래서 만들었습니다 (가운데)', '두 가지 원칙 (좌·우)', '한 앱에, 모든 바다 정보', '정보 획득 단계 축소', '시연 안내', '이미 운영 중', '추진계획', '맺음말'];
  let countersRun = false;
  let scNumRun = false;
  let trRun = false;
  let solTimer = null;
  function setState(n){
    state = Math.max(0, Math.min(total-1, n));
    wrap.classList.remove('s0','s1','s2','s3','s4','s5','s6','s7','s8','s9','s10','s11','s12','s13','s14','s15');
    wrap.classList.add('s' + state);
    steps.textContent = (state+1) + ' / ' + total + ' · ' + labels[state] + ' · CLICK 으로 다음';
    // s5 진입 시 세로 수치 카운터 1회 실행
    if(state === 5 && !countersRun){ countersRun = true; runCounters(); }
    if(state !== 5){ countersRun = false; }
    // s8(그래서 만들었습니다) 진입 0.5초 후 자동으로 s9(좌상단 이동 + 두 원칙)
    if(solTimer){ clearTimeout(solTimer); solTimer = null; }
    if(state === 8){ solTimer = setTimeout(() => { if(state === 8) setState(9); }, 500); }
    // s11 진입 시 -76 카운트업 (다다닥 빠르게)
    // s12(이미 운영 중) 진입 시 traction 카운트업
    if(state === 13 && !trRun){
      trRun = true;
      runTraction();
    }
    if(state !== 13){ trRun = false; }
    if(state === 11 && !scNumRun){
      scNumRun = true;
      const el = document.getElementById('sc-num');
      if(el){
        el.textContent = '0';
        const target = 65, dur = 950, delay = 1050;
        setTimeout(() => {
          const t0 = performance.now();
          function tick(now){
            const k = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - k, 2.4);
            el.textContent = Math.round(target * eased);
            if(k < 1) requestAnimationFrame(tick);
          }
          requestAnimationFrame(tick);
        }, delay);
      }
    }
    if(state !== 11){ scNumRun = false; }
  }

  // 수치 카운트업 (단계① 세로 수치)
  function runCounters(){
    document.querySelectorAll('#demand-vert .cu').forEach((el, idx) => {
      const to = parseFloat(el.dataset.to);
      const comma = el.dataset.comma === '1';
      const dur = 1300;
      const delay = 250 + idx * 160;
      el.textContent = comma ? '0' : '0';
      setTimeout(() => {
        const start = performance.now();
        function tick(now){
          const t = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - t, 3);
          const val = Math.round(to * eased);
          el.textContent = comma ? val.toLocaleString() : String(val);
          if(t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, delay);
    });
  }



  function runTraction(){
    document.querySelectorAll('#traction .tr-cu').forEach((el, idx) => {
      const target = parseFloat(el.dataset.target);
      const dec = parseInt(el.dataset.dec) || 0;
      const comma = el.dataset.comma === '1';
      const dur = 1200;
      const delay = 850 + idx * 110;
      setTimeout(() => {
        const t0 = performance.now();
        function tick(now){
          const k = Math.min(1, (now - t0) / dur);
          const eased = 1 - Math.pow(1 - k, 3);
          const val = target * eased;
          let display;
          if(comma) display = Math.round(val).toLocaleString();
          else if(dec) display = val.toFixed(dec);
          else display = Math.round(val).toString();
          el.textContent = display;
          if(k < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, delay);
    });
  }

  setState(0);

  // s7은 클릭/키보드 네비게이션에서 자동 건너뜀
  function nextState(s){ let n = s + 1; if(n === 7) n = 8; return Math.min(total - 1, n); }
  function prevState(s){ let p = s - 1; if(p === 7) p = 6; return Math.max(0, p); }

  // 첫 탭 시 풀스크린(주소창 숨김) — 모바일 브라우저 한정
  let fsAsked = false;
  function tryFullscreen(){
    if(fsAsked) return; fsAsked = true;
    const el = document.documentElement;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if(fn){ try{ fn.call(el).catch(()=>{}); }catch(_){} }
  }
  // 백그라운드로 나갈 때 영상 정지 → PIP 자동 진입 방지
  // 복귀 시 영상 재생 + 풀스크린 재요청 가능하도록 플래그 리셋
  const bgVideo = document.getElementById('bg-sea-video');
  document.addEventListener('visibilitychange', () => {
    if(document.hidden){
      if(bgVideo){ try{ bgVideo.pause(); }catch(_){} }
    } else {
      if(bgVideo){ try{ bgVideo.play().catch(()=>{}); }catch(_){} }
      fsAsked = false; // 첫 탭에서 다시 풀스크린 진입
    }
  });
  // PIP 자동 진입 차단(추가 보호)
  if(bgVideo){
    bgVideo.addEventListener('enterpictureinpicture', e => {
      try{ if(document.pictureInPictureElement) document.exitPictureInPicture(); }catch(_){}
    });
  }
  wrap.addEventListener('click', (e) => {
    tryFullscreen();
    const rect = wrap.getBoundingClientRect();
    const isLeftHalf = (e.clientX - rect.left) < rect.width / 2;
    if(isLeftHalf){
      if(state > 0) setState(prevState(state));
    } else {
      if(state < total - 1) setState(nextState(state));
    }
  });
  document.addEventListener('keydown', e => {
    if(e.key === ' ' || e.key === 'ArrowRight' || e.key === 'Enter'){ if(state < total-1) setState(nextState(state)); e.preventDefault(); }
    else if(e.key === 'ArrowLeft'){ if(state > 0) setState(prevState(state)); e.preventDefault(); }
    else if(e.key === 'r' || e.key === 'R'){ setState(0); }
  });

  function fit(){
    const w = window.innerWidth, h = window.innerHeight;
    const s = Math.min(w/1920, h/1080);
    wrap.style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  window.addEventListener('orientationchange', () => setTimeout(fit, 60));
  fit();

  /* === 분자형 7출처 그래프 (s4) 유기적 호흡 애니메이션 === */
  const CXG = 960, CYG = 638;
  const BASE_DIST = 285;
  const CENTER_RG = 115;
  const NODE_RG = 95;
  const N = 7;

  const gnodes = [];
  for(let i = 0; i < N; i++){
    const angle = (i / N) * Math.PI * 2 - Math.PI / 2;
    gnodes.push({
      angle,
      distPhase: i * 0.97,
      distFreq: 0.0006 + (i % 3) * 0.00009,
      distAmp: 18 + (i % 4) * 4,
      scalePhase: i * 1.31 + 0.6,
      scaleFreq: 0.00075 + ((i+1) % 4) * 0.00008,
      scaleAmp: 0.06 + ((i+1) % 3) * 0.015
    });
  }

  let vt = 0;          // 가상 시간(속도 가변 누적)
  let lastTs = null;
  let speedMul = 1;    // 현재 속도 배율
  function frameGraph(ts){
    if(lastTs === null) lastTs = ts;
    const dt = ts - lastTs;
    lastTs = ts;
    // s5~s7(블러 배경) 에서 1.5배속, 그 외 1배속 — 부드럽게 보간
    const targetSpeed = (state >= 5 && state <= 7) ? 1.5 : 1.0;
    speedMul += (targetSpeed - speedMul) * Math.min(1, dt / 350);
    vt += dt * speedMul;
    const t = vt;
    for(let i = 0; i < N; i++){
      const n = gnodes[i];
      const distBreath = Math.sin(t * n.distFreq + n.distPhase) * n.distAmp;
      const scaleBreath = 1 + Math.sin(t * n.scaleFreq + n.scalePhase) * n.scaleAmp;
      const dist = BASE_DIST + distBreath;
      const x = CXG + Math.cos(n.angle) * dist;
      const y = CYG + Math.sin(n.angle) * dist;

      const node = document.getElementById('gnode' + i);
      if(node){
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        node.style.transform = 'translate(-50%,-50%) scale(' + scaleBreath + ')';
      }

      const line = document.getElementById('line' + i);
      if(line){
        const startX = CXG + Math.cos(n.angle) * CENTER_RG;
        const startY = CYG + Math.sin(n.angle) * CENTER_RG;
        const r = NODE_RG * scaleBreath;
        const endX = x - Math.cos(n.angle) * r;
        const endY = y - Math.sin(n.angle) * r;
        line.setAttribute('x1', startX);
        line.setAttribute('y1', startY);
        line.setAttribute('x2', endX);
        line.setAttribute('y2', endY);
      }
    }
    requestAnimationFrame(frameGraph);
  }
  requestAnimationFrame(frameGraph);


  /* === S10 · 촘촘 패킹 (나선형 탐색) + 큰 진폭·빠른 모션 === */
  (function(){
    const features = {
      t0: ['AI 어시스턴트 "나리"', '해상기상전망', '해역별 특보 GIS', '임의 해점 종합', '태풍 통합', '기상부이', '물때 · 갯벌', '위치 자동 알림', '회피침로', '해안가 CCTV'],
      t1: ['기상예보', '해상일기도', '유향 · 유속', '풍향속', '파고', '해구별 기상', '태풍 경로', '행동지침', '바다낚시', '서핑', '갯벌체험', '바다갈라짐'],
      t2: ['물빠짐 예측', '강수량', '강수확률', '적설량', '특보 알림', '태풍 알림', '기온', '시정예측', '하늘상태', '특보구역', '조석정보', '해수욕', '위치 기반 정보', '특보예측'],
      t3: ['세계지도', '서핑지수', '갯바위 낚시', '스킨스쿠버', '공지사항', 'GPS', '즐겨찾기', '윈디', '제보기능', '기상청 전망', '중기예보', '단기예보', '7출처 통합', '4종 배경지도',
           '풍속', '풍랑', '돌풍', '습도', '운량', '체감기온', '자외선', '미세먼지', '음력', '월령', '일출', '일몰', '간조', '만조', '항만 정보', '레이더', '위성영상']
    };
    let seed = 47;
    function rand(){ seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    const phone = { cx: 960, cy: 670, halfW: 156, halfH: 278 };
    const safe = { left: 30, right: 1890, top: 320, bottom: 1030 };
    const fontByTier = { t0:15, t1:13, t2:12, t3:11 };
    const padXByTier = { t0:30, t1:26, t2:22, t3:20 };
    const padYByTier = { t0:18, t1:14, t2:12, t3:10 };
    // 모션 진폭 (각 칩의 최대 이동 반경 px) — 충돌 마진에 반영
    const motionByTier = { t0:13, t1:12, t2:11, t3:10 };

    function chipBounds(text, tier){
      const fs = fontByTier[tier];
      let w = 0;
      for(const c of text){
        if(/[가-힣]/.test(c)) w += fs * 0.99;
        else if(/[A-Z]/.test(c)) w += fs * 0.78;
        else if(/[a-z0-9]/.test(c)) w += fs * 0.58;
        else w += fs * 0.4;
      }
      return { w: w + padXByTier[tier], h: fs * 1.4 + padYByTier[tier] };
    }
    function insidePhone(x, y, w, h, mot){
      const mx = phone.halfW + w/2 + mot + 4;
      const my = phone.halfH + h/2 + mot + 4;
      return Math.abs(x - phone.cx) < mx && Math.abs(y - phone.cy) < my;
    }
    function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
    function overlapsAny(cand, list){
      for(const p of list){
        // 두 칩의 모션 진폭을 모두 합한 마진
        const margin = (cand.mot + p.mot) + 3;
        if(Math.abs(cand.x - p.x) < (cand.w + p.w)/2 + margin &&
           Math.abs(cand.y - p.y) < (cand.h + p.h)/2 + margin) return true;
      }
      return false;
    }

    const all = [];
    ['t0','t1','t2','t3'].forEach(k => features[k].forEach(t => all.push({text:t, tier:k})));

    const placed = [];

    function tryPlace(item){
      const b = chipBounds(item.text, item.tier);
      const mot = motionByTier[item.tier];
      const startR = { t0: 0, t1: 90, t2: 200, t3: 310 }[item.tier];
      for(let attempt = 0; attempt < 700; attempt++){
        const ang = rand() * Math.PI * 2;
        const r = startR + attempt * 1.4 + (rand() - 0.5) * 30;
        let x = phone.cx + Math.cos(ang) * r * 1.18;
        let y = phone.cy + Math.sin(ang) * r * 0.92;
        x = clamp(x, safe.left + b.w/2 + mot, safe.right - b.w/2 - mot);
        y = clamp(y, safe.top + b.h/2 + mot, safe.bottom - b.h/2 - mot);
        if(insidePhone(x, y, b.w, b.h, mot)) continue;
        const cand = { x, y, w: b.w, h: b.h, mot };
        if(overlapsAny(cand, placed)) continue;
        placed.push(cand);
        return cand;
      }
      // 실패 시 가장자리 빈자리 탐색 (마진 점진 완화)
      for(let relax = 0; relax <= 6; relax += 2){
        for(let i = 0; i < 200; i++){
          const x = safe.left + b.w/2 + mot + rand() * (safe.right - safe.left - b.w - 2*mot);
          const y = safe.top + b.h/2 + mot + rand() * (safe.bottom - safe.top - b.h - 2*mot);
          if(insidePhone(x, y, b.w, b.h, mot)) continue;
          const cand = { x, y, w: b.w, h: b.h, mot: Math.max(2, mot - relax) };
          if(!overlapsAny(cand, placed)){ placed.push(cand); return cand; }
        }
      }
      return null;
    }

    const root = document.getElementById('ap-chips');
    const anims = ['apFloatY', 'apFloatX', 'apFloatXY', 'apFloatD'];

    all.forEach(item => {
      const pos = tryPlace(item);
      if(!pos) return;
      const chip = document.createElement('div');
      chip.className = 'apchip ' + item.tier;
      chip.textContent = item.text;
      chip.style.left = pos.x + 'px';
      chip.style.top = pos.y + 'px';
      const an = anims[Math.floor(rand() * anims.length)];
      // 1.5배 빠르게 — 기존 5.5~10.5s를 3.7~7s로
      const dur = (11.1 + rand() * 9.9).toFixed(1);
      const dly = (-rand() * 18).toFixed(1);
      chip.style.animation = an + ' ' + dur + 's ease-in-out ' + dly + 's infinite';
      root.appendChild(chip);
    });
  })();
</script>
```

### 1.6 핵심 동작 메커니즘 정리

**(1) 상태머신 / 네비게이션**
- `setState(n)`이 `#wrap`의 단일 `.s{n}` 클래스를 교체 → 모든 슬라이드 표시/애니메이션은 CSS `#wrap.s{n} ...` 선택자로 구동. JS는 클래스 토글 + 1회성 카운트업 트리거만 담당.
- `total=16`. `nextState`/`prevState`는 **s7을 자동 건너뜀**(`n===7`이면 8로, `p===7`이면 6으로). 즉 클릭 시퀀스는 …s6 → s8 …, 역방향은 …s8 → s6 ….
- `s8` 진입 시 `solTimer`로 **0.5초 뒤 자동 `setState(9)`** ("그래서 만들었습니다" 가운데 → 좌상단 이동 + 두 원칙 등장). 도중 이탈 시 `clearTimeout`으로 취소.
- **좌우 반클릭 내비**: `wrap` 클릭 위치를 `getBoundingClientRect()` 기준으로 좌반(이전)/우반(다음) 판정. 키보드는 Space/→/Enter=다음, ←=이전, r/R=처음으로 리셋.

**(2) 배경영상 합성**
- `#bg-sea-video`(z-index:0) + `#bg-sea-overlay`(z-index:0, 검은 반투명)를 콘텐츠(z:auto / 각 슬라이드 z 5~100+) 아래에 깐다.
- 톤 차등: 기본 `filter:brightness(0.5) saturate(0.75)`. **s0(타이틀)**은 overlay `rgba(0,0,0,0.4)` 유지, **s1 이후(`:not(.s0)`)**는 overlay를 `rgba(0,0,0,0.58)`로 어둡게 + saturate 0.7로 차분하게. 모든 콘텐츠 패널(`#sol/#appone/#stepcut/#traction/#roadmap` 등)은 자체적으로 `background:rgba(0,0,0,0.55)` 가림막을 덧대 가독성 확보.
- **s15(클로징)에서 영상·오버레이를 `opacity:0`으로 숨김** → 클로징은 일출 그라디언트 배경(`#closing` linear-gradient)만 노출.
- JS `frameGraph`는 s5~s7에서 그래프 호흡 애니메이션을 1.5배속으로 보간(영상과 무관, 분자그래프 전용).

**(3) 모바일 풀스크린 / PIP 차단**
- 첫 탭 시 `tryFullscreen()`: `requestFullscreen`(벤더 프리픽스 폴백)로 주소창 제거. `fsAsked` 플래그로 1회만.
- `visibilitychange`: 백그라운드 진입 시 `bgVideo.pause()`로 **iOS/안드로이드 PIP 자동 진입 차단**, 복귀 시 `play()` + `fsAsked=false`로 재진입 허용.
- 추가 보호: `<video>`에 `disablepictureinpicture disableremoteplayback x-webkit-airplay="deny" controlslist="nodownload nofullscreen noremoteplayback"` 속성 + `enterpictureinpicture` 이벤트에서 `exitPictureInPicture()` 강제 탈출.
- `<head>`의 `apple-mobile-web-app-capable` / `mobile-web-app-capable` / `viewport-fit=cover`로 홈화면 추가 시 주소창 없는 PWA 실행.

**(4) `fit()` 스케일링**
- 1920×1080 고정 `#wrap`을 `Math.min(w/1920, h/1080)` 배율로 `transform:scale()`. `resize` 및 `orientationchange`(60ms 지연) 시 재계산.

**(5) 분자그래프 생성 (s4 / 블러배경 s5~s7)**
- 7개 노드(`#gnode0`~`#gnode6`)를 중심(960,638) 기준 원형 배치(각 `i/7*2π - π/2`). 각 노드는 `distFreq/distAmp`(거리 호흡) + `scaleFreq/scaleAmp`(크기 호흡) 사인파로 유기적 진동. SVG `line0`~`line6`의 끝점을 중심 반경(115)과 노드 반경(95×scale)에 맞춰 매 프레임 갱신해 "선이 노드에 닿는" 연결 유지. s5~s7에서 그래프 레이어는 CSS `blur(11px) scale(1.08) opacity:0.42`로 배경화되며 속도 1.5배.

**(6) 카운트업 3종**
- `runCounters()`(s5): `#demand-vert .cu`(어업인 9 / 낚시인 920 / 관광객 1,012) — `data-to`, `data-comma`로 천단위 콤마, easeOutCubic, idx별 stagger.
- s11 `#sc-num`: 평균 절차 감소율 **65%**까지 카운트업(target=65, dur=950, delay=1050, ease `pow(1-k,2.4)`).
- `runTraction()`(s13): `.tr-cu`(누적 이용자 1.5만+, 설치 1,351명, 유지율 80.6%, 알림 24.8만+, 1개월 정보제공 1.1만+) — `data-target`/`data-dec`/`data-comma`로 소수·콤마 포맷.
- 모든 카운트업은 `setState`의 `*Run` 가드 플래그로 진입당 1회만 실행, 상태 이탈 시 플래그 리셋.

**(7) s10 기능 칩 패킹**
- IIFE에서 4티어(t0~t3) 기능 단어 목록을 LCG 의사난수(seed=47)로 폰 목업(중심 960,670) 주변에 나선형 배치. `tryPlace`가 폰 영역(`insidePhone`)과 기존 칩(`overlapsAny`, 모션 진폭 합산 마진)을 회피하며 최대 700회 시도 + 실패 시 가장자리 완화 탐색. 배치 후 4종 float 애니메이션(`apFloatY/X/XY/D`) 중 랜덤 + 랜덤 duration(11.1~21s)·음수 delay로 위상 분산.

**(8) 클로징 'It's all you need' 구현**
- `#closing` 일출 연출: 하단 라디얼 글로우(`::before`, `cGlow` 펄스) + `.c-sun`(반원형 라디얼, `cSunPulse`) + `.c-horizon`(수평선 빛띠) + `.c-vessel`(역광 함정 실루엣 인라인 SVG, `fill:#000`).
- 텍스트 순차 fade-up: `.c-line1`("가장 복잡한 정보를", 흰색 104px) → `.c-line2`("가장 단순한 신호로", 주황 104px) → `.c-accent` → `.c-hand` → `.c-cta` → `.c-presenter`. 각 요소 기본 `opacity:0; translate(-50%,30px)` → `#wrap.s15`에서 `opacity:1; translate(-50%,0)` + transition-delay 0.35/0.7/1.0/1.25/1.5/1.65s로 단계 등장.
- **'It's all you need'** (`.c-hand`): `@font-face` base64 임베드된 **White Angelica** 손글씨 폰트(`font-family:'White Angelica','Nanum Pen Script',cursive`), **흰색 58px**, `text-shadow` 글로우. 내부 `span`에 `transform:skewX(-8deg)`로 기울인 필기체 느낌.

관련 파일: `/home/user/SEAGNAL/keynote_seagnal/slide02_preview.html` (해당 슬라이드), 동일 디렉터리에 `HANDOFF.md`, `index.html`, `manifest.json`, splash 이미지(`splash.png/jpg`) 등 키노트 자산이 함께 위치.

---

## 2. AI 비서 나리 소개 덱 (nari_intro.html)

### 2.1 개요 · 역할

`keynote_seagnal/nari_intro.html` 는 SEA:GNAL 의 핵심 기능인 대화형 해양안전 AI 비서 **'나리'** 를 발표 중 단독으로 소개하는 풀스크린 키노트 덱이다. 메인 키노트와 동일한 디자인 언어(검정 배경 `#07080a`, 오렌지 포인트 `#FF6B35`, Pretendard 폰트, 1920×1080 고정 캔버스 + `scale()` 핏)를 쓰되, 파일은 **독립 HTML 한 장**(약 12KB, 208줄)으로 자기완결적이다. 외부 의존은 CDN Pretendard 웹폰트 단 하나(`<link>` 11번 줄)뿐이고, 나머지 CSS·JS·콘텐츠는 전부 인라인이다. 서빙 시에는 `local_server/nari_intro.html` 에 동기화 사본이 존재한다(커밋 메시지상 "서빙용 local_server 사본 동기화").

현재 형태는 **2장 간결판**이다.
- **1장(slide0)** — 나리의 정체성 + 작동 원리(질문 → Gemini 2.5 두뇌 → 16개 도구 자율 호출 → 맞춤 답변의 4단계 흐름)
- **2장(slide1)** — "믿고 쓰는 AI" 신뢰 4박스(개인정보 단말 저장 / 실데이터 기반 / 공식 공공데이터 / 발표주기 최신화)

조작은 좌/우 클릭(좌측 절반=이전, 우측 절반=다음), 키보드(`Space`·`→`·`Enter`=다음, `←`=이전, `R`=처음으로), 하단 진행 점(dots) + `1 / 2` 페이지 라벨로 이뤄진다.

### 2.2 변천사 (git 이력 기준)

이 파일은 "단독 슬라이드 1장 → 4장 리치 버전 → 2장 간결판" 으로 크게 두 번 방향을 바꿨다. `git log` 기준 주요 분기점:

| 커밋 | 내용 |
|---|---|
| `bf3b40c` | AI 비서 '나리' 설명용 **단독 슬라이드 1장** 최초 추가 |
| `519b88f` | 카드 줄바꿈 정리 + **칩 궤도 회전 애니메이션** 도입(`orbitCW`/`orbitCCW`) |
| `b816475` | 칩 궤도 회전 속도 1/3로 감속(34s → 102s) |
| `9e3518c` | 단독 1장 → **4장 리치 버전**으로 확장 |
| `2c4f777` | 4장 덱 개정 — **칩 회전 버그 수정**·정확성 보강·구조 개편 |
| `665610e` | 정확성 정리 — **미구현 지식그래프/노드 수 제거**, 검증값만 유지 |
| `4e95a1a` | S3 연동 데이터를 '종류' 기준 표시(**개수 표기 제거**) |
| `74b1398` | 나리 **위치 처리 정직화** + 설문 표현 제거(대본·HTML·코드 일치) |
| `1572bd5` | 4장 → **2장 간결판**으로 재구성 |
| `593b8e3` / `00d2b1e` | 2장 보강(신뢰 박스), 4단계·최신화 박스 이동 정렬 |

**정확성 정리(과장 제거)의 핵심**: 리치 4장 버전에는 출품작이 실제로 구현하지 않은 표현이 섞여 있어 한 차례 대대적으로 솎아냈다.
- **지식그래프 / 노드 수** 설명 제거(`665610e` — "미구현 지식그래프/노드 제거, 검증값만 유지")
- **8직군 정식명칭 나열** 제거(리치판은 해양경찰/해양수산부/지방자치단체 등 4×2 그리드였으나, 현재 2장판에는 직군 열거가 없고 "직종 맞춤"이라는 일반화 표현만 남김)
- **"20개 도구"** → **"16개"** 로 정정(초기 칩 라벨이 "20개 해양 데이터 도구"였으나 실제 등록 도구 수 기준 16개로 수정)
- 연동 데이터 표기를 **개수 → 종류 기준**으로 전환(`4e95a1a` — "특보·예보·부이·조석·유향·수심·해무CCTV·태풍" 처럼 데이터 '종류'로 나열)
- **다출처(공식 공공데이터) 명시** — "기상청·국립해양조사원 등 검증된 공식 출처"로 한정
- **향후 고도화** 분리 — 미구현 기능(검색 그라운딩·병렬 최대6 등)은 본문에서 빼고 별도 향후 문구로만 처리(`2c4f777`: "미구현(검색 그라운딩·병렬 최대6) 제외", `ccd7c81`: "향후 문구 보강")
- **위치 정보 정직화**(`74b1398`) — "위치를 저장한다"가 아니라 "'내 근처' 질문 시에만 일시 사용, 저장 안 함"으로 정정. 이게 현재 2장 첫 박스의 핵심 문구다.

**칩 회전 버그(역회전 `reverse` 중복) 수정 경위** (`2c4f777`):

리치판 1장에는 코어 오브를 중심으로 4개의 칩(`.chip`)이 궤도(`.orbit`)를 따라 도는 위성 애니메이션이 있었다. 의도는 "궤도는 시계방향으로 돌되, 칩 텍스트는 항상 수평을 유지하도록 칩을 반대로 같은 속도로 역회전(상쇄)" 시키는 것이었다. 버그가 들어간 중간 버전(`9e3518c`)의 CSS는 다음과 같았다.

```css
.orbit{... animation:spin 120s linear infinite;}
.chip{... animation:spin 120s linear infinite reverse;}   /* ← reverse 포함 shorthand */
@keyframes spin{to{transform:translate(-50%,-50%) rotate(360deg);}}
.orbit{animation-name:spinO;} @keyframes spinO{to{transform:rotate(360deg);}}
.chip{animation-name:spinC;}  @keyframes spinC{to{transform:rotate(-360deg);}}  /* 이미 -360° */
```

문제는 **이중 역회전**이었다. `.chip` 의 shorthand `animation:spin ... reverse` 가 먼저 `reverse` 방향 플래그를 켜 둔 상태에서, 뒤따르는 규칙이 `animation-name` 만 `spinC` 로 덮어썼다. 그런데 `spinC` 키프레임 자체가 이미 `rotate(-360deg)`(역방향)로 정의돼 있어서, "이미 음의 회전" × "`reverse` 플래그"가 곱해져 부호가 다시 뒤집혔다. 결과적으로 칩이 궤도와 **상쇄되지 않고 같이 돌아** 텍스트가 거꾸로 뒤집히며 따라 도는(tumbling) 현상이 났다. (초기 정상 버전 `519b88f` 는 이 문제를 피하려고 `orbitCW`/`orbitCCW` 라는 별도 키프레임 쌍으로 명시적 정/역회전을 분리해 뒀었다.)

수정(`2c4f777`)은 커밋 메시지대로 "궤도 칩 뒤집힘 수정(orbitCW/CCW 정상 상쇄)"으로 처리했고, 이후 2장 간결판 재구성(`1572bd5`)에서 **칩·궤도 시스템 자체를 전부 제거**했다. 따라서 현재 파일에는 `.orbit`/`.chip`/`spinO`/`spinC` 가 더 이상 존재하지 않으며, 회전 애니메이션은 코어 링(`@keyframes ringSpin`, 78줄)과 호흡(`@keyframes breathe`, 79줄)·화살표 흐름(`@keyframes flow`, 80줄)만 남아 있다. 즉 버그는 "고친 뒤 해당 컴포넌트를 폐기"하는 방식으로 최종 봉합됐다.

### 2.3 현재 2장 구성

**1장(slide0) — 정체성 + 4단계 작동 흐름**

- 챕터 라벨 "SEA:GNAL · 대화형 해양안전 AI", 헤드 "AI 비서 '나리'"(따옴표 부분만 오렌지 `.em`), 부제 "제미나이 2.5를 두뇌로, 스스로 판단하는 자율 해양안전 비서"
- 우측 상단 **코어 오브**: 이중 링(`.core-ring` + `.core-ring.r2` 점선·역방향) 회전 + 오렌지 그라디언트 구체에 "나리 / Gemini 2.5 기반" 라벨, `breathe` 호흡 애니메이션
- 하단 **4단계 흐름**(`#flow`, 4개 `.fstep` + 사이 `.farrow` 화살표): STEP1 **질문**(음성·텍스트, 직종·위치 맥락 인식) → STEP2 **두뇌 · Gemini 2.5**(질문 분석해 실행계획 자율 수립, `.mid` 강조 박스) → STEP3 **도구 자율 호출**(해양 데이터 도구 **16개** 중 필요한 것만 실행) → STEP4 **맞춤 답변**(직종 맞춤 안내 + 앱 화면 바로가기)
- 푸터: "특보·예보·부이·조석·유향·수심·해무CCTV·태풍 등 공공 실데이터를 직접 연동"

**2장(slide1) — 신뢰 4박스**

헤드 "내 정보는 지키고, 답은 정직하게". `#rows` 안에 4개 `.trow`(아이콘 + 제목 + 설명):
1. 🔒 **개인정보는 단말에** — 대화·프로필은 휴대폰에만 저장, 위치는 '내 근처' 질문 시에만 **일시적으로** 쓰고 저장 안 함
2. ✅ **실데이터로만 답** — 가져온 실측·공공 데이터에만 근거, 없으면 모른다고 솔직히 답함
3. 📡 **공식 공공 데이터 기반** — 기상청·국립해양조사원 등 검증된 공식 출처만 사용
4. 🔄 **발표주기에 맞춰 최신화** — 특보·예보·관측값을 발표 시점에 맞춰 즉시 수집·갱신

(`#future` 향후 고도화 박스 CSS는 60~70번 줄에 정의돼 있으나, 현재 2장 본문 마크업에는 `#future` 요소가 배치돼 있지 않다 — 스타일만 남은 잔재.)

### 2.4 인터랙션 / 스케일링 로직 (script, 170~206줄)

- `total = 2`, `setState(n)` 이 `wrap` 의 `s0`/`s1` 클래스를 토글해 현재 슬라이드만 `opacity:1`(CSS 21번 줄 `#wrap.s0 #slide0,#wrap.s1 #slide1{opacity:1...}`), 동시에 해당 `.slide` 에 `.on` 부여 → `.rise` 요소들의 staggered 등장(`d1`~`d6` transition-delay)
- 클릭: `wrap` 좌측 절반 클릭=이전, 우측 절반=다음
- 키보드: `Space`/`→`/`Enter`=다음, `←`=이전, `r`/`R`=처음으로 리셋
- `fit()`: `Math.min(innerWidth/1920, innerHeight/1080)` 배율로 `wrap` 을 `scale()` → 어떤 화면 비율에서도 1920×1080 캔버스가 잘리지 않고 레터박스로 들어맞음. `resize`·`orientationchange`(60ms 지연) 시 재계산

### 2.5 파일 전체 코드

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
<title>AI 비서 '나리' 소개</title>
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;background:#000;font-family:'Pretendard',sans-serif;-webkit-font-smoothing:antialiased;color:#eef1f4;overflow:hidden;height:100%;-webkit-tap-highlight-color:transparent;user-select:none;-webkit-user-select:none;}
  *:focus{outline:none;}
  #stage{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#000;}
  #wrap{position:relative;width:1920px;height:1080px;flex:none;transform-origin:center center;cursor:pointer;
    background:radial-gradient(ellipse at 78% 30%, rgba(255,107,53,0.12) 0%, transparent 52%), #07080a;overflow:hidden;}

  .slide{position:absolute;inset:0;opacity:0;pointer-events:none;transition:opacity 0.6s ease;}
  #wrap.s0 #slide0,#wrap.s1 #slide1{opacity:1;pointer-events:auto;}

  .chap{position:absolute;left:130px;top:120px;color:#FF6B35;font-size:26px;letter-spacing:0.3em;font-weight:600;}
  .head{position:absolute;left:130px;top:178px;color:#fff;font-size:92px;font-weight:800;letter-spacing:-0.035em;line-height:1.1;}
  .head .em{color:#FF6B35;}
  .acc{position:absolute;left:132px;top:316px;width:96px;height:7px;background:#FF6B35;border-radius:4px;box-shadow:0 0 24px rgba(255,107,53,0.6);}

  .rise{opacity:0;transform:translateY(30px);transition:opacity 0.85s ease, transform 0.85s cubic-bezier(0.22,1,0.36,1);}
  .slide.on .rise{opacity:1;transform:translateY(0);}
  .slide.on .d1{transition-delay:0.12s;} .slide.on .d2{transition-delay:0.26s;} .slide.on .d3{transition-delay:0.42s;}
  .slide.on .d4{transition-delay:0.58s;} .slide.on .d5{transition-delay:0.74s;} .slide.on .d6{transition-delay:0.9s;}

  /* ===== 슬라이드 1 ===== */
  #s0-sub{position:absolute;left:130px;top:360px;width:980px;color:rgba(255,255,255,0.7);font-size:34px;font-weight:300;letter-spacing:-0.01em;word-break:keep-all;line-height:1.45;}
  #s0-sub b{color:#fff;font-weight:600;}

  /* 우측 코어 */
  .core{position:absolute;left:1500px;top:330px;}
  .core-ring{position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:330px;height:330px;border-radius:50%;border:1.5px solid rgba(255,107,53,0.28);animation:ringSpin 28s linear infinite;}
  .core-ring.r2{width:430px;height:430px;border-style:dashed;border-color:rgba(255,107,53,0.16);animation-duration:44s;animation-direction:reverse;}
  .core-orb{position:absolute;left:0;top:0;transform:translate(-50%,-50%);width:280px;height:280px;border-radius:50%;
    background:radial-gradient(circle at 34% 30%, #FF9866 0%, #FF6B35 55%, #C9430E 100%);
    box-shadow:0 0 100px rgba(255,107,53,0.55), inset 0 0 44px rgba(255,255,255,0.18);
    display:flex;flex-direction:column;align-items:center;justify-content:center;animation:breathe 4.2s ease-in-out infinite;}
  .core-orb .nm{font-size:92px;font-weight:800;letter-spacing:-0.02em;line-height:1;}
  .core-orb .role{font-size:25px;font-weight:500;color:rgba(255,255,255,0.92);margin-top:12px;}

  /* 4단계 흐름 */
  #flow{position:absolute;left:130px;right:130px;top:600px;display:flex;align-items:stretch;gap:0;}
  .fstep{flex:1;border:1px solid rgba(255,255,255,0.12);border-radius:20px;background:linear-gradient(150deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012));padding:26px 24px;display:flex;flex-direction:column;min-height:236px;}
  .fstep.mid{border-color:rgba(255,107,53,0.5);background:linear-gradient(150deg,rgba(255,107,53,0.15),rgba(255,107,53,0.03));box-shadow:0 0 44px rgba(255,107,53,0.16);}
  .fstep .fn{color:#FF6B35;font-size:19px;font-weight:700;letter-spacing:0.16em;}
  .fstep .ft{color:#fff;font-size:29px;font-weight:700;letter-spacing:-0.02em;margin-top:14px;word-break:keep-all;line-height:1.2;}
  .fstep .fd{color:rgba(255,255,255,0.66);font-size:20px;font-weight:300;margin-top:12px;line-height:1.45;word-break:keep-all;}
  .fstep .fd b{color:#FF8A5C;font-weight:600;}
  .farrow{flex:0 0 40px;display:flex;align-items:center;justify-content:center;color:rgba(255,107,53,0.7);font-size:34px;}
  .farrow .d{animation:flow 1.7s ease-in-out infinite;}
  #s0-foot{position:absolute;left:130px;top:910px;color:rgba(255,255,255,0.5);font-size:23px;font-weight:300;letter-spacing:-0.005em;}

  /* ===== 슬라이드 2 ===== */
  #rows{position:absolute;left:130px;right:130px;top:368px;display:flex;flex-direction:column;gap:22px;}
  .trow{display:flex;align-items:center;gap:30px;border:1px solid rgba(255,255,255,0.12);border-radius:20px;background:linear-gradient(150deg,rgba(255,255,255,0.05),rgba(255,255,255,0.012));padding:26px 42px;}
  .trow .ti{flex:0 0 78px;height:78px;border-radius:18px;background:rgba(255,107,53,0.16);border:1px solid rgba(255,107,53,0.45);display:flex;align-items:center;justify-content:center;font-size:38px;}
  .trow .th{color:#fff;font-size:33px;font-weight:700;letter-spacing:-0.02em;}
  .trow .td{color:rgba(255,255,255,0.68);font-size:25px;font-weight:300;margin-top:7px;line-height:1.4;word-break:keep-all;}
  .trow .td b{color:#FF8A5C;font-weight:600;}
  #future{position:absolute;left:130px;right:130px;top:880px;display:flex;align-items:center;gap:24px;padding:30px 44px;border-radius:22px;border:1px solid rgba(255,107,53,0.32);background:linear-gradient(135deg,rgba(255,107,53,0.12),rgba(255,107,53,0.03));}
  #future .ft{flex:none;color:#FF6B35;font-size:24px;font-weight:800;letter-spacing:0.06em;padding-right:26px;border-right:1px solid rgba(255,107,53,0.32);}
  #future .fx{color:rgba(255,255,255,0.86);font-size:28px;font-weight:400;letter-spacing:-0.01em;word-break:keep-all;}
  #future .fx b{color:#fff;font-weight:700;}

  /* 진행 표시 */
  #dots{position:absolute;left:50%;bottom:36px;transform:translateX(-50%);display:flex;gap:16px;z-index:50;}
  .dot{width:12px;height:12px;border-radius:50%;background:rgba(255,255,255,0.25);transition:all 0.4s ease;}
  .dot.on{background:#FF6B35;width:38px;border-radius:6px;}
  #pagelbl{position:absolute;right:44px;bottom:32px;color:rgba(255,255,255,0.4);font-size:19px;letter-spacing:0.1em;z-index:50;}

  @keyframes ringSpin{to{transform:translate(-50%,-50%) rotate(360deg);}}
  @keyframes breathe{0%,100%{box-shadow:0 0 100px rgba(255,107,53,0.55), inset 0 0 44px rgba(255,255,255,0.18);}50%{box-shadow:0 0 140px rgba(255,107,53,0.78), inset 0 0 50px rgba(255,255,255,0.24);}}
  @keyframes flow{0%,100%{opacity:0.35;transform:translateX(-7px);}50%{opacity:1;transform:translateX(7px);}}
</style>
</head>
<body>
<div id="stage"><div id="wrap" class="s0">

  <!-- ============ 1장 · 정체성 + 작동 ============ -->
  <section class="slide" id="slide0">
    <div class="chap rise">SEA:GNAL · 대화형 해양안전 AI</div>
    <div class="head rise d1">AI 비서 <span class="em">'나리'</span></div>
    <div class="acc rise d2"></div>
    <div id="s0-sub" class="rise d2">제미나이 2.5를 두뇌로, <b>스스로 판단하는</b> 자율 해양안전 비서</div>

    <div class="core rise d2">
      <div class="core-ring r2"></div>
      <div class="core-ring"></div>
      <div class="core-orb"><div class="nm">나리</div><div class="role">Gemini 2.5 기반</div></div>
    </div>

    <div id="flow">
      <div class="fstep rise d3">
        <div class="fn">STEP 1</div>
        <div class="ft">질문</div>
        <div class="fd">음성·텍스트로 묻기 <b>(직종·위치 맥락 인식)</b></div>
      </div>
      <div class="farrow rise d3"><span class="d">▶</span></div>
      <div class="fstep mid rise d4">
        <div class="fn">STEP 2</div>
        <div class="ft">두뇌 · Gemini 2.5</div>
        <div class="fd">질문을 분석해 <b>실행계획</b>을 스스로 수립</div>
      </div>
      <div class="farrow rise d4"><span class="d">▶</span></div>
      <div class="fstep rise d5">
        <div class="fn">STEP 3</div>
        <div class="ft">도구 자율 호출</div>
        <div class="fd">해양 데이터 도구 <b>16개</b> 중 필요한 것만 실행</div>
      </div>
      <div class="farrow rise d5"><span class="d">▶</span></div>
      <div class="fstep rise d6">
        <div class="fn">STEP 4</div>
        <div class="ft">맞춤 답변</div>
        <div class="fd"><b>직종 맞춤</b> 안내 + <b>앱 화면 바로가기</b></div>
      </div>
    </div>
    <div id="s0-foot" class="rise d6">특보·예보·부이·조석·유향·수심·해무CCTV·태풍 등 공공 실데이터를 직접 연동</div>
  </section>

  <!-- ============ 2장 · 믿음 + 앞으로 ============ -->
  <section class="slide" id="slide1">
    <div class="chap rise">믿고 쓰는 AI · 그리고 앞으로</div>
    <div class="head rise d1">내 정보는 지키고, <span class="em">답은 정직하게</span></div>
    <div class="acc rise d2"></div>

    <div id="rows">
      <div class="trow rise d3">
        <div class="ti">🔒</div>
        <div>
          <div class="th">개인정보는 단말에</div>
          <div class="td">대화·프로필은 <b>휴대폰에만 저장</b>. 위치는 '내 근처' 질문을 할 때만 <b>일시적으로</b> 쓰고 저장하지 않습니다.</div>
        </div>
      </div>
      <div class="trow rise d4">
        <div class="ti">✅</div>
        <div>
          <div class="th">실데이터로만 답</div>
          <div class="td">가져온 <b>실측·공공 데이터</b>에만 근거해 답하고, 없으면 <b>모른다고</b> 솔직히 말합니다.</div>
        </div>
      </div>
      <div class="trow rise d5">
        <div class="ti">📡</div>
        <div>
          <div class="th">공식 공공 데이터 기반</div>
          <div class="td"><b>기상청·국립해양조사원</b> 등 검증된 공식 출처의 데이터만 사용합니다.</div>
        </div>
      </div>
      <div class="trow rise d6">
        <div class="ti">🔄</div>
        <div>
          <div class="th">발표주기에 맞춰 최신화</div>
          <div class="td">특보·예보·관측값을 <b>발표 시점에 맞춰</b> 즉시 수집·갱신해, 늘 <b>최신 데이터</b>로 답합니다.</div>
        </div>
      </div>
    </div>
  </section>

  <div id="dots"><div class="dot"></div><div class="dot"></div></div>
  <div id="pagelbl">1 / 2</div>

</div></div>

<script>
  const wrap = document.getElementById('wrap');
  const slides = [0,1].map(i => document.getElementById('slide'+i));
  const dots = Array.from(document.querySelectorAll('#dots .dot'));
  const pagelbl = document.getElementById('pagelbl');
  const total = 2;
  let state = 0;

  function setState(n){
    state = Math.max(0, Math.min(total-1, n));
    wrap.classList.remove('s0','s1');
    wrap.classList.add('s'+state);
    slides.forEach((el,i)=> el.classList.toggle('on', i===state));
    dots.forEach((d,i)=> d.classList.toggle('on', i===state));
    pagelbl.textContent = (state+1)+' / '+total;
  }
  setState(0);

  wrap.addEventListener('click', (e)=>{
    const rect = wrap.getBoundingClientRect();
    const left = (e.clientX - rect.left) < rect.width/2;
    if(left){ if(state>0) setState(state-1); } else { if(state<total-1) setState(state+1); }
  });
  document.addEventListener('keydown', e=>{
    if(e.key===' '||e.key==='ArrowRight'||e.key==='Enter'){ if(state<total-1) setState(state+1); e.preventDefault(); }
    else if(e.key==='ArrowLeft'){ if(state>0) setState(state-1); e.preventDefault(); }
    else if(e.key==='r'||e.key==='R'){ setState(0); }
  });

  function fit(){
    const s=Math.min(window.innerWidth/1920, window.innerHeight/1080);
    wrap.style.transform='scale('+s+')';
  }
  window.addEventListener('resize',fit);
  window.addEventListener('orientationchange',()=>setTimeout(fit,60));
  fit();
</script>
</body>
</html>
```

### 2.6 인수인계 주의점

- **CDN 폰트 의존**: 11번 줄 `cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9` 웹폰트가 유일한 외부 링크다. 오프라인 발표 환경에서는 폰트가 시스템 fallback(`sans-serif`)으로 떨어진다 — 현장 시연 시 로컬 폰트 임베드 필요 여부 확인.
- **잔재 CSS**: `#future` 관련 스타일(60~70번 줄)은 정의돼 있으나 현재 마크업에 대응 요소가 없다. 향후 "고도화" 박스를 다시 넣을 경우 재활용 가능.
- **사본 동기화**: `keynote_seagnal/nari_intro.html` 수정 시 `local_server/nari_intro.html` 도 같이 갱신해야 서빙본과 어긋나지 않는다(과거 커밋들이 두 파일을 항상 동시 변경).
- **수치 정합성**: 도구 수 "**16개**"(115번 줄), 데이터 종류 나열(124번 줄), 위치 "**일시 사용·저장 안 함**"(138번 줄)은 정확성 정리를 거쳐 코드/대본과 일치시킨 값이다 — 임의 수정 금지(과장·미구현 표현이 다시 들어가지 않도록 주의).

---

## 3. 앱 코드 수정 (local_server/)

담당 파일: `local_server/js/admin.js`(관리자 화면 — 시연 버튼), `local_server/js/assistant.js`(AI 비서 '나리' 클라이언트 — 온보딩/질의). 나리 작동의 서버 측 두뇌 코드는 `local_server/routes/assistant.js`에 있다(3-3에서 인용).

### 3-1. 시연 버튼 (admin.js)

관리자 AI 탭의 'AI 비서' 제목 우측 주황색 '시연' 버튼. 발표용 별도 브라우저와 무관하게 앱 안에서 나리 소개 슬라이드(`nari_intro.html`)를 **가로(landscape) 전체화면 iframe 오버레이**로 띄운다.

동작 요약:
- **landscape 잠금**: `@capacitor/screen-orientation` 플러그인(`window.Capacitor.Plugins.ScreenOrientation.lock`)으로 앱 환경에서만 가로 잠금. 닫을 때 `portrait`로 복귀. 웹/미지원 환경은 try/catch로 무시.
- **iframe `/nari_intro.html`**: `position:fixed;inset:0;z-index:99999` 전체화면 오버레이에 캐시 무력화용 `?ts=Date.now()`를 붙인 iframe 삽입. 우상단 닫기(×) 버튼 포함.
- **PopupStack 뒤로가기**: `window.PopupStack.push('nari-demo-overlay', window.closeNariDemo)`로 등록 → 하드웨어 뒤로가기로 오버레이만 닫히고 앱이 종료되지 않게 함. 닫을 때 `PopupStack.remove`.
- 추가로 웹 풀스크린 API(`requestFullscreen`/`webkitRequestFullscreen`)도 시도(앱은 orientation lock만으로 충분).
- 중복 진입 방지: `nari-demo-overlay` 요소가 이미 있으면 즉시 return.

`window.openNariDemo` / `window.closeNariDemo` 전체 코드 (`local_server/js/admin.js:665-722`):

```javascript
window.openNariDemo = async function () {
    // 중복 진입 방지
    if (document.getElementById('nari-demo-overlay')) return;

    // 1) 화면을 가로로 잠금 (앱 환경에서만 동작; 웹은 무시)
    try {
        const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
        if (P && P.ScreenOrientation && P.ScreenOrientation.lock) {
            await P.ScreenOrientation.lock({ orientation: 'landscape' });
        }
    } catch (e) { /* 미지원 환경 무시 */ }

    // 2) 전체화면 오버레이 + iframe
    const ov = document.createElement('div');
    ov.id = 'nari-demo-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000;';
    ov.innerHTML =
        '<iframe src="/nari_intro.html?ts=' + Date.now() + '" ' +
        'style="position:absolute;inset:0;width:100%;height:100%;border:none;background:#000;" ' +
        'allow="fullscreen" allowfullscreen></iframe>' +
        '<button onclick="window.closeNariDemo()" aria-label="닫기" ' +
        'style="position:absolute;top:14px;right:14px;z-index:2;width:46px;height:46px;border-radius:50%;' +
        'background:rgba(0,0,0,.5);color:#fff;border:1px solid rgba(255,255,255,.35);font-size:1.2rem;cursor:pointer;' +
        'display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);">' +
        '<i class="fa-solid fa-xmark"></i></button>';
    document.body.appendChild(ov);

    // 3) 하드웨어 뒤로가기로 닫힘
    if (window.PopupStack) {
        try { window.PopupStack.push('nari-demo-overlay', window.closeNariDemo); } catch (e) {}
    }

    // 4) 시스템 바 숨김(웹 풀스크린 API; 앱은 orientation lock 으로 충분)
    try {
        const el = document.documentElement;
        const fn = el.requestFullscreen || el.webkitRequestFullscreen;
        if (fn) { const p = fn.call(el); if (p && p.catch) p.catch(() => {}); }
    } catch (e) {}
};

window.closeNariDemo = async function () {
    const ov = document.getElementById('nari-demo-overlay');
    if (ov) ov.remove();
    if (window.PopupStack) {
        try { window.PopupStack.remove('nari-demo-overlay'); } catch (e) {}
    }
    // 화면 방향 세로 복귀
    try {
        const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
        if (P && P.ScreenOrientation && P.ScreenOrientation.lock) {
            await P.ScreenOrientation.lock({ orientation: 'portrait' });
        }
    } catch (e) {}
    // 웹 풀스크린 해제
    try {
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen();
    } catch (e) {}
};
```

`renderUnifiedAiTab` 안 'AI 비서' 제목 우측 '시연' 버튼 HTML (`local_server/js/admin.js:730-738`):

```javascript
async function renderUnifiedAiTab(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
            <span><i class="fa-solid fa-robot" style="color:#22d3ee;"></i> AI 비서</span>
            <button onclick="window.openNariDemo()" title="AI 비서 '나리' 소개 슬라이드를 가로 전체화면으로 띄웁니다"
                    style="padding:7px 16px;background:linear-gradient(135deg,#FF6B35,#C9430E);color:#fff;border:none;border-radius:8px;font-weight:700;font-size:0.78rem;cursor:pointer;display:inline-flex;align-items:center;gap:7px;box-shadow:0 2px 10px rgba(255,107,53,.35);">
                <i class="fa-solid fa-display"></i> 시연
            </button>
        </div>
```

`renderUnifiedAiTab`은 파일 끝에서 전역으로 노출된다 (`local_server/js/admin.js:866`):

```javascript
window.renderUnifiedAiTab = renderUnifiedAiTab;
```

### 3-2. 직종 온보딩 재질문 수정 (assistant.js)

**원인**: 기존에는 온보딩 '건너뛰기' 시 `setProfile({})`로 **빈 객체 `{}`** 를 저장했고, 초기화 조건이 `if (getProfile() === null)`이었다. 빈 `{}`는 `null`이 아니므로 온보딩이 **영구 차단**되어, 직종을 한 번도 답하지 않은 사용자에게도 다시 묻지 못했다. 게다가 `seagnal_profile`은 localStorage에 저장되는데 **안드로이드 자동 백업(앱 데이터 백업)으로 이 빈 `{}` 값이 재설치 후에도 잔존**해, 새로 깐 사용자조차 온보딩을 못 보는 문제로 이어졌다. 수정은 (a) 트리거를 'occupation 없음 && !skipped'로 바꿔 직종이 없으면 다시 묻되, (b) 건너뛰기를 `setProfile({ skipped: true })`로 바꿔 '명시적으로 건너뜀'을 직종 없는 빈 프로필과 구분했다. 커밋 `8a03779` ("fix(나리): 직종 없으면 온보딩 재질문 — 빈 프로필 {} 로 영구 차단되던 문제").

프로필 저장소 정의 (`local_server/js/assistant.js:168-177`) — `localStorage`(휴대폰 로컬, 키 `seagnal_profile`)에만 저장:

```javascript
var PROFILE_KEY = 'seagnal_profile', MEMORY_KEY = 'seagnal_memory', MEMORY_MAX = 20;
var STYLE_KEY = 'seagnal_style', STYLE_REFRESH_EVERY = 8;

function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch (e) { return null; }
}
function setProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p || {})); } catch (e) {}
}
function clearProfile() { try { localStorage.removeItem(PROFILE_KEY); } catch (e) {} }
```

`startOnboarding` 정의 (`local_server/js/assistant.js:630-637`):

```javascript
function startOnboarding() {
  obMessages = [];
  obLog.innerHTML = '';
  profileBox.style.display = 'none';
  showMainUI(false);
  onboardEl.style.display = 'block';
  onboardTurn(); // 첫 인사/질문
}
```

온보딩 완료 시 서버가 돌려준 프로필 저장(여기서 `occupation` 등이 채워짐) — `onboardTurn` 내부 (`local_server/js/assistant.js:653-654`):

```javascript
if (d.done) {
  if (d.profile) setProfile(d.profile);
  finishOnboarding();
}
```

#### (a) 트리거 변경: `getProfile() === null` → 'occupation 없음 && !skipped'

**Before** (커밋 `8a03779` 이전):

```javascript
  // 프로필이 없으면 첫 실행 온보딩, 있으면 요약 표시
  if (getProfile() === null) {
    startOnboarding();
  } else {
    renderProfile();
    showMainUI(true);
  }
```

**After** (현재, `local_server/js/assistant.js:735-743`):

```javascript
  // 직종(occupation)이 없으면 온보딩으로 물어본다. 단, 사용자가 명시적으로 '건너뜀(skipped)'을
  // 선택한 경우에는 다시 묻지 않는다. (과거의 빈 프로필 {} 은 직종도 skipped도 없으므로 다시 물어봄)
  var _initProfile = getProfile();
  if (!_initProfile || (!_initProfile.occupation && !_initProfile.skipped)) {
    startOnboarding();
  } else {
    renderProfile();
    showMainUI(true);
  }
```

조건 `!_initProfile || (!_initProfile.occupation && !_initProfile.skipped)`의 의미: 프로필이 없거나(`null`), 또는 직종(`occupation`)도 없고 명시적 건너뜀(`skipped`)도 아닐 때 온보딩. 과거에 백업으로 남은 빈 `{}`는 `occupation`도 `skipped`도 없으므로 자동으로 다시 묻게 된다.

#### (b) 건너뛰기 변경: `setProfile({})` → `setProfile({ skipped: true })`

**Before** (커밋 `8a03779` 이전):

```javascript
  var obSkip = $('obSkip');
  if (obSkip) obSkip.addEventListener('click', function (e) {
    e.preventDefault();
    setProfile({}); // 빈 프로필로 저장(=온보딩 완료 표시) → 다음부터 안 물어봄
    finishOnboarding();
  });
```

**After** (현재, `local_server/js/assistant.js:672-677`):

```javascript
  var obSkip = $('obSkip');
  if (obSkip) obSkip.addEventListener('click', function (e) {
    e.preventDefault();
    setProfile({ skipped: true }); // 명시적 건너뜀 표시 → 다시 묻지 않음(직종 없는 빈 프로필과 구분)
    finishOnboarding();
  });
```

참고: 프로필 편집/삭제 버튼도 `startOnboarding`을 호출한다 (`local_server/js/assistant.js:710-717`). 삭제 시 `clearProfile()` + memory/style 제거 후 온보딩 재시작:

```javascript
  var editBtn = $('editProfile'), delBtn = $('deleteProfile');
  if (editBtn) editBtn.addEventListener('click', startOnboarding);
  if (delBtn) delBtn.addEventListener('click', function () {
    clearProfile();
    try { localStorage.removeItem(MEMORY_KEY); localStorage.removeItem(STYLE_KEY); } catch (e) {}
    renderProfile();
    startOnboarding();
  });
```

### 3-3. 참고: 나리 작동 핵심 코드

나리의 질의 처리 두뇌는 **서버 라우트** `local_server/routes/assistant.js`에 있다(클라이언트 `js/assistant.js`는 음성/UI·프로필·`POST /api/assistant/ask` 호출만 담당). 클라이언트가 `getProfile()`/`getMemory()`/`getStyle()`/`location`을 함께 보내면(`local_server/js/assistant.js:284`), 서버 `runBrain`이 **계획→도구 실행→실데이터 합성**으로 답을 만든다.

#### 클라이언트 위치 처리 (js/assistant.js)

"가까운/근처/내 위치" 류 질문이면 GPS 좌표를 먼저 얻어 함께 전송한다. `needsLocation`(`local_server/js/assistant.js:225-227`)과 `getUserLocation`(`:230-252`) — Capacitor Geolocation 우선, 없으면 브라우저 geolocation:

```javascript
  function needsLocation(query) {
    return /내\s*위치|현재\s*위치|가까운|가장\s*가까운|제일\s*가까운|근처|주변|여기서|여기/.test(query || '');
  }

  // 기기 위치 획득 — Capacitor Geolocation(권한 자동 처리) 우선, 없으면 브라우저 geolocation
  function getUserLocation() {
    return new Promise(function (resolve) {
      var Geo = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation)
        ? window.Capacitor.Plugins.Geolocation : null;
      if (Geo && Geo.getCurrentPosition) {
        var go = function () {
          Geo.getCurrentPosition({ enableHighAccuracy: false, timeout: 8000 })
            .then(function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); })
            .catch(function () { resolve(null); });
        };
        // 권한 프롬프트를 먼저 띄운 뒤 위치 조회
        if (Geo.requestPermissions) { Geo.requestPermissions().then(go).catch(go); } else { go(); }
        return;
      }
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          function (p) { resolve({ lat: p.coords.latitude, lon: p.coords.longitude }); },
          function () { resolve(null); }, { enableHighAccuracy: false, timeout: 8000 });
        return;
      }
      resolve(null);
    });
  }
```

서버 질의 페이로드 (`local_server/js/assistant.js:280-284`) — 프로필/메모리/성향/위치를 함께 전송:

```javascript
  function doAsk(query, loc) {
    fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query, profile: getProfile(), memory: getMemory(), style: getStyle(), location: loc })
    })
```

#### TOOL_CATALOG — 16개 도구 목록 전체 (routes/assistant.js)

`local_server/routes/assistant.js:585-606`. `planQuery`/`runBrain`의 프롬프트에 그대로 주입되는 도구 카탈로그(예보 4 + 관측 6 + 생활지수 3 + 위치기반 1 + 기타 2 = 16개):

```javascript
const TOOL_CATALOG = `
[예보]
- get_marine_forecast(zone): 명명된 해상예보구역(예: 제주도북부앞바다)의 단기 기상전망(풍향/풍속/파고/하늘).
- get_zone_forecast(zoneId, hoursAhead): 해구번호(예: "325")의 N시간 후 예보(파고/파주기/풍속/풍향). 미래 약 72시간까지.
- get_midterm_forecast(zone): 해역의 중기(3~10일) 해상예보.
- get_warning(zone): 해당 해역의 특보(주의보/경보) 발효 여부와 종류.
[관측]
- list_buoys_near(zone): 해당 해역 인근 기상부이 목록.
- get_buoy_observation(buoyName): 특정 부이의 최신 실측값(파고/풍속/수온/시정 등).
- get_current(lat, lon): 해당 좌표의 유향·유속(해류).
- get_depth(lat, lon): 해당 좌표의 수심.
- get_seafog_cctv(harbor): 항구 해무 CCTV 최신 영상(이미지 링크).
- get_tide(place): 지명/해역에서 가장 가까운 해점 좌표(고조/저조 상세 표출은 앱 바텀시트).
[생활지수]
- get_fishing_index(location): 바다낚시 지수(지점별 오전/오후 등급+어종).
- get_surfing_index(beach): 서핑 지수(해수욕장별 초/중/상급 등급, 파고·수온).
- get_sea_split_index(place): 바다갈라짐(갯벌) 가능 시간대/지수. place 생략 시 가능 지역 목록.
[위치기반]
- get_nearest_buoy(lat, lon): 좌표(사용자 GPS)에서 가장 가까운 기상부이의 위치 + 최신 관측값.
[기타]
- get_typhoon_status(): 현재 발효 중인 태풍 현황.
- resolve_location(text): 임의 지명을 좌표/주소로 변환(get_current/get_depth/get_tide 의 좌표 확보용).`;
```

각 도구의 실제 구현은 `TOOL_EXEC` 객체에 1:1로 매핑된다(`local_server/routes/assistant.js:662-771`). 예: `get_marine_forecast`→`buildForecastSummary`, `get_warning`→`findWarning`, `get_nearest_buoy`→`findNearestBuoys`+`getBuoyObs`. 모두 공개/사용자 데이터 한정이며 관리자 기능은 카탈로그에 없다.

#### runBrain — plan 실행 → 폴백 → 합성 (routes/assistant.js)

`planQuery`(`:774-799`)가 1단계로 질문을 `{steps:[{tool,args}], zone}` JSON 계획으로 변환하고, `runBrain`(`:802-827`)이 계획을 실행한 뒤 **수집결과(실데이터)에만 근거**해 음성용 2~4문장 구어체로 합성한다.

`planQuery` (`local_server/routes/assistant.js:774-799`) — GPS 좌표가 있으면 좌표기반 도구 안내 라인 추가:

```javascript
/** 1단계: 질문 → 가져올 데이터 계획(JSON) */
async function planQuery(query, profile, location) {
    const locLine = (location && location.lat != null && location.lon != null)
        ? `\n사용자 현재 위치(GPS): 위도 ${location.lat}, 경도 ${location.lon}. "내 위치/가까운/근처" 류 질문엔 이 좌표를 좌표기반 도구(get_nearest_buoy/get_current/get_depth/get_tide)에 넣으세요.`
        : '';
    const prompt =
`사용자의 한국어 질문에 답하기 위해 어떤 데이터를 가져올지 계획하세요.
사용 가능한 도구:
${TOOL_CATALOG}

규칙:
- 답에 꼭 필요한 도구만 steps 에 넣으세요(불필요한 호출 금지).
- 해역명/해구번호/지명/부이명을 args 에 정확히 넣으세요. 해구번호는 숫자 문자열(예: "325").
- "조업 가능?" 같은 판단 질문은 관련 예보(해구/해역)·특보·필요시 부이를 함께 모으세요.
- 관리자/설정/키 같은 건 도구가 없으니 무시하세요.${locLine}

사용자 프로필(참고): ${profile ? JSON.stringify(profile).slice(0, 500) : '없음'}
질문: "${query}"

JSON 으로만: {"steps":[{"tool":"<도구명>","args":{...}}], "zone":"<관련 해역명 또는 null>"}`;
    const r = await gemini.callGemini({
        model: BRAIN_MODEL, contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0 }, caller: 'Assistant-Plan'
    });
    if (!r.success || !r.text) return null;
    try { const p = JSON.parse(r.text); if (!Array.isArray(p.steps)) return null; return p; } catch (e) { return null; }
}
```

`runBrain` (`local_server/routes/assistant.js:802-827`) — 계획의 최대 6스텝만 실행, 각 도구 결과를 모아 `buildPersonalContext`로 만든 개인화 블록과 함께 합성 프롬프트(temperature 0.3)로 답변 생성:

```javascript
/** 2~3단계: 계획 실행 + 실데이터로 답변 종합 */
async function runBrain(query, profile, memory, style, location) {
    const plan = await planQuery(query, profile, location);
    if (!plan) return null;

    const results = [];
    for (const step of plan.steps.slice(0, 6)) {
        const exec = step && TOOL_EXEC[step.tool];
        if (!exec) continue;
        try { results.push({ tool: step.tool, args: step.args || {}, result: await exec(step.args || {}) }); }
        catch (e) { results.push({ tool: step.tool, error: e.message }); }
    }

    const personal = buildPersonalContext(profile, memory, style);
    const synth =
`당신은 한국 어선·항해자를 돕는 해양 기상 개인 비서입니다.
아래 "수집결과"의 실제 데이터에만 근거해 질문에 답하세요.
- 수집결과에 없는 수치/사실은 절대 지어내지 마세요. 없으면 솔직히 모른다고 하세요.
- 음성으로 읽어줄 2~4문장의 자연스러운 구어체. 핵심 수치 우선. 표/마크다운/이모지 금지.
- 조업 가능 여부 같은 안전 판단을 물으면 데이터에 근거해 조언하되, 마지막에 "최종 판단과 책임은 선장에게 있다"는 취지를 한 문장 덧붙이세요.
${personal}
질문: "${query}"
수집결과(JSON): ${JSON.stringify(results)}`;
    const r = await gemini.callGemini({ model: BRAIN_MODEL, contents: synth, config: { temperature: 0.3 }, caller: 'Assistant-Synth' });
    if (!r.success || !r.text) return null;
    return { answer: r.text.trim(), zone: plan.zone || null, toolsUsed: results.map(x => x.tool) };
}
```

**폴백 경로** (`local_server/routes/assistant.js:861-872`, 이하): `aiAvailable`이면 먼저 `runBrain`을 시도하고, 실패(`brain`/`answer` 없음 또는 예외)하면 결정론적 경로로 자동 폴백한다. 첫 폴백은 GPS 좌표 + "가까운 부이" 류 질문에 대한 `findNearestBuoys` 직접 응답(`:874-889`):

```javascript
    // [Tool Use 두뇌] AI 키가 있으면 먼저 두뇌로 처리(임의·복합 질문 이해 → 도구 실행 → 답변).
    //   실패하면 아래 결정론적 경로로 자동 폴백한다.
    if (aiAvailable) {
        try {
            const brain = await runBrain(query, profile, memory, style, loc);
            if (brain && brain.answer) {
                return res.json({
                    ok: true, zone: brain.zone, intent: 'brain', answer: brain.answer,
                    data: { toolsUsed: brain.toolsUsed }, aiUsed: true, zoneFromProfile: false,
                    links: buildLinks(query, null, brain.zone, profile), tideSearch: null
                });
            }
        } catch (e) { /* 두뇌 실패 → 결정론적 폴백으로 진행 */ }
    }
```

서버는 IP당 분당 20회 레이트리밋(`checkRateLimit`, `local_server/routes/assistant.js:526` 이하)으로 공유 Gemini 쿼터 남용을 막는다.

#### buildPersonalContext — 직종/성향/메모리 주입 (routes/assistant.js)

`local_server/routes/assistant.js:431-456`. 클라이언트가 보낸 `profile`(직종 등)·`style`(누적 통계/말투)·`memory`(최근 대화)를 합성 프롬프트용 참고 맥락 블록으로 만든다. **기상 수치는 반드시 "수집결과"에서만 가져오고, 이 블록은 말투·관심사·기본 해역·답변 길이 조절에만 쓰도록** 명시한다:

```javascript
function buildPersonalContext(profile, memory, style) {
    const lines = [];
    if (profile && (typeof profile === 'object' ? Object.keys(profile).length : String(profile).trim())) {
        const profileText = typeof profile === 'string' ? profile : JSON.stringify(profile);
        lines.push(`[사용자 프로필] ${profileText}`);
    }
    // [성향 다이제스트] 휴대폰에 누적된 통계 — 자주 묻는 주제/해역·선호 형식·말투
    if (style && typeof style === 'object') {
        const topN = (counts, n) => (counts && typeof counts === 'object')
            ? Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, n).map(e => e[0]) : [];
        const parts = [];
        if (style.totalQuestions) parts.push(`누적 질문 ${style.totalQuestions}회`);
        const tz = topN(style.zoneCounts, 3); if (tz.length) parts.push(`자주 보는 해역: ${tz.join(', ')}`);
        const tt = topN(style.topicCounts, 3); if (tt.length) parts.push(`관심 주제: ${tt.join(', ')}`);
        if (style.preferredFormat) parts.push(`선호 답변형식: ${style.preferredFormat}`);
        if (style.styleNote) parts.push(`말투/스타일: ${style.styleNote}`);
        if (parts.length) lines.push(`[사용자 성향] ${parts.join(' · ')}`);
    }
    if (Array.isArray(memory) && memory.length) {
        lines.push(`[최근 대화] ${memory.slice(-5).join(' / ')}`);
    }
    if (!lines.length) return '';
    return `\n아래는 이 사용자에 대한 참고 맥락입니다. 말투·관심사·기본 활동해역·답변 길이 조절에만 활용하고,
기상 수치는 반드시 위 "기상데이터"/"수집결과"에서만 가져오세요. 사용자가 '간단히'를 선호하면 더 짧게 답하세요.
${lines.join('\n')}\n`;
}
```

또한 질문에 해역이 없을 때 프로필의 기본 활동 해역을 뽑는 `profileDefaultZone`(`local_server/routes/assistant.js:463-477`)이 있어, `profile.location.zone`/`freeText`/문자열에서 유효 특보구역명을 결정론적으로 매칭한다.

---

## 4. 폼보드(홍보물)

### 4.1 양식·진행 방식

폼보드는 본선(2026.7.9 해양경찰청 대강당 입구 게시)에 걸리는 세로 1페이지 홍보물이다. 양식 파일은 `폼보드(홍보물) 양식.hwpx`로, **헤더 + 01~04 4구획** 구조다.

- **헤더**: 출품작 제목 / 한 줄 설명 / 차별 배지 / 소속·출품자 / 슬로건
- **01 왜 필요한가** — 문제 제기
- **02 무엇을 만들었나** — 솔루션
- **03 어떻게 보이나** — 앱 화면(스크린샷)
- **04 앞으로는** — 운영 실적 + 로드맵

**진행 방식(분업)**: 최종 **디자인은 본청 인공지능전환팀이 진행**한다. 우리(출품팀)는 **확정 문구(콘텐츠) + 이미지 배치 지시 + 첨부 이미지/인포그래픽**만 제공한다. 따라서 `formboard_content.md`는 "디자인 시안"이 아니라 "붙여넣을 확정 텍스트 + 이미지 지시서"이며, 직접 제작한 01·02 인포그래픽 HTML/JPG는 디자인팀에 넘기는 **콘텐츠 시안**이다. 제출 마감은 6.29(월) 15:00.

모든 인포그래픽 footer에는 `※ 본 안은 콘텐츠 시안 · 최종 디자인·수치 검증은 인공지능전환팀.` 문구를 고정으로 넣어 분업 책임을 명시했다.

### 4.2 콘텐츠 본문 — `keynote_seagnal/formboard_content.md` 전체

추천 본안(안1 · 현장공감·민원경감형) 본문 + 제출 전 정확성 체크리스트. `.docx` 동본도 같은 디렉토리에 존재(`formboard_content.docx`).

```markdown
# SEA:GNAL 폼보드(홍보물) 콘텐츠 — 본청 인공지능전환팀 제출용

> 양식: 폼보드(홍보물) 양식.hwpx (세로 1페이지, 헤더 + 01~04 구획)
> 디자인은 본청이 진행 → 본 문서는 **확정 문구 + 이미지 배치 지시**만 제공
> 제출 마감: 6.29(월) 15:00 / 본선 7.9(목) 해양경찰청 대강당 입구 게시

---

## ⚠️ 제출 전 반드시 확인할 숫자 (코드 감사 결과)

| 항목 | 상태 | 조치 |
|---|---|---|
| 설치 유지율 80.6% | ⚠️ **위험** | 코드(admin.js calcRetention)는 **푸시 구독 유지율**이지 Play Console **설치 유지율**이 아님. 둘은 다른 지표 → 출처를 Play Console로 명확히 하거나 라벨을 정확히 |
| 누적 이용자 1.5만+ / 안드로이드 설치 1,351 | ⚠️ 모수 상이 | "누적 이용자(웹 포함)" vs "안드로이드 설치"로 모수 1줄 명시 |
| 특보 알림 24.8만+ | ⚠️ repo 미검증 | 프로덕션 push_counter 실값으로 재확인. "발송 건수"로만 표기(=절감 통화량 직역 금지) |
| 해양정보 제공 1.1만+ | ⚠️ repo 미검증 | GET /api/stats/usage 실값 재확인 |
| AI 도구 개수 | 19 vs 20 혼재 | 코드=19, 소개문=20 → **하나로 통일** (권장: "약 20개" 또는 "19개") |
| 카카오 알림톡 공식문구 | ❌ 미구현 | 기능 칸에서 제외(서버에 발송 구현 없음) |
| 핸즈프리 긴급신고 | ❌ 미구현 | tel:119 링크일 뿐 → '앞으로는(로드맵)'에만 |
| 매일 443개 지점 물빠짐 | ⚠️ 고정값 아님 | "전국 조석/물때 매일 자동 수집"으로 순화 |
| 65% 감소 / 3회 터치 | ⚠️ 코드 증빙 불가 | "핵심정보 최소 동선"으로 완화 또는 산정근거 병기 |
| **검증 OK (자신있게 사용)** | ✅ | 지식그래프 **978노드/1,232관계**(≈1,000/1,200), Gemini **2.5(flash-lite)**, 기상청 4계열+국립해양조사원 6계열 통합, 특보 생애주기·태풍 반경 판정·온디바이스 처리, 8직군 |

> 모든 운영 실적 숫자에 **집계 기준일 + 출처(Play Console·서버 집계)** 병기 권장.

---

## ★ 추천 본안 (안1 · 현장공감·민원경감형) — 즉시 붙여넣기

### [헤더]
```
[출품작 제목] SEA:GNAL (바다 : 그 날의 신호)
[한 줄 설명] 7개+ 공공기관에 흩어진 해양정보를 앱 하나로 묶고, 자율 AI '나리'가 지키는 국산 해양안전 플랫폼
[차별 배지] 현업 해양경찰관 직접 개발 · 2025.3 출시 운영중 · Gemini 2.5 자율 에이전트
[소속/출품자] 제주해양경찰서 1505함 경사 신진섭 (현업 경찰관 직접 개발)
[슬로건] 특보 한 번에 울리던 전화벨을, 앱 하나로 잠재우다
```

### [01 왜 필요한가]
```
특보 한 번에 파출소로 쏟아지는 같은 질문. "오늘 배 띄워도 됩니까?" "우리 해역 경보 떴습니까?"
· 해양정보는 7개+ 공공기관에 흩어져 있다 — 기상청·국립해양조사원·한국천문연구원·방재기상플랫폼·해양기상기후포털·지자체
· 국민은 결국 민간앱(Windy)에 의존하지만, 한국 해상특보는 연동되지 않는다
· 그 공백은 고스란히 일선 파출소의 반복 민원·통화로 돌아온다
[지휘부 한 줄] = 일선 현장 응대 부담 ↑, 국산 공공정보 신뢰 공백
[넣을 이미지] 흩어진 7개 기관 아이콘 → SEA:GNAL '앱 하나'로 수렴하는 before/after 다이어그램 (디자인팀 제작)
```

### [02 무엇을 만들었나]
```
■ 앱(플랫폼): '앱 하나에 모든 해양정보' (50+ 기능)
· 해역별 특보 즉시 알림 — 발표·발효·격상·격하·해제 전 과정
· 태풍 발생·소멸·내습 알림 + 행동요령
· 해양종합정보 지도 — 유향·유속, 풍향·풍속, 파고·파향, 기상부이, 해무 CCTV 레이어
· 물때/조석, 위치기반 특보·최단 대피침로 (위치는 단말에서만 판정, 서버로 전송되지 않음)
■ AI '나리' — 단순 챗봇이 아닌 자율 에이전트
입력(음성/텍스트 질문 + 직군·위치) → 두뇌 Gemini 2.5 → 해양 데이터 도구 약 20개를 스스로 선택·병렬 호출 → 직군 맞춤 답변 + 앱 화면 바로가기
[숫자 카드] 약 20개 자율 도구 · 지식그래프 978노드/1,232관계 · 8개 직군 맞춤 · 대화기억 온디바이스(개인정보 보호)
[넣을 이미지] 입력→Gemini 2.5→약 20개 도구 자율 호출→직군 맞춤 출력 다이어그램 (디자인팀 제작) / 제주 돌하르방 마스코트
```

### [03 어떻게 보이나]
```
① 특보 즉시 알림 — 발효·격상·해제가 뜨는 즉시 푸시 (08_warn_information.jpg / 07_push_notification.jpg)
② 해양종합정보 레이어 — 유향속·파고파향·부이·해무 CCTV 한 화면 (04_marine_zone_data_10.jpg)
③ 오늘 물 빠지는 시각, 한 화면에 (06_tide_astronomical_data.jpg)
④ AI 나리 대화 — 묻기만 하면 화면 바로가기까지 (01_main_page_7.jpg)
⑤ 해역별 단기예보 — 파고·바람 시계열 (03_weather_forecast_10.jpg)
[캡션 원칙] 기능명이 아니라 '사용자가 얻는 것'으로 — 예: "③ 오늘 물 빠지는 시각, 한 화면에"
```

### [04 앞으로는]
```
■ 운영 실적 (Google Play Console·서버 집계 기준, 2026.6.◯◯ 기준 ※제출 전 기준일·실값 확정)
· 2025.3.30 출시 — 1년+ 실전 운영
· 누적 이용자 1.5만+ / 안드로이드 설치 1,351 · 설치 유지율 80.6%
· 특보 알림 24.8만+ 발송 / 해양정보 제공 1.1만+
■ 현장의 목소리
"윈디보다 100배 나은 국산 어플" · "업무에 엄청 많은 도움"
■ 확장 로드맵
· 단기: 위치기반 태풍·특보 알림(완료), AI 특보 예측, iOS, RAG 1단계
· 중기: 직군 지식그래프·온톨로지, 멀티홉 추론, 다국어 TTS
· 장기: 조난 표류 예측, 센서 연동 자동 SOS, GraphRAG '해양안전 의사결정 플랫폼'
[클로징] 민간앱 의존을 끊는 국산 공공 대안 + 일선 민원부담 경감 + 해양안전 의사결정 플랫폼으로 — 파출소·상황실·구조 현장으로 확장
[제작] 제주해양경찰서 1505함 경사 신진섭 — 현업 경찰관이 직접 개발
```

---

## 첨부 이미지 (local_server/assets/)
- screenshots_upload/08_warn_information.jpg (특보)
- screenshots_upload/07_push_notification.jpg (푸시)
- screenshots_upload/04_marine_zone_data_10.jpg (해양종합정보)
- screenshots_upload/06_tide_astronomical_data.jpg (조석/물때)
- screenshots_upload/01_main_page_7.jpg (메인/AI)
- screenshots_upload/03_weather_forecast_10.jpg (해역 예보)
- dolhareubang_cute_v2.png (AI 나리 마스코트)
- seagnal_feature_graphic_1024x500_*.png (헤더 배너)
```

> **주의(콘텐츠 vs 인포그래픽 불일치)**: `formboard_content.md`는 도구 수를 "약 20개", 지식그래프 "978노드/1,232관계"로 적었으나, 이후 정확성 정리(HANDOFF.md 기준)로 인포그래픽(`formboard_what.html`)과 나리 덱에서는 **도구 16개로 통일**하고 지식그래프 노드 수는 제거했다. `.md`의 "약 20개"·노드 수치는 체크리스트의 "19 vs 20 혼재 → 통일" 항목과 함께 **제출 전 최종 통일 대상**으로 남아 있다.

### 4.3 10개 안 목록 — `keynote_seagnal/formboard_options/`

각 안은 별도 `.docx`로 생성되어 있다(파일명 = 안 번호 + 유형). 같은 4구획 양식에 강조점만 달리한 방향 안들이다.

| 안 | 파일명 | 유형/제목 |
|---|---|---|
| 안1 | `formboard_안1_현장공감·민원경감형.docx` | 현장공감·민원경감형 **(★추천 본안)** |
| 안2 | `formboard_안2_현업개발자 진정성형.docx` | 현업 개발자 진정성형 |
| 안3 | `formboard_안3_자율 AI 에이전트 기술쇼케이스형.docx` | 자율 AI 에이전트 기술쇼케이스형 |
| 안4 | `formboard_안4_지식그래프 데이터자산형.docx` | 지식그래프 데이터자산형 |
| 안5 | `formboard_안5_온디바이스 프라이버시·신뢰형.docx` | 온디바이스 프라이버시·신뢰형 |
| 안6 | `formboard_안6_능동·선제 안전형.docx` | 능동·선제 안전형 |
| 안7 | `formboard_안7_공공데이터 통합 허브형.docx` | 공공데이터 통합 허브형 |
| 안8 | `formboard_안8_국산화·기술주권형.docx` | 국산화·기술주권형 |
| 안9 | `formboard_안9_안전·생명 미션형.docx` | 안전·생명 미션형 |
| 안10 | `formboard_안10_민원경감·업무효율형.docx` | 민원경감·업무효율형 |

추천 채택: **안1(현장공감·민원경감)을 본안**으로 하고, **안3(자율 에이전트)·안5(온디바이스 신뢰)** 요소를 흡수(HANDOFF.md §4 기준).

### 4.4 01 왜 필요한가 — `keynote_seagnal/formboard_why2.html` (최신 인포그래픽)

01 구획의 **최신본**은 `formboard_why2.html`이다. 구버전 `formboard_why.html`(및 초기 3안 `formboard_why_A/B/C.html`)에는 "윈디 미연동/920만" 등 옛 문구가 남아 있으므로 **사용 금지**, 최신은 `formboard_why2.html`만이다.

폰트는 경량 CDN(Pretendard min.css, 약 7KB)을 링크해 채팅 전송이 가벼운 본(本)이고, JPG 렌더 시에는 별도 임베드본(`formboard_why2_embed.html`, 약 2.75MB)을 쓴다(4.6 레시피).

**구조**: 3박스. ①해양 활동 인구 증가(요소별 큰 숫자 before→after) ②공공 정보 파편화(방사형) ③해경 부담(하단 바).

**데이터·출처(footer 근거, `formboard_why2.html:109`)**:

| 항목 | before | after | 출처 |
|---|---|---|---|
| 낚시 인구 | 850만 (2018) | 1,000만 (2024 예상) | 해양수산부 |
| 수상레저 조종면허(누적) | 11.1만 (2011) | 28.7만 (2021) | 해양경찰청 |
| 해수욕장 이용객 | 약 3,800만 (2023) | 4,110만 (2024, 개장기간·전년比 **+8.2%**) | 해양수산부 |

(관광객/방문객 지표는 코로나 등락으로 '증가' 근거 부적합 → 해수욕장으로 대체.)

**방사형 좌표 고정 정렬 방식**: 박스2의 방사형은 **컨테이너 `.radial`(width:460px·height:430px) = `<svg>`(width 460·height 430·viewBox 0 0 460 430) = 노드 절대좌표(left/top px)** 를 모두 **460×430 동일 좌표계**로 맞춰 SVG 연결선과 노드가 어긋나지 않게 정렬을 보장한다(`formboard_why2.html:30,80,81`). 중앙 "해양정보" 원과 6개 기관 노드는 `transform:translate(-50%,-50%)`로 좌표가 중심 기준이 되며, 중심(230,205)에서 6방향으로 선(`<line x1="230" y1="205" …>`)을 그어 육각 균형 배치한다. 노드 6개 좌표: 기상청(230,40)·국립해양조사원(373,123)·한국천문연구원(373,287)·지방자치단체(230,370)·방재기상플랫폼(87,287)·기타(87,123).

**⚠️ 미반영 사용자 요청 3건 (다음 세션에서 적용)** — 현재 HTML에는 아래가 **반영되지 않은 상태**다:

1. **박스1 제목** `formboard_why2.html:54` 현재 `해양 활동 인구, 매년 증가` → 요청: **"해양 활동 인구**는** 매년 증가"** (쉼표 → '는')
2. **박스2 제목** `formboard_why2.html:79` 현재 `공공 정보가 여러 기관에 흩어져` → 요청: **"공공 정보**는** 여러 기관에 흩어져"** ('가' → '는')
3. **박스3 문구** `formboard_why2.html:106` 현재 `그 정보 제공 부담은 고스란히 해양경찰의 몫이 되고 있습니다` → 요청: **"그 정보 제공은 고스란히 **현장의 부담으로 작용**하고 있습니다"** (+ 다음 줄 "(특보 및 기상정보 문의 민원 등)" 유지). ※'짊어지는 중'보다 가벼운 표현 요청 → '현장의 부담'으로.

**`formboard_why2.html` 전체 코드** (CDN-폰트 경량본):

```html
<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{font-family:'Pretendard',sans-serif;-webkit-font-smoothing:antialiased;background:#e3ebf3;}
#card{width:1280px;min-height:980px;background:linear-gradient(180deg,#eef3f8,#e3ebf3);padding:54px 52px 46px;}
.h{display:flex;align-items:center;gap:20px;}
.h .no{background:#FF6B35;color:#fff;font-weight:800;font-size:42px;border-radius:15px;padding:7px 20px;box-shadow:0 6px 18px rgba(255,107,53,.35);}
.h .t{color:#15243a;font-size:50px;font-weight:800;letter-spacing:-.03em;}
.sub{color:#5b6b80;font-size:25px;font-weight:500;margin:13px 0 30px 2px;letter-spacing:-.01em;}
.sub b{color:#FF6B35;font-weight:700;}
.cardbox{background:#fff;border-radius:24px;box-shadow:0 10px 30px rgba(30,50,80,.08);border:1px solid #d8e2ee;}
.ctt{color:#15243a;font-size:30px;font-weight:800;letter-spacing:-.02em;}
.ctt .o{color:#FF6B35;}
.top{display:flex;gap:28px;align-items:stretch;margin-bottom:28px;}

/* 박스1: 3열 before→after — 고정 높이로 행 정렬 */
.cols{display:flex;margin-top:26px;}
.col{flex:1;display:flex;flex-direction:column;align-items:center;position:relative;}
.col + .col::before{content:"";position:absolute;left:0;top:8%;height:84%;width:1px;background:#e6edf4;}
.col .lbl{width:172px;text-align:center;background:#f1f5fa;border:1px solid #e0e8f1;border-radius:24px;
 padding:9px 0;color:#34465c;font-size:22px;font-weight:700;white-space:nowrap;}
.col .b1{height:54px;display:flex;align-items:flex-end;color:#5b6b80;font-size:42px;font-weight:800;letter-spacing:-.03em;margin-top:20px;}
.col .yr{height:26px;color:#9aa8bb;font-size:20px;font-weight:600;margin-top:4px;}
.col .arr{height:44px;display:flex;align-items:center;color:#FF6B35;font-size:34px;font-weight:800;}
.col .b2{height:62px;display:flex;align-items:flex-end;color:#FF6B35;font-size:56px;font-weight:800;letter-spacing:-.035em;}
.col .yr2{height:26px;color:#9aa8bb;font-size:20px;font-weight:600;margin-top:4px;}

/* 박스2: 방사형 — 컨테이너=SVG=노드 좌표계 모두 460x430 고정(정렬 보장) */
.radial{position:relative;width:460px;height:430px;margin:10px auto 0;}
.radial svg{position:absolute;left:0;top:0;}
.node{position:absolute;transform:translate(-50%,-50%);background:#eef2f7;border:1px solid #d3deea;border-radius:24px;padding:11px 16px;color:#34465c;font-weight:700;font-size:20px;white-space:nowrap;box-shadow:0 4px 12px rgba(30,50,80,.06);}
.center{position:absolute;transform:translate(-50%,-50%);width:132px;height:132px;border-radius:50%;
 background:radial-gradient(circle at 34% 30%,#FF9866,#FF6B35 60%,#C9430E);color:#fff;display:flex;align-items:center;justify-content:center;
 font-size:28px;font-weight:800;box-shadow:0 0 38px rgba(255,107,53,.4);text-align:center;line-height:1.15;z-index:2;}
.rcap{color:#93a2b5;font-size:20px;text-align:center;margin-top:10px;}

/* 박스3 */
.bottom{display:flex;align-items:center;gap:26px;padding:30px 40px;}
.bottom .ic{flex:0 0 78px;height:78px;border-radius:18px;background:rgba(255,107,53,.13);display:flex;align-items:center;justify-content:center;font-size:40px;}
.bottom .bt{color:#1f3047;font-size:30px;font-weight:500;line-height:1.55;letter-spacing:-.01em;}
.bottom .bt b{color:#15243a;font-weight:800;}
.bottom .bt .o{color:#FF6B35;font-weight:800;}
.bottom .bt .sm{color:#7c8aa0;font-size:24px;font-weight:600;}
.foot{color:#93a2b5;font-size:16px;line-height:1.5;margin-top:20px;}
</style></head><body>
<div id="card">
 <div class="h"><span class="no">01</span><span class="t">왜 필요한가</span></div>
 <div class="sub">바다를 쓰는 사람은 <b>매년 늘어나는데</b>, 공공 정보는 <b>여러 기관에 흩어져</b> 있습니다</div>

 <div class="top">
   <!-- 좌: 3요소 before→after 큰 숫자 -->
   <div class="cardbox" style="flex:1;padding:30px 30px 36px;">
     <div class="ctt">해양 활동 인구, <span class="o">매년 증가</span></div>
     <div class="cols">
       <div class="col">
         <span class="lbl">낚시 인구</span>
         <div class="b1">850만</div><div class="yr">2018년</div>
         <div class="arr">↓</div>
         <div class="b2">1,000만</div><div class="yr2">2024년</div>
       </div>
       <div class="col">
         <span class="lbl">수상레저 면허</span>
         <div class="b1">11.1만</div><div class="yr">2011년</div>
         <div class="arr">↓</div>
         <div class="b2">28.7만</div><div class="yr2">2021년</div>
       </div>
       <div class="col">
         <span class="lbl">해수욕장 이용객</span>
         <div class="b1">3,800만</div><div class="yr">2023년</div>
         <div class="arr">↓</div>
         <div class="b2">4,110만</div><div class="yr2">2024년</div>
       </div>
     </div>
   </div>

   <!-- 우: 파편화 방사형(균형) -->
   <div class="cardbox" style="flex:1;padding:30px 34px;">
     <div class="ctt">공공 정보가 <span class="o">여러 기관에 흩어져</span></div>
     <div class="radial">
       <svg width="460" height="430" viewBox="0 0 460 430">
         <g stroke="#c4d2e2" stroke-width="2.5">
           <line x1="230" y1="205" x2="230" y2="40"/>
           <line x1="230" y1="205" x2="373" y2="123"/>
           <line x1="230" y1="205" x2="373" y2="287"/>
           <line x1="230" y1="205" x2="230" y2="370"/>
           <line x1="230" y1="205" x2="87" y2="287"/>
           <line x1="230" y1="205" x2="87" y2="123"/>
         </g>
       </svg>
       <div class="center" style="left:230px;top:205px;">해양<br>정보</div>
       <div class="node" style="left:230px;top:40px;">기상청</div>
       <div class="node" style="left:373px;top:123px;">국립해양조사원</div>
       <div class="node" style="left:373px;top:287px;">한국천문연구원</div>
       <div class="node" style="left:230px;top:370px;">지방자치단체</div>
       <div class="node" style="left:87px;top:287px;">방재기상플랫폼</div>
       <div class="node" style="left:87px;top:123px;">기타</div>
     </div>
     <div class="rcap">하나로 모인 창구가 없어, 정보가 기관마다 흩어져 있습니다</div>
   </div>
 </div>

 <!-- 하단 -->
 <div class="cardbox bottom">
   <div class="ic">🛟</div>
   <div class="bt">국민은 필요한 해양정보를 <b>한 곳에서 찾기 어렵고</b>,<br>그 정보 제공 부담은 고스란히 <span class="o">해양경찰의 몫이 되고 있습니다</span><br><span class="sm">(특보 및 기상정보 문의 민원 등)</span></div>
 </div>

 <div class="foot">※ 근거: 낚시 인구 850만(2018)→1,000만(2024 예상, 해양수산부) · 수상레저 조종면허 누적 11.1만(2011)→28.7만(2021, 해양경찰청) · 해수욕장 이용객 약 3,800만(2023)→4,110만(2024, 개장기간·전년比 +8.2%, 해양수산부). 본 안은 콘텐츠 시안 · 최종 디자인·수치 검증은 인공지능전환팀.</div>
</div>
</body></html>
```

### 4.5 02 무엇을 만들었나 — `keynote_seagnal/formboard_what.html` (1차본)

02 구획 인포그래픽 **1차본**. 구조: 3박스 가로 흐름(STEP1 모으기·API 통합 ▶ STEP2 가공·AI+자체로직 ▶ STEP3 결과물·통합 서비스) + 하단 주요기능 6타일(실시간 특보 알림 / 해양정보 시각화 / 위치기반 안전정보 / AI 비서 '나리' / 물때·조석 / 태풍 정보·행동요령). 도구 수는 **16개**로 표기(`formboard_what.html:63` — `formboard_content.md`의 "약 20개"와 불일치, 16개로 통일된 최신 정확성 기준).

**⚠️ 사용자 요청 새 레이아웃 — 현재 HTML에 미반영(다음 세션 적용)**. 사용자는 현재의 가로 3박스 흐름이 아니라 아래 **수직 흐름**을 요청했으나, `formboard_what.html`은 여전히 **가로 [STEP1]▶[STEP2]▶[STEP3] + 그리드 6타일** 1차본 상태다:

```
[박스1] + [박스2] > [박스3]      (상단: 박스1·박스2를 '+'로, 그 결과를 '>'로 박스3에 연결)
          ↓ (큰 화살표)
[             넓은 박스             ]  (하단: 주요 기능을 나열)
```
- 박스1 "공공기관 해양정보 API 통합", 박스2 "AI + 자체 개발 로직", 박스3 "통합 해양안전 서비스(채운 내용: 한 앱에서 보고·묻고·먼저 받는다)"
- 한 줄 요약(유지): "흩어진 공공 해양정보를 한곳에 모으고(API 통합), AI와 자체 로직으로 가공해, 누구나 쉽게 쓰는 해양안전 플랫폼으로 만들었습니다"
- 하단 넓은 박스 주요 기능(6개): 실시간 특보 알림 / 해양정보 시각화 / 위치기반 안전정보 / AI 비서 '나리' / 물때·조석 / 태풍 정보·행동요령

**`formboard_what.html` 전체 코드** (1차본, 미반영 상태):

```html
<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8">
<link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0;}
html,body{font-family:'Pretendard',sans-serif;-webkit-font-smoothing:antialiased;background:#e3ebf3;}
#card{width:1280px;min-height:980px;background:linear-gradient(180deg,#eef3f8,#e3ebf3);padding:54px 52px 46px;}
.h{display:flex;align-items:center;gap:20px;}
.h .no{background:#FF6B35;color:#fff;font-weight:800;font-size:42px;border-radius:15px;padding:7px 20px;box-shadow:0 6px 18px rgba(255,107,53,.35);}
.h .t{color:#15243a;font-size:50px;font-weight:800;letter-spacing:-.03em;}
.sub{color:#5b6b80;font-size:24px;font-weight:500;margin:13px 0 30px 2px;letter-spacing:-.01em;line-height:1.4;}
.sub b{color:#FF6B35;font-weight:700;}
.cardbox{background:#fff;border-radius:24px;box-shadow:0 10px 30px rgba(30,50,80,.08);border:1px solid #d8e2ee;}

/* 3박스 흐름 */
.flow{display:flex;align-items:stretch;gap:0;margin-bottom:30px;}
.fbox{flex:1;display:flex;flex-direction:column;padding:26px 26px 28px;min-height:340px;}
.fbox.mid{border:2px solid #FF6B35;box-shadow:0 12px 34px rgba(255,107,53,.16);}
.fbox .step{display:inline-block;align-self:flex-start;background:#f1f5fa;border:1px solid #e0e8f1;border-radius:20px;padding:5px 14px;color:#7c8aa0;font-size:18px;font-weight:700;letter-spacing:-.01em;}
.fbox.mid .step{background:rgba(255,107,53,.12);border-color:rgba(255,107,53,.3);color:#FF6B35;}
.fbox .ftt{color:#15243a;font-size:27px;font-weight:800;letter-spacing:-.02em;margin:14px 0 16px;line-height:1.25;}
.fbox.mid .ftt{color:#15243a;}
.fbox .ftt .o{color:#FF6B35;}
.fbox ul{list-style:none;display:flex;flex-direction:column;gap:13px;}
.fbox li{position:relative;padding-left:22px;color:#5b6b80;font-size:20px;font-weight:500;line-height:1.45;letter-spacing:-.01em;}
.fbox li::before{content:"";position:absolute;left:2px;top:11px;width:8px;height:8px;border-radius:50%;background:#FF6B35;}
.fbox li b{color:#15243a;font-weight:700;}
.fbox li .o{color:#FF6B35;font-weight:700;}
.fbox .res{color:#1f3047;font-size:21px;font-weight:800;line-height:1.4;letter-spacing:-.015em;margin:8px 0 16px;}
.arrow{flex:0 0 56px;display:flex;align-items:center;justify-content:center;color:#FF6B35;font-size:38px;font-weight:800;}

/* 주요 기능 */
.feat-h{color:#15243a;font-size:30px;font-weight:800;letter-spacing:-.02em;margin:2px 0 18px 2px;}
.feat-h .o{color:#FF6B35;}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;}
.tile{display:flex;align-items:flex-start;gap:16px;padding:20px 22px;}
.tile .ic{flex:0 0 56px;height:56px;border-radius:15px;background:rgba(255,107,53,.13);display:flex;align-items:center;justify-content:center;font-size:30px;}
.tile .tx .tt{color:#15243a;font-size:21px;font-weight:800;letter-spacing:-.015em;margin-bottom:5px;}
.tile .tx .ds{color:#5b6b80;font-size:17.5px;font-weight:500;line-height:1.38;letter-spacing:-.01em;}
.foot{color:#93a2b5;font-size:16px;line-height:1.5;margin-top:22px;}
</style></head><body>
<div id="card">
 <div class="h"><span class="no">02</span><span class="t">무엇을 만들었나</span></div>
 <div class="sub">흩어진 공공 해양정보를 한곳에 모으고(<b>API 통합</b>), AI와 자체 로직으로 가공해, 누구나 쉽게 쓰는 <b>해양안전 플랫폼</b>으로 만들었습니다</div>

 <!-- 3박스 흐름 -->
 <div class="flow">
   <div class="cardbox fbox">
     <span class="step">STEP 1 · 모으기</span>
     <div class="ftt">공공기관 해양정보<br><span class="o">API 통합</span></div>
     <ul>
       <li><b>기상청</b> (특보·예보·기상부이·태풍·시정)</li>
       <li><b>국립해양조사원</b> (조석·유향속·수심·해무CCTV·생활지수) 등</li>
       <li>다출처 공공 <b>실데이터</b>를 직접 수집·통합</li>
     </ul>
   </div>

   <div class="arrow">▶</div>

   <div class="cardbox fbox mid">
     <span class="step">STEP 2 · 가공하기</span>
     <div class="ftt">AI <span class="o">+</span> 자체 개발 로직</div>
     <ul>
       <li><b>Gemini 2.5</b> 기반 자율 에이전트 <span class="o">'나리'</span>가 <b>16개</b> 해양 데이터 도구를 스스로 호출</li>
       <li>해역·의도 추출, <b>위치 판정</b>(최단 대피침로), <b>결정론적 처리</b> 등 자체 로직</li>
     </ul>
   </div>

   <div class="arrow">▶</div>

   <div class="cardbox fbox">
     <span class="step">STEP 3 · 결과물</span>
     <div class="ftt">통합 해양안전 서비스</div>
     <div class="res">"한 앱에서 보고·묻고·먼저 받는<br>통합 해양안전 플랫폼"</div>
     <ul>
       <li>흩어진 정보를 한 화면에서 <b>보고</b>(시각화)</li>
       <li>AI에게 <b>묻고</b>(<span class="o">나리</span>)</li>
       <li>위험을 <b>먼저 받는다</b>(선제 알림)</li>
     </ul>
   </div>
 </div>

 <!-- 주요 기능 -->
 <div class="feat-h"><span class="o">주요</span> 기능</div>
 <div class="tiles">
   <div class="cardbox tile">
     <div class="ic">🚨</div>
     <div class="tx"><div class="tt">실시간 특보 알림</div>
       <div class="ds">발표·발효·격상·격하·해제 즉시 푸시 (1분 주기 감지)</div></div>
   </div>
   <div class="cardbox tile">
     <div class="ic">🗺️</div>
     <div class="tx"><div class="tt">해양정보 시각화</div>
       <div class="ds">유향속·파고파향·기상부이·해무CCTV를 한 지도에 레이어</div></div>
   </div>
   <div class="cardbox tile">
     <div class="ic">📍</div>
     <div class="tx"><div class="tt">위치기반 안전정보</div>
       <div class="ds">태풍 내습 예상시간 + 최단 대피 침로 안내</div></div>
   </div>
   <div class="cardbox tile">
     <div class="ic">🤖</div>
     <div class="tx"><div class="tt">AI 비서 '나리'</div>
       <div class="ds">자연어로 물으면 실데이터로 답</div></div>
   </div>
   <div class="cardbox tile">
     <div class="ic">🌊</div>
     <div class="tx"><div class="tt">물때 / 조석</div>
       <div class="ds">갯벌 고립 위험 시각 안내</div></div>
   </div>
   <div class="cardbox tile">
     <div class="ic">🌀</div>
     <div class="tx"><div class="tt">태풍 정보·행동요령</div>
       <div class="ds">발생·소멸·내습 알림 + 육·해상 행동요령</div></div>
   </div>
 </div>

 <div class="foot">※ 본 안은 콘텐츠 시안 · 최종 디자인은 인공지능전환팀. 기능은 실제 구현 기준.</div>
</div>
</body></html>
```

### 4.6 인포그래픽 JPG 렌더링 레시피 (재현용)

폰트 CDN이 에이전트 프록시 SSL로 막혀, 헤드리스 크로미움 렌더 시 Pretendard를 **base64로 직접 임베드**해야 한다(`_embed.html` 약 2.75MB 생성). 채팅 전송은 **경량 CDN-폰트 원본 HTML**로 하고(임베드본은 무겁다 → 32MB 한도 주의), 렌더 입력만 임베드본을 쓴다. `X`는 `why2` / `what` 등으로 치환.

```bash
# 1) /tmp/Pretendard.woff2 (없으면 재다운로드)
curl -fsSL -o /tmp/Pretendard.woff2 \
  "https://github.com/orioncactus/pretendard/raw/v1.3.9/packages/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"

# 2) base64 임베드본 생성 (CDN <link> → @font-face data URI 치환)
python3 -c "import base64;b=base64.b64encode(open('/tmp/Pretendard.woff2','rb').read()).decode();\
f='keynote_seagnal/formboard_X.html';h=open(f).read();\
L='<link href=\"https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css\" rel=\"stylesheet\">';\
open(f.replace('.html','_embed.html'),'w').write(h.replace(L,\"<style>@font-face{font-family:'Pretendard';src:url(data:font/woff2;base64,\"+b+\") format('woff2');font-weight:100 900;}</style>\"))"

# 3) 헤드리스 크로미움 캡처 (HEIGHT는 콘텐츠 높이에 맞춰 조정; 잘림 확인 후 재렌더)
/opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless --no-sandbox --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,HEIGHT \
  --screenshot=keynote_seagnal/formboard_X.png "file://$PWD/keynote_seagnal/formboard_X_embed.html"

# 4) Pillow로 PNG → JPG (quality 92)
python3 -c "from PIL import Image;Image.open('keynote_seagnal/formboard_X.png').convert('RGB').save('keynote_seagnal/formboard_X.jpg','JPEG',quality=92)"
```

산출물: `formboard_X.png`(원본) + `formboard_X.jpg`(전달용) + `formboard_X_embed.html`(렌더 입력, 폰트 base64는 `…(base64 생략)…`로 본문 약 2.75MB). 현 디렉토리에는 `formboard_why2.{png,jpg,_embed.html}`, `formboard_what.{png,jpg,_embed.html}`가 생성되어 있다.

### 4.7 다음 세션 To-Do (폼보드)

1. **02(`formboard_what.html`)** 레이아웃 재구성: `[A]+[B]>[C]` → `↓` → 넓은 박스(주요기능) 후 JPG 재렌더.
2. **01(`formboard_why2.html`)** 문구 3건 반영(는 / 는 / 현장의 부담으로 작용) 후 JPG 재렌더.
3. **03 어떻게 보이나 / 04 앞으로는** 인포그래픽 신규 제작(앱 스크린샷: `local_server/assets/screenshots_upload/`).
4. 운영 실적 수치 **실값·기준일 확정**(특히 '유지율' 지표 정의 — 푸시 구독 유지율 vs Play Console 설치 유지율) + 도구 수 16/19/20 통일 + 지식그래프 노드 수치 정합.

---

## 5. 시연 대본 · 정확성 · 브랜치 · 다음 작업

> 담당 영역 한눈 요약: ① 발표 시연 대본 전문(도입+1~5번) ② 정확성 검증 결과(검증OK / 미검증·미구현) ③ 데이터 근거(출처) ④ 브랜치 지도 ⑤ 모바일 32MB 한도 이슈 ⑥ 다음 세션 To-Do.
> ⚠️ **대본 원본 파일은 git 작업트리에 더 이상 없다.** `keynote_seagnal/demo_script.html`은 `claude/image-review-8rOWp` 브랜치에 추가(`63f5b03`)→수정(`74b1398`)→삭제(`58d385b`)되어, 최종본은 **git 히스토리에만** 존재한다. 복원/열람은 `git show 74b1398:keynote_seagnal/demo_script.html` 로 한다. (아래 5.1에 전문 수록)

---

### 5.1 시연 대본 전문 (최종본 = 커밋 `74b1398`)

대본은 발표자가 화면을 위로 스크롤하며 읽는 읽기용 문서다. `👆` 큐(cue) 칩은 화면 조작 시점이다. 모든 문구는 코드와 교차검증되어 있다(특히 5번 나리: 위치 일시 전송·미저장, 16개 도구는 `74b1398`에서 코드 일치화 완료).

**도입 (TTS 양해)**
```
원활한 시연을 위해, TTS로 주요 기능을 설명하겠습니다. 너른 양해 부탁드립니다.
```

**1. 해역별 특보정보**
```
(lead) 특보구역별로 특보와 기상정보를 한눈에 제공합니다.
해상특보가 발표, 발효, 격상, 격하, 해제, 어떤 변동이든 생기면 그 즉시
시간 정보와 함께 사용자에게 알림이 전송됩니다.
[👆 알림 탭]
이 알림을 눌러보면, 보시는 것처럼 해경에서 안내에 쓰는 공식 문구 형식 그대로 표출됩니다.
[👆 특보구역 선택]
원하는 특보구역을 선택하면, 현 해역의 기상정보·특보 시간·부이정보·예보까지 한 화면에 펼쳐집니다.
바로 이 기능 하나로 파출소 문의전화의 상당수가 해소될 것으로 기대합니다.
```

**2. 태풍 알림**
```
태풍이 발생하거나 소멸하면 특보와 똑같이 알림이 뜨고,
[👆 알림 탭]
누르면 바로 태풍 정보 화면으로 이동합니다.
특히 태풍이 우리 해역에 들어왔을 때는, 정보창에서 하늘색 부분은 예측기상,
연두색 부분은 관측기상을 추가로 제공하고,
이렇게 육상·해상에서의 행동요령까지 안내합니다.
```

**3. 해양종합정보**
```
(lead) 말 그대로 모든 해양정보를 하나로 통합했습니다.
유향속·풍향속·파고·파향을 이렇게 시간대를 옮겨가며 확인할 수 있고,
전국에 배치된 기상부이를 눌러 바로 정보를 볼 수도 있습니다.
특보구역을 누르면 지도에 구역이 그려지는데, 이건 VPASS에 작도된 구역과 동일합니다.
[👆 특보 ON]
여기서 특보 ON을 누르면, 특보가 있는 구역만 지도 위에 표출해 볼 수 있습니다.
[👆 임의 해점 클릭]
다음은 이 모든 정보를 종합해 보여주는 기능입니다.
지도에서 임의의 해점을 클릭하면, 이렇게 정보를 한 번에 제공합니다.
다음은 물빠짐 기능입니다. 조수간만의 차가 큰 서남해를 대상으로, 물이 얼마나 빠지는지
시각적으로 보여줍니다. 정확도를 위해, 전국의 조석정보를 매일 자동으로 수집하고 있습니다.
```

**4. 위치기반 정보**
```
먼저, 태풍이 내 GPS 위치로 내습할 것으로 예상되면, 이렇게 내습 예상시간과 함께 알림이 옵니다.
그리고 내가 있는 GPS 위치에 특보가 발표되면, 기상정보와 함께 가장 빠른 대피 침로까지 제공합니다.
```

**5. 대화형 AI 비서 '나리'** (위치 일시전송·미저장, 16도구·직종기억·휴대폰저장, 향후 지식그래프 — **설문/폴백 표현 제거됨**)
```
(lead) 마지막, 다섯 번째. 현재 미공개 상태로 고도화 중인 대화형 AI 비서 '나리'입니다.
시연에 앞서 잠깐만 설명드리겠습니다.

나리는 구글 제미나이 2.5를 두뇌로 삼고, 직접 수집·구동하는 16개의 해양 데이터 도구를
질문에 맞게 스스로 골라 호출한 뒤, 그 결과를 사람의 언어로 풀어 안내합니다.

또한 나리를 처음 사용할 때 물어본 사용자의 직종과, 자주 보는 해역·관심 주제를 기억해,
같은 질문도 그 사용자에게 맞는 말투와 우선순위로 답합니다.

이 기억은 서버가 아닌 사용자 휴대폰에만 저장해, 개인정보를 보호합니다.
위치 정보 역시, '내 근처' 같은 질문을 할 때만 일시적으로 서버에 보내
가까운 부이나 해역을 찾는 데 쓰고, 따로 저장하지는 않습니다.

앞으로는 해역·부이·물때·직종·용어를 잇는 지식그래프와, 검색 정밀화·위치 기반 선제 알림을 더해,
묻기도 전에 먼저 위험을 알려주는 능동형 해양안전 AI로 키워 나가고자 합니다.
[👆 나리 시연 (짧은 질문 1개)]
간단히 시연해 보겠습니다.
```

**대본 끝의 발표 전 확인 박스(원본 그대로)**
```
⚠️ 발표 전 확인 (사실 표현)
- "공식 문구 형식 그대로" — 화면 표시 문구가 실제 해경 안내 양식과 같을 때만. (카카오 발송 기능은 없음)
- "전국 조석정보 매일 자동 수집" — 지점 수(예: 443)는 실제 운영값으로 확인되면 추가
- "VPASS 작도 구역과 동일" — 화면으로 직접 시연
- 도구 16개 — 코드(TOOL_CATALOG·TOOL_EXEC) 교차검증 완료
```

> `74b1398` 커밋 메시지가 명시: 위치 처리 정직화(`assistant.js`의 '내 근처' 질문 시에만 GPS 일시 전송), 5번에서 '앱 접속 시 설문'(미연동) 표현 제거, 개인화는 온보딩 직종 + 행동기록(자주 보는 해역·관심주제)만 사용. **'설문'·'폴백' 단어는 대본·나리덱·코드 모두에서 제거됨.**

---

### 5.2 정확성 검증 결과 표

코드 교차검증 기준(실제 파일). ✅ = 자신있게 사용, ⚠️/❌ = 과장 금지·향후로만.

| 주장 | 판정 | 근거 / 사유 |
|---|---|---|
| AI 모델 = **Gemini 2.5 (flash-lite)** | ✅ 검증OK | `local_server/routes/assistant.js:583` `const BRAIN_MODEL = 'gemini-2.5-flash-lite';` (TTS는 `gemini-2.5-flash-preview-tts`, :1272). 'Pro' 등 상위 모델 표기 금지 |
| 자율 도구 **16개** | ✅ 검증OK | `routes/assistant.js`의 `TOOL_CATALOG`(585~610, `- name(` 라인 정확히 16개)와 `TOOL_EXEC` 객체 키(662~810, 16개)가 1:1 일치. **(주의: 폼보드 구버전 문서는 19/20 혼재 — 16으로 통일 필요)** |
| 기상청 4계열 + 국립해양조사원 6계열 **통합** | ✅ 검증OK (프레이밍) | 16개 도구가 KMA 예보·특보·부이(예: `get_marine_forecast`/`get_warning`/`get_buoy_observation`) + KHOA 조석·유향유속·수심(`get_tide`/`get_current`(`khoa-stream-nearest`,:748)/`get_depth`(`/api/ocean/depth`,:752))으로 구성. 슬라이드 덱은 "7출처 통합"으로 표기(`slide02_preview.html:1209`). 4+6 분류는 폼보드 검증항목(`formboard_content.md:22`)의 프레이밍 |
| 특보 **생애주기**(발표·발효·격상·격하·해제) | ✅ 검증OK | `00_docs/SUBREGION_ALERT/02_DATA_MODEL/03_subregion_lifecycle_schema.md`: `eventLabel`("발효됨"/"격상됨"/"격하됨"/"예비특보 발표"), `history[i].event`("신규 발효"/"격상됨"/"격하됨"/"해제됨"), tmFc(발표)/tmEf(발효) 필드 실재 |
| **온디바이스** 처리(프로필·대화기억 휴대폰 저장, 위치 일시전송·미저장) | ✅ 검증OK | 프론트 `js/assistant.js`: 프로필·메모리·스타일은 `localStorage`(`getProfile`:171 / `getMemory`:179 / `setProfile`:174). 위치는 `needsLocation()`(:225, "내 근처/근처/주변" 정규식) 매칭 시에만 `getUserLocation()`로 획득해 요청 body로 1회 전송(:284), 서버는 fs 저장 없이 사용. 서버 주석(`routes/assistant.js:388-392`): "답변의 근거 데이터는 기상청 실데이터(fc/warn)뿐이며 profile/memory는 개인화용" |
| 결정론적 폴백(키 없어도 실데이터) | ✅ 검증OK | `composeAnswerFallback`(:334) — Gemini 실패 시 실데이터 기반 결정론 답변 (단, **'폴백'이라는 단어는 대본/덱에서 제거**) |
| 지식그래프 **978노드 / 1,232관계** | ❌ 미구현(코드 없음) | 코드에 그래프 구현 없음. **나리 덱·대본에서 전부 제거, 향후 계획으로만.** (단 폼보드 구버전 `formboard_content.md:22,58`엔 잔존 → 폼보드 갱신 필요) |
| **카카오 알림톡** 발송 | ❌ 미구현 | 서버에 발송 구현 없음. 대본 확인박스에도 "(카카오 발송 기능은 없음)" 명기. 화면 문구가 해경 양식과 같을 때만 "공식 문구 형식 그대로" 사용 |
| 물빠짐 **443개 지점** | ⚠️ 미검증(고정값 아님) | 지점 수 고정값 근거 없음 → 대본은 "전국 조석정보를 매일 자동으로 수집"으로 순화. 실운영값 확인되면 그때 숫자 추가 |
| **핸즈프리 긴급신고** | ❌ 미구현 | `tel:119` 링크일 뿐 → 로드맵(향후)에만 |
| **65% 절차감소 / 3회 터치** | ⚠️ 코드 증빙불가 | 산정근거 없음 → "핵심정보 최소 동선" 등으로 완화. (메인 덱 s11 표는 "정보 획득 단계 축소"로 재계산) |
| **유지율 80.6%** | ⚠️ 라벨 위험 | `admin.js calcRetention`은 **푸시 구독 유지율**이지 Play Console **설치 유지율**이 아님(서로 다른 지표). `formboard_content.md:13`에 위험 명기. 라벨을 정확히("푸시 구독 유지율") 하거나 Play Console 실값으로 교체 |

---

### 5.3 데이터 근거 (출처) — '01 왜 필요한가' 인포그래픽 / 폼보드

해양 활동 인구 증가 주장의 요소별 출처. (메인 인포그래픽 = `keynote_seagnal/formboard_why2.html`)

| 항목 | 수치 | 출처 |
|---|---|---|
| 낚시 인구 | 850만(2018) → **1,000만(2024 예상)** | 해양수산부 |
| 수상레저 조종면허(누적) | 11.1만(2011) → **28.7만(2021)** | 해양경찰청 |
| 해수욕장 이용객 | 약 3,800만(2023) → **4,110만(2024**, 개장기간·전년比 **+8.2%**) | 해양수산부 |

- 관광객/방문객 지표는 코로나 등락으로 '증가' 근거에 부적합 → **해수욕장 이용객으로 대체**함.
- **운영 실적 5종(제출 전 실값·기준일 재확인 필요)**: ① 누적 이용자 1.5만+ ② 안드로이드 설치 1,351 ③ 유지율 80.6%(=푸시 구독 유지율, 라벨 주의) ④ 특보 알림 24.8만+ ⑤ 해양정보 제공 1.1만+. 모두 **Google Play Console·서버 집계 기준일 병기 권장**. ②와 ①은 모수가 다름("안드로이드 설치" vs "웹 포함 누적 이용자") → 1줄 명시.

---

### 5.4 브랜치 지도 (배포)

`git branch -a` / `git log` 교차확인 결과. 각 브랜치의 `nari_intro.html` 줄수로 신·구 버전을 식별(2장=208줄, 구4장=392줄).

| 브랜치 | 용도 | 핵심 사실(검증) | 상태 |
|---|---|---|---|
| `claude/image-review-8rOWp` | 발표자료·나리덱·폼보드 **작업 브랜치** | `keynote/nari_intro.html`(208) + `local_server/nari_intro.html`(392) 둘 다 존재. 대본 HTML이 추가됐다 삭제된 곳. 현재 체크아웃 브랜치 | 활성·푸시됨 |
| `claude/nari-intro-2page` | **시연 배포 — 머지 대상** | `local_server/nari_intro.html`=**208줄(2장 신버전)**. main 대비 앞서 있고, **직종 온보딩 재질문 수정(`7fade7c`/`73d7810`)도 이 브랜치에 포함** | 머지 대기(사용자) |
| `claude/admin-nari-demo` | 구버전(시연버튼+옛 4장) | `local_server/nari_intro.html`=**392줄(구4장)** | ⚠️ **머지 금지(구버전)** |
| `claude/nari-sigeon-onboarding` | 구버전(옛 4장+온보딩) | `local_server/nari_intro.html`=**392줄(구4장)** | ⚠️ **머지 금지(구버전)** |
| `main` | 운영 본선 | **시연 버튼(`admin.js`)은 이미 병합됨**(`grep 시연/nari_intro` 2건). `nari_intro.html` 자체는 main에 없음(0줄) | — |

> ⚠️ **선행 인수인계 문서(`HANDOFF.md` 4·6장)의 "직종 온보딩 수정은 이미 main에 있음"은 부정확.**
> 코드 확인 결과: `git show main:local_server/js/assistant.js | grep "skipped\|_initProfile"` = **0** (main에 미반영). 온보딩 수정은 `claude/nari-intro-2page`(5건)와 `claude/image-review-8rOWp`(5건)에만 존재.
> **결론: `claude/nari-intro-2page` 한 브랜치를 머지하면 ①나리 2장 ②직종 온보딩 재질문 수정이 함께 들어간다.** (main엔 시연 버튼만 선반영된 상태)
>
> 직종 온보딩 수정의 실체(`js/assistant.js:735-739`): 트리거를 `getProfile()===null` → `(!profile || (!profile.occupation && !profile.skipped))`로 변경. 건너뛰기는 `setProfile({skipped:true})`(:675). 효과: 과거 빈 `{}` 프로필도 직종을 다시 물어봄(빈 `{}`가 영구 차단하던 버그 해소). 온보딩 첫 질문(`routes/assistant.js:1132`): "…어떤 일을 하고 계신가요? (예: 어선 선장, 선원, 양식, 낚시, 레저보트 등)" + "답변은 이 휴대폰에만 저장되고 외부로 공유되지 않습니다".

---

### 5.5 모바일 32MB 한도 이슈와 해결

채팅(파일 전송) 채널의 **32MB 업로드 한도** 때문에 무거운 산출물은 그대로 보낼 수 없다. 해결 원칙은 **무게의 분리**다.

- **인포그래픽 HTML 전송**: 폰트를 base64 임베드하지 않은 **경량 CDN-폰트 HTML**(예: `formboard_why2.html` ≈7KB, `<link>`로 Pretendard CDN 참조)로 전송. 임베드본(`*_embed.html`, base64 Pretendard 포함 ≈2.75MB)이나 영상 포함 덱(`slide02_preview.html` ≈3.8MB)은 채팅으로 보내지 않는다.
- **base64는 git에만**: 클로징 손글씨 폰트(`White Angelica.ttf`)와 야간 항행 배경 영상(Veo 생성)은 `slide02_preview.html` 안에 base64로 인라인되어 **저장소(git)에만** 둔다. 채팅 전송 대상이 아니다.
- **`*_embed.html`은 .gitignore 처리**: `.gitignore:48-49` `keynote_seagnal/*_embed.html` — 폰트 base64 임베드 렌더용 임시본은 추적하지 않는다(JPG/PNG 렌더 산출물은 추적). 즉 **렌더에 쓰는 무거운 중간본은 로컬·git 무시, 채팅엔 경량본만**.
- 인포그래픽 JPG 렌더 시 프록시 SSL이 폰트 CDN을 막아 헤드리스 크로미움에서 Pretendard가 깨지므로, **렌더 직전에만** `_embed.html`(base64 임베드본)을 만들어 스크린샷 → JPG 변환 후 임베드본은 버린다(레시피는 `HANDOFF.md` 4장).

---

### 5.6 다음 세션 To-Do (우선순위)

1. **`claude/nari-intro-2page` 배포 머지** — 이 한 브랜치가 ①나리 소개 2장 ②직종 온보딩 재질문 수정을 함께 가져온다. **main엔 시연 버튼만 있고 온보딩 수정은 아직 없음**(5.4 경고 반드시 반영). 머지 후 구버전 2개(`claude/admin-nari-demo`, `claude/nari-sigeon-onboarding`) 정리.
2. **폼보드 정확성 동기화** — `formboard_content.md`가 아직 **19/20 도구 + 지식그래프 978노드/1,232관계**를 쓰고 있어 정정된 나리 덱(16도구·그래프 제거)과 모순. 폼보드 본문을 **16개 도구·그래프 향후로** 통일.
3. **01 왜필요(`formboard_why2.html`) 문구 3건 반영** 후 JPG 재렌더: ①"해양 활동 인구**는** 매년 증가" ②"공공 정보**는** 여러 기관에 흩어져" ③박스3 "그 정보 제공은 고스란히 **현장의 부담**으로 작용하고 있습니다"(+다음줄 "(특보 및 기상정보 문의 민원 등)").
4. **02 무엇을 만들었나(`formboard_what.html`)** 레이아웃 재구성([박스1]+[박스2]>[박스3] → ↓ → 넓은 박스+주요기능) 후 JPG.
5. **운영 실적 5종 실값·기준일 확정** — 특히 유지율 지표 정의(푸시 구독 vs 설치 유지율) 라벨 확정, 누적 이용자/안드로이드 설치 모수 명시.
6. (선택) **시연 대본을 작업트리로 복원할지 결정** — 현재 git 히스토리(`74b1398`)에만 있음. 발표자 읽기용으로 다시 필요하면 `git show 74b1398:keynote_seagnal/demo_script.html`로 꺼내 재배치.

---

**관련 파일 경로(절대경로)**
- 대본 원본(히스토리): `git show 74b1398:keynote_seagnal/demo_script.html`
- 나리 백엔드: `/home/user/SEAGNAL/local_server/routes/assistant.js` (모델 :583, TOOL_CATALOG :585, TOOL_EXEC :662, 온보딩 질문 :1132)
- 나리 프론트: `/home/user/SEAGNAL/local_server/js/assistant.js` (위치 :225·:284, 프로필 localStorage :171, 온보딩 트리거 :735)
- 유지율/실적 정의: `/home/user/SEAGNAL/keynote_seagnal/formboard_content.md` (:13 유지율 위험, :22 검증OK 표)
- 특보 생애주기: `/home/user/SEAGNAL/00_docs/SUBREGION_ALERT/02_DATA_MODEL/03_subregion_lifecycle_schema.md`
- 나리 2장(머지 대상): `claude/nari-intro-2page:local_server/nari_intro.html` (208줄)
- 01 인포그래픽: `/home/user/SEAGNAL/keynote_seagnal/formboard_why2.html`
