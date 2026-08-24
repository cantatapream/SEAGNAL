/**
 * ============================================================================
 * 파일명: js/marine-life/safety/accident_geocode_review.js
 * 역할  : 사고정보(선박·해경) 지오코딩 대조 검수 화면. 위치텍스트("OO 동방 5마일")가
 *         실제로 가리키는 곳과 데이터베이스에 저장된 좌표를 지도 위에 나란히 찍고
 *         선으로 이어 거리를 보여주며, 사람이 한 건씩 "유지 / 텍스트 위치로 변경 /
 *         삭제"를 판정한다.
 * [트리거 비활성화(2026-08-23)] 원래 "사고정보" 버튼 10회 연타로 열렸으나, 후보 목록이
 *   4회차 반영으로 0건이 되어(더 볼 게 없음) 그 트리거를 accident_info.js 의 구 검수
 *   모드(REVIEW_MODE)로 넘겼다 — 지금은 코드가 실행되지 않는다(init() 참고). 후보가
 *   다시 생기면(원본 데이터 재수집 등) bindTrigger() 를 되살려 쓸 수 있어 코드는 남김.
 * ----------------------------------------------------------------------------
 * [배경] local_server/scripts/accident_geocode_check.js(서버 스크립트, Nominatim
 *   지오코딩)로 1차 조사한 의심 후보 1,134건(client/accident_geocode_candidates.json)
 *   을 사람이 눈으로 최종 확인하기 위한 화면이다. 이 화면은 원본 데이터를 건드리지
 *   않고 판정 결과를 텍스트로 모아 "내보내기"만 한다 — 실제 삭제·좌표수정은 그
 *   결과를 받은 쪽이 별도로 처리한다(기존 검수 모드와 같은 원칙).
 * [지오코딩] 이 화면은 브라우저에서 직접 OpenStreetMap Nominatim 을 호출한다(서버
 *   스크립트가 쓰던 것과 같은 서비스 — 카카오 API 키를 GitHub Actions 시크릿에
 *   등록하는 절차가 막혀 우선 이 방식으로 진행, 2026-08-22 사용자 확정). 카드가
 *   넘어갈 때마다 최대 1건만 조회하고 같은 기준지명은 캐시해 재사용하므로 Nominatim
 *   사용정책(초당 1건 이하)에 사람이 한 건씩 보는 속도상 자연히 맞는다.
 * [세 가지 판정]
 *   - 유지            : 저장된 좌표가 맞다 — 아무 것도 안 함(내보내기 대상 아님)
 *   - 텍스트 위치로 변경 : 저장된 좌표가 틀렸고, 위치텍스트로 계산한 예상좌표가
 *                        맞다 — 그 예상좌표로 원본 좌표를 고쳐야 한다는 뜻
 *   - 삭제            : 어느 쪽도 못 믿겠다 — 기존 검수 모드처럼 행 자체를 삭제
 * [연계]
 *  - 트리거     : 비활성화됨(위 참고) — 원래는 #ocean-accident-toggle-btn 10회 연타
 *  - 데이터     : /accident_ships_hk.json(원본), /accident_geocode_candidates.json
 *                 (1차 조사로 뽑은 의심 후보 origIndex 목록)
 *  - 지도       : OpenLayers(전역 ol, ol.source.OSM()) — 앱의 다른 지도와 별개로
 *                 이 화면 전용 인스턴스를 새로 만든다
 *  - 관할 표시  : accident_codes.js 의 ACCIDENT_ORG_LABELS·accidentLabel() — 저장좌표
 *                 마커 옆에 관할 해경서 이름을 라벨로 붙여, "이 관할서 소속인데 왜
 *                 여기 찍혀 있지?"를 검수자가 지도에서 바로 판단하게 한다(자동 판정이
 *                 아니라 사람 판단을 돕는 정보 표시일 뿐 — 2026-08-23 사용자 확정,
 *                 관할해역 경계 데이터가 없고 원양사고는 정상적으로 관할서에서 멀리
 *                 떨어질 수 있어 자동 제외는 하지 않기로 함)
 * [로드 순서] accident_info.js 다음(같은 버튼을 참조하지만 그 버튼의 마크업이
 *             이미 로드돼 있어야 하므로, accident_codes.js 는 그보다도 먼저 로드됨)
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 트리거: 사고정보 버튼 10회 연타 ─────────────────────────────────────
    var TAP_THRESHOLD = 10;
    var TAP_RESET_MS = 3000;
    var _tapCount = 0;
    var _tapTimer = null;

    function bindTrigger() {
        var btn = document.getElementById('ocean-accident-toggle-btn');
        if (!btn) return;
        btn.addEventListener('click', function () {
            _tapCount++;
            clearTimeout(_tapTimer);
            _tapTimer = setTimeout(function () { _tapCount = 0; }, TAP_RESET_MS);
            if (_tapCount < TAP_THRESHOLD) return;
            _tapCount = 0;
            openReview();
        });
    }

    // ── 위치텍스트 파싱 · 좌표 계산 (accident_geocode_check.js 와 동일 로직) ──
    var DIR_PATTERN = /^(.*?)\s*(동남|동북|서남|서북|동|서|남|북)방\s*([0-9.]+)\s*(마일|해리|km|m)/;
    var BEARING_DEG = { 북: 0, 동북: 45, 동: 90, 동남: 135, 남: 180, 서남: 225, 서: 270, 서북: 315 };

    function parseDirectionDistance(posText) {
        var m = posText.match(DIR_PATTERN);
        if (!m) return null;
        var base = m[1].trim();
        if (!base) return null;
        var bearingDeg = BEARING_DEG[m[2]];
        var distanceKm = parseFloat(m[3]);
        if (m[4] === '마일' || m[4] === '해리') distanceKm *= 1.852;
        else if (m[4] === 'm') distanceKm /= 1000;
        return { base: base, bearingDeg: bearingDeg, distanceKm: distanceKm };
    }

    function destinationPoint(lat, lon, bearingDeg, distanceKm) {
        var R = 6371;
        var brng = bearingDeg * Math.PI / 180;
        var lat1 = lat * Math.PI / 180;
        var lon1 = lon * Math.PI / 180;
        var dR = distanceKm / R;
        var lat2 = Math.asin(Math.sin(lat1) * Math.cos(dR) + Math.cos(lat1) * Math.sin(dR) * Math.cos(brng));
        var lon2 = lon1 + Math.atan2(
            Math.sin(brng) * Math.sin(dR) * Math.cos(lat1),
            Math.cos(dR) - Math.sin(lat1) * Math.sin(lat2)
        );
        return { lat: lat2 * 180 / Math.PI, lon: lon2 * 180 / Math.PI };
    }

    function haversineKm(lat1, lon1, lat2, lon2) {
        var R = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── 지오코딩(브라우저 → Nominatim 직접 호출, 기준지명별로 메모리 캐시) ──
    var _geocodeCache = {};
    function geocode(query) {
        if (Object.prototype.hasOwnProperty.call(_geocodeCache, query)) {
            return Promise.resolve(_geocodeCache[query]);
        }
        var url = 'https://nominatim.openstreetmap.org/search?q=' + encodeURIComponent(query) + '&format=json&limit=1&countrycodes=kr';
        return fetch(url).then(function (res) { return res.json(); }).then(function (arr) {
            var result = (arr && arr.length) ? { lat: parseFloat(arr[0].lat), lon: parseFloat(arr[0].lon) } : null;
            _geocodeCache[query] = result;
            return result;
        }).catch(function () { _geocodeCache[query] = null; return null; });
    }

    // ── 상태 ────────────────────────────────────────────────────────────
    var POS_IDX = 4; // hk 행: [lat, lon, ymd, hm, pos, typeCd, causeCd, shipCd, orgCd, rescue, death, missing]
    var ORG_IDX = 8;
    var hkRows = null;
    var candidates = []; // [{origIndex, row, parsed, _expected}] — 텍스트 파싱 성공한 것만
    var cursor = 0;
    // rowKey(내용 기반) -> {action:'keep'|'delete'|'relocate', lat, lon}. origIndex를 키로
    // 쓰지 않는 이유: 서버에서 삭제를 반영할 때마다 뒤 행들의 번호가 당겨지는데, 브라우저
    // 저장(localStorage)은 그걸 모르고 예전 번호 그대로 남아있다가 다음 회차 때 완전히 다른
    // 행을 가리키는 판정으로 둔갑한다(2회차 반영 때 실제로 발생 확인, 2026-08-23). 내용 기반
    // 키는 서버 쪽 번호가 밀려도 같은 사고 기록을 계속 같은 키로 가리킨다.
    var decisions = {};
    var STORAGE_KEY = 'accidentGeocodeReviewDecisions_v1';

    function rowKey(row) {
        return row[2] + '|' + row[3] + '|' + row[4] + '|' + row[0] + '|' + row[1];
    }

    function loadDecisions() {
        try { decisions = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
        catch (e) { decisions = {}; }
    }
    function saveDecisions() {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(decisions)); } catch (e) { /* 저장 실패해도 화면 진행에는 지장 없음 */ }
    }

    function formatYmd(ymd) {
        if (!ymd || ymd.length !== 8) return ymd || '-';
        return ymd.slice(0, 4) + '-' + ymd.slice(4, 6) + '-' + ymd.slice(6, 8);
    }

    function labelForAction(action) {
        return action === 'keep' ? '유지' : action === 'relocate' ? '위치변경' : '삭제';
    }

    // ── DOM / 지도 ──────────────────────────────────────────────────────
    var els = {};
    var reviewMap = null;
    var vectorSource = null;

    function ensureOverlay() {
        if (document.getElementById('agr-overlay')) return;
        var style = document.createElement('style');
        style.textContent =
            '#agr-overlay{position:fixed;inset:0;z-index:2000;background:#0d1114;display:flex;flex-direction:column;font-family:sans-serif;color:#fff;}' +
            '#agr-hdr{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#161c21;border-bottom:1px solid #2a333a;}' +
            '#agr-hdr b{font-size:14px;}' +
            '#agr-progress{margin-left:auto;font-size:12px;color:#aaa;}' +
            '#agr-close{background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 6px;}' +
            '#agr-map{flex:1;min-height:0;}' +
            '#agr-info{flex:none;padding:10px 12px;background:#161c21;border-top:1px solid #2a333a;font-size:12px;line-height:1.6;}' +
            '#agr-info .agr-pos{font-weight:700;color:#ffb454;}' +
            '#agr-dist{font-weight:700;}' +
            '.agr-legend{display:flex;gap:12px;font-size:11px;color:#aaa;margin-top:4px;}' +
            '.agr-legend span{display:inline-flex;align-items:center;gap:4px;}' +
            '.agr-dot{width:9px;height:9px;border-radius:50%;display:inline-block;}' +
            '#agr-actions{flex:none;display:flex;gap:6px;padding:10px 12px 0;}' +
            '#agr-actions button{flex:1;padding:12px 4px;border-radius:8px;border:1px solid #444;background:#22292f;color:#fff;font-size:13px;font-weight:700;cursor:pointer;}' +
            '#agr-actions button.agr-keep{border-color:#3d8bff;color:#3d8bff;}' +
            '#agr-actions button.agr-relocate{border-color:#ffb454;color:#ffb454;}' +
            '#agr-actions button.agr-delete{border-color:#ff5f74;color:#ff5f74;}' +
            '#agr-nav{flex:none;display:flex;gap:6px;padding:8px 12px 12px;}' +
            '#agr-nav button{flex:1;padding:8px;border-radius:6px;border:1px solid #444;background:#1b2126;color:#ccc;font-size:12px;cursor:pointer;}' +
            '#agr-export-wrap{flex:none;padding:0 12px 12px;}' +
            '#agr-export-wrap textarea{width:100%;height:80px;font-size:11px;border-radius:6px;border:1px solid #555;background:#11161a;color:#fff;padding:6px;box-sizing:border-box;}';
        document.head.appendChild(style);

        var overlay = document.createElement('div');
        overlay.id = 'agr-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML =
            '<div id="agr-hdr"><b>사고정보 지오코딩 검수</b><span id="agr-progress"></span><button id="agr-close" aria-label="닫기">&times;</button></div>' +
            '<div id="agr-map"></div>' +
            '<div id="agr-info">' +
            '<div>위치텍스트: <span class="agr-pos" id="agr-pos">-</span></div>' +
            '<div>발생일자: <span id="agr-ymd">-</span> · 어긋난 거리: <span id="agr-dist">-</span></div>' +
            '<div>관할: <span id="agr-org">-</span></div>' +
            '<div>기준지명: <span id="agr-base">-</span></div>' +
            '<div class="agr-legend"><span><i class="agr-dot" style="background:#3d8bff"></i>저장된 좌표</span><span><i class="agr-dot" style="background:#2ecc71"></i>기준지명 위치</span><span><i class="agr-dot" style="background:#ff5f74"></i>텍스트가 가리키는 곳</span></div>' +
            '</div>' +
            '<div id="agr-actions">' +
            '<button type="button" class="agr-keep" id="agr-btn-keep">유지</button>' +
            '<button type="button" class="agr-relocate" id="agr-btn-relocate">텍스트 위치로 변경</button>' +
            '<button type="button" class="agr-delete" id="agr-btn-delete">삭제</button>' +
            '</div>' +
            '<div id="agr-nav"><button type="button" id="agr-prev">◀ 이전</button><button type="button" id="agr-skip">건너뛰기 ▶</button><button type="button" id="agr-export">내보내기</button></div>' +
            '<div id="agr-export-wrap" style="display:none;"><textarea id="agr-export-text" readonly></textarea></div>';
        document.body.appendChild(overlay);

        els.overlay = overlay;
        els.progress = document.getElementById('agr-progress');
        els.pos = document.getElementById('agr-pos');
        els.ymd = document.getElementById('agr-ymd');
        els.dist = document.getElementById('agr-dist');
        els.org = document.getElementById('agr-org');
        els.base = document.getElementById('agr-base');
        els.exportWrap = document.getElementById('agr-export-wrap');
        els.exportText = document.getElementById('agr-export-text');

        document.getElementById('agr-close').addEventListener('click', closeReview);
        document.getElementById('agr-btn-keep').addEventListener('click', function () { judge('keep'); });
        document.getElementById('agr-btn-relocate').addEventListener('click', function () { judge('relocate'); });
        document.getElementById('agr-btn-delete').addEventListener('click', function () { judge('delete'); });
        document.getElementById('agr-prev').addEventListener('click', function () { move(-1); });
        document.getElementById('agr-skip').addEventListener('click', function () { move(1); });
        document.getElementById('agr-export').addEventListener('click', exportResults);

        reviewMap = new ol.Map({
            target: 'agr-map',
            layers: [new ol.layer.Tile({ source: new ol.source.OSM() })],
            view: new ol.View({ center: ol.proj.fromLonLat([128, 36]), zoom: 6 })
        });
        vectorSource = new ol.source.Vector();
        reviewMap.addLayer(new ol.layer.Vector({ source: vectorSource }));
    }

    function pointStyle(color) {
        return new ol.style.Style({
            image: new ol.style.Circle({
                radius: 8,
                fill: new ol.style.Fill({ color: color }),
                stroke: new ol.style.Stroke({ color: '#fff', width: 2 })
            })
        });
    }

    function labelStyle(text) {
        return new ol.style.Style({
            text: new ol.style.Text({
                text: text,
                font: 'bold 12px sans-serif',
                fill: new ol.style.Fill({ color: '#fff' }),
                stroke: new ol.style.Stroke({ color: '#000', width: 3 }),
                offsetY: -10
            })
        });
    }

    function openReview() {
        ensureOverlay();
        els.overlay.style.display = 'flex';
        loadDecisions();
        if (hkRows) { cursor = firstUndecidedIndex(); renderCard(); return; }

        els.progress.textContent = '불러오는 중…';
        Promise.all([
            fetch('/accident_ships_hk.json').then(function (r) { return r.json(); }),
            fetch('/accident_geocode_candidates.json').then(function (r) { return r.json(); })
        ]).then(function (results) {
            hkRows = results[0].rows;
            var candIdx = results[1].origIndex;
            candidates = [];
            candIdx.forEach(function (origIndex) {
                var row = hkRows[origIndex];
                if (!row) return; // 그 사이 다른 라운드에서 삭제됐을 수 있음
                var parsed = parseDirectionDistance(row[POS_IDX] || '');
                if (parsed) candidates.push({ origIndex: origIndex, row: row, parsed: parsed });
            });
            cursor = firstUndecidedIndex();
            renderCard();
        }).catch(function (err) {
            els.progress.textContent = '데이터를 불러오지 못했습니다.';
            console.error('[accident_geocode_review] load failed', err);
        });
    }

    function firstUndecidedIndex() {
        for (var i = 0; i < candidates.length; i++) {
            if (!decisions[rowKey(candidates[i].row)]) return i;
        }
        return 0;
    }

    function closeReview() {
        els.overlay.style.display = 'none';
    }

    function move(delta) {
        if (!candidates.length) return;
        cursor = Math.max(0, Math.min(candidates.length - 1, cursor + delta));
        renderCard();
    }

    function judge(action) {
        var c = candidates[cursor];
        if (!c) return;
        if (action === 'relocate' && !c._expected) {
            window.alert('아직 텍스트 위치를 계산하지 못했습니다. 잠시 후 다시 시도해주세요.');
            return;
        }
        var entry = { action: action };
        if (action === 'relocate') {
            entry.lat = c._expected.lat;
            entry.lon = c._expected.lon;
        }
        decisions[rowKey(c.row)] = entry;
        saveDecisions();
        move(1);
    }

    function renderCard() {
        vectorSource.clear();
        var total = candidates.length;
        if (!total) { els.progress.textContent = '대상 없음'; return; }
        var c = candidates[cursor];
        var existing = decisions[rowKey(c.row)];
        els.progress.textContent = (cursor + 1) + ' / ' + total + (existing ? ' (판정됨: ' + labelForAction(existing.action) + ')' : '');
        els.pos.textContent = c.row[POS_IDX];
        els.ymd.textContent = formatYmd(c.row[2]);
        els.dist.textContent = '조회 중…';
        els.org.textContent = accidentLabel(ACCIDENT_ORG_LABELS, c.row[ORG_IDX]);
        els.base.textContent = '조회 중…';

        var actualLat = c.row[0], actualLon = c.row[1];
        var actualCoord = ol.proj.fromLonLat([actualLon, actualLat]);
        var actualFeature = new ol.Feature({ geometry: new ol.geom.Point(actualCoord) });
        actualFeature.setStyle(pointStyle('#3d8bff'));
        vectorSource.addFeature(actualFeature);

        // 저장좌표 마커 옆에 관할 해경서 이름 표시 — "이 관할서 소속인데 왜 여기 찍혀
        // 있지?"를 지도에서 바로 눈으로 판단할 수 있도록(2026-08-23 사용자 요청).
        var orgLabelFeature = new ol.Feature({ geometry: new ol.geom.Point(actualCoord) });
        orgLabelFeature.setStyle(labelStyle(els.org.textContent));
        vectorSource.addFeature(orgLabelFeature);

        reviewMap.getView().setCenter(actualCoord);
        reviewMap.getView().setZoom(9);

        geocode(c.parsed.base).then(function (baseCoord) {
            if (candidates[cursor] !== c) return; // 그새 다른 카드로 넘어갔으면 무시
            if (!baseCoord) {
                els.dist.textContent = '기준지명을 찾지 못했습니다("' + c.parsed.base + '")';
                els.base.textContent = '-';
                return;
            }
            c._baseCoord = baseCoord;

            // 기준지명 위치(초록) — 예: "욕지도"가 실제로 어디로 검색됐는지
            var baseCoordProj = ol.proj.fromLonLat([baseCoord.lon, baseCoord.lat]);
            var baseFeature = new ol.Feature({ geometry: new ol.geom.Point(baseCoordProj) });
            baseFeature.setStyle(pointStyle('#2ecc71'));
            vectorSource.addFeature(baseFeature);

            var expected = destinationPoint(baseCoord.lat, baseCoord.lon, c.parsed.bearingDeg, c.parsed.distanceKm);
            c._expected = expected;
            var expectedCoord = ol.proj.fromLonLat([expected.lon, expected.lat]);
            var expectedFeature = new ol.Feature({ geometry: new ol.geom.Point(expectedCoord) });
            expectedFeature.setStyle(pointStyle('#ff5f74'));
            vectorSource.addFeature(expectedFeature);

            var lineFeature = new ol.Feature({ geometry: new ol.geom.LineString([actualCoord, expectedCoord]) });
            lineFeature.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: '#ffd54a', width: 2, lineDash: [6, 4] })
            }));
            vectorSource.addFeature(lineFeature);

            // 기준지명 → 예상좌표: "욕지도"에서 실제로 파싱한 방위·거리만큼 이동했다는 걸 보여줌
            var baseLineFeature = new ol.Feature({ geometry: new ol.geom.LineString([baseCoordProj, expectedCoord]) });
            baseLineFeature.setStyle(new ol.style.Style({
                stroke: new ol.style.Stroke({ color: '#2ecc71', width: 2, lineDash: [2, 3] })
            }));
            vectorSource.addFeature(baseLineFeature);

            var km = haversineKm(actualLat, actualLon, expected.lat, expected.lon);
            var nm = km / 1.852;
            var midCoord = ol.proj.fromLonLat([(actualLon + expected.lon) / 2, (actualLat + expected.lat) / 2]);
            var labelFeature = new ol.Feature({ geometry: new ol.geom.Point(midCoord) });
            labelFeature.setStyle(labelStyle(km.toFixed(1) + 'km (' + nm.toFixed(1) + '해리)'));
            vectorSource.addFeature(labelFeature);

            els.dist.textContent = km.toFixed(1) + 'km / ' + nm.toFixed(1) + '해리';
            els.base.textContent = '"' + c.parsed.base + '" → (' + baseCoord.lat.toFixed(5) + ', ' + baseCoord.lon.toFixed(5) + ')에서 ' +
                c.parsed.distanceKm.toFixed(1) + 'km 이동해 텍스트 위치 계산';

            var extent = ol.extent.boundingExtent([actualCoord, expectedCoord, baseCoordProj]);
            reviewMap.getView().fit(extent, { padding: [60, 30, 160, 30], maxZoom: 13, duration: 250 });
        });
    }

    /**
     * 판정된 것을 전부 모아 내보낸다("유지"도 포함 — 판정이 끝난 건 서버 쪽 후보
     * 목록(client/accident_geocode_candidates.json)에서 빼야 다음에 다시 안 뜬다.
     * 이 화면 자체는 브라우저(localStorage)에만 저장하므로, 기기를 바꾸거나 캐시를
     * 지우면 판정 이력이 사라진다 — "내보내기"로 받은 결과를 실제 반영해야 영구적으로
     * 후보 목록에서 제외된다). decisions 객체를 직접 순회하지 않고 반드시 "지금 이
     * 세션에서 불러온 candidates 목록"을 기준으로 순회한다 — decisions 는 이전 회차의
     * 판정도 계속 들고 있는데(내용 기반 키라 서버 번호가 밀려도 안전하지만, 이미 서버에
     * 반영돼 후보 목록에서 빠진 행은 여전히 decisions 에 남아있을 수 있음), 그런 건 지금
     * candidates 에 없으므로 이렇게 하면 자동으로 내보내기에서 빠진다.
     */
    function exportResults() {
        var keepList = [];
        var deleteList = [];
        var relocateList = [];
        candidates.forEach(function (c) {
            var d = decisions[rowKey(c.row)];
            if (!d) return;
            if (d.action === 'keep') keepList.push(c.origIndex);
            else if (d.action === 'delete') deleteList.push(c.origIndex);
            else if (d.action === 'relocate') relocateList.push({ origIndex: c.origIndex, lat: d.lat, lon: d.lon });
        });
        var out = { hk_keep: keepList, hk_delete: deleteList, hk_relocate: relocateList };
        els.exportText.value = JSON.stringify(out);
        els.exportWrap.style.display = 'block';
    }

    /**
     * [트리거 비활성화(2026-08-23)] 사고정보 버튼 10회 연타는 이제 accident_info.js 의
     * 구 검수 모드(REVIEW_MODE, 마커를 직접 클릭해 플래그)를 여는 데 쓴다 — 이 화면의
     * 후보 목록(candidates.json)이 4회차 반영으로 이미 0건이 되어 더 볼 게 없어진 것과,
     * 트리거 하나를 두 화면이 동시에 쓸 수 없다는 것 둘 다가 이유(사용자 확정). bindTrigger()
     * 등 나머지 코드는 남겨두되(후보가 다시 생기면 재사용 가능) 실행되지 않도록 호출만 뺀다.
     */
    function init() {
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
