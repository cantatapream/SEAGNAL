/**
 * ============================================================================
 * 파일명: local_server/services/official_ports.js
 * 역할  : 해양수산부 공식 항(config/coastal_safety/official_ports.json — scripts/build_official_ports.js 가 만든 정리 파일)을 읽어
 *         해역 이름 기준점으로 쓸 항 목록을 준다. 「○○항 서방 0.5해리 해역」의 ○○항이 여기서 나온다.
 *         사용자 2026-10-19: *"항구로 확인하면 그 항구가 기준점이 되어 00항으로부터 몇도 몇마일 해상 이런 부분도 해결할 수 있지 않니"* ·
 *         선택 기준점 순서 「항구 우선」 · 항구 종류 「마을공동어항만 제외 (추천)」.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/official_ports.json
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : services/station_briefing_inputs.js(gather — 해역 카드 이름 input.ports) · services/marine_fusion.js(cellName — 위험예측 해상 시트 제목·관할 관심 해역·「지금 밀집」)
 *                    → 둘 다 services/station_briefing_rules.js regionName(region, places, ports) 에 넘긴다(같은 칸 같은 이름)
 * [로드 순서] 서버 require 부작용 없음. 첫 물음 때 파일을 한 번 읽는다. 파일이 없거나 깨지면 빈 목록(항구 기준점 없이 종전 규칙)과 오류 한 줄.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'config', 'coastal_safety', 'official_ports.json');
// 이름 기준점으로 쓰는 종류(2026-10-19 사용자 「마을공동어항만 제외 (추천)」)
const NAMING_KINDS = new Set(['무역항', '연안항', '국가어항', '지방어항', '어촌정주어항']);
let cached = null;
/**
 * 이름 기준점 항 목록(한 번만 읽는다).
 * 예: forNaming() → [{name:'한림항', kind:'연안항', lat:33.42046, lon:126.25364}, …](마을공동어항 없음)
 * @returns {{name:string,kind:string,lat:number,lon:number}[]} [연계] ← station_briefing_inputs.gather · marine_fusion.cellName
 */
function forNaming() {
    if (cached) return cached;
    try { cached = JSON.parse(fs.readFileSync(FILE, 'utf8')).ports.filter((p) => NAMING_KINDS.has(p.kind) && Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => ({ name: p.name, kind: p.kind, lat: p.lat, lon: p.lon })); }
    catch (e) { console.error('[official_ports] 공식 항 목록을 읽지 못해 항구 기준점 없이 해역 이름을 짓습니다: ' + (e.code || e.name)); cached = []; }
    return cached;
}
module.exports = { forNaming, NAMING_KINDS, FILE };
