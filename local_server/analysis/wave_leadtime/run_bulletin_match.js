'use strict';
/*
 * 통보문 (해상) 경고 ↔ 풍랑특보 발효 매칭 분석.
 *  - 입력: data/bulletins.json, data/warnings_2023-2026.csv, out/prelim_events.json
 *  - 출력: out/bulletin_warnings.json, 콘솔 통계(리포트용)
 */
const fs = require('path') && require('fs');
const path = require('path');
const DIR = __dirname;

// ─────────────────────────────────────────────────────────────────────────
// 0. 구역 정규화 / 포함관계
// ─────────────────────────────────────────────────────────────────────────
function normName(s) {
  return String(s == null ? '' : s).replace(/[\s·.()]/g, '').trim();
}
// "안쪽/바깥/전" 수식어를 분리한 base 와 sub(안/바깥/전/none) 반환
// 예: 동해중부안쪽먼바다 -> {base:"동해중부먼바다", sub:"안"}
//     동해중부바깥먼바다 -> {base:"동해중부먼바다", sub:"바깥"}
//     동해중부먼바다     -> {base:"동해중부먼바다", sub:"전"}  (umbrella)
//     동해중부전해상     -> {base:"동해중부", sub:"전", sea:true}
//     동해중부해상       -> {base:"동해중부", sub:"전", sea:true}
function decompZone(raw) {
  let z = normName(raw);
  // 해상/전해상 → 해당 광역의 모든 바다 우산
  let sea = false;
  if (/전?해상$/.test(z)) { sea = true; z = z.replace(/전?해상$/, ''); }
  let sub = '전';
  // 안쪽/바깥 수식
  if (z.includes('안쪽')) { sub = '안'; z = z.replace('안쪽', ''); }
  else if (z.includes('바깥')) { sub = '바깥'; z = z.replace('바깥', ''); }
  return { base: z, sub, sea };
}
/*
 * 두 구역(통보문 측 b, 발효 측 w)이 매칭되는가?
 * 규칙(포함 허용):
 *   - base(안/바깥 제거, 해상 제거)가 같아야 한다.
 *   - 통보문이 '전'(umbrella, 안/바깥 미구분 or 해상)이면 발효의 안/바깥/전 모두 매칭.
 *   - 통보문이 '안'/'바깥' 구체적이면 같은 sub 또는 발효가 '전'일 때 매칭.
 *   - 통보문이 sea(해상/전해상)이면 base 가 발효 base 의 prefix 이거나 동일하면 매칭
 *     (예: 통보문 "동해중부해상" base="동해중부" ↔ 발효 "동해중부먼바다" base="동해중부먼바다").
 */
function zoneMatch(b, w) {
  const B = decompZone(b), W = decompZone(w);
  let baseHit;
  if (B.sea || W.sea) {
    // 해상 우산: prefix 포함 비교 ("동해중부" ⊂ "동해중부먼바다"/"동해중부앞바다")
    baseHit = W.base.startsWith(B.base) || B.base.startsWith(W.base);
  } else {
    baseHit = B.base === W.base;
  }
  if (!baseHit) return false;
  if (B.sub === '전' || W.sub === '전' || B.sea || W.sea) return true;
  return B.sub === W.sub;
}

// ─────────────────────────────────────────────────────────────────────────
// 1. 통보문 (해상) 파싱
// ─────────────────────────────────────────────────────────────────────────
function parseTmFc(s) {
  // "2024-12-31 16:20:00.0"
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
}
// 구역 토큰 추출(한 줄에 여러개). 한글+괄호 가능, 바다/해상으로 끝남.
const ZONE_RE = /[가-힣][가-힣()]*(?:먼바다|앞바다|연안바다|전해상|해상)/g;
function extractZones(s) {
  const set = [];
  let m;
  ZONE_RE.lastIndex = 0;
  while ((m = ZONE_RE.exec(s))) {
    let z = m[0];
    // 괄호 안 하위구역 분리: "제주도앞바다(제주도동부앞바다...)" → 바깥 텍스트만
    z = z.replace(/\(.*$/, '');
    if (z.length >= 3) set.push(z);
  }
  return [...new Set(set)];
}
// 풍속 m/s 상한: "30~50km/h(9~14m/s)" 또는 "(15m/s)" → 14 / 15
function maxWindMs(s) {
  let max = null;
  const re = /(?:(\d+)\s*~\s*)?(\d+)\s*m\/s/g;
  let m;
  while ((m = re.exec(s))) {
    const hi = +m[2];
    if (max == null || hi > max) max = hi;
  }
  return max;
}
// 물결 m 상한: "1.5~3.0m" / "최대 5.0m 이상" → 3.0 / 5.0
function maxWaveM(s) {
  let max = null;
  const re = /(?:(\d+(?:\.\d+)?)\s*~\s*)?(\d+(?:\.\d+)?)\s*m(?!\/s)/g;
  let m;
  while ((m = re.exec(s))) {
    const hi = parseFloat(m[2]);
    if (max == null || hi > max) max = hi;
  }
  return max;
}
// 풍랑특보 언급 분류
function warnFlag(s) {
  // 예비특보 명시(아직 발효 전 예고) → prelim 우선
  if (s.includes('예비특보')) return 'prelim';
  const hasFeng = s.includes('풍랑특보') || s.includes('풍랑주의보') || s.includes('풍랑경보');
  if (!hasFeng) return 'none';
  // 이미 발효
  if (/풍랑(?:특보|주의보|경보)가?\s*발효/.test(s) || s.includes('발효된') || s.includes('발효 중')) return 'active';
  // 예비/가능성
  if (/발표(?:될|할|되)?\s*(?:가능성|예정)/.test(s) || s.includes('발표될') || s.includes('발표할')) return 'prelim';
  if (/해제/.test(s) && !/발표/.test(s)) return 'release';
  return 'mention';
}
// 예상 시점 표현(텍스트 그대로)
function timeExpr(s) {
  const m = s.match(/(오늘|내일|모레|글피|그글피|당분간|새벽|오전|오후|밤|아침|저녁)[^,]{0,12}?(?:부터|까지|사이|내외)?/);
  return m ? m[0] : null;
}

function parseBulletins() {
  const b = JSON.parse(fs.readFileSync(path.join(DIR, 'data', 'bulletins.json'), 'utf8'));
  const out = [];
  let nMarineLines = 0, nSeaLines = 0, nZoneEmpty = 0;
  for (const key of Object.keys(b)) {
    const it = b[key];
    const tmFc = parseTmFc(it.tmFc);
    if (tmFc == null) continue;
    for (const ln of (it.marine || [])) {
      nMarineLines++;
      if (!ln.includes('(해상)')) continue; // (해상) 줄만 대상
      nSeaLines++;
      const zones = extractZones(ln);
      if (!zones.length) { nZoneEmpty++; continue; }
      const windMs = maxWindMs(ln);
      const waveM = maxWaveM(ln);
      const flag = warnFlag(ln);
      const texpr = timeExpr(ln);
      for (const z of zones) {
        out.push({
          id: key, stn: it.stn, office: it.office,
          tmFc, zone: z, windMs, waveM, warnFlag: flag, timeExpr: texpr,
          line: ln,
        });
      }
    }
  }
  return { rows: out, stats: { nMarineLines, nSeaLines, nZoneEmpty } };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. 발효 이벤트 파싱 (CSV)
// ─────────────────────────────────────────────────────────────────────────
function parseDateKo(s) {
  // "2026년 06월 02일 01시 00분"
  const m = s.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2})시\s*(\d{2})분/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
}
// 해당지역 칸에서 "(N) 풍랑XX 발표 : <zones>" 단위 추출
function splitIndexed(s) {
  // 분할: " / " 로 (N) 단위 구분
  const segs = s.split(/\s\/\s/);
  const map = {};
  for (const seg of segs) {
    const im = seg.match(/^\s*\((\d+)\)\s*(.*)$/s);
    if (!im) continue;
    map[im[1]] = im[2];
  }
  return map;
}
// zones 텍스트 → 구역 배열. 부모(자식...) 형태에서 자식까지 펼침 + 부모도 포함.
function zonesFromText(s) {
  // 먼저 (해제예고 등) 텍스트 제거: 우리는 발효 zone 칸만 받음
  const out = [];
  // 괄호 안과 밖 모두 토큰 추출
  let t = s;
  let m;
  ZONE_RE.lastIndex = 0;
  while ((m = ZONE_RE.exec(t))) {
    let z = m[0].replace(/\(.*$/, '');
    if (z.length >= 3) out.push(z);
  }
  // 괄호 내부 자식들
  const inner = s.match(/\(([^)]*)\)/g) || [];
  for (const grp of inner) {
    let mm; ZONE_RE.lastIndex = 0;
    while ((mm = ZONE_RE.exec(grp))) {
      let z = mm[0].replace(/[()]/g, '');
      if (z.length >= 3) out.push(z);
    }
  }
  return [...new Set(out)];
}
function parseWarnings(sinceMs) {
  const raw = fs.readFileSync(path.join(DIR, 'data', 'warnings_2023-2026.csv'), 'utf8');
  const lines = raw.split(/\r?\n/);
  const events = new Map(); // key effTime|zone|level -> {effTime, zone, level, announce}
  let nRows = 0, nFengRows = 0, parseFail = 0;
  for (const ln of lines.slice(1)) {
    if (!ln.trim()) continue;
    nRows++;
    if (!ln.includes('풍랑') || !ln.includes('발표')) continue;
    nFengRows++;
    const cols = ln.split(',');
    if (cols.length < 4) continue;
    const announceRaw = cols[0];
    const announce = (() => {
      const m = announceRaw.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
      return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : null;
    })();
    const effCol = cols[2];
    const zoneCol = cols[3];
    const effMap = {};
    for (const seg of effCol.split(/\s\/\s/)) {
      const im = seg.match(/^\s*\((\d+)\)\s*(.*)$/s);
      if (!im) continue;
      if (!im[2].includes('발표')) continue; // 해제 제외
      const d = parseDateKo(im[2]);
      const level = im[2].includes('경보') ? '경보' : '주의보';
      if (d != null) effMap[im[1]] = { effTime: d, level };
    }
    const zoneMap = {};
    for (const seg of zoneCol.split(/\s\/\s/)) {
      const im = seg.match(/^\s*\((\d+)\)\s*(.*)$/s);
      if (!im) continue;
      if (!im[2].includes('발표')) continue;
      zoneMap[im[1]] = zonesFromText(im[2]);
    }
    for (const idx of Object.keys(effMap)) {
      const ef = effMap[idx];
      const zs = zoneMap[idx] || [];
      if (sinceMs != null && ef.effTime < sinceMs) continue;
      for (const z of zs) {
        const key = ef.effTime + '|' + z + '|' + ef.level;
        if (!events.has(key)) {
          events.set(key, { effTime: ef.effTime, zone: z, level: ef.level, announce });
        }
      }
    }
  }
  return { events: [...events.values()], stats: { nRows, nFengRows, parseFail } };
}

// ─────────────────────────────────────────────────────────────────────────
// 통계 헬퍼
// ─────────────────────────────────────────────────────────────────────────
function quantile(arr, q) {
  if (!arr.length) return null;
  const a = [...arr].sort((x, y) => x - y);
  const pos = (a.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return a[lo];
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
const DAY = 86400000, HOUR = 3600000;

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────
const SINCE = new Date(2024, 11, 5).getTime(); // 2024-12-05

const { rows: bRows, stats: bStats } = parseBulletins();
const bSince = bRows.filter(r => r.tmFc >= SINCE);
const { events: wEvents, stats: wStats } = parseWarnings(SINCE);

// 저장: out/bulletin_warnings.json
fs.writeFileSync(path.join(DIR, 'out', 'bulletin_warnings.json'),
  JSON.stringify(bRows, null, 0));

console.log('===== 파싱 통계 =====');
console.log('통보문 marine 줄 총수:', bStats.nMarineLines, '| (해상) 줄:', bStats.nSeaLines, '| 구역추출 실패(해상줄중):', bStats.nZoneEmpty);
console.log('통보문 (해상) 구역행(zone-level rows) 총:', bRows.length, '| 2024-12-05 이후:', bSince.length);
console.log('CSV 전체행:', wStats.nRows, '| 풍랑+발표 포함행:', wStats.nFengRows);
console.log('풍랑 발효 이벤트(2024-12-05 이후, dedup):', wEvents.length);
const levCnt = {}; for (const e of wEvents) levCnt[e.level] = (levCnt[e.level] || 0) + 1;
console.log('  레벨:', JSON.stringify(levCnt));

// ── 구역 매칭률 진단: 발효 구역명들이 통보문 구역세트에 매칭되는지 ──
const bZoneSet = [...new Set(bSince.map(r => r.zone))];
const wZoneSet = [...new Set(wEvents.map(e => e.zone))];
let matchableW = 0;
const unmatchedW = {};
for (const wz of wZoneSet) {
  const ok = bZoneSet.some(bz => zoneMatch(bz, wz));
  if (ok) matchableW++; else unmatchedW[wz] = (unmatchedW[wz] || 0);
}
console.log('\n===== 구역 매칭 진단 =====');
console.log('통보문 distinct 구역:', bZoneSet.length, '| 발효 distinct 구역:', wZoneSet.length);
console.log('발효 구역 중 통보문 구역집합과 매칭 가능:', matchableW, '/', wZoneSet.length,
  '(' + (100 * matchableW / wZoneSet.length).toFixed(1) + '%)');
console.log('매칭 불가 발효구역 예:', Object.keys(unmatchedW).slice(0, 20).join(', '));

// ─────────────────────────────────────────────────────────────────────────
// 3. 사전경고 매칭 (각 발효 이벤트 → 0~5일 전 같은구역 통보문 경고)
// ─────────────────────────────────────────────────────────────────────────
// 통보문을 구역 base 키로 버킷팅(속도). 매칭은 zoneMatch 로 최종 확인.
// 효율: 정렬된 통보문 + 시간창 필터
bSince.sort((a, b) => a.tmFc - b.tmFc);
const bTimes = bSince.map(r => r.tmFc);
function lowerBound(arr, x) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < x) lo = m + 1; else hi = m; } return lo; }

let nWarned = 0;        // 사전경고 있었던 발효
const leadAll = [];     // 최초경고 리드타임(hours)
const leadFeng = [];    // 통보문이 풍랑 명시(active/prelim/mention)한 경우 리드
const leadWaveOnly = []; // 풍랑 미명시(none) 물결/바람만
const perEvent = [];
for (const ev of wEvents) {
  const t0 = ev.effTime - 5 * DAY, t1 = ev.effTime; // 0~5일 전
  const lo = lowerBound(bTimes, t0);
  let firstWarn = null, fengWarn = false, waveOnlyWarn = false;
  for (let i = lo; i < bSince.length; i++) {
    const r = bSince[i];
    if (r.tmFc > t1) break;
    if (!zoneMatch(r.zone, ev.zone)) continue;
    // 경고로 간주: 풍랑 언급 or 바람≥강풍/물결 경고가 있는 (해상) 줄 = 전부 (해상) 줄이므로 경고성
    if (firstWarn == null || r.tmFc < firstWarn) firstWarn = r.tmFc;
    if (r.warnFlag === 'active' || r.warnFlag === 'prelim' || r.warnFlag === 'mention') fengWarn = true;
    else waveOnlyWarn = true;
  }
  const matched = firstWarn != null;
  if (matched) {
    nWarned++;
    const lead = (ev.effTime - firstWarn) / HOUR;
    leadAll.push(lead);
    // 분류: 풍랑명시 통보문이 하나라도 있으면 feng, 아니면 waveOnly
    if (fengWarn) leadFeng.push(lead); else leadWaveOnly.push(lead);
  }
  perEvent.push({ ev, matched, lead: matched ? (ev.effTime - firstWarn) / HOUR : null, fengWarn });
}
console.log('\n===== 3. 사전경고율 / 리드타임 =====');
console.log('발효 이벤트:', wEvents.length, '| 사전경고(0~5일전 통보문)있음:', nWarned,
  '(' + (100 * nWarned / wEvents.length).toFixed(1) + '%)');
function dist(name, a) {
  if (!a.length) { console.log(name, 'n=0'); return; }
  console.log(`${name} n=${a.length} | 리드(h) p10=${quantile(a, .1).toFixed(1)} p25=${quantile(a, .25).toFixed(1)} 중앙=${quantile(a, .5).toFixed(1)} p75=${quantile(a, .75).toFixed(1)} p90=${quantile(a, .9).toFixed(1)} 평균=${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(1)}`);
}
dist('전체경고', leadAll);
dist('풍랑명시', leadFeng);
dist('물결/바람만', leadWaveOnly);

// ─────────────────────────────────────────────────────────────────────────
// 4. 역방향(거짓경고율): 통보문 (해상) 경고 → 3일내 실제 발효?
//    경고 정의: warnFlag active/prelim/mention 또는 waveM>=2.0 또는 windMs>=14 (풍랑 위험 신호)
// ─────────────────────────────────────────────────────────────────────────
wEvents.sort((a, b) => a.effTime - b.effTime);
const wTimes = wEvents.map(e => e.effTime);
function isWarnRow(r) {
  if (r.warnFlag === 'active' || r.warnFlag === 'prelim' || r.warnFlag === 'mention') return true;
  if (r.waveM != null && r.waveM >= 2.0) return true;
  if (r.windMs != null && r.windMs >= 14) return true;
  return false;
}
let nWarnRows = 0, nHit3d = 0;
for (const r of bSince) {
  if (!isWarnRow(r)) continue;
  nWarnRows++;
  const t0 = r.tmFc, t1 = r.tmFc + 3 * DAY;
  const lo = lowerBound(wTimes, t0);
  let hit = false;
  for (let i = lo; i < wEvents.length; i++) {
    const e = wEvents[i];
    if (e.effTime > t1) break;
    if (zoneMatch(r.zone, e.zone)) { hit = true; break; }
  }
  if (hit) nHit3d++;
}
console.log('\n===== 4. 거짓경고율 / 적중률 =====');
console.log('통보문 (해상) 경고행:', nWarnRows, '| 3일내 실제 발효:', nHit3d,
  '적중률=' + (100 * nHit3d / nWarnRows).toFixed(1) + '% | 거짓경고율=' + (100 * (1 - nHit3d / nWarnRows)).toFixed(1) + '%');

// ─────────────────────────────────────────────────────────────────────────
// 5. 강도별 발효율 (풍속 m/s, 물결 m 구간별 → 3일내 발효율)
// ─────────────────────────────────────────────────────────────────────────
function hitWithin3d(r) {
  const lo = lowerBound(wTimes, r.tmFc);
  for (let i = lo; i < wEvents.length; i++) {
    const e = wEvents[i];
    if (e.effTime > r.tmFc + 3 * DAY) break;
    if (zoneMatch(r.zone, e.zone)) return true;
  }
  return false;
}
function bucketStats(rows, getVal, edges) {
  const buckets = edges.map((lo, i) => ({ lo, hi: edges[i + 1] ?? Infinity, n: 0, hit: 0 }));
  for (const r of rows) {
    const v = getVal(r);
    if (v == null) continue;
    const b = buckets.find(b => v >= b.lo && v < b.hi);
    if (!b) continue;
    b.n++;
    if (hitWithin3d(r)) b.hit++;
  }
  return buckets;
}
console.log('\n===== 5. 강도별 발효율(3일내) =====');
console.log('-- 풍속 m/s 상한 구간 --');
for (const b of bucketStats(bSince, r => r.windMs, [0, 9, 12, 14, 16, 18])) {
  console.log(`  ${b.lo}~${b.hi === Infinity ? '∞' : b.hi} m/s: n=${b.n} 발효=${b.hit} (${b.n ? (100 * b.hit / b.n).toFixed(1) : '0'}%)`);
}
console.log('-- 물결 m 상한 구간 --');
for (const b of bucketStats(bSince, r => r.waveM, [0, 1.5, 2.0, 2.5, 3.0, 4.0])) {
  console.log(`  ${b.lo}~${b.hi === Infinity ? '∞' : b.hi} m: n=${b.n} 발효=${b.hit} (${b.n ? (100 * b.hit / b.n).toFixed(1) : '0'}%)`);
}
console.log('-- 풍랑특보 명시여부별 --');
for (const f of ['active', 'prelim', 'mention', 'none', 'release']) {
  const rows = bSince.filter(r => r.warnFlag === f);
  let hit = 0; for (const r of rows) if (hitWithin3d(r)) hit++;
  console.log(`  ${f}: n=${rows.length} 발효=${hit} (${rows.length ? (100 * hit / rows.length).toFixed(1) : '0'}%)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. 예비특보 연계: prelim_events announceAt 기준 며칠전부터 통보문 경고
// ─────────────────────────────────────────────────────────────────────────
const prelim = JSON.parse(fs.readFileSync(path.join(DIR, 'out', 'prelim_events.json'), 'utf8'))
  .filter(e => e.kind === '풍랑' && e.announceAt >= SINCE);
let pWarned = 0; const pLead = [];
for (const pe of prelim) {
  const t0 = pe.announceAt - 5 * DAY, t1 = pe.announceAt;
  const lo = lowerBound(bTimes, t0);
  let first = null;
  for (let i = lo; i < bSince.length; i++) {
    const r = bSince[i];
    if (r.tmFc > t1) break;
    if (!zoneMatch(r.zone, pe.zone)) continue;
    if (first == null || r.tmFc < first) first = r.tmFc;
  }
  if (first != null) { pWarned++; pLead.push((pe.announceAt - first) / HOUR); }
}
console.log('\n===== 6. 예비특보 연계 =====');
console.log('풍랑 예비특보(2024-12-05 이후):', prelim.length, '| 발표前 5일내 통보문경고 있음:', pWarned,
  '(' + (100 * pWarned / prelim.length).toFixed(1) + '%)');
dist('예비특보前 통보문 리드', pLead);

// 결과 요약 객체도 파일로
fs.writeFileSync(path.join(DIR, 'out', 'bulletin_match_summary.json'), JSON.stringify({
  parseStats: bStats, warnStats: wStats,
  bulletinRows: bRows.length, bulletinRowsSince: bSince.length, warnEvents: wEvents.length,
  zoneMatchable: matchableW, zoneTotal: wZoneSet.length,
  preWarnRate: nWarned / wEvents.length, nWarned, nEvents: wEvents.length,
  leadAll: { n: leadAll.length, p25: quantile(leadAll, .25), p50: quantile(leadAll, .5), p75: quantile(leadAll, .75) },
  leadFeng: { n: leadFeng.length, p50: quantile(leadFeng, .5) },
  leadWaveOnly: { n: leadWaveOnly.length, p50: quantile(leadWaveOnly, .5) },
  falseWarn: { nWarnRows, nHit3d, hitRate: nHit3d / nWarnRows },
}, null, 2));
console.log('\n저장: out/bulletin_warnings.json, out/bulletin_match_summary.json');
