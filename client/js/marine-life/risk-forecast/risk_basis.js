/**
 * ============================================================================
 * 파일명: client/js/marine-life/risk-forecast/risk_basis.js
 * 역할  : 확정된 기준 상세 문안을 대화창으로 열고 원본 PDF 다운로드를 연결한다.
 * [연계]
 *  - 사용하는 파일 : 같은 폴더 위험예측 모듈 / OpenLayers(지도 모듈)
 *  - 서버 API      : /api/risk-forecast/* (routes/risk_forecast.js)
 *  - 마크업        : index2.html #risk-forecast-sheet / #risk-forecast-legend
 *  - 나를 쓰는 곳  : risk_forecast.js 또는 index2.html / risk_forecast_preview.html
 * [로드 순서] risk_basis_content.js 다음 · risk_forecast.js 이전
 * ============================================================================
 */
(function (w) {
    'use strict';
    var modal=null,trigger=null;
    /**
     * 기준 상세 대화창을 닫고 연 버튼으로 초점을 되돌린다.
     * 예: RiskBasis.close()
     * @param 없음
     * @returns {void}
     * [연계] RiskForecast·대화창 이벤트 → DOM 정리
     */
    function close() { if(modal){modal.remove();modal=null;}document.removeEventListener('keydown',key);if(trigger&&trigger.isConnected)trigger.focus(); }
    /**
     * Escape 닫기와 Tab 초점 순환을 처리한다.
     * 예: keydown 이벤트에서 key(event)
     * @param {KeyboardEvent} e - 키보드 이벤트
     * @returns {void}
     * [연계] open → close·초점 이동
     */
    function key(e) {
        if(e.key==='Escape'){e.preventDefault();close();return;}
        if(e.key==='Tab'&&modal){var f=modal.querySelectorAll('button,a[href]'),first=f[0],last=f[f.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}
    }
    /**
     * 확정 문안과 PDF 링크를 기준 상세 대화창에 표시한다.
     * 예: RiskBasis.open('sea',button)
     * @param {string} kind - sea 또는 coast; button은 초점 복원 대상
     * @returns {void}
     * [연계] RiskSheet → RiskBasisContent
     */
    function open(kind,button) {
        close();trigger=button;modal=document.createElement('div');modal.className='rf-modal';
        var box=document.createElement('div');box.className='rf-basis';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label','기준 상세');
        // 이 문안은 사용자 확정 설계서에서 빌드한 정적 문자열이며 API/사용자 문자열을 HTML로 받지 않는다.
        box.innerHTML=(w.RiskBasisContent||{})[kind]||'<button class="mclose">닫기</button><p>기준 상세 문안을 불러오지 못했습니다.</p>';
        modal.appendChild(box);document.body.appendChild(modal);modal.addEventListener('click',function(e){if(e.target===modal||e.target.closest('.mclose'))close();});document.addEventListener('keydown',key);box.querySelector('.mclose').focus();
    }
    w.RiskBasis={open:open,close:close};
})(window);
