/**
 * ============================================================================
 * 파일명: js/admin.js
 * 역할: 통합 관리자 시스템 (인증, 대시보드, 특보 관리)
 * ============================================================================
 *
 * [설명]
 * - adminAuthenticated: 관리자 인증 상태
 * - showUnifiedLoginModal(): 관리자 로그인 모달
 * - showAlertManagementModal(): 특보 관리 모달
 * - buildZoneAccordion(): 해역 선택 아코디언
 * - 수동 특보 등록/삭제 API 호출
 *
 * [로딩 순서] 13번째 (promo.js 이후)
 * ============================================================================
 */

// ============================================================================
// [통합 관리자 시스템] Unified Admin System
// ============================================================================

const adminAuthenticated = {
    api: false,
    notice: false,
    promo: false,
    alert: false
};

// 1. 통합 로그인 모달 (Mode: 'api' | 'notice' | 'promo')
window.showUnifiedLoginModal = function (mode, title, icon) {
    const existing = document.getElementById('unified-admin-login-modal');
    if (existing) existing.remove();

    const iconColor = mode === 'api' ? '#4fc3f7' : (mode === 'notice' ? '#ffd54f' : (mode === 'promo' ? '#ff7043' : '#ef5350'));

    const modal = document.createElement('div');
    modal.id = 'unified-admin-login-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;';

    modal.innerHTML = `
        <div style="background:#1e2435;border-radius:12px;padding:20px;max-width:320px;width:90%;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
            <h3 style="color:#fff;margin:0 0 15px;font-size:1.1rem;display:flex;align-items:center;justify-content:center;gap:8px;">
                <i class="fa-solid ${icon}" style="color:${iconColor};"></i>${title}
            </h3>
            <input type="password" id="unified-admin-password" placeholder="관리자 비밀번호" 
                   style="width:100%;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:15px;outline:none;text-align:center;">
            <div style="display:flex;gap:10px;">
                <button onclick="document.getElementById('unified-admin-login-modal').remove();" 
                        style="flex:1;padding:10px;background:rgba(255,255,255,0.05);border:none;border-radius:6px;color:#aaa;cursor:pointer;transition:background 0.2s;">취소</button>
                <button onclick="verifyUnifiedAdminPassword('${mode}');" 
                        style="flex:1;padding:10px;background:linear-gradient(135deg,${iconColor},${iconColor}cc);border:none;border-radius:6px;color:#1a1f2e;font-weight:600;cursor:pointer;box-shadow:0 4px 12px ${iconColor}33;">확인</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 엔터키 지원
    setTimeout(() => {
        const input = document.getElementById('unified-admin-password');
        if (input) {
            input.focus();
            input.onkeydown = (e) => {
                if (e.key === 'Enter') verifyUnifiedAdminPassword(mode);
            };
        }
    }, 100);
};

window.verifyUnifiedAdminPassword = function (mode) {
    const input = document.getElementById('unified-admin-password');
    if (!input) return;

    const password = input.value;

    if (password === 'zaqxsw12!wlstjq') {
        // 모든 권한을 한 번에 부여 (통합 모달이므로)
        adminAuthenticated.api = true;
        adminAuthenticated.notice = true;
        adminAuthenticated.promo = true;
        adminAuthenticated.alert = true;

        document.getElementById('unified-admin-login-modal').remove();

        // 통합 관리자 모달 호출 (인증된 모드로 시작)
        showUnifiedAdminModal(mode);
    } else {
        alert('비밀번호가 일치하지 않습니다.');
        input.value = '';
        input.focus();
    }
};

// 2-0. 수집 실패 통보문 알림 팝업
window.showCollectFailureAlert = async function () {
    try {
        const res = await fetch('/api/admin/collect-failures');
        if (!res.ok) return;
        const failures = await res.json();
        if (!failures || failures.length === 0) return;

        const old = document.getElementById('collect-failure-popup');
        if (old) old.remove();

        const popup = document.createElement('div');
        popup.id = 'collect-failure-popup';
        popup.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10002;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
        popup.onclick = (e) => { if (e.target === popup) popup.remove(); };

        const rows = failures.map(f => {
            const time = f.failedAt ? new Date(f.failedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
            return `<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;margin-bottom:6px;">
                <i class="fa-solid fa-circle-xmark" style="color:#ef4444;flex-shrink:0;"></i>
                <div style="flex:1;min-width:0;">
                    <div style="color:#fca5a5;font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.title || f.reportId}</div>
                    <div style="color:#94a3b8;font-size:0.7rem;margin-top:2px;">${f.reportId} · ${f.retriesUsed || 5}회 시도 · ${time}</div>
                    <div style="color:#f87171;font-size:0.72rem;margin-top:2px;">${f.error || ''}</div>
                </div>
            </div>`;
        }).join('');

        popup.innerHTML = `
            <div style="background:#1e293b;border-radius:14px;width:90%;max-width:500px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid rgba(239,68,68,0.3);box-shadow:0 0 30px rgba(239,68,68,0.15);">
                <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid fa-triangle-exclamation" style="color:#ef4444;font-size:1.2rem;"></i>
                    <div style="flex:1;">
                        <h4 style="margin:0;color:#fff;font-size:1rem;">AI 수집 실패 통보문 ${failures.length}건</h4>
                        <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">5회 재시도 후에도 AI 분석에 실패한 통보문입니다.</div>
                    </div>
                    <button onclick="document.getElementById('collect-failure-popup').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
                </div>
                <div style="padding:14px 18px;overflow-y:auto;flex:1;">${rows}</div>
                <div style="padding:12px 18px;border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="clearCollectFailures()" style="padding:8px 16px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                        <i class="fa-solid fa-check"></i> 확인 (기록 삭제)
                    </button>
                    <button onclick="document.getElementById('collect-failure-popup').remove()" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(popup);
    } catch (e) { /* 무시 */ }
};

// 실패 기록 삭제 및 헤더 복원
window.clearCollectFailures = async function () {
    try {
        await fetch('/api/admin/collect-failures', { method: 'DELETE' });
        markVisitorCounterError(false);
        const popup = document.getElementById('collect-failure-popup');
        if (popup) popup.remove();
    } catch (e) { /* 무시 */ }
};

// 2. 통합 관리자 모달 메인
window.showUnifiedAdminModal = function (initialTab = 'alert') {
    const existing = document.getElementById('unified-admin-modal');
    if (existing) existing.remove();

    const tabs = [
        { id: 'alert', name: '특보 알림', icon: 'fa-tower-broadcast' },
        { id: 'api', name: 'API 설정', icon: 'fa-server' },
        { id: 'notice', name: '공지 팝업', icon: 'fa-bell' },
        { id: 'promo', name: '게시판 관리', icon: 'fa-bullhorn' },
        { id: 'stats', name: '방문자 통계', icon: 'fa-chart-line' },
        { id: 'survey', name: '설문조사', icon: 'fa-clipboard-list' }
    ];

    const modal = document.createElement('div');
    modal.id = 'unified-admin-modal';

    modal.innerHTML = `
        <div class="unified-admin-wrapper">
            <div class="unified-admin-header">
                <h3><i class="fa-solid fa-user-shield"></i> SEAGNAL 통합 관리자 센터</h3>
                <button class="unified-admin-close" onclick="document.getElementById('unified-admin-modal').remove();">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
            
            <div class="unified-admin-main-tabs">
                ${tabs.map(t => `
                    <button class="admin-main-tab" data-tab="${t.id}" onclick="switchUnifiedAdminTab('${t.id}')">
                        <i class="fa-solid ${t.icon}"></i>
                        <span>${t.name}</span>
                    </button>
                `).join('')}
            </div>
            
            <div class="unified-admin-body" id="unified-admin-body">
                <!-- 콘텐츠가 여기에 렌더링됨 -->
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // 초기 탭 활성화
    switchUnifiedAdminTab(initialTab);

    // [신규] 수집 실패 통보문이 있으면 팝업으로 알림
    showCollectFailureAlert();
};

window.switchUnifiedAdminTab = function (tabId) {
    // 탭 버튼 스타일 업데이트
    document.querySelectorAll('.admin-main-tab').forEach(btn => {
        if (btn.dataset.tab === tabId) btn.classList.add('active');
        else btn.classList.remove('active');
    });

    const body = document.getElementById('unified-admin-body');
    if (!body) return;

    // 기존 내용 비우기
    body.innerHTML = `
        <div style="text-align:center;padding:100px;color:#64748b;">
            <i class="fa-solid fa-circle-notch fa-spin fa-2x"></i>
            <p style="margin-top:15px;font-weight:600;">데이터를 불러오는 중...</p>
        </div>
    `;

    // 탭별 콘텐츠 렌더링
    setTimeout(async () => {
        if (tabId === 'alert') {
            renderUnifiedAlertContent(body);
        } else if (tabId === 'api') {
            renderUnifiedApiContent(body);
        } else if (tabId === 'notice') {
            renderUnifiedNoticeContent(body);
        } else if (tabId === 'promo') {
            renderUnifiedPromoContent(body);
        } else if (tabId === 'stats') {
            renderUnifiedStatsContent(body);
        } else if (tabId === 'survey') {
            renderUnifiedSurveyContent(body);
        }
    }, 100);
};

// ============================================================================
// (A-0) 오류 목록 / 수동 입력 (특보 알림 탭 내부에서 사용)
// ============================================================================

// --- 서브탭 1: 오류 목록 ---
async function renderErrorListTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    let failures = [];
    try {
        const res = await fetch('/api/admin/collect-failures');
        if (res.ok) failures = await res.json();
    } catch (e) { /* 무시 */ }

    if (!failures || failures.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <i class="fa-solid fa-circle-check" style="font-size:2.5rem;color:#22c55e;margin-bottom:15px;display:block;"></i>
                <div style="font-size:1rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;">수집 오류 없음</div>
                <div style="font-size:0.85rem;">현재 AI 수집 실패 통보문이 없습니다.</div>
            </div>`;
        return;
    }

    const rows = failures.map((f, idx) => {
        const time = f.failedAt ? new Date(f.failedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
        return `
            <div style="display:flex;align-items:center;gap:10px;padding:12px 14px;background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:10px;margin-bottom:8px;">
                <i class="fa-solid fa-circle-xmark" style="color:#ef4444;flex-shrink:0;font-size:1.1rem;"></i>
                <div style="flex:1;min-width:0;">
                    <div style="color:#fca5a5;font-size:0.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${f.title || f.reportId}</div>
                    <div style="color:#94a3b8;font-size:0.75rem;margin-top:3px;">ID: ${f.reportId} | ${f.retriesUsed || 5}회 시도 | ${time}</div>
                    <div style="color:#f87171;font-size:0.75rem;margin-top:2px;">${f.error || ''}</div>
                </div>
                <button onclick="deleteOneCollectFailure('${f.reportId}')" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:#94a3b8;padding:6px 10px;cursor:pointer;font-size:0.75rem;white-space:nowrap;" title="이 항목 삭제">
                    <i class="fa-solid fa-trash"></i>
                </button>
            </div>`;
    }).join('');

    container.innerHTML = `
        <div style="margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;">
            <div style="color:#fca5a5;font-size:0.9rem;font-weight:600;">
                <i class="fa-solid fa-triangle-exclamation"></i> 수집 실패 ${failures.length}건
            </div>
            <button onclick="clearAllCollectFailuresAndRefresh()" style="padding:6px 14px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.8rem;font-weight:600;">
                <i class="fa-solid fa-check"></i> 전체 삭제
            </button>
        </div>
        ${rows}
    `;
}

// 개별 실패 기록 삭제
window.deleteOneCollectFailure = async function (reportId) {
    try {
        const res = await fetch('/api/admin/collect-failures');
        if (!res.ok) return;
        let failures = await res.json();
        failures = failures.filter(f => f.reportId !== reportId);
        // 전체 삭제 후 남은 것만 다시 저장
        await fetch('/api/admin/collect-failures', { method: 'DELETE' });
        for (const f of failures) {
            await fetch('/api/admin/collect-failures', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(f)
            });
        }
        if (failures.length === 0) markVisitorCounterError(false);
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { /* 무시 */ }
};

// 전체 실패 기록 삭제 및 새로고침
window.clearAllCollectFailuresAndRefresh = async function () {
    try {
        await fetch('/api/admin/collect-failures', { method: 'DELETE' });
        markVisitorCounterError(false);
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { /* 무시 */ }
};

// --- 서브탭 2: 수동 입력 (아코디언 + CRUD + 푸시알림) ---
async function renderManualInputTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    // 현재 발효 중 특보 가져오기 (연안/평수구역 제외)
    const allAlerts = (appState.alerts || []).filter(a => !a.isCoastal && !a.zoneName.includes('연안바다') && !a.zoneName.includes('평수구역'));

    // 해역별 특보 매핑
    const alertsByZone = {};
    allAlerts.forEach(a => {
        if (!alertsByZone[a.zoneName]) alertsByZone[a.zoneName] = [];
        alertsByZone[a.zoneName].push(a);
    });

    const mainRegions = ['동해', '서해', '남해', '제주'];
    let html = '<div style="margin-bottom:10px;color:#94a3b8;font-size:0.8rem;"><i class="fa-solid fa-info-circle"></i> 해역을 펼쳐 특보를 확인하고, 추가/수정/삭제할 수 있습니다.</div>';

    mainRegions.forEach(mainRegion => {
        const regionData = SEA_REGIONS[mainRegion];
        if (!regionData) return;
        const mainId = `ef-main-${mainRegion}`;

        // 대분류 내 전체 특보 수 계산
        let totalAlertCount = 0;
        regionData.subRegions.forEach(sub => {
            (SUB_REGION_ZONES[sub] || []).forEach(z => {
                totalAlertCount += (alertsByZone[z] || []).length;
            });
        });
        const alertBadge = totalAlertCount > 0
            ? `<span style="margin-left:8px;background:rgba(239,68,68,0.2);color:#fca5a5;padding:2px 8px;border-radius:10px;font-size:0.75rem;font-weight:600;">${totalAlertCount}건</span>`
            : `<span style="margin-left:8px;color:#64748b;font-size:0.75rem;">특보 없음</span>`;

        html += `<div style="margin-bottom:8px;border:1px solid rgba(255,255,255,0.06);border-radius:10px;overflow:hidden;background:rgba(255,255,255,0.02);">`;
        // 대분류 헤더
        html += `
            <div onclick="toggleEfAccordion('${mainId}')" style="padding:12px 14px;background:rgba(255,255,255,0.05);display:flex;align-items:center;cursor:pointer;user-select:none;">
                <i class="fa-solid fa-chevron-right ef-arrow" id="arrow-${mainId}" style="font-size:0.75rem;width:18px;transition:transform 0.2s;color:#94a3b8;"></i>
                <span style="font-weight:700;color:#fff;font-size:0.95rem;">${regionData.icon || ''} ${regionData.displayName || mainRegion}</span>
                ${alertBadge}
            </div>
            <div id="${mainId}" style="display:none;padding:4px 8px 8px 8px;background:rgba(0,0,0,0.15);">`;

        if (mainRegion === '제주') {
            // 제주: 중분류 생략, 바로 소분류
            const zones = SUB_REGION_ZONES['제주해역'] || [];
            zones.forEach(zone => {
                html += buildZoneAccordion(zone, alertsByZone[zone] || []);
            });
        } else {
            regionData.subRegions.forEach(subRegion => {
                const subId = `ef-sub-${subRegion}`;
                const subZones = SUB_REGION_ZONES[subRegion] || [];
                let subAlertCount = 0;
                subZones.forEach(z => { subAlertCount += (alertsByZone[z] || []).length; });
                const subBadge = subAlertCount > 0
                    ? `<span style="margin-left:6px;background:rgba(239,68,68,0.15);color:#fca5a5;padding:1px 6px;border-radius:8px;font-size:0.7rem;">${subAlertCount}건</span>`
                    : '';

                html += `
                    <div style="margin-bottom:6px;border:1px solid rgba(255,255,255,0.04);border-radius:8px;overflow:hidden;">
                        <div onclick="toggleEfAccordion('${subId}')" style="padding:10px 12px;background:rgba(255,255,255,0.03);display:flex;align-items:center;cursor:pointer;user-select:none;">
                            <i class="fa-solid fa-chevron-right ef-arrow" id="arrow-${subId}" style="font-size:0.65rem;width:15px;transition:transform 0.2s;color:#64748b;"></i>
                            <span style="font-weight:600;color:#3b82f6;font-size:0.88rem;">${subRegion}</span>
                            ${subBadge}
                        </div>
                        <div id="${subId}" style="display:none;padding:4px 6px 6px 14px;border-left:2px dashed rgba(255,255,255,0.08);">`;

                subZones.forEach(zone => {
                    html += buildZoneAccordion(zone, alertsByZone[zone] || []);
                });

                html += `</div></div>`;
            });
        }

        html += `</div></div>`;
    });

    container.innerHTML = html;
}

// 소분류 해역 아코디언 (클릭 시 특보 테이블 + CRUD)
function buildZoneAccordion(zoneName, alerts) {
    const zoneId = `ef-zone-${zoneName.replace(/[·\s]/g, '_')}`;
    const hasAlerts = alerts.length > 0;
    const indicatorColor = hasAlerts ? '#ef4444' : '#334155';
    const countText = hasAlerts ? `<span style="color:#fca5a5;font-size:0.72rem;margin-left:6px;">${alerts.length}건</span>` : '';

    let tableRows = '';
    if (hasAlerts) {
        alerts.forEach((a, idx) => {
            const statusText = a.isPreliminary ? '발표 예정' : '발효 중';
            const statusColor = a.isPreliminary ? '#f59e0b' : '#22c55e';
            tableRows += `
                <tr style="border-bottom:1px solid rgba(255,255,255,0.05);">
                    <td style="padding:8px 6px;color:#fff;font-size:0.8rem;font-weight:600;">${a.warnType || '-'}</td>
                    <td style="padding:8px 6px;font-size:0.8rem;"><span style="color:${a.level === '경보' ? '#ef4444' : '#f59e0b'};font-weight:600;">${a.level || '-'}</span></td>
                    <td style="padding:8px 6px;color:#cbd5e1;font-size:0.75rem;">${formatEfAlertTime(a.tmEf)}</td>
                    <td style="padding:8px 6px;color:#cbd5e1;font-size:0.75rem;">${formatEfAlertTime(a.tmEd)}</td>
                    <td style="padding:8px 4px;font-size:0.75rem;"><span style="color:${statusColor};">${statusText}</span></td>
                    <td style="padding:8px 4px;text-align:right;white-space:nowrap;">
                        <button onclick="openEditAlertModal('${zoneName}', ${idx})" style="background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.3);color:#60a5fa;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:0.7rem;margin-right:4px;" title="수정"><i class="fa-solid fa-pen"></i></button>
                        <button onclick="deleteManualAlert('${zoneName}')" style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);color:#f87171;padding:4px 8px;border-radius:5px;cursor:pointer;font-size:0.7rem;" title="삭제"><i class="fa-solid fa-trash"></i></button>
                    </td>
                </tr>`;
        });
    }

    return `
        <div style="margin-bottom:4px;border:1px solid rgba(255,255,255,0.03);border-radius:6px;overflow:hidden;">
            <div onclick="toggleEfAccordion('${zoneId}')" style="padding:8px 10px;display:flex;align-items:center;cursor:pointer;user-select:none;background:rgba(255,255,255,0.02);">
                <span style="width:6px;height:6px;border-radius:50%;background:${indicatorColor};margin-right:8px;flex-shrink:0;"></span>
                <i class="fa-solid fa-chevron-right ef-arrow" id="arrow-${zoneId}" style="font-size:0.6rem;width:13px;transition:transform 0.2s;color:#64748b;"></i>
                <span style="color:#ddd;font-size:0.85rem;">${zoneName}</span>
                ${countText}
            </div>
            <div id="${zoneId}" style="display:none;padding:8px;background:rgba(0,0,0,0.2);">
                ${hasAlerts ? `
                    <table style="width:100%;border-collapse:collapse;">
                        <thead>
                            <tr style="border-bottom:1px solid rgba(255,255,255,0.1);">
                                <th style="padding:6px;text-align:left;color:#94a3b8;font-size:0.72rem;font-weight:600;">종류</th>
                                <th style="padding:6px;text-align:left;color:#94a3b8;font-size:0.72rem;font-weight:600;">등급</th>
                                <th style="padding:6px;text-align:left;color:#94a3b8;font-size:0.72rem;font-weight:600;">발효</th>
                                <th style="padding:6px;text-align:left;color:#94a3b8;font-size:0.72rem;font-weight:600;">해제예정</th>
                                <th style="padding:6px;text-align:left;color:#94a3b8;font-size:0.72rem;font-weight:600;">상태</th>
                                <th style="padding:6px;text-align:right;color:#94a3b8;font-size:0.72rem;font-weight:600;">액션</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                ` : `
                    <div style="text-align:center;padding:12px;color:#64748b;font-size:0.82rem;">
                        <i class="fa-solid fa-circle-info"></i> 현재 발효 중인 특보가 없습니다.
                    </div>
                `}
                <div style="margin-top:8px;text-align:center;">
                    <button onclick="openAddAlertModal('${zoneName}')" style="padding:6px 14px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                        <i class="fa-solid fa-plus"></i> 특보 추가
                    </button>
                    <button onclick="openManualPushModal('${zoneName}')" style="padding:6px 14px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.78rem;font-weight:600;margin-left:6px;">
                        <i class="fa-solid fa-bell"></i> 푸시 발송
                    </button>
                </div>
            </div>
        </div>`;
}

// 시각 변환 헬퍼 (12자리 숫자 → datetime-local 형식)
function toLocalDatetime(s) {
    if (!s) return '';
    const n = String(s).replace(/[^0-9]/g, '');
    if (n.length >= 12) return `${n.slice(0,4)}-${n.slice(4,6)}-${n.slice(6,8)}T${n.slice(8,10)}:${n.slice(10,12)}`;
    return '';
}

// 시각 포맷 헬퍼 (오류확인/수동입력 전용)
function formatEfAlertTime(timeStr) {
    if (!timeStr || timeStr === '정보 없음' || timeStr === '미정') return timeStr || '-';
    // utils.js의 formatWarningTime이 있으면 위임 (범위형 시간 올바르게 처리)
    if (typeof formatWarningTime === 'function') {
        const result = formatWarningTime(timeStr, false);
        return result;
    }
    // 12자리 숫자 시각인 경우
    const numeric = String(timeStr).replace(/[^0-9]/g, '');
    if (numeric.length >= 10) {
        const m = numeric.substring(4, 6);
        const d = numeric.substring(6, 8);
        const h = numeric.substring(8, 10);
        const mi = numeric.length >= 12 ? numeric.substring(10, 12) : '00';
        return `${m}/${d} ${h}:${mi}`;
    }
    return timeStr;
}

// 아코디언 토글
window.toggleEfAccordion = function (id) {
    const body = document.getElementById(id);
    const arrow = document.getElementById('arrow-' + id);
    if (!body) return;
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    if (arrow) arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
};

// --- 시각 입력 타입 토글 (정확한 시각 ↔ 범위형) ---
window.toggleManualTimeType = function (prefix, type) {
    const exactWrap = document.getElementById(`${prefix}-exact-wrap`);
    const rangeWrap = document.getElementById(`${prefix}-range-wrap`);
    const btnExact = document.getElementById(`${prefix}-btn-exact`);
    const btnRange = document.getElementById(`${prefix}-btn-range`);
    if (!exactWrap || !rangeWrap) return;

    const activeStyle = 'flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.2);color:#93c5fd;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;';
    const inactiveStyle = 'flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#64748b;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;';

    if (type === 'exact') {
        exactWrap.style.display = '';
        rangeWrap.style.display = 'none';
        btnExact.style.cssText = activeStyle;
        btnRange.style.cssText = inactiveStyle;
    } else {
        exactWrap.style.display = 'none';
        rangeWrap.style.display = '';
        btnRange.style.cssText = activeStyle;
        btnExact.style.cssText = inactiveStyle;
    }
    exactWrap.dataset.active = (type === 'exact') ? '1' : '0';
};

// 시각 필드 HTML 생성 헬퍼
function buildTimeFieldHTML(id, label, isOptional) {
    const inputStyle = 'width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;box-sizing:border-box;color-scheme:dark;';
    const rangeInputStyle = 'flex:1;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.85rem;box-sizing:border-box;color-scheme:dark;';
    const mb = isOptional ? '16px' : '12px';
    return `
        <div style="margin-bottom:${mb};">
            <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:6px;">${label}${isOptional ? ' (선택)' : ''}</label>
            <div style="display:flex;gap:4px;margin-bottom:8px;">
                <button type="button" id="${id}-btn-exact" onclick="toggleManualTimeType('${id}','exact')"
                    style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(59,130,246,0.4);background:rgba(59,130,246,0.2);color:#93c5fd;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <i class="fa-solid fa-clock"></i> 정확한 시각
                </button>
                <button type="button" id="${id}-btn-range" onclick="toggleManualTimeType('${id}','range')"
                    style="flex:1;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,0.08);background:transparent;color:#64748b;font-size:0.75rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                    <i class="fa-solid fa-arrows-left-right"></i> 범위형
                </button>
            </div>
            <div id="${id}-exact-wrap" data-active="1">
                <input type="datetime-local" id="${id}" style="${inputStyle}">
            </div>
            <div id="${id}-range-wrap" style="display:none;">
                <div style="display:flex;gap:6px;">
                    <input type="date" id="${id}-range-date" style="${rangeInputStyle}">
                    <select id="${id}-range-period" style="${rangeInputStyle}">
                        <option value="새벽(00시~06시)">새벽(00~06시)</option>
                        <option value="오전(06시~12시)">오전(06~12시)</option>
                        <option value="오후(12시~18시)">오후(12~18시)</option>
                        <option value="밤(18시~24시)">밤(18~24시)</option>
                    </select>
                </div>
            </div>
        </div>`;
}

// --- 특보 추가 모달 ---
window.openAddAlertModal = function (zoneName) {
    const old = document.getElementById('manual-alert-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'manual-alert-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);animation:fadeIn 0.2s;';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:400px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <div style="padding:16px;background:linear-gradient(135deg,#3b82f6,#2563eb);display:flex;align-items:center;justify-content:space-between;">
                <h4 style="margin:0;color:#fff;font-size:0.95rem;"><i class="fa-solid fa-plus"></i> 특보 수동 추가</h4>
                <button onclick="document.getElementById('manual-alert-modal').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;">&times;</button>
            </div>
            <div style="padding:18px;">
                <div style="color:#94a3b8;font-size:0.82rem;margin-bottom:12px;"><i class="fa-solid fa-location-dot"></i> ${zoneName}</div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">특보 종류</label>
                    <select id="ma-warnType" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;">
                        <option value="풍랑">풍랑</option>
                        <option value="강풍">강풍</option>
                        <option value="호우">호우</option>
                        <option value="대설">대설</option>
                        <option value="태풍">태풍</option>
                        <option value="해일">해일</option>
                    </select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">특보 등급</label>
                    <select id="ma-level" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;">
                        <option value="주의보">주의보</option>
                        <option value="경보">경보</option>
                    </select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">발표 시각</label>
                    <input type="datetime-local" id="ma-tmFc" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;box-sizing:border-box;color-scheme:dark;">
                </div>
                ${buildTimeFieldHTML('ma-tmEf', '발효 시각', false)}
                ${buildTimeFieldHTML('ma-tmEd', '해제 예정 시각', true)}
                <button onclick="submitManualAlert('${zoneName}', 'add')" style="width:100%;padding:12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;">
                    <i class="fa-solid fa-check"></i> 추가
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    // 기본값: 현재 시각(KST)
    const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const nowStr = now.toISOString().slice(0, 16);
    document.getElementById('ma-tmFc').value = nowStr;
    document.getElementById('ma-tmEf').value = nowStr;
    // 범위형 날짜 기본값
    const todayStr = now.toISOString().slice(0, 10);
    const efDateEl = document.getElementById('ma-tmEf-range-date');
    const edDateEl = document.getElementById('ma-tmEd-range-date');
    if (efDateEl) efDateEl.value = todayStr;
    if (edDateEl) edDateEl.value = todayStr;
};

// --- 특보 수정 모달 ---
window.openEditAlertModal = function (zoneName, alertIdx) {
    const zoneAlerts = (appState.alerts || []).filter(a => a.zoneName === zoneName && !a.isCoastal);
    const alert = zoneAlerts[alertIdx];
    if (!alert) return;

    const old = document.getElementById('manual-alert-modal');
    if (old) old.remove();

    const modal = document.createElement('div');
    modal.id = 'manual-alert-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);animation:fadeIn 0.2s;';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    // 시각 변환: 모듈 스코프 toLocalDatetime 사용

    modal.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:400px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <div style="padding:16px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:space-between;">
                <h4 style="margin:0;color:#fff;font-size:0.95rem;"><i class="fa-solid fa-pen"></i> 특보 수정</h4>
                <button onclick="document.getElementById('manual-alert-modal').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;">&times;</button>
            </div>
            <div style="padding:18px;">
                <div style="color:#94a3b8;font-size:0.82rem;margin-bottom:12px;"><i class="fa-solid fa-location-dot"></i> ${zoneName}</div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">특보 종류</label>
                    <select id="ma-warnType" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;">
                        ${['풍랑','강풍','호우','대설','태풍','해일'].map(t => `<option value="${t}" ${alert.warnType === t ? 'selected' : ''}>${t}</option>`).join('')}
                    </select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">특보 등급</label>
                    <select id="ma-level" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;">
                        <option value="주의보" ${alert.level === '주의보' ? 'selected' : ''}>주의보</option>
                        <option value="경보" ${alert.level === '경보' ? 'selected' : ''}>경보</option>
                    </select>
                </div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">발표 시각</label>
                    <input type="datetime-local" id="ma-tmFc" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;box-sizing:border-box;color-scheme:dark;">
                </div>
                ${buildTimeFieldHTML('ma-tmEf', '발효 시각', false)}
                ${buildTimeFieldHTML('ma-tmEd', '해제 예정 시각', true)}
                <button onclick="submitManualAlert('${zoneName}', 'edit')" style="width:100%;padding:12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;">
                    <i class="fa-solid fa-check"></i> 수정 완료
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);

    // 기존 값 프리필: 범위형 여부 판별
    const isRangeVal = (v) => v && /[새벽오전오후밤]\(/.test(v);
    const parseRangeVal = (v) => {
        if (!v) return null;
        const m = v.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(.*)/);
        if (!m) return null;
        return { date: `${m[1]}-${m[2]}-${m[3]}`, period: m[4].trim() };
    };

    // 발표 시각
    const tmFcVal = toLocalDatetime(alert.tmFc);
    if (tmFcVal) document.getElementById('ma-tmFc').value = tmFcVal;
    else {
        const kstNowTmp = new Date(Date.now() + 9 * 60 * 60 * 1000);
        document.getElementById('ma-tmFc').value = kstNowTmp.toISOString().slice(0, 16);
    }

    // 발효 시각
    if (isRangeVal(alert.tmEfDisplay || alert.tmEf)) {
        const parsed = parseRangeVal(alert.tmEfDisplay || alert.tmEf);
        if (parsed) {
            toggleManualTimeType('ma-tmEf', 'range');
            document.getElementById('ma-tmEf-range-date').value = parsed.date;
            const periodSel = document.getElementById('ma-tmEf-range-period');
            for (const opt of periodSel.options) {
                if (parsed.period.includes(opt.value.split('(')[0])) { opt.selected = true; break; }
            }
        }
    } else {
        const v = toLocalDatetime(alert.tmEf);
        if (v) document.getElementById('ma-tmEf').value = v;
    }

    // 해제 예정 시각
    if (isRangeVal(alert.tmEdDisplay || alert.tmEd)) {
        const parsed = parseRangeVal(alert.tmEdDisplay || alert.tmEd);
        if (parsed) {
            toggleManualTimeType('ma-tmEd', 'range');
            document.getElementById('ma-tmEd-range-date').value = parsed.date;
            const periodSel = document.getElementById('ma-tmEd-range-period');
            for (const opt of periodSel.options) {
                if (parsed.period.includes(opt.value.split('(')[0])) { opt.selected = true; break; }
            }
        }
    } else {
        const v = toLocalDatetime(alert.tmEd);
        if (v) document.getElementById('ma-tmEd').value = v;
    }

    // 범위형 날짜 기본값 (빈 경우)
    const kstNow = new Date(Date.now() + 9 * 60 * 60 * 1000);
    const todayStr = kstNow.toISOString().slice(0, 10);
    ['ma-tmEf-range-date', 'ma-tmEd-range-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = todayStr;
    });
};

// --- 특보 추가/수정 처리 ---
window.submitManualAlert = async function (zoneName, mode, alertIdx) {
    const warnType = document.getElementById('ma-warnType').value;
    const level = document.getElementById('ma-level').value;

    // datetime-local → 기상청 형식 (예: "2026년 02월 19일 14시 30분")
    const toKmaFormat = (s) => {
        if (!s) return '';
        const [datePart, timePart] = s.split('T');
        const [y, m, d] = datePart.split('-');
        const [h, mi] = timePart.split(':');
        return `${y}년 ${m}월 ${d}일 ${h}시 ${mi}분`;
    };

    // date + period → 기상청 범위 형식 (예: "2026년 02월 19일 오전(06시~12시)")
    const toKmaRangeFormat = (dateVal, periodVal) => {
        if (!dateVal || !periodVal) return '';
        const [y, m, d] = dateVal.split('-');
        return `${y}년 ${m}월 ${d}일 ${periodVal}`;
    };

    // 발효 시각 읽기 (정확한 시각 or 범위형)
    const tmEfExactWrap = document.getElementById('ma-tmEf-exact-wrap');
    const tmEfIsRange = tmEfExactWrap && tmEfExactWrap.dataset.active === '0';
    let tmEf, tmEfRaw;
    if (tmEfIsRange) {
        const dateVal = document.getElementById('ma-tmEf-range-date').value;
        const periodVal = document.getElementById('ma-tmEf-range-period').value;
        if (!dateVal) { alert('발효 날짜를 선택해주세요.'); return; }
        tmEf = toKmaRangeFormat(dateVal, periodVal);
        tmEfRaw = null;
    } else {
        tmEfRaw = document.getElementById('ma-tmEf').value;
        tmEf = toKmaFormat(tmEfRaw);
    }

    // 해제 예정 시각 읽기 (정확한 시각 or 범위형)
    const tmEdExactWrap = document.getElementById('ma-tmEd-exact-wrap');
    const tmEdIsRange = tmEdExactWrap && tmEdExactWrap.dataset.active === '0';
    let tmCc;
    if (tmEdIsRange) {
        const dateVal = document.getElementById('ma-tmEd-range-date').value;
        const periodVal = document.getElementById('ma-tmEd-range-period').value;
        tmCc = dateVal ? toKmaRangeFormat(dateVal, periodVal) : '';
    } else {
        const tmEdRaw = document.getElementById('ma-tmEd').value;
        tmCc = tmEdRaw ? toKmaFormat(tmEdRaw) : '';
    }

    if (!warnType || !level || !tmEf) {
        alert('특보 종류, 등급, 발효 시각은 필수 입력입니다.');
        return;
    }

    // 발표 시각 읽기
    const tmFcRaw = document.getElementById('ma-tmFc').value;
    const tmFc = tmFcRaw ? toKmaFormat(tmFcRaw) : toKmaFormat(new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16));

    // 현재 시각과 비교하여 command 결정 (발표=아직 미발효, 발효=이미 발효)
    const now = new Date();
    // 범위형이면 정확한 비교 불가 → 발표로 처리
    const command = (mode === 'edit') ? '변경' : (tmEfIsRange ? '발표' : (new Date(tmEfRaw) > now ? '발표' : '발효'));

    try {
        // 수정 모드일 때 기존 특보를 먼저 해제
        if (mode === 'edit') {
            await fetch('/api/admin/manual-alert-release', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoneName, skipPush: true })
            });
        }

        // zone tree에 직접 주입
        const resp = await fetch('/api/admin/manual-alert', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneName, warnType, level, command, tmFc, tmEf, tmCc, skipPush: mode === 'edit' })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || '등록 실패');

        const modal = document.getElementById('manual-alert-modal');
        if (modal) modal.remove();

        // 서버에서 최신 데이터 다시 불러오기
        await refreshAlertData();

        // UI 새로고침
        const inner = document.getElementById('alert-top-content');
        if (inner) renderManualInputTab(inner);
        if (typeof renderAlertSection === 'function') renderAlertSection();

        alert(`${zoneName} ${warnType}${level} 등록 완료 (${result.applied ? '장부 반영됨' : '변경 없음'})`);
    } catch (e) {
        alert(`등록 실패: ${e.message}`);
    }
};

// --- 특보 삭제 (서버 zone tree에서 해제) ---
window.deleteManualAlert = async function (zoneName) {
    if (!confirm(`${zoneName}의 해당 특보를 해제(삭제)하시겠습니까?`)) return;

    try {
        const resp = await fetch('/api/admin/manual-alert-release', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zoneName, skipPush: false })
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || '해제 실패');

        // 서버에서 최신 데이터 다시 불러오기
        await refreshAlertData();

        const inner = document.getElementById('alert-top-content');
        if (inner) renderManualInputTab(inner);
        if (typeof renderAlertSection === 'function') renderAlertSection();

        alert(`${zoneName} 특보 해제 완료`);
    } catch (e) {
        alert(`해제 실패: ${e.message}`);
    }
};

// --- 수동 푸시 발송 모달 ---
window.openManualPushModal = function (zoneName) {
    const old = document.getElementById('manual-push-modal');
    if (old) old.remove();

    // 해당 해역의 현재 특보 정보 수집
    const zoneAlerts = (appState.alerts || []).filter(a => a.zoneName === zoneName && !a.isCoastal);
    let defaultTitle = `[${zoneName}] 해양특보 안내`;
    let defaultContent = '';
    if (zoneAlerts.length > 0) {
        defaultContent = zoneAlerts.map(a => `${a.warnType} ${a.level} (${a.isPreliminary ? '발표예정' : '발효중'})`).join('\n');
    } else {
        defaultContent = '현재 발효 중인 특보가 없습니다.';
    }

    const modal = document.createElement('div');
    modal.id = 'manual-push-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10010;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.7);animation:fadeIn 0.2s;';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };

    modal.innerHTML = `
        <div style="background:#1e293b;border-radius:14px;width:90%;max-width:420px;overflow:hidden;border:1px solid rgba(139,92,246,0.3);">
            <div style="padding:16px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);display:flex;align-items:center;justify-content:space-between;">
                <h4 style="margin:0;color:#fff;font-size:0.95rem;"><i class="fa-solid fa-bell"></i> 수동 푸시 발송</h4>
                <button onclick="document.getElementById('manual-push-modal').remove()" style="background:rgba(255,255,255,0.2);border:none;color:#fff;width:28px;height:28px;border-radius:50%;cursor:pointer;font-size:1rem;display:flex;align-items:center;justify-content:center;">&times;</button>
            </div>
            <div style="padding:18px;">
                <div style="color:#a78bfa;font-size:0.82rem;margin-bottom:12px;"><i class="fa-solid fa-location-dot"></i> 대상 해역: <strong>${zoneName}</strong></div>
                <div style="margin-bottom:12px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">알림 제목</label>
                    <input type="text" id="mp-title" value="${defaultTitle}" style="width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;box-sizing:border-box;">
                </div>
                <div style="margin-bottom:16px;">
                    <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;">알림 내용</label>
                    <textarea id="mp-content" style="width:100%;height:100px;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;resize:none;font-size:0.9rem;box-sizing:border-box;line-height:1.4;">${defaultContent}</textarea>
                </div>
                <button id="mp-send-btn" onclick="sendManualPush('${zoneName}')" style="width:100%;padding:12px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;">
                    <i class="fa-solid fa-paper-plane"></i> 푸시 알림 발송
                </button>
            </div>
        </div>`;
    document.body.appendChild(modal);
};

// --- 수동 푸시 발송 처리 ---
window.sendManualPush = async function (zoneName) {
    const title = document.getElementById('mp-title').value.trim();
    const content = document.getElementById('mp-content').value.trim();
    const btn = document.getElementById('mp-send-btn');

    if (!title || !content) {
        alert('제목과 내용을 입력해주세요.');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 발송 중...';

    try {
        const res = await fetch('/api/push-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content, targetZones: [zoneName] })
        });
        const result = await res.json();

        if (result.success || result.sent > 0) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 발송 완료!';
            btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
            setTimeout(() => {
                const modal = document.getElementById('manual-push-modal');
                if (modal) modal.remove();
            }, 1500);
        } else {
            btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 발송 실패';
            btn.style.background = 'rgba(239,68,68,0.3)';
            btn.disabled = false;
            setTimeout(() => {
                btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> 푸시 알림 발송';
                btn.style.background = 'linear-gradient(135deg,#8b5cf6,#7c3aed)';
            }, 2000);
        }
    } catch (e) {
        btn.innerHTML = '<i class="fa-solid fa-xmark"></i> 오류 발생';
        btn.disabled = false;
    }
};

// (A) 특보 알림 섹션 렌더링 (4개 상위 하위탭)
async function renderUnifiedAlertContent(container) {
    if (!adminAuthenticated.alert) return;

    const topTabs = [
        { id: 'alert-manage', name: '실시간 특보 알림 관리', icon: 'fa-tower-broadcast' },
        { id: 'collect-test', name: '특보 수집 테스트', icon: 'fa-flask' },
        { id: 'collect-error', name: '특보 수집 오류', icon: 'fa-list-check' },
        { id: 'manual-edit', name: '특보 수정', icon: 'fa-pen-to-square' }
    ];

    container.innerHTML = `
        <div class="admin-sub-tabs">
            ${topTabs.map(t => `
                <button class="alert-top-tab" data-tab="${t.id}" onclick="switchAlertTopTab('${t.id}')">
                    <i class="fa-solid ${t.icon}"></i> ${t.name}
                </button>
            `).join('')}
        </div>
        <div id="alert-top-content"></div>
    `;

    window.switchAlertTopTab = function (topTabId) {
        document.querySelectorAll('.alert-top-tab').forEach(btn => {
            if (btn.dataset.tab === topTabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        const topContent = document.getElementById('alert-top-content');
        if (!topContent) return;

        if (topTabId === 'alert-manage') {
            renderAlertManageSubTab(topContent);
        } else if (topTabId === 'collect-test') {
            renderCollectTestSubTab(topContent);
        } else if (topTabId === 'collect-error') {
            renderErrorListTab(topContent);
        } else if (topTabId === 'manual-edit') {
            renderManualInputTab(topContent);
        }
    };

    // 초기 상위 탭: 실시간 특보 알림 관리
    switchAlertTopTab('alert-manage');
}

// (A-1) 실시간 특보 알림 관리 하위탭 렌더링
function renderAlertManageSubTab(container) {
    const tabs = [
        { id: 'publish', name: '발표', icon: 'fa-bullhorn' },
        { id: 'active', name: '발효', icon: 'fa-check-circle' },
        { id: 'release', name: '해제', icon: 'fa-check' },
        { id: 'level', name: '격상/격하', icon: 'fa-arrow-up-right-dots' },
        { id: 'custom', name: '직접 발송', icon: 'fa-paper-plane' },
        { id: 'history', name: '발송 이력', icon: 'fa-history' }
    ];

    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
                <i class="fa-solid fa-tower-broadcast" style="color:#ef4444;"></i> 실시간 특보 알림 관리
            </div>
        </div>

        <div class="admin-sub-tabs">
            ${tabs.map(t => `
                <button class="alert-admin-tab" data-tab="${t.id}" onclick="switchAlertAdminTabInternal('${t.id}')">
                    ${t.name}
                </button>
            `).join('')}
        </div>

        <div id="alert-admin-inner-content"></div>
    `;

    window.switchAlertAdminTabInternal = function (subTabId) {
        document.querySelectorAll('.alert-admin-tab').forEach(btn => {
            if (btn.dataset.tab === subTabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        const innerContainer = document.getElementById('alert-admin-inner-content');
        if (innerContainer) window.renderAlertAdminContent(subTabId, innerContainer);
    };

    switchAlertAdminTabInternal('publish');
}

// (A-2) 특보 수집 테스트 인라인 렌더링
function renderCollectTestSubTab(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex; justify-content:space-between; align-items:center;">
            <div><i class="fa-solid fa-flask" style="color:#8b5cf6;"></i> 특보 수집 테스트</div>
        </div>
        <div style="display:flex;gap:0;border:1px solid rgba(255,255,255,0.1);border-radius:10px;overflow:hidden;margin-bottom:16px;">
            <button id="atm-tab-status" onclick="switchAlertTestTab('status')" class="atm-tab" style="flex:1;padding:12px;background:rgba(99,102,241,0.2);color:#a5b4fc;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid #6366f1;">
                <i class="fa-solid fa-database"></i> 수집 현황
            </button>
            <button id="atm-tab-collect" onclick="switchAlertTestTab('collect')" class="atm-tab" style="flex:1;padding:12px;background:transparent;color:#94a3b8;border:none;cursor:pointer;font-weight:600;font-size:0.9rem;border-bottom:2px solid transparent;">
                <i class="fa-solid fa-download"></i> 통보문 수집
            </button>
        </div>
        <div id="atm-content"></div>
    `;
    switchAlertTestTab('status');
}

