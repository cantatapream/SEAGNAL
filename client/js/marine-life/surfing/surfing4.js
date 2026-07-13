/**
 * ============================================================================
 * 파일명: js/surfing4.js
 * 역할: 서핑지수 프론트엔드 - 팝업 콘텐츠 렌더링 (서핑지수 테이블 + 상세정보)
 * ============================================================================
 *
 * [설명]
 * 팝업 내부의 모든 콘텐츠를 HTML 문자열로 생성하여 #surfing-popup-content에 주입합니다.
 * - 서핑지수 테이블: 오전/오후(또는 종일) × 초급/중급/상급 등급 배지
 * - 상세정보 테이블: 해구 기상 데이터 기반 9시/12시/15시/18시 파고·파주기·바람 + 수온
 * - 해상특보: surfing5.js의 buildAlertHtml()에 위임
 * - 면책조항: 고정 텍스트
 *
 * [로드 순서] surfing3.js 다음
 *
 * [연계]
 * - surfing1.js → window._surfing (데이터, 유틸, 상수)
 * - surfing3.js → openPopup()에서 s.renderPopupContent() 호출
 * - surfing5.js → s.buildAlertHtml(alertName) 호출 (해상특보 HTML)
 * - index.html → #surfing-popup-content, #surfing-date-label,
 *                #surfing-date-prev, #surfing-date-next
 *
 * [데이터 소스 매핑]
 * ┌──────────────┬──────────────────────────────────┐
 * │ 표출 항목     │ 데이터 소스                       │
 * ├──────────────┼──────────────────────────────────┤
 * │ 서핑지수      │ surfing_index → grades.초급/중급/상급 │
 * │ 파고/파주기/바람│ zone_forecasts → wh/wp/ws/windDir │
 * │ 수온          │ surfing_index → avgWtem           │
 * │ 해상특보      │ weather_alerts → 특보구역별 current │
 * └──────────────┴──────────────────────────────────┘
 * ============================================================================
 */

(function () {
    'use strict';

    if (!window._surfing) {
        console.error('surfing4.js: window._surfing이 없습니다. surfing1.js를 먼저 로드하세요.');
        return;
    }

    var s = window._surfing;

    // ========================================================================
    // 1. 메인 렌더링 함수
    // ========================================================================

    /**
     * 현재 선택된 해수욕장 + 날짜의 팝업 콘텐츠를 렌더링합니다.
     *
     * [호출 시점]
     * - surfing3.js의 openPopup() → 팝업 첫 표시
     * - 날짜 < > 버튼 클릭 → 날짜 변경 후 재렌더링
     *
     * [처리 흐름]
     * 1. 날짜 라벨 및 버튼 상태 업데이트
     * 2. 서핑지수 테이블 HTML 생성 (_buildIndexTable)
     * 3. zone_forecasts 데이터 유무로 D+0~D+2 / D+3+ 구분
     *    - D+0~D+2 (해구 시간대 데이터 있음): 9/12/15/18시 테이블 + 해상특보 별도 표시
     *    - D+3+   (해구 시간대 데이터 없음): 한 줄 compact 표시, 해상특보 바로 아래
     * 4. #surfing-popup-content에 주입
     */
    function _renderPopupContent() {
        if (!s.selectedBeach || !s.data) return;

        var beaches = s.data.beaches;
        var beach = beaches && beaches[s.selectedBeach];
        if (!beach) return;

        var dateStr = s.availableDates[s.selectedDateIdx];
        var forecast = beach.forecasts && beach.forecasts[dateStr];

        // --- 1. 날짜 라벨 업데이트 ---
        var dateLabel = document.getElementById('surfing-date-label');
        if (dateLabel) {
            dateLabel.textContent = s.utils.formatDateLabel(dateStr);
        }

        // --- 2. < > 버튼 활성/비활성 ---
        var prevBtn = document.getElementById('surfing-date-prev');
        var nextBtn = document.getElementById('surfing-date-next');
        if (prevBtn) prevBtn.disabled = s.selectedDateIdx <= 0;
        if (nextBtn) nextBtn.disabled = s.selectedDateIdx >= s.availableDates.length - 1;

        var contentEl = document.getElementById('surfing-popup-content');
        if (!contentEl) return;

        if (!forecast) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        // 해구번호 및 특보구역명
        // zoneId: 해구기상 팝업(marine.js)에서 사용하는 해구 번호 (서핑환경 테이블에서는 더 이상 사용하지 않음)
        // alertName: 해상특보 조회 키 (예: '충남북부앞바다')
        var alertName = beach.alert || (s.BEACH_META[s.selectedBeach] && s.BEACH_META[s.selectedBeach].alert);

        // 서핑지수 API의 오전/오후 슬롯 유무로 D+0~D+2 / D+3+ 구분
        // - 오전 또는 오후 슬롯이 있으면 → D+0~D+2 → 오전/오후 2컬럼 테이블
        // - 없으면(종일 슬롯만 있으면) → D+3+ → compact 1행
        var hasAmPm = !!(forecast['오전'] || forecast['오후']);

        // 수온 값 추출 (D+3+ compact 표시용으로만 사용)
        var temps = {};
        if (forecast['오전'] && forecast['오전'].avgWtem) temps['오전'] = forecast['오전'].avgWtem;
        if (forecast['오후'] && forecast['오후'].avgWtem) temps['오후'] = forecast['오후'].avgWtem;
        if (forecast['일']  && forecast['일'].avgWtem)   temps['종일'] = forecast['일'].avgWtem;

        var html = '';

        // --- 서핑지수 테이블 (서핑지수 API 기반, 오전/오후/종일 × 초급/중급/상급) ---
        html += _buildIndexTable(forecast);

        if (hasAmPm) {
            // ── D+0~D+2: 서핑 전용 API 기반 오전/오후 2컬럼 테이블 ──
            html += _buildDetailTableAmPm(forecast, alertName);
        } else {
            // ── D+3+: 한 줄 compact + 해상특보 텍스트 바로 아래 (기존 유지) ──
            html += _buildDetailCompact(forecast, temps, alertName);
        }

        contentEl.innerHTML = html;
    }

    // ========================================================================
    // 2. 서핑지수 테이블
    // ========================================================================

    /**
     * 서핑지수 테이블 HTML을 생성합니다.
     *
     * [구조]
     * - 카드 타이틀: "서핑지수" (테이블 위, 별도 텍스트)
     * - 헤더 행: 구분 | [초급 배지] | [중급 배지] | [상급 배지]
     * - 데이터 행: [오전/오후/종일 배지] | 매우좋음 | 보통 | 나쁨  (텍스트 색상만)
     *
     * [D+0~D+2 표시 예시]
     * 서핑지수
     * ┌──────┬──────────────┬──────────────┬──────────────┐
     * │ 구분 │   [초급▶]   │   [중급▶]   │   [상급▶]   │
     * ├──────┼──────────────┼──────────────┼──────────────┤
     * │[오전▶]│  매우좋음  │   보통       │   나쁨       │
     * ├──────┼──────────────┼──────────────┼──────────────┤
     * │[오후▶]│   나쁨     │   나쁨       │   나쁨       │
     * └──────┴──────────────┴──────────────┴──────────────┘
     *
     * [D+3+ 표시 예시]
     * 서핑지수
     * ┌──────┬──────────────┬──────────────┬──────────────┐
     * │ 구분 │   [초급▶]   │   [중급▶]   │   [상급▶]   │
     * ├──────┼──────────────┼──────────────┼──────────────┤
     * │[종일▶]│   나쁨     │   나쁨       │   나쁨       │
     * └──────┴──────────────┴──────────────┴──────────────┘
     *
     * @param {Object} forecast - beach.forecasts[dateStr]
     * @returns {string} HTML 문자열
     */
    function _buildIndexTable(forecast) {
        var hasAmPm = forecast['오전'] || forecast['오후'];
        var timeSlots  = hasAmPm ? ['오전', '오후'] : ['일'];
        var timeLabels = timeSlots.map(function(t) { return t === '일' ? '종일' : t; });

        var grades = ['초급', '중급', '상급'];
        var gradeClasses = {
            '초급': 'surfing-grade-beginner',
            '중급': 'surfing-grade-mid',
            '상급': 'surfing-grade-adv'
        };

        var html = '<div class="surfing-index-card">';
        // 테이블 위 섹션 타이틀 (이미지2 기준: 테이블 바깥 별도 텍스트)
        html += '<div class="surfing-index-card-title">서핑지수</div>';
        html += '<table class="surfing-index-table">';

        // --- 헤더 행: "구분" + [초급/중급/상급 배지] ---
        html += '<thead><tr>';
        html += '<th class="surfing-index-th-label">구분</th>';
        grades.forEach(function(grade) {
            html += '<th class="surfing-index-th-grade">';
            html += '<span class="surfing-grade-badge ' + gradeClasses[grade] + '">' + grade + '</span>';
            html += '</th>';
        });
        html += '</tr></thead>';

        // --- 데이터 행: [시간대 배지] + 등급값(텍스트 색상) ---
        html += '<tbody>';
        timeSlots.forEach(function(slot, idx) {
            html += '<tr>';
            html += '<td class="surfing-index-td-time">';
            html += '<span class="surfing-time-badge">' + timeLabels[idx] + '</span>';
            html += '</td>';

            grades.forEach(function(grade) {
                var slotData = forecast[slot];
                var levelVal = slotData && slotData.grades && slotData.grades[grade];
                var level    = levelVal || '-';
                var valClass = (level !== '-') ? ('surfing-val-' + level) : 'surfing-val-none';

                html += '<td class="surfing-index-td-val">';
                html += '<span class="' + valClass + '">' + s.utils.escapeHtml(level) + '</span>';
                html += '</td>';
            });

            html += '</tr>';
        });
        html += '</tbody>';
        html += '</table>';
        html += '</div>';

        return html;
    }

    // ========================================================================
    // 3. 상세정보 테이블 (파고 / 파주기 / 바람 / 수온)
    // ========================================================================

    /**
     * 해상특보 표시 내용(HTML)을 반환하는 공통 헬퍼.
     * 테이블 행과 compact 텍스트 양쪽에서 사용합니다.
     *
     * [반환 예시]
     * "충남북부앞바다: <span class='surfing-alert-none-txt'>특보 없음</span>"
     * "강원북부앞바다: <span class='surfing-alert-active'>풍랑주의보 발효 중</span>"
     *
     * @param {string} alertName - 특보구역명 (예: '충남북부앞바다')
     * @returns {string} 내부 HTML 문자열
     */
    function _buildAlertInlineHtml(alertName) {
        if (!alertName) return '<span class="surfing-alert-none-txt">정보 없음</span>';

        var zoneName = s.utils.escapeHtml(alertName);
        var alertMap = s.alertMap;

        if (!alertMap || !alertMap[alertName]) {
            return zoneName + ' <span class="surfing-alert-none-txt">정보 없음</span>';
        }

        var zoneInfo = alertMap[alertName];
        var current  = zoneInfo.current;
        var upcoming = zoneInfo.upcoming;

        if (current) {
            // 해제 상태이면 "특보 없음" 표시
            if (current.command === '해제') {
                return zoneName + ' <span class="surfing-alert-none-txt">특보 없음</span>';
            }
            var alertType = s.utils.escapeHtml(current.type || '특보');
            return zoneName + ' <span class="surfing-alert-active">' + alertType + ' 발효 중</span>';
        }
        if (upcoming) {
            var upType = s.utils.escapeHtml(upcoming.type || '특보');
            return zoneName + ' <span class="surfing-alert-upcoming">' + upType + ' (예비)</span>';
        }
        return zoneName + ' <span class="surfing-alert-none-txt">특보 없음</span>';
    }

    /**
     * 서핑환경 테이블 — 오전/오후 2컬럼 표시 (D+0~D+2)
     *
     * [변경 이유]
     * 기존에는 해구기상(zone_forecasts) API의 9/12/15/18시 데이터를 사용했으나,
     * 서핑 전용 API(surfing_index)가 서핑에 최적화된 파고·파주기 값을 제공하므로
     * 이 데이터 기반으로 전환합니다.
     * 풍향 정보는 서핑 전용 API에서 제공되지 않으므로 풍속만 표시합니다.
     *
     * [데이터 소스]
     * forecast['오전'] 및 forecast['오후'] 각각의:
     *   - avgWvhgt: 평균 유의파고 (m)
     *   - avgWvpd:  평균 파주기 (sec)
     *   - avgWspd:  평균 풍속 (m/s)
     *   - avgWtem:  평균 수온 (°C)
     *
     * [표시 예시]
     * 서핑환경
     * ┌────────────┬──────────┬──────────┐
     * │            │   오전   │   오후   │
     * ├────────────┼──────────┼──────────┤
     * │유의파고 m  │   1.9    │   2.0    │
     * │파주기 sec  │   8.3    │   8.6    │
     * │풍속 m/s    │   8.8    │   8.1    │
     * │수온 °C     │  6.5°C   │  6.8°C   │
     * │해상특보    │ 충남북부앞바다 특보없음  │ ← colspan=2
     * └────────────┴──────────┴──────────┘
     *
     * @param {Object} forecast  - beach.forecasts[dateStr] (오전/오후 슬롯 포함)
     * @param {string} alertName - 특보구역명 (예: '충남북부앞바다')
     * @returns {string} HTML 문자열
     */
    function _buildDetailTableAmPm(forecast, alertName) {
        // 오전/오후 슬롯 데이터 추출 (API 응답에 없으면 빈 객체로 폴백하여 '-' 표시)
        var am = forecast['오전'] || {};
        var pm = forecast['오후'] || {};

        /**
         * 숫자 값을 소수점 1자리 문자열로 변환합니다.
         * 값이 없으면 '-'를 반환합니다.
         * 예) 1.9234 → '1.9',  null → '-',  '' → '-'
         */
        function fmt(val) {
            return (val !== null && val !== undefined && val !== '')
                ? Number(val).toFixed(1)
                : '-';
        }

        var html = '<div class="surfing-detail-card">';
        html += '<div class="surfing-detail-card-title">서핑환경</div>';
        html += '<table class="surfing-detail-table">';

        // ── 헤더: 빈칸 | 오전 | 오후 ──
        html += '<thead><tr>';
        html += '<th class="surfing-detail-th-label"></th>';
        html += '<th class="surfing-detail-th-time">오전</th>';
        html += '<th class="surfing-detail-th-time">오후</th>';
        html += '</tr></thead><tbody>';

        // ── 유의파고 행: 서핑 전용 API의 평균 파고값 ──
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">유의파고</span><span class="surfing-detail-unit">m</span></td>';
        html += '<td class="surfing-detail-td-val">' + fmt(am.avgWvhgt) + '</td>';
        html += '<td class="surfing-detail-td-val">' + fmt(pm.avgWvhgt) + '</td>';
        html += '</tr>';

        // ── 파주기 행: 서핑 전용 API의 평균 파주기값 ──
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">파주기</span><span class="surfing-detail-unit">sec</span></td>';
        html += '<td class="surfing-detail-td-val">' + fmt(am.avgWvpd) + '</td>';
        html += '<td class="surfing-detail-td-val">' + fmt(pm.avgWvpd) + '</td>';
        html += '</tr>';

        // ── 풍속 행: 풍향 없이 속도만 표시 (서핑 API에 풍향 정보 없음) ──
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">풍속</span><span class="surfing-detail-unit">m/s</span></td>';
        html += '<td class="surfing-detail-td-val">' + fmt(am.avgWspd) + '</td>';
        html += '<td class="surfing-detail-td-val">' + fmt(pm.avgWspd) + '</td>';
        html += '</tr>';

        // ── 수온 행: 오전/오후 각 셀에 직접 수온 표시 ──
        var amTemp = am.avgWtem ? s.utils.escapeHtml(String(am.avgWtem)) + '°C' : '-';
        var pmTemp = pm.avgWtem ? s.utils.escapeHtml(String(pm.avgWtem)) + '°C' : '-';
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">수온</span><span class="surfing-detail-unit">&deg;C</span></td>';
        html += '<td class="surfing-detail-td-temp">' + amTemp + '</td>';
        html += '<td class="surfing-detail-td-temp">' + pmTemp + '</td>';
        html += '</tr>';

        // ── 해상특보 행: 오전/오후 2칸 전체 병합 (colspan=2) ──
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">해상특보</span></td>';
        html += '<td class="surfing-detail-td-alert" colspan="2">';
        html += _buildAlertInlineHtml(alertName);
        html += '</td>';
        html += '</tr>';

        html += '</tbody></table></div>';
        return html;
    }

    /**
     * 상세정보 한 줄 compact 표시 + 해상특보 (D+3+, zone_forecasts 없는 경우)
     *
     * [표시 예시]
     * ┌──────────────────────────────────────────────────────────┐
     * │  유의파고 0.3m   파주기 7.1sec   풍속 4.2m/s   수온 13.1°C │
     * ├──────────────────────────────────────────────────────────┤
     * │  강원북부앞바다: 특보 없음                                 │
     * └──────────────────────────────────────────────────────────┘
     *
     * - 테이블 없이 한 줄로 나열 → 데이터가 적은 종일 케이스에 적합
     * - 해상특보를 같은 카드 안에 바로 아래 표시
     *
     * @param {Object} forecast   - beach.forecasts[dateStr]
     * @param {Object} temps      - { '종일': '13.1' } (또는 오전/오후)
     * @param {string} alertName  - 특보구역명 (예: '강원북부앞바다'), 없으면 null
     * @returns {string} HTML 문자열
     */
    function _buildDetailCompact(forecast, temps, alertName) {
        // 종일 슬롯 데이터 (D+3+는 항상 forecast['일'])
        var d   = forecast['일'] || {};
        var wh  = d.avgWvhgt ? Number(d.avgWvhgt).toFixed(1) + 'm'   : '-';
        var wp  = d.avgWvpd  ? Number(d.avgWvpd).toFixed(1)  + 'sec' : '-';
        var ws  = d.avgWspd  ? Number(d.avgWspd).toFixed(1)  + 'm/s' : '-';
        var tem = temps['종일'] ? temps['종일'] + '°C' : '-';

        var html = '<div class="surfing-detail-compact-card">';
        html += '<div class="surfing-detail-card-title">서핑환경</div>';

        // 한 줄: 유의파고 / 파주기 / 풍속 / 수온 가로 나열
        html += '<div class="surfing-compact-row">';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">유의파고</span>';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(wh) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">파주기</span>';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(wp) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">풍속</span>';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(ws) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">수온</span>';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(tem) + '</span>';
        html += '</span>';
        html += '</div>';

        // 해상특보: 카드 박스 없이 텍스트 한 줄 (예: "해상특보 : 충남북부앞바다 특보 없음")
        if (alertName) {
            html += '<div class="surfing-compact-alert">';
            html += '<span class="surfing-compact-alert-label">해상특보</span> ';
            html += _buildAlertInlineHtml(alertName);
            html += '</div>';
        }

        html += '</div>';
        return html;
    }

    // ========================================================================
    // 4. window._surfing에 함수 등록
    // ========================================================================

    /**
     * surfing3.js의 openPopup()과 날짜 버튼 이벤트에서 s.renderPopupContent()를 호출합니다.
     */
    s.renderPopupContent = _renderPopupContent;

})();
