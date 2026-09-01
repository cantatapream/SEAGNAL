/**
 * ============================================================================
 * 파일명: js/marine-life/safety/accident_geocode_review_person.js
 * 역할  : 인명사고 카카오맵 지오코딩 대조 검수 화면. 위치텍스트("OO 동방 5마일",
 *         도분초 좌표 등)가 실제로 가리키는 곳과 데이터베이스에 저장된 좌표를
 *         지도 위에 나란히 찍고 선으로 이어 거리를 보여주며, 사람이 한 건씩
 *         "유지 / 텍스트 위치로 변경 / 삭제"를 판정한다.
 * [배경] local_server/scripts/accident_geocode_check.js(GitHub Actions에서 카카오
 *   API로 실행)가 21,798건 전수조사로 찾은 의심 후보 498건(30km 이상 어긋남,
 *   client/accident_geocode_suspects_person_ids.json)을 사람이 눈으로 최종
 *   확인하는 화면 — accident_geocode_review.js(hk 전용, Nominatim)의 person판.
 *   원본 데이터는 건드리지 않는다 — 판정 결과를 텍스트로 모아 "내보내기"만
 *   한다(실제 삭제·좌표수정은 그 결과를 받아 별도 스크립트로 반영).
 * [지오코딩] 브라우저에서 직접 카카오 API를 호출할 수 없어(도메인 인증 실패)
 *   서버 프록시(GET /api/search-place, routes/tide.js)를 거친다 — 해양종합정보
 *   탭의 장소검색과 같은 엔드포인트. 카드가 넘어갈 때마다 최대 1건만 조회하고
 *   같은 검색어는 캐시해 재사용한다.
 * [세 가지 방식(accident_geocode_check.js 와 동일 우선순위)]
 *   - coord    : 위치텍스트에 도분초 좌표가 그대로 박혀 있으면 그 좌표를 바로
 *                예상좌표로 씀(API 호출 없음, 가장 정확 — 사고 당시 실측값).
 *   - pattern  : "기준지명+방위+거리"가 있으면 기준지명을 검색해 방위·거리로
 *                예상좌표를 계산(정밀도 높음).
 *   - fulltext : 둘 다 없으면 위치텍스트를 정제해 그대로 검색(정확도 낮음,
 *                반드시 사람이 확인).
 * [세 가지 판정]
 *   - 유지            : 저장된 좌표가 맞다 — 아무 것도 안 함(내보내기 대상 아님)
 *   - 텍스트 위치로 변경 : 저장된 좌표가 틀렸고, 예상좌표가 맞다는 뜻
 *   - 삭제            : 어느 쪽도 못 믿겠다 — 행 자체를 삭제해야 한다는 뜻
 * [연계]
 *  - 트리거     : 이 파일 자체엔 없음 — accident_info.js 의 검수 서브모드 4단계
 *                 (사고정보 버튼 25회 연타, REVIEW_SUBMODE_KAKAO_PERSON)에서
 *                 window.AccidentGeocodeReviewPerson.open()/close() 를 호출한다.
 *  - 데이터     : /accident_persons.json(원본), /accident_geocode_suspects_person_ids.json
 *                 (카카오 전수조사로 뽑은 의심 후보 origIndex 498개)
 *  - 지도       : OpenLayers(전역 ol, ol.source.OSM()) — 앱의 다른 지도와 별개로
 *                 이 화면 전용 인스턴스를 새로 만든다(accident_geocode_review.js 와 동일)
 *  - 관할 표시  : accident_codes.js 의 ACCIDENT_ORG_LABELS·accidentLabel()
 * [로드 순서] accident_info.js·accident_geocode_review.js 다음(서브모드 연동 대상이
 *             먼저 정의돼 있어야 함, accident_codes.js 는 더 먼저)
 * ============================================================================
 */

(function () {
    'use strict';

    // ── 위치텍스트 파싱 (accident_geocode_check.js 와 동일 로직 — 2026-08-31 최종본) ──
    var DIR_PATTERN = /^(.*?)\s*((?:동남|동북|서남|서북|북동|북서|남동|남서)방?|(?:동|서|남|북)방)\s*([0-9.]+)\s*(마일|해리|km|m)/;
    var BEARING_DEG = {
        북: 0, 동북: 45, 북동: 45, 동: 90, 동남: 135, 남동: 135,
        남: 180, 서남: 225, 남서: 225, 서: 270, 서북: 315, 북서: 315,
    };
    function bearingKeyOf(rawBearing) {
        return rawBearing.charAt(rawBearing.length - 1) === '방' ? rawBearing.slice(0, -1) : rawBearing;
    }

    var LEADING_TAG_PATTERN = /^\[[^\]]*\]\s*/;
    var TRAILING_FILLER_WORDS = {
        해상: 1, 인근해상: 1, 인근: 1, 부근: 1, 앞: 1, 근처: 1, 끝단: 1, 사이: 1, 중: 1, 내: 1,
        TTP: 1, 테트라포트: 1, 테트라포드: 1, 항내: 1, 거주: 1, 근해: 1, 갯바위: 1, 해안가: 1, 갯벌: 1, 해변: 1, 앞바다: 1,
        내측: 1, 외측: 1, 아래: 1, 위: 1, 약: 1, 자택: 1, 밑: 1, 입구: 1, 주변: 1,
        동방: 1, 서방: 1, 남방: 1, 북방: 1, 동남방: 1, 동북방: 1, 서남방: 1, 서북방: 1, 북동방: 1, 북서방: 1, 남동방: 1, 남서방: 1,
    };
    var TRAILING_DISTANCE_ONLY = /^[0-9.]+(마일|해리|km|m)$/;

    function cleanKeyword(posText) {
        var text = posText.replace(LEADING_TAG_PATTERN, '').trim();
        var words = text.split(/\s+/);
        while (words.length > 1 && (TRAILING_FILLER_WORDS[words[words.length - 1]] || TRAILING_DISTANCE_ONLY.test(words[words.length - 1]))) {
            words.pop();
        }
        var stripped = words.join(' ').trim();
        return stripped || text;
    }

    function parseDirectionDistance(posText) {
        var m = posText.match(DIR_PATTERN);
        if (!m) return null;
        var base = cleanKeyword(m[1].trim());
        if (!base) return null;
        var bearingDeg = BEARING_DEG[bearingKeyOf(m[2])];
        var distanceKm = parseFloat(m[3]);
        if (m[4] === '마일' || m[4] === '해리') distanceKm *= 1.852;
        else if (m[4] === 'm') distanceKm /= 1000;
        return { base: base, bearingDeg: bearingDeg, distanceKm: distanceKm };
    }

    var DMS_PATTERN = /(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*N\D{0,6}(\d{1,3})-(\d{1,2}(?:\.\d+)?)(?:-(\d{1,2}(?:\.\d+)?))?\s*E/i;
    function dmsToDecimal(deg, min, sec) {
        return parseInt(deg, 10) + parseFloat(min) / 60 + (sec ? parseFloat(sec) : 0) / 3600;
    }
    function parseEmbeddedCoord(posText) {
        var m = posText.match(DMS_PATTERN);
        if (!m) return null;
        var minOk = function (v) { return !v || (parseFloat(v) >= 0 && parseFloat(v) < 60); };
        if (!minOk(m[2]) || !minOk(m[3]) || !minOk(m[5]) || !minOk(m[6])) return null;
        return { lat: dmsToDecimal(m[1], m[2], m[3]), lon: dmsToDecimal(m[4], m[5], m[6]) };
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

    // ── 지오코딩(서버 프록시 /api/search-place, 검색어별 메모리 캐시) ──
    var _geocodeCache = {};
    function geocode(query, refLat, refLon) {
        if (Object.prototype.hasOwnProperty.call(_geocodeCache, query)) {
            return Promise.resolve(_geocodeCache[query]);
        }
        var url = '/api/search-place?q=' + encodeURIComponent(query);
        return fetch(url).then(function (res) { return res.json(); }).then(function (data) {
            var docs = (data && data.documents) || [];
            if (!docs.length) { _geocodeCache[query] = null; return null; }
            var best = docs[0], bestDist = Infinity;
            docs.forEach(function (d) {
                var lat = parseFloat(d.y), lon = parseFloat(d.x);
                var dist = haversineKm(refLat, refLon, lat, lon);
                if (dist < bestDist) { bestDist = dist; best = d; }
            });
            var result = { lat: parseFloat(best.y), lon: parseFloat(best.x) };
            _geocodeCache[query] = result;
            return result;
        }).catch(function () { _geocodeCache[query] = null; return null; });
    }

    // ── 상태 ────────────────────────────────────────────────────────────
    var POS_IDX = 3; // person 행: [lat, lon, ymd, pos, typeCd, orgCd, prsn, rescue, death, missing]
    var ORG_IDX = 5;
    var personRows = null;
    var candidates = []; // [{origIndex, row, mode:'coord'|'pattern'|'fulltext', parsed}]
    var cursor = 0;
    var decisions = {};
    var STORAGE_KEY = 'personGeocodeReviewDecisions_v1';

    function rowKey(row) {
        return row[2] + '|' + row[3] + '|' + row[0] + '|' + row[1];
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
    var MODE_LABEL = { coord: 'coord(도분초 실측좌표)', pattern: 'pattern(기준지명+방위·거리)', fulltext: 'fulltext(전체검색, 신뢰도 낮음)' };

    // ── DOM / 지도 ──────────────────────────────────────────────────────
    var els = {};
    var reviewMap = null;
    var vectorSource = null;

    function ensureOverlay() {
        if (document.getElementById('agrp-overlay')) return;
        var style = document.createElement('style');
        style.textContent =
            '#agrp-overlay{position:fixed;inset:0;z-index:2000;background:#0d1114;display:flex;flex-direction:column;font-family:sans-serif;color:#fff;}' +
            '#agrp-hdr{flex:none;display:flex;align-items:center;gap:8px;padding:10px 12px;background:#161c21;border-bottom:1px solid #2a333a;}' +
            '#agrp-hdr b{font-size:14px;}' +
            '#agrp-progress{margin-left:auto;font-size:12px;color:#aaa;}' +
            '#agrp-close{background:none;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:0 6px;}' +
            '#agrp-map{flex:1;min-height:0;}' +
            '#agrp-info{flex:none;padding:10px 12px;background:#161c21;border-top:1px solid #2a333a;font-size:12px;line-height:1.6;}' +
            '#agrp-info .agrp-pos{font-weight:700;color:#ffb454;}' +
            '#agrp-mode{font-weight:700;color:#7fd4ff;}' +
            '#agrp-dist{font-weight:700;}' +
            '.agrp-legend{display:flex;gap:12px;font-size:11px;color:#aaa;margin-top:4px;flex-wrap:wrap;}' +
            '.agrp-legend span{display:inline-flex;align-items:center;gap:4px;}' +
            '.agrp-dot{width:9px;height:9px;border-radius:50%;display:inline-block;}' +
            '#agrp-actions{flex:none;display:flex;gap:6px;padding:10px 12px 0;}' +
            '#agrp-actions button{flex:1;padding:12px 4px;border-radius:8px;border:1px solid #444;background:#22292f;color:#fff;font-size:13px;font-weight:700;cursor:pointer;}' +
            '#agrp-actions button.agrp-keep{border-color:#3d8bff;color:#3d8bff;}' +
            '#agrp-actions button.agrp-relocate{border-color:#ffb454;color:#ffb454;}' +
            '#agrp-actions button.agrp-delete{border-color:#ff5f74;color:#ff5f74;}' +
            '#agrp-nav{flex:none;display:flex;gap:6px;padding:8px 12px 12px;}' +
            '#agrp-nav button{flex:1;padding:8px;border-radius:6px;border:1px solid #444;background:#1b2126;color:#ccc;font-size:12px;cursor:pointer;}' +
            '#agrp-export-wrap{flex:none;padding:0 12px 12px;}' +
            '#agrp-export-wrap textarea{width:100%;height:80px;font-size:11px;border-radius:6px;border:1px solid #555;background:#11161a;color:#fff;padding:6px;box-sizing:border-box;}';
        document.head.appendChild(style);

        var overlay = document.createElement('div');
        overlay.id = 'agrp-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML =
            '<div id="agrp-hdr"><b>인명사고 카카오 지오코딩 검수</b><span id="agrp-progress"></span><button id="agrp-close" aria-label="닫기">&times;</button></div>' +
            '<div id="agrp-map"></div>' +
            '<div id="agrp-info">' +
            '<div>위치텍스트: <span class="agrp-pos" id="agrp-pos">-</span></div>' +
            '<div>발생일자: <span id="agrp-ymd">-</span> · 방식: <span id="agrp-mode">-</span></div>' +
            '<div>어긋난 거리: <span id="agrp-dist">-</span> · 관할: <span id="agrp-org">-</span></div>' +
            '<div id="agrp-detail">-</div>' +
            '<div class="agrp-legend"><span><i class="agrp-dot" style="background:#3d8bff"></i>저장된 좌표</span><span><i class="agrp-dot" style="background:#2ecc71"></i>기준지명 위치</span><span><i class="agrp-dot" style="background:#ff5f74"></i>텍스트가 가리키는 곳(예상좌표)</span></div>' +
            '</div>' +
            '<div id="agrp-actions">' +
            '<button type="button" class="agrp-keep" id="agrp-btn-keep">유지</button>' +
            '<button type="button" class="agrp-relocate" id="agrp-btn-relocate">텍스트 위치로 변경</button>' +
            '<button type="button" class="agrp-delete" id="agrp-btn-delete">삭제</button>' +
            '</div>' +
            '<div id="agrp-nav"><button type="button" id="agrp-prev">◀ 이전</button><button type="button" id="agrp-skip">건너뛰기 ▶</button><button type="button" id="agrp-export">내보내기</button></div>' +
            '<div id="agrp-export-wrap" style="display:none;"><textarea id="agrp-export-text" readonly></textarea></div>';
        document.body.appendChild(overlay);

        els.overlay = overlay;
        els.progress = document.getElementById('agrp-progress');
        els.pos = document.getElementById('agrp-pos');
        els.ymd = document.getElementById('agrp-ymd');
        els.mode = document.getElementById('agrp-mode');
        els.dist = document.getElementById('agrp-dist');
        els.org = document.getElementById('agrp-org');
        els.detail = document.getElementById('agrp-detail');
        els.exportWrap = document.getElementById('agrp-export-wrap');
        els.exportText = document.getElementById('agrp-export-text');

        document.getElementById('agrp-close').addEventListener('click', closeReview);
        document.getElementById('agrp-btn-keep').addEventListener('click', function () { judge('keep'); });
        document.getElementById('agrp-btn-relocate').addEventListener('click', function () { judge('relocate'); });
        document.getElementById('agrp-btn-delete').addEventListener('click', function () { judge('delete'); });
        document.getElementById('agrp-prev').addEventListener('click', function () { move(-1); });
        document.getElementById('agrp-skip').addEventListener('click', function () { move(1); });
        document.getElementById('agrp-export').addEventListener('click', exportResults);

        reviewMap = new ol.Map({
            target: 'agrp-map',
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
        if (personRows) { cursor = firstUndecidedIndex(); renderCard(); return; }

        els.progress.textContent = '불러오는 중…';
        Promise.all([
            fetch('/accident_persons.json').then(function (r) { return r.json(); }),
            fetch('/accident_geocode_suspects_person_ids.json').then(function (r) { return r.json(); })
        ]).then(function (results) {
            personRows = results[0].rows;
            var candIdx = results[1].origIndex;
            candidates = [];
            candIdx.forEach(function (origIndex) {
                var row = personRows[origIndex];
                if (!row) return; // 그 사이 다른 작업에서 삭제됐을 수 있음
                var pos = row[POS_IDX] || '';
                var coord = parseEmbeddedCoord(pos);
                var dir = coord ? null : parseDirectionDistance(pos);
                var parsed = coord ? { mode: 'coord', lat: coord.lat, lon: coord.lon }
                    : dir ? { mode: 'pattern', base: dir.base, bearingDeg: dir.bearingDeg, distanceKm: dir.distanceKm }
                        : { mode: 'fulltext', query: cleanKeyword(pos) };
                candidates.push({ origIndex: origIndex, row: row, parsed: parsed });
            });
            cursor = firstUndecidedIndex();
            renderCard();
        }).catch(function (err) {
            els.progress.textContent = '데이터를 불러오지 못했습니다.';
            console.error('[accident_geocode_review_person] load failed', err);
        });
    }

    function firstUndecidedIndex() {
        for (var i = 0; i < candidates.length; i++) {
            if (!decisions[rowKey(candidates[i].row)]) return i;
        }
        return 0;
    }

    function closeReview() {
        if (els.overlay) els.overlay.style.display = 'none';
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
            window.alert('아직 예상좌표를 계산하지 못했습니다. 잠시 후 다시 시도해주세요.');
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
        els.mode.textContent = MODE_LABEL[c.parsed.mode];
        els.dist.textContent = '조회 중…';
        els.org.textContent = (typeof accidentLabel === 'function' && typeof ACCIDENT_ORG_LABELS !== 'undefined')
            ? accidentLabel(ACCIDENT_ORG_LABELS, c.row[ORG_IDX]) : String(c.row[ORG_IDX] || '-');
        els.detail.textContent = '-';

        var actualLat = c.row[0], actualLon = c.row[1];
        var actualCoord = ol.proj.fromLonLat([actualLon, actualLat]);
        var actualFeature = new ol.Feature({ geometry: new ol.geom.Point(actualCoord) });
        actualFeature.setStyle(pointStyle('#3d8bff'));
        vectorSource.addFeature(actualFeature);

        var orgLabelFeature = new ol.Feature({ geometry: new ol.geom.Point(actualCoord) });
        orgLabelFeature.setStyle(labelStyle(els.org.textContent));
        vectorSource.addFeature(orgLabelFeature);

        reviewMap.getView().setCenter(actualCoord);
        reviewMap.getView().setZoom(9);

        function drawExpected(expected, baseCoordProj) {
            if (candidates[cursor] !== c) return; // 그새 다른 카드로 넘어갔으면 무시
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

            var extentPoints = [actualCoord, expectedCoord];
            if (baseCoordProj) {
                var baseFeature = new ol.Feature({ geometry: new ol.geom.Point(baseCoordProj) });
                baseFeature.setStyle(pointStyle('#2ecc71'));
                vectorSource.addFeature(baseFeature);
                var baseLineFeature = new ol.Feature({ geometry: new ol.geom.LineString([baseCoordProj, expectedCoord]) });
                baseLineFeature.setStyle(new ol.style.Style({
                    stroke: new ol.style.Stroke({ color: '#2ecc71', width: 2, lineDash: [2, 3] })
                }));
                vectorSource.addFeature(baseLineFeature);
                extentPoints.push(baseCoordProj);
            }

            var km = haversineKm(actualLat, actualLon, expected.lat, expected.lon);
            var nm = km / 1.852;
            var midCoord = ol.proj.fromLonLat([(actualLon + expected.lon) / 2, (actualLat + expected.lat) / 2]);
            var labelFeature = new ol.Feature({ geometry: new ol.geom.Point(midCoord) });
            labelFeature.setStyle(labelStyle(km.toFixed(1) + 'km (' + nm.toFixed(1) + '해리)'));
            vectorSource.addFeature(labelFeature);

            els.dist.textContent = km.toFixed(1) + 'km / ' + nm.toFixed(1) + '해리';

            var extent = ol.extent.boundingExtent(extentPoints);
            reviewMap.getView().fit(extent, { padding: [60, 30, 160, 30], maxZoom: 13, duration: 250 });
        }

        if (c.parsed.mode === 'coord') {
            els.detail.textContent = '위치텍스트에 박힌 도분초 좌표를 API 호출 없이 그대로 씀(가장 정확).';
            drawExpected({ lat: c.parsed.lat, lon: c.parsed.lon }, null);
            return;
        }

        if (c.parsed.mode === 'pattern') {
            geocode(c.parsed.base, actualLat, actualLon).then(function (baseCoord) {
                if (candidates[cursor] !== c) return;
                if (!baseCoord) {
                    els.dist.textContent = '기준지명을 찾지 못했습니다("' + c.parsed.base + '")';
                    els.detail.textContent = '-';
                    return;
                }
                var baseCoordProj = ol.proj.fromLonLat([baseCoord.lon, baseCoord.lat]);
                var expected = destinationPoint(baseCoord.lat, baseCoord.lon, c.parsed.bearingDeg, c.parsed.distanceKm);
                els.detail.textContent = '"' + c.parsed.base + '" → (' + baseCoord.lat.toFixed(5) + ', ' + baseCoord.lon.toFixed(5) + ')에서 ' +
                    c.parsed.distanceKm.toFixed(1) + 'km 이동해 텍스트 위치 계산';
                drawExpected(expected, baseCoordProj);
            });
            return;
        }

        // fulltext
        geocode(c.parsed.query, actualLat, actualLon).then(function (found) {
            if (candidates[cursor] !== c) return;
            if (!found) {
                els.dist.textContent = '검색 결과 없음("' + c.parsed.query + '")';
                els.detail.textContent = '-';
                return;
            }
            els.detail.textContent = '검색어 "' + c.parsed.query + '" (신뢰도 낮음 — 반드시 지도로 확인)';
            drawExpected(found, null);
        });
    }

    /** [내보내기] 판정된 것을 전부 모은다("유지"도 포함 — 판정이 끝난 건 서버 쪽 후보
     * 목록(client/accident_geocode_suspects_person_ids.json)에서 빼야 다음에 다시 안 뜬다).
     * decisions 를 직접 순회하지 않고 "지금 이 세션에서 불러온 candidates 목록"을 기준으로
     * 순회한다 — accident_geocode_review.js 와 동일 원칙(서버 번호가 밀려도 안전). */
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
        var out = { person_keep: keepList, person_delete: deleteList, person_relocate: relocateList };
        els.exportText.value = JSON.stringify(out);
        els.exportWrap.style.display = 'block';
    }

    window.AccidentGeocodeReviewPerson = { open: openReview, close: closeReview };
})();
