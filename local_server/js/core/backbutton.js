/**
 * ============================================================================
 * 파일명: js/backbutton.js
 * 역할: 하드웨어 뒤로가기 버튼 처리 + 팝업 스택 관리
 * ============================================================================
 *
 * [설명]
 * - 모바일 하드웨어 뒤로가기 버튼 이벤트를 캡처하여 처리
 * - 팝업 스택(LIFO)을 관리하여 뒤로가기 시 마지막 팝업부터 닫기
 * - 팝업이 없을 때 뒤로가기 2번 연속 누르면 앱 종료
 * - 기존 팝업 open/close 함수를 래핑하여 자동으로 스택에 등록/해제
 *
 * [로딩 순서] app_init.js 이후 (모든 팝업 함수가 등록된 후)
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 팝업 스택 관리자
    // ========================================================================
    var popupStack = [];

    /**
     * 팝업을 스택에 등록
     * @param {string} id - 팝업 고유 식별자
     * @param {Function} closeFn - 팝업을 닫는 함수
     */
    window.PopupStack = {
        push: function (id, closeFn) {
            // 중복 등록 방지
            for (var i = 0; i < popupStack.length; i++) {
                if (popupStack[i].id === id) return;
            }
            popupStack.push({ id: id, close: closeFn });
        },

        remove: function (id) {
            popupStack = popupStack.filter(function (item) {
                return item.id !== id;
            });
        },

        popLast: function () {
            if (popupStack.length === 0) return false;
            var last = popupStack.pop();
            try {
                last.close();
            } catch (e) {
                console.warn('[BackButton] 팝업 닫기 실패:', last.id, e);
            }
            return true;
        },

        isEmpty: function () {
            return popupStack.length === 0;
        },

        size: function () {
            return popupStack.length;
        },

        // 디버깅용
        list: function () {
            return popupStack.map(function (item) { return item.id; });
        }
    };

    // ========================================================================
    // 기존 팝업 함수 래핑 (자동 스택 등록/해제)
    // ========================================================================

    /**
     * 1. 설정 모달 (settings.js)
     *    open: openSettingsModal() → modal.classList.remove('hidden')
     *    close: closeSettingsModal() → modal.classList.add('hidden')
     */
    function wrapSettingsModal() {
        var origOpen = window.openSettingsModal;
        var origClose = window.closeSettingsModal;
        if (!origOpen || !origClose) return;

        window.openSettingsModal = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('settings-modal', function () {
                window.closeSettingsModal();
            });
        };

        window.closeSettingsModal = function () {
            PopupStack.remove('settings-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 2. KMA iframe 모달 (ui_modal.js)
     */
    function wrapKmaIframeModal() {
        var origOpen = window.openKmaIframeModal;
        var origClose = window.closeKmaIframeModal;
        if (!origOpen || !origClose) return;

        window.openKmaIframeModal = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('kma-iframe-modal', function () {
                window.closeKmaIframeModal();
            });
        };

        window.closeKmaIframeModal = function () {
            PopupStack.remove('kma-iframe-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 3. SEAGNAL 시스템 모달 (ui_modal.js)
     */
    function wrapSeagnalModal() {
        var origOpen = window.showSeagnalModal;
        var origClose = window.closeSeagnalModal;
        if (!origOpen || !origClose) return;

        window.showSeagnalModal = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('seagnal-custom-modal', function () {
                window.closeSeagnalModal();
            });
        };

        window.closeSeagnalModal = function () {
            PopupStack.remove('seagnal-custom-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 4. 특보 히스토리 팝업 (alert_history.js)
     */
    function wrapAlertHistoryPopup() {
        var origOpen = window.showAlertHistoryPopup;
        var origClose = window.closeAlertHistoryPopup;
        if (!origOpen || !origClose) return;

        window.showAlertHistoryPopup = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('alert-history-modal', function () {
                window.closeAlertHistoryPopup();
            });
        };

        window.closeAlertHistoryPopup = function () {
            PopupStack.remove('alert-history-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 5. Windy 팝업 (windy.js)
     */
    function wrapWindyPopup() {
        var origOpen = window.showWindyPopup;
        var origClose = window.closeWindyPopup;
        if (!origOpen || !origClose) return;

        window.showWindyPopup = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('windy-modal', function () {
                window.closeWindyPopup();
            });
        };

        window.closeWindyPopup = function () {
            PopupStack.remove('windy-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 6. 해구별 기상정보 이용안내 팝업 (forecast.js)
     */
    function wrapSeaZoneInfoPopup() {
        var origOpen = window.showSeaZoneInfoPopup;
        var origClose = window.closeSeaZoneInfoPopup;
        if (!origOpen || !origClose) return;

        window.showSeaZoneInfoPopup = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('sea-zone-info-modal', function () {
                window.closeSeaZoneInfoPopup();
            });
        };

        window.closeSeaZoneInfoPopup = function () {
            PopupStack.remove('sea-zone-info-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 7. 조석 즐겨찾기 모달 (tide.js)
     */
    function wrapTideFavModal() {
        var origOpen = window.openTideFavModal;
        var origClose = window.closeTideFavModal;
        if (!origOpen || !origClose) return;

        window.openTideFavModal = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('tide-fav-modal', function () {
                window.closeTideFavModal();
            });
        };

        window.closeTideFavModal = function () {
            PopupStack.remove('tide-fav-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 8. 홍보 상세 모달 (promo.js)
     */
    function wrapPromoDetailModal() {
        var origOpen = window.openPromoDetail;
        var origClose = window.closePromoDetail;
        if (!origOpen || !origClose) return;

        window.openPromoDetail = function () {
            origOpen.apply(this, arguments);
            PopupStack.push('promo-detail-modal', function () {
                window.closePromoDetail();
            });
        };

        window.closePromoDetail = function () {
            PopupStack.remove('promo-detail-modal');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 9. 공지 팝업 (admin_trigger.js)
     */
    function wrapNoticePopup() {
        var origClose = window.closeNoticePopup;
        if (!origClose) return;

        // showNoticePopup은 로컬 함수이므로 DOM 감시로 등록
        var noticeObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'main-notice-popup' || (node.querySelector && node.querySelector('#main-notice-popup'))) {
                        PopupStack.push('main-notice-popup', function () {
                            // closeNoticePopup은 noticeId 인자가 필요
                            var popup = document.getElementById('main-notice-popup');
                            if (popup) popup.remove();
                        });
                    }
                });
            });
        });
        noticeObserver.observe(document.body, { childList: true });

        window.closeNoticePopup = function () {
            PopupStack.remove('main-notice-popup');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 10. 경보 상세 팝업 (fix_popup_logic.js)
     */
    function wrapAlertDetailPopup() {
        if (!window.AlertDetailPopup) return;

        var origShow = window.AlertDetailPopup.show;
        var origClose = window.AlertDetailPopup.close;
        if (!origShow || !origClose) return;

        window.AlertDetailPopup.show = function () {
            origShow.apply(this, arguments);
            // show 내부에서 suppressSafetyPopup 체크로 실제 표시 안 될 수 있음
            var popup = document.getElementById('alert-detail-popup');
            if (popup) {
                PopupStack.push('alert-detail-popup', function () {
                    window.AlertDetailPopup.close();
                });
            }
        };

        window.AlertDetailPopup.close = function () {
            PopupStack.remove('alert-detail-popup');
            origClose.apply(this, arguments);
        };
    }

    /**
     * 11. 제보 모달 (report_user.js)
     *     닫기가 inline onclick으로 document.getElementById('report-modal').remove()
     */
    function wrapReportModal() {
        var origOpen = window.openReportModal;
        if (!origOpen) return;

        window.openReportModal = function () {
            origOpen.apply(this, arguments);
            var modal = document.getElementById('report-modal');
            if (modal) {
                PopupStack.push('report-modal', function () {
                    var m = document.getElementById('report-modal');
                    if (m) m.remove();
                });
            }
        };

        // report-modal은 inline onclick으로 .remove()가 호출되므로 DOM 감시로 제거 감지
        var reportObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'report-modal') {
                        PopupStack.remove('report-modal');
                    }
                });
            });
        });
        reportObserver.observe(document.body, { childList: true });
    }

    /**
     * 12. 설문 팝업 (survey_user.js)
     *     IIFE 내부 함수이므로 DOM 감시로 등록/해제
     */
    function wrapSurveyPopup() {
        var surveyObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'survey-user-popup') {
                        PopupStack.push('survey-user-popup', function () {
                            var popup = document.getElementById('survey-user-popup');
                            if (popup) popup.remove();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'survey-user-popup') {
                        PopupStack.remove('survey-user-popup');
                    }
                });
            });
        });
        surveyObserver.observe(document.body, { childList: true });
    }

    /**
     * 13. 해역별 기상 예보 테이블 모달 (forecast.js)
     *     closeModal이 로컬 함수이므로 DOM 감시로 처리
     */
    function wrapSeaForecastModal() {
        var origOpen = window.showSeaForecastTable;
        if (!origOpen) return;

        window.showSeaForecastTable = function () {
            origOpen.apply(this, arguments);
            var modal = document.getElementById('sea-forecast-modal');
            if (modal) {
                PopupStack.push('sea-forecast-modal', function () {
                    var m = document.getElementById('sea-forecast-modal');
                    if (m) {
                        m.style.background = 'rgba(0, 0, 0, 0)';
                        var content = m.querySelector('.forecast-modal-content');
                        if (content) {
                            content.style.transform = 'scale(0.9) translateY(20px)';
                            content.style.opacity = '0';
                        }
                        setTimeout(function () { m.remove(); }, 300);
                    }
                });
            }
        };

        // DOM 제거 감시
        var forecastObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'sea-forecast-modal') {
                        PopupStack.remove('sea-forecast-modal');
                    }
                });
            });
        });
        forecastObserver.observe(document.body, { childList: true });
    }

    /**
     * 14. 제보 답변 팝업 (report_user.js)
     *     DOM 감시로 처리
     */
    function wrapReportAnswerPopup() {
        var reportAnswerObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'report-answer-popup' || (node.querySelector && node.querySelector('#report-answer-popup'))) {
                        PopupStack.push('report-answer-popup', function () {
                            var popup = document.getElementById('report-answer-popup');
                            if (popup) popup.remove();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'report-answer-popup') {
                        PopupStack.remove('report-answer-popup');
                    }
                });
            });
        });
        reportAnswerObserver.observe(document.body, { childList: true });
    }

    /**
     * 15. 앱 업데이트 팝업 (capacitor-plugins.js)
     *     DOM 감시로 처리 (type="module"이라 로딩 순서가 다름)
     */
    function wrapAppUpdatePopup() {
        var updateObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'app-update-overlay') {
                        PopupStack.push('app-update-overlay', function () {
                            var popup = document.getElementById('app-update-overlay');
                            if (popup) popup.remove();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'app-update-overlay') {
                        PopupStack.remove('app-update-overlay');
                    }
                });
            });
        });
        updateObserver.observe(document.body, { childList: true });
    }

    /**
     * 16. 서버 점검/네트워크 오류 팝업 (admin_trigger.js)
     */
    function wrapMaintenancePopup() {
        var maintObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'server-maintenance-popup') {
                        PopupStack.push('server-maintenance-popup', function () {
                            var popup = document.getElementById('server-maintenance-popup');
                            if (popup) { popup.remove(); window.location.reload(); }
                        });
                    }
                    if (node.id === 'network-error-popup') {
                        PopupStack.push('network-error-popup', function () {
                            var popup = document.getElementById('network-error-popup');
                            if (popup) { popup.remove(); window.location.reload(); }
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'server-maintenance-popup') {
                        PopupStack.remove('server-maintenance-popup');
                    }
                    if (node.id === 'network-error-popup') {
                        PopupStack.remove('network-error-popup');
                    }
                });
            });
        });
        maintObserver.observe(document.body, { childList: true });
    }

    /**
     * 17. 해구별 기상정보 모달 (marine.js)
     *     closeSeaZoneModal이 전역 함수이므로 래핑 + DOM 감시로 처리
     */
    function wrapSeaZoneModal() {
        var origClose = window.closeSeaZoneModal;
        if (!origClose) return;

        window.closeSeaZoneModal = function () {
            PopupStack.remove('sea-zone-modal');
            origClose.apply(this, arguments);
        };

        // showMarineZoneModal은 로컬 함수이므로 DOM 감시로 등록
        var seaZoneObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'sea-zone-modal') {
                        PopupStack.push('sea-zone-modal', function () {
                            window.closeSeaZoneModal();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'sea-zone-modal') {
                        PopupStack.remove('sea-zone-modal');
                    }
                });
            });
        });
        seaZoneObserver.observe(document.body, { childList: true });
    }

    /**
     * 18. 해구별 Windy 팝업 (marine.js - openZoneWindy)
     *     zone-windy-modal은 windy.js의 windy-modal과 별개
     */
    function wrapZoneWindyPopup() {
        var origClose = window.closeZoneWindyPopup;
        if (!origClose) return;

        window.closeZoneWindyPopup = function () {
            PopupStack.remove('zone-windy-modal');
            origClose.apply(this, arguments);
        };

        // DOM 감시로 등록/해제
        var zoneWindyObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'zone-windy-modal') {
                        PopupStack.push('zone-windy-modal', function () {
                            window.closeZoneWindyPopup();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'zone-windy-modal') {
                        PopupStack.remove('zone-windy-modal');
                    }
                });
            });
        });
        zoneWindyObserver.observe(document.body, { childList: true });
    }

    /**
     * 19. 연안기상 이미지 모달 (render_coastal.js)
     *     showImageModal은 로컬 함수이므로 DOM 감시로 처리
     */
    function wrapImageModal() {
        var imageModalObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'image-modal-overlay') {
                        PopupStack.push('image-modal-overlay', function () {
                            var overlay = document.getElementById('image-modal-overlay');
                            if (overlay) overlay.remove();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'image-modal-overlay') {
                        PopupStack.remove('image-modal-overlay');
                    }
                });
            });
        });
        imageModalObserver.observe(document.body, { childList: true });
    }

    /**
     * 20. 부이 정보 모달 (seaZones.js)
     *     buoy-info-modal + buoy-modal-backdrop 함께 제거
     */
    function wrapBuoyInfoModal() {
        var buoyObserver = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.id === 'buoy-info-modal') {
                        PopupStack.push('buoy-info-modal', function () {
                            var modal = document.getElementById('buoy-info-modal');
                            if (modal) modal.remove();
                            var backdrop = document.getElementById('buoy-modal-backdrop');
                            if (backdrop) backdrop.remove();
                        });
                    }
                });
                mutation.removedNodes.forEach(function (node) {
                    if (node.id === 'buoy-info-modal') {
                        PopupStack.remove('buoy-info-modal');
                    }
                });
            });
        });
        buoyObserver.observe(document.body, { childList: true });
    }



    // ========================================================================
    // 뒤로가기 토스트 및 앱 종료 로직
    // ========================================================================
    var lastBackPressTime = 0;
    var BACK_PRESS_INTERVAL = 2500; // 2.5초 이내에 다시 누르면 종료
    var toastTimer = null;

    /**
     * "한 번 더 누르면 종료" 안내 토스트를 화면에 표시.
     * 이미 표시된 토스트는 제거 후 새로 만듦. 일정 시간 후 자동 제거.
     *
     * [호출 시점] 뒤로가기 버튼이 1단계 종료 직전 상태에서 눌렸을 때.
     */
    function showExitToast() {
        // 기존 토스트가 있으면 제거
        var existing = document.getElementById('back-exit-toast');
        if (existing) existing.remove();

        var toast = document.createElement('div');
        toast.id = 'back-exit-toast';
        toast.textContent = '한번 더 누르면 종료됩니다';
        document.body.appendChild(toast);

        // 표시 애니메이션
        requestAnimationFrame(function () {
            toast.classList.add('show');
        });

        // 자동 제거
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toast.classList.remove('show');
            setTimeout(function () {
                if (toast.parentNode) toast.remove();
            }, 300);
        }, BACK_PRESS_INTERVAL);
    }

    // ========================================================================
    // 뒤로가기 공통 처리 로직
    // ========================================================================
    function handleBackPress(exitAppFn) {
        // 1. 팝업 스택에 팝업이 있으면 마지막 팝업 닫기
        if (!PopupStack.isEmpty()) {
            PopupStack.popLast();
            return;
        }

        // 2. 팝업이 없으면 종료 로직
        var now = Date.now();
        if (now - lastBackPressTime < BACK_PRESS_INTERVAL) {
            // 연속 뒤로가기 → 앱 종료
            exitAppFn();
        } else {
            // 첫 번째 뒤로가기 → 토스트 표시
            lastBackPressTime = now;
            showExitToast();
        }
    }

    // ========================================================================
    // Capacitor 뒤로가기 이벤트 리스너 (Capacitor 네이티브 환경)
    // ========================================================================
    var backButtonRegistered = false;

    function registerBackButtonListener(AppPlugin) {
        if (backButtonRegistered) return true;
        if (!AppPlugin || !AppPlugin.addListener) return false;

        AppPlugin.addListener('backButton', function () {
            handleBackPress(function () {
                AppPlugin.exitApp();
            });
        });

        backButtonRegistered = true;
        console.log('[BackButton] Capacitor 뒤로가기 핸들러 등록 완료');
        return true;
    }

    /**
     * Capacitor 네이티브 환경에서 뒤로가기 버튼 핸들러 초기화.
     * 웹 환경에서는 false 반환하여 fallback (initHistoryTrapBackButton).
     *
     * [동작] App.addListener('backButton', ...) 으로 Android 하드웨어 뒤로가기를 가로채
     *  모달/시트/홈 으로 단계적 이동. 더 이상 갈 곳 없으면 토스트 → 한번 더 누르면 종료.
     */
    function initCapacitorBackButton() {
        if (!window.Capacitor || !window.Capacitor.isNativePlatform()) return false;

        // 방법 1: window.Capacitor.Plugins.App 직접 접근
        if (window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
            if (registerBackButtonListener(window.Capacitor.Plugins.App)) return true;
        }

        // 방법 2: 동적 import 시도 (모듈 로딩이 완료된 경우)
        try {
            import('@capacitor/app').then(function (module) {
                var App = module.App;
                if (registerBackButtonListener(App)) {
                    console.log('[BackButton] dynamic import 방식으로 등록 성공');
                }
            }).catch(function () {
                console.warn('[BackButton] dynamic import 실패, 폴링 시작');
            });
        } catch (e) {
            // import()를 지원하지 않는 환경
        }

        // 방법 3: 플러그인이 늦게 등록될 수 있으므로 폴링으로 재시도
        var retryCount = 0;
        var maxRetries = 20;
        var retryInterval = setInterval(function () {
            retryCount++;
            if (backButtonRegistered) {
                clearInterval(retryInterval);
                return;
            }
            if (window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
                if (registerBackButtonListener(window.Capacitor.Plugins.App)) {
                    clearInterval(retryInterval);
                    console.log('[BackButton] 폴링 방식으로 등록 성공 (' + retryCount + '번째 시도)');
                }
            }
            if (retryCount >= maxRetries) {
                clearInterval(retryInterval);
                if (!backButtonRegistered) {
                    console.error('[BackButton] Capacitor App 플러그인 등록 실패 (최대 재시도 초과)');
                }
            }
        }, 500);

        // 일단 true 반환 (재시도 진행 중이므로 History API 폴백 방지)
        return true;
    }

    // ========================================================================
    // History API 트랩 (TWA 환경)
    // ========================================================================
    var HISTORY_TRAP_STATE = { seagnalTrap: true };

    function pushHistoryTrap() {
        // 현재 상태가 이미 트랩이면 중복 push 방지
        if (history.state && history.state.seagnalTrap) return;
        history.pushState(HISTORY_TRAP_STATE, '');
    }

    /**
     * 웹 환경(브라우저 / Capacitor 미사용) 용 뒤로가기 핸들러 초기화.
     * history.pushState 를 미리 1번 push 해서 사용자가 뒤로 누르면 popstate
     * 이벤트로 가로채는 방식. Capacitor 가 없을 때만 사용.
     */
    function initHistoryTrapBackButton() {
        // 히스토리 트랩 설치
        pushHistoryTrap();

        window.addEventListener('popstate', function (e) {
            // 트랩 상태가 pop 되었으면 → 뒤로가기 발생
            // 즉시 트랩을 다시 설치하여 다음 뒤로가기도 잡을 수 있도록
            pushHistoryTrap();

            handleBackPress(function () {
                // TWA에서는 App.exitApp()이 없으므로
                // 히스토리 트랩을 제거하고 실제 뒤로가기를 허용하여 앱 종료
                history.back();
            });
        });

        console.log('[BackButton] History API 트랩 뒤로가기 핸들러 등록 완료');
    }

    // ========================================================================
    // 초기화
    // ========================================================================
    function init() {
        // 모든 팝업 함수 래핑
        wrapSettingsModal();
        wrapKmaIframeModal();
        wrapSeagnalModal();
        wrapAlertHistoryPopup();
        wrapWindyPopup();
        wrapSeaZoneInfoPopup();
        wrapTideFavModal();
        wrapPromoDetailModal();
        wrapNoticePopup();
        wrapAlertDetailPopup();
        wrapReportModal();
        wrapSurveyPopup();
        wrapSeaForecastModal();
        wrapReportAnswerPopup();
        wrapAppUpdatePopup();
        wrapMaintenancePopup();
        wrapSeaZoneModal();
        wrapZoneWindyPopup();
        wrapImageModal();
        wrapBuoyInfoModal();


        // 뒤로가기 핸들러 초기화
        // Capacitor 네이티브 환경이면 Capacitor 방식, 아니면 History API 트랩 방식
        var isCapacitor = initCapacitorBackButton();
        if (!isCapacitor) {
            initHistoryTrapBackButton();
        }

        console.log('[BackButton] 팝업 스택 관리자 초기화 완료');
    }

    // DOM 준비 후 초기화
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
