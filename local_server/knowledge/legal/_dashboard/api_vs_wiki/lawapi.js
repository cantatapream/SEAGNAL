/**
 * ============================================================================
 * 파일명: _dashboard/api_vs_wiki/lawapi.js
 * 역할: 비교 실험 C 방식(위키 없이 법제처 API 만 쓰는 방식)의 "도구" 모음.
 *   AI 가 법령을 찾고 → 목차를 보고 → 필요한 조문만 읽고 → 위임된 시행령·시행규칙·고시·별표로
 *   따라가도록, 국가법령정보센터 Open API(law.go.kr/DRF)를 그때그때 부른다.
 * ============================================================================
 *
 * [왜 이렇게 쪼갰나] 법 전체를 통째로 AI 에게 주면(예: 지방세법 23만 자) 너무 크다. 그래서
 *   ①목차(조 번호·제목만) ②고른 조문 본문 ③그 조문이 위임한 곳 — 세 단계로 나눠, 사람이
 *   법전을 찾듯 좁혀 가게 한다. 이 도구가 실제로 그 흐름을 따라갈 수 있는지가 실험의 질문이다.
 *
 * [실험 장치일 뿐] 앱·서버 코드가 이 파일을 부르지 않는다. 운영에 영향 없다.
 *   OC(API 사용자 키)는 저장소 관례 값(_dashboard/loop 의 수집 스크립트들과 같은 값)을 쓰고,
 *   환경변수 LAW_OC 로 덮을 수 있다.
 *
 * [기록] 호출 수·실패 수·재시도 수·받은 글자 수를 stats 에 센다(비교표의 "API 호출" 칸).
 *
 * [연계] ← arm_c.js(AI 도구 호출 루프) · test_lawapi.js(키 없이 도구만 시험)
 *        → https://www.law.go.kr/DRF/lawSearch.do · lawService.do
 * ============================================================================
 */
'use strict';

const BASE = 'https://www.law.go.kr/DRF';
const OC = process.env.LAW_OC || 'hyoo1431';
const TRIES = 6;              // 이 환경에서 연결이 중간에 끊기는 일이 있어(실측: 5연속 끊김도 봤다) 재시도한다
const TIMEOUT_MS = 40000;
const MAX_TOOL_CHARS = 20000; // 도구 결과 한 번의 상한 — AI 에게 너무 큰 덩어리를 주지 않는다
// 소관부처 코드(법제처 검색 응답의 「소관부처코드」 실측: 어선법=1192000, 해양경비법=1532000)
const ORG = { mof: '1192000', kcg: '1532000' };

/**
 * 도구 상태(호출 수 등)를 담는 새 세션을 만든다. 질문마다 하나씩 만든다 — 질문끼리 캐시를
 * 나누면 뒤 질문이 빨라져 시간 비교가 틀어진다.
 * @returns {{stats:object, cache:Map}}
 */
function newSession() {
  return { stats: { calls: 0, failures: 0, retries: 0, chars: 0, ms: 0 }, cache: new Map() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * DRF 를 한 번 부른다(재시도 포함). 같은 세션 안의 같은 주소는 다시 받지 않는다.
 * 예: drf(s, 'lawSearch.do', {target:'law', query:'어선법'})
 * @returns {Promise<object|null>} JSON, 끝내 실패하면 null
 */
async function drf(s, endpoint, params) {
  const qs = new URLSearchParams({ OC, type: 'JSON', ...params }).toString();
  const url = `${BASE}/${endpoint}?${qs}`;
  if (s.cache.has(url)) return s.cache.get(url);
  const t0 = Date.now();
  s.stats.calls++;
  for (let i = 0; i < TRIES; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      const text = await res.text();
      if (!res.ok || !text.trim().startsWith('{')) throw new Error(`HTTP ${res.status} ${text.slice(0, 80)}`);
      const json = JSON.parse(text);
      s.stats.chars += text.length;
      s.stats.ms += Date.now() - t0;
      s.cache.set(url, json);
      return json;
    } catch (e) {
      if (i < TRIES - 1) { s.stats.retries++; await sleep(4000 * (i + 1)); }
    }
  }
  s.stats.failures++;
  s.stats.ms += Date.now() - t0;
  return null;
}

const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);
const clip = s => (s.length > MAX_TOOL_CHARS ? s.slice(0, MAX_TOOL_CHARS) + `\n…(이하 ${s.length - MAX_TOOL_CHARS}자 생략)` : s);
const squash = s => String(s || '').replace(/\s+/g, '');

/** 조문 JSON 덩어리 안의 "…내용" 글을 순서대로 모아 사람이 읽는 글로 만든다. */
function flatten(node, out = []) {
  if (Array.isArray(node)) { node.forEach(n => flatten(n, out)); return out; }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (typeof v === 'string' && /내용$/.test(k) && v.trim()) out.push(v.trim());
      else if (Array.isArray(v) && v.every(x => Array.isArray(x) || typeof x === 'string') && /내용$/.test(k)) {
        out.push(v.flat(3).map(x => String(x).trimEnd()).join('\n'));     // 별표내용은 줄 배열로 온다
      } else if (typeof v === 'object') flatten(v, out);
    }
  }
  return out;
}

/** "제16조의2" → {no:'16', br:'2'} . 숫자만 와도 받는다. */
function parseJo(s) {
  const m = String(s).match(/(\d+)(?:\s*조)?(?:\s*의\s*(\d+))?/);
  return m ? { no: String(Number(m[1])), br: m[2] ? String(Number(m[2])) : '' } : null;
}

// ── 법령(법률·시행령·시행규칙) ──────────────────────────────────────────────

/**
 * 법령 이름으로 찾는다. 정확히 같은 이름이 있으면 그것을, 없으면 비슷한 것들을 돌려준다.
 * @returns {Promise<Array<{name,id,kind,dept}>>}
 */
async function findLaws(s, name) {
  const j = await drf(s, 'lawSearch.do', { target: 'law', query: name, display: '20' });
  const list = arr(j && j.LawSearch && j.LawSearch.law).map(x => ({
    name: x['법령명한글'], id: x['법령ID'], kind: x['법령구분명'], dept: x['소관부처명'],
  }));
  const exact = list.filter(x => squash(x.name) === squash(name));
  return exact.length ? exact : list;
}

/** 법령 이름 → 본문 JSON(현행). 못 찾으면 null 과 후보 목록. */
async function loadLaw(s, name) {
  const cands = await findLaws(s, name);
  const hit = cands.find(x => squash(x.name) === squash(name));
  if (!hit) return { law: null, cands };
  const j = await drf(s, 'lawService.do', { target: 'law', ID: hit.id });
  return { law: j && j['법령'], cands, meta: hit };
}

function notFound(name, cands) {
  return `「${name}」 이라는 이름의 법령을 찾지 못했다.` +
    (cands.length ? ` 비슷한 이름: ${cands.slice(0, 10).map(c => c.name).join(', ')}` : ' 검색 결과도 없다.');
}

/** 조문 목록(조 번호 + 제목). 장·절 머리줄은 그대로 둔다. */
function tocLines(law) {
  return arr(law['조문'] && law['조문']['조문단위']).map(u => {
    if (u['조문여부'] === '전문') return `  ${String(u['조문내용'] || '').trim()}`;     // 장·절 제목
    const br = u['조문가지번호'] ? `의${Number(u['조문가지번호'])}` : '';
    return `제${u['조문번호']}조${br}(${u['조문제목'] || ''})`;
  }).filter(Boolean);
}

// ── 도구들(AI 가 부르는 단위) ────────────────────────────────────────────────

const tools = {
  /** 법령 검색: 키워드로 법률·시행령·시행규칙 이름을 찾는다. */
  async search_law(s, { query }) {
    const list = await findLaws(s, query);
    if (!list.length) return `「${query}」 검색 결과 없음`;
    return list.slice(0, 20).map(x => `${x.name} [${x.kind}·${x.dept}]`).join('\n');
  },

  /**
   * 본문 검색(2회차 추가, 2026-10-06): 법 **이름**이 아니라 **조문 본문**에 그 낱말이 있는 법령을 찾는다.
   * [왜] 시험 10문항에서 C 가 틀린 원인 — 질문 속 「검수사」「해상특수경비원」「수상구조사」는 이름 검색으로
   *   0건이고(실측), 본문 검색으로는 맞는 법이 나온다. 다만 본문 검색은 **가나다순 100건까지만** 주고
   *   (「이동조치」 1,365건 → 해양경비법이 100건 밖), 관련도 정렬이 없다. 그래서 소관 부처 필터(org)로
   *   해양수산부·해양경찰청 소관을 먼저 따로 받는다(「지도사」를 해경으로 거르면 수색구조법이 1순위 — 실측).
   *   다른 부처 법(출입국관리법·질서위반행위규제법 등)도 답이 될 수 있어 전체 결과도 함께 보인다.
   */
  async search_text(s, { query }) {
    const one = async org => {
      const j = await drf(s, 'lawSearch.do', { target: 'law', query, search: '2', display: '30', ...(org ? { org } : {}) });
      const r = (j && j.LawSearch) || {};
      return { total: r.totalCnt || '0', list: arr(r.law).map(x => `${x['법령명한글']} [${x['소관부처명']}]`) };
    };
    const [mof, kcg, all] = await Promise.all([one(ORG.mof), one(ORG.kcg), one(null)]);
    const block = (title, r) => `[${title} — 총 ${r.total}건]\n${r.list.length ? r.list.join('\n') : '(없음)'}`;
    return clip([block('해양수산부 소관', mof), block('해양경찰청 소관', kcg),
      block('전체 부처(가나다순 앞 30건만 — 많으면 낱말을 더 구체적으로)', all)].join('\n\n'));
  },

  /** 목차: 그 법령의 조 번호·제목 전부와 별표 제목 목록(본문은 안 준다 — 가볍다). */
  async law_toc(s, { law_name }) {
    const { law, cands } = await loadLaw(s, law_name);
    if (!law) return notFound(law_name, cands);
    const annex = arr(law['별표'] && law['별표']['별표단위'])
      .map(b => `별표${Number(b['별표번호'])}${b['별표가지번호'] && Number(b['별표가지번호']) ? '의' + Number(b['별표가지번호']) : ''} ${b['별표제목'] || ''}`);
    const info = law['기본정보'] || {};
    return clip(`「${law_name}」 시행 ${info['시행일자'] || '?'}\n[조문 목차]\n${tocLines(law).join('\n')}` +
      (annex.length ? `\n[별표·서식]\n${annex.join('\n')}` : '\n[별표] 없음'));
  },

  /** 조문 본문: 고른 조문들만 원문 그대로 준다. */
  async get_articles(s, { law_name, articles }) {
    const { law, cands } = await loadLaw(s, law_name);
    if (!law) return notFound(law_name, cands);
    const units = arr(law['조문'] && law['조문']['조문단위']).filter(u => u['조문여부'] === '조문');
    const out = [];
    for (const a of arr(articles)) {
      const want = parseJo(a);
      const u = want && units.find(x => String(Number(x['조문번호'])) === want.no &&
        String(x['조문가지번호'] ? Number(x['조문가지번호']) : '') === want.br);
      out.push(u ? `■ 「${law_name}」 ${a}\n${flatten(u).join('\n')}` : `■ 「${law_name}」 ${a}: 그런 조문이 없다`);
    }
    return clip(out.join('\n\n'));
  },

  /** 별표 본문: 별표 번호로 표 내용을 글로 준다(법제처가 글로 제공하는 범위만). */
  async get_annex(s, { law_name, annex_no }) {
    const { law, cands } = await loadLaw(s, law_name);
    if (!law) return notFound(law_name, cands);
    const want = parseJo(annex_no);
    const b = want && arr(law['별표'] && law['별표']['별표단위']).find(x => String(Number(x['별표번호'])) === want.no &&
      String(x['별표가지번호'] && Number(x['별표가지번호']) ? Number(x['별표가지번호']) : '') === want.br);
    if (!b) return `「${law_name}」 에 별표 ${annex_no} 가 없다`;
    const body = flatten({ 별표내용: b['별표내용'] }).join('\n').trim();
    return clip(`■ 「${law_name}」 별표 ${annex_no} ${b['별표제목'] || ''}\n` +
      (body || '(법제처 API 가 이 별표의 글 본문을 주지 않는다 — 첨부파일(HWP·PDF)로만 있다)'));
  },

  /** 위임: 그 법령의 조문이 시행령·시행규칙·고시 어디로 넘겼는지(법제처 위임법령 정보). */
  async delegations(s, { law_name, article }) {
    const cands = await findLaws(s, law_name);
    const hit = cands.find(x => squash(x.name) === squash(law_name));
    if (!hit) return notFound(law_name, cands);
    const j = await drf(s, 'lawService.do', { target: 'lsDelegated', ID: hit.id });
    const rows = arr(j && j.lsDelegated && j.lsDelegated['법령'] && j.lsDelegated['법령']['위임조문정보']);
    const want = article ? parseJo(article) : null;
    const brOf = v => (v && Number(v) ? `의${Number(v)}` : '');
    const lines = [];
    for (const r of rows) {
      const jo = r['조정보'] || {};
      // ★가지번호까지 맞춘다 — 안 보면 「제24조」를 물었을 때 「제24조의2」의 위임까지 섞여 나온다(실측).
      if (want && (String(Number(jo['조문번호'])) !== want.no || brOf(jo['조문가지번호']) !== (want.br ? '의' + want.br : ''))) continue;
      const head = `제${jo['조문번호']}조${brOf(jo['조문가지번호'])}(${jo['조문제목'] || ''})`;
      for (const w of arr(r['위임정보'])) {
        if (w['위임구분'] === '위임행정규칙' || w['위임구분'] === '위임규정') {
          const a = w['위임행정규칙조문정보'] || w['위임규정조문정보'] || {};
          const title = a['위임행정규칙제목'] || a['위임규정제목'] || '';
          lines.push(`${head} ${a['조항호목'] || ''} → [${w['위임구분']}] ${title} — "${String(a['라인텍스트'] || '').slice(0, 120)}"`);
          continue;
        }
        const kinds = arr(w['위임구분']);
        if (kinds.every(k => k === '인용법령')) continue;   // 단순 인용은 위임이 아니다
        const titles = arr(w['위임법령제목']);
        arr(w['위임법령조문정보']).forEach((a, i) => {
          // 위임받은 쪽의 가지번호(「제26조의2」의 「의2」)는 따로 온다 — 안 붙이면 엉뚱한 조문을 읽게 된다(실측).
          lines.push(`${head} ${a['조항호목'] || ''} → [${kinds[i] || kinds[0]}] 「${titles[i] || titles[0]}」 제${a['위임법령조문번호']}조${brOf(a['위임법령조문가지번호'])}(${a['위임법령조문제목'] || ''}) — "${a['라인텍스트'] || ''}"`);
        });
      }
    }
    if (!rows.length) return `「${law_name}」 의 위임 정보를 법제처에서 받지 못했다(없거나 조회 실패)`;
    return clip(lines.length ? [...new Set(lines)].join('\n') : `「${law_name}」 ${article || ''} 에서 위임된 곳이 없다`);
  },

  /**
   * 행정규칙(고시·훈령·예규) 검색 — 이름 검색 + 본문 검색(2회차 추가)을 합쳐, 해양수산부·해양경찰청 소관을 앞에 둔다.
   * [왜] 「검수사」는 이름 검색 0건, 본문 검색이면 「항만운송업무 처리지침」이 나온다(실측).
   */
  async search_admin_rule(s, { query }) {
    const get = async search => {
      const j = await drf(s, 'lawSearch.do', { target: 'admrul', query, display: '30', ...(search ? { search } : {}) });
      return arr(j && j.AdmRulSearch && j.AdmRulSearch.admrul);
    };
    const [byName, byText] = await Promise.all([get(null), get('2')]);
    const seen = new Set();
    const list = byName.concat(byText).filter(x => !seen.has(x['행정규칙일련번호']) && seen.add(x['행정규칙일련번호']));
    if (!list.length) return `「${query}」 행정규칙 검색 결과 없음(이름·본문 모두)`;
    const mar = x => /해양수산부|해양경찰청|지방해양수산청/.test(x['소관부처명'] || '') ? 0 : 1;
    list.sort((a, b) => mar(a) - mar(b));
    return clip(list.slice(0, 30).map(x => `${x['행정규칙명']} [${x['행정규칙종류']}·${x['소관부처명']}·시행 ${x['시행일자']}]`).join('\n'));
  },

  /** 행정규칙 본문: 이름이 정확히 같은 현행 행정규칙의 조문 전체(크면 앞부분만). */
  async get_admin_rule(s, { rule_name }) {
    const j = await drf(s, 'lawSearch.do', { target: 'admrul', query: rule_name, display: '20' });
    const list = arr(j && j.AdmRulSearch && j.AdmRulSearch.admrul);
    const hit = list.find(x => squash(x['행정규칙명']) === squash(rule_name));
    if (!hit) return `「${rule_name}」 행정규칙을 찾지 못했다.` + (list.length ? ` 비슷한 이름: ${list.slice(0, 10).map(x => x['행정규칙명']).join(', ')}` : '');
    const d = await drf(s, 'lawService.do', { target: 'admrul', ID: hit['행정규칙일련번호'] });
    const a = d && d.AdmRulService;
    if (!a) return `「${rule_name}」 본문 조회 실패`;
    const body = arr(a['조문내용']).flat(3).map(x => String(x).trim()).filter(Boolean).join('\n');
    const annex = flatten({ x: a['별표'] }).join('\n').trim();
    return clip(`■ 「${rule_name}」 (${hit['행정규칙종류']}, 시행 ${hit['시행일자']})\n` +
      (body || '(법제처 API 가 이 행정규칙의 글 본문을 주지 않는다 — 첨부파일로만 있다)') +
      (annex ? `\n[별표]\n${annex}` : ''));
  },
};

// AI 에게 보여 줄 도구 설명(Gemini functionDeclarations 형식).
const S = (props, req) => ({ type: 'OBJECT', properties: props, required: req });
const STR = d => ({ type: 'STRING', description: d });
const declarations = [
  { name: 'search_law', description: '법령 **이름**으로 법률·시행령·시행규칙을 찾는다(이름에 그 낱말이 있어야 나온다).', parameters: S({ query: STR('법령 이름 또는 그 일부') }, ['query']) },
  { name: 'search_text', description: '조문 **본문**에 그 낱말이 들어 있는 법령을 찾는다. 질문에 법 이름이 없을 때 제도명·자격명·전문용어로 찾는다. 해양수산부·해양경찰청 소관 결과를 따로 먼저 보여 준다.', parameters: S({ query: STR('본문에 나올 만한 구체적인 낱말(예: 수상구조사, 해상특수경비원)') }, ['query']) },
  { name: 'law_toc', description: '법령의 조문 목차(조 번호·제목)와 별표 목록을 본다. 본문은 주지 않는다.', parameters: S({ law_name: STR('정식 법령명(예: 어선법 시행규칙)') }, ['law_name']) },
  { name: 'get_articles', description: '법령의 특정 조문 본문을 원문 그대로 받는다.', parameters: S({ law_name: STR('정식 법령명'), articles: { type: 'ARRAY', items: STR('조문(예: 제13조, 제16조의2)'), description: '읽을 조문들' } }, ['law_name', 'articles']) },
  { name: 'get_annex', description: '법령의 별표 본문(표 내용)을 받는다.', parameters: S({ law_name: STR('정식 법령명'), annex_no: STR('별표 번호(예: 4, 1의2)') }, ['law_name', 'annex_no']) },
  { name: 'delegations', description: '법령 조문이 시행령·시행규칙·고시(행정규칙)의 어디에 세부사항을 위임했는지 본다.', parameters: S({ law_name: STR('정식 법령명'), article: STR('조문(예: 제13조). 비우면 그 법령 전체') }, ['law_name']) },
  { name: 'search_admin_rule', description: '고시·훈령·예규·지침 등 행정규칙을 이름과 본문으로 찾는다.', parameters: S({ query: STR('행정규칙 이름이나 본문에 나올 낱말') }, ['query']) },
  { name: 'get_admin_rule', description: '행정규칙 본문을 받는다(이름이 정확해야 한다).', parameters: S({ rule_name: STR('정확한 행정규칙명') }, ['rule_name']) },
];

/**
 * 도구 하나를 실행한다. 모르는 도구·실패는 글로 돌려준다(AI 가 다음 수를 고를 수 있게).
 * @returns {Promise<string>}
 */
async function runTool(s, name, args) {
  const f = tools[name];
  if (!f) return `알 수 없는 도구: ${name}`;
  try { return await f(s, args || {}); } catch (e) { return `도구 실패: ${e && e.message}`; }
}

module.exports = { newSession, runTool, declarations, tools };
