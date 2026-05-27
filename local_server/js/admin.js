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

// ============================================================================
// [Phase 4-B] 관리자 토큰 기반 인증 (보안 강화)
// ============================================================================
//
// [왜 이 블록이 생겼는가]
//   기존: 비밀번호가 이 파일에 하드코딩 + 클라이언트 측에서 직접 비교.
//         소스 보기로 비번 노출 + 서버 admin API 는 누구나 호출 가능.
//   변경: 비밀번호는 서버 .env 에만 존재. 클라이언트는 서버에 비번 보내고
//         토큰을 받아 sessionStorage(또는 "비밀번호 저장" 체크 시 localStorage)
//         에 보관. 이후 모든 /api/admin/* 호출에 X-Admin-Token 헤더 자동 첨부.
//
// [핵심 헬퍼]
//   getStoredAdminToken / saveAdminToken / clearAdminToken
//   setAdminAuthState  - adminAuthenticated.* 플래그 일괄 갱신
//
// [fetch 래퍼]
//   window.fetch 를 1회 감싸서 /api/admin/* 호출에 헤더 자동 첨부 + 401 자동 정리.
//   호출처 34곳의 fetch 코드는 그대로 둠 (래퍼가 가로채므로).
//
// [예외 URL — 헤더 안 붙이는 곳]
//   /api/admin/login                   (인증을 발급하는 곳, 당연히 면제)
//   /api/admin/maintenance-bypass-verify (점검 우회 일회성 검증, 토큰 무관)

const ADMIN_TOKEN_KEY = 'seagnal_admin_token';

/** localStorage(영구) > sessionStorage(세션) 순으로 토큰 조회. 없으면 null. */
function getStoredAdminToken() {
    try {
        return localStorage.getItem(ADMIN_TOKEN_KEY) ||
               sessionStorage.getItem(ADMIN_TOKEN_KEY) || null;
    } catch (_) { return null; }
}

/**
 * 토큰 저장.
 * @param {string}  token   서버에서 받은 토큰
 * @param {boolean} persist true 면 localStorage(영구), false 면 sessionStorage(탭 단위)
 *
 * 양쪽 저장소를 먼저 비우고 한 쪽에만 저장 → 중복으로 옛 토큰이 남는 사고 방지.
 */
function saveAdminToken(token, persist) {
    try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
        if (persist) {
            localStorage.setItem(ADMIN_TOKEN_KEY, token);
        } else {
            sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
        }
    } catch (_) { /* private mode 등 — 조용히 무시 */ }
}

/** 양쪽 저장소에서 토큰 모두 제거 (만료/로그아웃) */
function clearAdminToken() {
    try {
        localStorage.removeItem(ADMIN_TOKEN_KEY);
        sessionStorage.removeItem(ADMIN_TOKEN_KEY);
    } catch (_) { /* 무시 */ }
}

/** adminAuthenticated 플래그 4개를 한꺼번에 설정. UI 가드용 */
function setAdminAuthState(authed) {
    adminAuthenticated.api = !!authed;
    adminAuthenticated.notice = !!authed;
    adminAuthenticated.promo = !!authed;
    adminAuthenticated.alert = !!authed;
}

// 원본 fetch 보존 (래퍼 안에서 호출 + 외부에서 비-admin 호출에 활용)
const _origFetch = window.fetch.bind(window);

/**
 * window.fetch 글로벌 래퍼.
 *
 * [동작]
 *   - URL 이 /api/admin/* 이고 예외(login, bypass-verify)가 아닐 때만 처리
 *     1) 저장된 토큰이 있으면 X-Admin-Token 헤더 첨부
 *     2) 응답이 401 이면 토큰을 즉시 무효화 + 인증 상태 해제
 *        → 다음 admin 작업 시 로그인 모달이 다시 뜸
 *   - 그 외 URL 은 손대지 않고 원본 fetch 그대로 호출 (회귀 위험 최소화)
 *
 * [멱등성]
 *   이 파일이 두 번 로드되어도(이론상) 같은 함수로 다시 감싸지 않도록
 *   _origFetch 는 모듈 스코프에 한 번만 캡처됨.
 */
window.fetch = function adminAwareFetch(input, init) {
    let url = '';
    try {
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
    } catch (_) { /* 무시 */ }

    const isAdminApi = url.indexOf('/api/admin/') !== -1;
    const isExempt = isAdminApi && (
        url.indexOf('/api/admin/login') !== -1 ||
        url.indexOf('/api/admin/maintenance-bypass-verify') !== -1
    );
    const shouldAttachToken = isAdminApi && !isExempt;

    if (shouldAttachToken) {
        const token = getStoredAdminToken();
        if (token) {
            init = init || {};
            // Headers 객체로 변환 (init.headers 가 plain object/Headers/배열 모두 가능)
            const headers = new Headers(init.headers || {});
            headers.set('X-Admin-Token', token);
            init.headers = headers;
        }
    }

    const promise = _origFetch(input, init);

    if (shouldAttachToken) {
        return promise.then(function (res) {
            if (res && res.status === 401) {
                // 토큰 만료 또는 무효 — 정리. 다음 admin 작업 시 로그인 모달 표시됨.
                clearAdminToken();
                setAdminAuthState(false);
                console.warn('[admin] 인증 만료/무효 — 다시 로그인이 필요합니다.');
            }
            return res;
        });
    }
    return promise;
};

// ============================================================================
// [Phase 4-B] 페이지 로드 시 저장된 토큰 복원
// ============================================================================
//   토큰 자체의 유효성은 첫 API 호출에서 확인됨 (401 받으면 fetch 래퍼가 정리).
//   네트워크 없이 즉시 UI 상태 복원 → 자동 로그인 UX.
(function _restoreAdminAuthOnLoad() {
    if (getStoredAdminToken()) {
        setAdminAuthState(true);
    }
})();

// 1. 통합 로그인 모달 (Mode: 'api' | 'notice' | 'promo')
window.showUnifiedLoginModal = function (mode, title, icon) {
    const existing = document.getElementById('unified-admin-login-modal');
    if (existing) existing.remove();

    const iconColor = mode === 'api' ? '#4fc3f7' : (mode === 'notice' ? '#ffd54f' : (mode === 'promo' ? '#ff7043' : '#ef5350'));

    const modal = document.createElement('div');
    modal.id = 'unified-admin-login-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;animation:fadeIn 0.2s ease-out;';

    // "비밀번호 저장" 체크 여부: 직전에 영구 저장된 토큰이 있던 사용자에겐
    // 체크박스가 미리 체크되어 있도록 기본값 결정 (UX — 본인 기기 사용자 편의).
    const rememberDefault = !!(function(){
        try { return localStorage.getItem(ADMIN_TOKEN_KEY); } catch(_) { return null; }
    })();

    modal.innerHTML = `
        <div style="background:#1e2435;border-radius:12px;padding:20px;max-width:320px;width:90%;text-align:center;box-shadow:0 10px 25px rgba(0,0,0,0.5);border:1px solid rgba(255,255,255,0.08);">
            <h3 style="color:#fff;margin:0 0 15px;font-size:1.1rem;display:flex;align-items:center;justify-content:center;gap:8px;">
                <i class="fa-solid ${icon}" style="color:${iconColor};"></i>${title}
            </h3>
            <input type="password" id="unified-admin-password" placeholder="관리자 비밀번호"
                   style="width:100%;padding:12px;border:1px solid rgba(255,255,255,0.1);border-radius:8px;background:rgba(0,0,0,0.3);color:#fff;font-size:1rem;box-sizing:border-box;margin-bottom:10px;outline:none;text-align:center;">
            <!-- [Phase 4-B] "비밀번호 저장" 체크박스 — 체크 시 토큰을 localStorage 에
                  영구 저장하고 만료를 30 일로 연장 (본 기기에서만 사용한다는 전제) -->
            <label style="display:flex;align-items:center;justify-content:center;gap:6px;
                          color:#aaa;font-size:0.85rem;margin-bottom:15px;cursor:pointer;user-select:none;">
                <input type="checkbox" id="unified-admin-remember" ${rememberDefault ? 'checked' : ''}
                       style="width:14px;height:14px;cursor:pointer;accent-color:${iconColor};">
                이 기기에서 비밀번호 저장 (30일)
            </label>
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

/**
 * [Phase 4-B] 관리자 비밀번호 검증 — 서버에 위임 (보안 강화)
 *
 * 기존: 클라이언트에서 if (password === '하드코딩') 직접 비교
 *        → 소스 보기로 비번 노출, 서버 admin API 도 무방비
 * 변경: 비밀번호를 서버 POST /api/admin/login 에 보내 검증
 *        → 서버는 .env 의 ADMIN_PASSWORD 와 timingSafeEqual 비교
 *        → 성공 시 토큰 발급 → 클라이언트 저장 → 이후 모든 admin API 호출에 첨부
 *
 * 체크박스 "비밀번호 저장" 켜져 있으면:
 *   - 서버에 longTerm=true 로 요청 → 30일 만료 토큰
 *   - localStorage 에 저장 (브라우저 닫아도 유지)
 * 체크 꺼져 있으면:
 *   - longTerm=false → 24시간 만료 토큰
 *   - sessionStorage 에 저장 (탭 닫으면 사라짐)
 */
window.verifyUnifiedAdminPassword = async function (mode) {
    const input = document.getElementById('unified-admin-password');
    if (!input) return;

    const password = input.value;
    const rememberCb = document.getElementById('unified-admin-remember');
    const longTerm = !!(rememberCb && rememberCb.checked);

    try {
        // [중요] 원본 fetch 사용 — fetch 래퍼는 login URL 예외 처리하지만
        //        명시적으로 _origFetch 를 써서 어떤 환경에서도 헤더 첨부 시도 0 보장.
        const res = await _origFetch('/api/admin/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password, longTerm })
        });

        if (!res.ok) {
            // 서버가 401 또는 기타 에러 — 사용자에겐 동일 메시지 (정보 누출 방지)
            alert('비밀번호가 일치하지 않습니다.');
            input.value = '';
            input.focus();
            return;
        }

        const data = await res.json();
        if (!data || !data.token) {
            alert('서버 응답이 올바르지 않습니다. 잠시 후 다시 시도하세요.');
            return;
        }

        // 토큰 저장 + 인증 상태 표시
        saveAdminToken(data.token, longTerm);
        setAdminAuthState(true);

        document.getElementById('unified-admin-login-modal').remove();

        // 통합 관리자 모달 호출 (인증된 모드로 시작)
        showUnifiedAdminModal(mode);
    } catch (e) {
        // 네트워크 오류 등 — 사용자에게 친근한 메시지
        alert('서버와 통신할 수 없습니다. 인터넷 연결을 확인하세요.');
        console.error('[admin] 로그인 실패:', e && e.message);
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
        // [종합 통계] 기존 '이용자 현황' 탭을 대체. 내부에 [이용자 현황][사용량 통계] 하위탭.
        { id: 'stats', name: '종합 통계', icon: 'fa-chart-line' },
        { id: 'alert', name: '특보 알림', icon: 'fa-tower-broadcast' },
        { id: 'api', name: 'API 설정', icon: 'fa-server' },
        { id: 'notice', name: '공지 팝업', icon: 'fa-bell' },
        { id: 'promo', name: '게시판 관리', icon: 'fa-bullhorn' },
        { id: 'survey', name: '설문조사', icon: 'fa-clipboard-list' },
        { id: 'report', name: '제보 관리', icon: 'fa-envelope' },
        { id: 'block', name: '차단 관리', icon: 'fa-ban' },
        { id: 'maintenance', name: '점검', icon: 'fa-wrench' },
        { id: 'version', name: '버전 관리', icon: 'fa-code-branch' },
        { id: 'storage', name: '외부 저장소', icon: 'fa-cloud' },
        { id: 'ai', name: 'AI', icon: 'fa-robot' }
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
                    <button class="unified-admin-close" onclick="if(window.PopupStack)window.PopupStack.remove('unified-admin-modal'); if(typeof clearErrorListAutoRefresh==='function'){clearErrorListAutoRefresh();} document.getElementById('unified-admin-modal').remove();">
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

    // [뒤로가기] 통합 관리자 센터를 PopupStack 에 등록 → 휴대폰 하드웨어 뒤로가기로 닫힘(앱 종료 방지).
    if (window.PopupStack) {
        window.PopupStack.push('unified-admin-modal', function () {
            var m = document.getElementById('unified-admin-modal');
            if (m) {
                try { if (typeof clearErrorListAutoRefresh === 'function') clearErrorListAutoRefresh(); } catch (e) {}
                m.remove();
            }
        });
    }

    // [관리자 기기 등록 상태 확인] 현재 기기가 관리자로 등록되어 있는지 서버에서 조회하여 버튼 상태 갱신
    _checkAdminDeviceStatus();

    // 초기 탭 활성화
    switchUnifiedAdminTab(initialTab);

    // [v7 정리] 수집 실패 팝업 제거 — 오류 로그 탭에서 의심 사례 결정 UI 로 대체.
    //   (의심 사례 push 가 별도로 발사되므로 별도 팝업 불필요)
};

window.switchUnifiedAdminTab = function (tabId) {
    // [하위호환] 구버전의 'users' 탭 참조 → 'stats'(종합 통계) 로 정규화.
    if (tabId === 'users') tabId = 'stats';
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
        if (tabId === 'stats' || tabId === 'users') {
            // [종합 통계] 'users'(구버전 참조) 하위호환: stats 로 위임.
            //   내부에서 [이용자 현황][사용량 통계] 하위탭을 렌더하며, 기본은 이용자 현황.
            renderUnifiedComprehensiveStats(body);
        } else if (tabId === 'alert') {
            renderUnifiedAlertContent(body);
        } else if (tabId === 'api') {
            renderUnifiedApiContent(body);
        } else if (tabId === 'notice') {
            renderUnifiedNoticeContent(body);
        } else if (tabId === 'promo') {
            renderUnifiedPromoContent(body);
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
        } else if (tabId === 'ai') {
            renderUnifiedAiTab(body);
        }
    }, 100);
};

// ============================================================================
// AI 탭 — Gemini 호출량 + AI 비서 테스트 호출 + 음성 권한 토글
// ----------------------------------------------------------------------------
//  보안: 이 탭은 관리자만 진입 가능. AI 도구는 공개/사용자 데이터 한정이며
//        관리자 기능에는 접근하지 않는다(서버 측 도구 카탈로그에서 제외됨).
// ============================================================================
async function renderUnifiedAiTab(container) {
    container.innerHTML = `
        <div class="admin-section-title"><i class="fa-solid fa-robot" style="color:#22d3ee;"></i> AI 비서</div>

        <div id="ai-usage-box" style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="font-size:0.85rem;color:#94a3b8;margin-bottom:8px;"><i class="fa-solid fa-chart-simple"></i> 오늘 Gemini 호출량 (KST)</div>
            <div id="ai-usage-content" style="color:#e2e8f0;font-size:0.9rem;">불러오는 중…</div>
        </div>

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;margin-bottom:14px;">
            <div style="font-size:0.85rem;color:#94a3b8;margin-bottom:10px;"><i class="fa-solid fa-shield-halved"></i> 권한 관리</div>

            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
                <i class="fa-solid fa-microphone" style="color:#22d3ee;width:16px;"></i>
                <span style="font-size:0.85rem;color:#cbd5e1;">마이크</span>
                <span id="ai-perm-mic" style="font-size:0.8rem;color:#94a3b8;">확인 중…</span>
                <button id="ai-perm-mic-req" style="padding:5px 10px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;">권한 요청</button>
                <button id="ai-perm-mic-set" style="padding:5px 10px;background:#64748b;color:#fff;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;display:none;">설정 열기</button>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                <i class="fa-solid fa-location-dot" style="color:#34d399;width:16px;"></i>
                <span style="font-size:0.85rem;color:#cbd5e1;">위치(GPS)</span>
                <span id="ai-perm-gps" style="font-size:0.8rem;color:#94a3b8;">확인 중…</span>
                <button id="ai-perm-gps-req" style="padding:5px 10px;background:#3b82f6;color:#fff;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;">권한 요청</button>
                <button id="ai-perm-gps-set" style="padding:5px 10px;background:#64748b;color:#fff;border:none;border-radius:6px;font-size:0.75rem;cursor:pointer;display:none;">설정 열기</button>
            </div>
            <div style="font-size:0.72rem;color:#64748b;margin-top:6px;">거부했어도 "권한 요청"을 다시 누르거나, 막혔으면 "설정 열기"로 직접 허용할 수 있습니다.</div>

            <hr style="border:none;border-top:1px solid rgba(255,255,255,.08);margin:12px 0;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <i class="fa-solid fa-tower-broadcast" style="color:#22d3ee;"></i>
                <span style="font-size:0.85rem;color:#cbd5e1;">음성 비서(나리야)</span>
                <span id="ai-voice-status" style="font-size:0.8rem;color:#94a3b8;">상태 확인 중…</span>
                <button id="ai-voice-toggle" style="padding:6px 14px;background:#22d3ee;color:#04263b;border:none;border-radius:8px;font-weight:700;cursor:pointer;">켜기</button>
            </div>
            <div style="font-size:0.72rem;color:#64748b;margin-top:6px;">켜면 백그라운드에서 "나리야" 호출을 대기합니다. (앱에서만 동작)</div>
        </div>

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px;">
            <div style="font-size:0.85rem;color:#94a3b8;margin-bottom:8px;"><i class="fa-solid fa-flask"></i> 테스트 호출</div>
            <div style="display:flex;gap:8px;">
                <input id="ai-test-input" type="text" placeholder="예: 325 해구 60시간 후 조업 가능할까?" style="flex:1;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.3);color:#e2e8f0;font-size:0.9rem;outline:none;">
                <button id="ai-test-send" style="padding:0 16px;background:#3b82f6;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;">전송</button>
            </div>
            <div id="ai-test-result" style="margin-top:12px;color:#e2e8f0;font-size:0.9rem;line-height:1.6;white-space:pre-wrap;"></div>
        </div>
    `;

    // 1) 호출량 + 키 상태
    try {
        const r = await fetch('/api/admin/gemini-status');
        const d = await r.json();
        const u = d.usage || {};
        const keyTxt = (d.keys || []).map(k => `${k.label}${k.onCooldown ? '(쿨다운)' : ''}`).join(', ') || '없음';
        document.getElementById('ai-usage-content').innerHTML =
            `요청 <b>${u.requests || 0}</b>회 · 성공 <b>${u.success || 0}</b> · 한도초과 <b>${u.rateLimited || 0}</b><br>` +
            `<span style="color:#94a3b8;font-size:0.8rem;">키: ${keyTxt} · AI ${d.hasAnyKey ? '사용 가능' : '미설정(키 없음)'}</span>`;
    } catch (e) {
        document.getElementById('ai-usage-content').textContent = '호출량을 불러오지 못했습니다: ' + e.message;
    }

    // 2) 권한 관리 — 마이크/위치 권한 상태·요청·설정열기 (거부해도 재요청 가능)
    (function () {
        const P = (window.Capacitor && window.Capacitor.Plugins) ? window.Capacitor.Plugins : null;
        const Native = P && P.SeagnalAssistant ? P.SeagnalAssistant : null;   // 마이크(@Permission) 보유
        const Geo = P && P.Geolocation ? P.Geolocation : null;               // 위치
        const Settings = P && P.NativeSettings ? P.NativeSettings : null;    // 앱 설정 열기
        const label = (s) => s === 'granted' ? '허용됨' : (s === 'denied' ? '거부됨' : '미요청');
        const color = (s) => s === 'granted' ? '#34d399' : (s === 'denied' ? '#fbbf24' : '#94a3b8');
        const openSettings = () => { if (Settings && Settings.openAndroid) Settings.openAndroid({ option: 'application_details' }).catch(() => {}); };

        // 공통 렌더러: plugin.checkPermissions/requestPermissions(권한키) 사용
        function wire(plugin, permKey, ids) {
            const stEl = document.getElementById(ids.st), reqEl = document.getElementById(ids.req), setEl = document.getElementById(ids.set);
            if (!plugin || !plugin.checkPermissions) { stEl.textContent = '앱에서만 사용 가능'; reqEl.style.display = 'none'; return; }
            const apply = (state) => {
                stEl.textContent = label(state); stEl.style.color = color(state);
                setEl.style.display = (state === 'denied') ? 'inline-block' : 'none';
                reqEl.textContent = (state === 'granted') ? '재확인' : '권한 요청';
            };
            const refresh = () => plugin.checkPermissions().then(r => apply(r && r[permKey])).catch(() => apply('prompt'));
            refresh();
            reqEl.addEventListener('click', () => {
                reqEl.disabled = true;
                plugin.requestPermissions().then(r => apply(r && r[permKey])).catch(() => apply('denied')).then(() => { reqEl.disabled = false; });
            });
            setEl.addEventListener('click', openSettings);
        }
        wire(Native, 'microphone', { st: 'ai-perm-mic', req: 'ai-perm-mic-req', set: 'ai-perm-mic-set' });
        wire(Geo, 'location', { st: 'ai-perm-gps', req: 'ai-perm-gps-req', set: 'ai-perm-gps-set' });

        // 음성 비서(나리야) on/off 토글
        const st = document.getElementById('ai-voice-status');
        const btn = document.getElementById('ai-voice-toggle');
        if (!Native) { st.textContent = '앱(안드로이드)에서만 사용 가능'; btn.disabled = true; btn.style.opacity = .5; return; }
        let running = false;
        const render = () => { st.textContent = running ? '켜짐 — "나리야" 대기 중' : '꺼짐'; st.style.color = running ? '#34d399' : '#94a3b8'; btn.textContent = running ? '끄기' : '켜기'; };
        Native.isEnabled().then(x => { running = !!(x && x.running); render(); }).catch(render);
        btn.addEventListener('click', () => {
            btn.disabled = true;
            let profile = '{}'; try { profile = localStorage.getItem('seagnal_profile') || '{}'; } catch (e) {}
            const op = running ? Native.disable() : Native.enable({ serverUrl: location.origin, profile });
            op.then(x => { running = x ? !!x.running : !running; render(); })
              .catch(e => { st.textContent = '오류: ' + (e && e.message ? e.message : '권한/서비스 실패'); st.style.color = '#fbbf24'; })
              .then(() => { btn.disabled = false; });
        });
    })();

    // 3) 테스트 호출 (기존 /api/assistant/ask 사용)
    (function () {
        const input = document.getElementById('ai-test-input');
        const send = document.getElementById('ai-test-send');
        const out = document.getElementById('ai-test-result');
        const ask = () => {
            const q = input.value.trim(); if (!q) return;
            out.textContent = '생각 중…'; send.disabled = true;
            fetch('/api/assistant/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
                .then(r => r.json())
                .then(d => {
                    if (!d || !d.ok) throw new Error((d && d.error) || '응답 오류');
                    const tools = (d.data && d.data.toolsUsed) ? `\n[도구: ${d.data.toolsUsed.join(', ')}]` : '';
                    out.textContent = (d.answer || '(빈 응답)') + `\n\n— 해역:${d.zone || '-'} · 방식:${d.aiUsed ? 'AI두뇌' : '폴백'} · intent:${d.intent}` + tools;
                })
                .catch(e => { out.textContent = '오류: ' + e.message; })
                .then(() => { send.disabled = false; });
        };
        send.addEventListener('click', ask);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });
    })();
}
window.renderUnifiedAiTab = renderUnifiedAiTab;

// ============================================================================
// (A-0) 오류 목록 / 수동 입력 (특보 알림 탭 내부에서 사용)
// ============================================================================

// --- 서브탭 1: 오류 목록 (검토 필요 + 수집 실패 2섹션) ---
// [상태] 수집 오류 탭의 현재 선택된 하위 탭 및 자동 갱신 타이머
let currentErrorSubTab = 'review';  // 'review' | 'retry' | 'fail' (기본: 검토 필요)
let errorListAutoRefreshTimer = null;

// [페이지네이션] 세 리스트 각각 별도 페이지 번호 보관
// - 자동 갱신(30초) 시 현재 페이지를 그대로 재요청하기 위해 모듈-로컬 상태로 유지
// - 하위 탭 전환 시에도 보존 (각 탭 자체의 페이지 컨텍스트 유지)
// - 페이지 클릭 시에만 갱신되고, 응답 totalPages 보다 크면 자동 클램프
let _collectFailuresPage = 1;
let _reviewNeededPage = 1;
let _pendingRetriesPage = 1;
const _COLLECT_FAILURES_LIMIT = 30;
const _REVIEW_NEEDED_LIMIT = 30;
const _PENDING_RETRIES_LIMIT = 30;
// fetch race 가드: 30초 자동 갱신 + 페이지 클릭 + 사용자 액션 후 reload 인터리브에서
// 가장 마지막 요청 응답만 화면에 적용.
// - _errorListSeq: 전체 탭(initial + 30s auto-refresh)용 시퀀스
// - _failSeq / _reviewSeq / _retrySeq: 부분 갱신(섹션 페이지 클릭)용 섹션별 시퀀스
let _errorListSeq = 0;
let _failSeq = 0;
let _reviewSeq = 0;
let _retrySeq = 0;
// [D-7] "원문 보기" 펼침 상태 보존용 — 자동 갱신/부분 갱신 후 다시 펼치기
const _expandedRawIds = new Set();

/**
 * 에러 리스트 탭의 자동 새로고침 타이머 정지.
 * 탭 이탈 시 또는 탭 재진입 직전(중복 방지) 에 호출.
 */
function clearErrorListAutoRefresh() {
    if (errorListAutoRefreshTimer) {
        clearInterval(errorListAutoRefreshTimer);
        errorListAutoRefreshTimer = null;
    }
}

// 경과 시간(ms)을 "X시간 Y분" 형태로 포맷팅
function formatElapsed(ms) {
    if (!ms || ms < 0) return '-';
    const totalMin = Math.floor(ms / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours > 0) return `${hours}시간 ${mins}분`;
    return `${mins}분`;
}

/**
 * 관리자 화면의 에러 리스트 탭을 렌더 + 자동 새로고침 타이머 등록.
 * 진입 시 기존 타이머 정리 → 새 fetch → setInterval 로 주기 갱신 시작.
 *
 * [연계] /api/error-logs (GET) — 서버 에러 로그.
 *
 * @param {HTMLElement} container - 렌더 대상 컨테이너 (alert-top-content)
 * @param {number} depth - 재귀 클램프 호출 깊이 (무한 재귀 방지용 가드)
 */
async function renderErrorListTab(container, depth = 0) {
    // 재귀 가드: 서버에서 totalPages 가 NaN/0 으로 잘못 와도 무한 재귀 차단
    if (depth > 1) return;

    // 진입 시 자동 갱신 타이머 정리(중복 방지)
    clearErrorListAutoRefresh();

    const myReq = ++_errorListSeq;
    // 부분 갱신 시퀀스도 함께 무효화 (전체 갱신이 진행 중이면 늦은 섹션 응답이 화면을 덮어쓰지 못하도록)
    _failSeq++;
    _reviewSeq++;
    _retrySeq++;
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    // 다섯 가지 데이터를 병렬로 조회 (실패/검토/재시도/Gemini 키 상태/dmdw 오류).
    // 세 리스트(fail/review/retry)는 페이지네이션 모드(?page=)로 호출 → { data, pagination }.
    // - data: 현재 페이지 항목만
    // - pagination.total: 전체 항목 수 (배지/헤더 카운트용)
    // - 검토 필요는 신규 페이지네이션 전용 엔드포인트(review-needed/pending) 사용.
    // dmdw 오류는 페이지네이션 없이 raw array (main 패턴 유지).
    let failuresData = [];
    let failuresPagination = { page: 1, limit: _COLLECT_FAILURES_LIMIT, total: 0, totalPages: 1 };
    let reviewsData = [];
    let reviewsPagination = { page: 1, limit: _REVIEW_NEEDED_LIMIT, total: 0, totalPages: 1 };
    let pendingsData = [];
    let pendingsPagination = { page: 1, limit: _PENDING_RETRIES_LIMIT, total: 0, totalPages: 1 };
    let geminiStatus = { keys: [], count: 0 };
    let dmdwErrors = [];  // dmdw 자식 해역 크롤러 오류 로그
    // 섹션 단위 fetch 에러 플래그 (allSettled 결과 → 섹션별 분리)
    let failError = false;
    let reviewError = false;
    let retryError = false;

    const failUrl = `/api/admin/collect-failures?page=${_collectFailuresPage}&limit=${_COLLECT_FAILURES_LIMIT}`;
    const reviewUrl = `/api/admin/review-needed/pending?page=${_reviewNeededPage}&limit=${_REVIEW_NEEDED_LIMIT}`;
    const pendingUrl = `/api/admin/pending-retries?page=${_pendingRetriesPage}&limit=${_PENDING_RETRIES_LIMIT}`;
    // allSettled: 한 섹션 fetch 가 reject 되어도 나머지 섹션은 정상 표시
    const settled = await Promise.allSettled([
        fetch(failUrl).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
        fetch(reviewUrl).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
        fetch(pendingUrl).then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
        fetch('/api/admin/gemini-status').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))),
        fetch('/api/admin/dmdw-errors').then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)))
    ]);
    // race: body 파싱/렌더 직전 시퀀스 토큰 재확인 — 더 최신 요청이 떴으면 폐기
    if (myReq !== _errorListSeq) return;

    const [failR, reviewR, pendingR, geminiR, dmdwR] = settled;
    if (failR.status === 'fulfilled') {
        const body = failR.value;
        if (body && Array.isArray(body.data) && body.pagination) {
            failuresData = body.data;
            failuresPagination = body.pagination;
        } else if (Array.isArray(body)) {
            failuresData = body;
            failuresPagination = { page: 1, limit: _COLLECT_FAILURES_LIMIT, total: body.length, totalPages: 1 };
        }
    } else {
        failError = true;
    }
    if (reviewR.status === 'fulfilled') {
        const body = reviewR.value;
        if (body && Array.isArray(body.data) && body.pagination) {
            reviewsData = body.data;
            reviewsPagination = body.pagination;
        } else if (Array.isArray(body)) {
            const filt = body.filter(r => !r.acknowledged);
            reviewsData = filt;
            reviewsPagination = { page: 1, limit: _REVIEW_NEEDED_LIMIT, total: filt.length, totalPages: 1 };
        }
    } else {
        reviewError = true;
    }
    if (pendingR.status === 'fulfilled') {
        const body = pendingR.value;
        if (body && Array.isArray(body.data) && body.pagination) {
            pendingsData = body.data;
            pendingsPagination = body.pagination;
        } else if (Array.isArray(body)) {
            pendingsData = body;
            pendingsPagination = { page: 1, limit: _PENDING_RETRIES_LIMIT, total: body.length, totalPages: 1 };
        }
    } else {
        retryError = true;
    }
    if (geminiR.status === 'fulfilled') {
        geminiStatus = geminiR.value || { keys: [], count: 0 };
    }
    if (dmdwR.status === 'fulfilled') {
        dmdwErrors = Array.isArray(dmdwR.value) ? dmdwR.value : [];
    }
    // dmdw 는 fetch 실패해도 그대로 빈 배열 유지 — dmdw 탭만 빈 상태로 표시.

    // [빈 결과 가드] 세 리스트 모두 0건이면 다음 진입을 위해 페이지 변수 모두 1로 리셋.
    if (!failError && failuresPagination.total === 0) _collectFailuresPage = 1;
    if (!reviewError && reviewsPagination.total === 0) _reviewNeededPage = 1;
    if (!retryError && pendingsPagination.total === 0) _pendingRetriesPage = 1;

    // 페이지 클램프: 응답 totalPages 보다 크면 1 페이지로 리셋하고 자기 자신 재호출.
    // 데이터가 줄어들어 빈 페이지가 잡힌 경우 (예: 마지막 항목 삭제) 자동 보정.
    // depth 가드: 잘못된 totalPages 응답에도 한 번만 재호출하고 중단.
    let needReload = false;
    if (!failError && Number.isFinite(failuresPagination.totalPages) && _collectFailuresPage > failuresPagination.totalPages) {
        _collectFailuresPage = 1; needReload = true;
    }
    if (!reviewError && Number.isFinite(reviewsPagination.totalPages) && _reviewNeededPage > reviewsPagination.totalPages) {
        _reviewNeededPage = 1; needReload = true;
    }
    if (!retryError && Number.isFinite(pendingsPagination.totalPages) && _pendingRetriesPage > pendingsPagination.totalPages) {
        _pendingRetriesPage = 1; needReload = true;
    }
    if (needReload) {
        return renderErrorListTab(container, depth + 1);
    }

    const reviewCount = reviewsPagination.total;
    const retryCount = pendingsPagination.total;
    const failCount = failuresPagination.total;
    // dmdw 미확인 항목 카운트 — acknowledged=false 만 셈 (확인된 이력은 회색으로 잔존).
    const dmdwUnackCount = dmdwErrors.filter(e => !e.acknowledged).length;

    // Gemini 키 상태 배지 (항상 표시)
    const geminiBadgeHtml = renderGeminiKeysBadge(geminiStatus);

    // [정책 — main 사용자 요구]
    //   네 영역(검토/재시도/수집실패/dmdw) 모두 비어있어도 탭바는 항상 표시.
    //   이전 동작: 모두 0건이면 "수집 오류 없음" 메시지만 노출하고 return → 메뉴 구조 인지 불가.
    //   변경 동작: 탭바는 항상 그리고, 모두 0건인 경우만 탭바 위에 작은 "모든 항목 정상" 배너 노출.
    //   각 탭 내용은 섹션 렌더 함수가 빈 상태 메시지를 자체 처리.
    //   에러 섹션은 allEmpty 계산에서 제외 — 에러 상태도 사용자가 인지해야 하므로.
    const allEmpty = (
        !failError && !reviewError && !retryError &&
        reviewCount === 0 && retryCount === 0 && failCount === 0 && dmdwUnackCount === 0
    );
    const allClearBannerHtml = allEmpty
        ? `<div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 14px;margin-bottom:12px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;color:#86efac;font-size:0.85rem;font-weight:600;">
                <i class="fa-solid fa-circle-check"></i>
                모든 항목 정상 — 표시할 오류 없음
           </div>`
        : '';

    // 하위 탭 바 렌더링
    // [D-4] 배지 span 에 명시적 id 부여 → 부분 갱신 시 in-place 카운트 업데이트.
    //   count 0 일 때도 빈 배지 컨테이너를 유지 (display:none) 해야 in-place 업데이트가 가능.
    const tabBtn = (key, label, count, color) => {
        const active = (currentErrorSubTab === key);
        const badgeId = `err-subtab-${key}-badge`;
        const badgeStyle = count > 0
            ? `display:inline-block;min-width:18px;padding:1px 6px;margin-left:6px;background:${color};color:#fff;border-radius:10px;font-size:0.7rem;font-weight:700;text-align:center;`
            : `display:none;min-width:18px;padding:1px 6px;margin-left:6px;background:${color};color:#fff;border-radius:10px;font-size:0.7rem;font-weight:700;text-align:center;`;
        const badge = `<span id="${badgeId}" style="${badgeStyle}">${count > 0 ? count : ''}</span>`;
        const style = active
            ? `padding:8px 14px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);border-radius:8px;color:#93c5fd;cursor:pointer;font-size:0.82rem;font-weight:700;`
            : `padding:8px 14px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#94a3b8;cursor:pointer;font-size:0.82rem;font-weight:500;`;
        return `<button onclick="switchErrorSubTab('${key}')" style="${style}">${label}${badge}</button>`;
    };

    const tabBarHtml = `
        ${geminiBadgeHtml}
        ${allClearBannerHtml}
        <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;">
            ${tabBtn('review', '<i class="fa-solid fa-magnifying-glass"></i> 검토 필요', reviewCount, '#f59e0b')}
            ${tabBtn('retry',  '<i class="fa-solid fa-rotate"></i> 재시도 중',       retryCount,  '#3b82f6')}
            ${tabBtn('fail',   '<i class="fa-solid fa-triangle-exclamation"></i> 수집 실패', failCount, '#ef4444')}
            ${tabBtn('dmdw',   '<i class="fa-solid fa-globe"></i> dmdw 오류',         dmdwUnackCount, '#06b6d4')}
        </div>
        <div id="error-sub-tab-content"></div>
    `;
    container.innerHTML = tabBarHtml;

    const sub = document.getElementById('error-sub-tab-content');
    if (currentErrorSubTab === 'review') {
        sub.innerHTML = reviewError
            ? _renderSectionErrorHtml('review', '검토 필요')
            : renderReviewSectionHtml(reviewsData, reviewsPagination);
        _attachErrorListPagination('review', reviewsPagination);
    } else if (currentErrorSubTab === 'retry') {
        sub.innerHTML = retryError
            ? _renderSectionErrorHtml('retry', '재시도 중')
            : renderPendingRetriesHtml(pendingsData, pendingsPagination);
        _attachErrorListPagination('retry', pendingsPagination);
        // [D-7] 자동 갱신 후 펼친 원문 영역 복원 (에러 상태가 아닐 때만)
        if (!retryError) _restoreExpandedRawTexts();
    } else if (currentErrorSubTab === 'fail') {
        sub.innerHTML = failError
            ? _renderSectionErrorHtml('fail', '수집 실패')
            : renderFailureSectionHtml(failuresData, failuresPagination);
        _attachErrorListPagination('fail', failuresPagination);
    } else if (currentErrorSubTab === 'dmdw') {
        // [신규] dmdw 자식 해역 크롤러 오류 — 미확인 진하게, 확인됨 흐리게. 페이지네이션 없음.
        sub.innerHTML = renderDmdwErrorsSectionHtml(dmdwErrors);
    }

    // 자동 갱신은 서브탭 무관하게 항상 등록 (3개 서브탭 모두에서 30초 주기 동작)
    _registerErrorListAutoRefresh(container);
}

/**
 * 에러 리스트 탭 자동 갱신 타이머 등록 (모든 서브탭 공통).
 * 30초 주기로 renderErrorListTab 재호출하되, 현재 페이지/서브탭 상태는 모듈-로컬 변수로 보존.
 */
function _registerErrorListAutoRefresh(container) {
    clearErrorListAutoRefresh();
    errorListAutoRefreshTimer = setInterval(() => {
        const inner = document.getElementById('alert-top-content');
        // 컨테이너가 화면에서 사라졌으면 (탭 전환/모달 종료) 자동 정리
        if (!inner || !document.body.contains(inner)) {
            clearErrorListAutoRefresh();
            return;
        }
        renderErrorListTab(inner);
    }, 30000);
}

/**
 * 세 에러 리스트 페이지네이션 UI를 공용 helper 로 렌더 + 클릭 핸들러 부착.
 * - kind: 'review' | 'retry' | 'fail'
 * - pagination: { page, limit, total, totalPages }
 * 페이지 클릭 시 해당 섹션만 재 fetch + 그 섹션 컨테이너만 부분 갱신 (다른 섹션 보존).
 */
function _attachErrorListPagination(kind, pagination) {
    const containerId = kind === 'review' ? 'review-needed-pagination'
        : kind === 'retry' ? 'pending-retries-pagination'
            : 'collect-failures-pagination';
    const el = document.getElementById(containerId);
    if (!el || typeof window.renderStandardPagination !== 'function') return;
    const total = (pagination && pagination.totalPages) || 1;
    const cur = (pagination && pagination.page) || 1;
    window.renderStandardPagination(el, cur, total, (page) => {
        if (kind === 'review') {
            _reviewNeededPage = page;
            _fetchReviewNeededPage();
        } else if (kind === 'retry') {
            _pendingRetriesPage = page;
            _fetchPendingRetriesPage();
        } else {
            _collectFailuresPage = page;
            _fetchCollectFailuresPage();
        }
        // 페이지 전환 시 컨테이너 상단으로 부드럽게 스크롤 (다른 페이지네이션 화면과 동일 UX)
        // [H-3] inner 가 스크롤 컨테이너 자체일 경우 scrollIntoView 는 no-op →
        //   scroll({top:0}) 로 교체. scroll API 미지원 시 scrollTop fallback.
        const inner = document.getElementById('alert-top-content');
        if (inner) {
            if (typeof inner.scroll === 'function') {
                inner.scroll({ top: 0, behavior: 'smooth' });
            } else {
                inner.scrollTop = 0;
            }
        }
    });
}

/**
 * 섹션별 부분 갱신 fetch — 수집 실패.
 * 응답 도착 시 #collect-failures-section 컨테이너의 카드 + 페이지네이션만 다시 그림.
 * (다른 두 섹션의 상태/배지 카운트는 그대로 유지)
 */
async function _fetchCollectFailuresPage() {
    // [B-1] 부분 갱신 시작 시 전체용 시퀀스 토큰도 증가 →
    //   진행 중이던 30s 자동 갱신 응답이 자동 폐기되어 화면을 덮어쓰지 못함.
    //   섹션별 시퀀스(_failSeq)는 부분 갱신 간 race 가드용으로 그대로 유지.
    _errorListSeq++;
    const mySeq = ++_failSeq;
    const section = document.getElementById('collect-failures-section');
    if (!section) return;
    // [D-5] 헤더 보존: 리스트 영역(#collect-failures-list)만 스피너로 교체,
    //   섹션 헤더(수집실패 N건 + 전체삭제 버튼)는 그대로 유지.
    //   list-area id 가 현재 DOM 에 없으면(이전 렌더가 에러 메시지였던 경우 등)
    //   섹션 전체를 스피너로 교체 (fallback).
    _setSectionLoading(section, 'collect-failures-list');
    try {
        const res = await fetch(`/api/admin/collect-failures?page=${_collectFailuresPage}&limit=${_COLLECT_FAILURES_LIMIT}`);
        if (mySeq !== _failSeq) return;
        if (!res.ok) {
            // [D-6] 재시도 버튼 포함 에러 표시
            section.innerHTML = _renderSectionInnerErrorHtml('fail');
            return;
        }
        const body = await res.json();
        if (mySeq !== _failSeq) return;
        let data = [];
        let pagination = { page: 1, limit: _COLLECT_FAILURES_LIMIT, total: 0, totalPages: 1 };
        if (body && Array.isArray(body.data) && body.pagination) {
            data = body.data;
            pagination = body.pagination;
        } else if (Array.isArray(body)) {
            data = body;
            pagination = { page: 1, limit: _COLLECT_FAILURES_LIMIT, total: body.length, totalPages: 1 };
        }
        section.innerHTML = _renderFailureSectionInnerHtml(data, pagination);
        _attachErrorListPagination('fail', pagination);
        // [D-4] 다른 두 탭 배지 stale 회피 → 해당 섹션 배지만 in-place 업데이트
        _updateSubTabBadge('fail', pagination.total);
    } catch (e) {
        if (mySeq !== _failSeq) return;
        section.innerHTML = _renderSectionInnerErrorHtml('fail');
    }
}

/**
 * 섹션별 부분 갱신 fetch — 검토 필요.
 * 신규 페이지 전용 엔드포인트(/api/admin/review-needed/pending) 호출.
 */
async function _fetchReviewNeededPage() {
    // [B-1] 전체 시퀀스 토큰도 증가
    _errorListSeq++;
    const mySeq = ++_reviewSeq;
    const section = document.getElementById('review-needed-section');
    if (!section) return;
    // [D-5] 헤더 보존
    _setSectionLoading(section, 'review-needed-list');
    try {
        const res = await fetch(`/api/admin/review-needed/pending?page=${_reviewNeededPage}&limit=${_REVIEW_NEEDED_LIMIT}`);
        if (mySeq !== _reviewSeq) return;
        if (!res.ok) {
            section.innerHTML = _renderSectionInnerErrorHtml('review');
            return;
        }
        const body = await res.json();
        if (mySeq !== _reviewSeq) return;
        let data = [];
        let pagination = { page: 1, limit: _REVIEW_NEEDED_LIMIT, total: 0, totalPages: 1 };
        if (body && Array.isArray(body.data) && body.pagination) {
            data = body.data;
            pagination = body.pagination;
        } else if (Array.isArray(body)) {
            const filt = body.filter(r => !r.acknowledged);
            data = filt;
            pagination = { page: 1, limit: _REVIEW_NEEDED_LIMIT, total: filt.length, totalPages: 1 };
        }
        section.innerHTML = _renderReviewSectionInnerHtml(data, pagination);
        _attachErrorListPagination('review', pagination);
        _updateSubTabBadge('review', pagination.total);
    } catch (e) {
        if (mySeq !== _reviewSeq) return;
        section.innerHTML = _renderSectionInnerErrorHtml('review');
    }
}

/**
 * 섹션별 부분 갱신 fetch — 재시도 중.
 */
async function _fetchPendingRetriesPage() {
    // [B-1] 전체 시퀀스 토큰도 증가
    _errorListSeq++;
    const mySeq = ++_retrySeq;
    const section = document.getElementById('pending-retries-section');
    if (!section) return;
    // [D-5] 헤더 보존
    _setSectionLoading(section, 'pending-retries-list');
    try {
        const res = await fetch(`/api/admin/pending-retries?page=${_pendingRetriesPage}&limit=${_PENDING_RETRIES_LIMIT}`);
        if (mySeq !== _retrySeq) return;
        if (!res.ok) {
            section.innerHTML = _renderSectionInnerErrorHtml('retry');
            return;
        }
        const body = await res.json();
        if (mySeq !== _retrySeq) return;
        let data = [];
        let pagination = { page: 1, limit: _PENDING_RETRIES_LIMIT, total: 0, totalPages: 1 };
        if (body && Array.isArray(body.data) && body.pagination) {
            data = body.data;
            pagination = body.pagination;
        } else if (Array.isArray(body)) {
            data = body;
            pagination = { page: 1, limit: _PENDING_RETRIES_LIMIT, total: body.length, totalPages: 1 };
        }
        section.innerHTML = _renderPendingRetriesInnerHtml(data, pagination);
        _attachErrorListPagination('retry', pagination);
        _updateSubTabBadge('retry', pagination.total);
        // [D-7] 자동/부분 갱신 후 펼친 원문 영역 복원
        _restoreExpandedRawTexts();
    } catch (e) {
        if (mySeq !== _retrySeq) return;
        section.innerHTML = _renderSectionInnerErrorHtml('retry');
    }
}

// [D-5] 섹션 로딩 표시 — 리스트 영역만 스피너로 교체해 헤더 깜빡임 방지.
//   list-area id 가 현재 DOM 에 없으면 (이전 렌더가 에러 메시지였던 경우 등)
//   섹션 전체를 스피너로 교체.
function _setSectionLoading(section, listAreaId) {
    if (!section) return;
    const list = section.querySelector(`#${listAreaId}`);
    const spinner = '<div style="text-align:center;padding:20px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';
    if (list) {
        list.innerHTML = spinner;
    } else {
        section.innerHTML = spinner;
    }
}

// [D-6] 한 섹션 fetch 실패 시 [재시도] 버튼 함께 표시.
//   onclick 으로 해당 섹션의 _fetchXxxPage(현재 페이지) 를 다시 호출 →
//   자동 갱신 30초 대기 없이 사용자가 즉시 회복 가능.
// kind: 'review' | 'retry' | 'fail'
function _retryButtonHtml(kind) {
    const fnName = kind === 'review' ? '_fetchReviewNeededPage'
        : kind === 'retry' ? '_fetchPendingRetriesPage'
            : '_fetchCollectFailuresPage';
    // 최상위 function 선언이라 브라우저에서 window[fnName] 으로 접근 가능.
    return `<button onclick="${fnName}()" style="margin-top:10px;padding:6px 14px;background:rgba(59,130,246,0.15);border:1px solid rgba(59,130,246,0.4);border-radius:8px;color:#93c5fd;cursor:pointer;font-size:0.78rem;font-weight:600;">
        <i class="fa-solid fa-rotate"></i> 재시도
    </button>`;
}

// 섹션 부분 갱신 실패 메시지 (전체 갱신 시 — 섹션 외곽 컨테이너 포함).
// [D-6] 재시도 버튼 포함.
function _renderSectionErrorHtml(kind, label) {
    const containerId = kind === 'review' ? 'review-needed-section'
        : kind === 'retry' ? 'pending-retries-section'
            : 'collect-failures-section';
    return `<div id="${containerId}"><div style="text-align:center;padding:40px 20px;color:#fca5a5;font-size:0.88rem;">
        <i class="fa-solid fa-circle-exclamation"></i> ${label} 목록을 불러오지 못했습니다.
        <div>${_retryButtonHtml(kind)}</div>
    </div></div>`;
}

// 섹션 부분 갱신 실패 메시지 (innerHTML 만 — 외곽 #*-section 컨테이너 그대로 유지).
// [D-6] kind 가 주어지면 재시도 버튼 노출.
function _renderSectionInnerErrorHtml(kind) {
    const retryHtml = kind ? `<div>${_retryButtonHtml(kind)}</div>` : '';
    return `<div style="text-align:center;padding:30px 20px;color:#fca5a5;font-size:0.85rem;">
        <i class="fa-solid fa-circle-exclamation"></i> 목록을 불러오지 못했습니다.
        ${retryHtml}
    </div>`;
}

// [D-4] 한 서브탭의 배지 카운트를 in-place 로 업데이트.
//   부분 갱신 응답 도착 시 pagination.total 로 그 섹션의 탭 버튼 배지만 갱신
//   → 다른 두 탭의 stale 카운트 문제 회피.
function _updateSubTabBadge(kind, total) {
    const el = document.getElementById(`err-subtab-${kind}-badge`);
    if (!el) return;
    const n = Number.isFinite(total) ? total : 0;
    if (n > 0) {
        el.textContent = String(n);
        el.style.display = 'inline-block';
    } else {
        el.textContent = '';
        el.style.display = 'none';
    }
}

// [D-7] "원문 보기" 펼침 상태 복원.
//   _expandedRawIds 에 있는 reportId 들의 원문 영역을 다시 펼치고 내용을 채움.
//   togglePendingRawText 와 동일한 fetch 경로 사용 — 캐시 없이 재조회.
//   해당 항목이 더 이상 화면에 없으면 (페이지 이동/삭제 등) Set 에서 제거.
function _restoreExpandedRawTexts() {
    if (_expandedRawIds.size === 0) return;
    for (const reportId of Array.from(_expandedRawIds)) {
        const safeIdAttr = String(reportId).replace(/[^a-zA-Z0-9]/g, '_');
        const containerId = `raw-${safeIdAttr}`;
        const box = document.getElementById(containerId);
        if (!box) {
            _expandedRawIds.delete(reportId);
            continue;
        }
        box.style.display = 'block';
        box.textContent = '원문 불러오는 중...';
        fetch(`/api/admin/pending-retries/${encodeURIComponent(reportId)}/raw`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) { box.textContent = '원문을 가져오지 못했습니다.'; return; }
                box.textContent = data.rawText && data.rawText.trim().length > 0
                    ? data.rawText
                    : '(원문이 비어 있습니다.)';
            })
            .catch(e => { box.textContent = '원문 조회 오류: ' + e.message; });
    }
}

// [상단 배지] Gemini 키 상태 표시
function renderGeminiKeysBadge(status) {
    const keys = (status && status.keys) || [];
    if (keys.length === 0) {
        return `
            <div style="margin-bottom:14px;padding:10px 14px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:10px;color:#fca5a5;font-size:0.82rem;">
                <i class="fa-solid fa-key"></i> Gemini API 키가 등록되어 있지 않습니다.
            </div>`;
    }
    const items = keys.map(k => {
        if (k.onCooldown) {
            const remainMin = Math.ceil(k.remainingMs / 60000);
            return `
                <div style="flex:1;min-width:160px;padding:8px 12px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.25);border-radius:8px;display:flex;align-items:center;gap:8px;">
                    <i class="fa-solid fa-hourglass-half" style="color:#f59e0b;"></i>
                    <div style="flex:1;">
                        <div style="color:#fcd34d;font-size:0.82rem;font-weight:700;">${k.label} 키</div>
                        <div style="color:#d4a276;font-size:0.7rem;">쿨다운 ${remainMin}분 남음</div>
                    </div>
                </div>`;
        }
        return `
            <div style="flex:1;min-width:160px;padding:8px 12px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:8px;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-circle-check" style="color:#22c55e;"></i>
                <div style="flex:1;">
                    <div style="color:#86efac;font-size:0.82rem;font-weight:700;">${k.label} 키</div>
                    <div style="color:#64748b;font-size:0.7rem;">정상</div>
                </div>
            </div>`;
    }).join('');
    return `
        <div style="margin-bottom:14px;">
            <div style="color:#94a3b8;font-size:0.75rem;font-weight:600;margin-bottom:6px;">
                <i class="fa-solid fa-key"></i> Gemini API 키 상태
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;">${items}</div>
        </div>`;
}

// [하위 탭] 검토 필요 섹션 HTML (외곽 #review-needed-section 래퍼 포함)
// items: 현재 페이지 항목, pagination: 전체 카운트/페이지 정보
function renderReviewSectionHtml(items, pagination) {
    return `<div id="review-needed-section">${_renderReviewSectionInnerHtml(items, pagination)}</div>`;
}

// [내부] 검토 필요 섹션의 innerHTML 만 생성 (부분 갱신에서 외곽 컨테이너 그대로 두고 내부만 교체).
// [D-5] 구조: [header 영역] + [list 영역 (#review-needed-list)]
//   부분 갱신 로딩 시 list 영역만 스피너로 교체해 헤더(전체 확인완료 버튼)를 보존.
function _renderReviewSectionInnerHtml(items, pagination) {
    const total = (pagination && pagination.total) || 0;
    return `${_renderReviewHeaderHtml(total)}
        <div id="review-needed-list">${_renderReviewListInnerHtml(items)}</div>`;
}

// [D-5] 검토 필요 섹션 헤더 (카운트 + 전체 확인완료 버튼)
function _renderReviewHeaderHtml(total) {
    return `<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <div style="color:#fcd34d;font-size:0.9rem;font-weight:600;">
                <i class="fa-solid fa-magnifying-glass"></i> 검토 필요 ${total}건
            </div>
            <button onclick="acknowledgeAllReviews()" style="padding:5px 12px;background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                <i class="fa-solid fa-check-double"></i> 전체 확인완료
            </button>
        </div>`;
}

// [D-5] 리스트 영역만 (rows + 페이지네이션)
function _renderReviewListInnerHtml(items) {
    if (!items || items.length === 0) {
        return `<div style="text-align:center;padding:40px 20px;color:#64748b;font-size:0.88rem;">검토 필요 항목이 없습니다.</div>
            <div id="review-needed-pagination" class="pagination"></div>`;
    }
    const rows = items.map(r => {
        const time = r.detectedAt ? new Date(r.detectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
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
    return `${rows}
        <div id="review-needed-pagination" class="pagination"></div>`;
}

// [하위 탭] 재시도 중 섹션 HTML (외곽 #pending-retries-section 래퍼 포함)
// items: 현재 페이지 항목, pagination: 전체 카운트/페이지 정보
function renderPendingRetriesHtml(items, pagination) {
    return `<div id="pending-retries-section">${_renderPendingRetriesInnerHtml(items, pagination)}</div>`;
}

// [내부] 재시도 중 섹션의 innerHTML 만 생성.
// [D-5] [header 영역] + [list 영역 (#pending-retries-list)] 구조
function _renderPendingRetriesInnerHtml(items, pagination) {
    const total = (pagination && pagination.total) || 0;
    return `${_renderPendingRetriesHeaderHtml(total)}
        <div id="pending-retries-list">${_renderPendingRetriesListInnerHtml(items)}</div>`;
}

// [D-5] 재시도 섹션 헤더 (카운트 + 자동 갱신 안내)
function _renderPendingRetriesHeaderHtml(total) {
    return `<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <div style="color:#93c5fd;font-size:0.9rem;font-weight:600;">
                <i class="fa-solid fa-rotate"></i> 재시도 중 ${total}건
            </div>
            <div style="color:#64748b;font-size:0.7rem;">30초마다 자동 갱신</div>
        </div>`;
}

// [D-5] 리스트 영역만
function _renderPendingRetriesListInnerHtml(items) {
    if (!items || items.length === 0) {
        return `<div style="text-align:center;padding:40px 20px;color:#64748b;font-size:0.88rem;">현재 재시도 대기 중인 통보문이 없습니다.</div>
            <div id="pending-retries-pagination" class="pagination"></div>`;
    }
    const rows = items.map(p => {
        const reasonLabel = p.reason === 'API_RATE_LIMIT'
            ? '<span style="color:#fca5a5;background:rgba(239,68,68,0.1);padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;">⚠️ AI 할당량 초과</span>'
            : '<span style="color:#fcd34d;background:rgba(245,158,11,0.1);padding:2px 8px;border-radius:4px;font-size:0.7rem;font-weight:600;">📝 빈 양식 판정</span>';
        const firstSeenStr = p.firstSeen ? new Date(p.firstSeen).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
        const elapsedStr = formatElapsed(p.elapsedMs);
        const safeId = String(p.reportId).replace(/"/g, '&quot;');
        const rawContainerId = `raw-${safeId.replace(/[^a-zA-Z0-9]/g, '_')}`;
        return `
            <div style="padding:12px 14px;background:rgba(59,130,246,0.05);border:1px solid rgba(59,130,246,0.2);border-radius:10px;margin-bottom:8px;">
                <div style="display:flex;align-items:flex-start;gap:10px;">
                    <i class="fa-solid fa-rotate" style="color:#3b82f6;flex-shrink:0;font-size:1.1rem;margin-top:2px;"></i>
                    <div style="flex:1;min-width:0;">
                        <div style="color:#cbd5e1;font-size:0.9rem;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.title || p.reportId}</div>
                        <div style="margin-top:4px;">${reasonLabel}</div>
                        <div style="color:#94a3b8;font-size:0.72rem;margin-top:4px;">
                            최초 감지 ${firstSeenStr} · 경과 ${elapsedStr} · 재시도 ${p.retryCount || 0}회
                        </div>
                    </div>
                    <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                        <button onclick="togglePendingRawText('${safeId}', '${rawContainerId}')" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:6px;color:#cbd5e1;padding:6px 10px;cursor:pointer;font-size:0.72rem;white-space:nowrap;font-weight:500;" title="기상청 원문 보기">
                            <i class="fa-solid fa-file-lines"></i> 원문 보기
                        </button>
                        <button onclick="removePendingRetry('${safeId}', '${(p.title || '').replace(/'/g, "\\'")}')" style="background:linear-gradient(135deg,#ef4444,#dc2626);border:none;border-radius:6px;color:#fff;padding:6px 10px;cursor:pointer;font-size:0.72rem;white-space:nowrap;font-weight:600;" title="재시도 대기열에서 제거">
                            <i class="fa-solid fa-trash"></i> 대기열 제거
                        </button>
                    </div>
                </div>
                <div id="${rawContainerId}" style="display:none;margin-top:10px;padding:10px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.06);border-radius:6px;color:#cbd5e1;font-size:0.78rem;line-height:1.5;white-space:pre-wrap;max-height:280px;overflow:auto;"></div>
            </div>`;
    }).join('');
    return `${rows}
        <div id="pending-retries-pagination" class="pagination"></div>`;
}

// [하위 탭] 수집 실패 섹션 HTML (외곽 #collect-failures-section 래퍼 포함)
// items: 현재 페이지 항목, pagination: 전체 카운트/페이지 정보
function renderFailureSectionHtml(items, pagination) {
    return `<div id="collect-failures-section">${_renderFailureSectionInnerHtml(items, pagination)}</div>`;
}

// [내부] 수집 실패 섹션의 innerHTML 만 생성.
// [D-5] [header 영역] + [list 영역 (#collect-failures-list)] 구조
function _renderFailureSectionInnerHtml(items, pagination) {
    const total = (pagination && pagination.total) || 0;
    return `${_renderFailureHeaderHtml(total)}
        <div id="collect-failures-list">${_renderFailureListInnerHtml(items)}</div>`;
}

// [D-5] 수집 실패 섹션 헤더 (카운트 + 전체 삭제 버튼)
function _renderFailureHeaderHtml(total) {
    return `<div style="margin-bottom:10px;display:flex;align-items:center;justify-content:space-between;">
            <div style="color:#fca5a5;font-size:0.9rem;font-weight:600;">
                <i class="fa-solid fa-triangle-exclamation"></i> 수집 실패 ${total}건
            </div>
            <button onclick="clearAllCollectFailuresAndRefresh()" style="padding:5px 12px;background:linear-gradient(135deg,#22c55e,#16a34a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                <i class="fa-solid fa-check"></i> 전체 삭제
            </button>
        </div>`;
}

// [D-5] 리스트 영역만
function _renderFailureListInnerHtml(items) {
    if (!items || items.length === 0) {
        return `<div style="text-align:center;padding:40px 20px;color:#64748b;font-size:0.88rem;">수집 실패 기록이 없습니다.</div>
            <div id="collect-failures-pagination" class="pagination"></div>`;
    }
    const rows = items.map(f => {
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
    return `${rows}
        <div id="collect-failures-pagination" class="pagination"></div>`;
}

// [하위 탭 전환] 하위 탭 버튼 클릭 시 호출
//  - 허용 키: review(검토 필요), retry(재시도 중), fail(수집 실패), dmdw(dmdw 오류 — 신규)
window.switchErrorSubTab = function (key) {
    if (!['review', 'retry', 'fail', 'dmdw'].includes(key)) return;
    currentErrorSubTab = key;
    const inner = document.getElementById('alert-top-content');
    if (inner) renderErrorListTab(inner);
};

// ============================================================================
// [신규] dmdw 자식 해역 크롤러 오류 섹션 렌더링 + 액션
// ----------------------------------------------------------------------------
// 데이터 소스: GET /api/admin/dmdw-errors (data/dmdw_errors.json 의 항목 배열)
// 표시 정책:
//   - 미확인(acknowledged=false): 진한 배경 + [확인] 버튼 + [삭제] 버튼
//   - 사용자 확인 (manual): 흐릿 + ✓ 표시 + [삭제] 버튼만
//   - 자동 확인 (auto-recovered): 흐릿 + "자동확인" 라벨 + [삭제] 버튼만
//   - type 'recovered': 초록 톤
//   - type 'login_fail_credential': 빨간 톤
//   - type 'login_fail_network': 노란 톤
// ============================================================================

function renderDmdwErrorsSectionHtml(items) {
    if (!items || items.length === 0) {
        return `<div style="text-align:center;padding:40px 20px;color:#64748b;font-size:0.88rem;">dmdw 오류 기록이 없습니다.</div>`;
    }

    // 타입별 색상 팔레트
    const palette = {
        'recovered':              { bg: 'rgba(34,197,94,0.08)',  bd: 'rgba(34,197,94,0.25)',  ic: '#22c55e' },
        'login_fail_credential':  { bg: 'rgba(239,68,68,0.08)',  bd: 'rgba(239,68,68,0.25)',  ic: '#ef4444' },
        'login_fail_network':     { bg: 'rgba(245,158,11,0.08)', bd: 'rgba(245,158,11,0.25)', ic: '#f59e0b' }
    };
    const defaultPal = { bg: 'rgba(100,116,139,0.08)', bd: 'rgba(100,116,139,0.25)', ic: '#94a3b8' };

    const rows = items.map(e => {
        const pal = palette[e.type] || defaultPal;
        const time = e.detectedAt ? new Date(e.detectedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
        const isAck = !!e.acknowledged;
        const ackBadge = isAck
            ? (e.acknowledgedReason === 'auto-recovered'
                ? `<span style="display:inline-block;padding:2px 8px;background:rgba(59,130,246,0.15);color:#93c5fd;border-radius:6px;font-size:0.7rem;font-weight:600;">자동확인</span>`
                : `<span style="display:inline-block;padding:2px 8px;background:rgba(34,197,94,0.15);color:#86efac;border-radius:6px;font-size:0.7rem;font-weight:600;">✓ 확인됨</span>`)
            : '';
        const ackTime = isAck && e.acknowledgedAt
            ? `<span style="font-size:0.7rem;color:#94a3b8;margin-left:6px;">${new Date(e.acknowledgedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}</span>`
            : '';
        const opacity = isAck ? '0.55' : '1';
        const detailLine = e.detail
            ? `<div style="margin-top:4px;font-size:0.72rem;color:#64748b;"><i class="fa-solid fa-code" style="margin-right:4px;"></i>${escapeHtml(e.detail)}</div>`
            : '';
        const ackBtn = isAck
            ? ''
            : `<button onclick="acknowledgeDmdwError('${e.id}')" style="padding:5px 10px;background:linear-gradient(135deg,#3b82f6,#2563eb);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:600;margin-right:4px;">
                    <i class="fa-solid fa-check"></i> 확인
               </button>`;
        const delBtn = `<button onclick="deleteDmdwError('${e.id}')" style="padding:5px 10px;background:rgba(239,68,68,0.15);color:#fca5a5;border:1px solid rgba(239,68,68,0.3);border-radius:6px;cursor:pointer;font-size:0.72rem;font-weight:600;">
                            <i class="fa-solid fa-trash"></i> 삭제
                        </button>`;

        return `
            <div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:${pal.bg};border:1px solid ${pal.bd};border-radius:10px;margin-bottom:8px;opacity:${opacity};">
                <i class="fa-solid fa-circle-exclamation" style="color:${pal.ic};flex-shrink:0;font-size:1.1rem;margin-top:2px;"></i>
                <div style="flex:1;min-width:0;">
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
                        <span style="font-size:0.88rem;font-weight:700;color:#e2e8f0;">${escapeHtml(e.title)}</span>
                        ${ackBadge}${ackTime}
                    </div>
                    <div style="font-size:0.78rem;color:#94a3b8;margin-bottom:4px;">📅 ${time}</div>
                    <div style="font-size:0.8rem;color:#cbd5e1;line-height:1.5;">${escapeHtml(e.body)}</div>
                    ${detailLine}
                </div>
                <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0;">
                    ${ackBtn}
                    ${delBtn}
                </div>
            </div>`;
    }).join('');

    return `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
            <span style="font-size:0.85rem;color:#94a3b8;">${items.length} 건 (최신순)</span>
            <button onclick="deleteAllDmdwErrors()" style="padding:5px 12px;background:linear-gradient(135deg,#ef4444,#dc2626);color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:0.78rem;font-weight:600;">
                <i class="fa-solid fa-trash"></i> 전체 삭제
            </button>
        </div>
        ${rows}`;
}

// HTML 이스케이프 헬퍼 (XSS 방지)
//  - 메시지 본문에 <, >, &, " 같은 문자가 있어도 안전하게 표시
function escapeHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// [액션] 개별 확인
//  - POST /api/admin/dmdw-errors/:id/acknowledge
//  - 성공 시 해당 탭 다시 그리기
window.acknowledgeDmdwError = async function (id) {
    try {
        const r = await fetch(`/api/admin/dmdw-errors/${encodeURIComponent(id)}/acknowledge`, { method: 'POST' });
        if (!r.ok) {
            alert('확인 처리 실패');
            return;
        }
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { alert('확인 처리 오류: ' + e.message); }
};

// [액션] 개별 삭제
//  - DELETE /api/admin/dmdw-errors/:id
window.deleteDmdwError = async function (id) {
    if (!confirm('이 dmdw 오류 기록을 영구 삭제하시겠습니까?')) return;
    try {
        const r = await fetch(`/api/admin/dmdw-errors/${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!r.ok) {
            alert('삭제 실패');
            return;
        }
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { alert('삭제 오류: ' + e.message); }
};

// [액션] 전체 삭제 (초기화)
//  - DELETE /api/admin/dmdw-errors
window.deleteAllDmdwErrors = async function () {
    if (!confirm('dmdw 오류 기록을 모두 삭제하시겠습니까? (이력 복구 불가)')) return;
    try {
        const r = await fetch(`/api/admin/dmdw-errors`, { method: 'DELETE' });
        if (!r.ok) {
            alert('전체 삭제 실패');
            return;
        }
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) { alert('전체 삭제 오류: ' + e.message); }
};

// [원문 보기] 재시도 중 항목의 원문 텍스트를 토글 표시
// [D-7] 펼침/접힘 상태를 _expandedRawIds 에 기록 →
//   자동 갱신(30초)/부분 갱신 후 _restoreExpandedRawTexts() 가 복원.
window.togglePendingRawText = async function (reportId, containerId) {
    const box = document.getElementById(containerId);
    if (!box) return;
    if (box.style.display === 'block') {
        box.style.display = 'none';
        _expandedRawIds.delete(reportId);
        return;
    }
    box.style.display = 'block';
    _expandedRawIds.add(reportId);
    box.textContent = '원문 불러오는 중...';
    try {
        const res = await fetch(`/api/admin/pending-retries/${encodeURIComponent(reportId)}/raw`);
        if (!res.ok) {
            box.textContent = '원문을 가져오지 못했습니다.';
            return;
        }
        const data = await res.json();
        box.textContent = data.rawText && data.rawText.trim().length > 0
            ? data.rawText
            : '(원문이 비어 있습니다.)';
    } catch (e) {
        box.textContent = '원문 조회 오류: ' + e.message;
    }
};

// [대기열 제거] 특정 항목을 pendingRetries에서 제거
window.removePendingRetry = async function (reportId, title) {
    const confirmMsg = `"${title || reportId}"\n\n재시도 대기열에서 제거하시겠습니까?\n\n` +
        `· AI 자동 재시도가 중단됩니다\n` +
        `· 관리자 지속 알림이 더 이상 발송되지 않습니다\n` +
        `· 이 통보문은 다시 자동 수집 대상이 되지 않습니다\n\n` +
        `이미 '특보 수정' 탭에서 수동 반영하신 경우 선택하세요.`;
    if (!confirm(confirmMsg)) return;
    try {
        const res = await fetch(`/api/admin/pending-retries/${encodeURIComponent(reportId)}`, { method: 'DELETE' });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            alert('제거 실패: ' + (err.error || res.status));
            return;
        }
        const inner = document.getElementById('alert-top-content');
        if (inner) renderErrorListTab(inner);
    } catch (e) {
        alert('제거 오류: ' + e.message);
    }
};

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

/**
 * 시간대명 드롭다운 선택 시 기본 시작/종료 시간을 자동 세팅하는 함수
 * 예: "새벽" 선택 → 시작 00시, 종료 06시 자동 세팅
 *
 * [동작 원리]
 * 드롭다운의 각 option에 data-start, data-end 속성으로 기본 시간이 정의되어 있음
 * 선택된 option의 data 속성을 읽어 시작/종료 셀렉트박스에 반영
 *
 * [연계] buildTimeFieldHTML() → 시간대 드롭다운의 onchange에서 호출
 * [연계] updateRangePreview() → 시간 세팅 후 미리보기 갱신
 *
 * @param {string} prefix - 입력 필드 ID 접두사 (예: "ma-tmEf")
 */
window.applyPeriodDefaults = function (prefix) {
    var periodSelect = document.getElementById(prefix + '-range-period-name');
    var startSelect = document.getElementById(prefix + '-range-start');
    var endSelect = document.getElementById(prefix + '-range-end');
    if (!periodSelect || !startSelect || !endSelect) return;

    var selected = periodSelect.options[periodSelect.selectedIndex];
    var startVal = selected.getAttribute('data-start');
    var endVal = selected.getAttribute('data-end');

    if (startVal) startSelect.value = startVal;
    if (endVal) endSelect.value = endVal;

    updateRangePreview(prefix);
};

/**
 * 범위형 시간 미리보기 갱신 함수
 * 시간대명 + 시작/종료 시간을 조합하여 최종 결과를 미리보기에 표시
 * 예: 시간대명 "새벽" + 시작 00시 + 종료 06시 → "새벽(00시~06시)"
 *
 * [연계] 시작/종료 시간 셀렉트박스의 onchange에서 호출
 * [연계] applyPeriodDefaults() → 시간대명 변경 후 자동 호출
 *
 * @param {string} prefix - 입력 필드 ID 접두사 (예: "ma-tmEf")
 */
window.updateRangePreview = function (prefix) {
    var periodSelect = document.getElementById(prefix + '-range-period-name');
    var startSelect = document.getElementById(prefix + '-range-start');
    var endSelect = document.getElementById(prefix + '-range-end');
    var preview = document.getElementById(prefix + '-range-preview');
    if (!periodSelect || !startSelect || !endSelect || !preview) return;

    var name = periodSelect.value;
    var startH = startSelect.value;
    var endH = endSelect.value;
    preview.textContent = '→ ' + name + '(' + startH + '시~' + endH + '시)';
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

/**
 * 시각 필드 HTML 생성 헬퍼
 * "정확한 시각"(datetime-local)과 "범위형"(시간대명 + 시작/종료 시간) 두 모드를 지원
 *
 * [범위형 구성]
 * - 날짜 선택 (date input)
 * - 시간대명 드롭다운 (새벽, 아침, 오전 등) → 선택 시 기본 시작/종료 시간 자동 세팅
 * - 시작/종료 시간 직접 선택 (0~24시 셀렉트박스)
 * - 미리보기 (예: "새벽(00시~06시)")
 *
 * [연계] toggleManualTimeType() → 정확한 시각 ↔ 범위형 전환
 * [연계] updateRangePreview() → 시간대명/시작/종료 변경 시 미리보기 갱신
 * [연계] applyPeriodDefaults() → 시간대명 선택 시 기본 시간 자동 세팅
 *
 * @param {string} id - 입력 필드 ID 접두사 (예: "ma-tmEf")
 * @param {string} label - 라벨 텍스트 (예: "발효 시각")
 * @param {boolean} isOptional - 선택 입력 여부
 */
function buildTimeFieldHTML(id, label, isOptional) {
    const inputStyle = 'width:100%;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.9rem;box-sizing:border-box;color-scheme:dark;';
    const rangeInputStyle = 'flex:1;padding:10px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.85rem;box-sizing:border-box;color-scheme:dark;';
    const smallSelectStyle = 'width:70px;padding:8px 4px;background:rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:#fff;font-size:0.85rem;box-sizing:border-box;text-align:center;';
    const mb = isOptional ? '16px' : '12px';

    // 0~24시 옵션 생성
    let hourOptions = '';
    for (let h = 0; h <= 24; h++) {
        const hStr = String(h).padStart(2, '0');
        hourOptions += `<option value="${hStr}">${hStr}</option>`;
    }

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
                <div style="margin-bottom:8px;">
                    <input type="date" id="${id}-range-date" style="${inputStyle}">
                </div>
                <div style="margin-bottom:8px;">
                    <label style="display:block;color:#64748b;font-size:0.75rem;margin-bottom:4px;">시간대</label>
                    <select id="${id}-range-period-name" onchange="applyPeriodDefaults('${id}')" style="${inputStyle}">
                        <option value="새벽" data-start="00" data-end="06">새벽</option>
                        <option value="이른 새벽" data-start="00" data-end="03">이른 새벽</option>
                        <option value="아침" data-start="06" data-end="09">아침</option>
                        <option value="오전" data-start="06" data-end="12">오전</option>
                        <option value="낮" data-start="12" data-end="15">낮</option>
                        <option value="오후" data-start="12" data-end="18">오후</option>
                        <option value="늦은 오후" data-start="15" data-end="18">늦은 오후</option>
                        <option value="저녁" data-start="18" data-end="21">저녁</option>
                        <option value="밤" data-start="18" data-end="24">밤</option>
                    </select>
                </div>
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <label style="color:#64748b;font-size:0.75rem;white-space:nowrap;">시작</label>
                    <select id="${id}-range-start" onchange="updateRangePreview('${id}')" style="${smallSelectStyle}">
                        ${hourOptions}
                    </select>
                    <span style="color:#64748b;font-size:0.85rem;">시</span>
                    <span style="color:#64748b;font-size:0.85rem;margin:0 2px;">~</span>
                    <label style="color:#64748b;font-size:0.75rem;white-space:nowrap;">종료</label>
                    <select id="${id}-range-end" onchange="updateRangePreview('${id}')" style="${smallSelectStyle}">
                        ${hourOptions}
                    </select>
                    <span style="color:#64748b;font-size:0.85rem;">시</span>
                </div>
                <div id="${id}-range-preview" style="color:#93c5fd;font-size:0.78rem;padding:4px 0;">
                    → 새벽(00시~06시)
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
    /**
     * 범위형 기존값 프리필 헬퍼 (수정 모드에서 기존 특보값을 UI에 복원)
     * 예: "새벽(00시~06시)" → 시간대명 드롭다운: "새벽", 시작: "00", 종료: "06"
     *
     * [동작 원리]
     * 1. periodStr에서 시간대명과 시작/종료 시간을 파싱
     * 2. 시간대명 드롭다운에서 매칭되는 옵션 선택
     * 3. 시작/종료 셀렉트박스에 시간 세팅
     * 4. 미리보기 갱신
     *
     * @param {string} prefix - 입력 필드 ID 접두사 (예: "ma-tmEf")
     * @param {string} periodStr - 범위형 문자열 (예: "새벽(00시~06시)")
     */
    const restoreRangeValues = (prefix, periodStr) => {
        var nameSelect = document.getElementById(prefix + '-range-period-name');
        var startSelect = document.getElementById(prefix + '-range-start');
        var endSelect = document.getElementById(prefix + '-range-end');
        if (!nameSelect || !startSelect || !endSelect) return;

        // 시간대명 추출 (괄호 앞부분)
        var periodName = periodStr.split('(')[0].trim();

        // 시작/종료 시간 추출
        var timeMatch = periodStr.match(/(\d{2})시~(\d{2})시/);

        // 시간대명 드롭다운 매칭
        var matched = false;
        for (var i = 0; i < nameSelect.options.length; i++) {
            if (nameSelect.options[i].value === periodName) {
                nameSelect.selectedIndex = i;
                matched = true;
                break;
            }
        }
        // 매칭 실패 시 키워드 부분 매칭 시도
        if (!matched) {
            for (var j = 0; j < nameSelect.options.length; j++) {
                if (periodName.includes(nameSelect.options[j].value)) {
                    nameSelect.selectedIndex = j;
                    break;
                }
            }
        }

        // 시작/종료 시간 세팅
        if (timeMatch) {
            startSelect.value = timeMatch[1];
            endSelect.value = timeMatch[2];
        }

        // 미리보기 갱신
        updateRangePreview(prefix);
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
            restoreRangeValues('ma-tmEf', parsed.period);
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
            restoreRangeValues('ma-tmEd', parsed.period);
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

    /**
     * 범위형 시간 값 조합 헬퍼
     * 시간대명 드롭다운 + 시작/종료 셀렉트박스에서 값을 읽어
     * "시간대명(XX시~YY시)" 형태의 문자열을 생성
     *
     * @param {string} prefix - 입력 필드 ID 접두사 (예: "ma-tmEf")
     * @returns {string} 조합된 범위형 문자열 (예: "새벽(00시~06시)")
     */
    const getRangePeriodValue = (prefix) => {
        const nameEl = document.getElementById(prefix + '-range-period-name');
        const startEl = document.getElementById(prefix + '-range-start');
        const endEl = document.getElementById(prefix + '-range-end');
        if (!nameEl || !startEl || !endEl) return '';
        return nameEl.value + '(' + startEl.value + '시~' + endEl.value + '시)';
    };

    // 발효 시각 읽기 (정확한 시각 or 범위형)
    const tmEfExactWrap = document.getElementById('ma-tmEf-exact-wrap');
    const tmEfIsRange = tmEfExactWrap && tmEfExactWrap.dataset.active === '0';
    let tmEf, tmEfRaw;
    if (tmEfIsRange) {
        const dateVal = document.getElementById('ma-tmEf-range-date').value;
        const periodVal = getRangePeriodValue('ma-tmEf');
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
        const periodVal = getRangePeriodValue('ma-tmEd');
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

// ============================================================================
// (종합 통계) 상단 '종합 통계' 탭 — [이용자 현황] [사용량 통계] 하위탭 컨테이너
// ============================================================================

/**
 * 종합 통계 탭을 렌더링합니다. (기존 '이용자 현황' 상단 탭을 대체)
 *
 * 2개 하위 탭으로 구성:
 *  1. [이용자 현황] 기존 renderUnifiedUsersContent() 를 그대로 호출 (구독 현황/방문자 통계 유지).
 *  2. [사용량 통계] 신규 renderUsageStatsContent() (admin_collect.js) — 기능별 사용량 분석.
 *
 * [하위호환] switchUnifiedAdminTab('users') 로 진입해도 이 함수가 호출되며, 기본 활성
 *   하위탭은 [이용자 현황] 이라 기존 동작과 동일하게 보인다.
 *
 * [연계]
 *  - admin.js → switchUnifiedAdminTab('stats'|'users') 에서 호출
 *  - admin.js → renderUnifiedUsersContent() (이용자 현황 하위탭)
 *  - admin_collect.js → renderUsageStatsContent() (사용량 통계 하위탭)
 */
function renderUnifiedComprehensiveStats(container) {
    var subTabs = [
        { id: 'users', name: '이용자 현황', icon: 'fa-chart-pie' },
        { id: 'usage', name: '사용량 통계', icon: 'fa-gauge-high' }
    ];

    container.innerHTML = '<div class="admin-section-title"><i class="fa-solid fa-chart-line" style="color:#60a5fa;"></i> 종합 통계</div>'
        + '<div class="admin-sub-tabs">'
        + subTabs.map(function (t) {
            return '<button class="comp-stats-sub-tab" data-tab="' + t.id + '" onclick="window.switchComprehensiveStatsSubTab(\'' + t.id + '\')">'
                + '<i class="fa-solid ' + t.icon + '"></i> ' + t.name
                + '</button>';
        }).join('')
        + '</div>'
        + '<div id="comp-stats-sub-content"></div>';

    /**
     * 종합 통계 하위 탭 전환
     *  - users: 기존 이용자 현황(구독 현황/방문자 통계) — renderUnifiedUsersContent 재사용 (변형 X)
     *  - usage: 신규 사용량 통계 — renderUsageStatsContent (admin_collect.js)
     */
    window.switchComprehensiveStatsSubTab = function (tabId) {
        document.querySelectorAll('.comp-stats-sub-tab').forEach(function (btn) {
            if (btn.dataset.tab === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        var subContent = document.getElementById('comp-stats-sub-content');
        if (!subContent) return;

        if (tabId === 'usage') {
            if (typeof renderUsageStatsContent === 'function') {
                renderUsageStatsContent(subContent);
            } else {
                subContent.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;">사용량 통계 모듈을 불러올 수 없습니다.</div>';
            }
        } else {
            // 기존 이용자 현황 — 절대 변형하지 않고 그대로 호출
            if (typeof renderUnifiedUsersContent === 'function') {
                renderUnifiedUsersContent(subContent);
            } else {
                subContent.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;">이용자 현황 모듈을 불러올 수 없습니다.</div>';
            }
        }
    };

    // 기본 하위 탭: 이용자 현황 (기존 동작 유지)
    window.switchComprehensiveStatsSubTab('users');
}

// ============================================================================
// (이용자 현황) 앱 이용자 현황 탭 렌더링
// ============================================================================

/**
 * 앱 이용자 현황 탭을 렌더링합니다.
 *
 * 2개 하위 탭으로 구성:
 * 1. [구독 현황] 푸시 구독자 수 + 해역별 구독자 분포 트리
 * 2. [방문자 통계] 기존 방문자 통계 (그래프, 필터, 상세 테이블) 그대로 통합
 *
 * [데이터 소스]
 * - GET /api/push-subscriber-stats → 구독자 수 + 해역별 카운트
 * - GET /api/stats/visitors → 날짜별/시간대별 방문 통계 (admin_collect.js에서 렌더)
 *
 * [연계]
 * - admin.js → showUnifiedAdminModal()에서 'users' 탭으로 이 함수를 호출
 * - admin_collect.js → renderUnifiedStatsContent()를 방문자 통계 하위탭에서 호출
 * - routes/push.js → /api/push-subscriber-stats API
 */
async function renderUnifiedUsersContent(container) {
    // 하위 탭 2개: 구독 현황 / 방문자 통계
    var subTabs = [
        { id: 'subscriber', name: '구독 현황', icon: 'fa-bell' },
        { id: 'visitor', name: '방문자 통계', icon: 'fa-chart-line' }
    ];

    container.innerHTML = '<div class="admin-section-title"><i class="fa-solid fa-chart-pie" style="color:#8b5cf6;"></i> 앱 이용자 현황</div>'
        + '<div class="admin-sub-tabs">'
        + subTabs.map(function(t) {
            return '<button class="users-sub-tab" data-tab="' + t.id + '" onclick="window.switchUsersSubTab(\'' + t.id + '\')">'
                + '<i class="fa-solid ' + t.icon + '"></i> ' + t.name
                + '</button>';
        }).join('')
        + '</div>'
        + '<div id="users-sub-content"></div>';

    /**
     * 이용자 현황 하위 탭 전환
     * - subscriber: 구독자 수 카드 + 해역별 구독자 분포 트리
     * - visitor: 기존 방문자 통계 (그래프, 필터, 테이블) — admin_collect.js에서 렌더
     *
     * [연계] admin_collect.js → renderUnifiedStatsContent()
     */
    window.switchUsersSubTab = function(tabId) {
        document.querySelectorAll('.users-sub-tab').forEach(function(btn) {
            if (btn.dataset.tab === tabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        var subContent = document.getElementById('users-sub-content');
        if (!subContent) return;

        if (tabId === 'subscriber') {
            renderSubscriberTab(subContent);
        } else if (tabId === 'visitor') {
            // 기존 방문자 통계 렌더 함수 호출 (admin_collect.js에 정의)
            if (typeof renderUnifiedStatsContent === 'function') {
                renderUnifiedStatsContent(subContent);
            } else {
                subContent.innerHTML = '<div style="color:#64748b;text-align:center;padding:40px;">방문자 통계 모듈을 불러올 수 없습니다.</div>';
            }
        }
    };

    // 기본 하위 탭: 구독 현황
    window.switchUsersSubTab('subscriber');
}

/**
 * 구독 현황 하위 탭 렌더링
 *
 * [표시 항목]
 * 1. 푸시 구독자 수 요약 카드 (전체/FCM)
 * 2. 해역별 구독자 분포 트리 (대분류 > 중분류 > 소분류, 접이식)
 *
 * [데이터 소스]
 * - GET /api/push-subscriber-stats → 구독자 수 + 해역별 카운트
 *
 * [연계] renderUnifiedUsersContent() → switchUsersSubTab('subscriber')에서 호출
 */
/**
 * 구독 현황 하위 탭 렌더링
 *
 * [표시 항목]
 * 1. 구독자 요약 카드 (현재 총 구독자 수 + FCM/Web 구분)
 * 2. 전일/전월/전년 대비 증감 카드
 * 3. 구독자 추이 차트 (일별/주간/월별 전환 가능)
 * 4. 상세 증감 내역 테이블
 * 5. 해역별 구독자 분포 트리 (대분류 > 중분류 > 소분류, 접이식)
 *
 * [데이터 소스]
 * - GET /api/push-subscriber-stats → 현재 구독자 수 + 해역별 카운트
 * - GET /api/subscriber-history → 일별 구독자 스냅샷 (추이 분석용)
 *
 * [연계]
 * - renderUnifiedUsersContent() → switchUsersSubTab('subscriber')에서 호출
 * - services/subscriber_snapshot.js → 매일 자정 스냅샷 기록
 * - routes/push.js → /api/subscriber-history API
 */
let subscriberChart = null; // 구독자 추이 차트 인스턴스 (재생성 시 파괴용)

async function renderSubscriberTab(container) {
    container.innerHTML = '<div style="text-align:center;padding:40px;color:#64748b;"><i class="fa-solid fa-circle-notch fa-spin"></i> 로딩 중...</div>';

    try {
        // ── 1. 데이터 3개를 동시에 요청 ──
        // (현재 구독자 수 + 일별 스냅샷 이력 + 구독/해지 이벤트 로그)
        var statsRes = await fetch('/api/push-subscriber-stats');
        var historyRes = await fetch('/api/subscriber-history');
        var eventsRes = await fetch('/api/subscriber-events').catch(function() { return { ok: false }; });
        var stats = statsRes.ok ? await statsRes.json() : { totalSubscribers: 0, fcmCount: 0, webCount: 0, zoneCounts: {} };
        var history = historyRes.ok ? await historyRes.json() : {};
        var events = eventsRes.ok ? await eventsRes.json() : {};

        // ── 2. 전일/전월/전년 대비 증감 계산 ──
        // KST 기준 오늘/어제/한달전/1년전 날짜 문자열 생성
        var now = new Date();
        var kstNow = new Date(now.getTime() + (9 * 60 * 60 * 1000));
        var todayStr = kstNow.toISOString().split('T')[0];

        // 어제 날짜
        var yesterdayDate = new Date(kstNow.getTime() - 86400000);
        var yesterdayStr = yesterdayDate.toISOString().split('T')[0];

        // 한 달 전 날짜
        var lastMonthDate = new Date(kstNow);
        lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
        var lastMonthStr = lastMonthDate.toISOString().split('T')[0];

        // 1년 전 날짜
        var lastYearDate = new Date(kstNow);
        lastYearDate.setFullYear(lastYearDate.getFullYear() - 1);
        var lastYearStr = lastYearDate.toISOString().split('T')[0];

        var currentTotal = stats.totalSubscribers;

        // 증감 계산 함수: 과거 데이터가 없으면 null 반환
        function calcDiff(pastDateStr) {
            if (history[pastDateStr]) {
                return currentTotal - history[pastDateStr].total;
            }
            return null; // 데이터 없음
        }

        var diffDay = calcDiff(yesterdayStr);
        var diffMonth = calcDiff(lastMonthStr);
        var diffYear = calcDiff(lastYearStr);

        // 증감 표시용 HTML 생성 함수
        // 양수면 초록색 ▲, 음수면 빨간색 ▼, 0이면 회색 ─, 데이터 없으면 N/A
        function diffBadge(diff, label) {
            if (diff === null) {
                return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03);">'
                    + '<span style="color:#94a3b8;font-size:0.78rem;">' + label + '</span>'
                    + '<span style="color:#475569;font-size:0.8rem;font-weight:600;">N/A</span></div>';
            }
            var color = diff > 0 ? '#22c55e' : (diff < 0 ? '#ef4444' : '#64748b');
            var arrow = diff > 0 ? '▲' : (diff < 0 ? '▼' : '─');
            var sign = diff > 0 ? '+' : '';
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.03);">'
                + '<span style="color:#94a3b8;font-size:0.78rem;">' + label + '</span>'
                + '<span style="color:' + color + ';font-size:0.85rem;font-weight:700;">' + sign + diff + '명 ' + arrow + '</span></div>';
        }

        // ── 3. HTML 조립: 상단 2단 레이아웃 (요약카드 + 추이차트) ──
        var topHtml = '<div style="display:grid;grid-template-columns:1fr 1.5fr;gap:16px;margin-bottom:20px;">'
            // 왼쪽: 요약 카드 + 증감 카드
            + '<div>'
            // 현재 구독자 수 카드
            + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:20px;text-align:center;margin-bottom:12px;">'
            + '<div style="font-size:0.82rem;color:#94a3b8;margin-bottom:8px;"><i class="fa-solid fa-bell" style="margin-right:4px;"></i> 푸시 알림 구독자</div>'
            + '<div style="font-size:2.2rem;font-weight:800;color:#3b82f6;">' + stats.totalSubscribers + '<span style="font-size:0.9rem;font-weight:400;color:#64748b;">명</span></div>'
            + '<div style="font-size:0.75rem;color:#475569;margin-top:4px;">FCM(앱) ' + stats.fcmCount + '명'
            + (stats.webCount > 0 ? ' · Web ' + stats.webCount + '명' : '')
            + '</div></div>'
            // 전일/전월/전년 대비 증감 카드
            + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:14px 16px;">'
            + '<div style="font-size:0.78rem;color:#94a3b8;margin-bottom:8px;font-weight:600;">증감 현황</div>'
            + diffBadge(diffDay, '전일 대비')
            + diffBadge(diffMonth, '전월 대비')
            + diffBadge(diffYear, '전년 대비')
            + '</div>'
            + '</div>'
            // 오른쪽: 구독자 추이 차트
            + '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;position:relative;">'
            + '<div style="font-size:0.82rem;color:#94a3b8;margin-bottom:10px;font-weight:600;"><i class="fa-solid fa-chart-line" style="margin-right:4px;color:#8b5cf6;"></i> 구독자 추이</div>'
            + '<div style="height:180px;"><canvas id="subscriber-trend-chart"></canvas></div>'
            + '</div>'
            + '</div>';

        // ── 3.5 구독 유지율(이탈률) 카드 ──
        // 이벤트 로그 데이터를 기반으로 이번 주/이번 달/전체 기간의 유지율을 계산
        // 유지율 = 1 - (해지+만료) / (기간 시작 구독자 + 신규 구독)
        // 이벤트 데이터가 없으면 "데이터 수집 중" 표시

        /**
         * 특정 기간의 구독 유지율을 계산하는 함수
         *
         * [계산 방식]
         * 유지율 = (1 - 이탈자 / (기간 시작 시 구독자 + 신규)) × 100
         * - 이탈자 = 수동 해지(unsubscribe) + 만료 자동 정리(expired)
         * - 기간 시작 시 구독자 = 현재 구독자 - 신규 + 이탈자 (역산)
         *
         * @param {string} startDate - 집계 시작 날짜 (YYYY-MM-DD)
         * @param {string} endDate - 집계 종료 날짜 (YYYY-MM-DD)
         * @returns {Object} { rate: 유지율(%), subscribed: 신규, lost: 이탈, hasData: 데이터 유무 }
         */
        function calcRetention(startDate, endDate) {
            var totalSub = 0;   // 기간 내 신규 구독 수
            var totalUnsub = 0; // 기간 내 수동 해지 수
            var totalExpired = 0; // 기간 내 만료 정리 수
            var hasData = false;

            Object.keys(events).forEach(function(dateStr) {
                if (dateStr >= startDate && dateStr <= endDate) {
                    var dayEvent = events[dateStr];
                    totalSub += (dayEvent.subscribe || 0);
                    totalUnsub += (dayEvent.unsubscribe || 0);
                    totalExpired += (dayEvent.expired || 0);
                    hasData = true;
                }
            });

            var totalLost = totalUnsub + totalExpired;
            // 기간 시작 시점의 구독자 수를 역산
            // 현재 구독자 = 시작 시 구독자 + 신규 - 이탈
            // 시작 시 구독자 = 현재 - 신규 + 이탈
            var startCount = currentTotal - totalSub + totalLost;
            // 분모: 기간 시작 시 구독자 + 신규 (이 중 얼마나 유지되었는지)
            var base = startCount + totalSub;
            var rate = base > 0 ? ((1 - totalLost / base) * 100) : 100;
            if (rate > 100) rate = 100;
            if (rate < 0) rate = 0;

            return {
                rate: rate.toFixed(1),
                subscribed: totalSub,
                lost: totalLost,
                unsubscribed: totalUnsub,
                expired: totalExpired,
                hasData: hasData
            };
        }

        // 이번 주 시작일 (월요일)
        var weekDay = kstNow.getUTCDay() || 7;
        var thisWeekStart = new Date(kstNow);
        thisWeekStart.setUTCDate(thisWeekStart.getUTCDate() - weekDay + 1);
        var thisWeekStartStr = thisWeekStart.toISOString().split('T')[0];

        // 이번 달 시작일
        var thisMonthStartStr = todayStr.substring(0, 7) + '-01';

        // 전체 기간 (이벤트 데이터의 첫 날짜 ~ 오늘)
        var allEventDates = Object.keys(events).sort();
        var firstEventDate = allEventDates.length > 0 ? allEventDates[0] : todayStr;

        var weekRetention = calcRetention(thisWeekStartStr, todayStr);
        var monthRetention = calcRetention(thisMonthStartStr, todayStr);
        var totalRetention = calcRetention(firstEventDate, todayStr);

        /**
         * 유지율 카드 항목 HTML 생성 함수
         * 게이지 바와 함께 유지율, 신규, 이탈 수치를 표시합니다.
         *
         * @param {string} label - 카드 제목 (예: "이번 주")
         * @param {Object} ret - calcRetention() 반환값
         * @returns {string} HTML 문자열
         */
        function retentionCard(label, ret) {
            if (!ret.hasData) {
                return '<div style="flex:1;min-width:100px;background:rgba(0,0,0,0.2);border-radius:10px;padding:14px;text-align:center;">'
                    + '<div style="font-size:0.75rem;color:#64748b;margin-bottom:6px;">' + label + '</div>'
                    + '<div style="font-size:0.82rem;color:#475569;">수집 중</div>'
                    + '</div>';
            }

            // 유지율에 따른 색상: 95%↑ 초록, 90%↑ 노랑, 그 이하 빨강
            var rateNum = parseFloat(ret.rate);
            var color = rateNum >= 95 ? '#22c55e' : (rateNum >= 90 ? '#f59e0b' : '#ef4444');

            // 게이지 바 너비 (유지율 %)
            var barWidth = Math.max(rateNum, 5); // 최소 5% 너비 (비어 보이지 않도록)

            return '<div style="flex:1;min-width:100px;background:rgba(0,0,0,0.2);border-radius:10px;padding:14px;text-align:center;">'
                + '<div style="font-size:0.75rem;color:#94a3b8;margin-bottom:6px;">' + label + '</div>'
                + '<div style="font-size:1.3rem;font-weight:800;color:' + color + ';margin-bottom:6px;">' + ret.rate + '%</div>'
                // 게이지 바
                + '<div style="height:4px;background:rgba(255,255,255,0.05);border-radius:2px;overflow:hidden;margin-bottom:8px;">'
                + '<div style="height:100%;width:' + barWidth + '%;background:' + color + ';border-radius:2px;transition:width 0.5s;"></div>'
                + '</div>'
                // 상세 수치: 신규 / 이탈(해지+만료)
                + '<div style="font-size:0.7rem;color:#64748b;">'
                + '<span style="color:#22c55e;">+' + ret.subscribed + '</span>'
                + ' / '
                + '<span style="color:#ef4444;">-' + ret.lost + '</span>'
                + (ret.expired > 0 ? '<span style="color:#475569;"> (만료 ' + ret.expired + ')</span>' : '')
                + '</div>'
                + '</div>';
        }

        var retentionHtml = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;margin-bottom:20px;">'
            + '<div style="font-size:0.82rem;color:#94a3b8;margin-bottom:12px;font-weight:600;"><i class="fa-solid fa-shield-halved" style="margin-right:4px;color:#22c55e;"></i> 구독 유지율</div>'
            + '<div style="display:flex;gap:10px;flex-wrap:wrap;">'
            + retentionCard('이번 주', weekRetention)
            + retentionCard('이번 달', monthRetention)
            + retentionCard('전체', totalRetention)
            + '</div>'
            + '</div>';

        // ── 4. 조회 필터 바 (일별/주간/월별) + 상세 증감 내역 테이블 ──
        var filterHtml = '<div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:14px;padding:16px;margin-bottom:20px;">'
            // 필터 버튼 바
            + '<div style="display:flex;gap:6px;margin-bottom:14px;">'
            + '<div style="display:flex;background:rgba(0,0,0,0.2);padding:3px;border-radius:8px;">'
            + '<button onclick="window.switchSubHistoryType(\'daily\')" id="btn-sub-daily" style="padding:6px 14px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;transition:0.2s;">일별</button>'
            + '<button onclick="window.switchSubHistoryType(\'weekly\')" id="btn-sub-weekly" style="padding:6px 14px;border:none;border-radius:6px;background:transparent;color:#94a3b8;font-size:0.8rem;font-weight:600;cursor:pointer;transition:0.2s;">주간</button>'
            + '<button onclick="window.switchSubHistoryType(\'monthly\')" id="btn-sub-monthly" style="padding:6px 14px;border:none;border-radius:6px;background:transparent;color:#94a3b8;font-size:0.8rem;font-weight:600;cursor:pointer;transition:0.2s;">월별</button>'
            + '</div>'
            + '</div>'
            // 상세 증감 내역 테이블
            + '<div style="font-size:0.85rem;font-weight:700;color:#94a3b8;margin-bottom:10px;">상세 증감 내역</div>'
            + '<div style="max-height:280px;overflow-y:auto;">'
            + '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">'
            + '<thead style="position:sticky;top:0;background:#1e293b;color:#64748b;text-align:left;">'
            + '<tr>'
            + '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);">기간</th>'
            + '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;">구독자 수</th>'
            + '<th style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.05);text-align:right;">증감</th>'
            + '</tr>'
            + '</thead>'
            + '<tbody id="sub-history-table-body" style="color:#cbd5e1;"></tbody>'
            + '</table>'
            + '</div>'
            + '</div>';

        // ── 5. 해역별 구독자 분포 (기존 로직 유지) ──
        var zoneHtml = '<div style="margin-bottom:12px;font-weight:700;color:#fff;font-size:0.95rem;display:flex;align-items:center;gap:8px;"><i class="fa-solid fa-map-location-dot" style="color:#3b82f6;"></i> 해역별 구독자 분포</div>';

        var zc = stats.zoneCounts || {};

        if (typeof SUB_REGION_ZONES !== 'undefined' && typeof getMainRegion === 'function') {
            var regionTree = {};
            for (var subName in SUB_REGION_ZONES) {
                var mainName = getMainRegion(subName);
                if (!regionTree[mainName]) regionTree[mainName] = {};
                regionTree[mainName][subName] = SUB_REGION_ZONES[subName];
            }

            var treeIdx = 0;
            Object.entries(regionTree).forEach(function(entry) {
                var mainRegion = entry[0], subRegions = entry[1];
                var mainMax = 0;
                Object.values(subRegions).forEach(function(szones) {
                    szones.forEach(function(z) { if ((zc[z] || 0) > mainMax) mainMax = zc[z]; });
                });

                zoneHtml += '<div style="margin-bottom:8px;border:1px solid rgba(255,255,255,0.05);border-radius:10px;overflow:hidden;">'
                    + '<div onclick="var el=document.getElementById(\'user-zone-' + treeIdx + '\');el.style.display=el.style.display===\'none\'?\'block\':\'none\';" style="padding:12px 14px;background:rgba(255,255,255,0.05);cursor:pointer;display:flex;justify-content:space-between;align-items:center;">'
                    + '<span style="font-weight:700;color:#fff;font-size:0.9rem;">' + mainRegion + '</span>'
                    + '<span style="color:#818cf8;font-weight:700;font-size:0.85rem;">' + mainMax + '명</span>'
                    + '</div>'
                    + '<div id="user-zone-' + treeIdx + '" style="display:none;padding:10px;background:rgba(0,0,0,0.2);">';

                Object.entries(subRegions).forEach(function(subEntry) {
                    var subRegion = subEntry[0], zones = subEntry[1];
                    var subMax = 0;
                    zones.forEach(function(z) { if ((zc[z] || 0) > subMax) subMax = zc[z]; });

                    zoneHtml += '<div style="margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid rgba(255,255,255,0.03);">'
                        + '<div style="display:flex;justify-content:space-between;margin-bottom:6px;padding-left:4px;">'
                        + '<span style="color:#3b82f6;font-size:0.82rem;font-weight:600;">' + subRegion + '</span>'
                        + '<span style="color:#64748b;font-size:0.78rem;">' + subMax + '명</span>'
                        + '</div>';

                    zones.forEach(function(z) {
                        var count = zc[z] || 0;
                        zoneHtml += '<div style="display:flex;justify-content:space-between;padding:3px 0 3px 16px;font-size:0.78rem;">'
                            + '<span style="color:#94a3b8;">○' + z + '</span>'
                            + '<span style="color:#818cf8;font-weight:600;">' + count + '명</span>'
                            + '</div>';
                    });
                    zoneHtml += '</div>';
                });

                zoneHtml += '</div></div>';
                treeIdx++;
            });
        } else {
            zoneHtml += '<div style="color:#64748b;font-size:0.85rem;">해역 데이터를 불러올 수 없습니다.</div>';
        }

        // ── 6. 전체 HTML 조립 후 렌더링 ──
        container.innerHTML = topHtml + retentionHtml + filterHtml + zoneHtml;

        // ── 7. 차트 및 테이블 렌더링 ──
        // 이력 데이터를 날짜순으로 정렬
        var sortedDates = Object.keys(history).sort();

        /**
         * 구독자 추이 차트를 그리는 함수
         * Chart.js 라인 차트로 일별 구독자 수 추이를 시각화합니다.
         *
         * @param {string[]} labels - X축 라벨 (날짜 문자열)
         * @param {number[]} values - Y축 값 (구독자 수)
         *
         * [연계] Chart.js 라이브러리 사용 (방문자 차트와 동일한 라이브러리)
         */
        function renderSubChart(labels, values) {
            var canvas = document.getElementById('subscriber-trend-chart');
            if (!canvas) return;
            var ctx = canvas.getContext('2d');

            if (subscriberChart) subscriberChart.destroy();

            var gradient = ctx.createLinearGradient(0, 0, 0, 180);
            gradient.addColorStop(0, 'rgba(99, 102, 241, 0.4)');
            gradient.addColorStop(1, 'rgba(99, 102, 241, 0)');

            subscriberChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels,
                    datasets: [{
                        label: '구독자 수',
                        data: values,
                        borderColor: '#818cf8',
                        borderWidth: 2.5,
                        backgroundColor: gradient,
                        fill: true,
                        tension: 0.4,
                        pointBackgroundColor: '#fff',
                        pointBorderColor: '#818cf8',
                        pointRadius: 3,
                        pointHoverRadius: 5
                    }]
                },
                plugins: [{
                    // 차트 선에 은은한 글로우(빛번짐) 효과를 추가하는 플러그인
                    id: 'subGlow',
                    beforeDatasetDraw: function(chart) {
                        chart.ctx.save();
                        chart.ctx.shadowBlur = 12;
                        chart.ctx.shadowColor = '#818cf8';
                    },
                    afterDatasetDraw: function(chart) {
                        chart.ctx.restore();
                    }
                }],
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false },
                        tooltip: {
                            backgroundColor: '#1e293b',
                            titleColor: '#fff',
                            bodyColor: '#cbd5e1',
                            padding: 10,
                            cornerRadius: 8,
                            displayColors: false
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: false,
                            grid: { color: 'rgba(255,255,255,0.05)' },
                            ticks: { color: '#64748b', font: { size: 10 } }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: '#64748b', font: { size: 9 }, maxRotation: 45 }
                        }
                    }
                }
            });
        }

        /**
         * 상세 증감 내역 테이블을 업데이트하는 함수
         * 각 행에 기간, 구독자 수, 전 기간 대비 증감(+/- 색상 구분)을 표시합니다.
         *
         * @param {Array} tableData - [{ label, value, diff }] 형태의 배열
         *   label: 표시할 날짜/주간/월 문자열
         *   value: 해당 시점의 구독자 수
         *   diff: 이전 시점 대비 증감 (null이면 첫 데이터)
         */
        function renderSubTable(tableData) {
            var tbody = document.getElementById('sub-history-table-body');
            if (!tbody) return;

            tbody.innerHTML = tableData.map(function(item) {
                var diffHtml = '';
                if (item.diff === null || item.diff === undefined) {
                    diffHtml = '<span style="color:#475569;">─</span>';
                } else if (item.diff > 0) {
                    diffHtml = '<span style="color:#22c55e;font-weight:700;">+' + item.diff + ' ▲</span>';
                } else if (item.diff < 0) {
                    diffHtml = '<span style="color:#ef4444;font-weight:700;">' + item.diff + ' ▼</span>';
                } else {
                    diffHtml = '<span style="color:#64748b;">0 ─</span>';
                }

                return '<tr>'
                    + '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.03);">' + item.label + '</td>'
                    + '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.03);text-align:right;font-weight:700;">' + item.value.toLocaleString() + '명</td>'
                    + '<td style="padding:8px 12px;border-bottom:1px solid rgba(255,255,255,0.03);text-align:right;">' + diffHtml + '</td>'
                    + '</tr>';
            }).join('');
        }

        /**
         * 조회 모드(일별/주간/월별) 전환 함수
         * 버튼 클릭 시 해당 모드로 차트와 테이블을 다시 그립니다.
         *
         * @param {string} type - 'daily' | 'weekly' | 'monthly'
         *
         * [동작 방식]
         * - daily: 최근 30일의 일별 구독자 수를 표시
         * - weekly: 주 단위로 마지막 날의 구독자 수를 표시 (최대 12주)
         * - monthly: 월 단위로 마지막 날의 구독자 수를 표시 (최대 12개월)
         */
        window.switchSubHistoryType = function(type) {
            // 버튼 활성화 상태 전환
            ['daily', 'weekly', 'monthly'].forEach(function(t) {
                var btn = document.getElementById('btn-sub-' + t);
                if (btn) {
                    if (t === type) {
                        btn.style.background = '#3b82f6';
                        btn.style.color = '#fff';
                    } else {
                        btn.style.background = 'transparent';
                        btn.style.color = '#94a3b8';
                    }
                }
            });

            var labels = [];
            var values = [];
            var tableData = [];

            if (type === 'daily') {
                // 일별: 최근 30일
                var recent = sortedDates.slice(-30);
                for (var i = 0; i < recent.length; i++) {
                    var d = recent[i];
                    var val = history[d].total;
                    labels.push(d.substring(5)); // "MM-DD" 형태
                    values.push(val);
                    // 전일 대비 증감 계산
                    var prevVal = (i > 0) ? history[recent[i - 1]].total : null;
                    tableData.push({
                        label: d,
                        value: val,
                        diff: prevVal !== null ? val - prevVal : null
                    });
                }
                tableData.reverse(); // 최근 날짜가 위로
            } else if (type === 'weekly') {
                // 주간: 주의 마지막 날 기준 (최대 12주)
                // 날짜를 7일 단위로 묶어서 각 주의 마지막 기록을 사용
                var weekBuckets = {};
                sortedDates.forEach(function(d) {
                    var dateObj = new Date(d + 'T00:00:00Z');
                    // ISO 주차 계산: 해당 날짜가 속한 주의 시작일(월요일) 기준
                    var dayOfWeek = dateObj.getUTCDay() || 7; // 일요일=7
                    var monday = new Date(dateObj);
                    monday.setUTCDate(monday.getUTCDate() - dayOfWeek + 1);
                    var weekKey = monday.toISOString().split('T')[0]; // 주 시작일을 키로 사용
                    weekBuckets[weekKey] = { date: d, total: history[d].total };
                });
                var weekKeys = Object.keys(weekBuckets).sort().slice(-12);
                for (var w = 0; w < weekKeys.length; w++) {
                    var wk = weekKeys[w];
                    var wVal = weekBuckets[wk].total;
                    labels.push(wk.substring(5) + '~');
                    values.push(wVal);
                    var prevWVal = (w > 0) ? weekBuckets[weekKeys[w - 1]].total : null;
                    tableData.push({
                        label: wk + ' 주',
                        value: wVal,
                        diff: prevWVal !== null ? wVal - prevWVal : null
                    });
                }
                tableData.reverse();
            } else if (type === 'monthly') {
                // 월별: 각 월의 마지막 기록 (최대 12개월)
                var monthBuckets = {};
                sortedDates.forEach(function(d) {
                    var ym = d.substring(0, 7); // "YYYY-MM"
                    monthBuckets[ym] = { date: d, total: history[d].total };
                });
                var monthKeys = Object.keys(monthBuckets).sort().slice(-12);
                for (var m = 0; m < monthKeys.length; m++) {
                    var mk = monthKeys[m];
                    var mVal = monthBuckets[mk].total;
                    labels.push(mk);
                    values.push(mVal);
                    var prevMVal = (m > 0) ? monthBuckets[monthKeys[m - 1]].total : null;
                    tableData.push({
                        label: mk,
                        value: mVal,
                        diff: prevMVal !== null ? mVal - prevMVal : null
                    });
                }
                tableData.reverse();
            }

            renderSubChart(labels, values);
            renderSubTable(tableData);
        };

        // ── 8. 초기 렌더링: 일별 모드로 차트와 테이블 표시 ──
        // 이력 데이터가 있으면 차트를 그리고, 없으면 안내 메시지 표시
        if (sortedDates.length > 0) {
            window.switchSubHistoryType('daily');
        } else {
            // 아직 스냅샷 데이터가 없는 경우 (서비스 최초 적용 시)
            var chartArea = document.getElementById('subscriber-trend-chart');
            if (chartArea) {
                chartArea.parentElement.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#475569;font-size:0.82rem;">데이터 수집 중입니다. 내일부터 추이가 표시됩니다.</div>';
            }
            var tableBody = document.getElementById('sub-history-table-body');
            if (tableBody) {
                tableBody.innerHTML = '<tr><td colspan="3" style="padding:20px;text-align:center;color:#475569;">아직 이력 데이터가 없습니다.</td></tr>';
            }
        }

    } catch (e) {
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;">데이터 로드 실패: ' + e.message + '</div>';
    }
}

// (A) 특보 알림 섹션 렌더링 (4개 상위 하위탭)
//
// [사양] v7 최종 — 4 sub-tab 유지 (이름 변경):
//   1. 실시간 특보 알림 관리 (기존 유지 + 카운터 fix)
//   2. 장부 (JSON 표출) — 이전 "특보 수집 테스트" 의 JSON 표출만 유지
//   3. 오류 로그 — 이전 "특보 수집 오류" → 의심 사례 결정 UI 로 완전 교체
//   4. 특보 수정 — 기존 유지 (관리자 수동 입력/수정)
async function renderUnifiedAlertContent(container) {
    if (!adminAuthenticated.alert) return;

    const topTabs = [
        { id: 'alert-manage', name: '실시간 특보 알림 관리', icon: 'fa-tower-broadcast' },
        { id: 'ledger-view',  name: '장부',                   icon: 'fa-book' },
        { id: 'error-log',    name: '오류 로그',              icon: 'fa-triangle-exclamation' },
        { id: 'manual-edit',  name: '특보 수정',              icon: 'fa-pen-to-square' }
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
        // [정리] 다른 상위 탭으로 전환 시 오류 로그 탭의 자동 갱신 타이머 중단
        if (topTabId !== 'error-log' && typeof clearErrorListAutoRefresh === 'function') {
            clearErrorListAutoRefresh();
        }
        // 장부 탭 자동 refresh 타이머도 정리
        if (topTabId !== 'ledger-view' && window._ledgerAutoRefresh) {
            clearInterval(window._ledgerAutoRefresh);
            window._ledgerAutoRefresh = null;
        }
        document.querySelectorAll('.alert-top-tab').forEach(btn => {
            if (btn.dataset.tab === topTabId) btn.classList.add('active');
            else btn.classList.remove('active');
        });
        const topContent = document.getElementById('alert-top-content');
        if (!topContent) return;

        if (topTabId === 'alert-manage') {
            renderAlertManageSubTab(topContent);
        } else if (topTabId === 'ledger-view') {
            renderLedgerViewTab(topContent);
        } else if (topTabId === 'error-log') {
            renderErrorLogTab(topContent);
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
            <div id="alert-push-total-summary" style="font-size:0.85rem;color:#94a3b8;font-weight:500;display:flex;align-items:center;gap:6px;">
                <i class="fa-solid fa-chart-simple" style="color:#6366f1;"></i>
                <span>총 <span id="alert-push-total-sends" style="color:#e2e8f0;font-weight:700;">-</span>회 <span id="alert-push-total-count" style="color:#e2e8f0;font-weight:700;">-</span>개 푸시 발송</span>
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

    // [push_counter] 누적 푸시 발송 요약 — /api/push-counter 사용 (500 한도 우회).
    // 기존: /api/push-history 의 length / Σh.count → push_history.json 의 500건 limit 때문에
    //       500 이상이 되면 더 이상 증가하지 않는 버그.
    // 신규: 별도 push_counter.json 에 누적 atomic write (모든 발송 경로 통합).
    window.refreshAlertPushTotalSummary = async function () {
        const sendsEl = document.getElementById('alert-push-total-sends');
        const countEl = document.getElementById('alert-push-total-count');
        if (!sendsEl || !countEl) return;
        try {
            const res = await fetch('/api/push-counter');
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const counter = await res.json();
            const totalSends = Number(counter && counter.totalSends) || 0;
            const totalCount = Number(counter && counter.totalCount) || 0;
            sendsEl.textContent = totalSends.toLocaleString();
            countEl.textContent = totalCount.toLocaleString();
        } catch (e) {
            sendsEl.textContent = '?';
            countEl.textContent = '?';
            console.warn('[Admin] 푸시 발송 요약 조회 실패:', e.message);
        }
    };
    refreshAlertPushTotalSummary();

    switchAlertAdminTabInternal('publish');
}

// ============================================================================
// (A-2) [장부] weather_alerts.json 원본 JSON 표출 — 이전 "특보 수집 테스트" 의 JSON 부분만 유지
// ============================================================================
function renderLedgerViewTab(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
            <div><i class="fa-solid fa-book" style="color:#22d3ee;"></i> 장부 (weather_alerts.json)</div>
            <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:0.75rem;color:#64748b;" id="ledger-updated-at">-</span>
                <button onclick="resetLedgerWithTestPush()" style="padding:6px 12px;background:rgba(239,68,68,0.15);border:1px solid rgba(239,68,68,0.4);border-radius:6px;color:#fca5a5;cursor:pointer;font-size:0.8rem;font-weight:600;">
                    <i class="fa-solid fa-bolt"></i> 장부 초기화 (테스트 푸시)
                </button>
            </div>
        </div>
        <div style="margin-bottom:8px;color:#94a3b8;font-size:0.78rem;">
            <i class="fa-solid fa-info-circle"></i> 현재 weather_alerts.json 내용 (30초 자동 갱신).
        </div>
        <pre id="ledger-content" style="max-height:60vh;overflow:auto;padding:14px;background:rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.08);border-radius:8px;color:#e2e8f0;font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:0.78rem;line-height:1.5;white-space:pre-wrap;word-break:break-all;">로딩 중...</pre>
    `;
    refreshLedger();
    if (window._ledgerAutoRefresh) clearInterval(window._ledgerAutoRefresh);
    window._ledgerAutoRefresh = setInterval(() => {
        const el = document.getElementById('ledger-content');
        if (!el || !document.body.contains(el)) {
            clearInterval(window._ledgerAutoRefresh);
            window._ledgerAutoRefresh = null;
            return;
        }
        refreshLedger();
    }, 30000);
}

window.resetLedgerWithTestPush = async function () {
    const adminToken = localStorage.getItem('push_token') || '';
    if (!adminToken) {
        alert('이 기기의 푸시 토큰을 찾을 수 없습니다. 먼저 푸시 알림을 허용(구독)한 뒤 다시 시도하세요.\n(테스트 푸시는 이 관리자 기기에만 발송됩니다.)');
        return;
    }
    const ok = confirm('장부(diff 기준점)를 초기화하고, 현재 활성 특보를 신규로 감지하여 테스트 푸시를 발송합니다.\n\n※ 이 관리자 기기에만 발송됩니다 (일반 사용자에게는 발송되지 않음). 진행할까요?');
    if (!ok) return;
    try {
        const r = await fetch('/api/admin/marine/reset', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ testPush: true, adminToken })
        });
        const data = await r.json();
        if (!r.ok || !data.success) throw new Error(data.error || ('HTTP ' + r.status));
        alert(data.message || '초기화 + 테스트 푸시 완료');
        refreshLedger();
    } catch (e) {
        alert('초기화 실패: ' + (e && e.message));
    }
};

window.refreshLedger = async function () {
    const el = document.getElementById('ledger-content');
    const tsEl = document.getElementById('ledger-updated-at');
    if (!el) return;
    try {
        const r = await fetch('/api/admin/weather-alerts-json');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        el.textContent = JSON.stringify(data, null, 2);
        if (tsEl) {
            const now = new Date();
            tsEl.textContent = '갱신: ' + now.toLocaleTimeString('ko-KR', { hour12: false });
        }
    } catch (e) {
        el.textContent = '로드 실패: ' + (e && e.message);
    }
};

// ============================================================================
// (A-3) [오류 로그] 의심 사례 결정 UI — 이전 "특보 수집 오류" 의 자리.
// ============================================================================
// SPEC §"오류 로그 탭 - 의심 사례 표출 상세 사양" 구현.
//   - GET  /api/admin/marine/suspicious — currentCase + history 조회
//   - POST /api/admin/marine/suspicious/decide — 정상/비정상 결정 적용
//
// 30초 자동 갱신. 자동 처리 없음 — 관리자 수동 결정만 currentCase 를 정리.
function renderErrorLogTab(container) {
    container.innerHTML = `
        <div class="admin-section-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;">
            <div><i class="fa-solid fa-triangle-exclamation" style="color:#f59e0b;"></i> 오류 로그 (의심 사례 결정)</div>
            <div style="display:flex;gap:8px;align-items:center;">
                <span style="font-size:0.75rem;color:#64748b;" id="suspicious-updated-at">-</span>
                <button onclick="refreshErrorLog()" style="padding:6px 12px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.4);border-radius:6px;color:#fbbf24;cursor:pointer;font-size:0.8rem;font-weight:600;">
                    <i class="fa-solid fa-rotate"></i> 새로고침
                </button>
            </div>
        </div>
        <div style="margin-bottom:12px;color:#94a3b8;font-size:0.78rem;">
            <i class="fa-solid fa-info-circle"></i> mmis 응답에서 사전 예고 없이 3개 이상 zone 이 갑자기 사라지면 의심 사례로 분류됩니다.
            관리자 결정 (정상/비정상) 전까지 자동 처리하지 않습니다. (10분마다 push 재발사)
        </div>
        <div id="suspicious-case-section">로딩 중...</div>
        <div id="suspicious-history-section" style="margin-top:18px;"></div>
    `;
    refreshErrorLog();
    if (errorListAutoRefreshTimer) clearInterval(errorListAutoRefreshTimer);
    errorListAutoRefreshTimer = setInterval(() => {
        const el = document.getElementById('suspicious-case-section');
        if (!el || !document.body.contains(el)) {
            clearErrorListAutoRefresh();
            return;
        }
        refreshErrorLog();
    }, 30000);
}

window.refreshErrorLog = async function () {
    const caseSection = document.getElementById('suspicious-case-section');
    const histSection = document.getElementById('suspicious-history-section');
    const tsEl = document.getElementById('suspicious-updated-at');
    if (!caseSection) return;
    try {
        const r = await fetch('/api/admin/marine/suspicious');
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (data.currentCase) {
            caseSection.innerHTML = _renderSuspiciousCaseCard(data.currentCase);
        } else {
            caseSection.innerHTML = `
                <div style="padding:18px;background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.25);border-radius:10px;text-align:center;">
                    <div style="font-size:1rem;color:#86efac;font-weight:700;margin-bottom:6px;">
                        <i class="fa-solid fa-circle-check"></i> 현재 의심 사례 없음
                    </div>
                    <div style="font-size:0.8rem;color:#94a3b8;">
                        marine.kma 수집 정상. 사전 예고 없이 3+ zone 이 갑자기 사라지면 자동으로 표시됩니다.
                    </div>
                </div>
            `;
        }
        if (histSection) {
            histSection.innerHTML = _renderSuspiciousHistory(data.history || []);
        }
        if (tsEl) {
            const now = new Date();
            tsEl.textContent = '갱신: ' + now.toLocaleTimeString('ko-KR', { hour12: false });
        }
    } catch (e) {
        caseSection.innerHTML = '<div style="padding:14px;color:#ef4444;font-size:0.85rem;">조회 실패: ' + (e && e.message) + '</div>';
    }
};

function _renderSuspiciousCaseCard(currentCase) {
    const firstSeenStr = currentCase.firstSeenAt
        ? new Date(currentCase.firstSeenAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        : '-';
    const lastPushStr = currentCase.lastPushAt
        ? new Date(currentCase.lastPushAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
        : '-';
    const elapsedMs = Date.now() - (currentCase.firstSeenAt || Date.now());
    const elapsedMin = Math.floor(elapsedMs / 60000);
    const elapsedStr = elapsedMin >= 60
        ? `${Math.floor(elapsedMin / 60)}시간 ${elapsedMin % 60}분`
        : `${elapsedMin}분`;
    const nextPushIn = Math.max(0, (10 * 60 * 1000) - (Date.now() - (currentCase.lastPushAt || 0)));
    const nextPushMin = Math.ceil(nextPushIn / 60000);

    const zoneRows = (currentCase.zones || []).map(z => {
        return `
            <tr>
                <td style="padding:8px 10px;color:#fcd34d;font-weight:600;">${_escapeHtml(z.name)}</td>
                <td style="padding:8px 10px;color:#fef3c7;">${_escapeHtml(z.wrnTpNm || '-')}</td>
                <td style="padding:8px 10px;color:#fef3c7;">${_escapeHtml(z.wrnLvlNm || '-')}</td>
                <td style="padding:8px 10px;color:#d4a276;font-size:0.78rem;">${_escapeHtml(z.tmEf || '-')}</td>
            </tr>
        `;
    }).join('');

    return `
        <div style="padding:16px;background:rgba(239,68,68,0.08);border:2px solid rgba(239,68,68,0.4);border-radius:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;">
                <div style="font-size:1.05rem;color:#fca5a5;font-weight:700;">
                    <i class="fa-solid fa-circle-exclamation"></i> 의심 사례 — 결정 필요
                </div>
                <div style="font-size:0.75rem;color:#94a3b8;">
                    ID: <span style="color:#cbd5e1;font-weight:600;">${_escapeHtml(currentCase.id || '-')}</span>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:14px;font-size:0.78rem;">
                <div style="padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:6px;">
                    <div style="color:#94a3b8;">최초 감지</div>
                    <div style="color:#e2e8f0;font-weight:600;margin-top:2px;">${firstSeenStr}</div>
                </div>
                <div style="padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:6px;">
                    <div style="color:#94a3b8;">경과 시간</div>
                    <div style="color:#e2e8f0;font-weight:600;margin-top:2px;">${elapsedStr} (${currentCase.cycleCount || 0} cycles)</div>
                </div>
                <div style="padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:6px;">
                    <div style="color:#94a3b8;">마지막 push</div>
                    <div style="color:#e2e8f0;font-weight:600;margin-top:2px;">${lastPushStr}</div>
                </div>
                <div style="padding:8px 10px;background:rgba(0,0,0,0.25);border-radius:6px;">
                    <div style="color:#94a3b8;">다음 재push</div>
                    <div style="color:#fbbf24;font-weight:600;margin-top:2px;">${nextPushMin}분 후</div>
                </div>
            </div>
            <div style="margin-bottom:10px;color:#fca5a5;font-size:0.85rem;font-weight:600;">
                갑자기 사라진 zone ${(currentCase.zones || []).length}개
            </div>
            <div style="overflow-x:auto;margin-bottom:14px;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;background:rgba(0,0,0,0.25);">
                    <thead>
                        <tr style="background:rgba(239,68,68,0.15);">
                            <th style="padding:8px 10px;text-align:left;color:#fef3c7;border-bottom:1px solid rgba(255,255,255,0.1);">해역</th>
                            <th style="padding:8px 10px;text-align:left;color:#fef3c7;border-bottom:1px solid rgba(255,255,255,0.1);">특보종류</th>
                            <th style="padding:8px 10px;text-align:left;color:#fef3c7;border-bottom:1px solid rgba(255,255,255,0.1);">레벨</th>
                            <th style="padding:8px 10px;text-align:left;color:#fef3c7;border-bottom:1px solid rgba(255,255,255,0.1);">발효시각(tmEf)</th>
                        </tr>
                    </thead>
                    <tbody>${zoneRows}</tbody>
                </table>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button onclick="decideSuspicious('normal')" style="flex:1;min-width:200px;padding:12px 18px;background:linear-gradient(135deg,#22c55e,#16a34a);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;">
                    <i class="fa-solid fa-circle-check"></i> 정상 해제로 처리 (release push 발사)
                </button>
                <button onclick="decideSuspicious('invalid')" style="flex:1;min-width:200px;padding:12px 18px;background:linear-gradient(135deg,#f59e0b,#d97706);border:none;border-radius:8px;color:#fff;cursor:pointer;font-size:0.9rem;font-weight:700;">
                    <i class="fa-solid fa-triangle-exclamation"></i> 수집 오류로 유지 (10분 후 재push)
                </button>
            </div>
        </div>
    `;
}

function _renderSuspiciousHistory(history) {
    if (!Array.isArray(history) || history.length === 0) {
        return `
            <div style="padding:12px;color:#64748b;font-size:0.8rem;text-align:center;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);border-radius:8px;">
                결정 이력 없음 (최근 20건까지 보관)
            </div>
        `;
    }
    const colorByDecision = {
        'normal': { bg: 'rgba(34,197,94,0.08)', border: 'rgba(34,197,94,0.25)', text: '#86efac', label: '정상 해제' },
        'invalid': { bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)', text: '#fbbf24', label: '수집 오류 유지' },
        'auto-reset': { bg: 'rgba(99,102,241,0.08)', border: 'rgba(99,102,241,0.25)', text: '#a5b4fc', label: 'mmis 자동 회복' }
    };
    const rows = history.map(h => {
        const c = colorByDecision[h.decision] || { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)', text: '#cbd5e1', label: h.decision };
        const decidedStr = h.decidedAt ? new Date(h.decidedAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) : '-';
        const zonesStr = Array.isArray(h.zones) ? h.zones.join(', ') : '-';
        return `
            <div style="padding:10px 12px;background:${c.bg};border:1px solid ${c.border};border-radius:8px;margin-bottom:6px;">
                <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:4px;">
                    <span style="color:${c.text};font-weight:700;font-size:0.85rem;">${c.label}</span>
                    <span style="color:#94a3b8;font-size:0.72rem;">ID: ${_escapeHtml(h.id || '-')}</span>
                </div>
                <div style="color:#cbd5e1;font-size:0.78rem;margin-bottom:2px;">
                    <i class="fa-solid fa-clock"></i> ${decidedStr} ・ ${_escapeHtml(h.decidedBy || '-')} ・ ${h.elapsedMin || 0}분 (${h.cycleCount || 0} cycles)
                </div>
                <div style="color:#94a3b8;font-size:0.74rem;">
                    <i class="fa-solid fa-location-dot"></i> ${_escapeHtml(zonesStr)}
                </div>
            </div>
        `;
    }).join('');
    return `
        <div style="margin-bottom:8px;color:#94a3b8;font-size:0.85rem;font-weight:600;">
            <i class="fa-solid fa-clock-rotate-left"></i> 결정 이력 (최근 ${history.length}건)
        </div>
        ${rows}
    `;
}

function _escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

window.decideSuspicious = async function (decision) {
    const msg = decision === 'normal'
        ? '의심 zone 을 정상 해제로 처리하시겠습니까?\n→ release push 가 즉시 발사됩니다.'
        : '수집 오류로 유지하시겠습니까?\n→ currentCase 가 유지되고 10분 뒤 재push 됩니다.';
    if (!confirm(msg)) return;
    try {
        const r = await fetch('/api/admin/marine/suspicious/decide', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision })
        });
        const result = await r.json();
        if (!r.ok || result.error) {
            alert('결정 실패: ' + (result.error || ('HTTP ' + r.status)));
            return;
        }
        // 성공 시 즉시 갱신
        refreshErrorLog();
    } catch (e) {
        alert('결정 요청 실패: ' + (e && e.message));
    }
};

// (A-2-legacy) 특보 수집 테스트 인라인 렌더링 (deprecated — 이름 변경 + 사양 축소로 미사용)
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

// 노드의 하위(자손) 중 차단된 항목이 하나라도 있는지 검사 (재귀)
// [용도] 저장된 차단 항목이 하위에 있으면 해당 부모 노드를 펼친 상태로 렌더
function hasBlockedDescendant(node, blocked) {
    if (!node.children || node.children.length === 0) return false;
    return node.children.some(c => blocked.includes(c.id) || hasBlockedDescendant(c, blocked));
}

// 계층형 차단 트리를 HTML 로 변환 (재귀)
// [구조] 각 노드 = [펼침화살표(자식 있을 때)] + [체크박스] + [라벨], 자식은 접힌 컨테이너
// [동작] 상위 체크 → 하위 자동 체크(onFeatureCbChange), 짝꿍(linked)도 자동 체크
// [펼침] 하위에 차단 항목이 있으면 해당 노드는 펼친 상태(▼)로 렌더
// [indeterminate] 하위 일부만 차단된 부모는 부분선택(indeterminate) 표시
function buildFeatureTreeHtml(nodes, depth, blocked) {
    const cbStyle = 'width:15px;height:15px;accent-color:#f59e0b;cursor:pointer;flex-shrink:0;';
    return nodes.map(n => {
        const hasChildren = n.children && n.children.length > 0;
        const childIds = hasChildren ? n.children.map(c => c.id).join(',') : '';
        const isChecked = blocked.includes(n.id);
        // 하위에 차단된 자손이 있으면 펼침, 부모가 미체크인데 자손만 차단되면 indeterminate
        const blockedDesc = hasChildren && hasBlockedDescendant(n, blocked);
        const expanded = blockedDesc;
        const isIndeterminate = hasChildren && !isChecked && blockedDesc;
        const arrow = hasChildren
            ? `<span id="maint-arrow-${n.id}" onclick="toggleFeatureNode('${n.id}')" style="cursor:pointer;width:14px;text-align:center;color:#94a3b8;font-size:0.7rem;flex-shrink:0;">${expanded ? '▼' : '▶'}</span>`
            : `<span style="width:14px;flex-shrink:0;"></span>`;
        const indent = depth * 14;
        const labelColor = depth === 0 ? '#fff' : (depth === 1 ? '#e2e8f0' : '#cbd5e1');
        const weight = depth === 0 ? '700' : (depth === 1 ? '600' : '400');
        return `
            <div class="maint-node" style="margin-left:${indent}px;">
                <div style="display:flex;align-items:center;gap:8px;padding:5px 0;">
                    ${arrow}
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;flex:1;color:${labelColor};font-size:0.85rem;font-weight:${weight};">
                        <input type="checkbox" class="maint-feature-cb" value="${n.id}" data-children="${childIds}"${isIndeterminate ? ' data-indeterminate="1"' : ''} ${isChecked ? 'checked' : ''} onchange="onFeatureCbChange(this)" style="${cbStyle}"> ${n.label}
                    </label>
                </div>
                ${hasChildren ? `<div class="maint-children" id="maint-children-${n.id}" style="display:${expanded ? 'block' : 'none'};">${buildFeatureTreeHtml(n.children, depth + 1, blocked)}</div>` : ''}
            </div>`;
    }).join('');
}

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
    // ── 선택적 차단 대상: 계층형 트리 (index2 기준) ──
    // [구조] id: 차단 식별자(클라이언트 차단 로직과 동일), label: 표시명,
    //        children: 하위 항목, linked: 함께 차단되는 짝꿍 id (양방향)
    // [연계] index2.html 차단 적용 로직 + saveBlockedFeatures()
    const featureTree = [
        { id: 'main-weather', label: '특보정보', children: [
            { id: 'weather-alert-tab', label: '특보 및 전망', children: [
                { id: 'report-btn', label: '오류 제보 버튼' },
                { id: 'marine-forecast', label: '기상청 해상 기상 전망' },
                { id: 'weather-alert', label: '해역별 특보현황', linked: ['ov-warn-zone'] },
                { id: 'weather-buoy', label: '해역별 기상현황', linked: ['ov-buoy'], children: [
                    { id: 'status-forecast', label: '기상예보 버튼' },
                    { id: 'status-zone', label: '해구기상 버튼' },
                    { id: 'status-windy', label: '윈디 버튼' },
                    { id: 'status-overview', label: '종합정보 버튼' },
                ]},
            ]},
            { id: 'typhoon', label: '태풍정보' },
            { id: 'marine-chart-tab', label: '해상일기도', children: [
                { id: 'mc-wave', label: '수치파랑' },
                { id: 'mc-surge', label: '폭풍해일' },
                { id: 'mc-current', label: '해양순환' },
                { id: 'mc-sst', label: '해수면온도' },
            ]},
        ]},
        { id: 'main-ocean', label: '해양종합정보', children: [
            { id: 'basemap-rltm', label: '배경지도 · 기본맵' },
            { id: 'basemap-enc', label: '배경지도 · 전자해도' },
            { id: 'basemap-coast', label: '배경지도 · 해안도' },
            { id: 'ov-current', label: '유향·유속' },
            { id: 'ov-wind', label: '풍향·풍속' },
            { id: 'ov-wave', label: '파고·파향' },
            { id: 'ov-marker', label: '주요지명' },
            { id: 'ov-buoy', label: '기상부이', linked: ['weather-buoy'] },
            { id: 'ov-warn-zone', label: '특보구역', linked: ['weather-alert'] },
            { id: 'ov-marine-zone', label: '해구도' },
            { id: 'ov-other-wx', label: '천기' },
            { id: 'ov-cctv', label: 'CCTV' },
            { id: 'ov-gps', label: 'GPS (내 위치)' },
            { id: 'ocean-bottomsheet', label: '해점 바텀시트' },
            { id: 'ocean-search', label: '위치 검색창' },
        ]},
        { id: 'main-life', label: '해양생활', children: [
            { id: 'fishing', label: '바다낚시' },
            { id: 'surfing', label: '서핑' },
            { id: 'swimming', label: '해수욕' },
            { id: 'scuba', label: '스킨스쿠버' },
            { id: 'mudflat', label: '갯벌체험' },
            { id: 'sea-parting', label: '바다갈라짐' },
        ]},
        { id: 'main-promo', label: '공지사항' },
    ];

    // 트리 평탄화: id→label 조회 + 짝꿍(linked) 양방향 맵 구성
    const featureFlat = {};
    const featureLinks = {};
    const featureParent = {};
    (function walk(nodes, parentId) {
        nodes.forEach(n => {
            featureFlat[n.id] = n.label;
            if (parentId) featureParent[n.id] = parentId;
            if (n.linked) {
                featureLinks[n.id] = (featureLinks[n.id] || []).concat(n.linked);
                n.linked.forEach(l => { featureLinks[l] = (featureLinks[l] || []).concat(n.id); });
            }
            if (n.children) walk(n.children, n.id);
        });
    })(featureTree, null);
    window._maintFeatureLinks = featureLinks;
    window._maintFeatureParent = featureParent;

    // 점검 중일 때 차단된 서비스 목록 HTML 생성
    let blockedListHtml = '';
    if (config.active && blocked.length > 0) {
        const blockedLabels = blocked.map(id => featureFlat[id] || id);
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
            <!-- 선택적 차단 체크박스 (계층형 아코디언) -->
            <div id="maint-feature-list" style="display:${blocked.length > 0 && !config.active ? 'block' : 'none'};padding:14px;background:rgba(0,0,0,0.15);border-radius:10px;border:1px solid rgba(255,255,255,0.08);">
                <div style="color:#94a3b8;font-size:0.75rem;margin-bottom:10px;line-height:1.5;">차단할 기능을 선택하세요. 상위 항목을 체크하면 하위가 함께 차단됩니다.</div>
                ${buildFeatureTreeHtml(featureTree, 0, blocked)}
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

    // indeterminate(부분선택) 상태는 속성으로 지정 불가 → 렌더 후 JS로 적용
    container.querySelectorAll('.maint-feature-cb[data-indeterminate="1"]').forEach(cb => {
        cb.indeterminate = true;
    });
}

window.toggleBlockType = function () {
    const featureList = document.getElementById('maint-feature-list');
    const blockType = document.querySelector('input[name="maint-block-type"]:checked').value;
    featureList.style.display = blockType === 'selective' ? 'block' : 'none';
};

// 트리 노드 펼침/접힘
window.toggleFeatureNode = function (id) {
    const el = document.getElementById('maint-children-' + id);
    const arrow = document.getElementById('maint-arrow-' + id);
    if (!el) return;
    const open = el.style.display !== 'none';
    el.style.display = open ? 'none' : 'block';
    if (arrow) arrow.textContent = open ? '▶' : '▼';
};

// 체크박스 상태를 하위·짝꿍에 전파 (재귀, 무한루프 방지용 visited)
function _setFeatureCbChecked(id, state, visited) {
    if (visited.has(id)) return;
    visited.add(id);
    const cb = document.querySelector('.maint-feature-cb[value="' + id + '"]');
    if (cb) {
        cb.checked = state;
        if (cb.dataset.children) {
            cb.dataset.children.split(',').filter(Boolean).forEach(cid => _setFeatureCbChecked(cid, state, visited));
        }
    }
    const links = (window._maintFeatureLinks && window._maintFeatureLinks[id]) || [];
    links.forEach(lid => _setFeatureCbChecked(lid, state, visited));
}

// 한 상위 체크박스의 표시 상태를 '직속 자식들'로부터 재계산 (상위 자동 체크는 하지 않음)
// [규칙] 자식이 하나라도 체크/부분선택 → indeterminate(부분선택), 전부 해제 → 해제
//   상위 ID 자체는 '탭 전체 차단'이라는 독립 차단 대상이므로, 자식이 모두 체크됐다고
//   해서 상위까지 자동 체크(=저장)하지 않는다. 상위 체크는 관리자가 직접 했을 때만 유지된다.
function _refreshParentState(parentCb) {
    if (!parentCb || !parentCb.dataset.children) return;
    const childIds = parentCb.dataset.children.split(',').filter(Boolean);
    if (childIds.length === 0) return;
    let total = 0, checked = 0, partial = 0;
    childIds.forEach(cid => {
        const c = document.querySelector('.maint-feature-cb[value="' + cid + '"]');
        if (!c) return;
        total++;
        if (c.checked) checked++;
        if (c.indeterminate) partial++;
    });
    if (total === 0) return;
    if (checked === 0 && partial === 0) {
        parentCb.checked = false;
        parentCb.indeterminate = false;
    } else {
        parentCb.checked = false;
        parentCb.indeterminate = true;
    }
}

// 영향받은 노드들의 '상위(조상)'만 깊은 곳부터 재계산.
// [의도] 관리자가 직접 토글한 노드와 그 하위(cascade 결과)는 그대로 두고,
//   그보다 위에 있는 조상들의 부분선택 표시만 갱신 → 자식 전부 체크 시에도
//   조상이 자동 체크(저장)되지 않게 한다.
function _recomputeAncestors(visited) {
    const parentMap = window._maintFeatureParent || {};
    const depthOf = id => { let d = 0, p = parentMap[id]; while (p) { d++; p = parentMap[p]; } return d; };
    const toRecompute = new Set();
    visited.forEach(id => {
        let pid = parentMap[id];
        while (pid) {
            if (!visited.has(pid)) toRecompute.add(pid);
            pid = parentMap[pid];
        }
    });
    Array.from(toRecompute)
        .sort((a, b) => depthOf(b) - depthOf(a))
        .forEach(id => {
            const cb = document.querySelector('.maint-feature-cb[value="' + id + '"]');
            if (cb) _refreshParentState(cb);
        });
}

// 상위 체크 → 하위 전체 + 짝꿍 자동 동기화
window.onFeatureCbChange = function (cb) {
    const visited = new Set();
    _setFeatureCbChecked(cb.value, cb.checked, visited);
    // 토글·cascade·짝꿍으로 직접 설정된 항목들은 명확한 상태이므로 부분선택 해제
    visited.forEach(id => {
        const c = document.querySelector('.maint-feature-cb[value="' + id + '"]');
        if (c) c.indeterminate = false;
    });
    // 영향받은 노드들의 조상만 재계산 (조상은 자동 체크되지 않음)
    _recomputeAncestors(visited);
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

    // [추가] 라디오 상태에 따라 blockedFeatures 결정해 함께 전송
    //   - "전체 차단"  → 빈 배열 [] 로 PUSH (이전 선택적 차단 잔여값 초기화)
    //   - "선택적 차단" → 현재 체크된 features 수집해 PUSH
    //   서버 측 admin.js POST /api/admin/maintenance 가 blockedFeatures 도
    //   함께 받아 maintenance_config.json 에 기록.
    //   이전엔 toggleMaintenanceMode 가 active/title/content/blockPush 만
    //   보내고 blockedFeatures 를 갱신하지 않아, "전체 차단" 라디오로 바꿔도
    //   서버에 직전 선택값이 남아 사용자 측 가드(length>0 시 차단 화면 스킵)
    //   에 걸려 차단이 적용되지 않는 버그가 있었음.
    let blockedFeaturesToSend = [];
    if (isSelective) {
        document.querySelectorAll('.maint-feature-cb:checked').forEach(cb => {
            blockedFeaturesToSend.push(cb.value);
        });
    }

    try {
        const res = await fetch('/api/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                active: newActive,
                title,
                content,
                blockPush,
                blockedFeatures: blockedFeaturesToSend
            })
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

