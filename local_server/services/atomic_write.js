/**
 * ============================================================================
 * 파일명: services/atomic_write.js
 * 역할: JSON 등 중요 파일을 "원자적(atomic)"으로 저장 — 디스크 풀/크래시에도 손상 방지
 * ============================================================================
 *
 * [배경]
 *   기존엔 fs.writeFileSync(원본, data) 로 원본 파일에 직접 덮어썼다. 쓰는 도중
 *   디스크가 가득 차거나(ENOSPC) 프로세스가 죽으면 원본이 절반만 쓰여 잘리고
 *   손상된다(2026-06-24 surveys.json 유실 사고의 메커니즘).
 *
 * [동작]
 *   1) 같은 디렉토리의 임시 파일(원본+'.tmp')에 먼저 전부 기록.
 *   2) 성공적으로 다 쓰였을 때만 fs.renameSync(tmp→원본) 으로 한 번에 교체.
 *   rename 은 동일 파일시스템 내에서 원자적이라, 어느 순간에도 원본은
 *   "옛 완전본" 또는 "새 완전본" 둘 중 하나만 존재한다(반쪽 상태 없음).
 *   tmp 쓰기가 실패하면 throw 되고 rename 은 실행 안 되므로 원본은 그대로 보존된다.
 *
 * [주의] 동일 프로세스(Node 단일 스레드)에서 writeFileSync+renameSync 는 동기라
 *   같은 파일에 대한 두 호출이 서로 끼어들지 않는다(직렬화).
 * ============================================================================
 */

const fs = require('fs');

/**
 * 원본 파일에 원자적으로 기록(tmp→rename).
 * @param {string} filePath 최종 대상 경로
 * @param {string|Buffer} data 기록할 내용
 * @param {object|string} [options] fs.writeFileSync 옵션(예: 'utf8')
 */
function writeFileAtomic(filePath, data, options) {
    const tmp = filePath + '.tmp';
    fs.writeFileSync(tmp, data, options);
    try {
        fs.renameSync(tmp, filePath);
    } catch (e) {
        // rename 실패(드묾) 시 고아 tmp 정리 후 예외 전파(원본은 그대로 보존됨).
        try { fs.unlinkSync(tmp); } catch (_) { /* noop */ }
        throw e;
    }
}

module.exports = { writeFileAtomic };
