/**
 * ============================================================================
 * 파일명: js/ui_modal.js
 * 역할: 공통 UI 모달 (기상청 iframe, SEAGNAL 시스템 모달)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음
 *  - 서버 API      : 없음
 *  - 마크업        : 동적 생성 #kma-iframe-modal, #seagnal-custom-modal
 *  - 나를 쓰는 곳  : 다수 feature 공용 — handleKmaLinkClick()/showSeagnalModal() 을
 *                    tide.js·ocean_cctv.js·alert_history.js·surfing1.js·backbutton.js 등이 호출
 * ============================================================================
 *
 * [설명]
 * - handleKmaLinkClick(): 기상청 링크 클릭 핸들러 (앱/웹 분기)
 * - openKmaIframeModal(): 기상청 전용 iframe 모달 — opt.download 를 주면 머리줄(✕ 왼쪽)에 「PDF」 받기 버튼
 * - downloadKmaFile(): 그 버튼이 부르는 파일 받기(PC·휴대폰 브라우저 = 내려받기 · 휴대폰 앱 = 시스템 브라우저로 넘겨 받기)
 * - closeKmaIframeModal(): iframe 모달 닫기
 * - showSeagnalModal(): SEAGNAL 커스텀 시스템 모달 (alert 대체)
 * - closeSeagnalModal(): 시스템 모달 닫기
 *
 * [로딩 순서] alert_push.js 이후, app_init.js 이전
 * [원본] history.js에서 분리
 * ============================================================================
 */

// ============================================================================
// 기상청 링크 클릭 핸들러 (모바일 앱 대응)
// ============================================================================
window.handleKmaLinkClick = function (event, url, title) {
    event.preventDefault();
    window.openKmaIframeModal(url, title);
    return false;
};

// ============================================================================
// 기상청 전용 iframe 모달
// ============================================================================
/**
 * 기상청 문서를 팝업(iframe)으로 연다.
 * 예: openKmaIframeModal('/api/bulletin-doc/KTKO50_…/view', '제11-49호 풍랑주의보 발표', { download: { url: '/api/bulletin-doc/KTKO50_…/pdf', name: '제11-49호 풍랑주의보 발표.pdf' } })
 * @param {string} url 팝업에 띄울 주소 @param {string} title 머리줄 제목
 * @param {{download?: {url: string, name?: string}}} [opt] download = 원문 파일 — 주면 머리줄 ✕ 왼쪽에 「PDF」 버튼을 둔다
 *   (사용자 2026-11-19 「pdf 원문 다운로드 관련, 버튼을 이미지 2에서 표시한 부분에 … 휴대폰에서도 원문을 다운로드 할 수 있도록」)
 * [연계] ← alert_history.js(📋 해역별 통보문) · escalation.js(격상 가능성 📋) · handleKmaLinkClick 등 / core/backbutton.js 가 감싸 뒤로가기로 닫는다(인자는 그대로 넘어온다)
 */
window.openKmaIframeModal = function (url, title, opt) {
    var existing = document.getElementById('kma-iframe-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'kma-iframe-modal';
    modal.className = 'kma-iframe-modal';
    modal.innerHTML = '<div class="kma-iframe-overlay" onclick="window.closeKmaIframeModal()"></div>' +
        '<div class="kma-iframe-content">' +
        '<div class="kma-iframe-header">' +
        '<h3><i class="fa-solid fa-cloud-sun"></i> ' + title + ' - 기상청</h3>' +
        '<button class="kma-iframe-close" onclick="window.closeKmaIframeModal()">✕</button>' +
        '</div>' +
        '<div class="kma-iframe-body">' +
        '<iframe src="' + url + '" frameborder="0" allowfullscreen></iframe>' +
        '</div></div>';

    // [원문 받기] 머리줄 ✕ 왼쪽의 「PDF」 버튼 — 글은 textContent 로만 넣는다
    var dl = opt && opt.download;
    if (dl && dl.url) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'kma-iframe-download';
        btn.title = '원문 PDF 받기';
        btn.textContent = '⬇ PDF';
        btn.addEventListener('click', function () { window.downloadKmaFile(dl.url, dl.name); });
        var closeBtn = modal.querySelector('.kma-iframe-close');
        closeBtn.parentNode.insertBefore(btn, closeBtn);
    }

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
};

/**
 * 파일을 받는다 — PC·휴대폰 브라우저는 내려받기, 휴대폰 앱은 시스템 브라우저로 넘겨 받는다.
 *   앱 안(Capacitor 웹뷰)은 <a download> 를 처리하지 않아 누름이 아무 일도 안 한다(관리자 화면 [md로 저장]에서 겪은 것 — admin_bulletin_watch.js download).
 *   그래서 앱에서는 시스템 브라우저(@capacitor/browser)에 그 주소를 넘긴다 — 서버가 첨부(Content-Disposition: attachment)로 내려주므로 브라우저가 받는다.
 * 예: downloadKmaFile('/api/bulletin-doc/KTKO50_…/pdf', '제11-49호 풍랑주의보 발표.pdf')
 * @param {string} url 파일 주소(우리 서버 경로 또는 https 주소) @param {string} [name] 저장할 이름(브라우저 내려받기에만 쓰인다)
 * [연계] ← openKmaIframeModal 의 「PDF」 버튼 / → window.Capacitor.Plugins.Browser.open
 */
window.downloadKmaFile = function (url, name) {
    var abs = new URL(url, window.location.href).href;
    var cap = window.Capacitor;
    if (cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform()) {
        var Browser = cap.Plugins && cap.Plugins.Browser;
        if (Browser && typeof Browser.open === 'function') {
            var p = Browser.open({ url: abs });
            if (p && typeof p.catch === 'function') p.catch(function (e) { console.warn('[원문 받기] 시스템 브라우저를 못 열어 새 창으로 연다:', e && e.message); window.open(abs, '_blank'); });
        } else {
            window.open(abs, '_blank');
        }
        return;
    }
    var a = document.createElement('a');
    a.href = abs;
    a.download = name || '';
    a.target = '_blank';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
};

window.closeKmaIframeModal = function () {
    var modal = document.getElementById('kma-iframe-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(function () {
            modal.remove();
            document.body.style.overflow = '';
        }, 150);
    }
};

// ============================================================================
// SEAGNAL 커스텀 시스템 모달 (Alert 대체용)
// ============================================================================

window.showSeagnalModal = function (title, message, type) {
    type = type || 'info';
    var existing = document.getElementById('seagnal-custom-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'seagnal-custom-modal';
    modal.className = 'seagnal-modal';

    var icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    var iconClass = type === 'error' ? 'error' : '';

    // 배경(오버레이) 닫기는 click 이 아니라 pointerdown 에 건다.
    // [이유] 하이브리드 웹뷰는 지도를 탭하면 OL 이 포인터 이벤트로 즉시 모달을 띄우는데,
    // 그 직후 "같은 탭"에 대해 브라우저가 지연시켜 뒤늦게 쏘는 합성 click 이벤트가
    // 방금 생긴 전체화면 오버레이 위에서 발생해 "뜨자마자 바로 닫히는" 현상이 있었다
    // (350ms 유예를 줘봤지만 탭이 몰리는 구간에서도 재현됨 — 시간으로 땜질하지 않고
    // 근본 원인을 없앰). 브라우저가 지연시키는 건 click 뿐, pointerdown/touchstart 는
    // 손가락이 실제로 닿는 순간 즉시 발생해 지연되지 않으므로 이 문제 자체가 없다.
    modal.innerHTML = '<div class="seagnal-modal-overlay" onpointerdown="window.closeSeagnalModal()"></div>' +
        '<div class="seagnal-modal-content">' +
        '<div class="seagnal-modal-icon ' + iconClass + '">' +
        '<i class="fa-solid ' + icon + '"></i></div>' +
        '<div class="seagnal-modal-title">' + title + '</div>' +
        '<div class="seagnal-modal-message">' + message.replace(/\n/g, '<br>') + '</div>' +
        '<button class="seagnal-modal-btn" onclick="window.closeSeagnalModal()">확인</button>' +
        '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
};

window.closeSeagnalModal = function () {
    var modal = document.getElementById('seagnal-custom-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(function () {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
};
