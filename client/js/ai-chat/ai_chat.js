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
 *             근거법령 아코디언·좌표 미니지도 핀치줌). #nrya-overlays(body) 에 산다.
 *         FAB 는 (1) 앱 메인 특보 탭일 때만, (2) 서버 노출설정이 허용할 때만 보인다.
 *         (초보자용: 이 파일이 관리자용 나리야 콘솔과 사용자용 챗봇 버튼/창을 만든다)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : css/ai_chat.css (스타일), js/admin/admin.js
 *                    (통합관리자 'nariya' 탭이 renderAdminInto 호출 · 관리자 토큰
 *                    저장소 'seagnal_admin_token' 재사용)
 *  - 서버 API      : routes/legal.js
 *                    GET  /api/legal/config                   (노출설정 조회, 기본 off)
 *                    POST /api/legal/config {exposure}         (노출설정 저장, 관리자)
 *                    GET  /api/legal/reviews?status=pending    (검증 대기 목록)
 *                    GET  /api/legal/reviews/stats             (대기/승인 카운트)
 *                    POST /api/legal/reviews/:id/approve        (승인/반려 + 교정값)
 *                    POST /api/legal/ask {query}               (질문→근거 법령 검색)
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

  var serverExposure = 'off';                  // 서버 전역 노출설정(진실의 원천). 기본 off
  var configLoaded = false;                    // /config 최초 로드 완료 여부
  var statsCache = null;                       // {total,pending,approved} — 배지용

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

  /** 관리자 토큰을 로컬/세션에서 읽는다(admin.js 저장 규약과 동일). @returns {string|null} */
  function getAdminToken() {
    try { return localStorage.getItem(LS_ADMIN_TOKEN) || sessionStorage.getItem(LS_ADMIN_TOKEN) || null; } catch (_) { return null; }
  }

  /**
   * /api/legal/* 호출 래퍼. admin-token-gated 경로(reviews·config)에는 X-Admin-Token
   * 을 직접 붙인다(앱 전역 fetch 래퍼는 /api/admin/* 만 처리하고 /api/legal/* 은 안 붙임).
   * 예: legalFetch('/api/legal/reviews?status=pending') → Promise<Response>
   * @param {string} url - 요청 경로
   * @param {object} [opts] - fetch 옵션
   * @returns {Promise<Response>}
   */
  function legalFetch(url, opts) {
    opts = opts || {};
    if (url.indexOf('/api/legal/reviews') !== -1 || url.indexOf('/api/legal/config') !== -1) {
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
  // 관리자 검토 데이터 모델 (⚠수치검증만 서버 연동, 나머지는 골격)
  // ============================================================================
  function draftCards() {
    return '<div class="nrya-dual-note">순수 정의·절차 초안은 <b>AI 자동 승격</b> 가능(감사 통과 시). 처벌·안전값 포함 초안만 여기서 <b>사람 승인</b>.</div>' +
      ['연안체험활동 신고 절차|연안사고예방법|정의·절차(자동승격 후보)',
       '양식업 위반 처벌 구간|양식산업발전법|처벌 포함 → 사람승인']
      .map(function (x) { var p = x.split('|'); return '<div class="nrya-rv"><div class="nrya-rv-head"><span class="nrya-rv-id">draft</span><div class="nrya-rv-t">' + esc(p[0]) + '<small>' + esc(p[1]) + ' · ' + esc(p[2]) + '</small></div><span class="nrya-rv-st nrya-wait">검토 대기</span></div><div class="nrya-rv-body"></div></div>'; }).join('');
  }
  function skelRoom(emoji, title, flow) {
    return '<div class="nrya-skel-box"><div class="nrya-skel-emoji">' + emoji + '</div><div class="nrya-skel-t">' + esc(title) + '</div><div style="font-size:12px;color:var(--nrya-text-sub);line-height:1.6">아직 등록된 항목이 없습니다(골격). 실배선 시 아래 흐름으로 채워집니다.</div>' +
      '<div class="nrya-skel-flow">' + flow.map(function (s, i) { return (i ? '<span class="nrya-arw">→</span>' : '') + '<span class="nrya-s">' + esc(s) + '</span>'; }).join('') + '</div></div>';
  }
  var ADMIN = {
    초안승인: { n: '842', desc: '사서(AI)가 만든 <b>미승인 초안(draft)</b> 대기실. 순수 정의·절차는 감사 통과 시 자동 승격, 처벌·안전값 포함분은 여기서 사람이 승인해야 canonical이 됩니다.', render: draftCards },
    피드백: { n: '0', desc: '답변 <b>👍/👎 익명 로그</b>를 모아 원인 분류(triage) 후 관리자에게 올리는 방. 👎가 쌓인 주제 → 위키 보강으로 연결.', render: function () { return skelRoom('👍', '피드백 처리 (_feedback)', ['챗봇 👎', '익명 로그', 'AI 원인분류', '관리자 검토', '위키 보강']); } },
    새지식후보: { n: '0', desc: '대화 중 <b>새로 알게 된 지식 후보</b>. 공식 출처와 대조 후 관리자가 승인하면 위키에 편입됩니다(환각 방지 게이트).', render: function () { return skelRoom('💡', '새 지식 후보 (_candidates)', ['미존재 질문 감지', '검색·생성', '공식출처 대조', '관리자 승인', '위키 편입']); } },
    개정검토: { n: '0', desc: '법률 <b>개정·조문 변경이 감지</b>됐을 때 사람 검토 전까지 모아두는 방. 시행일·MST diff로 신설·삭제·금액·조번재편을 적재.', render: function () { return skelRoom('📌', '개정 검토 (_amendments)', ['개정 감지(시행일 diff)', '변경 적재', '관리자 검토', '재수집·재빌드', '옛 조문 _legacy 이동']); } },
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

  /** 서브탭(관리자 검토 5개 방)을 그린다. @param {string} active */
  function renderSubtabs(active) {
    var el = document.getElementById('nryaSubtabs'); if (!el) return; el.innerHTML = '';
    ADMIN_ORDER.forEach(function (k) {
      var a = ADMIN[k];
      var cnt = (k === '⚠수치검증' && statsCache) ? String(statsCache.pending) : a.n;
      var b = document.createElement('div'); b.className = 'nrya-subtab' + (k === active ? ' nrya-active' : '');
      b.innerHTML = esc(k) + '<span class="nrya-qn">' + esc(cnt) + '</span>';
      b.addEventListener('click', function () { renderSubtabs(k); renderAdmin(k); });
      el.appendChild(b);
    });
  }

  /** 선택한 관리자 방을 그린다(⚠수치검증만 서버 연동). @param {string} k */
  function renderAdmin(k) {
    var a = ADMIN[k]; var host = document.getElementById('nryaAdminContent'); if (!host) return;
    var intro = '<div class="nrya-intro"><div class="nrya-intro-h"><div class="nrya-intro-ic">🛠</div><div><div class="nrya-intro-name">' + esc(k) + '</div><div class="nrya-intro-tag">관리자 검토 방 · 승인→자동반영</div></div></div><div class="nrya-intro-desc">' + a.desc + '</div></div>';
    if (k === '⚠수치검증') {
      host.innerHTML = intro + '<div class="nrya-panel" id="nryaReviewHost" style="padding:6px 0 4px"></div>';
      renderReviewCards(document.getElementById('nryaReviewHost'));
    } else {
      host.innerHTML = intro + a.render();
      bindReviewStatic();
    }
  }

  // ── 지식 방 아코디언 바인딩 ──
  function bindAcc() {
    var host = document.getElementById('nryaRoomContent'); if (!host) return;
    host.querySelectorAll('.nrya-acc-head').forEach(function (h) {
      h.onclick = function () { h.parentElement.classList.toggle('nrya-open'); };
    });
  }
  // ── 정적 관리자 방(초안승인 등)의 rv 헤더 토글만 ──
  function bindReviewStatic() {
    var host = document.getElementById('nryaAdminContent'); if (!host) return;
    host.querySelectorAll('.nrya-rv-head').forEach(function (h) {
      h.onclick = function () { h.parentElement.classList.toggle('nrya-open'); };
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
        host.innerHTML = DUAL_NOTE + '<div class="nrya-notice-box"><span class="nrya-em">🔒</span>관리자 로그인 필요<br><span style="font-size:11.5px;color:var(--nrya-text-sub)">통합관리자 센터에서 로그인 후 다시 열어주세요.</span></div>';
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

  // 리뷰 카드에서 우선 노출할 구조화 필드(라벨·아이콘). 존재하는 것만 순서대로 렌더.
  var FIELD_VIEW = [
    { keys: ['AI 연결 내용', 'AI 연결·판단 내용', 'AI 판단', 'AI 유추', 'AI 연결', '정의 사슬 추적'], icon: '🧠', label: 'AI 분석 내용' },
    { keys: ['문제'], icon: '❗', label: '문제' },
    { keys: ['확인 필요', '확인'], icon: '🔍', label: '확인 필요' },
    { keys: ['근거'], icon: '📎', label: '근거' },
    { keys: ['필요 조치', '필요조치'], icon: '🛠', label: '필요 조치' },
    { keys: ['still_missing', '미확보', '미수집'], icon: '🚧', label: '미수집/미확보' }
  ];

  /** URL 이 원본 이미지(별표 스캔·flDownload)인지 판정. @param {string} u @returns {boolean} */
  function isImageUrl(u) { return /flDownload|\.(png|jpe?g|gif|webp|bmp|tiff?)(\?|#|$)/i.test(u); }

  /**
   * 서버가 파싱해 준 fields(구조화 항목) + urls(검증 링크)로 스캔 가능한 카드 본문을 만든다.
   * fields 가 비면 긴 body 를 잘라서 폴백 표시한다.
   * @param {object} rv - {fields, urls, body}
   * @returns {string} 본문 HTML
   */
  function reviewFieldsHTML(rv) {
    var fields = rv.fields || {};
    var used = {};
    var rows = '';
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
    var body =
      '<div class="nrya-rv-body">' +
        reviewFieldsHTML(rv) +
        (pages ? '<div class="nrya-src-line">📍 대상 페이지: ' + pages + '</div>' : '') +
        '<div class="nrya-correct">' +
          '<div class="nrya-correct-q">🔍 <b>검토</b>: 위 AI 분석 내용과 원본 링크를 확인하고, 확정할 값이 있으면 아래 칸에 직접 입력하세요. 값이 없는 검토는 빈 칸으로 승인하면 됩니다.</div>' +
          '<div class="nrya-correct-row"><label>확정 값</label><input class="nrya-correct-in" value="" placeholder="예: 540 (mm) · 필요 시 입력"></div>' +
          '<div class="nrya-correct-hint">그대로 맞으면 값 유지/빈칸 후 승인 · 틀리면 올바른 값 입력 후 승인</div>' +
        '</div>' +
        '<div class="nrya-rv-actions"><button class="nrya-btn-ok">✓ 승인 (입력값으로 확정)</button><button class="nrya-btn-no">✗ 반려 (재검토)</button></div>' +
        '<div class="nrya-inline-err nrya-hidden" style="display:none"></div>' +
        '<div class="nrya-chain"></div>' +
      '</div>';
    return '<div class="nrya-rv' + (open ? ' nrya-open' : '') + (approved ? ' nrya-approved' : '') + '" data-id="' + esc(rv.id) + '">' +
      '<div class="nrya-rv-head"><span class="nrya-rv-id">' + esc(rv.id) + '</span><div class="nrya-rv-t">' + esc(rv.title || rv.id) + '<small><b>' + esc(rv.law || '') + '</b>' + (pages ? ' · ' + (rv.targetPages || []).length + '개 페이지' : '') + '</small></div>' + st + '</div>' + body + '</div>';
  }

  /**
   * 리뷰 카드 1장에 헤더 토글 + 승인/반려 동작을 바인딩한다.
   * 승인: POST approve(decision:'approve') → promotedCount>0 이면 초록 성공, 0 이면
   *       경고(승격 0건)로 표시. 반려: decision:'reject'. 실패는 인라인 오류.
   * @param {HTMLElement} card
   * [연계] → POST /api/legal/reviews/:id/approve.
   */
  function bindReviewCard(card) {
    var id = card.getAttribute('data-id');
    var head = card.querySelector('.nrya-rv-head');
    if (head) head.onclick = function () { card.classList.toggle('nrya-open'); };

    var okBtn = card.querySelector('.nrya-btn-ok');
    var noBtn = card.querySelector('.nrya-btn-no');
    var errBox = card.querySelector('.nrya-inline-err');

    function showErr(msg) { if (!errBox) return; errBox.style.display = 'block'; errBox.classList.remove('nrya-hidden'); errBox.textContent = msg; }
    function clearErr() { if (!errBox) return; errBox.style.display = 'none'; errBox.textContent = ''; }
    function setBusy(b) { if (okBtn) okBtn.disabled = b; if (noBtn) noBtn.disabled = b; }
    function resetOk() { if (okBtn) okBtn.textContent = '✓ 승인 (입력값으로 확정)'; }

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
          if (data._denied) { showErr('관리자 로그인 필요 — 통합관리자 센터에서 로그인 후 다시 시도하세요.'); setBusy(false); resetOk(); return; }
          if (!data || !data.ok) { showErr((data && data.error) || '처리에 실패했습니다.'); setBusy(false); resetOk(); return; }
          if (decision === 'reject') { markRejected(card, data); }
          else { markApproved(card, val, data); }
          refreshStats(); // 대기 카운트 배지 갱신
        })
        .catch(function (e) { showErr('네트워크 오류: ' + String(e && e.message || e)); setBusy(false); resetOk(); });
    }

    if (okBtn) okBtn.onclick = function () { submit('approve'); };
    if (noBtn) noBtn.onclick = function () { submit('reject'); };
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

  // ============================================================================
  // 사용자 챗봇: FAB + 채팅 팝업 + 좌표 지도 팝업 (#nrya-overlays)
  // ============================================================================
  var STEPS = ['생각하고 있습니다', '관련 법령을 찾고 있습니다', '조문 구조를 확인하고 있습니다', '답변을 정리하고 있습니다'];

  // 재사용 지도 SVG(해안선 + 위경도 격자 + 좌표 폴리곤 + 라벨) — 목업 원본 그대로
  var MAPSVG = '<svg viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
    '<rect width="320" height="180" fill="#0c2033"/>' +
    '<path d="M0,0 L58,0 Q92,38 66,72 Q48,96 80,128 Q98,158 72,180 L0,180 Z" fill="#173245" stroke="rgba(120,190,150,.45)" stroke-width="1.2"/>' +
    '<g stroke="rgba(160,190,220,.10)" stroke-width="1"><line x1="90" y1="0" x2="90" y2="180"/><line x1="160" y1="0" x2="160" y2="180"/><line x1="230" y1="0" x2="230" y2="180"/><line x1="0" y1="60" x2="320" y2="60"/><line x1="0" y1="120" x2="320" y2="120"/></g>' +
    '<text x="162" y="12" fill="#6f8aa3" font-size="8" font-family="monospace">128°30′E</text>' +
    '<text x="232" y="12" fill="#6f8aa3" font-size="8" font-family="monospace">129°00′E</text>' +
    '<text x="3" y="58" fill="#6f8aa3" font-size="8" font-family="monospace">38°34′N</text>' +
    '<text x="3" y="118" fill="#6f8aa3" font-size="8" font-family="monospace">38°10′N</text>' +
    '<polygon points="150,44 236,58 250,112 172,134 126,86" fill="rgba(105,240,174,.22)" stroke="#69f0ae" stroke-width="2"/>' +
    '<text x="182" y="94" fill="#8fe6bb" font-size="11" font-weight="bold" font-family="sans-serif">조업 가능</text>' +
    '<g fill="#ff6b6b" stroke="#fff" stroke-width="1"><circle cx="150" cy="44" r="3.6"/><circle cx="236" cy="58" r="3.6"/><circle cx="250" cy="112" r="3.6"/><circle cx="172" cy="134" r="3.6"/><circle cx="126" cy="86" r="3.6"/></g>' +
    '<text x="150" y="37" fill="#e6f1ff" font-size="7.5" font-family="monospace" text-anchor="middle">38°34′09″N 128°30′06″E</text>' +
    '<text x="16" y="150" fill="#9fceb0" font-size="9.5" font-family="sans-serif">강원 연안</text>' +
    '</svg>';

  var overlaysBuilt = false;
  var mScale = 1, mX = 0, mY = 0; // 지도 팝업 줌 상태

  /**
   * body 에 #nrya-overlays(FAB + 채팅 팝업 + 지도 팝업)를 1회 주입하고 이벤트를 건다.
   * FAB 표시는 updateFabVisibility 가 탭/서버설정으로 게이트한다(초기값 숨김).
   * [연계] → updateFabVisibility, bindChat, bindMap.
   */
  function ensureOverlays() {
    if (overlaysBuilt) return;
    overlaysBuilt = true;

    var wrap = document.createElement('div');
    wrap.id = 'nrya-overlays';
    wrap.innerHTML =
      '<button class="nrya-fab" id="nryaFab" title="나리야에게 물어보기" style="display:none"><span class="nrya-fab-inner"><img src="' + NARIYA_IMG + '" alt="나리야"><span class="nrya-fab-label">AI 챗봇</span></span><span class="nrya-fab-badge">N</span></button>' +
      // 채팅 팝업
      '<div class="nrya-chat-wrap" id="nryaChatWrap">' +
        '<div class="nrya-chat">' +
          '<div class="nrya-chat-top">' +
            '<div class="nrya-ava" id="nryaChatOrb"><img src="' + NARIYA_IMG + '" alt="나리야"></div>' +
            '<div><div class="nrya-chat-name">나리야</div><div class="nrya-chat-on">해양법령 도우미 · 온라인</div></div>' +
            '<button class="nrya-chat-x" id="nryaChatX">×</button>' +
          '</div>' +
          '<div class="nrya-chat-body" id="nryaChatBody">' +
            '<div class="nrya-krow nrya-ai"><div class="nrya-kava"><div class="nrya-ava"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">나리야</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">안녕하세요! 해양법령에 대해 편하게 물어보세요. 예: "5톤 낚시어선인데 야간에 조업해도 되나요?"</div><span class="nrya-ktime">' + nowLabel() + '</span></div></div></div>' +
          '</div>' +
          '<div class="nrya-chat-input"><button class="nrya-chat-plus" title="첨부">＋</button><input id="nryaChatInput" placeholder="메시지 입력" /><button class="nrya-chat-send" id="nryaChatSend">➤</button></div>' +
        '</div>' +
      '</div>' +
      // 좌표 지도 확대 팝업(핀치줌)
      '<div class="nrya-mapmodal" id="nryaMapModal">' +
        '<div class="nrya-mapmodal-bar">' +
          '<div class="nrya-mapmodal-tabs">' +
            '<button class="nrya-mm-tab nrya-on" data-mm="here">📍 현재 화면에서 보기</button>' +
            '<button class="nrya-mm-tab" data-mm="ocean">🗺 해양종합정보 탭에서 보기</button>' +
          '</div>' +
          '<button class="nrya-mapmodal-x" id="nryaMapX">✕</button>' +
        '</div>' +
        '<div class="nrya-mapmodal-stage" id="nryaMapStage">' +
          '<div class="nrya-mapmodal-inner" id="nryaMapInner"></div>' +
          '<div class="nrya-mapmodal-zoom"><button data-z="in">＋</button><button data-z="out">－</button></div>' +
          '<div class="nrya-mapmodal-hint">두 손가락으로 확대·축소 · 드래그로 이동</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    bindChat();
    bindMap();
    updateFabVisibility();
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
    var margin = 12;
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
   * 하드웨어 백 스택 등록(PopupStack) + 입력창 포커스.
   * [연계] → PopupStack.push('nrya-chat', closeChat).
   */
  function openChat() {
    ensureOverlays();
    var wrap = document.getElementById('nryaChatWrap'); if (!wrap) return;
    wrap.classList.add('nrya-open');
    fitChat(); addVV(); _scrollChatBottom();
    var input = document.getElementById('nryaChatInput'); if (input) setTimeout(function () { input.focus(); }, 80);
    if (window.PopupStack) window.PopupStack.push('nrya-chat', closeChat);
  }

  /** 채팅 팝업을 닫는다(백스택에서 제거 + 리스너 해제). PopupStack.remove 는 멱등. */
  function closeChat() {
    if (window.PopupStack) window.PopupStack.remove('nrya-chat');
    var wrap = document.getElementById('nryaChatWrap'); if (wrap) wrap.classList.remove('nrya-open');
    removeVV();
  }

  function bindChat() {
    var body = document.getElementById('nryaChatBody');
    var input = document.getElementById('nryaChatInput');
    var fab = document.getElementById('nryaFab');

    if (fab) fab.addEventListener('click', openChat);
    var x = document.getElementById('nryaChatX'); if (x) x.addEventListener('click', closeChat);
    var send = document.getElementById('nryaChatSend'); if (send) send.addEventListener('click', doSend);
    if (input) {
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') doSend(); });
      // 포커스(키보드 등장) 시: 뷰포트 재계산 + 초기 메시지가 가리지 않게 맨 아래로
      input.addEventListener('focus', function () { fitChat(); setTimeout(function () { fitChat(); _scrollChatBottom(); }, 250); });
    }

    // 답변 내 근거법령 아코디언 토글 + 지도 구역 탭 → 확대 팝업(동적 답변 포함, 위임)
    if (body) body.addEventListener('click', function (e) {
      var h = e.target.closest('.nrya-lawacc-h'); if (h) { h.parentElement.classList.toggle('nrya-open'); return; }
      var mo = e.target.closest('[data-mapopen]'); if (mo) { openMap(); }
    });
  }

  /**
   * 채팅 입력을 서버 /api/legal/ask 로 보내고, 생각중 애니메이션 후 근거 법령을
   * 아코디언으로 렌더한다. 좌표성 질문이면 좌표 미니지도도 함께 붙인다.
   * 실패 시 안전한 폴백 말풍선을 띄운다(빈 화면 없음).
   * [연계] → POST /api/legal/ask.
   */
  function doSend() {
    var body = document.getElementById('nryaChatBody');
    var input = document.getElementById('nryaChatInput');
    if (!body || !input) return;
    var q = (input.value || '').trim();
    if (!q) q = '특정해역에서 야간 조업 제한이 있어?';

    // 내 말풍선
    var me = document.createElement('div'); me.className = 'nrya-krow nrya-me';
    me.innerHTML = '<div class="nrya-kbrow"><div class="nrya-kbub"></div><span class="nrya-ktime">지금</span></div>';
    me.querySelector('.nrya-kbub').textContent = q;
    body.appendChild(me); input.value = ''; body.scrollTop = body.scrollHeight;

    // 생각중(스켈레톤 + 상태 텍스트)
    var th = document.createElement('div'); th.className = 'nrya-krow nrya-ai';
    th.innerHTML = '<div class="nrya-kava"><div class="nrya-ava nrya-think"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">나리야</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">' +
      '<div class="nrya-sk-line" style="width:130px"></div><div class="nrya-sk-line" style="width:90px"></div>' +
      '<div class="nrya-think-status"><span class="nrya-ts">생각하고 있습니다</span><span class="nrya-think-dots"><i></i><i></i><i></i></span></div></div></div></div>';
    body.appendChild(th); body.scrollTop = body.scrollHeight;
    var orb = document.getElementById('nryaChatOrb'); if (orb) orb.classList.add('nrya-think');
    var i = 0, tsEl = th.querySelector('.nrya-ts');
    var iv = setInterval(function () { i++; if (i < STEPS.length) tsEl.textContent = STEPS[i]; }, 850);

    // 최소 노출 시간(생각중 UX 유지) + 서버 응답을 함께 기다림
    var minDelay = new Promise(function (r) { setTimeout(r, 850 * 2); });
    var ask = legalPost('/api/legal/ask', { query: q })
      .then(function (res) { return res.json().catch(function () { return { ok: false }; }); })
      .catch(function () { return { ok: false, _neterr: true }; });

    Promise.all([ask, minDelay]).then(function (arr) {
      clearInterval(iv); th.remove(); if (orb) orb.classList.remove('nrya-think');
      var data = arr[0];
      var a = document.createElement('div'); a.className = 'nrya-krow nrya-ai';
      a.innerHTML = '<div class="nrya-kava"><div class="nrya-ava"><img src="' + NARIYA_IMG + '" alt="나리야"></div></div><div class="nrya-kcol"><div class="nrya-kwho">나리야</div><div class="nrya-kbrow"><div class="nrya-kbub nrya-ai">' + answerHTML(q, data) + '</div><span class="nrya-ktime">지금</span></div></div></div>';
      body.appendChild(a); body.scrollTop = body.scrollHeight;
    });
  }

  /**
   * /api/legal/ask 응답을 답변 말풍선 내부 HTML로 조립한다.
   * 근거 법령(sources)을 아코디언으로, 좌표성 질문이면 미니지도를 덧붙인다.
   * @param {string} q - 사용자 질문
   * @param {object} data - {ok, sources[], note} 또는 실패 객체
   * @returns {string} 말풍선 내부 HTML
   */
  function answerHTML(q, data) {
    if (!data || !data.ok) {
      return '죄송해요, 지금은 답변 근거를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.' +
        '<div class="nrya-disc">일시적 오류일 수 있습니다. 문제가 계속되면 관리자에게 문의하세요.</div>';
    }
    var sources = data.sources || [];
    var lead = sources.length
      ? '질문과 관련된 <b>근거 법령·개념</b>을 찾았어요. 아래에서 조문 근거를 확인하세요. (현재는 검색 기반 근거 제시 단계이며, 문장형 답변 합성은 후속 단계입니다.)'
      : '아직 이 질문에 딱 맞는 근거를 위키에서 찾지 못했어요. 질문을 조금 더 구체적으로(법 이름·톤수·행위) 적어주시면 도움이 됩니다.';

    var html = lead;
    if (sources.length) {
      html += '<div class="nrya-lawacc"><div class="nrya-lawacc-h"><span class="nrya-arw">▶</span>📖 근거 법령 ' + sources.length + '건 (펼쳐서 보기)</div><div class="nrya-lawacc-b">' +
        sources.map(function (s) {
          var title = (s.law ? esc(s.law) : '') + (s.topic ? ' · ' + esc(s.topic) : '');
          if (!title) title = esc(s.file || '근거');
          var kind = s.kind ? esc(s.kind) : '개념';
          return '<div class="nrya-lawitem"><div class="nrya-lw-t"><span>' + title + '</span><span class="nrya-lw-src">' + kind + (s.score != null ? ' · 관련도 ' + esc(s.score) : '') + '</span></div>' +
            '<div class="nrya-lw-c">출처 파일: ' + esc(s.file || '(미상)') + '</div>' +
            '<div class="nrya-lw-more">원문 보기 ›</div></div>';
        }).join('') + '</div></div>';
    }

    // 좌표성 질문이면 좌표 미니지도(+핀치줌 팝업) 붙임 — 목업 지도/핀치줌 재사용
    if (/해역|좌표|구역|조업|특정해역|경위도|위경도/.test(q)) {
      html += '<div class="nrya-zonemap"><div class="nrya-zonemap-canvas" data-mapopen="1">' + MAPSVG + '<span class="nrya-zonemap-tap">⤢ 탭하면 확대</span></div>' +
        '<div class="nrya-zonemap-cap">📍 <b>GPS 경위도로 정의된 구역</b> 예시 · 실제 지도 위에 폴리곤 표시 · 탭하면 확대(핀치줌)·해양종합정보 연계</div></div>';
    }

    html += '<div class="nrya-disc">참고용입니다. 최종 확인은 공식 출처를 확인하세요.' + (data.note ? ' · ' + esc(data.note) : '') + '</div>';
    return html;
  }

  // ── 지도 팝업(핀치/드래그 줌) 바인딩 ──
  function applyMap() { var inner = document.getElementById('nryaMapInner'); if (inner) inner.style.transform = 'translate(' + mX + 'px,' + mY + 'px) scale(' + mScale + ')'; }
  function resetMap() { mScale = 1; mX = 0; mY = 0; applyMap(); }

  /** 좌표 지도 확대 팝업을 연다(내부에 MAPSVG 주입 + 줌 리셋 + 백스택 등록). */
  function openMap() {
    var inner = document.getElementById('nryaMapInner'), modal = document.getElementById('nryaMapModal');
    if (!inner || !modal) return;
    inner.innerHTML = MAPSVG; resetMap(); modal.classList.add('nrya-open');
    if (window.PopupStack) window.PopupStack.push('nrya-map', closeMap);
  }

  /** 좌표 지도 팝업을 닫는다(백스택에서 제거). PopupStack.remove 는 멱등. */
  function closeMap() {
    if (window.PopupStack) window.PopupStack.remove('nrya-map');
    var modal = document.getElementById('nryaMapModal'); if (modal) modal.classList.remove('nrya-open');
  }

  function bindMap() {
    var modal = document.getElementById('nryaMapModal');
    var stage = document.getElementById('nryaMapStage');
    var x = document.getElementById('nryaMapX');
    if (x) x.addEventListener('click', closeMap);

    document.querySelectorAll('#nrya-overlays .nrya-mm-tab').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.dataset.mm === 'ocean') {
          // 해양종합정보 탭으로 이동(챗봇/지도 팝업 닫고 실제 탭 전환)
          closeMap(); closeChat();
          try { if (typeof window.switchMainTab === 'function') window.switchMainTab('ocean-map-section'); } catch (_) {}
        } else {
          document.querySelectorAll('#nrya-overlays .nrya-mm-tab').forEach(function (t) { t.classList.remove('nrya-on'); });
          b.classList.add('nrya-on');
        }
      });
    });

    document.querySelectorAll('#nrya-overlays .nrya-mapmodal-zoom button').forEach(function (b) {
      b.addEventListener('click', function () { mScale = Math.max(1, Math.min(6, mScale * (b.dataset.z === 'in' ? 1.35 : 1 / 1.35))); applyMap(); });
    });

    if (!stage) return;
    var pts = {}, startDist = 0, startScale = 1, lastX = 0, lastY = 0, dragging = false;
    function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
    stage.addEventListener('pointerdown', function (e) {
      stage.setPointerCapture(e.pointerId); pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length === 2) { startDist = dist(pts[ids[0]], pts[ids[1]]); startScale = mScale; }
      else { dragging = true; lastX = e.clientX; lastY = e.clientY; }
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pts[e.pointerId]) return; pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pts);
      if (ids.length === 2) { var d = dist(pts[ids[0]], pts[ids[1]]); if (startDist > 0) { mScale = Math.max(1, Math.min(6, startScale * d / startDist)); applyMap(); } }
      else if (dragging) { mX += e.clientX - lastX; mY += e.clientY - lastY; lastX = e.clientX; lastY = e.clientY; applyMap(); }
    });
    function endPtr(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) startDist = 0; if (Object.keys(pts).length === 0) dragging = false; }
    stage.addEventListener('pointerup', endPtr); stage.addEventListener('pointercancel', endPtr);
    stage.addEventListener('wheel', function (e) { e.preventDefault(); mScale = Math.max(1, Math.min(6, mScale * (e.deltaY < 0 ? 1.12 : 1 / 1.12))); applyMap(); }, { passive: false });
  }

  // ============================================================================
  // 부트스트랩
  // ============================================================================

  /** 부트스트랩: 오버레이 주입 + 서버 노출설정 로드 + 탭 변화 옵저버 등록. */
  function boot() {
    ensureOverlays();

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
