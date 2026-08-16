'use strict';
// 임시 실험 스크립트 — 답변 "과잉생성"(질문한 것만이 아니라 근거자료의 다른 절까지 답하는 문제)을
// 막는 방법을 프롬프트 변형 4종으로 비교한다. 프로덕션 코드를 전혀 안 건드리고, 실제 위키 페이지
// 3개(각 20개 이상 절이 있어 과잉생성 위험이 큰 페이지)에서 뽑은 실제 질문 6개로 Gemini를 직접
// 호출해 답변을 모은다. 결과 확인 후 이 스크립트는 삭제할 것(실험용, 앱 런타임에 포함 안 됨).
const fs = require('fs');
const path = require('path');
const { GoogleGenAI } = require('@google/genai');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal', 'wiki');
const MODEL = 'gemini-2.5-flash';
const CONFIG = { temperature: 0.3, thinkingConfig: { thinkingBudget: -1 } };

function readBody(relPath) {
  const raw = fs.readFileSync(path.join(LEGAL_DIR, relPath), 'utf8');
  const m = raw.match(/^---\n[\s\S]*?\n---\n?([\s\S]*)$/);
  return m ? m[1] : raw;
}

const PAGES = {
  형사절차: readBody('comparisons/형사절차_일반.md'),
  선박검사: readBody('concepts/선박안전법__선박검사.md'),
  벌칙과태료: readBody('concepts/수산업법__벌칙및과태료체계총괄.md'),
};

const QUESTIONS = [
  { id: 'Q1', page: '형사절차', q: '벌금형을 선고유예 받으면 전과기록에 남나요?' },
  { id: 'Q2', page: '형사절차', q: '회사 소속 선장이 어업법을 위반했는데, 회사도 처벌받나요?' },
  { id: 'Q3', page: '선박검사', q: '선박을 개조했는데 임시검사 받아야 하나요?' },
  { id: 'Q4', page: '선박검사', q: '선박검사증서를 분실했는데 어떻게 재발급받나요?' },
  { id: 'Q5', page: '벌칙과태료', q: '어구관리기록부를 작성하지 않았는데 과태료가 얼마나 나오나요?' },
  { id: 'Q6', page: '벌칙과태료', q: '무허가로 조업하다 걸리면 배도 몰수되나요?' },
];

const RULES_A = `[답변 원칙 — 반드시 지킬 것]
1. 답의 근거는 오직 [근거자료]뿐이다. [근거자료]에 없는 내용은 지어내지 말고 "확인되지 않습니다"라고 정직하게 말한다.
2. 처벌(징역·벌금·과태료)은 조·항·호·금액을 [근거자료] 그대로 인용한다. 뭉개어 말하지 않는다. 처벌이 위반 횟수(1차/2차/3차…)에 따라 달라지면 가장 흔한 경우(통상 1차)만 먼저 답하고 "2차 이후도 궁금하시면 다시 물어보세요"로 마무리한다(한 번에 전부 나열하지 않는다).
3. 여기서는 사용자에게 되묻지 않는다 — 되물어야 하는 질문은 이 답변 앞 단계(되묻기 판단)에서 이미 걸러진다. 조건(선박 톤수·어업 종류·조업구역 등)이 질문에 없어도 되묻지 말고 [근거자료]에 있는 정보로 최선을 다해 답하되, 조건에 따라 갈리면 핵심 갈래만 짧게 구분해 밝힌다(모든 경우를 장황하게 전수 나열하지 않는다).
4. 판례·법리 해석·다툼의 여지가 있는 논점은 답하지 않는다(스코프 밖). 명확한 조문까지만 안내하고 "이 부분은 개별 사안에 따라 달라져 관할 소관부서에 확인하시는 것이 정확합니다"로 마무리한다.
5. 딱딱한 조문 나열 금지. 결론 먼저 → 필요한 근거. 본문 첫 문장을 "쉽게 말하면 ~"으로 열어 결론을 일상어로 짧게 요약한 뒤, 조문·처벌 같은 정확한 근거를 그다음에 이어 붙인다 — 이 쉬운 요약을 답변 맨 끝에 마무리 말로 붙이지 않는다. 과잉 설명은 하지 않는다.
6. 근거로 삼은 법령명·조문번호는 답변 문장 안에서 자연스럽게 밝힌다. 소관부서·연락처·기준일 각주는 붙이지 않는다.
7. 표·이모지는 쓰지 않는다. 강조는 굵게만 사용. 갈래·조건별 설명은 "1. → 가. → 1)" 순서로 위계를 드러낸다.
8. 처벌·의무의 대상이 여러 주체로 나뉘어 있으면 해당하는 관련 주체를 전부 빠짐없이 언급한다.`;

const RULES_B = `[답변 원칙 — 반드시 지킬 것]
1. ★질문한 것만 답한다. 사용자가 구체적으로 하나의 조건·위반유형·절차를 물었으면, [근거자료]에 다른 조건·다른 위반유형·다른 절차·다른 검사종류·다른 처벌조문이 나란히 있어도 언급하지 않는다. "참고로 알려드리면"·"추가로"처럼 요청받지 않은 정보를 덧붙이지 않는다.
2. 답의 근거는 오직 [근거자료]뿐이다. [근거자료]에 없는 내용은 지어내지 말고 "확인되지 않습니다"라고 정직하게 말한다.
3. 처벌(징역·벌금·과태료)은 조·항·호·금액을 [근거자료] 그대로 인용한다. 뭉개어 말하지 않는다. 처벌이 위반 횟수(1차/2차/3차…)에 따라 달라지면 가장 흔한 경우(통상 1차)만 먼저 답하고 "2차 이후도 궁금하시면 다시 물어보세요"로 마무리한다.
4. 사용자에게 되묻지 않는다 — [근거자료]에 있는 정보로 최선을 다해 답한다.
5. 판례·법리 해석·다툼의 여지가 있는 논점은 답하지 않는다(스코프 밖). "이 부분은 개별 사안에 따라 달라져 관할 소관부서에 확인하시는 것이 정확합니다"로 마무리한다.
6. 딱딱한 조문 나열 금지. 결론 먼저 → 필요한 근거. 본문 첫 문장을 "쉽게 말하면 ~"으로 열어 결론을 일상어로 짧게 요약한다.
7. 근거로 삼은 법령명·조문번호는 답변 문장 안에서 자연스럽게 밝힌다.
8. 표·이모지는 쓰지 않는다. 강조는 굵게만 사용.
9. 처벌·의무의 대상이 여러 주체로 나뉘어 있으면 해당하는 관련 주체를 전부 빠짐없이 언급한다(단, 이것도 질문 범위 안에서만).`;

const RULES_C = RULES_A + `
9. ★범위 이탈 방지(예시로 확인):
   [나쁜 예] 질문 "임시검사는 언제 받아야 하나요?" → 답 "임시검사는 개조·수리 시 받습니다. 참고로 정기검사는 정해진 주기마다, 중간검사는 그 사이에, 수수료는 검사종류별로 다르며..." — 틀림. 안 물어본 정기검사·중간검사·수수료까지 나열했다.
   [좋은 예] 같은 질문 → 답 "임시검사는 [근거자료]에 열거된 사유(예: 선체 개조·수리 등)가 있을 때만 받습니다. (해당 사유만 설명)" — 맞음. 물어본 임시검사만 답했다.
   질문에 나오지 않은 다른 검사종류·다른 조문·다른 위반유형·다른 절차는 [근거자료]에 있어도 언급하지 않는다.`;

const CRITIC_PROMPT = (question, draft) => `너는 법률 챗봇 답변의 "범위 이탈"만 전문으로 검토하는 검수자다. 아래는 사용자 질문과 그에 대한 초안 답변이다.

[질문]
"${question}"

[초안 답변]
${draft}

이 초안이 사용자가 실제로 물은 것 외에 다른 조건·다른 위반유형·다른 절차·다른 검사종류·다른 처벌조문까지 언급하고 있는지 확인해라. 있다면 그 벗어난 부분만 제거하고, 질문에 맞는 부분만 남겨 다시 써라(문체·형식은 그대로 유지). 벗어난 부분이 없으면 초안을 토씨 하나 안 바꾸고 그대로 반환해라. 다른 설명 없이 최종 답변 텍스트만 출력해라.`;

async function callGemini(ai, systemPrompt, userText) {
  const contents = `${systemPrompt}\n\n[근거자료]\n${userText}\n\n답:`;
  const res = await ai.models.generateContent({ model: MODEL, contents, config: CONFIG });
  return (res.text || '').trim();
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('GEMINI_API_KEY not set'); process.exit(1); }
  const ai = new GoogleGenAI({ apiKey });
  const results = [];

  for (const { id, page, q } of QUESTIONS) {
    console.log(`\n===== ${id}: ${q} =====`);

    const answerA = await callGemini(ai, `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 검증 절차를 거친 법령 위키에서 그대로 발췌한 원문이다.\n\n${RULES_A}`, `${PAGES[page]}\n\n질문: "${q}"`);
    console.log(`--- A(기준) ---\n${answerA}`);

    const answerB = await callGemini(ai, `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 검증 절차를 거친 법령 위키에서 그대로 발췌한 원문이다.\n\n${RULES_B}`, `${PAGES[page]}\n\n질문: "${q}"`);
    console.log(`--- B(재배치) ---\n${answerB}`);

    const answerC = await callGemini(ai, `너는 "나리야" — 대한민국 해양수산 법령을 안내하는 AI 챗봇이다. 아래 [근거자료]는 검증 절차를 거친 법령 위키에서 그대로 발췌한 원문이다.\n\n${RULES_C}`, `${PAGES[page]}\n\n질문: "${q}"`);
    console.log(`--- C(반례예시) ---\n${answerC}`);

    const answerD_draft = answerA; // D는 A를 초안으로 재사용(같은 조건에서 후처리 효과만 보기 위해)
    const answerD = await callGemini(ai, '너는 텍스트 편집기다. 아래 지시를 정확히 따른다.', CRITIC_PROMPT(q, answerD_draft));
    console.log(`--- D(기준+후처리) ---\n${answerD}`);

    results.push({ id, page, q, answerA, answerB, answerC, answerD_draft, answerD });
  }

  fs.writeFileSync(path.join(__dirname, 'scratch_ab_results.json'), JSON.stringify(results, null, 2));
  console.log('\n\n=== DONE, wrote scratch_ab_results.json ===');
}

main().catch(e => { console.error(e); process.exit(1); });
