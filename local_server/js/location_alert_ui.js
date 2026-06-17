/**
 * ============================================================================
 * location_alert_ui.js — 위치 기반 특보 경보: 동의·활성 UI (③ 단계)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§10)
 *
 * 푸시 설정 탭의 "위치 기반 특보 정보 제공" 토글을 담당.
 *  - 기본 비활성. **관리자 등록(로그인) 단말에서만 활성 가능** (seagnal_admin_token 보유).
 *  - 토글 ON 시 순서: 동의 팝업 → 전경 위치 권한 → 백그라운드("항상 허용") 안내 → 활성.
 *  - 동의 기록은 단말 저장(+서버 최소 기록 hook). 위치 좌표는 서버로 보내지 않음.
 *
 * 실제 백그라운드 위치 시작/중지 및 "항상 허용" 강제는 ② 단계(플러그인)에서 연결.
 * 여기서는 동의·권한 흐름과 상태 저장까지 담당하며, ②가 붙을 hook을 남긴다.
 *
 * Node(테스트)·브라우저 양쪽 로드 가능: 최상위에서 DOM 접근 안 함.
 * ============================================================================
 */
(function (root) {
    'use strict';

    const CONSENT_VERSION = '2026-06-16';            // 동의 문안 버전(변경 시 재동의 유도용)
    const STORAGE_KEY = 'locationAlertSettings_v1';
    const ADMIN_TOKEN_KEY = 'seagnal_admin_token';   // js/admin.js 와 동일 키

    // 네이티브 게이팅 플래그 키 (LocationAlertStore 와 합의). @capacitor/preferences 에 저장 →
    // Android SharedPreferences "CapacitorStorage". 종료 상태 네이티브가 활성+동의 확인에 사용.
    const NATIVE_ACTIVE_KEY = 'location_alert_active';   // "true"/"false"
    const NATIVE_CONSENT_KEY = 'location_alert_consent'; // "true"/"false"

    // ── 안전 스토리지 접근 ────────────────────────────────────────────────────
    function ls() { try { return root && root.localStorage; } catch (_) { return null; } }
    function ss() { try { return root && root.sessionStorage; } catch (_) { return null; } }

    // ── @capacitor/preferences 미러 (네이티브 killed 대응 플래그) ──────────────
    //   localStorage(기존) 는 그대로 두고, 같은 활성/동의 플래그를 Preferences 에도 저장한다.
    //   LocationAlertBackground.Mirror 를 우선 사용(공유), 없으면 Preferences 플러그인 직접 호출.
    function prefsSet(key, value) {
        try {
            const M = root.LocationAlertBackground && root.LocationAlertBackground.Mirror;
            if (M && M.set) { M.set(key, value); return; }
            const P = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.Preferences;
            if (P && P.set) P.set({ key, value: String(value) }).catch(() => { });
        } catch (_) { }
    }
    /** 활성+동의 플래그를 네이티브 미러에 반영. */
    function syncNativeFlags(enabled, consented) {
        prefsSet(NATIVE_ACTIVE_KEY, enabled ? 'true' : 'false');
        prefsSet(NATIVE_CONSENT_KEY, consented ? 'true' : 'false');
    }

    // ── 설정/동의 상태 (단말 저장) ────────────────────────────────────────────
    const LocationAlertSettings = {
        data: { enabled: false, consent: null }, // consent: { version, agreedAt }
        init() {
            try {
                const raw = ls() && ls().getItem(STORAGE_KEY);
                if (raw) Object.assign(this.data, JSON.parse(raw));
            } catch (_) { }
            // 기존 활성 단말이 앱 업데이트 후에도 네이티브 플래그를 갖도록 1회 동기화.
            syncNativeFlags(!!this.data.enabled, !!this.data.consent);
            return this;
        },
        save() {
            try { ls() && ls().setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (_) { }
            // 네이티브 게이팅 플래그 미러(활성 + 동의 여부). killed 상태 네이티브가 읽음.
            syncNativeFlags(!!this.data.enabled, !!this.data.consent);
        },
        get() { return this.data; },
        setEnabled(v) { this.data.enabled = !!v; this.save(); },
        recordConsent() {
            this.data.consent = { version: CONSENT_VERSION, agreedAt: new Date().toISOString() };
            this.save();
        },
        clear() { this.data = { enabled: false, consent: null }; this.save(); },
    };

    /** 관리자 등록 단말 여부 = 관리자 토큰 보유. (활성 권한 게이트) */
    function isAdminDevice() {
        try {
            return !!((ls() && ls().getItem(ADMIN_TOKEN_KEY)) || (ss() && ss().getItem(ADMIN_TOKEN_KEY)));
        } catch (_) { return false; }
    }

    // ── 동의 팝업 ─────────────────────────────────────────────────────────────
    const PIN_ICON = '<svg viewBox="0 0 24 24" stroke="#7fd1ff"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

    function consentMessageHtml() {
        return (
            '<div style="text-align:left; max-height:48vh; overflow-y:auto; font-size:0.86rem; line-height:1.65; color:#cbd5e1;">' +
            'SEAGNAL은 현재 위치하신 해역의 해상특보를 신속히 안내해 드리기 위해 위치정보를 이용합니다.<br><br>' +
            '<b>• 수집 항목</b> : 단말기 위치정보(GPS 좌표)<br>' +
            '<b>• 이용 목적</b> : 현재 위치한 해역의 해상특보(예비특보·주의보·경보) 안전 경보 제공<br>' +
            '<b>• 수집 방식</b> : 앱이 종료되어 있거나 사용 중이 아닐 때에도(백그라운드) 약 15분 주기로 위치를 확인합니다.<br>' +
            '<b style="color:#7fd1ff;">• 저장 및 보관</b> : 수집된 위치정보는 <b style="color:#7fd1ff;">이용자의 휴대폰 내부에만 저장되며, 서버 등 외부로 전송·수집되지 않습니다.</b> 최신 위치 1건만 갱신·보관하고, 본 기능을 해제하면 즉시 삭제됩니다.<br>' +
            '<b>• 동의 거부 권리</b> : 동의를 거부하거나 설정에서 언제든 해제할 수 있습니다. 다만 미동의 시 위치 기반 특보 경보는 제공되지 않습니다.' +
            '</div>'
        );
    }

    async function showConsentPopup() {
        if (typeof root.showCustomPopup !== 'function') return false;
        return await root.showCustomPopup({
            icon: PIN_ICON,
            iconBg: 'rgba(127, 209, 255, 0.12)',
            title: '위치 기반 특보 정보 제공 동의',
            message: consentMessageHtml(),
            confirmText: '동의함',
            cancelText: '동의하지 않음',
        });
    }

    async function showBackgroundGuidePopup() {
        if (typeof root.showCustomPopup !== 'function') return false;
        return await root.showCustomPopup({
            icon: PIN_ICON,
            iconBg: 'rgba(127, 209, 255, 0.12)',
            title: '“항상 허용”이 필요합니다',
            message: '앱이 꺼져 있을 때도 해상특보를 받으려면 위치 권한을 <b>“항상 허용”</b>으로 설정해야 합니다.<br>다음 화면에서 “항상 허용”을 선택해 주세요.',
            confirmText: '권한 요청',
            cancelText: '나중에',
        });
    }

    // ── 전경 위치 권한 확보 (기존 헬퍼 재사용) ───────────────────────────────
    async function ensureForegroundLocation() {
        // 네이티브가 아니면(웹) 통과 — 실제 권한은 네이티브에서만 의미.
        if (!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform())) return true;
        if (typeof root.getCurrentPositionViaCapacitor !== 'function') return false;
        try {
            await root.getCurrentPositionViaCapacitor(); // 권한 요청 + 1회 획득
            return true;
        } catch (_) {
            return false; // location_permission_denied 등
        }
    }

    /** 위치 권한 설정 화면 열기 — 앱 정보(권한) 화면. 알림 설정(openAppSettings)으로 가지 않도록 분리. */
    function openLocationSettings() {
        if (typeof root.openAppLocationSettings === 'function') return root.openAppLocationSettings();
        if (typeof root.openAppSettings === 'function') return root.openAppSettings(); // 폴백
    }

    /** 푸시 토큰(앱 표준 키 'push_token'). capacitor-plugins.js subscribeUser가 저장. */
    function getPushToken() {
        try { return (ls() && ls().getItem('push_token')) || null; } catch (_) { return null; }
    }

    /** 동의 사실만 서버에 최소 기록(위치 좌표 전송 안 함). 엔드포인트는 ④에서 구현 — 실패는 무시. */
    function syncConsentToServer(agreed) {
        try {
            if (!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform())) return;
            const token = getPushToken();
            if (!token) return; // 토큰 없으면 기록 불가(조용히 무시)
            const fetchFn = root.fetch;
            if (!fetchFn) return;
            fetchFn('/api/location-alert/consent', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, agreed: !!agreed, version: CONSENT_VERSION, at: new Date().toISOString() }),
            }).catch(() => { });
        } catch (_) { /* fail-soft (서버 라우트는 ④에서 추가) */ }
    }

    // ── 토글 핸들러 / 시각 상태 ──────────────────────────────────────────────
    function updateVisual(enabled) {
        const note = root.document && root.document.getElementById('location-alert-status');
        if (note) {
            note.textContent = enabled ? '활성됨 · 내 위치 해역의 특보를 경보합니다.' : '비활성 상태입니다.';
            note.style.color = enabled ? '#7fd1ff' : '#64748b';
        }
    }

    async function onToggle(checkbox) {
        // 끄기
        if (!checkbox.checked) {
            LocationAlertSettings.setEnabled(false);
            LocationAlertSettings.clear();
            updateVisual(false);
            syncConsentToServer(false);
            // TODO(②): 백그라운드 위치 추적 중지 + 단말 저장 위치 삭제
            if (root.LocationAlertBackground && root.LocationAlertBackground.stop) root.LocationAlertBackground.stop();
            return;
        }

        // 켜기 — 관리자 단말만
        if (!isAdminDevice()) {
            checkbox.checked = false;
            if (typeof root.showCustomPopup === 'function') {
                root.showCustomPopup({
                    icon: PIN_ICON, iconBg: 'rgba(127,209,255,0.12)',
                    title: '관리자 전용 기능', message: '이 기능은 현재 관리자 등록 단말에서만 활성할 수 있습니다.',
                    confirmText: '확인',
                });
            }
            return;
        }

        // 1) 동의
        const agreed = await showConsentPopup();
        if (!agreed) { checkbox.checked = false; return; }

        // 2) 전경 위치 권한
        const fg = await ensureForegroundLocation();
        if (!fg) {
            checkbox.checked = false;
            if (typeof root.showCustomPopup === 'function') {
                root.showCustomPopup({
                    icon: PIN_ICON, iconBg: 'rgba(255,152,0,0.12)',
                    title: '위치 권한이 필요합니다', message: '위치 권한이 거부되어 기능을 켤 수 없습니다.<br>휴대폰 설정에서 위치 권한을 허용해 주세요.',
                    confirmText: '설정으로 이동', cancelText: '취소',
                }).then((go) => { if (go) openLocationSettings(); });
            }
            return;
        }

        // 3) 백그라운드("항상 허용") — 설명 후 시스템 권한 "요청"으로 위치 권한 화면을 직접 띄움.
        //    (Android 11+는 백그라운드 위치 요청 시 '위치 액세스 권한' 화면으로 안내 → 설정 디깅 불필요)
        const proceed = await showBackgroundGuidePopup();

        // 4) 활성 확정 + 기록
        LocationAlertSettings.recordConsent();
        LocationAlertSettings.setEnabled(true);
        updateVisual(true);
        syncConsentToServer(true);
        // 백그라운드 추적 시작 — 플러그인이 requestPermissions:true 로 '항상 허용' 권한을 요청한다.
        if (proceed && root.LocationAlertBackground && root.LocationAlertBackground.start) {
            root.LocationAlertBackground.start();
        }
    }

    /** 설정 모달이 열릴 때 호출 — 토글 상태/관리자 게이트 반영 + 이벤트 바인딩. */
    function initLocationAlertUI() {
        if (!root.document) return;
        LocationAlertSettings.init();
        const toggle = root.document.getElementById('location-alert-toggle');
        const badge = root.document.getElementById('location-alert-admin-badge');
        if (!toggle) return;

        const admin = isAdminDevice();
        // 비관리자: 항상 OFF + 잠금. 관리자: 저장된 활성값 반영.
        toggle.checked = !!(admin && LocationAlertSettings.get().enabled);
        toggle.disabled = !admin;
        if (badge) badge.style.display = admin ? 'none' : 'inline-block';
        const card = root.document.getElementById('location-alert-card');
        if (card) card.style.opacity = admin ? '1' : '0.6';

        toggle.onchange = function () { onToggle(toggle); };
        updateVisual(toggle.checked);
    }

    const api = {
        CONSENT_VERSION, LocationAlertSettings, isAdminDevice, getPushToken,
        consentMessageHtml, initLocationAlertUI, onToggle,
    };
    if (root) { root.LocationAlertSettings = LocationAlertSettings; root.initLocationAlertUI = initLocationAlertUI; root.LocationAlertUI = api; }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
