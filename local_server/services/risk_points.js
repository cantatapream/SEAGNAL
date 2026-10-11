/**
 * 파일명: local_server/services/risk_points.js
 * 역할  : 위험예측의 점수·배수 표를 한 곳에 두고 화면 지수와 단계를 환산한다.
 * [연계] risk_score.js가 사용 · API/마크업 없음 · [로드 순서] risk_score 이전
 */
'use strict';
// 출처: accident_analysis/v3/points_v31.md, fcst_leads.md ②, 공개판 해상 5.1·5.2.
const MONTHS = [
  [-.78,.58,.93],[-.42,.75,.79],[-.12,.92,1.12],[-.18,.88,.62],
  [.16,1.12,1.35],[.29,1.22,1.09],[.46,1.38,1.39],[.66,1.58,1.66],
  [.56,1.47,1.45],[.02,1.01,1.02],[-.12,.92,.62],[-.54,.69,.61]
].map(([score,rr,fatalRr]) => Object.freeze({score,rr,fatalRr}));
const HAZARDS = [[0,1,1],[.70,1.62,1.18],[1.24,2.36,2.12],[1.74,3.34,2.25]]
  .map(([score,rr,fatalRr]) => Object.freeze({score,rr,fatalRr}));
const SEA = {
  warn_adv:{score:.75,rr:1.68,collisionRr:.40},
  warn_wrn:{score:2.16,rr:4.46,collisionRr:.70},
  wave4m:{score:3.86,rr:14.55,collisionRr:.89},
  wind14:{score:2.09,rr:4.27,collisionRr:.41},
  wind17:{score:3.39,rr:10.46,collisionRr:null}
};
const FORECAST = [
  [[1.59,.62],[2.29,.54],[4.34,.55]],
  [[1.63,.59],[2.14,.55],[3.39,.41]]
].map(day => day.map(([rr,collisionRr]) => Object.freeze({score:Math.log2(rr),rr,collisionRr})));
const COAST = Object.freeze({crowdScore:.97,crowdRr:1.96,crowdFatalRr:1.54,
  fatalScore:.37,fatalRr:1.29,fatalFatalRr:1.30,eventScore:1.09,eventRr:2.14,
  policyScore:.3,swellAnalysisRr:1.25});
/** 0~3점을 0~100으로 환산한다. 예: .75→25。
 * @param {number} score - 합계 점수 @returns {number} 지수
 * [연계] ← risk_score.js / 점수를 화면 값으로 환산한다.
 */
function scoreToIndex(score) { return Math.round(Math.min(3,Math.max(0,Number(score)||0))/3*100); }
/** 화면 정수 지수의 단계 말을 고른다. 예: 20→다소 높음.
 * @param {number} index - 화면 지수 @returns {string} 단계
 * [연계] ← risk_score.js / U77의 반올림 경계를 적용한다.
 */
function scoreBand(index) { return index<20?'평소 수준':index<67?'다소 높음':index<100?'높음':'매우 높음'; }
module.exports={MONTHS:Object.freeze(MONTHS),HAZARDS:Object.freeze(HAZARDS),SEA:Object.freeze(SEA),FORECAST:Object.freeze(FORECAST),COAST,scoreToIndex,scoreBand};
