// ============================================================
// 🌊 해역 평균 파고/풍속 모듈
// ------------------------------------------------------------
//  특보구역(예: 제주도남부앞바다) 별로 사전에 매핑된 대해구
//  목록을 이용해, 가장 가까운 3시간 예보 슬롯의 wh/ws 평균을
//  계산하여 노란 점선 박스를 생성한다.
//
//  데이터 소스:
//   - /zone_grid_map.json         : 매퍼 툴에서 다운받아 배치한 매핑
//                                   (local_server/assets/ 에 두어 /app/data
//                                   볼륨 마운트가 가리지 않는 경로로 서빙)
//                                   { code: { name, region, majorZones, smallZones } }
//   - /api/marine-zone-forecasts  : 대해구별 3시간 예보(시계열)
//
//  외부 노출(window.ZoneAvg):
//    - init()                      : 데이터 비동기 로드
//    - createBox(zoneName, opts)   : DOM 노드 반환 (없으면 null)
//    - refreshAll()                : 화면의 모든 .zone-avg-box 갱신
// ============================================================
(function () {
    const STATE = {
        gridMap: null,        // { code: { name, majorZones, smallZones } }
        nameToCode: null,     // { '울산앞바다': '12C10101', ... }
        forecasts: null,      // { '1': [ {tm, wh, ws, ...}, ... ], ... }
        loaded: false,
        loadPromise: null,
    };

    // init() 완료 후 실행될 콜백 큐
    //   왜 필요한가: createBox() 가 동기 함수인데 init() 은 비동기라서,
    //   느린 기기/네트워크에서는 카드가 먼저 렌더되고 init 이 나중에 끝나는
    //   레이스가 발생. 그러면 첫 렌더 때는 STATE.loaded=false → null 반환 →
    //   박스가 영영 안 붙고 사용자는 "어떤 기기는 되고 어떤 기기는 안 됨"
    //   증상을 보게 됨. 호출자(windy.js, render.js)가 onReady 로 후처리할 수
    //   있게 콜백 큐를 노출.
    const _readyCallbacks = [];
    /**
     * 모듈 init() 완료 후 실행될 콜백을 등록.
     * 이미 init 이 끝났으면 즉시 실행, 아니면 큐에 쌓아 _flushReady 가 호출.
     *
     * [용도]
     *   외부(windy.js, render.js 등)가 createBox 를 호출하기 전에
     *   "이 모듈이 데이터 로딩 끝났는지" 를 기다리는 진입점.
     *
     * @param {Function} cb - init 완료 후 실행할 함수 (인자 없음)
     */
    function onReady(cb) {
        if (typeof cb !== 'function') return;
        if (STATE.loaded) {
            try { cb(); } catch (e) { /* 콜백 에러는 다른 콜백에 영향 안 주게 무시 */ }
        } else {
            _readyCallbacks.push(cb);
        }
    }
    /**
     * 큐에 쌓인 모든 onReady 콜백을 순서대로 실행하고 큐를 비움.
     * init() 의 마지막 단계에서 1회 호출.
     */
    function _flushReady() {
        while (_readyCallbacks.length) {
            const cb = _readyCallbacks.shift();
            try { cb(); } catch (e) { /* 무시 */ }
        }
    }

    // ------------------------------------------------------------
    // 데이터 로드
    // ------------------------------------------------------------
    /**
     * 특보구역명 정규화 — 가운뎃점(·)·점(.)·공백 제거.
     * 같은 이름이지만 표기가 다른 케이스(예: "제주도·남부앞바다" vs "제주도남부앞바다")
     * 를 흡수하여 인덱스 조회 hit 률을 높임.
     *
     * @param {string} name - 정규화 대상 이름
     * @returns {string} - 정규화된 이름 (특수문자 제거)
     */
    function _normalizeName(name) {
        if (!name) return '';
        return String(name).replace(/[·.\s]+/g, '');
    }

    /**
     * 특보구역명 ↔ grid 코드 인덱스(STATE.nameToCode) 를 빌드.
     *
     * [입력 출처]
     *   1) STATE.gridMap (zone_grid_map.json) — 매퍼 툴이 만든 매핑. 1차 인덱스
     *   2) SEA_ZONE_COORDINATES (전역) — 전체 카탈로그. 보강 인덱스
     *
     * [출력]
     *   STATE.nameToCode = { '<원래이름>': '<code>', '<정규화이름>': '<code>', ... }
     *
     * [호출 시점] init() 에서 데이터 fetch 완료 후 1회.
     */
    function _buildNameIndex() {
        const idx = {};
        // 1) 매핑 JSON 자체에 name 있음 → 1차 인덱스
        if (STATE.gridMap) {
            for (const [code, m] of Object.entries(STATE.gridMap)) {
                if (m && m.name) {
                    idx[m.name] = code;
                    idx[_normalizeName(m.name)] = code;
                }
            }
        }
        // 2) seaZoneCoordinates (전체 카탈로그) → 보강
        if (typeof SEA_ZONE_COORDINATES !== 'undefined') {
            for (const [code, info] of Object.entries(SEA_ZONE_COORDINATES)) {
                if (info && info.name) {
                    if (!idx[info.name]) idx[info.name] = code;
                    const norm = _normalizeName(info.name);
                    if (!idx[norm]) idx[norm] = code;
                }
            }
        }
        STATE.nameToCode = idx;
    }

    /**
     * 모듈 비동기 초기화 — grid 매핑 + 예보 데이터 fetch 후 인덱스 빌드.
     *
     * [수행 순서]
     *   1) /zone_grid_map.json → STATE.gridMap (없을 수 있음 graceful)
     *   2) /api/marine-zone-forecasts → STATE.forecasts
     *   3) _buildNameIndex() 로 이름 인덱스 빌드
     *   4) STATE.loaded=true + _flushReady() 로 대기 콜백 일괄 실행
     *
     * [멱등성] STATE.loadPromise 캐시로 중복 호출해도 1회만 fetch.
     *
     * [연계] window.ZoneAvg.init 로 외부 노출 (windy.js, render.js 가 호출).
     *
     * @returns {Promise<void>}
     */
    async function init() {
        if (STATE.loadPromise) return STATE.loadPromise;
        STATE.loadPromise = (async () => {
            // grid map (없을 수 있음)
            try {
                const r = await fetch('/zone_grid_map.json', { cache: 'no-store' });
                if (r.ok) STATE.gridMap = await r.json();
            } catch (e) { /* 매핑 없음 → graceful */ }

            // forecasts
            try {
                const r = await fetch('/api/marine-zone-forecasts', { cache: 'no-store' });
                if (r.ok) {
                    const raw = await r.json();
                    STATE.forecasts = raw.data || raw; // 호환
                }
            } catch (e) { /* 예보 로드 실패 */ }

            _buildNameIndex();
            STATE.loaded = true;
            _flushReady();
        })();
        return STATE.loadPromise;
    }

    // ------------------------------------------------------------
    // 시간 파싱 (KMA tm: "YYYYMMDDHH")
    // ------------------------------------------------------------
    /**
     * KMA 형식 tm 문자열("YYYYMMDDHH") 을 JS Date 객체로 변환.
     * 길이가 10 미만이면 잘못된 입력으로 보고 null 반환.
     *
     * @param {string|number} tm - "2026043016" 형식
     * @returns {Date|null}
     */
    function _parseTm(tm) {
        const s = String(tm);
        if (s.length < 10) return null;
        const y = +s.substring(0, 4);
        const m = +s.substring(4, 6) - 1;
        const d = +s.substring(6, 8);
        const h = +s.substring(8, 10);
        return new Date(y, m, d, h, 0, 0);
    }

    /**
     * 예보 시계열 배열에서 현재 시각과 가장 가까운(시간 차 절대값 최소) 항목 선택.
     *
     * [용도] 3시간 단위 예보 슬롯 중 "지금 시점에 가장 적절한" 슬롯 선택.
     *
     * @param {Array<{tm: string, wh?: number, ws?: number}>} arr - 예보 시계열
     * @param {Date} now - 비교 기준 시각
     * @returns {Object|null} - 가장 가까운 예보 항목 (없으면 null)
     */
    function _nearestForecast(arr, now) {
        if (!arr || arr.length === 0) return null;
        let best = null;
        let bestDiff = Infinity;
        for (const item of arr) {
            const t = _parseTm(item.tm);
            if (!t) continue;
            const diff = Math.abs(t - now);
            if (diff < bestDiff) {
                bestDiff = diff;
                best = item;
            }
        }
        return best;
    }

    /**
     * 평균 계산에 사용할 대해구 번호 목록을 grid 매핑 항목으로부터 산출.
     *
     * [우선순위]
     *   1) m.majorZones 가 있으면 그대로 사용 — 명시적으로 지정된 대해구
     *   2) 없으면 m.smallZones 에서 "부모 번호" (소해구 ID 의 '-' 앞부분) 를
     *      distinct 추출 — 앞바다처럼 좁은 구역 fallback
     *
     * @param {Object} m - STATE.gridMap[code] 항목 ({majorZones, smallZones, ...})
     * @returns {string[]} - 대해구 번호 문자열 배열 (없으면 빈 배열)
     */
    function _resolveLzones(m) {
        if (!m) return [];
        if (Array.isArray(m.majorZones) && m.majorZones.length > 0) {
            return m.majorZones.map(String);
        }
        if (Array.isArray(m.smallZones) && m.smallZones.length > 0) {
            const set = new Set();
            for (const sid of m.smallZones) {
                const parent = String(sid).split('-')[0];
                if (parent) set.add(parent);
            }
            return [...set];
        }
        return [];
    }

    // ------------------------------------------------------------
    // 평균 계산
    // ------------------------------------------------------------
    /**
     * 특보구역명을 받아 그 구역의 평균 유의파고(wh) / 풍속(ws) 을 계산해 반환.
     *
     * [절차]
     *   1) zoneName → grid code 조회 (STATE.nameToCode, 정규화 fallback)
     *   2) STATE.gridMap[code] → _resolveLzones 로 대해구 번호 목록 결정
     *   3) 각 대해구의 시계열에서 _nearestForecast 로 현재와 가장 가까운 항목 선택
     *   4) 선택된 항목들의 wh/ws 산술 평균 계산 (소수점 1자리 반올림)
     *
     * [반환]
     *   { tm, avgWh, avgWs, count } 또는 null (매핑/예보 없음).
     *   tm: 첫 항목의 시각 (대표 시각으로 표시 용도)
     *   avgWh: 평균 유의파고 (m, 소수점 1자리)
     *   avgWs: 평균 풍속 (m/s, 소수점 1자리)
     *   count: 평균 산출에 들어간 대해구 개수
     *
     * [연계] createBox 가 호출하여 박스 텍스트를 채움.
     *
     * @param {string} zoneName - 특보구역명 (예: "제주도남부앞바다")
     * @returns {{tm: string, avgWh: number, avgWs: number, count: number}|null}
     */
    function getAverages(zoneName) {
        if (!STATE.loaded || !STATE.gridMap || !STATE.forecasts) return null;
        let code = STATE.nameToCode ? STATE.nameToCode[zoneName] : null;
        // 정규화된 이름으로 재조회 (가운뎃점/공백 차이 흡수)
        if (!code && STATE.nameToCode) {
            code = STATE.nameToCode[_normalizeName(zoneName)];
        }
        if (!code) return null;
        const m = STATE.gridMap[code];
        if (!m) return null;
        const lzones = _resolveLzones(m);
        if (lzones.length === 0) return null;

        const now = new Date();
        const items = [];
        let representativeTm = null;

        for (const num of lzones) {
            const series = STATE.forecasts[num];
            if (!series) continue;
            const item = _nearestForecast(series, now);
            if (!item) continue;
            if (typeof item.wh === 'number' && typeof item.ws === 'number') {
                items.push(item);
                if (!representativeTm) representativeTm = item.tm;
            }
        }

        if (items.length === 0) return null;

        const avgWh = items.reduce((s, it) => s + Number(it.wh), 0) / items.length;
        const avgWs = items.reduce((s, it) => s + Number(it.ws), 0) / items.length;

        return {
            tm: representativeTm,
            avgWh: Math.round(avgWh * 10) / 10,
            avgWs: Math.round(avgWs * 10) / 10,
            count: items.length
        };
    }

    /**
     * tm 문자열에서 시(hour) 만 두 자리로 추출해 "HH시" 형태로 반환.
     * 예: "2026043016" → "16시", 잘못된 입력 → "--".
     * 박스에 대표 시각을 라벨링할 때 사용.
     *
     * @param {string} tm
     * @returns {string}
     */
    function _formatHour(tm) {
        const d = _parseTm(tm);
        if (!d) return '--';
        return String(d.getHours()).padStart(2, '0') + '시';
    }

    // ------------------------------------------------------------
    // DOM 박스 생성
    // ------------------------------------------------------------
    // opts.inline = true → 기상현황 카드(zone명 옆 인라인 배치)용 컴팩트 스타일
    const TOOLTIP_TEXT = '해당 특보구역에 속하는 소해구에 대한\n파고 및 풍속 예측정보의 평균 값입니다.\n예측정보는 실제환경과 다를 수 있습니다.';

    /**
     * 박스에 클릭 시 안내 툴팁을 띄우는 핸들러 부착.
     *
     * [동작]
     *   - 박스 click 시 .zone-avg-tooltip 1회 생성 후 box 에 append
     *   - 일정 시간 뒤(타이머 setTimeout) 자동 제거
     *   - 같은 박스 재클릭 시 기존 툴팁 + 타이머 정리하고 새로 표시
     *   - e.stopPropagation() 으로 박스 클릭이 부모 요소(카드/지도) 로 버블되는 것 차단
     *
     * @param {HTMLElement} box - 툴팁을 부착할 .zone-avg-box element
     */
    function _attachTooltipHandler(box) {
        box.addEventListener('click', (e) => {
            e.stopPropagation();
            const prev = box.querySelector('.zone-avg-tooltip');
            if (prev) prev.remove();
            if (box._tooltipTimer) {
                clearTimeout(box._tooltipTimer);
                box._tooltipTimer = null;
            }
            const tip = document.createElement('div');
            tip.className = 'zone-avg-tooltip';
            tip.textContent = TOOLTIP_TEXT;
            box.appendChild(tip);
            box._tooltipTimer = setTimeout(() => {
                tip.remove();
                box._tooltipTimer = null;
            }, 2000);
        });
    }

    /**
     * 특보구역명으로 평균 파고/풍속 박스 DOM 을 생성해 반환.
     *
     * [반환 DOM 구조]
     *   <div class="zone-avg-box [inline]" data-zone-name="...">
     *     <span class="zone-avg-badge wave"><span class="lbl">평균 유의파고</span> 1.5m</span>
     *     <span class="zone-avg-badge wind"><span class="lbl">평균 풍속</span> 4.2m/s</span>
     *   </div>
     *
     * [매핑/예보 부재 시] null 반환 — 호출자가 박스를 만들지 않음.
     *
     * [연계]
     *   - windy.js / render.js 가 호출하여 카드 또는 zone 이름 옆에 인라인 배치
     *   - opts.inline=true → "inline" 클래스 추가 → CSS 가 컴팩트 스타일 적용
     *   - _attachTooltipHandler 로 클릭 시 안내 툴팁 부착
     *
     * @param {string} zoneName - 특보구역명
     * @param {{inline?: boolean}} opts - 표시 옵션
     * @returns {HTMLElement|null}
     */
    function createBox(zoneName, opts) {
        opts = opts || {};
        const result = getAverages(zoneName);
        if (!result) return null; // 매핑/예보 없음 → 박스 생성 안 함

        const box = document.createElement('div');
        box.className = 'zone-avg-box' + (opts.inline ? ' inline' : '');
        box.dataset.zoneName = zoneName;

        const waveBadge = document.createElement('span');
        waveBadge.className = 'zone-avg-badge wave';
        waveBadge.innerHTML = `<span class="lbl">평균 유의파고</span> ${result.avgWh.toFixed(1)}m`;
        box.appendChild(waveBadge);

        const windBadge = document.createElement('span');
        windBadge.className = 'zone-avg-badge wind';
        windBadge.innerHTML = `<span class="lbl">평균 풍속</span> ${result.avgWs.toFixed(1)}m/s`;
        box.appendChild(windBadge);

        _attachTooltipHandler(box);

        return box;
    }

    /**
     * 현재 DOM 에 떠 있는 모든 .zone-avg-box 를 새 데이터로 다시 그림.
     *
     * [호출 시점]
     *   - setInterval 5분마다 자동 호출 (현재 슬롯이 다음 3시간 예보로 넘어갔는지
     *     주기적으로 재평가) — 파일 끝에서 등록.
     *
     * [절차]
     *   각 박스의 data-zone-name 으로 새 박스를 createBox 호출해서 만들고,
     *   기존 노드를 replaceWith 으로 교체. 이렇게 하면 inline 여부 같은 옵션도
     *   자연스럽게 보존됨.
     *
     * [안전성] data-zone-name 이 없거나 createBox 가 null 이면 그 박스는 그대로 둠.
     */
    function refreshAll() {
        const boxes = document.querySelectorAll('.zone-avg-box');
        boxes.forEach((old) => {
            const name = old.dataset.zoneName;
            if (!name) return;
            const fresh = createBox(name, { inline: old.classList.contains('inline') });
            if (fresh) old.replaceWith(fresh);
        });
    }

    // ------------------------------------------------------------
    // 자동 주기 갱신 (5분마다 가장 가까운 예보 슬롯 재평가)
    // ------------------------------------------------------------
    setInterval(() => {
        if (STATE.loaded) refreshAll();
    }, 5 * 60 * 1000);

    // ------------------------------------------------------------
    // export
    // ------------------------------------------------------------
    window.ZoneAvg = {
        init,
        onReady,        // init 완료 후 1회 실행 콜백 등록 (느린 기기 race 대응)
        createBox,
        refreshAll,
        getAverages, // 디버그용
        _state: STATE
    };

    // 자동 초기화 (DOM 로드 직후, 다른 모듈은 createBox 호출 전 init() await 권장)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => init());
    } else {
        init();
    }
})();
