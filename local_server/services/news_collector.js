'use strict';
/**
 * ============================================================================
 * 파일명: local_server/services/news_collector.js
 * 역할  : 「뉴스·공지·어황」 탭의 오늘의 뉴스 — 1시간마다 네이버 뉴스에서 해양 기사를 모아, 확실한 것만 거르고,
 *         AI 판정(services/news_judge)으로 해양종사자에게 영향이 있는 기사만 카드로 만들어 날짜별로 저장한다.
 *         같은 사건은 한 장으로 묶고, 대표 기사 페이지에서 미리보기 사진(og:image)·언론사 이름만 읽어 둔다. 30일이 지나면 지운다.
 * 사용자 확정(원문은 client/js/notice/news_hub.design.md §1·§1-2):
 *   「1시간 간격으로 업데이트」 · 날짜 하나 = 그날 0~24시 KST · 「최신순」 · 하루 상한 없음 · 「푸시는 보내지말자」 · 「그냥 대표사진으로 받아와」 ·
 *   묶음 카드 = 대표 기사 시각 + 「○○ 외 N건」 · 「각 카드마다 … 아코디언 열어본 횟수도 기록」 · 「뉴스는 1개월치」 · 관리자가 검색어 추가·삭제(「추천대로」)
 * 동작(run — 매시 2분 KST):
 *   ① 검색어마다 최신순 한 쪽(100건)을 받는다. 그 쪽이 모두 지난 확인 뒤 기사면 다음 쪽(최대 3쪽 — 기사가 많은 검색어는 100건이 하루가 안 된다, 실측 2026-11-20 「어선 사고」 100건 = 약 29시간).
 *   ② 주소·제목으로 겹친 기사를 지우고, 이미 판정한 기사(seen)를 뺀다. 마트 할인 기사처럼 확실한 것만 기계로 버린다
 *      (낱말로 넓게 거르지 않는다 — 견본에서 「수상」이 「수상레저」 법안 기사를 잘못 버렸다).
 *   ③ AI 판정(BATCH 개씩 — 앞 묶음에서 만든 카드도 다음 묶음에 「이미 실은 카드」로 준다. 실제 시험 2026-11-21: 묶음끼리 못 보면 해광호가 카드 3장으로 갈라졌다).
 *      3점 이상만 카드. 같은 사건은 묶는다. 이미 실은 카드와 같은 사건이면: 같은 날이면 그 카드에 더하고(새 사실이면 카드 머리를 최신 소식으로 바꾼다),
 *      다른 날이면 새 사실이 있을 때만 새 카드(사용자 「사고 보도의 경우 새소식 있을 때만」 — 질문이 「매일 다시 올릴까요」였다).
 *      판정이 끝까지 실패한 기사는 pending 에 두고 다음 시간에 다시 묻는다(26시간이 지나면 버린다).
 *   ④ 새 카드의 대표 기사 페이지에서 og:image·og:site_name 을 읽는다(사진 파일은 저장하지 않는다 — 주소만).
 *   ⑤ 30일이 지난 날짜 파일·조회 수를 지운다. 결과를 state.json 에 남긴다(관리자 화면이 「마지막 갱신·결과」를 띄운다 — 조용한 실패를 막는다).
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : services/naver_search(searchNews) · services/news_judge(judge) · services/atomic_write
 *  - 저장          : data/news/<YYYY-MM-DD>.json(그날 카드·뺀 기사) · state.json · views.json(펼친 횟수) · seen.json(판정한 기사 열쇠 3일) · pending.json · kwstate.json(검색어마다 마지막으로 받은 때) · data/news_config.json(검색어)
 *  - 나를 쓰는 곳  : server.js(운영에서만 start) · routes/news.js(앱 · 관리자) · 검사 scripts/test_news_collector.js
 *  관리자(2026-11-21 시안 8-3 · 사용자 「뺀기사는 원문 링크 볼수있는 버튼 [원문] 반영」): 실린 카드 숨기기·다시 보이기 · AI 가 뺀 기사 싣기 · 검색어 · 지금 갱신.
 *   숨긴 카드도 「이미 실은 카드」로 판정에 주어 같은 사건 후속 기사는 숨긴 카드에 합쳐진다(같이 숨겨짐 — 사용자 2026-11-21 「이대로 두기」).
 *   매시 수집이 도는 중에 바꾸면 그 수집이 끝난 뒤에 적용한다(afterRun — 도는 쪽이 날짜 파일을 다시 쓰며 관리자 변경을 덮지 않게).
 * [로드 순서] 없음(서버 모듈)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomic } = require('./atomic_write');

const DATA = path.join(__dirname, '..', 'data');
const KEEP_DAYS = 30;                       // 사용자 「뉴스는 1개월치」
const FIRST_WINDOW_MS = 26 * 3600000;       // 처음 돌 때·오래 멈췄다 다시 돌 때 거슬러 보는 길이(어제 아침부터)
const OVERLAP_MS = 15 * 60000;              // 지난 확인과 15분 겹쳐 본다 — 네이버 색인이 늦게 올라오는 기사를 놓치지 않게(겹친 것은 seen 이 거른다)
const SEEN_MS = 3 * 86400000, PENDING_MS = 26 * 3600000;
const MAX_PAGES = 3, REJECT_MAX = 400, MIN_SCORE = 3;
const DEFAULT_KEYWORDS = [
    // 조업 규칙
    '금어기', '금채기', '총허용어획량', '금지체장', '어구 규제', '조업구역', '수산자원보호구역',
    // 돈
    '어업 보조금', '수산 보조금', '어업인 지원금', '수산 지원사업', '면세유 어업', '어선 감척', '수산직불금', '어선보험', '양식 재해보험', '수산물 가격',
    // 처벌·의무
    '불법조업 단속', '해경 단속', '수산업법 개정', '어선법 개정', '선원법 개정', '수상레저안전법', '낚시관리법', '해양 과태료',
    // 안전
    '어선 전복', '어선 침몰', '어선 화재', '어선 충돌', '선원 실종', '해상 사고', '낚시어선 사고', '수상레저 사고', '연안사고 위험예보',
    // 바다 여건
    '적조', '고수온', '해파리', '양식 피해', '어획량',
    // 갈등·제도
    '해상풍력 어민', '공유수면 점용', '외국인 선원', '어민 집회', '해양수산부 입법예고',
];
// 확실한 것만 기계로 버린다(②). 넓은 낱말 거르기는 하지 않는다.
const DROP_RE = [
    /(이마트|롯데마트|홈플러스|코스트코|쿠팡|컬리|GS25|CU|세븐일레븐|이마트24)[^.]{0,30}(할인|특가|세일|반값)/,
    /(할인|특가|세일|반값)[^.]{0,20}(이마트|롯데마트|홈플러스|코스트코)/,
];

/** KST 날짜. 예: kstDate(Date.parse('2026-11-20T16:00Z')) → '2026-11-21' */
const kstDate = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 10);
/** 카드에 보일 시각. 예: '11.20 14:36' */
const kstShort = (ms) => { const d = new Date(ms + 9 * 3600000); return String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + String(d.getUTCDate()).padStart(2, '0') + ' ' + String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); };
/** 검색 결과의 <b> 강조·엔티티를 걷는다. 예: '<b>금어기</b> &quot;해제&quot;' → '금어기 "해제"' */
function clean(s) {
    return String(s || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ').trim();
}
/** 같은 기사인지 볼 열쇠 — 주소(쿼리 중 추적용 꼬리 뺌). */
function urlKey(u) {
    try { const x = new URL(u); for (const k of [...x.searchParams.keys()]) if (/^(utm_|ref$|from$|fbclid$)/i.test(k)) x.searchParams.delete(k); return (x.host.replace(/^www\./, '') + x.pathname + (x.search || '')).toLowerCase(); }
    catch (_) { return String(u || '').toLowerCase(); }
}
/** 제목 열쇠 — 띄어쓰기·문장부호를 뺀다(같은 기사를 여러 매체가 그대로 받아 쓴 경우). */
const titleKey = (t) => String(t || '').replace(/\[[^\]]*\]|【[^】]*】/g, '').replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 60);
const hostOf = (u) => { try { return new URL(u).host.replace(/^(www|m|news|mnews)\./, ''); } catch (_) { return ''; } };
const idOf = (s) => 'n' + crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 10);

/**
 * 기사 페이지에서 미리보기 사진·언론사 이름을 읽는다. 실패하면 빈 값(사진 없이 기본 그림이 나간다).
 * 로고로 보이는 사진(주소에 logo·favicon·default)은 버린다 — 견본에서 방송사 로고가 대표사진으로 온 일이 있었다(포항MBC).
 * 예: await realMeta('https://www.kbmaeil.com/article/…') → { image:'https://…/20261120500144.jpg', site:'경북매일' }
 */
async function realMeta(url) {
    try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Mobile' }, redirect: 'follow', signal: AbortSignal.timeout(8000) });
        if (!r.ok) return { image: '', site: '' };
        const html = (await r.text()).slice(0, 400000);
        const meta = (prop) => { const m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*>', 'i')); const c = m && m[0].match(/content=["']([^"']+)["']/i); return c ? clean(c[1]) : ''; };
        let image = meta('og:image');
        try { image = image ? new URL(image, url).href : ''; } catch (_) { image = ''; }
        if (/logo|favicon|default|noimage|no_image|blank/i.test(image)) image = '';
        return { image, site: meta('og:site_name').slice(0, 30) };
    } catch (_) { return { image: '', site: '' }; }
}

/**
 * 오늘의 뉴스 수집기를 만든다. 검사에서는 검색·판정·페이지 읽기·저장 위치·시계를 바꿔 끼운다.
 * @param {{dir?:string, configFile?:string, search?:function, judge?:function, meta?:function, now?:function}} [o]
 * @returns {object} run · day · dates · hit · state · keywords · setKeywords · imageKnown · start
 * [연계] ← 모듈 기본(운영) / 검사 test_news_collector
 */
function createNews({ dir = path.join(DATA, 'news'), configFile = path.join(DATA, 'news_config.json'), search = null, judge = null, meta = realMeta, now = Date.now } = {}) {
    const doSearch = search || ((q, opt) => require('./naver_search').searchNews(q, opt));
    const doJudge = judge || ((arts, cards) => require('./news_judge').judge(arts, cards));
    const f = (n) => path.join(dir, n);
    let running = null, timer = null;
    // 한 줄 세우기 — 매시 확인(run)·관리자 바꾸기(숨기기·삭제·다시 변환·싣기)를 한 번에 하나씩만 한다.
    //   없으면: 「다시 변환」처럼 오래 걸리는 일 도중에 들어온 숨기기·삭제가 바로 적용됐다가, 그 일이 처음에 읽어 둔 날짜 파일을 다시 쓰며 되돌려졌다
    //   (별도 에이전트 검토 2026-11-21 — 지운 글이 되살아나 앱 목록에 다시 보임을 실행으로 재현).
    let chain = Promise.resolve();
    const exclusive = (fn) => { const p = chain.then(fn, fn); chain = p.then(() => {}, () => {}); return p; };
    const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return d; } };
    const write = (p, v) => { fs.mkdirSync(path.dirname(p), { recursive: true }); writeFileAtomic(p, JSON.stringify(v)); };
    const dayFile = (d) => f(d + '.json');
    const readDay = (d) => { const v = readJson(dayFile(d), null); return v && Array.isArray(v.cards) ? Object.assign({ rejected: [] }, v) : { date: d, cards: [], rejected: [] }; };
    const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

    /** 수집 검색어(관리자가 바꾼 것 — 없으면 기본 목록). */
    function keywords() { const v = readJson(configFile, null); return v && Array.isArray(v.keywords) && v.keywords.length ? v.keywords.slice() : DEFAULT_KEYWORDS.slice(); }
    /**
     * 검색어를 저장한다(관리자 화면 — 다음 단계). 빈 글·60자 넘는 글·겹침은 뺀다. 1~200개.
     * @param {string[]} list @returns {{ok:boolean, keywords?:string[], error?:string}}
     */
    function setKeywords(list) {
        if (!Array.isArray(list)) return { ok: false, error: '검색어 목록이 아님' };
        const out = [...new Set(list.map((s) => String(s || '').replace(/\s+/g, ' ').trim()).filter((s) => s && s.length <= 60))];
        if (!out.length || out.length > 200) return { ok: false, error: '검색어는 1~200개' };
        write(configFile, { keywords: out, updatedAt: new Date(now()).toISOString() });
        return { ok: true, keywords: out };
    }

    /** ① 검색어 하나 — 지난 확인 뒤 기사만, 필요하면 다음 쪽까지. */
    async function fetchKeyword(q, sinceMs, stat) {
        const out = [];
        for (let page = 0; page < MAX_PAGES; page++) {
            const r = await doSearch(q, { start: 1 + page * 100, display: 100, sort: 'date' });
            if (!r || !r.ok) { stat.keywordErrors.push(q + ': ' + String((r && r.error) || '실패').slice(0, 80)); break; }
            let older = false;
            for (const it of r.items || []) {
                const ms = Date.parse(it.pubDate);
                if (!Number.isFinite(ms)) continue;
                if (ms < sinceMs) { older = true; continue; }
                out.push({ title: clean(it.title), desc: clean(it.description), link: it.link || '', originallink: it.originallink || it.link || '', pubMs: ms, kw: q });
            }
            if (older || (r.items || []).length < 100) break;
        }
        return out;
    }

    /**
     * 한 번 모은다. 절대 던지지 않는다. 겹쳐 부르면 도는 것을 함께 기다린다.
     * 예: await run() → { ok:true, fetched:812, unique:340, candidates:96, judged:96, kept:14, added:9, merged:5, … }
     * [연계] ← start(매시 2분) · 관리자 「지금 갱신」(다음 단계) / → fetchKeyword · judge · meta
     */
    function run() {
        if (running) return running;
        running = exclusive(async () => {
            const t0 = now();
            const st = { lastRun: new Date(t0).toISOString(), ok: false, error: null, keywords: 0, fetched: 0, unique: 0, dropped: 0, candidates: 0, judged: 0, failed: 0, kept: 0, added: 0, merged: 0, rejected: 0, providers: {}, keywordErrors: [], judgeErrors: [] };
            let logged = false;
            try {
                fs.mkdirSync(dir, { recursive: true });
                const kws = keywords(); st.keywords = kws.length;
                // ① 검색어마다 「그 검색어를 마지막으로 받은 때」부터 — 한 검색어만 실패해도 다음 회차에 그 검색어는 놓친 시간부터 다시 받는다
                //   (종전: 전체 창 하나라 일부 실패가 ok:true 로 지나가고 그 시간 기사를 영영 놓쳤다 — 별도 에이전트 검토 2026-11-21, 실행으로 재현)
                const kwLast = readJson(f('kwstate.json'), {}) || {};
                const raw = [];
                for (const q of kws) {
                    const last = kwLast[q];
                    const sinceMs = Number.isFinite(last) && t0 - last < FIRST_WINDOW_MS ? last - OVERLAP_MS : t0 - FIRST_WINDOW_MS;
                    const errs = st.keywordErrors.length;
                    raw.push(...await fetchKeyword(q, sinceMs, st));
                    if (st.keywordErrors.length === errs) kwLast[q] = t0;   // 이번에 받았다
                }
                for (const k of Object.keys(kwLast)) if (!kws.includes(k)) delete kwLast[k];   // 저장은 판정 결과·pending 을 쓴 뒤에(도중에 죽으면 다음 회차가 같은 창을 다시 받게)
                st.fetched = raw.length;
                // ② 겹침·이미 판정·확실한 것 거르기
                const seen = readJson(f('seen.json'), {}) || {};
                for (const k of Object.keys(seen)) if (t0 - seen[k] > SEEN_MS) delete seen[k];
                const pending = (readJson(f('pending.json'), []) || []).filter((a) => a && t0 - a.pubMs < PENDING_MS);
                const byKey = new Map(), titles = new Set();
                for (const a of pending.concat(raw)) {
                    const uk = urlKey(a.originallink), tk = titleKey(a.title);
                    if (!a.title || seen[uk] || (tk && seen['t:' + tk])) continue;
                    const k = uk || tk;
                    if (byKey.has(k) || (tk && titles.has(tk))) continue;
                    byKey.set(k, a); if (tk) titles.add(tk);
                }
                st.unique = byKey.size;
                const cands = [];
                for (const a of byKey.values()) {
                    if (DROP_RE.some((re) => re.test(a.title + ' ' + a.desc))) { st.dropped++; seen[urlKey(a.originallink)] = t0; continue; }
                    cands.push(a);
                }
                cands.sort((a, b) => a.pubMs - b.pubMs);
                st.candidates = cands.length;
                // ③ 판정 — 오늘·어제 카드를 함께 준다(같은 사건 묶기)
                const today = kstDate(t0), yday = kstDate(t0 - 86400000);
                const days = { [today]: readDay(today), [yday]: readDay(yday) };
                const getDay = (d) => (days[d] = days[d] || readDay(d));
                const known = () => [yday, today].flatMap((d) => days[d].cards.map((c) => ({ id: c.id, title: c.title, date: d })));
                const findCard = (id) => { for (const d of Object.keys(days)) { const c = days[d].cards.find((x) => x.id === id); if (c) return c; } return null; };
                const arts = cands.map((a) => ({ title: a.title, desc: a.desc, source: hostOf(a.originallink), time: kstShort(a.pubMs) }));
                const failedSet = new Set(), judgeErrors = [];
                const groups = new Map();   // 같은 묶음 → 그 묶음 카드
                const fresh = new Set();    // 이번에 새로 만들었거나 대표 기사가 바뀐 카드(사진 읽기)
                const BATCH = require('./news_judge').BATCH;
                for (let b = 0; b < arts.length; b += BATCH) {
                const J = await doJudge(arts.slice(b, b + BATCH), known());
                for (const [k, v] of Object.entries(J.providers || {})) st.providers[k] = (st.providers[k] || 0) + v;
                judgeErrors.push(...(J.errors || []));
                for (const i of J.failed || []) failedSet.add(b + i);
                for (const r0 of (J.results || []).slice().sort((x, y) => cands[b + x.i].pubMs - cands[b + y.i].pubMs)) {
                    const r = Object.assign({}, r0, { i: b + r0.i, group: r0.group ? 'b' + b + ':' + r0.group : '' });
                    const a = cands[r.i];
                    seen[urlKey(a.originallink)] = t0; if (titleKey(a.title)) seen['t:' + titleKey(a.title)] = t0;
                    const d = kstDate(a.pubMs), host = hostOf(a.originallink);
                    if (r.score < MIN_SCORE) {
                        const day = getDay(d);
                        if (day.rejected.length < REJECT_MAX) day.rejected.push({ title: a.title, desc: a.desc, link: a.originallink || a.link, source: host, pubMs: a.pubMs, score: r.score, reason: r.reason });
                        st.rejected++;
                        continue;
                    }
                    st.kept++;
                    // 같은 사건: 같은 묶음이면 그 묶음 카드 · 이미 실은 카드면 같은 날이거나 새 사실이 없을 때 그 카드에 더한다
                    const prevCard = r.same ? findCard(r.same) : null;
                    let card = (r.group && groups.get(r.group)) || (prevCard && (prevCard.date === d || !r.newInfo) ? prevCard : null);
                    if (card && card === prevCard && r.newInfo && card.date === d && a.pubMs > card.rep.pubMs) {
                        // 같은 날 새 소식 — 카드를 새로 만들지 않고 머리를 최신 소식으로(「외 N건」은 그대로 늘린다)
                        card.count = (card.count || 1) + 1;
                        if (host && !card.hosts.includes(host)) card.hosts.push(host);
                        Object.assign(card, { title: a.title, summary: r.summary, summaryFixed: r.summaryFixed, cat: r.cat, score: Math.max(card.score, r.score) });
                        card.rep = { title: a.title, desc: a.desc, link: a.link, originallink: a.originallink, host, pubMs: a.pubMs };
                        fresh.add(card); st.merged++; st.updated = (st.updated || 0) + 1;
                        if (r.group) groups.set(r.group, card);
                        continue;
                    }
                    if (card) {
                        card.count = (card.count || 1) + 1;
                        if (host && !card.hosts.includes(host)) card.hosts.push(host);
                        // 「요약이 가장 충실한 기사」를 대표로 — 원문 요약이 더 긴 기사가 오면 대표를 바꾼다(묶음 안에서만, 이미 실은 카드는 그대로)
                        if (r.group && groups.get(r.group) === card && fresh.has(card) && card.addedAt === new Date(t0).toISOString() && a.desc.length > (card.rep.desc || '').length) {
                            Object.assign(card, { title: a.title, summary: r.summary, summaryFixed: r.summaryFixed });
                            card.rep = { title: a.title, desc: a.desc, link: a.link, originallink: a.originallink, host, pubMs: a.pubMs };
                        }
                        if (r.group && !groups.has(r.group)) groups.set(r.group, card);
                        st.merged++;
                        continue;
                    }
                    card = { id: idOf(urlKey(a.originallink) || a.title), date: d, title: a.title, summary: r.summary, summaryFixed: r.summaryFixed, cat: r.cat, region: r.region, score: r.score,
                        rep: { title: a.title, desc: a.desc, link: a.link, originallink: a.originallink, host, pubMs: a.pubMs }, hosts: host ? [host] : [], count: 1,
                        site: '', image: '', hidden: false, addedAt: new Date(t0).toISOString(), provider: r.provider, followOf: r.same && r.newInfo ? r.same : '' };
                    const day = getDay(d);
                    if (day.cards.some((c) => c.id === card.id)) continue;
                    day.cards.push(card); fresh.add(card); st.added++;
                    if (r.group) groups.set(r.group, card);
                }
                }
                st.judgeErrors = judgeErrors.slice(0, 5);
                st.failed = failedSet.size; st.judged = cands.length - failedSet.size;
                const newPending = cands.filter((_, i) => failedSet.has(i));
                // ④ 새 카드의 사진·언론사 이름(사진 파일은 저장하지 않는다)
                for (const c of fresh) { const m = await meta(c.rep.originallink || c.rep.link); c.image = m.image || ''; c.site = m.site || ''; }   // 대표 기사가 바뀐 카드도 다시 읽는다(사진이 다른 기사 것이 되지 않게)
                for (const d of Object.keys(days)) if (DAY_RE.test(d) && (days[d].cards.length || days[d].rejected.length)) { days[d].date = d; days[d].updatedAt = new Date(t0).toISOString(); write(dayFile(d), days[d]); }
                write(f('seen.json'), seen);
                write(f('pending.json'), newPending);
                write(f('kwstate.json'), kwLast);
                // ⑤ 30일 정리
                const files = fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n));
                const cut = kstDate(t0 - (KEEP_DAYS - 1) * 86400000);   // 오늘 포함 30개 날짜(종전 31개 — 검토 지적)
                const gone = files.filter((n) => n.slice(0, 10) < cut);
                if (gone.length) {
                    const ids = new Set(gone.flatMap((n) => readDay(n.slice(0, 10)).cards.map((c) => n.slice(0, 10) + '/' + c.id)));
                    for (const n of gone) { try { fs.unlinkSync(f(n)); } catch (_) { /* 이미 없다 */ } }
                    const vw = readJson(f('views.json'), {}) || {};
                    for (const k of Object.keys(vw.count || {})) if (ids.has(k)) { delete vw.count[k]; if (vw.adminDay) delete vw.adminDay[k]; }
                    write(f('views.json'), vw);
                }
                // 검색어가 전부 실패했으면 실패(기사 0건과 구별) · 판정이 전부 실패해도 실패
                if (st.keywordErrors.length && st.keywordErrors.length >= kws.length) st.error = '검색어 ' + kws.length + '개 모두 받지 못함: ' + st.keywordErrors[0];
                else if (st.candidates && st.failed === st.candidates) st.error = 'AI 판정이 모두 실패: ' + (st.judgeErrors[0] || '');
                st.ok = !st.error;
                st.keywordErrors = st.keywordErrors.slice(0, 10);
            } catch (err) {
                st.error = '수집 중 오류: ' + String((err && err.message) || err).split('\n')[0];
                console.error('[오늘의 뉴스] 수집 실패:', st.error); logged = true;
            }
            st.ms = now() - t0;
            try { write(f('state.json'), st); } catch (e) { console.error('[오늘의 뉴스] 상태 파일을 못 씀:', e && e.message); }
            if (!st.ok && !logged) console.warn('[오늘의 뉴스] 수집 실패:', st.error);
            return st;
        }).finally(() => { running = null; });
        return running;
    }

    const readViews = () => { const v = readJson(f('views.json'), null) || {}; return { count: v.count || {}, adminDay: v.adminDay || {} }; };
    /**
     * 그날의 카드(숨긴 것 빼고, 최신순 — 사용자 「최신순으로 하는게 좋겠는데」) + 펼친 횟수.
     * 예: day('2026-11-20') → { date, cards:[{ id, title, summary, cat, catName, region, time, pubMs, source, more, image, views, link }] }
     */
    function day(d) {
        if (!DAY_RE.test(String(d))) return null;
        const CATS = require('./news_judge').CATS, vw = readViews().count;
        const cards = readDay(d).cards.filter((c) => !c.hidden).sort((a, b) => b.rep.pubMs - a.rep.pubMs).map((c) => ({
            id: c.id, title: c.title, summary: c.summary, cat: c.cat, catName: CATS[c.cat] || '', region: c.region, time: kstShort(c.rep.pubMs), pubMs: c.rep.pubMs,
            source: c.site || c.rep.host, more: Math.max(0, (c.count || 1) - 1), image: c.image || '', views: vw[d + '/' + c.id] || 0, link: c.rep.originallink || c.rep.link,
        }));
        return { date: d, cards };
    }
    /** 보관 중인 날짜(달력 — 사용자 「날짜는 보유하고있는 뉴스 기간까지만」). 오래된 것부터. */
    function dates() { try { return fs.readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).map((n) => n.slice(0, 10)).sort(); } catch (_) { return []; } }
    /**
     * 카드를 펼친 횟수를 1 올린다(관리자 기기는 같은 카드 하루 1번 — 공지 조회수와 같은 규칙). 없는 카드면 null.
     * @param {string} d @param {string} id @param {boolean} [isAdmin] @returns {number|null}
     */
    function hit(d, id, isAdmin) {
        if (!DAY_RE.test(String(d)) || !/^n[0-9a-f]{10}$/.test(String(id)) || !readDay(d).cards.some((c) => c.id === id)) return null;
        const vw = readViews(), k = d + '/' + id, today = kstDate(now());
        if (isAdmin && vw.adminDay[k] === today) return vw.count[k] || 0;
        vw.count[k] = (vw.count[k] || 0) + 1;
        if (isAdmin) vw.adminDay[k] = today;
        try { write(f('views.json'), vw); } catch (e) { console.warn('[오늘의 뉴스] 펼친 횟수를 못 씀:', e && e.message); }
        return vw.count[k];
    }
    /** 매시 수집이 도는 중이면 끝난 뒤에 한다. */
    const afterRun = exclusive;   // 관리자 바꾸기도 같은 줄에 선다(앞의 확인·다른 바꾸기가 끝난 뒤에)
    /**
     * 관리자 — 그날의 카드(숨긴 것 포함)와 AI 가 뺀 기사.
     * 예: adminDay('2026-11-21') → { date, cards:[{…day() 카드, hidden, score, provider, summaryFixed, manual}], rejected:[{ index, title, link, source, time, score, reason }] }
     */
    function adminDay(d) {
        if (!DAY_RE.test(String(d))) return null;
        const CATS = require('./news_judge').CATS, vw = readViews().count, raw = readDay(d);
        const cards = raw.cards.slice().sort((a, b) => b.rep.pubMs - a.rep.pubMs).map((c) => ({
            id: c.id, title: c.title, summary: c.summary, cat: c.cat, catName: CATS[c.cat] || '', region: c.region, time: kstShort(c.rep.pubMs), source: c.site || c.rep.host,
            more: Math.max(0, (c.count || 1) - 1), views: vw[d + '/' + c.id] || 0, link: c.rep.originallink || c.rep.link, hidden: !!c.hidden, score: c.score, provider: c.provider || '', summaryFixed: !!c.summaryFixed, manual: !!c.manual,
        }));
        const rejected = raw.rejected.map((r, i) => ({ index: i, title: r.title, link: r.link, source: r.source, time: kstShort(r.pubMs), score: r.score, reason: r.reason || '' })).reverse();
        return { date: d, cards, rejected };
    }
    /** 카드를 숨기거나 다시 보인다. @returns {Promise<boolean>} [연계] ← routes/news.js 관리자 */
    function setHidden(d, id, hidden) {
        return afterRun(() => {
            if (!DAY_RE.test(String(d))) return false;
            const day = readDay(d), c = day.cards.find((x) => x.id === String(id)); if (!c) return false;
            c.hidden = !!hidden; write(dayFile(d), day); return true;
        });
    }
    /**
     * AI 가 뺀 기사를 싣는다(관리자 「싣기」). 요약은 원문 요약(앞 2문장 — 지어낼 AI 없이), 분류는 관리자가 고른 것(없으면 꼬리표 없음).
     * @param {string} d @param {number} index rejected 의 자리 @param {string} [cat] money|duty|rule|safety|sea|conflict
     * @param {string} [link] 그 기사 원문 주소 — 있으면 자리 대신 이것으로 찾는다(앞서 하나를 실어 자리가 밀린 낡은 화면에서 엉뚱한 기사가 실리지 않게 — 검토 지적)
     * @returns {Promise<{ok:boolean, id?:string, error?:string}>}
     */
    function publish(d, index, cat, link) {
        return afterRun(async () => {
            if (!DAY_RE.test(String(d))) return { ok: false, error: '날짜 꼴' };
            const day = readDay(d);
            if (link) index = day.rejected.findIndex((x) => x.link === link);
            const r = day.rejected[index];
            if (!Number.isInteger(index) || !r) return { ok: false, error: '없는 기사(이미 실었거나 목록이 바뀜)' };
            const J = require('./news_judge');
            const id = idOf(urlKey(r.link) || r.title);
            if (day.cards.some((c) => c.id === id)) { day.rejected.splice(index, 1); write(dayFile(d), day); return { ok: true, id }; }
            const card = { id, date: d, title: r.title, summary: J.fixSummary('', '', r.desc || '', r.title).text, summaryFixed: true, cat: Object.prototype.hasOwnProperty.call(J.CATS, cat) ? cat : 'none', region: '', score: MIN_SCORE,
                rep: { title: r.title, desc: r.desc || '', link: r.link, originallink: r.link, host: r.source || hostOf(r.link), pubMs: r.pubMs }, hosts: r.source ? [r.source] : [], count: 1,
                site: '', image: '', hidden: false, addedAt: new Date(now()).toISOString(), provider: 'admin', manual: true, followOf: '' };
            const m = await meta(r.link); card.image = m.image || ''; card.site = m.site || '';
            const fresh = readDay(d);   // 사진을 읽는 사이 바뀌었을 수 있다 — 다시 읽고 적용
            const k = fresh.rejected.findIndex((x) => x.link === r.link && x.pubMs === r.pubMs);
            if (k >= 0) fresh.rejected.splice(k, 1);
            if (!fresh.cards.some((c) => c.id === id)) fresh.cards.push(card);
            write(dayFile(d), fresh);
            return { ok: true, id };
        });
    }
    /** 지금 갱신(관리자) — 기다리지 않고 시작만. */
    function runNow() { const was = !!running; run().catch(() => {}); return { started: !was }; }
    /** 이 사진 주소가 우리 카드에 실린 것인가(http 사진 전달이 아무 주소나 대신 받아 주지 않게). */
    //   사진 주소 목록은 60초 담아 둔다 — 종전에는 요청마다 날짜 파일(최대 30개)을 전부 읽어 아무나 부르면 서버가 막혔다(검토 지적, 요청당 약 47ms 측정)
    let imgCache = null;
    function imageKnown(url) {
        if (!url) return false;
        if (!imgCache || now() - imgCache.at > 60000) imgCache = { at: now(), set: new Set(dates().flatMap((d) => readDay(d).cards.map((c) => c.image).filter(Boolean))) };
        return imgCache.set.has(url);
    }
    function state() { return readJson(f('state.json'), null); }
    /** 운영에서만(FLY_ALLOC_ID) — 시작 2분 뒤 한 번, 그 뒤 매시 2분(KST). @returns {boolean} [연계] ← server.js */
    function start() {
        if (!process.env.FLY_ALLOC_ID || timer) return false;
        setTimeout(() => run().catch(() => {}), 120000).unref();
        timer = setInterval(() => { if (new Date(now() + 9 * 3600000).getUTCMinutes() === 2) run().catch(() => {}); }, 60000);
        timer.unref();
        return true;
    }
    return { run, day, dates, hit, state, keywords, setKeywords, imageKnown, start, adminDay, setHidden, publish, runNow, running: () => !!running };
}

let real = null;
const getReal = () => (real = real || createNews());

module.exports = {
    run: () => getReal().run(), day: (d) => getReal().day(d), dates: () => getReal().dates(), hit: (d, id, a) => getReal().hit(d, id, a),
    state: () => getReal().state(), keywords: () => getReal().keywords(), setKeywords: (l) => getReal().setKeywords(l), imageKnown: (u) => getReal().imageKnown(u), start: () => getReal().start(),
    adminDay: (d) => getReal().adminDay(d), setHidden: (d, id, h) => getReal().setHidden(d, id, h), publish: (d, i, c) => getReal().publish(d, i, c), runNow: () => getReal().runNow(), running: () => getReal().running(),
    createNews, clean, urlKey, titleKey, kstDate, kstShort, DEFAULT_KEYWORDS, DROP_RE, KEEP_DAYS,
};
