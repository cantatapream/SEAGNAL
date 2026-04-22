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

// 1-1. 관리자 모드 토글 (localStorage 영구 저장)
window._toggleAdminMode = function (checked) {
    if (checked) {
        localStorage.setItem('seagnal_admin_mode', 'true');
        // 제보 뱃지 즉시 업데이트
        if (typeof updateReportBadge === 'function') updateReportBadge();
    } else {
        localStorage.removeItem('seagnal_admin_mode');
        // 뱃지 숨기기
        const badge = document.getElementById('report-badge');
        if (badge) badge.style.display = 'none';
        // 테스트 모드 상태 초기화 및 장부 정리
        window._atmTestMode = false;
        fetch('/api/admin/test-cleanup', { method: 'POST' }).catch(() => {});
    }
};

// ============================================================================
// 1-2. 관리자 기기 등록/해제 (관리자 전용 푸시 알림 수신 기기 관리)
// ============================================================================
// 기존 subscriptions.json(일반 사용자 구독)과 완전 별도로 admin_devices.json 사용.
// 등록하면: 수집 오류, 검토 필요 통보문 발생 시 이 기기로 푸시 알림을 받음.
// 해제하면: 더 이상 관리자 푸시 알림을 받지 않음.

/** 현재 기기의 FCM 토큰 가져오기 (localStorage에 저장되어 있음) */
function _getDeviceToken() {
    return localStorage.getItem('push_token') || null;
}

/** 관리자 기기 등록 상태를 서버에서 조회하여 버튼 UI 갱신 */
window._checkAdminDeviceStatus = async function () {
    const token = _getDeviceToken();
    const registerBtn = document.getElementById('btn-admin-register');
    const unregisterBtn = document.getElementById('btn-admin-unregister');
    if (!registerBtn || !unregisterBtn) return;

    if (!token) {
        // 토큰이 없으면 등록 불가 (앱이 아닌 PC 브라우저 등)
        registerBtn.style.display = 'none';
        unregisterBtn.style.display = 'none';
        return;
    }

    try {
        const res = await fetch(`/api/admin/device-status?token=${encodeURIComponent(token)}`);
        const data = await res.json();
        if (data.registered) {
            // 이미 등록됨 → 등록 버튼 비활성화, 해제 버튼 활성화
            registerBtn.style.background = '#334155';
            registerBtn.style.color = '#64748b';
            registerBtn.innerHTML = '<i class="fa-solid fa-check"></i> 등록됨';
            registerBtn.disabled = true;
            unregisterBtn.style.background = '#ef4444';
            unregisterBtn.disabled = false;
        } else {
            // 미등록 → 등록 버튼 활성화, 해제 버튼 비활성화
            registerBtn.style.background = '#3b82f6';
            registerBtn.style.color = '#fff';
            registerBtn.innerHTML = '<i class="fa-solid fa-mobile-screen"></i> 등록';
            registerBtn.disabled = false;
            unregisterBtn.style.background = '#334155';
            unregisterBtn.style.color = '#64748b';
            unregisterBtn.disabled = true;
        }
    } catch (e) {
        // 네트워크 오류 시 기본 상태 유지
    }
};

/** [등록] 버튼 클릭 → 현재 기기를 관리자 푸시 대상으로 등록 */
window._registerAdminDevice = async function () {
    const token = _getDeviceToken();
    if (!token) {
        alert('푸시 토큰을 찾을 수 없습니다.\n앱에서 알림 권한을 허용한 후 다시 시도해주세요.');
        return;
    }
    try {
        const res = await fetch('/api/admin/register-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
            alert(data.alreadyRegistered ? '이미 등록된 기기입니다.' : '관리자 기기 등록 완료!\n수집 오류 발생 시 이 기기로 푸시 알림을 받습니다.');
            _checkAdminDeviceStatus(); // 버튼 상태 갱신
        } else {
            alert('등록 실패: ' + (data.error || '알 수 없는 오류'));
        }
    } catch (e) {
        alert('등록 요청 실패: ' + e.message);
    }
};

/** [해제] 버튼 클릭 → 현재 기기를 관리자 푸시 대상에서 제거 */
window._unregisterAdminDevice = async function () {
    const token = _getDeviceToken();
    if (!token) return;
    if (!confirm('관리자 알림 수신을 해제하시겠습니까?')) return;
    try {
        const res = await fetch('/api/admin/unregister-device', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();
        if (data.success) {
            alert('관리자 기기 해제 완료');
            _checkAdminDeviceStatus(); // 버튼 상태 갱신
        }
    } catch (e) {
        alert('해제 요청 실패: ' + e.message);
    }
};

// 2-0. 관리자 접속 시 알림 팝업 (검토 필요 + 수집 실패 통합)
window.showCollectFailureAlert = async function () {
    try {
        // 검토 필요 + 수집 실패 병렬 조회
        const [failRes, reviewRes] = await Promise.all([
            fetch('/api/admin/collect-failures'),
            fetch('/api/admin/review-needed')
        ]);
        let failures = [];
        let reviews = [];
        if (failRes.ok) failures = await failRes.json();
        if (reviewRes.ok) reviews = await reviewRes.json();

        // 미확인 검토 필요 항목만 필터
        const pendingReviews = (reviews || []).filter(r => !r.acknowledged);
        // 둘 다 없으면 팝업 표시하지 않음
        if ((!failures || failures.length === 0) && pendingReviews.length === 0) return;

        const old = document.getElementById('collect-failure-popup');
        if (old) old.remove();

        const popup = document.createElement('div');
        popup.id = 'collect-failure-popup';
        popup.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.7);z-index:10002;display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s;';
        popup.onclick = (e) => { if (e.target === popup) popup.remove(); };

        let contentHtml = '';
        const totalCount = pendingReviews.length + (failures ? failures.length : 0);

        // ── 검토 필요 섹션 (오렌지) ──
        if (pendingReviews.length > 0) {
            const reviewRows = pendingReviews.map(r => {
                const time = r.detectedAt ? new Date(r.detectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '';
                const preview = (r.referenceText || '').substring(0, 60) + ((r.referenceText || '').length > 60 ? '...' : '');
                return `<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:8px;margin-bottom:6px;">
                    <i class="fa-solid fa-magnifying-glass" style="color:#f59e0b;flex-shrink:0;margin-top:2px;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="color:#fcd34d;font-size:0.85rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.title || r.reportId}</div>
                        <div style="color:#d4a276;font-size:0.72rem;margin-top:2px;">${preview}</div>
                        <div style="color:#94a3b8;font-size:0.68rem;margin-top:2px;">${time}</div>
                    </div>
                </div>`;
            }).join('');
            contentHtml += `
                <div style="margin-bottom:10px;color:#fcd34d;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid fa-magnifying-glass"></i> 검토 필요 ${pendingReviews.length}건
                </div>
                ${reviewRows}`;
        }

        // ── 수집 실패 섹션 (빨간) ──
        if (failures && failures.length > 0) {
            const failRows = failures.map(f => {
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
            if (pendingReviews.length > 0) contentHtml += '<div style="border-top:1px solid rgba(255,255,255,0.08);margin:10px 0;"></div>';
            contentHtml += `
                <div style="margin-bottom:10px;color:#fca5a5;font-size:0.85rem;font-weight:600;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 수집 실패 ${failures.length}건
                </div>
                ${failRows}`;
        }

        // 팝업 테두리 색상: 검토 필요만 있으면 오렌지, 수집 실패 포함 시 빨강
        const borderColor = failures && failures.length > 0 ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)';
        const shadowColor = failures && failures.length > 0 ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)';
        const headerIcon = failures && failures.length > 0 ? 'fa-triangle-exclamation' : 'fa-magnifying-glass';
        const headerColor = failures && failures.length > 0 ? '#ef4444' : '#f59e0b';

        popup.innerHTML = `
            <div style="background:#1e293b;border-radius:14px;width:90%;max-width:500px;max-height:80vh;overflow:hidden;display:flex;flex-direction:column;border:1px solid ${borderColor};box-shadow:0 0 30px ${shadowColor};">
                <div style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.1);display:flex;align-items:center;gap:10px;">
                    <i class="fa-solid ${headerIcon}" style="color:${headerColor};font-size:1.2rem;"></i>
                    <div style="flex:1;">
                        <h4 style="margin:0;color:#fff;font-size:1rem;">관리자 확인 필요 ${totalCount}건</h4>
                        <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">관리자 센터 → 특보 알림 → 특보 수집 오류 탭에서 상세 확인</div>
                    </div>
                    <button onclick="document.getElementById('collect-failure-popup').remove()" style="background:none;border:none;color:#94a3b8;font-size:1.3rem;cursor:pointer;">&times;</button>
                </div>
                <div style="padding:14px 18px;overflow-y:auto;flex:1;">${contentHtml}</div>
                <div style="padding:12px 18px;border-top:1px solid rgba(255,255,255,0.1);display:flex;gap:10px;justify-content:flex-end;">
                    <button onclick="clearCollectFailures()" style="padding:8px 16px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;font-weight:600;">
                        <i class="fa-solid fa-check"></i> 전체 확인
                    </button>
                    <button onclick="document.getElementById('collect-failure-popup').remove()" style="padding:8px 16px;background:rgba(255,255,255,0.1);color:#e2e8f0;border:none;border-radius:8px;cursor:pointer;font-size:0.85rem;">닫기</button>
                </div>
            </div>`;
        document.body.appendChild(popup);
    } catch (e) { /* 무시 */ }
};

// 실패 기록 삭제 + 검토 항목 전체 확인완료 및 팝업 닫기
window.clearCollectFailures = async function () {
    try {
        // 수집 실패 삭제 + 검토 필요 전체 확인완료 병렬 처리
        await Promise.all([
            fetch('/api/admin/collect-failures', { method: 'DELETE' }),
            fetch('/api/admin/review-needed/acknowledge-all', { method: 'POST' })
        ]);
        const popup = document.getElementById('collect-failure-popup');
        if (popup) popup.remove();
    } catch (e) { /* 무시 */ }
};

// 2. 통합 관리자 모달 메인
window.showUnifiedAdminModal = function (initialTab = 'alert') {
    const existing = document.getElementById('unified-admin-modal');
    if (existing) existing.remove();

    // 관리자 센터 상단 메인 탭 목록 (탭 클릭 시 switchUnifiedAdminTab()에서 분기)
    const tabs = [
        { id: 'alert', name: '특보 알림', icon: 'fa-tower-broadcast' },
        { id: 'api', name: 'API 설정', icon: 'fa-server' },
        { id: 'notice', name: '공지 팝업', icon: 'fa-bell' },
        { id: 'promo', name: '게시판 관리', icon: 'fa-bullhorn' },
        { id: 'stats', name: '방문자 통계', icon: 'fa-chart-line' },
        { id: 'survey', name: '설문조사', icon: 'fa-clipboard-list' },
        { id: 'report', name: '제보 관리', icon: 'fa-envelope' },
        { id: 'block', name: '차단 관리', icon: 'fa-ban' },
        { id: 'maintenance', name: '점검', icon: 'fa-wrench' },
        { id: 'version', name: '버전 관리', icon: 'fa-code-branch' },
        { id: 'storage', name: '외부 저장소', icon: 'fa-cloud' }
    ];

    const modal = document.createElement('div');
    modal.id = 'unified-admin-modal';

    const isAdminMode = localStorage.getItem('seagnal_admin_mode') === 'true';

    modal.innerHTML = `
        <div class="unified-admin-wrapper">
            <div class="unified-admin-header">
                <h3><i class="fa-solid fa-user-shield"></i> SEAGNAL 통합 관리자 센터</h3>
                <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                    <label style="display:flex;align-items:center;gap:5px;cursor:pointer;font-size:0.7rem;color:#94a3b8;" title="앱 종료 후에도 관리자 모드 유지">
                        <input type="checkbox" id="admin-mode-toggle" ${isAdminMode ? 'checked' : ''} onchange="window._toggleAdminMode(this.checked)"
                               style="width:14px;height:14px;accent-color:#3b82f6;">
                        <span>관리자 모드</span>
                    </label>
                    <!-- [관리자 기기 등록] 이 기기로 수집 오류/검토 필요 푸시 알림을 받을지 설정 -->
                    <div id="admin-device-btns" style="display:flex;gap:4px;">
                        <button id="btn-admin-register" onclick="window._registerAdminDevice()" style="padding:3px 8px;background:#3b82f6;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:0.65rem;font-weight:600;" title="이 기기를 관리자 알림 수신 기기로 등록">
                            <i class="fa-solid fa-mobile-screen"></i> 등록
                        </button>
                        <button id="btn-admin-unregister" onclick="window._unregisterAdminDevice()" style="padding:3px 8px;background:#64748b;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:0.65rem;font-weight:600;" title="이 기기의 관리자 알림 수신 해제">
                            <i class="fa-solid fa-bell-slash"></i> 해제
                        </button>
                    </div>
                    <button class="unified-admin-close" onclick="document.getElementById('unified-admin-modal').remove();">
                        <i class="fa-solid fa-xmark"></i>
                    </button>
                </div>
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

    // [관리자 기기 등록 상태 확인] 현재 기기가 관리자로 등록되어 있는지 서버에서 조회하여 버튼 상태 갱신
    _checkAdminDeviceStatus();

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
        } else if (tabId === 'report') {
            if (typeof renderUnifiedReportContent === 'function') renderUnifiedReportContent(body);
        } else if (tabId === 'block') {
            if (typeof renderUnifiedBlockContent === 'function') renderUnifiedBlockContent(body);
        } else if (tabId === 'maintenance') {
            renderUnifiedMaintenanceContent(body);
        } else if (tabId === 'version') {
            renderUnifiedVersionContent(body);
        } else if (tabId === 'storage') {
            // 외부 저장소 현황 탭 (Cloudinary, Google Cloud Storage 사용량)
            // → admin_collect.js의 renderUnifiedStorageContent()에서 렌더링
            renderUnifiedStorageContent(body);
        }
    }, 100);
};

// ============================================================================
// (A-0) 오류 목록 / 수동 입력 (특보 알림 탭 내부에서 사용)
// ============================================================================

// --- 서브탭 1: 오류 목록 (검토 필요 + 수집 실패 2섹션) ---
async function renderErrorListTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    // 두 가지 데이터를 병렬로 조회
    let failures = [];
    let reviews = [];
    try {
        const [failRes, reviewRes] = await Promise.all([
            fetch('/api/admin/collect-failures'),
            fetch('/api/admin/review-needed')
        ]);
        if (failRes.ok) failures = await failRes.json();
        if (reviewRes.ok) reviews = await reviewRes.json();
    } catch (e) { /* 무시 */ }

    // 미확인 검토 필요 항목만 필터
    const pendingReviews = (reviews || []).filter(r => !r.acknowledged);

    // 둘 다 없으면 정상 상태 표시
    if ((!failures || failures.length === 0) && pendingReviews.length === 0) {
        container.innerHTML = `
            <div style="text-align:center;padding:60px 20px;color:#64748b;">
                <i class="fa-solid fa-circle-check" style="font-size:2.5rem;color:#22c55e;margin-bottom:15px;display:block;"></i>
                <div style="font-size:1rem;font-weight:700;color:#cbd5e1;margin-bottom:6px;">수집 오류 없음</div>
                <div style="font-size:0.85rem;">현재 확인이 필요한 항목이 없습니다.</div>
            </div>`;
        return;
    }

    let html = '';

    // ── 섹션 1: 검토 필요 (오렌지색) ──
    if (pendingReviews.length > 0) {
        const reviewRows = pendingReviews.map(r => {
            const time = r.detectedAt ? new Date(r.detectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
            // 참고사항 미리보기 (최대 80자)
            const preview = (r.referenceText || '').substring(0, 80) + ((r.referenceText || '').length > 80 ? '...' : '');
            return `
                <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.2);border-radius:10px;margin-bottom:8px;">
                    <i class="fa-solid fa-magnifying-glass" style="color:#f59e0b;flex-shrink:0;font-size:1.1rem;margin-top:2px;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="color:#fcd34d;font-size:0.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${r.title || r.reportId}</div>
                        <div style="color:#d4a276;font-size:0.75rem;margin-top:3px;line-height:1.4;background:rgba(245,158,11,0.05);padding:6px 8px;border-radius:6px;">${preview}</div>
                        <div style="color:#94a3b8;font-size:0.68rem;margin-top:3px;">${time}</div>
                    </div>
                    <button onclick="acknowledgeReviewItem('${r.reportId}')" style="background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:6px;color:#fff;padding:6px 10px;cursor:pointer;font-size:0.72rem;white-space:nowrap;font-weight:600;" title="확인 완료 처리">
                        <i class="fa-solid fa-check"></i> 확인완료
                    </button>
                </div>`;
        }).join('');

        html += `
            <div style="margin-bottom:16px;">
                <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="color:#fcd34d;font-size:0.9rem;font-weight:600;">
                        <i class="fa-solid fa-magnifying-glass"></i> 검토 필요 ${pendingReviews.length}건
                    </div>
                    <button onclick="acknowledgeAllReviews()" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                        <i class="fa-solid fa-check-double"></i> 전체 확인완료
                    </button>
                </div>
                ${reviewRows}
            </div>`;
    }

    // ── 섹션 2: 수집 실패 (빨간색) ──
    if (failures && failures.length > 0) {
        const failRows = failures.map(f => {
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

        html += `
            <div>
                <div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
                    <div style="color:#fca5a5;font-size:0.9rem;font-weight:600;">
                        <i class="fa-solid fa-triangle-exclamation"></i> 수집 실패 ${failures.length}건
                    </div>
                    <button onclick="clearAllCollectFailuresAndRefresh()" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                        <i class="fa-solid fa-check"></i> 전체 삭제
                    </button>
                </div>
                ${failRows}
            </div>`;
    }

    container.innerHTML = html;
}

// [검토 필요] 개별 확인완료 처리
window.acknowledgeReviewItem = async function (reportId) {
    try {
        await fetch('/api/admin/review-needed/acknowledge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reportId })
        });
        // UI 새로고침
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { /* 무시 */ }
};

// [검토 필요] 전체 확인완료 처리
window.acknowledgeAllReviews = async function () {
    try {
        await fetch('/api/admin/review-needed/acknowledge-all', { method: 'POST' });
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { /* 무시 */ }
};

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
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { /* 무시 */ }
};

// 전체 실패 기록 삭제 및 새로고침
window.clearAllCollectFailuresAndRefresh = async function () {
    try {
        await fetch('/api/admin/collect-failures', { method: 'DELETE' });
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
                        <option value="아침(06시~09시)">아침(06~09시)</option>
                        <option value="오전(06시~12시)">오전(06~12시)</option>
                        <option value="오전(09시~12시)">오전(09~12시)</option>
                        <option value="낮(12시~15시)">낮(12~15시)</option>
                        <option value="오후(12시~18시)">오후(12~18시)</option>
                        <option value="늦은 오후(15시~18시)">늦은 오후(15~18시)</option>
                        <option value="저녁(18시~21시)">저녁(18~21시)</option>
                        <option value="밤(18시~24시)">밤(18~24시)</option>
                        <option value="밤(21시~24시)">밤(21~24시)</option>
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
    const isRangeVal = (v) => v && /[새벽아침오전낮오후저녁밤]\(/.test(v);
    const parseRangeVal = (v) => {
        if (!v) return null;
        const m = v.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(.*)/);
        if (!m) return null;
        return { date: `${m[1]}-${m[2]}-${m[3]}`, period: m[4].trim() };
    };
    // 범위형 period를 select option의 value와 정확히 매칭하는 헬퍼
    const selectRangePeriod = (selectEl, periodStr) => {
        // 1차: value 정확 매칭
        for (const opt of selectEl.options) {
            if (opt.value === periodStr) { opt.selected = true; return; }
        }
        // 2차: 시간 범위 매칭 (예: "밤(21시~24시)" vs "밤(21시~24시)")
        const timeMatch = periodStr.match(/(\d{2})시~(\d{2})시/);
        if (timeMatch) {
            for (const opt of selectEl.options) {
                if (opt.value.includes(timeMatch[1] + '시~' + timeMatch[2] + '시')) { opt.selected = true; return; }
            }
        }
        // 3차: 앞부분 키워드 매칭 (fallback)
        const prefix = periodStr.split('(')[0];
        for (const opt of selectEl.options) {
            if (opt.value.split('(')[0] === prefix) { opt.selected = true; return; }
        }
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
            selectRangePeriod(document.getElementById('ma-tmEf-range-period'), parsed.period);
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
            selectRangePeriod(document.getElementById('ma-tmEd-range-period'), parsed.period);
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
            body: JSON.stringify({ zoneName, warnType, level, command, tmFc, tmEf, tmCc, skipPush: true })
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
            body: JSON.stringify({ zoneName, skipPush: true })
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

    // 테스트 모드 토글 이벤트 바인딩
    const testToggleWrap = document.getElementById('atm-testmode-toggle-wrap');
    if (testToggleWrap) {
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
                fetch('/api/admin/test-cleanup', { method: 'POST' }).catch(() => {});
            }
            switchAlertTestTab('status');
        });
    }

    switchAlertTestTab('status');
}

// ============================================================================
// (G) 점검 모드 관리 탭 렌더링 (하위 탭: 점검 모드 / 운영 병행 모드)
// ============================================================================
async function renderUnifiedMaintenanceContent(container) {
    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-wrench" style="color:#f59e0b;"></i> 점검 관리
        </div>
        <!-- 하위 탭 -->
        <div style="display:flex;gap:0;margin-bottom:20px;border-radius:10px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);">
            <button id="maint-subtab-full" onclick="switchMaintenanceSubTab('full')" style="flex:1;padding:12px;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;">
                <i class="fa-solid fa-ban"></i> 점검 모드
            </button>
            <button id="maint-subtab-work" onclick="switchMaintenanceSubTab('work')" style="flex:1;padding:12px;background:rgba(255,255,255,0.03);color:#64748b;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;">
                <i class="fa-solid fa-helmet-safety"></i> 운영 병행 모드
            </button>
        </div>
        <div id="maint-subtab-body"></div>
    `;
    // 기본: 점검 모드 탭
    switchMaintenanceSubTab('full');
}

window.switchMaintenanceSubTab = function (tab) {
    const fullBtn = document.getElementById('maint-subtab-full');
    const workBtn = document.getElementById('maint-subtab-work');
    const body = document.getElementById('maint-subtab-body');
    if (!body) return;

    const activeStyle = 'flex:1;padding:12px;background:rgba(255,255,255,0.1);color:#fff;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;';
    const inactiveStyle = 'flex:1;padding:12px;background:rgba(255,255,255,0.03);color:#64748b;border:none;cursor:pointer;font-weight:700;font-size:0.85rem;';

    if (tab === 'full') {
        fullBtn.style.cssText = activeStyle;
        workBtn.style.cssText = inactiveStyle;
        renderMaintenanceFullTab(body);
    } else {
        fullBtn.style.cssText = inactiveStyle;
        workBtn.style.cssText = activeStyle;
        renderMaintenanceWorkTab(body);
    }
};

// --- 점검 모드 (전체 차단) 하위 탭 ---
async function renderMaintenanceFullTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    let config = { active: false, title: '', content: '', startedAt: null, blockedFeatures: [], blockPush: true };
    try {
        const res = await fetch('/api/admin/maintenance');
        if (res.ok) config = await res.json();
    } catch (e) { /* 무시 */ }

    const statusColor = config.active ? '#ef4444' : '#22c55e';
    const statusText = config.active ? '점검 중' : '정상 운영';
    const statusIcon = config.active ? 'fa-wrench' : 'fa-check-circle';
    const btnLabel = config.active ? '점검 해제' : '점검 시작';
    const btnColor = config.active ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#ef4444,#dc2626)';
    const btnIcon = config.active ? 'fa-play' : 'fa-stop';

    const blocked = config.blockedFeatures || [];
    const isBlockPush = config.blockPush !== false;
    // 선택적 차단 가능한 기능 목록
    // [구조] id: applyFeatureBlocks()에서 사용하는 차단 식별자
    //        label: 관리자 UI에 표시되는 한글 이름
    //        group: 체크박스 그룹 분류 (UI 렌더링용)
    // [연계] index.html applyFeatureBlocks() → featureMap/tabMap에서 동일 id 사용
    //        saveBlockedFeatures() → 체크된 id를 서버로 전송
    const features = [
        // 기상정보 > 특보 및 전망 탭 내 아코디언 (개별 차단 가능)
        { id: 'marine-forecast', label: '기상청 해상 기상 전망', group: '기상정보 > 특보 및 전망 내' },
        { id: 'weather-alert', label: '해역별 특보현황', group: '기상정보 > 특보 및 전망 내' },
        { id: 'weather-buoy', label: '해역별 기상현황', group: '기상정보 > 특보 및 전망 내' },
        // 기상정보 하위 서브탭 (탭 단위 차단)
        { id: 'weather-alert-tab', label: '특보 및 전망', group: '기상정보 하위 탭' },
        { id: 'sea-zone', label: '해구기상', group: '기상정보 하위 탭' },
        { id: 'typhoon', label: '태풍정보', group: '기상정보 하위 탭' },
        { id: 'cctv', label: '해안 CCTV', group: '기상정보 하위 탭' },
        // 해양생활 하위 서브탭 (탭 단위 차단)
        { id: 'fishing', label: '바다낚시', group: '해양생활 하위 탭' },
        { id: 'surfing', label: '서핑', group: '해양생활 하위 탭' },
        { id: 'swimming', label: '해수욕', group: '해양생활 하위 탭' },
        { id: 'scuba', label: '스킨스쿠버', group: '해양생활 하위 탭' },
        { id: 'mudflat', label: '갯벌체험', group: '해양생활 하위 탭' },
        { id: 'sea-parting', label: '바다갈라짐', group: '해양생활 하위 탭' },
        // 메인 탭 (독립 탭 단위 차단)
        { id: 'tide', label: '조석정보', group: '메인 탭' },
        { id: 'promo', label: '공지사항', group: '메인 탭' },
    ];

    const checkboxStyle = 'width:16px;height:16px;accent-color:#ef4444;cursor:pointer;';

    // 점검 중일 때 차단된 서비스 목록 HTML 생성
    let blockedListHtml = '';
    if (config.active && blocked.length > 0) {
        const blockedLabels = blocked.map(id => {
            const f = features.find(feat => feat.id === id);
            return f ? f.label : id;
        });
        blockedListHtml = `
            <div style="margin-top:10px;padding:10px 12px;background:rgba(239,68,68,0.1);border-radius:8px;border:1px solid rgba(239,68,68,0.2);">
                <div style="color:#fca5a5;font-size:0.75rem;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-list-check"></i> 차단된 서비스</div>
                ${blockedLabels.map(label => `<div style="color:#e2e8f0;font-size:0.8rem;padding:3px 0;"><i class="fa-solid fa-xmark" style="color:#ef4444;margin-right:6px;font-size:0.7rem;"></i>${label}</div>`).join('')}
            </div>
        `;
    }

    container.innerHTML = `
        <!-- 현재 상태 표시 -->
        <div style="margin-bottom:20px;padding:16px;background:rgba(0,0,0,0.2);border-radius:12px;border:1px solid ${statusColor}33;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <i class="fa-solid ${statusIcon}" style="color:${statusColor};font-size:1.3rem;"></i>
                <span style="color:${statusColor};font-weight:700;font-size:1.1rem;">${statusText}</span>
            </div>
            ${config.active && config.startedAt ? `<div style="color:#94a3b8;font-size:0.8rem;">시작 시각: ${config.startedAt}</div>` : ''}
            ${config.active && isBlockPush ? `<div style="color:#fca5a5;font-size:0.8rem;margin-top:4px;"><i class="fa-solid fa-bell-slash"></i> 푸시 알림 발송이 차단되어 있습니다.</div>` : ''}
            ${config.active && !isBlockPush ? `<div style="color:#86efac;font-size:0.8rem;margin-top:4px;"><i class="fa-solid fa-bell"></i> 푸시 알림은 정상 발송됩니다.</div>` : ''}
            ${blockedListHtml}
        </div>

        <!-- 차단 방식 선택 -->
        <div style="margin-bottom:16px;">
            <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:8px;font-weight:600;">차단 방식</label>
            <div style="display:flex;gap:10px;margin-bottom:12px;">
                <label style="display:flex;align-items:center;gap:6px;color:#e2e8f0;font-size:0.85rem;cursor:pointer;">
                    <input type="radio" name="maint-block-type" value="full" ${blocked.length === 0 ? 'checked' : ''} onchange="toggleBlockType()" style="accent-color:#ef4444;cursor:pointer;"> 전체 차단
                </label>
                <label style="display:flex;align-items:center;gap:6px;color:#e2e8f0;font-size:0.85rem;cursor:pointer;">
                    <input type="radio" name="maint-block-type" value="selective" ${blocked.length > 0 ? 'checked' : ''} onchange="toggleBlockType()" style="accent-color:#f59e0b;cursor:pointer;"> 선택적 차단
                </label>
            </div>
            <!-- 선택적 차단 체크박스 -->
            <div id="maint-feature-list" style="display:${blocked.length > 0 && !config.active ? 'block' : 'none'};padding:14px;background:rgba(0,0,0,0.15);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
                <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:10px;">차단할 기능을 선택하세요:</div>
                ${(() => {
                    // 그룹별로 체크박스를 자동 렌더링
                    // [연계] features 배열의 group 속성 기준으로 그룹 분리
                    const groups = [];
                    const seen = new Set();
                    features.forEach(f => {
                        if (!seen.has(f.group)) { seen.add(f.group); groups.push(f.group); }
                    });
                    return groups.map(g => `
                        <div style="margin-bottom:8px;color:#64748b;font-size:0.7rem;font-weight:600;">${g}</div>
                        ${features.filter(f => f.group === g).map(f => `
                            <label style="display:flex;align-items:center;gap:8px;padding:6px 0;color:#e2e8f0;font-size:0.85rem;cursor:pointer;">
                                <input type="checkbox" class="maint-feature-cb" value="${f.id}" ${blocked.includes(f.id) ? 'checked' : ''} style="${checkboxStyle}"> ${f.label}
                            </label>
                        `).join('')}
                        <div style="height:1px;background:rgba(255,255,255,0.06);margin:8px 0;"></div>
                    `).join('');
                })()}
                <button onclick="saveBlockedFeatures()" style="margin-top:12px;width:100%;padding:10px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.85rem;">
                    <i class="fa-solid fa-save"></i> 차단 기능 저장
                </button>
            </div>
        </div>

        <!-- 푸시 알림 차단 옵션 -->
        <div style="margin-bottom:16px;">
            <label style="display:flex;align-items:center;gap:8px;color:#e2e8f0;font-size:0.85rem;cursor:pointer;padding:12px;background:rgba(0,0,0,0.15);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
                <input type="checkbox" id="maint-block-push" ${isBlockPush ? 'checked' : ''} style="width:16px;height:16px;accent-color:#ef4444;cursor:pointer;">
                <div>
                    <div style="font-weight:600;"><i class="fa-solid fa-bell-slash" style="color:#f59e0b;margin-right:4px;"></i> 푸시 알림 차단</div>
                    <div style="color:#94a3b8;font-size:0.75rem;margin-top:2px;">체크 시 점검 중 모든 푸시 알림 발송이 중지됩니다.</div>
                </div>
            </label>
        </div>

        <!-- 점검 제목 -->
        <div style="margin-bottom:14px;">
            <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;font-weight:600;">점검 제목</label>
            <input type="text" id="maint-title" value="${(config.title || '').replace(/"/g, '&quot;')}" placeholder="예: 서버 점검 안내"
                   style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.95rem;box-sizing:border-box;">
        </div>

        <!-- 점검 내용 -->
        <div style="margin-bottom:20px;">
            <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;font-weight:600;">점검 내용</label>
            <textarea id="maint-content" rows="5" placeholder="사용자에게 표시할 점검 안내 내용을 입력하세요."
                      style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.95rem;box-sizing:border-box;resize:vertical;line-height:1.5;">${config.content || ''}</textarea>
        </div>

        <!-- 내용 저장 버튼 -->
        <div style="margin-bottom:16px;">
            <button onclick="saveMaintenanceContent()" style="width:100%;padding:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;">
                <i class="fa-solid fa-save"></i> 점검 내용 저장
            </button>
        </div>

        <!-- 구분선 -->
        <div style="height:1px;background:rgba(255,255,255,0.1);margin:20px 0;"></div>

        <!-- 점검 시작/해제 버튼 -->
        <div style="margin-bottom:16px;">
            <button id="maint-toggle-btn" onclick="toggleMaintenanceMode()" style="width:100%;padding:14px;background:${btnColor};color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                <i class="fa-solid ${btnIcon}"></i> ${btnLabel}
            </button>
        </div>

        <!-- 안내 -->
        <div style="padding:14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;">
            <div style="color:#fbbf24;font-size:0.85rem;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-circle-info"></i> 안내</div>
            <ul style="color:#94a3b8;font-size:0.8rem;margin:0;padding-left:16px;line-height:1.8;">
                <li><b>전체 차단</b>: 점검 시작 시 모든 사용자에게 점검 페이지가 표시됩니다.</li>
                <li><b>선택적 차단</b>: 선택한 기능만 차단되고, 나머지 기능은 정상 이용 가능합니다.</li>
                <li><b>푸시 알림 차단</b>: 체크 해제 시 점검 중에도 푸시 알림이 정상 발송됩니다.</li>
                <li>관리자는 점검 페이지에서 로고를 10회 클릭하여 우회 접속할 수 있습니다.</li>
                <li>점검 해제 시 사용자가 정상적으로 앱에 접근할 수 있습니다.</li>
            </ul>
        </div>
    `;
}

window.toggleBlockType = function () {
    const featureList = document.getElementById('maint-feature-list');
    const blockType = document.querySelector('input[name="maint-block-type"]:checked').value;
    featureList.style.display = blockType === 'selective' ? 'block' : 'none';
};

window.saveBlockedFeatures = async function () {
    const blockType = document.querySelector('input[name="maint-block-type"]:checked').value;
    let blockedFeatures = [];
    if (blockType === 'selective') {
        document.querySelectorAll('.maint-feature-cb:checked').forEach(cb => blockedFeatures.push(cb.value));
    }
    try {
        const res = await fetch('/api/admin/maintenance-features', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ blockedFeatures })
        });
        const result = await res.json();
        if (result.success) {
            alert('차단 기능이 저장되었습니다.');
        } else {
            alert('저장 실패: ' + (result.error || ''));
        }
    } catch (e) {
        alert('오류: ' + e.message);
    }
};

// --- 운영 병행 모드 하위 탭 ---
async function renderMaintenanceWorkTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    let config = { active: false, content: '', estimatedEnd: '', startedAt: null };
    try {
        const res = await fetch('/api/admin/work-mode');
        if (res.ok) config = await res.json();
    } catch (e) { /* 무시 */ }

    const statusColor = config.active ? '#f59e0b' : '#22c55e';
    const statusText = config.active ? '작업 중' : '미활성';
    const statusIcon = config.active ? 'fa-helmet-safety' : 'fa-check-circle';
    const btnLabel = config.active ? '작업 종료' : '작업 시작';
    const btnColor = config.active ? 'linear-gradient(135deg,#22c55e,#16a34a)' : 'linear-gradient(135deg,#f59e0b,#d97706)';
    const btnIcon = config.active ? 'fa-stop' : 'fa-play';

    const defaultContent = `현재 관리자가 SEA:GNAL의 쾌적한 사용 및 운영을 위하여 기능 개선작업을 진행 중입니다.\n작업 중에는 표출 오류, 서버 멈춤 등 기타 문제가 일시적으로 발생할 수 있습니다.\n하지만 작업 소요시간은 오래 걸리지 않으니 사용 중 문제가 발생하지 않도록 신속하게 마무리하겠습니다.\n이용해주셔서 감사합니다.`;

    container.innerHTML = `
        <!-- 현재 상태 -->
        <div style="margin-bottom:20px;padding:16px;background:rgba(0,0,0,0.2);border-radius:12px;border:1px solid ${statusColor}33;">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
                <i class="fa-solid ${statusIcon}" style="color:${statusColor};font-size:1.3rem;"></i>
                <span style="color:${statusColor};font-weight:700;font-size:1.1rem;">${statusText}</span>
            </div>
            ${config.active && config.startedAt ? `<div style="color:#94a3b8;font-size:0.8rem;">시작 시각: ${config.startedAt}</div>` : ''}
        </div>

        <!-- 표출 내용 -->
        <div style="margin-bottom:14px;">
            <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;font-weight:600;">표출 내용 <span style="color:#64748b;font-size:0.75rem;">(비워두면 기본 문구 사용)</span></label>
            <textarea id="work-mode-content" rows="6" placeholder="${defaultContent}"
                      style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.95rem;box-sizing:border-box;resize:vertical;line-height:1.5;">${config.content || ''}</textarea>
        </div>

        <!-- 종료 예상시점 -->
        <div style="margin-bottom:20px;">
            <label style="display:block;color:#94a3b8;font-size:0.85rem;margin-bottom:6px;font-weight:600;">작업 종료 예상시점</label>
            <input type="datetime-local" id="work-mode-end" value="${config.estimatedEnd || ''}"
                   style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.95rem;box-sizing:border-box;">
        </div>

        <!-- 내용 저장 버튼 -->
        <div style="margin-bottom:16px;">
            <button onclick="saveWorkModeContent()" style="width:100%;padding:12px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.9rem;">
                <i class="fa-solid fa-save"></i> 내용 저장
            </button>
        </div>

        <!-- 구분선 -->
        <div style="height:1px;background:rgba(255,255,255,0.1);margin:20px 0;"></div>

        <!-- 시작/종료 버튼 -->
        <div style="margin-bottom:16px;">
            <button onclick="toggleWorkMode()" style="width:100%;padding:14px;background:${btnColor};color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:1rem;box-shadow:0 4px 12px rgba(0,0,0,0.3);">
                <i class="fa-solid ${btnIcon}"></i> ${btnLabel}
            </button>
        </div>

        <!-- 안내 -->
        <div style="padding:14px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.2);border-radius:10px;">
            <div style="color:#fbbf24;font-size:0.85rem;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-circle-info"></i> 안내</div>
            <ul style="color:#94a3b8;font-size:0.8rem;margin:0;padding-left:16px;line-height:1.8;">
                <li>서비스는 정상 운영되며, 사용자에게 작업 중임을 안내합니다.</li>
                <li>헤더에 <span style="color:#fbbf24;">[기능개선 작업 중]</span> 뱃지가 깜빡이며 표시됩니다.</li>
                <li>뱃지를 클릭하면 안내 팝업이 표시됩니다.</li>
                <li>점검 모드와 동시에 활성화할 수 있습니다.</li>
            </ul>
        </div>
    `;
}

window.saveWorkModeContent = async function () {
    const content = document.getElementById('work-mode-content').value.trim();
    const estimatedEnd = document.getElementById('work-mode-end').value;
    try {
        const res = await fetch('/api/admin/work-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content, estimatedEnd })
        });
        const result = await res.json();
        if (result.success) alert('내용이 저장되었습니다.');
        else alert('저장 실패: ' + (result.error || ''));
    } catch (e) {
        alert('오류: ' + e.message);
    }
};

window.toggleWorkMode = async function () {
    let config = { active: false };
    try {
        const res = await fetch('/api/admin/work-mode');
        if (res.ok) config = await res.json();
    } catch (e) { /* */ }

    const newActive = !config.active;
    const content = document.getElementById('work-mode-content').value.trim();
    const estimatedEnd = document.getElementById('work-mode-end').value;

    const confirmMsg = newActive
        ? '운영 병행 모드를 시작하시겠습니까?\n\n사용자에게 [기능개선 작업 중] 뱃지가 표시됩니다.'
        : '운영 병행 모드를 종료하시겠습니까?';

    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch('/api/admin/work-mode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: newActive, content, estimatedEnd })
        });
        const result = await res.json();
        if (result.success) {
            alert(newActive ? '운영 병행 모드가 시작되었습니다.' : '운영 병행 모드가 종료되었습니다.');
            const body = document.getElementById('maint-subtab-body');
            if (body) renderMaintenanceWorkTab(body);
        } else {
            alert('오류: ' + (result.error || ''));
        }
    } catch (e) {
        alert('오류: ' + e.message);
    }
};

/** 점검 내용만 저장 (활성화 상태 변경 없이) */
window.saveMaintenanceContent = async function () {
    const title = document.getElementById('maint-title').value.trim();
    const content = document.getElementById('maint-content').value.trim();

    if (!title) {
        alert('점검 제목을 입력해주세요.');
        return;
    }

    try {
        const res = await fetch('/api/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content })
        });
        const result = await res.json();
        if (result.success) {
            alert('점검 내용이 저장되었습니다.');
        } else {
            alert('저장 실패: ' + (result.error || ''));
        }
    } catch (e) {
        alert('오류: ' + e.message);
    }
};

// ============================================================================
// (H) 버전 관리 탭 렌더링
// ============================================================================
async function renderUnifiedVersionContent(container) {
    container.innerHTML = '<div style="text-align:center;padding:60px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin fa-2x"></i><p style="margin-top:15px;">버전 정보 로딩 중...</p></div>';

    let versionData = {};
    try {
        const res = await fetch('/api/app-version');
        if (res.ok) versionData = await res.json();
    } catch (e) { /* 무시 */ }

    const fieldStyle = 'width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.95rem;box-sizing:border-box;';
    const currentStyle = 'padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#94a3b8;font-size:0.95rem;font-family:monospace;';

    container.innerHTML = `
        <div class="admin-section-title">
            <i class="fa-solid fa-code-branch" style="color:#8b5cf6;"></i> 앱 버전 관리
        </div>

        <div style="padding:14px;background:rgba(139,92,246,0.08);border:1px solid rgba(139,92,246,0.2);border-radius:10px;margin-bottom:20px;">
            <div style="color:#a78bfa;font-size:0.85rem;font-weight:600;margin-bottom:4px;"><i class="fa-solid fa-circle-info"></i> 안내</div>
            <div style="color:#94a3b8;font-size:0.8rem;line-height:1.6;">
                새 버전 생성 시 <span style="color:#a78bfa;font-weight:600;">android/app/build.gradle</span>의 <span style="color:#a78bfa;font-weight:600;">versionCode</span>와 <span style="color:#a78bfa;font-weight:600;">versionName</span>을 업데이트 후 Play Store에 배포한 후, 아래에서 버전 정보를 업데이트하면<br>
                기존 사용자 앱에서 자동으로 업데이트 팝업이 표시됩니다.
            </div>
        </div>

        <!-- 테이블 형태: 기존 / 변경 -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
            <!-- 헤더 -->
            <div style="text-align:center;color:#64748b;font-size:0.85rem;font-weight:700;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.1);">현재 값</div>
            <div style="text-align:center;color:#a78bfa;font-size:0.85rem;font-weight:700;padding-bottom:8px;border-bottom:1px solid rgba(139,92,246,0.3);">변경할 값</div>

            <!-- latestVersion -->
            <div>
                <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:6px;font-weight:600;">latestVersion</label>
                <div style="${currentStyle}">${versionData.latestVersion || '-'}</div>
            </div>
            <div>
                <label style="display:block;color:#a78bfa;font-size:0.8rem;margin-bottom:6px;font-weight:600;">latestVersion</label>
                <input type="text" id="ver-latestVersion" value="${versionData.latestVersion || ''}" placeholder="예: 1.2.0" style="${fieldStyle}">
            </div>

            <!-- latestVersionCode -->
            <div>
                <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:6px;font-weight:600;">versionCode</label>
                <div style="${currentStyle}">${versionData.latestVersionCode || '-'}</div>
            </div>
            <div>
                <label style="display:block;color:#a78bfa;font-size:0.8rem;margin-bottom:6px;font-weight:600;">versionCode</label>
                <input type="number" id="ver-latestVersionCode" value="${versionData.latestVersionCode || ''}" placeholder="예: 4" style="${fieldStyle}">
            </div>

        </div>

        <!-- 업데이트 메시지 (전체 너비) -->
        <div style="margin-bottom:20px;">
            <label style="display:block;color:#94a3b8;font-size:0.8rem;margin-bottom:4px;font-weight:600;">현재 업데이트 메시지</label>
            <div style="${currentStyle}; white-space:pre-wrap; margin-bottom:10px;">${versionData.updateMessage || '-'}</div>
            <label style="display:block;color:#a78bfa;font-size:0.8rem;margin-bottom:4px;font-weight:600;">변경할 업데이트 메시지</label>
            <textarea id="ver-updateMessage" rows="4" placeholder="사용자에게 표시할 업데이트 안내" style="${fieldStyle}; resize:vertical; line-height:1.5;">${versionData.updateMessage || ''}</textarea>
        </div>

        <!-- 적용 버튼 -->
        <button id="ver-apply-btn" onclick="applyVersionUpdate()" style="width:100%;padding:14px;background:linear-gradient(135deg,#8b5cf6,#7c3aed);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:1rem;box-shadow:0 4px 12px rgba(139,92,246,0.3);">
            <i class="fa-solid fa-check"></i> 적용
        </button>
    `;
}

/** 버전 정보 적용 */
window.applyVersionUpdate = async function () {
    const latestVersion = document.getElementById('ver-latestVersion').value.trim();
    const latestVersionCode = parseInt(document.getElementById('ver-latestVersionCode').value, 10);
    const updateMessage = document.getElementById('ver-updateMessage').value.trim();

    if (!latestVersion || isNaN(latestVersionCode)) {
        alert('latestVersion과 versionCode는 필수 입력입니다.');
        return;
    }

    const btn = document.getElementById('ver-apply-btn');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> 적용 중...';

    try {
        const res = await fetch('/api/admin/app-version', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latestVersion, latestVersionCode, updateMessage })
        });
        const result = await res.json();
        if (result.success) {
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 적용 완료!';
            btn.style.background = 'linear-gradient(135deg,#22c55e,#16a34a)';
            // UI 새로고침
            setTimeout(() => {
                const body = document.getElementById('unified-admin-body');
                if (body) renderUnifiedVersionContent(body);
            }, 1000);
        } else {
            alert('적용 실패: ' + (result.error || ''));
            btn.innerHTML = '<i class="fa-solid fa-check"></i> 적용';
            btn.disabled = false;
            btn.style.background = 'linear-gradient(135deg,#8b5cf6,#7c3aed)';
        }
    } catch (e) {
        alert('오류: ' + e.message);
        btn.innerHTML = '<i class="fa-solid fa-check"></i> 적용';
        btn.disabled = false;
        btn.style.background = 'linear-gradient(135deg,#8b5cf6,#7c3aed)';
    }
};

/** 점검 모드 시작/해제 토글 */
window.toggleMaintenanceMode = async function () {
    // 현재 상태 조회
    let config = { active: false };
    try {
        const res = await fetch('/api/admin/maintenance');
        if (res.ok) config = await res.json();
    } catch (e) { /* */ }

    const newActive = !config.active;
    const title = document.getElementById('maint-title').value.trim();
    const content = document.getElementById('maint-content').value.trim();

    if (newActive && !title) {
        alert('점검을 시작하려면 제목을 입력해주세요.');
        return;
    }

    const blockType = document.querySelector('input[name="maint-block-type"]:checked');
    const isSelective = blockType && blockType.value === 'selective';
    const blockPushCb = document.getElementById('maint-block-push');
    const blockPush = blockPushCb ? blockPushCb.checked : true;

    let confirmMsg;
    if (!newActive) {
        confirmMsg = '점검 모드를 해제하시겠습니까?\n\n사용자가 정상적으로 앱에 접근할 수 있습니다.';
    } else {
        const pushMsg = blockPush ? '\n푸시 알림 발송이 차단됩니다.' : '\n푸시 알림은 정상 발송됩니다.';
        confirmMsg = isSelective
            ? '점검 모드를 시작하시겠습니까?\n\n선택한 기능만 차단되고, 나머지 기능은 정상 이용 가능합니다.' + pushMsg
            : '점검 모드를 시작하시겠습니까?\n\n모든 사용자에게 점검 페이지가 표시됩니다.' + pushMsg;
    }

    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch('/api/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ active: newActive, title, content, blockPush })
        });
        const result = await res.json();
        if (result.success) {
            alert(newActive ? '점검 모드가 시작되었습니다.' : '점검 모드가 해제되었습니다.');
            // 하위 탭 UI 새로고침
            const subtabBody = document.getElementById('maint-subtab-body');
            if (subtabBody) renderMaintenanceFullTab(subtabBody);
        } else {
            alert('오류: ' + (result.error || ''));
        }
    } catch (e) {
        alert('오류: ' + e.message);
    }
};

