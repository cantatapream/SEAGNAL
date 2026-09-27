/**
 * ============================================================================
 * admin_location_status.js — 관리자 센터 "위치 기반" 탭
 * 역할  : 관리자 센터 "위치 기반" 탭 — 이 기기가 수집·저장한 최신 GPS 위치 표시
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : location-alert/location_alert_core.js(LocationAlertCore.locateZone 재사용), OpenLayers+OSM(CDN — 팝업 지도), Capacitor Preferences(네이티브 저장 위치 읽기)
 *  - 서버 API      : 없음 (완전 온-디바이스 — localStorage/Preferences 만 읽음)
 *  - 마크업        : index2.html 탭 컨테이너에 주입 (#locstat-coords, #locstat-map, #locstat-sealand, #locstat-wake 등)
 *  - 나를 쓰는 곳  : admin.js ('위치 기반' 탭 선택 시 window.renderLocationStatusTab 호출)
 * ============================================================================
 * 이 관리자 기기가 위치기반 특보(④)를 위해 수집·저장한 최신 GPS 위치를 보여준다.
 *   - 저장 위치: POS_KEY(location_alert_last_pos) = {lat,lng,acc,at,src}
 *       · Preferences(네이티브 killed wake 가 씀) 우선 → localStorage. 둘 다면 최신(at).
 *   - 표시: 위/경도, 정확도, 출처, 마지막 수집 시각(상대+절대)
 *   - 해상/육상 구분: LocationAlertCore.locateZone 재사용 — 해역 폴리곤 내부면 해상(해역명),
 *       아니면 육상/해역 밖. (알림 엔진의 off-sea 판정과 동일 기준)
 *   - 좌표 옆 핀 버튼 → 별도 팝업 지도(OpenLayers + OSM)에 그 위치를 마커로 표출
 *   - 참고 진단: 마지막 wake 처리 / 마지막 위치기반 판정
 * 완전 온-디바이스: 위치는 이 기기에 저장된 값을 읽을 뿐, 단말 밖으로 전송하지 않는다.
 * ============================================================================
 */
(function () {
    'use strict';

    var POS_KEY = 'location_alert_last_pos';
    var MATCH_KEY = 'location_alert_last_match';
    var WAKE_KEY = 'location_alert_last_wake';

    var WAKE_LABELS = {
        'notified': '알림 발송됨',
        'off-sea': '육지/해역 밖(무시)',
        'no-warning': '특보 없음',
        'no-match': '해당 구역 없음',
        'no-position': '위치 수집 실패',
        'stale-skip': '낡은 위치(무시)',
        'disabled-skip': '비활성/미동의(스킵)',
        'suberror': '처리 오류'
    };

    // Preferences 우선 조회(네이티브 killed 가 CapacitorStorage 에만 쓰므로) → 실패 시 localStorage.
    async function readPrefFirst(key) {
        try {
            var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
            if (P && P.get) {
                var r = await P.get({ key: key });
                if (r && r.value) return r.value;
            }
        } catch (_) { /* noop */ }
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    // 저장 위치(POS_KEY) — Preferences 우선, localStorage 폴백, 둘 다면 at 최신.
    async function readPos() {
        var prefRec = null, lsRec = null;
        try {
            var P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
            if (P && P.get) {
                var r = await P.get({ key: POS_KEY });
                if (r && r.value) { try { prefRec = JSON.parse(r.value); } catch (_) { prefRec = null; } }
            }
        } catch (_) { /* noop */ }
        try {
            var raw = (window.LocationAlertBackground && window.LocationAlertBackground.getPosition)
                ? window.LocationAlertBackground.getPosition()
                : JSON.parse(localStorage.getItem(POS_KEY));
            lsRec = raw || null;
        } catch (_) { lsRec = null; }
        if (!prefRec) return lsRec;
        if (!lsRec) return prefRec;
        var tp = Date.parse(prefRec.at || ''), tl = Date.parse(lsRec.at || '');
        if (Number.isFinite(tp) && Number.isFinite(tl)) return tp >= tl ? prefRec : lsRec;
        return prefRec;
    }

    function fmtAgo(at) {
        var t = Date.parse(at || '');
        if (!Number.isFinite(t)) return '시각 미상';
        var m = Math.round((Date.now() - t) / 60000);
        if (m < 1) return '방금';
        if (m < 60) return m + '분 전';
        var h = Math.floor(m / 60);
        if (h < 24) return h + '시간 ' + (m % 60) + '분 전';
        return Math.floor(h / 24) + '일 전';
    }
    function fmtAbs(at) {
        var t = Date.parse(at || '');
        if (!Number.isFinite(t)) return '';
        var d = new Date(t);
        var p = function (n) { return (n < 10 ? '0' : '') + n; };
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
        });
    }

    // 해상/육상 판정: 해역 폴리곤(warn_zones) 내부면 해상(해역명), 아니면 육상/해역 밖.
    async function seaLandOf(lat, lng, acc) {
        try {
            if (!window.LocationAlertRuntime || !window.LocationAlertRuntime.loadFeatures
                || !window.LocationAlertCore || !window.LocationAlertCore.locateZone) return null;
            var features = await window.LocationAlertRuntime.loadFeatures();
            if (!features || !features.length) return null;
            var z = window.LocationAlertCore.locateZone({ lat: lat, lng: lng }, features, acc || 0);
            if (z && z.feature) return { sea: true, zone: (z.feature.properties && z.feature.properties.name) || '', gray: !!z.grayZone };
            return { sea: false, zone: null, gray: false };
        } catch (e) {
            // ★조용히 넘어가지 않는다 (3-44). **해역 판정 칸이 빈 채로** 그려진다 —
            //   「바다 밖이다」와 「판정을 못 했다」가 구분되지 않았다.
            console.warn('[관리자] 해역 판정 실패 — 해역 칸 없이 그린다:', e && e.message);
            return null;
        }
    }

    // ── 렌더 ────────────────────────────────────────────────────────────────
    window.renderLocationStatusTab = function (container) {
        if (!container) return;
        container.innerHTML =
            '<div class="admin-section-title">' +
            '  <span><i class="fa-solid fa-location-dot" style="color:#34d399;"></i> 위치 기반 · 수집 위치</span>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px;margin-bottom:12px;">' +
            '  <div style="font-size:0.82rem;color:#94a3b8;margin-bottom:6px;">현재 저장된 위치 (이 관리자 기기)</div>' +
            '  <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">' +
            '    <span id="locstat-coords" style="font-size:1.15rem;font-weight:800;color:#e2e8f0;letter-spacing:.2px;">— , —</span>' +
            '    <button id="locstat-pin" title="지도에서 이 위치 보기" ' +
            '      style="width:38px;height:38px;border-radius:9px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;border:none;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(37,99,235,.4);">' +
            '      <i class="fa-solid fa-map-location-dot"></i></button>' +
            '  </div>' +
            '  <div id="locstat-meta" style="font-size:0.82rem;color:#94a3b8;margin-top:8px;">불러오는 중…</div>' +
            '  <div style="margin-top:10px;"><span id="locstat-sealand" style="display:inline-block;padding:4px 12px;border-radius:999px;font-size:0.82rem;font-weight:700;background:rgba(148,163,184,.15);color:#cbd5e1;">해상/육상 판정 중…</span></div>' +
            '  <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">' +
            '    <button onclick="window.locationStatusRecollect()" style="padding:8px 14px;border-radius:8px;background:#059669;color:#fff;border:none;font-weight:700;font-size:0.82rem;cursor:pointer;"><i class="fa-solid fa-location-crosshairs"></i> 지금 다시 수집</button>' +
            '    <button onclick="window.locationStatusRefresh()" style="padding:8px 14px;border-radius:8px;background:rgba(255,255,255,.08);color:#e2e8f0;border:none;font-weight:700;font-size:0.82rem;cursor:pointer;"><i class="fa-solid fa-rotate"></i> 새로고침</button>' +
            '  </div>' +
            '</div>' +
            '<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:12px;padding:14px;">' +
            '  <div style="font-size:0.8rem;color:#94a3b8;margin-bottom:8px;">진단 (참고)</div>' +
            '  <div id="locstat-wake" style="font-size:0.82rem;color:#cbd5e1;line-height:1.5;">마지막 wake 처리: 불러오는 중…</div>' +
            '  <div id="locstat-match" style="font-size:0.82rem;color:#cbd5e1;line-height:1.5;margin-top:6px;">마지막 위치기반 판정: 불러오는 중…</div>' +
            '</div>' +
            '<div style="font-size:0.75rem;color:#64748b;margin-top:10px;line-height:1.5;">' +
            '  ※ 이 위치는 이 관리자 기기에 저장된 최신 1건입니다. 특보 발표·앱 실행 시 그 순간 1회 수집되며, 단말 밖으로 전송되지 않습니다.' +
            '</div>';

        var pinBtn = document.getElementById('locstat-pin');
        if (pinBtn) pinBtn.onclick = function () {
            if (window.__locstatPos && Number.isFinite(window.__locstatPos.lat) && Number.isFinite(window.__locstatPos.lng)) {
                window.openLocationMapPopup(window.__locstatPos.lat, window.__locstatPos.lng);
            } else {
                if (typeof toast === 'function') toast('표시할 수집 위치가 없습니다.');
                else alert('표시할 수집 위치가 없습니다.');
            }
        };

        window.locationStatusRefresh();
    };

    window.locationStatusRefresh = async function () {
        var pos = await readPos();
        window.__locstatPos = pos && Number.isFinite(Number(pos.lat)) && Number.isFinite(Number(pos.lng))
            ? { lat: Number(pos.lat), lng: Number(pos.lng) } : null;

        var coordsEl = document.getElementById('locstat-coords');
        var metaEl = document.getElementById('locstat-meta');
        var slEl = document.getElementById('locstat-sealand');

        if (!pos || window.__locstatPos == null) {
            if (coordsEl) coordsEl.textContent = '— , —';
            if (metaEl) metaEl.innerHTML = '<span style="color:#fbbf24;">저장된 위치 없음</span> — 위치기반 특보 동의 후 특보 발표 또는 앱 실행 시 수집됩니다.';
            if (slEl) { slEl.textContent = '위치 없음'; slEl.style.background = 'rgba(148,163,184,.15)'; slEl.style.color = '#cbd5e1'; }
        } else {
            var lat = Number(pos.lat), lng = Number(pos.lng);
            if (coordsEl) coordsEl.textContent = lat.toFixed(6) + ', ' + lng.toFixed(6);
            if (metaEl) {
                metaEl.innerHTML = '정확도 <b>±' + (pos.acc != null ? Math.round(Number(pos.acc)) : '?') + 'm</b>'
                    + ' · 출처 <b>' + esc(pos.src || 'gps') + '</b>'
                    + ' · 마지막 수집 <b>' + fmtAgo(pos.at) + '</b>'
                    + (fmtAbs(pos.at) ? ' <span style="color:#64748b;">(' + fmtAbs(pos.at) + ')</span>' : '');
            }
            if (slEl) {
                slEl.textContent = '해상/육상 판정 중…';
                seaLandOf(lat, lng, pos.acc).then(function (r) {
                    if (!slEl) return;
                    if (r == null) {
                        slEl.textContent = '해상/육상 판정 불가(구역 데이터 없음)';
                        slEl.style.background = 'rgba(148,163,184,.15)'; slEl.style.color = '#cbd5e1';
                    } else if (r.sea) {
                        slEl.innerHTML = '<i class="fa-solid fa-water"></i> 해상' + (r.zone ? ' · ' + esc(r.zone) : '') + (r.gray ? ' (경계 인접)' : '');
                        slEl.style.background = 'rgba(6,182,212,.18)'; slEl.style.color = '#67e8f9';
                    } else {
                        slEl.innerHTML = '<i class="fa-solid fa-mountain-sun"></i> 육상 / 해역 밖';
                        slEl.style.background = 'rgba(251,146,60,.16)'; slEl.style.color = '#fdba74';
                    }
                });
            }
        }

        // 진단: 마지막 wake / 마지막 판정
        var wakeEl = document.getElementById('locstat-wake');
        if (wakeEl) {
            var rawW = await readPrefFirst(WAKE_KEY);
            var w = null; try { w = rawW ? JSON.parse(rawW) : null; } catch (_) { w = null; }
            if (w) {
                var coords = (w.lat != null && w.lng != null) ? (Number(w.lat).toFixed(4) + ', ' + Number(w.lng).toFixed(4)) : '-';
                wakeEl.innerHTML = '마지막 wake 처리: <b>' + fmtAgo(w.at) + '</b>'
                    + ' · 결과 <b>' + esc(WAKE_LABELS[w.outcome] || w.outcome || '-') + '</b>'
                    + ' · 출처 <b>' + esc(w.src || '-') + '</b>'
                    + ' · 좌표 ' + coords
                    + (w.zone ? ' · 구역 ' + esc(w.zone) : '');
            } else {
                wakeEl.innerHTML = '마지막 wake 처리: <span style="color:#64748b;">없음 (이 기기에서 처리된 적 없음)</span>';
            }
        }
        var matchEl = document.getElementById('locstat-match');
        if (matchEl) {
            var rawM = await readPrefFirst(MATCH_KEY);
            var mm = null; try { mm = rawM ? JSON.parse(rawM) : null; } catch (_) { mm = null; }
            if (mm) {
                matchEl.innerHTML = '마지막 위치기반 판정: 구역 <b>' + esc(mm.zone || '-') + '</b>'
                    + ' · 출처 <b>' + esc(mm.src || '-') + '</b>'
                    + (mm.tier ? ' · 단계 <b>' + esc(mm.tier) + '</b>' : '')
                    + ' · <b>' + fmtAgo(mm.at) + '</b>';
            } else {
                matchEl.innerHTML = '마지막 위치기반 판정: <span style="color:#64748b;">없음</span>';
            }
        }
    };

    // "지금 다시 수집" — 실제 fresh-fix 1회 수행 후 재표시.
    window.locationStatusRecollect = async function () {
        var BG = window.LocationAlertBackground;
        if (!BG || typeof BG.getFreshPosition !== 'function') {
            if (typeof toast === 'function') toast('위치 수집 모듈을 사용할 수 없습니다.');
            return;
        }
        var slEl = document.getElementById('locstat-sealand');
        if (slEl) { slEl.textContent = '위치 수집 중…'; }
        try { await BG.getFreshPosition(); } catch (e) {
            // ★조용히 넘어가지 않는다 (3-44). **마지막 저장 위치가 그대로 보인다** —
            //   방금 받은 위치라고 오해할 수 있다.
            console.warn('[관리자] 위치 새로 받기 실패 — 마지막 저장 위치를 보여 준다:', e && e.message);
        }
        window.locationStatusRefresh();
    };

    // ── 별도 팝업 지도(OpenLayers + OSM) ───────────────────────────────────────
    window.openLocationMapPopup = function (lat, lng, label) {
        if (document.getElementById('locstat-map-overlay')) return;
        if (typeof ol === 'undefined') {
            if (typeof toast === 'function') toast('지도 라이브러리를 불러오지 못했습니다.');
            else alert('지도 라이브러리를 불러오지 못했습니다.');
            return;
        }
        var ov = document.createElement('div');
        ov.id = 'locstat-map-overlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0b1220;display:flex;flex-direction:column;';
        ov.innerHTML =
            '<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#111827;color:#fff;">' +
            '  <div style="font-weight:700;font-size:0.95rem;"><i class="fa-solid fa-map-location-dot" style="color:#60a5fa;"></i> ' + esc(label || '수집 위치') + '</div>' +
            '  <button onclick="window.closeLocationMapPopup()" aria-label="닫기" style="width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;border:1px solid rgba(255,255,255,.25);font-size:1.1rem;cursor:pointer;">✕</button>' +
            '</div>' +
            '<div id="locstat-map" style="flex:1 1 auto;min-height:0;width:100%;background:#0b1220;"></div>' +
            '<div style="padding:9px 16px;background:#111827;color:#cbd5e1;font-size:0.82rem;text-align:center;">' + lat.toFixed(6) + ', ' + lng.toFixed(6) + '</div>';
        document.body.appendChild(ov);
        if (window.PopupStack) { try { window.PopupStack.push('locstat-map-overlay', window.closeLocationMapPopup); } catch (e) { /* noop */ } }

        try {
            var center = ol.proj.fromLonLat([lng, lat]);
            var marker = new ol.Feature({ geometry: new ol.geom.Point(center) });
            marker.setStyle(new ol.style.Style({
                image: new ol.style.Circle({
                    radius: 9,
                    fill: new ol.style.Fill({ color: 'rgba(37,99,235,0.92)' }),
                    stroke: new ol.style.Stroke({ color: '#ffffff', width: 3 })
                })
            }));
            var vsrc = new ol.source.Vector({ features: [marker] });
            window.__locstatMap = new ol.Map({
                target: 'locstat-map',
                layers: [
                    new ol.layer.Tile({ source: new ol.source.OSM() }),
                    new ol.layer.Vector({ source: vsrc })
                ],
                view: new ol.View({ center: center, zoom: 11, maxZoom: 18 }),
                controls: []
            });
            setTimeout(function () { try { window.__locstatMap.updateSize(); } catch (e) { /* noop */ } }, 120);
        } catch (e) {
            var mapEl = document.getElementById('locstat-map');
            if (mapEl) mapEl.innerHTML = '<div style="color:#fca5a5;padding:20px;text-align:center;">지도를 표시하지 못했습니다: ' + esc(e && e.message) + '</div>';
        }
    };

    window.closeLocationMapPopup = function () {
        try { if (window.__locstatMap) { window.__locstatMap.setTarget(null); window.__locstatMap = null; } } catch (e) { /* noop */ }
        var ov = document.getElementById('locstat-map-overlay');
        if (ov) ov.remove();
        if (window.PopupStack) { try { window.PopupStack.remove('locstat-map-overlay'); } catch (e) { /* noop */ } }
    };
})();
