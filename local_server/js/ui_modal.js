/**
 * ============================================================================
 * 파일명: js/ui_modal.js
 * 역할: 공통 UI 모달 (기상청 iframe, SEAGNAL 시스템 모달)
 * ============================================================================
 *
 * [설명]
 * - handleKmaLinkClick(): 기상청 링크 클릭 핸들러 (앱/웹 분기)
 * - openKmaIframeModal(): 기상청 전용 iframe 모달
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
    if (window.Capacitor && window.Capacitor.isNativePlatform()) {
        event.preventDefault();
        window.openKmaIframeModal(url, title);
        return false;
    }
    return true;
};

// ============================================================================
// 기상청 전용 iframe 모달
// ============================================================================
window.openKmaIframeModal = function (url, title) {
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

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
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

    modal.innerHTML = '<div class="seagnal-modal-overlay" onclick="window.closeSeagnalModal()"></div>' +
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
