// byl_image_ocr_cell.js — 별표/조문 이미지(<img id="N">)를 비전 OCR해 이미지 옆에 <id>.txt(sidecar)로 남긴다.
// 역할(초보자용): 미리 내려받은 _이미지/<id>.png 를 비전으로 읽어, 표·산식·수치는 텍스트로 전사,
//   도해·그림은 한 줄 캡션으로, 각각 _이미지/<id>.txt 에 저장한다. (원본 raw 큰 파일은 안 건드림 = 경합 없음)
//   나중에 merge_byl_ocr.js가 이 sidecar들을 raw <img> 자리에 결정적으로 접어 넣는다(단독 실행).
// [연계] 입력 _이미지/<id>.png(dl_byl_images.sh) · 출력 _이미지/<id>.txt · 병합 merge_byl_ocr.js
//        · 규칙 _SCHEMA.md 0-A 별표 이미지 이중처리 · 답변 _CHATBOT.md 5-9
// [로드 순서] Workflow 단독 실행. dl_byl_images.sh 이후, merge_byl_ocr.js 이전.
// 안전: sidecar 방식=이미지별 독립·완전 재개가능(<id>.txt 있으면 skip). 35-wide 병렬 안전(각자 다른 파일 씀).
// 모드: args.images = ["<dir>\t<id>", ...] 청크를 에이전트 1개가 OCR. (args는 문자열로 오므로 JSON.parse)

export const meta = {
  name: 'byl-image-ocr',
  description: '별표 이미지(<img>) 청크를 비전 OCR해 _이미지/<id>.txt sidecar로 저장',
  phases: [{ title: 'OCR', detail: '이미지 청크 비전 판독→sidecar' }],
}

const SCHEMA = {
  type: 'object',
  required: ['status'],
  properties: {
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    total: { type: 'number' },
    ocr_table: { type: 'number' },
    diagrams: { type: 'number' },
    already_done: { type: 'number' },
    missing_png: { type: 'number' },
    unreadable: { type: 'number' },
    note: { type: 'string' },
  },
}

// args 파싱(문자열로 옴). args.chunkFile = 처리할 이미지목록 파일 경로("<dir>\t<id>" 줄들).
let chunkFile = ''
let label = 'chunk'
if (args) {
  let a = args
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = {} } }
  if (a && a.chunkFile) chunkFile = a.chunkFile
  if (a && a.label) label = a.label
}

function prompt(cf) {
  return `너는 한국 해사법령의 별표·조문 이미지를 비전으로 판독하는 작업자다.
처리할 이미지 목록은 파일에 있다: \`${cf}\`
먼저 \`cat '${cf}'\` 로 목록을 읽어라. 각 줄은 "<이미지폴더 절대경로><탭><id>" 형식이다.

## 목표 (_SCHEMA.md 0-A 별표 이미지 이중처리)
각 이미지 \`<dir>/<id>.png\`를 비전으로 읽어 **옆에 sidecar 텍스트 \`<dir>/<id>.txt\`**를 만든다.
- **표/산식/수치** → 수치·항목을 **정확히 텍스트로 전사**(누락 금지). 처벌·안전 직결 수치엔 끝에 (⚠REVIEW).
- **도해·그림·사진**(구조도·부호·표지 도안 등) → **한 줄 캡션**만.

## 절차 (목록의 각 줄에 대해)
1. **재개**: \`<dir>/<id>.txt\`가 이미 있으면 skip(already_done).
2. \`<dir>/<id>.png\`가 없으면 missing_png로 세고 skip.
3. \`<dir>/<id>.png\`를 Read(비전)로 본다. 판독 불가/깨짐이면 unreadable로 세고 sidecar에 "[판독불가]"만 기록.
4. sidecar 저장 — 첫 줄은 유형 태그:
   - 표/산식: 첫 줄 \`[표]\` 또는 \`[산식]\`, 다음 줄부터 전사(행·열 구조 보존, 파이프표 가능).
   - 도해: 첫 줄 \`[도해]\`, 다음 줄 한 줄 캡션.
   파이썬으로 저장(경로에 공백·한글 있으니 정확히):
   \`\`\`
   python3 - <<'PY'
   open(r"<dir>/<id>.txt","w",encoding="utf-8").write("[표]\\n...전사...")
   PY
   \`\`\`

## 규칙 (필수)
- **환각 0**: 안 보이는 숫자를 지어내지 말 것. 흐리면 "(판독불명)"+(⚠REVIEW).
- 🚫 **.claude/ 절대 금지.** _이미지/ 폴더에 sidecar만 쓴다. **원문 txt·다른 파일 수정 금지.**
- 하나 판독할 때마다 **즉시 sidecar 저장**(끊겨도 재개).
- 목록의 모든 이미지를 처리한 뒤 스키마대로 반환(total=목록 줄 수).`
}

if (!chunkFile) {
  return { status: 'failed', total: 0, note: 'args.chunkFile 없음 — {chunkFile:"..."} 필요' }
}

phase('OCR')
const r = await agent(prompt(chunkFile), {
  label: `ocr:${label}`,
  phase: 'OCR',
  model: 'claude-sonnet-5',
  schema: SCHEMA,
})
return r || { status: 'failed', note: 'agent null' }
