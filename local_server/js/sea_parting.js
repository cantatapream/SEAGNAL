/**
 * ============================================================================
 * 파일명: js/sea_parting.js
 * 역할: 바다갈라짐 시간 프론트엔드 전체 로직
 * ============================================================================
 *
 * [설명]
 * 이 파일은 바다갈라짐 시간 탭의 모든 프론트엔드 기능을 담당합니다.
 * - API 호출 → 데이터 파싱
 * - 드롭다운 지역 선택 (데이터가 있는 지역만 동적 생성)
 * - 즐겨찾기 기능 (1개만 가능, localStorage 저장, 별표 표시)
 * - 날짜별 테이블 렌더링 (같은 날 2구간 시간순 정렬, 소요시간 표시)
 * - 미발생 지역 안내 + 면책 문구
 * - fade 애니메이션으로 데이터 전환
 * - 체험지수란? 이미지 팝업 (로딩 스피너 포함)
 *
 * [연계 파일]
 * - index.html → #sea-parting-section 내 HTML 요소들
 * - style.css → .sp-* 클래스 스타일
 * - routes/fishing.js (서버) → GET /api/sea-split-index 데이터 제공
 * - js/marine.js → _onSectionActivated('sea-parting-section') 시 initSeaParting() 호출
 *
 * [데이터 구조] (서버 응답)
 * {
 *   updatedAt: '수집 시점',
 *   allPlaces: ['진도','무창포',...],  ← 14개 전체 지역 (데이터 유무 불문)
 *   places: {                          ← 데이터가 존재하는 지역만 포함
 *     '실미도': {
 *       lat, lot,
 *       forecasts: {
 *         '2026-04-01': [
 *           { bgng:'09:00', end:'15:25', minArtmp, maxArtmp, minWspd, maxWspd, weather, totalIndex },
 *           { bgng:'17:57', end:'18:00', ... }   ← 같은 날 2구간 가능
 *         ]
 *       }
 *     }
 *   }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    /** localStorage에 즐겨찾기 지역명을 저장하는 키 */
    const STORAGE_KEY = 'seaParting_favorite';

    /** 서버에서 받아온 전체 데이터 (초기화 후 유지) */
    let _data = null;

    /** 현재 드롭다운에서 선택된 지역명 */
    let _selectedPlace = null;

    /** 초기화 완료 여부 (중복 호출 방지) */
    let _initialized = false;

    /** 초기화 진행 중 여부 (동시 호출 방지) */
    let _initializing = false;

    /** 체험지수 등급별 배지 색상 (테이블 체험지수 셀에 사용) */
    const INDEX_COLORS = {
        '매우좋음': { bg: 'linear-gradient(135deg, #81D4FA, #1565C0)', color: '#fff', border: 'rgba(21,101,192,0.4)' },
        '좋음':     { bg: 'linear-gradient(135deg, #81C784, #2E7D32)', color: '#fff', border: 'rgba(46,125,50,0.4)' },
        '보통':     { bg: 'linear-gradient(135deg, #FFD54F, #F9A825)', color: '#333', border: 'rgba(249,168,37,0.4)' },
        '나쁨':     { bg: 'linear-gradient(135deg, #FFB74D, #E65100)', color: '#fff', border: 'rgba(230,81,0,0.4)' },
        '매우나쁨': { bg: 'linear-gradient(135deg, #EF9A9A, #C62828)', color: '#fff', border: 'rgba(198,40,40,0.4)' }
    };

    // ========================================================================
    // 초기화 (탭 활성화 시 marine.js에서 호출됨)
    // ========================================================================

    /**
     * 바다갈라짐 탭이 활성화되면 호출되는 진입점
     * - 서버에서 데이터를 가져옴
     * - 드롭다운을 생성하고 첫 지역을 자동 선택
     * - 이미 초기화된 경우 중복 실행하지 않음
     */
    window.initSeaParting = async function () {
        // 이미 초기화 완료 → 무시
        if (_initialized && _data) return;
        // 다른 호출이 진행 중 → 무시 (빠른 탭 전환 방지)
        if (_initializing) return;
        _initializing = true;

        try {
            // 서버에서 바다갈라짐 데이터 가져오기
            const res = await fetch((window.CONFIG ? CONFIG.API_BASE : '') + '/api/sea-split-index');
            if (!res.ok) throw new Error('API 응답 실패');
            _data = await res.json();
        } catch (e) {
            _initializing = false;
            _showEmptyState('바다갈라짐 데이터를 불러오지 못했습니다.');
            return;
        }

        _initialized = true;
        _initializing = false;

        // 드롭다운에 데이터가 있는 지역 목록 채우기
        _renderDropdown();

        // 하단 정보 영역 렌더링 (미발생 지역 안내 + 면책 문구)
        _renderFooterInfo();

        // 자동으로 첫 지역 선택 (즐겨찾기 > 첫 번째 지역)
        _autoSelectPlace();
    };

    // ========================================================================
    // 드롭다운 렌더링 (지역 선택)
    // ========================================================================

    /**
     * 데이터가 있는 지역만 드롭다운 옵션으로 생성
     * - allPlaces 순서를 기준으로 정렬
     * - 드롭다운 변경 이벤트 바인딩
     */
    function _renderDropdown() {
        var select = document.getElementById('sp-place-select');
        if (!select || !_data) return;

        var placesWithData = Object.keys(_data.places);
        if (placesWithData.length === 0) {
            _showEmptyState('현재 제공되는 바다갈라짐 데이터가 없습니다.');
            return;
        }

        // allPlaces 원본 순서 유지 (데이터가 있는 지역만 필터)
        var allPlaces = _data.allPlaces || [];
        var sorted = allPlaces.filter(function (n) { return placesWithData.includes(n); });
        // allPlaces에 없는 새 지역이 있으면 뒤에 추가
        placesWithData.forEach(function (n) {
            if (!sorted.includes(n)) sorted.push(n);
        });

        // 드롭다운 옵션 생성
        select.innerHTML = sorted.map(function (name) {
            return '<option value="' + name + '">' + name + '</option>';
        }).join('');

        // 드롭다운 변경 시 해당 지역 데이터 표시 (중복 등록 방지)
        if (!select._spBound) {
            select.addEventListener('change', function () {
                _selectPlace(select.value);
            });
            select._spBound = true;
        }

        // 드롭다운 영역 표시
        var selectorRow = document.getElementById('sp-selector-row');
        if (selectorRow) selectorRow.style.display = 'flex';
    }

    // ========================================================================
    // 자동 지역 선택 (첫 화면 진입 시)
    // ========================================================================

    /**
     * 첫 진입 시 자동으로 지역을 선택하는 로직
     * 우선순위: 즐겨찾기 지역 > 데이터가 있는 첫 번째 지역
     */
    function _autoSelectPlace() {
        var select = document.getElementById('sp-place-select');
        if (!select || select.options.length === 0) return;

        // 1순위: 즐겨찾기가 있고, 데이터도 있는 경우
        var fav = _getFavorite();
        if (fav && _data.places[fav]) {
            select.value = fav;
            _selectPlace(fav);
            return;
        }

        // 2순위: 드롭다운 첫 번째 지역
        var firstName = select.options[0].value;
        _selectPlace(firstName);
    }

    // ========================================================================
    // 지역 선택 처리
    // ========================================================================

    /**
     * 특정 지역이 선택되었을 때 실행되는 핵심 함수
     * - 드롭다운 값 동기화
     * - 발표시점 표시
     * - 즐겨찾기 별표 상태 갱신
     * - 데이터 테이블 렌더링 (fade 애니메이션)
     */
    function _selectPlace(placeName) {
        if (!_data || !_data.places[placeName]) return;

        _selectedPlace = placeName;

        // 드롭다운 값 동기화 (코드에서 호출할 때를 위해)
        var select = document.getElementById('sp-place-select');
        if (select && select.value !== placeName) select.value = placeName;

        // 발표시점 줄 표시 + 내용 갱신
        var publishRow = document.getElementById('sp-publish-row');
        var publishEl = document.getElementById('sp-publish-time');
        if (publishRow) publishRow.style.display = 'flex';
        if (publishEl) {
            publishEl.textContent = _data.updatedAt ? '발표 ' + _data.updatedAt : '발표: -';
        }

        // 즐겨찾기 별표 상태 갱신
        _updateFavoriteBtn();

        // 데이터 테이블을 fade 애니메이션과 함께 렌더링
        _renderDataWithAnimation(placeName);
    }

    // ========================================================================
    // 데이터 테이블 렌더링
    // ========================================================================

    /**
     * 지역 전환 시 fade-out → 내용 교체 → fade-in 애니메이션
     */
    function _renderDataWithAnimation(placeName) {
        var container = document.getElementById('sp-data-container');
        if (!container) return;

        // 200ms 동안 fade-out
        container.classList.add('sp-fade-out');

        setTimeout(function () {
            _renderData(placeName, container);
            container.classList.remove('sp-fade-out');
            container.classList.add('sp-fade-in');
            // 300ms 후 애니메이션 클래스 제거
            setTimeout(function () { container.classList.remove('sp-fade-in'); }, 300);
        }, 200);
    }

    /**
     * 선택된 지역의 날짜별 예보 데이터를 테이블로 렌더링
     * - 같은 날 여러 구간이 있으면 시작시간(bgng) 기준 오름차순 정렬
     * - 각 체험시간 아래에 소요시간(X시간 Y분) 표시
     * - 풍속 컬럼 제외
     */
    function _renderData(placeName, container) {
        var place = _data.places[placeName];
        if (!place || !place.forecasts) {
            container.innerHTML = '<div class="sp-no-data">해당 지역의 데이터가 없습니다.</div>';
            return;
        }

        // 날짜를 오름차순 정렬
        var dates = Object.keys(place.forecasts).sort();
        if (dates.length === 0) {
            container.innerHTML = '<div class="sp-no-data">해당 지역의 데이터가 없습니다.</div>';
            return;
        }

        // 테이블 헤더 (풍속 제외: 날짜, 체험시간, 기온, 날씨, 체험지수)
        var html = '<div class="sp-table-wrap"><table class="sp-table">';
        html += '<thead><tr><th>날짜</th><th>체험시간</th><th>기온</th><th>날씨</th><th>체험지수</th></tr></thead>';
        html += '<tbody>';

        dates.forEach(function (date) {
            var windows = place.forecasts[date];
            if (!windows || windows.length === 0) return;

            // ★ 같은 날 여러 구간이 있으면 시작시간(bgng) 기준 오름차순 정렬
            // 원본 배열을 보호하기 위해 복사본을 만들어 정렬
            var sortedWindows = windows.slice().sort(function (a, b) {
                return (a.bgng || '').localeCompare(b.bgng || '');
            });

            var formattedDate = _formatDate(date);
            var dayOfWeek = _getDayOfWeek(date);
            var isWeekend = dayOfWeek === '토' || dayOfWeek === '일';

            sortedWindows.forEach(function (w, idx) {
                if (!w) return; // null 방어

                var indexStyle = INDEX_COLORS[w.totalIndex] || { bg: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: 'rgba(255,255,255,0.1)' };
                var timeRange = (w.bgng && w.end) ? w.bgng + ' ~ ' + w.end : '-';
                var duration = (w.bgng && w.end) ? _calcDuration(w.bgng, w.end) : '';
                var temp = (w.minArtmp != null && w.maxArtmp != null) ? w.minArtmp + '~' + w.maxArtmp + '°C' : '-';
                var weather = w.weather || '-';

                html += '<tr>';

                // 날짜 셀: 같은 날 여러 구간이면 첫 번째 행에서만 rowspan으로 표시
                if (idx === 0) {
                    html += '<td class="sp-date-cell' + (isWeekend ? ' sp-weekend' : '') + '"' +
                        (sortedWindows.length > 1 ? ' rowspan="' + sortedWindows.length + '"' : '') + '>' +
                        '<div class="sp-date-main">' + formattedDate + '</div>' +
                        '<div class="sp-date-day' + (isWeekend ? ' sp-weekend' : '') + '">' + dayOfWeek + '</div>' +
                        '</td>';
                }

                // 체험시간 셀 + 소요시간
                html += '<td class="sp-time-cell">' + timeRange +
                    (duration ? '<span class="sp-duration">(' + duration + ')</span>' : '') +
                    '</td>';

                // 기온
                html += '<td>' + temp + '</td>';

                // 날씨 (아이콘 + 텍스트)
                html += '<td>' + _getWeatherIcon(weather) + ' ' + weather + '</td>';

                // 체험지수 배지
                html += '<td><span class="sp-index-badge" style="background:' + indexStyle.bg +
                    ';color:' + indexStyle.color + ';border:1px solid ' + indexStyle.border + ';">' +
                    (w.totalIndex || '-') + '</span></td>';

                html += '</tr>';
            });
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    // ========================================================================
    // 하단 정보 영역 (미발생 지역 안내 + 면책 문구)
    // ========================================================================

    /**
     * 테이블 아래에 미발생 지역 안내와 면책 문구를 렌더링
     * - allPlaces(전체 14개)에 있지만 places(데이터 있는 지역)에 없는 지역 = 미발생
     * - 예보 기간은 데이터에서 최소/최대 날짜로 자동 계산
     */
    function _renderFooterInfo() {
        var footer = document.getElementById('sp-footer-info');
        if (!footer || !_data) return;

        var html = '';

        // 미발생 지역 계산: 전체 목록 중 데이터가 없는 지역
        var allPlaces = _data.allPlaces || [];
        var dataPlaces = Object.keys(_data.places);
        var missing = allPlaces.filter(function (n) { return !dataPlaces.includes(n); });

        if (missing.length > 0) {
            // 예보 기간 계산 (전체 데이터에서 가장 이른 날짜 ~ 가장 늦은 날짜)
            var allDates = [];
            Object.keys(_data.places).forEach(function (name) {
                var forecasts = _data.places[name].forecasts;
                if (forecasts) {
                    Object.keys(forecasts).forEach(function (d) { allDates.push(d); });
                }
            });
            allDates.sort();
            var startDate = allDates.length > 0 ? _formatDateShort(allDates[0]) : '';
            var endDate = allDates.length > 0 ? _formatDateShort(allDates[allDates.length - 1]) : '';
            var period = (startDate && endDate) ? '(' + startDate + '~' + endDate + ') ' : '';

            html += '<div class="sp-missing-notice">';
            html += '<i class="fa-solid fa-triangle-exclamation"></i> ';
            html += '<strong>' + missing.join(', ') + '</strong> 지역은 예보 기간 ' + period + '동안 바다갈라짐이 발생하지 않습니다.';
            html += '</div>';
        }

        // 면책 문구 (국립해양조사원 공식 안내)
        html += '<div class="sp-disclaimer">';
        html += '<p><i class="fa-solid fa-circle-check"></i> 생활해양예보지수는 수치예측결과를 활용하여 만들어진 참고자료로서 실제와 다를 수 있으니 현장의 해양·기상 상황을 반드시 확인하시기 바랍니다. 따라서 서비스는 사용자의 책임하에 이용되어야하며, 그 정보의 정확성과 법적인 책임은 조사원 및 본 앱에 있지 아니함을 알려드립니다.</p>';
        html += '</div>';

        footer.innerHTML = html;
    }

    // ========================================================================
    // 즐겨찾기 (localStorage, 1개만 가능)
    // ========================================================================

    /** localStorage에서 즐겨찾기 지역명 읽기 */
    function _getFavorite() {
        try {
            return localStorage.getItem(STORAGE_KEY) || null;
        } catch (e) {
            return null;
        }
    }

    /** localStorage에 즐겨찾기 지역명 저장 (null이면 삭제) */
    function _setFavorite(placeName) {
        try {
            if (placeName) {
                localStorage.setItem(STORAGE_KEY, placeName);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) { /* 시크릿 모드 등 localStorage 사용 불가 시 무시 */ }
    }

    /** 별표 버튼의 아이콘과 active 상태를 현재 즐겨찾기에 맞게 갱신 */
    function _updateFavoriteBtn() {
        var btn = document.getElementById('sp-favorite-btn');
        if (!btn) return;

        var fav = _getFavorite();
        var isFav = _selectedPlace && _selectedPlace === fav;

        // 꽉 찬 별(즐겨찾기) / 빈 별(미설정)
        btn.innerHTML = isFav
            ? '<i class="fa-solid fa-star"></i>'
            : '<i class="fa-regular fa-star"></i>';
        btn.classList.toggle('active', isFav);
    }

    /**
     * 즐겨찾기 별표 클릭 이벤트
     * - 현재 선택된 지역이 이미 즐겨찾기면 → 해제
     * - 아니면 → 새로 설정 (기존 즐겨찾기 대체)
     */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#sp-favorite-btn');
        if (!btn || !_selectedPlace) return;

        var fav = _getFavorite();
        if (_selectedPlace === fav) {
            _setFavorite(null);    // 즐겨찾기 해제
        } else {
            _setFavorite(_selectedPlace);  // 새 즐겨찾기 설정
        }

        _updateFavoriteBtn();
    });

    // ========================================================================
    // 체험지수란? 이미지 팝업 (로딩 스피너 포함)
    // ========================================================================

    /**
     * "체험지수란?" 버튼 클릭 시 이미지 팝업을 표시
     * - 낚시 지수와 동일한 방식: 오버레이 + 팝업 + 이미지
     * - 이미지 로딩 중에는 스피너 표시, 로딩 완료 후 이미지로 교체
     */
    document.addEventListener('click', function (e) {
        var btn = e.target.closest('#sp-guide-btn');
        if (!btn) return;
        _openGuidePopup();
    });

    function _openGuidePopup() {
        // 기존 팝업이 열려있으면 닫기
        _closeGuidePopup();

        var imgSrc = '/images/sea_split_guide.png';
        var title = '바다갈라짐 체험지수란?';

        // 배경 오버레이 (클릭 시 닫기)
        var overlay = document.createElement('div');
        overlay.className = 'fishing-guide-overlay';
        overlay.id = 'sp-guide-overlay';
        overlay.addEventListener('click', function () { _closeGuidePopup(); });

        // 팝업 컨테이너
        var popup = document.createElement('div');
        popup.className = 'fishing-guide-popup';
        popup.id = 'sp-guide-popup';
        popup.addEventListener('click', function (e) { e.stopPropagation(); });

        // 헤더 (제목 + 닫기 버튼)
        var header = document.createElement('div');
        header.className = 'fishing-guide-popup-header';
        header.innerHTML = '<span>' + title + '</span>' +
            '<button class="fishing-guide-popup-close" id="sp-guide-close-btn"><i class="fa-solid fa-xmark"></i></button>';

        // 스크롤 가능한 이미지 영역 (처음엔 로딩 스피너 표시)
        var body = document.createElement('div');
        body.className = 'fishing-guide-popup-body';

        // 로딩 스피너
        var spinner = document.createElement('div');
        spinner.className = 'guide-popup-spinner';
        spinner.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        body.appendChild(spinner);

        // 이미지 (처음엔 숨김, 로딩 완료 시 표시)
        var img = document.createElement('img');
        img.src = imgSrc;
        img.alt = title;
        img.style.width = '100%';
        img.style.display = 'none';
        img.onload = function () {
            // 이미지 로딩 완료 → 스피너 숨기고 이미지 표시
            spinner.style.display = 'none';
            img.style.display = 'block';
        };
        img.onerror = function () {
            // 이미지 로딩 실패 → 스피너를 에러 메시지로 교체
            spinner.innerHTML = '<span style="color:#ef4444;font-size:0.8rem;">이미지를 불러올 수 없습니다.</span>';
        };
        body.appendChild(img);

        popup.appendChild(header);
        popup.appendChild(body);
        document.body.appendChild(overlay);
        document.body.appendChild(popup);

        // 닫기 버튼 이벤트
        document.getElementById('sp-guide-close-btn').addEventListener('click', function () {
            _closeGuidePopup();
        });

        // 뒤로가기 버튼 지원 (PopupStack 등록)
        if (window.PopupStack) {
            window.PopupStack.push('sp-guide-popup', function () {
                _closeGuidePopup();
            });
        }
    }

    /** 체험지수란? 팝업 닫기 */
    function _closeGuidePopup() {
        var overlay = document.getElementById('sp-guide-overlay');
        var popup = document.getElementById('sp-guide-popup');
        // 이미지 로딩 중 팝업 닫힐 때 핸들러 정리 (메모리 누수 방지)
        if (popup) {
            var img = popup.querySelector('img');
            if (img) { img.onload = null; img.onerror = null; }
            popup.remove();
        }
        if (overlay) overlay.remove();
        if (window.PopupStack) {
            window.PopupStack.remove('sp-guide-popup');
        }
    }

    // ========================================================================
    // 유틸리티 함수
    // ========================================================================

    /**
     * 체험시간의 소요시간을 계산
     * 예: '09:00', '15:25' → '6시간 25분'
     * 예: '17:57', '18:00' → '03분'
     */
    function _calcDuration(startStr, endStr) {
        var sParts = startStr.split(':');
        var eParts = endStr.split(':');
        if (sParts.length < 2 || eParts.length < 2) return ''; // 형식 오류 방어
        var startMin = parseInt(sParts[0], 10) * 60 + parseInt(sParts[1], 10);
        var endMin = parseInt(eParts[0], 10) * 60 + parseInt(eParts[1], 10);
        if (isNaN(startMin) || isNaN(endMin)) return ''; // 숫자 변환 실패 방어
        var diff = endMin - startMin;
        if (diff < 0) diff += 24 * 60; // 자정 넘김 대응 (23:00~01:00 등)
        if (diff <= 0) return '';

        var hours = Math.floor(diff / 60);
        var mins = diff % 60;

        if (hours > 0 && mins > 0) return hours + '시간 ' + mins + '분';
        if (hours > 0) return hours + '시간';
        if (mins > 0) return (mins < 10 ? '0' + mins : mins) + '분';
        return '';
    }

    /**
     * 날짜 문자열을 테이블 표시용으로 변환
     * '2026-04-01' → '04.01'
     */
    function _formatDate(dateStr) {
        var parts = dateStr.split('-');
        if (parts.length === 3) return parts[1] + '.' + parts[2];
        return dateStr;
    }

    /**
     * 날짜 문자열을 짧은 형식으로 변환 (미발생 안내 기간 표시용)
     * '2026-04-01' → '04/01'
     */
    function _formatDateShort(dateStr) {
        var parts = dateStr.split('-');
        if (parts.length === 3) return parts[1] + '/' + parts[2];
        return dateStr;
    }

    /**
     * 날짜 문자열에서 요일 구하기
     * '2026-04-01' → '수'
     */
    function _getDayOfWeek(dateStr) {
        var days = ['일', '월', '화', '수', '목', '금', '토'];
        var d = new Date(dateStr);
        return days[d.getDay()];
    }

    /**
     * 날씨 텍스트에 따라 아이콘 반환
     * '맑음' → 해 아이콘, '흐림' → 구름 아이콘 등
     */
    function _getWeatherIcon(weather) {
        if (!weather) return '';
        if (weather.indexOf('맑') >= 0) return '<i class="fa-solid fa-sun" style="color:#ffd54f;"></i>';
        if (weather.indexOf('구름') >= 0) return '<i class="fa-solid fa-cloud-sun" style="color:#90a4ae;"></i>';
        if (weather.indexOf('흐') >= 0) return '<i class="fa-solid fa-cloud" style="color:#78909c;"></i>';
        if (weather.indexOf('비') >= 0 || weather.indexOf('소나기') >= 0) return '<i class="fa-solid fa-cloud-rain" style="color:#42a5f5;"></i>';
        if (weather.indexOf('눈') >= 0) return '<i class="fa-solid fa-snowflake" style="color:#b3e5fc;"></i>';
        return '';
    }

    /**
     * 데이터가 없을 때 빈 상태 메시지 표시
     */
    function _showEmptyState(msg) {
        var container = document.getElementById('sp-data-container');
        if (container) {
            container.innerHTML = '<div class="sp-no-data"><i class="fa-solid fa-circle-info" style="margin-right:4px;"></i>' + msg + '</div>';
        }
    }

})();
