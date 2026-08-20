/**
 * build_golden.js — 감사 파일에서 골든 문항 **후보**를 뽑아 `pinned/golden_questions.json` 초안을 만든다.
 * AI 를 부르지 않는다(비용 0).
 *
 * ⚠**이건 초안이다. 라벨은 사람(사서)이 확인해야 한다.**
 *   L-125 가 정확히 이 자리에서 났다 — 라벨을 대충 붙였더니 채점판이 틀렸고, 멀쩡한 것을
 *   병목이라고 보고했다. 그때 틀린 이유 셋: ①정답을 하나만 인정 ②법 단위로 붙임
 *   ③되묻기가 정답인 문항까지 실패로 셈. 그래서 이 초안에는 `verified: false` 를 달아 두고,
 *   확인 패스를 거친 것만 채점에 쓴다.
 *
 * [고르는 기준] 감사 표에서 ①물음표가 든 질문 칸이 있고 ②`full`·`✅` 판정이며 ③같은 줄에
 *   조문 표기가 있는 행. 법마다 고르게 뽑는다(한 법이 점수를 지배하지 않도록).
 *
 * [쓰는 법]  node build_golden.js [--per <법당 개수, 기본 4>] [--write]
 * [연계] ← _dashboard/audit/<법>.md(읽기 전용) · → pinned/golden_questions.json
 */
const fs = require('fs');
const path = require('path');
const AUD = path.resolve(__dirname, '..', 'audit');
const OUT = path.join(__dirname, 'pinned', 'golden_questions.json');
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : ''; };
const PER = Number(arg('--per') || 4);

const ART = /제\s*\d+조(?:의\s*\d+)?|별표\s*\d+(?:의\s*\d+)?|별지\s*제\s*\d+호/;
const LAWNAME = /「([^」]{2,40})」/g;

/** 되묻기가 정답인 문항(법을 특정할 단서가 없음)은 채점에서 빼야 한다(L-125 ③). */
const GENERIC = /증표|신분증|공무원이 조사|이의신청할 수 있나요\?$|과태료는 얼마.{0,4}\?$/;

/** 위키 statutes 파일 이름으로 "실재하는 법인가"를 판정한다. 슬러그 조각을 법 이름으로 쓰지 않기 위해. */
const STATUTES = path.resolve(__dirname, '..', '..', 'wiki', 'statutes');
const REAL = new Set(fs.existsSync(STATUTES)
  ? fs.readdirSync(STATUTES).filter(x => x.endsWith('.md')).map(x => x.slice(0, -3).replace(/\s+/g, ''))
  : []);
const isRealLaw = n => {
  const f = String(n).replace(/\s+/g, '');
  return [...REAL].some(r => r === f || r.includes(f) || f.includes(r));
};

/**
 * ★기대 조문이 **그 법에 실제로 있는지** raw 로 확인한다(2026-08-20, 첫 실행에서 오라벨로 발견).
 * 처음엔 낫표 안 이름이 없으면 그냥 그 감사 파일의 법을 기대 법령으로 썼는데,
 * 「배타적 경제수역 및 대륙붕에 관한 법률」(제1~5조뿐)에 **제21조**가 기대 근거로 붙었다.
 * 조문 번호는 맞는데 **주인이 틀린** 것이다 — L-145 와 같은 뿌리이고 오늘만 세 번째다.
 * `cite_exists.js` 가 쓰는 것과 같은 방식(raw 에서 조문 번호를 긁어 집합으로)을 그대로 쓴다.
 */
const RAW = path.resolve(__dirname, '..', '..', 'raw');
const rawIdx = new Map();
(function buildRaw() {
  if (!fs.existsSync(RAW)) return;
  for (const dom of fs.readdirSync(RAW)) {
    const dp = path.join(RAW, dom);
    if (!fs.existsSync(dp) || !fs.statSync(dp).isDirectory()) continue;
    for (const law of fs.readdirSync(dp)) {
      const lp = path.join(dp, law);
      if (!fs.statSync(lp).isDirectory()) continue;
      const set = rawIdx.get(law.replace(/\s+/g, '')) || new Set();
      const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const q = path.join(d, e.name);
        if (e.isDirectory()) walk(q);
        else if (e.name.endsWith('.txt')) {
          const t = fs.readFileSync(q, 'utf8'); let m; const re = /제\s*(\d+)조/g;
          while ((m = re.exec(t)) !== null) set.add('제' + m[1] + '조');
        } } };
      try { walk(lp); } catch (_) {}
      if (set.size) rawIdx.set(law.replace(/\s+/g, ''), set);
    }
  }
})();
/** 기대 조문이 그 법 raw 에 하나라도 있나. raw 가 없는 법은 판단하지 않는다(버리지 않음). */
function articleFits(law, artStr) {
  const key = String(law).replace(/\s+/g, '');
  let set = rawIdx.get(key);
  if (!set) for (const [k, v] of rawIdx) if (k.includes(key) || key.includes(k)) { set = v; break; }
  if (!set) return true;
  const arts = (String(artStr).match(/제\s*\d+조/g) || []).map(a => a.replace(/\s+/g, ''));
  if (!arts.length) return true;                    // 별표·별지만 있는 것은 이 검사 대상 아님
  return arts.some(a => set.has(a));
}

const rows = [];
for (const f of fs.readdirSync(AUD)) {
  if (!f.endsWith('.md') || f === '_횡단.md') continue;
  // ★감사 파일명에 붙은 라운드 접미사(`_2라운드`)를 떼어야 진짜 법 이름이 된다.
  //   안 떼면 `선박교통관제에관한법률_2라운드` 가 법 이름이 돼 어디에도 안 맞는다(첫 실행에서 발견).
  const slug = f.slice(0, -3).replace(/_\d+라운드$/, '');
  const picked = [];
  for (const raw of fs.readFileSync(path.join(AUD, f), 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|') || picked.length >= PER * 3) continue;
    if (!/✅|\bfull\b/.test(line) || !ART.test(line)) continue;
    const cells = line.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    // 질문 칸: 물음표가 있고 충분히 긴 칸
    const q = cells.find(c => /[?？]/.test(c) && c.length > 18 && c.length < 200);
    if (!q) continue;
    if (GENERIC.test(q)) continue;
    // 기대 근거 칸: 조문이 있고 질문이 아닌 칸 중 가장 긴 것
    const ev = cells.filter(c => c !== q && ART.test(c)).sort((a, b) => b.length - a.length)[0];
    if (!ev) continue;
    // 기대 법령: 낫표 안 이름이 있으면 그것, 없으면 이 법
    // ★낫표 안 이름이 **실재하는 법**일 때만 쓴다 — 위키 statutes 파일명으로 확인한다.
    //   안 그러면 `외국어선벌칙몰수담보금`(개념 페이지 슬러그 조각)이 법 이름으로 들어온다(첫 실행에서 발견).
    const names = [...ev.matchAll(LAWNAME)].map(m => m[1]).filter(isRealLaw);
    const expLaw = names[0] || slug;
    const expArt = (ev.match(new RegExp(ART.source, 'g')) || []).join('·');
    if (!articleFits(expLaw, expArt)) continue;   // ★조문의 주인이 안 맞으면 버린다
    picked.push({
      law: slug,
      question: q.replace(/^\**|\**$/g, '').replace(/\s*\([A-Z]*\d+[^)]*\)\s*$/, '').trim(),
      expect_law: expLaw,
      expect_article: expArt,
      evidence_cell: ev.slice(0, 180),
      verified: false,          // ★사람이 확인해야 채점에 쓴다
    });
  }
  // 한 법 안에서 서로 다른 조문을 고르게 — 같은 조문에 몰리지 않도록
  const seen = new Set(); const keep = [];
  for (const p of picked) {
    const k = p.expect_article.split('·')[0];
    if (seen.has(k)) continue;
    seen.add(k); keep.push(p);
    if (keep.length >= PER) break;
  }
  rows.push(...keep);
}

const byLaw = new Set(rows.map(r => r.law));
console.log(`골든 문항 초안 ${rows.length}개 · 법 ${byLaw.size}개 (법당 최대 ${PER})`);
console.log(`  ⚠전부 verified:false 다 — 확인 패스를 거쳐야 채점에 쓴다`);
if (argv.includes('--write')) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    _설명: '골든 문항집 — 문항마다 기대 근거(법령+조문)가 인용 후보까지 닿는지 golden_eval.js 가 잰다.',
    _규칙: [
      '★verified:true 인 문항만 채점에 쓴다. 라벨을 대충 붙이면 채점판이 틀린다(L-125).',
      '기대 근거는 여럿일 수 있다 — expect_article 에 가운뎃점으로 잇는다(정답 하나만 인정하면 틀린다).',
      '되묻기가 정답인 문항(법을 특정할 단서 없음)은 skip:true 로 채점에서 뺀다.',
      '라벨을 붙일 때는 그 페이지의 근거 조문 표에 실제로 있는지 확인한다 — 짐작으로 넣지 않는다.',
    ],
    생성: '2026-08-20 build_golden.js',
    questions: rows,
  }, null, 1));
  console.log(`저장: ${path.relative(process.cwd(), OUT)}`);
}
