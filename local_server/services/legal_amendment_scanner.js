/**
 * ============================================================================
 * 파일명: services/legal_amendment_scanner.js
 * 역할  : 나리야(해양법령 챗봇) 개정 감지 스캐너. raw 코퍼스가 가리키는 법률/시행령/
 *         시행규칙의 MST를 law.go.kr DRF API로 주기 조회해, 마지막 스캔 이후
 *         공포번호·시행일자가 바뀐 것을 찾아 _amendments/queue.jsonl에 적재한다.
 *         (초보자용: "이 법 바뀌었나?"를 밤마다 국가법령정보센터에 물어보고,
 *          바뀐 게 있으면 관리자가 볼 수 있게 메모만 남겨두는 역할. 위키를
 *          자동으로 고치지는 않는다 — 그건 사람이 승인해야 하는 별도 단계.)
 * ----------------------------------------------------------------------------
 * [설계]
 *  - 대상: raw/01~14_*(핵심 73법 계열) _meta.json의 families.{법률|시행령|시행규칙}.MST만.
 *    raw/15_관련타부처·_자치법규는 인용 발췌만 있어(전체 편입 안 함) 범위 밖 —
 *    ⚠경합위험(공유 raw) 원칙과 무관하게, 스캐너는 raw를 읽기만 하고 쓰지 않는다.
 *  - 비교 기준: DRF API(target=eflaw) 응답의 공포번호+시행일자. 조문 본문 전체를 매번
 *    받아 diff하면 API 부하가 크고, 이 두 필드는 실제 공포(개정)가 있을 때만 바뀌는
 *    저비용·고신뢰 신호다(상세 무엇이 바뀌었는지는 사람이 승인 후 재수집 단계에서 본다).
 *  - baseline(_dashboard/amendment_baseline.json): 처음 설치 시 현재값을 그대로 저장해
 *    "신규 설치=전부 개정"으로 오탐되는 것을 막는다. 이후 스캔은 baseline과 다른 것만 큐잉.
 *  - 사람 승인 게이트: 큐에 적재만 하고 위키·raw는 이 스캐너가 절대 자동 수정하지 않는다
 *    (환각0 불변식 — 승인 후 재수집·재빌드는 별도 관리자 조치).
 * [연계]
 *  - server.js → cron.schedule('0 16 * * *', ...) 매일 KST 01:00에 1회 호출(runAmendmentScan)
 *  - routes/legal.js → GET /api/legal/amendments, POST /api/legal/amendments/:id/decide
 *  - _dashboard/amendment_baseline.json → {법명::종류: {공포번호,시행일자,법령명}}
 *  - _amendments/queue.jsonl → 개정 후보 적재(각 줄 1건, status 필드로 상태 관리)
 * ============================================================================
 */
const fs = require('fs');
const https = require('https');
const path = require('path');

const LEGAL_DIR = path.join(__dirname, '..', 'knowledge', 'legal');
const RAW_DIR = path.join(LEGAL_DIR, 'raw');
const BASELINE_FILE = path.join(LEGAL_DIR, '_dashboard', 'amendment_baseline.json');
const QUEUE_FILE = path.join(LEGAL_DIR, '_amendments', 'queue.jsonl');
const CORE_DOMAIN_RE = /^(0[1-9]|1[0-4])_/;   // 01~14_* 만 핵심 법 계열(15_관련타부처·_자치법규 제외)

const OC = process.env.LAW_GO_KR_OC || 'hyoo1431';
const SCAN_DELAY_MS = 300;   // law.go.kr 연속호출 사이 예의상 지연

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * DRF API로 법령 문서 1건의 공포번호·시행일자·법령명만 조회. 실패(타임아웃·파싱오류 등)
 * 는 조용히 null — 이 항목은 이번 스캔에서 건너뛰고 baseline도 안 건드린다(다음 스캔에 재시도).
 * @param {string} mst
 * @returns {Promise<{공포번호:string, 시행일자:string, 법령명:string}|null>}
 */
function fetchLawMeta(mst) {
  return new Promise((resolve) => {
    const url = `https://www.law.go.kr/DRF/lawService.do?OC=${OC}&target=eflaw&type=JSON&MST=${encodeURIComponent(mst)}`;
    const req = https.get(url, { timeout: 15000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          const d = JSON.parse(data);
          const info = (d && d['법령'] && d['법령']['기본정보']) || {};
          resolve({
            공포번호: String(info['공포번호'] || ''),
            시행일자: String(info['시행일자'] || ''),
            법령명: String(info['법령명_한글'] || ''),
          });
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', function () { this.destroy(); resolve(null); });
  });
}

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveBaseline(b) {
  fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(b, null, 1), 'utf8');
}

/**
 * 스캔 대상 목록을 raw 디렉토리에서 동적으로 구성한다(하드코딩 법 목록 없음 — 새 법이
 * raw에 추가되면 다음 스캔부터 자동 포함).
 * @returns {Array<{law:string, kind:string, mst:string, lawNameFull:string}>}
 */
function listTargets() {
  const targets = [];
  let domains = [];
  try { domains = fs.readdirSync(RAW_DIR).filter((d) => CORE_DOMAIN_RE.test(d)); } catch (_) { return targets; }
  for (const domain of domains) {
    const domainDir = path.join(RAW_DIR, domain);
    let laws = [];
    try { laws = fs.readdirSync(domainDir).filter((f) => fs.statSync(path.join(domainDir, f)).isDirectory()); }
    catch (_) { continue; }
    for (const law of laws) {
      const metaPath = path.join(domainDir, law, '_meta.json');
      if (!fs.existsSync(metaPath)) continue;
      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (_) { continue; }
      const fams = meta.families || {};
      for (const kind of Object.keys(fams)) {
        const info = fams[kind];
        if (info && info.MST) targets.push({ law, kind, mst: String(info.MST), lawNameFull: meta['법령명'] || law });
      }
    }
  }
  return targets;
}

/**
 * queue.jsonl에 신규 항목들을 append한다(원자적이지 않은 단순 append — 스캔은 단독
 * cron 1개만 도니 동시쓰기 경합 없음, review_queue.md 같은 사람 동시편집 대상과 다름).
 * @param {Array<object>} entries
 */
function appendQueue(entries) {
  if (!entries.length) return;
  fs.mkdirSync(path.dirname(QUEUE_FILE), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.appendFileSync(QUEUE_FILE, lines, 'utf8');
}

/**
 * 전체 스캔 1회 실행. 변경 발견 시 큐에 적재 + baseline 갱신(변경 여부와 무관하게 모든
 * 성공 조회는 baseline을 최신값으로 갱신 — 다음 스캔의 비교 기준이 항상 "저번 스캔 시점").
 * @returns {Promise<{scanned:number, changed:number, errors:number, firstRun:boolean}>}
 */
async function runAmendmentScan() {
  const targets = listTargets();
  const baseline = loadBaseline();
  const firstRun = Object.keys(baseline).length === 0;
  let changed = 0, errors = 0;
  const newEntries = [];
  for (const t of targets) {
    const key = `${t.law}::${t.kind}`;
    const cur = await fetchLawMeta(t.mst);
    if (!cur) { errors++; await sleep(SCAN_DELAY_MS); continue; }
    const prev = baseline[key];
    // firstRun이면 baseline이 아예 없어 "개정 발견"이 무의미 — 기준값만 저장하고 큐잉 스킵.
    if (!firstRun && prev && (prev.공포번호 !== cur.공포번호 || prev.시행일자 !== cur.시행일자)) {
      changed++;
      newEntries.push({
        id: `am_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ts: new Date().toISOString(),
        law: t.law, kind: t.kind, mst: t.mst,
        법령명: cur.법령명 || t.lawNameFull,
        이전: prev, 현재: cur,
        status: 'pending',
      });
    }
    baseline[key] = cur;
    await sleep(SCAN_DELAY_MS);
  }
  appendQueue(newEntries);
  saveBaseline(baseline);
  return { scanned: targets.length, changed, errors, firstRun };
}

module.exports = { runAmendmentScan, listTargets, QUEUE_FILE };
