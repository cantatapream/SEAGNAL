/**
 * ============================================================================
 * location_alert_ui.js — 위치 기반 기상 정보 제공: 동의·활성 UI (③ 단계)
 * ============================================================================
 * 설계 문서: 00_docs/LOCATION_BASED_ALERT_DESIGN.md (§10)
 *
 * 푸시 설정 탭의 "위치 기반 기상 정보 제공" 토글을 담당.
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
    // 하위 토글 미러 (네이티브 killed 대응). LocationAlertStore.isTyphoonSubOn 이 sub_typhoon 을 읽음.
    const NATIVE_SUB_ALERT_KEY = 'location_alert_sub_alert';     // "true"/"false"
    const NATIVE_SUB_TYPHOON_KEY = 'location_alert_sub_typhoon'; // "true"/"false"

    // 종료(killed) 상태 알림은 네이티브 모듈이 포함된 APK 에서만 동작한다. 웹 UI 는 fly.dev
    // 최신이 떠서 토글이 보이지만, 구버전 APK(네이티브 미포함)에선 못 쓰므로 앱 버전으로 가드한다.
    // 네이티브 종료상태 기능이 들어간 최소 앱 버전(=이 기능 출시 버전). versionName 비교 기준.
    const NATIVE_MIN_VERSION = '1.2.1';

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
    /** 하위 토글(특보/태풍) 플래그를 네이티브 미러에 반영(killed 상태 네이티브가 읽음). 기본 ON. */
    function syncNativeSubFlags(subAlert, subTyphoon) {
        prefsSet(NATIVE_SUB_ALERT_KEY, subAlert === false ? 'false' : 'true');
        prefsSet(NATIVE_SUB_TYPHOON_KEY, subTyphoon === false ? 'false' : 'true');
    }

    // ── 설정/동의 상태 (단말 저장) ────────────────────────────────────────────
    const LocationAlertSettings = {
        // subAlert/subTyphoon: 하위 알림 토글(특보/태풍, 둘 다 기본 ON). 미설정 단말은 init 의
        //   Object.assign 이 저장값에 없는 키를 덮어쓰지 않으므로 기본 ON 으로 마이그레이션됨.
        data: { enabled: false, consent: null, subAlert: true, subTyphoon: true }, // consent: { version, agreedAt }
        init() {
            try {
                const raw = ls() && ls().getItem(STORAGE_KEY);
                if (raw) Object.assign(this.data, JSON.parse(raw));
            } catch (_) { }
            // 기존 활성 단말이 앱 업데이트 후에도 네이티브 플래그를 갖도록 1회 동기화.
            syncNativeFlags(!!this.data.enabled, !!this.data.consent);
            // 하위 토글 미러도 1회 동기화(미설정 단말은 기본 ON 으로 들어감).
            syncNativeSubFlags(this.data.subAlert, this.data.subTyphoon);
            return this;
        },
        save() {
            try { ls() && ls().setItem(STORAGE_KEY, JSON.stringify(this.data)); } catch (_) { }
            // 네이티브 게이팅 플래그 미러(활성 + 동의 여부). killed 상태 네이티브가 읽음.
            syncNativeFlags(!!this.data.enabled, !!this.data.consent);
            // 하위 토글(특보/태풍)도 미러 — 태풍 반경 알림은 네이티브가 직접 처리하므로 subTyphoon 필요.
            syncNativeSubFlags(this.data.subAlert, this.data.subTyphoon);
        },
        get() { return this.data; },
        setEnabled(v) { this.data.enabled = !!v; this.save(); },
        /** 하위 알림 토글 저장. key ∈ {'subAlert','subTyphoon'}. (enabled/consent 흐름과 독립) */
        setSub(key, v) {
            if (key !== 'subAlert' && key !== 'subTyphoon') return;
            this.data[key] = !!v;
            this.save(); // save() 가 syncNativeSubFlags 로 sub_alert/sub_typhoon 을 Preferences 에 미러.
        },
        recordConsent() {
            this.data.consent = { version: CONSENT_VERSION, agreedAt: new Date().toISOString() };
            this.save();
        },
        // 동의/활성만 초기화. 하위 토글(subAlert/subTyphoon) 사용자 선호는 보존(재동의 시 재설정 불필요).
        //   save()→syncNativeFlags 에는 enabled=false/consent=null 만 전달되므로 네이티브 게이팅 영향 없음.
        clear() {
            this.data = {
                enabled: false, consent: null,
                subAlert: this.data.subAlert !== false,
                subTyphoon: this.data.subTyphoon !== false,
            };
            this.save();
        },
    };

    /** 관리자 등록 단말 여부 = 관리자 토큰 보유. (활성 권한 게이트) */
    function isAdminDevice() {
        try {
            return !!((ls() && ls().getItem(ADMIN_TOKEN_KEY)) || (ss() && ss().getItem(ADMIN_TOKEN_KEY)));
        } catch (_) { return false; }
    }

    // ── 버전 게이팅 (네이티브 종료상태 지원 = 최신 APK 여부) ──────────────────
    let _nativeCapable = false; // 비동기 판정 결과 캐시(초기 보수적 false)
    /** 'a.b.c' 비교 → a<b:-1, ==:0, a>b:1 */
    function cmpVersion(a, b) {
        const pa = String(a == null ? '0' : a).split('.').map(function (n) { return parseInt(n, 10) || 0; });
        const pb = String(b == null ? '0' : b).split('.').map(function (n) { return parseInt(n, 10) || 0; });
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
    }
    /** 설치된 앱 버전(versionName) — @capacitor/app. 못 읽으면 null. */
    async function getAppVersion() {
        try {
            const App = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.App;
            if (App && App.getInfo) { const info = await App.getInfo(); return info && info.version; }
        } catch (_) { }
        return null;
    }
    /** 네이티브 종료상태 기능 사용 가능 여부 = 네이티브 플랫폼 && 앱버전 ≥ NATIVE_MIN_VERSION. */
    async function isNativeCapable() {
        if (!(root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform())) return false;
        const v = await getAppVersion();
        if (!v) return false; // 버전 못 읽으면 보수적으로 미지원
        return cmpVersion(v, NATIVE_MIN_VERSION) >= 0;
    }

    // ── 동의 팝업 ─────────────────────────────────────────────────────────────
    const PIN_ICON = '<svg viewBox="0 0 24 24" stroke="#7fd1ff"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>';

    function consentMessageHtml() {
        return (
            '<div style="text-align:left; max-height:48vh; overflow-y:auto; font-size:0.86rem; line-height:1.65; color:#cbd5e1;">' +
            'SEAGNAL은 현재 위치하신 해역의 해상특보를 신속히 안내해 드리기 위해 위치정보를 이용합니다.<br><br>' +
            '<b>• 수집 항목</b> : 단말기 위치정보(GPS 좌표)<br>' +
            '<b>• 이용 목적</b> : 현재 위치한 해역의 해상특보(예비특보·주의보·경보) 안전 경보 제공<br>' +
            '<b>• 수집 방식</b> : 해상특보가 발표·변경되는 시점에(앱이 종료되어 있거나 사용 중이 아닐 때에도) 그 순간 위치를 1회 확인합니다. 평상시 상시(백그라운드 연속) 수집은 하지 않습니다.<br>' +
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
            title: '위치 기반 기상 정보 제공 동의',
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
        // 위치 "획득"이 아니라 "권한만" 요청(빠름). getCurrentPosition 의 GPS 대기(최대 20초) 지연 제거.
        if (typeof root.requestForegroundLocationPermission === 'function') {
            try { return (await root.requestForegroundLocationPermission()) === 'granted'; }
            catch (_) { return false; }
        }
        // 폴백(구버전 앱): 위치 1회 획득으로 권한 확인.
        if (typeof root.getCurrentPositionViaCapacitor !== 'function') return false;
        try { await root.getCurrentPositionViaCapacitor(); return true; }
        catch (_) { return false; }
    }

    /** 위치 권한 설정 화면 열기 — 앱 정보(권한) 화면. 알림 설정(openAppSettings)으로 가지 않도록 분리. */
    function openLocationSettings() {
        if (typeof root.openAppLocationSettings === 'function') return root.openAppLocationSettings();
        if (typeof root.openAppSettings === 'function') return root.openAppSettings(); // 폴백
    }

    /** 백그라운드('항상 허용') 위치 권한을 네이티브에서 직접 요청 → Android 11+ 는 '항상 허용' 화면 표출.
     *  네이티브 플러그인(LocationPerm)이 있을 때만 동작. 호출에 성공하면 true. */
    async function requestBackgroundLocation() {
        try {
            const LP = root.Capacitor && root.Capacitor.Plugins && root.Capacitor.Plugins.LocationPerm;
            if (LP && LP.requestBackground) { await LP.requestBackground(); return true; }
        } catch (_) { }
        return false;
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

    // ── 앱 실행 재동기화 (B/C) ────────────────────────────────────────────────
    /**
     * (B) 네이티브 게이팅 플래그 재미러 — 앱 실행 시마다 호출(capacitor-plugins.js 훅).
     * 기존엔 설정 모달 open(init) / 토글(save) 때만 미러돼, 재설치·데이터 유실 후
     * Preferences 플래그가 비어 네이티브가 모든 wake 를 조용히 스킵할 수 있었다.
     * LocationAlertSettings.init() 은 멱등(localStorage 의 persisted 상태를 읽어 그대로
     * syncNativeFlags/syncNativeSubFlags 로 미러)이므로 재사용한다.
     * ⚠ persisted 상태를 "있는 그대로" 미러할 뿐 — OFF 인 설정을 ON 으로 만들지 않는다
     *   (토글 흐름과 충돌 없음). 절대 throw 하지 않음.
     */
    function resyncNativeFlags() {
        try {
            LocationAlertSettings.init(); // persisted 로드 + syncNativeFlags + syncNativeSubFlags
            return true;
        } catch (_) { return false; }
    }

    /**
     * (C) 동의 사실 서버 재등록 — 앱 실행/토큰 (재)등록 시 호출(capacitor-plugins.js 훅).
     * 기존엔 토글 시점에만 POST 했고 그 순간 push_token 이 없으면 조용히 무시돼,
     * 서버 동의 레코드가 현재 토큰과 어긋나면(미등록/토큰 회전) selectTargetTokens 가
     * 이 단말을 제외 → wake 가 영영 오지 않는 문제가 있었다.
     * persisted 설정이 활성+동의이고 push_token 이 있을 때만 syncConsentToServer(true)
     * (서버 /api/location-alert/consent 는 토큰 기준 upsert → 반복 POST 멱등).
     * 비활성/미동의/토큰 없음이면 조용히 no-op — 동의를 "만들어내지" 않는다.
     * @returns {boolean} POST 를 시도했으면 true.
     */
    function resyncConsentToServer() {
        try {
            LocationAlertSettings.init(); // persisted 상태 기준(멱등)
            const d = LocationAlertSettings.get();
            if (!d || d.enabled !== true || !d.consent) return false; // OFF/미동의 → no-op
            if (!getPushToken()) return false;                        // 토큰 없음 → no-op
            syncConsentToServer(true); // 내부에서 네이티브 가드 + fail-soft POST
            return true;
        } catch (_) { return false; }
    }

    // ── 토글 핸들러 / 시각 상태 ──────────────────────────────────────────────
    function updateVisual(enabled) {
        const note = root.document && root.document.getElementById('location-alert-status');
        if (note) {
            note.textContent = enabled ? '활성됨 · 내 위치 해역의 특보를 경보합니다.' : '비활성 상태입니다.';
            note.style.color = enabled ? '#7fd1ff' : '#64748b';
        }
    }

    /** 하위 토글 컨테이너 활성/잠금 처리. active=true 면 조작 가능, false 면 흐림+pointer-events 차단+disabled.
     *  상위(동의) 토글이 ON 이면서 게이트 통과 시에만 active. init·onToggle·버전게이트 공용 헬퍼. */
    function syncSubToggles(active) {
        if (!root.document) return;
        const box = root.document.getElementById('location-alert-sub');
        if (box) {
            box.style.opacity = active ? '1' : '0.4';
            box.style.pointerEvents = active ? 'auto' : 'none';
        }
        const subA = root.document.getElementById('location-alert-sub-alert');
        const subT = root.document.getElementById('location-alert-sub-typhoon');
        if (subA) subA.disabled = !active;
        if (subT) subT.disabled = !active;
    }

    /** 저장된 하위 토글 값을 체크박스 checked 에 반영(표시만). */
    function reflectSubToggleValues() {
        if (!root.document) return;
        const d = LocationAlertSettings.get();
        const subA = root.document.getElementById('location-alert-sub-alert');
        const subT = root.document.getElementById('location-alert-sub-typhoon');
        if (subA) subA.checked = d.subAlert !== false;
        if (subT) subT.checked = d.subTyphoon !== false;
    }

    async function onToggle(checkbox) {
        // 끄기
        if (!checkbox.checked) {
            LocationAlertSettings.setEnabled(false);
            LocationAlertSettings.clear();
            updateVisual(false);
            syncSubToggles(false); // 상위 OFF → 하위 토글 잠금(흐림). 선호값 자체는 clear()가 보존.
            syncConsentToServer(false);
            // 해제 시 단말 저장 위치 즉시 삭제(이벤트 기반: 상시 watcher 없음 → 삭제만).
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

        // 켜기 — 네이티브 종료상태 미지원(구버전 앱)이면 차단 + 업데이트 안내
        if (!_nativeCapable) {
            checkbox.checked = false;
            if (typeof root.showCustomPopup === 'function') {
                root.showCustomPopup({
                    icon: PIN_ICON, iconBg: 'rgba(248,113,113,0.12)',
                    title: '앱 업데이트가 필요합니다',
                    message: '이 기능은 최신 버전 앱에서만 사용할 수 있습니다.<br>앱을 최신 버전으로 업데이트해 주세요.',
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

        // 3) 백그라운드("항상 허용") 안내 후 — 위치 권한 화면을 연다.
        //    안드로이드는 앱별 위치-권한 라디오 화면으로 가는 공개 인텐트가 없어, 앱 정보(권한)
        //    화면을 연다(거기서 위치 → '항상 허용'). 플러그인 권한요청에만 의존하면 안 열리는
        //    기기가 있어, 설정 화면 열기를 보장한다.
        const proceed = await showBackgroundGuidePopup();

        // 4) 활성 확정 + 기록
        LocationAlertSettings.recordConsent();
        LocationAlertSettings.setEnabled(true);
        updateVisual(true);
        // 상위 ON 확정 → 하위 토글 활성 + 저장값 반영(체크박스 상태 동기화).
        reflectSubToggleValues();
        syncSubToggles(true);
        syncConsentToServer(true);
        if (proceed) {
            // 네이티브 권한 요청 → '항상 허용' 화면 직접 표출(최신 앱). 구버전 앱은 앱 정보 화면으로 폴백.
            const asked = await requestBackgroundLocation();
            if (!asked) openLocationSettings();
        }
        // 이벤트 기반 전환: 활성 시점에 fresh-fix 1회만 수행(상시 watcher/전경 서비스 없음).
        //   실제 위치 판정은 깨우는 신호(특보 발표·변경) 시점에 handleWake 가 fresh-fix 로 수행.
        //   '항상 허용'은 종료 상태에서의 1회 위치 획득(killed fresh-fix)을 위해 여전히 필요.
        if (root.LocationAlertBackground && root.LocationAlertBackground.start) {
            root.LocationAlertBackground.start();
        }
    }

    /** 설정 모달이 열릴 때 호출 — 토글 상태/관리자 게이트 + 버전 게이트 반영 + 이벤트 바인딩. */
    function initLocationAlertUI() {
        if (!root.document) return;
        LocationAlertSettings.init();
        const toggle = root.document.getElementById('location-alert-toggle');
        const badge = root.document.getElementById('location-alert-admin-badge');
        const updateNote = root.document.getElementById('location-alert-update-note');
        if (!toggle) return;

        const admin = isAdminDevice();
        // 비관리자: 항상 OFF + 잠금. 관리자: 저장된 활성값 반영.
        toggle.checked = !!(admin && LocationAlertSettings.get().enabled);
        toggle.disabled = !admin;
        if (badge) badge.style.display = admin ? 'none' : 'inline-block';
        if (updateNote) updateNote.style.display = 'none';
        const card = root.document.getElementById('location-alert-card');
        if (card) card.style.opacity = admin ? '1' : '0.6';

        toggle.onchange = function () { onToggle(toggle); };
        updateVisual(toggle.checked);

        // 하위 토글: 저장값 반영 + onchange→저장 바인딩.
        reflectSubToggleValues();
        const subA = root.document.getElementById('location-alert-sub-alert');
        const subT = root.document.getElementById('location-alert-sub-typhoon');
        if (subA) subA.onchange = function () { LocationAlertSettings.setSub('subAlert', subA.checked); };
        if (subT) {
            // ② 태풍: 라이브 태풍-반경 엔진 미구축 → 설정 저장만(엔진 구축 시 런타임/서버 연동).
            subT.onchange = function () { LocationAlertSettings.setSub('subTyphoon', subT.checked); };
        }
        // 하위 토글 활성 조건 = 상위 토글이 조작 가능(미잠금)하고 켜져 있음.
        syncSubToggles(!!toggle.checked && !toggle.disabled);

        // 버전 게이트(비동기): 관리자라도 네이티브 미지원(구버전 앱)이면 토글 비활성 + 빨간 안내.
        if (admin) {
            isNativeCapable().then(function (capable) {
                _nativeCapable = capable;
                if (!capable) {
                    toggle.checked = false;
                    toggle.disabled = true;
                    if (updateNote) updateNote.style.display = 'block';
                    updateVisual(false);
                } else {
                    toggle.disabled = false;
                    if (updateNote) updateNote.style.display = 'none';
                }
                // 게이트 판정 반영 후 하위 토글 잠금 재계산.
                syncSubToggles(!!toggle.checked && !toggle.disabled);
            });
        }
    }

    const api = {
        CONSENT_VERSION, NATIVE_MIN_VERSION, LocationAlertSettings, isAdminDevice, getPushToken,
        consentMessageHtml, initLocationAlertUI, onToggle, cmpVersion, isNativeCapable,
        syncSubToggles, reflectSubToggleValues,
        resyncNativeFlags, resyncConsentToServer,
    };
    if (root) { root.LocationAlertSettings = LocationAlertSettings; root.initLocationAlertUI = initLocationAlertUI; root.LocationAlertUI = api; }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
