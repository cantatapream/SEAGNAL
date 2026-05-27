/**
 * 일회성 스크립트: 이미지1 선박별 좌표/일자에 대해 TideBED 조석(고조/저조)을
 * 수집하여 엑셀로 정리. 창: 해당일 D-3 ~ D+2 (6일치). 조차(전 극값과의 차)는
 * 연속 시계열에서 계산하기 위해 D-4 ~ D+2 를 수집한다.
 * TideBED 는 2025-01-01 이후만 지원 → 미지원 날짜는 '수집불가'로 표기.
 */
const XLSX = require('xlsx');
const { collectTideBedData } = require('./services/tide_collector');

// ── 입력: 이미지1 (일자, 시간, 선명, 위도(deg-min), 경도(deg-min)) ──────────
const ROWS = [
  ['2024-01-09', '16:43', '민복정어09655', [32, 58.47], [124, 42.06]],
  ['2026-01-24', '13:04', '민복정어06786', [33, 7.18],  [124, 30.00]],
  ['2026-01-04', '19:20', '경담어19988',   [33, 8.10],  [124, 31.47]],
  ['2025-01-03', '19:00', '민복정어09957', [32, 15.33], [124, 40.31]],
  ['2025-01-06', '6:40',  '민복정어01977', [33, 0],     [124, 39]],
  ['2025-01-06', '6:40',  '월륙어28829',   [32, 14],    [125, 54.77]],
  ['2026-01-22', '22:00', '월렴어15006',   [33, 31.62], [124, 11.62]],
  ['2026-01-22', '12:30', '민복정어08611', [33, 33.48], [124, 10.71]],
  ['2026-01-03', '18:00', '민복정어08627', [33, 36],    [124, 8]],
  ['2023-10-26', '17:05', '민복정어01979', [33, 2],     [124, 34]],
  ['2023-10-31', '9:43',  '민복정어06786', [33, 6.58],  [124, 27.91]],
  ['2023-12-24', '3:00',  '민복정어08609', [33, 43],    [124, 13]],
  ['2023-04-05', '16:50', '민하어01229',   [33, 54],    [124, 11]],
  ['2023-04-12', '6:20',  '절대어03523',   [33, 30],    [124, 10]],
];

const MIN_SUPPORTED = '2025-01-01';

function dm(arr) { return arr[0] + arr[1] / 60; } // deg-decimalmin → decimal deg
function ymd(d) { return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0'); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function addDays(base, n) { const d = new Date(base); d.setDate(base.getDate() + n); return d; }

// ── 전체 피크 추출 (peak_finder.js 알고리즘 복제, 날짜필터/4개 cap 없이) ─────
//   연속 시계열 전체에서 모든 고조/저조를 시간순으로 뽑아 인접 조차 계산에 사용.
function timeToDate(t) { return new Date(t.replace(/-/g, '/')); }
function midTimeStr(t1, t2) {
  const mid = new Date((timeToDate(t1).getTime() + timeToDate(t2).getTime()) / 2);
  return String(mid.getHours()).padStart(2, '0') + ':' + String(mid.getMinutes()).padStart(2, '0');
}
function extractAllPeaks(items) {
  // 사용자 선택: 정확한 원본 격자예측값(obsrvnDt/obsrvnHgt) 사용.
  //   slctd(기준조위소 보정)는 격자별 josi 만큼 날짜가 밀리는 부작용이 있어
  //   날짜·시각 정렬이 깨끗한 obsrvn 으로 추출 (조차 계산도 정확).
  const points = items.map(i => ({
    time: i.obsrvnDt,
    height: parseFloat(i.obsrvnHgt)
  })).filter(p => !isNaN(p.height) && p.time);
  points.sort((a, b) => timeToDate(a.time) - timeToDate(b.time));
  if (points.length < 60) return [];

  let peaks = [];
  let lastDir = 0, flatStart = -1;
  for (let i = 1; i < points.length; i++) {
    const diff = points[i].height - points[i - 1].height;
    if (diff > 0) {
      if (lastDir === -1) {
        const s = flatStart >= 0 ? flatStart : i - 1, e = i - 1;
        peaks.push({ type: 'low', startTime: points[s].time, midFull: points[Math.round((s + e) / 2)].time, mid: midTimeStr(points[s].time, points[e].time), height: points[e].height });
      }
      lastDir = 1; flatStart = -1;
    } else if (diff < 0) {
      if (lastDir === 1) {
        const s = flatStart >= 0 ? flatStart : i - 1, e = i - 1;
        peaks.push({ type: 'high', startTime: points[s].time, midFull: points[Math.round((s + e) / 2)].time, mid: midTimeStr(points[s].time, points[e].time), height: points[e].height });
      }
      lastDir = -1; flatStart = -1;
    } else {
      if (flatStart < 0) flatStart = i - 1;
    }
  }

  // 유의 피크 선별 (peak_finder.filterPeaks 와 동일: 180분 이내 동종 피크는 극값만 유지)
  const filterPeaks = (ps) => {
    if (ps.length <= 1) return ps;
    ps.sort((a, b) => timeToDate(a.startTime) - timeToDate(b.startTime));
    const out = [ps[0]];
    for (let i = 1; i < ps.length; i++) {
      const prev = out[out.length - 1], cur = ps[i];
      const dmin = (timeToDate(cur.startTime) - timeToDate(prev.startTime)) / 60000;
      if (dmin > 180) out.push(cur);
      else if (cur.type === 'high' && cur.height > prev.height) out[out.length - 1] = cur;
      else if (cur.type === 'low' && cur.height < prev.height) out[out.length - 1] = cur;
    }
    return out;
  };
  const highs = filterPeaks(peaks.filter(p => p.type === 'high'));
  const lows = filterPeaks(peaks.filter(p => p.type === 'low'));
  const all = highs.concat(lows).sort((a, b) => timeToDate(a.midFull) - timeToDate(b.midFull));
  return all;
}

async function collectDay(lat, lon, dateObj) {
  if (iso(dateObj) < MIN_SUPPORTED) return { items: [], supported: false };
  const items = await collectTideBedData(lat, lon, ymd(dateObj));
  return { items, supported: true };
}

async function processRow(row) {
  const [dateStr, timeStr, name, latDM, lonDM] = row;
  const lat = dm(latDM).toFixed(5), lon = dm(lonDM).toFixed(5);
  const base = new Date(dateStr.replace(/-/g, '/'));

  // D-4 ..D+2 수집 (D-4는 D-3 첫 극값의 조차 계산용)
  const offsets = [-4, -3, -2, -1, 0, 1, 2];
  const dayResults = {};
  for (const off of offsets) {
    const d = addDays(base, off);
    dayResults[off] = await collectDay(lat, lon, d);
  }

  // 연속 시계열 합치기 (수집된 날짜만) → 전체 피크 + 인접 조차
  let allItems = [];
  for (const off of offsets) allItems = allItems.concat(dayResults[off].items);
  const peaks = extractAllPeaks(allItems);
  for (let i = 0; i < peaks.length; i++) {
    peaks[i].diff = i === 0 ? null : Math.round(peaks[i].height - peaks[i - 1].height);
    peaks[i].dateISO = peaks[i].midFull.slice(0, 10);
  }

  // 표시 대상: D-3 ..D+2 (6일)
  const outRows = [];
  for (const off of [-3, -2, -1, 0, 1, 2]) {
    const d = addDays(base, off);
    const dISO = iso(d);
    const isBaseDay = off === 0;
    if (dISO < MIN_SUPPORTED) {
      outRows.push({ name, dateStr, timeStr, lat, lon, dayISO: dISO, isBaseDay, note: '수집불가(API 미지원: 2025-01-01 이전)', tides: [] });
      continue;
    }
    const dayPeaks = peaks.filter(p => p.dateISO === dISO);
    outRows.push({ name, dateStr, timeStr, lat, lon, dayISO: dISO, isBaseDay, note: dayPeaks.length ? '' : '데이터 없음', tides: dayPeaks });
  }
  return { name, dateStr, timeStr, lat, lon, base, outRows };
}

(async () => {
  const results = [];
  for (const row of ROWS) {
    process.stderr.write(`\n▶ ${row[2]} (${row[0]}) 수집중...`);
    results.push(await processRow(row));
  }

  // ── 엑셀 시트 구성: 평면 테이블 (선박별 6일 × 고조/저조) ──────────────
  const aoa = [];
  const header = ['선명', '기준일자', '기준시간', '위도', '경도', '조석일자', '요일', '구분', '시각', '조위(cm)', '전조차(cm)', '비고'];
  aoa.push(header);
  const dow = ['일', '월', '화', '수', '목', '금', '토'];

  for (const r of results) {
    for (const day of r.outRows) {
      const dObj = new Date(day.dayISO.replace(/-/g, '/'));
      const dayLabel = day.dayISO + (day.isBaseDay ? ' ★' : '');
      if (day.tides.length === 0) {
        aoa.push([r.name, r.dateStr, r.timeStr, r.lat, r.lon, dayLabel, dow[dObj.getDay()], '', '', '', '', day.note]);
      } else {
        day.tides.forEach((t, idx) => {
          aoa.push([
            idx === 0 ? r.name : '',
            idx === 0 ? r.dateStr : '',
            idx === 0 ? r.timeStr : '',
            idx === 0 ? r.lat : '',
            idx === 0 ? r.lon : '',
            idx === 0 ? dayLabel : '',
            idx === 0 ? dow[dObj.getDay()] : '',
            t.type === 'high' ? '고조' : '저조',
            t.mid,
            Math.round(t.height),
            t.diff == null ? '' : (t.diff > 0 ? '+' + t.diff : String(t.diff)),
            idx === 0 ? day.note : ''
          ]);
        });
      }
    }
    aoa.push([]); // 선박 구분 빈 줄
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 }, { wch: 11 }, { wch: 8 }, { wch: 10 }, { wch: 10 },
    { wch: 14 }, { wch: 5 }, { wch: 6 }, { wch: 7 }, { wch: 9 }, { wch: 10 }, { wch: 30 }
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '조석5일치');
  const outPath = require('path').join(__dirname, '..', '선박별_조석_5일치.xlsx');
  XLSX.writeFile(wb, outPath);
  process.stderr.write(`\n\n✅ 저장: ${outPath}\n`);

  // 요약 출력
  console.log('\n=== 요약 ===');
  for (const r of results) {
    const days = r.outRows.map(d => `${d.dayISO}:${d.tides.length ? d.tides.length + 'peaks' : (d.note || '0')}`).join(' | ');
    console.log(`${r.name} (${r.dateStr}) [${r.lat},${r.lon}]`);
    console.log('   ' + days);
  }
})().catch(e => { console.error('ERR', e); process.exit(1); });
