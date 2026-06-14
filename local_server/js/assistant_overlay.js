/**
 * ============================================================================
 * 파일명: js/assistant_overlay.js
 * 역할: 백그라운드 "나리야" 음성 비서의 상태/대화를 앱 화면에 동적 오버레이로 표시.
 * ============================================================================
 *  네이티브 VoiceAssistantService → SeagnalAssistantPlugin.emitState() →
 *  'assistantState' 이벤트(state, query, answer)를 구독.
 *
 *  표시 정책(사장님 요구, 2026-06-14):
 *   - 대기/종료(wake·idle·stopped·off): 아무것도 표시하지 않음(완전 숨김).
 *   - 듣는중(listening)·생각중(thinking): 하단에 작은 Gemini 그라데이션 오브 + 상태.
 *   - 답변중(speaking): 넓은 패널로 확장 — 답변 내용이 충분히 크게·읽기 쉽게.
 *
 *  - index2 페이지 + Capacitor 플러그인이 있을 때만 동작(없으면 무동작).
 *  - 멈춤/꺼짐 시 잔류 방지를 위한 안전 자동 숨김 + 전역 숨김 훅(window.__nariyaOverlayHide).
 * ============================================================================
 */
(function () {
  if (window.__SEAGNAL_PAGE !== 'index2') return;
  var P = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SeagnalAssistant)
    ? window.Capacitor.Plugins.SeagnalAssistant : null;
  if (!P || !P.addListener) return;

  // ── 스타일 1회 주입 ──────────────────────────────────────────────────────
  var STYLE = [
    '#nariya-overlay{position:fixed;left:12px;right:12px;bottom:calc(16px + env(safe-area-inset-bottom));',
      'z-index:99999;display:none;max-width:560px;margin:0 auto;color:#e6f1ff;',
      'font-family:-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans KR",sans-serif;',
      'background:rgba(9,24,40,.97);border:1px solid rgba(56,189,248,.40);border-radius:18px;',
      'box-shadow:0 14px 40px rgba(0,0,0,.55);backdrop-filter:blur(10px);',
      'padding:14px 16px;transition:padding .25s ease, max-width .25s ease;}',
    '#nariya-overlay .nv-head{display:flex;align-items:center;gap:12px;}',
    '#nariya-overlay .nv-st{font-size:13px;font-weight:700;}',
    '#nariya-overlay .nv-q{font-size:12.5px;color:#7fd2ff;margin-top:8px;}',
    '#nariya-overlay .nv-a{font-size:15px;line-height:1.55;margin-top:6px;color:#eaf4ff;}',
    // 답변중: 넓고 크게
    '#nariya-overlay.nv-speaking{max-width:680px;padding:18px 20px;}',
    '#nariya-overlay.nv-speaking .nv-a{font-size:17.5px;line-height:1.65;margin-top:10px;',
      'max-height:46vh;overflow-y:auto;-webkit-overflow-scrolling:touch;}',
    '#nariya-overlay .nv-tap{font-size:11px;color:#6f8aa3;margin-top:10px;text-align:right;display:none;}',
    '#nariya-overlay.nv-speaking .nv-tap{display:block;}',
    // ── A. Gemini 그라데이션 오브 ──
    '#nariya-overlay .orb{width:46px;height:46px;border-radius:50%;flex:0 0 auto;position:relative;',
      'background:conic-gradient(from 0deg,#4f8cff,#9b6bff,#ff6bcb,#ffd36b,#4f8cff);',
      'animation:nvSpin 4s linear infinite, nvBreathe 2.4s ease-in-out infinite;}',
    '#nariya-overlay .orb::after{content:"";position:absolute;inset:7px;border-radius:50%;',
      'background:rgba(9,24,40,.97);box-shadow:inset 0 0 12px rgba(0,0,0,.5);}',
    '#nariya-overlay .orb::before{content:"";position:absolute;inset:-5px;border-radius:50%;z-index:-1;',
      'background:inherit;filter:blur(12px);opacity:.55;}',
    '#nariya-overlay.nv-listening .orb{animation-duration:3.2s,1.5s;}',
    '#nariya-overlay.nv-thinking .orb{animation-duration:1.3s,2s;filter:hue-rotate(20deg);}',
    '#nariya-overlay.nv-speaking .orb{width:40px;height:40px;animation-duration:6s,1s;}',
    '@keyframes nvSpin{to{transform:rotate(360deg);}}',
    '@keyframes nvBreathe{0%,100%{transform:scale(.92);}50%{transform:scale(1.06);}}'
  ].join('');

  var box, stEl, qEl, aEl, hideTimer;
  function injectStyle() {
    if (document.getElementById('nariya-overlay-style')) return;
    var s = document.createElement('style');
    s.id = 'nariya-overlay-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }
  function ensure() {
    if (box) return;
    injectStyle();
    box = document.createElement('div');
    box.id = 'nariya-overlay';
    box.innerHTML =
      '<div class="nv-head"><div class="orb"></div>' +
      '<div style="flex:1;min-width:0;"><div class="nv-st">나리야</div>' +
      '<div class="nv-q"></div></div></div>' +
      '<div class="nv-a"></div>' +
      '<div class="nv-tap">화면을 누르면 닫혀요</div>';
    document.body.appendChild(box);
    stEl = box.querySelector('.nv-st');
    qEl = box.querySelector('.nv-q');
    aEl = box.querySelector('.nv-a');
    box.addEventListener('click', hideNow);   // 답변 패널 탭하면 닫힘
  }

  function hideNow() { if (box) box.style.display = 'none'; clearTimeout(hideTimer); }
  function hideSoon(ms) { clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (box) box.style.display = 'none'; }, ms); }

  // 음성 비서를 끄거나 멈출 때 외부(토글 등)에서 즉시 숨길 수 있는 전역 훅.
  window.__nariyaOverlayHide = hideNow;

  var LABEL = { listening: '🎙️ 듣고 있어요', thinking: '💭 생각 중', speaking: '🔊 나리야' };

  P.addListener('assistantState', function (e) {
    try {
      var s = e && e.state;
      // 대기/종료 → 완전 숨김(평소엔 아무것도 안 보이게).
      if (s === 'wake' || s === 'idle' || s === 'stopped' || s === 'off') { hideNow(); return; }
      if (s !== 'listening' && s !== 'thinking' && s !== 'speaking') return;

      ensure();
      clearTimeout(hideTimer);
      box.className = 'nv-' + s;          // 상태 클래스(오브 속도·확장 제어)
      box.style.display = 'block';
      stEl.textContent = LABEL[s] || '나리야';

      if (s === 'listening') { qEl.textContent = ''; aEl.textContent = ''; }
      // 질문(Q)은 생각중·답변중에 작게, 답변(A)은 답변중에 크게.
      qEl.textContent = (e.query != null && e.query !== '') ? ('Q. ' + e.query) : qEl.textContent;
      if (s === 'speaking') {
        aEl.textContent = (e.answer != null) ? e.answer : '';
        aEl.scrollTop = 0;
      } else {
        aEl.textContent = '';
      }

      // 안전 자동 숨김 — 멈춤/꺼짐에도 오버레이가 영영 남지 않게.
      //   대화가 진행되면 단계마다 새 이벤트로 타이머가 갱신되어 조기 숨김 없음.
      if (s === 'speaking') hideSoon(28000);
      else if (s === 'listening') hideSoon(12000);
      else if (s === 'thinking') hideSoon(15000);
    } catch (err) { /* 무시 */ }
  });
})();
