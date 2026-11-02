/**
 * ============================================================================
 * 파일명: local_server/services/harbor_cells.js
 * 역할  : 「항구 칸」 고정 목록(config/coastal_safety/harbor_cells.json — 항·포구·방파제 안이라 정박·계류 배가 늘 세어지는
 *         GR4 해상 교통 칸)을 읽어, 칸 번호가 목록에 있는지 알려 준다. 혼잡 판정에서 이 칸을 빼는 쪽이 이 함수를 묻는다.
 *         사용자 2026-10-19 원문: *"항구에서 잡히는 것은 사실 통항이라고 보기는 어렵고 상시 그 배가 그 위치에 정박해서 계류하고 있는
 *         상태를 의미하는 거라서 이것이 그 21척이 몰려서 밀집되어 있다라고 혼잡하다고 볼 수는 없을 것 같거든."*
 *         선택: 빼는 범위 「예보 혼잡까지 전부」 · 지도 「회색+숫자 유지」 · 관할 합계 「합계에서 뺌」 · 목록 「자동판정후 애매한곳은1번으로」.
 * ----------------------------------------------------------------------------
 * [연계]
 *  - 사용하는 파일 : config/coastal_safety/harbor_cells.json(scripts/gen_harbor_cells.js 가 만든다 — 강·중 등급만)
 *  - 서버 API      : 없음
 *  - 나를 쓰는 곳  : services/marine_fusion.js(createStore 기본 harbor — 지금 척수·혼잡 예보의 충돌·접촉 주의·관심 단계·관할 합계·지도 회색 표시)
 *                    · services/station_briefing_inputs.js(collectSea — 해역별 혼잡 예보에서 항구 칸 제외)
 * [로드 순서] 서버 require 부작용 없음. 첫 물음 때 목록 파일을 한 번 읽는다. 파일이 없거나 깨졌으면 빈 목록(아무 칸도 빼지 않음)과 오류 한 줄.
 * ============================================================================
 */
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, '..', 'config', 'coastal_safety', 'harbor_cells.json');

/**
 * 목록 하나로 묻기 함수 묶음을 만든다(시험은 가짜 목록을 넣는다).
 * 예: create([{id:'GR4_F4K32_F3',grade:'강',hazards:['한림항']}]).of('GR4_F4K32_F3') → {id,grade:'강',…} · of('GR4_X') → null
 * @param {object[]} cells - [{id, grade, …}] @returns {{of:function, has:function, size:number}}
 * [연계] ← forDefault·scripts/test_harbor_cells.js / marine_fusion·station_briefing_inputs 가 of·has 를 부른다
 */
function create(cells) {
    const byId = new Map((Array.isArray(cells) ? cells : []).filter((c) => c && typeof c.id === 'string').map((c) => [c.id, c]));
    return { of: (id) => byId.get(id) || null, has: (id) => byId.has(id), size: byId.size };
}
let def = null;
/**
 * 저장소 목록 파일로 만든 기본 묶음(한 번만 읽는다).
 * 예: forDefault().has('GR4_F4K32_F3') → true(한림항) · forDefault().has('GR4_F2O32_J1') → false(보령 앞바다 — 진짜 일시 혼잡)
 * @returns {{of:function, has:function, size:number}} [연계] ← marine_fusion.createStore·station_briefing_inputs.collectSea 기본값
 */
function forDefault() {
    if (def) return def;
    try { def = create(JSON.parse(fs.readFileSync(FILE, 'utf8')).cells); }
    catch (e) { console.error('[harbor_cells] 목록을 읽지 못해 항구 칸을 빼지 않습니다: ' + (e.code || e.name)); def = create([]); }
    return def;
}
module.exports = { create, forDefault, FILE };
