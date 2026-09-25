/**
 * ============================================================================
 * 파일명: services/jma_parse.js
 * 역할 : 일본 기상청(JMA)이 공개하는 태풍 자료(JSON)를 우리 태풍 프레임으로 옮긴다.
 * ============================================================================
 *
 * [왜 일본인가 — 2026-09-25]
 *   일본 기상청은 우리 기상청과 **같은 방식**으로 태풍을 발표한다(둘 다 세계기상기구
 *   방식을 따른다). 그래서 미국(JTWC)에 없던 두 가지가 그대로 들어 있다.
 *     · 70% 확률반경(予報円) — 태풍 중심이 들어올 범위
 *     · 예상 시점의 중심기압 — 미국은 현재 위치만 준다
 *   게다가 풍속이 10분 평균이라(미국은 1분 평균) 환산 없이 그대로 쓸 수 있다.
 *
 * [어디서 받나 — 2026-09-25 실제로 받아 확인]
 *   목록  https://www.jma.go.jp/bosai/typhoon/data/targetTc.json
 *         [{"tropicalCyclone":"TC2632","typhoonNumber":"2626","category":"TS","issue":…}]
 *   본문  .../data/TC2632/specifications.json   위치·기압·풍속·강풍역·폭풍역·예보원
 *   경로  .../data/TC2632/forecast.json        지나온 실제 경로(track)
 *
 * [기준값 — 일본 기상청이 직접 밝힌 것]
 *   강풍역 = 초속 15m 이상 · 폭풍역 = 초속 25m 이상 · 풍속은 10분 평균
 *   → 우리 기상청의 강풍반경·폭풍반경과 **기준이 같다**(미국은 17.5/25.7m 로 달랐다).
 *   대きさ(크기) 大型=강풍역 반경 500~800km · 超大型=800km 이상
 *   (출처: https://www.jma.go.jp/jma/kishou/know/typhoon/1-3.html)
 *
 * [무엇이 없나]
 *   · 미국의 '34노트 위험구역' 같은 도형은 없다 → swath 는 만들지 않는다.
 *   · 지나온 경로에 시각·세기가 없다(위치만 준다) → 있는 것만 싣는다. 지어내지 않는다.
 *   · 예보도 그림 파일이 없다 → 지도 그림 버튼은 뜨지 않는다.
 *   · 강풍역은 현재 시점에만, 폭풍역은 예보 시점에만 나온다 — 일본이 그렇게 발표한다.
 *
 * [시각] 일본 시각(JST)과 한국 시각(KST)은 둘 다 UTC+9 라 벽시계가 같다.
 *   그래서 "2026-09-25T21:00:00+09:00" 에서 숫자만 뽑으면 바로 우리 형식이 된다.
 *
 * [주요 함수]
 *   parseTargetList(json)           목록 → [{ id, number, category }]
 *   parseSpecifications(json)       본문 → { number, name, issuedKst, frames }
 *   parseTrack(json)                경로 → [{ lat, lon }]
 *
 * [연계]
 *   → local_server/routes/typhoon_foreign.js 가 이 모듈로 해독한다
 *   → local_server/scripts/test_typhoon_jma.js 가 실제 자료로 고정한다
 *      (fixtures/jma_targetTc.json · jma_specifications.json · jma_forecast.json)
 * ============================================================================
 */

'use strict';

// 일본어 방위 → 우리가 쓰는 16방위 글자. 진행 방향(course)과 강풍역 방향(area)에 함께 쓴다.
const DIR_OF_JP = {
    '北': 'N', '北北東': 'NNE', '北東': 'NE', '東北東': 'ENE',
    '東': 'E', '東南東': 'ESE', '南東': 'SE', '南南東': 'SSE',
    '南': 'S', '南南西': 'SSW', '南西': 'SW', '西南西': 'WSW',
    '西': 'W', '西北西': 'WNW', '北西': 'NW', '北北西': 'NNW'
};
// 크기(大きさ) — 일본 기상청이 쓰는 두 등급뿐이다. 그 밖(‘-’ 등)은 표시하지 않는다.
const SIZE_OF_JP = { '大型': '대형', '超大型': '초대형' };
// 풍속을 못 읽었을 때만 쓰는 보조 수단. TD=열대저압부 TS=태풍 STS=강한열대폭풍 TY=태풍
const GRADE_OF_CATEGORY = { TD: 0, TS: 1, STS: 2, TY: 3 };

/** 숫자로 읽는다. 숫자가 아니면 null — 0 으로 뭉개지 않는다. */
function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
}

/**
 * 일본 시각 문자열 → 우리 프레임의 한국시각 문자열.
 * 예: toKstStamp('2026-09-25T21:00:00+09:00') → '202609252100'
 * [왜 그냥 잘라도 되나] 일본(JST)과 한국(KST)은 둘 다 UTC+9 라 벽시계가 같다.
 *   시차 계산을 넣으면 오히려 실수할 자리만 생긴다.
 * @param {string} jst
 * @returns {string|null} 'YYYYMMDDHHmm', 못 읽으면 null
 */
function toKstStamp(jst) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(jst || ''));
    return m ? (m[1] + m[2] + m[3] + m[4] + m[5]) : null;
}

/** 방위 칸을 읽는다 — 문자열('北')로 올 때도, 객체({jp:'全域'})로 올 때도 있다. */
function areaJp(area) {
    if (typeof area === 'string') return area;
    if (area && typeof area === 'object') return String(area.jp || '');
    return '';
}

/**
 * 강풍역·폭풍역 칸 → 우리 형식의 (장반경, 단반경, 단반경 방위).
 * 예: [{area:'北',range:{km:280}}, {area:'南',range:{km:165}}]
 *       → { long:280, short:165, dir:'S' }   (짧은 쪽이 남쪽)
 *     [{area:{jp:'全域'},range:{km:160}}] → { long:160, short:160, dir:'' } (원)
 * [왜 이렇게 담나] 우리 화면은 기상청 방식(장반경·단반경·단반경 방위)으로 그린다.
 *   일본도 같은 방식이라 그대로 옮겨진다.
 * @param {Array} arr - galeWarning 또는 stormWarning
 * @returns {{long:number, short:number, dir:string}|null} 없으면 null
 */
function warningToAsym(arr) {
    if (!Array.isArray(arr) || !arr.length) return null;
    const items = [];
    arr.forEach((w) => {
        const km = num(w && w.range && w.range.km);
        if (km === null || km <= 0) return;
        items.push({ km: km, jp: areaJp(w.area) });
    });
    if (!items.length) return null;
    if (items.length === 1) {
        // '全域' 하나뿐이면 방향이 없는 원이다.
        const only = items[0];
        return { long: only.km, short: only.km, dir: '' };
    }
    let max = items[0], min = items[0];
    items.forEach((it) => {
        if (it.km > max.km) max = it;
        if (it.km < min.km) min = it;
    });
    return { long: max.km, short: min.km, dir: DIR_OF_JP[min.jp] || '' };
}

/**
 * 풍속(10분 평균 m/s) → 기상청 강도(0~5).
 * 예: gradeOfWind(23) → 1 (약) · gradeOfWind(40) → 3 (강)
 * [왜 환산이 없나] 일본도 우리 기상청과 같은 10분 평균이다. 미국(1분 평균)만 환산했다.
 * @param {number} ms
 * @returns {number|null} 숫자가 아니면 null
 */
function gradeOfWind(ms) {
    if (typeof ms !== 'number' || !isFinite(ms)) return null;
    if (ms >= 54) return 5;
    if (ms >= 44) return 4;
    if (ms >= 33) return 3;
    if (ms >= 25) return 2;
    if (ms >= 17) return 1;
    return 0;
}

/**
 * 목록 파일(targetTc.json) → 지금 발표 중인 태풍들.
 * 예: parseTargetList([{tropicalCyclone:'TC2632',typhoonNumber:'2626',category:'TS'}])
 *       → [{ id:'TC2632', number:'2626', category:'TS' }]
 * [없을 때] 태풍이 없으면 빈 배열이 온다 — 그대로 빈 배열을 돌려준다.
 * [형식 검사] id 는 뒤에서 주소를 만드는 데 쓰이므로 영문+숫자만 받는다(경로조작 차단).
 * @param {Array} json
 * @returns {Array} [{ id, number, category }]
 */
function parseTargetList(json) {
    if (!Array.isArray(json)) return [];
    const out = [];
    json.forEach((t) => {
        const id = String((t && t.tropicalCyclone) || '');
        if (!/^[A-Za-z]{2}\d{4}$/.test(id)) return;
        out.push({
            id: id,
            number: String((t && t.typhoonNumber) || ''),
            category: String((t && t.category) || '')
        });
    });
    return out;
}

/**
 * 본문 파일(specifications.json) → 태풍 하나의 시계열 프레임.
 * 예: parseSpecifications(…) →
 *     { number:'2626', name:'SURIGAE', issuedKst:'202609252150',
 *       frames:[{ time:'202609252100', lat:21.3, lon:127.9, pressure:998, … }, …] }
 * [무엇을 안 만드나] 값이 없는 칸은 null 로 둔다. 예보 시점의 강풍역, 현재 시점의
 *   70%확률반경은 일본이 발표하지 않는다 — 비워 두고 지어내지 않는다.
 * @param {Array} json - specifications.json 내용
 * @returns {Object|null} 못 읽으면 null
 */
function parseSpecifications(json) {
    if (!Array.isArray(json) || !json.length) return null;

    const title = json.find(p => p && p.part === 'title');
    if (!title) return null;
    const number = String(title.typhoonNumber || '');
    const name = String((title.name && (title.name.en || title.name.jp)) || '').toUpperCase();
    const issuedKst = toKstStamp(title.issue && title.issue.JST);

    const frames = [];
    json.forEach((p) => {
        if (!p || p.part === 'title') return;
        const pos = p.position && p.position.deg;
        if (!Array.isArray(pos) || pos.length < 2) return;
        const time = toKstStamp(p.validtime && p.validtime.JST);
        if (!time) return;

        const sustained = (p.maximumWind && p.maximumWind.sustained) || {};
        const gust = (p.maximumWind && p.maximumWind.gust) || {};
        const windMs = num(sustained['m/s']);
        const gale = warningToAsym(p.galeWarning);     // 강풍역 — 초속 15m 이상
        const storm = warningToAsym(p.stormWarning);   // 폭풍역 — 초속 25m 이상
        const catEn = String((p.category && p.category.en) || '');
        const isCurrent = num(p.advancedHours) === 0;

        frames.push({
            time: time,
            lat: num(pos[0]),
            lon: num(pos[1]),
            // 일본은 예상 시점의 중심기압도 발표한다(미국은 현재만 줬다).
            pressure: num(p.pressure),
            windMs: windMs,
            windKmh: (windMs !== null) ? Math.round(windMs * 3.6) : null,
            gustMs: num(gust['m/s']),
            dir: DIR_OF_JP[String(p.course || '')] || '',
            // 이동 속력은 '25' 처럼 숫자로 올 때도, 'ゆっくり'(느림)처럼 말로 올 때도 있다.
            //   말로 온 것을 숫자로 바꾸면 없는 값을 지어내는 셈이라 그때는 비워 둔다.
            speedKmh: num(p.speed && p.speed['km/h']),
            radStrong: gale ? gale.long : null,
            radStrongS: gale ? gale.short : null,
            radStrongD: gale ? gale.dir : '',
            radStorm: storm ? storm.long : null,
            radStormS: storm ? storm.short : null,
            radStormD: storm ? storm.dir : '',
            // 네 방향 값은 미국만 준다. 일본은 장·단반경 방식이라 비운다.
            radQuad34: null,
            radQuad50: null,
            radQuad64: null,
            // 70% 확률반경 — 예보 시점에만 있다(현재 위치에는 없다. 기상청도 같다).
            radProb: num(p.probabilityCircleRadius && p.probabilityCircleRadius.km),
            grade: (gradeOfWind(windMs) !== null) ? gradeOfWind(windMs)
                 : (GRADE_OF_CATEGORY[catEn] !== undefined ? GRADE_OF_CATEGORY[catEn] : null),
            stormType: catEn,
            size: SIZE_OF_JP[String(p.scale || '')] || '',
            isCurrent: isCurrent
        });
    });

    if (!frames.length) return null;
    frames.sort((a, b) => String(a.time).localeCompare(String(b.time)));
    return { number: number, name: name || number, issuedKst: issuedKst, frames: frames };
}

/**
 * 경로 파일(forecast.json) → 태풍이 지나온 실제 경로.
 * 예: parseTrack(…) → [{ lat:14.3, lon:140.7 }, …]
 * [왜 시각·세기가 없나] 일본은 위치만 준다. 미국(.kmz)은 시각·세기도 줬지만,
 *   없는 것을 채워 넣지 않는다 — 화면은 위치만 있어도 선을 그린다.
 * [이어붙이기] 태풍이 되기 전(preTyphoon)과 된 뒤(typhoon)가 나뉘어 오는데,
 *   이어지는 지점이 양쪽에 겹쳐 들어 있어 한 번만 남긴다.
 * @param {Array} json - forecast.json 내용
 * @returns {Array} [{ lat, lon }] — 오래된 것부터
 */
function parseTrack(json) {
    if (!Array.isArray(json)) return [];
    const analysis = json.find(p => p && p.track);
    if (!analysis) return [];
    const out = [];
    ['preTyphoon', 'typhoon'].forEach((key) => {
        const arr = analysis.track[key];
        if (!Array.isArray(arr)) return;
        arr.forEach((pt) => {
            if (!Array.isArray(pt) || pt.length < 2) return;
            const lat = num(pt[0]), lon = num(pt[1]);
            if (lat === null || lon === null) return;
            const last = out[out.length - 1];
            if (last && last.lat === lat && last.lon === lon) return;   // 이음새 중복 제거
            out.push({ lat: lat, lon: lon });
        });
    });
    return out;
}

module.exports = {
    parseTargetList,
    parseSpecifications,
    parseTrack,
    // 아래는 시험에서 규칙을 하나씩 고정하려고 연다.
    _toKstStamp: toKstStamp,
    _warningToAsym: warningToAsym,
    _gradeOfWind: gradeOfWind,
    _areaJp: areaJp
};
