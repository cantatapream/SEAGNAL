/**
 * ============================================================================
 * 파일명: js/alert_history.js
 * 역할: 특보 히스토리 팝업 모달 (해역별 통보문 이력 조회)
 * ============================================================================
 *
 * [설명]
 * 특보 카드의 📋 버튼을 클릭하면 해당 해역에 적용된
 * 통보문 히스토리를 팝업으로 표시하는 컴포넌트입니다.
 *
 * - showAlertHistoryPopup(zoneName, history): 히스토리 팝업 표시
 *   → 해역명과 해당 해역의 history 배열을 받아 팝업 모달 생성
 *   → 각 통보문 항목은 아코디언 형태로, 클릭 시 시각 정보 표출
 *
 * - closeAlertHistoryPopup(): 팝업 닫기
 *
 * [데이터 흐름]
 * 1. render.js의 createAlertElement()에서 📋 버튼 생성
 * 2. 버튼 클릭 → showAlertHistoryPopup(zoneName, alertItem.history) 호출
 * 3. history 배열의 각 항목:
 *    { reportId, title, time(tmFc), tmEf, tmCc, type, command, processedAt }
 * 4. 아코디언 펼침 시 /api/bulletin-cache/:reportId API 호출
 *    → collect_cache에서 해당 통보문의 AI 분석 결과를 가져옴
 *    → 해당 해역(zoneName) 관련 시각 정보만 표시 (영향 해역 목록 미표시)
 *
 * [뱃지 색상 위계] (단계가 높을수록 강한 색상)
 * Lv1. 예비        → 연한 파란색 (muted blue)
 * Lv2. 주의보      → 노란색/앰버 (amber)
 * Lv3. 경보        → 주황색/빨간색 (orange-red)
 * Lv4. 태풍주의보  → 진한 빨간색 (deep red)
 * Lv5. 태풍경보    → 가장 강한 빨간색 (intense red)
 * 해제            → 초록색 (green, 별도)
 *
 * [연계 파일]
 * - js/render.js        → createAlertElement()에서 📋 버튼 생성 및 이 함수 호출
 * - js/data.js          → processSingleAlert()에서 alertItem.history에 이력 데이터 포함
 * - routes/weather.js   → GET /api/bulletin-cache/:reportId 엔드포인트
 * - report_alert_processor.js → collect_cache에 통보문별 캐시 저장, history에 title 포함
 *
 * [로딩 순서] render.js 이후, app_init.js 이전
 * ============================================================================
 */

// ============================================================================
// 스타일 주입 (최초 1회)
// ============================================================================
(function injectAlertHistoryStyles() {
    if (document.getElementById('alert-history-styles')) return;
    var style = document.createElement('style');
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
        /* 통보문 유형 뱃지 - 5단계 위계 색상 */
        .history-type-badge {
            font-size: 0.72rem;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 6px;
            white-space: nowrap;
            flex-shrink: 0;
        }
        /* Lv1: 예비 - 연한 파란색 */
        .history-type-badge.lv-preliminary {
            background: rgba(100, 181, 246, 0.15);
            color: #90caf9;
            border: 1px solid rgba(100, 181, 246, 0.25);
        }
        /* Lv2: 주의보 (비태풍) - 앰버/노란색 */
        .history-type-badge.lv-advisory {
            background: rgba(255, 193, 7, 0.2);
            color: #ffd54f;
            border: 1px solid rgba(255, 193, 7, 0.3);
        }
        /* Lv3: 경보 (비태풍) - 주황색/빨간색 */
        .history-type-badge.lv-warning {
            background: rgba(255, 87, 34, 0.2);
            color: #ff8a65;
            border: 1px solid rgba(255, 87, 34, 0.3);
        }
        /* Lv4: 태풍주의보 - 진한 빨간색 */
        .history-type-badge.lv-typhoon-advisory {
            background: rgba(229, 57, 53, 0.25);
            color: #ef5350;
            border: 1px solid rgba(229, 57, 53, 0.4);
        }
        /* Lv5: 태풍경보 - 가장 강한 빨간색 */
        .history-type-badge.lv-typhoon-warning {
            background: rgba(183, 28, 28, 0.35);
            color: #ff5252;
            border: 1px solid rgba(183, 28, 28, 0.5);
            text-shadow: 0 0 8px rgba(255, 82, 82, 0.3);
        }
        /* 해제 - 초록색 */
        .history-type-badge.lv-release {
            background: rgba(76, 175, 80, 0.2);
            color: #66bb6a;
            border: 1px solid rgba(76, 175, 80, 0.3);
        }
        /* 통보문 제목 (한 줄) */
        .history-report-info {
            flex: 1;
            min-width: 0;
        }
        .history-report-title {
            font-size: 0.82rem;
            font-weight: 600;
            color: #e0e0e0;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
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
        /* 아코디언 내용 (시각 정보) */
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
        /* 시각 정보 카드 */
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
 *   각 항목: { reportId, title, time, tmEf, tmCc, type, command, processedAt }
 */
window.showAlertHistoryPopup = function (zoneName, history) {
    closeAlertHistoryPopup();

    var modal = document.createElement('div');
    modal.id = 'alert-history-modal';
    modal.className = 'alert-history-modal';

    var overlay = document.createElement('div');
    overlay.className = 'alert-history-overlay';
    overlay.addEventListener('click', closeAlertHistoryPopup);
    modal.appendChild(overlay);

    var content = document.createElement('div');
    content.className = 'alert-history-content';

    // 헤더
    var header = document.createElement('div');
    header.className = 'alert-history-header';
    header.innerHTML = '<h3>\uD83D\uDCCB ' + escapeHtml(zoneName) + ' \uD2B9\uBCF4 \uD788\uC2A4\uD1A0\uB9AC</h3>';
    var closeBtn = document.createElement('button');
    closeBtn.className = 'alert-history-close';
    closeBtn.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    closeBtn.addEventListener('click', closeAlertHistoryPopup);
    header.appendChild(closeBtn);
    content.appendChild(header);

    // 본문
    var body = document.createElement('div');
    body.className = 'alert-history-body';

    if (!history || history.length === 0) {
        body.innerHTML = '<div class="alert-history-empty"><i class="fa-solid fa-inbox"></i>\uD788\uC2A4\uD1A0\uB9AC \uB370\uC774\uD130\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
    } else {
        history.forEach(function (entry, idx) {
            var item = createHistoryItem(entry, zoneName, idx);
            body.appendChild(item);
        });
    }

    content.appendChild(body);
    modal.appendChild(content);
    document.body.appendChild(modal);
    document.body.style.overflow = 'hidden';

    requestAnimationFrame(function () {
        modal.classList.add('show');
    });

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
 *
 * @param {Object} entry - history 배열의 항목
 *   { reportId, title, time(tmFc), tmEf, tmCc, type, command, processedAt }
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

    // 뱃지: 단계별 색상 적용
    var badgeInfo = getSeverityBadge(entry.type, entry.command);
    var badge = document.createElement('span');
    badge.className = 'history-type-badge ' + badgeInfo.cssClass;
    badge.textContent = badgeInfo.text;
    headerEl.appendChild(badge);

    // 통보문 제목: [특보] 제XX-XXX호 : YYYY.MM.DD.HH:MM
    var infoDiv = document.createElement('div');
    infoDiv.className = 'history-report-info';

    var titleSpan = document.createElement('div');
    titleSpan.className = 'history-report-title';
    titleSpan.textContent = formatBulletinTitle(entry);
    titleSpan.title = titleSpan.textContent; // 툴팁으로 전체 텍스트 표시
    infoDiv.appendChild(titleSpan);

    headerEl.appendChild(infoDiv);

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
    bodyInner.innerHTML = '<div class="history-loading"><i class="fa-solid fa-spinner fa-spin"></i> \uD1B5\uBCF4\uBB38 \uB0B4\uC6A9 \uBD88\uB7EC\uC624\uB294 \uC911...</div>';
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
            if (item.dataset.loaded === 'false') {
                loadBulletinContent(entry, zoneName, bodyInner);
                item.dataset.loaded = 'true';
            }
        }
    });

    return item;
}

// ============================================================================
// 통보문 AI 분석 내용 로드 (시각 정보만 표시, 영향 해역 미표시)
// ============================================================================

/**
 * 서버의 collect_cache에서 통보문 데이터를 가져와 시각 정보만 표시합니다.
 */
function loadBulletinContent(entry, zoneName, container) {
    if (!entry.reportId) {
        container.innerHTML = '<div style="color: #8b949e; font-size: 0.82rem;">\uD1B5\uBCF4\uBB38 ID \uC815\uBCF4\uAC00 \uC5C6\uC2B5\uB2C8\uB2E4.</div>';
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
            renderFallbackContent(entry, container);
        });
}

/**
 * 캐시된 통보문 AI 분석 결과에서 해당 해역의 시각 정보만 렌더링합니다.
 * 영향 해역 목록은 표시하지 않습니다.
 */
function renderBulletinContent(cacheData, entry, zoneName, container) {
    var html = '';

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
            html += '<div class="history-event-type">' + escapeHtml(normalizeTypeText(evt.type, evt.command)) + '</div>';

            if (evt.tmEf || evt.time) {
                html += '<div class="history-event-detail"><span>\uBC1C\uD6A8\uC2DC\uAC01</span><span>' + escapeHtml(formatHistoryTime(evt.tmEf || evt.time)) + '</span></div>';
            }
            if (evt.tmCc) {
                html += '<div class="history-event-detail"><span>\uD574\uC81C\uC608\uC815</span><span style="color: #69f0ae;">' + escapeHtml(formatHistoryTime(evt.tmCc)) + '</span></div>';
            }

            html += '</div>';
        });
    } else {
        html += renderFallbackHtml(entry);
    }

    container.innerHTML = html;
}

/**
 * 캐시 데이터가 없을 때 history 항목의 기본 정보만으로 표시합니다.
 */
function renderFallbackContent(entry, container) {
    container.innerHTML = renderFallbackHtml(entry);
}

function renderFallbackHtml(entry) {
    var html = '<div class="history-event-card">';
    html += '<div class="history-event-type">' + escapeHtml(normalizeTypeText(entry.type, entry.command)) + '</div>';

    if (entry.tmEf) {
        html += '<div class="history-event-detail"><span>\uBC1C\uD6A8\uC2DC\uAC01</span><span>' + escapeHtml(formatHistoryTime(entry.tmEf)) + '</span></div>';
    }
    if (entry.tmCc) {
        html += '<div class="history-event-detail"><span>\uD574\uC81C\uC608\uC815</span><span style="color: #69f0ae;">' + escapeHtml(formatHistoryTime(entry.tmCc)) + '</span></div>';
    }
    html += '<div style="margin-top: 8px; font-size: 0.76rem; color: #6b7280; font-style: italic;">';
    html += '<i class="fa-solid fa-circle-info" style="margin-right: 4px;"></i>';
    html += '\uD1B5\uBCF4\uBB38 \uC0C1\uC138 \uB0B4\uC6A9\uC740 \uC11C\uBC84 \uC7AC\uC218\uC9D1 \uD6C4 \uD655\uC778 \uAC00\uB2A5\uD569\uB2C8\uB2E4.';
    html += '</div>';
    html += '</div>';
    return html;
}

// ============================================================================
// 뱃지 위계 판별 (색상 + 텍스트)
// ============================================================================

/**
 * type과 command를 분석하여 뱃지의 CSS 클래스와 표시 텍스트를 반환합니다.
 *
 * 위계 (낮은 → 높은):
 *   예비 < 주의보 < 경보 < 태풍주의보 < 태풍경보
 *
 * @param {string} type - 예: "풍랑예비특보", "풍랑주의보", "풍랑경보", "태풍주의보", "태풍경보"
 * @param {string} command - 예: "예비", "발표", "변경", "해제", "연장", "보강"
 * @returns {{ cssClass: string, text: string }}
 */
function getSeverityBadge(type, command) {
    var typeStr = type || '';
    var cmd = command || '';

    // 해제는 별도 처리
    if (cmd === '해제') {
        return {
            cssClass: 'lv-release',
            text: normalizeTypeText(typeStr, cmd)
        };
    }

    // 예비 명령이거나 "예비특보" 포함
    if (cmd === '예비' || typeStr.includes('예비특보')) {
        return {
            cssClass: 'lv-preliminary',
            text: normalizeTypeText(typeStr, cmd)
        };
    }

    var isTyphoon = typeStr.includes('태풍');
    var isWarning = typeStr.includes('경보');
    var isAdvisory = typeStr.includes('주의보');

    if (isTyphoon && isWarning) {
        return { cssClass: 'lv-typhoon-warning', text: normalizeTypeText(typeStr, cmd) };
    }
    if (isTyphoon && isAdvisory) {
        return { cssClass: 'lv-typhoon-advisory', text: normalizeTypeText(typeStr, cmd) };
    }
    if (isWarning) {
        return { cssClass: 'lv-warning', text: normalizeTypeText(typeStr, cmd) };
    }
    if (isAdvisory) {
        return { cssClass: 'lv-advisory', text: normalizeTypeText(typeStr, cmd) };
    }

    // 기본: 주의보 수준
    return { cssClass: 'lv-advisory', text: normalizeTypeText(typeStr, cmd) };
}

/**
 * type과 command를 자연스러운 뱃지 텍스트로 변환합니다.
 *
 * 변환 규칙:
 * - "풍랑예비특보" + "예비" → "풍랑 예비"
 * - "풍랑주의보" + "발표" → "풍랑주의보 발표"
 * - "풍랑경보" + "변경" → "풍랑경보 변경"
 * - "태풍주의보" + "발표" → "태풍주의보 발표"
 *
 * @param {string} type
 * @param {string} command
 * @returns {string}
 */
function normalizeTypeText(type, command) {
    var typeStr = type || '';
    var cmd = command || '';

    // "예비특보" → "예비"로 변환 (예: "풍랑예비특보" → "풍랑 예비")
    if (typeStr.includes('예비특보')) {
        var baseType = typeStr.replace('예비특보', '').trim();
        return baseType + ' 예비';
    }

    // 일반적인 경우: "type command"
    if (cmd) {
        return typeStr + ' ' + cmd;
    }
    return typeStr;
}

// ============================================================================
// 통보문 제목 포맷팅
// ============================================================================

/**
 * 통보문 제목을 "[특보] 제XX-XXX호 : YYYY.MM.DD.HH:MM" 형식으로 반환합니다.
 *
 * entry.title이 있으면 KMA 원본 제목에서 "/" 이전 텍스트만 사용합니다.
 * 예: "[특보] 제02-222호 : 2026.02.24.22:30 / 풍랑경보 변경·풍랑주의보 발표"
 *   → "[특보] 제02-222호 : 2026.02.24.22:30"
 *
 * entry.title이 없으면 reportId + time으로 fallback합니다.
 *
 * @param {Object} entry - history 항목
 * @returns {string}
 */
function formatBulletinTitle(entry) {
    if (entry.title) {
        var slashIdx = entry.title.indexOf('/');
        if (slashIdx > 0) {
            return entry.title.substring(0, slashIdx).trim();
        }
        return entry.title.trim();
    }

    // fallback: reportId + time으로 구성
    var idStr = formatReportId(entry.reportId);
    var timeStr = formatHistoryTime(entry.time);
    if (timeStr) {
        return idStr + ' : ' + timeStr;
    }
    return idStr;
}

/**
 * reportId를 "제YYYYMMDD-HHMM호" 형식으로 변환합니다.
 * 예: "met:202602162000:141" → "[특보] 제20260216-2000호"
 */
function formatReportId(reportId) {
    if (!reportId) return '통보문 번호 없음';

    var parts = reportId.split(':');
    if (parts.length >= 2) {
        var ts = parts[1];
        if (ts && ts.length >= 12) {
            return '[특보] 제' + ts.substring(0, 8) + '-' + ts.substring(8, 12) + '호';
        }
    }
    return reportId;
}

/**
 * 기상청 시간 문자열을 짧은 형식으로 변환합니다.
 * 예: "2026년 02월 16일 20시 00분" → "2026.02.16.20:00"
 */
function formatHistoryTime(timeStr) {
    if (!timeStr) return '';

    var match = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
    if (match) {
        return match[1] + '.' + match[2] + '.' + match[3] + '.' + match[4] + ':' + match[5];
    }

    var rangeMatch = timeStr.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(.*)/);
    if (rangeMatch) {
        return rangeMatch[1] + '.' + rangeMatch[2] + '.' + rangeMatch[3] + '. ' + rangeMatch[4].trim();
    }

    return timeStr;
}

/**
 * HTML 특수문자를 이스케이프합니다.
 */
function escapeHtml(str) {
    if (!str) return '';
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
