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
        var zoneId    = beach.zone  || (s.BEACH_META[s.selectedBeach] && s.BEACH_META[s.selectedBeach].zone);
        var alertName = beach.alert || (s.BEACH_META[s.selectedBeach] && s.BEACH_META[s.selectedBeach].alert);

        // zone_forecasts 9/12/15/18시 데이터 존재 여부로 D+0~D+2 / D+3+ 구분
        // D+3 이후는 zone_forecasts 범위 밖이라 모든 값이 null
        var timeData    = s.utils.getZoneTimeData(zoneId, dateStr);
        var hasZoneData = timeData.some(function(td) {
            return td.wh !== null || td.wp !== null || td.ws !== null;
        });

        // 수온 값 추출 (오전/오후/종일 공통)
        var temps = {};
        if (forecast['오전'] && forecast['오전'].avgWtem) temps['오전'] = forecast['오전'].avgWtem;
        if (forecast['오후'] && forecast['오후'].avgWtem) temps['오후'] = forecast['오후'].avgWtem;
        if (forecast['일']  && forecast['일'].avgWtem)   temps['종일'] = forecast['일'].avgWtem;

        var html = '';

        // --- 서핑지수 테이블 ---
        html += _buildIndexTable(forecast);

        if (hasZoneData) {
            // ── D+0~D+2: 9/12/15/18시 상세 테이블 ──
            html += _buildDetailTableHourly(timeData, temps);
            // 해상특보는 테이블 아래 별도 블록
            if (s.buildAlertHtml && alertName) {
                html += s.buildAlertHtml(alertName);
            }
        } else {
            // ── D+3+: 한 줄 compact + 해상특보 바로 아래 ──
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
     * 상세정보 테이블 — 시간대별 표시 (D+0~D+2, 해구 기상 데이터 있는 경우)
     *
     * [표시 예시]
     * 상세정보
     * ┌────────────┬──────┬──────┬──────┬──────┐
     * │  구분      │  9시 │ 12시 │ 15시 │ 18시 │
     * ├────────────┼──────┼──────┼──────┼──────┤
     * │유의파고 m  │ 1.9m │ 1.9m │ 1.9m │ 1.9m │
     * │파주기 sec  │  6.9 │  6.9 │  6.9 │  6.9 │
     * │바람 m/s    │북서풍│북서풍│북서풍│북서풍│
     * │            │8.1m/s│8.1m/s│8.1m/s│8.1m/s│
     * │수온 °C     │ 오전 12.4°C  │ 오후 12.5°C  │
     * └────────────┴──────┴──────┴──────┴──────┘
     *
     * @param {Array}  timeData - [{time:'9시', wh, wp, ws, windDir}, ...]
     * @param {Object} temps    - { '오전': '12.4', '오후': '12.5' } 또는 { '종일': '13.1' }
     * @returns {string} HTML 문자열
     */
    function _buildDetailTableHourly(timeData, temps) {
        var html = '<div class="surfing-detail-card">';
        html += '<div class="surfing-detail-card-title">상세정보</div>';
        html += '<table class="surfing-detail-table">';

        // 헤더: 빈칸 + 9시/12시/15시/18시
        html += '<thead><tr>';
        html += '<th class="surfing-detail-th-label"></th>';
        timeData.forEach(function(td) {
            html += '<th class="surfing-detail-th-time">' + td.time + '</th>';
        });
        html += '</tr></thead><tbody>';

        // 유의파고
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">유의파고</span><span class="surfing-detail-unit">m</span></td>';
        timeData.forEach(function(td) {
            var val = (td.wh !== null && td.wh !== undefined) ? Number(td.wh).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val">' + val + '</td>';
        });
        html += '</tr>';

        // 파주기
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">파주기</span><span class="surfing-detail-unit">sec</span></td>';
        timeData.forEach(function(td) {
            var val = (td.wp !== null && td.wp !== undefined) ? Number(td.wp).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val">' + val + '</td>';
        });
        html += '</tr>';

        // 바람
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">바람</span><span class="surfing-detail-unit">m/s</span></td>';
        timeData.forEach(function(td) {
            var windInfo = s.utils.windDirToText(td.windDir);
            var wsVal = (td.ws !== null && td.ws !== undefined) ? Number(td.ws).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val surfing-detail-wind">';
            if (td.windDir !== null) {
                html += '<span class="surfing-wind-arrow">' + windInfo.arrow + '</span>';
                html += '<span class="surfing-wind-dir">' + windInfo.text + '</span>';
                html += '<span class="surfing-wind-spd">' + wsVal + '</span>';
            } else {
                html += '-';
            }
            html += '</td>';
        });
        html += '</tr>';

        // 수온 (오전/오후 colspan 또는 종일 colspan)
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">수온</span><span class="surfing-detail-unit">&deg;C</span></td>';
        if (temps['오전'] || temps['오후']) {
            var amVal = temps['오전'] ? temps['오전'] + '°C' : '-';
            var pmVal = temps['오후'] ? temps['오후'] + '°C' : '-';
            html += '<td class="surfing-detail-td-temp" colspan="2"><span class="surfing-temp-label">오전</span> ' + s.utils.escapeHtml(amVal) + '</td>';
            html += '<td class="surfing-detail-td-temp" colspan="2"><span class="surfing-temp-label">오후</span> ' + s.utils.escapeHtml(pmVal) + '</td>';
        } else {
            var allVal = temps['종일'] ? temps['종일'] + '°C' : '-';
            html += '<td class="surfing-detail-td-temp" colspan="4"><span class="surfing-temp-label">종일</span> ' + s.utils.escapeHtml(allVal) + '</td>';
        }
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
        html += '<div class="surfing-detail-card-title">상세정보</div>';

        // 한 줄: 유의파고 / 파주기 / 풍속 / 수온 가로 나열
        html += '<div class="surfing-compact-row">';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">유의파고</span> ';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(wh) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">파주기</span> ';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(wp) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">풍속</span> ';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(ws) + '</span>';
        html += '</span>';
        html += '<span class="surfing-compact-item">';
        html += '<span class="surfing-compact-label">수온</span> ';
        html += '<span class="surfing-compact-val">' + s.utils.escapeHtml(tem) + '</span>';
        html += '</span>';
        html += '</div>';

        // 해상특보: 한 줄 바로 아래 (surfing5.js의 buildAlertHtml 위임)
        if (s.buildAlertHtml && alertName) {
            html += s.buildAlertHtml(alertName);
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
