export const meta = {
  name: 'wiki-stub-rules-fulltext',
  description: '본문이 첨부파일(HWP/PDF)에만 있어 raw에 "첨부파일을 이용하십시오" 3줄 스텁으로만 남은 안전 핵심 행정규칙(어선구조기준·선박구조기준 등 설비·구조 규칙)을 DRF 첨부 다운로드→전사로 전문 확보. 완료 시 마커.',
  phases: [{ title: '스텁전문화', detail: '규칙당 1에이전트: 첨부 다운로드 + PDF/이미지 전사 + 스텁 교체' }],
}
const LEGAL = '/home/user/SEAGNAL/local_server/knowledge/legal'
const MARK = `${LEGAL}/_dashboard/fix3`

// 첨부파일 포인터 스텁(3줄) — 실제 내용은 다운로드 필요. 안전 핵심 설비·구조 기준 우선.
const STUBS = [
  { name: '어선구조기준', id: '2100000015109', file: `${LEGAL}/raw/04_선박해운/어선법/행정규칙/어선구조기준.txt`, law: '어선법', pri: 1 },
  { name: '어선복원성및만재흘수선기준', id: '2100000015110', file: `${LEGAL}/raw/04_선박해운/어선법/행정규칙/어선복원성및만재흘수선기준.txt`, law: '어선법', pri: 1 },
  { name: '강선의구조기준', id: '2100000099831', file: `${LEGAL}/raw/04_선박해운/선박안전법/행정규칙/강선의구조기준.txt`, law: '선박안전법', pri: 1 },
  { name: '알루미늄선의구조기준', id: '2100000025060', file: `${LEGAL}/raw/04_선박해운/선박안전법/행정규칙/알루미늄선의구조기준.txt`, law: '선박안전법', pri: 1 },
  { name: '물환경측정망운영계획', id: '2100000083714', file: `${LEGAL}/raw/15_관련타부처/물환경보전법/행정규칙/물환경측정망운영계획.txt`, law: '물환경보전법(타법)', pri: 2 },
  { name: '수계영향권별환경관리지역지정고시', id: '2100000111710', file: `${LEGAL}/raw/15_관련타부처/물환경보전법/행정규칙/수계영향권별환경관리지역지정고시.txt`, law: '물환경보전법(타법)', pri: 2 },
]

const SCHEMA = {
  type: 'object', required: ['name', 'result'],
  properties: {
    name: { type: 'string' }, result: { type: 'string' }, // fulltext | partial | failed | still_stub
    bytes_before: { type: 'integer' }, bytes_after: { type: 'integer' },
    method: { type: 'string' }, note: { type: 'string' }, marker: { type: 'boolean' },
  },
}

let cfg = (typeof args === 'string' ? JSON.parse(args) : args) || {}
const stubs = cfg.only ? STUBS.filter(s => cfg.only.includes(s.name)) : (cfg.pri1Only ? STUBS.filter(s => s.pri === 1) : STUBS)

log(`스텁 전문화: ${stubs.length}개 규칙`)
phase('스텁전문화')

const results = await parallel(stubs.map(s => () =>
  agent(
    `너는 SEAGNAL 해양법률 위키 사서다. 안전 핵심 행정규칙 「${s.name}」(소관법 ${s.law})의 **전문**을 확보한다. 현재 raw 파일 \`${s.file}\`은 "첨부파일을 이용하십시오"라는 **3줄 스텁**이라 실제 구조·설비 기준 내용이 비어 있다. 첨부파일을 받아 전사해 전문으로 교체한다.

## 수집 절차 (law.go.kr DRF, OC=hyoo1431, 행정규칙 admrul ID=${s.id})
1. 먼저 본문·첨부 메타를 조회: \`curl 'https://www.law.go.kr/DRF/admRulService.do?OC=hyoo1431&target=admrul&ID=${s.id}&type=JSON'\` (또는 LID=${s.id}). 응답에서 조문 본문이 실제로 있으면 그대로 전사. **첨부파일(HWP/PDF) 링크·flSeq가 있으면** 그것을 받는다.
2. 첨부 목록/별표 트리: \`curl 'https://www.law.go.kr/DRF/admRulByl.do?OC=hyoo1431&target=admrul&ID=${s.id}&type=JSON'\` 또는 \`admRulBylInfoR.do\`/\`admRulJoListTreeRInc.do?admRulSeq=${s.id}&section=By\` 로 bylSeq를 찾고, \`admRulBylContentsInfoR.do?bylSeq=<bylSeq>\` 응답의 \`flDownload.do?flSeq=<id>\` 다운로드 URL을 얻는다.
3. 파일 다운로드: \`curl -L -o /tmp/${s.name}.bin 'https://www.law.go.kr/DRF/flDownload.do?flSeq=<flSeq>'\`. 파일 종류 확인(\`file /tmp/${s.name}.bin\`).
   - **PDF면**: Read 도구로 그 PDF를 직접 읽어(pages 지정) 조문·표·수치를 정확히 전사.
   - **이미지(JPG/PNG/TIFF)면**: Read로 열어 **너의 비전으로 OCR** 전사(수치·표·별표 정확히).
   - **HWP면**: 바이너리라 직접 읽기 어렵다 — DRF의 HTML/텍스트 대체 엔드포인트를 시도하거나(예 type=HTML), 안 되면 result="failed"(note="HWP 첨부, 텍스트 추출 불가")로 정직 표기.
4. 전사한 전문으로 \`${s.file}\`을 교체 저장. **맨 위 헤더는 유지·갱신**: \`[고시/행정규칙] ${s.name}\` + \`ID:${s.id}\` + \`⚠REVIEW / 출처: 국가법령정보센터 행정규칙 첨부 전사 / 시행일\` + \`소관부서:\`(DRF 응답의 소관부처). 원문 수치·표 불변. 문서가 매우 길면 조문 구조(편·장·절·조)와 **모든 표·수치·별표**를 빠짐없이 담되, 순수 반복 서식은 요약하지 말고 그대로.

## 규율
- 🚫 **.claude/ 폴더 절대 금지**. 결과는 JSON 반환값으로만.
- **환각 0**: 실제 받은 첨부 내용만 전사. 못 받으면 지어내지 말고 result="failed"/"still_stub"(note에 사유).
- **외과수술식**: \`${s.file}\` 하나만 교체. 다른 파일 금지(위키 반영은 각 법 collect 셀 몫).
- 스텁보다 조금이라도 늘었으면 bytes_after에 실제 크기 기록. 전문 확보면 result="fulltext", 일부만이면 "partial".

반환(JSON): name("${s.name}"), result, bytes_before, bytes_after, method(pdf_read|vision_ocr|drf_html|failed), note, marker(false).`,
    { label: `stub:${s.name.slice(0, 10)}`, phase: '스텁전문화', model: 'sonnet', effort: 'high', schema: SCHEMA })
))

const ok = results.filter(Boolean)
await agent(
  `Bash로 \`mkdir -p ${MARK} && printf '%s\\n' "stub_rules done $(date -u +%FT%TZ) — ${ok.filter(r => r.result === 'fulltext').length}/${stubs.length} 전문화" > "${MARK}/_stub_rules.done"\`. {marker:true} 반환.`,
  { label: 'mark:stub', phase: '스텁전문화', model: 'sonnet', effort: 'low',
    schema: { type: 'object', required: ['marker'], properties: { marker: { type: 'boolean' } } } })

log(`스텁 전문화 완료: ${ok.filter(r => r.result === 'fulltext').length}/${stubs.length}`)
return { status: 'done', results: ok }
