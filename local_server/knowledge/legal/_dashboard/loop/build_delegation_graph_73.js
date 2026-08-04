// build_delegation_graph_73.js — H-34 측정: 파일럿 추출기를 73법 전체에 돌려 커버리지만 집계
// 역할(초보자용): build_delegation_graph.js(파일럿 3법)가 쓰는 `buildLaw` 를 그대로 빌려서
//   **핵심 73법 전부**에 돌린다. 추출 규칙(정규식·필터)은 한 줄도 안 바꾼다 — 이 파일은 "몇 %나
//   잡히는지 재는 자"일 뿐이다. 커버리지 낮은 법이 위로 오게 오름차순 정렬해 내보낸다.
//   재는 방법은 두 가지: **직접**(시행령·시행규칙이 법률을 스스로 인용) + **실질**(직접 + 시행규칙이
//   시행령을 인용하고 그 시행령 조문이 다시 법률을 인용하는 2단 경로까지 — resolveTwoHop 참고).
// [연계] 입력 _dashboard/loop/build_data.json 의 `all[]`(= 73법 정본 목록. audit9_groups.json 과 동일 집합)
//        추출 로직 재사용 ./build_delegation_graph.js 의 buildLaw()
//        출력 _dashboard/delegation_graph_coverage_73.json (커버리지 통계만 — edge 원본은 안 담는다.
//        73법 edge 를 다 담으면 수 MB라 사람이 훑을 수 없다. 파일럿 파일은 손대지 않는다.)
// [로드 순서] 단독 실행. `node local_server/knowledge/legal/_dashboard/loop/build_delegation_graph_73.js`
//   읽기전용 측정 — raw/wiki/서빙코드 일절 안 건드림.

const fs = require('fs')
const path = require('path')
const { buildLaw } = require('./build_delegation_graph.js')

const LEGAL = path.resolve(__dirname, '../..')
const DATA = `${LEGAL}/_dashboard/loop/build_data.json`
const OUT = `${LEGAL}/_dashboard/delegation_graph_coverage_73.json`
// 알갱이(항·호·목)와 별표 참조까지 담은 edge 원본. 커버리지 파일은 "훑어보는 자"라 여기 안 담는다
// (73법 edge 를 다 넣으면 수 MB — 사람이 훑을 수 없다). 소비자(위키 작성 보조·구멍 탐지)는 이쪽을 읽는다.
const OUT_FULL = `${LEGAL}/_dashboard/delegation_graph_full_73.json`

/**
 * 2단 위임(시행규칙 → 영 제N조 → 법 제M조)까지 세어 "실질 커버리지"를 구한다.
 *
 * 왜 필요한가: 기존 커버리지는 **법률을 직접 인용한 조문만** 센다. 그런데 시행규칙 조문은
 * "영 제16조제1항제3호에 따른 …"처럼 **자기 시행령을 인용**하는 경우가 흔하고(출입국관리법이 대표적),
 * 그 시행령 조문이 다시 "법 제M조에 따라 …"로 법률을 가리키면 **법률까지 가는 길은 이미 데이터에 있다**.
 * 직접 인용이 없다는 이유로 그걸 "모르는 조문"으로 세면 실제보다 커버리지가 과소평가된다.
 *
 * 알고리즘(2줄 요약): ①`backref_law` edge 를 가진 **시행령 조문 번호 집합**을 만든다.
 * ②직접 인용이 없는 시행규칙 조문의 `backref_decree` edge 목적지가 그 집합에 있으면 "2단 도달"로 센다.
 * 조 번호는 추출기가 이미 `제16조제1항제3호` → `{jo:'제16조', hang:'제1항'}` 으로 잘라 두므로
 * `to.jo`(=`제16조`, 가지번호는 `제16조의2`)를 그대로 `from.jo` 와 맞추면 된다(별도 정규화 불필요).
 *
 * ⚠ 시행령 조문이 자기 시행령의 다른 조를 "영 제N조"로 인용하는 대칭 케이스는 **데이터에 존재하지 않는다** —
 *   추출기(build_delegation_graph.js L69)가 자기 계층 인용(`targetTier === selfTier`)을 버리기 때문.
 *   73법 전체에서 `backref_decree` 의 from.tier 는 전부 'rule' 임을 실측 확인했다. 그래서 3단 이상은 안 본다.
 *
 * @param {object} r buildLaw() 반환값(edges.backref 를 그대로 쓴다)
 * @returns {{resolved:number, unresolved:number, samples:Array}} resolved=2단으로 구제된 조문 수,
 *   unresolved=영을 인용했지만 그 영 조문도 법률 인용이 없어 못 구한 조문 수, samples=근거 3건(사람 검증용)
 * [연계] 이 수치는 아래 main() 에서 effective_coverage_pct(=직접+2단) 계산에 쓰인다. 직접 수치
 *   (coverage_pct)는 비교를 위해 그대로 남긴다 — 개선폭이 보이도록 둘 다 보고.
 */
function resolveTwoHop(r) {
  const edges = r.edges.backref
  // 법률을 직접 인용하는 시행령 조문 = 2단 경유지로 쓸 수 있는 조문
  const decreeReachesLaw = new Set(
    edges.filter((e) => e.kind === 'backref_law' && e.from.tier === 'decree').map((e) => e.from.jo)
  )
  // 이미 법률을 직접 인용하는 조문(계층+조 번호) — 중복으로 세지 않기 위해 제외 대상
  const direct = new Set(edges.filter((e) => e.kind === 'backref_law').map((e) => `${e.from.tier}|${e.from.jo}`))

  const resolved = new Map() // key → 근거 edge (조문당 1번만 센다)
  const unresolved = new Set()
  for (const e of edges) {
    if (e.kind !== 'backref_decree') continue
    const key = `${e.from.tier}|${e.from.jo}`
    if (direct.has(key) || resolved.has(key)) continue
    if (decreeReachesLaw.has(e.to.jo)) resolved.set(key, e)
    else unresolved.add(key)
  }
  for (const key of resolved.keys()) unresolved.delete(key) // 한 조가 여러 영 조문을 인용하면 하나만 맞아도 도달

  const samples = [...resolved.values()].slice(0, 3).map((e) => ({
    from: `시행규칙 ${e.from.jo}${e.from.title ? `(${e.from.title})` : ''}`,
    via: `시행령 ${e.to.jo}${e.to.hang || ''}`,
    to: (edges.find((x) => x.kind === 'backref_law' && x.from.tier === 'decree' && x.from.jo === e.to.jo) || {}).to || null,
    evidence: e.evidence,
  }))
  return { resolved: resolved.size, unresolved: unresolved.size, samples }
}

function main() {
  const t0 = Date.now()
  const all = JSON.parse(fs.readFileSync(DATA, 'utf8')).all
  const rows = []
  const errors = []
  const full = {}

  for (const law of all) {
    // ⚠ 한 법이 터져도 나머지 72법 측정을 버리지 않는다. 에러는 "커버리지 0%"와 구분해 따로 보고한다
    //   (경로 못 찾음 같은 문제는 낮은 점수가 아니라 에러로 드러나야 한다).
    try {
      const r = buildLaw(law)
      const tier = (t) => {
        const s = r.tiers[t]
        return s ? { articles: s.articles, deleted: s.deleted, scanned: s.scanned, with_edges: s.withEdges, zero_edges: s.zeroEdges } : null
      }
      const hop = resolveTwoHop(r)
      const scanned = r.stats.scanned_decree_rule_articles
      const effective = r.stats.articles_with_law_backref + hop.resolved
      full[r.law] = { law: r.law, slug: r.slug, domain: law.domain, stats: r.stats, edges: r.edges }
      rows.push({
        law: r.law,
        domain: law.domain,
        // 직접 = 법률을 스스로 인용한 조문 비율(기존 지표, 그대로 둔다). 실질 = 직접 + 시행령 경유 2단 도달.
        coverage_pct: r.stats.coverage_pct,
        effective_coverage_pct: scanned ? +((100 * effective) / scanned).toFixed(1) : 0,
        two_hop_resolved: hop.resolved,
        two_hop_unresolved: hop.unresolved,
        // ⚠ 시행령 원문(시행령.txt)이 아예 없는 법은 2단 해소가 **원리적으로 불가능**하다 —
        //   시행규칙이 "영 제N조"라고 적어도 경유할 조문이 코퍼스에 없다. 낮은 점수의 원인이
        //   "옛 조문 작성 관행"이 아니라 "수집 구멍"이라는 뜻이라 따로 표시한다(73법 중 출입국관리법 1건).
        two_hop_blocked_no_decree_text: !r.tiers.decree && hop.unresolved > 0 ? true : undefined,
        two_hop_samples: hop.samples,
        scanned,
        with_backref: r.stats.articles_with_law_backref,
        without_backref: r.stats.articles_without_law_backref,
        law_reach_pct: r.stats.law_reach_pct,
        law_articles: r.stats.law_articles,
        law_articles_reached: r.stats.law_articles_reached,
        edges: {
          backref_law: r.stats.backref_law_edges,
          backref_decree: r.stats.backref_decree_edges,
          admrul: r.stats.admrul_edges,
          // 예전(조 단위 뭉치기) 기준 수 — 이 값이 예전 파일보다 작아지면 회귀다(알갱이를 더한 것뿐이라 줄 수 없다).
          backref_law_article_dedup: r.stats.backref_law_edges_article_dedup,
          backref_decree_article_dedup: r.stats.backref_decree_edges_article_dedup,
          annex_ref: r.stats.annex_ref_edges,
        },
        granularity: {
          with_hang: r.stats.backref_edges_with_hang,
          with_ho: r.stats.backref_edges_with_ho,
          with_mok: r.stats.backref_edges_with_mok,
        },
        annex: {
          refs: r.stats.annex_ref_edges,
          by_tier: r.stats.annex_ref_edges_by_tier,
          forms: r.stats.annex_ref_edges_form,
          other_law: r.stats.annex_ref_edges_other_law,
          distinct_targets: r.stats.annex_targets_distinct,
          articles_with_ref: r.stats.annex_articles_with_ref,
          capped_units: r.stats.annex_capped_units,
        },
        tiers: { law: tier('law'), decree: tier('decree'), rule: tier('rule') },
      })
    } catch (e) {
      errors.push({ law: law.name, raw: law.raw, error: String(e && e.message || e) })
    }
  }

  // 시행령·시행규칙 조문이 아예 없는 법(법률만 있는 법)은 분모가 0이라 커버리지가 무의미하다 — 따로 센다.
  const measurable = rows.filter((r) => r.scanned > 0)
  const noSub = rows.filter((r) => r.scanned === 0)
  // 정렬 기준을 실질 커버리지로 바꿨다 — "직접 인용이 없다"가 아니라 "법률까지 갈 길이 정말 없다"가
  // 진짜 구멍이기 때문. 직접 수치가 낮아도 2단으로 다 풀리는 법(출입국관리법)은 손볼 게 없고,
  // 2단으로도 안 풀리는 법(선박직원법 = 옛 조문 작성 관행)이 위로 와야 사람이 볼 목록이 된다.
  measurable.sort((a, b) => a.effective_coverage_pct - b.effective_coverage_pct || a.scanned - b.scanned)

  const sum = (f) => measurable.reduce((a, r) => a + f(r), 0)
  // ⚠ 별표 참조는 **법률 본문에도** 있어, 시행령·시행규칙이 없어 커버리지 집계에서 빠진 법(no_subordinate)도
  //   센다 — 그래서 measurable 이 아니라 rows(73법 전부) 위에서 합한다.
  const sumAll = (f) => rows.reduce((a, r) => a + f(r), 0)
  const totScanned = sum((r) => r.scanned)
  const totWith = sum((r) => r.with_backref)
  const totTwoHop = sum((r) => r.two_hop_resolved)
  const band = (lo, hi) => measurable.filter((r) => r.effective_coverage_pct >= lo && r.effective_coverage_pct < hi).length

  const result = {
    generated: new Date().toISOString(),
    scope: 'H-34 측정 — 핵심 73법 전체. 추출 로직은 파일럿(build_delegation_graph.js)과 동일, 범위만 3법→73법.',
    elapsed_sec: +((Date.now() - t0) / 1000).toFixed(1),
    caveats: [
      '파일럿과 동일: 법률→시행령 방향은 추출 안 함(역방향 edge를 뒤집으면 같은 정보), 호·목 미구조화, 인용문 안 남의 법 축약 "법"은 못 거름.',
      '커버리지 분모 = 시행령·시행규칙의 삭제되지 않은 조문 수. 시행령·시행규칙이 없는 법은 분모 0이라 집계에서 뺐다(no_subordinate).',
      '실질 커버리지(effective_coverage_pct) = 직접 인용 + 2단(시행규칙→영 제N조→법 제M조) 도달. 추출 규칙은 그대로고 세는 법만 바꿨다. 정렬은 실질 기준 오름차순.',
      '(2026-08-04) 인용이 적힌 자리를 항·호·목까지 담게 되어 edge 수(backref_*_edges)가 늘었다 — 예전 파일과 맞대 볼 값은 *_article_dedup 이다(같거나 커야 정상). 커버리지 분자·분모는 조 단위 그대로라 안 변한다.',
      '(2026-08-04) 별표·서식 참조(annex_ref)는 위임이 아니라 참조라 커버리지 계산에 일절 안 들어간다. edge 원본은 delegation_graph_full_73.json 에 있다.',
    ],
    summary: {
      laws_total: all.length,
      laws_measured: measurable.length,
      laws_no_subordinate: noSub.length,
      laws_errored: errors.length,
      scanned_decree_rule_articles: totScanned,
      articles_with_law_backref: totWith,
      overall_coverage_pct: totScanned ? +((100 * totWith) / totScanned).toFixed(1) : 0,
      two_hop_resolved: totTwoHop,
      two_hop_unresolved: sum((r) => r.two_hop_unresolved),
      articles_reachable_effective: totWith + totTwoHop,
      overall_effective_coverage_pct: totScanned ? +((100 * (totWith + totTwoHop)) / totScanned).toFixed(1) : 0,
      laws_improved_by_two_hop: measurable.filter((r) => r.two_hop_resolved > 0).length,
      backref_law_edges: sum((r) => r.edges.backref_law),
      backref_decree_edges: sum((r) => r.edges.backref_decree),
      admrul_edges: sum((r) => r.edges.admrul),
      // 알갱이(항·호·목) 추가분 — 예전 파일과 비교할 값은 *_article_dedup 쪽이다(줄면 회귀).
      backref_law_edges_article_dedup: sum((r) => r.edges.backref_law_article_dedup),
      backref_decree_edges_article_dedup: sum((r) => r.edges.backref_decree_article_dedup),
      backref_edges_with_hang: sum((r) => r.granularity.with_hang),
      backref_edges_with_ho: sum((r) => r.granularity.with_ho),
      backref_edges_with_mok: sum((r) => r.granularity.with_mok),
      // 별표·서식 참조(위임 아님) — 73법 전부(법률 본문 포함) 기준
      annex_ref_edges: sumAll((r) => r.annex.refs),
      annex_ref_edges_law_tier: sumAll((r) => r.annex.by_tier.law),
      annex_ref_edges_decree_tier: sumAll((r) => r.annex.by_tier.decree),
      annex_ref_edges_rule_tier: sumAll((r) => r.annex.by_tier.rule),
      annex_ref_edges_form: sumAll((r) => r.annex.forms),
      annex_ref_edges_other_law: sumAll((r) => r.annex.other_law),
      annex_articles_with_ref: sumAll((r) => r.annex.articles_with_ref),
      annex_capped_units: sumAll((r) => r.annex.capped_units),
      buckets_by_effective_coverage: {
        'lt50': band(0, 50),
        '50to80': band(50, 80),
        'gte80': measurable.filter((r) => r.effective_coverage_pct >= 80).length,
      },
    },
    errors,
    no_subordinate: noSub.map((r) => ({ law: r.law, law_articles: r.law_articles, admrul_edges: r.edges.admrul, annex_ref_edges: r.annex.refs })),
    per_law_sorted_worst_first: measurable,
  }

  fs.writeFileSync(OUT, JSON.stringify(result, null, 2))
  // edge 원본은 따로. 커버리지 파일(≈120KB, 훑어보는 용도)의 성격을 지키기 위해서다.
  fs.writeFileSync(OUT_FULL, JSON.stringify({
    generated: result.generated,
    scope: 'H-34 edge 원본 — 73법 전체. from 은 조·항·호·목까지, 별표/서식 참조는 kind:"annex_ref" 로 분리.',
    edge_kinds: {
      backref_law: '시행령·시행규칙 조문 → 그 근거 법률 조문(위임)',
      backref_decree: '시행규칙 조문 → 그 근거 시행령 조문(위임)',
      admrul: '법률·시행령 조문 → 고시(행정규칙). _admrul.json(정부 API) 그대로, 정규식 추출 아님',
      annex_ref: '조문 → 별표·서식(위임이 아니라 참조. to.tier="annex", to.num="별표2"·"서식1")',
    },
    from_labels: 'hang="제2항"(①②③에서), ho="제3호"·"제6호의2"(원문 번호 그대로), mok="가". 항 구분이 없거나 splitHo 가 안전상 안 쪼갠 자리는 null = 조 수준.',
    laws: full,
  }))
  console.log(`wrote ${OUT}`)
  console.log(`wrote ${OUT_FULL} (${(fs.statSync(OUT_FULL).size / 1048576).toFixed(1)} MB)`)
  console.log(JSON.stringify(result.summary, null, 2))
  if (errors.length) console.log('ERRORS:', JSON.stringify(errors, null, 2))
}

main()
