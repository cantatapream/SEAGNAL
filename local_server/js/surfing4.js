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
     * 1. 현재 날짜 라벨 업데이트 ( < 오늘 04월 02일 (목) > )
     * 2. < > 버튼 활성/비활성 상태 업데이트
     * 3. 서핑지수 테이블 HTML 생성 (_buildIndexTable)
     * 4. 상세정보 테이블 HTML 생성 (_buildDetailTable)
     * 5. 해상특보 HTML 생성 (surfing5.js 위임)
     * 6. 면책조항 HTML 추가
     * 7. 모두 조합하여 #surfing-popup-content에 주입
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

        // --- 3~6. 콘텐츠 영역 ---
        var contentEl = document.getElementById('surfing-popup-content');
        if (!contentEl) return;

        // 예보 데이터가 없는 날짜
        if (!forecast) {
            contentEl.innerHTML = '<p style="color:#888;text-align:center;padding:20px;">해당 날짜의 예보 데이터가 없습니다.</p>';
            return;
        }

        var html = '';

        // --- 서핑지수 테이블 ---
        html += _buildIndexTable(forecast);

        // --- 상세정보 테이블 ---
        // beach.zone: 해구번호 (BEACH_META에서 가져온 값, scheduler가 저장)
        var zoneId = beach.zone || (s.BEACH_META[s.selectedBeach] && s.BEACH_META[s.selectedBeach].zone);
        html += _buildDetailTable(forecast, zoneId, dateStr);

        // --- 해상특보 (surfing5.js가 정의한 buildAlertHtml 사용) ---
        var alertName = beach.alert || (s.BEACH_META[s.selectedBeach] && s.BEACH_META[s.selectedBeach].alert);
        if (s.buildAlertHtml && alertName) {
            html += s.buildAlertHtml(alertName);
        }

        // --- 면책조항 ---
        html += _buildDisclaimer();

        contentEl.innerHTML = html;
    }

    // ========================================================================
    // 2. 서핑지수 테이블
    // ========================================================================

    /**
     * 서핑지수 테이블 HTML을 생성합니다.
     *
     * [오전/오후 날짜 (D+0~D+2) 표시 예시]
     * ┌──────────────┬───────────────┬───────────────┐
     * │  서핑지수    │     오전      │     오후      │
     * ├──────────────┼───────────────┼───────────────┤
     * │    초급      │  ■ 매우좋음   │  ■ 나쁨       │
     * │    중급      │  ■ 보통       │  ■ 나쁨       │
     * │    상급      │  ■ 나쁨       │  ■ 나쁨       │
     * └──────────────┴───────────────┴───────────────┘
     *
     * [종일 날짜 (D+3~D+6) 표시 예시]
     * ┌──────────────┬──────────────────────────────┐
     * │  서핑지수    │           종일               │
     * ├──────────────┼──────────────────────────────┤
     * │    초급      │          ■ 나쁨              │
     * │    중급      │          ■ 나쁨              │
     * │    상급      │          ■ 나쁨              │
     * └──────────────┴──────────────────────────────┘
     *
     * 각 셀의 배경색은 등급(매우좋음~매우나쁨)에 따라 달라집니다.
     * 색상 매핑: LEVEL_COLORS (파랑/초록/노랑/주황/빨강)
     *
     * @param {Object} forecast - beach.forecasts[dateStr] 값
     *   예: { '오전': { grades: {초급:'매우좋음', 중급:'보통', 상급:'나쁨'}, avgWvhgt:... },
     *         '오후': { ... } }
     *   또는 { '일': { grades: {...}, ... } }  (종일)
     * @returns {string} HTML 문자열
     */
    function _buildIndexTable(forecast) {
        // 시간대 목록 결정
        // 오전/오후가 있으면 ['오전','오후'], 종일이면 ['일']
        var hasAmPm = forecast['오전'] || forecast['오후'];
        var timeSlots = hasAmPm ? ['오전', '오후'] : ['일'];
        // '일'은 화면에 '종일'로 표시
        var timeLabels = timeSlots.map(function(t) { return t === '일' ? '종일' : t; });

        var grades = ['초급', '중급', '상급'];
        var COLORS = s.LEVEL_COLORS;

        // 서핑지수 테이블을 카드 형태로 생성
        var html = '<div class="surfing-index-card">';
        html += '<div class="surfing-index-card-title">서핑지수</div>';
        html += '<table class="surfing-index-table">';

        // 헤더: 등급 라벨 + 시간대 라벨
        html += '<thead><tr>';
        html += '<th class="surfing-index-th-label"></th>';
        timeLabels.forEach(function(label) {
            html += '<th class="surfing-index-th-time">' + label + '</th>';
        });
        html += '</tr></thead>';

        // 등급 행 (초급/중급/상급)
        html += '<tbody>';
        grades.forEach(function(grade) {
            html += '<tr>';
            html += '<td class="surfing-index-td-grade">' + grade + '</td>';

            timeSlots.forEach(function(slot) {
                var slotData = forecast[slot];
                var levelVal = slotData && slotData.grades && slotData.grades[grade];
                var level = levelVal || '-';

                // 등급에 맞는 배경색/텍스트색 결정
                var colors = COLORS[level];
                var cellClass = 'surfing-index-td-val';
                if (colors) {
                    cellClass += ' surfing-level-' + level;
                } else {
                    cellClass += ' surfing-level-none';
                }

                html += '<td class="' + cellClass + '">';
                html += s.utils.escapeHtml(level);
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
     * 상세정보 테이블 HTML을 생성합니다.
     *
     * [표시 예시 — 오전/오후 날짜]
     * ┌────────────┬──────┬──────┬──────┬──────┐
     * │ 상세정보   │  9시 │ 12시 │ 15시 │ 18시 │
     * ├────────────┼──────┼──────┼──────┼──────┤
     * │ 유의파고(m)│ 0.7  │ 0.6  │ 0.8  │ 0.9  │
     * ├────────────┼──────┼──────┼──────┼──────┤
     * │ 파주기(sec)│ 7.0  │ 9.6  │ 8.7  │ 8.3  │
     * ├────────────┼──────┼──────┼──────┼──────┤
     * │ 바람(m/s)  │ ↓    │ ↓    │ ↘    │ ↘    │
     * │            │ 서풍 │ 서풍 │북서풍│북서풍│
     * │            │ 5.0  │ 4.4  │ 4.3  │ 4.3  │
     * ├────────────┼──────┴──────┼──────┴──────┤
     * │ 수온(°C)   │  오전 10.5  │  오후 10.8  │  ← 서핑 API 값
     * └────────────┴─────────────┴─────────────┘
     *
     * [데이터 소스]
     * - 파고(wh), 파주기(wp), 바람(ws+windDir): zone_forecasts.json (해구별 3시간 간격)
     *   → surfing1.js의 _getZoneTimeData(zoneId, dateStr)로 9/12/15/18시 추출
     * - 수온(avgWtem): surfing_index API (오전/오후/종일 평균값)
     *
     * @param {Object} forecast - beach.forecasts[dateStr]
     * @param {string} zoneId - 해구번호 (예: '63')
     * @param {string} dateStr - 날짜 YYYYMMDD (예: '20260402')
     * @returns {string} HTML 문자열
     */
    function _buildDetailTable(forecast, zoneId, dateStr) {
        // 해구별 시간대 데이터: [{time:'9시', wh, wp, ws, windDir}, ...]
        var timeData = s.utils.getZoneTimeData(zoneId, dateStr);

        // 해구 기상 데이터가 전부 비어있는지 확인 (D+3 이후 등)
        // zone_forecasts에 데이터가 없으면 서핑 API 평균값을 대신 사용
        var hasZoneData = timeData.some(function(td) {
            return td.wh !== null || td.wp !== null || td.ws !== null;
        });

        // 수온: 오전/오후/종일에서 추출
        var temps = {};
        if (forecast['오전'] && forecast['오전'].avgWtem) temps['오전'] = forecast['오전'].avgWtem;
        if (forecast['오후'] && forecast['오후'].avgWtem) temps['오후'] = forecast['오후'].avgWtem;
        if (forecast['일'] && forecast['일'].avgWtem)   temps['종일'] = forecast['일'].avgWtem;

        // ─── 해구 기상 데이터가 있는 경우 (D+0~D+2): 9/12/15/18시 상세 표시 ───
        if (hasZoneData) {
            return _buildDetailTableHourly(timeData, temps);
        }

        // ─── 해구 기상 없는 경우 (D+3 이후): 서핑 API 평균값으로 대체 표시 ───
        // 서핑 API의 오전/오후/종일별 avgWvhgt, avgWvpd, avgWspd를 사용
        return _buildDetailTableAvg(forecast, temps);
    }

    /**
     * 상세정보 테이블 — 시간대별 표시 (해구 기상 데이터 있는 경우)
     * 9시/12시/15시/18시 4개 컬럼
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
     * 상세정보 테이블 — 서핑 API 평균값 표시 (해구 기상 없는 D+3 이후)
     *
     * [동작]
     * zone_forecasts에 9/12/15/18시 데이터가 없는 경우,
     * 서핑 API 응답의 avgWvhgt, avgWvpd, avgWspd를 오전/오후 또는 종일 컬럼으로 표시합니다.
     *
     * 예: D+4 종일 → forecast['일'] = { avgWvhgt:'0.7', avgWvpd:'6.3', avgWspd:'5.1', avgWtem:'13.1' }
     *     → 유의파고 0.7m, 파주기 6.3sec, 풍속 5.1m/s, 수온 13.1°C 단일 행으로 표시
     */
    function _buildDetailTableAvg(forecast, temps) {
        // 오전/오후 또는 종일 컬럼 결정
        var hasAmPm = forecast['오전'] || forecast['오후'];
        var slots = hasAmPm ? ['오전', '오후'] : ['일'];
        var labels = slots.map(function(t) { return t === '일' ? '종일' : t; });

        var html = '<div class="surfing-detail-card">';
        html += '<div class="surfing-detail-card-title">상세정보 <span class="surfing-detail-note">(평균)</span></div>';
        html += '<table class="surfing-detail-table">';

        // 헤더
        html += '<thead><tr>';
        html += '<th class="surfing-detail-th-label"></th>';
        labels.forEach(function(label) {
            html += '<th class="surfing-detail-th-time">' + label + '</th>';
        });
        html += '</tr></thead><tbody>';

        // 유의파고
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">유의파고</span><span class="surfing-detail-unit">m</span></td>';
        slots.forEach(function(slot) {
            var d = forecast[slot];
            var val = (d && d.avgWvhgt) ? Number(d.avgWvhgt).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val">' + val + '</td>';
        });
        html += '</tr>';

        // 파주기
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">파주기</span><span class="surfing-detail-unit">sec</span></td>';
        slots.forEach(function(slot) {
            var d = forecast[slot];
            var val = (d && d.avgWvpd) ? Number(d.avgWvpd).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val">' + val + '</td>';
        });
        html += '</tr>';

        // 풍속 (방향 없이 평균 풍속만)
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">풍속</span><span class="surfing-detail-unit">m/s</span></td>';
        slots.forEach(function(slot) {
            var d = forecast[slot];
            var val = (d && d.avgWspd) ? Number(d.avgWspd).toFixed(1) : '-';
            html += '<td class="surfing-detail-td-val">' + val + '</td>';
        });
        html += '</tr>';

        // 수온
        html += '<tr>';
        html += '<td class="surfing-detail-td-label"><span class="surfing-detail-name">수온</span><span class="surfing-detail-unit">&deg;C</span></td>';
        if (temps['오전'] || temps['오후']) {
            var amVal = temps['오전'] ? temps['오전'] + '°C' : '-';
            var pmVal = temps['오후'] ? temps['오후'] + '°C' : '-';
            html += '<td class="surfing-detail-td-val">' + s.utils.escapeHtml(amVal) + '</td>';
            html += '<td class="surfing-detail-td-val">' + s.utils.escapeHtml(pmVal) + '</td>';
        } else {
            var allVal = temps['종일'] ? temps['종일'] + '°C' : '-';
            html += '<td class="surfing-detail-td-val" colspan="' + slots.length + '">' + s.utils.escapeHtml(allVal) + '</td>';
        }
        html += '</tr>';

        html += '</tbody></table></div>';
        return html;
    }

    // ========================================================================
    // 4. 면책조항
    // ========================================================================

    /**
     * 팝업 하단 면책조항 HTML을 반환합니다.
     *
     * [표시 내용 — 대화에서 확정된 문구]
     * "서핑지수는 수치예측결과를 활용하여 만들어진 참고 자료로서,
     *  기상 변화 등에 의해 실제와 다를 수 있습니다.
     *  따라서 서비스는 사용자의 책임하에 이용되어야하며,
     *  그 정보의 정확성과 법적인 책임은 조사원 및 본 앱에게 있지 아니함을
     *  알려드립니다."
     *
     * @returns {string} HTML 문자열
     */
    function _buildDisclaimer() {
        return '<div class="surfing-disclaimer">' +
            '<p>서핑지수는 수치예측결과를 활용하여 만들어진 참고 자료로서, ' +
            '기상 변화 등에 의해 실제와 다를 수 있습니다. ' +
            '따라서 서비스는 사용자의 책임하에 이용되어야하며, ' +
            '그 정보의 정확성과 법적인 책임은 조사원 및 본 앱에게 있지 아니함을 알려드립니다.</p>' +
            '</div>';
    }

    // ========================================================================
    // 5. window._surfing에 함수 등록
    // ========================================================================

    /**
     * surfing3.js의 openPopup()과 날짜 버튼 이벤트에서 s.renderPopupContent()를 호출합니다.
     */
    s.renderPopupContent = _renderPopupContent;

})();
