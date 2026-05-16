#!/usr/bin/env node
/**
 * ============================================================================
 * 파일명: scripts/bump_cache_version.js
 * 역할 : sw.js 의 캐시 버전 플레이스홀더를 빌드 시점 값으로 치환
 * ============================================================================
 *
 * [목적]
 * 서비스 워커(sw.js) 의 CACHE_VERSION 상수가 매 배포마다 새 값이 되도록
 * 자동화. 이 값이 바뀌면 사용자 브라우저는 옛 캐시를 자동으로 삭제하고
 * 새 캐시를 시작 → 옛 자원이 stale 로 남는 문제 원천 차단.
 *
 * [동작]
 *   1. local_server/sw.js 를 읽음
 *   2. 안의 '__CACHE_VERSION__' 플레이스홀더를 빌드 시점 타임스탬프로 치환
 *      (형식: YYYYMMDD-HHmmss UTC)
 *   3. 같은 파일에 덮어쓰기
 *
 * [사용 시점]
 *   - Dockerfile 빌드 단계에서 npm install 후, COPY . . 다음에 실행
 *   - 로컬 개발에선 실행 안 함 (sw.js 가 placeholder 그대로지만 동작은 함,
 *     단지 버전 관리 효과 없음)
 *
 * [멱등성]
 *   이미 치환된 sw.js 에 다시 실행하면 placeholder 가 없어 아무 일도 안 함.
 *   따라서 여러 번 실행해도 안전.
 *
 * [실행 방법]
 *   node local_server/scripts/bump_cache_version.js
 *
 * [Dockerfile 통합]
 *   COPY . .
 *   RUN node local_server/scripts/bump_cache_version.js   ← 이 줄 추가
 *   CMD [ "npm", "start" ]
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

// 치환 대상 파일
const SW_PATH = path.join(__dirname, '..', 'sw.js');

// 치환 대상 토큰 (sw.js 에서 const CACHE_VERSION = '__CACHE_VERSION__' 형태)
const PLACEHOLDER = '__CACHE_VERSION__';

/**
 * 현재 UTC 시각을 YYYYMMDD-HHmmss 형식으로 반환.
 * 예: "20260516-013045"
 *
 * 사람이 읽을 수 있고, 정렬 가능하며, 충돌 가능성 낮음 (초 단위).
 * 같은 초 안에 여러 번 빌드되는 일은 정상 운영에선 거의 없음.
 */
function buildVersionString() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return [
        d.getUTCFullYear(),
        pad(d.getUTCMonth() + 1),
        pad(d.getUTCDate())
    ].join('') + '-' + [
        pad(d.getUTCHours()),
        pad(d.getUTCMinutes()),
        pad(d.getUTCSeconds())
    ].join('');
}

function main() {
    // 1) sw.js 존재 여부 검증
    if (!fs.existsSync(SW_PATH)) {
        console.error(`[bump_cache_version] ❌ ${SW_PATH} 파일이 없음. 작업 중단.`);
        process.exit(1);
    }

    const original = fs.readFileSync(SW_PATH, 'utf8');

    // 2) 플레이스홀더 존재 여부 검증 (멱등성)
    if (!original.includes(PLACEHOLDER)) {
        console.log(`[bump_cache_version] ℹ ${PLACEHOLDER} 플레이스홀더 없음. 이미 치환되었거나 sw.js 형식 변경됨. 건너뜀.`);
        return;
    }

    // 3) 새 버전 문자열 생성 후 치환
    const newVersion = buildVersionString();
    const updated = original.split(PLACEHOLDER).join(newVersion);

    // 4) 저장
    fs.writeFileSync(SW_PATH, updated, 'utf8');

    console.log(`[bump_cache_version] ✅ CACHE_VERSION → '${newVersion}'`);
    console.log(`[bump_cache_version]    파일: ${SW_PATH}`);
}

main();
