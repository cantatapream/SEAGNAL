/**
 * ============================================================================
 * 파일명: js/admin_collect.js
 * 역할: 특보 수집 테스트, 결과 팝업, 방문자 통계 차트
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : admin.js(관리자 토큰/showUnifiedAdminModal), Chart.js(CDN — 방문자 통계 차트)
 *  - 서버 API      : /api/admin/report-collect·forecast-collect·crawl-status·crawl-toggle·collect-failures·processed-reports·storage-usage, /api/stats/visitors(/csv)·usage(/csv/image), /api/boards, /api/promo, /api/weather-alerts
 *  - 마크업        : index2.html #api-management-modal, #atm-content, #alert-test-modal-overlay, #atm-* (수집 테스트 모달 요소)
 *  - 나를 쓰는 곳  : admin.js (관리자 센터에서 showCollectTestModal/renderVisitorChart 호출) — 또한 window.showAlertManagementModal 을 여기서 재정의
 * ============================================================================
 *
 * [설명]
 * - showCollectTestModal(): 수집 테스트 모달
 * - renderVisitorChart(): Chart.js 방문자 통계 차트
 * - 통보문 AI 분석 결과 표시
 * - 수집 실패 관리
 *
 * [로딩 순서] 14번째 (admin.js 이후)
 * ============================================================================
 */

// ============================================================================
// 관리자 테스트 모드 헬퍼
// ============================================================================
window._atmTestMode = false; // 모달 내 테스트 모드 토글 상태

function isAdminTestMode() {
    return window._atmTestMode === true;
}
/**
 * 푸시 알림 인증 토큰을 localStorage 에서 조회.
 * 관리자 API 요청의 Authorization 헤더 또는 쿼리 파라미터에 사용.
 */
function getAdminToken() {
    return localStorage.getItem('push_token') || null;
}
/**
 * 관리자 테스트 모드(_atmTestMode) 가 켜져 있을 때만 적용할 추가 query
 * 파라미터를 반환. 일반 모드에서는 빈 객체.
 * fetch URL 쿼리에 spread 로 합쳐 사용.
 */
function getTestModeParams() {
    if (!isAdminTestMode()) return {};
    return { testMode: true, adminToken: getAdminToken() };
}

// ============================================================================
// [특보 수집 테스트] 팝업 모달
// ============================================================================

window.openAlertTestModal = function () {
    const existing = document.getElementById('alert-test-modal-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'alert-test-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML = `
        <div style="background:#1e293b;border-radius:16px;width:95%;max-width:900px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <h3 style="margin:0;color:#fff;font-size:1.1rem;"><i class="fa-solid fa-flask" style="color:#8b5cf6;"></i> 특보 수집 테스트</h3>
                    <label id="atm-testmode-toggle-wrap" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:4px 10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.1);border-radius:20px;user-select:none;" title="ON: 사용자 영향 없이 관리자 앱으로만 테스트">
                        <span style="color:#94a3b8;font-size:0.7rem;font-weight:600;">테스트</span>
                        <div style="position:relative;width:32px;height:18px;">
                            <input type="checkbox" id="atm-testmode-cb" style="opacity:0;width:0;height:0;position:absolute;" />
                            <div id="atm-testmode-track" style="position:absolute;inset:0;background:#475569;border-radius:9px;transition:background 0.2s;"></div>
                            <div id="atm-testmode-thumb" style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                        </div>
                        <span id="atm-testmode-label" style="color:#94a3b8;font-size:0.68rem;font-weight:700;min-width:22px;">OFF</span>
                    </label>
                </div>
                <button onclick="this.closest('#alert-test-modal-overlay').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <button id="atm-tab-status" onclick="switchAlertTestTab('status')" class="atm-tab" style="flex:1;padding:12px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid #6366f1;">
                    <i class="fa-solid fa-database"></i> 수집 현황
                </button>
                <button id="atm-tab-collect" onclick="switchAlertTestTab('collect')" class="atm-tab" style="flex:1;padding:12px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;">
                    <i class="fa-solid fa-download"></i> 통보문 수집
                </button>
                <button id="atm-tab-forecast" onclick="switchAlertTestTab('forecast')" class="atm-tab" style="flex:1;padding:12px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;">
                    <i class="fa-solid fa-water"></i> 전망 수집
                </button>
            </div>
            <div id="atm-content" style="flex:1;overflow-y:auto;padding:20px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);

    // 테스트 모드 토글 이벤트
    const testToggleWrap = document.getElementById('atm-testmode-toggle-wrap');
    if (testToggleWrap) {
        // 초기 상태 반영
        const cb = document.getElementById('atm-testmode-cb');
        cb.checked = window._atmTestMode;
        if (window._atmTestMode) {
            document.getElementById('atm-testmode-track').style.background = '#8b5cf6';
            document.getElementById('atm-testmode-thumb').style.left = '16px';
            document.getElementById('atm-testmode-label').textContent = 'ON';
            document.getElementById('atm-testmode-label').style.color = '#c4b5fd';
            testToggleWrap.style.borderColor = 'rgba(139,92,246,0.4)';
            testToggleWrap.style.background = 'rgba(139,92,246,0.12)';
        }

        testToggleWrap.addEventListener('click', function () {
            const cb = document.getElementById('atm-testmode-cb');
            const track = document.getElementById('atm-testmode-track');
            const thumb = document.getElementById('atm-testmode-thumb');
            const label = document.getElementById('atm-testmode-label');
            cb.checked = !cb.checked;
            window._atmTestMode = cb.checked;
            if (cb.checked) {
                track.style.background = '#8b5cf6';
                thumb.style.left = '16px';
                label.textContent = 'ON';
                label.style.color = '#c4b5fd';
                testToggleWrap.style.borderColor = 'rgba(139,92,246,0.4)';
                testToggleWrap.style.background = 'rgba(139,92,246,0.12)';
            } else {
                track.style.background = '#475569';
                thumb.style.left = '2px';
                label.textContent = 'OFF';
                label.style.color = '#94a3b8';
                testToggleWrap.style.borderColor = 'rgba(255,255,255,0.1)';
                testToggleWrap.style.background = 'rgba(0,0,0,0.25)';
                // OFF 시 테스트 장부 정리
                fetch('/api/admin/test-cleanup', { method: 'POST' }).catch(() => {});
            }
            // 현재 탭 새로고침
            const activeTab = document.querySelector('.atm-tab[style*="border-bottom: 2px solid rgb(99, 102, 241)"]') ||
                              document.querySelector('.atm-tab[style*="border-bottom:2px solid #6366f1"]');
            if (activeTab) {
                const tabId = activeTab.id.replace('atm-tab-', '');
                switchAlertTestTab(tabId);
            } else {
                switchAlertTestTab('status');
            }
        });
    }

    switchAlertTestTab('status');
};

window.switchAlertTestTab = function (tabId) {
    ['status', 'collect', 'forecast'].forEach(id => {
        const btn = document.getElementById('atm-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const content = document.getElementById('atm-content');
    if (tabId === 'status') renderATMStatus(content);
    else if (tabId === 'collect') renderATMCollect(content);
    else if (tabId === 'forecast') renderATMForecast(content);
};

// --- [수집 현황] 탭 ---
async function renderATMStatus(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;">로딩 중...</div>';
    try {
        const inTestMode = isAdminTestMode();
        const alertsUrl = inTestMode ? '/api/admin/test-alerts' : '/api/weather-alerts';
        const [alertsRes, crawlRes] = await Promise.all([
            fetch(alertsUrl).then(r => r.json()),
            fetch('/api/admin/crawl-status').then(r => r.json())
        ]);
        const isPaused = crawlRes.paused;
        // 테스트 모드에서 테스트 장부가 없으면 운영 장부 표시
        const displayData = (inTestMode && !alertsRes) ? (await fetch('/api/weather-alerts').then(r => r.json())) : alertsRes;

        const testBanner = inTestMode ? `
            <div style="background:rgba(139,92,246,0.15);border:1px solid rgba(139,92,246,0.3);border-radius:8px;padding:10px 14px;margin-bottom:12px;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-flask" style="color:#a78bfa;"></i>
                <span style="color:#c4b5fd;font-size:0.8rem;font-weight:600;">관리자 테스트 모드</span>
                <span style="color:#94a3b8;font-size:0.75rem;">초기화/수집 시 사용자에게 영향 없이 관리자 앱으로만 알림이 발송됩니다.</span>
            </div>` : '';

        container.innerHTML = `
            ${testBanner}
            <div style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;">
                <button onclick="atmReset()" style="padding:8px 16px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid fa-trash-can"></i> 초기화
                </button>
                <button id="atm-crawl-toggle" onclick="atmCrawlToggle()" style="padding:8px 16px;background:linear-gradient(135deg,${isPaused ? '#22c55e,#16a34a' : '#f59e0b,#d97706'});color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid ${isPaused ? 'fa-play' : 'fa-pause'}"></i> ${isPaused ? '크롤링 시작' : '크롤링 정지'}
                </button>
                <button onclick="renderATMStatus(document.getElementById('atm-content'))" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:#94a3b8;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">
                    <i class="fa-solid fa-refresh"></i> 새로고침
                </button>
                <select id="atm-children-window-hours" title="자식해역 리셋 후 푸시 발송 시간 필터 (1회용)" style="padding:8px 10px;background:rgba(15,23,42,0.6);color:#e2e8f0;border:1px solid rgba(255,255,255,0.15);border-radius:8px;cursor:pointer;font-size:0.85rem;">
                    <option value="0">윈도우 0h (푸시 없음)</option>
                    <option value="6">윈도우 6h</option>
                    <option value="12" selected>윈도우 12h (기본)</option>
                    <option value="18">윈도우 18h</option>
                    <option value="24">윈도우 24h</option>
                    <option value="30">윈도우 30h</option>
                    <option value="36">윈도우 36h</option>
                    <option value="42">윈도우 42h</option>
                    <option value="48">윈도우 48h</option>
                    <option value="54">윈도우 54h</option>
                    <option value="60">윈도우 60h</option>
                    <option value="66">윈도우 66h</option>
                    <option value="72">윈도우 72h</option>
                </select>
                <button onclick="atmResetChildren()" title="부모 current/upcoming/history 보존, 자식 children 만 null 로 리셋. 다음 1분 사이클에 종합기상 텍스트로 재마킹되며 선택한 시간 윈도우 안 발표분만 푸시 발송." style="padding:8px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid fa-water"></i> 자식해역 리셋
                </button>
            </div>
            <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:16px;overflow:auto;max-height:55vh;">
                <pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;">${JSON.stringify(displayData, null, 2)}</pre>
            </div>`;
    } catch (e) { container.innerHTML = '<div style="color:#ef4444;padding:20px;">오류: ' + e.message + '</div>'; }
}

window.atmReset = async function () {
    const testParams = getTestModeParams();
    const confirmMsg = testParams.testMode
        ? '테스트 장부를 초기화하시겠습니까?\n(관리자 테스트 모드: 사용자에게 영향 없음)'
        : '특보 장부를 초기화하시겠습니까?\n모든 수집 데이터가 삭제됩니다.';
    if (!confirm(confirmMsg)) return;
    try {
        const res = await fetch('/api/admin/alerts-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testParams)
        });
        const data = await res.json();
        alert(data.message || '초기화 완료');
        renderATMStatus(document.getElementById('atm-content'));
    } catch (e) { alert('초기화 실패: ' + e.message); }
};

window.atmCrawlToggle = async function () {
    try {
        await fetch('/api/admin/crawl-toggle', { method: 'POST' });
        renderATMStatus(document.getElementById('atm-content'));
    } catch (e) { alert('상태 변경 실패: ' + e.message); }
};

// 자식 해역 장부만 리셋 — V2 종합기상 텍스트 발표 푸시 검증용
// 부모 current/upcoming/history 보존 → 부모 푸시 시스템 무영향
// 자식 children 만 null → 다음 1분 사이클에 종합기상 'Y' 재마킹 → V2 시간 필터 통과 자식 push 발송
window.atmResetChildren = async function () {
    const testParams = getTestModeParams();
    // 드롭다운 선택값 — 0 ~ 72, 6 배수. 미선택 시 12 기본.
    const dropdown = document.getElementById('atm-children-window-hours');
    const windowHours = dropdown ? parseInt(dropdown.value, 10) : 12;
    const windowLabel = windowHours === 0
        ? '0h (푸시 발송 없음 — 자식 리셋만 수행)'
        : `${windowHours}h (최근 ${windowHours}시간 안 발표된 자식만 푸시)`;
    const confirmMsg = testParams.testMode
        ? `테스트 자식 해역 장부를 초기화하시겠습니까?\n시간 윈도우: ${windowLabel}\n(관리자 테스트 모드: 사용자에게 영향 없음)`
        : `자식 해역 장부만 초기화하시겠습니까?\n\n• 시간 윈도우: ${windowLabel}\n• 부모 current/upcoming/history 보존 → 부모 푸시 영향 없음\n• 자식 children 만 null 로 리셋\n• 다음 1분 사이클에 종합기상 텍스트로 자동 재마킹\n• 선택한 윈도우 안 발표분만 관리자 푸시 발송 (1회용)`;
    if (!confirm(confirmMsg)) return;
    try {
        const res = await fetch('/api/admin/children-reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...testParams, windowHours })
        });
        const data = await res.json();
        if (data.success === false) {
            alert('자식 해역 리셋 실패: ' + (data.error || '알 수 없는 오류'));
            return;
        }
        alert(data.message || '자식 해역 리셋 완료');
        renderATMStatus(document.getElementById('atm-content'));
    } catch (e) { alert('자식 해역 리셋 실패: ' + e.message); }
};

// --- [통보문 수집] 탭 ---
function renderATMCollect(container) {
    const today = new Date().toISOString().substring(0, 10);
    container.innerHTML = `
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">
            <input type="date" id="atm-date-input" value="${today}" style="padding:8px 12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:8px;color:#fff;font-size:0.9rem;" />
            <button onclick="atmFetchReports()" style="padding:8px 16px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                <i class="fa-solid fa-search"></i> 조회
            </button>
            <button id="atm-collect-all-btn" onclick="atmCollectAll()" style="display:none;padding:8px 16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                <i class="fa-solid fa-download"></i> 모두 수집
            </button>
            <label id="atm-push-toggle-wrap" style="display:none;align-items:center;gap:6px;cursor:pointer;padding:6px 12px;background:rgba(0,0,0,0.2);border:1px solid rgba(255,255,255,0.15);border-radius:8px;user-select:none;">
                <span style="color:#94a3b8;font-size:0.78rem;font-weight:600;">푸시 알림</span>
                <div style="position:relative;width:36px;height:20px;">
                    <input type="checkbox" id="atm-push-toggle" checked style="opacity:0;width:0;height:0;position:absolute;" />
                    <div id="atm-push-track" style="position:absolute;inset:0;background:#22c55e;border-radius:10px;transition:background 0.2s;"></div>
                    <div id="atm-push-thumb" style="position:absolute;top:2px;left:18px;width:16px;height:16px;background:#fff;border-radius:50%;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></div>
                </div>
                <span id="atm-push-label" style="color:#86efac;font-size:0.75rem;font-weight:700;min-width:24px;">ON</span>
            </label>
        </div>
        <div style="display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap;padding:10px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:8px;">
            <div style="display:flex;align-items:center;gap:6px;">
                <i class="fa-solid fa-clock" style="color:#a5b4fc;font-size:0.8rem;"></i>
                <span style="color:#a5b4fc;font-size:0.8rem;font-weight:600;">기준시각</span>
            </div>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="radio" name="atm-ref-mode" value="auto" checked onchange="document.getElementById('atm-ref-custom').style.display='none';" style="accent-color:#6366f1;" />
                <span style="color:#e2e8f0;font-size:0.8rem;">통보문 발표시각 기준</span>
            </label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="radio" name="atm-ref-mode" value="now" onchange="document.getElementById('atm-ref-custom').style.display='none';" style="accent-color:#6366f1;" />
                <span style="color:#e2e8f0;font-size:0.8rem;">현재시각 기준</span>
            </label>
            <label style="display:flex;align-items:center;gap:4px;cursor:pointer;">
                <input type="radio" name="atm-ref-mode" value="custom" onchange="document.getElementById('atm-ref-custom').style.display='flex';" style="accent-color:#6366f1;" />
                <span style="color:#e2e8f0;font-size:0.8rem;">직접 설정</span>
            </label>
            <input type="datetime-local" id="atm-ref-custom" style="display:none;padding:6px 10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#fff;font-size:0.8rem;" />
            <div style="width:100%;font-size:0.7rem;color:#64748b;margin-top:2px;">
                <i class="fa-solid fa-circle-info"></i> "통보문 발표시각 기준": 각 통보문의 발표시각을 now로 사용하여 과거 특보의 생애주기를 정확히 재현합니다.
            </div>
        </div>
        <div id="atm-progress" style="display:none;margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                <span id="atm-progress-text" style="color:#a5b4fc;font-size:0.85rem;">0/0건 처리 중...</span>
                <span id="atm-progress-pct" style="color:#94a3b8;font-size:0.85rem;">0%</span>
            </div>
            <div style="background:rgba(0,0,0,0.3);border-radius:4px;height:6px;overflow:hidden;">
                <div id="atm-progress-bar" style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:100%;width:0%;transition:width 0.3s;border-radius:4px;"></div>
            </div>
        </div>
        <div id="atm-report-list" style="color:#94a3b8;font-size:0.9rem;">날짜를 선택하고 [조회] 버튼을 눌러주세요.</div>
        <div id="atm-forecast-list" style="margin-top:16px;"></div>`;

    // 푸시 알림 토글 이벤트 바인딩
    const pushToggleWrap = document.getElementById('atm-push-toggle-wrap');
    if (pushToggleWrap) {
        pushToggleWrap.addEventListener('click', function () {
            const cb = document.getElementById('atm-push-toggle');
            const track = document.getElementById('atm-push-track');
            const thumb = document.getElementById('atm-push-thumb');
            const label = document.getElementById('atm-push-label');
            cb.checked = !cb.checked;
            if (cb.checked) {
                track.style.background = '#22c55e';
                thumb.style.left = '18px';
                label.textContent = 'ON';
                label.style.color = '#86efac';
            } else {
                track.style.background = '#475569';
                thumb.style.left = '2px';
                label.textContent = 'OFF';
                label.style.color = '#94a3b8';
            }
        });
    }
}

window._atmResults = {};
window._atmReports = [];

window.atmFetchReports = async function () {
    const date = document.getElementById('atm-date-input').value;
    if (!date) return alert('날짜를 선택해주세요.');
    const listEl = document.getElementById('atm-report-list');
    listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">통보문 목록을 불러오는 중...</div>';
    try {
        // 통보문 목록과 이미 처리된 reportId 목록을 동시에 조회
        const [reportsRes, processedRes] = await Promise.all([
            fetch('/api/admin/reports?date=' + date),
            fetch('/api/admin/processed-reports').catch(() => ({ ok: false }))
        ]);
        const data = await reportsRes.json();
        let processedIds = new Set();
        let failedIds = new Set();
        try {
            if (processedRes.ok) {
                const processedData = await processedRes.json();
                processedIds = new Set(processedData.processedIds || []);
                failedIds = new Set(processedData.failedIds || []);
            }
        } catch (e) { /* processed-reports 실패해도 통보문 목록은 정상 표시 */ }

        if (data.count === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">해당 날짜에 [특보]/[예비] 통보문이 없습니다.</div>';
            document.getElementById('atm-collect-all-btn').style.display = 'none';
            document.getElementById('atm-push-toggle-wrap').style.display = 'none';
            // 전망 목록도 초기화
            const forecastContainer = document.getElementById('atm-forecast-list');
            if (forecastContainer) forecastContainer.innerHTML = '';
            return;
        }
        // [특보]/[예비] 통보문과 [해설] 통보문 분리
        const alertReports = data.reports.filter(r => !r.title.includes('[해설]'));
        const forecastReports = data.reports.filter(r => r.title.includes('[해설]'));

        document.getElementById('atm-collect-all-btn').style.display = alertReports.length > 0 ? 'inline-block' : 'none';
        document.getElementById('atm-push-toggle-wrap').style.display = alertReports.length > 0 ? 'flex' : 'none';
        window._atmReports = alertReports; // 특보/예비만 (인덱스 일치)
        window._atmResults = {};

        // 전망 통보문: [해설] 통보문이 있으면 그걸 기준으로, 없으면 캐시 기반
        if (forecastReports.length > 0) {
            window._atmForecastReports = forecastReports;
            atmRenderForecastReports(forecastReports);
        } else {
            atmLoadForecastList();
        }

        if (alertReports.length === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">해당 날짜에 [특보]/[예비] 통보문이 없습니다.</div>';
            if (forecastReports.length === 0) {
                document.getElementById('atm-collect-all-btn').style.display = 'none';
                document.getElementById('atm-push-toggle-wrap').style.display = 'none';
            }
            return;
        }

        listEl.innerHTML = alertReports.map((r, i) => {
            const isProcessed = processedIds.has(r.id);
            const isFailed = failedIds.has(r.id);
            if (isProcessed && isFailed) {
                // 수집했으나 AI 분석 실패: [분석실패] 뱃지 + [결과] [재수집]
                return `
                <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(239,68,68,0.08);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;border-left:3px solid #ef4444;">
                    <span style="background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;flex-shrink:0;"><i class="fa-solid fa-triangle-exclamation"></i> 분석실패</span>
                    <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                    <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button id="atm-cb-${i}" onclick="atmCollectOne(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;"><i class="fa-solid fa-rotate"></i> 재수집</button>
                        <button id="atm-rb-${i}" onclick="atmShowCachedResult(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                    </div>
                </div>`;
            } else if (isProcessed) {
                // 이미 수집된 통보문: [완료] [결과] [재수집]
                return `
                <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                    <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button id="atm-cb-${i}" disabled style="padding:5px 12px;background:rgba(34,197,94,0.3);color:#86efac;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:default;"><i class="fa-solid fa-check"></i> 완료</button>
                        <button id="atm-rb-${i}" onclick="atmShowCachedResult(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                        <button onclick="atmCollectOne(${i})" style="padding:5px 10px;background:rgba(255,255,255,0.08);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:600;" title="AI를 다시 사용하여 재수집"><i class="fa-solid fa-rotate"></i> 재수집</button>
                    </div>
                </div>`;
            } else if (isFailed) {
                // 수집 실패한 통보문 (history에는 없지만 실패 기록만 있음)
                return `
                <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(239,68,68,0.08);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;border-left:3px solid #ef4444;">
                    <span style="background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;flex-shrink:0;"><i class="fa-solid fa-triangle-exclamation"></i> 분석실패</span>
                    <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                    <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button id="atm-cb-${i}" onclick="atmCollectOne(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;"><i class="fa-solid fa-rotate"></i> 재수집</button>
                        <button id="atm-rb-${i}" onclick="atmShowResult(${i})" style="display:none;padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                    </div>
                </div>`;
            } else {
                // 미수집 통보문: 기존 [수집] 버튼
                return `
                <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                    <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                    <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                    <div style="display:flex;gap:6px;flex-shrink:0;">
                        <button id="atm-cb-${i}" onclick="atmCollectOne(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">수집</button>
                        <button id="atm-rb-${i}" onclick="atmShowResult(${i})" style="display:none;padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                    </div>
                </div>`;
            }
        }).join('');
    } catch (e) { listEl.innerHTML = '<div style="color:#ef4444;padding:20px;">오류: ' + e.message + '</div>'; }
};

// 기준시각 계산 헬퍼
window.getAtmReferenceTime = function (reportId) {
    const mode = document.querySelector('input[name="atm-ref-mode"]:checked');
    if (!mode) return null;
    if (mode.value === 'now') return null; // null = 서버에서 new Date() 사용
    if (mode.value === 'custom') {
        const val = document.getElementById('atm-ref-custom').value;
        return val ? new Date(val).toISOString() : null;
    }
    // 'auto': reportId에서 발표시각 추출하여 사용
    if (reportId) {
        const parts = reportId.split(':');
        if (parts.length >= 2 && parts[1].length >= 12) {
            const ts = parts[1];
            return new Date(`${ts.substring(0,4)}-${ts.substring(4,6)}-${ts.substring(6,8)}T${ts.substring(8,10)}:${ts.substring(10,12)}:00+09:00`).toISOString();
        }
    }
    return null;
};

window.atmCollectOne = async function (i, refTimeOverride) {
    const MAX_RETRIES = 5;
    const report = window._atmReports[i];
    const btn = document.getElementById('atm-cb-' + i);
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 수집 중'; btn.style.background = 'rgba(255,255,255,0.1)';

    const referenceTime = refTimeOverride !== undefined ? refTimeOverride : getAtmReferenceTime(report.id);
    const pushToggle = document.getElementById('atm-push-toggle');
    const skipPush = pushToggle ? !pushToggle.checked : false;

    let lastData = null;
    let lastOk = false;
    let attempt = 0;

    for (attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        if (attempt > 1) {
            btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 재시도 ${attempt}/${MAX_RETRIES}`;
            btn.style.background = 'rgba(245,158,11,0.15)';
            // 재시도 간 1.5초 대기
            await new Promise(r => setTimeout(r, 1500));
        }
        try {
            const res = await fetch('/api/admin/report-collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: report.id, title: report.title, referenceTime, skipPush, ...getTestModeParams() }) });
            lastOk = res.ok;
            lastData = await res.json();
        } catch (e) {
            lastData = { success: false, aiError: e.message, aiResult: [], foundKeywords: [] };
            lastOk = false;
        }

        // AI 분석 성공 판별: 키워드가 있는데 aiResult가 빈 배열이거나 aiError가 있으면 실패
        const hasKeywords = lastData.foundKeywords && lastData.foundKeywords.length > 0;
        const aiAnalysisFailed = hasKeywords && (lastData.aiError || !lastData.aiResult || lastData.aiResult.length === 0);
        const isServerError = !lastOk || lastData.success === false;

        if (!aiAnalysisFailed && !isServerError) break; // 성공 → 루프 종료
        if (attempt === MAX_RETRIES) break; // 마지막 시도 → 루프 종료
    }

    window._atmResults[i] = lastData;
    document.getElementById('atm-rb-' + i).style.display = 'inline-block';

    // 최종 결과 판별
    const hasKeywords = lastData.foundKeywords && lastData.foundKeywords.length > 0;
    const aiStillFailed = hasKeywords && (lastData.aiError || !lastData.aiResult || lastData.aiResult.length === 0);
    const serverError = !lastOk || lastData.success === false;

    if (serverError) {
        btn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> 에러'; btn.style.background = 'rgba(245,158,11,0.3)'; btn.style.color = '#fcd34d';
    } else if (aiStillFailed) {
        btn.innerHTML = `<i class="fa-solid fa-xmark"></i> AI실패(${attempt}회)`; btn.style.background = 'rgba(239,68,68,0.3)'; btn.style.color = '#fca5a5';
        // 서버에 실패 기록 저장
        try {
            await fetch('/api/admin/collect-failures', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reportId: report.id, title: report.title, error: lastData.aiError || 'AI 분석 결과 없음', retriesUsed: attempt })
            });
        } catch (e) { /* 무시 */ }
        // [제거됨] 방문자 카운터 빨간색 표시는 관리자 배너 + FCM 푸시로 대체
    } else {
        btn.innerHTML = attempt > 1
            ? `<i class="fa-solid fa-check"></i> 완료(${attempt}회)`
            : '<i class="fa-solid fa-check"></i> 완료';
        btn.style.background = 'rgba(34,197,94,0.3)'; btn.style.color = '#86efac';
    }
};

// --- [해설] 통보문(전망)을 전망 영역에 렌더링 ---
window.atmRenderForecastReports = async function (forecastReports) {
    const container = document.getElementById('atm-forecast-list');
    if (!container) return;

    // 이미 캐시에 있는 reportId 조회
    let cachedIds = new Set();
    try {
        const cacheList = await fetch(CONFIG.API_BASE + '/api/forecast-cache/list').then(r => r.json());
        cachedIds = new Set((cacheList || []).map(c => c.reportId));
    } catch (e) { /* 무시 */ }

    // 현재 표출 중인 전망 reportId
    let activeIds = new Set();
    try {
        const marineFcst = await fetch(CONFIG.API_BASE + '/api/marine-forecast').then(r => r.ok ? r.json() : null);
        if (marineFcst) {
            if (marineFcst.ultraShort && marineFcst.ultraShort.reportId) activeIds.add(marineFcst.ultraShort.reportId);
            if (marineFcst.shortTerm && marineFcst.shortTerm.reportId) activeIds.add(marineFcst.shortTerm.reportId);
        }
    } catch (e) { /* 무시 */ }

    let html = `<div style="font-weight:700;color:#e2e8f0;font-size:0.9rem;margin-bottom:10px;"><i class="fa-solid fa-water" style="color:#94a3b8;"></i> 해상 기상 전망 (${forecastReports.length}건)</div>`;
    forecastReports.forEach((r, i) => {
        const isCached = cachedIds.has(r.id);
        const isActive = activeIds.has(r.id);
        const activeBadge = isActive
            ? '<span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;flex-shrink:0;border:1px solid rgba(34,197,94,0.3);"><i class="fa-solid fa-tower-broadcast"></i> 표출 중</span>'
            : '';

        if (isCached) {
            html += `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                ${activeBadge}
                <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button disabled style="padding:5px 12px;background:rgba(34,197,94,0.3);color:#86efac;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:default;"><i class="fa-solid fa-check"></i> 완료</button>
                    <button onclick="atmShowForecastResult('${encodeURIComponent(r.id)}')" style="padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                    <button onclick="atmCollectForecast('${encodeURIComponent(r.id)}','${encodeURIComponent(r.title)}',this)" style="padding:5px 10px;background:rgba(255,255,255,0.08);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:600;"><i class="fa-solid fa-rotate"></i> 재수집</button>
                </div>
            </div>`;
        } else {
            html += `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                ${activeBadge}
                <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button onclick="atmCollectForecast('${encodeURIComponent(r.id)}','${encodeURIComponent(r.title)}',this)" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">수집</button>
                </div>
            </div>`;
        }
    });
    container.innerHTML = html;
};

// 개별 전망 통보문 수집
window.atmCollectForecast = async function (encodedId, encodedTitle, btn) {
    const reportId = decodeURIComponent(encodedId);
    const title = decodeURIComponent(encodedTitle);
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 수집 중';
    btn.style.background = 'rgba(255,255,255,0.1)';
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/admin/forecast-collect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportId, title })
        });
        const data = await res.json();
        if (data.success) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료';
            btn.style.background = 'rgba(34,197,94,0.3)';
            btn.style.color = '#86efac';
            // 전망 리스트 새로고침
            if (window._atmForecastReports) {
                atmRenderForecastReports(window._atmForecastReports);
            }
        } else {
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 실패';
            btn.style.background = 'rgba(239,68,68,0.3)';
            btn.style.color = '#fca5a5';
        }
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 오류';
        btn.style.background = 'rgba(239,68,68,0.3)';
        btn.style.color = '#fca5a5';
    }
};

// --- 전망 통보문 리스트 (통보문 수집 탭 내) ---
window.atmLoadForecastList = async function () {
    const container = document.getElementById('atm-forecast-list');
    if (!container) return;
    const selectedDate = document.getElementById('atm-date-input').value; // YYYY-MM-DD
    if (!selectedDate) { container.innerHTML = ''; return; }
    container.innerHTML = '<div style="text-align:center;padding:10px;color:#64748b;font-size:0.8rem;"><i class="fa-solid fa-spinner fa-spin"></i> 전망 목록 로딩 중...</div>';
    try {
        const [cacheList, marineFcst] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/forecast-cache/list').then(r => r.json()),
            fetch(CONFIG.API_BASE + '/api/marine-forecast').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);
        // 현재 인덱스 페이지에 표출 중인 전망 reportId
        const activeIds = new Set();
        if (marineFcst) {
            if (marineFcst.ultraShort && marineFcst.ultraShort.reportId) activeIds.add(marineFcst.ultraShort.reportId);
            if (marineFcst.shortTerm && marineFcst.shortTerm.reportId) activeIds.add(marineFcst.shortTerm.reportId);
        }
        // 선택된 날짜로 필터링 (publishTime: "MM.DD. HH:MM" 또는 reportId에서 날짜 추출)
        const dateParts = selectedDate.split('-'); // ['2026','03','01']
        const mm = dateParts[1]; const dd = dateParts[2];
        const datePrefix = mm + '.' + dd + '.'; // "03.01."
        const dateStr = dateParts[0] + mm + dd; // "20260301"
        const filtered = (cacheList || []).filter(item => {
            if (item.publishTime && item.publishTime.startsWith(datePrefix)) return true;
            if (item.reportId && item.reportId.includes(dateStr)) return true;
            return false;
        });
        if (filtered.length === 0) {
            container.innerHTML = '';
            return;
        }
        let html = `<div style="font-weight:700;color:#e2e8f0;font-size:0.9rem;margin-bottom:10px;"><i class="fa-solid fa-water" style="color:#94a3b8;"></i> 해상 기상 전망 (${filtered.length}건)</div>`;
        filtered.forEach((item, i) => {
            const isActive = activeIds.has(item.reportId);
            const activeBadge = isActive
                ? '<span style="background:rgba(34,197,94,0.15);color:#4ade80;padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;flex-shrink:0;border:1px solid rgba(34,197,94,0.3);"><i class="fa-solid fa-tower-broadcast"></i> 표출 중</span>'
                : '';
            html += `
            <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                ${activeBadge}
                <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${item.title || item.reportId}</span>
                <span style="color:#64748b;font-size:0.7rem;">${item.publishTime || ''}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button disabled style="padding:5px 12px;background:rgba(34,197,94,0.3);color:#86efac;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:default;"><i class="fa-solid fa-check"></i> 완료</button>
                    <button onclick="atmShowForecastResult('${encodeURIComponent(item.reportId)}')" style="padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                    <button onclick="atmRecollectForecast('${encodeURIComponent(item.reportId)}')" style="padding:5px 10px;background:rgba(255,255,255,0.08);color:#94a3b8;border:1px solid rgba(255,255,255,0.1);border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:600;" title="전망 재수집"><i class="fa-solid fa-rotate"></i> 재수집</button>
                </div>
            </div>`;
        });
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444;font-size:0.8rem;padding:10px;">전망 목록 로드 실패: ${e.message}</div>`;
    }
};

// 전망 재수집
window.atmRecollectForecast = async function (encodedReportId) {
    if (!confirm('해상 기상 전망을 재수집하시겠습니까?')) return;
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/marine-forecast/refresh', { method: 'POST' });
        if (res.ok) {
            alert('재수집 완료');
            atmLoadForecastList();
        } else {
            alert('재수집 실패');
        }
    } catch (e) { alert('재수집 오류: ' + e.message); }
};

// 전망 결과 모달 - AI 분석결과 / 원문 텍스트 / 구분 텍스트
window.atmShowForecastResult = async function (encodedReportId) {
    const reportId = decodeURIComponent(encodedReportId);
    const existing = document.getElementById('atm-result-popup');
    if (existing) existing.remove();

    const popup = document.createElement('div');
    popup.id = 'atm-result-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;';
    popup.onclick = (e) => { if (e.target === popup) popup.remove(); };
    popup.innerHTML = '<div style="text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i></div>';
    document.body.appendChild(popup);

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/forecast-cache/' + encodedReportId);
        if (!res.ok) throw new Error('캐시 데이터 없음');
        const data = await res.json();

        const escHtml = (s) => s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') : '';
        // 마크업 렌더링 함수 (marine_forecast.js에서 글로벌 노출)
        const renderMarkup = window.renderMarineMarkup || escHtml;

        // AI 분석 결과: 최종 카테고리 데이터 (AI 결과 우선, 없으면 코드 추출)
        let aiHtml = '';
        const displayCats = data.categories || (data.aiResult && data.aiResult.categories ? data.aiResult.categories : {});
        const EMOJI_MAP = { '강풍': '💨', '해상': '🌊', '너울': '🌊', '바다안개': '🌫️', '바다 안개': '🌫️', '안개': '🌫️' };
        const displayKeys = Object.keys(displayCats);
        if (displayKeys.length > 0) {
            aiHtml = displayKeys.map(key => {
                const val = displayCats[key];
                let mainText = '';
                let subItems = [];
                if (typeof val === 'object' && val.main !== undefined) {
                    mainText = val.main || '';
                    subItems = val.sub || [];
                } else {
                    mainText = String(val || '');
                }
                const emoji = EMOJI_MAP[key] || '📋';
                return `<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;margin-bottom:8px;border-left:3px solid #6366f1;">
                    <div style="font-weight:700;color:#fff;font-size:0.85rem;margin-bottom:6px;">${emoji} ${escHtml(key)}</div>
                    <div style="color:#e2e8f0;font-size:0.8rem;line-height:1.6;">${renderMarkup(mainText)}</div>
                    ${subItems.map(s => `<div style="color:#cbd5e1;font-size:0.78rem;padding-left:12px;margin-top:4px;line-height:1.5;">${renderMarkup(s)}</div>`).join('')}
                </div>`;
            }).join('');
        } else {
            aiHtml = '<div style="color:#94a3b8;padding:10px;">AI 분석 결과가 없습니다.</div>';
        }

        // AI 이슈
        let issuesHtml = '';
        if (data.aiResult && data.aiResult.issues && data.aiResult.issues.length > 0) {
            issuesHtml = `<div style="background:#f59e0b11;border:1px solid #f59e0b33;border-radius:8px;padding:10px;margin-bottom:12px;">
                <div style="color:#f59e0b;font-weight:700;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation"></i> AI 발견 이슈</div>
                ${data.aiResult.issues.map(i => `<div style="color:#fbbf24;font-size:0.75rem;padding:2px 0;">• ${escHtml(i)}</div>`).join('')}
            </div>`;
        }

        // 구분 텍스트: 코드 파싱 결과
        let separatedText = '';
        if (data.codeCategories) {
            const codeKeys = Object.keys(data.codeCategories);
            separatedText = codeKeys.map(key => {
                const val = data.codeCategories[key];
                const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
                return `[${key}]\n${text}`;
            }).join('\n\n');
        }

        // 원문/구분 텍스트 영역
        const preStyle = 'margin:0;color:#cbd5e1;font-size:0.7rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;';
        const boxStyle = 'background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;max-height:35vh;';
        const hasSeparated = !!separatedText;
        let textHtml = '';

        if (hasSeparated && window.innerWidth >= 700) {
            textHtml = '<div style="display:flex;gap:12px;">'
                + '<div style="flex:1;min-width:0;"><div style="color:#a5b4fc;font-weight:600;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
                + '<div style="' + boxStyle + '"><pre style="' + preStyle + '">' + escHtml(data.rawText || '(내용 없음)') + '</pre></div></div>'
                + '<div style="flex:1;min-width:0;"><div style="color:#34d399;font-weight:600;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-scissors"></i> 구분 텍스트</div>'
                + '<div style="' + boxStyle + 'border:1px solid rgba(52,211,153,0.2);"><pre style="' + preStyle + '">' + escHtml(separatedText) + '</pre></div></div>'
                + '</div>';
        } else if (hasSeparated) {
            textHtml = '<div>'
                + '<div style="display:flex;gap:4px;margin-bottom:8px;">'
                + '<button id="atr-text-btn-original" onclick="atmSwitchTextView(\'original\')" style="flex:1;padding:6px 10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-size:0.8rem;border-radius:6px;font-weight:600;"><i class="fa-solid fa-file-lines"></i> 원문</button>'
                + '<button id="atr-text-btn-separated" onclick="atmSwitchTextView(\'separated\')" style="flex:1;padding:6px 10px;background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:0.8rem;border-radius:6px;"><i class="fa-solid fa-scissors"></i> 구분</button>'
                + '</div>'
                + '<div id="atr-text-original-panel" style="' + boxStyle + '"><pre style="' + preStyle + '">' + escHtml(data.rawText || '(내용 없음)') + '</pre></div>'
                + '<div id="atr-text-separated-panel" style="display:none;' + boxStyle + 'border:1px solid rgba(52,211,153,0.2);"><pre style="' + preStyle + '">' + escHtml(separatedText) + '</pre></div>'
                + '</div>';
        } else {
            textHtml = '<div><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
                + '<div style="' + boxStyle + '"><pre style="' + preStyle + '">' + escHtml(data.rawText || '(내용 없음)') + '</pre></div></div>';
        }

        const typeTag = data.type ? `<span style="background:rgba(99,102,241,0.2);color:#a5b4fc;padding:2px 8px;border-radius:4px;font-size:0.75rem;">${escHtml(data.type)}</span>` : '';

        popup.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:750px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <h4 style="margin:0;color:#fff;font-size:0.95rem;">수집 결과</h4>${typeTag}
                </div>
                <button onclick="document.getElementById('atm-result-popup').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="font-size:0.8rem;color:#94a3b8;padding:8px 18px 0;">${escHtml(data.title || '')} (${data.publishTime || ''})</div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <button id="atr-tab-json" onclick="atmSwitchFcstResultTab('json')" style="flex:1;padding:10px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid transparent;">JSON</button>
                <button id="atr-tab-ai" onclick="atmSwitchFcstResultTab('ai')" style="flex:1;padding:10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid #6366f1;">AI 분석</button>
            </div>
            <div id="atr-content" style="flex:1;overflow-y:auto;padding:16px;">
                <div id="atr-fcst-json" style="display:none;"></div>
                <div id="atr-fcst-ai">
                    ${issuesHtml}
                    <div style="margin-bottom:16px;">
                        <div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-robot"></i> AI 분석 결과 (${displayKeys.length}건)</div>
                        ${aiHtml}
                    </div>
                    ${textHtml}
                </div>
            </div>
        </div>`;

        // JSON 데이터 준비
        const jsonData = Object.assign({}, data);
        delete jsonData.rawText;
        document.getElementById('atr-fcst-json').innerHTML = '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;"><pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;">' + JSON.stringify(jsonData, null, 2) + '</pre></div>';

        window._atmFcstResultData = data;
    } catch (e) {
        popup.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;padding:40px;text-align:center;">
            <div style="color:#ef4444;margin-bottom:10px;"><i class="fa-solid fa-exclamation-circle fa-2x"></i></div>
            <div style="color:#f87171;">${e.message}</div>
            <button onclick="document.getElementById('atm-result-popup').remove()" style="margin-top:15px;padding:8px 16px;background:#374151;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
        </div>`;
    }
};

window.atmSwitchFcstResultTab = function (tabId) {
    ['json', 'ai'].forEach(id => {
        const btn = document.getElementById('atr-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const jsonDiv = document.getElementById('atr-fcst-json');
    const aiDiv = document.getElementById('atr-fcst-ai');
    if (tabId === 'json') {
        if (jsonDiv) jsonDiv.style.display = 'block';
        if (aiDiv) aiDiv.style.display = 'none';
    } else {
        if (jsonDiv) jsonDiv.style.display = 'none';
        if (aiDiv) aiDiv.style.display = 'block';
    }
};

window.atmCollectAll = async function () {
    const reports = window._atmReports;
    if (!reports || reports.length === 0) return;
    if (!confirm(reports.length + '건의 통보문을 모두 수집하시겠습니까?')) return;
    const progressEl = document.getElementById('atm-progress');
    const pText = document.getElementById('atm-progress-text');
    const pPct = document.getElementById('atm-progress-pct');
    const pBar = document.getElementById('atm-progress-bar');
    progressEl.style.display = 'block';

    // [수정] 시간순 정렬 (오래된 것부터 처리) - reportId 타임스탬프 기준
    const sortedIndices = reports.map((_, i) => i).sort((a, b) => {
        const tsA = (reports[a].id.split(':')[1] || '').substring(0, 12);
        const tsB = (reports[b].id.split(':')[1] || '').substring(0, 12);
        return tsA.localeCompare(tsB);
    });

    // [수정] auto 모드일 때: 가장 최근(마지막) 통보문의 발표시각을 기준시각으로 통일
    const mode = document.querySelector('input[name="atm-ref-mode"]:checked');
    let autoRefTimeOverride = null;
    if (mode && mode.value === 'auto' && sortedIndices.length > 0) {
        const latestIdx = sortedIndices[sortedIndices.length - 1];
        autoRefTimeOverride = getAtmReferenceTime(reports[latestIdx].id);
    }

    for (let step = 0; step < sortedIndices.length; step++) {
        const i = sortedIndices[step];
        const pct = Math.round((step / sortedIndices.length) * 100);
        pText.textContent = (step + 1) + '/' + sortedIndices.length + '건 처리 중...';
        pPct.textContent = pct + '%'; pBar.style.width = pct + '%';
        await atmCollectOne(i, autoRefTimeOverride);
    }
    pText.textContent = reports.length + '/' + reports.length + '건 완료!';
    pPct.textContent = '100%'; pBar.style.width = '100%';
};

// --- [결과 팝업] ---
window.atmShowResult = function (i) {
    const data = window._atmResults[i];
    if (!data) return alert('수집 결과가 없습니다.');
    const old = document.getElementById('atm-result-popup');
    if (old) old.remove();

    const popup = document.createElement('div');
    popup.id = 'atm-result-popup';
    popup.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.75);z-index:10001;display:flex;align-items:center;justify-content:center;';
    popup.onclick = (e) => { if (e.target === popup) popup.remove(); };

    const appliedBadge = data.success === false
        ? '<span style="background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:0.75rem;">서버 에러</span>'
        : data.applied
            ? '<span style="background:rgba(34,197,94,0.2);color:#86efac;padding:2px 8px;border-radius:4px;font-size:0.75rem;">장부 반영됨</span>'
            : '<span style="background:rgba(245,158,11,0.2);color:#fcd34d;padding:2px 8px;border-radius:4px;font-size:0.75rem;">미반영</span>';
    const pushBadge = data.pushResult
        ? (data.pushResult.sent
            ? '<span style="background:rgba(56,189,248,0.2);color:#7dd3fc;padding:2px 8px;border-radius:4px;font-size:0.75rem;">푸시 발송(' + data.pushResult.changeCount + '건)</span>'
            : '<span style="background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 8px;border-radius:4px;font-size:0.75rem;">푸시 실패</span>')
        : (data.applied ? '<span style="background:rgba(100,116,139,0.2);color:#94a3b8;padding:2px 8px;border-radius:4px;font-size:0.75rem;">변경 없음</span>' : '');
    const kwBadges = (data.foundKeywords || []).map(kw => '<span style="background:rgba(99,102,241,0.2);color:#a5b4fc;padding:2px 6px;border-radius:4px;font-size:0.7rem;">' + kw + '</span>').join(' ');

    popup.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:750px;max-height:85vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,0.1);">
                <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                    <h4 style="margin:0;color:#fff;font-size:0.95rem;">수집 결과</h4>${appliedBadge} ${pushBadge} ${kwBadges}
                </div>
                <button onclick="document.getElementById('atm-result-popup').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="font-size:0.8rem;color:#94a3b8;padding:8px 18px 0;">${data.title || data.reportId || ''}</div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);">
                <button id="atr-tab-json" onclick="atmSwitchResultTab('json')" style="flex:1;padding:10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid #6366f1;">JSON</button>
                <button id="atr-tab-ai" onclick="atmSwitchResultTab('ai')" style="flex:1;padding:10px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.85rem;border-bottom:2px solid transparent;">AI 분석</button>
            </div>
            <div id="atr-content" style="flex:1;overflow-y:auto;padding:16px;"></div>
        </div>`;
    document.body.appendChild(popup);
    window._atmCurResult = data;
    atmSwitchResultTab('json');
};

// 이미 수집된 통보문의 캐시 결과 표시 (AI 토큰 소모 없이)
window.atmShowCachedResult = async function (i) {
    // 먼저 메모리 캐시 확인 (현재 세션에서 이미 수집한 경우)
    if (window._atmResults[i]) {
        return atmShowResult(i);
    }
    // 서버 캐시에서 조회
    const report = window._atmReports[i];
    if (!report) return alert('통보문 정보가 없습니다.');

    try {
        const res = await fetch('/api/admin/report-cache/' + encodeURIComponent(report.id));
        const result = await res.json();
        if (result.cached && result.data) {
            window._atmResults[i] = result.data;
            atmShowResult(i);
        } else {
            alert('캐시된 수집 결과가 없습니다.\n[재수집] 버튼을 눌러 다시 수집해주세요.');
        }
    } catch (e) {
        alert('결과 조회 실패: ' + e.message);
    }
};

window.atmSwitchResultTab = function (tabId) {
    ['json', 'ai'].forEach(id => {
        const btn = document.getElementById('atr-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const ct = document.getElementById('atr-content');
    const d = window._atmCurResult;
    if (tabId === 'json') {
        // [수정] rawText 제외한 전체 응답 표시 (에러 응답 포함)
        const j = Object.assign({}, d);
        delete j.rawText; // 원문은 AI 탭에서 표시
        delete j.separatedText; // 구분 텍스트도 AI 탭에서 표시
        ct.innerHTML = '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;"><pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;">' + JSON.stringify(j, null, 2) + '</pre></div>';
    } else {
        const aiArr = d.aiResult || [];
        const aiHtml = aiArr.length > 0 ? aiArr.map((ev, idx) => {
            const borderColor = ev.command === '해제' ? '#22c55e' : ev.command === '예비' ? '#f59e0b' : '#ef4444';
            const tmFcDisplay = d.reportId ? (function(rid) { var p=rid.split(':'); if(p.length>=2){var t=p[1]; if(t.length>=12) return t.substring(0,4)+'년 '+t.substring(4,6)+'월 '+t.substring(6,8)+'일 '+t.substring(8,10)+'시 '+t.substring(10,12)+'분';} return ''; })(d.reportId) : '';
            const tmEfDisplay = ev.tmEf || ev.time || '';
            const tmCcDisplay = ev.tmCc || ev.tmYn || (ev.command === '해제' ? (ev.tmEf || ev.time || '') : '');
            return '<div style="background:rgba(0,0,0,0.2);border-radius:8px;padding:12px;margin-bottom:8px;border-left:3px solid ' + borderColor + ';">'
                + '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">'
                + '<span style="font-weight:700;color:#fff;font-size:0.85rem;">#' + (idx+1) + ' ' + ev.type + '</span>'
                + '<span style="background:rgba(255,255,255,0.1);color:#e2e8f0;padding:2px 8px;border-radius:4px;font-size:0.75rem;">' + ev.command + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:4px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">발표시각</span><span style="color:#94a3b8;">' + (tmFcDisplay || '정보 없음') + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:4px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">발효시각</span><span style="color:#e2e8f0;font-weight:500;">' + (tmEfDisplay || '정보 없음') + '</span></div>'
                + '<div style="font-size:0.8rem;margin-bottom:6px;display:flex;gap:4px;"><span style="color:#8b949e;min-width:56px;">해제시각</span><span style="color:#69f0ae;">' + (tmCcDisplay || '정보 없음') + '</span></div>'
                + '<div style="color:#94a3b8;font-size:0.8rem;">구역: ' + (ev.zones||[]).join(', ') + '</div>'
                + '</div>';
        }).join('') : '<div style="color:#94a3b8;padding:10px;">AI 분석 결과가 없습니다.</div>';
        // 원문/구분 텍스트 영역 구성
        var preStyle = 'margin:0;color:#cbd5e1;font-size:0.7rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;';
        var boxStyle = 'background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;max-height:35vh;';
        var hasSeparated = !!d.separatedText;
        var textHtml = '';

        if (hasSeparated && window.innerWidth >= 700) {
            // PC: 좌우 분할
            textHtml = '<div style="display:flex;gap:12px;">'
                + '<div style="flex:1;min-width:0;"><div style="color:#a5b4fc;font-weight:600;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
                + '<div style="' + boxStyle + '"><pre style="' + preStyle + '">' + (d.rawText||'(내용 없음)') + '</pre></div></div>'
                + '<div style="flex:1;min-width:0;"><div style="color:#34d399;font-weight:600;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-scissors"></i> 구분 텍스트</div>'
                + '<div style="' + boxStyle + 'border:1px solid rgba(52,211,153,0.2);"><pre style="' + preStyle + '">' + d.separatedText + '</pre></div></div>'
                + '</div>';
        } else if (hasSeparated) {
            // 모바일: 토글 버튼
            textHtml = '<div>'
                + '<div style="display:flex;gap:4px;margin-bottom:8px;">'
                + '<button id="atr-text-btn-original" onclick="atmSwitchTextView(\'original\')" style="flex:1;padding:6px 10px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-size:0.8rem;border-radius:6px;font-weight:600;"><i class="fa-solid fa-file-lines"></i> 원문</button>'
                + '<button id="atr-text-btn-separated" onclick="atmSwitchTextView(\'separated\')" style="flex:1;padding:6px 10px;background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:0.8rem;border-radius:6px;"><i class="fa-solid fa-scissors"></i> 구분</button>'
                + '</div>'
                + '<div id="atr-text-original-panel" style="' + boxStyle + '"><pre style="' + preStyle + '">' + (d.rawText||'(내용 없음)') + '</pre></div>'
                + '<div id="atr-text-separated-panel" style="display:none;' + boxStyle + 'border:1px solid rgba(52,211,153,0.2);"><pre style="' + preStyle + '">' + d.separatedText + '</pre></div>'
                + '</div>';
        } else {
            // 구분 텍스트 없음: 원문만 표시
            textHtml = '<div><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
                + '<div style="' + boxStyle + '"><pre style="' + preStyle + '">' + (d.rawText||'(내용 없음)') + '</pre></div></div>';
        }

        ct.innerHTML = '<div style="margin-bottom:16px;"><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-robot"></i> AI 분석 결과 (' + aiArr.length + '건)</div>' + aiHtml + '</div>' + textHtml;
    }
};

// 모바일 원문/구분 텍스트 토글
window.atmSwitchTextView = function(view) {
    var origPanel = document.getElementById('atr-text-original-panel');
    var sepPanel = document.getElementById('atr-text-separated-panel');
    var btnOrig = document.getElementById('atr-text-btn-original');
    var btnSep = document.getElementById('atr-text-btn-separated');
    if (!origPanel || !sepPanel) return;

    if (view === 'original') {
        origPanel.style.display = 'block';
        sepPanel.style.display = 'none';
        if (btnOrig) { btnOrig.style.background = 'rgba(99,102,241,0.2)'; btnOrig.style.color = '#a5b4fc'; btnOrig.style.border = 'none'; }
        if (btnSep) { btnSep.style.background = 'transparent'; btnSep.style.color = '#94a3b8'; btnSep.style.border = '1px solid rgba(255,255,255,0.1)'; }
    } else {
        origPanel.style.display = 'none';
        sepPanel.style.display = 'block';
        if (btnSep) { btnSep.style.background = 'rgba(16,185,129,0.2)'; btnSep.style.color = '#34d399'; btnSep.style.border = 'none'; }
        if (btnOrig) { btnOrig.style.background = 'transparent'; btnOrig.style.color = '#94a3b8'; btnOrig.style.border = '1px solid rgba(255,255,255,0.1)'; }
    }
};

// ============================================================================
// [전망 수집] 탭: 초단기/단기 전망 통보문 수집 결과 목록 및 결과 보기
// ============================================================================

async function renderATMForecast(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin"></i> 전망 수집 목록 로딩 중...</div>';

    try {
        const [cacheList, marineFcst] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/forecast-cache/list').then(r => r.json()),
            fetch(CONFIG.API_BASE + '/api/marine-forecast').then(r => r.ok ? r.json() : null).catch(() => null)
        ]);

        let html = '';

        // 현재 표출 중인 전망 요약
        if (marineFcst) {
            html += `
            <div style="background:linear-gradient(135deg,rgba(30,41,59,0.8),rgba(51,65,85,0.5));border:1px solid rgba(148,163,184,0.2);border-radius:10px;padding:14px;margin-bottom:16px;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <i class="fa-solid fa-water" style="color:#94a3b8;"></i>
                    <span style="color:#e2e8f0;font-weight:700;font-size:0.9rem;">현재 표출 중인 전망</span>
                    <span style="color:#64748b;font-size:0.72rem;margin-left:auto;">${marineFcst.updatedAt || ''}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                    ${['ultraShort', 'shortTerm'].map(key => {
                        const d = marineFcst[key];
                        const label = key === 'ultraShort' ? '초단기' : '단기';
                        if (!d) return `<div style="color:#64748b;font-size:0.78rem;padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;">${label}: 없음</div>`;
                        const cats = d.categories ? (typeof d.categories === 'object' ? Object.keys(d.categories).join(', ') : '있음') : '없음';
                        const aiTag = d.aiResult ? '<span style="color:#10b981;font-size:0.65rem;margin-left:4px;">AI✓</span>' : '';
                        return `<div style="padding:8px;background:rgba(0,0,0,0.2);border-radius:6px;">
                            <div style="color:#e2e8f0;font-size:0.82rem;font-weight:600;">${label} (${d.publishTime || ''})${aiTag}</div>
                            <div style="color:#94a3b8;font-size:0.72rem;">카테고리: ${cats}</div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // 수집 이력 목록
        if (!cacheList || cacheList.length === 0) {
            html += '<div style="text-align:center;padding:20px;color:#64748b;font-size:0.85rem;">수집된 전망 통보문이 없습니다. 기상 예보 수동 호출을 실행해주세요.</div>';
        } else {
            html += `<div style="font-weight:700;color:#e2e8f0;font-size:0.9rem;margin-bottom:10px;"><i class="fa-solid fa-list"></i> 수집 이력 (${cacheList.length}건)</div>`;
            cacheList.forEach(item => {
                const typeColor = item.type === '초단기전망' ? '#38bdf8' : '#a78bfa';
                const aiTag = item.hasAiResult ? '<span style="background:#10b98133;color:#10b981;padding:2px 6px;border-radius:4px;font-size:0.65rem;font-weight:700;">AI 분석</span>' : '';
                html += `
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;padding:10px 14px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
                    <div style="flex:1;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
                            <span style="background:${typeColor}22;color:${typeColor};padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:700;">${item.type || '전망'}</span>
                            ${aiTag}
                        </div>
                        <div style="color:#e2e8f0;font-size:0.82rem;font-weight:500;">${item.title || item.reportId}</div>
                        <div style="color:#64748b;font-size:0.72rem;">${item.publishTime || ''}</div>
                    </div>
                    <button onclick="showForecastResult('${encodeURIComponent(item.reportId)}')" style="padding:6px 14px;background:#8b5cf622;color:#a78bfa;border:1px solid #8b5cf644;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:600;">
                        <i class="fa-solid fa-eye"></i> 결과
                    </button>
                </div>`;
            });
        }

        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = `<div style="color:#ef4444;text-align:center;padding:20px;">전망 목록을 불러올 수 없습니다: ${e.message}</div>`;
    }
}

// 전망 결과 상세 보기 모달
window.showForecastResult = async function (encodedReportId) {
    const reportId = decodeURIComponent(encodedReportId);

    // 모달 생성
    const existing = document.getElementById('forecast-result-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'forecast-result-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.85);backdrop-filter:blur(5px);display:flex;align-items:center;justify-content:center;padding:20px;';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = '<div style="text-align:center;color:#94a3b8;"><i class="fa-solid fa-spinner fa-spin fa-2x"></i><p>로딩 중...</p></div>';
    document.body.appendChild(modal);

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/forecast-cache/' + encodedReportId);
        if (!res.ok) throw new Error('캐시 데이터 없음');
        const data = await res.json();

        const escHtml = (s) => {
            if (!s) return '';
            return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        };

        // 카테고리 비교 렌더링
        let compareHtml = '';
        const codeKeys = data.codeCategories ? Object.keys(data.codeCategories) : [];
        const aiKeys = data.aiResult && data.aiResult.categories ? Object.keys(data.aiResult.categories) : [];
        const allKeys = [...new Set([...codeKeys, ...aiKeys])];

        if (allKeys.length > 0) {
            compareHtml = allKeys.map(key => {
                const codeText = data.codeCategories && data.codeCategories[key] ? (typeof data.codeCategories[key] === 'string' ? data.codeCategories[key] : JSON.stringify(data.codeCategories[key])) : '';
                const aiCat = data.aiResult && data.aiResult.categories && data.aiResult.categories[key];
                const aiMain = aiCat ? (aiCat.main || '') : '';
                const aiSub = aiCat && aiCat.sub ? aiCat.sub.join('\n') : '';
                const aiText = aiMain + (aiSub ? '\n' + aiSub : '');

                const codeOnly = codeText && !aiText;
                const aiOnly = !codeText && aiText;
                const differ = codeText && aiText && codeText.trim() !== aiText.trim();

                let tagHtml = '';
                if (aiOnly) tagHtml = '<span style="color:#f59e0b;font-size:0.65rem;">AI 추가</span>';
                else if (codeOnly) tagHtml = '<span style="color:#ef4444;font-size:0.65rem;">AI 미포함</span>';
                else if (differ) tagHtml = '<span style="color:#38bdf8;font-size:0.65rem;">AI 교정</span>';
                else tagHtml = '<span style="color:#10b981;font-size:0.65rem;">일치</span>';

                return `
                <div style="margin-bottom:12px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;overflow:hidden;">
                    <div style="padding:8px 12px;background:rgba(99,102,241,0.1);display:flex;align-items:center;gap:8px;">
                        <span style="color:#a5b4fc;font-weight:700;font-size:0.85rem;">${escHtml(key)}</span>
                        ${tagHtml}
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
                        <div style="padding:10px;border-right:1px solid rgba(255,255,255,0.05);">
                            <div style="color:#64748b;font-size:0.7rem;font-weight:600;margin-bottom:4px;">코드 추출</div>
                            <pre style="color:#cbd5e1;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;margin:0;">${escHtml(codeText) || '<span style="color:#475569;">없음</span>'}</pre>
                        </div>
                        <div style="padding:10px;">
                            <div style="color:#10b981;font-size:0.7rem;font-weight:600;margin-bottom:4px;">AI 분석</div>
                            <pre style="color:#cbd5e1;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;margin:0;">${escHtml(aiText) || '<span style="color:#475569;">없음</span>'}</pre>
                        </div>
                    </div>
                </div>`;
            }).join('');
        }

        // AI 이슈 표시
        let issuesHtml = '';
        if (data.aiResult && data.aiResult.issues && data.aiResult.issues.length > 0) {
            issuesHtml = `
            <div style="background:#f59e0b11;border:1px solid #f59e0b33;border-radius:8px;padding:10px;margin-bottom:12px;">
                <div style="color:#f59e0b;font-weight:700;font-size:0.8rem;margin-bottom:6px;"><i class="fa-solid fa-triangle-exclamation"></i> AI 발견 이슈</div>
                ${data.aiResult.issues.map(i => `<div style="color:#fbbf24;font-size:0.75rem;padding:2px 0;">• ${escHtml(i)}</div>`).join('')}
            </div>`;
        }

        modal.innerHTML = `
        <div style="background:#1e293b;border-radius:16px;width:95%;max-width:900px;max-height:90vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(255,255,255,0.1);">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <div>
                    <h3 style="margin:0;color:#fff;font-size:1rem;"><i class="fa-solid fa-magnifying-glass-chart" style="color:#a78bfa;"></i> 전망 분석 결과</h3>
                    <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">${escHtml(data.title || '')} (${data.publishTime || ''})</div>
                </div>
                <button onclick="document.getElementById('forecast-result-modal').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="flex:1;overflow-y:auto;padding:16px 20px;">
                ${issuesHtml}

                <div style="display:flex;gap:8px;margin-bottom:12px;">
                    <button id="fcst-tab-compare" onclick="switchFcstResultTab('compare')" style="flex:1;padding:8px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;border-bottom:2px solid #6366f1;">
                        <i class="fa-solid fa-code-compare"></i> 비교
                    </button>
                    <button id="fcst-tab-raw" onclick="switchFcstResultTab('raw')" style="flex:1;padding:8px;background:transparent;color:#94a3b8;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">
                        <i class="fa-solid fa-file-lines"></i> 원문
                    </button>
                </div>

                <div id="fcst-result-compare">
                    ${compareHtml || '<div style="color:#64748b;text-align:center;padding:20px;">카테고리 데이터가 없습니다.</div>'}
                </div>
                <div id="fcst-result-raw" style="display:none;">
                    <pre style="color:#cbd5e1;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;padding:12px;background:rgba(0,0,0,0.3);border-radius:8px;max-height:60vh;overflow-y:auto;">${escHtml(data.rawText || '원문 없음')}</pre>
                </div>
            </div>
        </div>`;
    } catch (e) {
        modal.innerHTML = `
        <div style="background:#1e293b;border-radius:16px;padding:40px;text-align:center;">
            <div style="color:#ef4444;margin-bottom:10px;"><i class="fa-solid fa-exclamation-circle fa-2x"></i></div>
            <div style="color:#f87171;">${e.message}</div>
            <button onclick="document.getElementById('forecast-result-modal').remove()" style="margin-top:15px;padding:8px 16px;background:#374151;color:#fff;border:none;border-radius:6px;cursor:pointer;">닫기</button>
        </div>`;
    }
};

window.switchFcstResultTab = function (tabId) {
    const compareDiv = document.getElementById('fcst-result-compare');
    const rawDiv = document.getElementById('fcst-result-raw');
    const btnCompare = document.getElementById('fcst-tab-compare');
    const btnRaw = document.getElementById('fcst-tab-raw');

    if (tabId === 'compare') {
        if (compareDiv) compareDiv.style.display = 'block';
        if (rawDiv) rawDiv.style.display = 'none';
        if (btnCompare) { btnCompare.style.background = 'rgba(99,102,241,0.2)'; btnCompare.style.color = '#a5b4fc'; btnCompare.style.borderBottom = '2px solid #6366f1'; }
        if (btnRaw) { btnRaw.style.background = 'transparent'; btnRaw.style.color = '#94a3b8'; btnRaw.style.borderBottom = 'none'; }
    } else {
        if (compareDiv) compareDiv.style.display = 'none';
        if (rawDiv) rawDiv.style.display = 'block';
        if (btnRaw) { btnRaw.style.background = 'rgba(99,102,241,0.2)'; btnRaw.style.color = '#a5b4fc'; btnRaw.style.borderBottom = '2px solid #6366f1'; }
        if (btnCompare) { btnCompare.style.background = 'transparent'; btnCompare.style.color = '#94a3b8'; btnCompare.style.borderBottom = 'none'; }
    }
};

// (B) API 설정 섹션 렌더링
// (B) API 설정 섹션 렌더링
async function renderUnifiedApiContent(container) {
    if (!adminAuthenticated.api) return;

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-server" style="color:#38bdf8;"></i> API 수집 및 동기화 상태
        </div>
        
        <!-- API 상태 리스트 -->
        <div id="unified-api-status-list" style="margin-bottom:25px;">
            <!-- refreshUnifiedApiStatus에 의해 채워짐 -->
        </div>

        <!-- [New] TideBed API 관리 섹션 -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-water" style="color:#60a5fa;"></i> 공공데이터포털 TideBed API 관리 현황
        </div>

        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4); margin-bottom:15px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div id="tidebed-usage-status" style="font-weight:700; color:#fff; font-size:1rem;">
                    API 호출 현황 : <span style="color:#38bdf8;">-회</span> / <span style="color:#94a3b8;">-회</span>
                </div>
                <button class="admin-action-btn admin-btn-primary" onclick="addTideBedKey()">
                    <i class="fa-solid fa-plus"></i> KEY 추가
                </button>
            </div>
            
            <details class="admin-accordion" style="background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <summary style="padding:12px; cursor:pointer; color:#94a3b8; font-size:0.85rem; font-weight:600; list-style:none; display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-chevron-down" style="font-size:0.7rem;"></i> (API 키 등록 현황)
                </summary>
                <div id="tidebed-key-list" style="padding:10px; border-top:1px solid rgba(255,255,255,0.05);">
                    <!-- refreshUnifiedTideBedStatus에 의해 채워짐 -->
                </div>
            </details>
        </div>

        <!-- [New] 해양생활기상 API 만료일 관리 섹션 -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-umbrella-beach" style="color:#4fc3f7;"></i> 해양생활기상 API 만료일 관리 현황
        </div>

        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4); margin-bottom:15px;">
            <details class="admin-accordion" style="background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <summary style="padding:12px; cursor:pointer; color:#94a3b8; font-size:0.85rem; font-weight:600; list-style:none; display:flex; align-items:center; gap:8px;">
                    <i class="fa-solid fa-chevron-down" style="font-size:0.7rem;"></i> (지수별 API 만료일 현황)
                </summary>
                <div id="marine-life-expiry-list" style="padding:10px; border-top:1px solid rgba(255,255,255,0.05);">
                    <!-- refreshMarineLifeExpiry()에 의해 채워짐 -->
                </div>
            </details>
        </div>

        <!-- 인증키 설정 섹션 (하단 통합) -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-key" style="color:#f59e0b;"></i> 기상청 API HUB (Auth Key)
        </div>
        
        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4);">
            <div style="font-weight:600; color:#fff; margin-bottom:12px; font-size:0.85rem; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-bolt" style="color:#ff5722;"></i> 기상청 API HUB (Auth Key)
                <span style="font-size:0.7rem; color:#64748b; font-weight:400;">- 기상예보, 해구예보, 부이 공통</span>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <input type="password" id="unified-kma-hub-key" 
                    style="flex:1; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; padding:12px; font-size:0.9rem; font-family:monospace;" 
                    placeholder="인증키를 입력하세요">
                <button onclick="toggleUnifiedKeyVisibility('unified-kma-hub-key')" 
                    style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#94a3b8; width:45px; cursor:pointer;" title="보기/숨기기">
                    <i class="fa-solid fa-eye"></i>
                </button>
            </div>
            <button class="admin-action-btn admin-btn-primary" style="width:100%; height:45px; font-size:0.9rem;" onclick="saveUnifiedApiConfig()">
                <i class="fa-solid fa-save"></i> 인증키 설정 저장하기
            </button>
            <div style="margin-top:10px; font-size:0.7rem; color:#64748b; text-align:center;">
                <i class="fa-solid fa-circle-info"></i> 인증키를 변경하면 다음 데이터 수집 시점부터 적용됩니다.
            </div>
        </div>

        <div style="text-align:center; margin-top:20px;">
            <button class="admin-action-btn" style="background:none; border:1px solid rgba(255,255,255,0.1); color:#64748b;" onclick="refreshUnifiedApiStatus()">
                <i class="fa-solid fa-rotate"></i> 상태 데이터 새로고침
            </button>
        </div>
    `;

    // 인증키 보기 토글
    window.toggleUnifiedKeyVisibility = function (id) {
        const input = document.getElementById(id);
        const btn = event.currentTarget;
        const icon = btn.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    // [New] TideBed API 키 추가 (커스텀 모달 사용)
    window.addTideBedKey = function () {
        const modal = document.createElement('div');
        modal.id = 'tidebed-add-key-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;';

        modal.innerHTML = `
            <div style="background:#1e2435; border-radius:16px; width:100%; max-width:400px; padding:25px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 25px 50px rgba(0,0,0,0.5);">
                <h3 style="color:#fff; margin:0 0 20px; display:flex; align-items:center; gap:10px;">
                    <i class="fa-solid fa-key" style="color:#38bdf8;"></i> TideBED API 키 추가
                </h3>
                
                <div style="margin-bottom:15px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">새 인증키 (Service Key)</label>
                    <input type="text" id="new-tidebed-key" placeholder="API Key를 입력하세요" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; font-family:monospace; box-sizing:border-box;">
                </div>

                <div style="margin-bottom:15px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">만료 일자</label>
                    <input type="text" id="new-tidebed-expiry" placeholder="예: 2028-02-11" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
                </div>

                <div style="margin-bottom:25px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">닉네임 (소유자)</label>
                    <input type="text" id="new-tidebed-owner" placeholder="예: JIN" 
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; gap:12px;">
                    <button onclick="document.getElementById('tidebed-add-key-modal').remove()" 
                            style="flex:1; padding:12px; background:rgba(255,255,255,0.05); border:none; border-radius:8px; color:#94a3b8; cursor:pointer; font-weight:600;">취소</button>
                    <button id="tidebed-key-save-btn" style="flex:1; padding:12px; background:linear-gradient(135deg,#38bdf8,#2563eb); border:none; border-radius:8px; color:#fff; cursor:pointer; font-weight:700;">저장하기</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('tidebed-key-save-btn').onclick = async () => {
            const key = document.getElementById('new-tidebed-key').value.trim();
            const expiry = document.getElementById('new-tidebed-expiry').value.trim();
            const owner = document.getElementById('new-tidebed-owner').value.trim();

            if (!key) return alert('인증키를 입력해주세요.');

            try {
                const res = await fetch(CONFIG.API_BASE + '/api/tidebed/key', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ key, expiry, owner })
                });
                if (res.ok) {
                    alert('인증키가 성공적으로 추가되었습니다.');
                    modal.remove();
                    refreshUnifiedTideBedStatus();
                } else {
                    const data = await res.json();
                    alert(data.error || '추가 실패');
                }
            } catch (e) { alert('에러: ' + e.message); }
        };
    };

    // [New] TideBed API 키 삭제
    window.deleteTideBedKey = async function (index) {
        if (!confirm('정말 이 인증키를 삭제하시겠습니까?')) return;
        try {
            const res = await fetch(CONFIG.API_BASE + `/api/tidebed/key/${index}`, { method: 'DELETE' });
            if (res.ok) {
                alert('삭제되었습니다.');
                refreshUnifiedTideBedStatus();
            } else {
                const data = await res.json();
                alert(data.error || '삭제 실패');
            }
        } catch (e) { alert('에러: ' + e.message); }
    };

    // [New] TideBed API 상태 새로고침
    window.refreshUnifiedTideBedStatus = async function () {
        const usageEl = document.getElementById('tidebed-usage-status');
        const listEl = document.getElementById('tidebed-key-list');
        if (!usageEl || !listEl) return;

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/tidebed/config');
            const data = await res.json();

            // 상단 요약
            usageEl.innerHTML = `API 호출 현황 : <span style="color:#38bdf8;">${data.totalUsed.toLocaleString()}회</span> / <span style="color:#94a3b8;">${data.totalLimit.toLocaleString()}회</span>`;

            // 목록 렌더링
            listEl.innerHTML = `
                <div class="admin-accordion-content">
                    ${data.keys.map((k, i) => `
                        <div class="tidebed-key-item">
                            <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="flex:1;">
                                    <div style="font-size:0.75rem; font-weight:700; color:#fff; margin-bottom:6px; display:flex; align-items:center; gap:8px;">
                                        <i class="fa-solid fa-key" style="color:${data.currentIndex === i ? '#10b981' : '#64748b'}; font-size:0.6rem;"></i>
                                        ${i + 1}번 KEY ${data.currentIndex === i ? '<span style="padding:2px 6px; background:rgba(16,185,129,0.1); color:#10b981; border-radius:4px; font-size:0.65rem;">사용 중</span>' : ''}
                                    </div>
                                    <div style="display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:8px 10px; border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                                        <input type="password" value="${k.fullKey}" id="tidebed-key-${i}" readonly
                                            style="flex:1; background:transparent; border:none; color:#38bdf8; font-size:0.85rem; font-family:monospace; outline:none; padding:0;">
                                        <button onclick="toggleTideBedKeyItemVisibility(${i})" style="background:none; border:none; color:#94a3b8; cursor:pointer;" title="보기/숨기기">
                                            <i class="fa-solid fa-eye"></i>
                                        </button>
                                    </div>
                                    <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
                                        <div style="display:flex; justify-content:space-between; align-items:center;">
                                            <span style="font-size:0.7rem; color:#64748b;">일일 호출: <b style="color:#cbd5e1;">${k.used.toLocaleString()}</b> / 10,000</span>
                                            <button onclick="deleteTideBedKey(${i})" style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.2); color:#ef4444; border-radius:6px; padding:4px 8px; font-size:0.7rem; cursor:pointer;">
                                                <i class="fa-solid fa-trash-can" style="margin-right:4px;"></i> 삭제
                                            </button>
                                        </div>
                                        <div style="font-size:0.7rem; color:#64748b; padding:6px 0; border-top:1px solid rgba(255,255,255,0.03); display:flex; gap:10px;">
                                            <span>📅 만료: <b style="color:#94a3b8;">${k.expiry}</b></span>
                                            <span>👤 소유: <b style="color:#94a3b8;">${k.owner}</b></span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` || '<div style="color:#64748b; font-size:0.8rem; text-align:center; padding:10px;">등록된 키가 없습니다.</div>';

        } catch (e) {
            console.error('TideBed 상태 로드 실패:', e);
        }
    };

    window.toggleTideBedKeyItemVisibility = function (i) {
        const input = document.getElementById(`tidebed-key-${i}`);
        const icon = event.currentTarget.querySelector('i');
        if (input.type === 'password') {
            input.type = 'text';
            icon.classList.replace('fa-eye', 'fa-eye-slash');
        } else {
            input.type = 'password';
            icon.classList.replace('fa-eye-slash', 'fa-eye');
        }
    };

    // ========================================================================
    // [New] 해양생활기상 API 만료일 관리 함수
    // ========================================================================

    /**
     * 해양생활기상 지수별 만료일 현황을 서버에서 가져와 목록을 렌더링한다.
     * [연계] GET /api/marine-life/expiry → routes/fishing.js
     * [호출 시점] renderUnifiedApiContent() 완료 시, editMarineLifeExpiry() 저장 성공 시
     */
    window.refreshMarineLifeExpiry = async function () {
        const listEl = document.getElementById('marine-life-expiry-list');
        if (!listEl) return;

        // 지수별 아이콘 매핑 (UI 표시용)
        const iconMap = {
            fishing: { icon: 'fa-fish', color: '#4fc3f7' },
            surfing: { icon: 'fa-water', color: '#29b6f6' },
            mudflat: { icon: 'fa-shrimp', color: '#ff8a65' },
            swimming: { icon: 'fa-person-swimming', color: '#26c6da' },
            scuba: { icon: 'fa-mask-snorkel', color: '#7e57c2' },
            'sea-parting': { icon: 'fa-road', color: '#66bb6a' }
        };

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/marine-life/expiry');
            const data = await res.json();

            listEl.innerHTML = `
                <div class="admin-accordion-content">
                    ${data.indexes.map(idx => {
                        // 만료일 상태 계산: 만료됨(빨강), 30일 이내(노랑), 정상(초록), 미등록(회색)
                        const ic = iconMap[idx.type] || { icon: 'fa-circle-question', color: '#64748b' };
                        let statusColor = '#64748b';  // 미등록 기본
                        let statusText = '미등록';
                        if (idx.expiry && idx.expiry !== '-') {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            const expiryDate = new Date(idx.expiry + 'T00:00:00');
                            const diffDays = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

                            if (diffDays < 0) {
                                statusColor = '#ef4444'; statusText = '만료됨';
                            } else if (diffDays <= 30) {
                                statusColor = '#f59e0b'; statusText = diffDays + '일 남음';
                            } else {
                                statusColor = '#10b981'; statusText = '활성';
                            }
                        }

                        return `
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.03);">
                                <div style="display:flex; align-items:center; gap:10px;">
                                    <div style="width:30px; height:30px; background:rgba(255,255,255,0.05); border-radius:8px; display:flex; align-items:center; justify-content:center;">
                                        <i class="fa-solid ${ic.icon}" style="color:${ic.color}; font-size:0.8rem;"></i>
                                    </div>
                                    <div>
                                        <div style="font-size:0.8rem; font-weight:700; color:#fff;">${idx.name}</div>
                                        <div style="font-size:0.7rem; color:#64748b;">
                                            📅 만료: <b style="color:${statusColor};">${idx.expiry}</b>
                                            <span style="margin-left:6px; padding:2px 6px; background:${statusColor}22; color:${statusColor}; border-radius:4px; font-size:0.6rem; font-weight:800; border:1px solid ${statusColor}44;">${statusText}</span>
                                        </div>
                                    </div>
                                </div>
                                <button onclick="editMarineLifeExpiry('${idx.type}', '${idx.name}')"
                                    style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#94a3b8; border-radius:6px; padding:5px 10px; font-size:0.7rem; cursor:pointer;">
                                    <i class="fa-solid fa-pen" style="margin-right:4px;"></i> 수정
                                </button>
                            </div>
                        `;
                    }).join('')}
                </div>
            `;
        } catch (e) {
            console.error('해양생활기상 만료일 로드 실패:', e);
            listEl.innerHTML = '<div style="color:#ef4444; font-size:0.8rem; text-align:center; padding:10px;">만료일 정보를 불러오지 못했습니다.</div>';
        }
    };

    /**
     * 해양생활기상 지수의 만료일을 수정하는 모달을 표시한다.
     * @param {string} type - 지수 타입 (fishing, surfing 등)
     * @param {string} name - 지수 한글명 (바다낚시, 서핑 등)
     * [연계] PUT /api/marine-life/expiry/:type → routes/fishing.js
     * [호출] 각 지수 행의 [수정] 버튼 onclick
     */
    window.editMarineLifeExpiry = function (type, name) {
        const modal = document.createElement('div');
        modal.id = 'marine-expiry-edit-modal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.8);backdrop-filter:blur(10px);display:flex;align-items:center;justify-content:center;padding:20px;';

        modal.innerHTML = `
            <div style="background:#1e2435; border-radius:16px; width:100%; max-width:360px; padding:25px; border:1px solid rgba(255,255,255,0.1); box-shadow:0 25px 50px rgba(0,0,0,0.5);">
                <h3 style="color:#fff; margin:0 0 20px; display:flex; align-items:center; gap:10px; font-size:1rem;">
                    <i class="fa-solid fa-calendar-days" style="color:#4fc3f7;"></i> ${name} 만료일 수정
                </h3>

                <div style="margin-bottom:20px;">
                    <label style="display:block; color:#94a3b8; font-size:0.8rem; margin-bottom:6px;">만료 일자</label>
                    <input type="date" id="marine-expiry-input"
                           style="width:100%; padding:12px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; font-size:0.9rem; box-sizing:border-box;">
                </div>

                <div style="display:flex; gap:12px;">
                    <button onclick="document.getElementById('marine-expiry-edit-modal').remove()"
                            style="flex:1; padding:12px; background:rgba(255,255,255,0.05); border:none; border-radius:8px; color:#94a3b8; cursor:pointer; font-weight:600;">취소</button>
                    <button id="marine-expiry-save-btn"
                            style="flex:1; padding:12px; background:linear-gradient(135deg,#4fc3f7,#2196f3); border:none; border-radius:8px; color:#fff; cursor:pointer; font-weight:700;">저장하기</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // 저장 버튼 클릭 → PUT /api/marine-life/expiry/:type
        document.getElementById('marine-expiry-save-btn').onclick = async () => {
            const expiry = document.getElementById('marine-expiry-input').value;
            if (!expiry) return alert('만료일을 선택해주세요.');

            try {
                const res = await fetch(CONFIG.API_BASE + '/api/marine-life/expiry/' + type, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ expiry })
                });
                if (res.ok) {
                    alert('만료일이 저장되었습니다.');
                    modal.remove();
                    refreshMarineLifeExpiry();  // 목록 새로고침
                } else {
                    const data = await res.json();
                    alert(data.error || '저장 실패');
                }
            } catch (e) { alert('에러: ' + e.message); }
        };
    };

    // 인증키 저장
    window.saveUnifiedApiConfig = async function () {
        const hubKey = document.getElementById('unified-kma-hub-key').value;
        if (!hubKey) return alert('KMA HUB 인증키를 입력해주세요.');

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ KMA_HUB_KEY: hubKey })
            });
            if (res.ok) {
                alert('설정이 저장되었습니다.');
                refreshUnifiedApiStatus();
            } else { alert('저장 실패'); }
        } catch (e) { alert('에러: ' + e.message); }
    };

    window.refreshUnifiedApiStatus = async function () {
        const listContainer = document.getElementById('unified-api-status-list');
        const hubInput = document.getElementById('unified-kma-hub-key');
        if (!listContainer) return;

        try {
            // 1. 현재 설정된 인증키 먼저 로드
            const configRes = await fetch(CONFIG.API_BASE + '/api/config');
            const config = await configRes.json();
            if (hubInput && config.KMA_HUB_KEY) hubInput.value = config.KMA_HUB_KEY;

            // 2. 상태 리스트 로드
            const res = await fetch(CONFIG.API_BASE + '/api/status');
            const status = await res.json();
            // 관리자 화면에 표시할 API 수집 항목 목록
            // 해양생활기상: 수동 호출 시 바다낚시 지수 + 바다갈라짐 체험지수를 한번에 수집
            const apiItems = [
                { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
                { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
                { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' },
                { key: 'fishing', name: '해양생활기상', icon: 'fa-fish', color: '#4fc3f7' }
            ];

            listContainer.innerHTML = apiItems.map(api => {
                const s = status[api.key] || { lastRun: '-', status: '정보 없음', message: '' };
                const isSuccess = s.status === '성공';
                const statusColor = isSuccess ? '#10b981' : (s.status === '실패' ? '#ef4444' : '#64748b');

                return `
                    <div class="admin-card" id="api-card-${api.key}" style="padding:12px 15px;">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:12px;">
                                <div style="width:36px; height:36px; background:rgba(255,255,255,0.05); border-radius:10px; display:flex; align-items:center; justify-content:center;">
                                    <i class="fa-solid ${api.icon}" style="color:${api.color}; font-size:1rem;"></i>
                                </div>
                                <div>
                                    <div style="font-weight:700; color:#fff; font-size:0.9rem;">${api.name}</div>
                                    <div style="font-size:0.7rem; color:#64748b;">최종 실행: ${s.lastRun}</div>
                                </div>
                            </div>
                            <div style="display:flex; align-items:center; gap:10px;">
                                <span style="padding:3px 10px; border-radius:30px; font-size:0.65rem; font-weight:800; background:${statusColor}22; color:${statusColor}; border:1px solid ${statusColor}44;">
                                    ${s.status}
                                </span>
                                <button class="admin-action-btn" id="api-btn-${api.key}" style="padding:6px 10px; font-size:0.7rem;" onclick="forceUpdateApiUnified('${api.key}')">
                                    <i class="fa-solid fa-play"></i> 수동 호출
                                </button>
                            </div>
                        </div>
                        <div id="api-progress-${api.key}" style="display:none; margin-top:10px;"></div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            listContainer.innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">API 상태를 불러오지 못했습니다.</div>';
        }
    };

    window.forceUpdateApiUnified = async function (type) {
        const btn = document.getElementById('api-btn-' + type);
        const progressEl = document.getElementById('api-progress-' + type);
        if (!btn || !progressEl) return;

        const originalText = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 수집 중...';
        btn.disabled = true;

        // 진행 표시 UI
        progressEl.style.display = 'block';
        progressEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span class="cp-text" style="color:#a5b4fc; font-size:0.75rem;">준비 중...</span>
                <span class="cp-pct" style="color:#94a3b8; font-size:0.75rem;">0%</span>
            </div>
            <div style="background:rgba(0,0,0,0.3); border-radius:4px; height:5px; overflow:hidden;">
                <div class="cp-bar" style="background:linear-gradient(90deg,#6366f1,#8b5cf6); height:100%; width:0%; transition:width 0.3s; border-radius:4px;"></div>
            </div>
            <div class="cp-file" style="color:#64748b; font-size:0.65rem; margin-top:4px; min-height:1em; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;"></div>
        `;

        try {
            const es = new EventSource(CONFIG.API_BASE + '/api/force-update/' + type + '/stream');

            await new Promise((resolve, reject) => {
                es.onmessage = (ev) => {
                    try {
                        const data = JSON.parse(ev.data);
                        if (data.done) { es.close(); resolve(data); return; }
                        if (data.error) { es.close(); reject(new Error(data.error)); return; }
                        if (data.current && data.total) {
                            const pct = Math.round((data.current / data.total) * 100);
                            const textEl = progressEl.querySelector('.cp-text');
                            const pctEl = progressEl.querySelector('.cp-pct');
                            const barEl = progressEl.querySelector('.cp-bar');
                            const fileEl = progressEl.querySelector('.cp-file');
                            // 메인 진행률: "이미지 다운로드: 120/1060" (detail이 있으면 step + detail)
                            if (textEl) textEl.textContent = data.detail
                                ? `${data.step}: ${data.detail}`
                                : `${data.step}: ${data.current}/${data.total}`;
                            if (pctEl) pctEl.textContent = pct + '%';
                            if (barEl) barEl.style.width = pct + '%';
                            // 개별 파일 진행률 (하단): "do_korea_20260404_09.png 다운로드 중 57%"
                            if (fileEl) fileEl.textContent = data.fileDetail || '';
                        }
                    } catch (e) { }
                };
                es.onerror = () => { es.close(); reject(new Error('SSE 연결 실패')); };
            });

            // 완료 표시
            const barEl = progressEl.querySelector('.cp-bar');
            const pctEl = progressEl.querySelector('.cp-pct');
            const textEl = progressEl.querySelector('.cp-text');
            if (barEl) barEl.style.width = '100%';
            if (pctEl) pctEl.textContent = '100%';
            if (textEl) { textEl.textContent = '수집 완료!'; textEl.style.color = '#10b981'; }
            const fileEl2 = progressEl.querySelector('.cp-file');
            if (fileEl2) fileEl2.textContent = '';
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료';

            setTimeout(() => {
                progressEl.style.display = 'none';
                refreshUnifiedApiStatus();
            }, 2000);
        } catch (e) {
            btn.innerHTML = '<i class="fa-solid fa-times"></i> 에러';
            const textEl = progressEl.querySelector('.cp-text');
            if (textEl) { textEl.textContent = '수집 실패: ' + e.message; textEl.style.color = '#ef4444'; }
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.disabled = false;
                progressEl.style.display = 'none';
            }, 3000);
        }
    };

    refreshUnifiedApiStatus();
    refreshUnifiedTideBedStatus();
    refreshMarineLifeExpiry();  // 해양생활기상 만료일 현황 초기 로드
}

// (C) 공지 팝업 섹션 렌더링
async function renderUnifiedNoticeContent(container) {
    if (!adminAuthenticated.notice) return;

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-bell" style="color:#fbbf24;"></i> 서비스 상단 공지 팝업 관리
        </div>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:20px; margin-bottom:20px;">
            <div class="admin-card">
                <div style="font-weight:700; color:#fff; margin-bottom:12px; font-size:0.9rem;">진행 중인 공지</div>
                <div id="unified-active-notices" style="max-height:200px; overflow-y:auto;"></div>
            </div>
            <div class="admin-card">
                <div style="font-weight:700; color:#fff; margin-bottom:12px; font-size:0.9rem;">최근 종료된 공지</div>
                <div id="unified-expired-notices" style="max-height:200px; overflow-y:auto;"></div>
            </div>
        </div>
        
        <div class="admin-card" id="notice-form-container">
            <div style="font-weight:700; color:#fff; margin-bottom:15px; border-bottom:1px solid rgba(255,255,255,0.05); padding-bottom:10px;">
                <i class="fa-solid fa-plus-circle"></i> 공지사항 작성 및 수정
            </div>
            <input type="hidden" id="uni-notice-id" value="">
            <div style="margin-bottom:12px;">
                <input type="text" id="uni-notice-title" placeholder="공지 제목" style="width:100%; padding:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; outline:none;">
            </div>
            <div style="margin-bottom:12px;">
                <textarea id="uni-notice-content" placeholder="공지 상세 내용" style="width:100%; height:80px; padding:10px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff; outline:none; resize:none;"></textarea>
            </div>
            <div style="display:flex; gap:10px; margin-bottom:15px;">
                <input type="date" id="uni-notice-date" style="flex:1; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;">
                <select id="uni-notice-hour" style="width:70px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;"></select>
                <select id="uni-notice-min" style="width:70px; padding:8px; background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; color:#fff;"></select>
            </div>
            <!-- 게시글 링크 선택 -->
            <div style="margin-bottom:15px;">
                <label style="display:block; font-size:0.85rem; color:#94a3b8; margin-bottom:8px;">
                    <i class="fa-solid fa-link"></i> 게시글 연결 (선택)
                </label>
                <div id="uni-notice-promo-selector" style="background:rgba(0,0,0,0.2); border:1px solid rgba(255,255,255,0.1); border-radius:8px; overflow:hidden;">
                    <div id="uni-notice-promo-selected" style="display:none; padding:10px; background:rgba(59,130,246,0.1); border-bottom:1px solid rgba(255,255,255,0.05);">
                        <div style="display:flex; justify-content:space-between; align-items:center;">
                            <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
                                <i class="fa-solid fa-file-lines" style="color:#3b82f6;"></i>
                                <span id="uni-notice-promo-title" style="font-size:0.85rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"></span>
                            </div>
                            <button onclick="window.clearLinkedPromoUnified()" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.8rem; padding:4px 8px;">해제</button>
                        </div>
                    </div>
                    <div style="padding:6px 8px 4px;">
                        <input id="uni-notice-promo-search" type="text" placeholder="게시글 검색..." oninput="window.filterPromoListUnified(this.value)"
                               style="width:100%; padding:6px 10px; background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#e2e8f0; font-size:0.78rem; box-sizing:border-box; outline:none;" />
                    </div>
                    <div id="uni-notice-promo-list" style="max-height:150px; overflow-y:auto; padding:8px;">
                        <div style="text-align:center; color:#64748b; font-size:0.8rem; padding:10px;">게시글 목록을 불러오는 중...</div>
                    </div>
                </div>
                <input type="hidden" id="uni-notice-linked-promo" value="">
            </div>

            <button class="admin-action-btn admin-btn-primary" style="width:100%;" onclick="saveNoticeUnified()">
                <i class="fa-solid fa-save"></i> 공지사항 저장
            </button>
        </div>
    `;

    // 시간 옵션 채우기
    const hSelect = document.getElementById('uni-notice-hour');
    const mSelect = document.getElementById('uni-notice-min');
    for (let i = 0; i < 24; i++) hSelect.innerHTML += `<option value="${i}">${String(i).padStart(2, '0')}시</option>`;
    for (let i = 0; i < 60; i += 10) mSelect.innerHTML += `<option value="${i}">${String(i).padStart(2, '0')}분</option>`;

    window.refreshUnifiedNoticeList = async function () {
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/notices');
            const data = await res.json();

            const activeEl = document.getElementById('unified-active-notices');
            const expiredEl = document.getElementById('unified-expired-notices');

            activeEl.innerHTML = (data.active || []).map(n => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.03);">
                    <div style="font-size:0.85rem; color:#e2e8f0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${n.title}</div>
                    <div style="display:flex; gap:5px;">
                        <button onclick="editNoticeUnified(${n.id})" style="background:none; border:none; color:#38bdf8; cursor:pointer; font-size:0.8rem;">수정</button>
                        <button onclick="deleteNoticeUnified(${n.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.8rem;">삭제</button>
                    </div>
                </div>
            `).join('') || '<div style="color:#64748b; font-size:0.8rem; padding:10px;">활성 공지 없음</div>';

            expiredEl.innerHTML = (data.expired || []).map(n => `
                <div style="display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid rgba(255,255,255,0.03);">
                    <div style="font-size:0.85rem; color:#94a3b8; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${n.title}</div>
                    <div style="display:flex; gap:5px;">
                        <button onclick="editNoticeUnified(${n.id})" style="background:none; border:none; color:#38bdf8; cursor:pointer; font-size:0.8rem;">복사</button>
                        <button onclick="deleteNoticeUnified(${n.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; font-size:0.8rem;">삭제</button>
                    </div>
                </div>
            `).join('') || '<div style="color:#64748b; font-size:0.8rem; padding:10px;">종료 이력 없음</div>';
        } catch (e) { }
    };

    window.saveNoticeUnified = async function () {
        const dateVal = document.getElementById('uni-notice-date').value;
        const linkedPromoId = document.getElementById('uni-notice-linked-promo').value;
        const payload = {
            id: Number(document.getElementById('uni-notice-id').value) || Date.now(),
            title: document.getElementById('uni-notice-title').value,
            content: document.getElementById('uni-notice-content').value,
            expiresAt: dateVal
                ? `${dateVal} ${document.getElementById('uni-notice-hour').value.padStart(2, '0')}:${document.getElementById('uni-notice-min').value.padStart(2, '0')}`
                : null,
            linkedPromoId: linkedPromoId ? Number(linkedPromoId) : null,
            isActive: true
        };
        if (!payload.title || !payload.content) return alert('내용을 입력하세요.');
        const res = await fetch(CONFIG.API_BASE + '/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { alert('저장되었습니다.'); refreshUnifiedNoticeList(); }
    };

    // 게시글 목록 로드 (공지 연결용) - 전체 로드 + 검색 필터
    var _unifiedPromoCache = [];

    window.loadPromoListForNoticeUnified = async function () {
        const listEl = document.getElementById('uni-notice-promo-list');
        if (!listEl) return;
        const searchEl = document.getElementById('uni-notice-promo-search');
        if (searchEl) searchEl.value = '';
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/promo');
            if (!res.ok) throw new Error();
            const posts = await res.json();
            _unifiedPromoCache = posts || [];
            window.renderPromoListUnified(_unifiedPromoCache);
        } catch (e) {
            listEl.innerHTML = '<div style="color:#ef4444; font-size:0.8rem; padding:10px;">게시글 불러오기 실패</div>';
        }
    };

    window.renderPromoListUnified = function (posts) {
        const listEl = document.getElementById('uni-notice-promo-list');
        if (!listEl) return;
        if (!posts || posts.length === 0) {
            listEl.innerHTML = '<div style="text-align:center; color:#64748b; font-size:0.8rem; padding:10px;">등록된 게시글이 없습니다.</div>';
            return;
        }
        listEl.innerHTML = posts.map(p => `
            <div onclick="window.selectLinkedPromoUnified(${p.id}, '${(p.title || '').replace(/'/g, "\\'")}')"
                 style="padding:8px 10px; cursor:pointer; border-radius:6px; margin-bottom:4px; font-size:0.8rem; color:#cbd5e1; display:flex; align-items:center; gap:8px; transition:background 0.15s;"
                 onmouseover="this.style.background='rgba(255,255,255,0.05)'" onmouseout="this.style.background='transparent'">
                <i class="fa-solid fa-file-lines" style="color:#64748b; font-size:0.7rem;"></i>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${p.title}</span>
                <span style="font-size:0.7rem; color:#475569; flex-shrink:0;">${p.createdAt || ''}</span>
            </div>
        `).join('');
    };

    window.filterPromoListUnified = function (keyword) {
        if (!keyword || !keyword.trim()) {
            window.renderPromoListUnified(_unifiedPromoCache);
            return;
        }
        var lower = keyword.trim().toLowerCase();
        var filtered = _unifiedPromoCache.filter(function (p) {
            return (p.title || '').toLowerCase().indexOf(lower) !== -1;
        });
        window.renderPromoListUnified(filtered);
    };

    window.selectLinkedPromoUnified = function (id, title) {
        document.getElementById('uni-notice-linked-promo').value = id;
        document.getElementById('uni-notice-promo-title').textContent = title;
        document.getElementById('uni-notice-promo-selected').style.display = 'block';
        document.getElementById('uni-notice-promo-list').style.display = 'none';
    };

    window.clearLinkedPromoUnified = function () {
        document.getElementById('uni-notice-linked-promo').value = '';
        document.getElementById('uni-notice-promo-selected').style.display = 'none';
        document.getElementById('uni-notice-promo-list').style.display = 'block';
    };

    refreshUnifiedNoticeList();
    loadPromoListForNoticeUnified();
}

// 통합 모달 전용 공지사항 수정
window.editNoticeUnified = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        const data = await res.json();
        const allNotices = [...(data.active || []), ...(data.expired || [])];
        const target = allNotices.find(n => String(n.id) === String(id));

        if (target) {
            document.getElementById('uni-notice-id').value = target.id;
            document.getElementById('uni-notice-title').value = target.title;
            document.getElementById('uni-notice-content').value = target.content;

            if (target.expiresAt) {
                const parts = target.expiresAt.split(' ');
                document.getElementById('uni-notice-date').value = parts[0];
                if (parts[1]) {
                    const timeParts = parts[1].split(':');
                    document.getElementById('uni-notice-hour').value = parseInt(timeParts[0]);
                    document.getElementById('uni-notice-min').value = parseInt(timeParts[1]);
                }
            }
            // 연결된 게시글 복원
            if (target.linkedPromoId) {
                try {
                    // 관리자 패널에서 게시글 조회 → admin=true로 조회수 중복 증가 방지
                    const pRes = await fetch(CONFIG.API_BASE + '/api/promo/' + target.linkedPromoId + '?admin=true');
                    if (pRes.ok) {
                        const post = await pRes.json();
                        window.selectLinkedPromoUnified(post.id, post.title);
                    }
                } catch (e) { /* 게시글 삭제됨 */ }
            } else {
                window.clearLinkedPromoUnified();
            }

            document.getElementById('uni-notice-title').focus();
            // 폼으로 스크롤
            document.getElementById('notice-form-container').scrollIntoView({ behavior: 'smooth' });
        }
    } catch (e) { }
};

// 통합 모달 전용 공지사항 삭제
window.deleteNoticeUnified = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, { method: 'DELETE' });
        if (res.ok) {
            alert("삭제되었습니다.");
            refreshUnifiedNoticeList();
        } else {
            alert("삭제 실패");
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// (D) 게시판 관리 섹션 렌더링
async function renderUnifiedPromoContent(container) {
    if (!adminAuthenticated.promo) return;

    // 서브탭 구조: 게시판 관리 / 게시글 관리
    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-bullhorn" style="color:#f87171;"></i> 게시판 관리
        </div>

        <div class="admin-sub-tabs">
            <button class="error-fix-sub-tab active" data-subtab="board-mgmt" onclick="switchBoardSubTab('board-mgmt')">
                <i class="fa-solid fa-layer-group"></i> 게시판 관리
            </button>
            <button class="error-fix-sub-tab" data-subtab="post-mgmt" onclick="switchBoardSubTab('post-mgmt')">
                <i class="fa-solid fa-file-lines"></i> 게시글 관리
            </button>
        </div>

        <div id="board-subtab-content"></div>
    `;

    // 서브탭 전환 함수
    window.switchBoardSubTab = function (tabId) {
        document.querySelectorAll('.error-fix-sub-tab[data-subtab]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.subtab === tabId);
        });
        const content = document.getElementById('board-subtab-content');
        if (!content) return;
        if (tabId === 'board-mgmt') renderBoardManagement(content);
        else if (tabId === 'post-mgmt') renderPostManagement(content);
    };

    // ========== 게시판 관리 영역 ==========
    async function renderBoardManagement(el) {
        el.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px;">
                <div style="color:#94a3b8; font-size:0.85rem;">게시판 카테고리를 추가/수정/삭제/정렬할 수 있습니다.</div>
                <button class="admin-action-btn admin-btn-primary" onclick="openBoardEditor()">
                    <i class="fa-solid fa-plus"></i> 게시판 추가
                </button>
            </div>
            <div id="board-list-container">
                <div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 불러오는 중...</div>
            </div>
        `;
        loadBoardList();
    }

    // 게시판 목록 로드
    window.loadBoardList = async function () {
        const listEl = document.getElementById('board-list-container');
        if (!listEl) return;
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/boards');
            if (!res.ok) throw new Error('API 응답 오류: ' + res.status);
            const text = await res.text();
            let boards;
            try { boards = JSON.parse(text); } catch (e) { throw new Error('JSON 파싱 실패'); }

            if (!Array.isArray(boards) || boards.length === 0) {
                listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">등록된 게시판이 없습니다.</div>';
                return;
            }

            listEl.innerHTML = `
                <div style="display:flex; flex-direction:column; gap:6px;" id="board-sortable-list">
                    ${boards.map((board, idx) => {
                        const isFirst = idx === 0;
                        const isLast = idx === boards.length - 1;
                        return `
                        <div class="admin-card" style="margin-bottom:0; padding:12px; display:flex; align-items:center; gap:12px;" data-board-id="${board.id}">
                            <div style="display:flex; flex-direction:column; gap:4px; flex-shrink:0;">
                                <button class="board-sort-btn" onclick="moveBoardOrder('${board.id}', -1)"
                                    style="background:none; border:none; color:${isFirst ? '#334155' : '#64748b'}; cursor:${isFirst ? 'default' : 'pointer'}; font-size:0.7rem; padding:2px; opacity:${isFirst ? '0.3' : '1'};"
                                    ${isFirst ? 'disabled' : ''}>
                                    <i class="fa-solid fa-chevron-up"></i>
                                </button>
                                <button class="board-sort-btn" onclick="moveBoardOrder('${board.id}', 1)"
                                    style="background:none; border:none; color:${isLast ? '#334155' : '#64748b'}; cursor:${isLast ? 'default' : 'pointer'}; font-size:0.7rem; padding:2px; opacity:${isLast ? '0.3' : '1'};"
                                    ${isLast ? 'disabled' : ''}>
                                    <i class="fa-solid fa-chevron-down"></i>
                                </button>
                            </div>
                            <span style="display:inline-block; padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:600;
                                background:${hexToRgba(board.badgeColor, 0.15)};
                                color:${board.badgeColor};
                                border:1px solid ${hexToRgba(board.badgeColor, 0.5)};">
                                ${board.badgeText}
                            </span>
                            <div style="flex:1; min-width:0;">
                                <span style="font-weight:700; color:#fff; font-size:0.95rem;">${board.name}</span>
                            </div>
                            <div style="display:flex; gap:8px; flex-shrink:0;">
                                <button class="admin-action-btn" style="padding:5px 10px; font-size:0.75rem;" onclick='openBoardEditor(${JSON.stringify(board).replace(/'/g, "&#39;")})'>
                                    <i class="fa-solid fa-edit"></i> 수정
                                </button>
                                ${board.isDefault ? '' : `
                                <button class="admin-action-btn admin-btn-danger" style="padding:5px 10px; font-size:0.75rem;" onclick="deleteBoard('${board.id}')">
                                    <i class="fa-solid fa-trash"></i>
                                </button>`}
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            `;
        } catch (e) {
            listEl.innerHTML = `<div style="text-align:center; padding:40px; color:#ef4444;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size:1.5rem; margin-bottom:10px; display:block;"></i>
                게시판 목록 로드 실패<br>
                <span style="font-size:0.75rem; color:#94a3b8; margin-top:8px; display:block;">서버를 재시작해주세요 (새 API 엔드포인트 반영 필요)</span>
            </div>`;
        }
    };

    // 색상 헬퍼
    window.hexToRgba = function (hex, alpha) {
        if (!hex) return `rgba(148,163,184,${alpha})`;
        hex = hex.replace('#', '');
        if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    };

    // 게시판 순서 이동
    window.moveBoardOrder = async function (boardId, direction) {
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/boards');
            const boards = await res.json();
            const idx = boards.findIndex(b => b.id === boardId);
            if (idx === -1) return;
            const targetIdx = idx + direction;
            if (targetIdx < 0 || targetIdx >= boards.length) return;

            // swap sortOrder
            const order = boards.map((b, i) => ({ id: b.id, sortOrder: i + 1 }));
            const temp = order[idx].sortOrder;
            order[idx].sortOrder = order[targetIdx].sortOrder;
            order[targetIdx].sortOrder = temp;

            await fetch(CONFIG.API_BASE + '/api/boards/reorder', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ order })
            });
            loadBoardList();
        } catch (e) {
            alert('순서 변경 실패');
        }
    };

    // 게시판 편집 팝업
    window.openBoardEditor = function (editData) {
        const isEdit = !!editData;
        const existing = document.getElementById('board-editor-popup');
        if (existing) existing.remove();

        const popup = document.createElement('div');
        popup.id = 'board-editor-popup';
        popup.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:10001; display:flex; align-items:center; justify-content:center;';
        popup.innerHTML = `
            <div style="background:#1e293b; border-radius:16px; padding:24px; width:90%; max-width:420px; border:1px solid rgba(255,255,255,0.1);">
                <h4 style="color:#fff; margin:0 0 20px; font-size:1.1rem;">
                    <i class="fa-solid ${isEdit ? 'fa-edit' : 'fa-plus'}"></i> ${isEdit ? '게시판 수정' : '게시판 추가'}
                </h4>
                <div style="display:flex; flex-direction:column; gap:14px;">
                    <div>
                        <label style="font-size:0.8rem; color:#94a3b8; display:block; margin-bottom:4px;">게시판 이름</label>
                        <input type="text" id="board-edit-name" value="${isEdit ? editData.name : ''}" placeholder="예: 안전정보"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff; font-size:0.95rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.8rem; color:#94a3b8; display:block; margin-bottom:4px;">뱃지 텍스트 (2~4자)</label>
                        <input type="text" id="board-edit-badge" value="${isEdit ? editData.badgeText : ''}" placeholder="예: 안전" maxlength="4"
                            style="width:100%; padding:10px 12px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff; font-size:0.95rem; box-sizing:border-box;">
                    </div>
                    <div>
                        <label style="font-size:0.8rem; color:#94a3b8; display:block; margin-bottom:6px;">뱃지 색상</label>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <input type="color" id="board-edit-color" value="${isEdit ? editData.badgeColor : '#94a3b8'}"
                                style="width:48px; height:36px; border:none; background:none; cursor:pointer;">
                            <div id="board-color-preview" style="display:inline-block; padding:4px 14px; border-radius:20px; font-size:0.8rem; font-weight:600;
                                background:${isEdit ? hexToRgba(editData.badgeColor, 0.15) : 'rgba(148,163,184,0.15)'};
                                color:${isEdit ? editData.badgeColor : '#94a3b8'};
                                border:1px solid ${isEdit ? hexToRgba(editData.badgeColor, 0.5) : 'rgba(148,163,184,0.5)'};">
                                ${isEdit ? editData.badgeText : '미리보기'}
                            </div>
                            <div style="display:flex; gap:6px; flex-wrap:wrap;">
                                ${['#ff5252','#448aff','#69f0ae','#ffab40','#ce93d8','#4dd0e1','#f48fb1','#aed581'].map(c => `
                                    <button onclick="document.getElementById('board-edit-color').value='${c}'; updateBoardColorPreview();"
                                        style="width:24px; height:24px; border-radius:50%; border:2px solid rgba(255,255,255,0.2); background:${c}; cursor:pointer;"></button>
                                `).join('')}
                            </div>
                        </div>
                    </div>
                </div>
                <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:24px;">
                    <button onclick="document.getElementById('board-editor-popup').remove();"
                        style="padding:8px 20px; background:rgba(255,255,255,0.1); border:1px solid rgba(255,255,255,0.2); border-radius:8px; color:#94a3b8; cursor:pointer;">취소</button>
                    <button onclick="saveBoard(${isEdit ? "'" + editData.id + "'" : 'null'})"
                        style="padding:8px 20px; background:linear-gradient(135deg,#3b82f6,#2563eb); border:none; border-radius:8px; color:#fff; cursor:pointer; font-weight:600;">
                        <i class="fa-solid fa-check"></i> ${isEdit ? '수정' : '추가'}
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(popup);

        // 색상 미리보기 업데이트
        window.updateBoardColorPreview = function () {
            const color = document.getElementById('board-edit-color').value;
            const badgeText = document.getElementById('board-edit-badge').value || '미리보기';
            const preview = document.getElementById('board-color-preview');
            if (preview) {
                preview.style.color = color;
                preview.style.background = hexToRgba(color, 0.15);
                preview.style.border = '1px solid ' + hexToRgba(color, 0.5);
                preview.textContent = badgeText;
            }
        };

        document.getElementById('board-edit-color').addEventListener('input', updateBoardColorPreview);
        document.getElementById('board-edit-badge').addEventListener('input', updateBoardColorPreview);
    };

    // 게시판 저장
    window.saveBoard = async function (boardId) {
        const name = document.getElementById('board-edit-name').value.trim();
        const badgeText = document.getElementById('board-edit-badge').value.trim();
        const badgeColor = document.getElementById('board-edit-color').value;

        if (!name) { alert('게시판 이름을 입력해주세요.'); return; }
        if (!badgeText) { alert('뱃지 텍스트를 입력해주세요.'); return; }

        const data = { name, badgeText, badgeColor };
        if (boardId) data.id = boardId;

        try {
            const res = await fetch(CONFIG.API_BASE + '/api/boards', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await res.json();
            if (result.success) {
                const popup = document.getElementById('board-editor-popup');
                if (popup) popup.remove();
                loadBoardList();
                alert(boardId ? '게시판이 수정되었습니다.' : '게시판이 추가되었습니다.');
            } else {
                alert('저장 실패: ' + (result.error || ''));
            }
        } catch (e) {
            alert('서버 오류');
        }
    };

    // 게시판 삭제
    window.deleteBoard = async function (boardId) {
        if (!confirm('이 게시판을 삭제하시겠습니까?\n(게시글이 있으면 삭제할 수 없습니다)')) return;
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/boards/' + boardId, { method: 'DELETE' });
            const result = await res.json();
            if (result.success) {
                loadBoardList();
                alert('삭제되었습니다.');
            } else {
                alert(result.error || '삭제 실패');
            }
        } catch (e) {
            alert('서버 오류');
        }
    };

    // ========== 게시글 관리 영역 ==========
    // ------------------------------------------------------------------------
    // 통합 관리자(unified-admin-modal) > "게시판 관리" 메인 탭 > "게시글 관리" 서브탭.
    // - 서버 /api/promo 는 raw 배열을 반환(?page= 없이 호출 — 일반 사용자 화면과 공유).
    // - 클라이언트가 카테고리/제목 필터 → isPinned 우선 정렬 → 페이지 슬라이스 수행.
    //   (필터·검색과 자연스럽게 결합 + 데이터량이 수천 건 안쪽이라 충분히 빠름.)
    // - 페이지네이션 UI 는 공용 helper window.renderStandardPagination 사용.
    // ------------------------------------------------------------------------
    let _postMgmtPage = 1;
    const _POST_MGMT_LIMIT = 15;
    // fetch 결과 캐시: 페이지 전환 시 매번 서버 호출하지 않도록 모듈-로컬에 보관.
    // 저장(작성/수정)·삭제 시 invalidate.
    let _postMgmtCache = null;       // { posts: [], boardMap: {} } | null
    let _postMgmtCacheAt = 0;        // 캐시 채워진 시각(ms). 0 이면 미 채워짐.
    // 다중 어드민 환경에서 stale 캐시 방지용 TTL.
    // 30초 지나면 페이지 이동/필터 변경 시점에 자동 무효화 + 재 fetch.
    const _POST_MGMT_CACHE_TTL_MS = 30000;
    // 빠른 키 입력 race 가드: loadUnifiedPromoList 진입마다 시퀀스 토큰 증가.
    // await 후 토큰 불일치면 stale 응답으로 간주, 렌더 skip.
    let _postMgmtSeq = 0;
    // 검색 입력 debounce 핸들 (200ms). 마지막 keyup 만 fetch 트리거.
    let _postMgmtSearchDebounce = null;

    function _isPostMgmtCacheFresh() {
        return _postMgmtCache && (Date.now() - _postMgmtCacheAt) < _POST_MGMT_CACHE_TTL_MS;
    }

    // (I-5) 외부에서 호출되는 hook 을 한 객체로 묶어 prefix 통일.
    // - invalidateCache(): 저장/삭제 후 캐시 무효화.
    // - resetPage(): save 콜백에서 현재 페이지를 1로 리셋.
    window.__postMgmt = {
        invalidateCache: function () { _postMgmtCache = null; _postMgmtCacheAt = 0; },
        resetPage: function () { _postMgmtPage = 1; }
    };
    // (B-2 보조) 검색 입력에서 호출되는 debounced 트리거.
    // - 200ms 동안 추가 입력이 없으면 페이지 리셋 + loadUnifiedPromoList 호출.
    window.__postMgmtSearchInput = function () {
        if (_postMgmtSearchDebounce) clearTimeout(_postMgmtSearchDebounce);
        _postMgmtSearchDebounce = setTimeout(function () {
            _postMgmtSearchDebounce = null;
            _postMgmtPage = 1;
            if (typeof window.loadUnifiedPromoList === 'function') window.loadUnifiedPromoList();
        }, 200);
    };
    // 하위 호환: 기존 명세를 참조하는 외부 코드가 있을 경우 대비한 얇은 alias.
    window._invalidatePostMgmtCache = function () { window.__postMgmt.invalidateCache(); };
    window.__resetPostMgmtPage = function () { window.__postMgmt.resetPage(); };

    async function renderPostManagement(el) {
        // 게시판 목록을 불러와서 필터 드롭다운 생성
        let boards = [];
        try {
            const bRes = await fetch(CONFIG.API_BASE + '/api/boards');
            boards = await bRes.json();
        } catch (e) {}

        el.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; flex-wrap:wrap; gap:10px;">
                <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
                    <select id="admin-post-filter" onchange="window.__postMgmt.resetPage(); loadUnifiedPromoList()" style="padding:8px 12px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff; font-size:0.85rem;">
                        <option value="ALL">전체 게시판</option>
                        ${boards.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
                    </select>
                    <div style="position:relative;">
                        <input type="text" id="admin-post-search" placeholder="제목 검색..." onkeyup="window.__postMgmtSearchInput()"
                            style="padding:8px 12px 8px 32px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff; font-size:0.85rem; width:180px;">
                        <i class="fa-solid fa-magnifying-glass" style="position:absolute; left:10px; top:50%; transform:translateY(-50%); color:#64748b; font-size:0.8rem;"></i>
                    </div>
                </div>
                <button class="admin-action-btn admin-btn-primary" onclick="openPromoEditor()">
                    <i class="fa-solid fa-plus"></i> 새 게시글 작성
                </button>
            </div>

            <div id="unified-promo-list-container">
                <div style="text-align:center; padding:30px; color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 불러오는 중...</div>
            </div>
            <!-- 페이지네이션 컨테이너 (공용 helper 가 렌더). 목록 바로 아래. -->
            <div id="post-mgmt-pagination" class="pagination" style="margin-top:12px;"></div>
        `;
        // 서브탭 진입 시 1페이지부터 + 캐시 무효화하여 최신 데이터로 시작
        _postMgmtPage = 1;
        _postMgmtCache = null;
        _postMgmtCacheAt = 0;
        loadUnifiedPromoList();
    }

    // 게시글 목록 로드 (필터, 검색, 페이지네이션 포함)
    // 노출 함수명/시그니처는 그대로 유지(기존 호출자 호환).
    window.loadUnifiedPromoList = async function () {
        const listEl = document.getElementById('unified-promo-list-container');
        if (!listEl) return;
        const pagerEl = document.getElementById('post-mgmt-pagination');

        // (B-2) race 가드용 시퀀스 토큰. await 후 본인 토큰이 최신인지 확인.
        const myReq = ++_postMgmtSeq;

        const filterEl = document.getElementById('admin-post-filter');
        const searchEl = document.getElementById('admin-post-search');
        const filterCategory = filterEl ? filterEl.value : 'ALL';
        const searchKeyword = searchEl ? searchEl.value.trim().toLowerCase() : '';

        try {
            // (A-3) TTL 초과 시 캐시 자동 무효화 — 다른 어드민이 동시에 수정한 변경분 반영.
            if (_postMgmtCache && !_isPostMgmtCacheFresh()) {
                _postMgmtCache = null;
                _postMgmtCacheAt = 0;
            }
            // 캐시 미스면 서버 fetch (raw 배열) + 게시판 매핑 동시 로드
            if (!_postMgmtCache) {
                const [promoRes, boardsRes] = await Promise.all([
                    fetch(CONFIG.API_BASE + '/api/promo'),
                    fetch(CONFIG.API_BASE + '/api/boards')
                ]);
                // 더 새로운 요청이 들어왔으면 이 응답은 버린다.
                if (myReq !== _postMgmtSeq) return;
                const posts = await promoRes.json();
                const boards = await boardsRes.json();
                if (myReq !== _postMgmtSeq) return;
                const boardMap = {};
                (boards || []).forEach(b => { boardMap[b.id] = b; });
                _postMgmtCache = {
                    posts: Array.isArray(posts) ? posts : [],
                    boardMap: boardMap
                };
                _postMgmtCacheAt = Date.now();
            }
            // 캐시 히트 경로에서도 race 가드 — 동기 경로지만 일관성 위해 점검.
            if (myReq !== _postMgmtSeq) return;
            const { posts, boardMap } = _postMgmtCache;

            // 1) 필터링
            let filtered = posts;
            if (filterCategory !== 'ALL') {
                filtered = filtered.filter(p => p.category === filterCategory);
            }
            if (searchKeyword) {
                filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(searchKeyword));
            }

            // 2) 정렬: isPinned 우선, 그 다음 createdAt 역순 (공용 사용자 화면과 동일 패턴)
            filtered = filtered.slice().sort((a, b) => {
                if (a.isPinned && b.isPinned) return new Date(b.createdAt) - new Date(a.createdAt);
                if (a.isPinned) return -1;
                if (b.isPinned) return 1;
                return new Date(b.createdAt) - new Date(a.createdAt);
            });

            const total = filtered.length;
            const totalPages = Math.max(1, Math.ceil(total / _POST_MGMT_LIMIT));
            // 페이지 범위 보정 (삭제 등으로 마지막 페이지가 사라진 경우)
            if (_postMgmtPage > totalPages) _postMgmtPage = totalPages;
            if (_postMgmtPage < 1) _postMgmtPage = 1;

            if (total === 0) {
                listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">조건에 맞는 게시글이 없습니다.</div>';
                if (pagerEl) pagerEl.innerHTML = '';
                return;
            }

            // 3) 현재 페이지에 해당하는 slice 만 렌더
            const offset = (_postMgmtPage - 1) * _POST_MGMT_LIMIT;
            const pagePosts = filtered.slice(offset, offset + _POST_MGMT_LIMIT);

            listEl.innerHTML = pagePosts.map(post => {
                const board = boardMap[post.category];
                const badgeColor = board ? board.badgeColor : '#94a3b8';
                const badgeText = board ? board.badgeText : (post.category || '기타');
                return `
                <div class="admin-card" style="margin-bottom:10px; padding:12px;">
                    <div style="display:flex; justify-content:space-between; align-items:center;">
                        <div style="flex:1; min-width:0;">
                            <span style="display:inline-block; font-size:0.7rem; padding:2px 8px; border-radius:12px; font-weight:600; margin-right:8px;
                                background:${hexToRgba(badgeColor, 0.15)}; color:${badgeColor}; border:1px solid ${hexToRgba(badgeColor, 0.4)};">
                                ${badgeText}
                            </span>
                            ${post.isPinned ? '<i class="fa-solid fa-thumbtack" style="color:#ff5252; margin-right:4px;"></i>' : ''}
                            <span style="font-weight:700; color:#fff; font-size:0.95rem;">${post.title}</span>
                            <div style="font-size:0.75rem; color:#64748b; margin-top:4px;">${post.createdAt} | 조회수: ${post.views || 0}</div>
                        </div>
                        <div style="display:flex; gap:8px; flex-shrink:0;">
                            <button class="admin-action-btn" style="padding:5px 10px; font-size:0.75rem;" onclick="editPromoPost(${post.id})">
                                <i class="fa-solid fa-edit"></i> 수정
                            </button>
                            <button class="admin-action-btn admin-btn-danger" style="padding:5px 10px; font-size:0.75rem;" onclick="deletePromoPostUnified(${post.id})">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        </div>
                    </div>
                </div>`;
            }).join('');

            // 4) 페이지네이션 UI 렌더 (공용 helper 재사용)
            if (pagerEl && typeof window.renderStandardPagination === 'function') {
                window.renderStandardPagination(
                    pagerEl,
                    _postMgmtPage,
                    totalPages,
                    function (page) {
                        _postMgmtPage = page;
                        loadUnifiedPromoList();
                        // 페이지 전환 시 목록 상단으로 스크롤 (큰 페이지 이동 시 UX 개선).
                        // 통합 관리자 모달의 본문(.unified-admin-body)이 실제 스크롤러.
                        const scroller = document.getElementById('unified-admin-body');
                        if (scroller) {
                            if (typeof scroller.scroll === 'function') {
                                scroller.scroll({ top: 0, behavior: 'smooth' });
                            } else {
                                scroller.scrollTop = 0;
                            }
                        }
                    }
                );
            }
        } catch (e) {
            // stale 응답이면 UI 덮어쓰지 않음.
            if (myReq !== _postMgmtSeq) return;
            listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">게시글 로드 실패</div>';
            if (pagerEl) pagerEl.innerHTML = '';
        }
    };

    window.deletePromoPostUnified = async function (id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        // (F-2) 응답 success 검증. 실패 시 alert + 캐시 무효화/재로드 skip.
        //   promo.js 의 deletePromoPost 와 동일 패턴.
        try {
            const res = await fetch(CONFIG.API_BASE + '/api/promo/' + id, { method: 'DELETE' });
            const result = await res.json().catch(() => ({}));
            if (!res.ok || !result.success) {
                alert('삭제에 실패했습니다.');
                return;
            }
        } catch (e) {
            alert('삭제에 실패했습니다.');
            return;
        }
        // 캐시 무효화 후 재 fetch — 페이지 범위는 loadUnifiedPromoList 가 보정.
        window.__postMgmt.invalidateCache();
        loadUnifiedPromoList();
    };

    // 초기 렌더: 게시판 관리 서브탭
    renderBoardManagement(document.getElementById('board-subtab-content'));
}

// ============================================================================
// (E) 방문자 통계 섹션 렌더링
// ============================================================================

/**
 * 방문자 통계 대시보드를 렌더링합니다.
 *
 * [표시 항목]
 * 1. 상단 요약 카드 4개 (오늘/어제/7일/이달 방문수)
 * 2. 조회 필터 바 (시간별/일별/월별 + 날짜 선택)
 * 3. 방문자 차트 (라인 그래프 + 특보 푸시 발송 시점 수직 마커)
 * 4. 상세 데이터 테이블 (방문수 + 비중 + 특보 이벤트)
 *
 * [데이터 소스]
 * - GET /api/stats/visitors → 날짜별/시간대별 방문 통계
 * - GET /api/push-history → 특보 푸시 발송 이력 (차트 마커 + 테이블 표시용)
 *
 * [연계]
 * - admin.js → switchUsersSubTab('visitor')에서 이 함수를 호출
 * - processStatsAndRender() → 차트 및 테이블 데이터 가공
 * - renderVisitorChart() → Chart.js 차트 렌더링 + 특보 마커 표시
 */
let visitorChart = null;
let pushHistoryData = []; // 특보 푸시 발송 이력 (차트 마커용으로 전역 저장)
async function renderUnifiedStatsContent(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center;">
             <div><i class="fa-solid fa-chart-line" style="color:#a78bfa;"></i> 방문자 통계 분석</div>
             <div style="font-size:0.75rem; color:#64748b;">KST 기준 데이터</div>
        </div>
        
        <div id="stats-loading" style="text-align:center; padding:50px; color:#64748b;">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:10px;">통계 데이터를 분석 중입니다...</p>
        </div>
        
        <div id="stats-dashboard" style="display:none;">
            <!-- 상단 요약 카드 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(120px, 1fr)); gap:12px; margin-bottom:20px;">
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #3b82f6;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">오늘 방문</div>
                    <div id="stat-today" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #10b981;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">어제 방문</div>
                    <div id="stat-yesterday" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #f59e0b;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">최근 7일 합계</div>
                    <div id="stat-week" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
                <div class="admin-card" style="padding:15px; text-align:center; border-left:4px solid #f87171;">
                    <div style="font-size:0.75rem; color:#94a3b8; margin-bottom:5px;">이번 달 합계</div>
                    <div id="stat-month" style="font-size:1.2rem; font-weight:800; color:#fff;">0</div>
                </div>
            </div>

            <!-- 필터 제어바 -->
            <div style="background:rgba(255,255,255,0.03); padding:12px; border-radius:12px; margin-bottom:20px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border:1px solid rgba(255,255,255,0.05);">
                <div style="display:flex; background:rgba(0,0,0,0.2); padding:3px; border-radius:8px;">
                    ${['hourly', 'daily', 'monthly'].map(p => `
                        <button onclick="window.updateStatsType('${p}')" id="btn-stats-${p}"
                                style="padding:6px 12px; border:none; border-radius:6px; background:transparent; color:#94a3b8; font-size:0.8rem; font-weight:600; cursor:pointer; transition:0.2s;">
                            ${p === 'hourly' ? '시간별' : (p === 'daily' ? '일별' : '월별')}
                        </button>
                    `).join('')}
                </div>
                <div id="stats-date-group" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                    <!-- 날짜 선택기: 시간별 탭에서는 "조회 날짜" 라벨로 바뀌고, 종료일·물결표가 숨겨짐 -->
                    <span id="stats-date-label" style="color:#94a3b8; font-size:0.75rem; font-weight:600; display:none;">조회 날짜:</span>
                    <input type="date" id="stats-start-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <span id="stats-date-separator" style="color:#475569;">~</span>
                    <input type="date" id="stats-end-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <button onclick="window.refreshStatsDash()" style="background:#3b82f6; border:none; color:#fff; padding:5px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">적용</button>
                    <button onclick="window.exportVisitorCsv()" title="방문자 통계 CSV 내보내기" style="background:rgba(255,255,255,0.06); border:1px solid rgba(255,255,255,0.12); color:#cbd5e1; padding:5px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;"><i class="fa-solid fa-file-csv"></i> CSV</button>
                </div>
            </div>

            <!-- 그래프 영역 -->
            <div class="admin-card" style="padding:20px; margin-bottom:20px; height:320px; position:relative;">
                <canvas id="visitor-main-chart"></canvas>
            </div>

            <!-- 상세 데이터 표 -->
            <div class="admin-card" style="overflow:hidden;">
                <div style="padding:12px 16px; background:rgba(255,255,255,0.02); border-bottom:1px solid rgba(255,255,255,0.05); font-weight:700; font-size:0.85rem; color:#94a3b8;">
                    상세 데이터 내역
                </div>
                <div style="max-height:300px; overflow-y:auto;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                        <thead style="position:sticky; top:0; background:#1e293b; color:#64748b; text-align:left;">
                            <tr>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05);">날짜/시간</th>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:right;">방문수</th>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05); text-align:right;">비중</th>
                                <th style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.05);">특보 이벤트</th>
                            </tr>
                        </thead>
                        <tbody id="stats-table-body" style="color:#cbd5e1;"></tbody>
                    </table>
                </div>
            </div>
        </div>
    `;

    // 날짜 기본값 설정 (최근 30일)
    const now = new Date();
    const kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    const kst30DaysAgo = new Date(kstNow.getTime() - (30 * 24 * 60 * 60 * 1000));

    const endStr = kstNow.toISOString().split('T')[0];
    const startStr = kst30DaysAgo.toISOString().split('T')[0];

    document.getElementById('stats-start-date').value = startStr;
    document.getElementById('stats-end-date').value = endStr;

    let statsType = 'daily';
    let rawData = {};

    window.updateStatsType = function (type) {
        statsType = type;
        document.querySelectorAll('[id^="btn-stats-"]').forEach(btn => {
            if (btn.id === `btn-stats-${type}`) {
                btn.style.background = '#3b82f6';
                btn.style.color = '#fff';
            } else {
                btn.style.background = 'transparent';
                btn.style.color = '#94a3b8';
            }
        });

        // 시간별 ↔ 기간별 날짜 선택기 동적 전환
        // - 시간별: "조회 날짜" 라벨 표시 + 시작일 하나만 노출 (하루 선택)
        // - 일별/월별: 시작일 ~ 종료일 기간 범위 선택
        const dateLabel = document.getElementById('stats-date-label');
        const dateSeparator = document.getElementById('stats-date-separator');
        const dateEnd = document.getElementById('stats-end-date');

        if (type === 'hourly') {
            // 시간별: "조회 날짜:" 라벨을 보여주고, 종료일·물결표를 숨김
            dateLabel.style.display = 'inline';
            dateSeparator.style.display = 'none';
            dateEnd.style.display = 'none';
            // 시작일을 오늘로 초기화 (시간별 전환 시 기본값)
            const kstNow = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
            document.getElementById('stats-start-date').value = kstNow.toISOString().split('T')[0];
        } else {
            // 일별/월별: 라벨 숨기고, 종료일·물결표 다시 표시
            dateLabel.style.display = 'none';
            dateSeparator.style.display = 'inline';
            dateEnd.style.display = 'inline';
        }

        refreshStatsDash();
    };

    window.refreshStatsDash = function () {
        processStatsAndRender(rawData, statsType);
    };

    try {
        // 방문자 통계 + 특보 푸시 이력을 동시에 요청
        // 특보 이력은 차트에 수직 마커를 표시하고, 테이블에 이벤트 정보를 보여주기 위해 사용
        const [visitorRes, pushRes] = await Promise.all([
            fetch(CONFIG.API_BASE + '/api/stats/visitors'),
            fetch(CONFIG.API_BASE + '/api/push-history').catch(() => ({ ok: false }))
        ]);
        rawData = await visitorRes.json();

        // 특보 푸시 이력 저장 (자동 발송된 특보만 필터링)
        // type이 'auto'인 것만 = 크롤러가 자동 감지하여 발송한 특보 알림
        // 'manual'이나 'custom'은 관리자가 수동 발송한 것이므로 제외
        if (pushRes.ok) {
            var allHistory = await pushRes.json();
            pushHistoryData = Array.isArray(allHistory)
                ? allHistory.filter(function(h) { return h.type === 'auto'; })
                : [];
        } else {
            pushHistoryData = [];
        }

        document.getElementById('stats-loading').style.display = 'none';
        document.getElementById('stats-dashboard').style.display = 'block';

        // 요약 정보 계산
        updateStatsSummary(rawData);

        // 초기 렌더링 (일별)
        window.updateStatsType('daily');
    } catch (e) {
        container.innerHTML += `<div style="color:#ef4444; text-align:center; padding:20px;">데이터 로드 실패: ${e.message}</div>`;
    }
}

/**
 * 관리자 통계 요약(오늘 가입/푸시 발송 수 등) 카드를 갱신.
 * KST 기준 today 키로 data 에서 값 추출 후 DOM 라벨 갱신.
 *
 * @param {Object} data - 서버 통계 응답 (날짜별 키)
 */
function updateStatsSummary(data) {
    const kstNow = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
    const todayStr = kstNow.toISOString().split('T')[0];
    const yesterdayStr = new Date(kstNow.getTime() - 86400000).toISOString().split('T')[0];

    // 1. 오늘
    document.getElementById('stat-today').textContent = (data[todayStr]?.total || 0).toLocaleString();
    // 2. 어제
    document.getElementById('stat-yesterday').textContent = (data[yesterdayStr]?.total || 0).toLocaleString();

    // 3. 최근 7일
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
        const d = new Date(kstNow.getTime() - (i * 86400000)).toISOString().split('T')[0];
        weekTotal += (data[d]?.total || 0);
    }
    document.getElementById('stat-week').textContent = weekTotal.toLocaleString();

    // 4. 이번 달
    let monthTotal = 0;
    const thisMonthPrefix = todayStr.substring(0, 7);
    Object.keys(data).forEach(k => {
        if (k.startsWith(thisMonthPrefix)) monthTotal += (data[k].total || 0);
    });
    document.getElementById('stat-month').textContent = monthTotal.toLocaleString();
}

/**
 * 방문자 통계 데이터를 가공하여 차트와 테이블을 렌더링합니다.
 *
 * [동작 과정]
 * 1. 조회 모드(시간별/일별/월별)에 따라 데이터를 가공
 * 2. 해당 기간에 발송된 특보 푸시 이력을 매칭
 * 3. 차트에 방문자 수 + 특보 발송 시점 수직 마커를 표시
 * 4. 테이블에 방문수 + 비중 + 특보 이벤트 정보를 표시
 *
 * @param {Object} data - 방문자 통계 원본 데이터 (visitors_stats.json)
 * @param {string} type - 조회 모드 ('hourly' | 'daily' | 'monthly')
 *
 * [특보 이력 매칭 방식]
 * - 시간별(hourly): 해당 날짜의 각 시간대에 발송된 특보를 매칭
 *   예: 06시에 "풍랑주의보 발표" 발송 → 06시 행에 표시
 * - 일별(daily): 해당 날짜에 발송된 모든 특보 건수를 표시
 *   예: 4/4에 3건 발송 → 4/4 행에 "3건" 표시
 * - 월별(monthly): 해당 월에 발송된 모든 특보 건수를 표시
 *
 * [연계]
 * - pushHistoryData → renderUnifiedStatsContent()에서 로드한 특보 이력
 * - renderVisitorChart() → 차트 렌더링 + 수직 마커 표시
 */
function processStatsAndRender(data, type) {
    let labels = [];
    let values = [];
    let tableData = [];

    const startVal = document.getElementById('stats-start-date').value;
    const endVal = document.getElementById('stats-end-date').value;

    // ── 특보 푸시 이력을 시간대/날짜/월별로 분류 ──
    // pushHistoryData의 time 형식: "26.04.04 06:15" (YY.MM.DD HH:MM)
    // 이를 파싱하여 각 조회 모드에 맞게 매칭

    /**
     * 특보 이력의 time 문자열을 파싱하는 함수
     * "26.04.04 06:15" → { dateStr: "2026-04-04", hour: "06", fullTime: "06:15" }
     *
     * @param {string} timeStr - 이력의 time 필드 (YY.MM.DD HH:MM 형식)
     * @returns {Object|null} 파싱된 날짜/시간 정보 또는 null (파싱 실패 시)
     */
    function parsePushTime(timeStr) {
        if (!timeStr || timeStr.length < 14) return null;
        // "26.04.04 06:15" → year=26, month=04, day=04, hour=06, min=15
        var parts = timeStr.split(' ');
        if (parts.length < 2) return null;
        var dateParts = parts[0].split('.');
        var timeParts = parts[1].split(':');
        if (dateParts.length < 3 || timeParts.length < 2) return null;
        var year = '20' + dateParts[0]; // "26" → "2026"
        var month = dateParts[1];
        var day = dateParts[2];
        return {
            dateStr: year + '-' + month + '-' + day, // "2026-04-04"
            hour: timeParts[0],                       // "06"
            fullTime: parts[1]                        // "06:15"
        };
    }

    /**
     * 특보 탭 ID를 사람이 읽을 수 있는 한글 라벨로 변환
     * @param {string} tab - "publish" | "active" | "release" | "level"
     * @returns {string} 한글 라벨
     */
    function getAlertLabel(tab) {
        var map = { publish: '발표', active: '발효', release: '해제', level: '격상/격하' };
        return map[tab] || tab;
    }

    // 특보 이력을 날짜별로 그룹핑 (시간별/일별 공용)
    var pushByDate = {};   // { "2026-04-04": [{ hour, title, tab, fullTime }, ...] }
    var pushByMonth = {};  // { "2026-04": [{ title, tab }, ...] }

    pushHistoryData.forEach(function(h) {
        var parsed = parsePushTime(h.time);
        if (!parsed) return;
        // 날짜별 그룹
        if (!pushByDate[parsed.dateStr]) pushByDate[parsed.dateStr] = [];
        pushByDate[parsed.dateStr].push({
            hour: parsed.hour,
            fullTime: parsed.fullTime,
            title: h.title || '',
            tab: h.tab || ''
        });
        // 월별 그룹
        var ym = parsed.dateStr.substring(0, 7);
        if (!pushByMonth[ym]) pushByMonth[ym] = [];
        pushByMonth[ym].push({ title: h.title || '', tab: h.tab || '' });
    });

    // 차트에 표시할 특보 마커 위치 (X축 인덱스 + 라벨)
    var alertMarkers = [];

    if (type === 'hourly') {
        // 시간별 탭: 날짜 선택기(시작일)에서 선택된 날짜의 시간대별 데이터를 표시
        // 기본값은 오늘이며, 사용자가 날짜를 바꾸면 해당 날짜의 데이터를 보여줌
        const selectedDate = startVal;
        const dayData = data[selectedDate] || { hourly: {} };
        var dayPushes = pushByDate[selectedDate] || [];

        for (let i = 0; i < 24; i++) {
            const h = String(i).padStart(2, '0');
            labels.push(`${h}시`);
            const v = dayData.hourly[h] || 0;
            values.push(v);

            // 이 시간대에 발송된 특보 목록
            var hourPushes = dayPushes.filter(function(p) { return p.hour === h; });
            var alertEvents = hourPushes.map(function(p) {
                return { time: p.fullTime, title: p.title, label: getAlertLabel(p.tab) };
            });

            tableData.push({ label: `${h}:00 ~ ${h}:59`, value: v, alerts: alertEvents });

            // 차트 마커 추가 (분 단위 정밀 위치)
            if (hourPushes.length > 0) {
                hourPushes.forEach(function(p) {
                    var min = parseInt(p.fullTime.split(':')[1] || '0', 10);
                    alertMarkers.push({
                        index: i + (min / 60),
                        hourIndex: i,
                        label: p.title.replace(/[📢🔔⚠️🔴🟢⬆️⬇️]/g, '').trim().substring(0, 12),
                        fullLabel: p.title
                    });
                });
            }
        }
    } else if (type === 'daily') {
        const start = new Date(startVal);
        const end = new Date(endVal);
        let current = new Date(start);
        let idx = 0;

        while (current <= end) {
            const dStr = current.toISOString().split('T')[0];
            labels.push(dStr.substring(5)); // MM-DD
            const v = data[dStr]?.total || 0;
            values.push(v);

            // 이 날짜에 발송된 특보 목록
            var dayAlerts = pushByDate[dStr] || [];
            var alertEvents = dayAlerts.map(function(p) {
                return { time: p.fullTime, title: p.title, label: getAlertLabel(p.tab) };
            });

            tableData.push({ label: dStr, value: v, alerts: alertEvents });

            // 차트 마커 (일별: 특보가 있는 날에 마커 표시)
            if (dayAlerts.length > 0) {
                alertMarkers.push({
                    index: idx,
                    label: dayAlerts.length + '건',
                    fullLabel: dayAlerts.map(function(p) { return p.title; }).join('\n')
                });
            }

            current.setDate(current.getDate() + 1);
            idx++;
        }
    } else if (type === 'monthly') {
        // 최근 12개월 추출 또는 연도별 집계
        const yearMonths = {};
        Object.keys(data).forEach(k => {
            const ym = k.substring(0, 7);
            yearMonths[ym] = (yearMonths[ym] || 0) + (data[k].total || 0);
        });
        const sortedYM = Object.keys(yearMonths).sort().slice(-12);
        let idx = 0;
        sortedYM.forEach(ym => {
            labels.push(ym);
            values.push(yearMonths[ym]);

            // 이 달에 발송된 특보 건수
            var monthAlerts = pushByMonth[ym] || [];
            tableData.push({
                label: ym,
                value: yearMonths[ym],
                alerts: monthAlerts.length > 0
                    ? [{ time: '', title: monthAlerts.length + '건 발송', label: '' }]
                    : []
            });

            if (monthAlerts.length > 0) {
                alertMarkers.push({
                    index: idx,
                    label: monthAlerts.length + '건',
                    fullLabel: '특보 ' + monthAlerts.length + '건 발송'
                });
            }
            idx++;
        });
    }

    // 차트 그리기 (특보 마커 정보도 함께 전달)
    renderVisitorChart(labels, values, type, alertMarkers);

    // ── 테이블 업데이트 (특보 이벤트 컬럼 추가) ──
    const tbody = document.getElementById('stats-table-body');
    const total = values.reduce((a, b) => a + b, 0);

    // 최근 순으로 정렬하여 표출 (일별/월별일 때만)
    if (type !== 'hourly') tableData.reverse();

    tbody.innerHTML = tableData.map(item => {
        const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;

        // 특보 이벤트 컬럼 내용 생성
        // 시간별: "06:15 풍랑주의보 발표" 형태로 각 이벤트를 줄바꿈으로 표시
        // 일별/월별: "3건 발송" 또는 개별 제목 표시
        var alertHtml = '';
        if (item.alerts && item.alerts.length > 0) {
            alertHtml = item.alerts.map(function(a) {
                var text = '';
                if (a.time) text += '<span style="color:#94a3b8;">' + a.time + '</span> ';
                text += '<span style="color:#f59e0b;">' + (a.title || a.label) + '</span>';
                return text;
            }).join('<br>');
        }

        return `
            <tr>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03);">${item.label}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; font-weight:700;">${item.value.toLocaleString()}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; color:#64748b;">${percent}%</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); font-size:0.75rem; max-width:200px;">${alertHtml}</td>
            </tr>
        `;
    }).join('');
}

/**
 * 방문자 차트를 렌더링합니다.
 * Chart.js 라인 그래프에 특보 푸시 발송 시점을 수직 마커로 표시합니다.
 *
 * @param {string[]} labels - X축 라벨 (시간/날짜/월)
 * @param {number[]} values - Y축 값 (방문자 수)
 * @param {string} type - 조회 모드 ('hourly' | 'daily' | 'monthly')
 * @param {Array} alertMarkers - 특보 마커 배열 [{ index, label, fullLabel }]
 *   index: X축에서의 위치 (0-based)
 *   label: 차트에 짧게 표시할 텍스트 (예: "3건")
 *   fullLabel: 툴팁에 표시할 전체 텍스트
 *
 * [특보 마커 표시 방식]
 * 차트 위에 수직 점선을 그리고, 상단에 라벨을 표시합니다.
 * 외부 플러그인 없이 Chart.js의 커스텀 플러그인으로 직접 그립니다.
 *
 * [연계]
 * - processStatsAndRender() → 가공된 데이터와 마커 정보를 전달받음
 * - Chart.js 라이브러리 (CDN으로 로드됨)
 */
function renderVisitorChart(labels, values, type, alertMarkers) {
    const ctx = document.getElementById('visitor-main-chart').getContext('2d');

    if (visitorChart) visitorChart.destroy();

    const mainColor = '#22c55e'; // Vibrant Green (Emerald)

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
    gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');

    // 특보 마커를 참조하기 위해 변수에 저장 (플러그인 내부에서 접근)
    var markers = alertMarkers || [];

    visitorChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '방문자 수',
                data: values,
                borderColor: mainColor,
                borderWidth: 3,
                backgroundColor: gradient,
                fill: true,
                tension: 0.4,
                pointBackgroundColor: '#fff',
                pointBorderColor: mainColor,
                pointRadius: 4,
                pointHoverRadius: 6
            }]
        },
        plugins: [
            {
                // 차트 선에 은은한 글로우(빛번짐) 효과를 추가하는 플러그인
                id: 'glow',
                beforeDatasetDraw: (chart) => {
                    chart.ctx.save();
                    chart.ctx.shadowBlur = 15;
                    chart.ctx.shadowColor = mainColor;
                    chart.ctx.shadowOffsetX = 0;
                    chart.ctx.shadowOffsetY = 0;
                },
                afterDatasetDraw: (chart) => {
                    chart.ctx.restore();
                }
            },
            {
                // 특보 푸시 발송 시점에 수직 점선을 그리는 커스텀 플러그인
                // 텍스트 라벨은 표시하지 않고, 마우스 hover 시 툴팁으로 표시
                id: 'alertMarkers',
                afterDraw: function(chart) {
                    if (!markers || markers.length === 0) return;

                    var chartCtx = chart.ctx;
                    var xScale = chart.scales.x;
                    var yScale = chart.scales.y;

                    markers.forEach(function(marker) {
                        // 소수점 인덱스 보간: 예) 4.53 → 04시~05시 사이 53% 지점
                        var idx = marker.index;
                        var floorIdx = Math.floor(idx);
                        var frac = idx - floorIdx;
                        var x;
                        if (frac === 0) {
                            x = xScale.getPixelForValue(floorIdx);
                        } else {
                            var x0 = xScale.getPixelForValue(floorIdx);
                            var x1 = xScale.getPixelForValue(Math.min(floorIdx + 1, xScale.max));
                            x = x0 + (x1 - x0) * frac;
                        }
                        var yTop = yScale.top;
                        var yBottom = yScale.bottom;

                        // 수직 점선만 그리기 (라벨 없음)
                        chartCtx.save();
                        chartCtx.beginPath();
                        chartCtx.setLineDash([4, 4]);
                        chartCtx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
                        chartCtx.lineWidth = 1.5;
                        chartCtx.moveTo(x, yTop);
                        chartCtx.lineTo(x, yBottom);
                        chartCtx.stroke();
                        chartCtx.setLineDash([]);
                        chartCtx.restore();
                    });
                }
            }
        ],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { top: 0 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false,
                    callbacks: {
                        afterBody: function(tooltipItems) {
                            if (!markers || markers.length === 0 || !tooltipItems[0]) return '';
                            var idx = tooltipItems[0].dataIndex;
                            var matched = markers.filter(function(m) {
                                // hourIndex가 있으면 시간별 정밀 마커 → 시간대로 매칭
                                return (m.hourIndex !== undefined) ? m.hourIndex === idx : Math.floor(m.index) === idx;
                            });
                            if (matched.length === 0) return '';
                            var lines = ['', '⚠ 특보 알림:'];
                            matched.forEach(function(m) {
                                var text = m.fullLabel || m.label;
                                // fullLabel에 줄바꿈이 있으면 분리
                                text.split('\n').forEach(function(line) {
                                    lines.push('  ' + line.replace(/[📢🔔⚠️🔴🟢⬆️⬇️]/g, '').trim());
                                });
                            });
                            return lines;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#64748b', font: { size: 10 } }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 10 } }
                }
            }
        }
    });
}

// ============================================================================
// (F) 사용량 통계(Usage Analytics) 섹션 렌더링
// ============================================================================

/**
 * feature key → 한글 라벨 매핑표.
 * 사용량 통계 표/막대/요약에서 사람이 읽을 수 있는 이름으로 표시.
 * (서버 routes/usage.js 가 raw featureKey 를 그대로 돌려주므로 클라이언트에서 매핑)
 */
var USAGE_FEATURE_LABELS = {
    // A. 메인 화면 (특보 및 전망)
    'main.kma_marine_outlook_open': '기상청 해상기상 전망 펼침',
    'main.warn_region_open': '해역별 특보현황 펼침',
    'main.weather_region_open': '해역별 기상현황 펼침',
    'main.region_btn.forecast': '해역 버튼 · 기상예보',
    'main.region_btn.gugu': '해역 버튼 · 해구기상',
    'main.region_btn.windy': '해역 버튼 · 윈디',
    'main.region_btn.overview': '해역 버튼 · 종합정보',
    // B. 관측 부위(부이)
    'buoy.info_view': '부이 정보 조회',
    // C. 해상일기도
    'chart.load': '해상일기도 로딩',
    'chart.play': '해상일기도 재생',
    // D. 해양종합정보 오버레이
    'ocean.current': '유향유속(조류)',
    'ocean.wind': '풍향풍속(바람)',
    'ocean.wave': '파고/파향',
    'ocean.warn_zone': '특보 표출',
    'ocean.gugu_forecast': '해구 전망표/그래프',
    'ocean.cctv_open': 'CCTV 팝업',
    'ocean.typhoon': '태풍',
    'ocean.mudflat': '물빠짐',
    'ocean.basemap.rltm': '배경 · 기본맵',
    'ocean.basemap.enc': '배경 · 전자해도',
    'ocean.basemap.coast': '배경 · 해안도',
    'ocean.basemap.osm': '배경 · 세계지도',
    'ocean.basemap.vworld': '배경 · 위성지도',
    // 천기 요소 (천기도 + 바텀시트 통합)
    'shrt.rain_prob': '강수확률',
    'shrt.rain_amount': '강수량',
    'shrt.snow': '적설',
    'shrt.sky': '하늘상태',
    'shrt.temp_air': '기온(천기)',
    'shrt.vsby': '시정',
    // E. 해점 바텀시트 — 바텀시트로 얻은 데이터는 통합 1건으로 집계.
    'sheet.bottom_sheet': '해점 바텀시트',
    // (legacy) 마이그레이션 전 개별 집계분 라벨 — 표시 호환용으로 유지.
    'sheet.tide': '조석', 'sheet.astro': '천문(일출몰/월출몰)', 'sheet.moon': '월령(달 위상)', 'sheet.depth': '수심', 'sheet.water_temp': '수온',
    // F. 해양생활
    'life.fishing.tab': '바다낚시 탭 진입',
    'life.surfing.tab': '서핑 탭 진입',
    'life.parting.tab': '바다갈라짐 탭 진입',
    'life.mudflat.tab': '갯벌체험 탭 진입',
    'life.scuba.tab': '스킨스쿠버 탭 진입',
    'life.fishing.point.갯바위': '바다낚시 지점 · 갯바위',
    'life.fishing.point.선상': '바다낚시 지점 · 선상',
    'life.surfing.point': '서핑 지점 클릭',
    'life.parting.region': '바다갈라짐 지역 선택',
    'life.mudflat.region': '갯벌체험 지역 선택',
    'life.mudflat.point': '갯벌체험 지점 클릭',
    'life.scuba.point': '스킨스쿠버 지점 클릭',
    'life.ripcurrent.tab': '이안류 탭 진입',
    'life.ripcurrent.point': '이안류 지점 클릭'
};
function usageFeatureLabel(key) {
    return USAGE_FEATURE_LABELS[key] || key;
}

// ============================================================================
// (라)(마) Aurora 디자인 시스템 — 다크/화이트 두 팔레트(토글) 토큰
//   다크 = 스타일 A (Aurora Glass), 화이트 = 스타일 B (Clean Light)
//   화면/차트/도넛/표 + CSV/이미지 저장 결과물 모두 현재 모드 팔레트를 따른다.
// ============================================================================
var USAGE_THEMES = {
    dark: {
        // 스타일 A — Aurora Glass (관리자 센터와 일관)
        appBg: 'linear-gradient(160deg,#161d33 0%,#0c1120 100%)',
        appBgSolid: '#0c1120',
        cardBg: 'rgba(255,255,255,0.06)',
        cardBgSolid: '#1b2338',      // 드롭다운/팝업처럼 뒤가 비치면 안 되는 곳용 (불투명)
        cardBorder: 'rgba(255,255,255,0.10)',
        cardShadow: '0 8px 28px rgba(0,0,0,0.35)',
        text: '#e2e8f0',
        muted: '#94a3b8',
        faint: '#64748b',
        accent: '#3b82f6',           // 주 액센트 시작
        accent2: '#8b5cf6',          // 주 액센트 끝 (파랑→보라)
        cyan: '#22d3ee',             // 보조 시안
        amber: '#f59e0b',            // 경고 앰버
        gridLine: 'rgba(255,255,255,0.06)',
        ctrlBg: 'rgba(0,0,0,0.25)',
        ctrlBorder: 'rgba(255,255,255,0.10)',
        inputBg: 'rgba(0,0,0,0.30)',
        donutBorder: '#0c1120',
        // 도넛/막대 시리즈 팔레트 (액센트 → 시안 → 앰버 … 순)
        series: ['#3b82f6', '#8b5cf6', '#22d3ee', '#f59e0b', '#10b981', '#ec4899', '#60a5fa', '#a3a3a3', '#64748b']
    },
    light: {
        // 스타일 B — Clean Light (보고서용)
        appBg: '#f4f6fb',
        appBgSolid: '#f4f6fb',
        cardBg: '#ffffff',
        cardBgSolid: '#ffffff',
        cardBorder: '#eef2f7',
        cardShadow: '0 6px 22px rgba(15,23,42,0.08)',
        text: '#0f172a',
        muted: '#64748b',
        faint: '#94a3b8',
        accent: '#2563eb',           // 주 액센트 시작
        accent2: '#14b8a6',          // 주 액센트 끝 (파랑→청록)
        cyan: '#14b8a6',             // 보조 청록
        amber: '#f59e0b',            // 경고 앰버
        gridLine: 'rgba(15,23,42,0.06)',
        ctrlBg: '#eef2f7',
        ctrlBorder: '#e2e8f0',
        inputBg: '#ffffff',
        donutBorder: '#ffffff',
        series: ['#2563eb', '#14b8a6', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#6366f1', '#94a3b8', '#cbd5e1']
    }
};
var USAGE_THEME_KEY = 'seagnal_usage_theme';   // localStorage 키
function getUsageTheme() {
    var t = 'dark';
    try { t = localStorage.getItem(USAGE_THEME_KEY) || 'dark'; } catch (e) {}
    return (t === 'light') ? 'light' : 'dark';
}
function setUsageTheme(t) {
    try { localStorage.setItem(USAGE_THEME_KEY, t); } catch (e) {}
}
function usageThemeTokens() { return USAGE_THEMES[getUsageTheme()]; }

// 소속별 도넛 색상 팔레트 (테마 series 로 대체 — 호환용 유지)
var USAGE_AFF_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444',
    '#14b8a6', '#ec4899', '#a3a3a3', '#64748b'
];

var usageTrendChart = null;     // 추이 라인차트 인스턴스
var usageAffChart = null;       // 소속 도넛 인스턴스
var usageFeatureChart = null;   // 기능별 막대 인스턴스
var _usageLastData = null;      // 마지막 집계 응답 (CSV/이미지 export 용)
var _usageLastQuery = null;     // 마지막 조회 조건 (period/start/end/aff)
var _usageTrendStore = null;    // 추이 멀티라인용 { buckets, total[], byFeature{} }
var _usageAffSelection = [];    // 소속 복수선택 상태(빈 배열=전체). 재렌더/테마토글 후에도 유지.
var _usageAffType = 'doughnut'; // 소속별 조회수 차트 유형 (doughnut|bar). 기본=도넛.
var _usageFeatType = 'bar';     // 기능별 누적 차트 유형 (doughnut|bar). 기본=막대.
var _usageAffExploded = -1;     // 도넛 확대(분리)된 조각 index (-1=없음). 카드별로 따로 관리.
var _usageFeatExploded = -1;    // 기능 도넛 확대된 조각 index (-1=없음).
var _usageAffExplodeF = 0;      // 소속 도넛 확대 진행도 0~1 (애니메이션용).
var _usageFeatExplodeF = 0;     // 기능 도넛 확대 진행도 0~1.
var _usageMergedAffList = [];   // 현재 사용 가능한 소속 목록(드롭다운 옵션 출처).

/**
 * 사용량 통계 대시보드를 렌더링합니다. (종합 통계 > 사용량 통계 하위탭)
 *
 * [표시 항목]
 *  1. 기간 토글(일/월/연) + 날짜 범위 + 소속 드롭다운
 *  2. 요약 카드 (총 정보제공 건수, 최다 기능, 응답자/미정 수)
 *  3. 추이 라인차트 (Chart.js — 방문자 통계 패턴 재사용)
 *  4. 소속 분포 도넛
 *  5. 기능별 누적 막대 + 표 (feature key→한글 라벨)
 *
 * [데이터 소스] GET /api/stats/usage?period=&start=&end=&affiliation=
 *
 * [연계] admin.js → switchComprehensiveStatsSubTab('usage') 에서 호출
 */
async function renderUsageStatsContent(container) {
    var T = usageThemeTokens();
    var mode = getUsageTheme();
    var btnStyle = 'padding:6px 12px; border:none; border-radius:6px; background:transparent; color:' + T.muted + '; font-size:0.8rem; font-weight:600; cursor:pointer;';
    var inputStyle = 'background:' + T.inputBg + '; border:1px solid ' + T.ctrlBorder + '; border-radius:6px; color:' + T.text + '; padding:4px 8px; font-size:0.8rem;';
    var iconBtn = 'background:' + T.ctrlBg + '; border:1px solid ' + T.ctrlBorder + '; color:' + T.text + '; padding:5px 9px; border-radius:6px; font-size:0.78rem; font-weight:600; cursor:pointer;';

    container.innerHTML = `
        <div id="usage-root" class="usage-aurora" style="background:${T.appBg}; border-radius:18px; padding:16px; transition:background 0.25s;">
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center; color:${T.text};">
             <div><i class="fa-solid fa-gauge-high" style="color:${T.cyan};"></i> 사용량 통계 분석</div>
             <div style="display:flex; align-items:center; gap:10px;">
                <span style="font-size:0.72rem; color:${T.faint};">KST · 소속은 설문 응답으로 조회 시점 매핑</span>
                <button id="usage-landscape-toggle" onclick="window.toggleUsageLandscape()" title="가로보기 (화면 회전 · 영역을 나가면 자동 세로 복귀)"
                        style="${iconBtn}">
                    <i class="fa-solid fa-mobile-screen fa-rotate-90"></i> 가로
                </button>
                <button id="usage-theme-toggle" onclick="window.toggleUsageTheme()" title="다크/화이트 모드"
                        style="${iconBtn}">
                    <i class="fa-solid ${mode === 'light' ? 'fa-moon' : 'fa-sun'}"></i>
                    ${mode === 'light' ? ' 다크' : ' 화이트'}
                </button>
             </div>
        </div>

        <!-- 필터 제어바 -->
        <div style="background:${T.cardBg}; padding:12px; border-radius:14px; margin:12px 0 18px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow};">
            <div style="display:flex; background:${T.ctrlBg}; padding:3px; border-radius:8px; flex-wrap:wrap;">
                ${['today', 'daily', 'monthly', 'yearly', 'custom'].map(p => `
                    <button onclick="window.updateUsagePeriod('${p}')" id="btn-usage-${p}"
                            style="${btnStyle}">
                        ${p === 'today' ? '오늘' : (p === 'daily' ? '일별' : (p === 'monthly' ? '월별' : (p === 'yearly' ? '연별' : '직접 설정')))}
                    </button>
                `).join('')}
            </div>
            <div style="display:flex; align-items:center; gap:8px; margin-left:auto; flex-wrap:wrap;">
                <input type="date" id="usage-start-date" style="${inputStyle}">
                <span style="color:${T.faint};">~</span>
                <input type="date" id="usage-end-date" style="${inputStyle}">
                <!-- 소속 복수선택 커스텀 드롭다운 (버튼 + 체크박스 패널) -->
                <div id="usage-aff-dd" style="position:relative;">
                    <button type="button" id="usage-aff-btn" onclick="window._usageAffTogglePanel(event)"
                            style="${inputStyle} padding:5px 10px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; min-width:120px; justify-content:space-between;">
                        <span id="usage-aff-btn-label">전체 소속</span>
                        <i class="fa-solid fa-chevron-down" style="font-size:0.65rem; opacity:0.7;"></i>
                    </button>
                    <div id="usage-aff-panel" style="display:none; position:absolute; top:calc(100% + 4px); right:0; z-index:50; background:${T.cardBgSolid || T.cardBg}; border:1px solid ${T.ctrlBorder}; border-radius:10px; box-shadow:0 10px 30px rgba(0,0,0,0.35); padding:6px; min-width:200px; max-height:300px; overflow-y:auto;">
                        <!-- _renderUsageDashboard 가 채움 -->
                    </div>
                </div>
                <button onclick="window.refreshUsageDash()" style="background:linear-gradient(135deg,${T.accent},${T.accent2}); border:none; color:#fff; padding:5px 12px; border-radius:6px; font-size:0.8rem; font-weight:700; cursor:pointer;">적용</button>
            </div>
        </div>

        <!-- (나)(다) 내보내기 도구바 -->
        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">
            <span style="font-size:0.72rem; color:${T.faint}; margin-right:2px;"><i class="fa-solid fa-download"></i> 내보내기:</span>
            <button onclick="window.exportUsageCsv()" style="${iconBtn}"><i class="fa-solid fa-file-csv"></i> CSV</button>
            <button onclick="window.exportUsageImage('dashboard')" style="${iconBtn}"><i class="fa-solid fa-image"></i> 전체 대시보드</button>
            <button onclick="window.exportUsageImage('trend')" style="${iconBtn}">추이 PNG</button>
            <button onclick="window.exportUsageImage('aff')" style="${iconBtn}">도넛 PNG</button>
            <button onclick="window.exportUsageImage('feature')" style="${iconBtn}">기능별표 PNG</button>
        </div>

        <div id="usage-loading" style="text-align:center; padding:40px; color:${T.faint};">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:10px;">사용량 데이터를 분석 중입니다...</p>
        </div>

        <div id="usage-dashboard" style="display:none;">
            <!-- 요약 카드 -->
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(140px, 1fr)); gap:12px; margin-bottom:20px;">
                <div class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:15px; text-align:center; border-left:4px solid ${T.cyan};">
                    <div style="font-size:0.75rem; color:${T.muted}; margin-bottom:5px;">총 정보제공 건수</div>
                    <div id="usage-stat-total" style="font-size:1.2rem; font-weight:800; color:${T.text};">0</div>
                </div>
                <div class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:15px; text-align:center; border-left:4px solid ${T.accent};">
                    <div style="font-size:0.75rem; color:${T.muted}; margin-bottom:5px;">최다 기능</div>
                    <div id="usage-stat-top" style="font-size:0.95rem; font-weight:800; color:${T.text};">-</div>
                </div>
                <div class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:15px; text-align:center; border-left:4px solid ${T.accent2};">
                    <div style="font-size:0.75rem; color:${T.muted}; margin-bottom:5px;">소속 응답 기기</div>
                    <div id="usage-stat-assigned" style="font-size:1.2rem; font-weight:800; color:${T.text};">0</div>
                </div>
                <div class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:15px; text-align:center; border-left:4px solid ${T.amber};">
                    <div style="font-size:0.75rem; color:${T.muted}; margin-bottom:5px;">소속 미정 기기</div>
                    <div id="usage-stat-unassigned" style="font-size:1.2rem; font-weight:800; color:${T.text};">0</div>
                </div>
            </div>

            <!-- 추이 차트 -->
            <div id="usage-trend-card" class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:20px; margin-bottom:20px; position:relative;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
                    <div style="font-weight:700; font-size:0.85rem; color:${T.muted};">기간 추이 <span style="font-weight:400; color:${T.faint}; font-size:0.72rem;">· 전체 합계 또는 기능 선택(중복 가능)</span></div>
                    <span id="usage-trend-affnote" style="font-size:0.74rem; font-weight:700; color:${T.cyan};"></span>
                </div>
                <div id="usage-trend-controls" style="display:flex; gap:6px; flex-wrap:nowrap; overflow-x:auto; padding-bottom:8px; margin-bottom:6px; -webkit-overflow-scrolling:touch;"></div>
                <div style="position:relative; height:250px;"><canvas id="usage-trend-chart"></canvas></div>
            </div>

            <!-- 소속별 정보 조회수 (도넛/막대 전환) -->
            <div id="usage-aff-card" class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; padding:20px; margin-bottom:20px;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                    <div style="font-weight:700; font-size:0.85rem; color:${T.muted};">소속별 정보 조회수 <span id="usage-aff-affnote" style="font-weight:700; color:${T.cyan}; font-size:0.74rem;"></span></div>
                    <div id="usage-aff-typetoggle" style="display:flex; background:${T.ctrlBg}; padding:3px; border-radius:8px;">
                        <button type="button" data-type="doughnut" onclick="window._usageSetChartType('aff','doughnut')" title="원형" style="${btnStyle} padding:4px 9px;"><i class="fa-solid fa-circle-dot"></i></button>
                        <button type="button" data-type="bar" onclick="window._usageSetChartType('aff','bar')" title="막대" style="${btnStyle} padding:4px 9px;"><i class="fa-solid fa-chart-bar"></i></button>
                    </div>
                </div>
                <div id="usage-aff-canvas-wrap" style="height:280px; position:relative;">
                    <canvas id="usage-aff-chart"></canvas>
                </div>
            </div>

            <!-- 기능별 누적 막대 + 표 (한 카드로 묶어 기능별표 PNG에 함께 캡처) -->
            <div id="usage-feature-card" class="usage-card" style="background:${T.cardBg}; border:1px solid ${T.cardBorder}; box-shadow:${T.cardShadow}; border-radius:16px; margin-bottom:20px; overflow:hidden;">
                <div style="padding:20px;">
                    <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; flex-wrap:wrap;">
                        <div style="font-weight:700; font-size:0.85rem; color:${T.muted};">기능별 누적 사용 <span style="font-weight:400; color:${T.faint}; font-size:0.72rem;">· 건수 많은 순</span> <span id="usage-feat-affnote" style="font-weight:700; color:${T.cyan}; font-size:0.74rem;"></span></div>
                        <div id="usage-feat-typetoggle" style="display:flex; background:${T.ctrlBg}; padding:3px; border-radius:8px;">
                            <button type="button" data-type="doughnut" onclick="window._usageSetChartType('feat','doughnut')" title="원형" style="${btnStyle} padding:4px 9px;"><i class="fa-solid fa-circle-dot"></i></button>
                            <button type="button" data-type="bar" onclick="window._usageSetChartType('feat','bar')" title="막대" style="${btnStyle} padding:4px 9px;"><i class="fa-solid fa-chart-bar"></i></button>
                        </div>
                    </div>
                    <div id="usage-feat-canvas-wrap" style="position:relative; min-height:280px;">
                        <canvas id="usage-feature-chart"></canvas>
                    </div>
                </div>
            </div>
        </div>
        </div>
    `;

    // 날짜 기본값 (최근 30일)
    var now = new Date();
    var kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
    var kst30 = new Date(kstNow.getTime() - (30 * 24 * 60 * 60 * 1000));
    document.getElementById('usage-end-date').value = kstNow.toISOString().split('T')[0];
    document.getElementById('usage-start-date').value = kst30.toISOString().split('T')[0];

    var usagePeriod = 'daily';

    // (가) 직접 설정: custom 은 서버 집계를 일별(daily)로 받되, 사용자가 지정한 start~end 범위만 표출.
    //     오늘: start=end=오늘(KST) 로 자동 설정 + daily 집계.
    window.updateUsagePeriod = function (p) {
        // '오늘' 클릭 시 날짜 input 을 오늘로 맞춘다(서버 버킷은 daily).
        if (p === 'today') {
            var _now = new Date();
            var _kst = new Date(_now.getTime() + (9 * 60 * 60 * 1000));
            var _t = _kst.toISOString().split('T')[0];
            var _s = document.getElementById('usage-start-date');
            var _e = document.getElementById('usage-end-date');
            if (_s) _s.value = _t;
            if (_e) _e.value = _t;
        }
        usagePeriod = p;
        ['today', 'daily', 'monthly', 'yearly', 'custom'].forEach(function (x) {
            var b = document.getElementById('btn-usage-' + x);
            if (!b) return;
            if (x === p) { b.style.background = 'linear-gradient(135deg,' + T.accent + ',' + T.accent2 + ')'; b.style.color = '#fff'; }
            else { b.style.background = 'transparent'; b.style.color = T.muted; }
        });
        // 직접 설정이면 날짜 input 강조(사용자가 임의 기간 직접 지정)
        var sEl = document.getElementById('usage-start-date');
        var eEl = document.getElementById('usage-end-date');
        if (sEl && eEl) {
            var hl = (p === 'custom');
            sEl.style.borderColor = hl ? T.accent : T.ctrlBorder;
            eEl.style.borderColor = hl ? T.accent : T.ctrlBorder;
        }
        window.refreshUsageDash();
    };

    window.refreshUsageDash = async function () {
        var start = document.getElementById('usage-start-date').value;
        var end = document.getElementById('usage-end-date').value;
        // 소속 복수선택 상태(_usageAffSelection)를 콤마조인. 비면 '전체'.
        var aff = (_usageAffSelection && _usageAffSelection.length) ? _usageAffSelection.join(',') : '전체';
        // custom / today 는 서버측 버킷을 daily 로, 그 외는 그대로.
        var serverPeriod = (usagePeriod === 'custom' || usagePeriod === 'today') ? 'daily' : usagePeriod;

        var loadingEl = document.getElementById('usage-loading');
        if (loadingEl) loadingEl.style.display = 'block';

        try {
            var url = CONFIG.API_BASE + '/api/stats/usage?period=' + encodeURIComponent(serverPeriod)
                + '&start=' + encodeURIComponent(start) + '&end=' + encodeURIComponent(end)
                + '&affiliation=' + encodeURIComponent(aff);
            var res = await fetch(url);
            var data = await res.json();
            _usageLastData = data;
            _usageLastQuery = { period: usagePeriod, start: start, end: end, affiliation: aff };
            _renderUsageDashboard(data);
        } catch (e) {
            container.innerHTML += '<div style="color:#ef4444;text-align:center;padding:20px;">사용량 데이터 로드 실패: ' + (e && e.message) + '</div>';
        } finally {
            if (loadingEl) loadingEl.style.display = 'none';
        }
    };

    // (마) 다크/화이트 모드 토글 — localStorage 기억 후 화면 재렌더(차트/표/카드/배경 갱신)
    //   현재 선택(기간/날짜/소속)을 보존한 뒤 동일 진입점으로 재렌더하고 그대로 복원.
    window.toggleUsageTheme = function () {
        var keep = {
            period: usagePeriod,
            start: (document.getElementById('usage-start-date') || {}).value,
            end: (document.getElementById('usage-end-date') || {}).value
        };
        // 소속 복수선택은 모듈 변수(_usageAffSelection)에 이미 유지되므로 재렌더 후 그대로 살아남음.
        setUsageTheme(getUsageTheme() === 'dark' ? 'light' : 'dark');
        renderUsageStatsContent(container).then(function () {
            var s = document.getElementById('usage-start-date');
            var e = document.getElementById('usage-end-date');
            if (s && keep.start) s.value = keep.start;
            if (e && keep.end) e.value = keep.end;
            if (window.updateUsagePeriod) window.updateUsagePeriod(keep.period || 'daily');
        });
    };

    // 첫 진입: 일별 + 적용
    window.updateUsagePeriod('daily');
}

/**
 * /api/stats/usage 응답으로 요약/차트/표를 그린다.
 * @param {Object} data 서버 집계 응답
 */
function _renderUsageDashboard(data) {
    data = data || {};
    var T = usageThemeTokens();
    document.getElementById('usage-dashboard').style.display = 'block';

    // ── 소속 복수선택 드롭다운 옵션 채우기 (merged 소속 목록 동적 생성) ──
    //   merged = 표준 순서(존재하는 것) + 분포에 추가 등장한 소속.
    var order = data.affiliationOrder || [];
    var present = (data.affiliationDistribution || []).map(function (d) { return d.name; });
    var merged = [];
    order.forEach(function (o) { if (present.indexOf(o) !== -1 && merged.indexOf(o) === -1) merged.push(o); });
    present.forEach(function (p) { if (merged.indexOf(p) === -1) merged.push(p); });
    _usageMergedAffList = merged;
    // 이전 선택 중 더 이상 존재하지 않는 소속은 정리(데이터 변화 대응).
    _usageAffSelection = (_usageAffSelection || []).filter(function (a) { return merged.indexOf(a) !== -1; });
    _usageBuildAffPanel(merged, T);
    _usageUpdateAffButtonLabel();
    _usageUpdateTitleNotes();

    // ── 요약 카드 ──
    document.getElementById('usage-stat-total').textContent = (data.totalEvents || 0).toLocaleString();
    var top = data.topFeature || {};
    document.getElementById('usage-stat-top').textContent = top.key
        ? (usageFeatureLabel(top.key) + ' (' + (top.count || 0).toLocaleString() + ')')
        : '-';
    document.getElementById('usage-stat-assigned').textContent = (data.assignedDeviceCount || 0).toLocaleString();
    document.getElementById('usage-stat-unassigned').textContent = (data.unassignedDeviceCount || 0).toLocaleString();

    // ── 추이 라인차트: 전체 합계 + 기능별(중복 선택) 멀티라인 ──
    var trend = data.trend || [];
    _usageTrendStore = {
        buckets: trend.map(function (t) { return t.bucket; }),
        total: trend.map(function (t) { return t.total; }),
        byFeature: data.trendByFeature || {}
    };
    // 기능 선택 칩(건수 내림차순). 기본은 '전체 합계'만 체크.
    var trendCtrl = document.getElementById('usage-trend-controls');
    if (trendCtrl) {
        var bf0 = data.byFeature || {};
        var featKeys = Object.keys(bf0).sort(function (a, b) { return bf0[b] - bf0[a]; });
        var chip = 'display:inline-flex;align-items:center;gap:4px;white-space:nowrap;padding:4px 10px;border:1px solid ' + T.cardBorder + ';border-radius:14px;background:' + T.ctrlBg + ';color:' + T.muted + ';font-size:0.72rem;cursor:pointer;';
        trendCtrl.innerHTML = '<label style="' + chip + '"><input type="checkbox" id="usage-trend-total" checked onchange="window._usageRedrawTrend()" style="margin:0;"> 전체 합계</label>'
            + featKeys.map(function (k) {
                return '<label style="' + chip + '"><input type="checkbox" class="usage-trend-feat" value="' + k + '" onchange="window._usageRedrawTrend()" style="margin:0;"> ' + usageFeatureLabel(k) + '</label>';
            }).join('');
    }
    window._usageRedrawTrend();

    // ── 소속별 정보 조회수 (도넛/막대 전환) ──
    _usageRenderAffChart();

    // ── 기능별 누적 (막대/도넛 전환) ──
    _usageRenderFeatureChart();

    // 차트유형 토글 버튼 활성 상태 동기화
    _usageSyncTypeToggleUI();
}

// 단조증가 isotonic 회귀(PAVA): 각 라벨을 자연 위치(슬라이스 y)에 최대한 가깝게 두되,
//   인접 라벨이 gap 이상 떨어지도록 만든 위치를 최소 이동으로 계산(한쪽 쏠림 없이 균등 분산).
function _usageIsotonicInc(v) {
    var bv = [], bw = [];
    for (var i = 0; i < v.length; i++) {
        bv.push(v[i]); bw.push(1);
        while (bv.length > 1 && bv[bv.length - 2] > bv[bv.length - 1]) {
            var v2 = bv.pop(), w2 = bw.pop(), v1 = bv.pop(), w1 = bw.pop();
            bw.push(w1 + w2); bv.push((v1 * w1 + v2 * w2) / (w1 + w2));
        }
    }
    var res = [];
    for (var b = 0; b < bv.length; b++) { for (var k = 0; k < bw[b]; k++) res.push(bv[b]); }
    return res;
}

// ── 라벨 플러그인 팩토리 (도넛/막대 공용 재사용) ──
//   도넛: 이름+%·건수, 큰 조각은 링 안쪽 2줄, 작은 조각은 지시선으로 밖에(조각 색 지시선).
function _usageDonutLabelPlugin(T) {
    return {
        id: 'usageDonutLabels',
        afterDraw: function (chart) {
            var ds = chart.data.datasets[0]; if (!ds) return;
            var meta = chart.getDatasetMeta(0);
            var arr = ds.data || [];
            var names = chart.data.labels || [];
            var sum = arr.reduce(function (a, b) { return a + (b || 0); }, 0) || 1;
            var ctx = chart.ctx;
            ctx.save();
            ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
            ctx.lineJoin = 'round';
            var cx = (chart.chartArea.left + chart.chartArea.right) / 2;
            var cyc = (chart.chartArea.top + chart.chartArea.bottom) / 2;   // 도넛 중심
            // 기준(미확대) 외곽 반지름 + 확대 시 최대로 뻗는 반지름 → 라벨 거터(지시선 꺾이는 X)를 그 밖에 둔다.
            var baseR = (meta.data[0] && meta.data[0]._baseOuter) || (meta.data[0] ? meta.data[0].outerRadius : 0);
            var anyExpanded = meta.data.some(function (a) { return a._baseOuter != null && a.outerRadius > a._baseOuter + 1; });
            var gutterR = baseR + (anyExpanded ? (_USAGE_EXPLODE_OFFSET + _USAGE_EXPLODE_GROW + 12) : 16);
            var sides = { left: [], right: [] };
            meta.data.forEach(function (arc, i) {
                var v = arr[i] || 0; if (!v) return;
                var pct = v / sum * 100;
                var mid = (arc.startAngle + arc.endAngle) / 2;
                var name = String(names[i] || '');
                var value = pct.toFixed(1) + '% (' + v.toLocaleString() + ')';
                // 큰 조각은 링 안쪽 2줄(확대 시 조각과 함께 이동). 작은 조각은 바깥 지시선.
                if (pct >= 8) {
                    var r = (arc.innerRadius + arc.outerRadius) / 2;
                    var lx = arc.x + Math.cos(mid) * r, ly0 = arc.y + Math.sin(mid) * r;
                    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.fillStyle = '#fff';
                    ctx.strokeText(name, lx, ly0 - 7); ctx.fillText(name, lx, ly0 - 7);
                    ctx.strokeText(value, lx, ly0 + 8); ctx.fillText(value, lx, ly0 + 8);
                } else {
                    var right = Math.cos(mid) >= 0;   // 조각이 있는 쪽으로 라벨 배치(반대편으로 안 넘김 → 도넛 관통 방지)
                    sides[right ? 'right' : 'left'].push({
                        x: arc.x, y: arc.y, mid: mid, outer: arc.outerRadius, name: name, value: value,
                        sy: arc.y + Math.sin(mid) * arc.outerRadius,
                        color: T.series[i % T.series.length]
                    });
                }
            });
            var canvasW = chart.width;
            var minY = 20, maxY = chart.height - 20;   // 라벨이 캔버스를 벗어나지 않게 가두는 상하 경계
            ['left', 'right'].forEach(function (side) {
                var items = sides[side]; if (!items.length) return;
                var right = side === 'right';
                var dir = right ? 1 : -1;
                items.sort(function (a, b) { return a.sy - b.sy; });
                // 2줄 라벨 간격. 스택이 가용 높이보다 길면 간격을 줄여 모두 들어가게.
                var avail = maxY - minY;
                var gap = 34;
                if (items.length * gap > avail) gap = Math.max(22, Math.floor(avail / items.length));
                // 자연 위치(슬라이스 y)에 최대한 가깝게 두되 겹치면 등간격으로 분산(PAVA) → 조각 근처 + 쏠림/겹침 없음.
                var vv = items.map(function (it, i) { return it.sy - i * gap; });
                var uu = _usageIsotonicInc(vv);
                items.forEach(function (it, i) { it._ly = uu[i] + i * gap; });
                // 캔버스 경계 밖이면 통째로 보정
                var over = items[items.length - 1]._ly - maxY;
                if (over > 0) items.forEach(function (it) { it._ly -= over; });
                var topOver = minY - items[0]._ly;
                if (topOver > 0) items.forEach(function (it) { it._ly += topOver; });
                items.forEach(function (it) {
                    var ly = it._ly;
                    var sx = it.x + Math.cos(it.mid) * it.outer;            // 조각 외곽 edge(확대 시 함께 이동)
                    var syp = it.y + Math.sin(it.mid) * it.outer;
                    var kx = it.x + Math.cos(it.mid) * (it.outer + 8);      // 살짝 방사상으로 나간 점
                    var ky = it.y + Math.sin(it.mid) * (it.outer + 8);
                    var tw = Math.max(ctx.measureText(it.name).width, ctx.measureText(it.value).width);
                    var labelX = cx + dir * (gutterR + 6);                  // 거터(최대확장 반경 밖)에 정렬 → 확대해도 안 가림
                    if (right) labelX = Math.min(labelX, canvasW - tw - 6);
                    else labelX = Math.max(labelX, tw + 6);
                    var gx = labelX - dir * 6;                              // 지시선 꺾임(엘보) X
                    ctx.strokeStyle = it.color; ctx.lineWidth = 1.5;       // 지시선 색 = 해당 조각 색
                    ctx.beginPath(); ctx.moveTo(sx, syp); ctx.lineTo(kx, ky); ctx.lineTo(gx, ly); ctx.lineTo(labelX + (right ? -2 : 2), ly); ctx.stroke();
                    ctx.fillStyle = it.color; ctx.beginPath(); ctx.arc(sx, syp, 2.2, 0, Math.PI * 2); ctx.fill();  // 조각 접점 점
                    ctx.textBaseline = 'middle'; ctx.textAlign = right ? 'left' : 'right';
                    ctx.fillStyle = T.text; ctx.fillText(it.name, labelX, ly - 7);
                    ctx.fillStyle = T.muted; ctx.fillText(it.value, labelX, ly + 8);
                });
            });
            ctx.restore();
        }
    };
}

// 막대 '중앙'에 '건수 · %' 표출(짧으면 왼쪽부터). 어두운 외곽선(헤일로)+흰 글자.
function _usageBarLabelPlugin() {
    return {
        id: 'usageBarLabels',
        afterDatasetsDraw: function (chart) {
            var ctx = chart.ctx;
            var meta = chart.getDatasetMeta(0);
            var data = chart.data.datasets[0].data || [];
            var sum = data.reduce(function (a, b) { return a + (b || 0); }, 0) || 1;
            var x0 = chart.scales.x.getPixelForValue(0);  // 막대 시작(0) 픽셀
            ctx.save();
            ctx.font = 'bold 11px "Noto Sans KR", sans-serif';
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'center';
            ctx.lineJoin = 'round';
            meta.data.forEach(function (bar, i) {
                var v = data[i] || 0;
                var txt = v.toLocaleString() + '건 · ' + (v / sum * 100).toFixed(1) + '%';
                var tw = ctx.measureText(txt).width;
                var barW = bar.x - x0;
                var tx, align;
                if (barW >= tw + 8) { tx = (x0 + bar.x) / 2; align = 'center'; }
                else { tx = x0 + 5; align = 'left'; }
                ctx.textAlign = align;
                ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
                ctx.strokeText(txt, tx, bar.y);
                ctx.fillStyle = '#fff';
                ctx.fillText(txt, tx, bar.y);
            });
            ctx.restore();
        }
    };
}

// 도넛 조각별 그라데이션 배경 (밝은 자기색 → 매우 진한 자기색 대각선).
function _usageDonutSliceBg(T) {
    return function (context) {
        var base = T.series[(context.dataIndex || 0) % T.series.length];
        var chart = context.chart, ctx = chart && chart.ctx, area = chart && chart.chartArea;
        if (!ctx || !area) return base;
        var g = ctx.createLinearGradient(area.left, area.top, area.right, area.bottom);
        g.addColorStop(0, _usageLighten(base, 0.5));
        g.addColorStop(1, _usageDarken(base, 0.45));
        return g;
    };
}

// 소속별 정보 조회수 차트 렌더 (도넛 또는 가로막대). _usageLastData 기준.
function _usageRenderAffChart() {
    var data = _usageLastData || {};
    var T = usageThemeTokens();
    var dist = data.affiliationDistribution || [];
    // 소속 복수선택이 있으면 그 소속만 표출(서버는 전체 분포를 주지만, 드롭다운 선택분만 비교).
    var sel = _usageAffSelection || [];
    if (sel.length) dist = dist.filter(function (d) { return sel.indexOf(d.name) !== -1; });
    var aLabels = dist.map(function (d) { return d.name; });
    var aValues = dist.map(function (d) { return d.total; });
    if (usageAffChart) { try { usageAffChart.destroy(); } catch (e) {} usageAffChart = null; }
    var el = document.getElementById('usage-aff-chart');
    var wrap = document.getElementById('usage-aff-canvas-wrap');
    if (!el || typeof Chart === 'undefined') return;
    if (_usageAffType === 'doughnut') {
        var boxA = _usageDonutBox(aValues);
        if (wrap) wrap.style.height = boxA.height + 'px';
        usageAffChart = _usageMakeDonut(el, aLabels, aValues, T, 'aff', boxA);
    } else {
        if (wrap) wrap.style.height = Math.max(280, aLabels.length * 28 + 40) + 'px';
        usageAffChart = _usageMakeBar(el, aLabels, aValues, T);
    }
}

// 소규모 기능(전체의 GROUP_PCT% 미만)을 "기타" 한 항목으로 묶는다.
//   featRows: [{key,count}] (건수 내림차순). 반환: {labels, values}(라벨 변환 + 기타 말미 추가).
//   묶일 항목이 1개뿐이면 묶지 않고 그대로 둔다(기타 1건짜리는 무의미).
function _usageGroupSmallFeatures(featRows) {
    var GROUP_PCT = 3;
    var total = featRows.reduce(function (s, r) { return s + r.count; }, 0) || 1;
    var big = [], small = [];
    featRows.forEach(function (r) {
        if ((r.count / total * 100) < GROUP_PCT) small.push(r); else big.push(r);
    });
    var labels = big.map(function (r) { return usageFeatureLabel(r.key); });
    var values = big.map(function (r) { return r.count; });
    if (small.length >= 2) {
        var sum = small.reduce(function (s, r) { return s + r.count; }, 0);
        labels.push('기타 (' + small.length + '개 기능)');
        values.push(sum);
    } else {
        small.forEach(function (r) { labels.push(usageFeatureLabel(r.key)); values.push(r.count); });
    }
    return { labels: labels, values: values };
}

// 기능별 누적 차트 렌더 (막대 또는 도넛). _usageLastData 기준.
function _usageRenderFeatureChart() {
    var data = _usageLastData || {};
    var T = usageThemeTokens();
    var byFeature = data.byFeature || {};
    var featRows = Object.keys(byFeature).map(function (k) { return { key: k, count: byFeature[k] }; });
    featRows.sort(function (a, b) { return b.count - a.count; });
    if (usageFeatureChart) { try { usageFeatureChart.destroy(); } catch (e) {} usageFeatureChart = null; }
    var el = document.getElementById('usage-feature-chart');
    var wrap = document.getElementById('usage-feat-canvas-wrap');
    if (!el || typeof Chart === 'undefined') return;
    if (_usageFeatType === 'doughnut') {
        // 도넛은 지시선/조각이 난잡해지므로 소규모(3% 미만) 기능을 "기타"로 묶는다.
        var grouped = _usageGroupSmallFeatures(featRows);
        var boxF = _usageDonutBox(grouped.values);
        if (wrap) wrap.style.height = boxF.height + 'px';
        usageFeatureChart = _usageMakeDonut(el, grouped.labels, grouped.values, T, 'feat', boxF);
    } else {
        // 막대는 세로로 충분하므로 묶지 않고 모든 기능을 상세히 표출한다.
        var labels = featRows.map(function (r) { return usageFeatureLabel(r.key); });
        var values = featRows.map(function (r) { return r.count; });
        if (wrap) wrap.style.height = Math.max(280, values.length * 28 + 40) + 'px';
        usageFeatureChart = _usageMakeBar(el, labels, values, T);
    }
}

// 조각 클릭 확대용 상수: 바깥으로 밀어내는 거리 + 반지름을 키우는 양(확실히 커 보이게).
//   확대량 합(OFFSET+GROW)만큼 도넛 둘레에 여백이 필요 → 아래 layout.padding 과 함께 맞춰야 잘리지 않음.
var _USAGE_EXPLODE_OFFSET = 18;
var _USAGE_EXPLODE_GROW = 22;

// 선택한 "한 조각만" 분리+확대.
//   Chart.js 의 dataset.offset/hoverOffset 은 도넛 전체 반지름을 줄여 공간을 확보하므로
//   클릭 시 "도넛 전체가 반응"하는 문제가 있다. 그래서 offset 을 쓰지 않고,
//   이 플러그인이 그리기 직전(beforeDatasetsDraw)에 선택 조각의 호 기하만 직접 변형한다.
//   - afterUpdate 에서 각 조각의 기준 기하(_base*)를 캐시(클릭 시엔 update 없이 draw 만 하므로 기준 유지)
//   - 기본 도넛 애니메이션은 각도(rotate)만 움직이고 반지름/중심은 건드리지 않으므로 충돌 없음
function _usageDonutExplodePlugin(which) {
    return {
        id: 'usageDonutExplode',
        afterUpdate: function (chart) {
            var meta = chart.getDatasetMeta(0); if (!meta) return;
            meta.data.forEach(function (arc) {
                arc._baseOuter = arc.outerRadius;
                arc._baseX = arc.x;
                arc._baseY = arc.y;
            });
        },
        beforeDatasetsDraw: function (chart) {
            var meta = chart.getDatasetMeta(0); if (!meta) return;
            var idx = (which === 'feat') ? _usageFeatExploded : _usageAffExploded;
            var f = (which === 'feat') ? _usageFeatExplodeF : _usageAffExplodeF;
            meta.data.forEach(function (arc, i) {
                if (arc._baseOuter == null) return;
                if (i === idx && f > 0) {
                    var mid = (arc.startAngle + arc.endAngle) / 2;
                    arc.outerRadius = arc._baseOuter + _USAGE_EXPLODE_GROW * f;
                    arc.x = arc._baseX + Math.cos(mid) * _USAGE_EXPLODE_OFFSET * f;
                    arc.y = arc._baseY + Math.sin(mid) * _USAGE_EXPLODE_OFFSET * f;
                } else {
                    // 나머지(이전에 확대됐던 조각 포함)는 항상 기준 기하로 복원 → 전체 도넛은 그대로.
                    arc.outerRadius = arc._baseOuter;
                    arc.x = arc._baseX;
                    arc.y = arc._baseY;
                }
            });
        }
    };
}

// 확대 진행도(factor)를 from→to 로 부드럽게 애니메이션(update 없이 draw 만 반복 → 도넛 전체 재연출 없음).
function _usageAnimateExplode(chart, which, from, to, done) {
    var start = null, dur = 220;
    function setF(v) { if (which === 'feat') _usageFeatExplodeF = v; else _usageAffExplodeF = v; }
    function step(ts) {
        if (start === null) start = ts;
        var t = Math.min(1, (ts - start) / dur);
        var e = 1 - Math.pow(1 - t, 3);   // easeOutCubic
        setF(from + (to - from) * e);
        try { chart.draw(); } catch (err) {}
        if (t < 1) { requestAnimationFrame(step); }
        else { setF(to); try { chart.draw(); } catch (err) {} if (done) done(); }
    }
    requestAnimationFrame(step);
}

// 클릭 처리: 새 조각 → 그 조각만 0→1 확대(이전 조각은 즉시 복원), 토글/빈영역 → 1→0 축소 후 해제.
function _usageToggleExplode(chart, which, next) {
    var curIdx = (which === 'feat') ? _usageFeatExploded : _usageAffExploded;
    if (next === curIdx) return;
    if (next === -1) {
        // 현재 조각을 축소한 뒤 인덱스 해제(축소 동안은 인덱스 유지).
        _usageAnimateExplode(chart, which, 1, 0, function () {
            if (which === 'feat') _usageFeatExploded = -1; else _usageAffExploded = -1;
        });
    } else {
        // 새 조각으로 전환: 인덱스 즉시 교체(이전 조각은 plugin 이 기준 기하로 복원) + 0→1 확대.
        if (which === 'feat') { _usageFeatExploded = next; _usageFeatExplodeF = 0; }
        else { _usageAffExploded = next; _usageAffExplodeF = 0; }
        _usageAnimateExplode(chart, which, 0, 1, null);
    }
}

// 도넛 가운데 호버 시 정확 횟수를 보여줄 떠다니는 툴팁(공용 1개, 마우스 따라다님).
function _usageGetCenterTip() {
    var el = document.getElementById('usage-center-tip');
    if (!el) {
        el = document.createElement('div');
        el.id = 'usage-center-tip';
        el.style.cssText = 'position:fixed; z-index:100000; pointer-events:none; display:none; padding:6px 10px; border-radius:8px; font-size:0.82rem; font-weight:700; white-space:nowrap; box-shadow:0 6px 20px rgba(0,0,0,0.35);';
        document.body.appendChild(el);
    }
    return el;
}

// 도넛 가운데 총합 표기용 한글 단위 축약: 만 이상 "0.0만", 천 이상 "0.0천", 그 미만은 콤마 숫자.
function _usageFmtCountKo(n) {
    n = n || 0;
    if (n >= 10000) return (n / 10000).toFixed(1) + '만';
    if (n >= 1000) return (n / 1000).toFixed(1) + '천';
    return n.toLocaleString();
}

// 도넛 가운데 총합 텍스트(2줄): 윗줄=설명, 아랫줄="총 ####회". 가운데 빈 공간(cutout)에 맞춰 크기 자동 축소.
function _usageDonutCenterPlugin(T, title) {
    return {
        id: 'usageDonutCenter',
        afterDatasetsDraw: function (chart) {
            var ds = chart.data.datasets[0]; if (!ds) return;
            var sum = (ds.data || []).reduce(function (a, b) { return a + (b || 0); }, 0);
            var meta = chart.getDatasetMeta(0);
            // 안쪽 구멍 반지름(확대 플러그인은 outerRadius/중심만 바꾸므로 innerRadius 는 기준값 유지).
            var inner = (meta.data[0] && meta.data[0].innerRadius) || 60;
            var area = chart.chartArea;
            var cx = (area.left + area.right) / 2;
            var cy = (area.top + area.bottom) / 2;
            var maxW = Math.max(40, inner * 1.7);   // 안쪽 구멍 지름의 약 85%
            var ctx = chart.ctx;
            ctx.save();
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            var line2 = '총 ' + _usageFmtCountKo(sum) + '회';
            var f2 = 22;
            ctx.font = '800 ' + f2 + 'px "Noto Sans KR", sans-serif';
            while (ctx.measureText(line2).width > maxW && f2 > 11) { f2 -= 1; ctx.font = '800 ' + f2 + 'px "Noto Sans KR", sans-serif'; }
            var f1 = Math.max(10, Math.round(f2 * 0.62));
            ctx.fillStyle = T.muted;
            ctx.font = '600 ' + f1 + 'px "Noto Sans KR", sans-serif';
            ctx.fillText(title, cx, cy - (f2 * 0.55));
            ctx.fillStyle = T.text;
            ctx.font = '800 ' + f2 + 'px "Noto Sans KR", sans-serif';
            ctx.fillText(line2, cx, cy + (f1 * 0.7));
            ctx.restore();
        }
    };
}

// 도넛 박스(캔버스) 크기를 내용량+확대를 고려해 유동 계산.
//   - 도넛 반지름은 R 로 고정(좌우/상하 padding 으로 흡수) → 확대해도 둘레 여백(padTB) 안에서 처리.
//   - 지시선 라벨(8% 미만 조각)이 많을수록 세로로 더 키워(한쪽 스택이 들어갈 높이) 잘림 방지.
function _usageDonutBox(values) {
    var sum = values.reduce(function (a, b) { return a + (b || 0); }, 0) || 1;
    var nSmall = values.filter(function (v) { return (v / sum * 100) < 8; }).length;
    var perSide = Math.ceil(nSmall / 2);
    var R = 122;
    var explode = _USAGE_EXPLODE_OFFSET + _USAGE_EXPLODE_GROW;   // 확대 시 둘레로 더 나가는 양
    var donutNeed = 2 * (R + explode) + 36;                       // 도넛지름 + 위아래 확대여유 + 마진
    var labelNeed = perSide * 40 + 96;                            // 한쪽 지시선 스택(2줄, 라벨당 40px) + 상하 마진
    var height = Math.max(donutNeed, labelNeed);
    var padTB = Math.max(explode + 10, Math.round((height - 2 * R) / 2));
    return { height: height, padTB: padTB, padLR: 88, R: R };
}

// 도넛 차트 생성(라벨 플러그인 + 그라데이션 + 조각 클릭 확대 + 가운데 총합). which: 'aff'|'feat'.
function _usageMakeDonut(el, labels, values, T, which, box) {
    box = box || _usageDonutBox(values);
    var exploded = (which === 'feat') ? _usageFeatExploded : _usageAffExploded;
    // 재생성 시(새로고침/테마전환) 이미 확대 상태면 즉시 확대로 표시(재애니메이션 없이).
    if (which === 'feat') _usageFeatExplodeF = (exploded >= 0) ? 1 : 0;
    else _usageAffExplodeF = (exploded >= 0) ? 1 : 0;
    var centerTitle = (which === 'feat') ? '누적사용 정보' : '정보 제공';
    var chart = new Chart(el, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: _usageDonutSliceBg(T),
                borderColor: T.donutBorder,
                borderWidth: 2
                // offset/hoverOffset 미사용: 전체 도넛 축소를 피하고, 선택 조각만 plugin 으로 확대.
            }]
        },
        plugins: [_usageDonutExplodePlugin(which), _usageDonutCenterPlugin(T, centerTitle), _usageDonutLabelPlugin(T)],
        options: {
            responsive: true, maintainAspectRatio: false,
            cutout: '58%',   // 가운데 구멍 크게 → 총합 텍스트 공간 확보
            // 확대된 조각이 잘리지 않도록 둘레 여백을 충분히(상하=확대여유, 좌우=지시선 라벨용). 박스 높이와 함께 유동.
            layout: { padding: { left: box.padLR, right: box.padLR, top: box.padTB, bottom: box.padTB } },
            plugins: { legend: { display: false } },
            // (바) 조각 클릭 → 그 조각만 확대 토글. 빈 영역(조각 밖) 클릭 → 원위치.
            onClick: function (evt, elements, chart) {
                var idx = (elements && elements.length) ? elements[0].index : -1;
                var cur = (which === 'feat') ? _usageFeatExploded : _usageAffExploded;
                // 빈 영역 → 복귀(-1), 같은 조각 재클릭 → 복귀(-1), 다른 조각 → 그 조각 확대.
                var next = (idx === -1 || cur === idx) ? -1 : idx;
                _usageToggleExplode(chart, which, next);
            },
            // 가운데 구멍에 마우스를 올리면 정확한 총횟수를 툴팁으로(축약 없이) 표시.
            onHover: function (event, elements, chart) {
                var tip = _usageGetCenterTip();
                var ca = chart.chartArea;
                var meta = chart.getDatasetMeta(0);
                var inner = (meta && meta.data[0] && meta.data[0].innerRadius) || 0;
                if (!ca || !inner || !event) { tip.style.display = 'none'; return; }
                var cx = (ca.left + ca.right) / 2, cy = (ca.top + ca.bottom) / 2;
                var dx = event.x - cx, dy = event.y - cy;
                if (dx * dx + dy * dy <= inner * inner) {
                    var sum = (chart.data.datasets[0].data || []).reduce(function (a, b) { return a + (b || 0); }, 0);
                    tip.textContent = '총 ' + sum.toLocaleString() + '회';
                    tip.style.background = T.cardBgSolid || '#1b2338';
                    tip.style.color = T.text;
                    tip.style.border = '1px solid ' + T.cardBorder;
                    var ne = event.native;
                    tip.style.left = ((ne ? ne.clientX : 0) + 14) + 'px';
                    tip.style.top = ((ne ? ne.clientY : 0) + 14) + 'px';
                    tip.style.display = 'block';
                    if (chart.canvas) chart.canvas.style.cursor = 'help';
                } else {
                    tip.style.display = 'none';
                    if (chart.canvas) chart.canvas.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
                }
            }
        }
    });
    // 캔버스를 벗어나면 가운데 툴팁 숨김(onHover 는 캔버스 안에서만 발생). 재생성마다 덮어써 중복 방지.
    el.onmouseleave = function () { var t = document.getElementById('usage-center-tip'); if (t) t.style.display = 'none'; };
    return chart;
}

// 가로막대 차트 생성(라벨 플러그인 + 그라데이션). 도넛과 동일 데이터로 전환.
function _usageMakeBar(el, labels, values, T) {
    var maxV = values.length ? Math.max.apply(null, values) : 1;
    return new Chart(el, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: '건수',
                data: values,
                backgroundColor: _usageGrad(T.accent, T.accent2, true),
                borderRadius: 4
            }]
        },
        plugins: [_usageBarLabelPlugin()],
        options: {
            indexAxis: 'y',
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false, beginAtZero: true, max: maxV || 1 },
                y: { ticks: { color: T.text, font: { size: 11 } }, grid: { display: false } }
            }
        }
    });
}

// ============================================================================
// 소속 복수선택 드롭다운 + 차트유형 토글 + 제목 소팅기준 표시 헬퍼
// ============================================================================

// 드롭다운 패널을 현재 소속 목록 + 선택 상태로 다시 그린다.
function _usageBuildAffPanel(merged, T) {
    var panel = document.getElementById('usage-aff-panel');
    if (!panel) return;
    var row = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:6px;cursor:pointer;color:' + T.text + ';font-size:0.82rem;';
    var allChecked = !(_usageAffSelection && _usageAffSelection.length);
    var html = '<label style="' + row + 'font-weight:700;">'
        + '<input type="checkbox" id="usage-aff-all" ' + (allChecked ? 'checked' : '') + ' onchange="window._usageAffOnAll(this)" style="margin:0;"> 전체 소속</label>'
        + '<div style="height:1px;background:' + T.cardBorder + ';margin:4px 0;"></div>';
    html += merged.map(function (m) {
        var chk = (_usageAffSelection.indexOf(m) !== -1) ? 'checked' : '';
        var safe = String(m).replace(/"/g, '&quot;');
        return '<label style="' + row + '"><input type="checkbox" class="usage-aff-opt" value="' + safe + '" ' + chk + ' onchange="window._usageAffOnOne()" style="margin:0;"> ' + m + '</label>';
    }).join('');
    panel.innerHTML = html;
}

// "전체 소속" 체크 처리: 체크 시 나머지 해제(=빈 배열). 해제하려 해도 다른 게 없으면 전체 유지.
window._usageAffOnAll = function (cb) {
    if (cb.checked) {
        _usageAffSelection = [];
    } else {
        // 전체를 끄려는데 개별 선택이 없으면 의미 없음 → 그대로 전체 유지(다시 체크).
        cb.checked = true;
    }
    var T = usageThemeTokens();
    _usageBuildAffPanel(_usageMergedAffList, T);
    _usageUpdateAffButtonLabel();
};

// 개별 소속 체크 처리: 하나라도 체크되면 "전체 소속" 해제. 모두 해제되면 전체로 복귀.
window._usageAffOnOne = function () {
    var opts = Array.prototype.slice.call(document.querySelectorAll('.usage-aff-opt'));
    var sel = opts.filter(function (o) { return o.checked; }).map(function (o) { return o.value; });
    _usageAffSelection = sel;   // 빈 배열이면 전체
    var T = usageThemeTokens();
    _usageBuildAffPanel(_usageMergedAffList, T);
    _usageUpdateAffButtonLabel();
};

// 버튼 요약 라벨: 전체면 "전체 소속", 1개면 그 이름, 2개 이상이면 "OO 외 N".
function _usageUpdateAffButtonLabel() {
    var lbl = document.getElementById('usage-aff-btn-label');
    if (!lbl) return;
    var sel = _usageAffSelection || [];
    if (!sel.length) lbl.textContent = '전체 소속';
    else if (sel.length === 1) lbl.textContent = sel[0];
    else lbl.textContent = sel[0] + ' 외 ' + (sel.length - 1);
}

// 패널 펼침/접힘 토글 + 바깥 클릭 시 닫힘.
window._usageAffTogglePanel = function (evt) {
    if (evt) evt.stopPropagation();
    var panel = document.getElementById('usage-aff-panel');
    if (!panel) return;
    var open = panel.style.display !== 'none' && panel.style.display !== '';
    if (open) { _usageAffClosePanel(); return; }
    panel.style.display = 'block';
    // 바깥 클릭 1회 핸들러 등록(다음 틱에 등록해 이 클릭이 즉시 닫지 않도록).
    setTimeout(function () { document.addEventListener('click', _usageAffOutsideClick); }, 0);
};
function _usageAffClosePanel() {
    var panel = document.getElementById('usage-aff-panel');
    if (panel) panel.style.display = 'none';
    document.removeEventListener('click', _usageAffOutsideClick);
}
function _usageAffOutsideClick(e) {
    var dd = document.getElementById('usage-aff-dd');
    if (dd && !dd.contains(e.target)) _usageAffClosePanel();
}

// 차트 유형 토글(원형/막대). card: 'aff'|'feat'. _usageLastData 로 해당 차트만 재렌더.
window._usageSetChartType = function (card, type) {
    if (type !== 'doughnut' && type !== 'bar') return;
    if (card === 'aff') {
        if (_usageAffType === type) return;
        _usageAffType = type;
        _usageAffExploded = -1;   // 유형 전환 시 확대 상태 초기화
        _usageRenderAffChart();
    } else {
        if (_usageFeatType === type) return;
        _usageFeatType = type;
        _usageFeatExploded = -1;
        _usageRenderFeatureChart();
    }
    _usageSyncTypeToggleUI();
};

// 토글 버튼군 활성 상태(배경/글자색) 동기화.
function _usageSyncTypeToggleUI() {
    var T = usageThemeTokens();
    [['usage-aff-typetoggle', _usageAffType], ['usage-feat-typetoggle', _usageFeatType]].forEach(function (pair) {
        var box = document.getElementById(pair[0]);
        if (!box) return;
        Array.prototype.slice.call(box.querySelectorAll('button[data-type]')).forEach(function (b) {
            if (b.getAttribute('data-type') === pair[1]) {
                b.style.background = 'linear-gradient(135deg,' + T.accent + ',' + T.accent2 + ')';
                b.style.color = '#fff';
            } else {
                b.style.background = 'transparent';
                b.style.color = T.muted;
            }
        });
    });
}

// 제목 옆 기준 표시: 조회 기간(항상) + 선택 소속(있을 때)을 세 카드 제목 옆에 표기.
function _usageUpdateTitleNotes() {
    var sel = _usageAffSelection || [];
    var d = _usageLastData || {};
    var parts = [_usagePeriodRangeText(d)];
    if (sel.length) parts.push(sel.join(', '));
    var note = '· ' + parts.join(' · ');
    ['usage-trend-affnote', 'usage-aff-affnote', 'usage-feat-affnote'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.textContent = note;
    });
}

// 조회 기간 텍스트: start~end. 둘 다 없으면 '전체 기간'.
function _usagePeriodRangeText(d) {
    var s = (d && d.start) || '';
    var e = (d && d.end) || '';
    if (!s && !e) return '전체 기간';
    if (s && e) return s + ' ~ ' + e;
    return s || e;
}

// 추이 차트 재렌더: 체크된 항목(전체 합계 / 기능별 다중)에 맞춰 멀티라인 구성.
//   - 기능별 데이터는 _usageTrendStore.byFeature[key] (서버가 전체 bucket 축에 정렬해 줌).
//   - 기능을 하나도 안 고르면 전체 합계만, 여러 개 고르면 각 기능 라인 + (선택 시)합계.
window._usageRedrawTrend = function () {
    if (!_usageTrendStore) return;
    var T = usageThemeTokens();
    var store = _usageTrendStore;
    var totalCb = document.getElementById('usage-trend-total');
    var showTotal = !totalCb || totalCb.checked;
    var featCbs = Array.prototype.slice.call(document.querySelectorAll('.usage-trend-feat:checked'));
    var datasets = [];
    if (showTotal) {
        datasets.push({
            label: '전체 합계', data: store.total,
            borderColor: _usageGrad(T.accent, T.accent2, true), backgroundColor: _usageGrad(_usageHexToRgba(T.accent, 0.35), _usageHexToRgba(T.accent, 0), false),
            fill: featCbs.length === 0, tension: 0.3, pointRadius: 2, pointBackgroundColor: T.accent2
        });
    }
    featCbs.forEach(function (cb, i) {
        var key = cb.value;
        var arr = store.byFeature[key] || [];
        var col = T.series[i % T.series.length];
        datasets.push({
            label: usageFeatureLabel(key),
            data: arr.map(function (p) { return p.total; }),
            borderColor: col, backgroundColor: _usageHexToRgba(col, 0.10),
            fill: false, tension: 0.3, pointRadius: 2, pointBackgroundColor: col
        });
    });
    if (!datasets.length) {
        datasets.push({
            label: '전체 합계', data: store.total,
            borderColor: _usageGrad(T.accent, T.accent2, true), backgroundColor: _usageGrad(_usageHexToRgba(T.accent, 0.35), _usageHexToRgba(T.accent, 0), false),
            fill: true, tension: 0.3, pointRadius: 2, pointBackgroundColor: T.accent2
        });
    }
    if (usageTrendChart) { try { usageTrendChart.destroy(); } catch (e) {} usageTrendChart = null; }
    var el = document.getElementById('usage-trend-chart');
    if (el && typeof Chart !== 'undefined') {
        usageTrendChart = new Chart(el, {
            type: 'line',
            data: { labels: store.buckets, datasets: datasets },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { labels: { color: T.muted, boxWidth: 12, font: { size: 11 } } } },
                scales: {
                    x: { ticks: { color: T.faint }, grid: { color: T.gridLine } },
                    y: { beginAtZero: true, ticks: { color: T.faint }, grid: { color: T.gridLine } }
                }
            }
        });
    }
};

// hex(#rrggbb) → rgba 문자열 (차트 fill 투명도용)
function _usageHexToRgba(hex, alpha) {
    try {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.substring(0, 2), 16);
        var g = parseInt(h.substring(2, 4), 16);
        var b = parseInt(h.substring(4, 6), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    } catch (e) { return 'rgba(59,130,246,' + alpha + ')'; }
}

// 차트용 그라데이션 (Chart.js scriptable). chartArea 준비 전(최초 렌더)엔 단색(c1) 폴백.
//   horizontal=true: 좌→우 (가로막대/추이선용), false: 위→아래 (영역 채우기/도넛 sheen용)
function _usageGrad(c1, c2, horizontal) {
    return function (context) {
        var chart = context.chart;
        var ctx = chart && chart.ctx;
        var area = chart && chart.chartArea;
        if (!ctx || !area) return c1;
        var g = horizontal
            ? ctx.createLinearGradient(area.left, 0, area.right, 0)
            : ctx.createLinearGradient(0, area.top, 0, area.bottom);
        g.addColorStop(0, c1);
        g.addColorStop(1, c2);
        return g;
    };
}

// hex 를 흰색 쪽으로 amt(0~1) 만큼 밝게.
function _usageLighten(hex, amt) {
    try {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
        r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    } catch (e) { return hex; }
}

// hex 를 검정 쪽으로 amt(0~1) 만큼 어둡게.
function _usageDarken(hex, amt) {
    try {
        var h = String(hex).replace('#', '');
        if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
        var r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
        r = Math.round(r * (1 - amt)); g = Math.round(g * (1 - amt)); b = Math.round(b * (1 - amt));
        return 'rgb(' + r + ',' + g + ',' + b + ')';
    } catch (e) { return hex; }
}

// ============================================================================
// (나) CSV 추출 — 현재 선택된 기간/소속 필터가 반영된 집계를 CSV 로 다운로드.
//   한글 깨짐 방지 BOM(﻿) 포함. routes/survey.js CSV 패턴과 동일.
//   클라이언트에서 마지막 응답(_usageLastData)을 CSV 문자열로 만들어 Blob 다운로드.
//   내용: ① 메타(기간/소속) ② 기능별 건수+비중 ③ 소속 분포 ④ 기간 추이(날짜별 합계).
// ============================================================================
function _csvCell(v) {
    return '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
}
// CSV 내보내기 범위 선택 팝업 (전체 / 특정 기간 / 월별) → 확인 시 cb({mode,start,end}).
//   앱(Capacitor WebView)에서 blob/data URL 다운로드가 안 되므로, 호출부는 cb 안에서
//   실제 서버 URL(/api/stats/usage/csv)로 이동시켜 다운로드한다(설문 CSV와 동일 원리).
function _usageCsvScopePopup(q, cb) {
    var T = usageThemeTokens();
    var defStart = (q && q.start) || new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    var defEnd = (q && q.end) || new Date().toISOString().slice(0, 10);
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
        '<div style="background:' + (T.cardBgSolid || '#1e2435') + ';border:1px solid ' + T.cardBorder + ';border-radius:14px;padding:20px;max-width:360px;width:100%;color:' + T.text + ';box-shadow:0 12px 40px rgba(0,0,0,0.5);">'
        + '<div style="font-weight:800;font-size:1rem;margin-bottom:14px;"><i class="fa-solid fa-file-csv"></i> CSV 내보내기 범위</div>'
        + '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="radio" name="usage-csv-scope" value="all" checked> 전체 데이터</label>'
        + '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="radio" name="usage-csv-scope" value="monthly"> 월별 집계(전체 기간)</label>'
        + '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="radio" name="usage-csv-scope" value="range"> 특정 기간 지정</label>'
        + '<div id="usage-csv-range" style="display:none;gap:8px;align-items:center;margin:6px 0 4px;flex-wrap:wrap;">'
        + '<input type="date" id="usage-csv-start" value="' + defStart + '" style="background:' + T.inputBg + ';border:1px solid ' + T.ctrlBorder + ';border-radius:6px;color:' + T.text + ';padding:5px 8px;font-size:0.85rem;">'
        + '<span style="color:' + T.faint + ';">~</span>'
        + '<input type="date" id="usage-csv-end" value="' + defEnd + '" style="background:' + T.inputBg + ';border:1px solid ' + T.ctrlBorder + ';border-radius:6px;color:' + T.text + ';padding:5px 8px;font-size:0.85rem;">'
        + '</div>'
        + '<div style="display:flex;gap:10px;margin-top:16px;">'
        + '<button id="usage-csv-cancel" style="flex:1;padding:10px;background:' + T.ctrlBg + ';border:1px solid ' + T.ctrlBorder + ';border-radius:8px;color:' + T.muted + ';cursor:pointer;">취소</button>'
        + '<button id="usage-csv-ok" style="flex:1;padding:10px;background:linear-gradient(135deg,' + T.accent + ',' + T.accent2 + ');border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;">확인 · 다운로드</button>'
        + '</div></div>';
    document.body.appendChild(ov);
    // [뒤로가기] 팝업을 PopupStack 에 등록 → 하드웨어 뒤로가기로 팝업부터 닫힘.
    if (window.PopupStack) window.PopupStack.push('usage-csv-popup', function () { ov.remove(); });
    var close = function () { if (window.PopupStack) window.PopupStack.remove('usage-csv-popup'); ov.remove(); };
    var rangeBox = ov.querySelector('#usage-csv-range');
    ov.querySelectorAll('input[name="usage-csv-scope"]').forEach(function (r) {
        r.addEventListener('change', function () { rangeBox.style.display = (ov.querySelector('input[name="usage-csv-scope"]:checked').value === 'range') ? 'flex' : 'none'; });
    });
    ov.querySelector('#usage-csv-cancel').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#usage-csv-ok').onclick = function () {
        var mode = ov.querySelector('input[name="usage-csv-scope"]:checked').value;
        var start = mode === 'range' ? (ov.querySelector('#usage-csv-start').value || '') : '';
        var end = mode === 'range' ? (ov.querySelector('#usage-csv-end').value || '') : '';
        close();
        cb({ mode: mode, start: start, end: end });
    };
}

// CSV 등 서버 파일 URL 다운로드. 앱(Capacitor WebView)은 <a download>/첨부파일을
//   자체적으로 내려받지 못하므로, 네이티브에서는 시스템 브라우저(@capacitor/browser)로 열어
//   브라우저가 파일을 다운로드하게 한다. 데스크톱/웹은 기존 <a download>.
function _usageOpenDownloadUrl(url) {
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
    var anchorDl = function () {
        var a = document.createElement('a');
        a.href = url; a.download = ''; a.target = '_blank';
        document.body.appendChild(a); a.click(); a.remove();
    };
    if (isNative && Browser && Browser.open) {
        // 시스템 브라우저는 절대 URL 필요 — 상대경로면 현재 origin 을 붙인다.
        var abs = /^https?:\/\//.test(url) ? url : (window.location.origin + url);
        try {
            var p = Browser.open({ url: abs });
            if (p && typeof p.catch === 'function') p.catch(anchorDl);
            return;
        } catch (e) { /* 폴백 */ }
    }
    anchorDl();
}

// 이용자 현황 > 방문자 통계 CSV — 범위 선택 팝업 재사용 + 서버 URL(WebView 호환).
window.exportVisitorCsv = function () {
    if (typeof _usageCsvScopePopup !== 'function') { alert('내보내기 모듈을 불러올 수 없습니다.'); return; }
    _usageCsvScopePopup({}, function (scope) {
        var period = scope.mode === 'monthly' ? 'monthly' : 'daily';
        var base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) ? CONFIG.API_BASE : '';
        var url = base + '/api/stats/visitors/csv?period=' + encodeURIComponent(period)
            + '&start=' + encodeURIComponent(scope.start || '')
            + '&end=' + encodeURIComponent(scope.end || '');
        _usageOpenDownloadUrl(url);
    });
};

window.exportUsageCsv = function () {
    var q = _usageLastQuery || {};
    _usageCsvScopePopup(q, function (scope) {
        var period = scope.mode === 'monthly' ? 'monthly' : 'daily';
        var base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) ? CONFIG.API_BASE : '';
        var url = base + '/api/stats/usage/csv?period=' + encodeURIComponent(period)
            + '&start=' + encodeURIComponent(scope.start || '')
            + '&end=' + encodeURIComponent(scope.end || '')
            + '&affiliation=' + encodeURIComponent(q.affiliation || '전체');
        // 실제 서버 URL 이동 → WebView/브라우저 모두에서 다운로드 동작.
        _usageOpenDownloadUrl(url);
    });
};

// ============================================================================
// (다) 표/그래프 이미지(PNG) 다운로드 — 각 요소별 + 통합(전체 대시보드).
//   - 개별 차트(Chart.js): chart.toBase64Image() 로 선명한 PNG 추출 후 테마 배경 합성.
//   - 표/카드/통합 대시보드 DOM: html2canvas 로 캡처(현재 테마 배경색을 백그라운드로).
//   - 결과물은 (마)에 따라 현재 선택 모드(다크/화이트) 팔레트를 그대로 따른다.
//   target: 'trend' | 'aff' | 'feature' | 'dashboard'
//
// [개선 1 — 지연 로딩] html2canvas(약 200KB)는 index2.html 에 전역 로드하지 않고,
//   관리자가 DOM 캡처(feature/dashboard)를 실제로 호출할 때만 _ensureHtml2Canvas() 가
//   <script> 를 1회 주입(이후 캐시)한다 → 일반 사용자는 내려받지 않는다.
// [개선 2 — 폰트/렌더 타이밍] 캡처 직전 document.fonts.ready + Chart.js 애니메이션
//   완료 + 추가 1프레임을 보장(_usageCaptureReady) → FontAwesome 글리프 누락 방지.
// ============================================================================

// html2canvas 지연 로더 — 최초 호출 시 <script> 주입, 이후 캐시된 Promise 재사용.
var _html2canvasLoader = null;
function _ensureHtml2Canvas() {
    if (typeof window.html2canvas !== 'undefined') return Promise.resolve(window.html2canvas);
    if (_html2canvasLoader) return _html2canvasLoader;
    _html2canvasLoader = new Promise(function (resolve, reject) {
        try {
            var s = document.createElement('script');
            s.src = '/assets/vendor/html2canvas/html2canvas.min.js';
            s.async = true;
            s.onload = function () {
                if (typeof window.html2canvas !== 'undefined') resolve(window.html2canvas);
                else reject(new Error('html2canvas 로드 후에도 전역 미정의'));
            };
            s.onerror = function () {
                _html2canvasLoader = null; // 실패 시 다음 호출에서 재시도 가능
                reject(new Error('html2canvas 스크립트 로드 실패'));
            };
            document.head.appendChild(s);
        } catch (e) { _html2canvasLoader = null; reject(e); }
    });
    return _html2canvasLoader;
}

// 캡처 직전 폰트/차트 애니메이션 렌더 완료 보장.
//   - document.fonts.ready: FontAwesome 등 웹폰트 글리프가 캡처에 빠지지 않도록.
//   - Chart.js 애니메이션: 진행 중이면 즉시 완료(완성 프레임을 캡처).
//   - 추가 1프레임(rAF) 대기로 DOM/캔버스 페인트 반영.
function _usageCaptureReady() {
    return new Promise(function (resolve) {
        var done = function () {
            try {
                // 진행 중 차트 애니메이션을 완료 상태로 강제(스냅) → 완성 프레임 캡처.
                [usageTrendChart, usageAffChart, usageFeatureChart].forEach(function (c) {
                    if (c) { try { c.update('none'); } catch (e) {} }
                });
            } catch (e) {}
            // 폰트/차트 반영 후 한 프레임 더 기다렸다 캡처.
            (window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(function () {
                (window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(resolve);
            });
        };
        try {
            if (document.fonts && document.fonts.ready && typeof document.fonts.ready.then === 'function') {
                document.fonts.ready.then(done, done);
            } else { done(); }
        } catch (e) { done(); }
    });
}

// 공용 PC(넓은) 배열 캡처 — 대상 요소(카드/대시보드)를 임시로 넓은 폭(1024px)으로 확장하고
//   포함된 차트를 그 폭에 맞춰 리사이즈한 뒤 html2canvas 로 캡처, 끝나면 원래 폭으로 복원한다.
//   → 폰의 좁은 세로 배열이 아니라 PC 화면처럼 넓게 배열된 이미지를 저장한다(모든 내보내기 공통).
// 대상(카드/대시보드)을 이미지로 캡처. wide=true 면 PC(넓은 1024px) 배열, false 면 현재
//   폰 화면 폭 그대로(모바일 버전). 끝나면 원래 폭으로 복원.
function _usageCaptureWide(el, charts, T, filename, wide) {
    if (!el) { alert('캡처할 영역을 찾지 못했습니다.'); return; }
    var WIDE = 1024;
    var prevW = el.style.width, prevMax = el.style.maxWidth;
    if (wide) {
        el.style.width = WIDE + 'px';
        el.style.maxWidth = 'none';
        (charts || []).forEach(function (c) { if (c) { try { c.resize(); } catch (e) {} } });
    }
    var restore = function () {
        if (!wide) return;
        el.style.width = prevW; el.style.maxWidth = prevMax;
        (charts || []).forEach(function (c) { if (c) { try { c.resize(); } catch (e) {} } });
    };
    var raf = window.requestAnimationFrame || function (cb) { setTimeout(cb, 32); };
    raf(function () { raf(function () {  // 폭 변경 + 차트 리사이즈 반영을 위해 2프레임 대기
        _ensureHtml2Canvas().then(function (h2c) {
            var opts = { backgroundColor: T.appBgSolid, scale: 2, useCORS: true, logging: false };
            if (wide) { opts.width = WIDE; opts.windowWidth = WIDE; }
            return h2c(el, opts);
        }).then(function (canvas) {
            restore();
            _usageTriggerDownload(canvas.toDataURL('image/png'), filename, false);
        }).catch(function (e) {
            restore();
            alert('이미지 캡처 실패: ' + (e && e.message));
        });
    }); });
}

// 이미지 저장 형식 선택 팝업 (데스크탑=넓은 PC 배열 / 모바일=현재 폰 화면) → cb('desktop'|'mobile').
function _usageImageModePopup(cb) {
    var T = usageThemeTokens();
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;padding:16px;';
    ov.innerHTML =
        '<div style="background:' + (T.cardBgSolid || '#1e2435') + ';border:1px solid ' + T.cardBorder + ';border-radius:14px;padding:20px;max-width:360px;width:100%;color:' + T.text + ';box-shadow:0 12px 40px rgba(0,0,0,0.5);">'
        + '<div style="font-weight:800;font-size:1rem;margin-bottom:14px;"><i class="fa-solid fa-image"></i> 이미지 저장 형식</div>'
        + '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="radio" name="usage-img-mode" value="desktop" checked> 데스크탑 버전 <span style="color:' + T.faint + ';font-size:0.76rem;">(넓은 PC 배열)</span></label>'
        + '<label style="display:flex;align-items:center;gap:8px;padding:8px 0;cursor:pointer;"><input type="radio" name="usage-img-mode" value="mobile"> 모바일 버전 <span style="color:' + T.faint + ';font-size:0.76rem;">(현재 폰 화면 그대로)</span></label>'
        + '<div style="display:flex;gap:10px;margin-top:16px;">'
        + '<button id="usage-imgm-cancel" style="flex:1;padding:10px;background:' + T.ctrlBg + ';border:1px solid ' + T.ctrlBorder + ';border-radius:8px;color:' + T.muted + ';cursor:pointer;">취소</button>'
        + '<button id="usage-imgm-ok" style="flex:1;padding:10px;background:linear-gradient(135deg,' + T.accent + ',' + T.accent2 + ');border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;">확인 · 저장</button>'
        + '</div></div>';
    document.body.appendChild(ov);
    if (window.PopupStack) window.PopupStack.push('usage-imgmode-popup', function () { ov.remove(); });
    var close = function () { if (window.PopupStack) window.PopupStack.remove('usage-imgmode-popup'); ov.remove(); };
    ov.querySelector('#usage-imgm-cancel').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    ov.querySelector('#usage-imgm-ok').onclick = function () {
        var m = ov.querySelector('input[name="usage-img-mode"]:checked').value;
        close();
        cb(m);
    };
}

window.exportUsageImage = function (target) {
    // 먼저 데스크탑/모바일 버전 선택 → 선택에 따라 캡처 폭 결정.
    _usageImageModePopup(function (viewMode) {
        var T = usageThemeTokens();
        var mode = getUsageTheme();
        var ymd = new Date().toISOString().slice(0, 10);
        var suffix = '_' + mode + '_' + viewMode + '_' + ymd + '.png';
        var wide = (viewMode === 'desktop');
        _usageCaptureReady().then(function () {
            if (target === 'trend') {
                _usageCaptureWide(document.getElementById('usage-trend-card'), [usageTrendChart], T, 'seagnal_usage_trend' + suffix, wide);
            } else if (target === 'aff') {
                _usageCaptureWide(document.getElementById('usage-aff-card'), [usageAffChart], T, 'seagnal_usage_affiliation' + suffix, wide);
            } else if (target === 'feature') {
                _usageCaptureWide(document.getElementById('usage-feature-card'), [usageFeatureChart], T, 'seagnal_usage_feature' + suffix, wide);
            } else if (target === 'dashboard') {
                _usageCaptureWide(document.getElementById('usage-root'), [usageTrendChart, usageAffChart, usageFeatureChart], T, 'seagnal_usage_dashboard' + suffix, wide);
            }
        });
    });
};

// Chart.js 단독 → toBase64Image()(선명) + 테마 배경 합성 후 PNG 다운로드.
function _usageDownloadChart(chart, T, filename) {
    try {
        // (개선) 차트 픽셀은 toBase64Image() 로 추출(투명 배경 PNG). 테마 배경 위에 합성.
        var w = chart.canvas.width, h = chart.canvas.height;
        var pad = 24;
        var img = new Image();
        img.onload = function () {
            try {
                var out = document.createElement('canvas');
                out.width = w + pad * 2;
                out.height = h + pad * 2;
                var ctx = out.getContext('2d');
                ctx.fillStyle = T.appBgSolid;       // 현재 모드 배경
                ctx.fillRect(0, 0, out.width, out.height);
                ctx.drawImage(img, pad, pad, w, h);
                _usageTriggerDownload(out.toDataURL('image/png'), filename, false);
            } catch (e) {
                // 합성 실패 시 차트 base64 직접 다운로드.
                try { _usageTriggerDownload(chart.toBase64Image(), filename, false); } catch (e2) { alert('이미지 추출 실패: ' + (e2 && e2.message)); }
            }
        };
        img.onerror = function () {
            // 라이브 캔버스 직접 합성 폴백.
            try {
                var out2 = document.createElement('canvas');
                out2.width = w + pad * 2;
                out2.height = h + pad * 2;
                var c2 = out2.getContext('2d');
                c2.fillStyle = T.appBgSolid;
                c2.fillRect(0, 0, out2.width, out2.height);
                c2.drawImage(chart.canvas, pad, pad, w, h);
                _usageTriggerDownload(out2.toDataURL('image/png'), filename, false);
            } catch (e3) { alert('이미지 추출 실패: ' + (e3 && e3.message)); }
        };
        img.src = chart.toBase64Image();
    } catch (e) {
        try { _usageTriggerDownload(chart.toBase64Image(), filename, false); } catch (e2) { alert('이미지 추출 실패: ' + (e2 && e2.message)); }
    }
}

// DOM 영역(카드/표/대시보드) → html2canvas 로 PNG (현재 모드 배경).
//   html2canvas 는 지연 로더(_ensureHtml2Canvas)로 이 시점에만 동적 로드.
function _usageCaptureDom(el, T, filename) {
    if (!el) { alert('캡처할 영역을 찾지 못했습니다.'); return; }
    _ensureHtml2Canvas().then(function (h2c) {
        return h2c(el, {
            backgroundColor: T.appBgSolid,  // 현재 선택 모드 배경 → 보고서용 밝은/어두운 이미지
            scale: 2,                       // 고해상도(보고서 품질)
            useCORS: true,
            logging: false
        });
    }).then(function (canvas) {
        _usageTriggerDownload(canvas.toDataURL('image/png'), filename, false);
    }).catch(function (e) {
        alert('이미지 캡처 라이브러리 로드/캡처 실패: ' + (e && e.message));
    });
}

// 공통 다운로드 트리거 (url=objectURL/blob 이면 revoke)
//   앱(Capacitor WebView)에서는 data:image PNG 의 <a download> 가 동작하지 않으므로,
//   이미지 데이터 URL 은 모달로 띄워 사용자가 길게 눌러 저장/공유하게 한다(브라우저는 기존 다운로드).
function _usageTriggerDownload(href, filename, revoke) {
    var isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    if (isNative && /^data:image\//.test(String(href))) {
        // 앱(WebView)은 data:image 의 <a download>/길게눌러저장이 안 됨 → 서버 중계 후 시스템 브라우저로 다운로드.
        _usageSaveImageNative(href, filename);
        return;
    }
    var a = document.createElement('a');
    a.href = href;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (revoke) { setTimeout(function () { try { URL.revokeObjectURL(href); } catch (e) {} }, 1500); }
}

// 앱(네이티브)에서 PNG 저장: 서버에 잠깐 업로드(토큰) → 시스템 브라우저로 GET 열어 다운로드(CSV 원리).
//   길게눌러저장 모달은 WebView 에서 동작하지 않고 닫기까지 막혀 제거함.
function _usageSaveImageNative(dataUrl, filename) {
    try {
        var base = (typeof CONFIG !== 'undefined' && CONFIG.API_BASE) ? CONFIG.API_BASE : '';
        fetch(base + '/api/stats/usage/image?name=' + encodeURIComponent(filename || 'seagnal_usage.png'), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: dataUrl
        }).then(function (r) { return r.json(); }).then(function (j) {
            if (!j || !j.token) throw new Error('토큰 없음');
            var url = window.location.origin + '/api/stats/usage/image/' + j.token;
            var Browser = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Browser;
            if (Browser && Browser.open) {
                var p = Browser.open({ url: url });
                if (p && typeof p.catch === 'function') p.catch(function () { window.open(url, '_blank'); });
            } else {
                window.open(url, '_blank');
            }
        }).catch(function (e) {
            alert('이미지 저장 실패: ' + (e && e.message));
        });
    } catch (e) {
        alert('이미지 저장 실패: ' + (e && e.message));
    }
}

// ============================================================================
// (F) 가로보기 — 기기 화면을 가로로 회전(잠금)해 넓게 본다. 사용량 영역을 나가면(모달
//   닫힘/탭 이동으로 #usage-root 가 DOM 에서 제거되면) 자동으로 세로로 복귀한다.
//   화면회전은 @capacitor/screen-orientation (window.Capacitor.Plugins.ScreenOrientation).
// ============================================================================
var _usageLandscapeOn = false;
var _usageLeaveObserver = null;
function _usageOrientationPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.ScreenOrientation) || null;
}
function _usageUpdateLandscapeBtn() {
    var b = document.getElementById('usage-landscape-toggle');
    if (b) b.innerHTML = '<i class="fa-solid fa-mobile-screen fa-rotate-90"></i> ' + (_usageLandscapeOn ? '세로' : '가로');
}
function _usageExitLandscape() {
    var p = _usageOrientationPlugin();
    if (p) { try { if (p.unlock) p.unlock(); else p.lock({ orientation: 'portrait' }); } catch (e) {} }
    _usageLandscapeOn = false;
    if (_usageLeaveObserver) { try { _usageLeaveObserver.disconnect(); } catch (e) {} _usageLeaveObserver = null; }
    _usageUpdateLandscapeBtn();
}
window.toggleUsageLandscape = function () {
    var p = _usageOrientationPlugin();
    if (!p) { alert('이 기기에서는 가로보기(화면 회전)를 지원하지 않습니다. PC 브라우저에서는 창을 넓히면 동일하게 넓은 화면으로 보입니다.'); return; }
    if (_usageLandscapeOn) { _usageExitLandscape(); return; }
    try { p.lock({ orientation: 'landscape' }); } catch (e) { alert('화면 회전 전환 실패: ' + (e && e.message)); return; }
    _usageLandscapeOn = true;
    _usageUpdateLandscapeBtn();
    // 사용량 영역(#usage-root)이 사라지면 자동 세로 복귀.
    var root = document.getElementById('usage-root');
    if (root && window.MutationObserver) {
        _usageLeaveObserver = new MutationObserver(function () {
            if (!document.body.contains(root)) _usageExitLandscape();
        });
        _usageLeaveObserver.observe(document.body, { childList: true, subtree: true });
    }
};

// 기존 관리 함수들 리다이렉션 (하위 호환성 유지)
// 홍보 게시글 관리는 통합 관리자(unified-admin-modal) > "게시판 관리" 탭에서 처리.
// 별도 오렌지 팝업(showPromoManagementModal) 은 제거됨.
window.showNoticeManagementModal = () => showUnifiedAdminModal('notice');
window.showApiManagementModal = () => showUnifiedAdminModal('api');
window.showAlertManagementModal = () => showUnifiedAdminModal('alert');

// 2. 관리 모달 구현체들 (기존 함수는 이제 helper로 사용되거나 제거 가능)

// (A) 공지 팝업 관리
window.showNoticeManagementModal = async function () {
    if (!adminAuthenticated.notice) return;

    // 공지 데이터 로드
    let notices = { active: [], expired: [] };
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        if (res.ok) notices = await res.json();
    } catch (e) {
        // console.error(e);
        try {
            const res2 = await fetch(CONFIG.NOTICE_API_URL);
            if (res2.ok) {
                const old = await res2.json();
                if (old.isActive) notices.active = [old];
            }
        } catch (e2) { }
    }

    const existingModal = document.getElementById('notice-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'notice-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    // 시간 옵션
    const hourOptions = Array.from({ length: 24 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}시</option>`).join('');
    const minuteOptions = Array.from({ length: 60 }, (_, i) => `<option value="${i}">${String(i).padStart(2, '0')}분</option>`).join('');
    const now = new Date();
    const defaultDate = now.toISOString().split('T')[0];
    const nextHour = new Date(now.getTime() + 60 * 60 * 1000);

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#ffd54f,#ffb300);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#1a1f2e;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-bell"></i> 공지 팝업 관리
                </h3>
                <button onclick="document.getElementById('notice-management-modal').remove();" 
                        style="background:rgba(0,0,0,0.2);border:none;color:#1a1f2e;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            
            <div style="padding:16px;" id="notice-management-content">
                
                <!-- 현재 진행 중인 공지사항 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(6, 95, 70, 0.5); color: #a7f3d0; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(167, 243, 208, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-circle-check" style="margin-right:6px;"></i> 현재 진행 중인 공지
                    </div>
                    <div id="active-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(167, 243, 208, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.active && notices.active.length > 0 ? notices.active.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #fff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '제목 없음'}</div>
                                    <div style="font-size: 0.75rem; color: #94a3b8;"><i class="fa-regular fa-clock"></i> ~ ${n.expiresAt || '기한 없음'}</div>
                                </div>
                                <div style="display: flex; gap: 6px; flex-shrink: 0;">
                                    <button onclick="editNotice(${n.id})" style="background: rgba(59, 130, 246, 0.2); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">수정</button>
                                    <button onclick="deleteNoticeById(${n.id})" style="background: rgba(239, 68, 68, 0.2); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.4); padding: 4px 8px; border-radius: 6px; font-size: 0.75rem; cursor: pointer;">삭제</button>
                                </div>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">진행 중인 공지가 없습니다</div>'}
                    </div>
                </div>

                <!-- 종료된 공지사항 -->
                <div style="margin-bottom: 20px;">
                    <div style="background: rgba(68, 64, 60, 0.5); color: #d6d3d1; padding: 8px 12px; border-radius: 8px 8px 0 0; font-weight: 600; font-size: 0.9rem; border: 1px solid rgba(214, 211, 209, 0.2); border-bottom: none;">
                        <i class="fa-solid fa-clock-rotate-left" style="margin-right:6px;"></i> 종료된 공지
                    </div>
                    <div id="expired-notices-list" style="background: rgba(30, 41, 59, 0.6); border: 1px solid rgba(214, 211, 209, 0.2); border-radius: 0 0 8px 8px; max-height: 150px; overflow-y: auto;">
                        ${notices.expired && notices.expired.length > 0 ? notices.expired.map(n => `
                            <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05);">
                                <div style="flex: 1; min-width: 0; padding-right: 10px;">
                                    <div style="font-size: 0.9rem; color: #cbd5e1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 2px;">${n.title || '제목 없음'}</div>
                                    <div style="font-size: 0.75rem; color: #64748b;">종료: ${n.expiresAt || '-'}</div>
                                </div>
                                <button onclick="reactivateNotice(${n.id})" style="background: rgba(99, 102, 241, 0.2); color: #818cf8; border: 1px solid rgba(99, 102, 241, 0.4); padding: 4px 10px; border-radius: 6px; font-size: 0.75rem; cursor: pointer; flex-shrink: 0;">재등록</button>
                            </div>
                        `).join('') : '<div style="padding: 16px; text-align: center; color: #64748b; font-size: 0.85rem;">종료된 공지가 없습니다</div>'}
                    </div>
                </div>

                <!-- 작성 폼 -->
                <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px;">
                    <div style="font-weight: 600; font-size: 0.95rem; color: #e2e8f0; margin-bottom: 12px; display:flex; align-items:center; gap:8px;">
                        <i class="fa-solid fa-pen-nib" style="color:#ffd54f;"></i> 새 공지 작성 / 수정
                    </div>
                    
                    <input type="hidden" id="notice-edit-id" value="">
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">제목</label>
                        <input type="text" id="notice-title" style="width: 100%; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.95rem; box-sizing: border-box;" placeholder="예: 서버 점검 안내">
                    </div>
                    
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">내용</label>
                        <textarea id="notice-content" style="width: 100%; height: 80px; padding: 10px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 0.9rem; resize: none; box-sizing: border-box;" placeholder="내용을 입력하세요..."></textarea>
                    </div>
                    
                    <div style="margin-bottom: 16px;">
                        <label style="display: block; font-size: 0.8rem; color: #94a3b8; margin-bottom: 6px;">종료 일시</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="date" id="notice-expire-date" value="${defaultDate}" style="flex: 2; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">
                            <select id="notice-expire-hour" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${hourOptions}</select>
                            <select id="notice-expire-minute" style="flex: 1; padding: 8px; background: rgba(0,0,0,0.2); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff;">${minuteOptions}</select>
                        </div>
                    </div>
                    
                    <button onclick="saveNotice()" style="width: 100%; padding: 12px; background: linear-gradient(135deg, #ffd54f, #ffb300); color: #1a1e2e; border: none; border-radius: 8px; font-weight: 600; font-size: 0.95rem; cursor: pointer; transition: transform 0.2s;">
                        <i class="fa-solid fa-paper-plane" style="margin-right:6px;"></i> 공지 등록하기
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // 기본 시간 설정
    document.getElementById('notice-expire-hour').value = nextHour.getHours();
    document.getElementById('notice-expire-minute').value = 0;
};

// 헬퍼: 공지 수정 모드
window.editNotice = async function (id) {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices');
        const data = await res.json();
        const allNotices = [...(data.active || []), ...(data.expired || [])];
        const target = allNotices.find(n => String(n.id) === String(id));

        if (target) {
            document.getElementById('notice-edit-id').value = target.id;
            document.getElementById('notice-title').value = target.title;
            document.getElementById('notice-content').value = target.content;

            if (target.expiresAt) {
                const [datePart, timePart] = target.expiresAt.split(' ');
                document.getElementById('notice-expire-date').value = datePart;
                if (timePart) {
                    const [h, m] = timePart.split(':');
                    document.getElementById('notice-expire-hour').value = parseInt(h);
                    document.getElementById('notice-expire-minute').value = parseInt(m);
                }
            }
            document.getElementById('notice-title').focus();
        }
    } catch (e) {
        // console.error('수정 데이터 로드 실패:', e);
    }
};

window.reactivateNotice = function (id) {
    editNotice(id);
};

// (추가) 공지 저장/삭제 함수
window.saveNotice = async function () {
    const editId = document.getElementById('notice-edit-id').value;
    const title = document.getElementById('notice-title').value;
    const content = document.getElementById('notice-content').value;
    const expireDate = document.getElementById('notice-expire-date').value;
    const expireHour = document.getElementById('notice-expire-hour').value;
    const expireMinute = document.getElementById('notice-expire-minute').value;

    if (!title || !content) {
        alert("제목과 내용을 모두 입력해주세요.");
        return;
    }

    if (!expireDate) {
        alert("공지 종료 기한을 설정해주세요.");
        return;
    }

    const expiresAt = `${expireDate} ${String(expireHour).padStart(2, '0')}:${String(expireMinute).padStart(2, '0')}`;

    const payload = {
        isActive: true,
        id: editId ? parseInt(editId) : Date.now(),
        title: title,
        content: content,
        expiresAt: expiresAt,
        updatedAt: new Date().toLocaleString()
    };

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notices', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            alert('공지가 저장되었습니다.');
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal(); // 새로고침
        } else {
            alert('저장 실패');
        }
    } catch (e) {
        alert('오류 발생: ' + e.message);
    }
};

window.deleteNoticeById = async function (id) {
    if (!confirm("이 공지를 삭제하시겠습니까?")) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/notice/' + id, { method: 'DELETE' });
        if (res.ok) {
            alert("삭제되었습니다.");
            document.getElementById('notice-management-modal').remove();
            showNoticeManagementModal();
        } else {
            alert("삭제 실패");
        }
    } catch (e) {
        alert("오류: " + e.message);
    }
};

// (C) API 관리
window.showApiManagementModal = async function () {
    if (!adminAuthenticated.api) return;

    const existingModal = document.getElementById('api-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'api-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:480px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#4fc3f7,#0288d1);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:10;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-server"></i> API 관리 현황
                </h3>
                <button onclick="document.getElementById('api-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            <div style="padding:16px;" id="api-status-content">
                <div style="text-align:center;padding:40px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">API 상태를 불러오는 중...</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="refreshApiStatus();" style="padding:8px 16px;background:rgba(79,195,247,0.2);border:1px solid #4fc3f7;border-radius:6px;color:#4fc3f7;cursor:pointer;font-size:0.85rem;">
                    <i class="fa-solid fa-refresh"></i> 전체 새로고침
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    await refreshApiStatus();
};

window.refreshApiStatus = async function () {
    const content = document.getElementById('api-status-content');
    if (!content) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/status');
        const status = await res.json();

        // 관리자 화면에 표시할 API 수집 항목 목록 (모바일 뷰)
        // 해양생활기상: 수동 호출 시 바다낚시 지수 + 바다갈라짐 체험지수를 한번에 수집
        const apiItems = [
            { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
            { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
            { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' },
            { key: 'fishing', name: '해양생활기상', icon: 'fa-fish', color: '#4fc3f7' }
        ];

        let html = '';
        apiItems.forEach(api => {
            const s = status[api.key] || { lastRun: '-', status: '정보 없음', message: '' };
            const isSuccess = s.status === '성공';
            const statusColor = isSuccess ? '#4caf50' : (s.status === '실패' ? '#f44336' : '#9e9e9e');

            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="display:flex;align-items:center;gap:10px;">
                            <div style="width:36px;height:36px;background:rgba(${hexToRgb(api.color)},0.2);border-radius:8px;display:flex;align-items:center;justify-content:center;">
                                <i class="fa-solid ${api.icon}" style="color:${api.color};font-size:1rem;"></i>
                            </div>
                            <div>
                                <div style="color:#fff;font-weight:600;font-size:0.95rem;">${api.name}</div>
                                <div style="color:#888;font-size:0.75rem;">${s.message || ''}</div>
                            </div>
                        </div>
                        <span style="background:${statusColor};color:#fff;padding:3px 8px;border-radius:12px;font-size:0.7rem;font-weight:600;">${s.status}</span>
                    </div>
                    <div style="display:flex;align-items:center;justify-content:space-between;">
                        <div style="color:#aaa;font-size:0.75rem;">
                            <i class="fa-regular fa-clock" style="margin-right:4px;"></i>
                            ${s.lastRun || '호출 기록 없음'}
                        </div>
                        <button onclick="forceUpdateApi('${api.key}')" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;font-weight:500;">
                            <i class="fa-solid fa-rotate"></i> 수동 호출
                        </button>
                    </div>
                </div>
            `;
        });

        content.innerHTML = html;
    } catch (e) {
        content.innerHTML = `
            <div style="text-align:center;padding:30px;color:#f44336;">
                <i class="fa-solid fa-exclamation-circle fa-2x"></i>
                <p style="margin-top:10px;">API 상태를 불러올 수 없습니다.</p>
            </div>
        `;
    }
};

window.forceUpdateApi = async function (type) {
    const btn = event.target.closest('button');
    const card = btn.closest('div[style*="border-radius:10px"]');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 수집 중...';
    btn.disabled = true;

    // 진행 표시 UI 삽입
    let progressEl = card.querySelector('.collect-progress');
    if (!progressEl) {
        progressEl = document.createElement('div');
        progressEl.className = 'collect-progress';
        progressEl.style.cssText = 'margin-top:8px;';
        card.appendChild(progressEl);
    }
    progressEl.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span class="cp-text" style="color:#a5b4fc;font-size:0.75rem;">준비 중...</span>
            <span class="cp-pct" style="color:#94a3b8;font-size:0.75rem;">0%</span>
        </div>
        <div style="background:rgba(0,0,0,0.3);border-radius:4px;height:5px;overflow:hidden;">
            <div class="cp-bar" style="background:linear-gradient(90deg,#6366f1,#8b5cf6);height:100%;width:0%;transition:width 0.3s;border-radius:4px;"></div>
        </div>
    `;

    try {
        const es = new EventSource(CONFIG.API_BASE + '/api/force-update/' + type + '/stream');

        await new Promise((resolve, reject) => {
            es.onmessage = (ev) => {
                try {
                    const data = JSON.parse(ev.data);
                    if (data.done) {
                        es.close();
                        resolve(data);
                        return;
                    }
                    if (data.error) {
                        es.close();
                        reject(new Error(data.error));
                        return;
                    }
                    // 진행 상황 업데이트
                    if (data.current && data.total) {
                        const pct = Math.round((data.current / data.total) * 100);
                        const textEl = progressEl.querySelector('.cp-text');
                        const pctEl = progressEl.querySelector('.cp-pct');
                        const barEl = progressEl.querySelector('.cp-bar');
                        textEl.textContent = `${data.step}: ${data.current}/${data.total} (${data.detail || ''})`;
                        pctEl.textContent = pct + '%';
                        barEl.style.width = pct + '%';
                    }
                } catch (e) { }
            };
            es.onerror = () => {
                es.close();
                reject(new Error('SSE 연결 실패'));
            };
        });

        btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료';
        const barEl = progressEl.querySelector('.cp-bar');
        const pctEl = progressEl.querySelector('.cp-pct');
        const textEl = progressEl.querySelector('.cp-text');
        barEl.style.width = '100%';
        pctEl.textContent = '100%';
        textEl.textContent = '수집 완료!';
        textEl.style.color = '#4caf50';

        setTimeout(() => {
            progressEl.remove();
            refreshApiStatus();
        }, 2000);
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-times"></i> 에러';
        const textEl = progressEl.querySelector('.cp-text');
        if (textEl) {
            textEl.textContent = '수집 실패: ' + e.message;
            textEl.style.color = '#f44336';
        }
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
            progressEl.remove();
        }, 3000);
    }
};

/**
 * 색 hex (#RRGGBB) 문자열을 'r,g,b' 콤마 구분 문자열로 변환.
 * 차트 배경 등에 rgba(<hex>, 0.2) 형태로 alpha 를 추가할 때 유용.
 * 잘못된 hex 면 '255,255,255' (흰색) fallback.
 */
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}` : '255,255,255';
}

// ============================================================================
// [New] 페이지 초기 로드 시 공지사항 뱃지 미리 업데이트
// ============================================================================
(async function initPromoBadges() {
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        if (res.ok) {
            const posts = await res.json();
            updateNewBadges(posts);
        }
    } catch (e) {
        // 공지사항 뱃지 초기화 실패 시 무시
    }
})();

// ============================================================================
// (H) 외부 저장소 현황 섹션 렌더링
// ============================================================================

/**
 * 외부 저장소 현황 탭의 전체 화면을 렌더링합니다.
 * - Cloudinary: 이미지/문서 업로드에 사용하는 클라우드 저장소
 * - Google Cloud Storage: 일일 자동 백업에 사용하는 클라우드 저장소
 *
 * [동작 흐름]
 * 1. 로딩 스피너 표시
 * 2. /api/admin/storage-usage API 호출
 * 3. 응답 데이터로 게이지 바 + 수치 렌더링
 *
 * [연계]
 * - routes/admin.js → GET /api/admin/storage-usage (사용량 데이터 제공)
 * - admin.js → switchUnifiedAdminTab('storage')에서 이 함수를 호출
 *
 * @param {HTMLElement} container - 탭 내용이 렌더링될 컨테이너 요소
 */
async function renderUnifiedStorageContent(container) {
    // 1단계: 로딩 화면 표시
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center;">
            <div><i class="fa-solid fa-cloud" style="color:#7dd3fc;"></i> 외부 저장소 현황</div>
            <button onclick="renderUnifiedStorageContent(document.getElementById('unified-admin-body'))"
                    style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#94a3b8; padding:5px 12px; border-radius:8px; font-size:0.75rem; cursor:pointer;">
                <i class="fa-solid fa-rotate"></i> 새로고침
            </button>
        </div>
        <div style="text-align:center; padding:60px; color:#64748b;">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:12px;">저장소 사용량을 조회하는 중...</p>
        </div>
    `;

    // 2단계: 서버 API 호출
    try {
        const res = await fetch(CONFIG.API_BASE + '/api/admin/storage-usage');
        const data = await res.json();

        // 3단계: 데이터를 기반으로 화면 구성
        let html = `
            <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center;">
                <div><i class="fa-solid fa-cloud" style="color:#7dd3fc;"></i> 외부 저장소 현황</div>
                <button onclick="renderUnifiedStorageContent(document.getElementById('unified-admin-body'))"
                        style="background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1); color:#94a3b8; padding:5px 12px; border-radius:8px; font-size:0.75rem; cursor:pointer;">
                    <i class="fa-solid fa-rotate"></i> 새로고침
                </button>
            </div>
        `;

        // ── Cloudinary 카드 ──
        html += _renderCloudinaryCard(data.cloudinary);

        // ── Google Cloud Storage 카드 ──
        html += _renderGcsCard(data.gcs);

        // ── 안내 문구 ──
        html += `
            <div style="margin-top:16px; padding:12px 16px; background:rgba(255,255,255,0.02); border-radius:10px; border:1px solid rgba(255,255,255,0.05);">
                <div style="display:flex; align-items:center; gap:8px; color:#64748b; font-size:0.75rem;">
                    <i class="fa-solid fa-circle-info"></i>
                    <span>사용량이 <span style="color:#f59e0b;">80%</span>를 초과하면 경고가 표시됩니다.
                    Cloudinary 대역폭은 매월 초에 초기화됩니다.</span>
                </div>
            </div>
        `;

        container.innerHTML = html;

    } catch (e) {
        container.innerHTML += `
            <div style="color:#ef4444; text-align:center; padding:30px;">
                <i class="fa-solid fa-triangle-exclamation"></i> 저장소 정보를 불러오지 못했습니다: ${e.message}
            </div>
        `;
    }
}

/**
 * 바이트 수를 사람이 읽기 좋은 단위(KB, MB, GB)로 변환합니다.
 * @param {number} bytes - 바이트 수
 * @returns {string} 변환된 문자열 (예: "2.1 GB", "580 MB")
 */
function _formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return (bytes / Math.pow(1024, i)).toFixed(i > 1 ? 1 : 0) + ' ' + units[i];
}

/**
 * 사용 비율(%)에 따른 게이지 바 색상을 반환합니다.
 * - 0~60%: 녹색 (여유)
 * - 60~80%: 노란색 (주의)
 * - 80~100%: 빨간색 (경고)
 *
 * @param {number} pct - 사용 비율 (0~100)
 * @returns {string} CSS 색상 값
 */
function _getGaugeColor(pct) {
    if (pct >= 80) return '#ef4444';   // 빨간색 — 위험
    if (pct >= 60) return '#f59e0b';   // 노란색 — 주의
    return '#10b981';                   // 녹색 — 여유
}

/**
 * 게이지 바 HTML을 생성합니다.
 * 사용 비율에 따라 바 길이와 색상이 변하며, 80% 초과 시 경고 아이콘이 표시됩니다.
 *
 * @param {string} label - 게이지 바 제목 (예: "저장 공간", "월간 대역폭")
 * @param {number} used - 사용량 (바이트)
 * @param {number} limit - 한도 (바이트)
 * @returns {string} HTML 문자열
 */
function _renderGaugeBar(label, used, limit) {
    const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0;
    const color = _getGaugeColor(pct);
    const warning = pct >= 80 ? '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; margin-left:6px;"></i>' : '';

    return `
        <div style="margin-bottom:16px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                <span style="color:#94a3b8; font-size:0.8rem; font-weight:600;">${label}</span>
                <span style="color:#cbd5e1; font-size:0.8rem;">
                    ${_formatBytes(used)} / ${_formatBytes(limit)}${warning}
                </span>
            </div>
            <div style="background:rgba(0,0,0,0.3); border-radius:6px; height:8px; overflow:hidden;">
                <div style="background:${color}; height:100%; width:${pct.toFixed(1)}%; border-radius:6px; transition:width 0.5s ease;"></div>
            </div>
            <div style="text-align:right; margin-top:3px; font-size:0.7rem; color:${color}; font-weight:700;">
                ${pct.toFixed(1)}%
            </div>
        </div>
    `;
}

/**
 * Cloudinary 저장소 현황 카드를 렌더링합니다.
 * - 사용 중이면: 저장 공간 게이지, 대역폭 게이지, 파일 수 표시
 * - 미설정이면: "Cloudinary가 설정되지 않았습니다" 안내
 * - 오류 발생 시: 에러 메시지 표시
 *
 * @param {Object} cData - /api/admin/storage-usage 응답의 cloudinary 객체
 * @returns {string} HTML 문자열
 */
/**
 * Cloudinary 저장소 현황 카드를 렌더링합니다.
 *
 * [A+B 조합 UI 구성]
 * 1. 크레딧 게이지 — 저장+대역폭+변환 합산 사용량 (전체 한도 대비)
 * 2. 저장 공간 게이지 — 현재 보관 중인 파일 총 크기 (25GB 대비)
 * 3. 대역폭 게이지 — 이번 달 전송된 데이터 양 (25GB 대비)
 * 4. 크레딧 세부 내역 — 각 항목별 크레딧 소비 분해
 * 5. 파일 수 / 플랜 정보
 *
 * [연계]
 * - /api/admin/storage-usage 에서 데이터 수신
 * - _renderGaugeBar() 로 게이지 바 생성
 * - _formatBytes() 로 바이트 단위 변환
 *
 * @param {Object} cData - 서버 응답의 cloudinary 객체
 * @returns {string} HTML 문자열
 */
function _renderCloudinaryCard(cData) {
    let inner = '';

    if (!cData || !cData.available) {
        // Cloudinary 환경변수가 설정되지 않은 경우 (로컬 디스크 모드)
        inner = `
            <div style="text-align:center; padding:25px; color:#64748b;">
                <i class="fa-solid fa-cloud-slash" style="font-size:1.5rem; margin-bottom:8px; display:block;"></i>
                <div>Cloudinary가 설정되지 않았습니다</div>
                <div style="font-size:0.7rem; margin-top:4px;">로컬 디스크(uploads/) 모드로 동작 중</div>
            </div>
        `;
    } else if (cData.error) {
        // API 호출은 됐으나 오류 발생
        inner = `
            <div style="text-align:center; padding:25px; color:#ef4444;">
                <i class="fa-solid fa-circle-exclamation" style="font-size:1.2rem; margin-bottom:8px; display:block;"></i>
                <div>조회 실패: ${cData.error}</div>
            </div>
        `;
    } else {
        // ── 크레딧 사용량 계산 ──
        // Cloudinary 무료 플랜은 매달 25 크레딧 제공
        // 저장(1GB=1크레딧) + 대역폭(1GB=1크레딧) + 변환(1000건=1크레딧)을 합산 소비
        const creditsUsed = cData.credits?.used || 0;
        const creditsLimit = cData.credits?.limit || 25;
        const creditsPct = creditsLimit > 0 ? Math.min((creditsUsed / creditsLimit) * 100, 100) : 0;
        const creditsColor = _getGaugeColor(creditsPct);
        const creditsWarning = creditsPct >= 80 ? '<i class="fa-solid fa-triangle-exclamation" style="color:#ef4444; margin-left:6px;"></i>' : '';

        // ── 크레딧 세부 내역 계산 ──
        // 각 항목이 크레딧을 얼마나 소비하는지 분해하여 표시
        const storageCredits = ((cData.storage?.used || 0) / (1024 * 1024 * 1024)).toFixed(2);  // 바이트→GB = 크레딧
        const bandwidthCredits = ((cData.bandwidth?.used || 0) / (1024 * 1024 * 1024)).toFixed(2);
        const transformsUsed = cData.transformations?.used || 0;
        const transformsCredits = (transformsUsed / 1000).toFixed(2);  // 1000건 = 1크레딧

        inner = `
            <!-- 1. 크레딧 게이지 (전체 사용량 종합) -->
            <div style="margin-bottom:16px;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                    <span style="color:#94a3b8; font-size:0.8rem; font-weight:600;">
                        <i class="fa-solid fa-coins" style="margin-right:4px; color:#f59e0b;"></i>크레딧 사용량
                    </span>
                    <span style="color:#cbd5e1; font-size:0.8rem;">
                        ${creditsUsed.toFixed(1)} / ${creditsLimit} 크레딧${creditsWarning}
                    </span>
                </div>
                <div style="background:rgba(0,0,0,0.3); border-radius:6px; height:10px; overflow:hidden;">
                    <div style="background:${creditsColor}; height:100%; width:${creditsPct.toFixed(1)}%; border-radius:6px; transition:width 0.5s ease;"></div>
                </div>
                <div style="text-align:right; margin-top:3px; font-size:0.7rem; color:${creditsColor}; font-weight:700;">
                    ${creditsPct.toFixed(1)}%
                </div>
            </div>

            <!-- 2. 저장 공간 게이지 -->
            ${_renderGaugeBar('저장 공간', cData.storage.used, cData.storage.limit)}

            <!-- 3. 대역폭 게이지 (이번 달 전송량) -->
            ${_renderGaugeBar('대역폭 (월)', cData.bandwidth.used, cData.bandwidth.limit)}

            <!-- 4. 크레딧 세부 내역 (각 항목별 크레딧 소비 분해) -->
            <div style="margin-top:4px; padding:12px; background:rgba(0,0,0,0.2); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
                <div style="font-size:0.7rem; color:#64748b; font-weight:700; margin-bottom:8px;">
                    <i class="fa-solid fa-list" style="margin-right:4px;"></i>크레딧 세부 내역
                </div>
                <div style="display:flex; flex-direction:column; gap:4px; font-size:0.75rem;">
                    <div style="display:flex; justify-content:space-between; color:#cbd5e1;">
                        <span>저장 공간</span>
                        <span>${_formatBytes(cData.storage.used)} <span style="color:#64748b;">(${storageCredits} 크레딧)</span></span>
                    </div>
                    <div style="display:flex; justify-content:space-between; color:#cbd5e1;">
                        <span>대역폭</span>
                        <span>${_formatBytes(cData.bandwidth.used)} <span style="color:#64748b;">(${bandwidthCredits} 크레딧)</span></span>
                    </div>
                    <div style="display:flex; justify-content:space-between; color:#cbd5e1;">
                        <span>변환</span>
                        <span>${transformsUsed.toLocaleString()}건 <span style="color:#64748b;">(${transformsCredits} 크레딧)</span></span>
                    </div>
                </div>
            </div>

            <!-- 5. 파일 수 / 플랜 정보 -->
            <div style="display:flex; gap:10px; margin-top:12px;">
                <div style="flex:1; background:rgba(0,0,0,0.2); border-radius:8px; padding:10px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; margin-bottom:4px;">총 파일 수</div>
                    <div style="font-size:1.1rem; font-weight:800; color:#fff;">${(cData.resources || 0).toLocaleString()}</div>
                </div>
                <div style="flex:1; background:rgba(0,0,0,0.2); border-radius:8px; padding:10px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; margin-bottom:4px;">플랜</div>
                    <div style="font-size:1.1rem; font-weight:800; color:#fff;">${cData.plan || 'Free'}</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="admin-card" style="padding:18px; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="width:36px; height:36px; background:rgba(244,114,182,0.15); border-radius:10px; display:flex; align-items:center; justify-content:center;">
                    <i class="fa-solid fa-cloud-arrow-up" style="color:#f472b6; font-size:1rem;"></i>
                </div>
                <div>
                    <div style="font-weight:700; color:#fff; font-size:0.9rem;">Cloudinary</div>
                    <div style="font-size:0.7rem; color:#64748b;">이미지 · 문서 저장소</div>
                </div>
            </div>
            ${inner}
        </div>
    `;
}

/**
 * Google Cloud Storage 현황 카드를 렌더링합니다.
 * - 사용 중이면: 저장 공간 게이지, 파일 수, 최근 백업 날짜 표시
 * - 미설정이면: "GCS가 설정되지 않았습니다" 안내
 * - 오류 발생 시: 에러 메시지 표시
 *
 * @param {Object} gData - /api/admin/storage-usage 응답의 gcs 객체
 * @returns {string} HTML 문자열
 */
function _renderGcsCard(gData) {
    let inner = '';

    if (!gData || !gData.available) {
        // GCS 인증키 파일이 없는 경우
        inner = `
            <div style="text-align:center; padding:25px; color:#64748b;">
                <i class="fa-solid fa-cloud-slash" style="font-size:1.5rem; margin-bottom:8px; display:block;"></i>
                <div>Google Cloud Storage가 설정되지 않았습니다</div>
                <div style="font-size:0.7rem; margin-top:4px;">백업 기능이 비활성화되어 있습니다</div>
            </div>
        `;
    } else if (gData.error) {
        inner = `
            <div style="text-align:center; padding:25px; color:#ef4444;">
                <i class="fa-solid fa-circle-exclamation" style="font-size:1.2rem; margin-bottom:8px; display:block;"></i>
                <div>조회 실패: ${gData.error}</div>
            </div>
        `;
    } else {
        inner = `
            ${_renderGaugeBar('저장 공간', gData.storage.used, gData.storage.limit)}
            <div style="display:flex; gap:10px; margin-top:8px;">
                <div style="flex:1; background:rgba(0,0,0,0.2); border-radius:8px; padding:10px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; margin-bottom:4px;">백업 파일 수</div>
                    <div style="font-size:1.1rem; font-weight:800; color:#fff;">${(gData.fileCount || 0).toLocaleString()}</div>
                </div>
                <div style="flex:1; background:rgba(0,0,0,0.2); border-radius:8px; padding:10px; text-align:center;">
                    <div style="font-size:0.7rem; color:#64748b; margin-bottom:4px;">최근 백업</div>
                    <div style="font-size:1.1rem; font-weight:800; color:#fff;">${gData.latestBackup || '-'}</div>
                </div>
            </div>
        `;
    }

    return `
        <div class="admin-card" style="padding:18px; margin-bottom:16px;">
            <div style="display:flex; align-items:center; gap:10px; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid rgba(255,255,255,0.05);">
                <div style="width:36px; height:36px; background:rgba(56,189,248,0.15); border-radius:10px; display:flex; align-items:center; justify-content:center;">
                    <i class="fa-solid fa-box-archive" style="color:#38bdf8; font-size:1rem;"></i>
                </div>
                <div>
                    <div style="font-weight:700; color:#fff; font-size:0.9rem;">Google Cloud Storage</div>
                    <div style="font-size:0.7rem; color:#64748b;">자동 백업 저장소</div>
                </div>
            </div>
            ${inner}
        </div>
    `;
}

