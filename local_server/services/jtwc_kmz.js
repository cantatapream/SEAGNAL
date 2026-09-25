/**
 * ============================================================================
 * 파일명: services/jtwc_kmz.js
 * 역할 : JTWC 가 태풍마다 같이 올리는 '구글어스 파일'(.kmz)에서 글자 통보문에는
 *        없는 두 가지를 꺼낸다 — ①34노트 위험구역 도형 ②지나온 실제 경로.
 * ============================================================================
 *
 * [왜 이 파일이 생겼는가 — 2026-09-25]
 *   글자 통보문(web.txt)에는 경로 오차 범위가 아예 없다. 예전에 중계 업체를 거칠 때는
 *   그 업체가 계산한 '오차 원뿔'을 받아 그렸는데, 약관 때문에 그 경로를 버렸다.
 *   그 뒤 JTWC 가 공개하는 .kmz 를 열어 보니 같은 폴더에 다음이 들어 있었다.
 *     · '34 knot Danger Swath'  점 1,032개짜리 도형 1개
 *     · 'Previous Best Track Posits'  지난 5일치 실제 위치 19개 + 각 시점 세기
 *   위험구역은 바람 반경을 단순히 이어 붙인 것이 **아니다.** 실측해 보니 바람 반경
 *   경계보다 중앙값 205km·최대 360km 더 바깥까지 나간다 — 예보가 빗나갈 가능성이
 *   이미 들어 있는 도형이다. 원뿔이라는 이름은 아니지만 그 자리를 대신한다.
 *   JTWC 자료라 미국 정부 공공저작물이고, 그대로 보여 줘도 된다.
 *
 * [무엇을 안 꺼내나]
 *   바람 반경 도형(34/50/64노트)도 .kmz 에 들어 있지만 가져오지 않는다.
 *   실측해 보니 그 도형은 **글자 통보문의 네 방향 거리를 90°씩 그대로 두른 것**이라
 *   (예: 25/12Z 34노트 = 북동 130 · 남동 56 · 남서 74 · 북서 130 km, 사분면 안에서
 *   반경이 일정) 이미 가진 숫자로 똑같이 그릴 수 있다. 같은 것을 두 번 받지 않는다.
 *   → 화면 쪽에서 사분면 경계를 '계단'으로 그린다(client/js/typhoon/ocean_typhoon.js).
 *
 * [.kmz 가 무엇인가] doc.kml 이라는 글 파일 하나를 zip 으로 묶은 것이다.
 *   그림(images/*.png)도 같이 들었지만 우리는 doc.kml 만 쓴다.
 *   zip 을 푸는 외부 꾸러미를 새로 깔지 않고, 노드가 기본으로 가진 zlib 로 직접 푼다.
 *
 * [주요 함수]
 *   unzipEntry(buf, name)   zip 덩어리에서 파일 하나를 꺼낸다
 *   parseKml(text)          doc.kml 글 → { advisory, swath, past }
 *   parseKmz(buf)           .kmz 덩어리 → 위와 같음 (못 풀면 null)
 *
 * [연계]
 *   → local_server/routes/typhoon_foreign.js 가 통보문과 같이 받아 응답에 싣는다
 *   → local_server/scripts/test_typhoon_source.js 가 실제 파일로 고정한다
 *      (fixtures/jtwc_wp2526.kmz — 원본에서 그림만 뺀 것)
 * ============================================================================
 */

'use strict';

const zlib = require('zlib');
const jtwc = require('./jtwc_parse');

const KST_OFFSET_MS = 9 * 3600 * 1000;
// 날짜변경선을 걸치는 도형은 지도에서 화면을 가로지르는 띠로 뭉개진다. 그런 도형은 싣지 않는다.
const MAX_LON_SPAN_DEG = 180;

/**
 * zip 덩어리에서 파일 하나를 꺼낸다. 없거나 못 풀면 null.
 * 예: unzipEntry(kmzBuffer, 'doc.kml') → '<?xml version="1.0" …'
 * [어떻게] zip 은 끝에 '목차'(중앙 디렉터리)를 둔다. 그 목차를 읽어 파일 위치를 찾고,
 *   압축 방식이 0(그냥 담음)이면 그대로, 8(deflate)이면 zlib 로 푼다.
 * @param {Buffer} buf - .kmz/.zip 전체
 * @param {string} name - 꺼낼 파일 이름
 * @returns {string|null} 파일 내용(utf8)
 */
function unzipEntry(buf, name) {
    if (!Buffer.isBuffer(buf) || buf.length < 22) return null;
    // 목차 끝 표식(0x06054b50)을 뒤에서부터 찾는다(주석이 붙을 수 있어 최대 64KB 훑는다).
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
        if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = buf.readUInt16LE(eocd + 10);
    let p = buf.readUInt32LE(eocd + 16);
    for (let k = 0; k < count; k++) {
        if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
        const method = buf.readUInt16LE(p + 10);
        const compSize = buf.readUInt32LE(p + 20);
        const nameLen = buf.readUInt16LE(p + 28);
        const extraLen = buf.readUInt16LE(p + 30);
        const cmtLen = buf.readUInt16LE(p + 32);
        const localAt = buf.readUInt32LE(p + 42);
        const entry = buf.toString('utf8', p + 46, p + 46 + nameLen);
        if (entry === name) {
            // 실제 내용은 파일마다 붙은 머리(30바이트 + 이름 + 덤) 뒤에서 시작한다.
            if (localAt + 30 > buf.length || buf.readUInt32LE(localAt) !== 0x04034b50) return null;
            const lNameLen = buf.readUInt16LE(localAt + 26);
            const lExtraLen = buf.readUInt16LE(localAt + 28);
            const at = localAt + 30 + lNameLen + lExtraLen;
            const data = buf.slice(at, at + compSize);
            try {
                if (method === 0) return data.toString('utf8');
                if (method === 8) return zlib.inflateRawSync(data).toString('utf8');
            } catch (e) { return null; }
            return null;
        }
        p += 46 + nameLen + extraLen + cmtLen;
    }
    return null;
}

/** "<name>…</name>" 같은 칸 하나를 꺼낸다. 없으면 ''. */
function tagText(block, tag) {
    const m = new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>').exec(block);
    return m ? m[1].trim() : '';
}

/**
 * KML 의 좌표 글줄("130.7,19.9,0 129.1,20.9,0 …") → [[경도,위도], …].
 * 소수 셋째 자리(약 100m)까지만 남긴다 — 그 아래는 화면에서 구분되지 않는데 자료만 커진다.
 * @param {string} s
 * @returns {Array<Array<number>>}
 */
function parseCoords(s) {
    const out = [];
    String(s || '').trim().split(/\s+/).forEach((tok) => {
        const a = tok.split(',');
        if (a.length < 2) return;
        const lon = parseFloat(a[0]), lat = parseFloat(a[1]);
        if (!isFinite(lon) || !isFinite(lat)) return;
        out.push([Math.round(lon * 1000) / 1000, Math.round(lat * 1000) / 1000]);
    });
    return out;
}

/** UTC 각 조각 → 우리 프레임의 한국시각 문자열('YYYYMMDDHHmm'). */
function utcToKstStamp(y, mo, d, h) {
    const ms = Date.UTC(y, mo - 1, d, h, 0);
    if (isNaN(ms)) return null;
    const t = new Date(ms + KST_OFFSET_MS);
    const p = (n) => String(n).padStart(2, '0');
    return String(t.getUTCFullYear()) + p(t.getUTCMonth() + 1) + p(t.getUTCDate())
         + p(t.getUTCHours()) + p(t.getUTCMinutes());
}

/**
 * doc.kml 글을 읽어 위험구역과 지나온 경로를 꺼낸다.
 * 예: parseKml(doc.kml 내용) →
 *     { advisory: 8, swath: [[135.84,34.09], …], past: [{ time:'202609201500', … }, …] }
 * [자문 회차를 왜 같이 꺼내나] .kmz 와 글자 통보문이 각각 다른 시점 것일 수 있다.
 *   회차가 다르면 지난 예보의 위험구역을 새 예보 위에 그리게 되므로, 부르는 쪽에서
 *   회차를 맞춰 보고 다르면 안 쓴다. (첫 예보 지점 이름에 'WARNING NR 8' 로 들어 있다.)
 * @param {string} text - doc.kml 원문
 * @returns {{advisory:number|null, swath:Array|null, past:Array}|null} 못 읽으면 null
 */
function parseKml(text) {
    const src = String(text || '');
    if (src.indexOf('<Placemark') < 0) return null;

    const blocks = src.split('<Placemark').slice(1);
    let advisory = null;
    let swath = null;
    const past = [];

    blocks.forEach((b) => {
        const name = tagText(b, 'name');

        // ① 위험구역 — 도형 하나. 이름이 고정돼 있다.
        if (name === '34 knot Danger Swath') {
            const ring = parseCoords(tagText(b, 'coordinates'));
            if (ring.length >= 4) {
                const lons = ring.map(p => p[0]);
                const span = Math.max.apply(null, lons) - Math.min.apply(null, lons);
                if (span <= MAX_LON_SPAN_DEG) swath = ring;
            }
            return;
        }

        // ② 지나온 실제 경로 — 이름이 '26092006Z'(연연월월일일시시Z) 꼴인 점.
        const pm = /^(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(name);
        if (pm) {
            const pt = parseCoords(tagText(b, 'coordinates'))[0];
            if (!pt) return;
            const kt = (/Intensity:\s*(\d+)\s*knots/i.exec(b) || [])[1];
            const windMs = kt ? jtwc._ktToMs(+kt) : null;
            past.push({
                time: utcToKstStamp(2000 + (+pm[1]), +pm[2], +pm[3], +pm[4]),
                lat: pt[1],
                lon: pt[0],
                windMs: windMs,
                grade: jtwc._gradeOfWind(windMs)
            });
            return;
        }

        // ③ 자문 회차 — 첫 예보 지점 이름에만 들어 있다.
        if (advisory === null) {
            const am = /WARNING NR\s*(\d+)/i.exec(name);
            if (am) advisory = +am[1];
        }
    });

    past.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return { advisory: advisory, swath: swath, past: past };
}

/**
 * .kmz 덩어리 → parseKml 과 같은 결과. 압축을 못 풀면 null.
 * @param {Buffer} buf
 * @returns {{advisory:number|null, swath:Array|null, past:Array}|null}
 */
function parseKmz(buf) {
    const kml = unzipEntry(buf, 'doc.kml');
    if (kml === null) return null;
    return parseKml(kml);
}

module.exports = {
    unzipEntry,
    parseKml,
    parseKmz,
    _parseCoords: parseCoords,
    _utcToKstStamp: utcToKstStamp
};
