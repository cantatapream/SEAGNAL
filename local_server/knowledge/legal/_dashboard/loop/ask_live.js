/**
 * ask_live.js — 프로덕션 나리야 챗봇에 **실제 앱과 똑같은 방식으로** 질문하는 감사용 도구.
 *
 * 왜 있나: 2026-08-18 라이브 검증 1차에서 검증관들이 되묻기(clarify)에 답할 때 라벨을 그냥
 * 텍스트로 이어붙여 보냈는데, 실제 앱은 그렇게 하지 않는다. 그 결과 74법 중 대부분이 답변까지
 * 못 가고 `clarify` 로 끝나 검증이 통째로 성립하지 않았다(비용만 쓰고 신호 0).
 *
 * 실제 규약(client/js/ai-chat/ai_chat.js `pickClarifyOption` 원문 그대로):
 *   ① 선택지에 `ctx` 가 있으면 → 질의는 **원문 그대로 두고** ctx 만 얹어(얕은 병합) 재전송
 *   ② 선택지에 `ctx` 가 없으면 → 질의를 `원질문 + ' — ' + 라벨` 로 누적하고 직전 ctx(=lastCtx)를 실어 전송
 *      (서버는 이 ' — ' 개수로 되묻기 라운드를 세어 무한루프를 막는다 — 짧게 줄이면 그 방어가 깨진다)
 *   ③ lastCtx = 직전 응답의 `ctxNext`
 *
 * [연계] ← live_verify.js(검증관 프롬프트가 이 스크립트를 부르게 한다).
 *        → https://seagnal-server.fly.dev/api/legal/ask (NDJSON, 마지막 done 줄이 결과).
 *        ⚠읽기 전용 — 위키·raw 를 고치지 않는다.
 *
 * 쓰는 법:
 *   node ask_live.js --state <상태파일> start "<질문>"
 *   node ask_live.js --state <상태파일> pick <선택지번호(0부터)>
 *   node ask_live.js --state <상태파일> etc "<직접 적을 내용>"
 * 매 호출이 지금까지의 질의·ctx·요청횟수를 상태파일에 이어 적고, 결과를 요약해 찍는다.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const API = 'https://seagnal-server.fly.dev/api/legal/ask';

const argv = process.argv.slice(2);
let statePath = '';
const si = argv.indexOf('--state');
if (si >= 0) { statePath = argv[si + 1]; argv.splice(si, 2); }
if (!statePath) { console.error('--state <경로> 가 필요합니다'); process.exit(2); }
const cmd = argv[0];

function load() {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch (_) { return null; }
}
function save(s) { fs.writeFileSync(statePath, JSON.stringify(s, null, 1)); }

/** 얕은 병합 — 클라이언트 mergeCtx 와 같다(축 단위로 덮어쓴다). */
function mergeCtx(base, extra) {
  if (!base) return extra || null;
  if (!extra) return base;
  return Object.assign({}, base, extra);
}

// ⚠node 내장 fetch 는 이 환경의 에이전트 프록시를 타지 않아 호스트 차단에 걸린다(실측 2026-08-18).
//   curl 은 프록시 설정을 그대로 쓰므로 curl 로 보낸다.
function ask(query, ctx) {
  const body = { query };
  if (ctx) body.ctx = ctx;
  const tmp = statePath + '.body.json';
  fs.writeFileSync(tmp, JSON.stringify(body));
  const txt = execFileSync('curl', ['-s', '-X', 'POST', API,
    '-H', 'Content-Type: application/json',
    '--data-binary', '@' + tmp, '--max-time', '240'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = txt.trim().split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const o = JSON.parse(lines[i]); if (o && o.type === 'done') return o; } catch (_) {}
  }
  throw new Error('done 줄을 찾지 못함: ' + txt.slice(-300));
}

function report(s, data) {
  const out = {
    요청횟수: s.calls,
    보낸질의: s.query,
    되묻기: data.clarify ? data.clarify.question : null,
    선택지: data.clarify ? (data.clarify.options || []).map((o, i) =>
      `${i}: ${o.label}${o.ctx ? ' [ctx있음]' : ''}${o.act ? ' act=' + o.act : ''}`) : null,
    답변: (data.answer || '').slice(0, 700),
    citationChain: (data.citationChain || []).map(c =>
      `${c.law || ''} ${c.citedArticle || c.article || ''}`.trim()),
    sources: (data.sources || []).map(x => (x && (x.title || x.slug || x.law || x.name)) || JSON.stringify(x)).slice(0, 10),
  };
  console.log(JSON.stringify(out, null, 1));
}

(async () => {
  if (cmd === 'start') {
    const q = argv[1];
    if (!q) { console.error('질문이 비었습니다'); process.exit(2); }
    const s = { query: q, base: q, ctx: null, calls: 0, log: [] };
    s.calls++;
    const data = await ask(s.query, s.ctx);
    s.ctx = data.ctxNext || null;
    s.last = { clarify: data.clarify || null };
    s.log.push({ q: s.query, clarify: !!data.clarify });
    save(s); report(s, data); return;
  }

  const s = load();
  if (!s) { console.error('상태파일이 없습니다 — start 부터 하세요'); process.exit(2); }
  if (!s.last || !s.last.clarify) { console.error('직전 응답에 되묻기가 없습니다'); process.exit(2); }

  if (cmd === 'pick') {
    const n = Number(argv[1]);
    const opt = (s.last.clarify.options || [])[n];
    if (!opt) { console.error('그런 번호의 선택지가 없습니다'); process.exit(2); }
    if (opt.act === 'ask') { console.error('"다시 설명할게요"는 이 도구로 보낼 수 없습니다 — 다른 선택지를 고르세요'); process.exit(2); }
    if (opt.ctx) s.ctx = mergeCtx(s.ctx, opt.ctx);     // ① 질의는 그대로, ctx 만 얹는다
    else s.query = s.query + ' — ' + opt.label;        // ② 질의 누적, ctx 는 직전 것 그대로
  } else if (cmd === 'etc') {
    const typed = argv[1];
    if (!typed) { console.error('적을 내용이 비었습니다'); process.exit(2); }
    s.query = s.query + ' — ' + typed;                 // "기타" 칸도 ②와 같은 길
  } else {
    console.error('cmd 는 start | pick | etc'); process.exit(2);
  }

  s.calls++;
  const data = await ask(s.query, s.ctx);
  s.ctx = data.ctxNext || s.ctx;
  s.last = { clarify: data.clarify || null };
  s.log.push({ q: s.query, clarify: !!data.clarify });
  save(s); report(s, data);
})().catch(e => { console.error('실패:', e.message); process.exit(1); });
