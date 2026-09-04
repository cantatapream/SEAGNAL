/**
 * ============================================================================
 * 파일명: local_server/scripts/build_warn_intervals.js
 * 역할  : "특보가 언제부터 언제까지 떠 있었나"를 구역별로 뽑아 클라이언트가 쓸 수 있는
 *         파일로 만든다(빌드타임 1회성, 배포 코드에는 안 실림).
 *
 * [왜 필요한가]
 *   지금 앱이 가진 것은 "이 사고가 났을 때 특보가 떠 있었다"는 사고별 딱지뿐이다.
 *   "이 바다에 특보가 며칠 떠 있었나"는 어디에도 없다 — 그 계산은 빌드 과정 안에서만
 *   잠깐 만들어졌다가 버려진다. 격자 칸을 눌렀을 때 "특보 발효 일수"를 보여주려면
 *   그 중간 결과를 파일로 남겨야 한다(설계서 작업 6 G-8).
 *
 * [실행]
 *   cd /home/user/SEAGNAL
 *   npm install --no-save @turf/turf   # 운영 환경에 영구 설치 금지(기존 관례)
 *   node local_server/scripts/build_warn_intervals.js
 *
 * [출력] client/warn_intervals.json
 *   {
 *     "v": 1,
 *     "start": "20160826",           // 원본 통보문이 시작되는 날(그 이전은 계산 불가)
 *     "end": "20251231",
 *     "zones": { "제주도북부앞바다": { "WV|주의보": [[20160826,20160827], ...] } }
 *   }
 *   날짜는 YYYYMMDD 정수, 각 구간은 [시작일, 끝일] 로 그 날들을 전부 포함한다.
 *   같은 (구역,종류,레벨)의 붙어 있거나 겹치는 구간은 미리 합쳐 둔다.
 *
 * [왜 날짜 단위인가]
 *   사용자 확정(2026-09-04): "하루 중 일부만 발효돼도 1일로 센다". 인명사고는 발생
 *   시각이 없어 어차피 날짜로만 판정하고 있어(build_accident_warn_flags.js 참고),
 *   기준을 날짜로 통일하는 편이 사람이 이해하기도 쉽다.
 *
 * [연계] 구간 계산 자체는 build_accident_warn_flags.js 의 buildIntervals() 를 그대로
 *   쓴다 — 같은 원본에서 같은 규칙으로 뽑아야 사고 딱지와 발효 일수가 어긋나지 않는다.
 *   읽는 쪽: client/js/marine-life/safety/accident_info.js (S11 에서 연결)
 * ============================================================================
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { buildIntervals } = require('./build_accident_warn_flags.js');

const OUT_PATH = path.join(__dirname, '..', '..', 'client', 'warn_intervals.json');

/** 구역 이름 정규화 — 표기 흔들림(공백·가운뎃점·마침표)을 없앤다.
 * loadZoneFeatures() 가 해상구역에 쓰는 것과 같은 규칙. */
function normZone(name) { return String(name).replace(/[\s·.]/g, ''); }

/** 'YYYY-MM-DD HH:MM' -> 20160826 (정수). 시각은 버린다(날짜 단위로 세기 때문). */
function toYmdInt(s) {
    return Number(String(s).slice(0, 10).replace(/-/g, ''));
}

/** YYYYMMDD 정수를 하루 더한다 — 구간을 합칠 때 "바로 다음 날"인지 보려고 쓴다. */
function nextDay(ymd) {
    const d = new Date(Math.floor(ymd / 10000), Math.floor(ymd / 100) % 100 - 1, ymd % 100);
    d.setDate(d.getDate() + 1);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** [시작,끝] 날짜 구간들을 정렬해 겹치거나 붙은 것을 합친다. */
function mergeRanges(ranges) {
    if (!ranges.length) return [];
    ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = [ranges[0].slice()];
    for (let i = 1; i < ranges.length; i++) {
        const cur = out[out.length - 1];
        const r = ranges[i];
        if (r[0] <= nextDay(cur[1])) { if (r[1] > cur[1]) cur[1] = r[1]; }
        else out.push(r.slice());
    }
    return out;
}

function main() {
    console.log('[1/3] 통보문에서 특보 구간 계산...');
    const intervals = buildIntervals();

    console.log('[2/3] 날짜 단위로 바꾸고 구간 합치기...');
    const zones = {};
    let minYmd = null, maxYmd = null, rawCount = 0;
    const collisions = [];
    Object.keys(intervals).forEach((key) => {
        // key = "구역|종류코드|레벨"  (예: "제주도북부앞바다|WV|주의보")
        const parts = key.split('|');
        if (parts.length !== 3) return;
        // 구역 이름에서 공백·가운뎃점·마침표를 뺀다 — 통보문은 "인천·경기북부앞바다",
        // 지도 폴리곤은 "인천.경기북부앞바다" 처럼 표기가 갈려서 그대로 두면 짝이 안
        // 맞는다(실측: 44개 해상구역 중 2개가 이 이유로 안 붙었다). 읽는 쪽도 같은
        // 규칙으로 정규화해서 맞춘다.
        const zone = normZone(parts[0]), sub = parts[1] + '|' + parts[2];
        const list = intervals[key].map((iv) => {
            const a = toYmdInt(iv.start), b = toYmdInt(iv.end);
            if (minYmd === null || a < minYmd) minYmd = a;
            if (maxYmd === null || b > maxYmd) maxYmd = b;
            rawCount++;
            return [a, b];
        });
        var bucket = (zones[zone] || (zones[zone] = {}));
        if (bucket[sub]) {
            // 정규화로 서로 다른 구역이 한 이름이 되면 구간이 덮어써진다 — 합쳐 둔다.
            collisions.push(zone + ' ' + sub);
            bucket[sub] = mergeRanges(bucket[sub].concat(list));
        } else {
            bucket[sub] = mergeRanges(list);
        }
    });

    let mergedCount = 0, dayCount = 0;
    Object.keys(zones).forEach((z) => Object.keys(zones[z]).forEach((k) => {
        mergedCount += zones[z][k].length;
    }));

    console.log('[3/3] 저장...');
    const out = { v: 1, start: String(minYmd), end: String(maxYmd), zones: zones };
    fs.writeFileSync(OUT_PATH, JSON.stringify(out));
    const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(0);
    console.log(`  구역 ${Object.keys(zones).length}개 · 원본 구간 ${rawCount}개 -> 날짜 구간 ${mergedCount}개`);
    console.log(`  기간 ${out.start} ~ ${out.end}`);
    if (collisions.length) console.log('  ⚠정규화로 이름이 겹친 구역:', collisions.length, collisions.slice(0, 5));
    console.log(`  저장: ${OUT_PATH} (${kb}KB)`);
}

main();
