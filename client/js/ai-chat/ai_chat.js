/**
 * ============================================================================
 * 파일명: client/js/ai-chat/ai_chat.js
 * 역할  : 해양법령 챗봇(나리야) 인앱 모듈. 두 갈래로 나뉜다.
 *         (A) 관리자 콘솔 — 통합관리자 센터의 "나리야 법령" 탭이 부르는
 *             window.NariyaChat.renderAdminInto(container) 로, 지식 방 브라우저
 *             (원문/위키개념/법령/비교허브/별표/지식그래프 + 역할설명 인트로카드 —
 *              2026-09-09부터 숫자·목록·시행일이 전부 서버 실데이터이고 목록은 한 쪽 10개씩
 *              « ‹ 1 2 3 4 5 › » 로 넘긴다)
 *             + 관리자 검토센터(6개 서브탭·원본 vs AI값·교정입력·승인/반려·반영사슬)
 *             + 챗봇 노출 토글(서버 전역 설정)을 렌더한다.
 *         (B) 사용자 챗봇 — 우측 하단 FAB + 카카오톡풍 채팅 팝업(생각중·스켈레톤·
 *             근거법령 아코디언 = 위임흐름 체인 + 조문 카드를 누르면 뜨는 조문 원문 팝업).
 *             헤더 [대화이력] 은 이 기기에 저장해둔 **지난 대화 기록**(localStorage
 *             'nariya_history_v1')을 **대화 단위**로 묶어 열고(2026-09-09 ⑥ — 채팅창을
 *             연 뒤 닫기 전까지가 한 대화다), 한 줄을 누르면 그 대화에서 오간 질문·답변이
 *             순서대로 이어 붙는다. 대화 식별자가 없는 옛 기록은 날짜별로 묶어 보여준다.
 *             헤더 [내 정보] 는 온디바이스 프로필 화면을 연다(2026-09-09 ② — 예전에는
 *             ⚙·🕘 아이콘이었으나 무엇인지 알 수 없다는 지적으로 글자 버튼이 됐다).
 *             #nrya-overlays(body) 에 산다.
 *         FAB 는 (1) 앱 메인 특보 탭일 때만, (2) 서버 노출설정이 허용할 때만 보인다.
 *         (초보자용: 이 파일이 관리자용 나리야 콘솔과 사용자용 챗봇 버튼/창을 만든다)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : css/ai_chat.css (스타일), js/admin/admin.js
 *                    (통합관리자 'nariya' 탭이 renderAdminInto 호출 · 관리자 토큰
 *                    저장소 'seagnal_admin_token' 재사용),
 *                    js/settings/settings.js (전역 NotificationSettings — 답변완료
 *                    알림 옵트인 값 aiAnswer 읽기/켜기. 먼저 로드되어 있어야 함),
 *                    js/core/backbutton.js (전역 PopupStack — 채팅창·조문 팝업을
 *                    하드웨어 뒤로가기로 닫기),
 *                    @capacitor/browser (window.Capacitor.Plugins.Browser — 별표·서식
 *                    원본 파일을 앱 웹뷰 대신 시스템 브라우저로 열어 받게 한다.
 *                    openDownloadUrl 참고. 웹에서는 평범한 앵커로 폴백)
 *  - 서버 API      : routes/legal.js
 *                    GET  /api/legal/config                   (노출설정 조회, 기본 off)
 *                    POST /api/legal/config {exposure}         (노출설정 저장, 관리자)
 *                    GET  /api/legal/reviews?status=pending    (검증 대기 목록)
 *                    GET  /api/legal/reviews/stats             (대기/승인 카운트)
 *                    POST /api/legal/reviews/:id/approve        (승인/반려 + 교정값)
 *                    GET  /api/legal/admin/stats               (초안·피드백·새지식후보·개정검토·원문신선도 실카운트)
 *                    GET  /api/legal/freshness?status=pending  (원문신선도 — 낡은 행정규칙 원문 목록
 *                                                               + last: 마지막 점검이 언제·어떻게 끝났나)
 *                    POST /api/legal/freshness/:id/decide       (처리완료/해당없음)
 *                    POST /api/legal/freshness/scan-now         (즉시 1회 점검, 백그라운드 20~30분)
 *                    POST /api/legal/amendments/decide-all      (개정검토 전체 승인 — 2026-09-10 신설)
 *                    GET  /api/legal/amendments/decide-all/preview (전체 승인 전 미리보기: 대기 N건 중
 *                                                               몇 건이 승인 즉시 답변을 바꾸나)
 *                    GET  /api/legal/amendments/wiki-brief-all  (승인분 전 건을 한 덩어리 지시문으로)
 *                    GET  /api/legal/drafts                    (초안승인 탭 목록)
 *                    GET  /api/legal/rooms/stats               (지식 방 갈래 버튼 6개 숫자 +
 *                                                               인트로 칩 — 개념 status·그래프 엣지 종류.
 *                                                               2026-09-09: 종전에는 이 숫자가 전부
 *                                                               시안에서 베낀 상수였다)
 *                    GET  /api/legal/rooms/list?room&page       (방 6개 목록 · 한 쪽 10개 페이지네이션.
 *                                                               room=raw|concept|statute|comparison|annex|graph)
 *                    GET  /api/legal/rooms/law?dir              (원문 방 아코디언 한 칸 — 계층별 **실제
 *                                                               시행일**(.txt 머리말)·별표/서식·고시)
 *                    POST /api/legal/ask {query, deviceId, notifyOnComplete, ctx?, profile?, lastQuestion?}
 *                                                              (질문→AI 답변 스트리밍(NDJSON)+근거 법령
 *                                                               · done 에 clarify{question,options} 가 오면
 *                                                                 답변 대신 되묻기 선택지 버튼을 그리고,
 *                                                                 누르면 "원래질문 — 라벨"로 다시 질의
 *                                                               · [H-37] 선택지에 ctx 가 실려 오면(이해확인·
 *                                                                 상황질문·프로필확인) 질의는 그대로 두고
 *                                                                 ctx 만 되돌려 보낸다. profile 은 헤더 ⚙
 *                                                                 패널이 이 기기에만 저장한 스냅샷이고
 *                                                                 서버는 그 요청 중에만 읽는다(미저장)
 *                                                               · done 의 forms[] 는 답변이 인용한 조문에
 *                                                                 딸린 별지 서식 목록 — 답변 아래 "서식
 *                                                                 내려받기" 버튼으로 그린다(_CHATBOT.md 5-5).
 *                                                                 빈 배열이면 아무것도 그리지 않는다
 *                                                               · 6초 초과+옵트인이면 서버가 완료 푸시 발송)
 *                    GET  /api/legal/pending-answer/:requestId (푸시로 재진입 시 그 답변 1회 복원)
 *                    GET  /api/legal/article-text?law&article&tier&baseLaw
 *                                                              (근거법령 체인의 조문 카드를 누르면
 *                                                               그 조 원문 전체 + 인용된 항·호 강조.
 *                                                               인용이 범위(제1~9조)·문서 전체면 조를
 *                                                               강조 없이 나열하고, 본문의 별표·서식
 *                                                               참조는 refs 판정으로 링크·회색 처리)
 *                    GET  /api/legal/src?p=<raw 상대경로>       (별표 스캔 이미지 원본 — 위 refs 의 image)
 *  - 마크업        : #unified-admin-body(콘솔 마운트 지점, admin.js 소유),
 *                    body 에 스스로 주입하는 #nrya-overlays(FAB·채팅·지도 팝업)
 *  - 나를 쓰는 곳  : index2.html <script src="js/ai-chat/ai_chat.js"> — 자가 실행.
 *                    admin.js switchUnifiedAdminTab('nariya') → renderAdminInto.
 * [로드 순서] admin.js 이후 로드 권장(관리자 토큰 저장소·콘솔 호출부 정의 후).
 *            자가 실행이라 로드 순서 의존은 약함.
 * ============================================================================
 */
(function () {
  'use strict';

  // 중복 로드 방지(스크립트가 두 번 포함되어도 오버레이/옵저버가 두 번 생기지 않게)
  if (window.NariyaChat && window.NariyaChat.__loaded) return;

  // ── 상수 ──────────────────────────────────────────────────────────────
  var MAIN_TAB_GROUP = 'weather-group';       // FAB 이 보이는 유일한 메인 탭(특보)
  var LS_ADMIN = 'seagnal_admin_mode';         // 관리자 모드 플래그(앱 공용)
  var LS_ADMIN_TOKEN = 'seagnal_admin_token';  // 관리자 토큰(admin.js와 공유)
  var LS_DEVICE_ID = 'seagnal_device_id';      // 기기 식별자(앱 공용 — survey_user.js가 최초 생성)
  var LS_UNREAD = 'nariya_unread_v1';          // 채팅창이 닫힌 사이 도착한 답변 수(FAB 뱃지)
  var LS_HISTORY = 'nariya_history_v1';        // 지난 대화 기록(질문·답변만 · 기기 안에서만 보관)
  var HISTORY_MAX = 200;                       // 기록 보관 개수 상한(넘으면 오래된 것부터 버린다)
  // [H-37 §7.1] 온디바이스 프로필 — **이 기기에만** 저장한다(서버는 요청 처리 중에만 읽고 버린다).
  //   구조: {version:1, fields:{<필드>:{v,at}}} — 필드마다 저장 시각 at 을 둔다(신선도 표시용,
  //   사용자 확정 (아) "언제 저장·수정된 정보인지도 같이 보여준다").
  var LS_PROFILE = 'nariya_profile_v1';
  var CONSENT_ASK_MS = 6000;                   // 이만큼 넘게 걸리면 "다음부터 알림 드릴까요?" 배너
  var activeConsentTimer = null;               // 진행 중인 동의배너 타이머(채팅창 닫으면 취소 — closeChat 참고)
  // [H-37 §4.3] "아니요, 다시 설명할게요"를 누른 뒤 사용자가 새로 칠 문장 **한 번**에만 실릴 ctx.
  //   메모리에만 둔다 — localStorage 에 저장하면 새로고침 뒤 오래된 대기가 되살아난다(설계 §9.1 #3).
  var pendingCtx = null;
  var chatPending = 0;   // 답을 기다리는 중인 요청 수 — 0 이어야 채팅창을 홈으로 비운다(resetToHome)
  var histRestorePoint = null;  // 지난 대화를 붙이기 직전의 채팅창 HTML([채팅창으로]가 여기로 되돌린다)
  // [H-37 §3.2 · 2026-08-14 적대검증 F2] 서버가 마지막 답변에 실어 보낸 ctxNext(= 지금까지 확정된
  //   맥락). **ctx 를 안 든 선택지 버튼**(기존 되묻기·트리 되묻기)을 눌러도 이 값을 이어 보내야
  //   직전에 확정한 조건이 사라지지 않는다 — 안 그러면 프로필로 "네"를 누른 축을 서버가 다시 묻는
  //   무한루프가 된다(라이브 재현). 사용자가 **새 질문을 직접 타이핑**하면 그 순간 비운다(§9.1 #1).
  //   pendingCtx 와 마찬가지로 메모리에만 둔다(새로고침하면 소멸).
  var lastCtx = null;
  // 채팅창을 처음 열었을 때 보이는 인사말 한 줄. 창을 닫았다 다시 열면 이 상태(=홈)로 되돌린다.
  var GREETING_HTML = '<div class="nrya-krow nrya-ai"><div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">안녕하세요! 해양법령에 대해 편하게 물어보세요. 예: "5톤 낚시어선인데 야간에 조업해도 되나요?"</div></div></div></div>';
  // [H-37 최소 절충안, 2026-08-15] 직전에 보낸 질문 원문 — lastCtx와 달리 **새 질문을 타이핑해도
  //   안 비운다**(그게 이 값의 존재 이유다). ctx가 아니라 별도 필드로만 보내 서버가 "확정된 조건"이
  //   아니라 "확인 후보" 하나를 되묻기에 더 보여줄 때만 쓴다(routes/legal.js `lastQuestion` 참고).
  var lastQuestionText = '';
  // ── 대화 기억(2026-08-18 사용자 확정) ──────────────────────────────────────────
  // "🔁 관련해서 더 궁금해요"로 이어 물을 때, **직전까지 오간 대화를 통째로** AI에게 보여준다.
  // 예전에는 주제 낱말 하나(`ctx.topic`)만 넘겼는데, 그것만으로는 AI가 확신하지 못해 방금 한
  // 얘기를 또 되물었다(사용자 재현: 낚시어선업 이야기 뒤 "신고 안 하면?"에 "무슨 영업이신가요?").
  // ⚠**검색어에는 절대 안 섞는다**(설계 §2.1 R2) — 2026-08-18 오전에 직전 질문을 질의에 이어붙였다가
  //   "절차·방법·요건" 같은 일반어로 검색이 오염돼 무관한 법이 딸려 나온 사고가 있었다. 이 값은
  //   되묻기 판단·답변 합성에 **참고 자료로만** 간다.
  // ⚠기억은 **메모리에만** 둔다 — 앱을 껐다 켜면 새 대화로 시작한다(사용자 확정).
  var chatTurns = [];        // [{q, a, at}] — 이어 물은 순서대로
  var lastTurnAt = 0;        // 마지막 답변 시각(6시간이 지나면 그 대화는 끝난 것으로 본다)
  // 마지막 답변에서 이만큼 지나면 이어지지 않는다(사용자 확정 6시간). 앱을 켜둔 채 하루가 지나도
  // 어제 하던 얘기가 오늘 질문에 딸려오지 않게 하는 장치다.
  var CHAT_MEMORY_TTL_MS = 6 * 60 * 60 * 1000;
  // 기억이 이 길이를 넘으면 오래된 턴을 줄인다(비용 상한). 답변은 규칙상 **"쉽게 말하면 ~"으로
  // 시작하는 결론 요약**을 항상 달고 있어, 그 첫 문단만 남기면 따로 요약을 만들 필요가 없다
  // (AI를 다시 부르지 않으므로 비용 0 · 요약하다 뜻이 뒤틀릴 위험 0).
  var CHAT_MEMORY_MAX_CHARS = 8000;
  var CHAT_MEMORY_KEEP_FULL = 2;   // 최근 몇 턴을 통째로 남길지
  // 턴 수 상한 — 줄이기는 글자만 줄일 뿐 턴 자체는 안 버리므로, 아주 길게 이어 물으면 짧은 턴이
  // 끝없이 쌓인다. 서버도 같은 수(12)에서 자르므로 넘겨봐야 버려진다.
  var CHAT_MEMORY_MAX_TURNS = 12;

  // 연결이 끊긴 답을 서버 보관본에서 되찾을 때 다시 물어보는 간격·횟수(2026-08-18).
  //   3초 × 40회 = 2분. 이 안에 못 찾으면 보관본이 없는 것(6초 안에 끝나 보관 대상이 아니었던
  //   질문)이므로 평소 오류 안내로 돌아간다.
  var RECOVER_EVERY_MS = 3000;
  var RECOVER_TRIES = 40;
  // [계약4] 약칭표(GET /api/legal/aliases) 캐시 — `{약칭: 정식 법령명}`. 답변 본문의 「약칭」을
  //   근거 체인의 정식 법령명과 맞춰볼 때만 쓴다. **후보가 유일한 약칭만** 서버가 담아 보낸다.
  //   null = 아직 안 받음, {} = 받았거나 실패(재요청하지 않는다 — 링크가 덜 걸릴 뿐 오동작은 없다).
  var aliasMap = null;

  var serverExposure = 'off';                  // 서버 전역 노출설정(진실의 원천). 기본 off
  var configLoaded = false;                    // /config 최초 로드 완료 여부
  var statsCache = null;                       // {total,pending,approved} — 배지용
  var adminStatsCache = null;                  // {draft,feedback,candidates,amendments} — 서브탭 배지용
  var curAdminSubtab = '⚠수치검증';            // renderSubtabs가 마지막으로 그린 활성 탭(재갱신 시 유지용)

  // ── 소도구 ────────────────────────────────────────────────────────────

  /**
   * HTML 특수문자를 이스케이프해 안전하게 문자열을 삽입한다(서버/사용자 값 방어).
   * 예: esc('<b>5톤</b>') → '&lt;b&gt;5톤&lt;/b&gt;'
   * @param {*} s - 임의 값
   * @returns {string} 이스케이프된 문자열
   */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /** 관리자 모드 여부(로컬 저장 플래그). @returns {boolean} */
  function isAdmin() { try { return localStorage.getItem(LS_ADMIN) === 'true'; } catch (_) { return false; } }

  /**
   * 기기 식별자를 읽고, 없으면 새로 만들어 저장한다(survey_user.js getDeviceId와 동일 생성규칙 —
   * 설문·제보를 한 번도 안 한 사용자는 이 키가 없어 답변완료 푸시가 조용히 안 갔던 문제 수정).
   * @returns {string}
   */
  function getDeviceId() {
    try {
      var id = localStorage.getItem(LS_DEVICE_ID);
      if (!id) { id = 'dev_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10); localStorage.setItem(LS_DEVICE_ID, id); }
      return id;
    } catch (_) { return ''; }
  }

  /**
   * settings.js 가 전역(스크립트 스코프)에 만든 NotificationSettings 객체를 얻는다.
   * 예: notiSettings().set({aiAnswer:true}) → 저장 + (네이티브면) 서버 구독 재동기화
   * settings.js 가 먼저 로드되지 않았거나(테스트 페이지 등) 없으면 null.
   * @returns {object|null}
   * [연계] → js/settings/settings.js NotificationSettings — 알림 옵트인 값의 유일한 주인.
   */
  function notiSettings() {
    try { return (typeof NotificationSettings !== 'undefined') ? NotificationSettings : null; } catch (_) { return null; }
  }

  /** 답변완료 알림을 이미 켠 사용자인지(켰으면 동의 배너를 띄우지 않는다). @returns {boolean} */
  function aiAnswerOptedIn() {
    var ns = notiSettings();
    return !!(ns && ns.settings && ns.settings.aiAnswer === true);
  }

  /** 관리자 토큰을 로컬/세션에서 읽는다(admin.js 저장 규약과 동일). @returns {string|null} */
  function getAdminToken() {
    try { return localStorage.getItem(LS_ADMIN_TOKEN) || sessionStorage.getItem(LS_ADMIN_TOKEN) || null; } catch (_) { return null; }
  }

  /**
   * /api/legal/* 호출 래퍼. 저장된 관리자 토큰이 있으면 모든 /api/legal/* 요청에
   * X-Admin-Token 을 붙인다(reviews·config·drafts·admin/stats 등 서버가 토큰을
   * 요구하는 경로 전부를 커버 — 앱 전역 fetch 래퍼는 /api/admin/* 만 처리하고
   * /api/legal/* 은 안 붙이므로 여기서 직접 붙여야 한다. 토큰이 불필요한 공개
   * 경로(config GET·ask)에 붙여도 서버가 무시하므로 안전).
   * 예: legalFetch('/api/legal/reviews?status=pending') → Promise<Response>
   * @param {string} url - 요청 경로
   * @param {object} [opts] - fetch 옵션
   * @returns {Promise<Response>}
   */
  function legalFetch(url, opts) {
    opts = opts || {};
    if (url.indexOf('/api/legal/') !== -1) {
      var token = getAdminToken();
      if (token) {
        var headers = Object.assign({}, opts.headers || {});
        headers['X-Admin-Token'] = token;
        opts.headers = headers;
      }
    }
    return fetch(url, opts);
  }

  /** GET 편의. @param {string} url @returns {Promise<Response>} */
  function legalGet(url) { return legalFetch(url, {}); }

  /** POST(JSON) 편의. @param {string} url @param {object} body @returns {Promise<Response>} */
  function legalPost(url, body) {
    return legalFetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  /** 현재 시각을 "오후 2:11" 형태로. @returns {string} */
  function nowLabel() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    var ap = h < 12 ? '오전' : '오후'; var hh = h % 12; if (hh === 0) hh = 12;
    return ap + ' ' + hh + ':' + (m < 10 ? '0' + m : m);
  }

  // 나리야 캐릭터(투명 PNG). 예전 conic-gradient orb 를 이 캐릭터 아바타로 전면 교체.
  var NARIYA_IMG = 'images/nariya_character.png';
  /** 나리야 캐릭터 원형 아바타 HTML. @param {string} [extra] 추가 클래스 @returns {string} */
  function avatarHTML(extra) { return '<div class="nrya-ava' + (extra ? ' ' + extra : '') + '"><img src="' + NARIYA_IMG + '" alt="나리야"></div>'; }

  // ============================================================================
  // 지식 방 데이터 모델 (nrya- 접두어)
  //   ★숫자·목록·시행일은 **전부 서버 실데이터**다 — GET /api/legal/rooms/stats · /rooms/list · /rooms/law.
  //   ⚠2026-09-09 이전에는 이 자리에 client/mockups/ai_chat_rooms.html 의 **디자인 시안 숫자를 그대로
  //     박아** 두었고(위키개념 919·법령 73·비교허브 26·별표서식 98·그래프 88노드/1,310엣지·
  //     개념 canonical 8/draft 842), 실제와 크게 어긋나 있었다(963·74·49·199·109노드/2,180엣지·
  //     canonical 734/draft 226). 특히 **시행일자**가 원문과 달라(선박안전법 화면 2025-01-24 ↔
  //     원문 2023-06-28) 관리자가 원문 최신판을 오인할 수 있었다. 그래서 상수를 전부 없앴다 —
  //     ROOMS 에 남은 것은 화면 설명글(ic·tag·desc)뿐이고, 숫자는 roomStats 에서만 온다.
  //     시안 파일의 숫자를 다시 베끼지 말 것.
  // ============================================================================

  // 방 이름(화면·한글) → 서버 room 파라미터(ASCII). 한글을 쿼리에 그대로 싣지 않기 위한 대응표.
  var ROOM_KEY = { 원문: 'raw', 위키개념: 'concept', 법령: 'statute', 비교허브: 'comparison', '별표·서식': 'annex', 지식그래프: 'graph' };

  var ROOMS = {
    원문: {
      ic: '📁', tag: 'raw/ · 원문 보관실',
      desc: '국가법령정보센터 <b>원문 아카이브(불변)</b>입니다. 위키의 재료가 되는 1층. 법률·시행령·시행규칙 전문 + 별표·서식 + 고시(행정규칙)를 법령별로 보관합니다. 누르면 법령별 아코디언 → 계층별 실제 시행일·별표·고시.'
    },
    위키개념: {
      ic: '📗', tag: 'wiki/concepts/ · 답변 근거실',
      desc: '원문을 엮은 <b>개념 페이지</b>. 챗봇이 실제 답변에 사용하는 핵심 근거(2층). 정의우선·처벌 3축·타법연결을 담습니다. status(승인상태)에 따라 챗봇 인용 여부가 결정됩니다.'
    },
    법령: {
      ic: '📘', tag: 'wiki/statutes/ · 법령 허브',
      desc: '각 법의 <b>허브 페이지</b>(2층). 목차·타법연결 표·처벌 요약을 한 곳에 모아, 그 법의 전체 그림과 다른 법과의 연결을 봅니다. 개념 페이지들의 착지점.'
    },
    비교허브: {
      ic: '🔀', tag: 'wiki/comparisons/ · 테마 비교실',
      desc: '여러 법을 <b>하나의 축으로 비교</b>하는 방(신경망 허브). "음주운항 처벌은 법마다 어떻게 다른가" 같은 교차 질문에 답합니다. 톤수·조업형태·지역 조건 컬럼으로 프로필 필터와 연결.'
    },
    '별표·서식': {
      ic: '📊', tag: 'wiki/annexes/ · 별표·서식실',
      desc: '별표(표·기준)와 별지 서식의 <b>정리본</b>. 원문 이미지/HWP를 표로 정리하고, 서식은 원버튼 다운로드를 제공합니다. 이미지 판독 수치는 ⚠REVIEW로 사람 검증 대기.'
    },
    지식그래프: {
      ic: '🕸️', tag: 'wiki/graph.json · 신경망',
      desc: '법·개념을 <b>노드</b>, 인용·[[링크]]를 <b>엣지</b>로 본 신경망(그래프층). 챗봇 멀티홉 검색이 이 인접구조를 타고 근거를 확장합니다. 아래 목록은 연결이 많은 법부터 — 관리자는 고립노드·허브결손을 여기서 봅니다.'
    }
  };
  var ROOM_ORDER = ['원문', '위키개념', '법령', '비교허브', '별표·서식', '지식그래프'];
  var ROOM_N = { 원문: true, 위키개념: true };

  var roomStats = null;      // GET /api/legal/rooms/stats 결과(방 통계). 못 받았으면 null.
  var roomPage = {};         // 방마다 지금 보고 있는 쪽(1부터). 방을 다시 열면 그 쪽으로 돌아온다.
  var curRoom = '원문';      // 지금 열려 있는 방 — 인트로 카드를 다시 칠할 때 쓴다.
  var roomSeq = 0;           // 목록 요청 일련번호. 쪽·방을 빨리 바꾸면 늦게 온 응답이 최신 화면을
                             //   덮어써 "3쪽을 눌렀는데 2쪽이 보이는" 일이 생긴다 — 최신 것만 그린다.
  var ROOM_PAGE_WINDOW = 5;  // 쪽 번호를 한 번에 5개까지만 보인다(사고내역 팝업과 같은 규칙).

  /** 숫자를 1,286 처럼 세 자리마다 끊어 쓴다. @param {number} n @returns {string} */
  function nfmt(n) { return Number(n || 0).toLocaleString('ko-KR'); }

  /**
   * 원문 머리말의 시행일(YYYYMMDD)을 화면 표기로 바꾼다. 값이 없으면 지어내지 않는다.
   * 예: effLabel('20230628') → '2023. 6. 28.' · effLabel('') → ''
   * @param {string} s - 8자리 숫자 문자열
   * @returns {string} 8자리가 아니면 '' (호출부가 "확인 안 됨"을 대신 쓴다)
   * [연계] ← rawRowHTML/lawBodyHTML. 서버 /api/legal/rooms/law 이 .txt 머리말에서 읽어 준 값을 그대로 표시.
   */
  function effLabel(s) {
    var m = /^(\d{4})(\d{2})(\d{2})$/.exec(String(s || ''));
    return m ? m[1] + '. ' + Number(m[2]) + '. ' + Number(m[3]) + '.' : '';
  }

  /** 도메인 폴더명을 사람이 읽는 꼴로. 예: '04_선박해운' → '04 선박해운'. @param {string} d @returns {string} */
  function domLabel(d) { return String(d || '').replace('_', ' '); }

  /** status 값에 맞는 배지 CSS 클래스. @param {string} st @returns {string} */
  function stClass(st) { return st === 'canonical' ? 'nrya-st-can' : (st === 'review-pending' ? 'nrya-st-rev' : 'nrya-st-draft'); }

  /** 리스트 래퍼. @param {string[]} arr @returns {string} */
  function items(arr) { return '<div class="nrya-list">' + arr.join('') + '</div>'; }

  /**
   * 목록 아이템 1개 HTML(개념·법령·비교허브·별표서식·그래프 공용).
   * 예: itemHTML('음주운항조타', '해상교통안전법', 'canonical', ['처벌 포함'])
   * @param {string} t - 제목
   * @param {string} s - 부제(법 이름·수치 요약)
   * @param {string} st - 오른쪽 배지 글자(없으면 배지를 안 그린다)
   * @param {string} stc - 배지 CSS 클래스
   * @param {string[]} [chips] - 파란 칩 목록
   * @returns {string}
   * [연계] ← paintRoomList. 서버 /api/legal/rooms/list 가 준 값만 넣는다(지어낸 값 없음).
   */
  function itemHTML(t, s, st, stc, chips) {
    return '<div class="nrya-item"><div class="nrya-item-b"><div class="nrya-item-t">' + esc(t) + '</div><div class="nrya-item-s">' + esc(s) + '</div>' +
      (chips && chips.length ? '<div class="nrya-chips">' + chips.map(function (c) { return '<span class="nrya-chip">' + esc(c) + '</span>'; }).join('') + '</div>' : '') +
      '</div>' + (st ? '<span class="nrya-stbadge ' + stc + '">' + esc(st) + '</span>' : '') + '</div>';
  }

  // ============================================================================
  // 관리자 검토 데이터 모델 (5개 서브탭 전부 서버 연동 — 배지: refreshAdminStats/refreshStats,
  //   목록: 초안승인=renderDraftCards·⚠수치검증=renderReviewCards·나머지 3방=renderFeedbackCards/
  //   renderCandidateCards/renderAmendCards)
  // ============================================================================
  var ADMIN = {
    초안승인: { n: '…', desc: '사서(AI)가 만든 <b>미승인 초안(draft)</b> 대기실. 순수 정의·절차는 재검증 파이프라인이 자동 승격, 처벌·안전값 포함분은 ⚠수치검증 방에서 사람이 승인해야 canonical이 됩니다.', render: null /* 서버 연동: renderDraftCards */ },
    피드백: { n: '…', desc: '답변 <b>👍/👎 익명 로그</b>를 모아 원인 분류(triage) 후 관리자에게 올리는 방. 👎가 쌓인 주제 → 위키 보강으로 연결.', render: null /* 서버 연동: renderFeedbackCards */ },
    새지식후보: { n: '…', desc: '대화 중 <b>새로 알게 된 지식 후보</b>. 공식 출처와 대조 후 관리자가 승인하면 위키에 편입됩니다(환각 방지 게이트).', render: null /* 서버 연동: renderCandidateCards */ },
    개정검토: { n: '…', desc: '법률 <b>개정·조문 변경이 감지</b>됐을 때 사람 검토 전까지 모아두는 방. 바뀐 조문마다 <b>개정 전 → 개정 후 본문</b>을 펼쳐 볼 수 있고, 우리 원문에 없는 조는 <b>신설</b>로 표시됩니다.<br><b>승인을 누르면</b> ①미리 받아 둔 새 원문이 있는 건은 <b>시행일부터 챗봇 답변이 새 내용으로 바뀝니다</b>(시행일이 이미 지났으면 즉시) ②재수집 대상으로 표시됩니다. <b>원문 재수집과 위키 수정은 자동으로 되지 않습니다</b> — 서버는 저장소에 글을 쓸 수 없어, 작업 세션이 받아서 반영해야 합니다.<br><b>[✓ 전체 승인]</b> 은 대기 중인 건을 한 번에 승인합니다. <b>두 번 눌러야</b> 실행되며, 첫 번째 클릭에서 <b>몇 건이 승인 즉시(또는 시행일부터) 답변이 바뀌는지</b>를 먼저 알려 줍니다. 승인이 끝나면 <b>방금 승인한 전 건을 한 덩어리로 묶은 위키 반영 지시문</b>이 바로 펼쳐집니다.<br><b>[📋 승인분 전체 지시문]</b> 은 그 글을 나중에 다시 뽑을 때 씁니다(개별 카드의 지시문과 별개).', render: null /* 서버 연동: renderAmendCards */ },
    원문신선도: { n: '…', desc: '우리가 받아 둔 <b>법령·고시 원문이 낡았는지</b> 매주 자동 대조해 모아두는 방. 대상은 <b>행정규칙(고시·훈령) 653건 + 법률·시행령·시행규칙 222건</b>. 원문 머리글의 수집 일련번호와 law.go.kr 현행 일련번호를 기계로 비교한다(2026-08-23에 「위험물 선박운송 기준」이 2016년판으로 남아 있어 <b>이미 삭제된 조문을 현행처럼</b> 설명하던 사고가 있었다). 카드마다 <b>어느 위키를 고쳐야 하는지·무엇을 해야 하는지</b>가 함께 적힌다.', render: null /* 서버 연동: renderFreshCards */ },
    '⚠수치검증': { n: '…', desc: '별표 <b>이미지 판독값(OCR)·조번호 재편</b> 및 처벌·안전수치를 사람이 검증하는 방(가장 급함). 서버 review_queue.md 의 검증 대기 항목을 불러와 승인/반려한다.', render: null /* 서버 연동: renderReviewCards */ }
  };
  // ⚠수치검증을 맨 앞에 둔다 — 기본으로 열리는 방인데 맨 끝에 있어서 서브탭 줄이
  //   가로로 넘칠 때 화면 밖으로 밀려 보이지 않았다(사용자 화면 확인, 2026-08-28).
  var ADMIN_ORDER = ['⚠수치검증', '초안승인', '피드백', '새지식후보', '개정검토', '원문신선도'];

  // ============================================================================
  // 관리자 콘솔 렌더링 — 통합관리자 센터 컨테이너(#unified-admin-body)에 마운트
  // ============================================================================

  /**
   * 통합관리자 센터의 "나리야 법령" 탭이 부르는 진입점. 주어진 컨테이너에 나리야
   * 관리자 콘솔 전체(지식 방 브라우저 + 관리자 검토센터 + 노출 토글)를 렌더한다.
   * 탭을 열 때마다 새로 불려도 안전하도록 매번 innerHTML 을 재구성한다.
   * @param {HTMLElement} container - 콘솔을 담을 컨테이너(예: #unified-admin-body)
   * [연계] ← admin.js switchUnifiedAdminTab('nariya'). → renderRoom/renderAdmin/initSeg.
   */
  function renderAdminInto(container) {
    if (!container) return;

    container.innerHTML =
      '<div class="nrya-console">' +
        '<div class="nrya-app">' +
          '<div class="nrya-env-ribbon"><span class="nrya-dot"></span>나리야 법령 콘솔 · 챗봇 노출은 서버 전역 설정(기본: 비노출)</div>' +
          '<div class="nrya-header">' +
            '<div class="nrya-h-row"><div class="nrya-h-mark">나</div><div><div class="nrya-h-title">AI 챗봇 · 나리야</div><div class="nrya-h-sub">해양법령 지식베이스 관리</div></div></div>' +
            '<div class="nrya-vswitch" id="nryaVswitch">' +
              '<button class="nrya-active" data-view="rooms">💬 지식 방</button>' +
              '<button data-view="admin">🛠 관리자 검토 <span class="nrya-vb-badge" id="nryaVbBadge">…</span></button>' +
            '</div>' +
          '</div>' +
          '<div id="nryaViewRooms">' +
            '<div class="nrya-rooms" id="nryaRoomPills"></div>' +
            '<div id="nryaRoomContent"></div>' +
          '</div>' +
          '<div id="nryaViewAdmin" class="nrya-hidden">' +
            '<div class="nrya-panel">' +
              // [2026-09-10 사용자 확정] 리뷰 전용 페이지(client/legal_review.html)를 없앴다 —
              //   그 페이지가 쓰던 API(`/api/legal/reviews`·`/reviews/stats`·`/reviews/:id/approve`)를
              //   이 콘솔의 ⚠수치검증 방이 전부 쓰고 `submit-findings` 까지 더 갖고 있어, 화면이 둘로
              //   갈려 있을 이유가 없었다. 좁아서 못 읽던 문제는 이 콘솔을 전체화면으로 키워 해결한다.
              '<div class="nrya-card">' +
                '<div class="nrya-card-lab"><span class="nrya-pipe"></span>AI 챗봇 노출 설정 (서버 전역)</div>' +
                '<div class="nrya-seg" id="nryaSeg">' +
                  '<button data-exp="user">일반 노출</button>' +
                  '<button data-exp="admin">관리자만</button>' +
                  '<button data-exp="off">비노출</button>' +
                '</div>' +
                '<div class="nrya-seg-help" id="nryaSegHelp">노출 설정을 불러오는 중…</div>' +
                '<div class="nrya-seg-err nrya-hidden" id="nryaSegErr"></div>' +
              '</div>' +
              '<div class="nrya-card-lab" style="padding:0 2px"><span class="nrya-pipe"></span>관리자 검토 센터 · 5개 검토 방(UI 통합·데이터 분리)</div>' +
              '<div class="nrya-subtabs" id="nryaSubtabs"></div>' +
              '<div id="nryaAdminContent"></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var root = container.querySelector('.nrya-console');

    // 뷰 전환(지식 방 / 관리자 검토)
    var vsw = root.querySelector('#nryaVswitch');
    vsw.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-view]'); if (!b) return;
      this.querySelectorAll('button').forEach(function (x) { x.classList.remove('nrya-active'); });
      b.classList.add('nrya-active');
      var v = b.dataset.view;
      root.querySelector('#nryaViewRooms').classList.toggle('nrya-hidden', v !== 'rooms');
      root.querySelector('#nryaViewAdmin').classList.toggle('nrya-hidden', v !== 'admin');
    });

    // 노출 3-state 토글(서버 전역 설정)
    initSeg(root);

    // 초기 렌더
    renderRoomPills('원문'); renderRoom('원문');
    renderSubtabs('⚠수치검증'); renderAdmin('⚠수치검증');

    // 서버에서 노출설정·통계를 받아 토글/배지 갱신
    fetchConfig();
    refreshRoomStats();   // 지식 방 갈래 버튼 6개 숫자·인트로 칩(실데이터)
    refreshStats();
    refreshAdminStats();
  }

  /**
   * 노출 토글(일반노출/관리자만/비노출)의 상태를 서버 설정으로 그리고, 클릭 시
   * POST /api/legal/config 로 저장한 뒤 FAB 표시를 재평가한다.
   * @param {HTMLElement} root - .nrya-console 루트
   * [연계] → setConfig/paintSeg. 서버 전역 노출 규칙의 관리자 진입점.
   */
  function initSeg(root) {
    var seg = root.querySelector('#nryaSeg');
    seg.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-exp]'); if (!b) return;
      setConfig(b.dataset.exp);
    });
    paintSeg(); // 현재 알고 있는 serverExposure 로 즉시 1차 페인트
  }

  /**
   * 현재 마운트된 노출 토글 UI를 serverExposure 값에 맞춰 칠하고 안내문을 갱신한다.
   * 콘솔이 안 떠 있으면 아무 것도 하지 않는다(안전).
   */
  function paintSeg() {
    var seg = document.getElementById('nryaSeg'); if (!seg) return;
    var help = document.getElementById('nryaSegHelp');
    var HELP = {
      user: '<b>일반 노출</b> — 모든 사용자에게 챗봇 버튼이 노출됩니다(특보 탭에서만). 서버 전역 설정입니다.',
      admin: '<b>관리자만</b> — 관리자 모드 기기에서만 챗봇 버튼이 보입니다. 일반 사용자에겐 노출되지 않습니다(특보 탭에서만).',
      off: '<b>비노출(기본값)</b> — 아무에게도 챗봇 버튼이 노출되지 않습니다. 테스트 완료 후 노출로 전환하세요.'
    };
    seg.querySelectorAll('button').forEach(function (x) {
      var on = x.dataset.exp === serverExposure;
      x.classList.toggle('nrya-on', on);
      x.classList.toggle('nrya-warn', on && (serverExposure === 'admin' || serverExposure === 'off'));
    });
    if (help) help.innerHTML = (configLoaded ? '' : '<span style="color:#94a3b8">(서버 조회 전 · 기본값 표시) </span>') + (HELP[serverExposure] || HELP.off);
  }

  /** 노출 토글 저장 실패 등 인라인 오류 표시. @param {string} msg */
  function segError(msg) {
    var el = document.getElementById('nryaSegErr'); if (!el) return;
    el.style.display = 'block'; el.classList.remove('nrya-hidden'); el.textContent = msg;
  }
  function segClearError() { var el = document.getElementById('nryaSegErr'); if (!el) return; el.style.display = 'none'; el.textContent = ''; }

  /**
   * 서버의 챗봇 노출 설정을 조회해 serverExposure 를 갱신하고, 토글/ FAB 를 재평가한다.
   * 실패 시 기본값(off)을 유지한다(안전 — 노출 안 됨).
   * [연계] → GET /api/legal/config. ← boot(로드 시), renderAdminInto(콘솔 열 때).
   */
  function fetchConfig() {
    return legalGet('/api/legal/config').then(function (res) {
      return res.json().catch(function () { return null; });
    }).then(function (data) {
      if (data && data.ok && ['off', 'admin', 'user'].indexOf(data.exposure) !== -1) {
        serverExposure = data.exposure;
      }
      configLoaded = true;
      paintSeg();
      updateFabVisibility();
    }).catch(function () {
      configLoaded = true; // 실패해도 기본 off 로 확정
      paintSeg();
      updateFabVisibility();
    });
  }

  /**
   * 노출 설정을 서버에 저장(관리자 전용)하고 성공 시 FAB 를 재평가한다.
   * @param {'user'|'admin'|'off'} exp
   * [연계] → POST /api/legal/config. ← initSeg 클릭.
   */
  function setConfig(exp) {
    segClearError();
    legalPost('/api/legal/config', { exposure: exp }).then(function (res) {
      if (res.status === 401 || res.status === 403) return { _denied: true };
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data._denied) { segError('관리자 로그인 필요 — 통합관리자 센터에서 로그인 후 다시 시도하세요.'); return; }
      if (!data || !data.ok) { segError((data && data.error) || '노출 설정 저장 실패'); return; }
      serverExposure = data.exposure || exp;
      paintSeg();
      updateFabVisibility();
    }).catch(function (e) { segError('네트워크 오류: ' + String(e && e.message || e)); });
  }

  /**
   * 갈래 버튼(방 pill) 6개의 숫자를 서버 통계에서 만든다. 아직 못 받았으면 '…'.
   * 예: roomCount('위키개념') → '963' · roomCount('원문') → '70법'
   * @param {string} k - 방 이름
   * @returns {string} 버튼에 찍을 짧은 숫자
   * [연계] ← renderRoomPills. → roomStats(GET /api/legal/rooms/stats). 상수 금지 — 못 받으면 '…'.
   */
  function roomCount(k) {
    var s = roomStats; if (!s) return '…';
    if (k === '원문') return nfmt(s.raw.laws) + '법';
    if (k === '지식그래프') return nfmt(s.graph.nodes) + '노드';
    var m = { 위키개념: 'concept', 법령: 'statute', 비교허브: 'comparison', '별표·서식': 'annex' }[k];
    return m ? nfmt(s[m].total) : '…';
  }

  /**
   * 인트로 카드 아래 회색 칩 목록을 서버 통계로 만든다(옛 하드코딩 meta 배열을 대체).
   * 예: roomChips('위키개념') → ['canonical 734', 'review-pending 3', 'draft 226']
   * @param {string} k - 방 이름
   * @returns {string[]} 통계를 못 받았으면 설명 칩만
   * [연계] ← renderRoom. → roomStats. status 칩은 **서버가 실제로 센 키만** 그린다(없는 키를 0으로 지어내지 않음).
   */
  function roomChips(k) {
    var s = roomStats;
    if (!s) return ['숫자 불러오는 중…'];
    var ST = ['canonical', 'review-pending', 'draft'];
    var statusChips = function (o) { return ST.filter(function (x) { return o[x]; }).map(function (x) { return x + ' ' + nfmt(o[x]); }); };
    if (k === '원문') return ['불변', nfmt(s.raw.domains) + ' 도메인', '원문 ' + nfmt(s.raw.txtFiles) + '건', '별표·고시 포함'];
    if (k === '위키개념') return statusChips(s.concept.status);
    if (k === '법령') return ['기준법 ' + nfmt(s.statute.inRaw), '타부처 ' + nfmt(s.statute.notInRaw)].concat(statusChips(s.statute.status));
    if (k === '비교허브') return ['교차법 비교'].concat(statusChips(s.comparison.status));
    if (k === '별표·서식') return statusChips(s.annex.status);
    if (k === '지식그래프') {
      return ['엣지 ' + nfmt(s.graph.edges)].concat(Object.keys(s.graph.kinds).sort().map(function (x) { return x + ' ' + nfmt(s.graph.kinds[x]); }));
    }
    return [];
  }

  /**
   * 서버에서 방 통계를 받아 갈래 버튼·인트로 칩을 다시 그린다.
   * [연계] → GET /api/legal/rooms/stats(관리자 토큰 필요). ← renderAdminInto(콘솔을 열 때 1회).
   *          실패해도 화면은 '…' 인 채로 살아 있게 둔다 — 숫자를 지어내지 않는다.
   */
  function refreshRoomStats() {
    return legalGet('/api/legal/rooms/stats').then(function (res) {
      return res.json().catch(function () { return null; });
    }).then(function (d) {
      if (!d || !d.ok) return;
      roomStats = d;
      if (document.getElementById('nryaRoomPills')) { renderRoomPills(curRoom); paintRoomIntro(curRoom); }
    }).catch(function () { /* 숫자는 '…' 로 남는다 */ });
  }

  /** 방 pill 목록을 그린다(활성 방 표시 + 실데이터 N + N 배지). @param {string} active */
  function renderRoomPills(active) {
    var el = document.getElementById('nryaRoomPills'); if (!el) return; el.innerHTML = '';
    ROOM_ORDER.forEach(function (k) {
      var b = document.createElement('div'); b.className = 'nrya-room' + (k === active ? ' nrya-active' : '');
      b.innerHTML = esc(k) + '<span class="nrya-cnt">' + esc(roomCount(k)) + '</span>' + (ROOM_N[k] ? '<span class="nrya-new-badge">N</span>' : '');
      b.addEventListener('click', function () { renderRoomPills(k); renderRoom(k); });
      el.appendChild(b);
    });
  }

  /** 인트로 카드(설명 + 실데이터 칩)만 다시 그린다. @param {string} k 방 이름 */
  function paintRoomIntro(k) {
    var host = document.getElementById('nryaRoomIntro'); if (!host || !ROOMS[k]) return;
    var r = ROOMS[k];
    host.innerHTML = '<div class="nrya-intro"><div class="nrya-intro-h"><div class="nrya-intro-ic">' + r.ic + '</div><div><div class="nrya-intro-name">' + esc(k) + ' 방</div><div class="nrya-intro-tag">' + esc(r.tag) + '</div></div></div>' +
      '<div class="nrya-intro-desc">' + r.desc + '</div><div class="nrya-intro-meta">' +
      roomChips(k).map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div></div>';
  }

  /**
   * 선택한 방을 그린다 — 인트로 카드 + (서버에서 받은) 목록 + 쪽 이동 단추.
   * 목록은 여기서 그리지 않고 loadRoomList 가 서버 응답을 받아 채운다.
   * @param {string} k - 방 이름
   * [연계] ← renderRoomPills 클릭 · renderAdminInto 초기 렌더. → loadRoomList.
   */
  function renderRoom(k) {
    var host = document.getElementById('nryaRoomContent'); if (!host || !ROOMS[k]) return;
    curRoom = k;
    host.innerHTML = '<div id="nryaRoomIntro"></div><div id="nryaRoomBody"></div>';
    paintRoomIntro(k);
    loadRoomList(k, roomPage[k] || 1);
  }

  /**
   * 방 목록 한 쪽(10개)을 서버에서 받아 그린다.
   * 예: loadRoomList('위키개념', 3) → GET /api/legal/rooms/list?room=concept&page=3
   * @param {string} k - 방 이름
   * @param {number} page - 1부터 세는 쪽 번호
   * [연계] → GET /api/legal/rooms/list. ← renderRoom · 쪽 이동 단추. 늦게 온 응답은 curRoom 으로 걸러 버린다.
   */
  function loadRoomList(k, page) {
    roomPage[k] = page;
    var seq = ++roomSeq;
    var body = document.getElementById('nryaRoomBody'); if (!body) return;
    body.innerHTML = '<div class="nrya-list"><div class="nrya-notice-box"><span class="nrya-em">⏳</span>목록을 불러오는 중…</div></div>';
    legalGet('/api/legal/rooms/list?room=' + ROOM_KEY[k] + '&page=' + page).then(function (res) {
      if (res.status === 401 || res.status === 403) return { _denied: true };
      return res.json().catch(function () { return null; });
    }).then(function (d) {
      if (seq !== roomSeq) return;                                // 더 최근 요청이 있으면 이 응답은 버린다
      var b = document.getElementById('nryaRoomBody'); if (!b) return;
      if (d && d._denied) { b.innerHTML = adminLockHTML(); return; }
      if (!d || !d.ok) { b.innerHTML = roomErrHTML((d && d.error) || '목록을 불러오지 못했습니다.'); return; }
      roomPage[k] = d.page;   // 범위 밖 쪽을 서버가 당겨 줬으면 그 값으로 맞춘다
      paintRoomList(b, k, d);
    }).catch(function (e) {
      if (seq !== roomSeq) return;
      var b = document.getElementById('nryaRoomBody');
      if (b) b.innerHTML = roomErrHTML('네트워크 오류: ' + String(e && e.message || e));
    });
  }

  /** 목록을 못 불러왔을 때의 안내(숫자를 지어내지 않고 사실만 적는다). @param {string} msg @returns {string} */
  function roomErrHTML(msg) {
    return '<div class="nrya-list"><div class="nrya-notice-box"><span class="nrya-em">⚠</span>' + esc(msg) + '</div></div>';
  }

  /**
   * 받은 한 쪽을 실제 DOM 으로 그린다(목록 10줄 + 쪽 이동 단추 + "N / M쪽 · 모두 K건").
   * @param {HTMLElement} host - #nryaRoomBody
   * @param {string} k - 방 이름
   * @param {object} d - 서버 응답 {items,page,pages,total,perPage}
   * [연계] ← loadRoomList. → rawRowHTML/listRowHTML · roomPagerHTML · bindRoomPager · bindLawAcc.
   */
  function paintRoomList(host, k, d) {
    var rows = (d.items || []).map(k === '원문' ? rawRowHTML : function (it) { return listRowHTML(k, it); });
    host.innerHTML = items(rows.length ? rows : ['<div class="nrya-notice-box"><span class="nrya-em">🔎</span>이 방에 항목이 없습니다.</div>']) +
      roomPagerHTML(d);
    bindRoomPager(host, k);
    if (k === '원문') bindLawAcc(host);
  }

  /**
   * 원문 방 한 줄 — 법 하나의 아코디언 머리(펼치면 계층 원문·별표·고시를 그때 불러온다).
   * @param {object} l - {name, dir, domain, ministry, eff}
   * @returns {string}
   * [연계] ← paintRoomList. → bindLawAcc(펼침) · GET /api/legal/rooms/law.
   */
  function rawRowHTML(l) {
    var eff = effLabel(l.eff);
    return '<div class="nrya-acc" data-dir="' + esc(l.dir) + '"><div class="nrya-acc-head"><div style="flex:1;min-width:0">' +
      '<div class="nrya-acc-name">' + esc(l.name) + '</div>' +
      '<div class="nrya-acc-dom">' + esc(domLabel(l.domain) + (l.ministry ? ' · ' + l.ministry : '')) + '</div></div>' +
      '<div class="nrya-eff"><span class="nrya-lbl">시행</span>' + (eff || '확인 안 됨') + '</div>' +
      '<div class="nrya-chev">▼</div></div><div class="nrya-acc-body"></div></div>';
  }

  /**
   * 원문 말고 다섯 방의 한 줄. 방마다 부제에 쓰는 수치가 다르다(전부 서버가 센 값).
   * @param {string} k - 방 이름
   * @param {object} it - 서버 응답 items[i]
   * @returns {string}
   * [연계] ← paintRoomList. → itemHTML.
   */
  function listRowHTML(k, it) {
    if (k === '지식그래프') {
      return itemHTML(it.title, '위키 ' + nfmt(it.pages) + '쪽 · 나가는 링크 ' + nfmt(it.out) + ' · 들어오는 링크 ' + nfmt(it.in),
        '연결 ' + nfmt(it.degree), 'nrya-st-draft', []);
    }
    var chips = [];
    if (it.penalty) chips.push('처벌 포함');
    if (it.byls) chips.push('별표 ' + nfmt(it.byls));
    var sub;
    if (k === '법령') sub = '개념 ' + nfmt(it.concepts) + ' · 타법연결 ' + nfmt(it.xlaw) + ' · 링크 ' + nfmt(it.links);
    else if (k === '비교허브') sub = '다루는 법 ' + nfmt(it.xlaw) + ' · 링크 ' + nfmt(it.links);
    else sub = it.law || '';
    return itemHTML(it.title, sub, it.status, stClass(it.status), chips);
  }

  /**
   * 쪽 이동 단추 — « ‹ 1 2 3 4 5 › » (쪽 번호는 5개까지, 현재 쪽 주위로 따라 움직인다).
   * 사고내역 팝업(accident_info.js buildWarnDetailPager)과 **같은 방식**을 따른다.
   * 예: 97쪽 중 1쪽 → « ‹ 가 disabled, 1 2 3 4 5 › » + '1 / 97쪽 · 모두 963건'
   * @param {object} d - 서버 응답 {page,pages,total}
   * @returns {string} 한 쪽뿐이면 단추 없이 건수만
   * [연계] ← paintRoomList. → bindRoomPager(클릭 처리).
   */
  function roomPagerHTML(d) {
    var note = '<div class="nrya-pagenote">' + nfmt(d.page) + ' / ' + nfmt(d.pages) + '쪽 · 모두 ' + nfmt(d.total) + '건</div>';
    if (d.pages <= 1) return note;
    var from = Math.max(1, Math.min(d.page - Math.floor(ROOM_PAGE_WINDOW / 2), d.pages - ROOM_PAGE_WINDOW + 1));
    var to = Math.min(d.pages, from + ROOM_PAGE_WINDOW - 1);
    var nums = '';
    for (var i = from; i <= to; i++) {
      nums += '<button type="button" class="n' + (i === d.page ? ' on' : '') + '" data-rpage="' + i + '">' + i + '</button>';
    }
    var edge = function (p, label, aria, off) {
      return '<button type="button" class="e" data-rpage="' + p + '"' + (off ? ' disabled' : '') + ' aria-label="' + aria + '">' + label + '</button>';
    };
    var first = d.page === 1, last = d.page === d.pages;
    return '<div class="nrya-pager">' +
      edge(1, '&laquo;', '첫 쪽', first) + edge(d.page - 1, '&lsaquo;', '이전 쪽', first) + nums +
      edge(d.page + 1, '&rsaquo;', '다음 쪽', last) + edge(d.pages, '&raquo;', '마지막 쪽', last) +
      '</div>' + note;
  }

  /** 쪽 단추 클릭 → 그 쪽을 서버에서 다시 받아 그린다. @param {HTMLElement} host @param {string} k */
  function bindRoomPager(host, k) {
    host.querySelectorAll('.nrya-pager button[data-rpage]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.disabled) return;
        loadRoomList(k, parseInt(b.dataset.rpage, 10) || 1);
      });
    });
  }

  // 서브탭 배지가 참조할 adminStatsCache 필드명(⚠수치검증은 statsCache.pending을 따로 씀)
  var ADMIN_STAT_KEY = { 초안승인: 'draft', 피드백: 'feedback', 새지식후보: 'candidates', 개정검토: 'amendments', 원문신선도: 'freshness' };

  /** 서브탭(관리자 검토 6개 방)을 그린다. @param {string} active */
  function renderSubtabs(active) {
    curAdminSubtab = active;
    var el = document.getElementById('nryaSubtabs'); if (!el) return; el.innerHTML = '';
    ADMIN_ORDER.forEach(function (k) {
      var a = ADMIN[k];
      var cnt = a.n;
      if (k === '⚠수치검증' && statsCache) cnt = String(statsCache.pending);
      else if (ADMIN_STAT_KEY[k] && adminStatsCache) cnt = String(adminStatsCache[ADMIN_STAT_KEY[k]]);
      var b = document.createElement('div'); b.className = 'nrya-subtab' + (k === active ? ' nrya-active' : '');
      b.innerHTML = esc(k) + '<span class="nrya-qn">' + esc(cnt) + '</span>';
      b.addEventListener('click', function () { renderSubtabs(k); renderAdmin(k); });
      el.appendChild(b);
    });
  }

  /** 선택한 관리자 방을 그린다(6방 전부 서버 연동). @param {string} k */
  function renderAdmin(k) {
    var a = ADMIN[k]; var host = document.getElementById('nryaAdminContent'); if (!host) return;
    stopScanGauge();   // 다른 방으로 옮기면 진행률 폴링을 멈춘다(스캔 자체는 서버에서 계속 돈다)
    var intro = '<div class="nrya-intro"><div class="nrya-intro-h"><div class="nrya-intro-ic">🛠</div><div><div class="nrya-intro-name">' + esc(k) + '</div><div class="nrya-intro-tag">관리자 검토 방 · 승인→자동반영</div></div></div><div class="nrya-intro-desc">' + a.desc + '</div></div>';
    if (k === '⚠수치검증') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaReviewHost" style="padding:6px 0 4px"></div>';
      renderReviewCards(document.getElementById('nryaReviewHost'));
    } else if (k === '초안승인') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaDraftHost" style="padding:6px 0 4px"></div>';
      renderDraftCards(document.getElementById('nryaDraftHost'));
    } else if (k === '피드백') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaFeedbackHost" style="padding:6px 0 4px"></div>';
      renderFeedbackCards(document.getElementById('nryaFeedbackHost'));
    } else if (k === '새지식후보') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaCandidateHost" style="padding:6px 0 4px"></div>';
      renderCandidateCards(document.getElementById('nryaCandidateHost'));
    } else if (k === '개정검토') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaAmendHost" style="padding:6px 0 4px"></div>';
      renderAmendCards(document.getElementById('nryaAmendHost'));
    } else if (k === '원문신선도') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaFreshHost" style="padding:6px 0 4px"></div>';
      renderFreshCards(document.getElementById('nryaFreshHost'));
    }
  }

  // ── 원문 방 아코디언 — 펼칠 때 그 법의 계층 원문·별표·고시를 서버에서 그때 받아 채운다 ──

  /**
   * 법 목록의 아코디언 머리에 클릭을 걸고, 처음 펼칠 때 한 번만 내용을 불러온다.
   * (70법치를 미리 다 읽지 않기 위해 지연 로딩 — 한 법에 별표가 147건인 경우도 있다)
   * @param {HTMLElement} host - 목록을 담은 #nryaRoomBody
   * [연계] ← paintRoomList(원문 방). → GET /api/legal/rooms/law · lawBodyHTML.
   */
  function bindLawAcc(host) {
    host.querySelectorAll('.nrya-acc').forEach(function (acc) {
      var head = acc.querySelector('.nrya-acc-head'); if (!head) return;
      head.onclick = function () {
        var opened = acc.classList.toggle('nrya-open');
        var body = acc.querySelector('.nrya-acc-body');
        if (!opened || !body || body.dataset.state) return;        // 이미 불렀거나 부르는 중이면 그대로
        body.dataset.state = 'loading';
        body.innerHTML = '<div class="nrya-file"><div class="nrya-file-nm">원문 목록을 불러오는 중…</div></div>';
        legalGet('/api/legal/rooms/law?dir=' + encodeURIComponent(acc.dataset.dir)).then(function (res) {
          if (res.status === 401 || res.status === 403) return { _denied: true };
          return res.json().catch(function () { return null; });
        }).then(function (d) {
          if (d && d._denied) { body.innerHTML = adminLockHTML(); body.dataset.state = ''; return; }
          if (!d || !d.ok) { body.innerHTML = '<div class="nrya-file"><div class="nrya-file-nm">' + esc((d && d.error) || '불러오지 못했습니다.') + '</div></div>'; body.dataset.state = ''; return; }
          body.innerHTML = lawBodyHTML(d);
          body.dataset.state = 'loaded';
          bindLawDl(body);
        }).catch(function (e) {
          body.innerHTML = '<div class="nrya-file"><div class="nrya-file-nm">네트워크 오류: ' + esc(String(e && e.message || e)) + '</div></div>';
          body.dataset.state = '';
        });
      };
    });
  }

  /**
   * 펼친 법 하나의 내용 HTML — 계층 원문(실제 시행일)·별표/별지 서식·고시(행정규칙).
   * ★시행일은 서버가 각 .txt 머리말에서 읽은 값이다. 없으면 '확인 안 됨' — 지어내지 않는다.
   * @param {object} d - GET /api/legal/rooms/law 응답
   * @returns {string}
   * [연계] ← bindLawAcc. 링크는 /api/legal/src(우리 raw 원문)와 law.go.kr 원본(HWP·이미지).
   */
  function lawBodyHTML(d) {
    var files = (d.files || []).map(function (f) {
      // 챗봇이 실제로 읽는 판을 그대로 보여준다 — 시행일이 지난 예고본이 있으면 그 파일이다(staged).
      // 아직 시행 전인 예고본은 pending 으로 "언제부터 바뀐다"만 알려 준다.
      // 예고본 적용 / 승인 대기(시행일은 지났는데 승인이 안 나 옛 판을 읽는 중) / 개정 예정 — 셋을 구분한다.
      var note = f.staged ? '<span class="nrya-file-amd">· 예고본 적용</span>'
        : (f.waiting && f.waiting.length ? '<span class="nrya-file-amd">· ' + esc(effLabel(f.waiting[0])) + ' 시행분 승인 대기(옛 판 표시 중)</span>'
        : (f.pending && f.pending.length ? '<span class="nrya-file-amd">· ' + esc(effLabel(f.pending[0])) + ' 개정 예정</span>' : ''));
      return '<a class="nrya-file" href="' + esc(f.src) + '" target="_blank" rel="noopener">' +
        '<div class="nrya-file-ic' + (f.ic === '법' ? '' : ' nrya-rule') + '">' + esc(f.ic) + '</div>' +
        '<div class="nrya-file-nm">' + esc(f.label) + (f.amd ? '<span class="nrya-file-amd">· ' + esc(f.amd) + '</span>' : '') + note + '</div>' +
        '<div class="nrya-file-eff">' + (f.eff ? '시행 ' + effLabel(f.eff) : '시행일 확인 안 됨') + '</div></a>';
    }).join('') || '<div class="nrya-file"><div class="nrya-file-nm">계층 원문 파일이 없습니다.</div></div>';

    var byls = (d.byls || []).map(function (b) {
      var dl = [];
      if (b.src) dl.push('<a href="' + esc(b.src) + '" target="_blank" rel="noopener">📄 본문(텍스트)</a>');
      if (b.hwp) dl.push('<a href="' + esc(b.hwp) + '" data-dl="1">⬇ HWP 원본</a>');
      if (b.pdf) dl.push('<a href="' + esc(b.pdf) + '" data-dl="1">⬇ PDF</a>');
      if (b.img) dl.push('<a href="' + esc(b.img) + '" data-dl="1" class="nrya-img">🖼 이미지</a>');
      return '<div class="nrya-byl"><span class="nrya-byl-no">' + esc(b.badge) + '</span><div style="flex:1">' +
        '<div class="nrya-byl-nm">' + esc(b.title || '(제목 확인 안 됨)') + '</div>' +
        (dl.length ? '<div class="nrya-dl">' + dl.join('') + '</div>' : '') + '</div></div>';
    }).join('');

    // 고시 머리말에 시행일이 적힌 것은 738건 중 203건뿐이다(2026-09-09 실측) — 없으면 **빈칸으로 둔다**.
    var adms = (d.admruls || []).map(function (a) {
      return '<div class="nrya-byl"><span class="nrya-byl-no">고시</span><div style="flex:1">' +
        '<div class="nrya-byl-nm">' + esc(a.title) +
        (a.eff ? '<span class="nrya-file-amd">· 시행 ' + effLabel(a.eff) + '</span>' : '') + '</div>' +
        '<div class="nrya-dl"><a href="' + esc(a.src) + '" target="_blank" rel="noopener">📄 본문(텍스트)</a></div>' +
        '</div></div>';
    }).join('');

    return files +
      '<div class="nrya-acc-scroll">' +
      '<div class="nrya-byl-title">별표 · 별지 서식 (' + nfmt((d.byls || []).length) + '건)</div>' +
      (byls || '<div class="nrya-byl"><div class="nrya-byl-nm">수집된 별표·서식이 없습니다.</div></div>') +
      '<div class="nrya-byl-title">고시 · 행정규칙 (' + nfmt((d.admruls || []).length) + '건)</div>' +
      (adms || '<div class="nrya-byl"><div class="nrya-byl-nm">수집된 고시가 없습니다.</div></div>') +
      '</div>';
  }

  /** law.go.kr 원본(HWP·PDF·이미지) 링크는 앱 웹뷰에서도 열리도록 openDownloadUrl 로 넘긴다. @param {HTMLElement} body */
  function bindLawDl(body) {
    body.querySelectorAll('a[data-dl]').forEach(function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); openDownloadUrl(a.href); });
    });
  }

  // ============================================================================
  // 초안승인 — 서버 연동(목록만, 읽기전용 — 승인 액션은 ⚠수치검증/재검증 파이프라인이 처리)
  // ============================================================================
  var DRAFT_NOTE = '<div class="nrya-dual-note">순수 정의·절차 초안은 <b>재검증 파이프라인이 자동 승격</b>. 처벌·안전값 포함 초안은 ⚠수치검증 방에서 사람이 승인합니다.</div>';

  /**
   * 서버 401/403(토큰 만료·없음) 시 보일 잠금 화면. "관리자 모드" 체크박스는 켜져 있어도
   * 서버 인증 토큰과는 별개(체크박스=클라 표시설정, 토큰=실제 인증)라 여기서 재로그인 버튼을 바로 준다.
   * @returns {string}
   */
  function adminLockHTML() {
    return '<div class="nrya-notice-box"><span class="nrya-em">🔒</span>관리자 로그인 필요' +
      '<br><span style="font-size:11.5px;color:var(--nrya-text-sub)">관리자 모드가 켜져 있어도 인증 토큰이 없거나 만료되면 다시 로그인해야 합니다.</span>' +
      '<div style="margin-top:10px"><button class="nrya-btn-ok" style="padding:8px 18px;border-radius:8px;border:none;font-weight:700;cursor:pointer" ' +
      'onclick="showUnifiedLoginModal(\'ai\',\'AI 챗봇 관리자 로그인\',\'fa-robot\')">다시 로그인</button></div></div>';
  }

  /**
   * 미승인 초안(draft) 목록을 서버에서 불러와 카드로 렌더한다(읽기전용).
   * [연계] → GET /api/legal/drafts.
   * @param {HTMLElement} host - 카드를 담을 컨테이너
   */
  var draftPage = 1;              // 초안승인 방에서 보고 있는 쪽(방을 나갔다 와도 1쪽부터 다시)

  /**
   * 미승인 초안(draft) 목록을 서버에서 불러와 카드로 렌더한다.
   *
   * 2026-09-10 사용자 지적 두 가지를 함께 고쳤다:
   *   ①**쪽 나누기가 없었다** — 224건이 한 화면에 통째로 쏟아졌다. 이제 한 쪽 20건 + « ‹ 1 2 3 4 5 › ».
   *   ②**초안을 열어 볼 방법이 없었다** — 카드에 [📄 초안 보기]를 달았다.
   *
   * ★카드에 「미확인 N줄」을 함께 보여 준다. 이 방의 이름이 "초안승인"이라 페이지 전체가 막혀
   *   있는 것처럼 읽히지만 **그렇지 않다** — draft 페이지도 챗봇이 그대로 쓰고, 그중 사람 검토가
   *   안 끝난 **줄만** [미확인]으로 밀려난다(`_SCHEMA.md` §5). 그러니 승인해야 할 실체는
   *   "페이지"가 아니라 **그 N줄**이다. 0줄이면 승격 후보다.
   * [연계] → GET /api/legal/drafts?page=&per=20 · roomPagerHTML(지식 방과 같은 쪽 단추).
   * @param {HTMLElement} host - 카드를 담을 컨테이너
   * @param {number} [page] - 볼 쪽(없으면 마지막으로 보던 쪽)
   */
  function renderDraftCards(host, page) {
    if (!host) return;
    draftPage = page || draftPage || 1;
    host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>초안 목록을 불러오는 중…</div>';
    legalGet('/api/legal/drafts?page=' + draftPage + '&per=20').then(function (res) {
      if (res.status === 401 || res.status === 403) {
        host.innerHTML = DRAFT_NOTE + adminLockHTML();
        return null;
      }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) {
        host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>';
        return;
      }
      var list = data.drafts || [];
      if (!list.length) {
        host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">✅</span>대기 중인 초안이 없습니다.</div>';
        return;
      }
      host.innerHTML = DRAFT_NOTE +
        '<div class="nrya-dual-note">이 방의 초안은 <b>챗봇이 이미 쓰고 있습니다.</b> 페이지가 통째로 막힌 것이 아니라, ' +
          '사람 검토가 안 끝난 <b>줄만</b> 답변에서 「미확인」으로 표시돼 나갑니다(<code>_SCHEMA.md</code> §5). ' +
          '그래서 승인해야 할 것은 페이지가 아니라 <b>아래 「미확인 N줄」</b>이고, <b>0줄이면 승격 후보</b>입니다.</div>' +
        list.map(draftCardHTML).join('') +
        roomPagerHTML({ page: data.page, pages: data.pages, total: data.total });
      host.querySelectorAll('.nrya-rv').forEach(bindDraftCard);
      host.querySelectorAll('.nrya-pager button[data-rpage]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (b.disabled) return;
          renderDraftCards(host, parseInt(b.dataset.rpage, 10) || 1);
        });
      });
    }).catch(function (e) {
      host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>';
    });
  }

  /**
   * 초안 카드 한 장. 「미확인 N줄」이 이 초안이 대기 중인 **이유**이므로 상태 자리에 그것을 둔다.
   * @param {object} d - {file,law,topic,penalty,unverified}
   * @returns {string}
   */
  function draftCardHTML(d) {
    var n = Number(d.unverified);
    var st = n === 0 ? '<span class="nrya-rv-st nrya-done">미확인 0줄 · 승격 후보</span>'
      : n > 0 ? '<span class="nrya-rv-st nrya-warn">미확인 ' + nfmt(n) + '줄</span>'
      : '<span class="nrya-rv-st nrya-wait">본문을 읽지 못함</span>';
    return '<div class="nrya-rv" data-file="' + esc(d.file) + '">' +
      '<div class="nrya-rv-head"><span class="nrya-rv-id">draft</span>' +
        '<div class="nrya-rv-t">' + esc(d.topic || d.file) + '<small>' + esc(d.law || '') +
          (d.penalty ? ' · 처벌·수치 포함' : '') + '</small></div>' + st + '</div>' +
      '<button class="nrya-btn-brief nrya-btn-draft" type="button">📄 초안 보기</button>' +
      '<div class="nrya-draft-body nrya-hidden"></div>' +
      '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
  }

  /**
   * 카드의 [📄 초안 보기]를 묶는다 — 누르면 그 초안을 **챗봇이 쓰는 모습 그대로** 갈라서 펼친다:
   * 위쪽에 「미확인」으로 밀려난 줄들(= 승인해야 할 것), 아래에 지금도 근거로 쓰이는 본문.
   * 다시 누르면 접는다.
   * @param {HTMLElement} card
   * [연계] → GET /api/legal/drafts/detail?file=…
   */
  function bindDraftCard(card) {
    var btn = card.querySelector('.nrya-btn-draft'); if (!btn) return;
    var box = card.querySelector('.nrya-draft-body');
    var LABEL = '📄 초안 보기';
    btn.onclick = function () {
      if (box.dataset.loaded === '1' && !box.classList.contains('nrya-hidden')) {
        box.classList.add('nrya-hidden'); btn.textContent = LABEL; return;
      }
      if (box.dataset.loaded === '1') { box.classList.remove('nrya-hidden'); btn.textContent = '📄 접기'; return; }
      btn.disabled = true; btn.textContent = '여는 중…';
      legalGet('/api/legal/drafts/detail?file=' + encodeURIComponent(card.dataset.file)).then(function (res) {
        return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
      }).then(function (d) {
        btn.disabled = false;
        if (!d || !d.ok) { btn.textContent = LABEL; showCardErr(card, (d && d.error) || '초안을 열지 못했습니다.'); return; }
        btn.textContent = '📄 접기';
        box.dataset.loaded = '1';
        box.classList.remove('nrya-hidden');
        var un = d.unverified || [];
        box.innerHTML =
          (un.length
            ? '<div class="nrya-draft-sec nrya-draft-un"><div class="nrya-draft-lab">⚠ 사람 검토가 안 끝난 줄 ' + nfmt(un.length) + '줄 — <b>이것이 승인 대상입니다</b></div>' +
                un.map(function (l) { return '<div class="nrya-draft-line">' + esc(l) + '</div>'; }).join('') + '</div>'
            : '<div class="nrya-draft-sec nrya-draft-ok"><div class="nrya-draft-lab">✅ 사람 검토가 안 끝난 줄이 <b>없습니다</b> — 승격 후보입니다.</div></div>') +
          '<div class="nrya-draft-sec"><div class="nrya-draft-lab">📖 지금도 그대로 근거로 쓰이는 본문</div>' +
            '<pre class="nrya-draft-pre">' + esc(d.kept || '') + '</pre></div>';
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = LABEL;
        showCardErr(card, '네트워크 오류: ' + String(e && e.message || e));
      });
    };
  }

  // ============================================================================
  // ⚠수치검증 — 서버 연동(목록/승인/반려)
  // ============================================================================
  var DUAL_NOTE = '<div class="nrya-dual-note">⚠ <b>승인 이원화</b>: 처벌·과태료·안전수치·⚠REVIEW 포함 페이지는 <b>사람 승인 필수</b>. 순수 정의/절차 페이지만 AI 자동 승격.</div>';

  // 목록 상태(검색·법 필터·페이지). 새로고침해도 사용자가 보던 조건을 잃지 않게 남겨 둔다.
  var reviewState = { list: [], page: 0, law: '', q: '', status: 'pending' };
  var REVIEW_PAGE_SIZE = 20;

  /** 지금 조건(법·검색어)에 걸리는 항목만 추린다. @returns {Array} */
  function reviewFiltered() {
    var law = reviewState.law, q = reviewState.q.toLowerCase();
    return reviewState.list.filter(function (rv) {
      if (law && (rv.law || '') !== law) return false;
      if (!q) return true;
      var hay = ((rv.id || '') + ' ' + (rv.title || '') + ' ' + (rv.targetPages || []).join(' ')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  /**
   * 목록 위 도구줄 — 새로고침·법 선택·검색·"몇 건 중 몇 번째".
   * 카드가 200장을 넘어가면서 "지금 몇 개 중 어디를 보고 있는지"가 화면에 없어 추가했다.
   * @param {Array} shown 지금 조건에 걸린 항목 @returns {string}
   */
  function reviewToolbarHTML(shown) {
    var laws = {}, i;
    for (i = 0; i < reviewState.list.length; i++) laws[reviewState.list[i].law || '(법 미상)'] = 1;
    var names = Object.keys(laws).sort();
    var opts = '<option value="">전체 법 (' + reviewState.list.length + '건)</option>' +
      names.map(function (n) {
        var c = reviewState.list.filter(function (r) { return (r.law || '(법 미상)') === n; }).length;
        return '<option value="' + esc(n) + '"' + (reviewState.law === n ? ' selected' : '') + '>' + esc(n) + ' (' + c + ')</option>';
      }).join('');
    var from = shown.length ? reviewState.page * REVIEW_PAGE_SIZE + 1 : 0;
    var to = Math.min((reviewState.page + 1) * REVIEW_PAGE_SIZE, shown.length);
    var pages = Math.max(1, Math.ceil(shown.length / REVIEW_PAGE_SIZE));
    return '<div class="nrya-rv-bar">' +
      '<button class="nrya-rv-refresh" title="서버에서 다시 불러오기">↻ 새로고침</button>' +
      '<select class="nrya-rv-status" title="승인된 항목을 보면 되돌릴 수 있습니다">' +
        ['pending:대기만', 'approved:승인됨', 'all:전체'].map(function (o) {
          var v = o.split(':')[0];
          return '<option value="' + v + '"' + (reviewState.status === v ? ' selected' : '') + '>' + o.split(':')[1] + '</option>';
        }).join('') + '</select>' +
      '<select class="nrya-rv-law">' + opts + '</select>' +
      '<input class="nrya-rv-q" type="search" placeholder="검색(ID·제목·페이지)" value="' + esc(reviewState.q) + '">' +
      '<span class="nrya-rv-count">' + from + '–' + to + ' / ' + shown.length + '건' +
        (reviewState.law || reviewState.q ? ' (전체 ' + reviewState.list.length + '건 중)' : '') + '</span>' +
      '<span class="nrya-rv-pager">' +
        '<button class="nrya-rv-prev"' + (reviewState.page <= 0 ? ' disabled' : '') + '>‹ 이전</button>' +
        '<b>' + (reviewState.page + 1) + ' / ' + pages + '</b>' +
        '<button class="nrya-rv-next"' + (reviewState.page >= pages - 1 ? ' disabled' : '') + '>다음 ›</button>' +
      '</span></div>';
  }

  /**
   * 상태(reviewState)를 화면에 그린다. 서버를 다시 부르지 않는다 — 필터·페이지 이동용.
   * @param {HTMLElement} host
   * [연계] ← renderReviewCards(서버에서 목록을 받은 뒤), 도구줄 이벤트.
   */
  function paintReviews(host) {
    var shown = reviewFiltered();
    var pages = Math.max(1, Math.ceil(shown.length / REVIEW_PAGE_SIZE));
    if (reviewState.page > pages - 1) reviewState.page = pages - 1;
    if (reviewState.page < 0) reviewState.page = 0;
    var slice = shown.slice(reviewState.page * REVIEW_PAGE_SIZE, (reviewState.page + 1) * REVIEW_PAGE_SIZE);
    host.innerHTML = DUAL_NOTE + reviewToolbarHTML(shown) +
      (slice.length ? slice.map(function (rv, i) { return reviewCardHTML(rv, i === 0); }).join('')
                    : '<div class="nrya-notice-box"><span class="nrya-em">🔎</span>조건에 맞는 항목이 없습니다.</div>');
    host.querySelectorAll('.nrya-rv').forEach(function (card) { bindReviewCard(card); });

    var refresh = host.querySelector('.nrya-rv-refresh');
    if (refresh) refresh.onclick = function () { renderReviewCards(host); };
    var st = host.querySelector('.nrya-rv-status');
    if (st) st.onchange = function () {
      // 법 필터를 그대로 두면, 새 목록에 그 법이 없을 때 화면엔 '전체 법'로 보이는데 실제로는
      // 옛 법이 계속 걸려 0건이 뜬다(2026-08-28 독립 검토에서 발견·실측). 그래서 같이 푼다.
      reviewState.status = st.value; reviewState.law = ''; reviewState.page = 0;
      renderReviewCards(host);
    };
    var sel = host.querySelector('.nrya-rv-law');
    if (sel) sel.onchange = function () { reviewState.law = sel.value; reviewState.page = 0; paintReviews(host); };
    var q = host.querySelector('.nrya-rv-q');
    if (q) q.onchange = function () { reviewState.q = q.value.trim(); reviewState.page = 0; paintReviews(host); };
    var prev = host.querySelector('.nrya-rv-prev');
    if (prev) prev.onclick = function () { reviewState.page--; paintReviews(host); host.scrollIntoView({ block: 'start' }); };
    var next = host.querySelector('.nrya-rv-next');
    if (next) next.onclick = function () { reviewState.page++; paintReviews(host); host.scrollIntoView({ block: 'start' }); };
  }

  /**
   * 승인/반려/되돌리기 결과를 **목록 데이터에도** 반영한다.
   * ⚠종전에는 카드 화면만 바꿔서, 쪽을 넘겼다 오거나 필터를 건드리면 `reviewState.list` 로
   *   다시 그려지면서 **방금 승인한 카드가 미처리 상태로 되살아났다**(2026-08-28 독립 검토에서
   *   발견·실측). 되살아난 카드에서 또 누르면 같은 항목을 두 번 처리하게 된다.
   * @param {string} id 리뷰 항목 번호 @param {'approve'|'reject'|'undo'} decision
   */
  function syncReviewState(id, decision) {
    var it = null;
    for (var i = 0; i < reviewState.list.length; i++) if (reviewState.list[i].id === id) { it = reviewState.list[i]; break; }
    if (!it) return;
    it.approved = (decision === 'approve');
    // 지금 보고 있는 칸(대기만/승인됨)과 안 맞게 된 항목은 목록에서 뺀다 — 다시 그릴 때 사라진다.
    if ((reviewState.status === 'pending' && it.approved) ||
        (reviewState.status === 'approved' && !it.approved)) {
      reviewState.list.splice(reviewState.list.indexOf(it), 1);
    }
  }

  /**
   * 검증 대기 목록을 서버에서 불러와 리뷰 카드로 렌더한다.
   * 401 → "관리자 로그인 필요", 오류 → 오류 박스, 빈 목록 → 안내. 절대 빈 화면 없음.
   * 목록이 200장을 넘어 한 번에 다 그리면 화면이 무거워지므로 20장씩 나눠 그린다(paintReviews).
   * @param {HTMLElement} host - 카드를 담을 컨테이너
   * [연계] → GET /api/legal/reviews?status=pending, paintReviews, bindReviewCard.
   */
  function renderReviewCards(host) {
    if (!host) return;
    host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>검증 대기 목록을 불러오는 중…</div>';
    legalGet('/api/legal/reviews?status=' + encodeURIComponent(reviewState.status)).then(function (res) {
      if (res.status === 401 || res.status === 403) {
        host.innerHTML = DUAL_NOTE + adminLockHTML();
        return null;
      }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) {
        host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>';
        return;
      }
      reviewState.list = data.reviews || [];
      if (!reviewState.list.length) {
        host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">✅</span>검증 대기 항목이 없습니다.</div>';
        return;
      }
      paintReviews(host);
    }).catch(function (e) {
      host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>';
    });
  }

  // ============================================================================
  // 피드백·새지식후보·개정검토 — 서버 연동(목록/결정). 3방 모두 "대기 → 승인|처리완료 / 무시"
  // 2택 구조라 카드 결정 바인딩(bindDecideCard)을 공유하고, 카드 본문 HTML만 방마다 다르다.
  // ⚠수치검증(reviewCardHTML)과 달리 값 확정·확인체크리스트 같은 복잡한 유형분기가 없다.
  // ============================================================================

  /** ISO 시각을 "MM.DD HH:MM"로 짧게. @param {string} iso @returns {string} */
  function shortTs(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return '';
    function p(n) { return String(n).padStart(2, '0'); }
    return p(d.getMonth() + 1) + '.' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  /**
   * 결정 카드(피드백·새지식후보·개정검토 공용) 1장에 헤더 토글 + 승인|처리완료/무시 버튼을 바인딩한다.
   * @param {HTMLElement} card @param {string} apiBase - 예: '/api/legal/feedback'
   * @param {string} okDecision @param {string} noDecision @param {string} okLabel @param {string} noLabel
   * [연계] → POST <apiBase>/:id/decide.
   */
  function bindDecideCard(card, apiBase, okDecision, noDecision, okLabel, noLabel) {
    var id = card.getAttribute('data-id');
    var head = card.querySelector('.nrya-rv-head');
    if (head) head.onclick = function () { card.classList.toggle('nrya-open'); };
    var okBtn = card.querySelector('.nrya-btn-ok');
    var noBtn = card.querySelector('.nrya-btn-no');
    var errBox = card.querySelector('.nrya-inline-err');
    function showErr(msg) { if (!errBox) return; errBox.style.display = 'block'; errBox.classList.remove('nrya-hidden'); errBox.textContent = msg; }
    function setBusy(b) { if (okBtn) okBtn.disabled = b; if (noBtn) noBtn.disabled = b; }
    function submit(decision, label, cls) {
      setBusy(true);
      legalPost(apiBase + '/' + encodeURIComponent(id) + '/decide', { decision: decision, by: '관리자' })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) return { _denied: true };
          return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
        })
        .then(function (data) {
          if (data._denied) { showErr('관리자 로그인 필요 — 통합관리자 센터에서 로그인 후 다시 시도하세요.'); setBusy(false); return; }
          if (!data || !data.ok) { showErr((data && data.error) || '처리에 실패했습니다.'); setBusy(false); return; }
          var st = card.querySelector('.nrya-rv-st');
          var actions = card.querySelector('.nrya-rv-actions');
          if (st) { st.className = 'nrya-rv-st ' + cls; st.textContent = (cls === 'nrya-done' ? '✓ ' : '✗ ') + label; }
          if (actions) actions.style.display = 'none';
          refreshAdminStats();
        })
        .catch(function (e) { showErr('네트워크 오류: ' + String(e && e.message || e)); setBusy(false); });
    }
    if (okBtn) okBtn.onclick = function () { submit(okDecision, okLabel, 'nrya-done'); };
    if (noBtn) noBtn.onclick = function () { submit(noDecision, noLabel, 'nrya-rej'); };
  }

  /** 피드백 카드 1건. @param {object} fb - {id,ts,question,answerGist,thumb,reason,status,triage} @returns {string} */
  function feedbackCardHTML(fb) {
    var st = fb.status === 'reviewed' ? '<span class="nrya-rv-st nrya-done">✓ 처리완료</span>'
      : fb.status === 'dismissed' ? '<span class="nrya-rv-st nrya-rej">✗ 무시</span>'
      : '<span class="nrya-rv-st nrya-wait">대기</span>';
    var triage = fb.triage;
    var triageField = triage
      ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">🧠 AI 재검토</div><div class="nrya-rv-fval">' + (triage.genuineIssue ? '⚠ 실제 문제 가능성' : '✅ 오해·톤 문제로 판단') + ' · ' + esc(triage.category || '') + '<br>' + esc(triage.note || '') + '</div></div>'
      : (fb.thumb === 'down' ? '<div class="nrya-rv-field"><div class="nrya-rv-fval">AI 재검토 대기 중…</div></div>' : '');
    var body =
      '<div class="nrya-rv-body">' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">❓ 질문</div><div class="nrya-rv-fval">' + esc(fb.question || '(없음)') + '</div></div>' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">💬 답변 요지</div><div class="nrya-rv-fval">' + esc(fb.answerGist || '(없음)') + '</div></div>' +
        (fb.reason ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">📝 사유</div><div class="nrya-rv-fval">' + esc(fb.reason) + '</div></div>' : '') +
        triageField +
        (fb.status === 'pending' ? '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 처리완료</button><button class="nrya-btn-no">✗ 무시</button></div>' : '') +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
    return '<div class="nrya-rv" data-id="' + esc(fb.id) + '"><div class="nrya-rv-head"><span class="nrya-rv-id">' + (fb.thumb === 'down' ? '👎' : '👍') + '</span><div class="nrya-rv-t">' + esc((fb.question || '').slice(0, 60) || fb.id) + '<small>' + esc(shortTs(fb.ts)) + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 피드백 목록을 서버에서 불러와 카드로 렌더한다.
   * [연계] → GET /api/legal/feedback?status=pending, bindDecideCard.
   * @param {HTMLElement} host
   */
  function renderFeedbackCards(host) {
    if (!host) return;
    host.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>피드백 목록을 불러오는 중…</div>';
    legalGet('/api/legal/feedback?status=pending').then(function (res) {
      if (res.status === 401 || res.status === 403) { host.innerHTML = adminLockHTML(); return null; }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) { host.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>'; return; }
      var list = data.feedback || [];
      if (!list.length) { host.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">✅</span>대기 중인 피드백이 없습니다.</div>'; return; }
      host.innerHTML = '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">총 ' + list.length + '건</div>' + list.map(feedbackCardHTML).join('');
      host.querySelectorAll('.nrya-rv').forEach(function (card) { bindDecideCard(card, '/api/legal/feedback', 'reviewed', 'dismissed', '처리완료', '무시'); });
    }).catch(function (e) { host.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>'; });
  }

  /** 새 지식 후보 카드 1건. @param {object} cd - {id,ts,query,laws,files,answerGist,status} @returns {string} */
  function candidateCardHTML(cd) {
    var st = cd.status === 'approved' ? '<span class="nrya-rv-st nrya-done">✓ 승인·편입대기</span>'
      : cd.status === 'dismissed' ? '<span class="nrya-rv-st nrya-rej">✗ 무시</span>'
      : '<span class="nrya-rv-st nrya-wait">대기</span>';
    var laws = (cd.laws || []).map(esc).join(' · ');
    var files = (cd.files || []).map(esc).join(', ');
    var body =
      '<div class="nrya-rv-body">' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">❓ 질문</div><div class="nrya-rv-fval">' + esc(cd.query || '(없음)') + '</div></div>' +
        (laws ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">⚖️ 관련 법</div><div class="nrya-rv-fval">' + laws + '</div></div>' : '') +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">💬 답변 요지</div><div class="nrya-rv-fval">' + esc(cd.answerGist || '(없음)') + '</div></div>' +
        (files ? '<div class="nrya-src-line">📍 원문 파일: ' + files + '</div>' : '') +
        (cd.status === 'pending' ? '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 승인(위키 편입 필요)</button><button class="nrya-btn-no">✗ 무시</button></div>' : '') +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
    return '<div class="nrya-rv" data-id="' + esc(cd.id) + '"><div class="nrya-rv-head"><span class="nrya-rv-id">💡</span><div class="nrya-rv-t">' + esc((cd.query || '').slice(0, 60) || cd.id) + '<small>' + esc(shortTs(cd.ts)) + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 새 지식 후보 목록을 서버에서 불러와 카드로 렌더한다. "승인"은 위키 자동편입이 아니라
   * "편입 필요" 표시일 뿐이다(_SCHEMA.md §2 ingest 절차는 별도 저작 작업).
   * [연계] → GET /api/legal/candidates?status=pending, bindDecideCard.
   * @param {HTMLElement} host
   */
  function renderCandidateCards(host) {
    if (!host) return;
    host.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>새 지식 후보를 불러오는 중…</div>';
    legalGet('/api/legal/candidates?status=pending').then(function (res) {
      if (res.status === 401 || res.status === 403) { host.innerHTML = adminLockHTML(); return null; }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) { host.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>'; return; }
      var list = data.candidates || [];
      if (!list.length) { host.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">✅</span>새 지식 후보가 없습니다.</div>'; return; }
      host.innerHTML = '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">총 ' + list.length + '건</div>' + list.map(candidateCardHTML).join('');
      host.querySelectorAll('.nrya-rv').forEach(function (card) { bindDecideCard(card, '/api/legal/candidates', 'approved', 'dismissed', '승인(편입대기)', '무시'); });
    }).catch(function (e) { host.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>'; });
  }

  /**
   * 개정 후보 카드 1건 — 종류별로 "무엇이 바뀌는지"를 보여 준다(2026-09-10 정정 전엔 공포번호·시행일자
   * `? → ?` 두 줄뿐이라 관리자가 승인/무시를 판단할 정보가 없었다).
   *   · 법률류(law_pending·law_amended·law_renamed·law_dept_changed): 바뀐 조문 목록, 공포번호·공포일·시행일 이전→현재, 부처.
   *   · 행정규칙류(admrul_amended·admrul_unknown_new): 발령일·시행일·개정구분·부처(공포번호 칸 없음 — 행정규칙엔 그 항목이 없다),
   *     신규 고시는 "새로 발령" + 본문이 인용한 우리 법(related_laws).
   *   · 없는 값은 줄을 통째로 생략한다(`?` 표기 금지).
   *   · 링크는 종류별로 다르다 — 법령은 lsInfoP.do?lsiSeq=<MST>&efYd=<시행일>, 행정규칙은 admRulSc.do(행정규칙 탭 검색).
   *     종전 lsSc.do(법령 탭)는 행정규칙 제목으로 검색하면 항상 "결과 없음"이었다(2026-09-10 curl 확인).
   * @param {object} am - {id,ts,law,kind,kind_code,layer,mst,법령명,이전,현재,changed_articles,related_laws,status}
   *   (kind_code 가 없는 옛 항목은 kind 라벨·layer 로 종류를 가른다)
   * @returns {string}
   * [연계] ← GET /api/legal/amendments (services/legal_amendment_scanner.js toLegacyEntry 스키마)
   */
  function amendmentCardHTML(am) {
    var st = am.status === 'approved' ? '<span class="nrya-rv-st nrya-done">✓ 승인·재수집 필요</span>'
      : am.status === 'dismissed' ? '<span class="nrya-rv-st nrya-rej">✗ 무시</span>'
      : '<span class="nrya-rv-st nrya-warn">개정 감지</span>';
    var prev = am.이전 || {}; var cur = am.현재 || {};
    var lawName = am.법령명 || am.law || '';
    var code = am.kind_code || '';
    var isAdm = code ? code.indexOf('admrul_') === 0 : (am.layer === '행정규칙' || /행정규칙/.test(am.kind || ''));
    var isNew = code === 'admrul_unknown_new' || (!code && /신규/.test(am.kind || ''));
    function ymd(v) { v = String(v || ''); return /^\d{8}$/.test(v) ? v.slice(0, 4) + '-' + v.slice(4, 6) + '-' + v.slice(6) : v; }
    /** 이전→현재 한 줄. 둘 다 없으면 null(줄 생략), 같으면 값만, 다르면 화살표. */
    function arrow(a, b) {
      a = a || ''; b = b || '';
      if (!a && !b) return null;
      if (!a) return '<b>' + esc(b) + '</b>';
      if (!b || a === b) return esc(a);
      return esc(a) + ' → <b>' + esc(b) + '</b>';
    }
    var lines = [];
    function line(label, html) { if (html) lines.push(esc(label) + ' ' + html); }
    if (isAdm) {
      if (isNew) lines.push('<b>새로 발령</b>' + (cur.제개정구분명 ? ' (' + esc(cur.제개정구분명) + ')' : ''));
      else line('개정구분', cur.제개정구분명 ? '<b>' + esc(cur.제개정구분명) + '</b>' : null);
      line('발령일', arrow(ymd(prev.발령일자), ymd(cur.발령일자)));
      line('시행일', arrow(ymd(prev.시행일자), ymd(cur.시행일자)));
      line('부처', arrow(prev.소관부처명, cur.소관부처명));
    } else {
      line('법령명', prev.법령명 && cur.법령명 && prev.법령명 !== cur.법령명 ? arrow(prev.법령명, cur.법령명) : null);
      line('공포번호', arrow(prev.공포번호, cur.공포번호));
      line('공포일', arrow(ymd(prev.공포일자), ymd(cur.공포일자)));
      var ef = arrow(ymd(prev.시행일자), ymd(cur.시행일자));
      line('시행일', ef ? ef + (cur.현행연혁코드 ? ' (' + esc(cur.현행연혁코드) + ')' : '') : null);
      line('부처', arrow(prev.소관부처명, cur.소관부처명));
    }
    // ★바뀐 조문마다 '개정 전 → 개정 후' 본문을 접었다 펴서 보여준다(사용자 확정 2026-09-10).
    //   종전에는 조 번호·제목만 있어 "뭐가 어떻게 바뀌는지"를 알 수 없었다.
    //   `신설` 은 탐지기가 우리 원문에 그 조가 없는 것으로 판정한 값이다(API 는 신설을 안 알려 준다).
    //   옛 카드(본문을 안 받아 오던 시절 것)는 본문 칸이 비어 있으므로 **지어내지 말고** 그렇다고 적는다.
    var arts = am.changed_articles || [];
    var newCnt = arts.filter(function (a) { return a.신설; }).length;
    function artBlock(lab, txt, cls) {
      return '<div class="nrya-art-side ' + cls + '"><div class="nrya-art-lab">' + esc(lab) + '</div>' +
        '<div class="nrya-art-txt">' + esc(txt) + '</div></div>';
    }
    var artsHTML = arts.length ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">📝 바뀐 조문 (' + arts.length +
      (newCnt ? ' · 신설 ' + newCnt : '') + ')</div><div class="nrya-rv-fval">' +
      arts.map(function (a) {
        var no = '제' + esc(a.조문번호 || '') + '조' + (a.조문가지번호 && a.조문가지번호 !== '0' ? '의' + esc(a.조문가지번호) : '');
        var head = no + (a.조문제목 ? '(' + esc(a.조문제목) + ')' : '') +
          (a.신설 ? ' <span class="nrya-art-new">신설</span>' : (a.조문제개정유형 ? ' · ' + esc(a.조문제개정유형) : '')) +
          (a.조문시행일자 ? ' · ' + esc(ymd(a.조문시행일자)) : '');
        var hasText = !!(a.새본문 || a.옛본문);
        var body = !hasText
          ? '<div class="nrya-art-none">이 항목은 본문을 받아 오기 전에 감지된 것이라 조문 내용이 없습니다. 「지금 스캔」을 다시 돌리면 채워집니다.</div>'
          : (a.신설
              ? artBlock('개정 전', '우리가 가진 원문에는 이 조가 없습니다 — 새로 만들어지는 조문으로 봅니다. (원문이 낡았을 때도 이렇게 나올 수 있으니, 원문 방에서 그 법의 시행일을 함께 확인하세요.)', 'nrya-art-old nrya-art-empty')
              : artBlock('개정 전', a.옛본문 || '우리 원문에서 이 조를 찾지 못했습니다.', 'nrya-art-old')) +
            artBlock('개정 후', a.새본문 || '(새 본문을 받지 못했습니다)', 'nrya-art-new-side');
        return '<details class="nrya-art"><summary>' + head + '</summary>' + body + '</details>';
      }).join('') + '</div></div>' : '';
    // ★승인 게이트(2026-09-10): 이 항목의 예고본을 이미 받아 뒀으면, 승인이 곧 "답변 전환"이라는 것을 알린다.
    var stg = am.stage || null;
    var stageHTML = stg ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">📅 미리 받아 둔 새 원문</div><div class="nrya-rv-fval">' +
      esc(ymd(stg.date)) + ' 시행 · ' + esc(stg.file || '') +
      (stg.due
        ? ' — <b>시행일이 지났지만 승인 전이라 챗봇은 아직 옛 내용을 답합니다.</b> 승인하면 바로 새 내용으로 바뀝니다.'
        : ' — 승인해 두면 시행일부터 자동으로 새 내용을 답합니다.') +
      '</div></div>' : '';
    var rel = am.related_laws || [];
    var relHTML = isAdm && rel.length ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">📚 관련 법(본문 인용)</div><div class="nrya-rv-fval">' + rel.map(function (r) { return esc(r.name || r.slug || ''); }).join(' · ') + '</div></div>' : '';
    var ident = isAdm ? (cur.ID ? 'ID ' + esc(cur.ID) : (am.mst ? 'ID ' + esc(am.mst) : '')) : (cur.MST || am.mst ? 'MST ' + esc(cur.MST || am.mst) : '');
    var link = isAdm
      ? 'https://www.law.go.kr/admRulSc.do?menuId=5&subMenuId=41&query=' + encodeURIComponent(lawName)
      : 'https://www.law.go.kr/lsInfoP.do?lsiSeq=' + encodeURIComponent(cur.MST || am.mst || '') + (cur.시행일자 ? '&efYd=' + encodeURIComponent(cur.시행일자) : '');
    var body =
      '<div class="nrya-rv-body">' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">📌 종류</div><div class="nrya-rv-fval">' + esc(am.kind || '') + (ident ? ' · ' + ident : '') + '</div></div>' +
        (lines.length ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">🔄 변경</div><div class="nrya-rv-fval">' + lines.join('<br>') + '</div></div>' : '') +
        stageHTML + artsHTML + relHTML +
        '<a class="nrya-rv-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">🔗 law.go.kr에서 확인</a>' +
        (am.status === 'pending' ? '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 승인(재수집 필요)</button><button class="nrya-btn-no">✗ 무시</button></div>' : '') +
        // ★승인 뒤 위키를 사람이 고쳐야 한다 — 무엇을 어디서 고칠지 적힌 글을 뽑아 준다.
        //   그 글만 복사해 AI 에게 붙여 넣으면 된다(사용자 확정 2026-09-10). 무시한 건은 뽑지 않는다.
        (am.status !== 'dismissed'
          ? '<button class="nrya-btn-brief" type="button">📋 위키 반영 지시문 만들기</button>' +
            '<div class="nrya-brief nrya-hidden"></div>'
          : '') +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
    return '<div class="nrya-rv" data-id="' + esc(am.id) + '"><div class="nrya-rv-head"><span class="nrya-rv-id">📌</span><div class="nrya-rv-t">' + esc(lawName || am.id) + '<small>' + esc(shortTs(am.ts)) + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 카드의 「📋 위키 반영 지시문 만들기」 버튼을 묶는다.
   * 누르면 서버가 그 개정의 **개정 전/후 원문 + 고칠 위키 목록 + 해야 할 일**을 한 덩어리 글로 만들어 주고,
   * 그 글을 화면에 펼쳐 준다. 복사 버튼이 되면 클립보드로, 안 되면 글상자를 통째로 선택해 준다
   * (앱 웹뷰는 클립보드가 막혀 있을 수 있어 **두 갈래를 다 둔다**).
   * @param {HTMLElement} card - `.nrya-rv` 카드
   * [연계] → GET /api/legal/amendments/:id/wiki-brief · services/legal_wiki_brief.js.
   */
  function bindBriefButton(card) {
    var btn = card.querySelector('.nrya-btn-brief'); if (!btn) return;
    var box = card.querySelector('.nrya-brief');
    var id = card.dataset.id;
    var LABEL = '📋 위키 반영 지시문 만들기';
    btn.onclick = function () {
      if (box && !box.classList.contains('nrya-hidden') && box.dataset.loaded === '1') {
        box.classList.add('nrya-hidden'); btn.textContent = LABEL; return;   // 다시 누르면 접는다
      }
      btn.disabled = true; btn.textContent = '만드는 중…';
      legalGet('/api/legal/amendments/' + encodeURIComponent(id) + '/wiki-brief').then(function (res) {
        return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
      }).then(function (d) {
        btn.disabled = false;
        if (!d || !d.ok) { btn.textContent = LABEL; showCardErr(card, (d && d.error) || '지시문을 만들지 못했습니다.'); return; }
        btn.textContent = '📋 지시문 접기';
        renderBriefBox(box, d.text,
          '아래 글을 <b>통째로 복사해 AI에게 붙여 넣으면</b> 위키 반영 작업을 이어서 할 수 있습니다. ' +
          '고칠 위키 후보 <b>' + nfmt((d.pages || []).length) + '쪽</b>이 함께 적혀 있습니다.');
      }).catch(function (e) {
        btn.disabled = false; btn.textContent = LABEL;
        showCardErr(card, '네트워크 오류: ' + String(e && e.message || e));
      });
    };
  }

  /** 카드 안 인라인 오류줄에 메시지를 띄운다(카드마다 하나씩 있다). @param {HTMLElement} card @param {string} msg */
  function showCardErr(card, msg) {
    var el = card.querySelector('.nrya-inline-err'); if (!el) return;
    el.classList.remove('nrya-hidden'); el.style.display = 'block'; el.textContent = msg;
  }

  /**
   * 인계문 글상자를 그린다(단건·일괄이 같은 모양을 쓴다). 복사 버튼이 되면 클립보드로,
   * 안 되면 글상자를 통째로 선택해 준다 — 앱 웹뷰는 클립보드가 막혀 있을 수 있어 **두 갈래를 다 둔다**.
   * @param {HTMLElement} box - `.nrya-brief` 상자
   * @param {string} text - 인계문 전문
   * @param {string} helpHTML - 상자 맨 위 안내 한 줄(HTML 허용 — 호출부가 만든 문장만 넣는다)
   * [연계] ← bindBriefButton(단건) · bindAmendBulk(일괄).
   */
  function renderBriefBox(box, text, helpHTML) {
    box.dataset.loaded = '1';
    box.classList.remove('nrya-hidden');
    box.innerHTML = '<div class="nrya-brief-help">' + helpHTML + '</div>' +
      '<div class="nrya-brief-acts"><button type="button" class="nrya-btn-copy">📄 복사</button>' +
      '<button type="button" class="nrya-btn-selall">전체 선택</button></div>' +
      '<textarea class="nrya-brief-txt" readonly rows="14"></textarea>';
    var ta = box.querySelector('.nrya-brief-txt');
    ta.value = text || '';
    box.querySelector('.nrya-btn-copy').onclick = function () {
      var b = this;
      var done = function (ok) { b.textContent = ok ? '✅ 복사됨' : '⚠ 복사 실패 — 전체 선택 후 직접 복사하세요'; setTimeout(function () { b.textContent = '📄 복사'; }, 2500); };
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(function () { done(true); }, function () { done(false); });
          return;
        }
      } catch (_) { /* 아래 폴백 */ }
      try { ta.select(); done(document.execCommand && document.execCommand('copy')); }
      catch (_) { done(false); }
    };
    box.querySelector('.nrya-btn-selall').onclick = function () { ta.focus(); ta.select(); };
  }

  /**
   * 개정검토 방 상단의 일괄 버튼 둘을 묶는다 — [✓ 전체 승인] 과 [📋 승인분 전체 지시문].
   *
   * **전체 승인은 두 번 눌러야 실행된다.** 첫 클릭은 서버에 미리보기를 물어
   * *"N건 승인 · 그중 M건은 승인 즉시(또는 시행일부터) 챗봇 답변이 바뀝니다"* 를 보여주고
   * 버튼 글자를 확인용으로 바꾼다. 되돌릴 수 없는 일이라 네이티브 confirm 대신 이 방식을 쓴다
   * (앱 웹뷰에서 confirm 이 막히거나 덮이는 경우가 있다).
   *
   * 승인이 끝나면 **방금 승인한 건들만** 묶은 일괄 인계문을 곧바로 펼쳐 준다 — 사용자가 그 글을
   * 복사해 AI 에게 붙여 넣는 것이 다음 단계이기 때문이다(사용자 확정 2026-09-10).
   * [연계] → GET /api/legal/amendments/decide-all/preview · POST /api/legal/amendments/decide-all
   *          · GET /api/legal/amendments/wiki-brief-all · renderBriefBox · loadAmendList.
   */
  function bindAmendBulk() {
    var allBtn = document.getElementById('nryaAmendAllBtn');
    var briefBtn = document.getElementById('nryaAmendAllBriefBtn');
    var box = document.getElementById('nryaAmendAllBrief');
    var err = document.getElementById('nryaAmendScanErr');
    var ALL_LABEL = '✓ 전체 승인';
    var BRIEF_LABEL = '📋 승인분 전체 지시문';
    var armed = null;   // 확인 대기 중인 건수·id (두 번째 클릭에서 쓴다)

    function fail(msg) { if (err) { err.classList.remove('nrya-hidden'); err.style.display = 'block'; err.textContent = msg; } }
    function clearErr() { if (err) { err.style.display = 'none'; err.textContent = ''; } }
    /** 응답을 JSON 으로. 권한 없음은 _denied 로 구분해 올린다. */
    function asJson(res) {
      if (res.status === 401 || res.status === 403) return { _denied: true };
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }
    function disarm() { armed = null; if (allBtn) { allBtn.textContent = ALL_LABEL; allBtn.classList.remove('nrya-btn-danger'); } }

    /** 일괄 인계문을 받아 상자에 펼친다. @param {string} qs - 쿼리스트링(ids= 또는 status=) */
    function loadBulkBrief(qs, headline) {
      briefBtn.disabled = true; briefBtn.textContent = '만드는 중…';
      return legalGet('/api/legal/amendments/wiki-brief-all' + qs).then(asJson).then(function (d) {
        briefBtn.disabled = false; briefBtn.textContent = BRIEF_LABEL;
        if (d && d._denied) { fail('관리자 로그인 필요'); return; }
        if (!d || !d.ok) { fail((d && d.error) || '지시문을 만들지 못했습니다.'); return; }
        renderBriefBox(box, d.text,
          headline +
          ' 그중 <b>' + nfmt(d.detailed) + '건</b>은 바뀐 조문까지 적혀 있고, ' +
          '<b>' + nfmt(d.listed) + '건</b>은 비교할 옛 원문이 없어 목록으로만 담았습니다. ' +
          '고칠 위키 후보는 모두 <b>' + nfmt(d.pages) + '쪽</b>입니다. ' +
          '아래 글을 <b>통째로 복사해 AI에게 붙여 넣으면</b> 위키 반영 작업을 이어서 할 수 있습니다.');
      }).catch(function (e) {
        briefBtn.disabled = false; briefBtn.textContent = BRIEF_LABEL;
        fail('네트워크 오류: ' + String(e && e.message || e));
      });
    }

    if (briefBtn) briefBtn.onclick = function () {
      clearErr();
      if (box && !box.classList.contains('nrya-hidden') && box.dataset.loaded === '1') {
        box.classList.add('nrya-hidden'); return;   // 다시 누르면 접는다
      }
      loadBulkBrief('?status=approved', '승인된 <b>전 건</b>을 한 덩어리로 묶었습니다.');
    };

    if (allBtn) allBtn.onclick = function () {
      clearErr();
      if (armed) {                                  // ── 두 번째 클릭: 실제로 승인한다 ──
        var n = armed.pending;
        allBtn.disabled = true; allBtn.textContent = '승인하는 중…';
        legalPost('/api/legal/amendments/decide-all', { decision: 'approved' }).then(asJson).then(function (d) {
          allBtn.disabled = false; disarm();
          if (d && d._denied) { fail('관리자 로그인 필요'); return; }
          if (!d || !d.ok) { fail((d && d.error) || '전체 승인에 실패했습니다.'); return; }
          loadAmendList();                          // 목록을 새로 그린다(승인분은 대기 목록에서 빠진다)
          // ★위쪽 서브탭 배지(개정검토 44)도 그 자리에서 다시 센다(2026-09-10 사용자 지적:
          //   "승인을 했다면 위에 개정검토 44가 갱신되어야 하는데 갱신되지 않았어").
          //   종전에는 배지를 방을 다시 열 때만 갱신해, 승인 뒤에도 옛 숫자가 남아 있었다.
          refreshAdminStats();
          if (!d.decided) { fail('승인할 대기 건이 없습니다.'); return; }
          // 방금 승인한 건만 묶어 곧바로 펼친다 — 이게 다음 단계다.
          loadBulkBrief('?ids=' + encodeURIComponent((d.ids || []).join(',')),
            '방금 <b>' + nfmt(d.decided) + '건</b>을 승인했습니다' +
            (d.staged ? ' — 그중 <b>' + nfmt(d.staged) + '건</b>은 미리 받아 둔 새 원문이 있어 <b>챗봇 답변이 이미 바뀌었거나 시행일부터 바뀝니다</b>.' : '.') +
            ' 재수집 대상 표시는 ' + nfmt(d.mirrored) + '건에 옮겨 적었습니다.');
        }).catch(function (e) {
          allBtn.disabled = false; disarm();
          fail('네트워크 오류: ' + String(e && e.message || e));
        });
        return;
      }
      // ── 첫 번째 클릭: 무엇이 벌어지는지 먼저 보여주고 확인을 받는다 ──
      allBtn.disabled = true; allBtn.textContent = '확인하는 중…';
      legalGet('/api/legal/amendments/decide-all/preview').then(asJson).then(function (d) {
        allBtn.disabled = false;
        if (d && d._denied) { allBtn.textContent = ALL_LABEL; fail('관리자 로그인 필요'); return; }
        if (!d || !d.ok) { allBtn.textContent = ALL_LABEL; fail((d && d.error) || '미리보기를 받지 못했습니다.'); return; }
        if (!d.pending) { allBtn.textContent = ALL_LABEL; fail('승인할 대기 건이 없습니다.'); return; }
        armed = d;
        allBtn.classList.add('nrya-btn-danger');
        allBtn.textContent = '한 번 더 눌러 ' + nfmt(d.pending) + '건 전체 승인';
        fail('대기 ' + nfmt(d.pending) + '건을 승인합니다. ' +
          (d.staged
            ? '그중 ' + nfmt(d.staged) + '건은 미리 받아 둔 새 원문이 있어 승인 즉시(시행일이 아직이면 그날부터) 챗봇 답변이 새 내용으로 바뀝니다. '
            : '미리 받아 둔 새 원문이 있는 건은 없어 챗봇 답변은 지금 바뀌지 않습니다. ') +
          '나머지는 「재수집 필요」 표시만 붙습니다. 위키는 자동으로 안 바뀌니, 승인 뒤 나오는 지시문으로 사람이 반영해야 합니다. ' +
          '취소하려면 이 방을 벗어났다 다시 들어오세요.');
      }).catch(function (e) {
        allBtn.disabled = false; allBtn.textContent = ALL_LABEL;
        fail('네트워크 오류: ' + String(e && e.message || e));
      });
    };
  }

  /**
   * 개정 검토 방: 상단 "지금 스캔" 버튼(정기 cron과 별개로 즉시 1회, 백그라운드 3~4분) + 목록.
   * 승인해도 재수집·재빌드는 여기서 자동 실행하지 않는다(사람이 다음 단계로 orchestrate).
   * [연계] → POST /api/legal/amendments/scan-now(백그라운드 시작, 즉시 응답), GET /api/legal/amendments?status=pending, bindDecideCard.
   * @param {HTMLElement} host
   */
  function renderAmendCards(host) {
    if (!host) return;
    var SCAN_LABEL = '🔍 지금 스캔 (백그라운드 · 완료까지 3~4분)';
    host.innerHTML = '<div class="nrya-rv-actions" style="margin-bottom:8px"><button class="nrya-btn-ok" id="nryaAmendScanBtn" style="flex:0 0 auto;padding:8px 16px">' + SCAN_LABEL + '</button></div>' +
      // ★일괄 처리 줄(2026-09-10 사용자 요청). 전체 승인은 **누르기 전에 무엇이 벌어지는지 먼저 보여준다**.
      '<div class="nrya-rv-actions" style="margin-bottom:10px">' +
        '<button class="nrya-btn-ok" id="nryaAmendAllBtn" style="flex:1 1 auto;padding:8px 16px;white-space:nowrap">✓ 전체 승인</button>' +
        '<button class="nrya-btn-brief" id="nryaAmendAllBriefBtn" type="button" style="flex:1 1 auto;margin:0;padding:8px 16px;white-space:nowrap">📋 승인분 전체 지시문</button>' +
      '</div>' +
      '<div class="nrya-inline-err nrya-hidden" id="nryaAmendScanErr" style="display:none"></div>' +
      '<div class="nrya-gauge nrya-hidden" id="nryaScanGauge"></div>' +
      '<div class="nrya-brief nrya-hidden" id="nryaAmendAllBrief"></div>' +
      '<div id="nryaAmendListHost"></div>';
    bindAmendBulk();
    // 스캔을 걸어 두고 이 방을 벗어났다 돌아온 경우 — 게이지를 **이어서** 보여 준다.
    legalGet('/api/legal/amendments/scan-progress').then(function (res) {
      return res.ok ? res.json().catch(function () { return null; }) : null;
    }).then(function (d) { if (d && d.ok && d.running) startScanGauge(); }).catch(function () {});
    var scanBtn = document.getElementById('nryaAmendScanBtn');
    var scanErr = document.getElementById('nryaAmendScanErr');
    if (scanBtn) scanBtn.onclick = function () {
      if (scanErr) { scanErr.style.display = 'none'; scanErr.textContent = ''; }
      scanBtn.disabled = true; scanBtn.textContent = '스캔 시작 중…';
      legalPost('/api/legal/amendments/scan-now', {}).then(function (res) {
        if (res.status === 401 || res.status === 403) return { _denied: true };
        return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
      }).then(function (data) {
        scanBtn.disabled = false; scanBtn.textContent = SCAN_LABEL;
        if (data && data._denied) { if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = '관리자 로그인 필요'; } return; }
        if (!data || !data.ok) { if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = (data && data.error) || '스캔 실패'; } return; }
        // started:true — 백그라운드에서 계속 진행 중. 게이지 바를 띄우고 2초마다 진행률을 물어본다.
        startScanGauge();
      }).catch(function (e) { scanBtn.disabled = false; scanBtn.textContent = SCAN_LABEL; if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = '네트워크 오류: ' + String(e && e.message || e); } });
    };
    loadAmendList();
  }

  var scanPollTimer = null;   // 게이지 폴링 타이머(방을 떠나면 멈춘다)

  /**
   * 「지금 스캔」 진행률 게이지를 띄우고 2초마다 서버에 진행 상황을 물어 갱신한다.
   *
   * ★막대는 **질의 진행도**이지 남은 시간이 아니다 — 부처마다 고시 수가 들쭉날쭉해 시간으로
   *   환산하면 거짓 예측이 된다. 그래서 막대 아래에 지금 무엇을 하고 있는지(단계·부처)와
   *   고시 상세를 받아 온 횟수를 함께 적어, 막대가 한동안 안 움직여도 **멈춘 게 아님**을 보인다.
   * 스캔이 끝나면 결과(새로 올린 건수)를 적고 목록을 자동으로 새로 그린다 —
   *   종전에는 "잠시 후 이 방을 다시 열어 새로고침해 주세요"라고만 적혀 있었다.
   * [연계] → GET /api/legal/amendments/scan-progress · loadAmendList(끝나면 자동 새로고침).
   */
  function startScanGauge() {
    var box = document.getElementById('nryaScanGauge'); if (!box) return;
    stopScanGauge();
    box.classList.remove('nrya-hidden');
    paintGauge({ running: true, percent: 0, phase: '준비', label: '스캔을 시작하는 중', detail: 0 });
    var misses = 0;                       // 연달아 실패한 조회 수(너무 많으면 폴링을 멈춘다)
    scanPollTimer = setInterval(function () {
      legalGet('/api/legal/amendments/scan-progress').then(function (res) {
        if (res.status === 401 || res.status === 403) return { _denied: true };
        return res.json().catch(function () { return null; });
      }).then(function (d) {
        if (!d || d._denied || !d.ok) {
          if (++misses >= 5) { stopScanGauge(); paintGauge({ done: true, err: '진행률을 받지 못했습니다. 잠시 후 이 방을 다시 열어 확인해 주세요.' }); }
          return;
        }
        misses = 0;
        paintGauge(d);
        if (!d.running && d.finishedAt) {   // 끝났다 — 폴링을 멈추고 목록을 새로 그린다
          stopScanGauge();
          loadAmendList();
        }
      }).catch(function () {
        if (++misses >= 5) { stopScanGauge(); paintGauge({ done: true, err: '진행률을 받지 못했습니다. 잠시 후 이 방을 다시 열어 확인해 주세요.' }); }
      });
    }, 2000);
  }

  /** 게이지 폴링을 멈춘다(멱등 — 두 번 불러도 안전). */
  function stopScanGauge() {
    if (scanPollTimer) { clearInterval(scanPollTimer); scanPollTimer = null; }
  }

  /**
   * 게이지 한 장을 그린다.
   * @param {object} d - 서버 진행률({running,percent,phase,label,detail,result}) 또는
   *                     {done:true, err:'…'}(폴링 실패 안내)
   */
  function paintGauge(d) {
    var box = document.getElementById('nryaScanGauge'); if (!box) return;
    if (d && d.err) {
      box.innerHTML = '<div class="nrya-gauge-head"><b>⚠ 스캔 진행률</b></div><div class="nrya-gauge-sub">' + esc(d.err) + '</div>';
      return;
    }
    var pct = Math.max(0, Math.min(100, Number(d.percent) || 0));
    var finished = d.running === false && d.finishedAt;
    var r = d.result || null;
    var headTxt = finished
      ? (r ? '✅ 스캔 완료 — 새로 올린 개정 ' + nfmt(r.changed) + '건'
             + (r.filtered ? ' · 우리 법과 무관해 거른 신규 고시 ' + nfmt(r.filtered) + '건' : '')
             + (r.errors ? ' · ⚠ 탐지 스크립트 오류 있음(서버 로그 확인)' : '')
           : '✅ 스캔 완료')
      : '🔄 스캔 중 — ' + pct + '%';
    var sub = finished
      ? '아래 목록을 방금 새로 그렸습니다.'
      : (d.phase === '법령' ? '1단계: 법령 개정 광역질의'
        : d.phase === '행정규칙' ? '2단계: 행정규칙(고시) 광역질의'
        : '준비 중') +
        (d.label ? ' · ' + esc(String(d.label)) : '') +
        (d.total ? ' (' + nfmt(d.done) + '/' + nfmt(d.total) + ' 질의)' : '') +
        (d.detail ? ' · 고시 상세 ' + nfmt(d.detail) + '건 확인' : '');
    box.innerHTML = '<div class="nrya-gauge-head"><b>' + headTxt + '</b></div>' +
      '<div class="nrya-gauge-bar"><i style="width:' + (finished ? 100 : pct) + '%"></i></div>' +
      '<div class="nrya-gauge-sub">' + sub + '</div>' +
      (finished ? '' : '<div class="nrya-gauge-note">막대는 <b>질의 진행도</b>입니다(남은 시간이 아닙니다). 부처마다 고시 수가 달라 한동안 안 움직일 수 있지만, 아래 숫자가 늘고 있으면 정상입니다. 이 방을 벗어나도 스캔은 계속 돕니다.</div>');
  }

  /** renderAmendCards 의 목록 부분만 새로고침(스캔 버튼은 그대로 둔다). */
  function loadAmendList() {
    var listHost = document.getElementById('nryaAmendListHost'); if (!listHost) return;
    listHost.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>개정 목록을 불러오는 중…</div>';
    legalGet('/api/legal/amendments?status=pending').then(function (res) {
      if (res.status === 401 || res.status === 403) { listHost.innerHTML = adminLockHTML(); return null; }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) { listHost.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>'; return; }
      var list = data.amendments || [];
      if (!list.length) { listHost.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">✅</span>감지된 개정이 없습니다.</div>'; return; }
      listHost.innerHTML = '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">총 ' + list.length + '건</div>' + list.map(amendmentCardHTML).join('');
      listHost.querySelectorAll('.nrya-rv').forEach(function (card) {
        bindDecideCard(card, '/api/legal/amendments', 'approved', 'dismissed', '승인(재수집 필요)', '무시');
        bindBriefButton(card);
      });
    }).catch(function (e) { listHost.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>'; });
  }

  // ============================================================================
  // 원문신선도 — 서버 연동. 매주 자동 점검 결과(구버전 행정규칙)를 보여주고,
  //   관리자가 처리하거나 무시한다. 개정검토와 같은 2택 구조라 bindDecideCard 를 공유한다.
  //
  // ★이 방이 개정검토와 다른 점: 카드에 "무엇이 낡았나"만이 아니라 **무엇을 해야 하는지
  //   (actions)** 와 **어느 위키를 고쳐야 하는지(wiki_pages)** 가 함께 담긴다.
  //   그게 없으면 관리자는 "낡았다"는 사실만 알고 어디에 손을 대야 할지 모른다.
  // [연계] ← GET /api/legal/freshness · POST /api/legal/freshness/:id/decide
  //        · POST /api/legal/freshness/scan-now · services/admrul_fresh_scanner.js
  // ============================================================================

  /**
   * 마지막 점검이 언제·어떻게 끝났는지 한 줄로. **"이상 없음"과 "점검 실패"를 반드시 구분한다** —
   * 실패를 이상 없음으로 읽으면 낡은 원문을 그대로 놔두게 된다.
   * @param {object|null} last - {ok,finishedAt,checked,stale,added,unknown,error}
   * @returns {string} HTML
   */
  function freshLastHTML(last) {
    if (!last) {
      return '<div class="nrya-notice-box"><span class="nrya-em">ℹ️</span>아직 한 번도 점검하지 않았습니다. 매주 일요일 새벽 3시(KST)에 자동으로 돌고, 아래 버튼으로 지금 돌릴 수도 있습니다.</div>';
    }
    if (!last.ok) {
      return '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span><b>마지막 점검이 실패했습니다</b> (' + esc(shortTs(last.finishedAt)) + ')<br>' +
        '<span style="font-size:11.5px">사유: ' + esc(last.error || '알 수 없음') + '</span><br>' +
        '<span style="font-size:11.5px;color:var(--nrya-text-sub)">아래 목록이 비어 있어도 <b>"낡은 원문이 없다"는 뜻이 아닙니다</b> — 확인을 못 한 것입니다.</span></div>';
    }
    // 한쪽(행정규칙/법령)만 실패했으면 숫자만 보여주고 넘기면 안 된다 — 무엇을 못 봤는지 밝힌다.
    var partial = last.partialError
      ? '<div class="nrya-notice-box nrya-err" style="margin-bottom:8px"><span class="nrya-em">⚠️</span><b>일부 점검이 실패했습니다</b><br><span style="font-size:11.5px">' + esc(last.partialError) + '<br>그 부분은 <b>확인하지 못한 것</b>이지 "이상 없음"이 아닙니다.</span></div>'
      : '';
    return partial + '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">' +
      '마지막 점검 ' + esc(shortTs(last.finishedAt)) + ' · ' + (last.checked || 0) + '건 대조 · 낡은 원문 ' + (last.stale || 0) + '건' +
      (last.renamed ? '(그중 이름 바뀜 의심 ' + last.renamed + '건)' : '') +
      (last.mismatch ? ' · 이름불일치 ' + last.mismatch + '건' : '') +
      (last.repealed ? ' · 폐지가능 ' + last.repealed + '건' : '') +
      (last.unknown ? ' · 응답없음 ' + last.unknown + '건' : '') + '</div>' +
      ((last.mismatch || last.unknown)
        ? '<div class="nrya-notice-box" style="margin:0 0 8px"><span class="nrya-em">ℹ️</span>' +
          '<b>확인하지 못한 것 ' + ((last.mismatch || 0) + (last.unknown || 0)) + '건</b> — "이상 없음"이 아닙니다.<br>' +
          '<span style="font-size:11.5px;color:var(--nrya-text-sub)">' +
          '<b>이름불일치</b>: 우리 파일 제목과 국가법령정보센터 공식 이름이 달라 찾지 못한 것입니다. 2026-08-27부터는 이런 경우 <b>이름이 비슷한 현행을 후보로 찾아 아래 목록에 함께 띄웁니다</b>(그 행은 "이름 바뀜 의심"으로 표시됩니다). 비슷하다고 기계가 임의로 이어 붙이지는 않습니다 — 다른 기관·다른 단지 고시가 검색 상위로 나오는 일이 있어 잘못 짝지을 위험이 큽니다. 후보가 하나도 없을 때만 여기 "확인하지 못한 것"으로 남습니다.<br>' +
          '<b>응답없음</b>: 조회가 실패한 것이니 다음 점검 때 다시 확인됩니다.</span></div>' +
          (last.repealed
            ? '<div class="nrya-notice-box nrya-err" style="margin:0 0 8px"><span class="nrya-em">🚨</span>' +
              '<b>폐지 가능 ' + last.repealed + '건</b> — 본문은 열리는데 <b>현행 목록에는 없습니다.</b><br>' +
              '<span style="font-size:11.5px;color:var(--nrya-text-sub)">구버전과는 다른 문제입니다. 구버전은 새 판으로 갈면 되지만, 폐지된 것을 현행처럼 들고 있으면 <b>없어진 규정을 살아 있는 것처럼 안내</b>하게 됩니다. 사람이 확인해야 합니다.</span></div>'
            : '')
        : '');
  }

  /**
   * 구버전 원문 카드 1건.
   * @param {object} it - {id,ts,title,held_ids,current,files,wiki_pages,actions,status}
   * @returns {string} HTML
   */
  function freshnessCardHTML(it) {
    var st = it.status === 'done' ? '<span class="nrya-rv-st nrya-done">✓ 처리완료</span>'
      : it.status === 'dismissed' ? '<span class="nrya-rv-st nrya-rej">✗ 해당없음</span>'
      : '<span class="nrya-rv-st nrya-warn">' + ((it.verdict === '이름바뀜의심') ? '이름 바뀜 의심' : '구버전') + '</span>';
    var cur = it.current || {};
    var held = (it.held_ids || []).join(', ');
    var link = 'https://www.law.go.kr/admRulSc.do?menuId=5&query=' + encodeURIComponent(it.title || '');
    var tier = it.tier || '행정규칙';
    // 시행예정 판이 있으면 알려 준다 — **결함이 아니라 "곧 이렇게 바뀐다"는 예고다.**
    var pend = (it.pending || []).length
      ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">📅 시행예정</div><div class="nrya-rv-fval">' +
          it.pending.map(function (x) { return esc(x.issued) + ' 시행 (공포 ' + esc(x.no || '?') + ')'; }).join('<br>') +
          '<br><span style="font-size:11.5px;color:var(--nrya-text-sub)">아직 시행 전이라 지금 고칠 것은 아닙니다. 시행일에 맞춰 다시 받으면 됩니다.</span></div></div>'
      : '';
    // ★이름이 바뀐 것으로 보이는 행(2026-08-27) — "몇 번에서 몇 번으로" 대신 **후보 목록**을 보여 준다.
    //   같은 이름의 현행이 없어 현행 일련번호를 못 짚는 경우다. 후보는 **판정이 아니다.**
    var cands = it.rename_candidates || [];
    var candHTML = cands.length
      ? '<div class="nrya-rv-field"><div class="nrya-rv-flab">🔎 이름이 바뀐 것 같은 현행 후보</div><div class="nrya-rv-fval">' +
          '<ul style="margin:4px 0 0;padding-left:18px">' + cands.map(function (c) {
            return '<li style="margin:2px 0">「' + esc(c.name) + '」<br>' +
              '<span style="font-size:11.5px;color:var(--nrya-text-sub)">일련 ' + esc(c.serial) +
              ' · 발령 ' + esc(c.issued) + '</span></li>'; }).join('') + '</ul>' +
          '<span style="font-size:11.5px;color:var(--nrya-text-sub)">⚠후보일 뿐입니다. 이름이 비슷해도 다른 문서일 수 있어요 — ' +
          '소관 기관과 적용 대상(구역·단지)이 같은지 본문으로 대조한 뒤에 판단하세요.</span></div></div>'
      : '';
    var wiki = (it.wiki_pages || []).length
      ? '<ul style="margin:4px 0 0;padding-left:18px">' + it.wiki_pages.map(function (w) {
          return '<li style="margin:2px 0"><code style="font-size:11px">' + esc(w) + '</code></li>'; }).join('') + '</ul>'
      : '<span style="color:var(--nrya-text-sub)">아직 못 찾았습니다 — 제목이 본문에 그대로 안 적혀 있을 수 있으니 조문 번호·소관 기관으로 다시 찾아보세요.</span>';
    var actions = (it.actions || []).length
      ? '<ol style="margin:4px 0 0;padding-left:18px">' + it.actions.map(function (x) {
          // actions 문구는 서버가 만든 안내문이다(사용자 입력이 아니다). 그래도 esc 로 통일한다.
          return '<li style="margin:4px 0">' + esc(x) + '</li>'; }).join('') + '</ol>'
      : '<span style="color:var(--nrya-text-sub)">(안내 없음)</span>';
    var body =
      '<div class="nrya-rv-body">' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">📚 계열</div><div class="nrya-rv-fval">' + esc(tier) + '</div></div>' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">🔢 어떻게 낡았나</div><div class="nrya-rv-fval">' +
          (cands.length
            ? '우리가 가진 일련번호 <b>' + esc(held || '?') + '</b>. 이 이름으로는 <b>현행 목록에서 못 찾았습니다</b> — 이름이 바뀌었을 수 있습니다(아래 후보 참고).'
            : '우리가 가진 일련번호 <b>' + esc(held || '?') + '</b> → 현행 <b>' + esc(cur.serial || '?') + '</b>' +
              (cur.issued ? '<br>현행 발령일자 ' + esc(cur.issued) + (cur.no ? ' · 발령번호 ' + esc(cur.no) : '') : '')) +
        '</div></div>' +
        candHTML +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">🛠 해야 할 일</div><div class="nrya-rv-fval">' + actions + '</div></div>' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">📄 고쳐야 할 위키 (' + ((it.wiki_pages || []).length) + ')</div><div class="nrya-rv-fval">' + wiki + '</div></div>' +
        pend +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">📁 낡은 원문 파일</div><div class="nrya-rv-fval"><code style="font-size:11px">' + esc((it.files || []).join(' · ') || '(없음)') + '</code></div></div>' +
        '<a class="nrya-rv-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">🔗 law.go.kr에서 현행본 확인</a>' +
        (((it.status || 'pending') === 'pending') ? '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 처리완료</button><button class="nrya-btn-no">✗ 해당없음</button></div>' : '') +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
    return '<div class="nrya-rv" data-id="' + esc(it.id) + '"><div class="nrya-rv-head"><span class="nrya-rv-id">🕰</span><div class="nrya-rv-t">' +
      esc(it.title || it.id) + '<small>' + esc(shortTs(it.ts)) + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 원문신선도 방: 상단 "지금 점검" 버튼(정기 점검과 별개로 즉시 1회, 백그라운드 20~30분) + 목록.
   * 처리완료로 표시해도 재수집·위키수정은 여기서 자동 실행하지 않는다(사람이 직접 한다).
   * @param {HTMLElement} host
   */
  function renderFreshCards(host) {
    if (!host) return;
    var SCAN_LABEL = '🔍 지금 점검 (백그라운드 · 완료까지 30~40분)';
    host.innerHTML = '<div class="nrya-rv-actions" style="margin-bottom:10px"><button class="nrya-btn-ok" id="nryaFreshScanBtn" style="flex:0 0 auto;padding:8px 16px">' + SCAN_LABEL + '</button></div>' +
      '<div class="nrya-inline-err nrya-hidden" id="nryaFreshScanErr" style="display:none"></div>' +
      '<div id="nryaFreshListHost"></div>';
    var scanBtn = document.getElementById('nryaFreshScanBtn');
    var scanErr = document.getElementById('nryaFreshScanErr');
    if (scanBtn) scanBtn.onclick = function () {
      if (scanErr) { scanErr.style.display = 'none'; scanErr.textContent = ''; }
      scanBtn.disabled = true; scanBtn.textContent = '점검 시작 중…';
      legalPost('/api/legal/freshness/scan-now', {}).then(function (res) {
        if (res.status === 401 || res.status === 403) return { _denied: true };
        return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
      }).then(function (data) {
        scanBtn.disabled = false; scanBtn.textContent = SCAN_LABEL;
        if (data && data._denied) { if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = '관리자 로그인 필요'; } return; }
        if (!data || !data.ok) { if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = (data && data.error) || '점검 시작 실패'; } return; }
        var listHost = document.getElementById('nryaFreshListHost');
        if (listHost) {
          listHost.insertAdjacentHTML('afterbegin', '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">🔄 백그라운드 점검이 시작됐습니다. 행정규칙 653건 + 법령 222건을 하나씩 대조하느라 30~40분 걸립니다 — 나중에 이 방을 다시 열어 확인해 주세요.</div>');
        }
      }).catch(function (e) { scanBtn.disabled = false; scanBtn.textContent = SCAN_LABEL; if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = '네트워크 오류: ' + String(e && e.message || e); } });
    };
    loadFreshList();
  }

  /** renderFreshCards 의 목록 부분만 새로고침(점검 버튼은 그대로 둔다). */
  function loadFreshList() {
    var listHost = document.getElementById('nryaFreshListHost'); if (!listHost) return;
    listHost.innerHTML = '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>목록을 불러오는 중…</div>';
    legalGet('/api/legal/freshness?status=pending').then(function (res) {
      if (res.status === 401 || res.status === 403) { listHost.innerHTML = adminLockHTML(); return null; }
      return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
    }).then(function (data) {
      if (data === null) return;
      if (!data || !data.ok) { listHost.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>' + esc((data && data.error) || '목록을 불러오지 못했습니다.') + '</div>'; return; }
      var head = freshLastHTML(data.last);
      var list = data.items || [];
      if (!list.length) {
        // 점검이 실패했으면 "이상 없음"이라고 쓰지 않는다 — freshLastHTML 이 그 사정을 위에 적어 준다.
        var okMsg = (data.last && data.last.ok)
          ? '<div class="nrya-notice-box"><span class="nrya-em">✅</span>낡은 원문이 없습니다.</div>'
          : '';
        listHost.innerHTML = head + okMsg; return;
      }
      listHost.innerHTML = head + '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">처리 대기 ' + list.length + '건</div>' + list.map(freshnessCardHTML).join('');
      listHost.querySelectorAll('.nrya-rv').forEach(function (card) { bindDecideCard(card, '/api/legal/freshness', 'done', 'dismissed', '처리완료', '해당없음'); });
    }).catch(function (e) { listHost.innerHTML = '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>'; });
  }

  // 리뷰 카드에서 우선 노출할 구조화 필드(라벨·아이콘). 존재하는 것만 순서대로 렌더.
  // ⚠2026-08-06: 'AI 법리추론 내용(사람 확인 필요)' 등 review_queue.md가 실제로 쓰던 라벨이
  // 이 목록에 없어 화면에서 통째로 사라지던 버그가 있었다(사용자 지적으로 발견) — 아래 두 키를
  // 🧠 행에 추가해 해소. '볼 법(N)'·'확인 체크리스트'는 §6-D 표준 필드라 여기 목록이 아니라
  // reviewFieldsHTML()에서 별도 전용 렌더링을 한다(law.go.kr 링크·번호목록 등 구조가 다름).
  var FIELD_VIEW = [
    { keys: ['AI 제안값', 'AI 제안', '제안값'], icon: '💡', label: 'AI 제안값' },
    { keys: ['AI 연결 내용', 'AI 연결·판단 내용', 'AI 판단', 'AI 유추', 'AI 연결', '정의 사슬 추적', 'AI 법리추론 내용', 'AI 법리추론 내용(사람 확인 필요)'], icon: '🧠', label: 'AI 분석 내용' },
    { keys: ['왜 의문인가'], icon: '❓', label: '왜 의문인가' },
    { keys: ['AI 잠정결론'], icon: '🧭', label: 'AI 잠정결론' },
    { keys: ['문제'], icon: '❗', label: '문제' },
    { keys: ['확인 필요', '확인'], icon: '🔍', label: '확인 필요' },
    { keys: ['근거'], icon: '📎', label: '근거' },
    { keys: ['원문 조문', '원문'], icon: '📜', label: '원문 조문' },
    { keys: ['필요 조치', '필요조치'], icon: '🛠', label: '필요 조치' },
    { keys: ['still_missing', '미확보', '미수집'], icon: '🚧', label: '미수집/미확보' }
  ];

  /** URL 이 원본 이미지(별표 스캔·flDownload)인지 판정. @param {string} u @returns {boolean} */
  function isImageUrl(u) { return /flDownload|\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|#|$)/i.test(u); }

  /**
   * "볼 법(N)" 필드 값 하나를 law.go.kr 검색 링크가 붙은 카드로 그린다.
   * 값 형식은 "「법령 전체명칭」 제N조 — 요지"(§6-D 표준) — 「」로 법령명을 뽑아 검색어로 쓴다.
   * @param {string} val @returns {string}
   */
  function lawBlockHTML(val) {
    var parts = String(val).split(/\s*—\s*/);
    var head = (parts[0] || '').trim();
    var gist = parts.slice(1).join(' — ').trim();
    var nameMatch = head.match(/「([^」]+)」/);
    var lawName = nameMatch ? nameMatch[1] : '';
    var link = lawName ? 'https://www.law.go.kr/lsSc.do?menuId=1&query=' + encodeURIComponent(lawName) : '';
    return '<div class="nrya-rv-lawblock">' +
      '<div class="nrya-rv-lawhead">' + esc(head) + '</div>' +
      (gist ? '<div class="nrya-rv-lawgist">' + esc(gist) + '</div>' : '') +
      (link ? '<a class="nrya-rv-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">🔗 law.go.kr에서 검색</a>' : '') +
      '</div>';
  }

  /** "확인 체크리스트" 필드(서버가 개행으로 합쳐 준 "1. …\n2. …")를 번호 목록으로. @param {string} text @returns {string} */
  function checklistHTML(text) {
    var lines = String(text).split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
    if (!lines.length) return '';
    return '<ol class="nrya-rv-checklist">' + lines.map(function (l) {
      return '<li>' + esc(l.replace(/^\d+\.\s*/, '')) + '</li>'; // 앞 번호는 <ol>이 그려주므로 벗김
    }).join('') + '</ol>';
  }

  /**
   * 서버가 파싱해 준 fields(구조화 항목) + urls(검증 링크)로 스캔 가능한 카드 본문을 만든다.
   * fields 가 비면 긴 body 를 잘라서 폴백 표시한다. "볼 법(N)"·"확인 체크리스트"(§6-D 표준
   * 필드, 2026-08-06)는 FIELD_VIEW 루프보다 먼저 전용 렌더링(law.go.kr 링크·번호목록)한다.
   * @param {object} rv - {fields, urls, body}
   * @returns {string} 본문 HTML
   */
  function reviewFieldsHTML(rv) {
    var fields = rv.fields || {};
    var used = {};
    var rows = '';

    var lawKeys = Object.keys(fields).filter(function (k) { return /^볼\s*법\s*\(\d+\)/.test(k); });
    if (lawKeys.length) {
      lawKeys.sort(function (a, b) {
        var na = parseInt((a.match(/\((\d+)\)/) || [])[1] || '0', 10);
        var nb = parseInt((b.match(/\((\d+)\)/) || [])[1] || '0', 10);
        return na - nb;
      });
      rows += '<div class="nrya-rv-field"><div class="nrya-rv-flab">⚖️ 볼 법 (' + lawKeys.length + ')</div>' +
        lawKeys.map(function (k) { used[k] = 1; return lawBlockHTML(fields[k]); }).join('') + '</div>';
    }

    if (fields['확인 체크리스트']) {
      used['확인 체크리스트'] = 1;
      rows += '<div class="nrya-rv-field"><div class="nrya-rv-flab">🔍 확인 체크리스트 — 이 순서대로 확인해주세요</div>' + checklistHTML(fields['확인 체크리스트']) + '</div>';
    }

    FIELD_VIEW.forEach(function (fv) {
      for (var i = 0; i < fv.keys.length; i++) {
        var k = fv.keys[i];
        if (fields[k] && !used[k]) {
          used[k] = 1;
          rows += '<div class="nrya-rv-field"><div class="nrya-rv-flab">' + fv.icon + ' ' + esc(fv.label) + '</div><div class="nrya-rv-fval">' + esc(fields[k]) + '</div></div>';
          break;
        }
      }
    });
    if (!rows) {
      // 폴백: 구조화 필드가 없으면 body 를 잘라 보여줌(장문 방지)
      var b = String(rv.body || '').trim();
      if (b.length > 480) b = b.slice(0, 480) + ' …';
      rows = '<div class="nrya-rv-field"><div class="nrya-rv-fval nrya-rv-fval-pre">' + esc(b || '(본문 없음)') + '</div></div>';
    }
    var urls = rv.urls || [];
    if (urls.length) {
      rows += '<div class="nrya-rv-links"><div class="nrya-rv-flab">🔗 원문/이미지 링크 (검증)</div>' +
        urls.map(function (u) {
          var img = isImageUrl(u);
          return '<a class="nrya-rv-link' + (img ? ' nrya-img' : '') + '" href="' + esc(u) + '" target="_blank" rel="noopener noreferrer">' + (img ? '🖼 원본 이미지 열기' : '🔗 원문 링크 열기') + '</a>';
        }).join('') + '</div>';
    }
    return rows;
  }

  /**
   * 리뷰 1건을 카드 HTML로 만든다. 헤더(title+law) + 구조화 필드(AI 분석/확인 필요/근거)
   * + 클릭 가능한 검증 링크 + 교정입력 + 승인/반려 + 반영사슬.
   * @param {object} rv - {id,law,title,targetPages,body,fields,urls,approved,approvedMeta}
   * @param {boolean} open - 최초 펼침 여부
   * @returns {string} 카드 HTML
   */
  function reviewCardHTML(rv, open) {
    var approved = !!rv.approved;
    // 이미 승인된 항목은 승인/반려 대신 **되돌리기**만 보여준다(잘못 누른 승인을 되돌릴 길이 없었다).
    if (approved) {
      var pagesA = (rv.targetPages || []).map(esc).join(' · ');
      return '<div class="nrya-rv nrya-approved' + (open ? ' nrya-open' : '') + '" data-id="' + esc(rv.id) + '">' +
        '<div class="nrya-rv-head"><span class="nrya-rv-id">' + esc(rv.id) + '</span>' +
        '<div class="nrya-rv-t">' + esc(rv.title || rv.id) + '<small><b>' + esc(rv.law || '') + '</b></small></div>' +
        '<span class="nrya-rv-st nrya-done">✓ 승인·canonical</span></div>' +
        '<div class="nrya-rv-body">' + reviewFieldsHTML(rv) +
          (pagesA ? '<div class="nrya-src-line">📍 대상 페이지: ' + pagesA + '</div>' : '') +
          '<div class="nrya-rv-actions"><button class="nrya-btn-no nrya-btn-undo">↩ 승인 되돌리기 (대기로)</button></div>' +
          '<div class="nrya-inline-err nrya-hidden" style="display:none"></div><div class="nrya-chain"></div>' +
        '</div></div>';
    }
    var pages = (rv.targetPages || []).map(esc).join(' · ');
    var st = approved
      ? '<span class="nrya-rv-st nrya-done">✓ 승인·canonical</span>'
      : '<span class="nrya-rv-st nrya-wait">검증 대기</span>';
    // 유형 분기(2026-08-06 3갈래로 확장): '확인 체크리스트'가 있으면 §6-D 신형(직접 확인→AI 재검토),
    // 'AI 제안값'이 있으면 값확정형(수치 입력), 나머지는 구형 해석·판단형(승인/기각+선택 메모).
    var hasChecklist = !!((rv.fields || {})['확인 체크리스트']);
    var isValue = !!((rv.fields || {})['AI 제안값']);
    var correctBlock, actionsHTML;
    if (hasChecklist) {
      correctBlock =
        '<div class="nrya-findings">' +
          '<div class="nrya-findings-q">✍️ <b>확인한 내용을 적어주세요</b> — 위 체크리스트대로 직접 확인한 뒤 무엇을 확인했는지 적으면, AI가 원문·논리와 다시 대조합니다.</div>' +
          '<textarea class="nrya-findings-in" placeholder="예: law.go.kr에서 원문 확인함 — 위키 서술과 문구 일치"></textarea>' +
        '</div><div class="nrya-ai-verdict nrya-hidden"></div>';
      actionsHTML = '<div class="nrya-rv-actions"><button class="nrya-btn-ok nrya-btn-findings">✍️ 확인 내용 제출 → AI 재검토</button><button class="nrya-btn-no">✗ 반려</button></div>';
    } else {
      correctBlock = isValue
        ? '<div class="nrya-correct">' +
            '<div class="nrya-correct-q">💡 <b>값 확정</b>: 원본 이미지·조문을 확인하고, AI 제안값이 맞으면 비워두고 승인, 틀리면 올바른 값으로 고쳐 승인하세요.</div>' +
            '<div class="nrya-correct-row"><label>확정 값</label><input class="nrya-correct-in" value="" placeholder="예: 300만원 (맞으면 비워두고 승인)"></div>' +
          '</div>'
        : '<div class="nrya-correct">' +
            '<div class="nrya-correct-q">🧠 <b>판단</b>: 위 AI 분석이 타당하면 승인, 아니면 기각. 필요하면 메모를 남기세요(수치 입력 아님).</div>' +
            '<div class="nrya-correct-row"><label>메모(선택)</label><input class="nrya-correct-in" value="" placeholder="예: 사전통지 비적용 해석 맞음"></div>' +
          '</div>';
      actionsHTML = '<div class="nrya-rv-actions"><button class="nrya-btn-ok">' + (isValue ? '✓ 승인 (값 확정)' : '✓ 승인 (판단 인정)') + '</button><button class="nrya-btn-no">✗ ' + (isValue ? '반려' : '기각') + '</button></div>';
    }
    var body =
      '<div class="nrya-rv-body">' +
        reviewFieldsHTML(rv) +
        (pages ? '<div class="nrya-src-line">📍 대상 페이지: ' + pages + '</div>' : '') +
        correctBlock +
        actionsHTML +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
        '<div class="nrya-chain"></div>' +
      '</div>';
    return '<div class="nrya-rv' + (open ? ' nrya-open' : '') + (approved ? ' nrya-approved' : '') + '" data-id="' + esc(rv.id) + '">' +
      '<div class="nrya-rv-head"><span class="nrya-rv-id">' + esc(rv.id) + '</span><div class="nrya-rv-t">' + esc(rv.title || rv.id) + '<small><b>' + esc(rv.law || '') + '</b>' + (pages ? ' · ' + (rv.targetPages || []).length + '개 페이지' : '') + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 리뷰 카드 1장에 헤더 토글 + 승인/반려(또는 확인제출→AI재검토) 동작을 바인딩한다.
   * 카드에 `.nrya-findings-in`(§6-D 신형, 확인 체크리스트 있는 항목)이 있으면 "확인 제출"
   * 경로(POST submit-findings)를, 없으면 기존 "승인/기각" 경로(POST approve)를 쓴다.
   * 승인: promotedCount>0 이면 초록 성공, 0 이면 경고(승격 0건)로 표시. 실패는 인라인 오류.
   * @param {HTMLElement} card
   * [연계] → POST /api/legal/reviews/:id/approve, POST /api/legal/reviews/:id/submit-findings.
   */
  function bindReviewCard(card) {
    var id = card.getAttribute('data-id');
    var head = card.querySelector('.nrya-rv-head');
    if (head) head.onclick = function () { card.classList.toggle('nrya-open'); };

    var okBtn = card.querySelector('.nrya-btn-ok');
    var noBtn = card.querySelector('.nrya-btn-no');
    var undoBtn = card.querySelector('.nrya-btn-undo');
    var errBox = card.querySelector('.nrya-inline-err');
    var findingsIn = card.querySelector('.nrya-findings-in');

    function showErr(msg) { if (!errBox) return; errBox.style.display = 'block'; errBox.classList.remove('nrya-hidden'); errBox.textContent = msg; }
    function clearErr() { if (!errBox) return; errBox.style.display = 'none'; errBox.textContent = ''; }
    function setBusy(b) { if (okBtn) okBtn.disabled = b; if (noBtn) noBtn.disabled = b; if (undoBtn) undoBtn.disabled = b; }

    /**
     * 승인 직후 **그 카드 안에** 되돌리기 버튼을 붙인다.
     * 승인되면 CSS 가 액션 영역을 숨기고(`.nrya-approved .nrya-rv-actions{display:none}`),
     * 되돌리려면 목록 위 "승인됨"으로 바꿔 167건 중에서 찾아야 했다 — 방금 누른 것을 그 자리에서
     * 되돌릴 길이 없었다(2026-08-28 독립 검토에서 지적).
     */
    function addInlineUndo() {
      var box = card.querySelector('.nrya-chain');
      if (!box || box.querySelector('.nrya-btn-undo')) return;
      var btn = document.createElement('button');
      btn.className = 'nrya-btn-no nrya-btn-undo';
      btn.style.marginTop = '8px';
      btn.textContent = '↩ 방금 승인 되돌리기';
      btn.onclick = function () {
        if (!window.confirm('방금 누른 승인을 되돌립니다.\n대상 페이지는 canonical → draft 로 내려가고 확정 각인이 지워집니다.')) return;
        btn.disabled = true; btn.textContent = '되돌리는 중…';
        submit('undo');
      };
      box.appendChild(btn);
    }

    function submit(decision) {
      clearErr();
      var input = card.querySelector('.nrya-correct-in');
      var val = input ? input.value.trim() : '';
      setBusy(true);
      if (okBtn && decision === 'approve') okBtn.textContent = '처리 중…';
      legalPost('/api/legal/reviews/' + encodeURIComponent(id) + '/approve', { decision: decision, correctedValue: val, by: '관리자' })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) return { _denied: true };
          return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
        })
        .then(function (data) {
          if (data._denied) { showErr('관리자 로그인 필요 — 통합관리자 센터에서 로그인 후 다시 시도하세요.'); setBusy(false); if (okBtn) okBtn.textContent = '✓ 승인'; return; }
          if (!data || !data.ok) { showErr((data && data.error) || '처리에 실패했습니다.'); setBusy(false); if (okBtn) okBtn.textContent = '✓ 승인'; return; }
          syncReviewState(id, decision);
          if (decision === 'undo') {
            card.classList.remove('nrya-approved');
            var stx = card.querySelector('.nrya-rv-st');
            if (stx) { stx.className = 'nrya-rv-st nrya-wait'; stx.textContent = '검증 대기'; }
            var box = card.querySelector('.nrya-chain');
            if (box) box.innerHTML = '<div class="nrya-rv-st nrya-wait">↩ 되돌렸습니다 — ' + esc(data.note || '') + '</div>';
            var act = card.querySelector('.nrya-rv-actions');
            if (act) act.querySelectorAll('button').forEach(function (x) { x.disabled = false; });
          } else if (decision === 'reject') { markRejected(card, data); }
          else { markApproved(card, val, data); addInlineUndo(); }   // 각인 뒤에 붙여야 안 지워진다
          refreshStats(); // 대기 카운트 배지 갱신
        })
        .catch(function (e) { showErr('네트워크 오류: ' + String(e && e.message || e)); setBusy(false); if (okBtn) okBtn.textContent = '✓ 승인'; });
    }

    /** AI 재검토 결과(mismatch/uncertain)를 텍스트 입력란 아래 콜아웃으로 보여준다. */
    function showVerdict(verdict, message) {
      var box = card.querySelector('.nrya-ai-verdict');
      if (!box) return;
      box.className = 'nrya-ai-verdict' + (verdict === 'mismatch' ? ' nrya-verdict-mismatch' : ' nrya-verdict-uncertain');
      var icon = verdict === 'mismatch' ? '⚠️' : '❔';
      box.innerHTML = '<div class="nrya-verdict-lab">' + icon + ' AI 재검토 결과</div><div class="nrya-verdict-msg">' + esc(message) + '</div>';
    }

    function submitFindings() {
      clearErr();
      var val = findingsIn ? findingsIn.value.trim() : '';
      if (!val) { showErr('확인한 내용을 입력해주세요.'); return; }
      setBusy(true);
      if (okBtn) okBtn.textContent = 'AI 재검토 중…';
      legalPost('/api/legal/reviews/' + encodeURIComponent(id) + '/submit-findings', { findings: val, by: '관리자' })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) return { _denied: true };
          return res.json().catch(function () { return { ok: false, error: '응답 파싱 실패' }; });
        })
        .then(function (data) {
          if (data._denied) { showErr('관리자 로그인 필요 — 통합관리자 센터에서 로그인 후 다시 시도하세요.'); setBusy(false); if (okBtn) okBtn.textContent = '✍️ 확인 내용 제출 → AI 재검토'; return; }
          if (!data || !data.ok) { showErr((data && data.error) || '처리에 실패했습니다.'); setBusy(false); if (okBtn) okBtn.textContent = '✍️ 확인 내용 제출 → AI 재검토'; return; }
          if (data.autoApplied) {
            markApproved(card, '', data);
            syncReviewState(id, 'approve');
            addInlineUndo();
          } else {
            setBusy(false);
            if (okBtn) okBtn.textContent = '✍️ 확인 내용 다시 제출';
            showVerdict(data.verdict, data.message);
          }
          refreshStats();
        })
        .catch(function (e) { showErr('네트워크 오류: ' + String(e && e.message || e)); setBusy(false); if (okBtn) okBtn.textContent = '✍️ 확인 내용 제출 → AI 재검토'; });
    }

    if (undoBtn) {
      // 이미 승인된 카드 — 되돌리기만 있다(승인/반려 버튼 자체가 없다).
      undoBtn.onclick = function () {
        if (!window.confirm('이 승인을 되돌립니다.\n대상 페이지는 canonical → draft 로 내려가고 확정 각인이 지워집니다.')) return;
        undoBtn.disabled = true; undoBtn.textContent = '되돌리는 중…';
        submit('undo');
      };
    } else if (findingsIn) {
      if (okBtn) okBtn.onclick = submitFindings;
      if (noBtn) noBtn.onclick = function () { submit('reject'); };
    } else {
      if (okBtn) okBtn.onclick = function () { submit('approve'); };
      if (noBtn) noBtn.onclick = function () { submit('reject'); };
    }
  }

  /**
   * 승인 응답 처리. promotedCount(승격 건수)를 기준으로 초록 성공 또는 경고로 표시한다.
   * 서버 note 를 항상 관리자에게 노출한다. changedFiles 목록도 함께 보여준다.
   * @param {HTMLElement} card @param {string} val 확정값 @param {object} data 승인 응답
   */
  function markApproved(card, val, data) {
    var promoted = (typeof data.promotedCount === 'number') ? data.promotedCount : ((data.changedFiles || []).length);
    var st = card.querySelector('.nrya-rv-st');
    var chain = card.querySelector('.nrya-chain');
    card.classList.add('nrya-approved');
    var files = data.changedFiles || [];
    var filesTxt = files.length ? files.map(esc).join(', ') : '(변경 파일 없음)';
    var valTxt = (val && val !== '') ? esc(val) : '(값 없음 — 연결·해석 확정)';
    var note = esc(data.note || '');

    if (promoted === 0) {
      // 경고: 승인은 기록됐지만 canonical 승격이 일어나지 않음
      if (st) { st.className = 'nrya-rv-st nrya-warn'; st.textContent = '⚠ 승인(승격 0건)'; }
      if (chain) {
        chain.classList.add('nrya-warn-chain');
        chain.innerHTML =
          '<div class="nrya-chain-step"><span class="nrya-n nrya-warnn">!</span> 승인은 기록됐지만 <b style="color:#ffe082">canonical 승격 0건</b> 입니다.</div>' +
          '<div class="nrya-chain-step"><span class="nrya-n nrya-warnn">!</span> 확정값: <b style="color:#ffe082">' + valTxt + '</b> · 변경 파일: ' + filesTxt + '</div>' +
          '<div class="nrya-chain-step"><span class="nrya-n nrya-warnn">!</span> ' + (note || '대상 페이지가 없거나 이미 canonical 이라 승격되지 않았을 수 있습니다. 확인 필요.') + '</div>';
      }
    } else {
      if (st) { st.className = 'nrya-rv-st nrya-done'; st.textContent = '✓ 승인·canonical'; }
      if (chain) {
        chain.classList.remove('nrya-warn-chain');
        chain.innerHTML =
          '<div class="nrya-chain-step"><span class="nrya-n">1</span> review_queue.md 승인 마킹 · 이력 보존(review_approvals.json)</div>' +
          '<div class="nrya-chain-step"><span class="nrya-n">2</span> 확정값: <b style="color:#69f0ae">' + valTxt + '</b> · ⚠REVIEW 플래그 해제</div>' +
          '<div class="nrya-chain-step"><span class="nrya-n">3</span> status → <b style="color:#69f0ae">canonical</b> 승격 ' + promoted + '건 (' + filesTxt + ')</div>' +
          '<div class="nrya-chain-step"><span class="nrya-n">4</span> ' + (note || '임베딩·그래프 인덱스 재빌드 → 챗봇 인용 가능(배치)') + '</div>';
      }
    }
  }

  /** 반려 처리 시: 상태 배지를 '반려'로 바꾸고 액션을 숨긴다. 서버 note 노출. */
  function markRejected(card, data) {
    var st = card.querySelector('.nrya-rv-st');
    if (st) { st.className = 'nrya-rv-st nrya-rej'; st.textContent = '✗ 반려'; }
    var actions = card.querySelector('.nrya-rv-actions');
    if (actions) actions.style.display = 'none';
    var chain = card.querySelector('.nrya-chain');
    if (chain) { chain.classList.add('nrya-warn-chain'); chain.style.display = 'block'; chain.innerHTML = '<div class="nrya-chain-step"><span class="nrya-n nrya-warnn">✗</span> ' + esc(data.note || '반려 처리 · 재검토 큐 유지') + '</div>'; }
  }

  /**
   * 대기/승인 카운트를 서버에서 받아 배지(vswitch·⚠수치검증 서브탭)를 갱신한다.
   * [연계] → GET /api/legal/reviews/stats. 실패는 조용히 무시(배지만 미갱신).
   */
  function refreshStats() {
    legalGet('/api/legal/reviews/stats').then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).then(function (data) {
      if (!data || !data.ok) return;
      statsCache = { total: data.total, pending: data.pending, approved: data.approved };
      var badge = document.getElementById('nryaVbBadge'); if (badge) badge.textContent = String(data.pending);
      var subs = document.querySelectorAll('#nryaSubtabs .nrya-subtab');
      subs.forEach(function (s) { if (s.textContent.indexOf('⚠수치검증') === 0) { var qn = s.querySelector('.nrya-qn'); if (qn) qn.textContent = String(data.pending); } });
    }).catch(function () { /* 무시 */ });
  }

  /**
   * 초안승인·피드백·새지식후보·개정검토 서브탭 배지를 서버 실카운트로 갱신한다.
   * [연계] → GET /api/legal/admin/stats. 실패는 조용히 무시(배지만 미갱신, 기존 표시 유지).
   */
  function refreshAdminStats() {
    legalGet('/api/legal/admin/stats').then(function (res) {
      if (!res.ok) return null;
      return res.json().catch(function () { return null; });
    }).then(function (data) {
      if (!data || !data.ok) return;
      // ⚠2026-09-09: `freshness` 가 빠져 있어 관리자 화면 '원문신선도' 배지에 `undefined` 가
      //   그대로 찍히고 있었다(끝 탭이라 잘려 `undefine` 으로 보였다). 서버는
      //   routes/legal.js:599 에서 정상적으로 보내고 있고 ADMIN_STAT_KEY 도 'freshness' 로
      //   매핑돼 있었다 — 받는 쪽 한 칸만 빠진 것이었다.
      adminStatsCache = { draft: data.draft, feedback: data.feedback, candidates: data.candidates, amendments: data.amendments, freshness: data.freshness };
      renderSubtabs(curAdminSubtab); // 현재 보고 있는 탭을 유지한 채 배지만 최신화
    }).catch(function () { /* 무시 */ });
  }

  // ============================================================================
  // 사용자 챗봇: FAB + 채팅 팝업 + 좌표 지도 팝업 (#nrya-overlays)
  // ============================================================================
  var STEPS = ['생각하고 있습니다', '관련 법령을 찾고 있습니다', '조문 구조를 확인하고 있습니다', '답변을 정리하고 있습니다'];

  var overlaysBuilt = false;

  /**
   * body 에 #nrya-overlays(FAB + 채팅 팝업)를 1회 주입하고 이벤트를 건다.
   * FAB 표시는 updateFabVisibility 가 탭/서버설정으로 게이트한다(초기값 숨김).
   * [연계] → updateFabVisibility, bindChat.
   */
  function ensureOverlays() {
    if (overlaysBuilt) return;
    overlaysBuilt = true;

    var wrap = document.createElement('div');
    wrap.id = 'nrya-overlays';
    wrap.innerHTML =
      '<button class="nrya-fab" id="nryaFab" title="나리야에게 물어보기" style="display:none"><span class="nrya-fab-inner"><img src="' + NARIYA_IMG + '" alt="나리야"><span class="nrya-fab-label">AI 챗봇</span></span><span class="nrya-fab-badge" style="display:none"></span></button>' +
      // 채팅 팝업
      '<div class="nrya-chat-wrap" id="nryaChatWrap">' +
        '<div class="nrya-chat">' +
          '<div class="nrya-chat-top">' +
            '<div class="nrya-ava" id="nryaChatOrb"><img src="' + NARIYA_IMG + '" alt="나리야"></div>' +
            '<div class="nrya-chat-titles"><div class="nrya-chat-name">해양법령 도우미</div></div>' +
            '<div class="nrya-chat-acts">' +
              '<button class="nrya-chat-x nrya-chat-txt nrya-chat-back" id="nryaChatBack" title="채팅창으로 돌아가기" style="display:none">채팅창으로</button>' +
              // [H-37 §7.2] 나에 대해서 설명하기(온디바이스 프로필) — 이 기기에만 저장된다.
              // ②2026-09-09: 톱니(⚙)·시계(🕘) 아이콘을 **글자 버튼**으로 바꿨다 — 사용자 지적
              //   "아이콘만으로는 무엇인지 알 수 없다". 여는 화면·동작은 하나도 안 바뀐다.
              '<button class="nrya-chat-x nrya-chat-txt nrya-chat-prof" id="nryaChatProf" title="나에 대해서 설명하기">내 정보</button>' +
              '<button class="nrya-chat-x nrya-chat-txt nrya-chat-hist" id="nryaChatHist" title="대화 기록">대화이력</button>' +
              '<button class="nrya-chat-x" id="nryaChatX">×</button>' +
            '</div>' +
          '</div>' +
          '<div class="nrya-chat-body" id="nryaChatBody">' +
            // ⑦ 아바타(.nrya-kava)를 뺐다 — 답변 영역을 왼쪽 끝까지 넓게 쓴다(이름 줄은 유지).
            GREETING_HTML +
          '</div>' +
          // 대화 기록(기기 저장) 목록 화면 — 열릴 때만 보이고 그동안 위 대화 영역은 숨는다
          '<div class="nrya-hist" id="nryaHistPanel" style="display:none"></div>' +
          // 프로필(나에 대해서 설명하기) 화면 — 기록 화면과 같은 방식(열릴 때만 보인다)
          '<div class="nrya-hist" id="nryaProfPanel" style="display:none"></div>' +
          '<div class="nrya-chat-input"><button class="nrya-chat-plus" title="첨부">＋</button><input id="nryaChatInput" placeholder="메시지 입력" /><button class="nrya-chat-send" id="nryaChatSend">➤</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    bindChat();
    updateFabVisibility();
    paintBadge();          // 지난 세션에서 못 본 답변이 있으면 FAB 에 숫자로 남아 있다
  }

  // ── FAB 안읽음 뱃지: 채팅창이 닫힌 사이 도착한 답변 수 ──────────────────

  /** 안읽음 카운트를 읽는다(깨졌으면 0). @returns {number} */
  function getUnread() {
    try { return parseInt(localStorage.getItem(LS_UNREAD) || '0', 10) || 0; } catch (_) { return 0; }
  }

  /**
   * 안읽음 카운트를 저장하고 뱃지를 다시 그린다.
   * 예: setUnread(getUnread() + 1) → FAB 우상단에 "1"
   * @param {number} n - 새 카운트(0이면 뱃지 숨김)
   * [연계] ← doSend(닫힌 상태로 답변 도착), openChat(0으로 리셋). → paintBadge
   */
  function setUnread(n) {
    try { localStorage.setItem(LS_UNREAD, String(n)); } catch (_) {}
    paintBadge();
  }

  /** 안읽음 카운트를 FAB 뱃지에 반영한다(0이면 숨김, 100 이상은 '99+'). */
  function paintBadge() {
    var b = document.querySelector('#nrya-overlays .nrya-fab-badge'); if (!b) return;
    var n = getUnread();
    b.textContent = n > 99 ? '99+' : String(n);
    b.style.display = n > 0 ? 'grid' : 'none';
  }

  /** 채팅창이 지금 화면에 떠 있는지(닫혀 있을 때만 안읽음을 센다). @returns {boolean} */
  function isChatOpen() {
    var w = document.getElementById('nryaChatWrap');
    return !!(w && w.classList.contains('nrya-open'));
  }

  /**
   * FAB 표시 여부를 (1) 메인 특보 탭인지 (2) 서버 노출설정이 허용하는지 로 판정해 적용한다.
   * 규칙: 최종표시 = tabIsMain && exposureAllows.
   *   tabIsMain    : body[data-active-tab] === 'weather-group' (없으면 초기값이므로 참으로 취급)
   *   exposureAllows: 'user'→항상 · 'admin'→관리자 모드일 때만 · 'off'→절대 안 됨(기본)
   * [연계] ← boot, body[data-active-tab] 옵저버, storage 이벤트, fetchConfig, setConfig.
   */
  function updateFabVisibility() {
    var fab = document.getElementById('nryaFab'); if (!fab) return;
    var t = null; try { t = document.body.getAttribute('data-active-tab'); } catch (_) {}
    var tabIsMain = (t === null || t === undefined || t === '' || t === MAIN_TAB_GROUP);
    var exposureAllows = (serverExposure === 'user') || (serverExposure === 'admin' && isAdmin());
    fab.style.display = (tabIsMain && exposureAllows) ? 'grid' : 'none';
  }

  // ── 채팅 팝업: 온스크린 키보드 대응(visualViewport) + 하드웨어 백(PopupStack) ──
  var _vvBound = false;

  /** 채팅 메시지 영역을 맨 아래로 스크롤한다. */
  function _scrollChatBottom() { var b = document.getElementById('nryaChatBody'); if (b) b.scrollTop = b.scrollHeight; }

  /**
   * 채팅 카드가 항상 visualViewport(키보드 위 남은 화면) 안에 들어오도록 top/height 를
   * 계산해 고정 크기 플로팅 카드로 유지한다. 키보드가 뜨면 카드가 밀려나는 대신
   * 메시지 영역(flex:1)이 그만큼 줄어든다.
   * [연계] ← _onVV(visualViewport resize/scroll), openChat, 입력창 focus.
   */
  function fitChat() {
    var chat = document.querySelector('#nryaChatWrap .nrya-chat'); if (!chat) return;
    var margin = 28;   // ⚠ ai_chat.css 의 .nrya-chat top(28px)·height(100vh-56px)와 같은 값
    var vv = window.visualViewport;
    if (vv) {
      var h = Math.max(240, vv.height - margin * 2);
      chat.style.height = h + 'px';
      chat.style.top = (vv.offsetTop + margin) + 'px';
    } else {
      chat.style.height = Math.max(240, (window.innerHeight - margin * 2)) + 'px';
      chat.style.top = margin + 'px';
    }
  }

  function _onVV() { fitChat(); }
  function addVV() {
    if (_vvBound) return; _vvBound = true;
    if (window.visualViewport) { window.visualViewport.addEventListener('resize', _onVV); window.visualViewport.addEventListener('scroll', _onVV); }
    window.addEventListener('resize', _onVV);
  }
  function removeVV() {
    if (!_vvBound) return; _vvBound = false;
    if (window.visualViewport) { window.visualViewport.removeEventListener('resize', _onVV); window.visualViewport.removeEventListener('scroll', _onVV); }
    window.removeEventListener('resize', _onVV);
  }

  /**
   * 채팅 팝업을 연다: 뷰포트에 맞춰 크기 조정 + visualViewport 리스너 등록 +
   * 하드웨어 백 스택 등록(PopupStack) + 입력창 포커스 + 안읽음 뱃지 리셋.
   * [연계] → PopupStack.push('nrya-chat', closeChat), setUnread(0).
   */
  function openChat() {
    ensureOverlays();
    var wrap = document.getElementById('nryaChatWrap'); if (!wrap) return;
    resetToHome();                // 다시 열면 늘 인사말 한 줄짜리 홈부터 (2026-09-10 사용자 지적)
    startConversation();          // ⑥ 이번에 연 창이 "한 대화"의 시작이다(기록을 이 단위로 묶는다)
    wrap.classList.add('nrya-open');
    ensureAliases();              // 답변 본문의 「약칭」을 정식명으로 맞춰볼 표를 미리 받아둔다
    setUnread(0);                 // 열어서 보는 순간 안읽음 해제
    fitChat(); addVV(); _scrollChatBottom();
    var input = document.getElementById('nryaChatInput'); if (input) setTimeout(function () { input.focus(); }, 80);
    if (window.PopupStack) window.PopupStack.push('nrya-chat', closeChat);
  }

  /** 채팅 팝업을 닫는다(백스택에서 제거 + 리스너 해제). PopupStack.remove 는 멱등. */
  function closeChat() {
    if (window.PopupStack) window.PopupStack.remove('nrya-chat');
    var wrap = document.getElementById('nryaChatWrap'); if (wrap) wrap.classList.remove('nrya-open');
    removeVV();
    // 답이 오기 전에 채팅창을 닫으면 동의배너 타이머도 취소한다 — 안 보는 사이 뜬금없이 뜨지 않게.
    if (activeConsentTimer) { clearTimeout(activeConsentTimer); activeConsentTimer = null; }
    chatConvEnded = true; // ⑥ 이 대화는 여기서 끝 — 다음에 열 때 startConversation 이 새 번호를 딴다
    closeHistory(true);   // 기록 화면을 켜둔 채 닫았어도 다음에 열면 평소 대화 화면부터
    closeProf();          // 내 정보 화면도 마찬가지 — 켜둔 채 닫으면 다음에 그 화면이 그대로 떴다
    histRestorePoint = null;  // 되돌리기 지점도 버린다 — 다음에 열면 홈부터 새로 시작한다
  }

  /**
   * 채팅창을 **처음 연 상태(홈)** 로 되돌린다 — 인사말 한 줄만 남기고 지난 대화 내용을 지운다.
   * 2026-09-10 사용자 지적: *"채팅을 보았다가 해당 창을 끄고 다시 챗봇을 들어오면 홈이 나오도록
   * 하고 싶은데 계속 직전 화면이 표시됨."* 종전에는 채팅 영역의 DOM 이 그대로 남아 있어서, 창을
   * 닫았다 열면 지난 대화가 끝까지 스크롤된 채 다시 보였다.
   *
   * ★지우는 것은 **화면뿐**이다 — 주고받은 질문·답변은 기기에 저장돼 있어(pushHistory) 헤더
   *   [대화이력]에서 그대로 다시 볼 수 있다.
   *
   * 두 경우에는 **지우지 않는다**(지우면 사용자가 볼 것을 잃는다):
   *   ①안읽음이 남아 있을 때 — 창을 닫아둔 사이 도착한 답변이 화면에 그려져 있고, FAB 뱃지가
   *     그것을 보라고 알린 상태다.
   *   ②답을 기다리는 중일 때 — 보낸 질문의 답변 말풍선이 아직 채워지는 중이라, 여기서 비우면
   *     그 말풍선이 화면에서 떨어져 나가 답이 도착해도 보이지 않는다.
   * [연계] ← openChat. → forgetChatMemory(이어 묻기 맥락도 함께 끊는다).
   */
  function resetToHome() {
    if (getUnread() > 0 || chatPending > 0) return;
    var body = document.getElementById('nryaChatBody');
    if (body) { body.innerHTML = GREETING_HTML; body.scrollTop = 0; }
    forgetChatMemory();
    lastCtx = null; pendingCtx = null;
    setChatPlaceholder(false);   // 홈의 입력창 안내문은 '메시지 입력'
  }

  // ── 대화 기록(기기 저장): 헤더 🕘 → 날짜별 목록 → 누르면 그 질문/답변을 말풍선으로 ──────
  //    저장은 doSend 가 **진짜 최종 답변**을 받은 순간에만 한다(되묻기·오류는 저장 안 함).
  //    근거 법령(sources·citationChain·forms)도 **받았던 그대로** 저장한다(2026-08-18 사용자 확정 —
  //    예전엔 용량을 아끼려 질문·답변 글자만 저장했는데, 지난 대화를 다시 열면 근거 아코디언·서식
  //    버튼이 통째로 사라지는 게 더 나쁘다는 실사용 지적으로 저장 대상을 넓혔다). HISTORY_MAX=200건
  //    기준 늘어나는 용량은 수백 KB 안팎으로 추정(로컬 저장 한도 대비 미미).

  // ── ⑥ 대화 단위 묶기(2026-09-09 사용자 지적) ──────────────────────────────────
  //   증상: 9월 7일에 **한 대화창에서 이어서 물은 것**이 목록에 4줄로 나뉘어 떠 연속성이 안 보였다.
  //   원인: pushHistory 가 질문 하나·답변 하나를 한 건으로 저장하고, 목록도 그 건마다 한 줄이었다.
  //   고침: 채팅창을 연 순간부터 닫을 때까지를 **한 대화(cid)** 로 보고, 그 대화 안의 질문들을
  //         한 줄로 묶어 보여준다. 줄을 누르면 그 대화에서 오간 것을 순서대로 이어 붙인다.
  //   ⚠기존에 기기에 쌓인 옛 기록에는 cid 가 없다 — **지우지 않는다.** cid 없는 건은 예전처럼
  //     날짜로 묶어(그날 = 한 묶음) 보여준다. 저장 파일은 손대지 않고 읽는 쪽만 바뀐다.
  var chatConvId = null;        // 지금 진행 중인 대화의 식별자(메모리에만 — 새로고침하면 새 대화)
  var chatConvEnded = false;    // 창을 닫았나(닫힌 뒤 도착한 늦은 답변은 **그 대화에** 남긴다)

  /**
   * 채팅창을 열 때 부른다 — 이번에 연 것이 새 대화면 새 번호를 딴다.
   * 예: 처음 열면 'c1757...' 발급 · 닫았다 다시 열면 새 번호 · 안 닫고 계속 쓰면 같은 번호
   * [연계] ← openChat. → pushHistory(저장할 때 이 번호를 함께 남긴다).
   */
  function startConversation() {
    if (chatConvId && !chatConvEnded) return;   // 안 닫고 계속 쓰는 중이면 같은 대화다
    chatConvId = 'c' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    chatConvEnded = false;
  }

  /**
   * 저장된 대화 기록을 배열로 읽는다(없거나 깨졌으면 빈 배열 — 절대 예외를 던지지 않는다).
   * @returns {Array<{q:string,a:string,note:string,sources:Array,chain:Array,forms:Array,cid:string,ts:number}>} 오래된 것부터
   */
  function loadHistory() {
    try {
      var raw = localStorage.getItem(LS_HISTORY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) { return []; }
  }

  /**
   * 질문/답변 한 쌍을 기록에 덧붙인다(상한 초과분은 오래된 것부터 버린다).
   * 예: pushHistory('5톤 낚시어선 야간조업?', {answer:'…', note:'…', citationChain:[…], forms:[…]})
   * @param {string} q - 사용자 질문
   * @param {object} data - done 응답({answer, note, sources, citationChain, forms})
   * [연계] ← doSend 의 최종 렌더 직후(되묻기·오류 제외). → openHistory 목록, openHistoryGroup.
   */
  function pushHistory(q, data) {
    try {
      var arr = loadHistory();
      arr.push({
        q: String(q || ''), a: String((data && data.answer) || ''), note: String((data && data.note) || ''),
        sources: (data && data.sources) || [], chain: (data && data.citationChain) || [], forms: (data && data.forms) || [],
        citeLaws: (data && data.citeLaws) || [],
        // ★2026-08-18: 대화 맥락도 함께 남긴다 — 없으면 기록에서 다시 연 답변의 "🔁 관련해서 더
        //   궁금해요"가 빈손이 되어, 이어 물으면 주제가 안 실린다(푸시 복원과 같은 결함).
        ctxNext: (data && data.ctxNext) || null,
        // ⑥ 이 질문이 **어느 대화**에서 나왔는지. 창을 닫기 전까지는 같은 값이라, 목록에서 한 줄로 묶인다.
        //   ⚠늦게 도착한 답변(창을 닫은 뒤 도착)도 그 대화 번호를 그대로 쓴다 — 그래야 원래
        //     묻던 흐름에 남는다. 새 번호는 **다음에 창을 열 때** startConversation 이 딴다.
        cid: chatConvId || '',
        ts: Date.now(),
      });
      if (arr.length > HISTORY_MAX) arr = arr.slice(arr.length - HISTORY_MAX);
      localStorage.setItem(LS_HISTORY, JSON.stringify(arr));
    } catch (_) { /* 저장 불가(시크릿 모드·용량 초과)여도 대화는 계속돼야 한다 */ }
  }

  /** 기록 목록의 날짜 머리글 문구. 예: '오늘' · '어제' · '2026. 8. 1.' @param {number} ts @returns {string} */
  function histDayLabel(ts) {
    var d = new Date(ts), now = new Date();
    var d0 = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var n0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var diff = Math.round((n0 - d0) / 86400000);
    if (diff <= 0) return '오늘';
    if (diff === 1) return '어제';
    return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.';
  }

  /** 기록 항목 오른쪽의 상대 시각. 예: '방금' · '12분 전' · '3시간 전' · '5일 전' @param {number} ts @returns {string} */
  function histTimeLabel(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return '방금';
    if (s < 3600) return Math.floor(s / 60) + '분 전';
    if (s < 86400) return Math.floor(s / 3600) + '시간 전';
    return Math.floor(s / 86400) + '일 전';
  }

  /** 한 기록 건이 속한 **묶음 열쇠**. cid 가 있으면 그 대화, 없는 옛 기록은 그 날짜로 묶는다.
   * 예: {cid:'c17…'} → 'c:c17…' · cid 없는 2026-09-07 건 → 'd:2026-9-7'
   * @param {object} e - loadHistory() 원소 @returns {string}
   * [연계] ← historyGroups. ⚠옛 기록에 cid 를 **써 넣지 않는다**(기록 파일은 읽기만 한다).
   */
  function histGroupKey(e) {
    if (e && e.cid) return 'c:' + e.cid;
    var d = new Date((e && e.ts) || 0);
    return 'd:' + d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  /**
   * 저장된 기록을 **대화 단위**로 묶어 최신 대화부터 돌려준다(대화 안은 물어본 순서 그대로).
   * 예: 9월 7일 한 창에서 4번 이어 물었으면 → 묶음 1개(items 4개)
   * @returns {Array<{key:string, items:Array, ts:number}>} ts 는 그 대화의 마지막 질문 시각
   * [연계] ← historyListHTML(목록 한 줄 = 묶음 하나) · openHistoryGroup(누르면 items 를 순서대로 되살린다).
   */
  function historyGroups() {
    var list = loadHistory(), map = {}, order = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i] || {}, k = histGroupKey(e);
      if (!map[k]) { map[k] = { key: k, items: [], ts: 0 }; order.push(map[k]); }
      map[k].items.push(e);
      if ((e.ts || 0) > map[k].ts) map[k].ts = e.ts || 0;
    }
    // 최신 대화가 위로. ⚠나온 순서를 뒤집는 게 아니라 **시각으로** 정렬한다 — 창을 닫은 뒤
    //   늦게 도착한 답변이 옛 대화에 붙으면(pushHistory 주석) 그 대화가 목록에서 다시 위로
    //   올라와야 하는데, 뒤집기만 하면 저장 순서에 눌려 엉뚱한 자리에 남는다.
    order.sort(function (a, b) { return b.ts - a.ts; });
    return order;
  }

  /**
   * 기록 목록 HTML(최신 → 과거, 날짜 머리글로 묶음)을 만든다. 질문이 길면 CSS 로 말줄임한다.
   * ⑥한 줄 = **한 대화**다(예전엔 한 줄 = 질문 하나여서 이어 물은 대화가 여러 줄로 쪼개져 보였다).
   * 줄에 적는 질문은 그 대화의 **첫 질문**이고, 질문이 둘 이상이면 개수를 알약으로 덧붙인다.
   * @returns {string} HTML(기록이 없으면 안내 문구)
   */
  function historyListHTML() {
    var groups = historyGroups();
    if (!groups.length) {
      return '<div class="nrya-hist-empty">아직 저장된 대화가 없어요.<br>질문하고 답변을 받으면 여기에 쌓입니다.</div>';
    }
    var html = '', lastDay = '';
    for (var i = 0; i < groups.length; i++) {
      // e = 그 대화의 **첫 기록 건**(줄 제목에 쓴다). ⚠이름을 바꾸지 말 것 — 회귀 스위트
      //   test_ask_context 가 `splitAskedQuery(e.q).question` 을 글자 그대로 잠가 두었다.
      var g = groups[i], e = g.items[0] || {};
      var day = histDayLabel(g.ts);
      if (day !== lastDay) { lastDay = day; html += '<div class="nrya-hist-day">' + esc(day) + '</div>'; }
      html += '<button type="button" class="nrya-hist-item" data-g="' + esc(g.key) + '">' +
        '<span class="nrya-hist-q">' + esc(splitAskedQuery(e.q).question || '(질문 없음)') + '</span>' +
        (g.items.length > 1 ? '<span class="nrya-hist-n">질문 ' + g.items.length + '개</span>' : '') +
        '<span class="nrya-hist-t">' + esc(histTimeLabel(g.ts)) + '</span>' +
      '</button>';
    }
    return html;
  }

  /**
   * 헤더 오른쪽 버튼을 하위화면 모드/홈 모드로 바꾼다. ✕ 는 항상 그대로 둔다.
   * 하위화면(내 정보·대화이력)에서는 [내 정보]·[대화이력]을 **둘 다 감추고** [채팅창으로]만 남긴다
   * — 2026-09-10 사용자 지적: "누른 상태에서는 내정보 버튼이나 내역 버튼이 나오지 않도록 해줘."
   * (종전에는 누른 그 버튼만 감춰서, 대화이력을 보는 중에도 [내 정보]가 [채팅창으로] 바로 옆에
   *  남아 잘못 눌리기 쉬웠다.)
   * @param {boolean} backMode - true 면 [채팅창으로]만, false 면 [내 정보]·[대화이력]만 보인다
   */
  function setHistHeader(backMode) {
    var pb = document.getElementById('nryaChatProf'); if (pb) pb.style.display = backMode ? 'none' : '';
    var hb = document.getElementById('nryaChatHist'); if (hb) hb.style.display = backMode ? 'none' : '';
    var bb = document.getElementById('nryaChatBack'); if (bb) bb.style.display = backMode ? '' : 'none';
  }

  /** 기록 목록 화면이 지금 떠 있는지. @returns {boolean} */
  function isHistoryOpen() {
    var p = document.getElementById('nryaHistPanel');
    return !!(p && p.style.display !== 'none');
  }

  /**
   * 기록 목록 화면을 연다(대화 영역을 숨기고 목록 패널을 채운다 — 대화 DOM 은 그대로 남는다).
   * [연계] ← 헤더 🕘 버튼, onHistBack(지난 답변을 본 뒤 다시 목록으로).
   */
  function openHistory() {
    var panel = document.getElementById('nryaHistPanel'); if (!panel) return;
    panel.innerHTML = historyListHTML();
    panel.style.display = 'block';
    panel.scrollTop = 0;
    var body = document.getElementById('nryaChatBody'); if (body) body.style.display = 'none';
    setHistHeader(true);
  }

  /**
   * 기록 목록을 닫고 대화 화면으로 되돌린다.
   * @param {boolean} hideBack - true 면 헤더도 평소(🕘)로. 지난 답변을 펼친 직후엔 false 로 두어
   *                             ‹ 로 목록에 다시 갈 수 있게 남긴다.
   */
  function closeHistory(hideBack) {
    var panel = document.getElementById('nryaHistPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    var body = document.getElementById('nryaChatBody'); if (body) body.style.display = '';
    if (hideBack) setHistHeader(false);
    _scrollChatBottom();
  }

  /**
   * 헤더 [채팅창으로] 버튼: 어느 하위화면에 있든 **채팅창으로 되돌린다.**
   * 2026-09-10 사용자 지적으로 동작을 하나로 통일했다 — 종전에는 지난 대화를 펼친 뒤 누르면
   * 목록으로 되돌아가(openHistory) 채팅창으로 못 가는 길이 있었다.
   */
  function onHistBack() {
    if (isProfOpen()) closeProf();
    if (isHistoryOpen()) closeHistory(true);
    else setHistHeader(false);
    restoreFromHistory();   // 지난 대화를 펼쳐 뒀다면 펼치기 직전 상태로 되돌린다
  }

  /**
   * 지난 대화를 채팅창에 붙이기 **직전**의 상태로 되돌린다(붙인 적이 없으면 아무것도 안 한다).
   * 2026-09-10 사용자 지적으로 넣었다 — *"채팅창으로를 눌러도 초기화된 화면이 아니라 기존
   * 화면에서 위 버튼만 바뀌는데?"* 종전에는 헤더만 바뀌고 붙인 대화가 그대로 남았다.
   * 되돌린 뒤에도 그 대화는 기기에 저장돼 있어 [대화이력]에서 언제든 다시 볼 수 있다.
   * [연계] ← onHistBack · closeChat. → openHistoryGroup(여기서 되돌릴 자리를 찍는다).
   */
  function restoreFromHistory() {
    if (histRestorePoint === null) return;
    var body = document.getElementById('nryaChatBody');
    if (body) { body.innerHTML = histRestorePoint; _scrollChatBottom(); }
    histRestorePoint = null;
  }

  // ── [H-37 §7] 나에 대해서 설명하기(온디바이스 프로필) ─────────────────────────
  //   사용자 확정 (바): "카테고리별로 하나 선택하면 그 선택한 것을 기반으로 또 선택할 수 있도록
  //   버튼을 만들어 두면 사용자가 타이핑 칠 필요 없이 바로바로 내용이 기록되는거지. 물론 온디바이스에만
  //   저장되어야 하고 또한 선택 마지막에는 직접 관심분야 등 타이핑해서 넣을 수 있도록"
  //   ★저장 위치는 이 기기의 localStorage 뿐이다. 서버로는 질문할 때 스냅샷이 함께 가지만, 서버는
  //     그 요청을 처리하는 동안만 메모리에서 읽고 **어떤 파일에도 쓰지 않는다**(설계 §3.3 R1).
  //   ★버튼 라벨의 출처: `_CHATBOT.md` §1의 프로필 필드표(직군·선박용도·어업종류·면허·야간조업)와
  //     `_dashboard/zone_tree.json`의 조업해역 트리 라벨(특정해역·조업자제해역·일반해역·해외수역).
  //     **지어낸 값이 없다** — 라벨이 자산·문서와 문자 그대로 같아야 서버의 축 대조(완전일치/포함)가
  //     성립한다(설계 §7.4.2).
  //   ⚠톤수·길이는 버튼이 아니라 숫자 입력이다 — `tonnage_facet.json`의 임계값은 **법마다 다른**
  //     경계라 하나의 공통 구간표가 없고, 그걸 클라이언트에 상수로 박으면 자산이 바뀔 때 화면이
  //     거짓말을 한다(L-81 "데이터의 범위를 코드가 산문으로 단언하지 말 것"). → 설계 대비 변경점.
  // ── ⑤ 어업 종류 목록(2026-09-09) ─────────────────────────────────────────────
  //   예전에는 칩 4개('연안자망'·'근해통발'·'양식'·'그 밖')뿐이라 실제로 하는 어업을 고를 수 없었다
  //   (사용자 지적). 아래 목록은 **전부 우리 raw 원문에서 그대로 옮긴 것이고, 지어낸 이름이 없다.**
  //   가져온 자리(법령명·조문·시행일)는 다음과 같다 — 값이 라벨과 글자까지 같아야 서버의 축 대조가
  //   성립하므로(설계 §7.4.2 · legal_retriever.js profileConfirmStep 은 **완전일치**만 본다) 원문 표기를
  //   한 글자도 고치지 않았다.
  //     · 면허어업  : raw/05_수산어업/수산업법/시행령.txt 제6조(정치망어업 3종, 2026-07-01 시행) +
  //                   수산업법 법률.txt 제7조제1항제2호(마을어업, 2026-04-23 시행)
  //     · 근해어업  : 같은 시행령 제21조제1항 1~21호 (21종)
  //     · 연안어업  : 같은 시행령 제22조제1항 1~8호 (8종). 8호 '연안복합어업'의 가~마목
  //                   (낚시어업·문어단지어업·손꽁치어업·패류껍질어업·패류미끼망어업)도 같은 묶음에 넣었다
  //     · 구획어업  : 같은 시행령 제23조제1항 1~12호 (12종)
  //     · 신고어업  : 같은 시행령 제26조제1항 1~2호 (나잠어업·맨손어업)
  //     · 양식업    : raw/05_수산어업/양식산업발전법/법률.txt 제10조제1항(면허 7종) ·
  //                   제43조제1항(허가 2종, 2025-01-24 시행)
  //   ⚠못 담은 갈래(정직 기록): ①한시어업(수산업법 제43조)은 그때그때 시·도지사가 정하는 것이라
  //     원문에 **종류 목록 자체가 없다** ②시험·연구·교습어업(제46조)도 마찬가지다 ③내수면어업법의
  //     내수면 어업 종류는 이 앱(바다)의 범위 밖이라 넣지 않았다. 이 셋은 아래 "직접 입력"으로 적는다.
  var FISHERY_TYPES = [
    { g: '면허어업 (수산업법 제7조)', opts: ['대형정치망어업', '중형정치망어업', '소형정치망어업', '마을어업'] },
    { g: '허가어업 — 근해어업 (시행령 제21조)', opts: [
      '외끌이대형저인망어업', '쌍끌이대형저인망어업', '동해구외끌이중형저인망어업', '서남해구외끌이중형저인망어업',
      '서남해구쌍끌이중형저인망어업', '대형트롤어업', '동해구중형트롤어업', '대형선망어업', '소형선망어업',
      '근해채낚기어업', '근해자망어업', '근해안강망어업', '근해봉수망어업', '근해자리돔들망어업',
      '근해장어통발어업', '근해문어단지어업', '근해통발어업', '근해연승어업', '근해형망어업',
      '기선권현망어업', '잠수기어업'] },
    { g: '허가어업 — 연안어업 (시행령 제22조)', opts: [
      '연안개량안강망어업', '연안선망어업', '연안통발어업', '연안조망어업', '연안선인망어업',
      '연안자망어업', '연안들망어업', '연안복합어업',
      '낚시어업', '문어단지어업', '손꽁치어업', '패류껍질어업', '패류미끼망어업'] },
    { g: '허가어업 — 구획어업 (시행령 제23조)', opts: [
      '건간망어업', '건망어업', '들망어업', '선인망어업', '승망류어업', '안강망어업', '장망류어업',
      '지인망어업', '해선망어업', '새우조망어업', '실뱀장어안강망어업', '패류형망어업'] },
    { g: '신고어업 (시행령 제26조)', opts: ['나잠어업', '맨손어업'] },
    { g: '양식업 — 면허 (양식산업발전법 제10조)', opts: [
      '해조류양식업', '패류양식업', '어류등양식업', '복합양식업', '협동양식업', '외해양식업', '내수면양식업'] },
    { g: '양식업 — 허가 (양식산업발전법 제43조)', opts: ['육상해수양식업', '육상등 내수양식업'] },
  ];

  var PROFILE_MENU = [
    { k: '직군', opts: ['어업인', '비어업인', '해양종사자', '공무원', '그 밖'] },
    { k: '선박용도', opts: ['낚시어선', '어선', '레저', '일반'] },
    // ④톤수·길이는 한 줄에 나란히 놓고 단위를 칸 오른쪽에 붙인다(2026-09-09 사용자 확정).
    //   저장값에는 예전 그대로 우리말 단위를 붙인다("9.77" → "9.77톤") — 서버로 가는 값의 모양이
    //   바뀌면 안 되기 때문이다. 화면에 보이는 단위(t·m)와 저장 단위(톤·미터)는 일부러 다르다.
    { pair: [
      { k: '톤수', unit: 't', suffix: '톤', ph: '예: 9.77' },
      { k: '길이', unit: 'm', suffix: '미터', ph: '예: 12' },
    ] },
    // ⑤칩 4개 → 글자를 치면 걸러지는 드롭다운(FISHERY_TYPES). 목록에 없는 것도 직접 적어 저장할 수 있다.
    { k: '어업종류', search: FISHERY_TYPES },
    { k: '면허·자격', opts: ['소형선박조종사', '해기사', '없음'] },
    { k: '주 조업구역', opts: ['특정해역', '조업자제해역', '일반해역', '해외수역'] },
    { k: '야간조업', opts: ['예', '아니오'] },
    { k: '관심분야', input: '자유롭게 적어주세요(예: 야간조업 안전장비)' },
  ];

  /**
   * 기기에 저장된 프로필을 읽는다(없거나 깨졌으면 빈 것 — 예외를 던지지 않는다).
   * @returns {{version:number, fields:Object<string,{v:string,at:string}>}}
   * [연계] ← doSend(요청에 스냅샷 첨부) · renderProfPanel.
   */
  function loadProfile() {
    try {
      var o = JSON.parse(localStorage.getItem(LS_PROFILE) || '{}');
      if (!o || typeof o !== 'object' || !o.fields) return { version: 1, fields: {} };
      return { version: 1, fields: o.fields };
    } catch (_) { return { version: 1, fields: {} }; }
  }

  /** 프로필 한 필드를 저장(값이 빈 문자열이면 그 필드만 지운다) + 저장 시각(KST ISO)을 함께 남긴다. */
  function saveProfileField(key, value) {
    try {
      var p = loadProfile();
      if (value) p.fields[key] = { v: String(value).slice(0, 40), at: kstIso() };
      else delete p.fields[key];
      localStorage.setItem(LS_PROFILE, JSON.stringify({ version: 1, fields: p.fields }));
    } catch (_) { /* 저장 불가(시크릿 모드 등)여도 대화는 계속돼야 한다 */ }
  }

  /** 지금 시각을 KST(+09:00) ISO 문자열로. 프로필 `at`(신선도 표시)에 쓴다. */
  function kstIso() {
    var d = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
    return d.slice(0, 19) + '+09:00';
  }

  /**
   * 입력창 안내문(placeholder)을 바꾼다 — 확인 카드가 떠 있는 동안 "버튼을 고르거나 새로 질문"임을
   * 알린다(설계 §9.1 #14: 자유 입력은 **언제나 새 질문**이라는 동작 자체는 바꾸지 않는다).
   * @param {boolean} waiting - true면 안내 문구, false면 평소 문구
   */
  function setChatPlaceholder(waiting) {
    var el = document.getElementById('nryaChatInput'); if (!el) return;
    el.placeholder = waiting ? '어떤 상황인지 조금 더 구체적으로 적어주세요' : '메시지 입력';
  }

  /** 프로필 화면이 지금 떠 있는지. @returns {boolean} */
  function isProfOpen() {
    var p = document.getElementById('nryaProfPanel');
    return !!(p && p.style.display !== 'none');
  }

  /**
   * 프로필 항목 하나의 머리글 줄("직군  현재: 어업인 (2026-09-09 저장)")을 만든다.
   * 예: profLabelHTML('톤수', {v:'9.77톤', at:'2026-09-09T…'}) → '<div …>톤수 <span …>현재: 9.77톤 …</span></div>'
   * @param {string} k - 항목 이름 @param {object} [cur] - 저장된 값 {v, at}
   * @returns {string} HTML
   * [연계] ← profPanelHTML(세 갈래 — 칩·숫자쌍·검색 — 이 같은 머리글을 쓴다).
   *          `nrya-prof-cur` 는 ④ 숫자칸이 화면을 다시 그리지 않고 이 자리만 갱신할 때 쓴다.
   */
  function profLabelHTML(k, cur) {
    return '<div class="nrya-hist-day">' + esc(k) +
      ' <span class="nrya-hist-t nrya-prof-cur" data-k="' + esc(k) + '">' + esc(profCurText(cur)) + '</span></div>';
  }

  /** 머리글에 적을 "현재: …" 문구(저장값이 없으면 빈 문자열). @param {object} [cur] @returns {string} */
  function profCurText(cur) {
    if (!cur || !cur.v) return '';
    return '현재: ' + cur.v + (cur.at ? ' (' + String(cur.at).slice(0, 10) + ' 저장)' : '');
  }

  /**
   * ④ 톤수·길이 두 칸을 한 줄에 그린다(단위는 칸 오른쪽). [저장] 버튼은 두지 않는다.
   * 예: profPairHTML(PROFILE_MENU[2], loadProfile()) → '톤수 [9.77] t | 길이 [12] m'
   * @param {object} m - PROFILE_MENU 의 { pair:[{k,unit,suffix,ph}, …] } 항목
   * @param {object} p - loadProfile() 결과
   * @returns {string} HTML
   * [연계] ← profPanelHTML. → bindChat 의 nrya-prof-num 입력/blur 처리(숫자만 + 손 떼면 저장).
   *   ⚠[저장] 버튼을 없앤 이유: 한 줄에 칸 둘·단위 둘·버튼 둘은 360px 화면에 들어가지 않는다.
   *     그리고 이 패널의 다른 항목(칩)은 이미 **누르는 즉시** 저장한다 — 숫자칸만 버튼을 요구하면
   *     같은 화면 안에서 저장 방식이 둘로 갈린다. 그래서 "칸에서 손을 떼면 저장"으로 맞췄다.
   */
  function profPairHTML(m, p) {
    var cells = m.pair.map(function (f) {
      var cur = p.fields[f.k];
      // 저장값에는 우리말 단위가 붙어 있다("9.77톤") — 칸에는 숫자만 되돌려 놓는다.
      var num = String((cur && cur.v) || '').replace(f.suffix, '');
      return '<div class="nrya-prof-cell">' + profLabelHTML(f.k, cur) +
        '<div class="nrya-prof-numrow">' +
          // data-init = 그릴 때 넣은 값. blur 저장이 **손댔을 때만** 일어나게 하는 표식이다
          // (아래 saveProfNum 주석 참고 — 안 그러면 그냥 눌렀다 뗀 것만으로 값이 지워진다).
          '<input class="nrya-prof-num" inputmode="decimal" data-k="' + esc(f.k) + '" data-suffix="' + esc(f.suffix) + '"' +
            ' data-init="' + esc(num) + '" placeholder="' + esc(f.ph) + '" value="' + esc(num) + '">' +
          '<span class="nrya-prof-unit">' + esc(f.unit) + '</span>' +
        '</div></div>';
    }).join('');
    return '<div class="nrya-prof-pair">' + cells + '</div>';
  }

  /**
   * ⑤ 어업종류 — 글자를 치면 걸러지는 드롭다운을 그린다(목록은 FISHERY_TYPES = 법령 원문).
   * 예: '통발' 이라고 치면 근해통발어업·근해장어통발어업·연안통발어업만 남는다
   * @param {object} m - PROFILE_MENU 의 { k, search:[{g,opts}] } 항목
   * @param {object} [cur] - 저장된 값 {v, at}
   * @returns {string} HTML
   * [연계] ← profPanelHTML. → bindChat 의 nrya-prof-search 입력 처리(filterProfList) ·
   *          nrya-prof-opt 클릭(그 값으로 저장).
   *   ⚠목록에 없는 것도 그대로 저장할 수 있게 뒀다(맨 아래 "직접 입력"). 이유 두 가지 —
   *     ①한시어업·시험어업·내수면 어업처럼 **원문에 종류 목록 자체가 없는** 갈래가 실제로 있다.
   *     ②서버는 프로필 값이 되묻기 선택지 라벨과 **글자까지 같을 때만** 그 축을 쓴다
   *       (legal_retriever.js profileConfirmStep). 목록 밖 값은 그 대조에 안 걸릴 뿐이고,
   *       걸리지 않으면 평소대로 되묻는다 — 막는 것보다 안전하다.
   */
  function profSearchHTML(m, cur) {
    var curV = (cur && cur.v) || '';
    var rows = m.search.map(function (grp) {
      return '<div class="nrya-prof-grp" data-grp="1">' + esc(grp.g) + '</div>' +
        grp.opts.map(function (o) {
          return '<button type="button" class="nrya-prof-opt nrya-prof-pick' + (o === curV ? ' nrya-prof-cur-opt' : '') +
            '" data-k="' + esc(m.k) + '" data-v="' + esc(o) + '">' + esc(o) + '</button>';
        }).join('');
    }).join('');
    return '<input class="nrya-prof-search" data-k="' + esc(m.k) + '" placeholder="어업 이름을 치면 걸러져요(예: 통발)">' +
      '<div class="nrya-prof-list">' + rows +
        '<div class="nrya-prof-none" hidden>목록에 없어요. 아래 “직접 입력”으로 그대로 저장할 수 있어요.</div>' +
        '<button type="button" class="nrya-prof-opt nrya-prof-free" data-k="' + esc(m.k) + '" hidden></button>' +
      '</div>' +
      (curV ? '<div class="nrya-consent-btns nrya-prof-row"><button type="button" class="nrya-consent-btn nrya-prof-btn"' +
        ' data-k="' + esc(m.k) + '" data-v="">이 항목 지우기</button></div>' : '');
  }

  /** 프로필 화면 HTML(저장된 값 + 카테고리별 버튼/입력). @returns {string} */
  function profPanelHTML() {
    var p = loadProfile();
    var h = '<div class="nrya-hist-day">나에 대해서 설명하기</div>' +
      '<div class="nrya-disc">여기 적은 내용은 <b>이 기기에만</b> 저장돼요. 답이 조건에 따라 갈릴 때 ' +
      '나리야가 "저장된 정보로 답할까요?"라고 먼저 확인해요.</div>';
    PROFILE_MENU.forEach(function (m, mi) {
      if (m.pair) { h += profPairHTML(m, p); return; }          // ④ 톤수·길이(한 줄·숫자만)
      var cur = p.fields[m.k];
      h += profLabelHTML(m.k, cur);
      if (m.search) { h += profSearchHTML(m, cur); return; }     // ⑤ 어업종류(검색 드롭다운)
      // ③ 칩 줄. nrya-prof-row 가 붙어야 글자가 접히는 대신 **버튼째** 다음 줄로 넘어간다(CSS 참고).
      h += '<div class="nrya-consent-btns nrya-prof-row">';
      if (m.opts) {
        h += m.opts.map(function (o) {
          return '<button type="button" class="nrya-consent-btn nrya-prof-btn" data-k="' + esc(m.k) + '" data-v="' + esc(o) + '">' + esc(o) + '</button>';
        }).join('');
      } else {
        h += '<input class="nrya-fb-reason-in nrya-prof-in" id="nryaProfIn' + mi + '" placeholder="' + esc(m.input) + '" value="' + esc(cur ? cur.v : '') + '">' +
          '<button type="button" class="nrya-consent-btn nrya-prof-save" data-k="' + esc(m.k) + '" data-in="nryaProfIn' + mi + '"' +
          (m.suffix ? ' data-suffix="' + esc(m.suffix) + '"' : '') + '>저장</button>';
      }
      if (cur) h += '<button type="button" class="nrya-consent-btn nrya-prof-btn" data-k="' + esc(m.k) + '" data-v="">이 항목 지우기</button>';
      h += '</div>';
    });
    h += '<div class="nrya-consent-btns nrya-prof-row"><button type="button" class="nrya-consent-btn nrya-prof-reset">전체 초기화</button></div>';
    return h;
  }

  /** ③ 칩 자간을 좁혀 볼 단계(사용자 표현 "자간 -10" = 최대 -0.10em). 왼쪽이 평소 자간이다. */
  var PROF_CHIP_TRACKING = ['', '-0.02em', '-0.04em', '-0.06em', '-0.08em', '-0.10em'];

  /**
   * ③ 칩 줄("어업인"·"비어업인"…)의 자간을 **필요한 만큼만** 좁힌다(최대 -0.10em).
   * 예: 어떤 줄이 평소 자간이면 3줄인데 -0.06em 이면 2줄로 줄어든다 → -0.06em 을 고른다.
   *     원래 한 줄에 들어가는 줄(면허·자격 칩 3개 등)은 아무것도 안 건드린다(빈 문자열 = 평소 자간).
   *     좁혀도 줄 수가 그대로면 역시 평소 자간을 남긴다(아래 [실측 기록] 참고).
   * @param {HTMLElement} root - 프로필 패널(#nryaProfPanel)
   * @returns {void}
   * [연계] ← openProf(패널을 그린 직후 — 화면에 붙은 뒤라야 높이를 잴 수 있다).
   *          CSS 의 .nrya-prof-row(flex-wrap)·.nrya-prof-btn(nowrap)과 한 몸이다.
   *   [고른 방법] "한 줄에 들어가나"가 아니라 **줄 수를 재서** 고른다. 자간을 다 좁혀도 한 줄이
   *     안 되는 줄(직군 5칩이 실제로 그렇다)에서 "한 줄 기준"만 보면 목표를 못 이뤘는데도
   *     -0.10em 이 그대로 남아 글자만 빽빽해진다. 줄 수로 재면 ①한 줄에 들어가면 자간을 안 건드리고
   *     ②안 들어가면 줄 수를 가장 적게 만드는 **가장 느슨한** 자간을 고른다 — 사용자가 말한
   *     "좁혀서 맞춰 보고, 그래도 안 되면 다음 줄로"가 두 경우 모두에서 그대로 성립한다.
   *   ⚠여기까지가 전부다. 글자 크기를 줄이거나 버튼을 좁히지 않는다(읽을 수 없게 되는 쪽이 더 나쁘다).
   *     남은 넘침은 CSS 의 flex-wrap 이 버튼째 다음 줄로 내려 해결한다.
   *   [실측 기록 2026-09-09] 화면 폭 300~440px 을 10px 씩 훑어 재 보니, 지금 칩 글자와 11.5px 글자
   *     크기에서는 **-0.10em 까지 좁혀도 줄 수가 안 줄어든다**(칩 하나가 50~70px 인데 -0.10em 로
   *     아끼는 건 칩당 3~5px 뿐이다). 그래서 실제로는 늘 '평소 자간'이 골라지고, 넘치는 칩은 아래
   *     flex-wrap 이 다음 줄로 내린다 — 사용자가 말한 2단계 중 **2단계가 실제로 작동하는 쪽**이다.
   *     이 함수를 남겨 두는 이유는 칩 글자가 바뀌거나(예: 라벨 추가) 화면이 넓어져 **한 칩 차이로
   *     갈리는 경우**가 생기면 그때 자동으로 좁혀 주기 때문이고, 재 보고 고르므로 헛되이 좁히지 않는다.
   */
  function fitProfChips(root) {
    if (!root) return;
    var rows = root.querySelectorAll('.nrya-prof-row');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.children.length < 2) continue;       // 버튼 하나짜리 줄은 좁힐 이유가 없다
      var last = PROF_CHIP_TRACKING[PROF_CHIP_TRACKING.length - 1];
      row.style.letterSpacing = last;
      var best = row.offsetHeight;                 // 가장 좁혔을 때의 줄 수(=최소 높이)
      for (var k = 0; k < PROF_CHIP_TRACKING.length; k++) {
        row.style.letterSpacing = PROF_CHIP_TRACKING[k];
        if (row.offsetHeight <= best) break;       // 같은 줄 수를 내는 가장 느슨한 자간에서 멈춘다
      }
    }
  }

  /** 프로필 화면을 연다(대화 영역을 숨기고 패널을 채운다 — 기록 화면과 같은 방식). */
  function openProf() {
    var panel = document.getElementById('nryaProfPanel'); if (!panel) return;
    closeHistory(true);
    panel.innerHTML = profPanelHTML();
    panel.style.display = 'block';
    panel.scrollTop = 0;
    var body = document.getElementById('nryaChatBody'); if (body) body.style.display = 'none';
    setHistHeader(true);
    fitProfChips(panel);   // ③ 칩 글자가 두 줄로 접히지 않게 자간을 좁혀 맞춘다(패널이 보인 뒤에 재야 한다)
  }

  /** 프로필 화면을 닫고 대화 화면으로 되돌린다. */
  function closeProf() {
    var panel = document.getElementById('nryaProfPanel');
    if (panel) { panel.style.display = 'none'; panel.innerHTML = ''; }
    var body = document.getElementById('nryaChatBody'); if (body) body.style.display = '';
    setHistHeader(false);
    _scrollChatBottom();
  }

  /**
   * 목록에서 대화 한 줄을 눌렀을 때: 그 대화에서 오간 질문·답변을 **물어본 순서대로** 이어 붙이고
   * 대화 화면으로 돌아간다. 붙인 뒤에도 입력창은 그대로라 이어서 새 질문을 할 수 있고,
   * 헤더 ‹ 로 목록에 다시 갈 수 있다.
   * 예: openHistoryGroup('c1757…') → 그날 그 창에서 물은 4건이 질문1·답변1·질문2·답변2… 로 이어 붙는다
   * @param {string} key - 목록 버튼의 data-g(histGroupKey 가 만든 묶음 열쇠)
   * [연계] ← 기록 패널 클릭 위임(bindChat). → renderRestoredAnswer(푸시 복원과 같은 말풍선 쌍 렌더를 재사용).
   */
  function openHistoryGroup(key) {
    var groups = historyGroups(), grp = null;
    for (var i = 0; i < groups.length; i++) { if (groups[i].key === String(key)) { grp = groups[i]; break; } }
    if (!grp || !grp.items.length) return;
    closeHistory(false);   // 목록만 닫고 ‹ 는 남긴다
    var body = document.getElementById('nryaChatBody');
    // ★[채팅창으로]로 되돌아갈 자리를 먼저 찍어 둔다(2026-09-10 사용자 지적).
    //   종전에는 지난 대화를 채팅창에 붙인 뒤 [채팅창으로]를 눌러도 **버튼만 바뀌고 붙인 내용이
    //   그대로 남아** 홈으로 못 갔다. 붙이기 **직전**의 채팅창을 기억해 뒀다가 그 상태로 되돌린다
    //   — 통째로 비우지 않는 이유는, 지난 대화를 열어 보기 전에 하던 **진행 중 대화**까지
    //   날아가면 안 되기 때문이다. 여러 건을 연달아 펼쳐도 **맨 처음 자리**로 돌아간다.
    if (body && histRestorePoint === null) histRestorePoint = body.innerHTML;
    if (body) {
      // 지금 하고 있는 대화와 섞이지 않게 "여기부터 지난 대화"라고 한 줄 끼운다.
      var sep = document.createElement('div'); sep.className = 'nrya-hist-sep';
      sep.textContent = histDayLabel(grp.ts) + ' 대화 (' + grp.items.length + '건)';
      body.appendChild(sep);
    }
    // ⚠되살리는 한 건의 이름을 `hit` 에서 바꾸지 말 것 — 회귀 스위트 test_ask_context 가
    //   `citationChain: hit.chain || [], forms: hit.forms || []` · `ctxNext: hit.ctxNext || null,` ·
    //   `citeLaws: hit.citeLaws || []` 을 **글자 그대로** 잠가 두었다(근거·서식·맥락이 복원에서
    //   빠지는 회귀를 막는 자물쇠다). 이름만 바꿔도 그 자물쇠가 헛돈다.
    grp.items.forEach(function (hit) {
      renderRestoredAnswer({
        ok: true, query: hit.q, answer: hit.a, note: hit.note,
        sources: hit.sources || [], citationChain: hit.chain || [], forms: hit.forms || [], citeLaws: hit.citeLaws || [],
        ctxNext: hit.ctxNext || null,
      });
    });
  }

  function bindChat() {
    var body = document.getElementById('nryaChatBody');
    var input = document.getElementById('nryaChatInput');
    var fab = document.getElementById('nryaFab');

    if (fab) fab.addEventListener('click', openChat);
    var x = document.getElementById('nryaChatX'); if (x) x.addEventListener('click', closeChat);
    var hist = document.getElementById('nryaChatHist'); if (hist) hist.addEventListener('click', openHistory);
    var prof = document.getElementById('nryaChatProf'); if (prof) prof.addEventListener('click', openProf);
    var back = document.getElementById('nryaChatBack'); if (back) back.addEventListener('click', onHistBack);
    // ★★2026-08-18(사용자 "아직도 맥락을 못 찾는다" 지적으로 발견한 진짜 원인):
    //   예전에는 리스너로 doSend 를 **그대로** 넘겼다(`click` → doSend). 그러면 브라우저가 클릭 이벤트
    //   객체를 첫 인자로** 넘겨 doSend 가 그것을 `sendCtx`(확인 버튼이 들고 온 맥락)로 받는다.
    //   그 결과 `var ctx = sendCtx || pendingCtx` 에서 **이벤트 객체가 이겨 pendingCtx 가 통째로
    //   버려졌다** — "🔁 관련해서 더 궁금해요"로 예약해 둔 맥락도, "아니요, 다시 설명할게요"로
    //   예약해 둔 맥락도 **전송 버튼으로 보내면 전부 사라졌다.** 엔터로 보낼 때만 살아 있었다
    //   (그 경로는 `doSend()` 로 인자 없이 부른다). 휴대폰에서는 버튼을 누르므로 사실상 항상 유실.
    //   ⚠인자를 받는 함수를 이벤트 리스너로 **그대로** 넘기지 말 것 — 반드시 감싸서 부른다.
    var send = document.getElementById('nryaChatSend');
    if (send) send.addEventListener('click', function () { doSend(); });
    if (input) {
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });
      // 포커스(키보드 등장) 시: 뷰포트 재계산 + 초기 메시지가 가리지 않게 맨 아래로
      input.addEventListener('focus', function () { fitChat(); setTimeout(function () { fitChat(); _scrollChatBottom(); }, 250); });
    }

    // 답변 내 근거법령 아코디언 토글 + 조문 카드 → 원문 팝업
    // (동적으로 붙는 답변까지 커버하도록 위임. 연락처 줄은 전화 링크라 카드 클릭에서 제외)
    if (body) body.addEventListener('click', function (e) {
      var h = e.target.closest('.nrya-lawacc-h');
      if (h) { h.parentElement.classList.toggle('nrya-open'); return; }
      // ⚠공백 안내 칩 — 누르면 위키에 적힌 원문 문구를 그대로 펼친다
      var g = e.target.closest('.nrya-gap-t');
      if (g) { g.parentElement.classList.toggle('nrya-open'); return; }
      // 되묻기 선택지 버튼 — 고른 조건을 원래 질문에 합쳐 다시 물어본다
      var opt = e.target.closest('.nrya-clarify-btn');
      if (opt) { pickClarifyOption(opt); return; }
      // "기타 — 직접 적을게요" — 누르면 입력란이 열리고, [확인]이 고른 선택지와 같은 길로 보낸다
      var etcOpen = e.target.closest('.nrya-clarify-etcopen');
      if (etcOpen) {
        var wrap = etcOpen.closest('.nrya-clarify-etc');
        if (wrap && !wrap.closest('.nrya-clarify').classList.contains('nrya-done')) {
          wrap.classList.add('nrya-open');
          var inp = wrap.querySelector('.nrya-clarify-etcin'); if (inp) inp.focus();
        }
        return;
      }
      var etcGo = e.target.closest('.nrya-clarify-etcgo');
      if (etcGo) { sendClarifyEtc(etcGo.closest('.nrya-clarify-etc')); return; }
      // 답변 본문 안의 조문·별표 인용(글자 자체가 누를 자리) — 근거 카드와 **같은** 팝업을 연다.
      // citeHTML 이 data-law/article/tier/base 를 카드와 똑같은 이름으로 붙여 두었다.
      var cite = e.target.closest('.nrya-cite');
      if (cite) { openArtPop(cite); return; }
      // 서식 다운로드 버튼 — 앱 웹뷰에서도 받아지도록 기본 링크 이동 대신 openDownloadUrl 로 연다
      var fdl = e.target.closest('.nrya-form-dl');
      if (fdl) { e.preventDefault(); openDownloadUrl(fdl.getAttribute('href')); return; }
      if (e.target.closest('.nrya-chain-tel')) return;
      var hit = e.target.closest('.nrya-chain-hit');
      if (hit) openArtPop(hit);
      var fbBtn = e.target.closest('.nrya-fb-btn');
      if (fbBtn) { onFeedbackThumb(fbBtn); return; }
      var fbSend = e.target.closest('.nrya-fb-send');
      if (fbSend) { onFeedbackSend(fbSend); return; }
      var contBtn = e.target.closest('.nrya-cont-btn');
      if (contBtn) { pickContinuity(contBtn); return; }
    });

    // "기타" 입력란에서 엔터로도 보낸다(확인 버튼과 같은 길).
    if (body) body.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      var inp = e.target.closest ? e.target.closest('.nrya-clarify-etcin') : null;
      if (!inp) return;
      e.preventDefault();
      sendClarifyEtc(inp.closest('.nrya-clarify-etc'));
    });

    // 기록 목록 항목 클릭(목록은 열 때마다 새로 그려지므로 패널에 한 번만 위임한다)
    var panel = document.getElementById('nryaHistPanel');
    if (panel) panel.addEventListener('click', function (e) {
      var it = e.target.closest('.nrya-hist-item');
      if (it) openHistoryGroup(it.getAttribute('data-g'));   // ⑥ 한 줄 = 한 대화
    });

    // [H-37 §7.2] 프로필 패널(버튼 선택 · 직접 입력 저장 · 항목/전체 삭제) — 저장 즉시 다시 그린다.
    var pp = document.getElementById('nryaProfPanel');
    if (pp) pp.addEventListener('click', function (e) {
      var b = e.target.closest('.nrya-prof-btn');
      if (b) { saveProfileField(b.getAttribute('data-k'), b.getAttribute('data-v') || ''); openProf(); return; }
      // ⑤ 어업종류 드롭다운에서 고른 값(목록 안 항목 · "직접 입력" 둘 다 data-v 를 들고 있다)
      var opt = e.target.closest('.nrya-prof-opt');
      if (opt) { saveProfileField(opt.getAttribute('data-k'), opt.getAttribute('data-v') || ''); openProf(); return; }
      var s = e.target.closest('.nrya-prof-save');
      if (s) {
        var el = document.getElementById(s.getAttribute('data-in'));
        var v = el ? (el.value || '').trim() : '';
        var sfx = s.getAttribute('data-suffix') || '';
        // 숫자만 적었으면 단위를 붙여 저장한다("9.77" → "9.77톤") — 저장값이 곧 화면 문구가 된다.
        if (v && sfx && /^[0-9.]+$/.test(v)) v += sfx;
        saveProfileField(s.getAttribute('data-k'), v); openProf(); return;
      }
      if (e.target.closest('.nrya-prof-reset')) {
        try { localStorage.removeItem(LS_PROFILE); } catch (_) {}
        openProf();
      }
    });
    // ④숫자칸(톤수·길이) — 치는 동안 숫자가 아닌 글자는 아예 안 들어가고, 손을 떼면(blur) 저장한다.
    // ⑤검색칸 — 친 글자로 목록을 거른다.
    //   ⚠둘 다 위 click 위임과 **같은 패널**에 걸지만 이벤트가 달라 서로 안 부딪힌다.
    //   ⚠blur 는 거품(bubble)이 안 올라오므로 캡처 단계(세 번째 인자 true)로 받는다 — 이걸 빼면
    //     칸에서 손을 떼도 아무 일이 안 일어난다.
    if (pp) {
      pp.addEventListener('input', function (e) {
        var n = e.target.closest ? e.target.closest('.nrya-prof-num') : null;
        if (n) { n.value = numericOnly(n.value); return; }
        var q = e.target.closest ? e.target.closest('.nrya-prof-search') : null;
        if (q) filterProfList(q);
      });
      pp.addEventListener('blur', function (e) {
        var n = e.target.closest ? e.target.closest('.nrya-prof-num') : null;
        if (n) saveProfNum(n);
      }, true);
    }
  }

  /**
   * 숫자칸에 넣어도 되는 글자만 남긴다(소수점 하나까지 — 톤수 예시가 9.77 이다).
   * 예: numericOnly('9.7a7.5') → '9.775' · numericOnly('abc') → ''
   * @param {string} v - 사용자가 친 그대로의 값
   * @returns {string} 숫자와 소수점 하나만 남은 값
   * [연계] ← bindChat 의 프로필 패널 input 처리(④ 톤수·길이 칸).
   */
  function numericOnly(v) {
    var s = String(v || '').replace(/[^0-9.]/g, '');
    var i = s.indexOf('.');
    if (i < 0) return s;
    return s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '');   // 두 번째부터의 소수점은 버린다
  }

  /**
   * ④ 숫자칸에서 손을 뗐을 때 그 값을 저장하고 머리글의 "현재: …"만 바꿔 준다.
   * 예: 톤수 칸에 9.77 을 적고 다른 곳을 누르면 → '9.77톤' 으로 저장 + 머리글이 '현재: 9.77톤 (… 저장)'
   * @param {HTMLInputElement} el - .nrya-prof-num 입력칸
   * @returns {void}
   * [연계] ← bindChat 의 blur 처리. → saveProfileField(이 기기에만 저장).
   *   ⚠화면을 통째로 다시 그리지 않는다(openProf 를 안 부른다) — 다시 그리면 방금 옮겨 간 포커스와
   *     스크롤 위치가 튄다. 값이 안 바뀌었으면 저장도 건너뛴다(저장 시각 at 이 헛되이 갱신되지 않게).
   */
  function saveProfNum(el) {
    // ⚠손대지 않았으면 아무것도 안 한다. 이걸 빼면 **칸을 눌렀다 떼기만 해도** 저장이 돌아,
    //   예전 방식으로 숫자가 아닌 값이 들어가 있던 기기(옛 톤수 칸은 아무 글자나 받았다)에서
    //   그 값이 소리 없이 지워진다. data-init 은 그릴 때 넣어둔 값이다.
    if (el.value === (el.getAttribute('data-init') || '')) return;
    var k = el.getAttribute('data-k'), sfx = el.getAttribute('data-suffix') || '';
    var num = numericOnly(el.value).replace(/\.$/, '');    // '9.' 처럼 소수점만 남은 꼴은 버린다
    el.value = num;
    el.setAttribute('data-init', num);   // 다음 blur 부터는 "또 바뀌었을 때"만 저장한다
    var next = num ? num + sfx : '';
    var cur = loadProfile().fields[k];
    if (String((cur && cur.v) || '') === next) return;
    saveProfileField(k, next);
    var lab = document.querySelector('#nryaProfPanel .nrya-prof-cur[data-k="' + k + '"]');
    if (lab) lab.textContent = profCurText(loadProfile().fields[k]);
  }

  /**
   * ⑤ 검색칸에 친 글자로 어업 목록을 거른다(공백은 무시하고 부분일치로 본다).
   * 예: '통발' → 근해장어통발어업·근해통발어업·연안통발어업만 남고, 항목이 하나도 없는 묶음 머리글은 숨는다
   * @param {HTMLInputElement} input - .nrya-prof-search
   * @returns {void}
   * [연계] ← bindChat 의 input 처리. 목록 원본은 FISHERY_TYPES(법령 원문).
   *   목록에 **정확히 같은 이름이 없으면** 맨 아래 "직접 입력" 버튼이 그 글자로 나타난다(저장 가능).
   */
  function filterProfList(input) {
    var list = input.nextElementSibling; if (!list || !list.classList.contains('nrya-prof-list')) return;
    var q = String(input.value || '').replace(/\s+/g, '');
    var kids = list.children, shownInGrp = 0, lastGrp = null, total = 0, exact = false;
    for (var i = 0; i < kids.length; i++) {
      var el = kids[i];
      if (el.hasAttribute('data-grp')) {
        if (lastGrp) lastGrp.hidden = (shownInGrp === 0);
        lastGrp = el; shownInGrp = 0; continue;
      }
      if (!el.classList.contains('nrya-prof-pick')) continue;   // 안내문·직접입력 버튼은 아래에서 따로 본다
      var label = el.getAttribute('data-v') || '';
      var hit = !q || label.replace(/\s+/g, '').indexOf(q) >= 0;
      el.hidden = !hit;
      if (hit) { shownInGrp++; total++; }
      if (label === input.value.trim()) exact = true;
    }
    if (lastGrp) lastGrp.hidden = (shownInGrp === 0);
    var free = list.querySelector('.nrya-prof-free');
    var none = list.querySelector('.nrya-prof-none');
    var typed = input.value.trim();
    if (free) {
      free.hidden = !(typed && !exact);
      free.setAttribute('data-v', typed);
      free.textContent = '직접 입력: “' + typed + '” 으로 저장';
    }
    if (none) none.hidden = !(typed && total === 0);
  }

  /** 👍는 바로 전송, 👎는 사유(선택) 입력칸을 펼친다. @param {HTMLElement} btn */
  function onFeedbackThumb(btn) {
    var wrap = btn.closest('.nrya-fb'); if (!wrap) return;
    var thumb = btn.getAttribute('data-thumb');
    if (thumb === 'up') { submitFeedback(wrap, 'up', ''); return; }
    var box = wrap.querySelector('.nrya-fb-reason');
    if (box) box.classList.remove('nrya-hidden');
    wrap.querySelectorAll('.nrya-fb-btn').forEach(function (b) { b.disabled = true; });
  }

  /** 👎 사유 입력 후 "전송". @param {HTMLElement} btn */
  function onFeedbackSend(btn) {
    var wrap = btn.closest('.nrya-fb'); if (!wrap) return;
    var input = wrap.querySelector('.nrya-fb-reason-in');
    submitFeedback(wrap, 'down', input ? input.value.trim() : '');
  }

  /**
   * 만족도 로그를 서버로 보내고 버튼을 "감사합니다"로 바꾼다(중복 전송 방지).
   * @param {HTMLElement} wrap - .nrya-fb 컨테이너 @param {'up'|'down'} thumb @param {string} reason
   * [연계] → POST /api/legal/feedback.
   */
  function submitFeedback(wrap, thumb, reason) {
    wrap.classList.add('nrya-fb-done');
    wrap.innerHTML = '<span class="nrya-fb-lab">피드백 감사합니다 🙏</span>';
    legalPost('/api/legal/feedback', {
      question: wrap.getAttribute('data-q') || '',
      answerGist: wrap.getAttribute('data-gist') || '',
      thumb: thumb, reason: reason
    }).catch(function () { /* 전송 실패는 조용히 — 사용자에게 재시도를 강요하지 않는다 */ });
  }

  // ── 조문 원문 팝업: 카드를 누르면 그 조 전문을 띄우고 인용된 항·호를 강조 ──────────
  var artPopBuilt = false;
  var artPopReq = 0;   // 조회 순번 — 늦게 도착한 이전 요청이 지금 보는 조문을 덮어쓰지 않게 한다
  var artPopRefs = {}; // 지금 보고 있는 조문의 별표·서식 참조 판정(서버 refs를 key로 정리한 것)
  var artPopRefsCut = false; // 서버가 판정 상한에서 멈췄나(true면 refs에 없는 참조 = "판정 안 함")
  // 조 없이 별표만 가리킨 인용(mode:'annex')에서 **하나뿐인 별표를 자동으로 열었나.**
  // 이때 뒤에 남는 조문 팝업은 그 별표 한 줄짜리 목록뿐이라, 별표를 닫으면 다 봤는데도 같은 것을
  // 한 번 더 닫아야 했다(사용자 지적 2026-08-18). 자동으로 연 경우만 함께 닫는다 — 조 본문에서
  // 사용자가 직접 누른 별표는 예전처럼 조문 팝업으로 돌아간다.
  var bylAutoOpened = false;

  // 본문 안의 별표·서식·이미지 참조 표현. ⚠ 서버(services/article_text.js)의 REF_RE 와
  // **같은 표현이어야** 판정(kind)과 화면 링크가 어긋나지 않는다 — 한쪽만 고치지 말 것.
  var NRYA_REF_RE = /별지\s*제\s*(\d+(?:의\d+)?)\s*호(?:\s*서식)?|별표\s*제?\s*(\d+(?:의\d+)?)|【이미지\s*(\d+)】/g;

  /** 참조 정규식 매치를 서버 refs 와 맞출 열쇠로 바꾼다(`별표1`·`서식1`·`이미지9`). */
  function refKeyOf(m) {
    if (m[1] != null) return '서식' + m[1];
    if (m[2] != null) return '별표' + m[2];
    return '이미지' + m[3];
  }

  /**
   * 원문 한 토막을 요소에 넣되, 그 안의 "별표 1"·"별지 제1호 서식" 같은 표현 **자체**를
   * 눌러볼 수 있는 링크로 바꾼다(별도 칩·버튼 줄을 뒤에 붙이지 않는다 — 목업 확정).
   * 우리에게 원문이 없는 참조는 누를 수 없는 회색 "(원문 미수집)"으로 둔다(지어내지 않는다).
   * 다만 **이미지 참조(`【이미지 N】`)만은 링크가 아니라 그림 자체**를 그 자리에 그려 넣는다 —
   * 원문에서 그림은 문장과 한 덩어리이기 때문이다(아래 ★ 주석).
   * 원문 글자는 전부 textContent·텍스트노드로만 넣는다(HTML 주입 없음 — XSS 방지).
   * 예: appendText(div, '수수료는 별표 1과 같다.', refs) → '수수료는 ' + <span.nrya-byl-ref>별표 1</span> + '과 같다.'
   * @param {HTMLElement} host - 글자를 붙일 요소
   * @param {string} text - 서버가 준 원문 토막
   * [연계] ← renderArtPop. → openBylPop(클릭 위임은 ensureArtPop 에서 한 번만 묶는다).
   */
  function appendText(host, text) {
    var s = String(text || ''), last = 0, m;
    NRYA_REF_RE.lastIndex = 0;
    while ((m = NRYA_REF_RE.exec(s))) {
      if (m.index > last) host.appendChild(document.createTextNode(s.slice(last, m.index)));
      last = m.index + m[0].length;
      var key = refKeyOf(m), ref = artPopRefs[key];
      var isImg = key.indexOf('이미지') === 0;
      // 이미지 마커는 원문 문장이 아니라 수집 표시다 — 실물이 없으면 흔적 없이 지운다.
      if (isImg && (!ref || ref.kind !== 'image')) continue;
      // ★2026-08-18(사용자 확정): 그림이 있는 자리에는 **그림을 그 자리에 그대로** 띄운다.
      //   사용자 원문: "본문 내용 그 별지나 별표 안에도 그 내용이 텍스트로 적혀 있고 그 중간에
      //   이미지가 들어간 경우가 있단 말이야. … 텍스트와 이미지가 같이 나와 줘야 될 것 같은데".
      //   예전에는 `🖼 원본 이미지` 링크만 두어, 그림을 보려면 팝업을 한 번 더 열어야 했다.
      //   ⚠ 원문의 그림은 두 갈래다 — 문장 아래 붙는 표·산식(큰 그림)과, 문장 **안에** 끼는
      //     수식 기호(작은 그림. 예: 선박에너지효율검사기준 "제1항의 계산식에서 【이미지 A】 및
      //     【이미지 B】는"). 둘을 갈라 다루려면 그림 크기를 미리 알아야 하는데 우리는 모른다 —
      //     그래서 inline-block 하나로 두고 CSS 가 알아서 흐르게 한다(큰 것은 폭에 맞춰 줄을
      //     차지하고, 작은 것은 글자 사이에 그대로 앉는다). 눌러 크게 보는 길은 그대로 둔다.
      if (isImg) {
        var fig = document.createElement('img');
        fig.className = 'nrya-artpop-img nrya-byl-ref';
        fig.setAttribute('data-byl', key);
        fig.loading = 'lazy';
        fig.alt = ref.title || '원문 이미지';
        fig.src = ref.image;
        host.appendChild(fig);
        continue;
      }
      // 서버가 판정 상한(MAX_REFS)에서 멈춰 **아예 안 본** 참조는 "미수집"이 아니다 —
      // 없는 걸 있다고 하지도, 모르는 걸 없다고 단정하지도 않게 원문 글자 그대로 둔다.
      if (!ref && artPopRefsCut) { host.appendChild(document.createTextNode(m[0])); continue; }
      var span = document.createElement('span');
      if (ref && ref.kind !== 'missing') {
        span.className = 'nrya-byl-ref';
        span.setAttribute('data-byl', key);
        span.textContent = m[0];
      } else {
        span.className = 'nrya-byl-missing';
        span.textContent = m[0] + ' (원문 미수집)';
      }
      host.appendChild(span);
    }
    if (last < s.length) host.appendChild(document.createTextNode(s.slice(last)));
  }

  /**
   * 조문 팝업(배경막 + 카드)과 별표 팝업을 #nrya-overlays 안에 1회 주입한다. 닫기 버튼·배경막
   * 클릭·별표 참조 클릭은 여기서 한 번만 묶는다(카드 내용은 열 때마다 renderArtPop 이 갈아끼운다).
   * [연계] ← openArtPop. → closeArtPop · openBylPop.
   */
  function ensureArtPop() {
    if (artPopBuilt) return;
    var host = document.getElementById('nrya-overlays'); if (!host) return;
    artPopBuilt = true;
    var veil = document.createElement('div'); veil.className = 'nrya-artpop-veil'; veil.id = 'nryaArtVeil';
    var pop = document.createElement('div'); pop.className = 'nrya-artpop'; pop.id = 'nryaArtPop';
    pop.innerHTML =
      '<div class="nrya-artpop-head">' +
        '<div class="nrya-artpop-titles">' +
          // [2026-08-18 사용자 확정] 조 하나를 여는 보통 경우에는 칩을 비워 둔다 — "원문 · 자동
          //   발췌"는 화면을 보면 아는 말이라 자리만 차지했다(사용자 원문: "원문 자동발췌는
          //   없애주고"). 나열·범위·별표처럼 **몇 개를 여는지 알려줘야 하는 경우에만** 채운다
          //   (renderArtPop 의 artScopeLabel) — 빈 칩은 CSS `:empty` 로 사라진다.
          '<span class="nrya-artpop-chip" id="nryaArtChip"></span>' +
          '<p class="nrya-artpop-law" id="nryaArtLaw"></p>' +
          // 시행일자는 조문 제목과 **같은 줄 오른쪽 끝**에 둔다(사용자 확정). 자리가 모자라면
          //   글자를 쪼개 두 줄로 만들지 않고 배지째 아랫줄로 내려간다(체인 카드와 같은 규칙).
          '<div class="nrya-artpop-artrow">' +
            '<h3 class="nrya-artpop-art" id="nryaArtTitle"></h3>' +
            '<span class="nrya-artpop-eff" id="nryaArtEff"></span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="nrya-artpop-x" id="nryaArtX">×</button>' +
      '</div>' +
      '<div class="nrya-artpop-gist" id="nryaArtGist"></div>' +
      '<div class="nrya-artpop-body" id="nryaArtBody"></div>' +
      // [2026-08-18 사용자 확정] 근거 아코디언을 없애면서 그 카드가 갖고 있던 소관부서 연락처를
      //   이 팝업이 이어받는다 — 사용자 원문: "팝업을 열었을 때 거기에 전화번호가 적혀 있으면 될
      //   것 같다. 시행일자도 그렇고."(시행일자는 위 nryaArtEff 가 이미 보여준다)
      '<div class="nrya-artpop-tel" id="nryaArtTel"></div>' +
      '<div class="nrya-artpop-foot" id="nryaArtFoot"></div>';
    var bveil = document.createElement('div'); bveil.className = 'nrya-bylpop-veil'; bveil.id = 'nryaBylVeil';
    var bpop = document.createElement('div'); bpop.className = 'nrya-bylpop'; bpop.id = 'nryaBylPop';
    bpop.innerHTML =
      '<div class="nrya-bylpop-head">' +
        '<span class="nrya-bylpop-t" id="nryaBylTitle"></span>' +
        // 다운로드 버튼 자리(appendBylDownloads가 채운다). 본문 끝이 아니라 헤더에 두는 이유는
        // 별표4처럼 표가 긴 원문에서 버튼이 화면 맨 아래로 밀려 안 보였기 때문 — 헤더는 본문
        // 스크롤 밖이라 표 길이와 상관없이 늘 보인다(2026-08-17 사용자 요청).
        '<span class="nrya-bylpop-dl" id="nryaBylDl"></span>' +
        '<button type="button" class="nrya-bylpop-close" id="nryaBylX">×</button>' +
      '</div>' +
      '<div class="nrya-bylpop-body" id="nryaBylBody"></div>';
    host.appendChild(veil); host.appendChild(pop); host.appendChild(bveil); host.appendChild(bpop);
    veil.addEventListener('click', closeArtPop);
    pop.querySelector('#nryaArtX').addEventListener('click', closeArtPop);
    bveil.addEventListener('click', closeBylPop);
    bpop.querySelector('#nryaBylX').addEventListener('click', closeBylPop);
    // 별표 참조는 본문·푸터 어디서든 같은 방식으로 열리게 위임한다.
    pop.addEventListener('click', function (e) {
      var r = e.target.closest('.nrya-byl-ref');
      if (r) { openBylPop(artPopRefs[r.getAttribute('data-byl')]); return; }
      // [계약2] "조문 전체 보기" — 감춰뒀던 나머지 항·호를 펼친다. DOM 은 처음부터 다 그려져
      //   있어 서버 재조회가 없다. ★2026-08-18(사용자 확정): 예전에는 한 번 펼치면 버튼을
      //   없앴는데, 긴 조문을 펼친 뒤 다시 근거 항만 보고 싶어도 돌아갈 길이 없었다
      //   (사용자 원문: "조문 연 후 접기가 아직도 반영이 안된것같은데?") — 접기 토글로 바꾼다.
      var more = e.target.closest('.nrya-artpop-more');
      if (more) {
        var ab = document.getElementById('nryaArtBody');
        if (ab) more.textContent = ab.classList.toggle('nrya-focused') ? '조문 전체 보기' : '접기';
        return;
      }
      // [계약3] 부칙은 본문과 섞이지 않게 기본 접힘 — 머리줄을 누르면 펼친다.
      var ad = e.target.closest('.nrya-addenda-t');
      if (ad) { ad.parentElement.classList.toggle('nrya-open'); return; }
    });
  }

  // 별표 원문에 쓰인 괘선(罫線) 글자. raw 원문의 표는 전부 이 글자로 그려져 있어(실측)
  // "이 줄이 표의 일부인가"를 이걸로 가른다. 하나도 없으면 표가 아니라 산문이다.
  var NRYA_BOX_RE = /[─━│┃┌┏┐┓└┗┘┛├┠┤┨┬┯┴┷┼╋]/;
  // 괘선과 공백뿐인 줄 = 행 구분선(`├───┼───┤`). 헤더가 2단으로 겹친 표의 가운데 줄
  // (`│      │      ├──┬──┬──┤`)도 여기에 걸려 행 경계가 된다.
  var NRYA_BOX_ONLY_RE = /^[\s─━│┃┌┏┐┓└┗┘┛├┠┤┨┬┯┴┷┼╋]*$/;

  /**
   * 한 칸이 여러 줄에 걸쳐 있을 때 그 줄들을 잇는다. **줄바꿈을 그대로 살려서** 잇는다 —
   * 원문 표는 칸 폭에 맞춰 낱말 가운데서도 줄을 바꾸는데(`… 통영항, 장` + `승포항 …` = 장승포항),
   * 어디가 낱말 경계였는지 글자만 보고는 알 수 없기 때문이다(`신고를` + `하지`는 띄어야 하고
   * `출입통` + `제`는 붙여야 하는데, 여백 폭으로도 구분되지 않음을 실측으로 확인했다).
   * 없는 띄어쓰기를 지어내거나 있는 띄어쓰기를 지우느니 원문 줄 그대로 둔다(환각 0).
   *
   * ★2026-08-18 재검토(사용자 지적: "한 줄짜리 내용인데 끊겨 보인다") — **자동으로 이을 수 없음을
   *   실측으로 확인했다.** 원문은 옛 고정폭 폭에 맞춰 접혀 있는데, 그 접힘이 두 갈래다:
   *     ⓐ낱말 **가운데**서 끊긴 것 → 붙일 때 띄어쓰기를 넣으면 안 된다(`…구명조끼. 이`+`중 20…`)
   *     ⓑ낱말 **사이**에서 끊긴 것 → 붙일 때 띄어쓰기를 넣어야 한다(`…하기 위해 위`+`사람에게 …`)
   *   둘을 가르려고 ①칸을 얼마나 채웠나(채움률) ②남은 여백에 다음 낱말이 들어갔겠나 를 전수
   *   측정해 봤지만, **같은 채움률·같은 여백에서 ⓐ와 ⓑ가 함께 나온다**(`…통영항, 장`+`승포항`은
   *   여백 3에 ⓐ, `…위해 위`+`사람에게`는 같은 여백 3에 ⓑ). 좁은 칸은 더 심해서
   *   `1. 국가관리무역항`+`(14개)`(일부러 나눈 줄)와 `1. 안전·구`+`명설비`(접힌 줄)가 같은 값이다.
   *   → 잘못 붙이면 **법령 원문의 낱말이 붙거나 갈라진다.** 눈에 보이는 줄바꿈보다 그쪽이 훨씬
   *     나쁘므로 잇지 않는다. 표를 원래 모양대로 보려면 팝업의 "원본 이미지 보기"를 쓴다
   *     (별표·별지 2,719건 중 2,679건에 원본 스캔이 있다).
   * 예: joinBylCell('1. 국가관리무역항', '(14개)') → '1. 국가관리무역항\n(14개)'
   * @param {string} a - 지금까지 이어붙인 셀 글자
   * @param {string} b - 다음 줄의 같은 칸 글자
   * @returns {string}
   * [연계] ← parseBylTable(). 칸은 CSS `white-space:pre-wrap` 으로 그 줄바꿈을 살려 그린다.
   */
  function joinBylCell(a, b) {
    return (a && b) ? a + '\n' + b : (a || b);
  }

  // 표시폭 기준(2칸으로 세는 글자). 원문 표는 고정폭 화면 기준으로 그려져 있어, 칸 경계가 몇 번째
  // '열'인지 재려면 글자 폭을 그 기준으로 세야 한다. **ASCII 밖은 전부 2칸**으로 본다 — ○·※·①·℃
  // 처럼 폭이 애매한 글자까지 2칸으로 세는 쪽이 실측에서 훨씬 잘 맞았다(별표 원문 표 11,916덩어리
  // 중 줄 폭이 딱 맞아떨어진 것: 이 기준 6,862 vs 한글·괘선만 2칸으로 셀 때 5,431).
  var NRYA_WIDE_RE = /[^\x00-\x7F]/;

  /**
   * 한 줄에서 칸 구분자(`│`·`┃`)가 각각 **몇 번째 열**에 있는지 표시폭 기준으로 세어 돌려준다.
   * 이 열 번호가 있어야 "짧은 행에서 어느 칸이 합쳐졌는지"를 기준행과 대조할 수 있다.
   * 예: bylPipeCols('│계    │64│40│') → [0, 8, 12, 16]
   * @param {string} line - 표의 한 줄(원문 그대로)
   * @returns {number[]} 구분자들의 열 번호(왼쪽 테두리 → 오른쪽 테두리 순)
   * [연계] ← parseBylTable(). 병합이 '끝에서만' 일어났는지 확인하는 데만 쓴다.
   */
  function bylPipeCols(line) {
    var n = 0, out = [];
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (ch === '│' || ch === '┃') out.push(n);
      n += NRYA_WIDE_RE.test(ch) ? 2 : 1;
    }
    return out;
  }

  /**
   * 괘선으로 그려진 표 한 덩어리를 행렬(행 × 셀)로 읽는다. 구분선(`├──┼──┤`)이 행 경계이고,
   * 그 사이의 여러 줄은 칸별로 이어붙여 한 행으로 만든다.
   * 조금이라도 어긋나면(줄마다 칸 수가 다름 등) **null 을 돌려 원본 <pre> 폴백에 맡긴다** —
   * 잘못 정리해 숫자가 엉뚱한 항목에 붙느니 원본 그대로 보여주는 게 낫다(환각 0).
   *
   * ⚠ 칸 수가 모자란 행(원문에서 칸이 합쳐진 행)은 renderBylTable 이 **마지막 칸을 넓혀** 그리는데,
   *   병합이 왼쪽·가운데에서 일어난 표가 실제로 있다(`│계(2열 병합)│64│40│` — 수상구조법 시행규칙
   *   별표6). 그 행은 뒤 칸들이 통째로 왼쪽으로 밀려 **값이 엉뚱한 헤더 밑에 놓인다.** 그래서 여기서
   *   각 행의 구분자 열 번호를 칸이 가장 많은 기준행과 대조해, **글자가 든 칸이 자기가 그려질 열
   *   범위 안에 그대로 들어갈 때만** 통과시킨다(빈 칸은 어디 놓여도 값이 안 뒤바뀌므로 건너뛴다).
   *   이 대조는 칸 수가 기준행보다 **적은** 행에만 적용된다 — 칸 수가 이미 기준행과 같은 행은
   *   대조 없이 그대로 쓴다(칸 수가 같으면 k번째 칸=k번째 열이라 위치가 달라도 대응은 안전하다).
   *   하나라도 벗어나면 병합 자리를 우리가 복원할 수 없다는 뜻이라 **표 전체를 <pre> 폴백**한다 —
   *   억지로 맞춰 그리면 원문 글자는 그대로여도 값↔헤더 대응이 조작된다(환각 0 위반).
   *   ↳ 실측(별표 원문 1,251표): 그대로 그리는 표 1,127, 폴백으로 돌아가는 표 124.
   * @param {string[]} lines - 표 덩어리의 줄들
   * @returns {Array<string[]>|null} 행 목록(각 행은 셀 글자 배열), 확신이 안 서면 null
   * [연계] ← renderBylText(). → renderBylTable() · bylPipeCols()
   */
  function parseBylTable(lines) {
    var rows = [], cur = null, curCols = null, ok = true;
    function flushRow() { if (cur) { rows.push({ cells: cur, cols: curCols }); cur = null; curCols = null; } }
    lines.forEach(function (ln) {
      if (!ok) return;
      if (NRYA_BOX_ONLY_RE.test(ln)) { flushRow(); return; }
      // 굵은 테두리(`┃`)로 바깥선을 그린 표가 실측으로 많다 — 같은 칸 구분자로 본다.
      var line = ln.replace(/┃/g, '│');
      if (line.indexOf('│') < 0) { ok = false; return; }
      var parts = line.split('│');
      // 줄 양끝(테두리 바깥)은 비어 있어야 한다 — 아니면 우리가 모르는 형식이다.
      if (parts[0].trim() || parts[parts.length - 1].trim()) { ok = false; return; }
      var cells = parts.slice(1, -1).map(function (c) { return c.trim(); });
      if (!cells.length) { ok = false; return; }
      // 칸이 전부 빈 줄도 행 경계다 — 구분선(`├──┤`) 없이 빈 줄로만 행을 나눈 표가 있다
      // (유선및도선사업법 시행령 별표3). 이걸 안 끊으면 모든 위반행위가 한 칸에 뭉쳐 버린다.
      if (cells.every(function (c) { return !c; })) { flushRow(); return; }
      if (!cur) { cur = cells; curCols = bylPipeCols(ln); return; }
      // ★2026-08-18(사용자 "어떤 건 표, 어떤 건 아스키" 지적): 예전에는 줄마다 칸 수가 다르면
      //   **표 전체를 포기**했다(ok=false → 통째로 ASCII). 병합·중첩 셀이 있는 표(한 칸 안이 다시
      //   여러 칸으로 갈리는 표)가 전부 여기서 걸렸다. 이제는 포기하지 않고 **행을 끊고 새 행으로**
      //   이어간다 — 칸이 어디에 놓이는지는 아래 열 위치 대조(ref ±1)가 판정하고, 거기서 자리를
      //   못 정하면 그때 null 을 돌려 ASCII 로 떨어진다(엉뚱한 칸에 값이 들어가지 않는다).
      //   실측(별표 원문 전수, 구분자 줄 3개 이상인 덩어리 9,227개): 표로 그려지는 것 1,081 → 1,302
      //   (+221). **못 그리게 된 것 0건, 이미 그려지던 표의 결과가 달라진 것 0건.**
      if (cur.length !== cells.length) { flushRow(); cur = cells; curCols = bylPipeCols(ln); return; }
      cur = cur.map(function (c, i) { return joinBylCell(c, cells[i]); });
    });
    flushRow();
    if (!ok || rows.length < 2) return null;
    var max = 0;
    rows.forEach(function (r) { if (r.cells.length > max) max = r.cells.length; });
    if (max < 2) return null;
    // 기준행 = 칸이 가장 많은 행들 중 **가장 흔한 경계**. 원문에 한 줄만 한 칸 밀린 표가 있어
    // (실측) 맨 앞 행을 무조건 믿으면 멀쩡한 표가 통째로 폴백된다.
    var seen = {}, ref = null, refN = 0;
    rows.forEach(function (r) {
      if (r.cells.length !== max || !r.cols) return;
      var k = r.cols.join(',');
      seen[k] = (seen[k] || 0) + 1;
      if (seen[k] > refN) { refN = seen[k]; ref = r.cols; }
    });
    if (!ref) return null;
    // ★2026-08-18(사용자 지적 — 근해어업 표가 아스키로 떨어짐): 예전에는 **맨 끝 칸만** 여러 열에
    //   걸칠 수 있다고 보고, 나머지는 "k번째 칸 = k번째 열"로 못 박았다. 그래서 **앞쪽 칸이 병합된
    //   표**(수산업법 시행령 별표7 근해어업: `가.` 표시 칸이 어떤 줄에서는 옆 칸과 합쳐져 있다)는
    //   첫 칸부터 어긋나 표 전체가 아스키로 떨어졌다.
    //   이제는 칸의 **양쪽 테두리 위치를 기준행의 열 경계와 맞춰** 그 칸이 몇 열을 덮는지 센다
    //   (자리를 추측하는 게 아니라 원문에 그어진 선을 읽는 것이다). 경계가 기준행과 안 맞으면
    //   예전처럼 null 을 돌려 아스키로 떨어진다 — 엉뚱한 칸에 값이 들어가느니 그 편이 낫다.
    var at = function (x) {                            // 이 위치가 기준행의 몇 번째 열 경계인가
      for (var j = 0; j < ref.length; j++) if (Math.abs(ref[j] - x) <= 1) return j;   // ±1 오차 허용
      return -1;
    };
    var out = [], exact = true;
    for (var i = 0; i < rows.length && exact; i++) {
      var cells = rows[i].cells, cols = rows[i].cols, len = cells.length;
      var row = [], want = 0;
      for (var k = 0; k < len; k++) {
        var a = at(cols[k]), b = (k === len - 1) ? ref.length - 1 : at(cols[k + 1]);
        // 왼쪽 테두리는 앞 칸이 끝난 자리에서 이어져야 하고, 오른쪽은 그보다 뒤여야 한다.
        if (a < 0 || b < 0 || a !== want || b <= a) { exact = false; break; }
        row.push({ text: cells[k], span: b - a });
        want = b;
      }
      if (!exact || want !== ref.length - 1) { exact = false; break; }
      out.push(row);
    }
    if (exact) return out;
    // ⚠선 위치로 다 맞추지 못했으면 **예전 판정을 그대로** 한 번 더 본다 — 새 방식이 더 엄격해서,
    //   예전에 잘 그려지던 표(빈 칸이 섞였거나 테두리가 한 칸씩 어긋난 표)까지 아스키로 떨어뜨렸다
    //   (실측 113건). 새 방식은 **더 많이 그리려고** 얹은 것이지 있던 것을 뺏으려는 게 아니다.
    for (var i2 = 0; i2 < rows.length; i2++) {
      var c2 = rows[i2].cells, k2, len2 = c2.length;
      if (len2 === max) continue;                     // 칸이 다 있는 행은 넓힐 일이 없다
      for (k2 = 0; k2 < len2; k2++) {
        if (!c2[k2]) continue;                        // 빈 칸은 어디 놓여도 값이 안 뒤바뀐다
        var lo = ref[k2], hi = (k2 === len2 - 1) ? ref[max] : ref[k2 + 1];
        if (rows[i2].cols[k2] < lo - 1 || rows[i2].cols[k2 + 1] > hi + 1) return null;
      }
    }
    // 예전 규약: **맨 끝 칸만** 남은 열을 다 덮는다.
    return rows.map(function (r) {
      return r.cells.map(function (t, ci) {
        return { text: t, span: (ci === r.cells.length - 1 && r.cells.length < max) ? max - r.cells.length + 1 : 1 };
      });
    });
  }

  /**
   * parseBylTable 이 읽은 행렬을 표로 그린다. 원문에서 오른쪽 칸들이 합쳐진 행(`┴`로 이어진 자리)은
   * 칸 수가 모자라므로 **마지막 칸을 남은 열만큼 넓혀**(colspan) 값이 엉뚱한 열 밑으로 가지 않게 한다.
   * 병합이 정말 '끝에서만' 일어났는지는 parseBylTable 이 칸 경계로 이미 확인했다(아니면 여기까지 안 온다).
   * 예: 과태료 표에서 `│…│법 제113조제1항제1호│200                 │`(3칸)의 `200`은
   *     1회·2회·3회 위반 세 열에 걸친 값이다 → colspan 3.
   * @param {HTMLElement} host - 별표 팝업 본문
   * @param {Array<string[]>} rows - parseBylTable 결과
   * [연계] ← renderBylText().
   */
  function renderBylTable(host, rows) {
    var tbl = document.createElement('table'); tbl.className = 'nrya-byl-tbl';
    rows.forEach(function (cells, ri) {
      var tr = document.createElement('tr');
      if (/^(합계|소계|계)$/.test(((cells[0] || {}).text || '').replace(/\s/g, ''))) tr.className = 'nrya-byl-sum';
      cells.forEach(function (c) {
        var cell = document.createElement(ri === 0 ? 'th' : 'td');
        if (c.span > 1) cell.colSpan = c.span;   // 원문에 그어진 선이 말해주는 병합 폭 그대로
        if (/\d/.test(c.text) && /^[\d,.\s~\-]+$/.test(c.text)) cell.className = 'nrya-byl-num';
        cell.textContent = c.text;               // 원문 글자는 전부 textContent 로만(HTML 주입 없음)
        tr.appendChild(cell);
      });
      tbl.appendChild(tr);
    });
    // 칸이 많은 표는 좁은 화면에 다 안 들어간다 — 감싸서 **이 칸 안에서만** 가로로 밀어 보게 한다
    // (2026-08-18 사용자 요청). 팝업 본문 자체가 가로로 밀리면 다른 글까지 잘려 보인다.
    var box = document.createElement('div'); box.className = 'nrya-byl-scroll';
    box.appendChild(tbl);
    host.appendChild(box);
  }

  /**
   * 별표 원문을 팝업 폭에 맞게 그린다. 원문은 고정폭 화면 기준으로 정렬돼 있어 그대로 <pre> 에 넣으면
   * 좁은 팝업에서 가로로 흘러 ASCII 그림처럼 보인다 — 괘선으로 그려진 표는 진짜 표로 다시 그리고,
   * 표가 아닌 산문은 줄끝 공백만 털어 pre-wrap 으로 접어 준다.
   * ⚠ 표 파싱이 조금이라도 어긋나면 지어내지 않고 원본 <pre> 그대로 보여준다(환각 0).
   * @param {HTMLElement} host - 별표 팝업 본문(#nryaBylBody)
   * @param {string} text - 서버가 준 별표 원문
   * [연계] ← openBylPop(kind==='text'). → parseBylTable() · renderBylTable()
   */
  function renderBylText(host, text) {
    var seg = [], segIsTable = null;
    function flush() {
      if (!seg.length) { return; }
      if (segIsTable) {
        var rows = parseBylTable(seg);
        if (rows) renderBylTable(host, rows);
        else {
          var pre = document.createElement('pre'); pre.className = 'nrya-bylpop-pre';
          pre.textContent = seg.join('\n');
          host.appendChild(pre);
        }
      } else {
        var t = seg.map(function (l) { return l.replace(/\s+$/, ''); }).join('\n')
          .replace(/\n{3,}/g, '\n\n').replace(/^\n+|\n+$/g, '');
        if (t) {
          var p = document.createElement('div'); p.className = 'nrya-byl-prose';
          p.textContent = t;
          host.appendChild(p);
        }
      }
      seg = [];
    }
    String(text || '').split('\n').forEach(function (ln) {
      var isTable = NRYA_BOX_RE.test(ln);
      if (segIsTable !== null && isTable !== segIsTable) flush();
      segIsTable = isTable;
      seg.push(ln);
    });
    flush();
  }

  /**
   * law.go.kr 원본 파일(HWP·PDF) 주소를 사용자 환경에 맞는 방법으로 연다.
   * ⚠ 앱(Capacitor 안드로이드 WebView)은 평범한 앵커/`<a download>` 의 다운로드를 못 받는 경우가
   *   있어, 네이티브에서는 시스템 브라우저(@capacitor/browser)로 넘겨 브라우저가 받게 한다.
   *   이 저장소의 다른 다운로드 코드(admin_collect.js `_usageOpenDownloadUrl`,
   *   typhoon/ocean_typhoon.js, marine-life/safety/access_control.js)가 전부 쓰는 것과 같은 패턴이다.
   * ⚠ 파일은 **사용자 브라우저가 law.go.kr 에서 직접** 받는다 — 우리 서버가 대신 받아오면 안 된다
   *   (_LESSONS.md L-56 · form_download_survey.md §5-3).
   * 예: openDownloadUrl('https://www.law.go.kr/LSW/flDownload.do?flSeq=131996113')
   * @param {string} url - 절대 URL(http/https)
   * @returns {void}
   * [연계] ← appendBylDownloads(별표 팝업) · 답변 아래 서식 버튼(bindChat 위임 클릭).
   */
  function openDownloadUrl(url) {
    var u = String(url || '');
    if (!/^https?:\/\//.test(u)) return;
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    var anchorOpen = function () {
      var a = document.createElement('a');
      a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
      document.body.appendChild(a); a.click(); a.remove();
    };
    if (isNative && Browser && Browser.open) {
      try {
        var p = Browser.open({ url: u });
        if (p && typeof p.catch === 'function') p.catch(anchorOpen);
        return;
      } catch (e) { /* 폴백 */ }
    }
    anchorOpen();
  }

  /**
   * 별표의 law.go.kr 원본 파일 링크를 붙인다. **kind 와 무관하게** 붙는다 —
   * 표 원문을 갖고 있어도 원본 파일은 따로 받아볼 수 있어야 한다("보기와 다운로드는 양자택일이 아니다").
   * 형식이 하나뿐이면 고르는 선택창 없이 평범한 단일 링크로, 둘이면 동등한 크기 버튼 두 개로 낸다
   * (어느 쪽도 기본값으로 정하지 않는다). 새 탭에서 사용자의 브라우저가 직접 받는다 — 서버가 대신
   * 받아오면 law.go.kr에 차단된다(_LESSONS.md L-56).
   * ⚠ 실제로 여는 것은 openDownloadUrl 이다(앱 웹뷰 대응) — href 는 길게 눌러 주소 복사 등을 쓸 수
   *   있게 그대로 두고, 클릭만 가로챈다. 답변 아래 서식 버튼과 **같은 헬퍼**를 써야 두 곳이 어긋나지 않는다.
   * ⚠ 붙는 자리는 **팝업 헤더**(제목 옆)다 — 예전엔 본문 끝이라, 별표4처럼 표가 긴 원문에서는
   *   버튼이 화면 맨 아래로 밀려 끝까지 스크롤해야 보였다(2026-08-17 사용자 지적).
   * @param {HTMLElement} host - 별표 팝업 헤더의 버튼 자리(#nryaBylDl)
   * @param {object} ref - 서버 refs 항목
   * @returns {number} 실제로 붙인 링크 개수(0이면 아무것도 안 붙였다)
   * [연계] ← openBylPop.
   */
  function appendBylDownloads(host, ref) {
    var have = [['pdf', '📄 PDF로 열기', 'nrya-pdf'], ['hwp', '⬇ HWPX 다운로드', 'nrya-hwp']]
      .filter(function (b) { return /^https?:\/\//.test(String((ref || {})[b[0]] || '')); });
    if (!have.length) return 0;
    var row = document.createElement('div');
    row.className = have.length > 1 ? 'nrya-byl-big-row' : 'nrya-byl-dl';
    have.forEach(function (b) {
      var a = document.createElement('a');
      a.className = have.length > 1 ? ('nrya-byl-big-btn ' + b[2]) : 'nrya-byl-dl-link';
      a.textContent = b[1];
      a.href = ref[b[0]]; a.target = '_blank'; a.rel = 'noopener noreferrer';
      a.addEventListener('click', function (e) { e.preventDefault(); openDownloadUrl(a.href); });
      row.appendChild(a);
    });
    host.appendChild(row);
    return have.length;
  }

  /**
   * 답변이 인용한 조문에 딸린 **별지 서식**(신고서·신청서 등)을 바로 받을 수 있는 버튼 줄을 만든다.
   * (_CHATBOT.md 5-5 사용자 확정 — "질문에 관련된 별지 서식이 있으면 다운로드 버튼을 붙인다")
   * ★환각 0: 서버가 근거 조문 원문에서 실제로 판정한 목록(data.forms)만 그린다 — 화면에서 서식을
   *   찾거나 주소를 만들지 않는다.
   * ⚠ 0건이면 **빈 문자열**을 돌려준다(빈 상자·빈 줄이 남지 않게).
   * ⚠ 근거 법령 아코디언 **밖**에 그린다 — 접혀 있는 목록 안에 넣으면 지금 바로 눌러야 할 버튼이
   *   펼치기 전엔 안 보인다(공백 안내를 아코디언 밖으로 뺀 것과 같은 이유).
   * 예: renderFormDownloadsHTML([{title:'낚시어선업 신고서', law:'낚시 관리 및 육성법 시행규칙',
   *      key:'서식11', hwp:'https://…', pdf:''}])
   *     → '📄 서식 내려받기 / 「낚시어선업 신고서」 [⬇ 받기]' 한 줄
   * @param {Array} forms - 서버 응답의 forms([{law,tier,article,key,title,hwp,pdf}])
   * @returns {string} 버튼 줄 HTML(서식이 없으면 '')
   * [연계] ← answerHTML. → bindChat 의 위임 클릭(.nrya-form-dl) → openDownloadUrl.
   *          ← 서버 routes/legal.js pickFormRefs 가 폐지(삭제) 서식을 이미 걸러 보낸다.
   */
  function renderFormDownloadsHTML(forms) {
    var list = (forms || []).filter(function (f) {
      return f && (/^https?:\/\//.test(String(f.hwp || '')) || /^https?:\/\//.test(String(f.pdf || '')));
    });
    if (!list.length) return '';
    // HWP를 먼저 쓴다 — 국가법령정보센터가 서식 원본으로 주는 형식이 HWP뿐이라(PDF는 아직 수집
    // 전, _LESSONS.md L-55) 실제로는 거의 항상 HWP다. PDF가 채워지면 그때 자동으로 쓰인다.
    var h = '<div class="nrya-forms"><div class="nrya-forms-h">📄 서식 내려받기</div>';
    list.forEach(function (f) {
      var url = /^https?:\/\//.test(String(f.hwp || '')) ? f.hwp : f.pdf;
      // 제목이 비면(수집 원문에 제목이 없는 드문 경우) 지어내지 않고 서식 열쇠를 그대로 쓴다.
      var name = String(f.title || '').trim() || String(f.key || '서식');
      h += '<a class="nrya-form-dl" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="nrya-form-nm">「' + esc(name) + '」</span>' +
        '<span class="nrya-form-law">' + esc(String(f.law || '')) + '</span>' +
        '<span class="nrya-form-btn">⬇ 받기</span></a>';
    });
    return h + '</div>';
  }

  /**
   * 별표·서식 하나를 팝업으로 보여준다. 서버 판정(kind)에 따라 본문이 셋 중 하나로 갈리고,
   * **원본 파일 링크(hwp/pdf)는 kind 와 상관없이** 팝업 헤더(제목 옆)에 항상 붙는다.
   *  - text  : 우리가 가진 원문 표 — 괘선 표는 표로 다시 그리고, 산문은 접어서(pre-wrap) 보여준다
   *            (파싱이 어긋나면 원본 고정폭 <pre> 폴백)
   *  - image : 우리가 같이 수집해 둔 스캔본을 앱 안에서 바로
   *  - link  : law.go.kr 원본 파일만 있는 경우 — 안내 문구(본문) + 헤더의 다운로드 링크
   *  - missing : 아무것도 없다 — 지어내지 않고 "아직 수집하지 못했습니다"만 남긴다
   * @param {object} ref - 서버 refs 항목 {key,text,kind,title,body,image,pdf,hwp}
   * [연계] ← ensureArtPop 의 클릭 위임 · renderAnnexOnly. → PopupStack('nrya-bylpop').
   */
  /**
   * 별표·서식 스캔본 이미지를 차례로 붙인다(law.go.kr 원본 주소 — image/gif 가 그대로 내려온다).
   * 여러 장짜리 서식도 있어 배열을 그대로 순서대로 그린다.
   * @param {HTMLElement} host @param {string[]} urls
   * [연계] ← openBylPop. CSS `.nrya-bylpop-img` 는 기존 스캔본 표시와 같은 것을 쓴다.
   */
  function renderBylImages(host, urls) {
    urls.forEach(function (u) {
      var img = document.createElement('img');
      img.className = 'nrya-bylpop-img';
      img.loading = 'lazy';
      img.alt = '원본 이미지';
      img.src = u;
      host.appendChild(img);
    });
  }

  /** 이미지를 먼저 보여준 서식에서 "글자로 보기"를 눌러 원문 텍스트를 펼치는 버튼.
   * @param {HTMLElement} host @param {string} bodyText
   * [연계] ← openBylPop. → renderBylText. */
  function appendBylTextToggle(host, bodyText) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nrya-byl-toggle';
    btn.textContent = '글자로 보기';
    btn.addEventListener('click', function () {
      btn.remove();
      renderBylText(host, bodyText);
    });
    host.appendChild(btn);
  }

  /** 글자를 먼저 보여준 별표에서 "원본 이미지 보기"를 눌러 스캔본을 펼치는 버튼.
   * @param {HTMLElement} host @param {string[]} urls
   * [연계] ← openBylPop. → renderBylImages. */
  function appendBylImageToggle(host, urls) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'nrya-byl-toggle';
    btn.textContent = '원본 이미지 보기';
    btn.addEventListener('click', function () {
      btn.remove();
      renderBylImages(host, urls);
    });
    host.appendChild(btn);
  }

  /**
   * 이 별표 글자 안에 **표로 못 읽는 표**가 섞여 있나(= 아스키 그림으로 떨어질 표가 있나).
   * renderBylText 와 **같은 방식으로** 덩어리를 나눠 parseBylTable 을 미리 돌려 본다.
   * 예: bylHasAsciiTable(근해어업표원문) → true (한 줄에 글자와 표 선이 섞여 못 읽는다)
   * @param {string} text - 별표 원문
   * @returns {boolean}
   * [연계] ← openBylPop(무엇을 먼저 보여줄지 정한다). ↔ renderBylText(덩어리 나누는 규칙 동일).
   */
  function bylHasAsciiTable(text) {
    var seg = [], segIsTable = null, bad = false;
    function flush() {
      // 구분자 줄이 3개 이상이면 "사람이 표로 볼 것"으로 본다(그보다 적으면 표가 아니라 그림·머리줄).
      if (seg.length && segIsTable && seg.filter(function (l) { return /[│┃]/.test(l); }).length >= 3) {
        if (!parseBylTable(seg)) bad = true;
      }
      seg = [];
    }
    String(text || '').split('\n').forEach(function (ln) {
      var isTable = NRYA_BOX_RE.test(ln);
      if (segIsTable !== null && isTable !== segIsTable) flush();
      segIsTable = isTable;
      seg.push(ln);
    });
    flush();
    return bad;
  }

  function openBylPop(ref) {
    if (!ref) return;
    bylAutoOpened = false;          // 자동으로 연 경우는 renderAnnexOnly 가 곧바로 다시 세운다
    var pop = document.getElementById('nryaBylPop'), veil = document.getElementById('nryaBylVeil');
    var body = document.getElementById('nryaBylBody'); if (!pop || !veil || !body) return;
    var dl = document.getElementById('nryaBylDl');
    document.getElementById('nryaBylTitle').textContent =
      (ref.text || '') + (ref.title ? ' · ' + ref.title : '');
    body.innerHTML = '';
    if (dl) dl.innerHTML = '';                   // 팝업은 재사용된다 — 직전 별표의 버튼을 지운다
    // ★2026-08-18(사용자 확정): **서식(별지)은 이미지를 먼저** 보여준다 — 신고서 양식은 칸이
    //   중요한데 글자로 옮기면 옛 고정폭 표가 그대로 나와 알아보기 어렵다("아스키 그림"). 별표는
    //   반대로 글자가 나아(검색·복사가 되고 표가 깔끔하다) 지금처럼 글자를 먼저 두고, 이미지는
    //   아래 버튼으로 따로 볼 수 있게 한다. 실측: 서식 1,988건 중 1,980건(99.6%)에 이미지가 있다.
    var isForm = /서식/.test(String(ref.key || '') + String(ref.text || ''));
    var imgs = (ref.images && ref.images.length) ? ref.images : (ref.image ? [ref.image] : []);
    if (isForm && imgs.length) {
      renderBylImages(body, imgs);
      if (ref.body) appendBylTextToggle(body, ref.body);   // 글자로도 볼 수 있게(선택)
    } else if (ref.kind === 'text' && ref.body) {
      // ★2026-08-18(사용자 확정): 표로 못 읽는 표가 섞여 있으면 **원본 이미지를 먼저** 보여준다.
      //   아스키 그림(선을 글자로 그린 것)은 좁은 화면에서 읽을 수 없고, 원본 이미지는 법령에
      //   실린 표 그대로다 — "반드시 표를 봐야 하는 경우에는 아스키가 아니라 이미지가 나와야
      //   한다"(사용자 원문). 실측: 별표·별지 2,724건 중 2,679건(98.3%)에 원본 이미지가 있다.
      //   ⚠글자를 버리지는 않는다 — "글자로 보기"로 언제든 펼칠 수 있다(검색·복사가 되는 쪽).
      //   ⚠표가 전부 제대로 읽히는 별표는 **예전 그대로 글자 먼저** — 글자가 더 보기 좋다.
      if (imgs.length && bylHasAsciiTable(ref.body)) {
        renderBylImages(body, imgs);
        appendBylTextToggle(body, ref.body);
      } else {
        renderBylText(body, ref.body);
        if (imgs.length) appendBylImageToggle(body, imgs);   // 원본 스캔본 보기(선택)
      }
    } else if (imgs.length) {
      renderBylImages(body, imgs);
    } else if (ref.kind === 'image' && ref.image) {
      var img = document.createElement('img'); img.className = 'nrya-bylpop-img';
      img.alt = ref.title || '별표 원본 이미지';
      img.src = ref.image;                       // 우리 서버(GET /api/legal/src)가 주는 수집본
      body.appendChild(img);
    } else {
      // 표 텍스트가 없는 경우에만 나오는 안내 — text/image 에는 붙이지 않는다.
      var n = (/^https?:\/\//.test(String(ref.pdf || '')) ? 1 : 0) + (/^https?:\/\//.test(String(ref.hwp || '')) ? 1 : 0);
      var note = document.createElement('p'); note.className = 'nrya-byl-note';
      note.textContent = !n ? '원본을 아직 수집하지 못했습니다.'
        : (n > 1 ? 'law.go.kr에 원본 파일만 있고 표 텍스트는 없습니다 — 여는 방식을 골라주세요.'
                 : 'law.go.kr에 원본 파일만 있고 표 텍스트는 없습니다.');
      body.appendChild(note);
    }
    if (dl) appendBylDownloads(dl, ref);
    body.scrollTop = 0;
    veil.classList.add('nrya-open'); pop.classList.add('nrya-open');
    if (window.PopupStack) window.PopupStack.push('nrya-bylpop', closeBylPop);
  }

  /** 별표 팝업을 닫는다. 자동으로 열린 것(bylAutoOpened)이면 뒤의 조문 팝업도 함께 닫는다.
   *  PopupStack.remove 는 멱등이라 두 번 불러도 안전하다. */
  function closeBylPop() {
    if (window.PopupStack) window.PopupStack.remove('nrya-bylpop');
    var pop = document.getElementById('nryaBylPop'), veil = document.getElementById('nryaBylVeil');
    if (pop) pop.classList.remove('nrya-open');
    if (veil) veil.classList.remove('nrya-open');
    if (bylAutoOpened) { bylAutoOpened = false; closeArtPop(); }
  }

  /**
   * 조 하나(single)를 그린다 — 인용된 항(hit)은 tier 색 배경으로 강조하고 나머지는 흐리게 둔다.
   * 번호는 항 ①②③ · 호 1. 2. 3. · 목 가. 나. 다. 로, **원문에 적힌 것을 그대로** 쓴다.
   * ⚠ 호 번호를 화면에서 다시 매기면(예전 `(i + 1) + '. '`) 개정으로 끼워 넣은 가지번호 호가
   *   어긋난다 — 낚시관리및육성법 제53조②의 8번째 항목은 `8.`이 아니라 `6의2.`라서, 다시 매기면
   *   근거로 강조된 호와 화면에 적힌 번호가 서로 다른 조문을 가리키게 된다.
   * @param {HTMLElement} body - #nryaArtBody
   * @param {Array} paragraphs - 서버 응답 paragraphs [{mark,text,hit,items:[{label,text,hit,subs}]}]
   * [연계] ← renderArtPop. ← services/article_text.js splitHo()가 붙인 label.
   */
  function renderSingle(body, paragraphs) {
    (paragraphs || []).forEach(function (p) {
      var row = document.createElement('div');
      row.className = 'nrya-artpop-para' + (p.hit ? ' nrya-hit' : '');
      var mark = document.createElement('div'); mark.className = 'nrya-artpop-mark'; mark.textContent = p.mark || '';
      var wrap = document.createElement('div'); wrap.className = 'nrya-artpop-text';
      var t = document.createElement('span'); appendText(t, p.text); wrap.appendChild(t);
      if (p.items && p.items.length) {
        var ul = document.createElement('ul');
        // [계약2] 이 항에 강조된 호가 하나라도 있으면 표시해 둔다 — focused 모드에서 "그 호만"
        //   남기는 CSS 가 이 표시로 갈린다(호가 하나도 강조 안 된 항은 호를 다 보여준다:
        //   `제58조제5항`처럼 항까지만 특정한 인용에서 호를 통째로 감추면 안 되기 때문).
        ul.className = 'nrya-artpop-items' + (p.items.some(function (it) { return !!it.hit; }) ? ' nrya-has-hit' : '');
        p.items.forEach(function (it) {
          var li = document.createElement('li');
          li.appendChild(document.createTextNode((it.label || '') + '. '));
          appendText(li, it.text);
          if (it.hit) li.className = 'nrya-hit';
          if (it.subs && it.subs.length) {
            var sul = document.createElement('ul'); sul.className = 'nrya-artpop-subs';
            it.subs.forEach(function (s) {
              var sli = document.createElement('li');
              sli.appendChild(document.createTextNode((s.label || '') + '. '));
              appendText(sli, s.text);
              sul.appendChild(sli);
            });
            li.appendChild(sul);
          }
          ul.appendChild(li);
        });
        wrap.appendChild(ul);
      }
      row.appendChild(mark); row.appendChild(wrap); body.appendChild(row);
    });
  }

  /**
   * 범위·전체 인용을 그린다 — 조를 미니헤더(제N조 · 제목)로 구분해 **순서대로 나열**하고,
   * 어느 항도 강조하지 않는다(여러 조 전체가 근거라 한 곳을 칠하면 지어내는 것과 같다).
   * @param {HTMLElement} body - #nryaArtBody
   * @param {Array} articles - 서버 응답 articles [{jo,title,paragraphs}]
   * [연계] ← renderArtPop.
   */
  function renderArticles(body, articles) {
    (articles || []).forEach(function (a) {
      var blk = document.createElement('div'); blk.className = 'nrya-art-block';
      var head = document.createElement('div'); head.className = 'nrya-art-block-head';
      var num = document.createElement('span'); num.className = 'nrya-art-num'; num.textContent = a.jo || '';
      var ttl = document.createElement('span'); ttl.className = 'nrya-art-title'; ttl.textContent = a.title || '';
      head.appendChild(num); head.appendChild(ttl); blk.appendChild(head);
      var bd = document.createElement('div'); bd.className = 'nrya-art-body';
      (a.paragraphs || []).forEach(function (p, i) {
        // 항 기호가 없는 첫 조각(항 구분이 없는 조)은 줄바꿈 없이 본문에 바로 붙인다.
        if (!p.mark && i === 0) { appendText(bd, p.text); }
        else {
          var row = document.createElement('div'); row.className = 'nrya-art-para';
          var mk = document.createElement('span'); mk.className = 'nrya-art-mark'; mk.textContent = p.mark || '';
          var tx = document.createElement('span'); appendText(tx, p.text);
          row.appendChild(mk); row.appendChild(tx); bd.appendChild(row);
        }
        // 호·목 번호도 원문에 적힌 것을 그대로 쓴다(renderSingle 의 ⚠ 주석과 같은 이유).
        (p.items || []).forEach(function (it) {
          var r2 = document.createElement('div'); r2.className = 'nrya-art-para nrya-art-ho';
          var m2 = document.createElement('span'); m2.className = 'nrya-art-mark'; m2.textContent = (it.label || '') + '.';
          var t2 = document.createElement('span'); appendText(t2, it.text);
          r2.appendChild(m2); r2.appendChild(t2); bd.appendChild(r2);
          (it.subs || []).forEach(function (s) {
            var r3 = document.createElement('div'); r3.className = 'nrya-art-para nrya-art-mok';
            var m3 = document.createElement('span'); m3.className = 'nrya-art-mark'; m3.textContent = (s.label || '') + '.';
            var t3 = document.createElement('span'); appendText(t3, s.text);
            r3.appendChild(m3); r3.appendChild(t3); bd.appendChild(r3);
          });
        });
      });
      blk.appendChild(bd); body.appendChild(blk);
    });
  }

  /**
   * 조 없이 **별표만 가리킨 인용**(mode:'annex')을 그린다 — 조 본문이 없으므로 별표 목록만 낸다.
   * 열 수 있는 별표가 하나뿐이면 그 별표 팝업을 곧바로 띄운다(누를 곳을 한 번 더 찾게 하지 않는다).
   * 우리에게 없는 별표는 지어내지 않고 회색 "(원문 미수집)"으로 둔다.
   * @param {HTMLElement} body - #nryaArtBody
   * @param {object} d - article-text 응답(mode==='annex')
   * [연계] ← renderArtPop. → openBylPop(기존 별표 팝업 UI 그대로 재사용).
   */
  function renderAnnexOnly(body, d) {
    var refs = d.refs || [];
    var openable = refs.filter(function (r) { return r.kind !== 'missing'; });
    var list = document.createElement('div'); list.className = 'nrya-byl-list';
    refs.forEach(function (r) {
      var s = document.createElement('span');
      if (r.kind === 'missing') {
        s.className = 'nrya-byl-missing';
        s.textContent = r.key + ' (원문 미수집)';
      } else {
        s.className = 'nrya-byl-ref';
        s.setAttribute('data-byl', r.key);
        s.textContent = r.key + (r.title ? ' · ' + r.title : '');
      }
      list.appendChild(s);
    });
    body.appendChild(list);
    if (!openable.length) {
      var msg = document.createElement('div'); msg.className = 'nrya-artpop-msg';
      msg.textContent = '이 인용의 별표 원문을 아직 갖고 있지 않아요.';
      body.appendChild(msg);
      return;
    }
    if (refs.length === 1) { openBylPop(openable[0]); bylAutoOpened = true; }
  }

  /**
   * 서버가 준 조문 원문을 팝업 본문에 그린다. mode 에 따라 조 하나(강조 있음)와
   * 나열·범위·전체(강조 없음)로 갈리고, 조 없이 별표만 가리킨 인용(annex)은 별표 목록만 낸다.
   * 원문이 너무 길면 정직하게 국가법령정보센터로 넘긴다.
   * 원문 텍스트는 전부 textContent/텍스트노드로 넣는다(HTML 주입 없음).
   * @param {object} d - GET /api/legal/article-text 응답
   * [연계] ← openArtPop. → renderSingle · renderArticles · appendText.
   */
  function renderArtPop(d) {
    var body = document.getElementById('nryaArtBody'); if (!body) return;
    var foot = document.getElementById('nryaArtFoot');
    body.innerHTML = ''; if (foot) foot.innerHTML = '';
    body.classList.remove('nrya-focused');   // 이전 조문에서 켜둔 focused 가 남지 않게
    artPopRefs = {};
    artPopRefsCut = !!d.refsTruncated;
    (d.refs || []).forEach(function (r) { artPopRefs[r.key] = r; });

    if (d.mode === 'annex') {
      renderAnnexOnly(body, d);
    } else if (d.tooLong) {
      // 수십 개 조를 억지로 밀어넣지 않는다 — 원문 소재를 정직하게 안내한다.
      var msg = document.createElement('div'); msg.className = 'nrya-artpop-msg';
      msg.textContent = '원문이 깁니다(' + d.tooLong.articleCount + '개조) · 국가법령정보센터에서 확인하세요';
      body.appendChild(msg);
      var a = document.createElement('a');
      a.className = 'nrya-byl-big-btn nrya-pdf';
      a.textContent = '🔗 국가법령정보센터에서 보기';
      a.href = (d.tier === 'notice' ? 'https://www.law.go.kr/admRulSc.do?query=' : 'https://www.law.go.kr/lsSc.do?query=') +
        encodeURIComponent(d.law || '');
      a.target = '_blank'; a.rel = 'noopener noreferrer';
      body.appendChild(a);
    } else if (d.articles) {
      renderArticles(body, d.articles);
      // 나열 인용(`제53조·제55조`)에서 원문을 못 찾은 조가 있으면 조용히 빼지 않고 밝힌다 —
      // 안 그러면 절반만 보고도 인용된 조를 전부 본 줄 안다.
      if (d.missing && d.missing.length) {
        var miss = document.createElement('div'); miss.className = 'nrya-artpop-msg';
        miss.textContent = d.missing.join('·') + '는 원문에서 찾지 못했어요(표시 ' +
          d.articles.length + '개조 / 인용 ' + (d.articles.length + d.missing.length) + '개조).';
        body.appendChild(miss);
      }
    } else {
      renderSingle(body, d.paragraphs);
      // [계약2] focused:true = 요청한 표기가 항·호까지 특정했다(`제58조제5항제7호`) → 그 항의
      //   머리문장과 그 호만 남긴다. 나머지는 지우지 않고 **CSS 로 감추기만** 하므로 아래
      //   "조문 전체 보기"가 재조회 없이 그 자리에서 펼친다.
      //   ⚠강조된 항이 하나도 없으면 접지 않는다 — 그대로 접으면 본문이 통째로 사라져 빈 팝업이 된다.
      if (d.focused && (d.paragraphs || []).some(function (p) { return !!(p && p.hit); })) {
        body.classList.add('nrya-focused');
        if (foot) {
          var moreBtn = document.createElement('button');   // 아래 별표 목록의 `more` 와 이름 겹치지 않게
          moreBtn.type = 'button'; moreBtn.className = 'nrya-artpop-more';
          moreBtn.textContent = '조문 전체 보기';
          foot.appendChild(moreBtn);
        }
      }
    }

    // 문서에 딸린 별표 목록 — 본문에서 인용되지 않은 별표도 여기서 바로 열 수 있게 한다.
    // 열 수 있는 것만 칩으로 두고, 서버가 판정 한도(refs 상한)를 넘겨 못 보낸 나머지는
    // 열리지 않는 칩을 만들지 않고 개수만 정직하게 적는다.
    if (foot && d.attachments && d.attachments.length) {
      var lbl = document.createElement('span'); lbl.className = 'nrya-artpop-src';
      lbl.textContent = '이 문서의 별표';
      foot.appendChild(lbl);
      var shown = 0;
      d.attachments.forEach(function (at) {
        var ref = artPopRefs[at.key];
        if (!ref || ref.kind === 'missing') return;
        shown++;
        var s = document.createElement('span');
        s.className = 'nrya-byl-ref';
        s.setAttribute('data-byl', at.key);
        s.textContent = at.key;
        foot.appendChild(s);
      });
      if (shown < d.attachments.length) {
        var more = document.createElement('span'); more.className = 'nrya-byl-missing';
        more.textContent = '외 ' + (d.attachments.length - shown) + '개';
        foot.appendChild(more);
      }
    }

    // [계약3] 부칙(addenda)은 서버가 본문 항과 분리해 따로 보낸다 — 기본은 접어두고 눌러야 펼친다
    // (조문을 보러 온 사람에게 부칙 전문이 먼저 쏟아지지 않게). 글자는 textContent 로만 넣는다.
    if (d.addenda) {
      var adBox = document.createElement('div'); adBox.className = 'nrya-addenda';
      var adT = document.createElement('div'); adT.className = 'nrya-addenda-t'; adT.textContent = '부칙 보기';
      var adB = document.createElement('div'); adB.className = 'nrya-addenda-b'; adB.textContent = String(d.addenda);
      adBox.appendChild(adT); adBox.appendChild(adB); body.appendChild(adBox);
    }
    body.scrollTop = 0;
  }

  /**
   * 조문 카드를 눌렀을 때: 팝업을 먼저 띄워 "불러오는 중"을 보여주고, 원문을 받아 채운다.
   * 원문을 못 받으면(수집 안 된 고시·서버 토큰 없음 등) 지어내지 않고 안내 문구만 남긴다.
   * 범위·전체 인용은 조를 강조할 수 없으므로 위키 표의 **요지를 그대로** 캡션으로 보여준다.
   * 예: openArtPop(카드요소) → GET /api/legal/article-text?law=…&article=제10조④3호&tier=law
   * @param {HTMLElement} el - .nrya-chain-hit (data-law/article/tier/base/gist 를 갖고 있다)
   * [연계] → routes/legal.js GET /api/legal/article-text · PopupStack('nrya-artpop').
   */
  function openArtPop(el) {
    ensureArtPop();
    var pop = document.getElementById('nryaArtPop'), veil = document.getElementById('nryaArtVeil');
    if (!pop || !veil) return;
    var law = el.getAttribute('data-law') || '';
    var article = el.getAttribute('data-article') || '';
    var tier = el.getAttribute('data-tier') || 'law';
    var gist = el.getAttribute('data-gist') || '';
    var chip = document.getElementById('nryaArtChip');
    chip.className = 'nrya-artpop-chip'; chip.textContent = '';   // 조 하나면 빈 채로 둔다
    // ⚠제목에 찍는 이름과 서버에 보내는 이름은 다르다. `law`(data-law)는 원문을 찾을 때 쓰는
    //   값이라 그대로 두고, 제목에는 계층 낱말뿐인 이름에 페이지의 법을 붙인 것을 쓴다
    //   (chainStepHTML 이 data-lawshow 로 실어 보낸다 — displayLawName 참고).
    //   실어 오지 않은 옛 기록이면 예전처럼 law 를 그대로 쓴다(나빠지지 않게).
    document.getElementById('nryaArtLaw').textContent = el.getAttribute('data-lawshow') || law;
    document.getElementById('nryaArtTitle').textContent = article || '조문 원문';
    document.getElementById('nryaArtEff').textContent = '';
    document.getElementById('nryaArtGist').textContent = '';
    document.getElementById('nryaArtFoot').innerHTML = '';
    // 눌린 글자에 심어둔 소관부서 연락처(citeHTML 의 data-*)를 그대로 보여준다 — 서버 재조회 없음.
    var telHost = document.getElementById('nryaArtTel');
    if (telHost) telHost.innerHTML = contactLineHTML({
      소관부처명: el.getAttribute('data-min') || '', 부서명: el.getAttribute('data-dept') || '',
      전화번호: el.getAttribute('data-tel') || '',
    });
    document.getElementById('nryaArtBody').innerHTML = '<div class="nrya-artpop-msg">원문을 불러오는 중…</div>';
    pop.setAttribute('data-tier', el.getAttribute('data-pen') ? 'penalty' : tier); // 강조색을 체인 카드와 맞춘다
    veil.classList.add('nrya-open'); pop.classList.add('nrya-open');
    if (window.PopupStack) window.PopupStack.push('nrya-artpop', closeArtPop);

    var myReq = ++artPopReq;
    legalGet('/api/legal/article-text?law=' + encodeURIComponent(law) +
      '&article=' + encodeURIComponent(article) +
      '&tier=' + encodeURIComponent(tier) +
      '&baseLaw=' + encodeURIComponent(el.getAttribute('data-base') || ''))
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (d) {
        // 기다리는 사이 닫았거나 다른 조문을 다시 눌렀으면 그리지 않는다(엉뚱한 조문 표시 방지)
        if (myReq !== artPopReq || !pop.classList.contains('nrya-open')) return;
        if (!d || !d.ok) {
          document.getElementById('nryaArtBody').innerHTML =
            '<div class="nrya-artpop-msg">원문을 불러오지 못했어요. 위 요지와 소관부서 연락처를 확인해 주세요.</div>';
          return;
        }
        if (d.articleTitle) document.getElementById('nryaArtTitle').textContent = d.articleTitle;
        document.getElementById('nryaArtEff').textContent = d.effectiveDate
          ? ((d.tier === 'notice' ? '발령일자 ' : '시행일자 ') + d.effectiveDate) : '';
        if (d.mode && d.mode !== 'single') {
          // 조 하나를 못 짚으므로 강조 대신 위키 표의 요지를 **가공 없이** 캡션으로 보여준다.
          chip.className = 'nrya-artpop-chip nrya-range';
          chip.textContent = '원문 · ' + artScopeLabel(d);
          if (gist) {
            var g = document.getElementById('nryaArtGist');
            var b = document.createElement('b'); b.textContent = '이 인용의 요지';
            g.appendChild(b); g.appendChild(document.createTextNode(' — ' + gist));
          }
        }
        renderArtPop(d);
      });
  }

  /**
   * 범위·전체 인용 팝업의 칩 문구를 만든다(예: '문서 전체(4개조 + 별표 2)', '제1조~제9조 (9개조)').
   * 개수는 **실제로 나열된 조 수**다 — 범위 안에 삭제된 조가 있으면 표기된 범위보다 적을 수 있어
   * "전체"라고 단정하지 않는다(`제3조~제7조 (2개조 전체)` 같은 모순 표기 방지).
   * @param {object} d - article-text 응답
   * @returns {string}
   * [연계] ← openArtPop.
   */
  function artScopeLabel(d) {
    // 조 없이 별표만 가리킨 인용은 "몇 개조"가 없다 — 별표 건수로 적는다.
    if (d.mode === 'annex') return '별표·서식 ' + (d.refs || []).length + '건';
    var att = (d.attachments && d.attachments.length) ? ' + 별표 ' + d.attachments.length : '';
    if (d.tooLong) return (d.mode === 'whole' ? '문서 전체' : d.articleTitle) + '(' + d.tooLong.articleCount + '개조' + att + ')';
    var n = (d.articles || []).length;
    if (d.mode === 'whole') return '문서 전체(' + n + '개조' + att + ')';
    return d.articleTitle + ' (' + n + '개조' + att + ')';
  }

  /** 조문 팝업을 닫는다(백스택에서 제거 + 표시 해제). 위에 떠 있던 별표 팝업도 같이 닫는다. */
  function closeArtPop() {
    bylAutoOpened = false;   // 먼저 끈다 — 안 그러면 아래 closeBylPop 이 여기를 다시 부른다
    closeBylPop();
    if (window.PopupStack) window.PopupStack.remove('nrya-artpop');
    var pop = document.getElementById('nryaArtPop'), veil = document.getElementById('nryaArtVeil');
    if (pop) pop.classList.remove('nrya-open');
    if (veil) veil.classList.remove('nrya-open');
  }

  /**
   * NDJSON 스트림(POST /api/legal/ask 응답)을 읽어 답변 조각(delta)마다 콜백을 부르고,
   * 마지막 done 라인을 파싱해 반환한다. 스트리밍 미지원 환경(res.body.getReader 없음)이면
   * 전체 텍스트를 한 번에 받아 done 라인만 파싱하는 방식으로 안전하게 폴백한다.
   * @param {Response} res - fetch 응답(legalPost 결과)
   * @param {(text:string)=>void} onDelta - 답변 조각이 도착할 때마다 호출
   * @returns {Promise<object>} done 라인 payload(못 받으면 {ok:false})
   * [연계] ← doSend. → POST /api/legal/ask 의 NDJSON 스트림 소비.
   */
  function readNdjsonStream(res, onDelta) {
    function consumeLines(text) {
      var done = null;
      text.split('\n').forEach(function (line) {
        line = line.trim(); if (!line) return;
        var obj; try { obj = JSON.parse(line); } catch (e) { return; }
        if (obj.type === 'delta' && obj.text) onDelta(obj.text);
        else if (obj.type === 'done') done = obj;
      });
      return done;
    }
    if (!res.body || !res.body.getReader) {
      return res.text().then(function (txt) { return consumeLines(txt) || { ok: false }; });
    }
    var reader = res.body.getReader();
    var decoder = new TextDecoder('utf-8');
    var buf = '', doneObj = null;
    function pump() {
      return reader.read().then(function (result) {
        if (result.done) {
          if (buf) doneObj = consumeLines(buf) || doneObj;
          return doneObj || { ok: false };
        }
        buf += decoder.decode(result.value, { stream: true });
        var lines = buf.split('\n');
        buf = lines.pop(); // 마지막 조각은 아직 미완성일 수 있어 다음 read로 넘김
        doneObj = consumeLines(lines.join('\n')) || doneObj;
        return pump();
      });
    }
    return pump();
  }

  // ── 답변완료 알림 동의 배너(6초 넘게 걸릴 때만) ────────────────────────

  /**
   * 나리야 말풍선 한 줄을 만들어 채팅창 맨 아래에 붙이고 그 말풍선 요소를 돌려준다.
   * 예: appendAiRow('<b>안녕</b>') → 아바타+이름+말풍선 행이 추가되고 .nrya-kbub 반환
   * @param {string} innerHTML - 말풍선 안에 넣을 HTML(호출자가 이스케이프 책임)
   * @param {string} [rowId] - 나중에 찾아 지우려면 붙일 행 id
   * @returns {HTMLElement|null} 말풍선(.nrya-kbub) 요소
   * [연계] ← showNotifyConsentBanner, renderRestoredAnswer, renderExpiredNotice —
   *          doSend 가 쓰는 것과 같은 말풍선 골격을 재사용하려고 뽑았다.
   */
  function appendAiRow(innerHTML, rowId) {
    var body = document.getElementById('nryaChatBody'); if (!body) return null;
    var row = document.createElement('div'); row.className = 'nrya-krow nrya-ai';
    if (rowId) row.id = rowId;
    // ⑦2026-09-09: 아바타(.nrya-kava)를 뺀다 — 이 함수가 doSend·복원 화면과 **같은 골격**을 쓰므로
    //   여기 한 줄이 답변·안내 말풍선 전부의 왼쪽 여백을 결정한다.
    row.innerHTML = '<div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow">' +
      '<div class="nrya-kbub nrya-ai"></div></div></div>';
    var bub = row.querySelector('.nrya-kbub');
    bub.innerHTML = innerHTML;
    body.appendChild(row); body.scrollTop = body.scrollHeight;
    return bub;
  }

  /**
   * "답변이 좀 걸리고 있어요. 완료되면 알림 드릴까요?" 동의 배너를 채팅창에 띄운다.
   * [허용]을 누르면 지금 기다리고 있는 이 질문에도 뒤늦게 알림이 걸린다(POST /api/legal/notify-me
   * 로 이미 떠난 요청에 askId로 표시) — 화면 밖으로 나가도 이번 답도 놓치지 않는다. 물론 다음
   * 질문부터는 처음부터 옵트인 상태로 보내지므로 이 배너 자체가 다시 뜨지 않는다.
   * [허용 안 함] 배너만 닫는다(설정 변경 없음).
   * @param {string} askId - 지금 기다리는 중인 질문의 접수번호(doSend가 발급) — notify-me 상관키.
   * [연계] ← doSend 의 6초 타이머. → notiSettings().set, requestPushPermissionIfNeeded,
   *          POST /api/legal/notify-me.
   */
  function showNotifyConsentBanner(askId) {
    if (document.getElementById('nryaNotifyAsk')) return;   // 이미 떠 있으면 중복 금지
    var bub = appendAiRow(
      '답변이 좀 걸리고 있어요. 완료되면 알림 드릴까요?' +
      '<div class="nrya-consent-btns">' +
        '<button type="button" class="nrya-consent-btn nrya-yes">허용</button>' +
        '<button type="button" class="nrya-consent-btn nrya-no">허용 안 함</button>' +
      '</div>', 'nryaNotifyAsk');
    if (!bub) return;
    var row = document.getElementById('nryaNotifyAsk');
    bub.querySelector('.nrya-yes').addEventListener('click', function () {
      var ns = notiSettings();
      if (ns && typeof ns.set === 'function') ns.set({ aiAnswer: true });  // 저장 + 서버 동기화(다음 질문부터)
      requestPushPermissionIfNeeded();
      legalPost('/api/legal/notify-me', { askId: askId }).catch(function () {});  // 지금 이 질문에도 뒤늦게 걸기
      bub.textContent = '완료되면 알려드릴게요';
      setTimeout(function () { if (row) row.remove(); }, 2500);
    });
    bub.querySelector('.nrya-no').addEventListener('click', function () { if (row) row.remove(); });
  }

  /**
   * 푸시 권한이 아직 '미결정(prompt)' 이면 시스템 권한 요청을 띄우고, 허용되면 등록까지 한다.
   * 이미 허용됐거나 거부됐거나(설정에서만 변경 가능) 웹이면 아무 것도 하지 않는다.
   * [연계] ← 동의 배너 [허용]. → window.checkPushPermission(capacitor-plugins.js),
   *          PushNotifications.requestPermissions/register — 설정 화면 마스터 토글과 같은 흐름.
   */
  function requestPushPermissionIfNeeded() {
    try {
      if (!window.Capacitor || typeof window.Capacitor.isNativePlatform !== 'function' || !window.Capacitor.isNativePlatform()) return;
      var P = window.Capacitor.Plugins && window.Capacitor.Plugins.PushNotifications; if (!P) return;
      if (typeof window.checkPushPermission !== 'function') return;
      window.checkPushPermission().then(function (perm) {
        if (perm !== 'prompt') return;
        return P.requestPermissions().then(function (r) {
          if (r && r.receive === 'granted' && P.register) P.register();   // 등록 → registration 리스너가 subscribeUser 호출
        });
      }).catch(function () { /* 권한 흐름 실패는 무시(알림만 안 올 뿐) */ });
    } catch (_) { /* 방어적 — 무시 */ }
  }

  /**
   * 이 대화 기억이 아직 살아 있나(마지막 답변에서 6시간 안). 지났으면 비우고 false.
   * @returns {boolean}
   * [연계] ← rememberTurn · chatMemoryForSend.
   */
  function chatMemoryAlive() {
    if (!chatTurns.length) return false;
    if (Date.now() - lastTurnAt < CHAT_MEMORY_TTL_MS) return true;
    chatTurns = []; lastTurnAt = 0;      // 시간이 지난 대화는 이어지지 않는다(사용자 확정)
    return false;
  }

  /** 이어 묻기를 그만두거나(🆕 다른 종류의 질문) 새 질문을 직접 타이핑했을 때 기억을 비운다. */
  function forgetChatMemory() { chatTurns = []; lastTurnAt = 0; }

  /**
   * 방금 주고받은 한 턴을 기억에 쌓는다. 쌓인 길이가 상한을 넘으면 오래된 턴부터 줄인다.
   * 줄이는 방법: **최근 몇 턴은 통째로**, 그보다 오래된 턴은 **질문 + 답변 첫 문단**만 남긴다.
   * 답변 첫 문단은 답변 원칙 6번이 강제하는 "쉽게 말하면 ~" 결론 요약이라 **그 자체가 요약**이다
   * — AI를 다시 불러 요약할 필요가 없다(비용 0, 요약하다 뜻이 뒤틀릴 위험 0).
   * @param {string} q - 사용자가 보낸 질의(되묻기로 누적된 문자열 그대로)
   * @param {string} a - 그 답변 본문
   * [연계] ← doSend(최종 답변을 그린 뒤). → chatMemoryForSend.
   */
  function rememberTurn(q, a) {
    if (!q || !a) return;
    if (!chatMemoryAlive()) chatTurns = [];      // 시간이 지났으면 이번 턴부터 새 대화
    chatTurns.push({ q: String(q), a: String(a) });
    if (chatTurns.length > CHAT_MEMORY_MAX_TURNS) chatTurns = chatTurns.slice(-CHAT_MEMORY_MAX_TURNS);
    lastTurnAt = Date.now();
    var total = 0, i;
    for (i = 0; i < chatTurns.length; i++) total += chatTurns[i].q.length + chatTurns[i].a.length;
    if (total <= CHAT_MEMORY_MAX_CHARS) return;
    for (i = 0; i < chatTurns.length - CHAT_MEMORY_KEEP_FULL; i++) {
      chatTurns[i].a = firstParagraph(chatTurns[i].a);
    }
  }

  /**
   * 답변에서 **첫 문단**만 잘라 온다(답변 원칙 6번의 "쉽게 말하면 ~" 결론 요약).
   * 빈 줄이 없으면 첫 문장까지만, 그것도 없으면 앞 300자까지.
   * 예: firstParagraph('쉽게 말하면, 신고제입니다.\n\n자세히는…') → '쉽게 말하면, 신고제입니다.'
   * @param {string} a @returns {string}
   * [연계] ← rememberTurn(오래된 턴 줄이기).
   */
  function firstParagraph(a) {
    var t = String(a || '').trim();
    var cut = t.indexOf('\n\n');
    if (cut > 0) return t.slice(0, cut).trim();
    var dot = t.indexOf('다.');
    if (dot > 0) return t.slice(0, dot + 2);
    return t.slice(0, 300);
  }

  /**
   * 서버로 보낼 대화 기억을 만든다. 이어 묻는 중(맥락 있음)일 때만 실어 보낸다.
   * @returns {Array<{q:string,a:string}>|null} 보낼 것이 없으면 null(요청 본문에 필드 자체를 안 넣는다)
   * [연계] → POST /api/legal/ask 의 `history`. 서버는 이 값을 **검색어에 섞지 않는다**(R2).
   */
  function chatMemoryForSend() {
    if (!chatMemoryAlive()) return null;
    return chatTurns.map(function (t) { return { q: t.q, a: t.a }; });
  }

  /** 답을 되찾는 동안 보여줄 말풍선 속. 스피너 하나와 한 줄 설명. @returns {string} */
  function recoveringHTML() {
    return '<div class="nrya-recover"><span class="nrya-spin" aria-hidden="true"></span>' +
      '답변을 가져오는 중이에요… 잠시만요.</div>';
  }

  /**
   * 연결이 끊긴 질문의 답을 **서버 보관본에서** 되찾아 온다(AI를 다시 부르지 않는다 = 비용 0).
   * 앱이 앞으로 나와 있을 때만 물어보고, 아직 만드는 중이면 잠시 뒤 다시 묻는다.
   * ⚠ 화면이 뒤에 있는 동안에는 묻지 않는다 — 백그라운드에서 부질없이 두드리지 않게.
   * 예: recoverAnswer('ask_1755_ab12') → done 과 같은 모양의 응답, 끝내 못 찾으면 null
   * @param {string} askId - 그 질문의 접수번호(doSend 가 발급해 서버로 보낸 값)
   * @returns {Promise<object|null>}
   * [연계] ← doSend(_neterr 경로). → GET /api/legal/answer-by-ask/:askId.
   */
  function recoverAnswer(askId) {
    if (!askId) return Promise.resolve(null);
    var tries = 0;
    return new Promise(function (resolve) {
      function ask() {
        // 서버 보관 조건이 "6초 넘게 걸린 답변"이라, 그보다 빨리 끝난 질문은 보관본이 아예 없다.
        // 그런 질문은 백그라운드로 내려갈 틈도 없었다는 뜻이라 여기서 정직하게 포기한다.
        if (tries++ >= RECOVER_TRIES) return resolve(null);
        if (document.hidden) return setTimeout(ask, RECOVER_EVERY_MS);   // 뒤에 있으면 그냥 기다린다
        legalGet('/api/legal/answer-by-ask/' + encodeURIComponent(askId))
          .then(function (r) { return r.json(); })
          .catch(function () { return null; })
          .then(function (d) {
            if (d && d.ok) return resolve(d);
            setTimeout(ask, RECOVER_EVERY_MS);
          });
      }
      ask();
    });
  }

  /**
   * 채팅 입력을 서버 /api/legal/ask 로 보내고, 생각중 애니메이션 후 답변을 스트리밍으로
   * (조각조각 타이핑되듯) 렌더한다. 근거 법령 아코디언·좌표 미니지도는 스트림이 끝난
   * done 시점에 최종 렌더로 붙는다. 실패 시 안전한 폴백 말풍선을 띄운다(빈 화면 없음).
   * ⚠ 스트리밍은 체감 대기시간만 줄인다 — 실제 생성시간은 그대로다.
   * [연계] → POST /api/legal/ask, readNdjsonStream.
   * @param {object} [sendCtx] - 확인 버튼이 들고 있던 ctx(H-37 §3.2). 없으면 pendingCtx → 없으면 미전송.
   * @param {HTMLElement} [failBox] - 그 버튼이 속한 되묻기 묶음(전송 실패 시 다시 누를 수 있게 되돌린다)
   * @param {boolean} [hideMe] - true면 내 말풍선을 **그리지 않는다**(되묻기 버튼으로 온 요청 전용).
   *                             서버로 보내는 질의 문자열은 그대로다 — 화면 표시만 생략한다.
   */
  function doSend(sendCtx, failBox, hideMe) {
    var body = document.getElementById('nryaChatBody');
    var input = document.getElementById('nryaChatInput');
    if (!body || !input) return;
    var q = (input.value || '').trim();
    if (!q) q = '특정해역에서 야간 조업 제한이 있어?';
    if (isHistoryOpen()) closeHistory(true);   // 기록 목록을 보다가 질문하면 대화 화면으로 돌아온다
    if (isProfOpen()) closeProf();
    // [H-37 §3.2] 이번 요청에 실을 대기 맥락(ctx).
    //   ①선택지 버튼으로 온 요청이면 pickClarifyOption 이 만들어 준 ctx(버튼의 ctx + 직전 맥락)
    //   ②"다시 설명할게요"를 누른 직후 사용자가 손으로 친 문장이면 그때 예약해 둔 pendingCtx
    //   ③그 밖에는 **없음**(= 사용자가 새로 타이핑한 질문은 맥락을 비우고 시작한다 — 설계 §9.1 #1).
    //   어느 경우에도 `query` 문자열에는 아무것도 덧붙이지 않는다.
    //   ★sendCtx 가 없다 = 버튼이 아니라 입력창에서 온 새 질문이다 → 이어받을 맥락도 함께 버린다
    //     (2026-08-14 F2 수정: lastCtx 가 새 질문으로 새면 안 된다).
    if (!sendCtx) lastCtx = null;
    var ctx = sendCtx || pendingCtx || null;
    pendingCtx = null;
    // ⚠기억을 버리는 판단은 **ctx 를 정한 뒤에** 한다 — "🔁 관련해서 더 궁금해요"를 누르고 손으로
    //   친 질문은 sendCtx 가 없고 pendingCtx 로 들어오므로, 위에서 버리면 이어 묻기가 통째로 죽는다.
    if (!ctx) forgetChatMemory();
    setChatPlaceholder(false);
    chatPending++;                 // 답이 올 때까지는 채팅창을 홈으로 비우지 않는다(resetToHome)

    // 내 말풍선. ★되묻기 선택지로 보낸 요청(hideMe)은 **그리지 않는다** — 라운드마다
    //   "원래질문 — 라벨1 — 라벨2"가 통째로 다시 뜨면서 화면에 누적되기 때문이다(사용자 확정).
    //   ⚠함정: 화면에만 안 그리는 것이고 **서버로 가는 q 는 그대로 누적된 문자열**이다 — 서버는
    //     그 문자열의 결합자(' — ') 개수로 되묻기 라운드 수를 세어 무한루프를 막는다
    //     (_CHATBOT.md 1-B). 여기서 q 를 짧게 만들면 그 방어가 통째로 깨진다.
    //     같은 이유로 pushHistory·feedbackHTML 의 data-q 에도 누적 문자열을 그대로 남긴다
    //     (나중에 "어떤 조건에서 나온 답인지" 재현해야 하므로).
    //   "전송됐다"는 신호는 바로 아래 생각중(스켈레톤) 말풍선이 대신한다.
    if (!hideMe) {
      var me = document.createElement('div'); me.className = 'nrya-krow nrya-me';
      me.innerHTML = '<div class="nrya-kbrow"><div class="nrya-kbub"></div></div>';
      me.querySelector('.nrya-kbub').textContent = q;
      body.appendChild(me);
    }
    input.value = ''; body.scrollTop = body.scrollHeight;

    // 생각중(스켈레톤 + 상태 텍스트)
    var th = document.createElement('div'); th.className = 'nrya-krow nrya-ai';
    // ⑦아바타를 뺀다. "생각 중"의 펄스 애니메이션은 헤더 오브(#nryaChatOrb, 아래 nrya-think)가
    //   그대로 맡는다. 답변이 오면 말풍선이 옆으로 튀지 않게 생각중 행도 같이 빼야 한다.
    th.innerHTML = '<div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">' +
      '<div class="nrya-sk-line" style="width:130px"></div><div class="nrya-sk-line" style="width:90px"></div>' +
      '<div class="nrya-think-status"><span class="nrya-ts">생각하고 있습니다</span><span class="nrya-think-dots"><i></i><i></i><i></i></span></div></div></div></div>';
    body.appendChild(th); body.scrollTop = body.scrollHeight;
    var orb = document.getElementById('nryaChatOrb'); if (orb) orb.classList.add('nrya-think');
    var i = 0, tsEl = th.querySelector('.nrya-ts');
    var iv = setInterval(function () { i++; if (i < STEPS.length) tsEl.textContent = STEPS[i]; }, 850);

    var startedAt = Date.now(), hadDelta = false, bubbleEl = null, accumulated = '';
    var MIN_THINK_MS = 850 * 2; // 근거 없음 등 즉답 케이스에서 생각중이 순간 깜빡이지 않게 하는 최소 노출시간

    /** 첫 delta 도착 시 생각중 말풍선을 실제 답변 말풍선으로 교체(1회만). */
    function ensureAnswerBubble() {
      if (bubbleEl) return;
      clearInterval(iv); if (orb) orb.classList.remove('nrya-think'); th.remove();
      var a = document.createElement('div'); a.className = 'nrya-krow nrya-ai';
      a.innerHTML = '<div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai"></div></div></div>';
      body.appendChild(a);
      bubbleEl = a.querySelector('.nrya-kbub');
    }

    // [답변완료 알림] 이미 켠 사용자면 서버에 "다 되면 푸시 보내달라"고 알린다(6초 초과 시 서버가 발송).
    //   아직 안 켰다면 6초 뒤에 인라인 동의 배너를 띄운다 — [허용]을 누르면 이 askId로 지금 이
    //   요청에도 뒤늦게 알림이 걸린다(빨리 끝나면 아래 타이머 취소, 배너 자체가 안 뜬다).
    var optedIn = aiAnswerOptedIn();
    var askId = 'ask_' + Date.now() + '_' + Math.random().toString(36).substring(2, 10);
    if (activeConsentTimer) { clearTimeout(activeConsentTimer); activeConsentTimer = null; } // 이전 질문분 정리
    if (!optedIn) {
      activeConsentTimer = setTimeout(function () {
        activeConsentTimer = null; showNotifyConsentBanner(askId);
      }, CONSENT_ASK_MS);
    }

    // [H-37 §7.3] 프로필 스냅샷은 값이 하나라도 있을 때만 싣는다(없으면 필드 자체를 안 보낸다 —
    //   그러면 서버 전 경로가 no-op 이라 응답이 종전과 바이트 동일하다).
    var profile = loadProfile();
    var ask = { query: q, deviceId: getDeviceId(), notifyOnComplete: optedIn, askId: askId };
    if (ctx) ask.ctx = ctx;
    // [대화 기억] 이어 묻는 중일 때만 직전까지의 대화를 통째로 싣는다(2026-08-18 사용자 확정).
    //   ⚠ `query` 문자열에는 아무것도 덧붙이지 않는다 — 검색어 오염 방지(R2).
    //   맥락이 없는 새 질문(ctx 없음)에는 안 싣는다 → 서버 요청 본문이 오늘과 바이트 동일(R0).
    if (ctx) { var hist = chatMemoryForSend(); if (hist && hist.length) ask.history = hist; }
    if (Object.keys(profile.fields).length) ask.profile = profile;
    // [H-37 최소 절충안] 직전 질문을 실어 보낸다(lastCtx와 무관 — 새 질문 타이핑에도 안 비운다).
    // ⚠ 2026-08-18 실사용 재현 버그: 되묻기 확인 버튼(이해확인·상황질문 등, hideMe=true)도 이
    //   함수를 거치므로, 예전엔 여기서 매번 lastQuestionText = q 로 덮어썼다 — 그러면 "네, 맞아요"를
    //   눌러 **같은 질문**을 ctx만 얹어 다시 보내는 확인 라운드에서 lastQuestionText 가 이미 그
    //   질문 자신과 같아져("낚시어선업 신고 안 하면?" → 확인 → 재전송 시점엔 lastQuestionText도
    //   똑같이 "낚시어선업 신고 안 하면?") 정작 decideClarify 가 실행되는 시점(확인이 다 끝난 뒤)엔
    //   ask.lastQuestion 이 통째로 안 실려, "🔁 이어서" 버튼으로 이어붙인 직전 주제가 사라지고
    //   엉뚱한 일반 되묻기로 튀었다(라이브 재현: 신고 요건 질문 뒤 "신고 안 하면?"을 이어 물었는데
    //   낚시어선업과 무관한 "무슨 어업을 하셨나요"가 나옴). **사용자가 직접 새로 타이핑했을 때만**
    //   (hideMe 가 없을 때만) 갱신해, 같은 질문의 확인 라운드 내내 "그 이전 질문"이 살아남게 한다.
    if (lastQuestionText && lastQuestionText !== q) ask.lastQuestion = lastQuestionText;
    if (!hideMe) lastQuestionText = q;
    legalPost('/api/legal/ask', ask).then(function (res) {
      return readNdjsonStream(res, function (deltaText) {
        hadDelta = true;
        ensureAnswerBubble();
        accumulated += deltaText;
        bubbleEl.innerHTML = answerBodyHTML(accumulated);
        body.scrollTop = body.scrollHeight;
      });
    }).catch(function () { return { ok: false, _neterr: true }; })
      .then(function (data) {
        var wait = hadDelta ? 0 : Math.max(0, MIN_THINK_MS - (Date.now() - startedAt));
        return new Promise(function (resolve) { setTimeout(function () { resolve(data); }, wait); });
      }).then(function (data) {
        // ★2026-08-18(사용자 확정): 답을 기다리는 중에 앱을 백그라운드로 내리면 연결이 끊긴다.
        //   서버는 그대로 답을 끝까지 만들어 보관하므로, 실패로 단정하지 말고 **그 보관본을 되찾아
        //   온다**(AI 재호출 없음 = 비용 0). 되찾는 동안에는 오류 문구 대신 기다림 표시를 둔다
        //   (사용자 원문: "자동으로 재시도… 재시도 버튼 없이. 오래 걸리면 로딩스피너").
        if (data && data._neterr) {
          ensureAnswerBubble();
          bubbleEl.innerHTML = recoveringHTML();
          body.scrollTop = body.scrollHeight;
          return recoverAnswer(askId).then(function (got) { return got || data; });
        }
        return data;
      }).then(function (data) {
        if (activeConsentTimer) { clearTimeout(activeConsentTimer); activeConsentTimer = null; }  // 6초 안에 끝남 → 배너 없음
        ensureAnswerBubble(); // done만 오고 delta가 하나도 없었던 경우(근거없음·오류) 대비
        // [H-37 §3.2 · F2] 서버가 준 ctxNext 를 다음 요청까지 들고 있는다(없으면 비운다).
        //   전송 실패(_neterr)면 손대지 않는다 — 눌렀던 버튼을 다시 누를 때 맥락이 살아 있어야 한다.
        if (!(data && data._neterr)) lastCtx = (data && data.ctxNext) || null;
        bubbleEl.innerHTML = answerHTML(q, data);
        // [H-37 §9.1 #9] 전송이 실패했으면 눌렀던 선택지 묶음을 **다시 누를 수 있게** 되돌린다 —
        //   기존 되묻기에도 있던 결함(한 번 누르면 nrya-done 이라 네트워크 오류 시 재시도 불가)이라
        //   같이 고친다. 성공했으면 그대로 비활성으로 둔다(중복 전송 방지).
        if (failBox && data && data._neterr) failBox.classList.remove('nrya-done');
        body.scrollTop = body.scrollHeight;
        // 진짜 최종 답변일 때만 기기에 기록으로 남긴다 — 되묻기(clarify)는 아직 답이 아니고,
        // 실패(!ok)나 답변 문장이 없는 응답은 나중에 다시 봐도 얻을 게 없다.
        if (data && data.ok && !data.clarify && data.answer) pushHistory(q, data);
        // [대화 기억] 진짜 답변만 쌓는다(되묻기는 아직 답이 아니고, 실패는 남길 것이 없다).
        if (data && data.ok && !data.clarify && data.answer) rememberTurn(q, data.answer);
        // 답변이 도착했는데 채팅창을 닫아둔 상태면 FAB 뱃지로 알린다(열려 있으면 이미 보는 중).
        if (!isChatOpen()) setUnread(getUnread() + 1);
        if (chatPending > 0) chatPending--;
      })
      // 위 단계 어디서든 예기치 못한 오류가 나도 대기 수는 반드시 되돌린다 —
      // 안 그러면 chatPending 이 0 으로 안 내려와 채팅창이 영영 홈으로 안 비워진다.
      .catch(function () { if (chatPending > 0) chatPending--; });
  }

  // 답변 본문에서 눌러볼 인용을 찾는 표현. 다섯 갈래를 한 번에 훑는다.
  //   ①「법령명」 — 뒤따르는 조문·별표가 "어느 법인지"를 정하는 표시(글자는 그대로 둔다)
  //   ②계층 표기(`같은 법 시행령`·`시행규칙`) ③별표·별지 서식 ④조문 ⑤문장 끝(①의 맥락을 버린다)
  // ⚠ ③을 ④보다 먼저 둔다 — `별지 제1호 서식`의 `제1호`가 조문 갈래로 먼저 걸리면 안 된다.
  // ★②는 2026-08-18 사용자 지적으로 새로 넣었다(가장 심각했던 결함): 예전에는 이 갈래가 없어
  //   **"시행령"이라는 말을 아예 안 읽었다.** 그래서 "「낚시 관리 및 육성법」 … 같은 법 시행령
  //   제16조제1항"을 누르면 시행령이 아니라 **법률 제16조(낚시터업의 등록)**가 열렸다 — 링크가
  //   안 걸리는 것(누락)보다 나쁜, **엉뚱한 원문을 여는** 오류다.
  //   ⚠뒤에 조문·별표 표기가 **바로 따라올 때만** 계층으로 본다(lookahead) — "대통령령으로
  //     정하는"·"시행령에서 정한다" 같은 일반 문구까지 계층 전환으로 읽으면, 그 문장 뒤쪽의
  //     멀쩡한 조문 링크까지 엉뚱한 계층으로 끌려간다.
  var NRYA_CITE_RE = /「([^」\n]{2,60})」|((?:같은\s*법|동\s*법)(?:\s*(?:시행령|시행규칙))?|시행령|시행규칙)(?=\s*(?:제\s*\d+\s*조|별표|별지))|(별표\s*제?\s*\d+(?:의\s*\d+)?|별지\s*제\s*\d+\s*호(?:\s*서식)?)|(제\s*\d+\s*조(?:의\s*\d+)?(?:\s*제\s*\d+\s*항)?(?:\s*제\s*\d+\s*호(?:의\s*\d+)?)?)|([.。!?\n])/g;

  /** 법령명에서 계층 꼬리(`시행령`·`시행규칙`)를 떼 모법 이름만 남긴다.
   *  예: baseLawName('낚시 관리 및 육성법 시행령') → '낚시 관리 및 육성법'
   *  [연계] ← citeHTML(계층 전환). */
  function baseLawName(nm) {
    return String(nm || '').replace(/\s*(?:시행령|시행규칙)\s*$/, '').trim();
  }

  /**
   * 약칭표를 서버에서 한 번만 받아 캐시한다(매 답변마다 부르지 않는다 — 계약4).
   * 실패해도 빈 표로 확정한다: 링크가 덜 걸릴 뿐, 엉뚱한 법을 열지는 않는다.
   * [연계] ← openChat. → GET /api/legal/aliases. 사용처는 resolveCiteLaw.
   */
  function ensureAliases() {
    if (aliasMap) return;
    aliasMap = {};                       // 재요청 방지(실패해도 다시 부르지 않는다)
    legalGet('/api/legal/aliases')
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (d) { if (d && d.ok && d.map && typeof d.map === 'object') aliasMap = d.map; })
      .catch(function () { /* 캐시가 비어 있어도 대화는 그대로 돌아간다 */ });
  }

  /**
   * 이 답변의 근거 체인(citationChain)에 실린 법령명을 "이름 → 팝업 열쇠" 표로 만든다.
   * 예: buildCiteIndex([{law:'어선법 시행령',tier:'decree',baseLaw:'어선법'}])
   *     → {'어선법 시행령': {law:'어선법 시행령', tier:'decree', base:'어선법'}}
   * ⚠같은 법령명인데 tier·baseLaw 가 서로 다른 줄이 섞여 있으면 어느 원문을 열지 우리가 단정할 수
   *   없다 → `ambiguous` 로 표시해 **링크하지 않는다**(엉뚱한 원문을 여는 것이 훨씬 나쁘다).
   * @param {Array} chain - data.citationChain
   * @returns {object} 법령명 → {law,tier,base,ambiguous?}
   * [연계] ← answerBodyHTML. → resolveCiteLaw.
   */
  /**
   * 이 법령명으로 원문을 찾을 때 `baseLaw` 가 **실제로 쓰이는가**.
   * 서버 article_text.resolveBase() 를 그대로 옮긴 판정이다: 법령 칸으로 raw 폴더가 바로 찾아지면
   * baseLaw 는 아예 안 쓰이고, ⓐ법령 칸이 `이 법`·`시행령`처럼 **계층 단어뿐**이거나 ⓑ고시일 때만
   * baseLaw 로 폴더를 찾는다(routes/legal.js mergeCitationChains 주석과 같은 두 경우).
   * 예: baseMatters('낚시 관리 및 육성법','law') → false · baseMatters('시행령','decree') → true
   * @param {string} name - 법령 칸 @param {string} tier - law|decree|rule|notice
   * @returns {boolean}
   * [연계] ← buildCiteIndex(모호 판정). 서버 isSelfRef/SELF_REF_TOKEN_RE 와 같은 규칙.
   */
  function _baseMatters(name, tier) {
    if (tier === 'notice') return true;
    // ⚠ `별표·별지·서식` 꼬리를 먼저 떼는 것까지 서버 isSelfRef 와 같아야 한다 — 안 떼면
    //   `시행령 별표1`(위키 근거조문표에 실제로 있는 표기, 전수 4건)이 "계층 단어뿐"으로 안 잡혀
    //   baseLaw 가 필요 없다고 잘못 판단하고, 그러면 서로 다른 법의 시행령 별표를 같은 것으로 보아
    //   **엉뚱한 원문을 열 수** 있다(전수 점검에서 발견해 보완).
    var s = String(name || '').replace(/[「」『』]/g, '')
      .replace(/\s*(?:별표|별지|서식)[^가-힣]*$/, '').replace(/\s+/g, '');
    if (!s || /^같은/.test(s)) return false;
    return s.replace(/^(이|동|본)/, '').replace(/(법률|법령|법|시행령|시행규칙|[·ㆍ・,\/]|→)/g, '') === '';
  }

  function buildCiteIndex(chain, citeLaws) {
    var idx = {};
    // [하이브리드 링크 ②, 2026-08-18] **답변 본문에 적힌 주소**에서 서버가 뽑아 준 법들을 먼저 깔고,
    //   아래에서 근거 목록(citationChain)으로 덮어쓴다 — 근거 목록의 tier·baseLaw 는 위키 사서가
    //   검증한 값이라 더 정확하므로 **그쪽이 이긴다**(사용자와 정한 우선순위: 검증값 우선, 없으면 폴백).
    //   이 폴백이 없으면 답변에 「법령명」 제N조라고 완전한 주소가 있어도 그 법이 근거 목록에 없으면
    //   링크를 포기했다(사용자 지적: "정확한 주소가 있는데 왜 못 찾나").
    (citeLaws || []).forEach(function (c) {
      var nm = String((c && c.law) || '').trim(); if (!nm) return;
      idx[nm] = { law: nm, tier: String(c.tier || 'law'), base: String(c.base || ''), contact: c.contact || null };
    });
    (chain || []).forEach(function (row) {
      var nm = String((row && row.law) || '').trim(); if (!nm) return;
      var tier = String((row && row.tier) || 'law');
      var base = String((row && row.baseLaw) || '');
      var hit = idx[nm];
      // 근거 목록 줄이 처음 오면 폴백으로 깔아둔 값을 **덮어쓴다**(검증값 우선). 그 뒤 같은 이름이
      // 또 오면 아래 모호 판정으로 넘어간다 — 폴백끼리는 애초에 이름당 하나뿐이라 충돌이 없다.
      var made = { law: nm, tier: tier, base: base, fromChain: true,
        contact: row.contact || (hit && hit.contact) || null, eff: row.effectiveDate || '' };
      if (hit && !hit.fromChain) { idx[nm] = made; return; }
      if (!hit) { idx[nm] = made; return; }
      if (!hit.contact && row.contact) hit.contact = row.contact;   // 뒤 줄이 연락처를 갖고 있으면 채운다
      if (!hit.eff && row.effectiveDate) hit.eff = row.effectiveDate;
      // ⚠ baseLaw 가 다르다고 무조건 모호로 보면 **정상적인 법률 링크가 통째로 죽는다**(2026-08-18
      //   실사용 재현): 근거 목록은 여러 위키 페이지의 줄을 합친 것이고, baseLaw 는 "그 줄이 실려
      //   있던 페이지"라 같은 법이라도 페이지마다 값이 다르다 — 특히 비교 페이지(comparisons/)는
      //   baseLaw 가 파일명(`여객화물운송사업_경계_해운법_낚시어선업_유도선업`)이다. 그 결과
      //   「낚시 관리 및 육성법」은 링크가 안 걸리고 「… 시행령」만 걸리는 현상이 났다.
      //   baseLaw 는 **원문 폴더를 못 찾을 때만** 쓰이므로(_baseMatters), 안 쓰이는 경우의 차이는
      //   어느 쪽을 골라도 같은 문서를 열어 모호하지 않다 — tier 차이만 모호로 남긴다.
      if (hit.tier !== tier) { hit.ambiguous = true; return; }
      if (hit.base !== base && _baseMatters(nm, tier)) hit.ambiguous = true;
    });
    return idx;
  }

  /** 법령명 표기의 공백만 지운 열쇠. 「」 안 이름과 위키 정식명은 뜻이 같아도 AI가 띄어쓰기를
   * 다르게 쓰면(예: "낚시관리및육성법" vs "낚시 관리 및 육성법") 문자 그대로는 안 맞는다 —
   * filterCitationChainByAnswer(서버)가 별표 표기를 대조할 때 쓰는 것과 같은 공백-흡수 방식이다.
   * @param {string} s @returns {string} */
  function _flatLawKey(s) { return String(s || '').replace(/\s+/g, ''); }

  /**
   * 「」 안에 적힌 이름이 이 답변의 근거 체인 중 어느 법인지 가린다(환각 0 — 확신 없으면 null).
   * ①문자 그대로 일치 → 그 줄의 tier·baseLaw 를 그대로 쓴다(계약4 1단계)
   * ②약칭표로 정식명으로 바꿔 다시 대조(계약4 2단계)
   * ③`「약칭 시행령」`처럼 하위법령 꼬리가 붙은 표기는 꼬리를 떼고 약칭만 바꿔 다시 대조
   * 그래도 못 찾거나 후보가 갈리면 null → 호출자가 링크를 걸지 않는다.
   * 예: resolveCiteLaw('어선안전조업법', idx) → {law:'어선안전조업 및 … 법률', tier:'law', base:''}
   * @param {string} name - 「」 안의 이름 @param {object} idx - buildCiteIndex 결과
   * @returns {{law:string,tier:string,base:string}|null}
   * [연계] ← citeHTML.
   */
  function resolveCiteLaw(name, idx) {
    var nm = String(name || '').trim(); if (!nm) return null;
    var hit = idx[nm];
    if (!hit && aliasMap) {
      var full = aliasMap[nm];
      if (full) hit = idx[full];
      if (!hit) {
        var m = /^(.+?)\s*(시행령|시행규칙)$/.exec(nm);
        if (m && aliasMap[m[1]]) hit = idx[aliasMap[m[1]] + ' ' + m[2]];
      }
    }
    // ④문자 그대로도·약칭표로도 못 찾았으면 공백만 지우고 마지막으로 한 번 더 본다(2026-08-18,
    //   실사용 지적 — AI가 「낚시관리및육성법」처럼 위키 정식명("낚시 관리 및 육성법")과 띄어쓰기만
    //   다르게 써서 링크가 통째로 안 걸리는 사례). 후보가 둘 이상으로 갈리면(서로 다른 법이 같은
    //   평평한 열쇠로 겹치면) 여전히 링크하지 않는다 — 엉뚱한 원문을 여는 게 훨씬 나쁘다.
    if (!hit) {
      var flat = _flatLawKey(nm), found = null, dup = false;
      for (var k in idx) {
        if (_flatLawKey(k) !== flat) continue;
        if (found && found !== idx[k]) { dup = true; break; }
        found = idx[k];
      }
      if (found && !dup) hit = found;
    }
    return (hit && !hit.ambiguous) ? hit : null;
  }

  /**
   * 답변 본문 글자 안의 조문·별표 인용을 **그 글자 자체가 눌리는 자리**로 바꾼 HTML을 만든다.
   * 예: citeHTML('「어선법」 제58조제5항제7호에 따라', idx)
   *     → '「어선법」 <span class="nrya-cite" data-article="제58조제5항제7호" …>제58조제5항제7호</span>에 따라'
   * ★환각 0: 어느 법인지 **확신이 설 때만** 링크한다 — 못 가리면 그냥 글자로 둔다.
   *   그래서 문장이 끝나면(마침표·물음표·줄바꿈) 앞 문장의 법 맥락을 버린다 — 다음 문장의 조문을
   *   앞 문장의 법으로 열어 보여주는 것이 링크를 안 거는 것보다 훨씬 나쁘기 때문이다.
   * ★팝업에 넘기는 조문 표기는 **본문에 적힌 그대로**여야 한다(그래야 서버가 그 항·호만 짚어준다).
   * 글자는 전부 esc() 로 넣는다 — 이 파일의 문자열 조립 규약(HTML 주입 없음).
   * @param {string} s - 답변 원문 @param {object} idx - buildCiteIndex 결과
   * @returns {string} 이스케이프된 HTML
   * [연계] ← answerBodyHTML. → bindChat 의 위임 클릭 → openArtPop(근거 카드와 같은 팝업).
   */
  function citeHTML(s, idx) {
    var out = '', last = 0, cur = null, m;
    var curName = '';    // 지금 문장에서 확정된 법령명(문장이 끝나면 버린다)
    var lastName = '';   // 답변 전체에서 마지막으로 「」로 밝힌 법령명 — `같은 법`이 가리키는 대상
    NRYA_CITE_RE.lastIndex = 0;
    while ((m = NRYA_CITE_RE.exec(s))) {
      if (m[1] != null) {                                                // ①법령명(글자는 그대로)
        curName = m[1]; lastName = m[1]; cur = resolveCiteLaw(curName, idx); continue;
      }
      if (m[2] != null) {                                                // ②계층 표기
        // `같은 법 …`은 **앞 문장의 법**을 명시적으로 가리키는 말이라 문장 경계를 넘어 이어받는다.
        //   (그냥 `시행령 제N조`는 같은 문장 안에서 밝힌 법을 쓰고, 없으면 마지막 법으로 잇는다.)
        var same = /같은\s*법|동\s*법/.test(m[2]);
        var tierM = /시행령|시행규칙/.exec(m[2]);
        var base = baseLawName(same ? (lastName || curName) : (curName || lastName));
        if (!base) { cur = null; curName = ''; continue; }   // 어느 법인지 모르면 링크하지 않는다
        var want = tierM ? (base + ' ' + tierM[0]) : base;
        // ★못 찾으면 **링크를 포기한다**(cur = null) — 예전처럼 모법으로 남겨두면 시행령 조문을
        //   눌렀는데 법률의 같은 번호 조문이 열린다(사용자 지적으로 드러난 실제 사고).
        cur = resolveCiteLaw(want, idx);
        curName = cur ? want : '';
        continue;
      }
      if (m[5] != null) { cur = null; curName = ''; continue; }          // ⑤문장 끝 → 법 맥락 버림
      if (!cur) continue;                                                // 어느 법인지 모르면 링크 안 함
      var txt = (m[3] != null) ? m[3] : m[4];
      var ct = cur.contact || {};
      out += esc(s.slice(last, m.index)) +
        '<span class="nrya-cite" data-law="' + esc(cur.law) + '" data-article="' + esc(txt) +
        '" data-tier="' + esc(cur.tier) + '" data-base="' + esc(cur.base) +
        '" data-min="' + esc(ct.소관부처명 || '') + '" data-dept="' + esc(ct.부서명 || '') +
        '" data-tel="' + esc(ct.전화번호 || '') + '">' + esc(txt) + '</span>';
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  }

  /**
   * 답변 본문(AI 합성 텍스트)을 안전하게 HTML로 변환한다. **굵게**만 허용하고 나머지는 이스케이프.
   * 근거 체인이 함께 주어지면(최종 렌더) 본문의 조문·별표 인용을 눌러볼 수 있는 자리로 바꾼다 —
   * 스트리밍 중(체인 없음)에는 예전 그대로 글자만 그린다(어느 법인지 아직 알 수 없으므로).
   * ⚠**굵게·줄바꿈 치환은 인용 span 을 만든 뒤에** 건다 — 순서를 바꾸면 span 태그 안쪽이 치환 대상이
   *   된다. span 태그에는 `**` 도 줄바꿈도 없으므로 이 순서에서는 서로 간섭하지 않는다.
   * @param {string} text - Gemini가 만든 답변 원문
   * @param {Array} [chain] - data.citationChain(근거 목록 — 링크의 1순위 재료)
   * @param {Array} [citeLaws] - data.citeLaws(답변 본문 주소에서 뽑은 법 — 2순위 폴백, 하이브리드)
   * @returns {string} 이스케이프된 HTML(굵게·줄바꿈·인용 링크만 적용)
   */
  function answerBodyHTML(text, chain, citeLaws) {
    var s = String(text == null ? '' : text);
    var hasIdx = (chain && chain.length) || (citeLaws && citeLaws.length);
    var html = hasIdx ? citeHTML(s, buildCiteIndex(chain, citeLaws)) : esc(s);
    // 처벌·양벌 문구가 든 굵은 글씨만 빨간색으로 구분(isPenaltyRow 와 같은 키워드 — 근거법령
    // 카드의 '벌칙' 배지와 같은 기준으로 맞춘다). 나머지 굵은 글씨는 기존 노란색 그대로.
    return html.replace(/\*\*(.+?)\*\*/g, function (m, inner) {
      var cls = /징역|벌금|과태료|처벌|형벌|양벌|몰수|추징/.test(inner) ? ' class="nrya-penalty-b"' : '';
      return '<b' + cls + '>' + inner + '</b>';
    }).replace(/\n/g, '<br>');
  }

  /**
   * 요지·원문 발췌·단계 칸에 처벌 문구가 들어있으면 처벌 조문으로 본다(체인 끝에 빨간 원으로 따로 뺀다).
   * ⚠ "형벌"도 찾아야 한다 — 위키 요지가 "처벌"이 아니라 "형벌(구간·재범·측정거부)"처럼 적힌
   *   행이 있어 "처벌"만 찾으면 놓친다(실측: 해상교통안전법 제113조 — 원문 제목 자체가
   *   "제113조(벌칙)"인데 요지 문구 차이로 '법률' 배지가 뜬 사례). 요지뿐 아니라 원문 발췌
   *   (row.excerpt)도 함께 본다 — 요지가 짧아 처벌 문구를 못 담았어도 발췌 쪽엔 있을 수 있다.
   * ⚠ 위키 표의 **단계 칸(row.step)** 도 함께 본다 — 처벌 신호가 요지가 아니라 단계에만 있는 행이
   *   있다(같은 제113조 행: 단계 "② 형벌(5톤 이상)" / 요지 "구간·재범·측정거부 형량" — 요지엔
   *   처벌 낱말이 없어 "형벌"을 추가한 뒤에도 계속 '법률' 배지로 떴다. 라이브 재현).
   * ⚠ "양벌"도 처벌로 센다 — 양벌규정(법인·선주 병과) 행은 자기 요지에 형량이 없어 다른 낱말이
   *   하나도 안 걸리는데, 그 행이 말하는 건 결국 벌칙이라 위반 조문과 같은 벌칙 묶음에 있어야 맞다
   *   (실측: 해상교통안전법 제117조 — 단계 "⑦ 양벌" / 요지 "법인·선주 병과").
   */
  function isPenaltyRow(row) {
    return /징역|벌금|과태료|처벌|형벌|양벌|몰수|추징/.test(
      String(row.gist || '') + ' ' + String(row.excerpt || '') + ' ' + String(row.step || ''));
  }

  /**
   * 소관부서 연락처 한 줄(☎ 부처명 (부서명) 전화번호). 전화번호는 눌러서 걸 수 있다.
   * 근거 아코디언이 갖고 있던 표기를 그대로 옮긴 것이다(2026-08-18 아코디언 제거).
   * 답변 맨 끝 요약도 한때 이 함수를 썼으나 같은 내용이 두 곳에 뜨는 게 되어 없앴다 —
   * 지금은 **조문 팝업 한 곳**만 쓴다.
   * ⚠걸리는 번호(href="tel:")는 통번호 그대로다 — 화면 표시만 다듬는다.
   * 예: contactLineHTML({소관부처명:'해양수산부', 부서명:'수산자원정책과', 전화번호:'051-773-5539'})
   * @param {{소관부처명?:string, 부서명?:string, 전화번호?:string}} c
   * @returns {string} 전화번호가 없으면 빈 문자열(아무것도 그리지 않는다)
   * [연계] ← openArtPop(조문 팝업의 연락처 줄).
   */
  function contactLineHTML(c) {
    if (!c || !c.전화번호) return '';
    var raw = String(c.전화번호).split(',')[0].trim();
    var dial = raw.replace(/[^0-9+]/g, '');
    var who = esc(c.소관부처명 || '') + (c.부서명 ? ' (' + esc(c.부서명) + ')' : '');
    return '<span class="nrya-meta-tel">☎ ' + who +
      ' <a href="tel:' + esc(dial) + '">' + esc(raw) + '</a></span>';
  }

  /** tier 코드를 화면 라벨로. 처벌 조문은 '벌칙'으로 표시한다. */
  function tierLabel(row, penalty) {
    if (penalty) return '벌칙';
    return { decree: '시행령', rule: '시행규칙', notice: '고시' }[row.tier] || '법률';
  }

  /**
   * 근거 줄의 법령명을 **화면에 보여줄 문자열**로 만든다.
   * 법령명이 `시행령`·`시행규칙`처럼 **계층 낱말뿐**이면 그 줄이 실려 있던 위키 페이지의 법
   * (row.baseLaw)을 앞에 붙여 준다.
   *
   * 예: displayLawName({law:'시행규칙', baseLaw:'해양경비법'})      → '해양경비법 시행규칙'
   *     displayLawName({law:'시행령 별표3', baseLaw:'어선법'})     → '어선법 시행령 별표3'
   *     displayLawName({law:'수산업법 시행령'})                    → '수산업법 시행령'(그대로)
   *
   * [왜 필요한가 — 2026-09-07 27차 라이브 검증에서 발견]
   *   위키 `## 근거 조문` 표에는 법령 칸을 `시행규칙` 처럼 계층 낱말만 적은 행이 흔하다
   *   (개념 페이지 163행·위키 전체 194행). `시행령 별표3` 처럼 계층 낱말 + 별표/별지 번호만 적은
   *   행도 같은 이유로 12행 있다. 그 페이지 안에서는 어느 법인지 자명해서다.
   *   서버는 이 꼴을 알고 baseLaw 로 원문을 잘 찾아온다(legal_retriever.js BARE_TIER_CELL_RE, B3).
   *   **그런데 화면이 그 baseLaw 를 안 써서**, 여러 법이 섞인 답변에서는 근거 목록에
   *   "시행규칙 제1조의2" 처럼 어느 법인지 없는 줄이 그대로 나왔다. 실제 사례:
   *   "헬기로 정선명령을 방송해도 효력이 있나" 답변에 어선안전조업법 시행규칙과
   *   해양경비법 시행규칙이 함께 실렸는데 뒤엣것이 "시행규칙"으로만 표시됐다.
   *
   * ⚠**보여줄 글자만 만든다 — 판정에 쓰는 값(row.law)은 건드리지 않는다.**
   *   row.law 는 조문 원문을 어느 폴더에서 읽을지 정하는 열쇠로도 쓰이고, 그 판정은
   *   "법령 칸이 계층 낱말뿐인가"를 조건으로 삼는다(usesBaseLaw). 값 자체를 바꾸면
   *   그 판정이 뒤집혀 엉뚱한 원문을 열 수 있다.
   * @param {{law:string, baseLaw:string}} row - citationChain 한 줄
   * @returns {string} 화면에 찍을 법령명(붙일 게 없으면 원래 값 그대로)
   * [연계] ← chainStepHTML(근거 목록 카드) · openArtPop(조문 원문 팝업 제목).
   */
  function displayLawName(row) {
    var nm = String((row && row.law) || '').trim();
    var base = String((row && row.baseLaw) || '').trim();
    // 계층 낱말 하나로 끝나거나, 그 뒤에 별표·별지·서식 번호만 붙은 꼴까지 받는다.
    if (!base || !/^(시행령|시행규칙)(\s*(별표|별지|서식)\s*제?\s*\d+(의\d+)?\s*호?)?$/.test(nm)) return nm;
    return base + ' ' + nm;
  }

  /**
   * 인용사슬 한 조문을 체인 한 칸으로 그린다.
   * 제목 줄은 **[뱃지] 법령명 조문번호** 한 줄로 짧게 끝내고(시행일자는 그 줄 오른쪽 끝의 작은 칩),
   * 그 아래에 그 조문의 **원문 발췌**(row.excerpt — 서버가 조문 원문에서 그대로 잘라 실어준 것)를
   * 보여준다. 발췌를 못 구한 줄(범위 인용·원문 조회 실패 등)만 예전처럼 위키 `요지`로 대신한다.
   * ⚠발췌는 원문 그대로다 — 화면이 손대지 않는다(routes/legal.js pickExcerpt 참고).
   * 연락처 줄을 뺀 카드 본문(.nrya-chain-hit)은 눌러서 조문 원문 팝업(전문)을 여는 영역이다.
   * ⚠ data-base(조문 원문 폴더를 찾는 열쇠)는 **그 줄이 실려 있던 위키 페이지의 법**(row.baseLaw,
   *   서버가 줄마다 붙여 보낸다)이다 — 줄의 자기 법(row.law)이 아니다. 체인 하나에 여러 법의 줄이
   *   섞여 있으므로 목록 전체에 하나를 공유할 수도 없다(예전엔 소스 하나만 그려서 공유가 가능했다).
   * @param {object} row - {law, article, effectiveDate, excerpt, gist, step, tier, contact, baseLaw}
   * @param {number} n - 화면에 찍을 순번(1부터)
   * @param {boolean} last - 세로 연결선을 끊을지(체인의 마지막 칸)
   * @param {boolean} penalty - 처벌 조문인지(빨간 원 + '벌칙' 라벨)
   * @returns {string} HTML
   * [연계] ← chainHTML. 데이터는 legal_retriever.js extractCitationChain/lookupContact.
   *        data-* 는 openArtPop 이 GET /api/legal/article-text 를 부를 때 그대로 쓴다.
   */
  function chainStepHTML(row, n, last, penalty) {
    var eff = row.effectiveDate
      ? '<span class="nrya-chain-eff">' + (row.tier === 'notice' ? '발령일자 ' : '시행일자 ') + esc(row.effectiveDate) + '</span>'
      : '';
    var head = esc(tierLabel(row, penalty)); // 뱃지. 법령명·조문번호는 같은 줄의 nrya-chain-art 가 잇는다
    // 본문 미리보기: 조문 원문 발췌가 있으면 그것을, 없으면(범위 인용·원문 조회 실패) 위키 요지를.
    var quote = row.excerpt
      ? '<div class="nrya-chain-quote nrya-chain-ex"><div class="nrya-chain-hang">' + esc(row.excerpt) + '</div></div>'
      : (row.gist ? '<div class="nrya-chain-quote"><div class="nrya-chain-hang">' + esc(row.gist) + '</div></div>' : '');
    var tel = '';
    if (row.contact && row.contact.전화번호) {
      // 부처명 → 부서명(괄호) → 전화번호를 **각각 한 줄씩** 쌓는다(사용자 확정) — 한 줄로 이으면
      // `해양수산부(어선안전정책과-어선 안전) · 051-773-5523` 처럼 길어져 좁은 말풍선에서 잘린다.
      var who = '';
      if (row.contact.소관부처명) {
        who = '<span>' + esc(row.contact.소관부처명) + '</span>' +
          (row.contact.부서명 ? '<span>(' + esc(row.contact.부서명) + ')</span>' : '');
      } else if (row.contact.부서명) {
        who = '<span>' + esc(row.contact.부서명) + '</span>';
      }
      var raw = String(row.contact.전화번호).split(',')[0].trim();
      var dial = raw.replace(/[^0-9+]/g, '');
      // 번호도 **지역번호 뒤에서 한 번 더** 줄을 바꿔 보여준다(사용자 확정).
      // ⚠걸리는 번호(href="tel:")는 통번호 그대로다 — 나누는 건 화면 표시뿐이다.
      var cut = /^([^-]+-)([\s\S]+)$/.exec(raw);
      var num = cut
        ? '<span class="nrya-tel-part">' + esc(cut[1]) + '</span><span class="nrya-tel-part">' + esc(cut[2]) + '</span>'
        : '<span class="nrya-tel-part">' + esc(raw) + '</span>';
      // [2026-08-17 실기기 피드백] 부서와 번호를 한 줄기로 쌓으니 네 줄이 되어 카드가 길어졌다.
      //   사용자 요구는 **왼쪽에 부서(2줄) · 오른쪽에 번호(2줄)** 로 나란히 두는 것이다.
      tel = '<div class="nrya-chain-tel"><span class="nrya-chain-tel-ic">☎</span>' +
        '<span class="nrya-chain-tel-b">' + who + '</span>' +
        '<a class="nrya-chain-tel-n" href="tel:' + esc(dial) + '">' + num + '</a></div>';
    } else {
      tel = '<div class="nrya-chain-tel nrya-unknown">☎ 확인되지 않음</div>';
    }
    // 클릭 영역이 서버에 그대로 넘길 값들(조문 원문 조회 키). data-pen 은 강조색만 벌칙색으로 바꾸는 표시.
    // data-gist 는 범위·전체 인용 팝업에서 "이 인용의 요지" 캡션으로 그대로 다시 쓴다
    // (조 하나를 못 짚어 강조를 할 수 없는 대신 방향을 잡아주는 문구 — 가공 없이 원문 그대로).
    // [계약1] `citedArticle` = 답변 문장이 이 줄을 인용할 때 실제로 쓴 표기 전체(`제58조제5항제7호`).
    //   비어 있지 않으면 그걸 보내야 팝업이 그 항·호만 짚어준다(없으면 예전처럼 위키 표의 조문 칸).
    // ⚠data-law 는 **서버에 그대로 넘길 값**이라 손대지 않는다. 화면에 보여줄 이름은
    //   data-lawshow 로 따로 싣는다(displayLawName — 계층 낱말뿐인 법령명에 페이지의 법을 붙인 것).
    var hitAttrs = ' data-law="' + esc(row.law || '') + '" data-lawshow="' + esc(displayLawName(row)) +
      '" data-article="' + esc(row.citedArticle || row.article || '') +
      '" data-tier="' + esc(row.tier || 'law') + '" data-base="' + esc(row.baseLaw || '') +
      '" data-gist="' + esc(row.gist || '') + '"' +
      (penalty ? ' data-pen="1"' : '');
    // 위키 "근거 조문" 표의 단계 칸(예: "① 신고"·"② 요건 실체") — 있으면 작게 덧붙인다.
    // ⚠ 카드 순서(n)는 손대지 않는다(법 이름이 답변에 먼저 나온 순서 그대로 유지) — 이건 그 순서
    //   안에서 "이 조문이 전체 흐름의 어느 단계인지"만 참고로 보여주는 라벨이다(2026-08-18, 실사용
    //   지적 "근거 목록을 봐도 무슨 흐름인지 모르겠다" — 정렬을 바꾸는 대신 표에 이미 있는 단계
    //   정보를 그대로 노출만 한다. 위키에 그 표가 없거나 단계 칸이 비어 있으면 그냥 안 보인다).
    var step = row.step ? '<span class="nrya-chain-step-lab">' + esc(row.step) + '</span>' : '';
    return '<div class="nrya-chain-step' + (last ? ' nrya-last' : '') + (penalty ? ' nrya-penalty' : '') + '" data-tier="' + esc(row.tier || 'law') + '">' +
      '<div class="nrya-chain-rail"><div class="nrya-chain-dot">' + n + '</div><div class="nrya-chain-line"></div></div>' +
      '<div class="nrya-chain-content">' +
        '<div class="nrya-chain-hit"' + hitAttrs + '>' +
          '<div class="nrya-chain-head"><span class="nrya-chain-tier">' + head + '</span>' +
            '<span class="nrya-chain-art">' + esc(displayLawName(row)) + (row.article ? ' ' + esc(row.article) : '') + '</span>' + eff + '</div>' +
          step +
          quote +
        '</div>' +
        tel +
      '</div>' +
    '</div>';
  }

  /**
   * 인용사슬 전체를 위임 흐름 체인으로 그린다. 위임 조문(법률→시행령→시행규칙→고시)을 한 체인으로
   * 잇고, 처벌 조문은 간격을 띄워 별도 체인으로 뺀다(처벌 조문이 없으면 구분 없이 한 체인).
   * ⚠ 각 칸에 보이는 문장은 그 조문 **원문의 앞부분 발췌**(서버가 실어준 row.excerpt)이고, 발췌를
   *   못 구한 칸만 위키 "근거 조문" 표의 요지다. 조문 전문(항·호 전체)은 카드를 누르면 조문
   *   팝업(openArtPop)이 raw 원문에서 그때그때 읽어 보여준다.
   * @param {Array} chain - data.citationChain(모든 근거 소스의 줄을 서버가 하나로 합쳐 보낸 목록.
   *   줄마다 자기 baseLaw 를 갖고 있어 여러 법이 섞여 있어도 조문 원문 조회가 정확하다)
   * @returns {string} HTML
   */
  function chainHTML(chain) {
    var main = [], pen = [];
    chain.forEach(function (row) { (isPenaltyRow(row) ? pen : main).push(row); });
    var n = 0, html = '';
    if (main.length) {
      html += '<div class="nrya-chain">' + main.map(function (row, i) {
        return chainStepHTML(row, ++n, i === main.length - 1, false);
      }).join('') + '</div>';
    }
    if (pen.length) {
      html += (main.length ? '<div class="nrya-chain-gap"></div>' : '') +
        '<div class="nrya-chain">' + pen.map(function (row, i) {
          return chainStepHTML(row, ++n, i === pen.length - 1, true);
        }).join('') + '</div>';
    }
    return html;
  }

  /**
   * "우리가 원문을 가질 수 없는 공백" 안내(gapNotices)를 근거 목록 아래 ⚠칩으로 그린다.
   * 시·군·구가 개별 고시로 정해 국가법령정보센터에 안 올라오는 사항이 대표적이다 — 이때
   * 위키에 사람이 적어둔 "관할 지자체에 확인하시는 것이 정확합니다" 문구를 **그대로** 보여준다
   * (요약·재작성하지 않는다 — 지어내지 않기 위해).
   * 칩을 누르면 그 아래 위키 원문 문장이 펼쳐진다(서버 재조회 없음 — 응답에 이미 들어있다).
   * ⚠ 항상 보이는 칩 머리글은 **어디에 물어야 하는지를 단정하지 않는다** — 어디가 관할인지는 사항마다
   *   다른데(지자체 고시일 수도, 소관부처·외교부 조약정보일 수도 있다) 머리글에 "관할 지자체"라고
   *   박아두면 위키에 없는 지시가 상시 노출된다. 실제 문의처는 펼침 본문의 위키 원문이 말해준다.
   * ⚠ 근거 법령 아코디언 **밖**(항상 보이는 자리)에 그린다 — 접힌 목록 안에 넣으면 정작 꼭 봐야
   *   할 안내가 펼치기 전엔 안 보인다.
   * @param {Array} sources - data.sources
   * @returns {string} HTML(안내가 없으면 빈 문자열)
   * [연계] ← answerHTML. ← legal_retriever.extractGapNotices(위키 "## 타법 연결"의 수집곤란 행).
   */
  function gapNoticesHTML(sources) {
    var seen = {}, out = '';
    sources.forEach(function (s) {
      (s.gapNotices || []).forEach(function (g) {
        if (!g || !g.title || seen[g.title]) return;
        seen[g.title] = 1;
        out += '<div class="nrya-gap"><div class="nrya-gap-t">⚠ 원문 미수집 — 별도 확인 필요 · ' + esc(g.title) + '</div>' +
          '<div class="nrya-gap-b">' + esc(g.note || '') + '</div></div>';
      });
    });
    return out;
  }

  /**
   * 되묻기(명확화) 질문 + 선택지 버튼을 그린다.
   * 서버(legal_retriever.decideClarify)가 "이 질문은 조건에 따라 답이 완전히 갈린다"고 판단하면
   * 모든 경우를 나열한 긴 답변 대신 질문 하나와 선택지(최대 10개)가 내려온다 — 여기서 버튼으로 그리고,
   * 누르면 원래 질문에 고른 조건을 붙여 다시 물어본다(pickClarifyOption).
   * ⚠ 이 챗봇은 대화 이력을 서버에 보내지 않는 단발성 구조라, "이어지는 답"을 자유 텍스트로 받으면
   *   원래 맥락이 사라진다 — 그래서 자유 입력이 아니라 **버튼**으로 받아 클라이언트가 맥락을 합친다.
   * @param {string} q - 이 답변을 만든 원래 질문(버튼 클릭 시 앞에 붙일 문장)
   * @param {{question:string, options:Array<{label:string,hint:string}>}} clarify - done 이벤트의 clarify
   * @returns {string} HTML(선택지가 없으면 빈 문자열)
   * [연계] ← answerHTML. → pickClarifyOption(위임 클릭 핸들러). ← routes/legal.js done.clarify.
   */
  function clarifyHTML(q, clarify) {
    if (!clarify || !clarify.question || !(clarify.options || []).length) return '';
    // ⚠ 2026-08-18: "직전 질문과 이어질 수 있다"는 확인 후보를 맨 앞으로 올려 강조하던 처리를
    //   **없앴다** — 서버가 그 선택지를 아예 안 보낸다(질의를 합치면 이미 답한 것을 또 설명하고
    //   검색어가 오염돼, 맥락을 ctx.topic 으로 잇는 방식으로 바꿨다).
    var btns = (clarify.options || []).map(function (o) {
      if (!o || !o.label) return '';
      // [H-37 §3.2] 서버가 선택지에 `ctx`를 실어 보내면(이해확인·상황질문·프로필확인) 그 버튼은
      //   **질의에 라벨을 붙이지 않고** 이 ctx 만 되돌려 보낸다 — 질의 문자열을 오염시키지 않는
      //   것이 이 설계의 핵심이다(설계 §3.1 D안). `act="ask"`면 보내지 않고 입력창으로 안내한다.
      // [계약5] 선택지 맨 끝의 "잘 모르겠어요"(act:'unknown')는 조건을 고른 게 아니라 **모른다는 답**
      //   이라, 다른 선택지와 눈에 띄게 구분되도록 연한 점선 테두리로 그린다. 전송 경로는 다른 ctx
      //   버튼과 완전히 같다(pickClarifyOption 의 data-ctx 갈래 — 새 경로를 만들지 않는다).
      var cls = 'nrya-consent-btn nrya-clarify-btn' + (o.act === 'unknown' ? ' nrya-clarify-unknown' : '');
      var label = o.label;
      return '<button type="button" class="' + cls + '" data-label="' + esc(o.label) + '"' +
        (o.ctx ? ' data-ctx="' + esc(JSON.stringify(o.ctx)) + '"' : '') +
        (o.act ? ' data-act="' + esc(o.act) + '"' : '') +
        (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(label) + '</button>';
    }).join('');
    // ★2026-08-18(사용자 확정): 선택지가 전부 안 맞을 때 **직접 적을 자리**를 둔다. 실사용에서
    //   낚시어선업 이야기를 하다 되물었더니 수산부산물·폐기물 처리업만 뜨고, 정작 맞는 업종이
    //   없어 "잘 모르겠어요"밖에 누를 게 없었다(사용자 원문: "기타. 라고 넣고 그 아래 타이핑할
    //   수 있는 란과 제출? 확인? 버튼이 있으면 좋겠는데?").
    //   ⚠ 이 버튼에는 `nrya-clarify-btn` 을 붙이지 않는다 — 그 클래스를 붙이면 위임 클릭이
    //     곧바로 선택지 전송으로 보내버려 입력란이 열리지 않는다.
    var etc = '<div class="nrya-clarify-etc">' +
      '<button type="button" class="nrya-consent-btn nrya-clarify-etcopen">✏️ 기타 — 직접 적을게요</button>' +
      '<div class="nrya-clarify-etcbox">' +
        '<input type="text" class="nrya-clarify-etcin" maxlength="60" placeholder="해당하는 내용을 적어주세요">' +
        '<button type="button" class="nrya-consent-btn nrya-clarify-etcgo">확인</button>' +
      '</div></div>';
    return '<div class="nrya-clarify" data-q="' + esc(q || '') + '">' +
      '<div class="nrya-clarify-q">' + esc(clarify.question) + '</div>' +
      '<div class="nrya-consent-btns nrya-clarify-btns">' + btns + '</div>' + etc + '</div>';
  }

  /**
   * 되묻기 선택지 버튼을 눌렀을 때: 원래 질문 + 고른 선택지를 한 문장으로 합쳐 새 질의로 보낸다.
   * 예: "낚싯배 위에서 술 마시면 처벌?" + "조타 담당" → "낚싯배 위에서 술 마시면 처벌? — 조타 담당"
   * 전송은 입력창에 넣고 기존 doSend()를 그대로 부른다(새 전송 경로를 만들지 않는다).
   * 한 번 고르면 그 선택지 묶음은 비활성(nrya-done)이라 다시 눌러 중복 전송되지 않고, **누른 버튼만**
   * 앱 강조색으로 남는다(nrya-picked) — 이 카드가 화면에 계속 남아 "무엇 중에 무엇을 골랐는지"를
   * 보여주는 것이 사용자가 원한 동작이다. 합친 문장을 내 말풍선으로 다시 띄우지는 않는다(doSend
   * 세 번째 인자 hideMe) — 라운드마다 누적된 긴 문장이 그대로 뜨면 화면이 지저분해지기 때문이다.
   * @param {HTMLElement} btn - 눌린 .nrya-clarify-btn
   * [연계] ← bindChat 의 위임 클릭. → doSend(기존 질문 전송 로직 재사용).
   */
  function pickClarifyOption(btn) {
    var box = btn.closest('.nrya-clarify');
    if (!box || box.classList.contains('nrya-done')) return;
    box.classList.add('nrya-done');
    btn.classList.add('nrya-picked');   // 고른 버튼 표시(안 고른 버튼은 흐리게 남는다 — CSS)
    var input = document.getElementById('nryaChatInput'); if (!input) return;
    var q = box.getAttribute('data-q') || '';
    var label = btn.getAttribute('data-label') || btn.textContent || '';
    // [H-37] ctx 를 들고 있는 선택지(이해확인·상황질문·프로필확인)는 **질의를 그대로 두고** ctx만
    //   갱신해 재전송한다. ctx 가 없는 선택지(기존 되묻기·트리 되묻기)는 예전 그대로 ' — 라벨' 누적.
    var raw = btn.getAttribute('data-ctx');
    if (raw) {
      var ctx = null;
      try { ctx = JSON.parse(raw); } catch (_) { ctx = null; }
      if (btn.getAttribute('data-act') === 'ask') {
        // "아니요, 다시 설명할게요" — 보내지 않고 입력창으로 안내한다. 예약한 ctx(라운드 +1)는
        // 사용자가 새로 친 문장 **한 번**에만 실린다(설계 §4.3).
        pendingCtx = ctx;
        setChatPlaceholder(true);
        input.value = '';
        input.focus();
        return;
      }
      // [2026-08-14 F2] 버튼이 든 ctx 는 **직전 맥락 위에 축 단위로** 얹는다 — 한 축의 버튼을
      //   눌렀다고 다른 축의 결정(프로필 확인·상황질문)이 지워지면 안 된다(설계 §7.4 축 단위 원칙).
      input.value = q;
      doSend(mergeCtx(lastCtx, ctx), box, true);
      return;
    }
    // [2026-08-14 F2] ctx 없는 선택지(기존 되묻기·트리 되묻기)라도 **직전까지 확정된 맥락은 이어
    //   보낸다.** 예전엔 여기서 doSend(null, …)이라 프로필로 확정한 축이 통째로 사라져 서버가 같은
    //   축을 다시 묻는 무한루프가 됐다(적대검증 재현: 프로필확인 "네" → 트리 답변의 ctx 없는 버튼).
    input.value = q ? q + ' — ' + label : label;
    doSend(lastCtx, box, true);
  }

  /**
   * 되묻기 카드의 "기타 — 직접 적을게요"에 쓴 내용을 **고른 선택지와 똑같은 길로** 보낸다.
   * 즉 원래 질문 뒤에 ' — 적은 내용'을 붙이고, 직전까지 확정된 맥락(lastCtx)을 함께 실어 보낸다
   * (pickClarifyOption 의 ctx 없는 갈래와 같은 처리 — 새 전송 경로를 만들지 않는다).
   * 빈칸이면 아무것도 하지 않는다. 한 번 보내면 그 카드 전체가 잠긴다(중복 전송 방지).
   * @param {HTMLElement} wrap - `.nrya-clarify-etc`
   * [연계] ← bindChat 위임(클릭·엔터). → doSend(hideMe=true — 누적 문장을 다시 띄우지 않는다).
   */
  function sendClarifyEtc(wrap) {
    if (!wrap) return;
    var box = wrap.closest('.nrya-clarify');
    if (!box || box.classList.contains('nrya-done')) return;
    var inp = wrap.querySelector('.nrya-clarify-etcin');
    var typed = inp ? String(inp.value || '').trim() : '';
    if (!typed) { if (inp) inp.focus(); return; }
    var input = document.getElementById('nryaChatInput'); if (!input) return;
    box.classList.add('nrya-done');
    wrap.classList.add('nrya-picked');          // 무엇을 적어 보냈는지 카드에 남는다
    var q = box.getAttribute('data-q') || '';
    input.value = q ? q + ' — ' + typed : typed;
    doSend(lastCtx, box, true);
  }

  /**
   * 두 ctx 를 축(uc·scope·prof) 단위로 합친다 — 같은 축은 새 값(버튼이 들고 온 것)이 이긴다.
   * 예: mergeCtx({prof:{decided:[…]}}, {uc:{rounds:1,state:'confirmed'}})
   *     → {prof:{decided:[…]}, uc:{rounds:1,state:'confirmed'}}
   * ⚠축 단위 확인 원칙(설계 §7.4)의 클라이언트 쪽 짝이다 — 한 축의 버튼을 눌렀다고 다른 축의
   *   결정까지 지워지면 안 된다.
   * @param {object|null} base - 직전 응답의 ctxNext @param {object|null} extra - 버튼의 data-ctx
   * @returns {object|null} 둘 다 없으면 null
   * [연계] ← pickClarifyOption. → doSend(요청 바디의 ctx).
   */
  function mergeCtx(base, extra) {
    if (!base) return extra || null;
    if (!extra) return base;
    var out = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) out[k] = base[k];
    for (k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) out[k] = extra[k];
    return out;
  }

  /**
   * /api/legal/ask 응답을 답변 말풍선 내부 HTML로 조립한다.
   * AI 합성 답변(answer)을 본문으로, 근거 법령(sources)은 아코디언으로 붙인다. 서버가 되묻기를
   * 택한 응답(clarify)이면 answer 자리에 짧은 안내 한 줄만 오고 그 아래에 선택지 버튼이 붙는다.
   * 아코디언에는 서버가 합쳐 보낸 인용사슬(data.citationChain — 근거 소스 여러 곳의 줄을 답변이
   * 인용한 순서로 하나로 정렬한 목록)을 위임흐름 체인으로 펼친다 — 줄이 하나도 없으면 아코디언
   * 자체를 그리지 않는다.
   * answer가 없으면(합성 실패·근거 없음) 안내 문구로 대체한다.
   * ※ 백엔드 내부 필드(kind·score·file)는 화면에 노출하지 않는다(사용자에게 의미 없는 값).
   * @param {string} q - 사용자 질문(되묻기 선택지를 누를 때 앞에 붙일 원래 질문으로 쓴다)
   * @param {object} data - {ok, answer, sources[], citationChain[], note, clarify?} 또는 실패 객체
   * @returns {string} 말풍선 내부 HTML
   */
  function answerHTML(q, data) {
    if (!data || !data.ok) {
      return '죄송해요, 지금은 답변 근거를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' +
        '<div class="nrya-disc">일시적 오류일 수 있습니다. 문제가 계속되면 관리자에게 문의하세요.</div>';
    }
    var sources = data.sources || [];
    // 근거 체인은 본문보다 먼저 꺼낸다 — 본문의 조문·별표 인용을 눌러볼 자리로 바꿀 때
    // "어느 법인지"를 이 체인으로 가리기 때문이다(answerBodyHTML → citeHTML).
    // data.citeLaws 는 그 폴백 — 답변 본문에 주소가 적혀 있는데 근거 목록엔 없는 법을 메운다.
    var chain = data.citationChain || [];
    var lead = data.answer
      ? answerBodyHTML(data.answer, chain, data.citeLaws)
      : (data.clarify
        ? '조건에 따라 답이 달라져서, 하나만 여쭤볼게요.'   // 되묻기인데 서버 안내문이 비었을 때의 최소 문구
        : (sources.length
          ? '질문과 관련된 <b>근거 법령·개념</b>을 찾았지만, 지금은 답변 문장을 만들지 못했어요. 아래에서 조문 근거를 직접 확인하세요.'
          : '아직 이 질문에 딱 맞는 근거를 위키에서 찾지 못했어요. 질문을 조금 더 구체적으로(법 이름·톤수·행위) 적어주시면 도움이 됩니다.'));

    // 되묻기 선택지는 본문 바로 아래에 둔다 — 지금 사용자가 해야 할 일이다.
    var html = lead + clarifyHTML(q, data.clarify);
    // ★2026-08-18(사용자 확정): "근거 법령" 아코디언(조문 카드 전문 목록)을 **없앴다.**
    //   본문의 조문 인용이 이제 충실히 링크되므로(6-11 하이브리드 링크) 같은 조문 전문을 아래에
    //   또 펼쳐 놓을 이유가 없고, 답변마다 카드가 10장씩 쌓여 "어디를 봐야 할지 모르겠다"는
    //   실사용 지적이 반복됐다. 사용자 원문: *"본문에 하이퍼링크가 들어가 있다면 근거 전문을
    //   캐치할 필요가 없을 것 같다 … 근거 전문란을 빼면 좋겠어."*
    //   ⚠**데이터(data.citationChain)는 그대로 받는다** — 본문 링크가 어느 법인지 가릴 때 쓰는
    //     1순위 재료이고(buildCiteIndex), 서식 버튼도 이 줄들에서 나온다. 화면에만 안 그린다.
    //   ⚠대신 아래 두 자리로 옮겼다(같은 확정): ①시행일자·소관부처·전화번호는 답변 맨 끝 요약으로
    //     ②조문 팝업(본문 링크를 눌러 여는 창)에도 그 조문의 연락처를 함께 보여준다(chainStepHTML
    //     이 하던 역할을 팝업이 이어받는다).
    // 근거 조문에 딸린 별지 서식 다운로드 버튼(_CHATBOT.md 5-5). 아코디언 **밖·바로 아래**에 둔다 —
    // 지금 사용자가 눌러야 할 액션이라 접혀 있으면 안 된다. 되묻기는 아직 답이 아니라 붙이지 않는다
    // (면책·만족도 버튼을 붙이지 않는 것과 같은 이유). 서식이 0건이면 renderFormDownloadsHTML 이
    // 빈 문자열을 주므로 아무것도 그려지지 않는다.
    if (!data.clarify) html += renderFormDownloadsHTML(data.forms);
    // ⚠공백 안내는 아코디언 **밖**에 둔다 — 접혀 있는 목록 안에 넣으면 정작 꼭 봐야 할
    // "관할 지자체에 확인하세요"가 펼치기 전엔 안 보인다(그게 이번에 고친 문제 자체다).
    html += gapNoticesHTML(sources);
    // [2026-08-18 사용자 확정] 답변 끝의 법별 시행일자·소관부서 연락처 요약은 **없앤다** —
    //   본문의 조문 표기를 누르면 그 팝업이 같은 시행일자·전화번호를 보여주므로 같은 내용이
    //   두 곳에 있었다(사용자 원문: "아래에 소관부서 번호가 나오지 않도록 해줘 어차피 조문
    //   누르면 나오니까"). contactLineHTML 은 그 팝업이 계속 쓴다.

    // 면책("참고용입니다…")은 **최종 답변에만** 붙인다(사용자 확정) — 되묻기 응답은 아직 답이 아니라
    // 되묻는 질문이라, 확인할 "답"이 없는데 공식 출처 확인을 권하면 말이 안 맞는다.
    // 되묻기에서는 서버 안내문(data.note — "추가 정보가 필요해요")만 남긴다.
    if (data.clarify) {
      if (data.note) html += '<div class="nrya-disc">' + esc(data.note) + '</div>';
    } else {
      html += '<div class="nrya-disc">참고용입니다. 최종 확인은 공식 출처를 확인하세요.' + (data.note ? ' · ' + esc(data.note) : '') + '</div>';
    }
    // 되묻기 응답엔 아직 "최종 답변"이 없어 만족도를 물을 대상이 없다 — 진짜 답변에만 붙인다.
    if (!data.clarify && data.answer) html += feedbackHTML(q, data.answer) + continuityHTML(q, data);
    return html;
  }

  /**
   * 답변 하단 👍/👎 만족도 버튼. _feedback/README.md 흐름: 👍는 바로 전송, 👎는 사유(선택)
   * 입력칸을 펼쳐 "전송"으로 보낸다(둘 다 비워도 전송 가능). 질문·답변요지는 data-* 로 들고
   * 있다가 delegated 클릭 핸들러(bindChat)가 읽어 POST /api/legal/feedback 한다.
   * @param {string} q @param {string} answer @returns {string}
   * [연계] → bindChat(위임 클릭), POST /api/legal/feedback.
   */
  function feedbackHTML(q, answer) {
    var gist = String(answer).replace(/<[^>]+>/g, '').slice(0, 400);
    return '<div class="nrya-fb" data-q="' + esc(q) + '" data-gist="' + esc(gist) + '">' +
      '<span class="nrya-fb-lab">이 답변이 도움이 됐나요?</span>' +
      '<button type="button" class="nrya-fb-btn" data-thumb="up">👍</button>' +
      '<button type="button" class="nrya-fb-btn" data-thumb="down">👎</button>' +
      '<div class="nrya-fb-reason nrya-hidden">' +
        '<textarea class="nrya-fb-reason-in" placeholder="어떤 점이 아쉬웠나요? (선택)"></textarea>' +
        '<button type="button" class="nrya-fb-send">전송</button>' +
      '</div>' +
    '</div>';
  }

  /**
   * 답변 하단 "이어서 질문할까요?" 3버튼(2026-08-17, MASTER_PLAN H-36 후속 ①만 — 기기별 사실
   * 영구저장은 이번엔 범위 밖, 사용자 확정). 이 챗봇은 "새로 타이핑하면 맥락을 비운다"(§9.1 #1)가
   * 기본 동작이라, 사용자가 방금 답의 맥락 위에서 더 물어보고 싶어도 다음 문장을 치는 순간 맥락이
   * 날아간다 — 그 간극을 메운다.
   * 예: continuityHTML('낚시어선업 신고 요건이 뭔가요', {ctxNext:{scope:{...}}})
   * @param {string} q - 원래 질문(눌러도 재전송하지 않는다 — 표시용)
   * @param {object} data - done 이벤트(ctxNext 있으면 "이어서" 버튼에 싣는다)
   * @returns {string}
   * [연계] ← answerHTML. → bindChat(위임 클릭) → pickContinuity().
   */
  function continuityHTML(q, data) {
    var ctxAttr = data.ctxNext ? ' data-ctx="' + esc(JSON.stringify(data.ctxNext)) + '"' : '';
    return '<div class="nrya-cont" data-q="' + esc(q) + '">' +
      '<button type="button" class="nrya-cont-btn" data-cont="more"' + ctxAttr + '>🔁 관련해서 더 궁금해요</button>' +
      '<button type="button" class="nrya-cont-btn" data-cont="new">🆕 다른 종류의 질문이에요</button>' +
      '<button type="button" class="nrya-cont-btn" data-cont="done">✅ 궁금증 해소됐어요</button>' +
    '</div>';
  }

  /**
   * continuityHTML 버튼 클릭 처리. 서버로 아무것도 보내지 않는다(온디바이스 UI 상태 전환뿐).
   * - more: 방금 답의 ctxNext 를 pendingCtx 에 예약해 **다음에 사용자가 직접 치는 문장 한 번**에만
   *   실리게 한다(§4.3 "아니요, 다시 설명할게요"와 같은 예약 방식 재사용 — 새 경로를 안 만든다).
   * - new: 맥락을 명시적으로 비운다(타이핑 시 이미 비워지지만, 버튼을 눌렀다는 의도를 그대로 반영).
   * - done: 서버에 보낼 것이 없다 — 버튼 3개를 감사 인사로 바꾸고 끝낸다(만족도 👍 버튼과 같은 패턴).
   * 어느 쪽이든 같은 묶음을 다시 누르면 안 되므로 nrya-done 으로 잠근다(pickClarifyOption과 동일 관례).
   * @param {HTMLElement} btn - 눌린 .nrya-cont-btn
   * [연계] ← bindChat 위임 클릭. → pendingCtx(more) · doSend가 다음 전송에서 소비.
   */
  function pickContinuity(btn) {
    var box = btn.closest('.nrya-cont');
    if (!box || box.classList.contains('nrya-done')) return;
    box.classList.add('nrya-done');
    var cont = btn.getAttribute('data-cont');
    var input = document.getElementById('nryaChatInput');
    if (cont === 'done') {
      box.innerHTML = '<span class="nrya-cont-thanks">대화해 주셔서 감사해요 🙌</span>';
      return;
    }
    if (cont === 'more') {
      var raw = btn.getAttribute('data-ctx');
      var ctx = null;
      if (raw) { try { ctx = JSON.parse(raw); } catch (_) { ctx = null; } }
      pendingCtx = ctx;
      box.innerHTML = '<span class="nrya-cont-thanks">네, 이어서 물어보세요 — 아래에 이어서 적어주시면 방금 답변 맥락을 이어갈게요.</span>';
    } else {
      pendingCtx = null;
      lastCtx = null;
      forgetChatMemory();            // 주제가 바뀌므로 지금까지의 대화를 이어받지 않는다
      box.innerHTML = '<span class="nrya-cont-thanks">네, 새 질문을 아래에 적어주세요.</span>';
    }
    if (input) { input.value = ''; input.focus(); }
  }

  // ── 답변완료 푸시 딥링크(?popup=ai_chat&rid=…) ─────────────────────────

  /**
   * 완료 푸시를 눌러 들어왔는지 URL 파라미터로 확인하고, 맞으면 채팅창을 열어
   * 보관된 답변(질문+답변 말풍선 쌍)을 복원한다. 서버 보관함은 1회용이라 이 조회 한 번으로 비워진다.
   * 예: /?popup=ai_chat&rid=a3f1… → 채팅창 자동 열림 + 그 질문/답변 복원
   * [연계] ← boot. → GET /api/legal/pending-answer/:requestId,
   *          renderRestoredAnswer / renderExpiredNotice.
   *          (fix_popup_logic.js 의 checkForPushPopup 과 같은 "URL 파라미터로 팝업 자동 열기" 패턴)
   */
  function checkAnswerDeepLink() {
    var params; try { params = new URLSearchParams(window.location.search); } catch (_) { return; }
    if (params.get('popup') !== 'ai_chat') return;
    var rid = params.get('rid') || '';
    // 주소창에서 파라미터 제거 — 새로고침 때 이미 비워진 보관함을 또 조회하지 않게(fix_popup_logic.js 와 동일 처리)
    try { if (window.history.replaceState) window.history.replaceState({}, document.title, window.location.pathname); } catch (_) {}

    // rid 없이는 채팅창을 열지 않는다 — ?popup=ai_chat 만으로 노출설정(exposure)을 우회해
    // 숨겨둔 챗봇을 여는 구멍이 되면 안 되므로(rid는 실제로 푸시를 받은 사람만 가진 값).
    if (!rid) return;
    openChat();
    legalGet('/api/legal/pending-answer/' + encodeURIComponent(rid))
      .then(function (r) { return r.json(); })
      .catch(function () { return { ok: false }; })
      .then(function (data) {
        if (data && data.ok) renderRestoredAnswer(data);
        else renderExpiredNotice();
      });
  }

  /**
   * 서버가 보관하고 있던 질문/답변을 평소의 말풍선 쌍(내 질문 → 나리야 답변)으로 그린다.
   * @param {object} data - {ok:true, query, answer, sources, citationChain, note}
   * [연계] ← checkAnswerDeepLink. → answerHTML(평소 답변과 똑같이 근거 아코디언까지 렌더).
   */
  function renderRestoredAnswer(data) {
    var body = document.getElementById('nryaChatBody'); if (!body) return;
    var me = document.createElement('div'); me.className = 'nrya-krow nrya-me';
    // ⚠말풍선과 칩을 세로로 쌓으려면 한 칸 더 감싸야 한다 — .nrya-kbrow 는 가로 flex 라
    //   여기에 바로 붙이면 칩이 말풍선 **옆**으로 간다.
    me.innerHTML = '<div class="nrya-kbrow"><div class="nrya-mecol"><div class="nrya-kbub"></div></div></div>';
    var q = splitAskedQuery(data.query || '');
    me.querySelector('.nrya-kbub').textContent = q.question;
    // 되묻기로 고른 조건은 **작은 칩**으로 따로 붙인다(2026-08-18 사용자 지적). 실시간 화면에서는
    //   선택지 카드가 그 자리에 남아 "무엇 중 무엇을 골랐는지"를 보여주지만, 복원 화면에는 그
    //   카드가 없어 누적 문자열(`원질문 — 라벨1 — 라벨2`)이 통째로 말풍선에 찍혔다.
    if (q.picks.length) {
      var chips = document.createElement('div'); chips.className = 'nrya-mepicks';
      q.picks.forEach(function (t) {
        var c = document.createElement('span'); c.className = 'nrya-mepick'; c.textContent = t;
        chips.appendChild(c);
      });
      me.querySelector('.nrya-mecol').appendChild(chips);
    }
    body.appendChild(me);
    appendAiRow(answerHTML(data.query || '', data));
  }

  /**
   * 저장된 질문 문자열을 **원래 질문**과 **되묻기로 고른 라벨들**로 가른다.
   * 되묻기 선택지를 누르면 질의가 `원질문 — 라벨1 — 라벨2`로 누적되는데(서버가 라운드 수를 세는
   * 근거라 이 형식 자체는 바꾸지 않는다), 화면에는 그대로 찍으면 안 된다.
   * 예: splitAskedQuery('낚시어선업 절차 — 10톤 미만 — 네, 등록했습니다')
   *     → {question:'낚시어선업 절차', picks:['10톤 미만','네, 등록했습니다']}
   * @param {string} raw - 저장된 질의 문자열
   * @returns {{question:string, picks:string[]}}
   * [연계] ← renderRestoredAnswer · histQuestionLabel. 결합자는 pickClarifyOption 이 붙이는 ' — '.
   */
  function splitAskedQuery(raw) {
    var parts = String(raw || '').split(' — ');
    return { question: (parts.shift() || '').trim(), picks: parts.map(function (t) { return t.trim(); }).filter(Boolean) };
  }

  /**
   * 보관 기한(3시간)이 지났거나 이미 확인한 답변이라 복원할 게 없을 때의 안내 말풍선.
   * 원문 질문은 서버도 이미 지워 복원할 수 없으므로, 다시 물어보도록 입력창에 포커스만 준다.
   * [연계] ← checkAnswerDeepLink.
   */
  function renderExpiredNotice() {
    var bub = appendAiRow('이전 답변을 찾을 수 없어요. 다시 확인해 볼까요?' +
      '<div class="nrya-consent-btns"><button type="button" class="nrya-consent-btn nrya-yes nrya-reask">다시 질문하기</button></div>');
    if (!bub) return;
    bub.querySelector('.nrya-reask').addEventListener('click', function () {
      var i = document.getElementById('nryaChatInput'); if (i) i.focus();
    });
  }

  // ============================================================================
  // 부트스트랩
  // ============================================================================

  /** 부트스트랩: 오버레이 주입 + 서버 노출설정 로드 + 탭 변화 옵저버 등록 + 완료푸시 딥링크 처리. */
  function boot() {
    ensureOverlays();
    checkAnswerDeepLink();   // 답변완료 푸시로 들어왔으면 채팅창 자동 오픈 + 답변 복원

    // 서버 노출설정 로드(기본 off) → FAB 재평가
    fetchConfig();

    // body[data-active-tab] 변화 감지 → FAB 표시 재평가(메인 특보 탭에서만 노출)
    try {
      var moBody = new MutationObserver(function () { updateFabVisibility(); });
      moBody.observe(document.body, { attributes: true, attributeFilter: ['data-active-tab'] });
    } catch (_) {}

    // 다른 탭/창에서 관리자 모드가 바뀌면(=admin 노출조건 변동) FAB 재평가
    window.addEventListener('storage', function (e) {
      if (!e || e.key === LS_ADMIN) updateFabVisibility();
    });

    updateFabVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // ── 공개 표면 ──
  window.NariyaChat = {
    __loaded: true,
    /** 통합관리자 센터가 부르는 진입점: 주어진 컨테이너에 관리자 콘솔 전체를 렌더(재호출 안전). */
    renderAdminInto: renderAdminInto,
    /** 채팅 팝업 열기(테스트/외부 트리거용). */
    open: openChat,
    /** ⚠수치검증 목록 새로고침(현재 열려 있을 때). */
    refreshReviews: function () { var h = document.getElementById('nryaReviewHost'); if (h) renderReviewCards(h); },
    /** 서버 노출설정 재조회 + FAB 재평가. */
    refreshConfig: fetchConfig,
    /** FAB 표시 재평가(관리자 모드/탭/노출 변경 후 호출). */
    updateFab: updateFabVisibility
  };
})();
