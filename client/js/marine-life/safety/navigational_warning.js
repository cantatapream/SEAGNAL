/**
 * ============================================================================
 * 파일명: client/js/marine-life/safety/navigational_warning.js
 * 역할  : 해양안전 화면에 "항행경보" 버튼을 얹어, 현재 발효 중인 항행경보
 *         (선박사고·표류장애물·수중장애물·해상사격훈련 등) 목록을 팝업으로 보여준다.
 *         지도 레이어가 아니라 안내(ⓘ) 버튼과 같은 클릭-오픈 방식이다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : shared/ui/ui_modal.js(window.showSeagnalModal)
 *  - 서버 API      : GET /api/navigational-warning/list (30분 캐시)
 *  - 마크업        : index2.html #ocean-navwarn-btn — 해양안전 전용
 *  - 나를 쓰는 곳  : 버튼은 이 파일이 자체 바인딩(다른 해양안전 버튼과 동일 패턴)
 * [로드 순서] seaway.js 다음 · life_safety.js 바로 앞 (marine-life/safety 그룹)
 * ============================================================================
 */

(function () {
    'use strict';

    var LIST_URL = '/api/navigational-warning/list';

    /** 목록 한 건의 팝업 HTML(제목/구분/발표기관/근거/본문) */
    function _itemHtml(item) {
        var cat = item.noti_cat || item.app_cat || '';
        var meta = [cat, item.gov_cd, item.basic].filter(Boolean).join(' · ');
        return '<div class="navwarn-item">' +
            '<div class="navwarn-item-title">' + (item.title || '(제목 없음)') + '</div>' +
            (meta ? '<div class="navwarn-item-meta">' + meta + '</div>' : '') +
            '<div class="navwarn-item-content">' + (item.content || '') + '</div>' +
            '</div>';
    }

    function _openPopup() {
        if (typeof window.showSeagnalModal !== 'function') return;
        window.showSeagnalModal('항행경보', '불러오는 중...', 'info');
        _applyWideClass();

        fetch(LIST_URL)
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (!data.success) {
                    window.showSeagnalModal('항행경보', data.error || '항행경보를 불러오지 못했습니다.', 'error');
                    return;
                }
                var items = data.items || [];
                var html = items.length
                    ? items.map(_itemHtml).join('')
                    : '현재 발효 중인 항행경보가 없습니다.';
                window.showSeagnalModal('항행경보', html, 'info');
                _applyWideClass();
            })
            .catch(function () {
                window.showSeagnalModal('항행경보', '항행경보를 불러오지 못했습니다.', 'error');
            });
    }

    /** 목록이 길어 기본 폭·높이보다 넓게 + 스크롤 (access_control.js 의 wide 클래스와 같은 패턴) */
    function _applyWideClass() {
        var modalContent = document.querySelector('#seagnal-custom-modal .seagnal-modal-content');
        if (modalContent) modalContent.classList.add('access-control-wide', 'navwarn-list');
    }

    function _bind() {
        var btn = document.getElementById('ocean-navwarn-btn');
        if (!btn) return;
        btn.addEventListener('click', _openPopup);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _bind);
    } else {
        _bind();
    }
})();
