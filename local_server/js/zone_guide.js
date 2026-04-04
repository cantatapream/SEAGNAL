/**
 * ============================================================================
 * 파일명: js/zone_guide.js
 * 역할: 관심 해역 설정 유도 팝업 (1회성 넛지)
 * ============================================================================
 *
 * [개요 - 초보자 안내]
 * 이 파일은 "모든 해역(35개)을 구독 중인 사용자"에게 관심 해역 설정을 유도하는
 * 1회성 팝업을 표시합니다.
 *
 * [문제 배경]
 * 앱의 기본 설정이 모든 해역 구독이라, 대부분의 사용자가 관심 해역을 설정하지 않아
 * 거의 모든 푸시 알림이 전체 사용자에게 발송됩니다.
 * 이 팝업은 사용자에게 관심 해역 설정을 유도하여 불필요한 알림을 줄이는 목적입니다.
 *
 * [동작 원리]
 * 1. 팝업 체인의 마지막 단계에서 checkZoneGuide() 호출
 *    (설문 → 공지 → 해역 가이드 순서)
 * 2. 조건 확인:
 *    - zone_guide_dismissed가 true이면 → 표시 안 함
 *    - 사용자가 이미 해역을 커스터마이징했으면 → 표시 안 함
 *    - zone_guide_first_seen이 없으면 → 첫 방문이므로 플래그만 저장하고 표시 안 함
 *    - zone_guide_first_seen이 있으면 → 2회차 이상 방문이므로 모달 표시
 * 3. 모달은 신규/기존 사용자에 따라 다른 문구를 표시:
 *    - first_seen이 7일 이내 → 신규 사용자 문구 ("관심 해역을 설정해보세요")
 *    - first_seen이 7일 초과 → 기존 사용자 문구 ("모든 해역의 알림을 받고 있어요")
 * 4. [설정하기] → 기존 설정 모달(관심해역 탭) 열기
 * 5. [유지하기] → 토스트 메시지 표시 + 영구 미표시 플래그 저장
 *
 * [localStorage 키]
 * - zone_guide_first_seen: 최초 방문 시각 (Date.now() 숫자)
 * - zone_guide_dismissed: 'true'이면 영구 미표시
 *
 * [연계 파일]
 * - js/admin_trigger.js → checkNoticeStatus() / closeNoticePopup()에서 이 파일의
 *                          checkZoneGuide()를 호출하여 팝업 체인 연결
 * - js/settings.js → openSettingsModal()로 관심해역 설정 화면 열기
 * - js/config.js → SEA_REGIONS, SUB_REGION_ZONES (해역 계층 구조)
 * - capacitor-plugins.js → ALL_ZONES (전체 소분류 해역 목록, 동일 기준 사용)
 *
 * [로딩 순서]
 * index.html에서 survey_user.js 다음에 로드
 * IIFE(즉시실행함수)로 감싸져 있어 전역 스코프를 오염시키지 않음
 * 외부에서 호출할 수 있도록 window.checkZoneGuide만 전역에 노출
 * ============================================================================
 */

(function () {

    // ========================================================================
    // [상수] 전체 소분류 해역 목록
    // capacitor-plugins.js의 ALL_ZONES와 동일한 목록
    // 이 목록을 기준으로 "모든 해역 구독 중"인지 판별합니다.
    // ========================================================================
    const ALL_ZONES = [
        // 동해남부 소분류
        '울산앞바다', '경북남부앞바다', '경북북부앞바다',
        '동해남부남쪽안쪽먼바다', '동해남부남쪽바깥먼바다',
        '동해남부북쪽안쪽먼바다', '동해남부북쪽바깥먼바다',
        // 동해중부 소분류
        '강원북부앞바다', '강원중부앞바다', '강원남부앞바다',
        '동해중부안쪽먼바다', '동해중부바깥먼바다',
        // 서해중부 소분류
        '인천·경기북부앞바다', '인천·경기남부앞바다',
        '충남북부앞바다', '충남남부앞바다',
        '서해중부안쪽먼바다', '서해중부바깥먼바다',
        // 서해남부 소분류
        '전북북부앞바다', '전북남부앞바다',
        '전남북부서해앞바다', '전남중부서해앞바다', '전남남부서해앞바다',
        '서해남부북쪽안쪽먼바다', '서해남부북쪽바깥먼바다',
        '서해남부남쪽안쪽먼바다', '서해남부남쪽바깥먼바다',
        // 남해동부 소분류
        '부산앞바다', '경남서부남해앞바다', '경남중부남해앞바다',
        '거제시동부앞바다', '남해동부안쪽먼바다', '남해동부바깥먼바다',
        // 남해서부 소분류
        '전남서부남해앞바다', '전남동부남해앞바다',
        '남해서부서쪽먼바다', '남해서부동쪽먼바다',
        // 제주 소분류
        '제주도북부앞바다', '제주도남부앞바다', '제주도동부앞바다',
        '제주도서부앞바다', '제주도남서쪽안쪽먼바다',
        '제주도남동쪽안쪽먼바다', '제주도남쪽바깥먼바다'
    ];

    // ========================================================================
    // [localStorage 키 상수]
    // ========================================================================
    const KEY_FIRST_SEEN = 'zone_guide_first_seen';   // 최초 방문 시각
    const KEY_DISMISSED = 'zone_guide_dismissed';       // 영구 미표시 플래그
    const SETTINGS_KEY = 'weatherAppSettings_v1';       // 사용자 해역 설정

    // 신규/기존 사용자 구분 기준 (7일 = 604800000ms)
    const NEW_USER_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

    // ========================================================================
    // [핵심 함수] checkZoneGuide()
    // 팝업 체인의 마지막 단계에서 호출됩니다.
    // 조건을 순서대로 확인하고, 모달을 표시할지 결정합니다.
    // ========================================================================
    function checkZoneGuide() {
        // 1. 이미 "다시 보지 않기" 처리가 되었는지 확인
        if (localStorage.getItem(KEY_DISMISSED) === 'true') {
            return; // 영구 미표시 → 아무것도 안 함
        }

        // 2. 사용자가 이미 해역을 커스터마이징했는지 확인
        //    weatherAppSettings_v1에서 하나라도 false로 설정한 해역이 있으면
        //    이미 직접 설정을 변경한 사용자이므로 팝업이 불필요합니다.
        if (!isAllZonesOn()) {
            return; // 이미 커스텀 상태 → 아무것도 안 함
        }

        // 3. 최초 방문 여부 확인 (zone_guide_first_seen 존재 여부)
        const firstSeen = localStorage.getItem(KEY_FIRST_SEEN);

        if (!firstSeen) {
            // 이 기능을 처음 만남! 플래그를 저장하고 팝업은 표시하지 않음
            // (신규 사용자는 설문/공지 등 다른 팝업이 이미 충분하므로 다음 접속에 표시)
            localStorage.setItem(KEY_FIRST_SEEN, String(Date.now()));
            return;
        }

        // 4. 2회차 이상 방문 → 모달 표시
        //    신규/기존 사용자 구분 기준:
        //    - seagnal_device_id가 zone_guide_first_seen보다 먼저 생성되었으면 기존 사용자
        //      (이 기능 배포 전부터 앱을 사용하던 사람)
        //    - 그렇지 않으면 first_seen 시점으로 7일 기준 판단
        //    - 기존 사용자 판별: seagnal_device_id 존재 + first_seen이 최근(= 기능 배포 시점)
        //      → 배포 직후 first_seen이 생겼으므로 elapsed가 짧더라도 기존 사용자
        var userType = 'new';
        var elapsed = Date.now() - parseInt(firstSeen, 10);

        // seagnal_device_id는 앱 최초 접속 시 survey_user.js에서 생성됨
        // first_seen과 device_id 생성 시점의 차이로 판별:
        // - device_id의 타임스탬프 < first_seen → 이미 앱을 사용하던 사용자 (기존)
        // - device_id가 없거나 first_seen과 거의 동시 → 신규 사용자
        var deviceId = localStorage.getItem('seagnal_device_id') || '';
        var deviceTimestamp = 0;
        var deviceMatch = deviceId.match(/^dev_(\d+)_/);
        if (deviceMatch) {
            deviceTimestamp = parseInt(deviceMatch[1], 10);
        }
        var firstSeenTs = parseInt(firstSeen, 10);

        if (deviceTimestamp > 0 && (firstSeenTs - deviceTimestamp > 60000)) {
            // device_id가 first_seen보다 1분 이상 먼저 생성됨 → 기존 사용자
            // (이 기능 배포 전부터 앱을 사용하던 사람)
            userType = 'existing';
        } else if (elapsed > NEW_USER_THRESHOLD_MS) {
            // first_seen이 7일 넘었는데 아직 dismissed 안 함 → 기존으로 분류
            userType = 'existing';
        }

        // 1.5초 딜레이 후 모달 표시 (화면 렌더링이 안정된 후)
        setTimeout(function () {
            // 다른 모달/팝업이 이미 열려있으면 해역 가이드를 표시하지 않음
            // (예: 공지 "자세히 보기"로 게시글 상세가 열린 경우)
            // - .notice-modal-overlay: 공지 팝업
            // - #survey-user-popup: 설문 팝업
            // - #promo-detail-modal:not(.hidden): 게시글 상세 모달 (hidden 클래스 없을 때 = 열린 상태)
            var hasOtherPopup = document.querySelector(
                '.notice-modal-overlay, #survey-user-popup, #promo-detail-modal:not(.hidden)'
            );
            if (hasOtherPopup) return;

            showZoneGuideModal(userType);
        }, 1500);
    }

    // ========================================================================
    // [헬퍼 함수] isAllZonesOn()
    // 모든 해역이 ON 상태인지 확인합니다.
    // weatherAppSettings_v1에서 소분류 해역 중 하나라도 false이면 false 반환.
    // 대분류/중분류가 false인 경우도 커스터마이징된 것으로 판단합니다.
    // ========================================================================
    function isAllZonesOn() {
        try {
            const saved = localStorage.getItem(SETTINGS_KEY);
            if (!saved) return true; // 설정 자체가 없으면 기본값(전체 ON)

            const settings = JSON.parse(saved);

            // 설정 객체의 모든 값을 확인:
            // 하나라도 false가 있으면 사용자가 커스터마이징한 것
            for (const key in settings) {
                if (settings[key] === false) {
                    return false;
                }
            }
            return true; // 모든 값이 true이거나 설정이 비어있음 → 전체 ON
        } catch (e) {
            return true; // 파싱 실패 시 안전하게 true 반환
        }
    }

    // ========================================================================
    // [UI 함수] showZoneGuideModal(userType)
    // 사용자 유형에 따라 다른 문구의 모달을 표시합니다.
    // userType: 'new' (신규, 7일 이내) 또는 'existing' (기존, 7일 초과)
    // ========================================================================
    function showZoneGuideModal(userType) {
        // 이미 모달이 떠 있으면 중복 생성 방지
        const existing = document.getElementById('zone-guide-popup');
        if (existing) existing.remove();

        // 사용자 유형별 문구 설정
        const isNew = userType === 'new';

        // 신규: 설정 유도, 기존: 현재 상태 알림
        const icon = isNew ? '📍' : '🔔';
        const title = isNew
            ? '관심 해역을 설정해보세요'
            : '현재 모든 해역(35개)의\n특보 알림을 받고 있어요';
        const description = isNew
            ? '관심 해역만 선택하면\n꼭 필요한 특보 알림만 받을 수 있어요'
            : '관심 해역만 선택하면\n꼭 필요한 알림만 받을 수 있어요';
        const primaryBtn = isNew ? '관심 해역 설정하기' : '설정하러 가기';
        const secondaryBtn = isNew ? '모든 해역 알림 받기' : '그냥 모두 다 받을게요';

        // 모달 DOM 생성
        const popup = document.createElement('div');
        popup.id = 'zone-guide-popup';
        popup.style.cssText = [
            'position: fixed',
            'inset: 0',
            'z-index: 10100',
            'background: rgba(0, 0, 0, 0.75)',
            'backdrop-filter: blur(6px)',
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'animation: zgFadeIn 0.3s ease-out'
        ].join(';');

        // 제목 텍스트의 줄바꿈 처리 (\n → <br>)
        const titleHtml = title.replace(/\n/g, '<br>');
        const descHtml = description.replace(/\n/g, '<br>');

        popup.innerHTML = `
            <style>
                @keyframes zgFadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes zgSlideUp { from { transform: translateY(30px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
            </style>
            <div style="
                animation: zgSlideUp 0.3s ease-out;
                background: linear-gradient(145deg, #1e293b, #0f172a);
                border-radius: 20px;
                padding: 32px 24px;
                max-width: 340px;
                width: 90%;
                text-align: center;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                border: 1px solid rgba(255, 255, 255, 0.08);
            ">
                <!-- 아이콘 -->
                <div style="
                    width: 60px; height: 60px;
                    margin: 0 auto 16px;
                    background: linear-gradient(135deg, #448aff, #2962ff);
                    border-radius: 16px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 1.5rem;
                ">${icon}</div>

                <!-- 강조 제목 (볼드 + 큰 글씨 + 배경 강조) -->
                <div style="
                    background: rgba(68, 138, 255, 0.1);
                    border: 1px solid rgba(68, 138, 255, 0.2);
                    border-radius: 12px;
                    padding: 14px 16px;
                    margin-bottom: 12px;
                ">
                    <h3 style="
                        color: #fff;
                        font-size: 1.15rem;
                        margin: 0;
                        font-weight: 800;
                        line-height: 1.5;
                    ">${titleHtml}</h3>
                </div>

                <!-- 설명 문구 -->
                <p style="
                    color: #94a3b8;
                    font-size: 0.88rem;
                    margin: 0 0 24px;
                    line-height: 1.6;
                ">${descHtml}</p>

                <!-- 메인 버튼 (설정하기) -->
                <button id="zg-btn-settings" style="
                    width: 100%;
                    padding: 14px;
                    background: linear-gradient(135deg, #448aff, #2962ff);
                    border: none;
                    border-radius: 12px;
                    color: #fff;
                    font-size: 1rem;
                    font-weight: 700;
                    cursor: pointer;
                    margin-bottom: 12px;
                    box-shadow: 0 4px 15px rgba(68, 138, 255, 0.3);
                    transition: transform 0.15s;
                ">${primaryBtn}</button>

                <!-- 보조 텍스트 링크 (유지하기) -->
                <button id="zg-btn-dismiss" style="
                    width: 100%;
                    padding: 12px;
                    background: transparent;
                    border: none;
                    color: #64748b;
                    font-size: 0.85rem;
                    cursor: pointer;
                    transition: color 0.2s;
                ">${secondaryBtn}</button>
            </div>
        `;

        document.body.appendChild(popup);

        // ------------------------------------------------------------------
        // [설정하기 버튼] 클릭 이벤트
        // 모달을 닫고, 기존 설정 화면(관심해역 탭)을 엽니다.
        // 영구 미표시 플래그를 저장합니다.
        // ------------------------------------------------------------------
        document.getElementById('zg-btn-settings').onclick = function () {
            popup.remove();
            localStorage.setItem(KEY_DISMISSED, 'true');

            // 기존 설정 모달 열기 (settings.js의 openSettingsModal 함수)
            // 관심해역 탭이 기본 선택되어 열립니다.
            if (typeof openSettingsModal === 'function') {
                openSettingsModal();
            }
        };

        // ------------------------------------------------------------------
        // [유지하기 버튼] 클릭 이벤트
        // 모달을 닫고, 토스트 메시지를 표시합니다.
        // 영구 미표시 플래그를 저장합니다.
        // ------------------------------------------------------------------
        document.getElementById('zg-btn-dismiss').onclick = function () {
            popup.remove();
            localStorage.setItem(KEY_DISMISSED, 'true');
            showZoneGuideToast();
        };
    }

    // ========================================================================
    // [UI 함수] showZoneGuideToast()
    // "언제든 설정에서 해역을 변경할 수 있어요" 토스트 메시지를 3초간 표시합니다.
    // ========================================================================
    function showZoneGuideToast() {
        // 기존 토스트가 있으면 제거
        const existing = document.getElementById('zone-guide-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'zone-guide-toast';
        toast.textContent = '언제든 설정에서 해역을 변경할 수 있어요';
        toast.style.cssText = [
            'position: fixed',
            'bottom: 80px',
            'left: 50%',
            'transform: translateX(-50%) translateY(20px)',
            'background: rgba(30, 41, 59, 0.95)',
            'color: #e2e8f0',
            'padding: 12px 20px',
            'border-radius: 12px',
            'font-size: 0.85rem',
            'font-weight: 500',
            'z-index: 10200',
            'opacity: 0',
            'transition: opacity 0.3s ease, transform 0.3s ease',
            'box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3)',
            'border: 1px solid rgba(255, 255, 255, 0.1)',
            'text-align: center',
            'max-width: 90%'
        ].join(';');

        document.body.appendChild(toast);

        // 약간의 딜레이 후 나타남 (CSS 트랜지션이 동작하도록)
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                toast.style.opacity = '1';
                toast.style.transform = 'translateX(-50%) translateY(0)';
            });
        });

        // 3초 후 사라짐
        setTimeout(function () {
            toast.style.opacity = '0';
            toast.style.transform = 'translateX(-50%) translateY(20px)';
            setTimeout(function () {
                if (toast.parentNode) toast.remove();
            }, 300); // 트랜지션 완료 후 DOM 제거
        }, 3000);
    }

    // ========================================================================
    // [전역 노출] checkZoneGuide를 외부에서 호출할 수 있도록 window에 등록
    // admin_trigger.js의 closeNoticePopup() 및 checkNoticeStatus()에서 호출합니다.
    // ========================================================================
    window.checkZoneGuide = checkZoneGuide;

})();
