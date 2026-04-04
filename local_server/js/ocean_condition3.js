/**
 * ============================================================================
 * 파일명: js/ocean_condition3.js
 * 역할: 해황예보도 - 날짜/시간 버튼 생성 및 선택 제어
 * ============================================================================
 *
 * [설명]
 * API에서 받아온 데이터를 기반으로 날짜 버튼(7일)과 시간 버튼(8개)을
 * 동적으로 생성하고, 선택 상태를 관리합니다.
 *
 * [UI 구조]
 * ── 일시 선택 ──────────────────────────────────
 * │ 4/4(금) │ 4/5(토) │ 4/6(일) │ ... │ 4/10(목) │  ← 날짜 행
 * │ 00시│03시│06시│09시│12시│15시│18시│21시       │  ← 시간 행
 * ────────────────────────────────────────────────
 *
 * - 선택된 버튼: 파란색 배경 + 흰색 텍스트 (active 클래스)
 * - 데이터 없는 시간: 어둡게 + 클릭 불가 (disabled 클래스)
 *
 * [연계 파일]
 * - ocean_condition1.js → OceanForecast 전역 상태, OCEAN_DAY_NAMES 등
 * - ocean_condition2.js → loadOceanData() 완료 후 이 파일의 함수 호출
 * - ocean_condition4.js → 시간 선택 시 showOceanImage() 호출
 * ============================================================================
 */

// ============================================================================
// 날짜 버튼 생성
// ============================================================================

/**
 * 날짜 버튼 7개를 동적으로 생성하여 #ocean-forecast-date-btns에 삽입
 *
 * [동작]
 * 1. OceanForecast.dateMap에서 날짜 목록 추출 (예: ['20260404', '20260405', ...])
 * 2. 각 날짜에 대해 버튼 생성: "4/4(금)" 형태
 * 3. 클릭 시 selectOceanDate() 호출
 *
 * [호출 위치] ocean_condition2.js → loadOceanData() 완료 후
 */
window.buildOceanDateButtons = function () {
    const state = window.OceanForecast;
    const container = document.getElementById('ocean-forecast-date-btns');
    if (!container) return;

    container.innerHTML = ''; // 기존 버튼 초기화

    // dateMap의 키(날짜 문자열)를 정렬하여 배열로 변환
    const dates = Object.keys(state.dateMap).sort();

    for (const dateStr of dates) {
        // 날짜 문자열 파싱: '20260404' → year=2026, month=04, day=04
        const year = parseInt(dateStr.substring(0, 4));
        const month = parseInt(dateStr.substring(4, 6));
        const day = parseInt(dateStr.substring(6, 8));
        const dateObj = new Date(year, month - 1, day); // month는 0-indexed
        const dayName = OCEAN_DAY_NAMES[dateObj.getDay()]; // 요일 한글

        // 버튼 생성: "4/4(금)" 형태
        const btn = document.createElement('button');
        btn.className = 'ocean-forecast-date-btn';
        btn.dataset.date = dateStr; // 데이터 속성에 원본 날짜 저장
        btn.innerHTML = '<span class="date-num">' + month + '/' + day + '</span>' +
                         '<span class="date-day">(' + dayName + ')</span>';

        // 클릭 이벤트: 이 날짜를 선택
        btn.addEventListener('click', function () {
            window.selectOceanDate(dateStr);
        });

        container.appendChild(btn);
    }
};

// ============================================================================
// 날짜 선택 처리
// ============================================================================

/**
 * 특정 날짜를 선택하고 시간 버튼을 갱신
 *
 * [동작]
 * 1. 모든 날짜 버튼에서 active 제거 → 선택된 버튼에 active 추가
 * 2. 해당 날짜의 시간 버튼 생성 (buildOceanTimeButtons)
 * 3. 오늘 날짜면 현재 시각 기준 가장 가까운 시간 자동 선택
 *    다른 날짜면 가장 빠른 활성 시간 자동 선택
 *
 * @param {string} dateStr - 선택할 날짜 (예: '20260404')
 * @param {string} [preferTime] - 선호 시간 (지정 시 해당 시간 우선 선택)
 *
 * [호출 위치]
 * - 날짜 버튼 클릭 이벤트
 * - autoSelectOceanTime() (초기 자동 선택)
 */
window.selectOceanDate = function (dateStr, preferTime) {
    const state = window.OceanForecast;
    state.selectedDate = dateStr;

    // 날짜 버튼 active 상태 갱신
    const dateBtns = document.querySelectorAll('.ocean-forecast-date-btn');
    dateBtns.forEach(function (btn) {
        if (btn.dataset.date === dateStr) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 해당 날짜의 시간 버튼 생성
    buildOceanTimeButtons(dateStr);

    // 시간 자동 선택
    if (preferTime && state.dateMap[dateStr] && state.dateMap[dateStr].includes(preferTime)) {
        // 지정된 선호 시간이 있고 데이터가 존재하면 해당 시간 선택
        window.selectOceanTime(preferTime);
    } else {
        // 자동 선택: 가장 빠른 활성 시간
        var availableTimes = state.dateMap[dateStr] || [];
        if (availableTimes.length > 0) {
            window.selectOceanTime(availableTimes[0]);
        }
    }
};

// ============================================================================
// 시간 버튼 생성
// ============================================================================

/**
 * 특정 날짜에 대한 시간 버튼 8개를 생성
 *
 * [동작]
 * 1. 고정 8개 시간대 (00, 03, 06, 09, 12, 15, 18, 21) 버튼 생성
 * 2. 해당 날짜에 데이터가 있는 시간 → 활성 (클릭 가능)
 * 3. 데이터 없는 시간 → 비활성 (어둡게 + 클릭 불가)
 *
 * @param {string} dateStr - 날짜 (예: '20260404')
 *
 * [호출 위치] selectOceanDate() 내부
 */
function buildOceanTimeButtons(dateStr) {
    var state = window.OceanForecast;
    var container = document.getElementById('ocean-forecast-time-btns');
    if (!container) return;

    container.innerHTML = ''; // 기존 버튼 초기화

    // 해당 날짜에서 데이터가 존재하는 시간 목록
    var availableTimes = state.dateMap[dateStr] || [];

    // 8개 고정 시간대에 대해 버튼 생성
    for (var i = 0; i < OCEAN_TIME_SLOTS.length; i++) {
        var time = OCEAN_TIME_SLOTS[i];
        var hasData = availableTimes.indexOf(time) !== -1;

        var btn = document.createElement('button');
        btn.className = 'ocean-forecast-time-btn';
        btn.dataset.time = time;
        btn.textContent = time + '시';

        if (hasData) {
            // 데이터 있음 → 클릭 가능
            (function (t) {
                btn.addEventListener('click', function () {
                    window.selectOceanTime(t);
                });
            })(time);
        } else {
            // 데이터 없음 → 비활성화 (어둡게, 클릭 불가)
            btn.classList.add('disabled');
            btn.disabled = true;
        }

        container.appendChild(btn);
    }
}

// ============================================================================
// 시간 선택 처리
// ============================================================================

/**
 * 특정 시간을 선택하고 이미지를 표출
 *
 * [동작]
 * 1. 모든 시간 버튼에서 active 제거 → 선택된 버튼에 active 추가
 * 2. 선택된 날짜+시간에 해당하는 이미지 표출 (ocean_condition4.js)
 *
 * @param {string} time - 선택할 시간 (예: '09', '12')
 *
 * [호출 위치]
 * - 시간 버튼 클릭 이벤트
 * - selectOceanDate() (자동 선택)
 * - autoSelectOceanTime() (초기 자동 선택)
 */
window.selectOceanTime = function (time) {
    var state = window.OceanForecast;
    state.selectedTime = time;

    // 시간 버튼 active 상태 갱신
    var timeBtns = document.querySelectorAll('.ocean-forecast-time-btn');
    timeBtns.forEach(function (btn) {
        if (btn.dataset.time === time) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // 이미지 표출 (ocean_condition4.js)
    window.showOceanImage();
};

// ============================================================================
// 자동 시간 선택 (초기 진입 시)
// ============================================================================

/**
 * 현재 시각을 기준으로 가장 가까운 다가올 예보 시간을 자동 선택
 *
 * [로직]
 * - 현재 10:30 → 12시 선택 (다음 3시간 단위)
 * - 현재 15:00 → 15시 선택 (정각이면 해당 시간)
 * - 현재 22:00 → 다음날 00시 선택 (오늘에 없으면 다음날로 이동)
 *
 * [호출 위치] ocean_condition2.js → loadOceanData() 완료 후
 */
window.autoSelectOceanTime = function () {
    var state = window.OceanForecast;
    var dates = Object.keys(state.dateMap).sort();
    if (dates.length === 0) return;

    // 현재 KST 시각 계산
    var now = new Date();
    var kstOffset = 9 * 60 * 60 * 1000; // UTC+9
    var utcMs = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
    var kstDate = new Date(utcMs + kstOffset);
    var currentHour = kstDate.getHours();

    // 현재 날짜를 YYYYMMDD 형식으로
    var todayStr = String(kstDate.getFullYear()) +
        String(kstDate.getMonth() + 1).padStart(2, '0') +
        String(kstDate.getDate()).padStart(2, '0');

    // 현재 시각에서 가장 가까운 다가올 3시간 단위 시간 계산
    // 예: 10시 → 12시, 15시 → 15시, 22시 → 24(=다음날 00)
    var nextSlotHour = Math.ceil(currentHour / 3) * 3;
    // 정각이면 해당 시간 그대로 (예: 15시 → 15시)
    if (currentHour % 3 === 0) {
        nextSlotHour = currentHour;
    }

    // 24시 이상이면 다음날 00시
    if (nextSlotHour >= 24) {
        // 다음날 00시를 찾아야 함
        var todayIdx = dates.indexOf(todayStr);
        if (todayIdx >= 0 && todayIdx + 1 < dates.length) {
            var nextDate = dates[todayIdx + 1];
            window.selectOceanDate(nextDate, '00');
            return;
        }
        // 다음날 데이터가 없으면 오늘 마지막 시간대
        if (state.dateMap[todayStr]) {
            var todayTimes = state.dateMap[todayStr];
            window.selectOceanDate(todayStr, todayTimes[todayTimes.length - 1]);
            return;
        }
    }

    var targetTime = String(nextSlotHour).padStart(2, '0');

    // 오늘 날짜에 해당 시간대 데이터가 있는지 확인
    if (state.dateMap[todayStr] && state.dateMap[todayStr].indexOf(targetTime) !== -1) {
        window.selectOceanDate(todayStr, targetTime);
        return;
    }

    // 오늘 날짜에 해당 시간이 없으면 → 오늘의 가장 가까운 이후 시간 찾기
    if (state.dateMap[todayStr]) {
        var todayTimes2 = state.dateMap[todayStr];
        for (var i = 0; i < todayTimes2.length; i++) {
            if (parseInt(todayTimes2[i]) >= nextSlotHour) {
                window.selectOceanDate(todayStr, todayTimes2[i]);
                return;
            }
        }
        // 이후 시간이 없으면 다음날로
        var todayIdx2 = dates.indexOf(todayStr);
        if (todayIdx2 >= 0 && todayIdx2 + 1 < dates.length) {
            window.selectOceanDate(dates[todayIdx2 + 1]);
            return;
        }
    }

    // 오늘 데이터 자체가 없으면 → 첫 번째 날짜의 첫 시간 선택
    window.selectOceanDate(dates[0]);
};
