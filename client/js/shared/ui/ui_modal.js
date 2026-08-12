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
