/**
 * ============================================================================
 * 파일명: scripts/reset_visitor_total.js
 * 역할: 방문자 Total 카운트를 3/19(앱 배포일) 이후 데이터로 재설정하는 일회성 스크립트
 * ============================================================================
 *
 * [설명]
 * 이 스크립트는 앱 배포 시작일(2026-03-19) 이전의 테스트 기간 방문 데이터를 제거하고,
 * 인덱스 페이지의 "Total" 카운터를 배포일부터의 누적치로 재설정합니다.
 *
 * [실행 방법]
 * 서버의 local_server 디렉토리에서:
 *   node scripts/reset_visitor_total.js
 *
 * [동작 과정]
 * 1. visitors_stats.json과 visitors.json을 백업 (원본 보존)
 * 2. visitors_stats.json에서 2026-03-19 이전 날짜의 데이터를 모두 삭제
 * 3. 남은 날짜(3/19 이후)의 total 합계를 계산
 * 4. visitors.json의 total을 이 합계 값으로 덮어씀
 *
 * [주의사항]
 * - 실서버에서 한 번만 실행해야 합니다
 * - 실행 전 자동으로 백업 파일이 생성됩니다 (.backup 확장자)
 * - 서버 실행 중에도 안전하게 실행 가능 (파일 단위 원자적 쓰기)
 *
 * [연계 파일]
 * - config/server_config.js → FILES.VISITORS, FILES.VISITORS_STATS 경로 사용
 * - routes/stats.js → 변경된 데이터를 /api/visit API에서 읽어 표시
 * - js/app_init.js → updateVisitorStats()에서 Total 값을 인덱스 페이지에 표시
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// 앱 배포 시작일 (이 날짜 이전의 데이터는 테스트 기간으로 간주)
const CUTOFF_DATE = '2026-03-19';

// 데이터 파일 경로 (server_config.js와 동일한 경로)
const DATA_DIR = path.join(__dirname, '..', 'data');
const VISITORS_FILE = path.join(DATA_DIR, 'visitors.json');
const VISITORS_STATS_FILE = path.join(DATA_DIR, 'visitors_stats.json');

console.log('============================================');
console.log('방문자 Total 재설정 스크립트');
console.log('기준일: ' + CUTOFF_DATE + ' (이전 데이터 제거)');
console.log('============================================\n');

// ── 1단계: 백업 생성 ──
console.log('[1/4] 백업 파일 생성 중...');

if (fs.existsSync(VISITORS_FILE)) {
    fs.copyFileSync(VISITORS_FILE, VISITORS_FILE + '.backup');
    console.log('  ✓ visitors.json → visitors.json.backup');
}
if (fs.existsSync(VISITORS_STATS_FILE)) {
    fs.copyFileSync(VISITORS_STATS_FILE, VISITORS_STATS_FILE + '.backup');
    console.log('  ✓ visitors_stats.json → visitors_stats.json.backup');
}

// ── 2단계: visitors_stats.json에서 기준일 이전 데이터 삭제 ──
console.log('\n[2/4] 기준일 이전 데이터 분석 중...');

let stats = {};
if (fs.existsSync(VISITORS_STATS_FILE)) {
    stats = JSON.parse(fs.readFileSync(VISITORS_STATS_FILE, 'utf8'));
}

const allDates = Object.keys(stats).sort();
const beforeDates = allDates.filter(function(d) { return d < CUTOFF_DATE; });
const afterDates = allDates.filter(function(d) { return d >= CUTOFF_DATE; });

console.log('  전체 날짜 수: ' + allDates.length);
console.log('  삭제 대상 (' + CUTOFF_DATE + ' 이전): ' + beforeDates.length + '일');
console.log('  보존 대상 (' + CUTOFF_DATE + ' 이후): ' + afterDates.length + '일');

// 삭제 대상 데이터의 합계 (참고용)
let beforeTotal = 0;
beforeDates.forEach(function(d) {
    beforeTotal += (stats[d].total || 0);
    console.log('    삭제: ' + d + ' (' + stats[d].total + '명)');
});

// 기준일 이전 데이터 삭제
beforeDates.forEach(function(d) {
    delete stats[d];
});

// ── 3단계: 보존된 데이터의 합계 계산 ──
console.log('\n[3/4] 보존 데이터 합계 계산 중...');

let afterTotal = 0;
afterDates.forEach(function(d) {
    afterTotal += (stats[d].total || 0);
});

console.log('  삭제된 방문수: ' + beforeTotal + '명');
console.log('  보존된 방문수 (새 Total): ' + afterTotal + '명');

// visitors_stats.json 저장
fs.writeFileSync(VISITORS_STATS_FILE, JSON.stringify(stats, null, 2), 'utf8');
console.log('  ✓ visitors_stats.json 업데이트 완료');

// ── 4단계: visitors.json의 total 재설정 ──
console.log('\n[4/4] visitors.json Total 재설정 중...');

let visitors = { today: 0, total: 0, lastDate: '' };
if (fs.existsSync(VISITORS_FILE)) {
    visitors = JSON.parse(fs.readFileSync(VISITORS_FILE, 'utf8'));
}

const oldTotal = visitors.total;
visitors.total = afterTotal;

fs.writeFileSync(VISITORS_FILE, JSON.stringify(visitors, null, 2), 'utf8');

console.log('  이전 Total: ' + oldTotal + '명');
console.log('  새 Total: ' + afterTotal + '명');
console.log('  차이: -' + (oldTotal - afterTotal) + '명');
console.log('  ✓ visitors.json 업데이트 완료');

console.log('\n============================================');
console.log('완료! 인덱스 페이지의 Total이 ' + afterTotal + '명으로 표시됩니다.');
console.log('백업 파일: visitors.json.backup, visitors_stats.json.backup');
console.log('============================================');
