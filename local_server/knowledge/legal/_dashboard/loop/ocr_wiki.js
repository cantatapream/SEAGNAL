const path = require('path');
export const meta = {
  name: 'ocr-annex',
  description: '이미지로만 존재하는 별표·고시(처벌표·요율표 등)를 비전 OCR로 텍스트화 — 처벌수치는 REVIEW 플래그',
  phases: [{ title: 'OCR', detail: '항목마다 에이전트가 이미지 받아 읽고 별표 txt에 반영' }],
}
const LEGAL = path.resolve(__dirname, '../..')
const SCHEMA = {
  type: 'object', required: ['item', 'status'],
  properties: {
    item: { type: 'string' },
    status: { type: 'string' },       // ocr_done / not_image(원문없음) / not_found(이미지 못찾음) / partial
    file_written: { type: 'string' }, // 반영한 raw 파일 경로
    review_flagged: { type: 'boolean' }, // 처벌·금액 수치 REVIEW 표기했는지
    note: { type: 'string' },
  },
}
function prompt(it) {
  return `너는 SEAGNAL 해양법률 위키의 OCR 사서다. 목표: **이미지로만 존재해 텍스트가 안 뽑힌 별표/고시의 표를 비전으로 읽어 텍스트로 복원**한다.

## 대상
- 법: 「${it.law}」
- 감사가 지목한 구멍(무엇이 이미지라 못 뽑혔는지): "${it.gap}"

## 절차
1. **대상 별표/고시 특정**: \`${LEGAL}/raw/\`에서 이 법 폴더를 찾고(예: Grep/ls로 법명 매칭), \`별표/_links.json\`을 Read해 위 구멍이 가리키는 별표의 **제목을 매칭**한다(예 '기준임금','보험료율','부과기준','구조기준','수수료','시설기준' 등). 별표가 아니라 고시(행정규칙)면 \`행정규칙/\` 폴더의 해당 txt와 그 원본 링크를 찾는다.
   - _links.json 항목: {"제목","HWP","이미지":[url,...]}. **"이미지" URL**을 쓴다.
2. **이미지 확보 판단**:
   - 대응하는 별표 txt(예 \`별표/시행령_별표3.txt\`)를 Read해 **이미 숫자표 텍스트가 충분히 있으면** OCR 불필요 → status="not_image", 손대지 말 것.
   - 텍스트가 제목·머리말뿐이고 **실제 표(숫자/금액/기준)가 비어있으면** OCR 대상.
3. **다운로드+변환+OCR** (Bash로):
   \`\`\`
   cd <scratchpad 또는 /tmp>
   python3 -c "import urllib.request as u; open('a.gif','wb').write(u.urlopen(u.Request('<이미지URL>',headers={'User-Agent':'Mozilla/5.0'}),timeout=40).read())"
   python3 -c "from PIL import Image; Image.open('a.gif').convert('RGB').save('a.png')"
   \`\`\`
   그 다음 **Read로 a.png를 열어(비전) 표 전체를 정확히 전사**한다(행/열/숫자/금액/단위 그대로). 이미지가 여러 장이면 순서대로 모두.
4. **반영**: 원래 별표 txt(또는 고시 txt)에 전사 내용을 **추가**한다(기존 내용 위에 append). 반드시 맨 앞에 이 헤더를 붙인다:
   \`\`\`
   [OCR 2026-07-17 · ⚠REVIEW 처벌·금액·수치는 사람확인 필요]
   \`\`\`
   그리고 위키 개념 페이지에 이 수치가 쓰이면 그 페이지 해당 부분에도 \`(출처: <별표>, OCR·REVIEW)\` 표기.
5. 처벌·과태료·금액·요율 등 **수치가 포함되면 review_flagged=true**.

## 원칙
- 이미지에 실제로 있는 것만 전사. 흐릿하거나 안 보이면 "[판독불가]" 표기(지어내지 않음).
- 원문 이미지 자체가 없거나 URL 접근 실패면 status="not_found", note에 사유.
- 처벌 정밀도(조·항·호·금액) 유지.

반환(JSON): item, status, file_written, review_flagged, note.`
}
let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let items = cfg.items || []
if (!items.length && cfg.listPath) {
  const boot = await agent(
    `\`${cfg.listPath}\`(JSON: {"items":[...]})를 Read로 읽어 반환: {items: 그 배열 전체(원소 객체 그대로, 필터·가공·생략 금지)}.`,
    { label: 'boot-ocr', phase: 'OCR', model: 'sonnet', effort: 'low',
      schema: { type: 'object', required: ['items'], properties: { items: { type: 'array', items: { type: 'object' } } } } })
  if (boot) items = boot.items || []
}
log(`OCR 대상 ${items.length}건`)
phase('OCR')
const res = (await parallel(items.map(it => () =>
  agent(prompt(it), { label: `ocr:${(it.law||'').slice(0,10)}`, phase: 'OCR', model: 'sonnet', effort: 'high', schema: SCHEMA })
))).filter(Boolean)
const done = res.filter(r => r.status === 'ocr_done').length
const notimg = res.filter(r => r.status === 'not_image').length
const notfound = res.filter(r => r.status === 'not_found').length
const review = res.filter(r => r.review_flagged).length
return { total: items.length, ocr_done: done, not_image: notimg, not_found: notfound, review_flagged: review, results: res }
