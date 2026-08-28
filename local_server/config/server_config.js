/**
 * ============================================================================
 * 파일명: config/server_config.js
 * 역할: SEAGNAL 서버의 전역 설정을 관리하는 모듈
 * ============================================================================
 *
 * [설명]
 * 이 파일은 서버 전체에서 사용되는 공통 설정값들을 한 곳에 모아 관리합니다.
 * - 서버 포트, 데이터 디렉토리 경로, 업로드 디렉토리 경로 등
 * - Fly.io 환경 감지 (클라우드 vs 로컬 구분)
 * - Express 앱 인스턴스 생성 및 기본 미들웨어 설정
 *
 * [연계 파일]
 * - server.js (메인 엔트리) → 이 모듈에서 app, 경로 상수 등을 가져와 사용
 * - routes/*.js (모든 라우트) → DATA_DIR, UPLOAD_DIR 등 경로 상수 사용
 * - services/*.js (모든 서비스) → DATA_DIR, IS_FLY_IO 등 환경 설정 사용
 *
 * [초보자를 위한 안내]
 * Express.js는 Node.js 웹 서버 프레임워크입니다.
 * 이 파일에서 Express 앱을 생성하고 CORS(다른 도메인에서의 접근 허용),
 * JSON 파싱(POST 요청의 본문을 자동으로 JavaScript 객체로 변환) 등
 * 기본적인 미들웨어를 설정합니다.
 * ============================================================================
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// ============================================================================
// Express 앱 생성 및 기본 미들웨어
// ============================================================================
const app = express();
app.use(cors());

// ============================================================================
// 응답 압축 (gzip / brotli) — 모든 응답을 자동 압축하여 대역폭 절감
// ============================================================================
// [동작 원리]
//   compression() 미들웨어는 응답 본문을 gzip/deflate 으로 자동 압축한다.
//   클라이언트가 보낸 'Accept-Encoding: gzip' 헤더를 보고 지원 여부를 판단,
//   응답에 'Content-Encoding: gzip' 을 자동으로 부착한다. 받는 쪽(브라우저/앱)은
//   자동으로 압축을 풀어 사용하므로 application 코드 변경 불필요.
//
// [효과 — 실측 기준]
//   /api/buoys 25,691 bytes → 약 3,000 bytes (88% 절감)
//   /api/forecasts 51,645 bytes → 약 6,000 bytes (88% 절감)
//   모바일 사용자 다운로드 시간 대폭 단축 + 데이터 사용량 감소
//
// [예외 처리 (compression 기본 동작)]
//   - 작은 응답(< 1KB) 은 자동 비압축 (오버헤드가 더 큼)
//   - Content-Type: text/event-stream (SSE) 자동 비압축 (실시간성 보장)
//   - Content-Type: image/* 등 이미 압축된 형식 비압축
//   - 클라이언트가 'Accept-Encoding' 헤더를 안 보내면 비압축 (안전한 fallback)
//
// [위치]
//   cors() 직후, body 파서·정적 파일·라우트보다 앞에 위치해야
//   모든 라우트의 응답이 일관되게 압축됨.
//
// [연계]
//   - server.js → 라우트 응답이 자동 압축됨 (라우트 코드 변경 불필요)
//   - routes/* → 응답 본문은 그대로 작성, 압축은 미들웨어가 처리
//   - X-Data-* 헤더 (services/freshness.js) 와 함께 동작 — 헤더는 비압축, 본문만 압축
//
// [5순위 갱신 — 정적 자원 사전 압축 도입]
//   server.js 의 정적 자원은 이제 express-static-gzip 으로 빌드된 .gz / .br
//   를 그대로 전송한다 (build-gzip.js 가 prestart 에서 미리 생성). 따라서
//   여기 compression() 은 "정적 자원이 아닌 동적 응답만" 압축해야 중복 압축
//   / CPU 낭비를 막을 수 있다.
//
//   필터 규칙:
//   [hotfix — 정적 prefix 제외 제거]
//     운영 환경에서 express-static-gzip 이 .br/.gz 응답을 생성하지 못하는
//     문제가 발견되어(파일은 디스크에 정상 생성됨에도 미들웨어가 압축본을
//     선택하지 못함), 정적 prefix 를 compression 제외 대상에서 다시 포함해
//     실시간 압축으로 안전망을 둔다.
//   동작 시나리오:
//     A) express-static-gzip 이 사전 압축본(.br/.gz)을 응답 → 이미 Content-Encoding
//        헤더가 있으므로 compression 미들웨어가 자동으로 재압축 안 함 (정상 통과).
//     B) express-static-gzip 이 원본 파일로 fallback → compression 미들웨어가
//        Accept-Encoding + Content-Type 보고 실시간 gzip/brotli 적용.
//   결과: 두 경로 어느 쪽이든 압축 응답 보장. 5순위 CPU 절감 효과는 A 케이스에서만
//        나타나며, B 케이스는 기존(5순위 전) 수준으로 회귀.
app.use(compression());
// [limit: 5mb]
//   Quill 에디터에 이미지를 paste / drop / 파일선택으로 삽입하면 base64 인라인
//   방식으로 본문 HTML 에 섞여 들어감. 클라이언트 측에서 js/image_compress.js
//   가 모든 삽입 경로를 후킹하여 이미지를 JPEG 500KB 이하로 자동 축소함.
//   게시글 하나당 이미지 10장(=5MB) 까지 여유 있게 허용.
//
//   과거엔 100kb(기본) 였다가 일시적으로 50mb 까지 올렸으나(b527b1a), 자동
//   압축 도입으로 5mb 면 충분해져 재조정. limit 을 작게 유지할수록 악의적
//   POST 요청에 의한 메모리 소진(DoS) 표면이 줄어듦 (Fly.io 512MB 인스턴스
//   기준 동시 5MB 요청 ~100건까지 감당).
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ limit: '5mb', extended: true }));

// ============================================================================
// 경로 상수
// ============================================================================
const DATA_DIR = path.join(__dirname, '..', 'data');
// 업로드 디렉토리를 data/ 안에 배치하여 Fly.io 볼륨(영구 저장소)에 포함시킴
// → 컨테이너 재생성(배포/재시작) 시에도 업로드된 파일이 소멸되지 않음
// fly.toml의 [[mounts]] destination = '/app/local_server/data' 범위 내에 위치
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const SERVER_ROOT = path.join(__dirname, '..');

// 업로드 폴더가 없으면 자동 생성 (data/uploads/)
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// ============================================================================
// 환경 감지
// ============================================================================
const IS_FLY_IO = !!process.env.FLY_APP_NAME;
const PORT = 3001;

// 정적 파일 루트 경로 결정 — STEP 7 분리: 브라우저 자산은 client/ 로 이동
// (repo/client — Fly 에서는 /app/client, 로컬에서는 <repo>/client)
// 서버 코드(routes/services 등)는 더 이상 정적으로 서빙되지 않는다 (보안 개선).
const staticRoot = path.join(SERVER_ROOT, '..', 'client');

// ============================================================================
// 데이터 파일 경로 상수 (JSON 파일들)
// ============================================================================
const FILES = {
    VISITORS: path.join(DATA_DIR, 'visitors.json'),
    VISITORS_STATS: path.join(DATA_DIR, 'visitors_stats.json'),
    // 사용량 통계(Usage Analytics): 기능별 사용 횟수를 날짜/기기 단위로 누적
    // [연계] services/usage_queue.js → 메모리 큐 + 5초 비동기 flush
    // [연계] routes/usage.js → /api/usage 수집 + /api/stats/usage 조회
    USAGE_STATS: path.join(DATA_DIR, 'usage_stats.json'),
    COLLECT_FAILURES: path.join(DATA_DIR, 'collect_failures.json'),
    SUBSCRIPTIONS: path.join(DATA_DIR, 'subscriptions.json'),
    PUSH_HISTORY: path.join(DATA_DIR, 'custom_push_history.json'),
    TIDEBED_CONFIG: path.join(DATA_DIR, 'tidebed_config.json'),
    SURVEYS: path.join(DATA_DIR, 'surveys.json'),
    REPORTS: path.join(DATA_DIR, 'reports.json'),
    BLOCKS: path.join(DATA_DIR, 'blocks.json'),
    TIDE_USAGE: path.join(DATA_DIR, 'tide_usage.json'),
    // 구독자 일별 스냅샷: 매일 자정(KST)에 구독자 수를 기록하여 증감 추이 분석에 사용
    // [연계] services/subscriber_snapshot.js → 스냅샷 기록
    // [연계] routes/push.js → /api/subscriber-history API에서 조회
    SUBSCRIBER_STATS: path.join(DATA_DIR, 'subscriber_stats.json'),
    // 구독/해지 이벤트 로그: 신규 구독, 수동 해지, 만료 토큰 자동 정리를 일별로 집계
    // [연계] routes/push.js → 구독/해지 발생 시 기록 + /api/subscriber-events API에서 조회
    // [연계] js/admin.js → 구독 현황 탭의 이탈률 카드에서 활용
    SUBSCRIBER_EVENTS: path.join(DATA_DIR, 'subscriber_events.json'),
    // 법률위키 사람검증 승인 이력: 관리자가 승인/반려한 기록(감사 추적용)
    // ★볼륨(DATA_DIR)에 둔다 — 종전 경로는 knowledge/legal/_dashboard/ 라 컨테이너 이미지 안이었고,
    //   재배포할 때마다 관리자가 승인한 기록이 이미지의 옛 값으로 되돌아가 사라졌다
    //   (nariya_config.json 이 H-37 에서 같은 이유로 옮겨졌는데 이 파일은 안 옮겨져 있었다).
    // [연계] routes/legal.js → 승인 시 append · GET /api/legal/reviews/approvals 로 내려받아
    //        _dashboard/loop/apply_approvals.py 가 저장소에 반영한다.
    LEGAL_APPROVALS: path.join(DATA_DIR, 'review_approvals.json')
};

module.exports = {
    app,
    express,
    fs,
    path,
    DATA_DIR,
    UPLOAD_DIR,
    SERVER_ROOT,
    IS_FLY_IO,
    PORT,
    staticRoot,
    FILES
};
