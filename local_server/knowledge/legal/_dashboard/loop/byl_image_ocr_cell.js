// byl_image_ocr_cell.js — 별표/조문 이미지(<img id="N">)를 비전 OCR해 표·수치는 텍스트로, 도해는 캡션+원본보존.
// 역할(초보자용): 원문 txt에 <img id="N">로 박힌 표·산식·도해를, 미리 내려받아 둔 _이미지/<N>.png 를
//   비전으로 읽어 ①표·산식·수치는 텍스트로 전사해 원문에 삽입 ②도해·그림은 한 줄 캡션+원본경로 표기.
//   → "이미지 속 수치"를 읽을 수 있게 하고, 도해는 챗봇이 나중에 띄울 수 있게 원본을 남긴다.
// [연계] 입력 raw/**/*.txt(<img id>)+같은폴더 _이미지/<id>.png(dl_byl_images.sh가 받아둠)
//        · 규칙 _SCHEMA.md 0-A 별표 이미지 이중처리 · 답변 _CHATBOT.md 5-9
// [로드 순서] Workflow 단독 실행. dl_byl_images.sh(다운로드) 이후.
// 안전: 파일당 에이전트 1개 = 자기 파일만 수정(병렬 안전). 재개 가능(【이미지판독 N】 있으면 skip).

export const meta = {
  name: 'byl-image-ocr',
  description: '별표/조문 이미지(<img>)를 비전 OCR해 수치는 텍스트로, 도해는 캡션+원본보존',
  phases: [{ title: 'OCR', detail: '파일별 이미지 비전 판독·원문 삽입' }],
}

const ROOT = '/home/user/SEAGNAL/local_server/knowledge/legal'

// 대상 파일(ROOT 상대경로). args.files 로 덮어쓸 수 있음.
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
  // 대형(마지막 — 오래 걸림): 선박기관 110, 어선설비 66, 어선기관 139
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
    ocr_table: { type: 'number' },     // 표·산식으로 전사한 수
    diagrams_kept: { type: 'number' }, // 도해로 원본보존 표기한 수
    already_done: { type: 'number' },  // 이미 판독돼 skip
    failed: { type: 'number' },
    note: { type: 'string' },
  },
}

function promptFor(rel) {
  return `너는 한국 해사법령 원문의 별표·조문 이미지를 비전으로 판독해 텍스트로 남기는 작업자다.
대상 원문: ${ROOT}/${rel}
이미지 폴더: 같은 디렉터리의 _이미지/<id>.png (dl_byl_images.sh가 이미 내려받아 둠)

## 목표 (사용자 확정 규칙 _SCHEMA.md 0-A 별표 이미지 이중처리)
원문에는 <img id="숫자"></img> 형태로 **표·산식·도해**가 이미지로 박혀 있다. 각 이미지를:
- **표/산식/수치** → 이미지를 읽어 **수치·항목을 텍스트로 정확히 전사**(누락 금지). 처벌·안전 직결 수치는 끝에 (⚠REVIEW) 표시.
- **도해·그림·사진**(구조도·부호·표지 도안 등 텍스트로 표현 불가) → **한 줄 캡션**만 달고 원본은 그대로 둔다(챗봇이 나중에 띄움).

## 절차
1. \`cd ${ROOT}\` 후 대상 파일에서 이미지 id 목록을 뽑는다: \`grep -o '<img id="[0-9]*"' '${rel}' | grep -o '[0-9]*'\`
2. **재개**: 파일에 이미 \`【이미지판독 <id>】\`가 있으면 그 id는 **건너뛴다**(중복 작업 금지).
3. 각 남은 id에 대해:
   a. \`_이미지/<id>.png\`를 Read(비전)로 본다. (파일 없으면 failed로 세고 넘어감)
   b. 표/산식이면 수치를 텍스트로 전사, 도해면 한 줄 캡션.
   c. **원문에 삽입**: 해당 \`<img id="<id>"></img>\` 바로 뒤에 아래 한 줄을 넣는다(파이썬으로 정확히 1회 치환, 원문 다른 곳 건드리지 말 것):
      - 표/산식: \`\\n【이미지판독 <id>】 <전사한 표/수치 텍스트>\`
      - 도해: \`\\n【이미지판독 <id>·도해】 <캡션> (원본: _이미지/<id>.png)\`
   d. 안전한 치환 예:
      \`\`\`
      python3 - <<'PY'
      p="${rel}"
      s=open(p,encoding="utf-8").read()
      tag='<img id="<id>"></img>'
      ins=tag+"\\n【이미지판독 <id>】 ...전사텍스트..."
      if '【이미지판독 <id>】' not in s:
          s=s.replace(tag, ins, 1)
          open(p,"w",encoding="utf-8").write(s)
      PY
      \`\`\`
      (원문에 <img id="<id>"> 뒤 </img>가 없을 수도 있으니, 없으면 '<img id="<id>">'로 매칭)
4. 다 끝나면 이 파일에 대응하는 위키 개념(\`wiki/concepts/\`에서 이 기준 이름으로 찾기)의 still_missing 중 "별표 이미지 미전사/수치표" 항목을, 이제 수치가 확보됐으면 해당 문장을 **"→ 이미지판독 완료(원문 【이미지판독】 참조)"**로 갱신한다(없으면 생략).

## 규칙 (필수)
- **환각 0**: 이미지에 안 보이는 숫자를 지어내지 말 것. 흐릿하면 그대로 "(판독불명)"이라 적고 (⚠REVIEW).
- 🚫 **.claude/ 는 절대 건드리지 말 것.** raw/·wiki/ 안에서만.
- 원문의 다른 텍스트·다른 이미지 태그는 **손대지 말 것**(딱 그 id 뒤에만 삽입).
- 대량(수십~백여 개)일 수 있다. 처음부터 끝까지 하나씩 처리하고, 중간에 끊겨도 재개되도록 **한 개 처리할 때마다 즉시 파일에 기록**(위 파이썬처럼 건건이 write).

작업 후 스키마대로 결과 반환(images_total·ocr_table·diagrams_kept·already_done·failed).`
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
  total_images: ok.reduce((s, r) => s + (r.images_total || 0), 0),
  ocr_table: ok.reduce((s, r) => s + (r.ocr_table || 0), 0),
  diagrams_kept: ok.reduce((s, r) => s + (r.diagrams_kept || 0), 0),
  detail: ok.map((r) => ({ file: r.file, status: r.status, table: r.ocr_table, diagram: r.diagrams_kept, failed: r.failed })),
}
