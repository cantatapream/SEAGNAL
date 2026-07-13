/**
 * ============================================================================
 * 파일명: scripts/refactor/check_order.js
 * 역할  : [V3 로드 순서 무결성] index2.html 의 <script src> 파일명 나열 순서가
 *         기준선 스냅샷과 100% 동일한지 검사한다. (경로는 무시, 파일명만 비교
 *         — 폴더 이동은 허용하되 순서 변경은 잡아내기 위함)
 *         번들러 없이 전역 스코프에 순서대로 로드되는 이 앱에서
 *         로드 순서 변경 = 기능 파괴이므로 가장 중요한 검사.
 * 사용  : node scripts/refactor/check_order.js --snapshot   (기준선 기록)
 *         node scripts/refactor/check_order.js              (기준선과 비교)
 * [연계] baseline/order_snapshot.json (기준선 저장 위치)
 * ============================================================================
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const INDEX = path.join(ROOT, 'local_server', 'index2.html');
const SNAP = path.join(__dirname, 'baseline', 'order_snapshot.json');

function currentOrder() {
    const html = fs.readFileSync(INDEX, 'utf8');
    const order = [];
    const re = /<script[^>]*\ssrc="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
        const raw = m[1];
        if (/^(https?:)?\/\//.test(raw)) continue; // 외부 CDN 제외 (현재 없음)
        order.push(path.basename(raw.split('?')[0])); // 파일명만 (경로·쿼리 무시)
    }
    return order;
}

const order = currentOrder();

if (process.argv.includes('--snapshot')) {
    fs.mkdirSync(path.dirname(SNAP), { recursive: true });
    fs.writeFileSync(SNAP, JSON.stringify({ createdAt: null, order }, null, 2));
    console.log(`[check_order] 기준선 기록 완료 — script ${order.length}개 순서 저장`);
    process.exit(0);
}

if (!fs.existsSync(SNAP)) {
    console.error('[check_order] ❌ 기준선이 없습니다. 먼저 --snapshot 으로 기록하세요.');
    process.exit(1);
}
const base = JSON.parse(fs.readFileSync(SNAP, 'utf8')).order;

const max = Math.max(base.length, order.length);
const diffs = [];
for (let i = 0; i < max; i++) {
    if (base[i] !== order[i]) diffs.push(`#${i + 1}: 기준선="${base[i] || '(없음)'}" ↔ 현재="${order[i] || '(없음)'}"`);
}

console.log(`[check_order] 기준선 ${base.length}개 ↔ 현재 ${order.length}개`);
if (diffs.length) {
    console.error(`[check_order] ❌ 순서 불일치 ${diffs.length}곳:`);
    diffs.slice(0, 20).forEach((d) => console.error('  - ' + d));
    process.exit(1);
}
console.log('[check_order] ✅ 통과 — 로드 순서 100% 동일');
