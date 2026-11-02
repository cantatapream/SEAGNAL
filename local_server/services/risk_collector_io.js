/**
 * 역할: 위험예측 수집기의 인증키·원자적 파일 저장·하루 호출 장부와 비밀을 제외한 수집 결과 이력을 관리한다.
 * [연계] sea_traffic_collector/tour_concentration_collector/coastal_events_collector → data/risk_forecast만 쓴다.
 * [로드 순서] 서버 require. 키는 기존 api_config.json 또는 환경에서 읽고 출력하지 않는다.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { randomUUID } = require('crypto');
const DATA = path.join(__dirname, '..', 'data');
const DEFAULT_DIR = path.join(DATA, 'risk_forecast');
/** KST 날짜를 만든다. 예: UTC 15시 → 다음날. @param {number} now @returns {string} [연계] ← 수집기 장부 */
function day(now = Date.now()) { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
/** KST ISO 시각을 만든다. 예: 2026-10-10T12:00:00+09:00. @param {number} now @returns {string} [연계] ← 수집기 상태 */
function iso(now = Date.now()) { return new Date(now + 9 * 3600000).toISOString().slice(0, 19) + '+09:00'; }
/** 기존 공용 ROMS 키를 읽는다. 예: 환경 우선, 설정 파일 차선. @returns {string} [연계] → ocean2.js와 같은 저장소 */
function publicKey() {
    if (process.env.ROMS_SERVICE_KEY) return process.env.ROMS_SERVICE_KEY;
    try { return JSON.parse(fs.readFileSync(path.join(DATA, 'api_config.json'), 'utf8')).ROMS_SERVICE_KEY || ''; }
    catch (_) { return ''; }
}
/** 파일을 읽는다. 예: gzip JSON → 객체. @param {string} file @returns {object|null} [연계] ← 수집기/위험 저장소 */
function read(file) { try { const b = fs.readFileSync(file),d=JSON.parse(file.endsWith('.gz') ? zlib.gunzipSync(b).toString() : b.toString());return /^sea_traffic(?:_pending)?\.json\.gz$/.test(path.basename(file))?require('./marine_congestion_codec').decode(d):d; } catch (_) { return null; } }
/** 자기 파일을 원자적으로 바꾼다. 예: 실패 전 정상 캐시는 남는다. @param {string} file @param {object} data @returns {void} [연계] ← 세 수집기 */
function write(file, data) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.' + process.pid + '.tmp';
    const stored=/^sea_traffic(?:_pending)?\.json\.gz$/.test(path.basename(file))?require('./marine_congestion_codec').pack(data):data;
    const b = Buffer.from(JSON.stringify(stored));
    try { fs.writeFileSync(tmp, file.endsWith('.gz') ? zlib.gzipSync(b) : b); fs.renameSync(tmp, file); }
    finally { try { fs.unlinkSync(tmp); } catch (_) { /* rename 후 없음 */ } }
}
/** 비밀이 섞일 수 있는 원천 오류는 고정 분류로 바꾼다. 예: fetch URL 대신 network error. @param {Error} e @returns {string} [연계] ← 상태파일 */
function errorName(e) { return /^(HTTP \d{3}|quota exhausted|empty response|invalid response|partial response|missing key|invalid event|unmatched event|collector busy)$/.test(e.message) ? e.message : 'network or parse error'; }
/** 비밀을 포함할 수 있는 원천 메시지는 출력하지 않고 작업 이름·안전한 오류 분류를 기록한다.
 * 예: HTTP400 또는 EACCES만 기록, URL·인증키는 기록하지 않음.
 * @param {string} name - 고정 작업 이름 @param {Error} error - 오류 @returns {void} [연계] ← 수집기/잠금 정리
 */
function reportError(name, error) {
    const safeCode=/^E[A-Z0-9]+$/.test(error.code||'')?error.code:errorName(error);
    console.error('[risk_forecast] '+name+': '+safeCode);
}
const heldTokens = new Set();
/** Linux 프로세스 시작 표식을 읽는다. 예: 재기동에 같은 PID가 배정되어도 구별.
 * @param {number} pid - 소유 PID @returns {string|null} 부팅ID·시작 tick [연계] ← acquireLock
 */
function processIdentity(pid) {
    try {
        const stat=fs.readFileSync('/proc/'+pid+'/stat','utf8');
        const start=stat.slice(stat.lastIndexOf(')')+2).split(' ')[19];
        return fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()+':'+start;
    } catch (_) { return null; }
}
/** 잠금 파일 소유자의 종료·재기동 여부를 확인한다. 예: 최근 빈 파일은 쓰기 중으로 간주.
 * @param {string} file - 잠금 경로 @returns {object|null} 회수 가능한 파일 정보 [연계] ← acquireLock
 */
function abandonedLock(file) {
    let stat;try{stat=fs.statSync(file);}catch(_){return null;}
    const owner=read(file);
    if(!Number.isInteger(owner?.pid)||owner.pid<1)return Date.now()-stat.mtimeMs>30000?{owner,ino:stat.ino}:null;
    if(owner.pid===process.pid&&!heldTokens.has(owner.token))return{owner,ino:stat.ino};
    try{process.kill(owner.pid,0);}catch(e){return e.code==='ESRCH'?{owner,ino:stat.ino}:null;}
    const identity=processIdentity(owner.pid);
    return owner.identity&&identity&&owner.identity!==identity?{owner,ino:stat.ino}:null;
}
/** 살아 있는 프로세스가 보유한 파일 잠금을 얻는다. 예: 죽은 PID 또는 같은 PID의 이전 기동만 회수.
 * @param {string} file - 잠금 경로 @param {number} depth - 회수 잠금 내부 깊이
 * @returns {function|null} 해제 함수 또는 경쟁 중 null
 * [연계] ← request와 세 수집기 / 공유 영속 볼륨의 중복 호출 방지
 */
function acquireLock(file, depth = 0) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const token = randomUUID();
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(file, 'wx', 0o600);
            try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, identity:processIdentity(process.pid), token })); } finally { fs.closeSync(fd); }
            heldTokens.add(token);
            return () => { heldTokens.delete(token);if (read(file)?.token === token) { try { fs.unlinkSync(file); } catch (e) { /* 이미 해제된 ENOENT는 정상 종료. 그 밖의 정리 실패는 기록한다. */ if(e.code!=='ENOENT')reportError('lock release',e); } } };
        } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            const old=abandonedLock(file);if(!old||depth>=4)return null;
            // 회수도 잠근 후 소유자와 inode를 다시 확인하여 새 소유자의 잠금을 지우지 않는다.
            const finishReap=acquireLock(file+'.reap',depth+1);if(!finishReap)return null;
            try {
                const current=abandonedLock(file);
                if(!current||current.ino!==old.ino||current.owner?.token!==old.owner?.token)return null;
                try{fs.unlinkSync(file);}catch(_){return null;}
            } finally { finishReap(); }
        }
    }
    return null;
}
/** 하루 장부 변경을 프로세스 사이에서 직렬화한다. 예: 동시 요청 두 건도 각각 먼저 예약.
 * @param {string} file - 잠금 경로 @param {function} fn - 동기 장부 변경 @returns {Promise<object>} 결과
 * [연계] ← request / HTTP 실패도 호출 한 건으로 남긴다.
 */
async function withLock(file, fn) {
    for (let attempt = 0; attempt < 100; attempt++) {
        const release = acquireLock(file);
        if (release) { try { return fn(); } finally { release(); } }
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error('collector busy');
}
/** 공공 API 호출 한 건을 요청 전에 영속 장부에 센다. 예: 재시작해도 오늘 90건 상한 유지. @param {object} args @returns {Promise<object>} [연계] ← 공공자료 수집기 */
async function request({ dir = DEFAULT_DIR, name, limit, url, params, fetchImpl = fetch, now = Date.now(), key = publicKey() }) {
    if (!key) throw new Error('missing key');
    const ledgerFile = path.join(dir, name + '_quota.json');
    await withLock(ledgerFile + '.lock', () => {
        let ledger = read(ledgerFile);
        if (!ledger || ledger.date !== day(now)) ledger = { date: day(now), calls: 0 };
        if (!Number.isInteger(ledger.calls) || ledger.calls < 0) throw new Error('invalid response');
        if (ledger.calls >= limit) throw new Error('quota exhausted');
        ledger.calls++;
        write(ledgerFile, ledger);
    });
    const u = new URL(url);
    let decoded = key;
    try { decoded = decodeURIComponent(key); } catch (_) { /* 이미 디코딩된 키 */ }
    for (const [k, v] of Object.entries({ serviceKey: decoded, ...params })) u.searchParams.set(k, v);
    // 타임아웃이 없으면 한 실패 호출이 모든 다음 수집을 영구 대기시킬 수 있다.
    const response = await fetchImpl(u.toString(), { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const header = data.response && data.response.header;
    // KOMSA의 실제 성공 응답은 200 / NORMAL_SERVICE다(사용자 제공 성공 호출 기록).
    const normalSea = header && String(header.resultCode) === '200' && header.resultMsg === 'NORMAL_SERVICE';
    if (header && !normalSea && !['00', '0000', '0', 'NORMAL_SERVICE'].includes(String(header.resultCode))) throw new Error('invalid response');
    return data;
}
/** body/items/item 공개 응답을 검증한다. 예: 기본0행거부, 명시적totalCount=0인공식목록만보충검색허용.
 * @param {object} data - 공개응답 @param {object} options - allowEmpty(기본false)
 * @returns {{rows:array,total:number}} [연계] ← coastal_events/sea_traffic/tour_concentration_collector / 빈실패로정상캐시덮기금지.
 */
function items(data, { allowEmpty = false } = {}) {
    const body = data.response && data.response.body;
    if (!body) throw new Error('invalid response');
    const value = body.items && body.items.item;
    const rows = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
    const total = Number(body.totalCount);
    if (body.totalCount === null || body.totalCount === '' || body.totalCount === undefined || !Number.isInteger(total) || total < rows.length) throw new Error('invalid response');
    if (!rows.length && !(allowEmpty && total === 0 && Object.hasOwn(body, 'items') &&
        (body.items === '' || body.items === null || (body.items &&
            (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)))))) throw new Error('empty response');
    return { rows, total };
}
/** 최종 시도 상태를 저장한다. 예: 오류여도 마지막 성공 자료를 유지. @param {object} args @returns {void} [연계] ← 세 수집기 → risk_store */
function status(dir, name, now, error, extra = {}) {
    const file = path.join(dir, name + '_status.json');
    const previous = read(file) || {};
    const next = { ...previous, ...extra, status: error ? 'error' : 'ok', lastRun: iso(now),
        ...(error ? { lastError: errorName(error) } : { lastSuccess: iso(now), lastError: null }) };
    write(file, next);
    // 이력 저장 실패가 실제 원천 수집 성공 여부를 바꾸지 않도록 분리한다.
    try { require('./risk_error_history').createHistory({ dir }).recordCollector(name, next); }
    catch (_) { console.warn('[risk_history] 수집 이력 연결 실패'); }
}
module.exports = { DEFAULT_DIR, day, iso, publicKey, read, write, errorName, request, items, status, acquireLock, withLock, reportError };
