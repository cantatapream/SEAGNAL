const path = require('path');
export const meta = {
  name: 'wiki-shared-refs-bootstrap',
  description: '여러 기준법이 공통으로 인용하는 타법 조문(전자정부법 제36조 등 최다 38개 법 공용)을 law.go.kr DRF로 1회 수집해 raw/15_관련타부처/에 공용 저장. 각 법 collect 셀이 재수집 안 하고 연결만 하도록 하는 부트스트랩. 완료 시 마커.',
  phases: [{ title: '공용타법수집', detail: '참조당 1에이전트: DRF 발췌수집 + 기존 발췌 병합(삭제금지) + REVIEW 헤더' }],
}
const LEGAL = path.resolve(__dirname, '../..')
const MARK = `${LEGAL}/_dashboard/fix3`
const TABU = `${LEGAL}/raw/15_관련타부처`

// 마스터 워크리스트 A표(공용 타법 2개 법 이상). 각 항목: 필요한 "그 조문"만 발췌(전체 개념화 금지).
// 기존 발췌 파일이 있으면 이어붙이고 기존 인용출처는 지우지 말 것.
const REFS = [
  { law: '전자정부법', arts: '제36조제1항', folder: '전자정부법', note: '행정정보 공동이용. 38개 법 공용 최다' },
  { law: '관광진흥법', arts: '제3조·제4조·제15조·제54조·제55조', folder: '관광진흥법', note: '기존 발췌(제2·52조)에 병합' },
  { law: '한국농어촌공사 및 농지관리기금법', arts: '제3조', folder: '한국농어촌공사및농지관리기금법', note: '설립근거' },
  { law: '농지법', arts: '제31조·제34조·제35조·제36조', folder: '농지법', note: '기존(제38조)에 병합. 농지전용 허가·신고' },
  { law: '초·중등교육법', arts: '제2조', folder: '초중등교육법', note: '학교의 종류' },
  { law: '신문 등의 진흥에 관한 법률', arts: '제9조제1항', folder: '신문등의진흥에관한법률', note: '등록' },
  { law: '토지이용규제 기본법', arts: '제8조·제10조', folder: '토지이용규제기본법', note: '지형도면 고시·확인' },
  { law: '소방시설공사업법', arts: '제13조제1항', folder: '소방시설공사업법', note: '소방시설공사 신고' },
  { law: '응급의료에 관한 법률', arts: '제2조·제36조', folder: '응급의료에관한법률', note: '정의·응급구조사 자격' },
  { law: '주민등록법', arts: '제16조제1항', folder: '주민등록법', note: '전입신고' },
  { law: '소방시설 설치 및 관리에 관한 법률', arts: '제6조제1항', folder: '소방시설설치및관리에관한법률', note: '건축허가등의 동의' },
  { law: '부동산투자회사법', arts: '제2조제1호', folder: '부동산투자회사법', note: '정의' },
  { law: '수도법', arts: '제17조·제49조', folder: '수도법', note: '기존(제52·54조)에 병합. 수도사업 인가' },
  { law: '전파법', arts: '제21조·제24조·제45조·제70조', folder: '전파법', note: '기존(제2·19조)에 병합. 무선국·기술기준·자격' },
  { law: '기상법', arts: '제2조·제13조·제13조의2·제14조', folder: '기상법', note: '정의·특보' },
  { law: '자연재해대책법', arts: '제4조', folder: '자연재해대책법', note: '기존(제2조)에 병합. 재해영향평가 협의' },
  { law: '중소기업기본법', arts: '제2조', folder: '중소기업기본법', note: '중소기업자 정의' },
  { law: '대기환경보전법', arts: '제23조', folder: '대기환경보전법', note: '배출시설 설치허가·신고' },
  { law: '소음ㆍ진동관리법', arts: '제8조', folder: '소음진동관리법', note: '배출시설 설치허가·신고' },
  { law: '남북교류협력에 관한 법률', arts: '제20조제1항', folder: '남북교류협력에관한법률', note: '기존 발췌에 병합' },
]

const SCHEMA = {
  type: 'object', required: ['ref', 'result'],
  properties: {
    ref: { type: 'string' }, result: { type: 'string' }, // collected | already_present | partial | failed
    saved_to: { type: 'string' }, arts_saved: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' }, marker: { type: 'boolean' },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const refs = cfg.only ? REFS.filter(r => cfg.only.includes(r.folder)) : REFS

const dupe = await agent(
  `Bash로 \`test -f "${MARK}/_shared_refs.done" && echo DONE || echo TODO\`. DONE이면 {done:true} 아니면 {done:false}.`,
  { label: 'dupechk:shared', phase: '공용타법수집', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['done'], properties: { done: { type: 'boolean' } } } })
if (dupe && dupe.done) { log('공용타법 이미 완료'); return { status: 'already_done_skipped' } }

log(`공용 타법 부트스트랩: ${refs.length}개 참조`)
phase('공용타법수집')

const results = await parallel(refs.map(r => () =>
  agent(
    `너는 SEAGNAL 해양법률 위키 사서다. 여러 기준법이 공통 인용하는 타법 「${r.law}」의 **다음 조문만 발췌** 수집한다(전체 개념화 금지): ${r.arts}. (용도: ${r.note})

## 수집 (law.go.kr DRF, OC=hyoo1431)
1. \`curl 'https://www.law.go.kr/DRF/lawSearch.do?OC=hyoo1431&target=law&type=JSON&query=${encodeURIComponent(r.law)}'\` → 결과에서 정확히 「${r.law}」의 MST(현행). 동명이법 주의.
2. \`curl 'https://www.law.go.kr/DRF/lawService.do?OC=hyoo1431&target=law&MST=<MST>&type=JSON'\` → 조문 전문. 위 지정 조문(${r.arts})만 골라 발췌.
   ★**판(version)을 반드시 대조한다**(2026-09-21, L-295·L-296): \`target=law&MST=\` 는 한 MST 가 시행일 판을 둘 이상 가지면 **어느 판이 올지 못 고르고 시행예정 판을 주기도 한다.** 받은 본문의 \`기본정보.시행일자\` 가 1번 목록이 알려 준 현행 시행일자와 **다르면** \`target=eflaw&MST=<MST>&efYd=<현행시행일자>\` 로 다시 받는다. 그래도 안 맞으면 **저장하지 말고** result="failed"(사유: 판 확정 실패). ⚠아직 시행되지 않은 조문을 raw 에 적는 것이 못 받는 것보다 나쁘다.
   (더 쉬운 길: \`node _dashboard/loop/add_other_law_article.js\` 가 이 대조를 이미 한다.)
3. 저장: \`${TABU}/${r.folder}/법률_발췌.txt\`. **이미 파일이 있으면 그 안의 기존 발췌 조문은 절대 지우지 말고**, 없는 조문만 이어붙인다(중복 조문은 건너뜀). 파일 맨 위 \`⚠REVIEW / 출처: 국가법령정보센터 ${r.law}(현행) / 발췌수집\` 헤더가 없으면 추가. 원문 수치·문구 불변.
4. **소관부처명**을 응답에서 확인해 발췌 파일 헤더에 \`소관부서: <부처>\`로 기록(연락처 있으면 병기).

## 규율
- 🚫 **.claude/ 폴더 절대 금지**. 결과는 JSON 반환값으로만.
- **환각 0**: DRF로 실제 받은 조문만. 못 받으면 result="failed"(note에 사유: 접속실패/조문없음/법령명불일치).
- **외과수술식**: \`${TABU}/${r.folder}/\`만 건드린다. 다른 법 폴더·위키 금지(위키 연결은 각 법 collect 셀이 함).
- 지정 조문 중 일부만 받았으면 result="partial", arts_saved에 실제 저장된 조문 나열.

반환(JSON): ref("${r.law} ${r.arts}"), result, saved_to, arts_saved[], note, marker(false).`,
    { label: `sref:${r.folder.slice(0, 10)}`, phase: '공용타법수집', model: 'sonnet', effort: 'high', schema: SCHEMA })
))

const ok = results.filter(Boolean)
await agent(
  `Bash로 \`mkdir -p ${MARK} && printf '%s\\n' "shared_refs done $(date -u +%FT%TZ) — ${ok.length}/${refs.length}" > "${MARK}/_shared_refs.done"\`. {marker:true} 반환.`,
  { label: 'mark:shared', phase: '공용타법수집', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['marker'], properties: { marker: { type: 'boolean' } } } })

log(`공용 타법 수집 완료: ${ok.filter(r => r.result === 'collected' || r.result === 'already_present').length}/${refs.length}`)
return { status: 'done', count: ok.length, results: ok }
