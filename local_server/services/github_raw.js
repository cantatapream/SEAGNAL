/**
 * ============================================================================
 * 파일명: services/github_raw.js
 * 역할: 법령 원문(raw/)을 GitHub에서 "필요할 때만" 읽어오는 최소 클라이언트
 * ============================================================================
 *
 * [설명]
 * 나리야 챗봇이 위키(검증된 요약카드)에서 근거를 못 찾았을 때, 좁혀진 법 1~2개의
 * **원문 텍스트**를 그 자리에서 GitHub에서 받아 "미검증 참고" 답변을 만든다
 * (MASTER_PLAN F절 "★★설계 확정 — raw는 서버에 상주시키지 않고 필요 시 GitHub에서
 * 그때그때 내려받는다"). raw 전량(≈129MB)을 서버 메모리·디스크에 상시로 두면 Fly.io
 * 1GB 인스턴스의 기존 안전마진을 잠식해 OOM 재발 위험이 있어, 상주 대신 온디맨드로 읽는다.
 *
 * 이 저장소(`cantatapream/SEAGNAL`)는 비공개라 raw.githubusercontent.com 공개 URL로는
 * 못 읽는다 → GitHub Contents API를 읽기전용 토큰(`GITHUB_RAW_TOKEN`, Fly.io 시크릿)으로 호출한다.
 *
 * [★2026-09-22 — 로컬 폴백 추가 (P-11 · 일감 2-11)]
 * 종전에는 토큰이 없으면 **바로 빈 결과**였다. 그런데 이 저장소를 체크아웃해 돌리는 환경에는
 * `local_server/knowledge/legal/raw/` 가 **바로 옆에 있다**. 그래서 조문 원문·서식 버튼(§5-5)·
 * 별표 이미지(§5-9)가 **로컬에서 통째로 죽어 있었고, 소리도 안 났다** — `renderFormDownloadsHTML`
 * 은 0건이면 아무것도 안 그리므로 사용자는 "서식이 없다"와 "확인 못 했다"를 구분할 수 없었다.
 * 이제 **로컬 디스크를 먼저 보고, 없을 때만 GitHub 로 간다.**
 *   · Fly.io 배포본 — 이미지에 raw/ 가 없다 → 로컬 미스 → 종전과 똑같이 GitHub API
 *   · 체크아웃 환경 — raw/ 가 있다 → 디스크에서 읽는다(토큰·네트워크 불필요, 더 빠르다)
 * 이 폴백이 L-7(조문·서식·별표 라이브 검증)을 여는 열쇠다.
 *
 * [안전장치 — 이 파일의 핵심 계약]
 *  - 경로는 저장소 루트 기준 상대경로만 받는다. `..` 로 루트 밖을 가리키면 로컬 읽기를 거부한다.
 *  - 로컬에도 없고 토큰도 없으면 **한 번은 큰 소리로 알린다**(G-14 — 조용한 실패 금지).
 *  - 토큰이 없으면(로컬 개발환경 등) API를 아예 호출하지 않고 즉시 빈 결과(null/[])를 준다.
 *  - 네트워크 오류·404·401·타임아웃 등 어떤 실패에도 **예외를 던지지 않고** 빈 결과로 폴백한다.
 *    (legal_retriever.js의 expandQueryTerms()와 같은 "이 단계가 죽어도 챗봇 본체는 산다" 패턴)
 *  - 요청마다 타임아웃(REQUEST_TIMEOUT_MS)을 걸어 GitHub가 느려져도 사용자 응답이 안 밀리게 한다.
 *
 * [연계 파일]
 * - services/legal_retriever.js               → searchRawFallback()이 이 모듈의 두 함수를 호출
 * - knowledge/legal/_dashboard/law_raw_paths.json → 법명 → raw 폴더 상대경로(여기 경로를 그대로 API path로 씀)
 * - knowledge/legal/raw/<분류>/<법명>/          → 실제로 읽어오는 원문(법률.txt·시행령.txt·행정규칙/…)
 *
 * [로드 순서] 번들 없음(서버). legal_retriever.js가 require 시점에 함께 로드된다.
 * ============================================================================
 */
'use strict';

// 읽기전용 PAT이 `cantatapream/SEAGNAL` 한 곳에만 발급돼 있어 저장소를 고정한다(다른 저장소는 못 읽음).
const REPO = 'cantatapream/SEAGNAL';
const API_BASE = `https://api.github.com/repos/${REPO}/contents/`;
// 2차(미검증 참고) 조회는 사용자가 화면에서 기다리는 중에 돈다 — GitHub가 느려지면
// 무한정 기다리지 말고 끊고 폴백한다(그 경우 챗봇은 기존대로 "확인되지 않습니다"로 끝난다).
const REQUEST_TIMEOUT_MS = 8000;

// ── 로컬 폴백 (2026-09-22, P-11) ───────────────────────────────────────────
const fs = require('fs');
const path = require('path');
// 이 파일은 `<repo>/local_server/services/` 에 있다 → 두 단계 올라가면 저장소 루트.
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = 'local_server/knowledge/legal/raw';
let _warnedNoSource = false;

/**
 * 저장소 루트 기준 상대경로를 로컬 절대경로로 바꾼다. 루트 밖을 가리키면 null.
 * 경로 문자열이 데이터(`law_raw_paths.json`·위키 칸)에서 오므로 탈출을 막는다.
 * @param {string} repoPath
 * @returns {string|null}
 */
function localPathOf(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) return null;
  const abs = path.resolve(REPO_ROOT, repoPath);
  if (abs !== REPO_ROOT && !abs.startsWith(REPO_ROOT + path.sep)) return null;
  return abs;
}

/**
 * 로컬에도 없고 토큰도 없어 읽을 길이 아예 없는 상황을 **한 번은 알린다.**
 * 종전에는 이 경우가 조용히 빈 결과로 끝나 서식·별표가 소리 없이 사라졌다(G-14).
 * @param {string} repoPath
 */
function warnNoSource(repoPath) {
  if (_warnedNoSource) return;
  _warnedNoSource = true;
  // ⚠문구를 정확히 쓴다. 이 경고는 두 가지 아주 다른 상황에서 같이 나온다:
  //   ⓐ 이 환경에 raw/ 자체가 없다(Fly.io 배포본) → 토큰이 없으면 정말 아무것도 못 읽는다
  //   ⓑ raw/ 는 있는데 **그 파일 하나가 없다**(수집 공백·이름 불일치)
  // 종전 문구는 ⓑ 인데도 "로컬 raw/ 도 없다"고 말해 오진을 부른다 — 실제로 첫 실행에서
  // 「수상레저기구법 시행규칙_별표16」이 그랬다(파일은 `동력수상레저기구안전검사기준_별표16.txt`
  // 라는 고시 이름으로 있었다 — P-3 접두사 불일치). 그래서 둘을 갈라 적는다.
  const hasRoot = (() => { try { return fs.statSync(path.join(REPO_ROOT, RAW_DIR)).isDirectory(); } catch (_) { return false; } })();
  console.error('[github_raw] 원문을 못 읽었다 — '
    + (hasRoot ? '로컬 raw/ 는 있으나 이 경로가 없고' : '이 환경에 로컬 raw/ 가 없고')
    + ' GITHUB_RAW_TOKEN 도 없다. 조문 원문·서식(§5-5)·별표 이미지(§5-9)가 빈 결과가 된다.'
    + ' 첫 경로: ' + repoPath);
}

/**
 * GitHub 읽기전용 토큰이 설정돼 있는지. 없으면 2차 조회 자체를 건너뛰어야 한다.
 * 예: hasToken() → false(로컬 개발환경) → legal_retriever가 2차 조회를 스킵
 * @returns {boolean}
 * [연계] → legal_retriever.searchRawFallback()이 제일 먼저 확인하는 게이트.
 */
function hasToken() {
  return !!process.env.GITHUB_RAW_TOKEN;
}

/**
 * Contents API를 한 번 호출한다. 실패(토큰없음·네트워크·404·401·타임아웃)는 전부 null.
 * 경로에 한글·공백이 들어가므로 세그먼트 단위로 인코딩한다.
 * @param {string} repoPath - 저장소 루트 기준 상대경로(예: 'local_server/knowledge/legal/raw/04_선박해운/어선법')
 * @param {string} accept - Accept 헤더(디렉터리 목록은 JSON, 파일 본문은 raw)
 * @returns {Promise<Response|null>} 성공한 응답 또는 null
 * [연계] ← listDir()·fetchText()가 공용으로 사용.
 */
async function ghFetch(repoPath, accept) {
  if (!hasToken()) return null;
  try {
    const url = API_BASE + String(repoPath).split('/').filter(Boolean).map(encodeURIComponent).join('/');
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.GITHUB_RAW_TOKEN}`,
        Accept: accept,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[GitHubRaw] ${res.status} ${repoPath}`);
      return null;
    }
    return res;
  } catch (e) {
    console.error(`[GitHubRaw] 호출 실패 ${repoPath}: ${String(e.message || e).slice(0, 180)}`);
    return null;
  }
}

/**
 * 디렉터리 한 단계의 항목 목록(이름·경로·종류)을 받아온다. 파일 **내용은 받지 않아** 가볍다
 * (MASTER_PLAN "①동시조회 — 파일 목록만"). 하위 폴더 안까지 보려면 그 폴더 경로로 다시 부르면 된다.
 * 예: listDir('local_server/knowledge/legal/raw/04_선박해운/어선법')
 *     → [{name:'법률.txt',type:'file',...},{name:'행정규칙',type:'dir',...}, …]
 * @param {string} dirPath - 저장소 루트 기준 디렉터리 상대경로
 * @returns {Promise<Array<{name:string,path:string,type:string}>>} 실패·빈 폴더면 []
 * [연계] ← legal_retriever.searchRawFallback()의 ①단계(법 폴더 목차 파악).
 */
async function listDir(dirPath) {
  const lp = localPathOf(dirPath);
  if (lp) {
    try {
      // GitHub Contents API 와 **같은 모양**으로 돌려준다 — 호출부는 e.name·e.type·e.path 를 쓴다.
      const ents = fs.readdirSync(lp, { withFileTypes: true });
      return ents.map(e => ({ name: e.name, path: dirPath + '/' + e.name, type: e.isDirectory() ? 'dir' : 'file' }));
    } catch (_) { /* 로컬에 없다 → 아래 GitHub 로 */ }
  }
  if (!hasToken()) { warnNoSource(dirPath); return []; }
  const res = await ghFetch(dirPath, 'application/vnd.github+json');
  if (!res) return [];
  try {
    const json = await res.json();
    if (!Array.isArray(json)) return [];   // 파일 경로를 넣은 경우 객체가 온다 — 목록이 아니므로 버린다
    return json.map(e => ({ name: e.name, path: e.path, type: e.type }));
  } catch (_) {
    return [];
  }
}

/**
 * 파일 하나의 텍스트 내용을 받아온다. `Accept: application/vnd.github.raw`를 쓰면 응답이
 * base64가 아니라 원문 그대로라 디코딩이 필요 없다.
 * 예: fetchText('local_server/knowledge/legal/raw/04_선박해운/어선법/법률.txt') → '어선법\n[시행 …'
 * @param {string} filePath - 저장소 루트 기준 파일 상대경로
 * @returns {Promise<string|null>} 실패하면 null
 * [연계] ← legal_retriever.searchRawFallback()의 ①·③단계(법률.txt·AI가 지목한 파일들).
 */
async function fetchText(filePath) {
  const lp = localPathOf(filePath);
  if (lp) {
    try {
      if (fs.statSync(lp).isFile()) return fs.readFileSync(lp, 'utf8');
    } catch (_) { /* 로컬에 없다 → 아래 GitHub 로 */ }
  }
  if (!hasToken()) { warnNoSource(filePath); return null; }
  const res = await ghFetch(filePath, 'application/vnd.github.raw');
  if (!res) return null;
  try {
    return await res.text();
  } catch (_) {
    return null;
  }
}

module.exports = { hasToken, listDir, fetchText, localPathOf };
