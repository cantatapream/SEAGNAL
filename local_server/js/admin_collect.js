/**
 * ============================================================================
 * 파일명: js/admin_collect.js
 * 역할: 특보 수집 테스트, 결과 팝업, 방문자 통계 차트
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
                <h3 style="margin:0;color:#fff;font-size:1.1rem;"><i class="fa-solid fa-flask" style="color:#8b5cf6;"></i> 특보 수집 테스트</h3>
                <button onclick="this.closest('#alert-test-modal-overlay').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
            </div>
            <div style="display:flex;gap:0;border-bottom:1px solid rgba(255,255,255,0.1);flex-shrink:0;">
                <button id="atm-tab-status" onclick="switchAlertTestTab('status')" class="atm-tab" style="flex:1;padding:12px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid #6366f1;">
                    <i class="fa-solid fa-database"></i> 수집 현황
                </button>
                <button id="atm-tab-collect" onclick="switchAlertTestTab('collect')" class="atm-tab" style="flex:1;padding:12px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;">
                    <i class="fa-solid fa-download"></i> 통보문 수집
                </button>
            </div>
            <div id="atm-content" style="flex:1;overflow-y:auto;padding:20px;"></div>
        </div>
    `;
    document.body.appendChild(overlay);
    switchAlertTestTab('status');
};

window.switchAlertTestTab = function (tabId) {
    ['status', 'collect'].forEach(id => {
        const btn = document.getElementById('atm-tab-' + id);
        if (!btn) return;
        if (id === tabId) { btn.style.background = 'rgba(99,102,241,0.2)'; btn.style.color = '#a5b4fc'; btn.style.borderBottom = '2px solid #6366f1'; }
        else { btn.style.background = 'transparent'; btn.style.color = '#94a3b8'; btn.style.borderBottom = '2px solid transparent'; }
    });
    const content = document.getElementById('atm-content');
    if (tabId === 'status') renderATMStatus(content);
    else renderATMCollect(content);
};

// --- [수집 현황] 탭 ---
async function renderATMStatus(container) {
    container.innerHTML = '<div style="text-align:center;padding:30px;color:#94a3b8;">로딩 중...</div>';
    try {
        const [alertsRes, crawlRes] = await Promise.all([
            fetch('/api/weather-alerts').then(r => r.json()),
            fetch('/api/admin/crawl-status').then(r => r.json())
        ]);
        const isPaused = crawlRes.paused;
        container.innerHTML = `
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
            </div>
            <div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:16px;overflow:auto;max-height:55vh;">
                <pre style="margin:0;color:#e2e8f0;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;">${JSON.stringify(alertsRes, null, 2)}</pre>
            </div>`;
    } catch (e) { container.innerHTML = '<div style="color:#ef4444;padding:20px;">오류: ' + e.message + '</div>'; }
}

window.atmReset = async function () {
    if (!confirm('특보 장부를 초기화하시겠습니까?\\n모든 수집 데이터가 삭제됩니다.')) return;
    try {
        const res = await fetch('/api/admin/alerts-reset', { method: 'POST' });
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
        <div id="atm-report-list" style="color:#94a3b8;font-size:0.9rem;">날짜를 선택하고 [조회] 버튼을 눌러주세요.</div>`;

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
        const res = await fetch('/api/admin/reports?date=' + date);
        const data = await res.json();
        if (data.count === 0) {
            listEl.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">해당 날짜에 [특보]/[예비] 통보문이 없습니다.</div>';
            document.getElementById('atm-collect-all-btn').style.display = 'none';
            document.getElementById('atm-push-toggle-wrap').style.display = 'none';
            return;
        }
        document.getElementById('atm-collect-all-btn').style.display = 'inline-block';
        document.getElementById('atm-push-toggle-wrap').style.display = 'flex';
        window._atmReports = data.reports;
        window._atmResults = {};
        listEl.innerHTML = data.reports.map((r, i) => `
            <div id="atm-row-${i}" style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:rgba(0,0,0,0.2);border-radius:8px;margin-bottom:6px;flex-wrap:wrap;">
                <span style="flex:1;color:#e2e8f0;font-size:0.85rem;min-width:200px;">${r.title}</span>
                <span style="color:#64748b;font-size:0.7rem;word-break:break-all;">${r.id}</span>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    <button id="atm-cb-${i}" onclick="atmCollectOne(${i})" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">수집</button>
                    <button id="atm-rb-${i}" onclick="atmShowResult(${i})" style="display:none;padding:5px 12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">결과</button>
                </div>
            </div>`).join('');
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
            const res = await fetch('/api/admin/report-collect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reportId: report.id, title: report.title, referenceTime, skipPush }) });
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
        // 헤더 방문자 표시 빨간색으로 변경
        markVisitorCounterError(true);
    } else {
        btn.innerHTML = attempt > 1
            ? `<i class="fa-solid fa-check"></i> 완료(${attempt}회)`
            : '<i class="fa-solid fa-check"></i> 완료';
        btn.style.background = 'rgba(34,197,94,0.3)'; btn.style.color = '#86efac';
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
        ct.innerHTML = '<div style="margin-bottom:16px;"><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-robot"></i> AI 분석 결과 (' + aiArr.length + '건)</div>' + aiHtml + '</div>'
            + '<div><div style="color:#a5b4fc;font-weight:600;font-size:0.85rem;margin-bottom:8px;"><i class="fa-solid fa-file-lines"></i> 원문 텍스트</div>'
            + '<div style="background:rgba(0,0,0,0.3);border-radius:10px;padding:14px;overflow:auto;max-height:35vh;"><pre style="margin:0;color:#cbd5e1;font-size:0.75rem;white-space:pre-wrap;word-break:break-all;font-family:Courier New,monospace;">' + (d.rawText||'(내용 없음)') + '</pre></div></div>';
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

        <!-- 인증키 설정 섹션 (하단 통합) -->
        <div class="admin-section-title" style="margin-top:30px; border-top:1px solid rgba(255,255,255,0.05); padding-top:20px;">
            <i class="fa-solid fa-key" style="color:#f59e0b;"></i> 기상청 API HUB (Auth Key)
        </div>
        
        <div class="admin-card" style="padding:20px; background:rgba(15, 23, 42, 0.4);">
            <div style="font-weight:600; color:#fff; margin-bottom:12px; font-size:0.85rem; display:flex; align-items:center; gap:8px;">
                <i class="fa-solid fa-bolt" style="color:#ff5722;"></i> 기상청 API HUB (Auth Key)
                <span style="font-size:0.7rem; color:#64748b; font-weight:400;">- 기상예보, 특보-HUB, 해구예보, 부이 공통</span>
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
            const apiItems = [
                { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
                { key: 'warnings_hub', name: '특보 - HUB (KMA)', icon: 'fa-bolt', color: '#ff5722' },
                { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
                { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' }
            ];

            listContainer.innerHTML = apiItems.map(api => {
                const s = status[api.key] || { lastRun: '-', status: '정보 없음', message: '' };
                const isSuccess = s.status === '성공';
                const statusColor = isSuccess ? '#10b981' : (s.status === '실패' ? '#ef4444' : '#64748b');

                return `
                    <div class="admin-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 15px;">
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
                            <button class="admin-action-btn" style="padding:6px 10px; font-size:0.7rem;" onclick="forceUpdateApiUnified('${api.key}')">
                                <i class="fa-solid fa-play"></i> 수동 호출
                            </button>
                        </div>
                    </div>
                `;
            }).join('');
        } catch (e) {
            listContainer.innerHTML = '<div style="color:#ef4444;text-align:center;padding:20px;">API 상태를 불러오지 못했습니다.</div>';
        }
    };

    window.forceUpdateApiUnified = async function (type) {
        if (!confirm(`${type} API 수집을 강제로 실행하시겠습니까?`)) return;
        try {
            await fetch(CONFIG.API_BASE + '/api/force-update/' + type, { method: 'POST' });
            alert('요청되었습니다.');
            refreshUnifiedApiStatus();
        } catch (e) { alert('오류 발생'); }
    };

    refreshUnifiedApiStatus();
    refreshUnifiedTideBedStatus();
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
        const payload = {
            id: Number(document.getElementById('uni-notice-id').value) || Date.now(),
            title: document.getElementById('uni-notice-title').value,
            content: document.getElementById('uni-notice-content').value,
            expiresAt: dateVal
                ? `${dateVal} ${document.getElementById('uni-notice-hour').value.padStart(2, '0')}:${document.getElementById('uni-notice-min').value.padStart(2, '0')}`
                : null,
            isActive: true
        };
        if (!payload.title || !payload.content) return alert('내용을 입력하세요.');
        const res = await fetch(CONFIG.API_BASE + '/api/notices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (res.ok) { alert('저장되었습니다.'); refreshUnifiedNoticeList(); }
    };

    refreshUnifiedNoticeList();
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
                    <select id="admin-post-filter" onchange="loadUnifiedPromoList()" style="padding:8px 12px; background:#0f172a; border:1px solid rgba(255,255,255,0.15); border-radius:8px; color:#fff; font-size:0.85rem;">
                        <option value="ALL">전체 게시판</option>
                        ${boards.map(b => `<option value="${b.id}">${b.name}</option>`).join('')}
                    </select>
                    <div style="position:relative;">
                        <input type="text" id="admin-post-search" placeholder="제목 검색..." onkeyup="loadUnifiedPromoList()"
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
        `;
        loadUnifiedPromoList();
    }

    // 게시글 목록 로드 (필터, 검색 포함)
    window.loadUnifiedPromoList = async function () {
        const listEl = document.getElementById('unified-promo-list-container');
        if (!listEl) return;

        const filterEl = document.getElementById('admin-post-filter');
        const searchEl = document.getElementById('admin-post-search');
        const filterCategory = filterEl ? filterEl.value : 'ALL';
        const searchKeyword = searchEl ? searchEl.value.trim().toLowerCase() : '';

        try {
            const [promoRes, boardsRes] = await Promise.all([
                fetch(CONFIG.API_BASE + '/api/promo'),
                fetch(CONFIG.API_BASE + '/api/boards')
            ]);
            const posts = await promoRes.json();
            const boards = await boardsRes.json();

            // 게시판 맵 생성
            const boardMap = {};
            boards.forEach(b => { boardMap[b.id] = b; });

            // 필터링
            let filtered = posts;
            if (filterCategory !== 'ALL') {
                filtered = filtered.filter(p => p.category === filterCategory);
            }
            if (searchKeyword) {
                filtered = filtered.filter(p => (p.title || '').toLowerCase().includes(searchKeyword));
            }

            if (filtered.length === 0) {
                listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#64748b;">조건에 맞는 게시글이 없습니다.</div>';
                return;
            }

            listEl.innerHTML = filtered.map(post => {
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
        } catch (e) {
            listEl.innerHTML = '<div style="text-align:center; padding:40px; color:#ef4444;">게시글 로드 실패</div>';
        }
    };

    window.deletePromoPostUnified = async function (id) {
        if (!confirm('정말 삭제하시겠습니까?')) return;
        await fetch(CONFIG.API_BASE + '/api/promo/' + id, { method: 'DELETE' });
        loadUnifiedPromoList();
    };

    // 초기 렌더: 게시판 관리 서브탭
    renderBoardManagement(document.getElementById('board-subtab-content'));
}

// (E) 방문자 통계 섹션 렌더링
let visitorChart = null;
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
                            ${p === 'hourly' ? '시간별(오늘)' : (p === 'daily' ? '일별' : '월별')}
                        </button>
                    `).join('')}
                </div>
                <div id="stats-date-group" style="display:flex; align-items:center; gap:8px; margin-left:auto;">
                    <input type="date" id="stats-start-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <span style="color:#475569;">~</span>
                    <input type="date" id="stats-end-date" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.1); border-radius:6px; color:#fff; padding:4px 8px; font-size:0.8rem;">
                    <button onclick="window.refreshStatsDash()" style="background:#3b82f6; border:none; color:#fff; padding:5px 10px; border-radius:6px; font-size:0.8rem; font-weight:600; cursor:pointer;">적용</button>
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

        // 시간별일 때는 날짜 선택기 비활성화 (오늘 고정)
        const dateGroup = document.getElementById('stats-date-group');
        if (type === 'hourly') dateGroup.style.opacity = '0.3', dateGroup.style.pointerEvents = 'none';
        else dateGroup.style.opacity = '1', dateGroup.style.pointerEvents = 'all';

        refreshStatsDash();
    };

    window.refreshStatsDash = function () {
        processStatsAndRender(rawData, statsType);
    };

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/stats/visitors');
        rawData = await res.json();

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

function processStatsAndRender(data, type) {
    let labels = [];
    let values = [];
    let tableData = [];

    const startVal = document.getElementById('stats-start-date').value;
    const endVal = document.getElementById('stats-end-date').value;

    if (type === 'hourly') {
        const kstNow = new Date(new Date().getTime() + (9 * 60 * 60 * 1000));
        const todayStr = kstNow.toISOString().split('T')[0];
        const dayData = data[todayStr] || { hourly: {} };

        for (let i = 0; i < 24; i++) {
            const h = String(i).padStart(2, '0');
            labels.push(`${h}시`);
            const v = dayData.hourly[h] || 0;
            values.push(v);
            tableData.push({ label: `${h}:00 ~ ${h}:59`, value: v });
        }
    } else if (type === 'daily') {
        const start = new Date(startVal);
        const end = new Date(endVal);
        let current = new Date(start);

        while (current <= end) {
            const dStr = current.toISOString().split('T')[0];
            labels.push(dStr.substring(5)); // MM-DD
            const v = data[dStr]?.total || 0;
            values.push(v);
            tableData.push({ label: dStr, value: v });
            current.setDate(current.getDate() + 1);
        }
    } else if (type === 'monthly') {
        // 최근 12개월 추출 또는 연도별 집계
        const yearMonths = {};
        Object.keys(data).forEach(k => {
            const ym = k.substring(0, 7);
            yearMonths[ym] = (yearMonths[ym] || 0) + (data[k].total || 0);
        });
        const sortedYM = Object.keys(yearMonths).sort().slice(-12);
        sortedYM.forEach(ym => {
            labels.push(ym);
            values.push(yearMonths[ym]);
            tableData.push({ label: ym, value: yearMonths[ym] });
        });
    }

    // 차트 그리기
    renderVisitorChart(labels, values, type);

    // 테이블 업데이트
    const tbody = document.getElementById('stats-table-body');
    const total = values.reduce((a, b) => a + b, 0);

    // 최근 순으로 정렬하여 표출 (일별/월별일 때만)
    if (type !== 'hourly') tableData.reverse();

    tbody.innerHTML = tableData.map(item => {
        const percent = total > 0 ? ((item.value / total) * 100).toFixed(1) : 0;
        return `
            <tr>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03);">${item.label}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; font-weight:700;">${item.value.toLocaleString()}</td>
                <td style="padding:10px 16px; border-bottom:1px solid rgba(255,255,255,0.03); text-align:right; color:#64748b;">${percent}%</td>
            </tr>
        `;
    }).join('');
}

function renderVisitorChart(labels, values, type) {
    const ctx = document.getElementById('visitor-main-chart').getContext('2d');

    if (visitorChart) visitorChart.destroy();

    const isLine = type !== 'bar';
    const mainColor = '#22c55e'; // Vibrant Green (Emerald)

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(34, 197, 94, 0.4)');
    gradient.addColorStop(1, 'rgba(34, 197, 94, 0)');

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
        plugins: [{
            id: 'glow',
            beforeDatasetDraw: (chart, args) => {
                const { ctx } = chart;
                ctx.save();
                ctx.shadowBlur = 15;
                ctx.shadowColor = mainColor;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
            },
            afterDatasetDraw: (chart) => {
                chart.ctx.restore();
            }
        }],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: '#1e293b',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    padding: 12,
                    cornerRadius: 8,
                    displayColors: false
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

// 기존 관리 함수들 리다이렉션 (하위 호환성 유지)
window.showNoticeManagementModal = () => showUnifiedAdminModal('notice');
window.showPromoManagementModal = () => showUnifiedAdminModal('promo');
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

// (B) 게시판 관리 - 오렌지 테마 모달 (왼쪽 목록 팝업)
window.showPromoManagementModal = async function () {
    if (!adminAuthenticated.promo) return;

    const existingModal = document.getElementById('promo-management-modal');
    if (existingModal) existingModal.remove();

    const modal = document.createElement('div');
    modal.id = 'promo-management-modal';
    modal.className = 'notice-popup';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);';

    modal.innerHTML = `
        <div style="background:linear-gradient(135deg,#1a1f2e,#252b3b);border-radius:16px;max-width:500px;width:95%;max-height:85vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.5);">
            <div style="background:linear-gradient(135deg,#ff7043,#e64a19);padding:16px 20px;border-radius:16px 16px 0 0;display:flex;align-items:center;justify-content:space-between;">
                <h3 style="margin:0;color:#fff;font-size:1.1rem;display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-bullhorn"></i> 게시판 관리
                </h3>
                <button onclick="document.getElementById('promo-management-modal').remove();" 
                        style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.2rem;">×</button>
            </div>
            <div style="padding:16px;" id="promo-management-content">
                <div style="text-align:center;padding:30px;color:#aaa;">
                    <i class="fa-solid fa-spinner fa-spin fa-2x"></i>
                    <p style="margin-top:10px;">게시글 목록을 불러오는 중...</p>
                </div>
            </div>
            <div style="padding:12px 16px;background:rgba(0,0,0,0.2);border-radius:0 0 16px 16px;text-align:center;">
                <button onclick="openPromoEditor();" 
                        style="padding:10px 20px;background:linear-gradient(135deg,#ff7043,#e64a19);border:none;border-radius:8px;color:#fff;font-weight:600;cursor:pointer;font-size:0.9rem;">
                    <i class="fa-solid fa-plus" style="margin-right:6px;"></i>새 게시글 작성
                </button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    await loadPromoListForAdmin();
};

async function loadPromoListForAdmin() {
    const content = document.getElementById('promo-management-content');
    if (!content) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo');
        const posts = await res.json();

        if (!posts || posts.length === 0) {
            content.innerHTML = `
                <div style="text-align:center;padding:30px;color:#888;">
                    <i class="fa-solid fa-inbox fa-2x"></i>
                    <p style="margin-top:10px;">등록된 게시글이 없습니다.</p>
                </div>
            `;
            return;
        }

        let html = '';
        posts.forEach(post => {
            const date = post.createdAt ? new Date(post.createdAt).toLocaleDateString('ko-KR') : '-';
            html += `
                <div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px;margin-bottom:10px;border:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div style="color:#fff;font-weight:600;font-size:0.95rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${post.title || '제목 없음'}</div>
                        <span style="color:#888;font-size:0.75rem;margin-left:10px;">${date}</span>
                    </div>
                    <div style="display:flex;gap:8px;justify-content:flex-end;">
                        <button onclick="editPromoPost(${post.id}); document.getElementById('promo-management-modal').remove();" 
                                style="background:rgba(79,195,247,0.15);border:1px solid rgba(79,195,247,0.3);color:#4fc3f7;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-edit"></i> 수정
                        </button>
                        <button onclick="deletePromoPostFromAdmin(${post.id});" 
                                style="background:rgba(244,67,54,0.15);border:1px solid rgba(244,67,54,0.3);color:#f44336;padding:5px 12px;border-radius:6px;cursor:pointer;font-size:0.75rem;">
                            <i class="fa-solid fa-trash"></i> 삭제
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
                <p style="margin-top:10px;">게시글 목록을 불러올 수 없습니다.</p>
            </div>
        `;
    }
}

async function deletePromoPostFromAdmin(postId) {
    if (!confirm('정말로 이 게시글을 삭제하시겠습니까?')) return;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/promo/' + postId, { method: 'DELETE' });
        const result = await res.json();
        if (result.success) {
            loadPromoListForAdmin();
            loadPromoPosts();
        } else {
            alert('삭제 실패');
        }
    } catch (e) {
        alert('삭제 중 오류 발생: ' + e.message);
    }
}

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

        const apiItems = [
            { key: 'general', name: '기상 예보', icon: 'fa-sun', color: '#ffd54f' },
            { key: 'warnings_hub', name: '특보 - HUB (KMA)', icon: 'fa-bolt', color: '#ff5722' },
            { key: 'zone', name: '해구별 예보', icon: 'fa-map-location-dot', color: '#29b6f6' },
            { key: 'buoys', name: '관측 부이', icon: 'fa-anchor', color: '#26a69a' }
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
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>...';
    btn.disabled = true;

    try {
        const res = await fetch(CONFIG.API_BASE + '/api/force-update/' + type, { method: 'POST' });
        const result = await res.json();

        if (result.success) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 완료';
            setTimeout(() => { refreshApiStatus(); }, 1000);
        } else {
            throw new Error(result.error || '실패');
        }
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-times"></i> 에러';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
    }
};

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
            // console.log('[Init] 공지사항 뱃지 초기화 완료');
        }
    } catch (e) {
        // console.warn('[Init] 공지사항 뱃지 초기화 실패:', e.message);
    }
})();

