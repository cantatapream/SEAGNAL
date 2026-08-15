// ocr_review_verify.js — 별표 OCR값확정 대기 카드(review_gen/) Opus 비전 2차 재검증.
// 역할(초보자용): review_gen/<법>.md에 쌓인 "별표 이미지 OCR값이 맞는지 확인 필요" 카드들을
//   Opus(비전모델)가 원본 이미지/원문 텍스트를 직접 열어 대조한다. 일치/정정 확인되면
//   canonical 승급, 애매하면 그대로 사람 대기 유지(보수적). 사용자 확정 2026-08-15:
//   AI(Opus) 재검증 통과 시 사람 승인 없이 바로 canonical 승급(기존 "OCR값=무조건 사람" 규칙의
//   범위 축소 — 그림 참조).
// [연계] 입력 _dashboard/review_gen/<슬러그>.md(카드) + raw/(원본 이미지·텍스트, 읽기전용)
//        출력 wiki/*/<슬러그>__*.md status 승급 + review_gen 카드에 결과 부기.
//        마커 fix3/ocrverify_<슬러그>.done. 자기 법 파일만 쓰므로 병렬 안전(⚠경합없음).
//        review_queue.md 동기화는 이 스크립트가 하지 않음 — 오케스트레이터가 완료 후 일괄 처리.
// [로드 순서] Workflow. draft_reverify.js의 "② card" 산출물을 소비하는 후속 단계.
export const meta = {
  name: 'maritime-ocr-review-verify',
  description: '별표OCR값확정 대기 카드(review_gen/)를 Opus 비전으로 원본 이미지/원문 재검증 → 일치 확인 시 canonical 승격',
  phases: [{ title: 'OCR재검증', detail: '법별 1에이전트: 카드마다 원본(이미지/txt) 직접 대조 → 일치/정정/미확인' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'

const SCHEMA = {
  type: 'object', required: ['law', 'status'],
  properties: {
    law: { type: 'string' }, status: { type: 'string', enum: ['done', 'partial', 'failed'] },
    matched: { type: 'integer', description: '원본과 정확히 일치 확인 → canonical 승급' },
    corrected: { type: 'integer', description: '원본과 달라 정정 후 canonical 승급' },
    unverifiable: { type: 'integer', description: '이미지 판독불가/원본 미발견 등으로 여전히 사람 대기' },
    pages_promoted: { type: 'integer' },
    note: { type: 'string' },
  },
}

function prompt(law) {
  return `너는 SEAGNAL 해양법률 위키의 **별표 OCR값 2차 재검증 사서**다(Opus 비전모델). 담당 법의 review_gen 카드를 **원본(이미지 또는 raw 텍스트)과 직접 대조**해 확정한다. **자기 법 파일만** 쓴다(.claude·다른 법·graph·review_queue.md 금지 — review_queue.md 동기화는 오케스트레이터가 별도로 일괄 처리한다).

## 담당 법: 「${law}」
- 카드 목록: \`${LEGAL}/_dashboard/review_gen/${law}.md\`를 Read (없거나 빈 파일이면 note에 "카드없음" 남기고 즉시 종료).

## 각 카드(### REVIEW-...)마다 처리
1. **"원본" 필드를 파싱**한다. \`/api/legal/src?p=<경로>\` 형태면 실제 파일은 \`${LEGAL}/raw/<경로>\`다.
   - 경로가 \`_이미지/*.png\`(또는 .jpg)면 → **Read 도구로 그 이미지 파일을 직접 열어 표/수치를 눈으로 읽는다**(네가 지금 비전모델이라 가능하다).
   - 경로가 \`.txt\`면 → Read/Grep으로 그 원문 텍스트에서 해당 조·항·호·별표 부분을 직접 찾는다(이미지보다 더 확실한 근거 — grep으로 EXACT 대조).
   - law.go.kr URL만 있고 로컬 파일이 없으면 → unverifiable.
2. **"AI 제안값"과 원본을 대조**해 판정:
   - **matched**: 원본의 수치·문구가 AI 제안값과 정확히 일치.
   - **corrected**: 원본을 읽어보니 AI 제안값과 다름 — 원본이 진짜 값이므로 그 값으로 정정.
   - **unverifiable**: 이미지가 흐릿/잘림/글자판독불가, 원본 파일을 못 찾음, 표 구조가 복잡해 확신이 안 섬 — **억지로 판정하지 말고 그대로 사람 대기 유지**(보수적으로).
3. **matched/corrected면 대상 페이지를 수정**한다(대상 페이지: 카드의 "대상 페이지" 필드):
   - 그 페이지에서 이 카드가 가리키는 ⚠REVIEW 표기 문장을 찾아, matched면 REVIEW 단어만 제거(값은 이미 맞으므로 본문 변경 최소), corrected면 **원본에서 읽은 정확한 값으로 교체**하고 REVIEW 제거.
   - 변경이력에 한 줄 추가: \`| 2026-08-15 | Opus 비전 재검증(REVIEW-${law}-NNN): <matched면 "원본 이미지 대조 결과 일치 확인" / corrected면 "원본 대조 결과 <이전값>→<정정값>"> | REVIEW-${law}-NNN, 원본 경로 |\`
   - **그 페이지에 이 배치가 다루지 않는 다른 ⚠REVIEW가 더 남아있는지 확인**한다(grep "⚠\\s*REVIEW"). **전부 해소됐을 때만** frontmatter \`status: draft\` → \`status: canonical\`로 승급한다. 하나라도 남아있으면 draft 유지(본문 수정만 반영, status는 그대로).
4. **review_gen 카드 자체를 갱신**(자기 파일이라 안전): matched/corrected 처리한 카드의 "승인: [ ] 대기" 줄 바로 아래에 한 줄 추가:
   \`- ✅ Opus 비전 재검증 완료(2026-08-15): matched|corrected, <확인한 값>\`
   unverifiable은 카드를 그대로 둔다(수정 없음).

## 규칙(외과수술식·환각0·보수적)
- 이미지가 애매하면 절대 억지로 판정하지 마라 — unverifiable로 남기는 게 틀린 승급보다 훨씬 안전하다.
- 본문에서 값/REVIEW 문장 외에는 손대지 않는다.
- 완료 후 Bash 마커: \`printf 'ocr2\\n' > ${LEGAL}/_dashboard/fix3/ocrverify_${law}.done\`.

## 반환(JSON): law, status, matched, corrected, unverifiable, pages_promoted, note.`
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
let laws = cfg.laws || []
log(`OCR 2차재검증 대상 ${laws.length}법 (Opus)`)
phase('OCR재검증')
const res = (await parallel(laws.map(law => () =>
  agent(prompt(law), { label: `ocrverify:${law.slice(0, 12)}`, phase: 'OCR재검증', model: 'opus', effort: 'medium', schema: SCHEMA })
))).filter(Boolean)

return {
  laws: res.length,
  matched: res.reduce((s, r) => s + (r.matched || 0), 0),
  corrected: res.reduce((s, r) => s + (r.corrected || 0), 0),
  unverifiable: res.reduce((s, r) => s + (r.unverifiable || 0), 0),
  pages_promoted: res.reduce((s, r) => s + (r.pages_promoted || 0), 0),
  per_law: res.map(r => ({ law: r.law, matched: r.matched || 0, corrected: r.corrected || 0, unverifiable: r.unverifiable || 0 })),
}
