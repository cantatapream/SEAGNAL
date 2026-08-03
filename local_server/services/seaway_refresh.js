/**
 * ============================================================================
 * 파일명: services/seaway_refresh.js
 * 역할: 항로(seaway) 데이터가 원본에서 바뀌었는지 매월 말일에 한 번 점검하고,
 *       바뀌었으면 새 GeoJSON 을 런타임 데이터 폴더에 저장하는 서비스.
 * ============================================================================
 *
 * [왜 필요한가 — 초보자를 위한 안내]
 *   항로(선박이 다니도록 지정ㆍ고시된 통로)는 부이 관측값처럼 실시간으로 변하는
 *   데이터가 아니라, 고시가 바뀔 때만 아주 가끔 변한다. 그래서 매번 외부 서버에
 *   물어보지 않고 정적 파일(client/seaway_zones.json)로 고정해 두고 쓴다.
 *   다만 "가끔"이라도 바뀌긴 하므로, 한 달에 한 번(말일 04:00 KST) 원본과 대조해
 *   달라진 게 있으면 그때만 갱신한다.
 *
 * [왜 client/ 가 아니라 data/ 에 쓰는가]
 *   client/ 는 git 으로 추적되는 정적 파일이고 Fly.io 배포 때마다 이미지에 다시
 *   구워진다 — 운영 서버가 그 파일을 고쳐 써도 다음 배포에서 커밋 시점 내용으로
 *   되돌아간다. 반면 local_server/data/ 는 Fly 볼륨(영속 스토리지)이라 배포와
 *   무관하게 유지된다. 그래서 갱신 결과는 data/seaway_zones.json 에 저장하고,
 *   routes/seaway.js 가 "그 파일이 있으면 그걸, 없으면 client/ 원본을" 서빙한다.
 *
 * [데이터 출처]
 *   국립해양조사원 "개방海" 포털 WFS 프록시(mapprime:vi_seaway 레이어).
 *   POST https://www.khoa.go.kr/oceanmap/cmm/proxyRun.do 로 WFS GetFeature XML 을
 *   보내면 GML(FeatureCollection)이 온다. 좌표계는 EPSG:5179(미터) 라 WGS84
 *   (경위도)로 재투영해야 지도에 얹을 수 있다.
 *
 * [연계]
 *   - scheduler.js         → 매월 말일 04:00 KST 에 checkAndRefreshSeaway() 호출
 *   - routes/seaway.js     → 여기서 저장한 data/seaway_zones.json 을 서빙
 *   - client/js/marine-life/safety/seaway.js → /seaway_zones.json 을 받아 지도에 표시
 *   - config/server_config.js → DATA_DIR 경로 상수
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const proj4 = require('proj4');
const { DATA_DIR } = require('../config/server_config');

/** 개방海 WFS 프록시 — 브라우저가 쓰는 것과 같은 엔드포인트(별도 인증 없음). */
const WFS_URL = 'https://www.khoa.go.kr/oceanmap/cmm/proxyRun.do';

/** 항로 레이어(vi_seaway) 조회용 WFS GetFeature 요청 본문. */
const WFS_BODY = '<wfs:GetFeature xmlns:wfs="http://www.opengis.net/wfs" service="WFS" version="1.1.0" maxFeatures="2000" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/wfs http://schemas.opengis.net/wfs/1.1.0/wfs.xsd"><wfs:Query typeName="mapprime:vi_seaway" srsName="EPSG:5179"><wfs:PropertyName>korn_nm</wfs:PropertyName><wfs:PropertyName>rfrnc_doc</wfs:PropertyName><wfs:PropertyName>rfrnc_site</wfs:PropertyName><wfs:PropertyName>tbl_korn_nm</wfs:PropertyName><wfs:PropertyName>ag_geom</wfs:PropertyName></wfs:Query></wfs:GetFeature>';

/** EPSG:5179 (KGD2002 / Unified CS) — 원본 좌표계. WGS84 로 바꿔야 지도에 얹힌다. */
const EPSG5179 = '+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs';

/** 갱신 결과를 저장할 곳 (Fly 볼륨 — 배포해도 안 지워짐). */
const OUT_FILE = path.join(DATA_DIR, 'seaway_zones.json');

/** 아직 한 번도 갱신 안 됐을 때 비교 기준이 되는 배포본. */
const FALLBACK_FILE = path.join(__dirname, '..', '..', 'client', 'seaway_zones.json');

/**
 * 개방海 WFS 프록시에 GetFeature 요청을 보내 GML(XML) 원문을 받아온다.
 * 예: await fetchSeawayGml() → '<?xml version="1.0"...<wfs:FeatureCollection...'
 * @returns {Promise<string>} GML FeatureCollection XML 문자열
 * [연계] ← checkAndRefreshSeaway() / → 외부 khoa.go.kr — 원본 항로를 받아오려고 부른다
 */
async function fetchSeawayGml() {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(WFS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=UTF-8' },
            body: WFS_BODY,
            signal: controller.signal
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * GML 의 posList 문자열("x1 y1 x2 y2 ...", EPSG:5179 미터)을 WGS84 좌표 배열로 바꾼다.
 * 예: '1027235.3 1645943.8 ...' → [[127.797…, 34.807…], ...]
 * @param {string} text - 공백으로 구분된 x y 시퀀스
 * @returns {number[][]} [[경도, 위도], ...]
 * [연계] ← parseGeometry() — GML 링/선의 좌표를 지도용 경위도로 바꾸려고 부른다
 */
function parsePosList(text) {
    const nums = text.trim().split(/\s+/).map(Number);
    const ring = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
        ring.push(proj4(EPSG5179, 'WGS84', [nums[i], nums[i + 1]]));
    }
    return ring;
}

/**
 * 하나의 vi_seaway 블록에서 GeoJSON geometry(MultiPolygon 또는 MultiLineString)를 뽑는다.
 * 예: <gml:MultiSurface>…</gml:MultiSurface> → { type:'MultiPolygon', coordinates:[[[...]]] }
 * @param {string} block - <mapprime:vi_seaway>…</mapprime:vi_seaway> 한 덩어리
 * @returns {object|null} GeoJSON geometry (좌표가 하나도 없으면 null)
 * [연계] ← parseFeatures() — feature 마다 도형을 만들려고 부른다
 *          → parsePosList() — 좌표를 EPSG:5179 에서 WGS84 로 바꾸려고 부른다
 */
function parseGeometry(block) {
    // 면(面)으로 고시된 항로 — surfaceMember 하나가 폴리곤 하나.
    //   GML 은 exterior(바깥 링)를 먼저, interior(구멍)를 뒤에 쓰므로 posList 를
    //   나온 순서대로 담으면 GeoJSON 의 링 순서(바깥→구멍)와 그대로 맞는다.
    if (block.includes('<gml:MultiSurface')) {
        const members = block.match(/<gml:surfaceMember>[\s\S]*?<\/gml:surfaceMember>/g) || [];
        const polygons = members
            .map(m => (m.match(/<gml:posList>([\s\S]*?)<\/gml:posList>/g) || [])
                .map(p => parsePosList(p.replace(/<\/?gml:posList>/g, ''))))
            .filter(rings => rings.length > 0);
        return polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
    }
    // 선(線)으로 고시된 항로 — 통항분리대 등.
    if (block.includes('<gml:MultiLineString')) {
        const members = block.match(/<gml:lineStringMember>[\s\S]*?<\/gml:lineStringMember>/g) || [];
        const lines = members
            .map(m => {
                const p = m.match(/<gml:posList>([\s\S]*?)<\/gml:posList>/);
                return p ? parsePosList(p[1]) : [];
            })
            .filter(line => line.length > 0);
        return lines.length ? { type: 'MultiLineString', coordinates: lines } : null;
    }
    return null;
}

/**
 * GML 전문을 GeoJSON FeatureCollection 으로 바꾼다.
 * 예: parseFeatures(gml) → [{type:'Feature', properties:{name:'광양만',…}, geometry:{…}}, …]
 * @param {string} gml - WFS 응답 XML
 * @returns {object[]} GeoJSON Feature 배열 (client/seaway_zones.json 과 같은 스키마)
 * [연계] ← checkAndRefreshSeaway() — 받아온 원문을 지도에서 쓰는 형태로 바꾸려고 부른다
 *          → parseGeometry() — 블록마다 도형을 만들려고 부른다
 */
function parseFeatures(gml) {
    const blocks = gml.match(/<mapprime:vi_seaway[\s\S]*?<\/mapprime:vi_seaway>/g) || [];
    const features = [];
    for (const block of blocks) {
        const tag = (name) => {
            const m = block.match(new RegExp(`<mapprime:${name}>([\\s\\S]*?)</mapprime:${name}>`));
            return m ? m[1] : '';
        };
        const geometry = parseGeometry(block);
        if (!geometry) continue;   // 도형 없는 레코드는 지도에 못 그리므로 버린다
        features.push({
            type: 'Feature',
            properties: {
                name: tag('korn_nm'),
                category: tag('tbl_korn_nm'),
                reference_doc: tag('rfrnc_doc'),
                reference_url: tag('rfrnc_site')
            },
            geometry
        });
    }
    return features;
}

/**
 * 지금 서빙 중인 항로 GeoJSON 을 읽는다 — 갱신본이 있으면 그걸, 없으면 배포본을.
 * 예: readCurrent() → { type:'FeatureCollection', features:[…141개…] }
 * @returns {object|null} GeoJSON 객체 (둘 다 못 읽으면 null)
 * [연계] ← checkAndRefreshSeaway() — "바뀌었는지" 비교 기준을 얻으려고 부른다
 */
function readCurrent() {
    for (const file of [OUT_FILE, FALLBACK_FILE]) {
        try {
            if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
        } catch (e) {
            console.error(`[seaway_refresh] ${path.basename(file)} 읽기 실패: ${e.message}`);
        }
    }
    return null;
}

/**
 * feature 목록을 "이름|종류 → 도형문자열 목록" Map 으로 만든다(비교용 지문).
 * 예: buildIndex(features) → Map { '광양만|주의해역' => ['[[[127.79…]]]', …], … }
 *
 * 같은 이름·종류가 여러 개인 항로(예: 광양만 주의해역 5개)가 있어 값이 배열이고,
 * 원본 순서가 바뀌어도 오탐이 안 나도록 정렬해서 담는다. 좌표는 소수점 9자리로
 * 반올림한다 — 약 0.1mm 수준이라 실제 고시 변경은 그대로 잡히면서, 재투영 계산의
 * 부동소수점 끝자리 차이(1e-14도) 때문에 "바뀌었다"고 잘못 판정하는 걸 막는다.
 *
 * @param {object[]} features - GeoJSON Feature 배열
 * @returns {Map<string, string[]>} 키='이름|종류', 값=정렬된 도형 JSON 문자열 배열
 * [연계] ← diffFeatures() — 옛것/새것을 같은 방식으로 지문화하려고 부른다
 */
function buildIndex(features) {
    const index = new Map();
    for (const f of features) {
        const key = `${f.properties.name}|${f.properties.category}`;
        const shape = JSON.stringify(f.geometry, (k, v) =>
            typeof v === 'number' ? Number(v.toFixed(9)) : v);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(shape);
    }
    for (const list of index.values()) list.sort();
    return index;
}

/**
 * 옛 항로와 새 항로를 비교해 무엇이 달라졌는지 정리한다.
 * 예: diffFeatures(old, next) → { changed:true, added:['ㅇㅇ항로|지정항로'], removed:[], moved:[] }
 * @param {object[]} oldFeatures - 지금 서빙 중인 feature 배열
 * @param {object[]} newFeatures - 방금 받아온 feature 배열
 * @returns {{changed:boolean, added:string[], removed:string[], moved:string[]}}
 *          added=새로 생긴 항로, removed=없어진 항로, moved=이름은 같은데 좌표가 바뀐 항로
 * [연계] ← checkAndRefreshSeaway() — 저장할지 말지 판단하려고 부른다
 *          → buildIndex() — 양쪽을 같은 기준으로 지문화하려고 부른다
 */
function diffFeatures(oldFeatures, newFeatures) {
    const oldIndex = buildIndex(oldFeatures);
    const newIndex = buildIndex(newFeatures);
    const added = [];
    const removed = [];
    const moved = [];

    for (const [key, shapes] of newIndex) {
        if (!oldIndex.has(key)) added.push(key);
        else if (JSON.stringify(oldIndex.get(key)) !== JSON.stringify(shapes)) moved.push(key);
    }
    for (const key of oldIndex.keys()) {
        if (!newIndex.has(key)) removed.push(key);
    }
    return { changed: added.length + removed.length + moved.length > 0, added, removed, moved };
}

/**
 * 원본 항로 데이터를 받아 지금 서빙 중인 것과 대조하고, 달라졌으면 갱신 저장한다.
 * 예: await checkAndRefreshSeaway() → 로그 '[seaway_refresh] 변경 없음 (141개)'
 * @returns {Promise<void>} 결과는 콘솔 로그로만 알린다(월 1회 배치라 반환값 소비처 없음)
 * [연계] ← scheduler.js 의 1분 마스터 틱(매월 말일 04:00 KST) — 월간 신선도 점검
 *          → fetchSeawayGml()/parseFeatures()/diffFeatures() — 받고·바꾸고·비교하려고
 *          네트워크 오류 등은 여기서 삼킨다 — 월 1회 배치가 서버를 죽이면 안 되고,
 *          실패해도 다음 달에 다시 시도하면 되기 때문.
 */
async function checkAndRefreshSeaway() {
    try {
        const gml = await fetchSeawayGml();
        const features = parseFeatures(gml);
        if (features.length === 0) {
            console.error('[seaway_refresh] 원본에서 항로를 하나도 못 읽었습니다 — 갱신 취소');
            return;
        }

        const current = readCurrent();
        if (!current || !Array.isArray(current.features)) {
            console.error('[seaway_refresh] 기존 항로 파일을 못 읽어 비교 불가 — 갱신 취소');
            return;
        }

        const diff = diffFeatures(current.features, features);
        if (!diff.changed) {
            console.log(`[seaway_refresh] 변경 없음 (${features.length}개)`);
            return;
        }

        const geojson = { type: 'FeatureCollection', features };
        const tmp = `${OUT_FILE}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(geojson), 'utf8');
        fs.renameSync(tmp, OUT_FILE);

        console.log(`[seaway_refresh] 변경 감지 — ${current.features.length}개 → ${features.length}개, 저장: ${OUT_FILE}`);
        if (diff.added.length) console.log(`[seaway_refresh]   추가 ${diff.added.length}개: ${diff.added.join(', ')}`);
        if (diff.removed.length) console.log(`[seaway_refresh]   삭제 ${diff.removed.length}개: ${diff.removed.join(', ')}`);
        if (diff.moved.length) console.log(`[seaway_refresh]   좌표변경 ${diff.moved.length}개: ${diff.moved.join(', ')}`);
    } catch (e) {
        console.error(`[seaway_refresh] 점검 실패: ${e.message}`);
    }
}

module.exports = { checkAndRefreshSeaway };
