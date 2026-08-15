/**
 * ============================================================================
 * 파일명: client/js/ai-chat/ai_chat.js
 * 역할  : 해양법령 챗봇(나리야) 인앱 모듈. 두 갈래로 나뉜다.
 *         (A) 관리자 콘솔 — 통합관리자 센터의 "나리야 법령" 탭이 부르는
 *             window.NariyaChat.renderAdminInto(container) 로, 지식 방 브라우저
 *             (원문/위키개념/법령/비교허브/별표/지식그래프 + 역할설명 인트로카드)
 *             + 관리자 검토센터(5개 서브탭·원본 vs AI값·교정입력·승인/반려·반영사슬)
 *             + 챗봇 노출 토글(서버 전역 설정)을 렌더한다.
 *         (B) 사용자 챗봇 — 우측 하단 FAB + 카카오톡풍 채팅 팝업(생각중·스켈레톤·
 *             근거법령 아코디언 = 위임흐름 체인 + 조문 카드를 누르면 뜨는 조문 원문 팝업).
 *             헤더 🕘 는 이 기기에 저장해둔 **지난 대화 기록**(localStorage
 *             'nariya_history_v1' — 질문·답변 문장만, 근거 법령은 저장 안 함)을
 *             날짜별 목록으로 열고, 항목을 누르면 그 질문/답변을 말풍선으로 되살린다.
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
 *                    하드웨어 뒤로가기로 닫기)
 *  - 서버 API      : routes/legal.js
 *                    GET  /api/legal/config                   (노출설정 조회, 기본 off)
 *                    POST /api/legal/config {exposure}         (노출설정 저장, 관리자)
 *                    GET  /api/legal/reviews?status=pending    (검증 대기 목록)
 *                    GET  /api/legal/reviews/stats             (대기/승인 카운트)
 *                    POST /api/legal/reviews/:id/approve        (승인/반려 + 교정값)
 *                    GET  /api/legal/admin/stats               (초안·피드백·새지식후보·개정검토 실카운트)
 *                    GET  /api/legal/drafts                    (초안승인 탭 목록)
 *                    POST /api/legal/ask {query, deviceId, notifyOnComplete, ctx?, profile?}
 *                                                              (질문→AI 답변 스트리밍(NDJSON)+근거 법령
 *                                                               · done 에 clarify{question,options} 가 오면
 *                                                                 답변 대신 되묻기 선택지 버튼을 그리고,
 *                                                                 누르면 "원래질문 — 라벨"로 다시 질의
 *                                                               · [H-37] 선택지에 ctx 가 실려 오면(이해확인·
 *                                                                 상황질문·프로필확인) 질의는 그대로 두고
 *                                                                 ctx 만 되돌려 보낸다. profile 은 헤더 ⚙
 *                                                                 패널이 이 기기에만 저장한 스냅샷이고
 *                                                                 서버는 그 요청 중에만 읽는다(미저장)
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
  // [H-37 §3.2 · 2026-08-14 적대검증 F2] 서버가 마지막 답변에 실어 보낸 ctxNext(= 지금까지 확정된
  //   맥락). **ctx 를 안 든 선택지 버튼**(기존 되묻기·트리 되묻기)을 눌러도 이 값을 이어 보내야
  //   직전에 확정한 조건이 사라지지 않는다 — 안 그러면 프로필로 "네"를 누른 축을 서버가 다시 묻는
  //   무한루프가 된다(라이브 재현). 사용자가 **새 질문을 직접 타이핑**하면 그 순간 비운다(§9.1 #1).
  //   pendingCtx 와 마찬가지로 메모리에만 둔다(새로고침하면 소멸).
  var lastCtx = null;

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
  // 지식 방 데이터 모델 (대표 정적 콘텐츠 · nrya- 접두어)
  // ============================================================================
  var accHTML =
    '<div class="nrya-acc nrya-open"><div class="nrya-acc-head"><div style="flex:1;min-width:0"><div class="nrya-acc-name">해상교통안전법</div><div class="nrya-acc-dom">03 해상교통안전 · 해양수산부</div></div><div class="nrya-eff"><span class="nrya-lbl">시행</span>2024. 7. 26.</div><div class="nrya-chev">▼</div></div>' +
      '<div class="nrya-acc-body">' +
        '<div class="nrya-file"><div class="nrya-file-ic">법</div><div class="nrya-file-nm">법률<span class="nrya-file-amd">· 일부개정</span></div><div class="nrya-file-eff">시행 2024. 7. 26.</div></div>' +
        '<div class="nrya-file"><div class="nrya-file-ic nrya-rule">령</div><div class="nrya-file-nm">시행령<span class="nrya-file-amd">· 일부개정</span></div><div class="nrya-file-eff">시행 2025. 5. 20.</div></div>' +
        '<div class="nrya-file"><div class="nrya-file-ic nrya-rule">칙</div><div class="nrya-file-nm">시행규칙</div><div class="nrya-file-eff">시행 2024. 7. 26.</div></div>' +
        '<div class="nrya-byl-title">별표 · 별지 서식 (64건)</div>' +
        '<div class="nrya-byl"><span class="nrya-byl-no">령 별표1</span><div style="flex:1"><div class="nrya-byl-nm">교통안전특정해역의 범위(제5조 관련)</div><div class="nrya-dl"><a href="#">⬇ HWP 원본</a><a href="#" class="nrya-img">🖼 이미지</a><a href="#">📄 본문(텍스트)</a></div></div></div>' +
        '<div class="nrya-byl"><span class="nrya-byl-no">칙 별표3</span><div style="flex:1"><div class="nrya-byl-nm">해양사고 관련 보고 서식</div><div class="nrya-dl"><a href="#">⬇ HWP 원본</a><a href="#">📄 본문</a></div></div></div>' +
      '</div></div>' +
    ['선박안전법|02 선박 · 별표 147|2025. 1. 24.', '수산업법|06 수산 · 별표 122|2024. 12. 20.', '해양환경관리법|09 해양환경|2025. 7. 25.', '수상레저안전법|05 레저 · 해양경찰청|2024. 7. 31.']
      .map(function (x) { var p = x.split('|'); return '<div class="nrya-acc"><div class="nrya-acc-head"><div style="flex:1;min-width:0"><div class="nrya-acc-name">' + p[0] + '</div><div class="nrya-acc-dom">' + p[1] + '</div></div><div class="nrya-eff"><span class="nrya-lbl">시행</span>' + p[2] + '</div><div class="nrya-chev">▼</div></div><div class="nrya-acc-body"></div></div>'; }).join('');

  /** 리스트 래퍼. @param {string[]} arr @returns {string} */
  function items(arr) { return '<div class="nrya-list">' + arr.join('') + '</div>'; }

  /** 개념 리스트 아이템 1개 HTML. @returns {string} */
  function concept(t, s, st, stc, chips) {
    return '<div class="nrya-item"><div class="nrya-item-b"><div class="nrya-item-t">' + t + '</div><div class="nrya-item-s">' + s + '</div>' +
      (chips ? '<div class="nrya-chips">' + chips.map(function (c) { return '<span class="nrya-chip">' + c + '</span>'; }).join('') + '</div>' : '') +
      '</div>' + (st ? '<span class="nrya-stbadge ' + stc + '">' + st + '</span>' : '') + '</div>';
  }

  var ROOMS = {
    원문: {
      ic: '📁', tag: 'raw/ · 원문 보관실', n: '70법 · 7,203 원문',
      desc: '국가법령정보센터 <b>원문 아카이브(불변)</b>입니다. 위키의 재료가 되는 1층. 법률·시행령·시행규칙 전문 + 별표·서식 + 고시(행정규칙)를 법령별로 보관합니다. 누르면 법령별 아코디언 → 시행일·별표 다운로드.',
      meta: ['불변', '15 도메인', '별표·고시 포함'],
      render: function () { return items([accHTML]); }
    },
    위키개념: {
      ic: '📗', tag: 'wiki/concepts/ · 답변 근거실', n: '919 개념',
      desc: '원문을 엮은 <b>개념 페이지</b>. 챗봇이 실제 답변에 사용하는 핵심 근거(2층). 정의우선·처벌 3축·타법연결을 담습니다. status(승인상태)에 따라 챗봇 인용 여부가 결정됩니다.',
      meta: ['canonical 8', 'review-pending 83', 'draft 842'],
      render: function () {
        return items([
          concept('음주운항조타', '해상교통안전법 · 혈중알코올 0.03% 기준', 'canonical', 'nrya-st-can', ['처벌 3축', '↔ 수상레저']),
          concept('어선등록총톤수', '어선법 · 등록·검사 정의', 'canonical', 'nrya-st-can', ['정의우선']),
          concept('만재흘수선복원성', '선박안전법 · 안전수치 포함', 'review-pending', 'nrya-st-rev', ['⚠ 사람승인 대기']),
          concept('허가어업', '수산업법 · 톤수 구간·처벌', 'review-pending', 'nrya-st-rev', ['처벌 포함']),
          concept('연안출입통제구역', '연안사고예방법 · 초안', 'draft', 'nrya-st-draft', ['미승인'])]);
      }
    },
    법령: {
      ic: '📘', tag: 'wiki/statutes/ · 법령 허브', n: '73 법령',
      desc: '각 법의 <b>허브 페이지</b>(2층). 목차·타법연결 표·처벌 요약을 한 곳에 모아, 그 법의 전체 그림과 다른 법과의 연결을 봅니다. 개념 페이지들의 착지점.',
      meta: ['70 기준법 + 교차참조'],
      render: function () {
        return items([
          concept('해상교통안전법', '타법연결 12 · 개념 22', '', 'nrya-st-can', ['허브']),
          concept('수산업법', '타법연결 28 · 개념 19', '', 'nrya-st-can', ['최대 백본']),
          concept('선박안전법', '타법연결 · 별표 147', '', 'nrya-st-can', []),
          concept('영해 및 접속수역법', '정의 백본 · 19법이 인용', '', 'nrya-st-can', ['정의 허브'])]);
      }
    },
    비교허브: {
      ic: '🔀', tag: 'wiki/comparisons/ · 테마 비교실', n: '26 허브',
      desc: '여러 법을 <b>하나의 축으로 비교</b>하는 방(신경망 허브). "음주운항 처벌은 법마다 어떻게 다른가" 같은 교차 질문에 답합니다. 톤수·조업형태·지역 조건 컬럼으로 프로필 필터와 연결.',
      meta: ['교차법 비교', '신경망 허브'],
      render: function () {
        return items([
          concept('음주운항_측정거부', '5개 법 · 0.03% 기준 비교', '', 'nrya-st-can', ['처벌축']),
          concept('형사절차_일반', '공소시효·미수·경합범', '', 'nrya-st-can', []),
          concept('신고_허가_면허', '행정행위 강도 3분해', '', 'nrya-st-can', ['조건 컬럼']),
          concept('폐기물_해양오염', '배출·투기 규제 비교', '', 'nrya-st-can', [])]);
      }
    },
    '별표·서식': {
      ic: '📊', tag: 'wiki/annexes/ · 별표·서식실', n: '98 정리본',
      desc: '별표(표·기준)와 별지 서식의 <b>정리본</b>. 원문 이미지/HWP를 표로 정리하고, 서식은 원버튼 다운로드를 제공합니다. 이미지 판독 수치는 ⚠REVIEW로 사람 검증 대기.',
      meta: ['표 정리', '서식 다운로드', '⚠REVIEW 일부'],
      render: function () {
        return items([
          concept('수상레저안전법 시행규칙 별표6', '조종면허 취소·정지 세부기준', '', 'nrya-st-can', ['⬇ 다운로드']),
          concept('선박안전법 별표1의2', '대행검사기관 협정내용', 'review-pending', 'nrya-st-rev', ['⚠ 판독값']),
          concept('해상교통안전법 별표1', '교통안전특정해역 좌표', '', 'nrya-st-can', ['🗺 지도'])]);
      }
    },
    지식그래프: {
      ic: '🕸️', tag: 'wiki/graph.json · 신경망', n: '88 노드 · 1,310 엣지',
      desc: '법·개념을 <b>노드</b>, 인용·[[링크]]를 <b>엣지</b>로 본 신경망(그래프층). 챗봇 멀티홉 검색이 이 인접구조를 타고 근거를 확장합니다. 관리자는 고립노드·비대칭·허브결손을 눈으로 점검.',
      meta: ['멀티홉 기반', 'cite+link 639', 'link 395'],
      render: function () {
        var g = '<div class="nrya-g-stats"><div class="nrya-g-stat"><div class="nrya-g-num">88</div><div class="nrya-g-lab">노드(법)</div></div><div class="nrya-g-stat"><div class="nrya-g-num">1,310</div><div class="nrya-g-lab">엣지(인용·링크)</div></div></div>';
        var canvas = '<div class="nrya-g-canvas">';
        var pos = [[15, 30], [45, 20], [75, 35], [30, 65], [60, 70], [85, 60], [50, 45], [20, 50]];
        pos.forEach(function (p) { canvas += '<div class="nrya-g-node" style="left:' + p[0] + '%;top:' + p[1] + '%"></div>'; });
        [[0, 6], [1, 6], [2, 6], [6, 3], [6, 4], [4, 5], [7, 0], [7, 3]].forEach(function (e) {
          var a = pos[e[0]], b = pos[e[1]]; var dx = (b[0] - a[0]), dy = (b[1] - a[1]); var len = Math.sqrt(dx * dx + dy * dy); var ang = Math.atan2(dy * 1.5, dx * 6) * 180 / Math.PI;
          canvas += '<div class="nrya-g-edge" style="left:' + a[0] + '%;top:' + a[1] + '%;width:' + len * 5.5 + 'px;transform:rotate(' + ang + 'deg)"></div>';
        });
        canvas += '</div>';
        return '<div class="nrya-list">' + g + canvas + '<div class="nrya-skel-box" style="text-align:left"><div class="nrya-skel-t">그래프 뷰 · 골격</div><div style="font-size:12px;color:var(--nrya-text-sub);line-height:1.6">실배선 시: 노드 탭 → 그 법의 인접 법·개념 하이라이트, 고립노드 빨강 표시, 비대칭 링크 경고. 관리자가 ⚠REVIEW·개정 큐와 연동해 점검.</div></div></div>';
      }
    }
  };
  var ROOM_ORDER = ['원문', '위키개념', '법령', '비교허브', '별표·서식', '지식그래프'];
  var ROOM_N = { 원문: true, 위키개념: true };

  // ============================================================================
  // 관리자 검토 데이터 모델 (5개 서브탭 전부 서버 연동 — 배지: refreshAdminStats/refreshStats,
  //   목록: 초안승인=renderDraftCards·⚠수치검증=renderReviewCards·나머지 3방=renderFeedbackCards/
  //   renderCandidateCards/renderAmendCards)
  // ============================================================================
  var ADMIN = {
    초안승인: { n: '…', desc: '사서(AI)가 만든 <b>미승인 초안(draft)</b> 대기실. 순수 정의·절차는 재검증 파이프라인이 자동 승격, 처벌·안전값 포함분은 ⚠수치검증 방에서 사람이 승인해야 canonical이 됩니다.', render: null /* 서버 연동: renderDraftCards */ },
    피드백: { n: '…', desc: '답변 <b>👍/👎 익명 로그</b>를 모아 원인 분류(triage) 후 관리자에게 올리는 방. 👎가 쌓인 주제 → 위키 보강으로 연결.', render: null /* 서버 연동: renderFeedbackCards */ },
    새지식후보: { n: '…', desc: '대화 중 <b>새로 알게 된 지식 후보</b>. 공식 출처와 대조 후 관리자가 승인하면 위키에 편입됩니다(환각 방지 게이트).', render: null /* 서버 연동: renderCandidateCards */ },
    개정검토: { n: '…', desc: '법률 <b>개정·조문 변경이 감지</b>됐을 때 사람 검토 전까지 모아두는 방. 시행일·MST diff로 신설·삭제·금액·조번재편을 적재.', render: null /* 서버 연동: renderAmendCards */ },
    '⚠수치검증': { n: '…', desc: '별표 <b>이미지 판독값(OCR)·조번호 재편</b> 및 처벌·안전수치를 사람이 검증하는 방(가장 급함). 서버 review_queue.md 의 검증 대기 항목을 불러와 승인/반려한다.', render: null /* 서버 연동: renderReviewCards */ }
  };
  var ADMIN_ORDER = ['초안승인', '피드백', '새지식후보', '개정검토', '⚠수치검증'];

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
              // 리뷰 전용 페이지(폰·PC에서 크게 읽고 승인) 바로가기
              '<button type="button" onclick="window.open(\'/legal_review.html\',\'_blank\',\'noopener\')" ' +
                'style="width:100%;display:flex;align-items:center;justify-content:center;gap:8px;border:1px solid rgba(105,240,174,.45);' +
                'background:rgba(105,240,174,.12);color:#8fe6bb;font-family:inherit;font-weight:800;font-size:14px;padding:13px;border-radius:11px;margin-bottom:12px;cursor:pointer;">' +
                '🔗 리뷰 전용 페이지 크게 열기 (승인 시 위키 자동 반영)</button>' +
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

  /** 방 pill 목록을 그린다(활성 방 표시 + N 배지). @param {string} active */
  function renderRoomPills(active) {
    var el = document.getElementById('nryaRoomPills'); if (!el) return; el.innerHTML = '';
    ROOM_ORDER.forEach(function (k) {
      var r = ROOMS[k];
      var b = document.createElement('div'); b.className = 'nrya-room' + (k === active ? ' nrya-active' : '');
      b.innerHTML = esc(k) + '<span class="nrya-cnt">' + esc(r.n.split(' ')[0]) + '</span>' + (ROOM_N[k] ? '<span class="nrya-new-badge">N</span>' : '');
      b.addEventListener('click', function () { renderRoomPills(k); renderRoom(k); });
      el.appendChild(b);
    });
  }

  /** 선택한 방의 인트로 카드 + 대표 내용을 그린다. @param {string} k 방 이름 */
  function renderRoom(k) {
    var r = ROOMS[k]; var host = document.getElementById('nryaRoomContent'); if (!host) return;
    var intro = '<div class="nrya-intro"><div class="nrya-intro-h"><div class="nrya-intro-ic">' + r.ic + '</div><div><div class="nrya-intro-name">' + esc(k) + ' 방</div><div class="nrya-intro-tag">' + esc(r.tag) + '</div></div></div>' +
      '<div class="nrya-intro-desc">' + r.desc + '</div><div class="nrya-intro-meta">' + r.meta.map(function (m) { return '<span>' + esc(m) + '</span>'; }).join('') + '</div></div>';
    host.innerHTML = intro + r.render() + '<div class="nrya-foot-note">대표 예시 · 실제 데이터는 해당 방 폴더에서 로드됩니다.</div>';
    bindAcc();
  }

  // 서브탭 배지가 참조할 adminStatsCache 필드명(⚠수치검증은 statsCache.pending을 따로 씀)
  var ADMIN_STAT_KEY = { 초안승인: 'draft', 피드백: 'feedback', 새지식후보: 'candidates', 개정검토: 'amendments' };

  /** 서브탭(관리자 검토 5개 방)을 그린다. @param {string} active */
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

  /** 선택한 관리자 방을 그린다(5방 전부 서버 연동). @param {string} k */
  function renderAdmin(k) {
    var a = ADMIN[k]; var host = document.getElementById('nryaAdminContent'); if (!host) return;
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
    }
  }

  // ── 지식 방 아코디언 바인딩 ──
  function bindAcc() {
    var host = document.getElementById('nryaRoomContent'); if (!host) return;
    host.querySelectorAll('.nrya-acc-head').forEach(function (h) {
      h.onclick = function () { h.parentElement.classList.toggle('nrya-open'); };
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
  function renderDraftCards(host) {
    if (!host) return;
    host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>초안 목록을 불러오는 중…</div>';
    legalGet('/api/legal/drafts').then(function (res) {
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
      host.innerHTML = DRAFT_NOTE + '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">총 ' + list.length + '건</div>' +
        list.map(function (d) {
          var st = d.penalty ? '<span class="nrya-rv-st nrya-warn">처벌 포함·사람승인</span>' : '<span class="nrya-rv-st nrya-wait">자동승격 대상</span>';
          return '<div class="nrya-rv"><div class="nrya-rv-head"><span class="nrya-rv-id">draft</span><div class="nrya-rv-t">' + esc(d.topic || d.file) + '<small>' + esc(d.law || '') + '</small></div>' + st + '</div></div>';
        }).join('');
    }).catch(function (e) {
      host.innerHTML = DRAFT_NOTE + '<div class="nrya-notice-box nrya-err"><span class="nrya-em">⚠️</span>네트워크 오류: ' + esc(String(e && e.message || e)) + '</div>';
    });
  }

  // ============================================================================
  // ⚠수치검증 — 서버 연동(목록/승인/반려)
  // ============================================================================
  var DUAL_NOTE = '<div class="nrya-dual-note">⚠ <b>승인 이원화</b>: 처벌·과태료·안전수치·⚠REVIEW 포함 페이지는 <b>사람 승인 필수</b>. 순수 정의/절차 페이지만 AI 자동 승격.</div>';

  /**
   * 검증 대기 목록을 서버에서 불러와 리뷰 카드로 렌더한다.
   * 401 → "관리자 로그인 필요", 오류 → 오류 박스, 빈 목록 → 안내. 절대 빈 화면 없음.
   * @param {HTMLElement} host - 카드를 담을 컨테이너
   * [연계] → GET /api/legal/reviews?status=pending, bindReviewCard.
   */
  function renderReviewCards(host) {
    if (!host) return;
    host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">⏳</span>검증 대기 목록을 불러오는 중…</div>';
    legalGet('/api/legal/reviews?status=pending').then(function (res) {
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
      var list = data.reviews || [];
      if (!list.length) {
        host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">✅</span>검증 대기 항목이 없습니다.</div>';
        return;
      }
      host.innerHTML = DUAL_NOTE + list.map(function (rv, i) { return reviewCardHTML(rv, i === 0); }).join('');
      host.querySelectorAll('.nrya-rv').forEach(function (card) { bindReviewCard(card); });
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

  /** 개정 후보 카드 1건. @param {object} am - {id,ts,law,kind,mst,법령명,이전,현재,status} @returns {string} */
  function amendmentCardHTML(am) {
    var st = am.status === 'approved' ? '<span class="nrya-rv-st nrya-done">✓ 승인·재수집 필요</span>'
      : am.status === 'dismissed' ? '<span class="nrya-rv-st nrya-rej">✗ 무시</span>'
      : '<span class="nrya-rv-st nrya-warn">개정 감지</span>';
    var prev = am.이전 || {}; var cur = am.현재 || {};
    var lawName = am.법령명 || am.law || '';
    var link = 'https://www.law.go.kr/lsSc.do?menuId=1&query=' + encodeURIComponent(lawName);
    var body =
      '<div class="nrya-rv-body">' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">📌 종류</div><div class="nrya-rv-fval">' + esc(am.kind || '') + ' · MST ' + esc(am.mst || '') + '</div></div>' +
        '<div class="nrya-rv-field"><div class="nrya-rv-flab">🔄 변경</div><div class="nrya-rv-fval">공포번호 ' + esc(prev.공포번호 || '?') + ' → <b>' + esc(cur.공포번호 || '?') + '</b><br>시행일자 ' + esc(prev.시행일자 || '?') + ' → <b>' + esc(cur.시행일자 || '?') + '</b></div></div>' +
        '<a class="nrya-rv-link" href="' + esc(link) + '" target="_blank" rel="noopener noreferrer">🔗 law.go.kr에서 확인</a>' +
        (am.status === 'pending' ? '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 승인(재수집 필요)</button><button class="nrya-btn-no">✗ 무시</button></div>' : '') +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
      '</div>';
    return '<div class="nrya-rv" data-id="' + esc(am.id) + '"><div class="nrya-rv-head"><span class="nrya-rv-id">📌</span><div class="nrya-rv-t">' + esc(lawName || am.id) + '<small>' + esc(shortTs(am.ts)) + '</small></div>' + st + '</div>' + body + '</div>';
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
    host.innerHTML = '<div class="nrya-rv-actions" style="margin-bottom:10px"><button class="nrya-btn-ok" id="nryaAmendScanBtn" style="flex:0 0 auto;padding:8px 16px">' + SCAN_LABEL + '</button></div>' +
      '<div class="nrya-inline-err nrya-hidden" id="nryaAmendScanErr" style="display:none"></div>' +
      '<div id="nryaAmendListHost"></div>';
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
        // started:true — 백그라운드에서 계속 진행 중, 아직 새 항목은 안 들어와 있으니 목록을
        // 지금 다시 그려봐야 그대로다(혼동 방지). 안내 문구만 목록 위에 한 번 얹는다.
        var listHost = document.getElementById('nryaAmendListHost');
        if (listHost) {
          listHost.insertAdjacentHTML('afterbegin', '<div style="font-size:11.5px;color:var(--nrya-text-sub);margin:2px 0 8px">🔄 백그라운드 스캔이 시작됐습니다. 완료까지 최대 4분 — 잠시 후 이 방을 다시 열어 새로고침해 주세요.</div>');
        }
      }).catch(function (e) { scanBtn.disabled = false; scanBtn.textContent = SCAN_LABEL; if (scanErr) { scanErr.style.display = 'block'; scanErr.textContent = '네트워크 오류: ' + String(e && e.message || e); } });
    };
    loadAmendList();
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
      listHost.querySelectorAll('.nrya-rv').forEach(function (card) { bindDecideCard(card, '/api/legal/amendments', 'approved', 'dismissed', '승인(재수집 필요)', '무시'); });
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
    var errBox = card.querySelector('.nrya-inline-err');
    var findingsIn = card.querySelector('.nrya-findings-in');

    function showErr(msg) { if (!errBox) return; errBox.style.display = 'block'; errBox.classList.remove('nrya-hidden'); errBox.textContent = msg; }
    function clearErr() { if (!errBox) return; errBox.style.display = 'none'; errBox.textContent = ''; }
    function setBusy(b) { if (okBtn) okBtn.disabled = b; if (noBtn) noBtn.disabled = b; }

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
          if (decision === 'reject') { markRejected(card, data); }
          else { markApproved(card, val, data); }
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
          } else {
            setBusy(false);
            if (okBtn) okBtn.textContent = '✍️ 확인 내용 다시 제출';
            showVerdict(data.verdict, data.message);
          }
          refreshStats();
        })
        .catch(function (e) { showErr('네트워크 오류: ' + String(e && e.message || e)); setBusy(false); if (okBtn) okBtn.textContent = '✍️ 확인 내용 제출 → AI 재검토'; });
    }

    if (findingsIn) {
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
      adminStatsCache = { draft: data.draft, feedback: data.feedback, candidates: data.candidates, amendments: data.amendments };
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
            '<div><div class="nrya-chat-name">해양법령 도우미</div></div>' +
            '<div class="nrya-chat-acts">' +
              '<button class="nrya-chat-x nrya-chat-back" id="nryaChatBack" title="뒤로" style="display:none">‹</button>' +
              // [H-37 §7.2] 나에 대해서 설명하기(온디바이스 프로필) — 이 기기에만 저장된다
              '<button class="nrya-chat-x nrya-chat-prof" id="nryaChatProf" title="나에 대해서 설명하기">⚙</button>' +
              '<button class="nrya-chat-x nrya-chat-hist" id="nryaChatHist" title="대화 기록">🕘</button>' +
              '<button class="nrya-chat-x" id="nryaChatX">×</button>' +
            '</div>' +
          '</div>' +
          '<div class="nrya-chat-body" id="nryaChatBody">' +
            '<div class="nrya-krow nrya-ai"><div class="nrya-kava"><div class="nrya-ava"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">안녕하세요! 해양법령에 대해 편하게 물어보세요. 예: "5톤 낚시어선인데 야간에 조업해도 되나요?"</div></div></div></div>' +
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
    wrap.classList.add('nrya-open');
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
    closeHistory(true);   // 기록 화면을 켜둔 채 닫았어도 다음에 열면 평소 대화 화면부터
  }

  // ── 대화 기록(기기 저장): 헤더 🕘 → 날짜별 목록 → 누르면 그 질문/답변을 말풍선으로 ──────
  //    저장은 doSend 가 **진짜 최종 답변**을 받은 순간에만 한다(되묻기·오류는 저장 안 함).
  //    근거 법령(sources·citationChain)은 저장하지 않는다 — 용량이 커지는데 "내가 뭘 물었더라"
  //    를 되짚는 데는 질문·답변 문장이면 충분하다(지난 답변을 눌러도 근거 아코디언은 안 붙는다).

  /**
   * 저장된 대화 기록을 배열로 읽는다(없거나 깨졌으면 빈 배열 — 절대 예외를 던지지 않는다).
   * @returns {Array<{q:string,a:string,note:string,ts:number}>} 오래된 것부터
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
   * 예: pushHistory('5톤 낚시어선 야간조업?', {answer:'…', note:'…'})
   * @param {string} q - 사용자 질문
   * @param {object} data - done 응답({answer, note})
   * [연계] ← doSend 의 최종 렌더 직후(되묻기·오류 제외). → openHistory 목록.
   */
  function pushHistory(q, data) {
    try {
      var arr = loadHistory();
      arr.push({ q: String(q || ''), a: String((data && data.answer) || ''), note: String((data && data.note) || ''), ts: Date.now() });
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

  /**
   * 기록 목록 HTML(최신 → 과거, 날짜 머리글로 묶음)을 만든다. 질문이 길면 CSS 로 말줄임한다.
   * @returns {string} HTML(기록이 없으면 안내 문구)
   */
  function historyListHTML() {
    var list = loadHistory();
    if (!list.length) {
      return '<div class="nrya-hist-empty">아직 저장된 대화가 없어요.<br>질문하고 답변을 받으면 여기에 쌓입니다.</div>';
    }
    var html = '', lastDay = '';
    for (var i = list.length - 1; i >= 0; i--) {
      var e = list[i] || {};
      var day = histDayLabel(e.ts);
      if (day !== lastDay) { lastDay = day; html += '<div class="nrya-hist-day">' + esc(day) + '</div>'; }
      html += '<button type="button" class="nrya-hist-item" data-ts="' + esc(String(e.ts)) + '">' +
        '<span class="nrya-hist-q">' + esc(e.q || '(질문 없음)') + '</span>' +
        '<span class="nrya-hist-t">' + esc(histTimeLabel(e.ts)) + '</span>' +
      '</button>';
    }
    return html;
  }

  /**
   * 헤더 오른쪽 버튼을 기록 모드/평소 모드로 바꾼다(‹ 뒤로 ↔ 🕘 기록). ✕ 는 항상 그대로 둔다.
   * @param {boolean} backMode - true 면 ‹ 만, false 면 🕘 만 보인다
   */
  function setHistHeader(backMode) {
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

  /** 헤더 ‹ 버튼: 목록을 보고 있으면 대화로, 지난 답변을 펼친 뒤라면 목록으로 돌아간다. */
  function onHistBack() {
    if (isProfOpen()) { closeProf(); return; }   // 프로필 화면에서 ‹ 는 대화로 되돌린다
    if (isHistoryOpen()) closeHistory(true);
    else openHistory();
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
  var PROFILE_MENU = [
    { k: '직군', opts: ['어업인', '비어업인', '해양종사자', '공무원', '그 밖'] },
    { k: '선박용도', opts: ['낚시어선', '어선', '레저', '일반'] },
    { k: '톤수', input: '숫자만(예: 9.77) — 총톤수', suffix: '톤' },
    { k: '길이', input: '숫자만(예: 12) — 선박 길이', suffix: '미터' },
    { k: '어업종류', opts: ['연안자망', '근해통발', '양식', '그 밖'] },
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

  /** 프로필 화면 HTML(저장된 값 + 카테고리별 버튼/입력). @returns {string} */
  function profPanelHTML() {
    var p = loadProfile();
    var h = '<div class="nrya-hist-day">나에 대해서 설명하기</div>' +
      '<div class="nrya-disc">여기 적은 내용은 <b>이 기기에만</b> 저장돼요. 답이 조건에 따라 갈릴 때 ' +
      '나리야가 "저장된 정보로 답할까요?"라고 먼저 확인해요.</div>';
    PROFILE_MENU.forEach(function (m, mi) {
      var cur = p.fields[m.k];
      h += '<div class="nrya-hist-day">' + esc(m.k) +
        (cur ? ' <span class="nrya-hist-t">현재: ' + esc(cur.v) + (cur.at ? ' (' + esc(String(cur.at).slice(0, 10)) + ' 저장)' : '') + '</span>' : '') +
        '</div><div class="nrya-consent-btns">';
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
    h += '<div class="nrya-consent-btns"><button type="button" class="nrya-consent-btn nrya-prof-reset">전체 초기화</button></div>';
    return h;
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
   * 기록 항목을 눌렀을 때: 그 질문/답변을 평소 말풍선 쌍으로 대화창에 붙이고 대화 화면으로 돌아간다.
   * 붙인 뒤에도 입력창은 그대로라 이어서 새 질문을 할 수 있고, 헤더 ‹ 로 목록에 다시 갈 수 있다.
   * @param {string} ts - 항목의 data-ts(저장 시각 = 식별자)
   * [연계] → renderRestoredAnswer(푸시 복원과 같은 말풍선 쌍 렌더를 재사용).
   */
  function openHistoryEntry(ts) {
    var list = loadHistory(), hit = null;
    for (var i = list.length - 1; i >= 0; i--) { if (String(list[i] && list[i].ts) === String(ts)) { hit = list[i]; break; } }
    if (!hit) return;
    closeHistory(false);   // 목록만 닫고 ‹ 는 남긴다
    renderRestoredAnswer({ ok: true, query: hit.q, answer: hit.a, sources: [], note: hit.note });
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
    var send = document.getElementById('nryaChatSend'); if (send) send.addEventListener('click', doSend);
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
      if (e.target.closest('.nrya-chain-tel')) return;
      var hit = e.target.closest('.nrya-chain-hit');
      if (hit) openArtPop(hit);
      var fbBtn = e.target.closest('.nrya-fb-btn');
      if (fbBtn) { onFeedbackThumb(fbBtn); return; }
      var fbSend = e.target.closest('.nrya-fb-send');
      if (fbSend) { onFeedbackSend(fbSend); return; }
    });

    // 기록 목록 항목 클릭(목록은 열 때마다 새로 그려지므로 패널에 한 번만 위임한다)
    var panel = document.getElementById('nryaHistPanel');
    if (panel) panel.addEventListener('click', function (e) {
      var it = e.target.closest('.nrya-hist-item');
      if (it) openHistoryEntry(it.getAttribute('data-ts'));
    });

    // [H-37 §7.2] 프로필 패널(버튼 선택 · 직접 입력 저장 · 항목/전체 삭제) — 저장 즉시 다시 그린다.
    var pp = document.getElementById('nryaProfPanel');
    if (pp) pp.addEventListener('click', function (e) {
      var b = e.target.closest('.nrya-prof-btn');
      if (b) { saveProfileField(b.getAttribute('data-k'), b.getAttribute('data-v') || ''); openProf(); return; }
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
      // 서버가 판정 상한(MAX_REFS)에서 멈춰 **아예 안 본** 참조는 "미수집"이 아니다 —
      // 없는 걸 있다고 하지도, 모르는 걸 없다고 단정하지도 않게 원문 글자 그대로 둔다.
      if (!ref && artPopRefsCut) { host.appendChild(document.createTextNode(m[0])); continue; }
      var span = document.createElement('span');
      if (ref && ref.kind !== 'missing') {
        span.className = 'nrya-byl-ref';
        span.setAttribute('data-byl', key);
        span.textContent = isImg ? '🖼 원본 이미지' : m[0];
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
          '<span class="nrya-artpop-chip" id="nryaArtChip">원문 · 자동 발췌</span>' +
          '<p class="nrya-artpop-law" id="nryaArtLaw"></p>' +
          '<h3 class="nrya-artpop-art" id="nryaArtTitle"></h3>' +
        '</div>' +
        '<button type="button" class="nrya-artpop-x" id="nryaArtX">×</button>' +
      '</div>' +
      '<div class="nrya-artpop-gist" id="nryaArtGist"></div>' +
      '<span class="nrya-artpop-eff" id="nryaArtEff"></span>' +
      '<div class="nrya-artpop-body" id="nryaArtBody"></div>' +
      '<div class="nrya-artpop-foot" id="nryaArtFoot"></div>';
    var bveil = document.createElement('div'); bveil.className = 'nrya-bylpop-veil'; bveil.id = 'nryaBylVeil';
    var bpop = document.createElement('div'); bpop.className = 'nrya-bylpop'; bpop.id = 'nryaBylPop';
    bpop.innerHTML =
      '<div class="nrya-bylpop-head">' +
        '<span class="nrya-bylpop-t" id="nryaBylTitle"></span>' +
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
      if (r) openBylPop(artPopRefs[r.getAttribute('data-byl')]);
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
      if (cur.length !== cells.length) { ok = false; return; }
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
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].cells, cols = rows[i].cols, len = cells.length;
      if (len === max) continue;                      // 칸이 다 있는 행은 넓힐 일이 없다
      for (var k = 0; k < len; k++) {
        if (!cells[k]) continue;                      // 빈 칸은 어디 놓여도 값이 안 뒤바뀐다
        // 이 칸이 그려질 열 범위: 마지막 칸은 남은 열 전부(colspan), 나머지는 같은 번호의 열 하나.
        var lo = ref[k], hi = (k === len - 1) ? ref[max] : ref[k + 1];
        if (cols[k] < lo - 1 || cols[k + 1] > hi + 1) return null;   // ±1 은 원문의 한 칸 오차 허용
      }
    }
    return rows.map(function (r) { return r.cells; });
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
    var max = 0;
    rows.forEach(function (r) { if (r.length > max) max = r.length; });
    var tbl = document.createElement('table'); tbl.className = 'nrya-byl-tbl';
    rows.forEach(function (cells, ri) {
      var tr = document.createElement('tr');
      if (/^(합계|소계|계)$/.test((cells[0] || '').replace(/\s/g, ''))) tr.className = 'nrya-byl-sum';
      cells.forEach(function (c, ci) {
        var cell = document.createElement(ri === 0 ? 'th' : 'td');
        if (ci === cells.length - 1 && cells.length < max) cell.colSpan = max - cells.length + 1;
        if (/\d/.test(c) && /^[\d,.\s~\-]+$/.test(c)) cell.className = 'nrya-byl-num';
        cell.textContent = c;                    // 원문 글자는 전부 textContent 로만(HTML 주입 없음)
        tr.appendChild(cell);
      });
      tbl.appendChild(tr);
    });
    host.appendChild(tbl);
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
   * 별표의 law.go.kr 원본 파일 링크를 붙인다. **kind 와 무관하게** 붙는다 —
   * 표 원문을 갖고 있어도 원본 파일은 따로 받아볼 수 있어야 한다("보기와 다운로드는 양자택일이 아니다").
   * 형식이 하나뿐이면 고르는 선택창 없이 평범한 단일 링크로, 둘이면 동등한 크기 버튼 두 개로 낸다
   * (어느 쪽도 기본값으로 정하지 않는다). 새 탭에서 사용자의 브라우저가 직접 받는다 — 서버가 대신
   * 받아오면 law.go.kr에 차단된다(_LESSONS.md L-56).
   * @param {HTMLElement} host - 별표 팝업 본문
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
      row.appendChild(a);
    });
    host.appendChild(row);
    return have.length;
  }

  /**
   * 별표·서식 하나를 팝업으로 보여준다. 서버 판정(kind)에 따라 본문이 셋 중 하나로 갈리고,
   * **원본 파일 링크(hwp/pdf)는 kind 와 상관없이** 그 아래 항상 붙는다.
   *  - text  : 우리가 가진 원문 표 — 괘선 표는 표로 다시 그리고, 산문은 접어서(pre-wrap) 보여준다
   *            (파싱이 어긋나면 원본 고정폭 <pre> 폴백)
   *  - image : 우리가 같이 수집해 둔 스캔본을 앱 안에서 바로
   *  - link  : law.go.kr 원본 파일만 있는 경우 — 안내 문구 + 아래 다운로드 링크
   *  - missing : 아무것도 없다 — 지어내지 않고 "아직 수집하지 못했습니다"만 남긴다
   * @param {object} ref - 서버 refs 항목 {key,text,kind,title,body,image,pdf,hwp}
   * [연계] ← ensureArtPop 의 클릭 위임 · renderAnnexOnly. → PopupStack('nrya-bylpop').
   */
  function openBylPop(ref) {
    if (!ref) return;
    var pop = document.getElementById('nryaBylPop'), veil = document.getElementById('nryaBylVeil');
    var body = document.getElementById('nryaBylBody'); if (!pop || !veil || !body) return;
    document.getElementById('nryaBylTitle').textContent =
      (ref.text || '') + (ref.title ? ' · ' + ref.title : '');
    body.innerHTML = '';
    if (ref.kind === 'text' && ref.body) {
      renderBylText(body, ref.body);
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
    appendBylDownloads(body, ref);
    body.scrollTop = 0;
    veil.classList.add('nrya-open'); pop.classList.add('nrya-open');
    if (window.PopupStack) window.PopupStack.push('nrya-bylpop', closeBylPop);
  }

  /** 별표 팝업을 닫는다(조문 팝업은 그대로 둔다). PopupStack.remove 는 멱등. */
  function closeBylPop() {
    if (window.PopupStack) window.PopupStack.remove('nrya-bylpop');
    var pop = document.getElementById('nryaBylPop'), veil = document.getElementById('nryaBylVeil');
    if (pop) pop.classList.remove('nrya-open');
    if (veil) veil.classList.remove('nrya-open');
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
        var ul = document.createElement('ul'); ul.className = 'nrya-artpop-items';
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
    if (refs.length === 1) openBylPop(openable[0]);
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
    chip.className = 'nrya-artpop-chip'; chip.textContent = '원문 · 자동 발췌';
    document.getElementById('nryaArtLaw').textContent = law;
    document.getElementById('nryaArtTitle').textContent = article || '조문 원문';
    document.getElementById('nryaArtEff').textContent = '';
    document.getElementById('nryaArtGist').textContent = '';
    document.getElementById('nryaArtFoot').innerHTML = '';
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
    row.innerHTML = '<div class="nrya-kava"><div class="nrya-ava"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div>' +
      '<div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow">' +
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
   * 채팅 입력을 서버 /api/legal/ask 로 보내고, 생각중 애니메이션 후 답변을 스트리밍으로
   * (조각조각 타이핑되듯) 렌더한다. 근거 법령 아코디언·좌표 미니지도는 스트림이 끝난
   * done 시점에 최종 렌더로 붙는다. 실패 시 안전한 폴백 말풍선을 띄운다(빈 화면 없음).
   * ⚠ 스트리밍은 체감 대기시간만 줄인다 — 실제 생성시간은 그대로다.
   * [연계] → POST /api/legal/ask, readNdjsonStream.
   * @param {object} [sendCtx] - 확인 버튼이 들고 있던 ctx(H-37 §3.2). 없으면 pendingCtx → 없으면 미전송.
   * @param {HTMLElement} [failBox] - 그 버튼이 속한 되묻기 묶음(전송 실패 시 다시 누를 수 있게 되돌린다)
   */
  function doSend(sendCtx, failBox) {
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
    setChatPlaceholder(false);

    // 내 말풍선
    var me = document.createElement('div'); me.className = 'nrya-krow nrya-me';
    me.innerHTML = '<div class="nrya-kbrow"><div class="nrya-kbub"></div></div>';
    me.querySelector('.nrya-kbub').textContent = q;
    body.appendChild(me); input.value = ''; body.scrollTop = body.scrollHeight;

    // 생각중(스켈레톤 + 상태 텍스트)
    var th = document.createElement('div'); th.className = 'nrya-krow nrya-ai';
    th.innerHTML = '<div class="nrya-kava"><div class="nrya-ava nrya-think"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">' +
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
      a.innerHTML = '<div class="nrya-kava"><div class="nrya-ava"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">해양법령 도우미</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai"></div></div></div>';
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
    if (Object.keys(profile.fields).length) ask.profile = profile;
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
        // 답변이 도착했는데 채팅창을 닫아둔 상태면 FAB 뱃지로 알린다(열려 있으면 이미 보는 중).
        if (!isChatOpen()) setUnread(getUnread() + 1);
      });
  }

  /**
   * 답변 본문(AI 합성 텍스트)을 안전하게 HTML로 변환한다. **굵게**만 허용하고 나머지는 이스케이프.
   * @param {string} text - Gemini가 만든 답변 원문
   * @returns {string} 이스케이프된 HTML(굵게·줄바꿈만 적용)
   */
  function answerBodyHTML(text) {
    return esc(text).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
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

  /** tier 코드를 화면 라벨로. 처벌 조문은 '벌칙'으로 표시한다. */
  function tierLabel(row, penalty) {
    if (penalty) return '벌칙';
    return { decree: '시행령', rule: '시행규칙', notice: '고시' }[row.tier] || '법률';
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
      var who = row.contact.소관부처명
        ? esc(row.contact.소관부처명) + (row.contact.부서명 ? '(' + esc(row.contact.부서명) + ')' : '')
        : esc(row.contact.부서명 || '');
      var dial = String(row.contact.전화번호).split(',')[0].replace(/[^0-9+]/g, '');
      tel = '<div class="nrya-chain-tel">☎ ' + who + ' · <a href="tel:' + esc(dial) + '">' + esc(String(row.contact.전화번호).split(',')[0].trim()) + '</a></div>';
    } else {
      tel = '<div class="nrya-chain-tel nrya-unknown">☎ 확인되지 않음</div>';
    }
    // 클릭 영역이 서버에 그대로 넘길 값들(조문 원문 조회 키). data-pen 은 강조색만 벌칙색으로 바꾸는 표시.
    // data-gist 는 범위·전체 인용 팝업에서 "이 인용의 요지" 캡션으로 그대로 다시 쓴다
    // (조 하나를 못 짚어 강조를 할 수 없는 대신 방향을 잡아주는 문구 — 가공 없이 원문 그대로).
    var hitAttrs = ' data-law="' + esc(row.law || '') + '" data-article="' + esc(row.article || '') +
      '" data-tier="' + esc(row.tier || 'law') + '" data-base="' + esc(row.baseLaw || '') +
      '" data-gist="' + esc(row.gist || '') + '"' +
      (penalty ? ' data-pen="1"' : '');
    return '<div class="nrya-chain-step' + (last ? ' nrya-last' : '') + (penalty ? ' nrya-penalty' : '') + '" data-tier="' + esc(row.tier || 'law') + '">' +
      '<div class="nrya-chain-rail"><div class="nrya-chain-dot">' + n + '</div><div class="nrya-chain-line"></div></div>' +
      '<div class="nrya-chain-content">' +
        '<div class="nrya-chain-hit"' + hitAttrs + '>' +
          '<div class="nrya-chain-head"><span class="nrya-chain-tier">' + head + '</span>' +
            '<span class="nrya-chain-art">' + esc(row.law || '') + (row.article ? ' ' + esc(row.article) : '') + '</span>' + eff + '</div>' +
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
    var btns = clarify.options.map(function (o) {
      if (!o || !o.label) return '';
      // [H-37 §3.2] 서버가 선택지에 `ctx`를 실어 보내면(이해확인·상황질문·프로필확인) 그 버튼은
      //   **질의에 라벨을 붙이지 않고** 이 ctx 만 되돌려 보낸다 — 질의 문자열을 오염시키지 않는
      //   것이 이 설계의 핵심이다(설계 §3.1 D안). `act="ask"`면 보내지 않고 입력창으로 안내한다.
      return '<button type="button" class="nrya-consent-btn nrya-clarify-btn" data-label="' + esc(o.label) + '"' +
        (o.ctx ? ' data-ctx="' + esc(JSON.stringify(o.ctx)) + '"' : '') +
        (o.act ? ' data-act="' + esc(o.act) + '"' : '') +
        (o.hint ? ' title="' + esc(o.hint) + '"' : '') + '>' + esc(o.label) + '</button>';
    }).join('');
    return '<div class="nrya-clarify" data-q="' + esc(q || '') + '">' +
      '<div class="nrya-clarify-q">' + esc(clarify.question) + '</div>' +
      '<div class="nrya-consent-btns nrya-clarify-btns">' + btns + '</div></div>';
  }

  /**
   * 되묻기 선택지 버튼을 눌렀을 때: 원래 질문 + 고른 선택지를 한 문장으로 합쳐 새 질의로 보낸다.
   * 예: "낚싯배 위에서 술 마시면 처벌?" + "조타 담당" → "낚싯배 위에서 술 마시면 처벌? — 조타 담당"
   * 전송은 입력창에 넣고 기존 doSend()를 그대로 부른다(새 전송 경로를 만들지 않는다) — 합친
   * 문장이 내 말풍선으로 그대로 보이므로 사용자가 무엇을 골랐는지도 화면에 남는다.
   * 한 번 고르면 그 선택지 묶음은 비활성(nrya-done)이라 다시 눌러 중복 전송되지 않는다.
   * @param {HTMLElement} btn - 눌린 .nrya-clarify-btn
   * [연계] ← bindChat 의 위임 클릭. → doSend(기존 질문 전송 로직 재사용).
   */
  function pickClarifyOption(btn) {
    var box = btn.closest('.nrya-clarify');
    if (!box || box.classList.contains('nrya-done')) return;
    box.classList.add('nrya-done');
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
      doSend(mergeCtx(lastCtx, ctx), box);
      return;
    }
    // [2026-08-14 F2] ctx 없는 선택지(기존 되묻기·트리 되묻기)라도 **직전까지 확정된 맥락은 이어
    //   보낸다.** 예전엔 여기서 doSend(null, …)이라 프로필로 확정한 축이 통째로 사라져 서버가 같은
    //   축을 다시 묻는 무한루프가 됐다(적대검증 재현: 프로필확인 "네" → 트리 답변의 ctx 없는 버튼).
    input.value = q ? q + ' — ' + label : label;
    doSend(lastCtx, box);
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
    var lead = data.answer
      ? answerBodyHTML(data.answer)
      : (data.clarify
        ? '조건에 따라 답이 달라져서, 하나만 여쭤볼게요.'   // 되묻기인데 서버 안내문이 비었을 때의 최소 문구
        : (sources.length
          ? '질문과 관련된 <b>근거 법령·개념</b>을 찾았지만, 지금은 답변 문장을 만들지 못했어요. 아래에서 조문 근거를 직접 확인하세요.'
          : '아직 이 질문에 딱 맞는 근거를 위키에서 찾지 못했어요. 질문을 조금 더 구체적으로(법 이름·톤수·행위) 적어주시면 도움이 됩니다.'));

    // 되묻기 선택지는 본문 바로 아래(근거 법령 아코디언보다 위)에 둔다 — 지금 사용자가 해야 할 일이다.
    var html = lead + clarifyHTML(q, data.clarify);
    // 근거 조문 체인은 서버가 **모든 소스의 줄을 합쳐 하나로** 보내준다(data.citationChain) —
    // 그대로 그린다.
    // ⚠예전엔 화면이 sources[i].citationChain 중 줄 수가 가장 많은 소스 하나를 골라 그 소스만
    //   그렸다. 그래서 답변이 두 법을 함께 인용한 질문에서 **한쪽 법의 근거가 통째로 안 보였다**
    //   (라이브 재현: 답변은 「낚시 관리 및 육성법」 제30·53조를 먼저 말하는데 근거 목록 5줄이
    //   전부 해상교통안전법·선박직원법). 어느 줄을 보여줄지는 "답변이 실제로 인용했는가"로
    //   서버가 이미 걸렀으므로, 화면이 여기서 또 골라낼 이유가 없다.
    // ⚠나머지 소스를 "법령명 · 주제"만 적은 카드로 나열하던 부분은 뺐다 — 조문도 요지도 없어
    //   ("음주운항_측정거부" 같은 이름 한 줄) 답변 본문과 위 체인이 이미 말한 것 이상을 주지 못하는데,
    //   근거 건수만 부풀려 보이게 했다(라이브 실측 지적).
    var chain = data.citationChain || [];
    // 건수는 체인에 실제로 남은 **법령 가짓수**(같은 법의 여러 조문은 한 건)로 센다.
    var lawNames = [];
    chain.forEach(function (row) {
      var nm = row.law || '';
      if (nm && lawNames.indexOf(nm) < 0) lawNames.push(nm);
    });
    var shown = lawNames.length;
    if (shown) {
      html += '<div class="nrya-lawacc"><div class="nrya-lawacc-h"><span class="nrya-arw">▶</span>📖 근거 법령 ' + shown + '건 (펼쳐서 보기)</div><div class="nrya-lawacc-b">';
      html += chainHTML(chain);
      html += '</div></div>';
    }
    // ⚠공백 안내는 아코디언 **밖**에 둔다 — 접혀 있는 목록 안에 넣으면 정작 꼭 봐야 할
    // "관할 지자체에 확인하세요"가 펼치기 전엔 안 보인다(그게 이번에 고친 문제 자체다).
    html += gapNoticesHTML(sources);

    html += '<div class="nrya-disc">참고용입니다. 최종 확인은 공식 출처를 확인하세요.' + (data.note ? ' · ' + esc(data.note) : '') + '</div>';
    // 되묻기 응답엔 아직 "최종 답변"이 없어 만족도를 물을 대상이 없다 — 진짜 답변에만 붙인다.
    if (!data.clarify && data.answer) html += feedbackHTML(q, data.answer);
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
    me.innerHTML = '<div class="nrya-kbrow"><div class="nrya-kbub"></div></div>';
    me.querySelector('.nrya-kbub').textContent = data.query || '';
    body.appendChild(me);
    appendAiRow(answerHTML(data.query || '', data));
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
