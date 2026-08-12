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
    event.preventDefault();
    window.openKmaIframeModal(url, title);
    return false;
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

// 모달이 열린 직후 이 시간(ms) 동안은 배경(오버레이) 탭으로 인한 닫기를 무시한다.
// [이유] 하이브리드 웹뷰에서 지도를 탭하면(OL 은 포인터 이벤트로 즉시 처리) 모달이
// 뜨는데, 그 직후 같은 탭에 대한 브라우저의 지연된 합성 click 이벤트가 뒤늦게 도착해
// 방금 생긴 전체화면 오버레이의 onclick(닫기)을 눌러버려 "뜨자마자 바로 닫히는" 현상이
// 생겼다(항로 팝업에서 실제 확인됨). "확인" 버튼 탭은 이 유예에 걸리지 않는다
// (closeSeagnalModal 을 인자 없이 호출).
var SEAGNAL_MODAL_CLOSE_GRACE_MS = 350;
var _seagnalModalOpenedAt = 0;

window.showSeagnalModal = function (title, message, type) {
    type = type || 'info';
    var existing = document.getElementById('seagnal-custom-modal');
    if (existing) existing.remove();

    var modal = document.createElement('div');
    modal.id = 'seagnal-custom-modal';
    modal.className = 'seagnal-modal';

    var icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-info';
    var iconClass = type === 'error' ? 'error' : '';

    modal.innerHTML = '<div class="seagnal-modal-overlay" onclick="window.closeSeagnalModal(true)"></div>' +
        '<div class="seagnal-modal-content">' +
        '<div class="seagnal-modal-icon ' + iconClass + '">' +
        '<i class="fa-solid ' + icon + '"></i></div>' +
        '<div class="seagnal-modal-title">' + title + '</div>' +
        '<div class="seagnal-modal-message">' + message.replace(/\n/g, '<br>') + '</div>' +
        '<button class="seagnal-modal-btn" onclick="window.closeSeagnalModal()">확인</button>' +
        '</div>';

    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';
    _seagnalModalOpenedAt = Date.now();
};

/**
 * SEAGNAL 시스템 모달을 닫는다.
 * 예1: closeSeagnalModal() — "확인" 버튼 탭, 즉시 닫힘.
 * 예2: closeSeagnalModal(true) — 배경(오버레이) 탭. 연 지 350ms 안이면 지연된
 *      합성 click 으로 보고 무시, 그 뒤면 정상적으로 닫힘.
 * @param {boolean} [fromBackdrop] - 오버레이(배경) 탭으로 인한 호출이면 true
 * [연계] ← showSeagnalModal() 의 오버레이/버튼 onclick, backbutton.js(뒤로가기 시 즉시 닫기 — 인자 없이 호출)
 */
window.closeSeagnalModal = function (fromBackdrop) {
    if (fromBackdrop && (Date.now() - _seagnalModalOpenedAt) < SEAGNAL_MODAL_CLOSE_GRACE_MS) return;
    var modal = document.getElementById('seagnal-custom-modal');
    if (modal) {
        modal.classList.add('fade-out');
        setTimeout(function () {
            modal.remove();
            document.body.style.overflow = '';
        }, 200);
    }
};
