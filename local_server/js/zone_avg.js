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

    // ------------------------------------------------------------
    // 데이터 로드
    // ------------------------------------------------------------
    // 이름 정규화 (가운뎃점·점·공백 차이 흡수)
    function _normalizeName(name) {
        if (!name) return '';
        return String(name).replace(/[·.\s]+/g, '');
    }

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
        })();
        return STATE.loadPromise;
    }

    // ------------------------------------------------------------
    // 시간 파싱 (KMA tm: "YYYYMMDDHH")
    // ------------------------------------------------------------
    function _parseTm(tm) {
        const s = String(tm);
        if (s.length < 10) return null;
        const y = +s.substring(0, 4);
        const m = +s.substring(4, 6) - 1;
        const d = +s.substring(6, 8);
        const h = +s.substring(8, 10);
        return new Date(y, m, d, h, 0, 0);
    }

    // 현재 시각에 가장 가까운 예보 항목
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

    // 평균 계산에 사용할 대해구 번호 목록 산출
    //  - majorZones 가 있으면 그대로 사용
    //  - 비어있으면 smallZones 에서 부모 번호를 distinct 하게 추출 (앞바다 등 좁은 구역)
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

    // 화면의 모든 박스를 새로 그림 (3시간 슬롯 변경 시)
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
