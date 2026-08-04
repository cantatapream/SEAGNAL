// build_delegation_graph.js — H-34 파일럿: 조문 단위 위임그래프를 원문에서 기계추출(3법 한정)
// 역할(초보자용): "법 제39조제2항 위임 → 시행규칙 제34조" 같은 **조문 대 조문** 연결을 사람 손이 아니라
//   raw 원문에서 뽑아낸다. 한국 법제 관행상 시행령·시행규칙 조문은 자기 본문 첫머리에 "법 제39조제2항에
//   따른 …"처럼 **자기가 어느 법률 조문을 집행하는지 스스로 적어 둔다** — 그 역방향 인용을 긁어 모으면
//   위임그래프가 된다. 고시(행정규칙)는 이미 raw/**/행정규칙/_admrul.json 이 조문 단위 위임을 갖고 있어
//   같은 모양(edge)으로 합치기만 한다.
//   (2026-08-04 확장) ①인용이 **조 안 어느 항·호·목에 적혀 있는지**까지 from 에 담는다.
//   ②"별표 2와 같다"·"별지 제3호서식에 따른다" 같은 **별표·서식 참조**를 kind:'annex_ref' 로 따로 모은다
//   — 별표는 아래로 다시 위임하는 조항이 아니라 딸린 표·서식이라, 위임 edge(backref_*)와 섞지 않는다.
// [연계] 입력 _dashboard/loop/build_data.json(법→raw 경로) + raw/<도메인>/<법>/{법률,시행령,시행규칙}.txt
//        + raw/<도메인>/<법>/행정규칙/_admrul.json · 파싱 재사용 services/article_text.js
//        출력 _dashboard/delegation_graph_pilot.json (읽기전용 분석 — raw/wiki/서빙코드 일절 안 건드림)
// [로드 순서] 단독 실행. `node local_server/knowledge/legal/_dashboard/loop/build_delegation_graph.js`
//   파일럿 3법(낚시관리및육성법·해상교통안전법·선박직원법)만. 서빙 파이프라인 미연결(사용자 검토 후 결정).

const fs = require('fs')
const path = require('path')
// ⚠ article_text.js 는 서버 모듈(github_raw·legal_retriever)을 require 한다 — 이 스크립트를 돌리면
//   "[Gemini] 키 0개 등록됨" 같은 서버 부팅 로그가 한 줄 찍힌다(무해). 조 블록 자르기 정규식은
//   그쪽이 실측으로 이미 여러 번 고친 자산이라(부칙 leak·편장절 꼬리 등) 새로 짜지 않고 그대로 쓴다.
// ⚠ splitParagraphs·splitHo·collectRefs 도 같은 이유로 그대로 빌려 쓴다 — 항(①②③) 쪼개기와
//   호 가지번호("6의2.") 처리는 L-61 에서 실측으로 고친 자산이고, 별표·서식 참조 표기(`별표 1`·
//   `별지 제1호서식`)도 collectRefs 가 이미 판정한다. 여기서 다시 정규식을 짜면 갈라진다.
const {
  listArticleNumbers, extractArticleBlock, splitParagraphs, collectRefs,
} = require('../../../../services/article_text.js')

const LEGAL = path.resolve(__dirname, '../..')
const DATA = `${LEGAL}/_dashboard/loop/build_data.json`
const OUT = `${LEGAL}/_dashboard/delegation_graph_pilot.json`

const PILOT = ['낚시 관리 및 육성법', '해상교통안전법', '선박직원법']
const TIERS = [['법률.txt', 'law'], ['시행령.txt', 'decree'], ['시행규칙.txt', 'rule']]
const TIER_KO = { 법률: 'law', 시행령: 'decree', 시행규칙: 'rule' }

// 역방향 인용 표기. 시행령·시행규칙 본문에서 `법`(=모법)·`영`(=시행령)은 관용적으로 그 법령 자신을 가리킨다.
// 예: "법 제39조제2항에 따른", "영 제13조제2항 각 호".
// ⚠ `제(\d+)조의(\d+)`(가지번호)·`제(\d+)항`까지만 잡는다 — 호·목(제1호다목)은 evidence 문자열에만 남는다.
const SHORT_RE = /(법|영)\s*제(\d+)조(?:의(\d+))?(?:제(\d+)항)?/g
// ⚠ 이 두 가지는 **모법이 아니다** — 걸러내지 않으면 남의 법 조문이 위임그래프에 섞인다(실측 확인).
//   ① "같은 법 제4조제2항"·"동법 제8조" → 바로 앞 문장에서 언급한 다른 법
//   ② "해사안전기본법 제3조"처럼 한글이 바로 앞에 붙은 `법` → 다른 법 이름의 끝글자
const OTHER_LAW_BEFORE = /(같은\s*|동)$/
const HANGUL_BEFORE = /[가-힣A-Za-z」]$/
// 별표 참조 바로 앞에 붙은 「법령명」 — `「수산자원관리법 시행령」 별표 1`(= 남의 법 별표)을 표시하는 데 쓴다.
const OTHER_LAW_ANNEX_BEFORE = /「([^」]{1,40})」\s*$/

/** 「법령명」(이하 "법"이라 한다) 제2조 — 정의 조문에서 모법을 풀네임으로 쓰는 관행을 잡는 정규식. */
function fullNameRe(lawName) {
  const esc = lawName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*')
  return new RegExp(`「\\s*${esc}\\s*」\\s*(?:\\([^)]*\\)\\s*)?제(\\d+)조(?:의(\\d+))?(?:제(\\d+)항)?`, 'g')
}

const squash = (s) => String(s || '').replace(/\s+/g, ' ').trim()
const joOf = (n, branch) => (branch ? `제${n}조의${branch}` : `제${n}조`)

/** 매치 앞뒤를 잘라 근거문(evidence)으로 만든다. 앞 12자 + 매치 + 뒤 30자. */
function evidenceAt(body, start, end) {
  return squash(body.slice(Math.max(0, start - 12), Math.min(body.length, end + 30)))
}

// ── 조 안에서 "그 인용이 어느 항·호에 적혀 있나"를 알아내는 자리(offset) 표 ────────────────────
// splitParagraphs/splitHo 는 쪼갠 글자만 주고 위치는 안 준다. 그런데 그 조각들은 전부 조 본문의
// **연속된 부분문자열**(양끝 공백만 잘린 것)이라, 앞에서부터 커서를 밀며 indexOf 로 되찾으면 자리를 안다.
// 이렇게 하면 **기존 스캔(본문 전체를 한 번에 훑는 정규식)은 한 글자도 안 바꾼 채** 매치 위치만
// 항·호로 번역할 수 있다 — 항별로 따로 스캔하면 앞 문맥이 잘려 "같은 법"·법이름 끝글자 필터
// (OTHER_LAW_BEFORE·HANGUL_BEFORE)가 헛돌아 없던 edge 가 생길 위험이 있어 그렇게 하지 않았다.
/** 항 머리기호(①…⑳) → `제N항`. 기호가 없는(항 구분 없는) 조각은 null = 조 수준. */
const hangOf = (mark) => (mark >= '①' && mark <= '⑳' ? `제${mark.charCodeAt(0) - 0x245f}항` : null)
/** splitHo 의 label 은 원문 그대로다('6의2', L-61) — 법령 표기(`제6호의2`)로 옮기기만 하고 번호를 만들지 않는다. */
const hoOf = (label) => {
  const m = /^(\d+)(?:의(\d+))?$/.exec(String(label || ''))
  return m ? (m[2] ? `제${m[1]}호의${m[2]}` : `제${m[1]}호`) : null
}

/**
 * 조 본문을 항·호·목 조각으로 쪼개고 각 조각이 본문 어디에 있는지(start,end)까지 붙여 돌려준다.
 * 예: unitSpans('① 가나\n② 다음 각 호와 같다.1. 다라') 의 마지막 원소 → {hang:'제2항', ho:'제1호', …}
 * @param {string} body - extractArticleBlock 이 뽑은 조 본문
 * @returns {Array<{hang:string|null, ho:string|null, mok:string|null, text:string, start:number, end:number}>}
 *   못 쪼개는 조(①②③ 없는 밋밋한 조문, splitHo 가 안전상 포기한 항)는 그 덩어리 하나가 그대로 한 조각이 된다.
 * [연계] → scanBackrefs()·scanAnnexRefs() 가 매치 위치를 이 표에 대조해 from.hang/ho 를 채운다.
 */
function unitSpans(body) {
  const out = []
  let cursor = 0
  const take = (hang, ho, mok, text) => {
    const t = String(text || '')
    if (!t) return
    const i = body.indexOf(t, cursor)
    if (i < 0) return // 되찾기 실패(있으면 안 되는 일) — 그 조각은 표에서 빠지고 조 수준으로 떨어진다
    cursor = i + t.length
    out.push({ hang, ho, mok, text: t, start: i, end: i + t.length })
  }
  for (const p of splitParagraphs(body)) {
    const hang = hangOf(p.mark || '')
    take(hang, null, null, p.text)
    for (const it of p.items || []) {
      const ho = hoOf(it.label)
      take(hang, ho, null, it.text)
      for (const sub of it.subs || []) take(hang, ho, sub.label, sub.text)
    }
  }
  return out
}

/** 매치가 시작된 자리를 품는 조각을 찾는다. 조각 사이(호 머리번호 "1." 같은 틈)면 null = 조 수준. */
function unitAt(spans, pos) {
  for (const u of spans) if (pos >= u.start && pos < u.end) return u
  return null
}

/** 조각(항·호·목) 표기를 edge 의 from 에 넣을 모양으로. 조 수준이면 전부 null. */
const fromUnit = (u) => ({ hang: u ? u.hang : null, ho: u ? u.ho : null, mok: u ? u.mok : null })

/**
 * 조 본문 하나에서 모법(법)·시행령(영) 역방향 인용을 뽑는다. 없으면 빈 배열(그게 정상인 조문도 많다).
 * @param {string} body - 조 본문
 * @param {string} lawName - 모법 이름(풀네임 인용 `「…법」 제3조` 를 잡는 데 쓴다)
 * @param {string} selfTier - 이 조문이 속한 계층(law|decree|rule)
 * @param {Array} spans - unitSpans(body) 결과. 매치 자리를 항·호로 번역하는 데만 쓴다.
 * @returns {Array<{from:{hang,ho,mok}, to:{tier,jo,hang}, evidence:string}>}
 */
function scanBackrefs(body, lawName, selfTier, spans) {
  const edges = []
  const seen = new Set()
  const push = (targetTier, jo, hang, start, end) => {
    const u = unitAt(spans, start)
    const f = fromUnit(u)
    // 같은 조항을 여러 번 인용해도 edge 는 하나 — 단 **인용이 적힌 항·호가 다르면 다른 edge** 다.
    // (예전엔 조 단위로만 뭉쳤다. 그때 세던 수는 stats.backref_*_edges_article_dedup 으로 따로 남긴다.)
    const key = `${f.hang || ''}|${f.ho || ''}|${f.mok || ''}|${targetTier}|${jo}|${hang || ''}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from: f, to: { tier: targetTier, jo, hang: hang || null }, evidence: evidenceAt(body, start, end) })
  }

  SHORT_RE.lastIndex = 0
  let m
  while ((m = SHORT_RE.exec(body))) {
    const before = body.slice(Math.max(0, m.index - 6), m.index)
    if (OTHER_LAW_BEFORE.test(before) || HANGUL_BEFORE.test(before)) continue
    const targetTier = m[1] === '법' ? 'law' : 'decree'
    if (targetTier === selfTier) continue // 시행령이 자기를 "영"이라 부르는 자기참조는 위임이 아니다
    push(targetTier, joOf(m[2], m[3]), m[4] ? `제${m[4]}항` : null, m.index, m.index + m[0].length)
  }

  const FULL_RE = fullNameRe(lawName)
  while ((m = FULL_RE.exec(body))) {
    push('law', joOf(m[1], m[2]), m[3] ? `제${m[3]}항` : null, m.index, m.index + m[0].length)
  }
  return edges
}

/**
 * 조 본문에서 별표·서식 참조(`별표 2와 같다`·`별지 제3호서식에 따른다`)를 항·호 단위로 뽑는다.
 * ⚠ 이건 **위임이 아니라 참조**다 — 별표는 다시 아래로 위임하는 법령 조항이 아니라 딸린 표·서식이라,
 *   backref_* 와 절대 같은 배열·같은 kind 로 섞지 않는다(kind:'annex_ref', to.tier:'annex').
 * 표기 판정은 collectRefs(article_text.js)를 그대로 쓴다 — 서버 팝업이 링크를 거는 기준과 같아야 한다.
 * ⚠ collectRefs 는 한 번에 MAX_REFS(12)개까지만 돌려준다. 항·호 단위로 부르면 실측상 걸리지 않지만,
 *   걸린 조각 수를 세어(capped) 보고한다 — "없다"와 "안 봤다"를 섞지 않기 위해서다.
 * @param {string} body - 조 본문
 * @param {Array} spans - unitSpans(body) 결과. 비면 본문 전체를 조각 하나로 본다.
 * ⚠ 실측: `「수산자원관리법 시행령」 별표 1 및 별표 2를 준용한다` 처럼 **남의 법 별표**를 가리키는 문장이 있다.
 *   역방향 인용 쪽 OTHER_LAW_BEFORE 필터와 같은 취지로, 바로 앞에 「법령명」이 붙어 있으면 그 이름을
 *   other_law 에 담아 둔다(버리지는 않는다 — 인용 사실 자체는 참이고, 소비자가 걸러 쓰면 된다).
 * @returns {{refs:Array<{from:{hang,ho,mok}, to:{tier,num,type,text}, other_law?:string, evidence:string}>, capped:number}}
 */
function scanAnnexRefs(body, spans) {
  const units = spans.length ? spans : [{ hang: null, ho: null, mok: null, text: body, start: 0, end: body.length }]
  const refs = []
  let capped = 0
  for (const u of units) {
    const found = collectRefs(u.text)
    if (found.length >= 12) capped++
    for (const r of found) {
      if (!/^(별표|서식)/.test(r.key)) continue // 【이미지 N】은 별표 참조가 아니다
      const at = u.start + Math.max(0, u.text.indexOf(r.text))
      const om = OTHER_LAW_ANNEX_BEFORE.exec(body.slice(Math.max(0, at - 44), at))
      refs.push({
        from: fromUnit(u),
        to: { tier: 'annex', num: r.key, type: r.key.startsWith('별표') ? '별표' : '서식', text: r.text },
        other_law: om ? squash(om[1]) : undefined,
        evidence: evidenceAt(body, at, at + r.text.length),
      })
    }
  }
  return { refs, capped }
}

/** 개정으로 통째로 지워진 조(`삭제 <1998.2.24>`)는 분모에서 뺀다 — 인용이 없는 게 당연해 커버리지를 왜곡한다. */
const isDeleted = (b) => /^삭제\s*(<[^>]*>)?\s*$/.test(squash(b.body))

function buildLaw(law) {
  const out = {
    law: law.name,
    slug: law.slug,
    raw: law.raw,
    tiers: {},
    edges: { backref: [], admrul: [], annex: [] },
    stats: {},
  }

  // 1) 계층별 조문 목록 + 역방향 인용 스캔(+ 항·호 자리 · 별표/서식 참조)
  for (const [file, tier] of TIERS) {
    const p = `${law.raw}/${file}`
    if (!fs.existsSync(p)) continue
    const text = fs.readFileSync(p, 'utf8')
    const jos = listArticleNumbers(text, tier)
    const st = {
      file, articles: jos.length, deleted: 0, scanned: 0, withEdges: 0, zeroEdges: 0, edges: 0,
      // 별표·서식 참조는 **법률 본문에도** 있고 그건 진짜 참조라 세 계층 다 훑는다(역방향 인용과 다름).
      annexScanned: 0, annexRefs: 0, articlesWithAnnex: 0, annexCapped: 0,
    }
    for (const jo of jos) {
      const block = extractArticleBlock(text, jo, tier)
      if (!block) continue
      if (isDeleted(block)) { st.deleted++; continue }
      const spans = unitSpans(block.body)

      const ann = scanAnnexRefs(block.body, spans)
      st.annexScanned++
      st.annexCapped += ann.capped
      if (ann.refs.length) st.articlesWithAnnex++
      st.annexRefs += ann.refs.length
      for (const r of ann.refs) {
        out.edges.annex.push({
          kind: 'annex_ref',
          from: { tier, jo, hang: r.from.hang, ho: r.from.ho, mok: r.from.mok, title: block.title || null },
          to: r.to,
          other_law: r.other_law,
          evidence: r.evidence,
        })
      }

      if (tier === 'law') continue // 법률 본문의 "법 제N조"는 자기참조가 아니라 남의 법이라 스캔하지 않는다
      st.scanned++
      const found = scanBackrefs(block.body, law.name, tier, spans)
      const lawEdges = found.filter((e) => e.to.tier === 'law')
      if (lawEdges.length) st.withEdges++
      else st.zeroEdges++
      st.edges += found.length
      for (const e of found) {
        out.edges.backref.push({
          kind: e.to.tier === 'law' ? 'backref_law' : 'backref_decree',
          from: { tier, jo, hang: e.from.hang, ho: e.from.ho, mok: e.from.mok, title: block.title || null },
          to: e.to,
          evidence: e.evidence,
        })
      }
    }
    if (tier === 'law') { st.scanned = 0; st.withEdges = 0; st.zeroEdges = 0 }
    out.tiers[tier] = st
  }

  // 2) 이미 있는 고시 위임(_admrul.json)을 같은 edge 모양으로 합친다(새 추출 없음)
  const admrulPath = `${law.raw}/행정규칙/_admrul.json`
  if (fs.existsSync(admrulPath)) {
    const adm = JSON.parse(fs.readFileSync(admrulPath, 'utf8'))
    for (const [title, info] of Object.entries(adm)) {
      for (const w of info['위임'] || []) {
        const cell = w['조항호목'] || w['위임조'] || ''
        const mm = /^제(\d+)조(?:의(\d+))?(?:제(\d+)항)?/.exec(cell)
        // ⚠ 실측: 위임조("제21조")와 조항호목("제21조의2제1항")의 조 번호가 어긋난 항목이 있다.
        //    더 자세한 조항호목 쪽을 채택하고, 어긋남은 note 로 남겨 사람이 볼 수 있게 한다.
        const jo = mm ? joOf(mm[1], mm[2]) : (w['위임조'] || null)
        out.edges.admrul.push({
          kind: 'admrul',
          from: { tier: TIER_KO[w['층']] || w['층'] || null, jo, cell: cell || null },
          to: { tier: 'notice', title, id: info.ID || null },
          evidence: w['근거문'] || '',
          note: mm && w['위임조'] && w['위임조'] !== jo ? `위임조(${w['위임조']})≠조항호목(${cell})` : undefined,
        })
      }
    }
  }

  // 3) 커버리지 — 판단 기준은 "법률 역방향 인용"만(영 인용은 참고 수치로 따로 센다)
  const scanned = ['decree', 'rule'].reduce((a, t) => a + (out.tiers[t]?.scanned || 0), 0)
  const withEdges = ['decree', 'rule'].reduce((a, t) => a + (out.tiers[t]?.withEdges || 0), 0)
  const lawEdges = out.edges.backref.filter((e) => e.kind === 'backref_law')
  const lawArticles = out.tiers.law?.articles || 0
  const reached = new Set(lawEdges.map((e) => e.to.jo))
  // 예전(조 단위) edge 수와 비교할 수 있게 항·호를 뺀 열쇠로도 센다 — 이 수치가 예전보다 줄면 회귀다.
  const coarse = (list) => new Set(list.map((e) => `${e.from.tier}|${e.from.jo}|${e.to.tier}|${e.to.jo}|${e.to.hang || ''}`)).size
  const decreeEdges = out.edges.backref.filter((e) => e.kind === 'backref_decree')
  const annexTier = (t) => out.edges.annex.filter((e) => e.from.tier === t).length
  out.stats = {
    scanned_decree_rule_articles: scanned,
    articles_with_law_backref: withEdges,
    articles_without_law_backref: scanned - withEdges,
    coverage_pct: scanned ? +((100 * withEdges) / scanned).toFixed(1) : 0,
    backref_law_edges: lawEdges.length,
    backref_decree_edges: out.edges.backref.length - lawEdges.length,
    backref_law_edges_article_dedup: coarse(lawEdges),
    backref_decree_edges_article_dedup: coarse(decreeEdges),
    // 새로 얻은 알갱이 — 인용이 적힌 자리를 항/호/목까지 아는 edge 수
    backref_edges_with_hang: out.edges.backref.filter((e) => e.from.hang).length,
    backref_edges_with_ho: out.edges.backref.filter((e) => e.from.ho).length,
    backref_edges_with_mok: out.edges.backref.filter((e) => e.from.mok).length,
    annex_ref_edges: out.edges.annex.length,
    annex_ref_edges_by_tier: { law: annexTier('law'), decree: annexTier('decree'), rule: annexTier('rule') },
    annex_ref_edges_form: out.edges.annex.filter((e) => e.to.type === '서식').length,
    annex_ref_edges_other_law: out.edges.annex.filter((e) => e.other_law).length,
    annex_targets_distinct: new Set(out.edges.annex.map((e) => `${e.from.tier}|${e.to.num}`)).size,
    annex_articles_with_ref: ['law', 'decree', 'rule'].reduce((a, t) => a + (out.tiers[t]?.articlesWithAnnex || 0), 0),
    annex_capped_units: ['law', 'decree', 'rule'].reduce((a, t) => a + (out.tiers[t]?.annexCapped || 0), 0),
    admrul_edges: out.edges.admrul.length,
    // 역방향(시행령→법)만 모아도 법률 조문 기준의 "아래로 위임" 목록이 그대로 나온다 — 이 수치가 그 도달률.
    law_articles: lawArticles,
    law_articles_reached: reached.size,
    law_reach_pct: lawArticles ? +((100 * reached.size) / lawArticles).toFixed(1) : 0,
  }
  return out
}

function main() {
  const all = JSON.parse(fs.readFileSync(DATA, 'utf8')).all
  const laws = PILOT.map((name) => {
    const l = all.find((x) => x.name === name)
    if (!l) throw new Error(`build_data.json 에 없는 법: ${name}`)
    return buildLaw(l)
  })

  const sum = (k) => laws.reduce((a, l) => a + l.stats[k], 0)
  const result = {
    generated: new Date().toISOString(),
    scope: 'H-34 파일럿 3법 — 시행령·시행규칙 조문의 "법 제N조" 역방향 인용 + _admrul.json 고시 위임 통합',
    caveats: [
      '법률→시행령 방향은 추출하지 않았다(법률 본문은 자기 시행령의 조 번호를 적지 않는다). 역방향 edge를 뒤집으면 같은 정보가 된다.',
      '인용이 적힌 자리(from)는 항·호·목까지 구조화했다(splitParagraphs/splitHo 재사용). 다만 인용 대상(to)의 호·목은 여전히 evidence 문자열에만 있다.',
      '별표·서식 참조는 kind:"annex_ref" 로 edges.annex 에 따로 담는다(위임이 아니라 참조 — 세 계층 모두에서 훑는다).',
      '"같은 법"·"동법"·다른 법명 끝글자의 "법"은 제외했지만, 인용문 안에서 남의 법을 "법"으로 축약한 드문 경우는 걸러지지 않는다.',
    ],
    summary: {
      laws: laws.length,
      scanned_decree_rule_articles: sum('scanned_decree_rule_articles'),
      articles_with_law_backref: sum('articles_with_law_backref'),
      coverage_pct: +((100 * sum('articles_with_law_backref')) / sum('scanned_decree_rule_articles')).toFixed(1),
      backref_law_edges: sum('backref_law_edges'),
      backref_decree_edges: sum('backref_decree_edges'),
      admrul_edges: sum('admrul_edges'),
      per_law: Object.fromEntries(laws.map((l) => [l.law, l.stats])),
    },
    laws: Object.fromEntries(laws.map((l) => [l.law, l])),
  }
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  console.log(`wrote ${OUT}`)
  console.log(JSON.stringify(result.summary, null, 2))
}

// 직접 실행하면 기존대로 파일럿 3법. require 하면 buildLaw 만 빌려 쓴다(73법 측정 = build_delegation_graph_73.js).
if (require.main === module) main()

module.exports = { buildLaw }
