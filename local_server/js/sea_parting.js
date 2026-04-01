/**
 * ============================================================================
 * 파일명: js/sea_parting.js
 * 역할: 바다갈라짐 체험지수 프론트엔드 전체 로직
 * ============================================================================
 *
 * [설명]
 * 이 파일은 바다갈라짐 체험지수 탭의 모든 프론트엔드 기능을 담당합니다.
 * - API fetch → 데이터 파싱
 * - 동적 지역 버튼 생성 (데이터 있는 지점만)
 * - 즐겨찾기 기능 (1개만, localStorage, 별표 표시, 버튼 우선 배치)
 * - 날짜별 테이블 렌더링 (같은 날 2구간 지원)
 * - fade 애니메이션으로 데이터 전환
 * - 체험지수란? 팝업
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
 *   allPlaces: ['진도','무창포',...],
 *   places: { '실미도': { lat, lot, forecasts: { '2026-04-01': [{ bgng, end, ... totalIndex }] } } }
 * }
 * ============================================================================
 */

(function () {
    'use strict';

    // ========================================================================
    // 상수 및 상태 변수
    // ========================================================================

    const STORAGE_KEY = 'seaParting_favorite';
    let _data = null;
    let _selectedPlace = null;
    let _initialized = false;

    /** 체험지수 등급별 색상 */
    const INDEX_COLORS = {
        '매우좋음': { bg: 'rgba(21,101,192,0.15)', color: '#81D4FA', border: 'rgba(21,101,192,0.4)' },
        '좋음':     { bg: 'rgba(46,125,50,0.15)',  color: '#81C784', border: 'rgba(46,125,50,0.4)' },
        '보통':     { bg: 'rgba(249,168,37,0.15)', color: '#FFD54F', border: 'rgba(249,168,37,0.4)' },
        '나쁨':     { bg: 'rgba(230,81,0,0.15)',   color: '#FFB74D', border: 'rgba(230,81,0,0.4)' },
        '매우나쁨': { bg: 'rgba(198,40,40,0.15)',  color: '#EF9A9A', border: 'rgba(198,40,40,0.4)' }
    };

    // ========================================================================
    // 초기화
    // ========================================================================

    window.initSeaParting = async function () {
        if (_initialized && _data) return;

        try {
            const res = await fetch((window.CONFIG?.API_BASE || '') + '/api/sea-split-index');
            if (!res.ok) throw new Error('API 응답 실패');
            _data = await res.json();
        } catch (e) {
            _showNotice('바다갈라짐 체험지수 데이터를 불러오지 못했습니다.');
            return;
        }

        _initialized = true;
        _renderPlaceButtons();

        // 즐겨찾기가 있으면 자동 선택
        const fav = _getFavorite();
        if (fav && _data.places[fav]) {
            _selectPlace(fav);
        }
    };

    // ========================================================================
    // 지역 버튼 렌더링
    // ========================================================================

    function _renderPlaceButtons() {
        const container = document.getElementById('sp-place-buttons');
        if (!container || !_data) return;

        const placesWithData = Object.keys(_data.places);
        if (placesWithData.length === 0) {
            _showNotice('현재 제공되는 바다갈라짐 체험지수 데이터가 없습니다.');
            return;
        }

        const fav = _getFavorite();

        // 즐겨찾기를 맨 앞으로 정렬
        const sorted = [...placesWithData].sort((a, b) => {
            if (a === fav) return -1;
            if (b === fav) return 1;
            // allPlaces 순서 유지
            const allPlaces = _data.allPlaces || [];
            return allPlaces.indexOf(a) - allPlaces.indexOf(b);
        });

        container.innerHTML = sorted.map(name => {
            const isFav = name === fav;
            const isActive = name === _selectedPlace;
            return `<button class="sp-place-btn${isActive ? ' active' : ''}${isFav ? ' favorite' : ''}" data-place="${name}">
                ${isFav ? '<i class="fa-solid fa-star sp-fav-icon"></i> ' : ''}${name}
            </button>`;
        }).join('');

        // 이벤트 바인딩
        container.querySelectorAll('.sp-place-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                _selectPlace(btn.dataset.place);
            });
        });
    }

    // ========================================================================
    // 지역 선택
    // ========================================================================

    function _selectPlace(placeName) {
        if (!_data || !_data.places[placeName]) return;

        _selectedPlace = placeName;

        // 버튼 active 상태 갱신
        document.querySelectorAll('.sp-place-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.place === placeName);
        });

        // info row 표시
        const infoRow = document.getElementById('sp-info-row');
        if (infoRow) infoRow.style.display = 'flex';

        // 발표시점 업데이트
        const publishEl = document.getElementById('sp-publish-time');
        if (publishEl) {
            publishEl.textContent = _data.updatedAt ? '발표: ' + _data.updatedAt : '발표: -';
        }

        // 즐겨찾기 버튼 상태
        _updateFavoriteBtn();

        // 데이터 테이블 렌더링 (fade 애니메이션)
        _renderDataWithAnimation(placeName);

        // 안내문구 숨기기
        const notice = document.getElementById('sp-notice');
        if (notice) notice.style.display = 'none';
    }

    // ========================================================================
    // 데이터 테이블 렌더링
    // ========================================================================

    function _renderDataWithAnimation(placeName) {
        const container = document.getElementById('sp-data-container');
        if (!container) return;

        // fade out
        container.classList.add('sp-fade-out');

        setTimeout(() => {
            _renderData(placeName, container);
            container.classList.remove('sp-fade-out');
            container.classList.add('sp-fade-in');
            setTimeout(() => container.classList.remove('sp-fade-in'), 300);
        }, 200);
    }

    function _renderData(placeName, container) {
        const place = _data.places[placeName];
        if (!place || !place.forecasts) {
            container.innerHTML = '<div class="sp-no-data">해당 지역의 체험지수 데이터가 없습니다.</div>';
            return;
        }

        const dates = Object.keys(place.forecasts).sort();
        if (dates.length === 0) {
            container.innerHTML = '<div class="sp-no-data">해당 지역의 체험지수 데이터가 없습니다.</div>';
            return;
        }

        let html = '<div class="sp-table-wrap"><table class="sp-table">';
        html += '<thead><tr><th>날짜</th><th>체험시간</th><th>기온</th><th>풍속</th><th>날씨</th><th>체험지수</th></tr></thead>';
        html += '<tbody>';

        dates.forEach(date => {
            const windows = place.forecasts[date];
            if (!windows || windows.length === 0) return;

            const formattedDate = _formatDate(date);
            const dayOfWeek = _getDayOfWeek(date);
            const isWeekend = dayOfWeek === '토' || dayOfWeek === '일';

            windows.forEach((w, idx) => {
                const indexStyle = INDEX_COLORS[w.totalIndex] || { bg: 'rgba(255,255,255,0.05)', color: '#94a3b8', border: 'rgba(255,255,255,0.1)' };
                const timeRange = (w.bgng && w.end) ? `${w.bgng} ~ ${w.end}` : '-';
                const temp = (w.minArtmp != null && w.maxArtmp != null) ? `${w.minArtmp}~${w.maxArtmp}°C` : '-';
                const wind = (w.minWspd != null && w.maxWspd != null) ? `${w.minWspd}~${w.maxWspd}m/s` : '-';
                const weather = w.weather || '-';

                html += '<tr>';
                // 날짜 셀: 같은 날 여러 구간이면 첫 번째만 표시
                if (idx === 0) {
                    html += `<td class="sp-date-cell${isWeekend ? ' sp-weekend' : ''}" ${windows.length > 1 ? `rowspan="${windows.length}"` : ''}>
                        <div class="sp-date-main">${formattedDate}</div>
                        <div class="sp-date-day${isWeekend ? ' sp-weekend' : ''}">${dayOfWeek}</div>
                    </td>`;
                }
                html += `<td class="sp-time-cell">${timeRange}</td>`;
                html += `<td>${temp}</td>`;
                html += `<td>${wind}</td>`;
                html += `<td>${_getWeatherIcon(weather)} ${weather}</td>`;
                html += `<td><span class="sp-index-badge" style="background:${indexStyle.bg};color:${indexStyle.color};border:1px solid ${indexStyle.border};">${w.totalIndex || '-'}</span></td>`;
                html += '</tr>';
            });
        });

        html += '</tbody></table></div>';
        container.innerHTML = html;
    }

    // ========================================================================
    // 즐겨찾기
    // ========================================================================

    function _getFavorite() {
        try {
            return localStorage.getItem(STORAGE_KEY) || null;
        } catch (e) {
            return null;
        }
    }

    function _setFavorite(placeName) {
        try {
            if (placeName) {
                localStorage.setItem(STORAGE_KEY, placeName);
            } else {
                localStorage.removeItem(STORAGE_KEY);
            }
        } catch (e) { /* ignore */ }
    }

    function _updateFavoriteBtn() {
        const btn = document.getElementById('sp-favorite-btn');
        if (!btn) return;

        const fav = _getFavorite();
        const isFav = _selectedPlace && _selectedPlace === fav;

        btn.innerHTML = isFav
            ? '<i class="fa-solid fa-star"></i>'
            : '<i class="fa-regular fa-star"></i>';
        btn.classList.toggle('active', isFav);
    }

    // 즐겨찾기 버튼 클릭
    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#sp-favorite-btn');
        if (!btn || !_selectedPlace) return;

        const fav = _getFavorite();
        if (_selectedPlace === fav) {
            // 이미 즐겨찾기 → 해제
            _setFavorite(null);
        } else {
            // 새로 즐겨찾기 설정 (기존 대체)
            _setFavorite(_selectedPlace);
        }

        _updateFavoriteBtn();
        _renderPlaceButtons(); // 버튼 순서 재배치
    });

    // ========================================================================
    // 체험지수란? 팝업
    // ========================================================================

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('#sp-guide-btn');
        if (!btn) return;

        _showGuidePopup();
    });

    function _showGuidePopup() {
        // 기존 팝업 제거
        const existing = document.getElementById('sp-guide-popup');
        if (existing) { existing.remove(); return; }

        const popup = document.createElement('div');
        popup.id = 'sp-guide-popup';
        popup.className = 'sp-guide-popup';
        popup.innerHTML = `
            <div class="sp-guide-content">
                <div class="sp-guide-header">
                    <h3><i class="fa-solid fa-circle-info"></i> 바다갈라짐 체험지수란?</h3>
                    <button class="sp-guide-close" id="sp-guide-close"><i class="fa-solid fa-xmark"></i></button>
                </div>
                <div class="sp-guide-body">
                    <p>바다갈라짐 체험지수는 <strong>국립해양조사원</strong>에서 제공하는 지수로,
                    조석(밀물·썰물)에 의해 바닷길이 열리는 현상의 체험 적합도를 나타냅니다.</p>
                    <div class="sp-guide-levels">
                        <div class="sp-guide-level"><span class="sp-dot" style="background:#81D4FA;"></span> 매우좋음 – 체험하기 매우 좋은 조건</div>
                        <div class="sp-guide-level"><span class="sp-dot" style="background:#81C784;"></span> 좋음 – 체험하기 좋은 조건</div>
                        <div class="sp-guide-level"><span class="sp-dot" style="background:#FFD54F;"></span> 보통 – 보통 수준의 조건</div>
                        <div class="sp-guide-level"><span class="sp-dot" style="background:#FFB74D;"></span> 나쁨 – 체험에 부적합한 조건</div>
                        <div class="sp-guide-level"><span class="sp-dot" style="background:#EF9A9A;"></span> 매우나쁨 – 체험 불가 수준</div>
                    </div>
                    <p class="sp-guide-source">출처: 국립해양조사원 바다갈라짐 체험지수</p>
                </div>
            </div>
        `;

        document.body.appendChild(popup);
        requestAnimationFrame(() => popup.classList.add('show'));

        // 닫기
        popup.querySelector('#sp-guide-close').addEventListener('click', () => {
            popup.classList.remove('show');
            setTimeout(() => popup.remove(), 300);
        });
        popup.addEventListener('click', (e) => {
            if (e.target === popup) {
                popup.classList.remove('show');
                setTimeout(() => popup.remove(), 300);
            }
        });
    }

    // ========================================================================
    // 유틸리티
    // ========================================================================

    function _formatDate(dateStr) {
        // '2026-04-01' → '04.01'
        const parts = dateStr.split('-');
        if (parts.length === 3) return parts[1] + '.' + parts[2];
        return dateStr;
    }

    function _getDayOfWeek(dateStr) {
        const days = ['일', '월', '화', '수', '목', '금', '토'];
        const d = new Date(dateStr);
        return days[d.getDay()];
    }

    function _getWeatherIcon(weather) {
        if (!weather) return '';
        if (weather.includes('맑')) return '<i class="fa-solid fa-sun" style="color:#ffd54f;"></i>';
        if (weather.includes('구름')) return '<i class="fa-solid fa-cloud-sun" style="color:#90a4ae;"></i>';
        if (weather.includes('흐')) return '<i class="fa-solid fa-cloud" style="color:#78909c;"></i>';
        if (weather.includes('비') || weather.includes('소나기')) return '<i class="fa-solid fa-cloud-rain" style="color:#42a5f5;"></i>';
        if (weather.includes('눈')) return '<i class="fa-solid fa-snowflake" style="color:#b3e5fc;"></i>';
        return '';
    }

    function _showNotice(msg) {
        const notice = document.getElementById('sp-notice');
        if (notice) {
            notice.innerHTML = `<p><i class="fa-solid fa-circle-info"></i> ${msg}</p>`;
            notice.style.display = 'block';
        }
    }

})();
