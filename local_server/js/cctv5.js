// ====================================================================
// cctv5.js — 탭 클릭 초기화 연결 (DOMContentLoaded)
//
// [역할]
//   페이지 로드 완료 후, CCTV 서브탭 버튼 클릭 이벤트에
//   initCctvMap()(cctv2.js)을 연결합니다.
//
// [왜 setTimeout 100ms를 쓰는가?]
//   switchSubTab()(marine.js)이 탭 전환 CSS 애니메이션을 실행하는 동안
//   #cctv-map 컨테이너의 실제 크기가 아직 0일 수 있습니다.
//   100ms 후에 initCctvMap()을 호출하면 애니메이션이 완료된 시점에
//   OpenLayers가 컨테이너 크기를 올바르게 읽어 지도를 렌더링합니다.
//   (tide.js의 동일한 패턴에서 검증된 방법)
//
// [연계]
//   - index.html .sub-tab-btn[data-target="cctv-section"] — 클릭 이벤트 등록 대상
//   - js/marine.js switchSubTab() — 탭 전환 애니메이션 처리 (이 파일과 독립적으로 동작)
//   - cctv2.js initCctvMap()      — 지도 초기화 함수
// ====================================================================

document.addEventListener('DOMContentLoaded', function () {

    // ─────────────────────────────────────────────────────────────────
    // CCTV 서브탭 버튼에 클릭 이벤트 등록
    // data-target="cctv-section" 인 .sub-tab-btn 버튼이 대상
    // (현재 HTML에 1개이지만, querySelectorAll로 혹시 모를 복수 대응)
    // ─────────────────────────────────────────────────────────────────
    const cctvTabBtns = document.querySelectorAll('.sub-tab-btn[data-target="cctv-section"]');

    cctvTabBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            // 탭 전환 CSS 애니메이션 완료 후 지도 초기화
            setTimeout(initCctvMap, 100);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // 초기 접속 시 cctv-section이 이미 active인 경우 대비
    // (예: 딥링크, 관리자 화면 등에서 바로 CCTV 탭으로 진입한 경우)
    // ─────────────────────────────────────────────────────────────────
    const cctvSection = document.getElementById('cctv-section');
    if (cctvSection && cctvSection.classList.contains('active')) {
        initCctvMap();
    }

    // ─────────────────────────────────────────────────────────────────
    // 유의사항 버튼(#cctv-notice-btn) → showSeagnalModal 팝업
    // [연계] index2.html #cctv-disclaimer (숨김 소스) → innerHTML 을 모달로 전달
    // ─────────────────────────────────────────────────────────────────
    const cctvNoticeBtn = document.getElementById('cctv-notice-btn');
    if (cctvNoticeBtn) {
        cctvNoticeBtn.addEventListener('click', function () {
            const src = document.getElementById('cctv-disclaimer');
            const html = src ? src.innerHTML : '';
            if (typeof window.showSeagnalModal === 'function') {
                window.showSeagnalModal('유의사항', html, 'info');
            }
        });
    }
});
