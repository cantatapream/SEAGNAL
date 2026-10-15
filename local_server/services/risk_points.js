/**
 * 파일명: local_server/services/risk_points.js
 * 역할  : 위험예측의 점수·배수 표를 한 곳에 두고 화면 지수와 단계를 환산한다.
 * [연계] risk_score.js가 사용 · API/마크업 없음 · [로드 순서] risk_score 이전
 *        (연안 달·위험구역 표는 2026-10-15 U81로 바꿈 — 근거 경로는 각 표 위 주석)
 */
'use strict';
// 출처: accident_analysis/v3/points_v31.md(해상), fcst_leads.md ②, 공개판 해상 5.1·5.2.
// 달(MONTHS) — 2026-10-15 다시 잼(설계서 U81④, 보고서 v3 §13.2): 사람 점수가 「이 관광지 30일 평균 대비 오늘」(상대값)이 되어
//   종전 표(외지인 방문자 절대값을 보정한 뒤 남은 몫, points_v31.md)에서 빠져 있던 계절 붐빔 몫을 달이 다시 담는다.
//   같은 틀(28_fatal_points.py 달 칸: 층 = 사고×그 해, 요일·공휴일 보정, 군집 = 사고 날짜, 기준 = 1년 평균 날)에
//   노출만 log2(그날 외지인 방문자 ÷ 그날부터 30일 기하평균)으로 바꿔 전체 사고·사망·실종 사고를 각각 잰 값(month_relative.csv 「M 주」).
//   [점수, 전체 사고 배수, 사망·실종 사고 배수] — 점수 = log2(배수)를 소수 둘째 자리로.
const MONTHS = [
  [-.95,.52,.86],[-.60,.66,.73],[-.22,.86,1.07],[-.14,.91,.63],
  [.19,1.14,1.38],[.30,1.23,1.10],[.71,1.63,1.54],[.74,1.67,1.74],
  [.73,1.66,1.55],[.07,1.05,1.06],[-.27,.83,.59],[-.60,.66,.57]
].map(([score,rr,fatalRr]) => Object.freeze({score,rr,fatalRr}));
// 위험구역(장소) — 후보 A(설계서 U81②, 보고서 v3 §13.3): 세 종류(연안사고 위험구역·사망사고 발생구역·연안사고 다발구역)를
//   같은 무게로, 종류마다 3km 안 개수를 3곳에서 멈추고 log 로 센다. 그 종류 몫 점수 = coef × log2(min(개수,3)+1), 세 종류를 더한다.
//   coef = 위험구역 종류별 재분석(2026-10-15) out/score_tables.csv 「candA」 1곳 값 0.43914371217365067
//        = log2(out/type_models.csv 「b3= 종류별 log2(min(개수,3)+1) 같은 무게」 2023~24 전체(주) RR 1.355799376249529).
//   fatalRrPerUnit = 같은 파일 같은 모형의 2023~24 사망·실종 결과 RR 1.3633303367286298(사망·실종 123건, 95% 1.12–1.67).
//   종전 「전체 개수 0/1~2/3~5/6+ 구간 + 사망사고 발생구역 가산 0.37」은 없앤다(사망구역은 자기 종류 줄로 들어감).
const HAZARD_TYPES = Object.freeze(['연안사고 위험구역','사망사고 발생구역','연안사고 다발구역']);
const HAZARD_PER_TYPE = Object.freeze({coef:0.43914371217365067,fatalRrPerUnit:1.3633303367286298,cap:3});
/** 한 종류의 3km 안 개수로 그 종류 몫 점수·배수를 만든다. 예: 1곳→.44점, 2곳→.70점, 3곳 이상→.88점.
 * @param {number} n - 그 종류 개수 @returns {{score:number,rr:number,fatalRr:number}}
 * [연계] ← risk_score.scoreCoast / 후보 A 표(score_tables.csv candA)를 계수 하나로 다시 만든다.
 */
function hazardType(n){const u=Math.log2(Math.min(Math.max(0,n|0),HAZARD_PER_TYPE.cap)+1),score=HAZARD_PER_TYPE.coef*u;return{score,rr:2**score,fatalRr:HAZARD_PER_TYPE.fatalRrPerUnit**u};}
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
// 사람 혼잡(U81①): 점수 = crowdScore × max(0, log2(오늘 집중률 ÷ 이 관광지 30일 기하평균)) — 연속값, 평균 이하면 0.
//   crowdScore·crowdRr·crowdFatalRr = 외지인 방문자 2배당(보고서 v3 §4.4·§12.2, 같은 장소·같은 달 비교) 그대로.
const COAST = Object.freeze({crowdScore:.97,crowdRr:1.96,crowdFatalRr:1.54,
  eventScore:1.09,eventRr:2.14,policyScore:.3,swellAnalysisRr:1.25});
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
module.exports={MONTHS:Object.freeze(MONTHS),HAZARD_TYPES,HAZARD_PER_TYPE,hazardType,SEA:Object.freeze(SEA),FORECAST:Object.freeze(FORECAST),COAST,scoreToIndex,scoreBand};
