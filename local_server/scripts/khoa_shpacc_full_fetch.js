/**
 * ============================================================================
 * 파일명: local_server/scripts/khoa_shpacc_full_fetch.js
 * 역할  : khoa_nshpac_full_fetch.js(인명사고)와 같은 방식으로, 오션맵 라이브
 *         지도가 실제로 쓰는 선박사고 두 레이어(tl_shpacc_hk_p=해양경찰청·
 *         tl_shpacc_hs_p=해양안전심판원)의 gid+좌표+속성을 전수 수집한다.
 * [배경] 인명사고에서 오션맵 라이브 지도가 원본 CSV의 ERR_CD 빈 값 행만
 *   보여준다는 걸 확인했다(2026-09-01). 선박사고 두 레이어도 listOLMPData.json
 *   메타데이터에 이미 확인돼 있었고(14차 정찰 로그), 클릭 시 뜨는 팝업 렌더
 *   함수(otms-popup.js, clusterPopupNS.tl_shpacc_hk_p/tl_shpacc_hs_p)도 코드로
 *   확인됨 — 인명사고와 똑같이 clickCluster.json({LAYER, ARRGID}) 로 gid별
 *   속성을 받는 구조다. 이 스크립트로 실제 좌표까지 받아, 원본 CSV
 *   (TL_SHPACC_HK_P.csv·TL_SHPACC_HS_P.csv)의 ERR_CD 필터와 같은 패턴인지
 *   검증하고, 우리 앱(accident_ships_hk.json)과 비교한다.
 * [API] (khoa_oceanmap_probe.js 정찰로 확정, khoa_nshpac_full_fetch.js 와 동일)
 *   - POST /oceanmap/map/cmm/selectListCluster.json, 본문 `LAYER=<layer>`
 *     → {"layer":..,"result":[{"gid":N,"x":..,"y":..,"point_geom":{...}}]}
 *   - POST /oceanmap/map/cmm/clickCluster.json, 본문 {LAYER, ARRGID}
 *     → tl_shpacc_hk_p: {result:[{gid,accymd,occara,acctyp,wetnws,accloc}]}
 *     → tl_shpacc_hs_p: {result:[{gid,accymd,accNm,shpNm,acctyp}]}
 *   (otms-popup.js clusterPopupNS 에서 확인한 필드명 그대로 — 추측 아님)
 * [실행환경] khoa.go.kr 접속이 개발 샌드박스에서 막혀 있어 GitHub Actions 에서 돈다.
 * [출력] local_server/data/khoa_shpacc_full.json
 *   { v:1, fetchedAt, layers:{ tl_shpacc_hk_p:{layerTotal,rows:[[gid,lat,lon,
 *     accymd,occara,acctyp,wetnws,accloc]]}, tl_shpacc_hs_p:{layerTotal,rows:
 *     [[gid,lat,lon,accymd,accNm,shpNm,acctyp]]} } }
 * [연계] .github/workflows/khoa-shpacc-full-fetch.yml
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_JSON = path.join(OUT_DIR, 'khoa_shpacc_full.json');

const TARGET_URL = 'https://www.khoa.go.kr/oceanmap/main.do';
const GID_BATCH_SIZE = 500;
const BATCH_DELAY_MS = 300;

// TL_SHPACC_*.prj 도 TL_NSHPAC.prj 와 동일 KGD2002 통합좌표계(EPSG:5179 상당).
const KGD2002_UNIFIED = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 ' +
    '+x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';

const LAYERS = [
    { key: 'tl_shpacc_hk_p', attrFields: ['accymd', 'occara', 'acctyp', 'wetnws', 'accloc'] },
    { key: 'tl_shpacc_hs_p', attrFields: ['accymd', 'accNm', 'shpNm', 'acctyp'] },
];

async function fetchLayer(page, layerKey, attrFields) {
    console.log(`\n[${layerKey}] selectListCluster.json 로 gid+좌표 목록 요청`);
    const listResult = await page.evaluate(async (layer) => {
        const res = await fetch('/oceanmap/map/cmm/selectListCluster.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `LAYER=${layer}`,
        });
        const status = res.status;
        const json = await res.json().catch(() => null);
        return { status, json };
    }, layerKey);

    if (listResult.status !== 200 || !listResult.json || !Array.isArray(listResult.json.result)) {
        console.error(`  [실패] ${layerKey} selectListCluster.json 응답이 예상과 다름:`, JSON.stringify(listResult).slice(0, 500));
        return { layerTotal: 0, rows: [] };
    }

    const points = listResult.json.result
        .map((r) => ({ gid: r.gid, x: r.x, y: r.y }))
        .filter((r) => Number.isFinite(r.gid) && Number.isFinite(r.x) && Number.isFinite(r.y));
    console.log(`  받은 지점 ${listResult.json.result.length}건, 좌표 유효 ${points.length}건`);

    console.log(`[${layerKey}] clickCluster.json 으로 속성 배치 조회 — ${GID_BATCH_SIZE}건씩`);
    const attrByGid = new Map();
    const gids = points.map((p) => p.gid);
    let failedBatches = 0;
    for (let i = 0; i < gids.length; i += GID_BATCH_SIZE) {
        const batch = gids.slice(i, i + GID_BATCH_SIZE);
        const batchResult = await page.evaluate(async ({ layer, arrgid }) => {
            const res = await fetch('/oceanmap/map/cmm/clickCluster.json', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ LAYER: layer, ARRGID: arrgid }),
            });
            const status = res.status;
            const json = await res.json().catch(() => null);
            return { status, json };
        }, { layer: layerKey, arrgid: batch });

        if (batchResult.status === 200 && batchResult.json && Array.isArray(batchResult.json.result)) {
            batchResult.json.result.forEach((r) => attrByGid.set(r.gid, r));
        } else {
            failedBatches++;
            console.error(`  [배치 실패] gid ${batch[0]}~${batch[batch.length - 1]}:`, JSON.stringify(batchResult).slice(0, 300));
        }
        const done = Math.min(i + GID_BATCH_SIZE, gids.length);
        console.log(`  진행 ${done}/${gids.length} (속성 확보 ${attrByGid.size}건)`);
        await page.waitForTimeout(BATCH_DELAY_MS);
    }

    let coordFail = 0;
    const rows = [];
    for (const p of points) {
        let lat, lon;
        try {
            [lon, lat] = proj4(KGD2002_UNIFIED, proj4.WGS84, [p.x, p.y]);
        } catch (e) {
            coordFail++;
            continue;
        }
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) { coordFail++; continue; }
        const attr = attrByGid.get(p.gid) || {};
        rows.push([p.gid, Math.round(lat * 100000) / 100000, Math.round(lon * 100000) / 100000,
            ...attrFields.map((f) => (attr[f] === undefined ? null : attr[f]))]);
    }
    console.log(`  [${layerKey}] 최종 rows ${rows.length}건 (좌표변환 실패 ${coordFail}건, 속성 배치 실패 ${failedBatches}건)`);
    return { layerTotal: listResult.json.result.length, attrFetched: attrByGid.size, failedAttrBatches: failedBatches, coordConvertFailed: coordFail, attrFields, rows };
}

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    console.log('[1/2] 메인 페이지 접속:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    console.log('[2/2] 레이어별 전수 수집');
    const layers = {};
    for (const { key, attrFields } of LAYERS) {
        layers[key] = await fetchLayer(page, key, attrFields);
    }

    await browser.close();

    const out = { v: 1, fetchedAt: new Date().toISOString(), layers };
    fs.writeFileSync(OUT_JSON, JSON.stringify(out));
    console.log(`\n저장 완료: ${OUT_JSON}`);
    for (const { key } of LAYERS) {
        console.log(`  ${key}: layerTotal=${layers[key].layerTotal}, rows=${layers[key].rows.length}`);
    }
}

main().catch((e) => {
    console.error('수집 실패:', e);
    process.exit(1);
});
