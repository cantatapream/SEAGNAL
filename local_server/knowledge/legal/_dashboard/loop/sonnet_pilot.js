export const meta = {
  name: 'sonnet-penalty-pilot',
  description: 'Sonnet 5 파일럿: 3개 법 처벌·정의 정확도를 Opus 심판으로 검증',
  phases: [
    { title: '생성(Sonnet)', detail: 'Sonnet 5가 3개 법 처벌·정의 페이지 작성' },
    { title: '심판(Opus)', detail: 'Opus가 원문 대조로 채점' },
  ],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const SCHEMA = `${LEGAL}/_SCHEMA.md`
const OUT = '/tmp/claude-0/-home-user-SEAGNAL/8333e12b-62ed-5369-b337-c007bf38af54/scratchpad/sonnet_pilot'

const LAWS = [
  { name: '어선법', slug: '어선법', raw: `${LEGAL}/raw/04_선박해운/어선법` },
  { name: '수산자원관리법', slug: '수산자원관리법', raw: `${LEGAL}/raw/05_수산어업/수산자원관리법` },
  { name: '해상교통안전법', slug: '해상교통안전법', raw: `${LEGAL}/raw/03_해상교통안전/해상교통안전법` },
]

const BUILD = {
  type: 'object', required: ['law', 'penalty_claims', 'definition_chain', 'reviews'],
  properties: {
    law: { type: 'string' },
    pages_written: { type: 'integer' },
    penalty_claims: {
      type: 'array', description: '이 법에서 뽑은 모든 처벌 주장',
      items: {
        type: 'object', required: ['위반', '조항호', '금액형량', '유형'],
        properties: {
          위반: { type: 'string' }, 조항호: { type: 'string', description: '제N조제M항제K호' },
          금액형량: { type: 'string' }, 유형: { type: 'string', description: '벌칙|과태료|행정처분' },
          원문근거: { type: 'string', description: '해당 조문 원문 발췌(있으면)' },
        },
      },
    },
    definition_chain: {
      type: 'array', description: '정의 사슬 홉(타법 인용을 실제로 읽었는지)',
      items: {
        type: 'object', required: ['용어', '정의출처'],
        properties: { 용어: { type: 'string' }, 정의출처: { type: 'string', description: '법령명 조문' }, 타법읽음: { type: 'boolean' } },
      },
    },
    reviews: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, detail: { type: 'string' } } } },
  },
}

const VERIFY = {
  type: 'object', required: ['law', 'penalty_checks', 'correct', 'wrong', 'hallucinated', 'honestly_flagged', 'opus_parity', 'verdict'],
  properties: {
    law: { type: 'string' },
    penalty_checks: {
      type: 'array',
      items: {
        type: 'object', required: ['주장', '판정', '정답'],
        properties: {
          주장: { type: 'string' }, 판정: { type: 'string', description: 'correct|wrong|hallucinated|honestly_flagged|unverifiable' },
          정답: { type: 'string', description: 'raw/API 원문 기준 정답' }, note: { type: 'string' },
        },
      },
    },
    definition_checks: { type: 'array', items: { type: 'object', properties: { 용어: { type: 'string' }, 판정: { type: 'string' }, note: { type: 'string' } } } },
    correct: { type: 'integer' }, wrong: { type: 'integer' },
    hallucinated: { type: 'integer', description: '원문에 없는데 지어낸 값 수(가장 중요)' },
    honestly_flagged: { type: 'integer', description: '모를 때 REVIEW로 정직하게 표시한 수' },
    opus_parity: { type: 'boolean', description: 'Opus 수준으로 신뢰 가능한가' },
    verdict: { type: 'string', description: '한줄 총평' },
  },
}

function buildPrompt(l) {
  return `너는 SEAGNAL 해양법률 위키의 사서다. \`${SCHEMA}\`를 먼저 읽는다(특히 처벌 3축 정확한 항·호·금액 필수·뭉개기 금지, 타법 인용은 실제 조문 읽기, 모르면 지어내지 말고 REVIEW).

## 임무: 「${l.name}」의 **처벌·정의를 정밀 추출**하고 개념 페이지를 작성한다.
- raw: \`${l.raw}\` (법률.txt·시행령.txt·시행규칙.txt + 별표/_links.json). 조문 원문을 직접 Read/Grep으로 읽어라.
- 인용된 타법이 \`${LEGAL}/raw/\` 하위에 있으면 그 조문도 실제로 읽어 정의를 확정(멀티홉).

## 산출물
1. 개념 페이지 1~2개를 \`${OUT}/${l.slug}__<주제>.md\`에 작성(스키마 개념 형식). 처벌은 정확한 조·항·호·금액.
2. **반드시** manifest 반환: 이 법에서 뽑은 **모든 처벌값**(위반/조항호/금액형량/유형/원문근거)과 **정의 사슬 홉**(용어/정의출처/타법읽음)과 reviews.

★ 절대 원칙: 원문에서 형량·금액을 못 찾으면 **지어내지 말고** 금액형량에 "REVIEW(원문 미확인)"라고 쓰고 reviews에 남겨라. 정확성 > 분량.`
}

function verifyPrompt(l, claims) {
  return `너는 **엄격한 심판(Opus)**이다. 아래는 다른 모델(Sonnet)이 「${l.name}」에서 뽑은 처벌·정의 주장이다. 각 주장을 **raw 원문으로 직접 대조**해 채점하라.
- raw: \`${l.raw}\` 의 법률.txt·시행령.txt·시행규칙.txt(형량 chapeau 복구됨) + 별표/. 필요하면 조문을 Read/Grep으로 열어 확인. 애매하면 국가법령 API로 재확인해도 됨.
- 각 처벌 주장을: **correct**(원문과 일치) / **wrong**(원문과 다름) / **hallucinated**(원문에 근거 없는데 구체 금액을 지어냄) / **honestly_flagged**(Sonnet이 모른다고 REVIEW 표시—정직) / **unverifiable**(원문으로 판단 불가) 로 판정하고 정답을 적어라.
- 정의 사슬도 타법을 실제로 맞게 읽었는지 점검.
- 집계: correct/wrong/hallucinated/honestly_flagged 개수, **opus_parity**(지어낸 값이 0이고 오류가 사소하며 정직 플래깅이 작동하면 true), verdict 한줄.

Sonnet 주장(JSON):
${JSON.stringify(claims).slice(0, 8000)}`
}

// 실행
phase('생성(Sonnet)')
const builds = await parallel(LAWS.map(l => () =>
  agent(buildPrompt(l), { label: `sonnet:${l.name}`, phase: '생성(Sonnet)', model: 'sonnet', effort: 'high', schema: BUILD })
    .then(m => ({ l, m }))
))

phase('심판(Opus)')
const verdicts = await parallel(builds.filter(b => b && b.m).map(({ l, m }) => () =>
  agent(verifyPrompt(l, m), { label: `judge:${l.name}`, phase: '심판(Opus)', model: 'opus', effort: 'high', schema: VERIFY })
))

const v = verdicts.filter(Boolean)
const agg = {
  laws: v.map(x => x.law),
  total_correct: v.reduce((s, x) => s + (x.correct || 0), 0),
  total_wrong: v.reduce((s, x) => s + (x.wrong || 0), 0),
  total_hallucinated: v.reduce((s, x) => s + (x.hallucinated || 0), 0),
  total_honestly_flagged: v.reduce((s, x) => s + (x.honestly_flagged || 0), 0),
  parity_pass: v.filter(x => x.opus_parity).length,
  per_law: v.map(x => ({ law: x.law, correct: x.correct, wrong: x.wrong, hallucinated: x.hallucinated, honestly_flagged: x.honestly_flagged, opus_parity: x.opus_parity, verdict: x.verdict })),
  detail: v,
}
return agg
