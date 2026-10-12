/**
 * 역할: 4단계 해양교통 혼잡 예보 오늘·내일 48시간을 하루 한 번 모은다.
 * [연계] server.js → 본 모듈 → data/risk_forecast/sea_traffic.json.gz, risk_sea_cells.
 * [로드 순서] 서버 require는 부작용 없음. FLY_ALLOC_ID가 있는 서버만 자동 외부 호출.
 */
'use strict';
const path = require('path');
const io = require('./risk_collector_io');
const URL = 'https://apis.data.go.kr/B554035/sea-tfc-congst-fcst/get_sea_tfc_congst_fcst';
/** 응답 칸을 검증한다. 예: 혼잡 0.05는 표출에서 빠지며 풍속/파고는 저장 안 함. @param {object} r @returns {object} [연계] ← collect */
function normalize(r) {
    const lat = Number(r.latitude), lon = Number(r.longitude), ci = Number(r.congestionIndex);
    if ([r.latitude,r.longitude,r.congestionIndex].some(v=>v===null||v===''||v===undefined) || !/^\d{8}$/.test(String(r.fcstDate)) || !/^(?:[01]\d|2[0-3])00$/.test(String(r.fcstTime)) || !r.gridId || !Number.isFinite(lat) || lat < 20 || lat > 45 || !Number.isFinite(lon) || lon < 115 || lon > 140 || !Number.isFinite(ci) || ci < 0 || ci > 100) throw new Error('invalid response');
    return { gridId: String(r.gridId), latitude: lat, longitude: lon, fcstDate: String(r.fcstDate), fcstTime: String(r.fcstTime), fcstCreateDateTime: r.fcstCreateDateTime || null, congestionIndex: ci, congestionLevel: r.congestionLevel };
}
/** 독립 수집 인스턴스를 만든다. 예: tests는 임시 폴더와 가짜 HTTP를 주입. @param {object} options @returns {object} [연계] ← server.js/검사 */
function createCollector({ dir = io.DEFAULT_DIR, fetchImpl, key, clock = Date.now, updateCells } = {}) {
    let running = false, timer = null;
    const file = path.join(dir, 'sea_traffic.json.gz'), pendingFile = path.join(dir, 'sea_traffic_pending.json.gz');
    /** 누락 시각만 재수집한다. 예: 부분 실패는 정상 파일 유지, 다음 시도에는 실패 한 건만. @returns {Promise<object>} [연계] ← tick/start */
    async function collect() {
        if (running) return { ok: false, error: 'collector busy' };
        const release = io.acquireLock(path.join(dir, "congestion_collect.lock"));
        if (!release) return { ok: false, error: "collector busy" };
        running = true;
        const now = clock(), date = io.day(now);
        try {
            let pending = io.read(pendingFile);
            if (!pending || pending.date !== date) pending = require('./marine_congestion_codec').decode(require('./marine_congestion_codec').pack({ date, frames: {} }));
            const times = [];
            for (let d = 0; d < 2; d++) {
                const dt = new Date(Date.parse(date + 'T00:00:00+09:00') + d * 86400000);
                const target = io.day(dt.getTime()).replace(/-/g, '');
                for (let h = 0; h < 24; h++) times.push([target, String(h).padStart(2, '0') + '00']);
            }
            let failed = 0;
            for (const [fcstDate, fcstTime] of times) {
                const frameKey = fcstDate + fcstTime;
                if (pending.frames[frameKey]) continue;
                try {
                    const rows = [];
                    let pageNo = 1, total;
                    do {
                        const data = await io.request({ dir, name: 'congestion', limit: 90, url: URL, fetchImpl, key, now: clock(),
                            params: { fcstDate, fcstTime, gridLevel: 4, type: 'json', pageNo, numOfRows: 7000 } });
                        const batch = io.items(data);
                        if (total != null && total !== batch.total) throw new Error('partial response');
                        total = batch.total;
                        for (const item of batch.rows) {
                            const row = normalize(item);
                            if (row.fcstDate.replace(/-/g, '') !== fcstDate || row.fcstTime.padStart(4, '0') !== fcstTime) throw new Error('invalid response');
                            rows.push(row);
                        }
                        pageNo++;
                    } while (rows.length < total);
                    if (rows.length !== total || new Set(rows.map(r => r.gridId)).size !== rows.length) throw new Error('partial response');
                    pending.frames[frameKey] = rows.filter(r => r.congestionIndex >= 0.1);
                    io.write(pendingFile, pending);
                } catch (e) {
                    failed++;
                    io.reportError('congestion frame', e);
                    io.status(dir, 'congestion', now, e, { date, framesReady: Object.keys(pending.frames).length });
                    // 같은 잘못된 요청·인증을 48시각 반복해 일일 한도를 쓰지 않는다.
                    // 외부 HTTP500 등 일시 장애는 아래 기존 부분 수집·재시도 정책을 유지한다.
                    if (['HTTP 400', 'HTTP 401', 'HTTP 403'].includes(e.message)) throw e;
                    if (e.message === 'quota exhausted' || e.message === 'missing key') break;
                }
            }
            if (failed || Object.keys(pending.frames).length !== 48) throw new Error('partial response');
            const byId=new Map();for(const key of Object.keys(pending.frames))for(const r of pending.frames[key])byId.set(r.gridId,r);const cells=[...byId.values()];
            await (updateCells || require('./risk_sea_cells').update)(cells, { dir });
            pending.collectedAt=io.iso(now);const next=pending;
            io.write(file, next);
            io.status(dir, 'congestion', now, null, { date, framesReady: 48 });
            return { ok: true, frames: 48 };
        } catch (e) {
            io.status(dir, 'congestion', now, e);
            return { ok: false, error: io.errorName(e) };
        } finally { running = false; release(); }
    }
    /** 정해진 생산 이후·재시도 시각에만 받는다. 예: 05:10 실패→06:10·07:10, 하루 성공은 건너뜀. @returns {Promise<object|null>} [연계] ← start */
    async function tick() {
        const now = clock(), local = new Date(now + 9 * 3600000), h = local.getUTCHours(), m = local.getUTCMinutes();
        const current = io.read(file);
        if (current && current.date === io.day(now)) return null;
        if (![5, 6, 7].includes(h) || m !== 10) return null;
        return collect();
    }
    /** 운영에서만 자동 실행한다. 예: 개발기동에는 키가 있어도 호출 0. @returns {boolean} [연계] ← server.js */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        // 새 배포가 정각을 놓쳤으면 생산 이후 한 번, 이후 재시도 시각은 tick이 제어.
        const now = clock(), local = new Date(now + 9 * 3600000), current = io.read(file);
        if (local.getUTCHours()*60+local.getUTCMinutes() >= 310 && (!current || current.date !== io.day(now))) collect().catch(e => io.reportError('congestion startup', e));
        timer = setInterval(() => { tick().catch(e => { io.reportError('congestion tick', e); try { io.status(dir, 'congestion', clock(), e); } catch (writeError) { io.reportError('congestion status write', writeError); } }); }, 60000);
        timer.unref();
        return true;
    }
    return { collect, tick, start, stop() { if (timer) clearInterval(timer); timer = null; } };
}
const defaultCollector = createCollector();
module.exports = { ...defaultCollector, createCollector, normalize };
