// byl_image_ocr_cell.js — 별표/조문 이미지(<img id="N">)를 비전 OCR해 이미지 옆에 <id>.txt(sidecar)로 남긴다.
// 역할(초보자용): 미리 내려받은 _이미지/<id>.png 를 비전으로 읽어, 표·산식·수치는 텍스트로 전사,
//   도해·그림은 한 줄 캡션으로, 각각 _이미지/<id>.txt 에 저장한다. (원본 raw 큰 파일은 안 건드림 = 경합 없음)
//   나중에 merge_byl_ocr.js가 이 sidecar들을 raw <img> 자리에 결정적으로 접어 넣는다(단독 실행).
// [연계] 입력 _이미지/<id>.png(dl_byl_images.sh) · 출력 _이미지/<id>.txt · 병합 merge_byl_ocr.js
//        · 규칙 _SCHEMA.md 0-A 별표 이미지 이중처리 · 답변 _CHATBOT.md 5-9
// [로드 순서] Workflow 단독 실행. dl_byl_images.sh 이후, merge_byl_ocr.js 이전.
// 안전: sidecar 방식이라 파일별 독립·완전 재개가능(<id>.txt 있으면 skip). 파일당 1에이전트.

export const meta = {
  name: 'byl-image-ocr',
  description: '별표 이미지(<img>)를 비전 OCR해 _이미지/<id>.txt sidecar로 저장',
  phases: [{ title: 'OCR', detail: '파일별 이미지 비전 판독→sidecar' }],
}

const ROOT = '/home/user/SEAGNAL/local_server/knowledge/legal'

// 기본=기술기준 계열(618 이미지 준비됨). args.files(ROOT상대경로 배열)로 전체 스코프 지정 가능.
const DEFAULT_FILES = [
  'raw/04_선박해운/선박안전법/행정규칙/선박구명설비기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박소방설비기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박전기설비기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박만재흘수선기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박복원성기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박방화구조기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/강화플라스틱(FRP)선의구조기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박설비기준.txt',
  'raw/03_해상교통안전/해상교통안전법/행정규칙/선박설비기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/목선의구조기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/소형선박의구조및설비기준.txt',
  'raw/04_선박해운/어선법/행정규칙/총톤수10톤미만소형어선의구조및설비기준.txt',
  'raw/10_항만물류/유선및도선사업법/행정규칙/선박구명설비기준.txt',
  'raw/10_항만물류/유선및도선사업법/행정규칙/유·도선의규격및시설·설비기준.txt',
  'raw/04_선박해운/선박안전법/행정규칙/선박기관기준.txt',
  'raw/04_선박해운/어선법/행정규칙/어선설비기준.txt',
  'raw/04_선박해운/어선법/행정규칙/어선기관기준.txt',
]

const SCHEMA = {
  type: 'object',
  required: ['file', 'status'],
  properties: {
    file: { type: 'string' },
    status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    images_total: { type: 'number' },
    ocr_table: { type: 'number' },     // 표·산식으로 전사
    diagrams: { type: 'number' },      // 도해 캡션
    already_done: { type: 'number' },  // sidecar 이미 있어 skip
    missing_png: { type: 'number' },   // png 없어 못함
    note: { type: 'string' },
  },
}

function promptFor(rel) {
  const dir = rel.substring(0, rel.lastIndexOf('/')) + '/_이미지'
  return `너는 한국 해사법령의 별표·조문 이미지를 비전으로 판독하는 작업자다.
대상 원문: ${ROOT}/${rel}
이미지 폴더: ${ROOT}/${dir}/<id>.png (이미 내려받아 둠)

## 목표 (_SCHEMA.md 0-A 별표 이미지 이중처리)
원문에 <img id="숫자"></img>로 박힌 표·산식·도해를 판독해, **이미지마다 옆에 sidecar 텍스트 파일 \`${dir}/<id>.txt\`**를 만든다.
- **표/산식/수치** → 이미지를 읽어 **수치·항목을 정확히 텍스트로 전사**(누락 금지). 처벌·안전 직결 수치엔 끝에 (⚠REVIEW).
- **도해·그림·사진**(구조도·부호·표지 도안 등) → **한 줄 캡션**만.

## 절차
1. \`cd ${ROOT}\` 후 대상 파일의 이미지 id 목록: \`grep -o '<img id="[0-9]*"' '${rel}' | grep -o '[0-9]*' | sort -u\`
2. 각 id마다:
   a. **재개**: \`${dir}/<id>.txt\`가 이미 있으면 **skip**(already_done).
   b. \`${dir}/<id>.png\`가 없으면 missing_png로 세고 skip.
   c. \`${dir}/<id>.png\`를 Read(비전)로 본다.
   d. sidecar 작성 — 첫 줄은 유형 태그, 이후 내용:
      - 표/산식: 첫 줄 \`[표]\` 또는 \`[산식]\`, 다음 줄부터 전사한 표/수치(행·열 구조 최대 보존, 파이프 표 가능).
      - 도해: 첫 줄 \`[도해]\`, 다음 줄 한 줄 캡션.
      파이썬으로 저장:
      \`\`\`
      python3 - <<'PY'
      open("${dir}/<id>.txt","w",encoding="utf-8").write('''[표]
      ...전사내용...''')
      PY
      \`\`\`
3. 전부 처리하면 스키마대로 반환.

## 규칙 (필수)
- **환각 0**: 이미지에 안 보이는 숫자를 지어내지 말 것. 흐리면 "(판독불명)" + (⚠REVIEW).
- 🚫 **.claude/ 절대 금지.** raw/ 안에서만(특히 _이미지/ 폴더에 sidecar).
- 원문 txt·다른 파일은 **수정하지 말 것**(이 셀은 sidecar만 만든다). 병합은 별도 단독 스크립트가 한다.
- 대량(수십~139개)일 수 있다. 하나 판독할 때마다 **즉시 sidecar 저장**(끊겨도 재개되게).`
}

let files = DEFAULT_FILES
if (args) {
  let a = args
  if (typeof a === 'string') { try { a = JSON.parse(a) } catch (e) { a = {} } }
  if (a && Array.isArray(a.files) && a.files.length) files = a.files
}

phase('OCR')
const results = await parallel(
  files.map((rel) => () =>
    agent(promptFor(rel), {
      label: `ocr:${rel.split('/').pop()}`,
      phase: 'OCR',
      model: 'claude-sonnet-5',
      schema: SCHEMA,
    })
  )
)

const ok = results.filter(Boolean)
return {
  files: files.length,
  done: ok.filter((r) => r.status === 'done').length,
  partial: ok.filter((r) => r.status === 'partial').length,
  failed: ok.filter((r) => r.status === 'failed').length,
  ocr_table: ok.reduce((s, r) => s + (r.ocr_table || 0), 0),
  diagrams: ok.reduce((s, r) => s + (r.diagrams || 0), 0),
  detail: ok.map((r) => ({ file: r.file.split('/').pop(), status: r.status, table: r.ocr_table, diagram: r.diagrams, skip: r.already_done, nopng: r.missing_png })),
}
