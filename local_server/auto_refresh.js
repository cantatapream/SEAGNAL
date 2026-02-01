/**
 * Auto Refresh & Tab Sync Logic
 * - 탭 전환 시 데이터 강제 갱신
 * - 1분 주기 백그라운드 데이터 갱신
 */
(function () {
    // 1. 주기적 갱신 (5분)
    setInterval(() => {
        if (typeof fetchAllData === 'function') {
            console.log('[AutoRefresh] 백그라운드 데이터 갱신 수행 (5분 주기)');
            fetchAllData();
        }
    }, 300 * 1000);

    // 2. 탭 전환 시 갱신
    document.addEventListener('DOMContentLoaded', () => {
        const tabs = document.querySelectorAll('.nav-btn');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                // 약간의 지연 후 갱신 (탭 전환 애니메이션 고려)
                setTimeout(() => {
                    if (typeof fetchAllData === 'function') {
                        console.log('[AutoRefresh] 탭 전환 감지 -> 데이터 갱신');
                        fetchAllData();
                    }

                    // 기상정보 탭일 경우, 예보 데이터도 갱신 시도
                    if (tab.dataset.target === 'weather-section') {
                        // 만약 fetchWeatherForecast 함수가 있다면 호출
                        if (typeof fetchWeatherForecast === 'function') {
                            fetchWeatherForecast();
                        }
                    }
                }, 100);
            });
        });

        // 페이지 가시성 변경 시 (앱이 백그라운드에서 깨어날 때) 갱신
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                console.log('[AutoRefresh] 앱 활성화(Foreground) -> 데이터 갱신');
                if (typeof fetchAllData === 'function') fetchAllData();
            }
        });
    });
})();
