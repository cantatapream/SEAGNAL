/**
 * ============================================================================
 * 파일명: local_server/scripts/khoa_nshpac_full_fetch.js
 * 역할  : 국립해양조사원(KHOA) 오션맵이 인명사고 마커를 그릴 때 쓰는 실제
 *         gid+좌표 벌크 API(selectListCluster.json)와 속성 API(clickCluster.json)를
 *         khoa_oceanmap_probe.js(1~14차 정찰)로 확정한 뒤, 그 API로 전체 인명사고
 *         데이터(좌표 포함)를 실제로 받아와 저장하는 스크립트다(수집·저장함 —
 *         probe 스크립트와 달리 읽기 전용이 아님).
 * [배경] 우리 앱(client/accident_persons.json)은 국립해양조사원이 배포하는
 *   "인명사고(25년)" CSV(TL_NSHPAC.csv)의 XCDNT/YCDNT(KGD2002 통합좌표, TM
 *   투영)를 그대로 좌표로 쓴다. 그런데 카카오맵 역지오코딩 대조에서 498건이
 *   의심됐고, 오션맵 자체 홈페이지에서는 마커가 정확하게 찍혀 보인다는 사용자
 *   관찰이 있어 — 오션맵이 내부적으로 쓰는 "진짜" 좌표를 직접 받아 우리 데이터와
 *   전수 비교하려는 것.
 * [API] khoa_oceanmap_probe.js 14차에서 확정(코드로 확인, 추측 아님):
 *   - POST /oceanmap/map/cmm/selectListCluster.json, 본문 `LAYER=vi_nshpac_p`
 *     → {"layer":"vi_nshpac_p","result":[{"gid":N,"x":..,"y":..,"point_geom":{...}}]}
 *     (좌표는 x,y — build_accidents.js 의 XCDNT/YCDNT 와 같은 KGD2002 통합좌표계,
 *     EPSG:5179. 12차 결과에서 확인: 이 요청은 페이지 진입만 하면 바로 되고,
 *     지도 화면 진입·토글 클릭 등 UI 조작이 전혀 필요 없었다 — clickCluster.json
 *     과 같은 패턴.)
 *   - POST /oceanmap/map/cmm/clickCluster.json, 본문 `{LAYER, ARRGID:[gid,...]}`
 *     → {"result":[{"gid":N,"accloc":"...","accymd":"...","acctyp":"...",
 *       "accckr":null}]} (11차에서 확정 — 좌표는 없고 날짜·유형·지명 텍스트만).
 *   두 응답을 gid 로 합치면 "좌표 + 속성"이 다 있는 완전한 레코드가 나온다.
 * [실행환경] khoa.go.kr 접속이 개발 샌드박스에서 막혀 있어(EGRESS_BLOCKED)
 *   GitHub Actions 에서 돈다 — khoa_oceanmap_probe.js 와 같은 우회 패턴.
 * [출력] local_server/data/khoa_nshpac_full.json
 *   { v:1, fetchedAt, layerTotal, rows:[[gid,lat,lon,accymd,accloc,acctyp,accckr],...] }
 * [연계] .github/workflows/khoa-nshpac-full-fetch.yml
 * ============================================================================
 */
'use strict';

const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');

const OUT_DIR = path.join(__dirname, '..', 'data');
const OUT_JSON = path.join(OUT_DIR, 'khoa_nshpac_full.json');

const TARGET_URL = 'https://www.khoa.go.kr/oceanmap/main.do';
const LAYER = 'vi_nshpac_p';
const GID_BATCH_SIZE = 500;
const BATCH_DELAY_MS = 300; // 공공 서버에 과도한 연속 요청을 피하려는 최소한의 지연

// TL_NSHPAC.prj 그대로 옮긴 투영식 — build_accidents.js 의 KGD2002_UNIFIED 와 동일.
const KGD2002_UNIFIED = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 ' +
    '+x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs';

async function main() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const { chromium } = require('playwright');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();

    console.log('[1/3] 메인 페이지 접속:', TARGET_URL);
    await page.goto(TARGET_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForTimeout(2000);

    console.log('[2/3] selectListCluster.json 로 gid+좌표 목록 요청 (UI 조작 없이 직접 호출)');
    const listResult = await page.evaluate(async (layer) => {
        const res = await fetch('/oceanmap/map/cmm/selectListCluster.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `LAYER=${layer}`,
        });
        const status = res.status;
        const json = await res.json().catch(() => null);
        return { status, json };
    }, LAYER);

    if (listResult.status !== 200 || !listResult.json || !Array.isArray(listResult.json.result)) {
        console.error('[실패] selectListCluster.json 응답이 예상과 다름:', JSON.stringify(listResult).slice(0, 500));
        await browser.close();
        process.exit(1);
    }

    const points = listResult.json.result
        .map((r) => ({ gid: r.gid, x: r.x, y: r.y }))
        .filter((r) => Number.isFinite(r.gid) && Number.isFinite(r.x) && Number.isFinite(r.y));
    console.log(`  받은 지점 ${listResult.json.result.length}건, 좌표 유효 ${points.length}건`);

    console.log(`[3/3] clickCluster.json 으로 속성(사고발생일·유형·지명) 배치 조회 — ${GID_BATCH_SIZE}건씩`);
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
        }, { layer: LAYER, arrgid: batch });

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

    await browser.close();

    console.log('좌표 변환(KGD2002 통합좌표계 → WGS84) 및 병합');
    const rows = [];
    let coordFail = 0;
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
        rows.push([
            p.gid,
            Math.round(lat * 100000) / 100000,
            Math.round(lon * 100000) / 100000,
            attr.accymd || '',
            attr.accloc || '',
            attr.acctyp || '',
            attr.accckr === undefined ? null : attr.accckr,
        ]);
    }

    const out = {
        v: 1,
        fetchedAt: new Date().toISOString(),
        layerTotal: listResult.json.result.length,
        attrFetched: attrByGid.size,
        failedAttrBatches: failedBatches,
        coordConvertFailed: coordFail,
        rows,
    };
    fs.writeFileSync(OUT_JSON, JSON.stringify(out));
    console.log(`\n저장 완료: ${OUT_JSON}`);
    console.log(`  전체 지점 ${out.layerTotal}건, 속성 확보 ${out.attrFetched}건, 최종 rows ${rows.length}건`);
    console.log(`  좌표변환 실패 ${coordFail}건, 속성 배치 실패 ${failedBatches}건`);
}

main().catch((e) => {
    console.error('수집 실패:', e);
    process.exit(1);
});
