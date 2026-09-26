/**
 * cite_exists.js — 근거 조문 표의 **법령 칸과 조문 칸이 실제로 짝이 맞는지** 원문으로 대조한다.
 * AI 를 부르지 않는다(비용 0).
 *
 * [왜 있나 — 품질 4축 ①수집·②형태]
 * 근거 조문 표의 행은 사용자가 원문을 열어 보는 유일한 통로다(`_CHATBOT.md` 답변규칙 7번).
 * 그런데 **조문 번호는 맞는데 주인이 틀린** 행은 아무 검사도 못 잡았다 — 링크는 걸리고 표는
 * 멀쩡해 보이지만, 눌러 보면 전혀 다른 내용이 나온다. 2026-08-20 xref 이관 라운드에서
 * 사서 여남은 명이 "목록에 타법 조문이라 적힌 번호가 실은 이 법 자기 조문이었다"고 반복
 * 보고했고(L-145), 그 오류가 위키에 남았는지 확인할 방법이 없었다. 이 검사가 그 방법이다.
 *
 * [어떻게 보나] 그 법의 raw 원문(법률·시행령·시행규칙·행정규칙 txt)에서 조문 번호를 전부 긁어
 * 집합으로 만들고, 표의 조문 칸에 적힌 번호가 그 집합에 있는지 본다. raw 가 없는 법은 건너뛴다
 * (없는 것을 틀렸다고 말하지 않는다 — 그건 다른 문제다).
 *
 * ⚠**요지 칸은 안 본다.** 요지에는 그 페이지 법의 자기 조문이 흔히 적혀 있어, 거기까지 훑으면
 *   멀쩡한 행이 무더기로 걸린다(이 함정에 도구도 사서도 한 번씩 빠졌다).
 *
 * [쓰는 법]  node cite_exists.js [--examples] [--gate]
 * [연계] ← wiki 아래 md 전부 · raw 아래 txt 전부.  ⚠읽기 전용(고치지 않는다).
 */
const fs = require('fs');
const path = require('path');
const LEGAL = path.resolve(__dirname, '../..');
const WIKI = path.join(LEGAL, 'wiki');
// 2-6 세는 법 사전 — 「근거 조문 행」의 뜻과 범위는 여기 하나에만 적혀 있다.
const COUNT = require('./_counting.js');
const RAW = path.join(LEGAL, 'raw');

/** raw 폴더를 훑어 `법이름 → 그 법에 실재하는 조문 번호 집합` 을 만든다. */
function buildRawIndex() {
  const idx = new Map();
  for (const domain of fs.readdirSync(RAW)) {
    const dp = path.join(RAW, domain);
    if (!fs.statSync(dp).isDirectory()) continue;
    for (const law of fs.readdirSync(dp)) {
      const lp = path.join(dp, law);
      if (!fs.statSync(lp).isDirectory()) continue;
      // `full` = 이 폴더가 그 법의 **전문**을 담고 있나. 파일 이름에 `발췌` 가 붙었거나
      //   `15_관련타부처`(다른 법이 참조하려고 필요한 부분만 받아 둔 자리)뿐이면 전문이 아니다.
      //   이 구분이 없으면 **수집이 덜 된 것**과 **인용이 틀린 것**을 못 가른다(4축 ① vs ②).
      const set = { nums: new Set(), full: domain !== '15_관련타부처' };
      const walk = d => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const p = path.join(d, e.name);
          if (e.isDirectory()) walk(p);
          else if (e.name.endsWith('.txt')) {
            if (/발췌/.test(e.name)) set.full = false;
            const t = fs.readFileSync(p, 'utf8');
            let m; const re = /제\s*(\d+)조/g;
            while ((m = re.exec(t)) !== null) set.nums.add(Number(m[1]));
          }
        }
      };
      try { walk(lp); } catch (_) { /* 읽기 실패는 건너뛴다 */ }
      if (!set.nums.size) continue;
      // ★**덮어쓰지 말고 합친다.** 같은 법이 두 폴더에 있는 경우가 흔하다 —
      //   소관 도메인에는 전문이, `15_관련타부처` 에는 다른 법이 참조하려고 받아 둔
      //   **발췌본**이 있다. 처음엔 덮어써서, 전문(제1~64조)이 발췌본(제2·8조)으로 바뀌는 바람에
      //   멀쩡한 인용 1,433건이 "원문에 없는 조문"으로 잡혔다(2026-08-20 첫 실행).
      const key = law.replace(/\s+/g, '');
      const prev = idx.get(key);
      if (prev) { for (const n of set.nums) prev.nums.add(n); prev.full = prev.full || set.full; }
      else idx.set(key, set);
    }
  }
  return idx;
}

function section(body, re) {
  for (const p of body.split(/^##\s+/m)) if (new RegExp('^' + re).test(p.trim()))
    return p.slice(p.indexOf('\n') + 1);
  return '';
}

const raw = buildRawIndex();
const bad = [], partial = [];
let rows = 0, checked = 0;
for (const kind of ['concepts', 'statutes', 'annexes', 'comparisons']) {
  const dir = path.join(WIKI, kind);
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.md')) continue;
    // ★행 고르기를 **세는 법 사전**에 맡긴다 (2026-09-22, 2-6).
    //   [무엇이 틀렸었나] 종전에는 구분선(`|---|`)만 건너뛰고 **표 머리행**
    //   (`| 법령명 | 조문 | 시행일 | 요지 |`)은 데이터 행으로 셌다. 그 탓에 이 도구가
    //   보고하던 19,161 이 실제보다 **1,248행 부풀어** 있었고, 같은 것을 세는 다른 두
    //   도구(14,218·17,903)와 영영 안 맞았다(G-10 = 뿌리 사슬 ⑥).
    //   [왜 사전에 맡기나] 여기서 다시 직접 쪼개면 또 갈린다. 절 찾기·칸 쪼개기는
    //   **생산 함수의 것 하나**(`R.sectionTable`·`R.tableCells`)만 쓴다(L-136).
    const body = COUNT.stripFrontmatter(fs.readFileSync(path.join(dir, f), 'utf8'));
    for (const c of COUNT.writtenRows(body)) {
      rows++;
      // 법령 칸에서 이름만 남긴다(괄호 주석·낫표·강조 제거). 계층(시행령 등)은 떼어 모법으로 본다.
      const law = c[0].replace(/[「」*\[\]]/g, '').replace(/\(.*?\)/g, '')
        .replace(/\s*(시행령|시행규칙|시행규정)\s*$/, '').replace(/\s+/g, '');
      const set = raw.get(law);
      if (!set) continue;                       // raw 가 없는 법은 판단하지 않는다
      checked++;
      let m; const re = /제\s*(\d+)조/g; const miss = [];
      while ((m = re.exec(c[1])) !== null) if (!set.nums.has(Number(m[1]))) miss.push('제' + m[1] + '조');
      if (!miss.length) continue;
      const hit = `${kind}/${f}  |  ${c[0].slice(0, 30)}  |  ${c[1].slice(0, 40)}  ← ${miss.join('·')}`;
      (set.full ? bad : partial).push(hit);
    }
  }
}
// ⚠숫자만 말하지 않는다 — **뜻과 범위를 함께** 말한다(2-6). 그러지 않으면 또 갈린다.
console.log(`근거 조문 행 ${rows.toLocaleString()}개 (뜻: 표에 적힌 데이터 행 · 범위: ${COUNT.SCOPES.indexed})`
  + ` · 그중 raw 로 대조 가능한 행 ${checked.toLocaleString()}개`);
console.log(`\n★인용 오류 후보(그 법 raw 를 **전문으로** 갖고 있는데 그 조가 없다): ${bad.length}개`);
if (process.argv.includes('--examples')) bad.slice(0, 25).forEach(b => console.log('  ' + b));
console.log(`\n수집 공백(그 법 raw 가 **발췌본**이라 판단 보류 — 4축 ①): ${partial.length}개`);
if (process.argv.includes('--examples')) partial.slice(0, 15).forEach(b => console.log('  ' + b));
if (process.argv.includes('--gate') && bad.length) process.exit(1);
