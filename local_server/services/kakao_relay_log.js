/**
 * ============================================================================
 * 파일명: local_server/services/kakao_relay_log.js
 * 역할  : 카톡 특보중계 「10일 시험」의 날짜별 기록장. 받은 글·중복·신호·기기 설정·카톡판 특보현황과
 *         MMIS 특보현황의 비교 결과를 하루 한 파일(data/kakao_relay_log/YYYY-MM-DD.jsonl, KST 날짜)에
 *         한 줄씩 덧붙인다. 30일이 지난 파일은 지운다.
 *         (사용자 확정 2026-11-03 「수집되는 정보들이 모두 기록되어 있어야 해」 — 원래 기록은 최근 300건만 남았다)
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : 없음(fs·path 만)
 *  - 서버 API      : 없음(routes/kakao_relay GET /api/admin/kakao-relay/compare 가 kakao_shadow.summarize 로 읽는다)
 *  - 나를 쓰는 곳  : services/kakao_relay(받은 글·신호·기기) · services/kakao_shadow(비교) · 검사 test_kakao_shadow
 * [로드 순서] 해당 없음(서버 모듈)
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');

const KEEP_DAYS = 30;
const KST = 9 * 3600e3;

/** ISO → KST 'MM/DD HH:MM'. 못 읽으면 원래 글자. */
function hmK(iso) {
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return String(iso || '?');
    const k = new Date(t + KST).toISOString();
    return k.slice(5, 10).replace('-', '/') + ' ' + k.slice(11, 16);
}
const DIFF_WORD = { cur: '발효 중인 특보 등급', up: '다가오는 특보(예비특보·발효 전 발표) 유무', clr: '해제 시각' };
const SOURCE_WORD = { notification: '알림 글(200자에서 잘릴 수 있음)', screen: '대화방 전문' };

/**
 * 기록 한 줄을 사람이 읽는 한글 문장으로 바꾼다(사용자 확정 2026-11-03 「로그를 남길 때 내가 이해하기 쉬운 설명으로」).
 * 기록장에 쓸 때 「설명」 칸으로 함께 남기고, 마크다운 보고서에도 그대로 쓴다.
 * 예: explain({kind:'beat', device:'tablet', battery:73, note:'ok'}) → 'tablet 기기가 살아 있다는 신호를 보냄 — 배터리 73%, 앱 상태 「ok」.'
 * @param {object} ev @returns {string}
 * [연계] ← append(이 파일) · kakao_shadow.reportMarkdown
 */
function explain(ev) {
    const dev = ev.device || '(기기 이름 없음)';
    const lag = (m) => typeof m !== 'number' ? '' : m > 0 ? `카톡이 앱(MMIS)보다 ${m}분 빨랐음` : m === 0 ? '카톡과 앱(MMIS)이 같은 분에 바뀜' : `앱(MMIS)이 카톡보다 ${-m}분 먼저 바뀌어 있었음`;
    switch (ev.kind) {
        case 'msg': {
            const ls = ev.lines || [];
            const n = (tag) => ls.filter((l) => l.tag === tag).length;
            const parts = [['new', '새 특보'], ['missed', '놓친 글(알림 없이 대화방에서 발견)'], ['seen', '이미 받은 줄'], ['cutTail', '잘린 끝 줄(믿지 않음)'], ['unknownZone', '모르는 구역'], ['typhoon', '태풍(MMIS 기준)'], ['unknownAction', '동작어를 못 읽음']]
                .filter(([t]) => n(t)).map(([t, w]) => `${w} ${n(t)}`);
            return `${dev} 기기가 카톡 ${SOURCE_WORD[ev.source] || ev.source}을 보냄 — ${ev.trigger === false ? '방금 온 알림과 함께 읽힌 직전 글' : '방금 온 알림'}. `
                + (ls.length ? `특보 줄 ${ls.length}개: ${parts.join(' · ')}.` : '특보 줄을 하나도 나누지 못함(알림톡 꼴이 바뀌었거나 특보 글이 아님).');
        }
        case 'dup': return `${dev} 기기가 이미 받은 글을 다시 보냄(${SOURCE_WORD[ev.source] || ev.source}) — 같은 글이라 버림. 두 기기가 같은 알림을 받았거나 대화방을 다시 읽은 것.`;
        case 'ignored': return `${dev} 기기는 관리자가 ${ev.state === 'removed' ? '지운' : '끈'} 기기라 보낸 글 ${ev.count}건을 받지 않음.`;
        case 'beat': return `${dev} 기기가 살아 있다는 신호를 보냄 — 배터리 ${ev.battery == null || ev.battery < 0 ? '모름' : ev.battery + '%'}, 앱 상태 「${ev.note || ''}」.`;
        case 'device': return `관리자가 ${dev} 기기를 ${{ enable: '켬(다시 받음)', disable: '끔(받지 않음)', remove: '지움(받지 않음)' }[ev.action] || ev.action}.`;
        case 'anchor': return ev.status === 'found' ? `${dev} 기기가 대화방에서 「마지막으로 본 글」을 찾음 — 그 사이 글을 빠짐없이 읽었다는 뜻.`
            : ev.status === 'missing' ? `${dev} 기기가 대화방을 끝까지 올려도 「마지막으로 본 글」을 못 찾음 — 그 사이 특보 글을 놓쳤을 수 있음.`
            : `${dev} 기기 대화방 읽기 기준점 상태: ${ev.status}(아직 기준점이 없으면 처음 읽기).`;
        case 'baseline': return `비교 시험 시작. 시작 상태는 이 시각 앱 특보현황(MMIS)으로 채움 — 특보 걸린 구역 ${(ev.active || []).length}곳`
            + ((ev.active || []).length ? `(${ev.active.join(' / ')})` : '') + '. '
            + ((ev.kakaoRelease || []).length ? `시작 전에 카톡이 이미 알린 해제 시각도 넣음: ${ev.kakaoRelease.join(' / ')}. ` : '')
            + '이후 카톡판의 변화는 카톡 줄로만 일어남.';
        case 'mmis': return `앱 특보현황(MMIS)에서 ${ev.zone} 상태가 「${ev.to}」로 바뀜.`;
        case 'missedLine': return `${dev} 기기가 대화방에서 알림 없이 지나간 줄을 발견: ${ev.line}. 언제 온 글인지 몰라 카톡판에는 반영하지 않고 기록만 함.`;
        case 'apply': return `카톡 줄을 카톡판 특보현황에 반영: ${ev.line} (${dev} 기기, 받은 시각 ${hmK(ev.receivedAt)}).`;
        case 'line': {
            const head = `카톡 줄 판정 — ${ev.line} (받은 시각 ${hmK(ev.receivedAt)}): `;
            if (ev.result === '일치') return head + `앱(MMIS)과 같아짐. ${lag(ev.lagMin)}.`;
            if (ev.result === '불일치') return head + `받은 뒤 6시간 동안 앱(MMIS)과 같아지지 않음 → 확인 필요. 그때 카톡판 「${ev.kakao || ''}」 / 앱 「${ev.mmis || ''}」.`;
            if (ev.result === '다음 글로 대체') return head + `앱(MMIS)과 같아지기 전에 같은 구역에 다음 카톡 글이 와서 판정을 마침. 그때 앱 「${ev.mmis || ''}」.`;
            if (/^바뀐 것 없음/.test(ev.result)) return head + '이미 알고 있던 내용이라 카톡판이 바뀌지 않음(판정 대상 아님).';
            if (/^확인 불가/.test(ev.result)) return head + '카톡이 해제 시각을 알렸지만 앱(MMIS)에 정확한 해제 시각이 없어 맞는지 확인할 수 없었음.';
            if (/태풍/.test(ev.result)) return head + '태풍 특보가 걸린 구역이라 비교에서 뺌(카톡은 태풍 발효를 보내지 않음).';
            return head + ev.result;
        }
        case 'episode': return `${ev.zone}: ${hmK(ev.start)}~${hmK(ev.end)} (${ev.min}분) 카톡판과 앱(MMIS)이 달랐음. 다른 것: ${(ev.diffs || []).map((d) => DIFF_WORD[d] || d).join(', ')}. `
            + `${ev.first}. ${ev.worst === 'diff' ? '10분 넘게 달라 확인 필요' : '10분 안에 같아짐(정상적인 시간차)'}. 달랐을 때 카톡판 「${ev.kakao}」 / 앱 「${ev.mmis}」.`
            + (ev.endedAs === 'typhoon' ? ' 태풍 특보로 바뀌며 비교가 끝남.' : '');
        case 'tick': {
            if (ev.mmisError) return `앱 특보현황(MMIS) 파일을 읽지 못해 이번에는 비교하지 못함(${ev.mmisError}).`;
            const zs = (ev.diffZones || []).map((z) => `${z.zone}(카톡판 「${z.kakao}」 / 앱 「${z.mmis}」)`);
            return `5분 점검 — 같음 ${ev.match}구역 · 반영 대기 ${ev.wait} · 차이 ${ev.diff} · 태풍(비교 제외) ${ev.typhoon} · 특보 걸린 구역 ${ev.active}.`
                + (zs.length ? ` 10분 넘게 다른 구역: ${zs.join(', ')}.` : '')
                + (ev.mmisAgeMin != null && ev.mmisAgeMin > 15 ? ` ⚠앱 특보현황 파일이 ${ev.mmisAgeMin}분째 갱신되지 않음(MMIS 수집 멈춤 의심).` : '');
        }
        default: return '';
    }
}

/** ms → KST 날짜 'YYYY-MM-DD'. 예: dayOf(Date.parse('2026-11-02T15:30Z')) → '2026-11-03' */
function dayOf(ms) {
    return new Date(ms + KST).toISOString().slice(0, 10);
}

/**
 * 기록장을 만든다. 서버(받은 글)와 스케줄러(비교) 두 프로세스가 같은 파일에 덧붙이므로
 * 한 줄씩 append 만 한다(고쳐 쓰지 않는다).
 * 예: const lg = createLog('/tmp/x'); lg.append({kind:'beat', device:'tablet'}); lg.read('2026-11-03')
 * @param {string} dir
 * [연계] ← kakao_relay.createStore · kakao_shadow.runShadow
 */
function createLog(dir) {
    const fileOf = (day) => path.join(dir, day + '.jsonl');
    /** 한 줄 덧붙이기. 기록이 안 돼도 중계·비교는 멈추지 않는다(경고만). */
    function append(ev, nowMs = Date.now()) {
        try {
            fs.mkdirSync(dir, { recursive: true });
            const line = { t: new Date(nowMs).toISOString(), ...ev };
            // 데이터만 남기지 않고 사람이 읽는 설명을 함께 남긴다(사용자 확정 2026-11-03).
            if (!line.설명) { const say = explain(line); if (say) line.설명 = say; }
            fs.appendFileSync(fileOf(dayOf(nowMs)), JSON.stringify(line) + '\n');
        } catch (e) {
            console.warn('[kakao_relay_log] 기록 실패:', e.message);
        }
    }
    /** 그날 기록 전부. 깨진 줄은 건너뛴다. */
    function read(day) {
        let txt;
        try { txt = fs.readFileSync(fileOf(day), 'utf8'); }
        catch (e) { if (e.code === 'ENOENT') return []; throw e; }
        const out = [];
        for (const line of txt.split('\n')) {
            if (!line) continue;
            try { out.push(JSON.parse(line)); } catch (_) { /* 쓰는 중 잘린 마지막 줄 — 건너뜀 */ }
        }
        return out;
    }
    /** 기록이 있는 날짜들(오래된 순). */
    function days() {
        try { return fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).map((f) => f.slice(0, 10)).sort(); }
        catch (e) { return []; }
    }
    /** 30일 지난 파일 지우기. 지운 날짜 목록. */
    function prune(nowMs = Date.now()) {
        const cut = dayOf(nowMs - KEEP_DAYS * 864e5);
        const gone = [];
        for (const d of days()) {
            if (d >= cut) continue;
            try { fs.unlinkSync(fileOf(d)); gone.push(d); } catch (e) { console.warn('[kakao_relay_log] 지우기 실패:', d, e.message); }
        }
        return gone;
    }
    return { append, read, days, prune, dir };
}

module.exports = { createLog, dayOf, explain, hmK, KEEP_DAYS, DIFF_WORD };
