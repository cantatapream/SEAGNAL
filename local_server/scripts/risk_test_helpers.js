/** 파일명: local_server/scripts/risk_test_helpers.js
 * 역할  : 위험예측 검사 결과를 기존 게이트의 PASS/FAIL 형식으로 출력한다.
 * [연계] test_risk_*.js · 운영 로드/API/마크업 없음
 */
'use strict';
const assert=require('assert');
/** 독립 검사 함수를 모아 실행한다. 예: 실패도 모두 출력 후 exit1.
 * @param {object} cases - 이름→검사 함수 @returns {void}
 * [연계] ← test_risk_*.js / 전체 실패를 빠뜨리지 않는다.
 */
module.exports=function run(cases){let pass=0,fail=0;for(const [name,fn]of Object.entries(cases)){try{fn(assert);pass++;console.log('✅',name);}catch(e){fail++;console.error('❌',name,e.message);}}console.log(`${pass} PASS / ${fail} FAIL`);if(fail)process.exitCode=1;};
