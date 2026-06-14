/**
 * ============================================================================
 * 파일명: js/assistant_overlay.js
 * 역할: 백그라운드 "나리야" 음성 비서의 상태/대화를 앱 화면에 오버레이로 표시.
 * ============================================================================
 *  네이티브 VoiceAssistantService → SeagnalAssistantPlugin.emitState() →
 *  'assistantState' 이벤트(state, query, answer)를 구독해, 화면 하단에
 *  듣는중/생각중/답변중 상태 + 질문/답변 텍스트를 띄운다.
 *  (상단 알림만으로는 현황 확인이 어렵다는 피드백 반영 — Gemini 같은 경험)
 *
 *  - index2 페이지 + Capacitor 플러그인이 있을 때만 동작(없으면 무동작).
 *  - 답변 표시 후 자동 숨김, 대기 상태는 잠깐 후 숨김.
 * ============================================================================
 */
(function () {
  if (window.__SEAGNAL_PAGE !== 'index2') return;
  var P = (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SeagnalAssistant)
    ? window.Capacitor.Plugins.SeagnalAssistant : null;
  if (!P || !P.addListener) return;

  var box, qEl, aEl, stEl, dotEl, hideTimer;
  function ensure() {
    if (box) return;
    box = document.createElement('div');
    box.id = 'nariya-overlay';
    box.style.cssText = 'position:fixed;left:12px;right:12px;bottom:16px;z-index:99999;' +
      'background:rgba(11,31,51,.97);border:1px solid rgba(56,189,248,.45);border-radius:16px;' +
      'padding:14px 16px;color:#e6f1ff;font-family:-apple-system,BlinkMacSystemFont,Roboto,"Noto Sans KR",sans-serif;' +
      'box-shadow:0 10px 30px rgba(0,0,0,.55);display:none;max-width:560px;margin:0 auto;';
    box.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;">' +
        '<span id="nariya-dot" style="width:10px;height:10px;border-radius:50%;background:#38bdf8;box-shadow:0 0 8px #38bdf8;"></span>' +
        '<span id="nariya-st">나리야</span></div>' +
      '<div id="nariya-q" style="font-size:13px;color:#22d3ee;margin-top:8px;"></div>' +
      '<div id="nariya-a" style="font-size:15px;line-height:1.55;margin-top:4px;"></div>';
    document.body.appendChild(box);
    stEl = box.querySelector('#nariya-st');
    qEl = box.querySelector('#nariya-q');
    aEl = box.querySelector('#nariya-a');
    dotEl = box.querySelector('#nariya-dot');
  }
  function hideNow() { if (box) box.style.display = 'none'; clearTimeout(hideTimer); }
  function hideSoon(ms) { clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (box) box.style.display = 'none'; }, ms); }

  // 음성 비서를 끄거나 멈출 때 외부(토글 등)에서 즉시 숨길 수 있는 전역 훅.
  window.__nariyaOverlayHide = hideNow;

  var LABEL = { wake: '대기 중', listening: '🎙️ 듣고 있어요', thinking: '💭 생각 중', speaking: '🔊 답변 중' };
  var COLOR = { wake: '#8da9c4', listening: '#38bdf8', thinking: '#fbbf24', speaking: '#22d3ee' };

  P.addListener('assistantState', function (e) {
    try {
      ensure();
      var s = e && e.state;
      // 대기/종료 상태는 오버레이를 숨긴다. ('idle'/'stopped'/'off' 는 서비스 정지 신호)
      if (s === 'wake') { hideSoon(1500); return; }
      if (s === 'idle' || s === 'stopped' || s === 'off') { hideNow(); return; }
      clearTimeout(hideTimer);
      box.style.display = 'block';
      stEl.textContent = LABEL[s] || '나리야';
      dotEl.style.background = COLOR[s] || '#38bdf8';
      dotEl.style.boxShadow = '0 0 8px ' + (COLOR[s] || '#38bdf8');
      if (s === 'listening') { qEl.textContent = ''; aEl.textContent = ''; }
      if (e.query != null) qEl.textContent = 'Q. ' + e.query;
      if (e.answer != null) aEl.textContent = 'A. ' + e.answer;
      // 안전 자동 숨김 — 서비스가 듣는중/생각중에서 멈추거나 꺼져도 오버레이가 영영 남지
      //   않도록 보장. 실제 대화는 단계마다 새 이벤트가 와서 타이머가 갱신되므로 조기 숨김 없음.
      if (s === 'speaking') hideSoon(20000);
      else if (s === 'listening') hideSoon(12000);
      else if (s === 'thinking') hideSoon(15000);
    } catch (err) { /* 무시 */ }
  });
})();
