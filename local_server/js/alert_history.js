/**
 * ============================================================================
 * 파일명: js/alert_history.js
 * 역할: 특보 히스토리 팝업 모달 (해역별 통보문 이력 조회)
 * ============================================================================
 *
 * [설명]
 * 특보 카드의 히스토리 아이콘 버튼을 클릭하면 해당 해역에 적용된
 * 통보문 히스토리를 팝업으로 표시하는 컴포넌트입니다.
 *
 * - showAlertHistoryPopup(zoneName, history): 히스토리 팝업 표시
 *   → 해역명과 해당 해역의 history 배열을 받아 팝업 모달 생성
 *   → 각 통보문 항목은 아코디언 형태로, 클릭 시 해당 해역 관련 AI 분석 내용 표출
 *
 * - closeAlertHistoryPopup(): 팝업 닫기
 *
 * [데이터 흐름]
 * 1. render.js의 createAlertElement()에서 히스토리 아이콘 버튼 생성
 * 2. 버튼 클릭 → showAlertHistoryPopup(zoneName, alertItem.history) 호출
 * 3. history 배열의 각 항목:
 *    { reportId, time(tmFc), tmEf, tmCc, type, command, processedAt }
 * 4. 아코디언 펼침 시 /api/bulletin-cache/:reportId API 호출
 *    → collect_cache에서 해당 통보문의 AI 분석 결과를 가져옴
 *    → aiResult 중 해당 해역(zoneName)에 해당하는 이벤트만 필터링하여 표시
 *
 * [연계 파일]
 * - js/render.js        → createAlertElement()에서 히스토리 버튼 생성 및 이 함수 호출
 * - js/data.js          → processSingleAlert()에서 alertItem.history에 이력 데이터 포함
 * - routes/weather.js   → GET /api/bulletin-cache/:reportId 엔드포인트
 * - report_alert_processor.js → collect_cache에 통보문별 캐시 저장
 * - js/ui_modal.js      → 기존 모달 패턴 참고 (동일한 다크테마 UI 스타일)
 *
 * [로딩 순서] render.js 이후, app_init.js 이전
 * ============================================================================
 */

// ============================================================================
// 스타일 주입 (최초 1회)
// ============================================================================
(function injectAlertHistoryStyles() {
    if (document.getElementById('alert-history-styles')) return;
    const style = document.createElement('style');
    style.id = 'alert-history-styles';
    style.textContent = `
        /* 히스토리 팝업 오버레이 */
        .alert-history-modal {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            z-index: 10001;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s ease;
        }
        .alert-history-modal.show {
            opacity: 1;
            pointer-events: all;
        }
        .alert-history-overlay {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.75);
        }
        /* 히스토리 팝업 컨텐츠 */
        .alert-history-content {
            position: relative;
            width: 92%;
            max-width: 520px;
            max-height: 80vh;
            background: linear-gradient(160deg, #1a1e2e 0%, #0f172a 100%);
            border-radius: 16px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: translateY(20px);
            transition: transform 0.25s ease;
        }
        .alert-history-modal.show .alert-history-content {
            transform: translateY(0);
        }
        /* 헤더 */
        .alert-history-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: linear-gradient(135deg, rgba(30, 60, 114, 0.9), rgba(42, 82, 152, 0.7));
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            flex-shrink: 0;
        }
        .alert-history-header h3 {
            margin: 0;
            font-size: 1.0rem;
            font-weight: 700;
            color: #fff;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .alert-history-close {
            background: rgba(255, 255, 255, 0.1);
            border: none;
            color: #aaa;
            font-size: 1.1rem;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all 0.2s;
        }
        .alert-history-close:hover {
            background: rgba(255, 255, 255, 0.2);
            color: #fff;
        }
        /* 본문 (스크롤 영역) */
        .alert-history-body {
            overflow-y: auto;
            padding: 12px 16px;
            flex: 1;
        }
        /* 히스토리 없음 */
        .alert-history-empty {
            text-align: center;
            color: #8b949e;
            padding: 32px 16px;
            font-size: 0.9rem;
        }
        .alert-history-empty i {
            font-size: 2rem;
            margin-bottom: 12px;
            display: block;
            color: #4a5568;
        }
        /* 통보문 아이템 */
        .history-item {
            margin-bottom: 8px;
            border-radius: 10px;
            border: 1px solid rgba(255, 255, 255, 0.06);
            overflow: hidden;
            transition: border-color 0.2s;
        }
        .history-item:hover {
            border-color: rgba(255, 255, 255, 0.12);
        }
        .history-item-header {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 12px 14px;
            cursor: pointer;
            background: rgba(30, 40, 60, 0.5);
            transition: background 0.2s;
        }
        .history-item-header:hover {
            background: rgba(40, 55, 80, 0.6);
        }
        /* 통보문 유형 뱃지 */
        .history-type-badge {
            font-size: 0.72rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        .history-type-badge.preliminary {
            background: rgba(255, 152, 0, 0.25);
            color: #ffb74d;
            border: 1px solid rgba(255, 152, 0, 0.3);
        }
        .history-type-badge.alert {
            background: rgba(244, 67, 54, 0.2);
            color: #ef5350;
            border: 1px solid rgba(244, 67, 54, 0.3);
        }
        .history-type-badge.release {
            background: rgba(76, 175, 80, 0.2);
            color: #66bb6a;
            border: 1px solid rgba(76, 175, 80, 0.3);
        }
        /* 통보문 번호 및 시간 */
        .history-report-info {
            flex: 1;
            min-width: 0;
        }
        .history-report-id {
            font-size: 0.82rem;
            font-weight: 600;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .history-report-time {
            font-size: 0.72rem;
            color: #8b949e;
            margin-top: 2px;
        }
        /* 아코디언 화살표 */
        .history-item-arrow {
            color: #6b7280;
            font-size: 0.7rem;
            transition: transform 0.2s;
            flex-shrink: 0;
        }
        .history-item.expanded .history-item-arrow {
            transform: rotate(90deg);
        }
        /* 아코디언 내용 (AI 분석) */
        .history-item-body {
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease;
            background: rgba(15, 23, 42, 0.6);
        }
        .history-item.expanded .history-item-body {
            max-height: 500px;
        }
        .history-item-body-inner {
            padding: 12px 14px;
            font-size: 0.82rem;
            color: #c9d1d9;
            line-height: 1.6;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        /* AI 분석 이벤트 카드 */
        .history-event-card {
            background: rgba(30, 40, 60, 0.4);
            border-radius: 8px;
            padding: 10px 12px;
            margin-bottom: 8px;
            border-left: 3px solid #4fc3f7;
        }
        .history-event-card:last-child {
            margin-bottom: 0;
        }
        .history-event-type {
            font-weight: 700;
            font-size: 0.82rem;
            color: #81d4fa;
            margin-bottom: 4px;
        }
        .history-event-detail {
            display: flex;
            justify-content: space-between;
            font-size: 0.78rem;
            color: #8b949e;
            margin-top: 3px;
        }
        .history-event-detail span:last-child {
            color: #c9d1d9;
            font-weight: 500;
        }
        /* 로딩 스피너 */
        .history-loading {
            text-align: center;
            padding: 16px;
            color: #8b949e;
            font-size: 0.82rem;
        }
        .history-loading i {
            margin-right: 6px;
        }
        /* 명령 타입별 색상 */
        .history-command-tag {
            font-size: 0.72rem;
            padding: 2px 6px;
            border-radius: 4px;
            font-weight: 600;
        }
        .history-command-tag.publish { background: rgba(33, 150, 243, 0.2); color: #64b5f6; }
        .history-command-tag.effect { background: rgba(244, 67, 54, 0.2); color: #ef5350; }
        .history-command-tag.change { background: rgba(156, 39, 176, 0.2); color: #ce93d8; }
        .history-command-tag.release { background: rgba(76, 175, 80, 0.2); color: #66bb6a; }
        .history-command-tag.extend { background: rgba(255, 152, 0, 0.2); color: #ffb74d; }
        .history-command-tag.reinforce { background: rgba(233, 30, 99, 0.2); color: #f48fb1; }
    `;
    document.head.appendChild(style);
})();

// ============================================================================
// 히스토리 팝업 표시
// ============================================================================

/**
 * 특보 히스토리 팝업을 표시합니다.
 * @param {string} zoneName - 해역명 (예: "제주도남쪽바깥먼바다")
 * @param {Array} history - 해당 해역의 통보문 히스토리 배열
 *   각 항목: { reportId, time, tmEf, tmCc, type, command, processedAt }
 */
window.showAlertHistoryPopup = function (zoneName, history) {
    // 기존 팝업이 있으면 제거
    closeAlertHistoryPopup();

    const modal = document.createElement('div');
    modal.id = 'alert-history-modal';
    modal.className = 'alert-history-modal';

    // 오버레이 (클릭 시 닫기)
    const overlay = document.createElement('div');
    overlay.className = 'alert-history-overlay';
    overlay.addEventListener('click', closeAlertHistoryPopup);
    modal.appendChild(overlay);

    // 컨텐츠
    const content = document.createElement('div');
    content.className = 'alert-history-content';

    // 헤더
    const header = document.createElement('div');
    header.className = 'alert-history-header';
    header.innerHTML = `
        <h3><i class="fa-solid fa-clock-rotate-left" style="color: #81d4fa;"></i> ${zoneName} 특보 히스토리</h3>
    `;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'alert-history-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', closeAlertHistoryPopup);
    header.appendChild(closeBtn);
    content.appendChild(header);

    // 본문
    const body = document.createElement('div');
    body.className = 'alert-history-body';

    if (!history || history.length === 0) {
        body.innerHTML = `
            <div class="alert-history-empty">
                <i class="fa-solid fa-inbox"></i>
                히스토리 데이터가 없습니다.
            </div>
        `;
    } else {
        // 히스토리 항목 렌더링 (최신순 - history[0]이 가장 최신)
        history.forEach(function (entry, idx) {
            var item = createHistoryItem(entry, zoneName, idx);
            body.appendChild(item);
        });
    }

    content.appendChild(body);
    modal.appendChild(content);
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    // 애니메이션 트리거
    requestAnimationFrame(function () {
        modal.classList.add('show');
    });

    // ESC 키로 닫기
    modal._escHandler = function (e) {
        if (e.key === 'Escape') closeAlertHistoryPopup();
    };
    document.addEventListener('keydown', modal._escHandler);
};

// ============================================================================
// 히스토리 팝업 닫기
// ============================================================================
window.closeAlertHistoryPopup = function () {
    var modal = document.getElementById('alert-history-modal');
    if (!modal) return;

    // ESC 핸들러 제거
    if (modal._escHandler) {
        document.removeEventListener('keydown', modal._escHandler);
    }

    modal.classList.remove('show');
    setTimeout(function () {
        if (modal.parentNode) modal.parentNode.removeChild(modal);
        document.body.style.overflow = '';
    }, 250);
};

// ============================================================================
// 개별 히스토리 아이템 생성
// ============================================================================

/**
 * 통보문 히스토리 한 건의 DOM 요소를 생성합니다.
 * 아코디언 형태로, 클릭 시 해당 통보문의 AI 분석 결과 중 이 해역 관련 내용만 표시합니다.
 *
 * @param {Object} entry - history 배열의 항목
 *   { reportId, time(tmFc), tmEf, tmCc, type, command, processedAt }
 * @param {string} zoneName - 현재 해역명 (AI 분석 결과 필터링용)
 * @param {number} idx - 인덱스
 * @returns {HTMLElement} - 히스토리 아이템 DOM
 */
function createHistoryItem(entry, zoneName, idx) {
    var item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.reportId = entry.reportId || '';
    item.dataset.loaded = 'false';

    // --- 헤더 ---
    var headerEl = document.createElement('div');
    headerEl.className = 'history-item-header';

    // 유형 뱃지 (예비/특보/해제)
    var badgeClass = 'alert';
    var badgeText = '특보';
    if (entry.command === '예비') {
        badgeClass = 'preliminary';
        badgeText = '예비';
    } else if (entry.command === '해제') {
        badgeClass = 'release';
        badgeText = '해제';
    }

    var badge = document.createElement('span');
    badge.className = 'history-type-badge ' + badgeClass;
    badge.textContent = badgeText;
    headerEl.appendChild(badge);

    // 통보문 번호 및 시간
    var infoDiv = document.createElement('div');
    infoDiv.className = 'history-report-info';

    var reportIdText = formatReportId(entry.reportId);
    var reportIdSpan = document.createElement('div');
    reportIdSpan.className = 'history-report-id';
    reportIdSpan.textContent = reportIdText;
    infoDiv.appendChild(reportIdSpan);

    var timeSpan = document.createElement('div');
    timeSpan.className = 'history-report-time';
    timeSpan.textContent = formatHistoryTime(entry.time);
    infoDiv.appendChild(timeSpan);

    headerEl.appendChild(infoDiv);

    // 명령 태그 (발표/발효/변경/해제/연장/보강)
    var commandTag = document.createElement('span');
    commandTag.className = 'history-command-tag ' + getCommandClass(entry.command);
    commandTag.textContent = entry.type ? (entry.type + ' ' + entry.command) : entry.command;
    headerEl.appendChild(commandTag);

    // 화살표
    var arrow = document.createElement('i');
    arrow.className = 'fa-solid fa-chevron-right history-item-arrow';
    headerEl.appendChild(arrow);

    item.appendChild(headerEl);

    // --- 아코디언 바디 ---
    var bodyEl = document.createElement('div');
    bodyEl.className = 'history-item-body';

    var bodyInner = document.createElement('div');
    bodyInner.className = 'history-item-body-inner';
    bodyInner.innerHTML = '<div class="history-loading"><i class="fa-solid fa-spinner fa-spin"></i> 통보문 내용 불러오는 중...</div>';
    bodyEl.appendChild(bodyInner);

    item.appendChild(bodyEl);

    // --- 아코디언 토글 ---
    headerEl.addEventListener('click', function (e) {
        e.stopPropagation();

        var isExpanded = item.classList.contains('expanded');

        // 다른 아이템 모두 접기
        var parent = item.parentElement;
        if (parent) {
            parent.querySelectorAll('.history-item.expanded').forEach(function (other) {
                if (other !== item) other.classList.remove('expanded');
            });
        }

        if (isExpanded) {
            item.classList.remove('expanded');
        } else {
            item.classList.add('expanded');
            // 최초 펼침 시 데이터 로드
            if (item.dataset.loaded === 'false') {
                loadBulletinContent(entry, zoneName, bodyInner);
                item.dataset.loaded = 'true';
            }
        }
    });

    return item;
}

// ============================================================================
// 통보문 AI 분석 내용 로드
// ============================================================================

/**
 * 서버의 collect_cache에서 통보문 데이터를 가져와 해당 해역 관련 내용만 표시합니다.
 *
 * @param {Object} entry - history 항목 { reportId, type, command, tmEf, tmCc, ... }
 * @param {string} zoneName - 필터링할 해역명
 * @param {HTMLElement} container - 내용을 렌더링할 DOM 컨테이너
 */
function loadBulletinContent(entry, zoneName, container) {
    if (!entry.reportId) {
        container.innerHTML = '<div style="color: #8b949e; font-size: 0.82rem;">통보문 ID 정보가 없습니다.</div>';
        return;
    }

    var encodedId = encodeURIComponent(entry.reportId);

    fetch('/api/bulletin-cache/' + encodedId + '?_t=' + Date.now())
        .then(function (resp) {
            if (!resp.ok) throw new Error('NOT_FOUND');
            return resp.json();
        })
        .then(function (cacheData) {
            renderBulletinContent(cacheData, entry, zoneName, container);
        })
        .catch(function () {
            // 캐시가 없는 경우: history 항목의 기본 정보로 대체 표시
            renderFallbackContent(entry, zoneName, container);
        });
}

/**
 * 캐시된 통보문 AI 분석 결과를 해역 기준으로 필터링하여 렌더링합니다.
 */
function renderBulletinContent(cacheData, entry, zoneName, container) {
    var html = '';

    // AI 분석 결과에서 해당 해역과 관련된 이벤트만 필터링
    var aiResult = cacheData.aiResult || [];
    var relevantEvents = aiResult.filter(function (evt) {
        if (!evt.zones || !Array.isArray(evt.zones)) return false;
        return evt.zones.some(function (z) {
            return z === zoneName || z.includes(zoneName) || zoneName.includes(z);
        });
    });

    if (relevantEvents.length > 0) {
        relevantEvents.forEach(function (evt) {
            html += '<div class="history-event-card">';
            html += '<div class="history-event-type">' + escapeHtml(evt.type || '') + ' ' + escapeHtml(evt.command || '') + '</div>';

            if (evt.tmEf || evt.time) {
                html += '<div class="history-event-detail"><span>발효시각</span><span>' + escapeHtml(formatHistoryTime(evt.tmEf || evt.time)) + '</span></div>';
            }
            if (evt.tmCc) {
                html += '<div class="history-event-detail"><span>해제예정</span><span style="color: #69f0ae;">' + escapeHtml(formatHistoryTime(evt.tmCc)) + '</span></div>';
            }

            // 영향 해역 표시 (해당 해역 강조)
            if (evt.zones && evt.zones.length > 0) {
                var zonesHtml = evt.zones.map(function (z) {
                    if (z === zoneName) return '<span style="color: #81d4fa; font-weight: 600;">' + escapeHtml(z) + '</span>';
                    return '<span style="color: #8b949e;">' + escapeHtml(z) + '</span>';
                }).join(', ');
                html += '<div class="history-event-detail" style="flex-direction: column; gap: 4px;"><span>영향 해역</span><span style="font-size: 0.76rem; line-height: 1.5;">' + zonesHtml + '</span></div>';
            }

            html += '</div>';
        });
    } else {
        // AI 결과에 해당 해역이 없는 경우 (히스토리 기본 정보로 표시)
        html += renderFallbackHtml(entry, zoneName);
    }

    container.innerHTML = html;
}

/**
 * 캐시 데이터가 없을 때 history 항목의 기본 정보만으로 표시합니다.
 */
function renderFallbackContent(entry, zoneName, container) {
    container.innerHTML = renderFallbackHtml(entry, zoneName);
}

function renderFallbackHtml(entry, zoneName) {
    var html = '<div class="history-event-card">';
    html += '<div class="history-event-type">' + escapeHtml(entry.type || '정보 없음') + ' ' + escapeHtml(entry.command || '') + '</div>';

    if (entry.tmEf) {
        html += '<div class="history-event-detail"><span>발효시각</span><span>' + escapeHtml(formatHistoryTime(entry.tmEf)) + '</span></div>';
    }
    if (entry.tmCc) {
        html += '<div class="history-event-detail"><span>해제예정</span><span style="color: #69f0ae;">' + escapeHtml(formatHistoryTime(entry.tmCc)) + '</span></div>';
    }
    html += '<div style="margin-top: 8px; font-size: 0.76rem; color: #6b7280; font-style: italic;">';
    html += '<i class="fa-solid fa-circle-info" style="margin-right: 4px;"></i>';
    html += '통보문 상세 내용은 서버 재수집 후 확인 가능합니다.';
    html += '</div>';
    html += '</div>';
    return html;
}

// ============================================================================
// 유틸리티 함수
// ============================================================================

/**
 * reportId를 "제YYYYMMDD-HHMM호" 형식으로 변환합니다.
 * 예: "met:202602162000:141" → "제20260216-2000호"
 *
 * @param {string} reportId
 * @returns {string}
 */
function formatReportId(reportId) {
    if (!reportId) return '통보문 번호 없음';

    var parts = reportId.split(':');
    if (parts.length >= 2) {
        var ts = parts[1];
        if (ts && ts.length >= 12) {
            return '제' + ts.substring(0, 8) + '-' + ts.substring(8, 12) + '호';
        }
    }
    return reportId;
}

/**
 * 기상청 시간 문자열을 짧은 형식으로 변환합니다.
 * 예: "2026년 02월 16일 20시 00분" → "02.16. 20:00"
 *
 * @param {string} timeStr
 * @returns {string}
 */
function formatHistoryTime(timeStr) {
    if (!timeStr) return '';

    // "YYYY년 MM월 DD일 HH시 MM분" 패턴
    var match = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (match) {
        return match[1] + '.' + match[2] + '.' + match[3] + '. ' + match[4] + ':' + match[5];
    }

    // 범위형: "YYYY년 MM월 DD일 오전(06시~12시)" 패턴
    var rangeMatch = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(.*)/);
    if (rangeMatch) {
        return rangeMatch[1] + '.' + rangeMatch[2] + '.' + rangeMatch[3] + '. ' + rangeMatch[4].trim();
    }

    return timeStr;
}

/**
 * command 값에 따른 CSS 클래스를 반환합니다.
 * @param {string} command
 * @returns {string}
 */
function getCommandClass(command) {
    switch (command) {
        case '발표':
        case '예비': return 'publish';
        case '발효': return 'effect';
        case '변경': return 'change';
        case '해제': return 'release';
        case '연장': return 'extend';
        case '보강': return 'reinforce';
        default: return 'publish';
    }
}

/**
 * HTML 특수문자를 이스케이프합니다.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
