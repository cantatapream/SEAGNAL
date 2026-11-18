'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/bulletin_docs.js
 * 역할  : 통보문 원문 PDF 를 우리 서버에 받아 두고 쪽마다 그림(PNG)으로 바꿔 둔다 —
 *         📋 해역별 통보문 팝업이 누르는 즉시 우리 서버의 그림으로 통보문을 보인다(구글 문서 뷰어를 거치지 않는다).
 *         특보가 끝나 그 통보문이 어느 해역의 발자취에도 없으면 지운다.
 * 사용자 2026-11-18:
 *   「차라리 통보문 원문 pdf 파일 자체를 우리서버에 보관, 요청시 우리서버에서 내려주고 -> 특보가 사라지면 삭제(생애주기 끝나면)하는방식은 어떠니?」
 *   (내 답: 휴대폰 앱은 PDF 를 스스로 못 그리니 보관하면서 그림으로도 바꿔 두자) → 「좋아 그렇게 하자.」
 *   「통보문이 한장 이상인 경우도 문제없이 표출되어야해. 2장인경우 해당창에서 아래로 스크롤해서 내려본다던가 할 수 있어야함」
 * 왜: 종전에는 누르는 순간 휴대폰이 구글 문서 뷰어에 PDF 를 보여 달라고 했다(구글이 기상청 파일 서버에서 가져와 그림으로 바꿔 준다).
 *     PC 에서는 처음 여는 통보문이 비고 「gview — 다운로드 할 수 없음」이, 휴대폰에서는 흰 화면·긴 기다림이 났다(우리 쪽에서는 재현 못 함 — 원인 미확정).
 *     어느 쪽이든 우리가 고칠 수 없는 구간이라 통째로 걷어 낸다.
 * 동작(통보문 기준 계산이 끝난 뒤 매분 sync):
 *   ① 지금 발자취(bulletin_status trails)에 든 통보문 = 있어야 할 것. 통보문 자료의 그림 이름(「KTKO50_<발표시각>_<관서>_<호>」)이 열쇠다.
 *   ② 없는 것은 기상청 공개 폴더에서 PDF 를 받아 둔다(PDF 로 답했을 때만 — 그 서버는 없는 파일에도 200 text/html 로 답한다. 못 받으면 다음 분에 다시).
 *   ③ pdftoppm 으로 쪽마다 PNG 를 만든다(여러 장이면 1.png, 2.png …). 변환기가 없으면 PDF 만 둔다 — 팝업은 종전 길(바깥 PDF·본문 글)로 보인다.
 *   ④ 있어야 할 것에 없는 열쇠의 파일은 지운다(생애주기 끝).
 * MMIS 코드와 엮지 않는다(사용자 「mmis와 엮이면 안될 것」) — 공개 파일을 한 번 받을 뿐 로그인·API 는 쓰지 않는다.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/bulletin_status(read — trails) · services/bulletin_watch(bulletins — 그림 이름) · 바깥 프로그램 pdftoppm(Dockerfile 의 poppler-utils)
 *  - 저장          : data/bulletin_docs/<열쇠>.pdf · <열쇠>-<쪽>.png
 *  - 나를 쓰는 곳  : scheduler.js(통보문 기준 계산 다음 매분 sync) · routes/weather.js(GET /api/zone-bulletins 가 그림 주소를 붙임 · GET /api/bulletin-doc/… 가 파일을 내려줌) ·
 *                   검사 scripts/test_bulletin_docs.js
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const DIR = path.join(__dirname, '..', 'data', 'bulletin_docs');
const PDF_BASE = 'https://marine.kma.go.kr/resources/kmas/C5N_DATA/WRN/PDF/';
const KEY_RE = /^KTKO5\d_\d{12}_\d+_\d+$/;
const DPI = 130;   // 휴대폰 화면 폭(약 1,080점)에 A4 한 쪽이 꽉 차는 크기(1,075×1,520쯤). 실측 2026-11-18: 한 쪽 0.3초·30만 바이트 안팎
const KST = (s) => Date.parse(String(s).slice(0, 19).replace(' ', 'T') + '+09:00');

/**
 * 통보문 자료의 그림 이름에서 열쇠와 PDF 주소를 만든다.
 * 예: { rptImageName2: '202611/18/KTKO50_202611181600_184_51.png' } → { key:'KTKO50_202611181600_184_51', url:'https://marine.kma.go.kr/…/202611/18/KTKO50_202611181600_184_51.pdf' }
 * @param {object} r 통보문 본문(result) @returns {{key:string, url:string}|null} 그림 이름이 없거나 꼴이 다르면 null
 * [연계] ← needed(이 파일) · routes/weather.js
 */
function docOf(r) {
    const m = String((r && (r.rptImageName2 || r.pwnImageName)) || '').match(/^(\d{6}\/\d{2}\/)(KTKO5\d_\d{12}_\d+_\d+)\.png$/);
    return m ? { key: m[2], url: PDF_BASE + m[1] + m[2] + '.pdf' } : null;
}

/**
 * 지금 있어야 할 통보문 원문 — 어느 해역의 발자취에든 든 통보문.
 * @param {object} trails bulletin_status 의 trails({단위: {list:[{rpt, office, ho, inMs}]}}) @param {Array} bulletins bulletin_watch.bulletins()
 * @returns {Map<string, string>} 열쇠 → PDF 주소
 * [연계] ← sync(이 파일)
 */
function needed(trails, bulletins) {
    const out = new Map();
    for (const t of Object.values(trails || {})) for (const e of (t && t.list) || []) {
        const b = bulletins.find((x) => x.rpt === e.rpt && x.office === e.office && x.result.t1Title === e.ho && KST(x.result.tmIn) === e.inMs);
        const d = b && docOf(b.result);
        if (d) out.set(d.key, d.url);
    }
    return out;
}

/** 기상청 공개 폴더에서 PDF 를 받는다. PDF 로 답하지 않으면(없는 파일 = 200 text/html) null. @returns {Promise<Buffer|null>} */
async function realFetch(url) {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok || !/pdf/i.test(r.headers.get('content-type') || '')) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.subarray(0, 5).toString('latin1') === '%PDF-' ? buf : null;
}
/** PDF → 쪽 그림(<prefix>-1.png, <prefix>-2.png …). 변환기가 없거나 실패하면 던진다. @returns {Promise<void>} */
function realConvert(pdfFile, prefix) {
    return new Promise((resolve, reject) => execFile('pdftoppm', ['-png', '-r', String(DPI), pdfFile, prefix], { timeout: 60000 }, (e) => (e ? reject(e) : resolve())));
}

/**
 * 원문 보관소를 만든다. 검사에서는 받기(fetchPdf)·바꾸기(convert)·저장 위치(dir)를 바꿔 끼운다.
 * @param {{dir?:string, fetchPdf?:function, convert?:function}} [o]
 * @returns {{sync:function, pages:function, file:function}}
 * [연계] ← 모듈 기본(운영) / 검사 test_bulletin_docs
 */
function createDocs({ dir = DIR, fetchPdf = realFetch, convert = realConvert } = {}) {
    let running = false;
    const ls = () => { try { return fs.readdirSync(dir); } catch (_) { return []; } };
    /** 그 열쇠의 쪽 그림 번호들(1부터, 빠짐없이 이어진 만큼). 예: ['K-1.png','K-2.png'] → [1,2] */
    const pagesIn = (files, key) => {
        // pdftoppm 은 쪽 수가 10 이상이면 번호를 0 으로 채운다(-01) — 숫자로 읽어 번호순으로
        const ns = files.map((f) => { const m = f.match(/^(.+)-(\d+)\.png$/); return m && m[1] === key ? +m[2] : 0; }).filter(Boolean).sort((a, b) => a - b);
        // 1쪽부터 빠짐없이 이어진 만큼만 — 변환이 끝나 이름을 바꾸는 도중(큰 번호부터 바꾼다)에는 1쪽이 아직 없어 「없음」으로 읽힌다
        let n = 0; while (ns[n] === n + 1) n++;
        return ns.slice(0, n);
    };

    /**
     * 한 번 맞춘다: 없는 원문을 받아 그림으로 바꾸고, 생애주기가 끝난 원문을 지운다. 절대 던지지 않는다(수집을 막지 않게).
     * 예: 발자취에 제11-51호·제11-13호 → 두 PDF 를 받아 KTKO50_…_51-1.png 등을 만든다 / 그 해역 특보가 끝나 발자취에서 빠지면 파일을 지운다.
     * @param {{trails:object, bulletins:Array}} a
     * @returns {Promise<{need:number, fetched:number, converted:number, waiting:number, removed:number, skipped?:boolean}>} waiting = PDF 가 아직 안 올라온 것
     * [연계] ← scheduler.js(매분) / → fetchPdf · convert
     */
    async function sync({ trails, bulletins }) {
        const stat = { need: 0, fetched: 0, converted: 0, waiting: 0, removed: 0 };
        if (running) return Object.assign(stat, { skipped: true });
        running = true;
        try {
            const need = needed(trails, bulletins || []);
            stat.need = need.size;
            fs.mkdirSync(dir, { recursive: true });
            let files = ls();
            for (const [key, url] of need) {
                const pdf = path.join(dir, key + '.pdf');
                try {
                    if (!files.includes(key + '.pdf')) {
                        const buf = await fetchPdf(url);
                        if (!buf) { stat.waiting++; continue; }   // 아직 안 올라왔다 — 다음 분에 다시
                        fs.writeFileSync(pdf + '.tmp', buf); fs.renameSync(pdf + '.tmp', pdf);
                        stat.fetched++;
                    }
                    if (!pagesIn(files, key).length) {
                        // 임시 이름(<열쇠>.part-N.png)으로 만든 뒤 제 이름으로 바꾼다 — 만드는 도중의 반쪽 그림이 나가지 않게.
                        //   없으면: 변환 도중 팝업이 열리면 잘린 그림이 7일 캐시되고, 변환이 중간에 죽으면 1쪽만 남은 채 굳는다(별도 에이전트 검토 2026-11-18).
                        const part = (f) => f.match(/^(.+)\.part-(\d+)\.png$/);
                        for (const f of ls()) { const m = part(f); if (m && m[1] === key) fs.unlinkSync(path.join(dir, f)); }
                        try { await convert(pdf, path.join(dir, key + '.part')); } catch (e) {
                            // 변환기가 없는 것(ENOENT)이 아니면 PDF 가 깨진 것으로 보고 지운다 — 다음 분에 다시 받는다.
                            //   없으면: 올라오는 도중의 PDF 를 한 번 받으면 그 통보문은 특보가 끝날 때까지 변환 실패만 되풀이한다.
                            if (!(e && e.code === 'ENOENT')) fs.unlinkSync(pdf);
                            throw e;
                        }
                        const made = ls().map(part).filter((m) => m && m[1] === key).sort((a, b) => b[2] - a[2]);   // 큰 번호부터 — 1쪽이 맨 나중
                        for (const m of made) fs.renameSync(path.join(dir, m[0]), path.join(dir, key + '-' + m[2] + '.png'));
                        if (made.length) stat.converted++;
                    }
                } catch (e) {
                    console.warn('[bulletin_docs] 원문 받기·그림 바꾸기 실패(다음 분에 다시) — ' + key + ':', String((e && e.message) || e).split('\n')[0]);
                }
            }
            // 생애주기가 끝난 원문을 지운다 — 발자취에 없는 열쇠의 파일(끝나지 못한 임시 파일 포함)
            //   통보문 자료가 하나도 없으면 지우지 않는다 — 특보가 다 끝난 것이 아니라 자료를 못 읽은 것이다(관찰기는 통보문을 10일 기억한다).
            //   없으면: 관찰기 상태 파일을 한 번 못 읽으면 보관소를 통째로 비우고 다음 분에 전부 다시 받는다.
            files = (bulletins || []).length ? ls() : [];
            for (const f of files) {
                const m = f.match(/^(KTKO5\d_\d{12}_\d+_\d+)(?:\.pdf|\.pdf\.tmp|(?:\.part)?-\d+\.png)$/);
                if (m && !need.has(m[1])) { try { fs.unlinkSync(path.join(dir, f)); stat.removed++; } catch (_) { /* 이미 없으면 지울 것도 없다 */ } }
            }
        } catch (e) {
            console.warn('[bulletin_docs] 맞추기 실패:', e && e.message);
        } finally { running = false; }
        return stat;
    }

    /** 그 통보문의 쪽 그림 번호들(없으면 빈 배열). 예: pages('KTKO50_202611181600_184_51') → [1] */
    function pages(key) { return KEY_RE.test(String(key)) ? pagesIn(ls(), key) : []; }
    /**
     * 내려줄 파일의 경로(없거나 열쇠·쪽 번호 꼴이 아니면 null — 바깥에서 온 글자를 경로에 그대로 붙이지 않는다).
     * 예: file('KTKO50_…_51', 'pdf') → '…/KTKO50_…_51.pdf' · file('KTKO50_…_51', 2) → '…/KTKO50_…_51-2.png'(쪽 수가 10 이상이면 '-02.png')
     */
    function file(key, what) {
        if (!KEY_RE.test(String(key))) return null;
        const files = ls();
        if (what === 'pdf') return files.includes(key + '.pdf') ? path.join(dir, key + '.pdf') : null;
        const n = +what; if (!Number.isInteger(n) || n < 1) return null;
        const f = files.find((x) => { const m = x.match(/^(.+)-(\d+)\.png$/); return m && m[1] === key && +m[2] === n; });
        return f ? path.join(dir, f) : null;
    }
    return { sync, pages, file };
}

let real = null;
const getReal = () => (real = real || createDocs());

module.exports = {
    sync: (a) => getReal().sync(a),
    pages: (k) => getReal().pages(k),
    file: (k, w) => getReal().file(k, w),
    createDocs, docOf, needed, KEY_RE, DPI,
};
