/**
 * ============================================================================
 * 파일명: scripts/hazard_rocks_ocr_fetch.js
 * 역할: 노출암 고립판정 OCR 검증용 — 좌표 하나의 KHOA 전자해도 타일(z16 3x3 +
 *   z12 광역)을 받아온다. hazard_rocks_ocr_stitch.py 가 이걸 정밀 크롭한다.
 * ============================================================================
 * 사용법: node hazard_rocks_ocr_fetch.js <label> <lat> <lon> <outDir>
 * 산출물: <outDir>/<label>_t{col}_{row}.png (z16 9장) + <label>_wideraw.png(z12)
 *         + <label>_meta.json(스티칭에 필요한 좌표/타일 정보)
 * 의존성: 로컬 서버(local_server) 가 3001 포트에서 떠 있어야 함 —
 *   GET /api/ocean/khoa-wms 프록시(routes/ocean1.js)를 그대로 재사용해 KHOA
 *   WMS 타일을 받는다. 프록시가 죽어 있으면 이 스크립트도 실패한다.
 * [연계]
 *   - hazard_rocks_ocr_stitch.py → 이 산출물을 스티칭+정밀크롭
 *   - hazard_rocks_ocr_build_review.py → 최종 검토 페이지 생성
 *   - HAZARD_ROCKS_HANDOFF.md §6.4/§6.7 → 방법론·재사용 가이드
 * ============================================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const [, , label, latStr, lonStr, outDirArg] = process.argv;
const lat = parseFloat(latStr), lon = parseFloat(lonStr);
const outDir = outDirArg || '/tmp/ocr_batch';
fs.mkdirSync(outDir, { recursive: true });

const R = 6378137;
const ORIGIN_X = -Math.PI * R;
const ORIGIN_Y = Math.PI * R;

function latLonToMercator(lat, lon) {
    const x = lon * (Math.PI / 180) * R;
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
    return { x, y };
}
function tileXY(x, y, zoom) {
    const tileSize = 2 * Math.PI * R / Math.pow(2, zoom);
    const tx = Math.floor((x - ORIGIN_X) / tileSize);
    const ty = Math.floor((ORIGIN_Y - y) / tileSize);
    return { tx, ty, tileSize };
}
function tileBboxOf(tx, ty, tileSize) {
    const minX = ORIGIN_X + tx * tileSize;
    const maxX = minX + tileSize;
    const maxY = ORIGIN_Y - ty * tileSize;
    const minY = maxY - tileSize;
    return { minX, minY, maxX, maxY };
}
async function fetchTilePng(bbox, w, h) {
    const wmsParams = new URLSearchParams({
        layer: 'BASEMAP_ENC573857', SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap',
        FORMAT: 'image/png', TRANSPARENT: 'true', LAYERS: '', STYLES: '',
        WIDTH: String(w), HEIGHT: String(h), SRS: 'EPSG:3857', TILED: 'true', BBOX: bbox
    });
    const proxyUrl = `http://localhost:3001/api/ocean/khoa-wms?${wmsParams}`;
    for (let attempt = 1; attempt <= 4; attempt++) {
        try {
            const r = await fetch(proxyUrl);
            if (!r.ok) { await new Promise(res => setTimeout(res, 1500)); continue; }
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50) { await new Promise(res => setTimeout(res, 1500)); continue; }
            return buf;
        } catch (e) { await new Promise(res => setTimeout(res, 1500)); }
    }
    return null;
}

async function main() {
    const { x, y } = latLonToMercator(lat, lon);

    // ── z16: 3x3 타일(각 256px) 받아서 매니페스트로 저장 ──
    const Z16 = 16;
    const { tx: cx, ty: cy, tileSize: ts16 } = tileXY(x, y, Z16);
    const tileFiles = [];
    for (let dty = -1; dty <= 1; dty++) {
        for (let dtx = -1; dtx <= 1; dtx++) {
            const { minX, minY, maxX, maxY } = tileBboxOf(cx + dtx, cy + dty, ts16);
            const buf = await fetchTilePng(`${minX},${minY},${maxX},${maxY}`, 256, 256);
            if (!buf) continue;
            const fname = path.join(outDir, `${label}_t${dtx + 1}_${dty + 1}.png`);
            fs.writeFileSync(fname, buf);
            tileFiles.push({ dtx, dty, fname });
        }
    }

    // ── z12: 단일 타일(넓은 대체 뷰, ≈9.8km) ──
    const Z12 = 12;
    const { tx: wx, ty: wy, tileSize: ts12 } = tileXY(x, y, Z12);
    const wideBbox = tileBboxOf(wx, wy, ts12);
    const wideBuf = await fetchTilePng(`${wideBbox.minX},${wideBbox.minY},${wideBbox.maxX},${wideBbox.maxY}`, 400, 400);
    let widePath = null;
    if (wideBuf) {
        widePath = path.join(outDir, `${label}_wideraw.png`);
        fs.writeFileSync(widePath, wideBuf);
    }

    fs.writeFileSync(path.join(outDir, `${label}_meta.json`), JSON.stringify({
        label, lat, lon, x, y,
        z16: { cx, cy, tileSize: ts16, tiles: tileFiles.map(t => ({ dtx: t.dtx, dty: t.dty, fname: t.fname })) },
        z12: { tx: wx, ty: wy, tileSize: ts12, bbox: wideBbox, path: widePath }
    }));
    console.log('DONE', label, tileFiles.length, '/9 z16 타일,', widePath ? 'z12 확보' : 'z12 실패');
}
main().catch(e => { console.error('FETCH_ERROR', e.message); process.exit(1); });
