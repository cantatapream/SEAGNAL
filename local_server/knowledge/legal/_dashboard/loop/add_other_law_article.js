/**
 * add_other_law_article.js — **타법 조문 한 개**를 law.go.kr 에서 받아 우리 발췌본에 덧붙인다.
 *
 * 무엇을 하나: 사서가 "이 근거는 「산림자원법」 제10조인데 우리 raw 에 없다"고 막혔을 때,
 *   그 **조문 하나만** 받아 `raw/15_관련타부처/<법>/<계층>_발췌.txt` 끝에 붙여 준다.
 *
 * [왜 이렇게 하나 — 2026-08-27 사용자 확정]
 * `raw/15_관련타부처/` 는 **법 전체가 아니라 우리가 인용한 조문만 받아 둔 발췌본**이다
 * (실측: 타법 폴더 483개 중 276개가 발췌, 평균 14KB · 전문 폴더는 평균 70KB).
 * 같은 발췌본을 여러 법이 돌려 쓰기 때문에, A법이 받아 둔 조문만 있는 파일을 B법이 다른 조문
 * 때문에 열면 반드시 막힌다. 실제로 이번 라운드에 세 번 막혔다
 * (산림자원법 제10조 · 국가경찰과 자치경찰의 조직 및 운영에 관한 법률 전체 · 개인정보보호법 제18조).
 *
 * **법 전체를 받지 않는 이유는 용량이 아니다.** 늘어나는 용량은 15~30MB 수준으로 문제가 안 된다.
 * 전문을 가지면 **매주 도는 신선도 점검 대상이 872건 → 약 2,300건(2.7배)** 이 되고,
 * 그 원문이 낡았을 때 책임이 우리에게 온다. 발췌본은 "그 조문만 참고용"이라 부담이 가볍다.
 * 그래서 **필요한 조문만, 필요할 때** 덧붙인다.
 *
 * ⚠**"혹시 몰라서" 더 받지 마라.** 실제로 근거로 쓸 조문만 받는다.
 * ⚠**사용자 질문 때 실시간으로 받는 것이 아니다.** 위키를 만들·고칠 때 미리 받아 둔다 —
 *   챗봇은 우리가 저장해 둔 파일만 읽는다(원문을 실시간으로 받아 답에 쓰면 "원문에 그 조가
 *   진짜 있나" 확인 단계가 통째로 빠진다).
 *
 * [쓰는 법]
 *   node add_other_law_article.js --law "산림자원의 조성 및 관리에 관한 법률" --arts "제10조" \
 *        --why "신항만건설촉진법 G63 — 입목벌채 허가 의제 시 조림의무 확인"
 *       → 받아서 보여만 준다(파일은 안 건드림)
 *   ... --apply            → 실제로 발췌본 끝에 붙인다
 *   ... --tier 시행령       → 계층 지정(기본 법률)
 *
 * [연계] → raw/15_관련타부처/<법>/<계층>_발췌.txt · _meta.json (--apply 일 때만 씀)
 *        ← law.go.kr DRF API (lawSearch.do → lawService.do)
 *        ⚠**공유 폴더다.** 여러 사서가 동시에 같은 타법을 건드리면 경합 위험이 있다
 *          (CLAUDE.md 병렬 안전 규칙). 순수 덧붙이기라 위험이 낮지만, 같은 배치에서 여러 법이
 *          같은 타법을 받으려 하면 오케스트레이터가 단독으로 처리한다.
 * [로드 순서] 단독 실행 CLI.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const LEGAL = path.resolve(__dirname, '../..');
const OTHER = path.join(LEGAL, 'raw', '15_관련타부처');
const OC = 'hyoo1431';
const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const die = m => { console.error('✖ ' + m); process.exit(1); };
const flat = s => String(s || '').replace(/[「」『』()（）·ㆍ・,.\s-]/g, '');

/** DRF 한 번 부르기. 못 받으면 null(= "없다"가 아니라 "모른다"). */
function api(url) {
  return new Promise(resolve => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let b = '';
      res.on('data', c => { b += c; });
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(null); } });
    }).on('error', () => resolve(null));
  });
}

/** 법 이름 → 현행 법령 한 건. 이름이 정확히 같은 것만 받는다(비슷한 것을 임의로 고르지 않는다). */
async function findLaw(name, tier) {
  const q = encodeURIComponent(name + (tier === '법률' ? '' : ' ' + tier));
  const d = await api(`https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&type=JSON&target=law&display=50&query=${q}`);
  let arr = ((d || {}).LawSearch || {}).law || [];
  if (!Array.isArray(arr)) arr = [arr];
  const want = flat(name) + (tier === '법률' ? '' : flat(tier));
  const exact = arr.filter(x => flat(x['법령명한글']) === want);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) die(`「${name} ${tier}」 와 이름이 똑같은 법령이 ${exact.length}건이다 — 사람이 골라야 한다.`);
  die(`「${name}${tier === '법률' ? '' : ' ' + tier}」 를 law.go.kr 에서 못 찾았다(후보 ${arr.length}건).\n   ` +
    arr.slice(0, 8).map(x => x['법령명한글']).join('\n   ') +
    `\n   → 정식 명칭을 정확히 쓰라. 비슷한 이름을 임의로 고르지 않는다.`);
}

/** 조문 하나를 사람이 읽는 글로 편다. `제10조(제목)` + 항·호. */
function renderArticle(u) {
  const no = String(u['조문번호'] || '');
  const sub = String(u['조문가지번호'] || '');
  // ⚠가지조 표기는 **제391조의3** 이지 제391의3조가 아니다(2026-08-30, L-217).
  //   종전 코드는 '제'+번호+'의'+가지+'조' 로 이어 붙여 `[제391의3조]` 를 만들었다.
  //   위키·챗봇은 `제391조의3` 으로 인용하므로 그 머리표로는 **받아 놓고도 못 찾는다.**
  //   실측(2026-08-30): 이 꼴로 잘못 저장된 머리표가 raw 전체에 11개 있었다.
  const label = '제' + no + '조' + (sub ? '의' + sub : '');
  const head = String(u['조문내용'] || '').trim();
  const out = [head];
  for (const h of [].concat(u['항'] || [])) {
    if (!h) continue;
    out.push(String(h['항내용'] || '').trim());
    for (const o of [].concat(h['호'] || [])) {
      if (!o) continue;
      out.push('  ' + String(o['호내용'] || '').trim());
      for (const m of [].concat(o['목'] || [])) {
        if (m) out.push('    ' + String(m['목내용'] || '').trim());
      }
    }
  }
  const title = (/^제\d+조(?:의\d+)?\s*\(([^)]{1,60})\)/.exec(head) || [])[1] || '';
  return { label, title, text: out.filter(Boolean).join('\n') };
}

(async () => {
  const lawIn = arg('--law') || die('--law "정식 법령명" 이 필요하다(예: "산림자원의 조성 및 관리에 관한 법률").');
  const artsIn = arg('--arts') || die('--arts "제10조" 가 필요하다. 쉼표로 여러 개도 된다.');
  const why = arg('--why') || die('--why "왜 이 조문이 필요한가" 가 필요하다 — 다음 사람이 이 줄을 보고 판단한다.');
  const tier = arg('--tier') || '법률';
  const APPLY = argv.includes('--apply');
  if (!['법률', '시행령', '시행규칙'].includes(tier)) die('--tier 는 법률·시행령·시행규칙 중 하나다.');

  const hit = await findLaw(lawIn, tier);
  const mst = String(hit['법령일련번호'] || '');
  console.error(`  ↳ law.go.kr: 「${hit['법령명한글']}」 MST=${mst} · 시행 ${hit['시행일자']} · 소관 ${hit['소관부처명'] || '?'}`);

  const d = await api(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&type=JSON&target=law&MST=${mst}`);
  if (!d) die('본문을 못 받았다(응답 없음). 잠시 뒤 다시 시도하라 — "없다"가 아니라 "못 받았다"이다.');
  const body = d['법령'] || {};
  let units = ((body['조문'] || {})['조문단위']) || [];
  if (!Array.isArray(units)) units = [units];

  // ★이미 있는 폴더·파일을 먼저 찾는다(2026-08-27, 시험 중 발견).
  //   산림자원법은 폴더가 이미 있고 그 안에 `법률.txt`(제32·36조만)가 들어 있었다.
  //   그걸 못 보고 `법률_발췌.txt` 를 새로 만들면 **같은 법의 발췌가 두 파일로 갈리고**,
  //   `cite_row.js` 는 `법률.txt` 를 먼저 집으므로 새로 받은 조문을 못 본다 — 받아 놓고도 못 쓴다.
  const wantSlug = flat(hit['법령명한글']).replace(/[/\\]/g, '');
  let dir = path.join(OTHER, wantSlug);
  if (!fs.existsSync(dir)) {
    const found = fs.existsSync(OTHER) &&
      fs.readdirSync(OTHER).find(e => flat(e) === wantSlug);
    if (found) dir = path.join(OTHER, found);
  }
  // 계층 파일 고르기: 이미 쓰던 파일이 있으면 **거기에 덧붙인다.**
  const plain = path.join(dir, `${tier}.txt`);
  const excerpt = path.join(dir, `${tier}_발췌.txt`);
  // ★조문마다 파일이 따로 있는 옛 형식(`법률_제182조(연결조문).txt`)을 먼저 합친다
  //   (2026-08-31, 내가 실제로 당했다). 그런 폴더에 새 조문을 넣으면 `법률_발췌.txt` 가
  //   **새로 만들어지고**, 챗봇은 `법률.txt` → `법률_발췌.txt` 순으로만 보므로
  //   먼저 있던 조문들이 통째로 안 열리게 된다 — 지방자치법에서 제182·198조 3행이 그렇게 죽었다.
  //   발췌본이 두 파일로 갈리면 "받아 놓고도 못 쓴다"는 것은 이 파일 위쪽 주석이 이미 경고한 것인데,
  //   그때는 `법률.txt` 만 살폈고 조문별 파일은 못 봤다.
  if (!fs.existsSync(plain) && fs.existsSync(dir)) {
    const singles = fs.readdirSync(dir)
      .filter(n => new RegExp('^' + tier + '_제\\d+조(?:의\\d+)?\\(.*\\)\\.txt$').test(n));
    if (singles.length) {
      const head = fs.existsSync(excerpt) ? fs.readFileSync(excerpt, 'utf8') : `${name} — 타법연결용 발췌 (전체 아님)\n`;
      let merged = head;
      for (const n of singles) {
        const t = fs.readFileSync(path.join(dir, n), 'utf8').trim();
        const no = (/^\[제\d+조(?:의\d+)?\]/.exec(t) || [''])[0];
        if (no && merged.includes(no)) continue;
        merged += '\n\n' + t + '\n';
      }
      fs.writeFileSync(excerpt, merged);
      console.error(`  ↳ 조문별 파일 ${singles.length}개를 ${path.basename(excerpt)} 로 합쳤다(원본은 지우지 않는다).`);
    }
  }
  const file = fs.existsSync(plain) ? plain : excerpt;
  const had = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (file === plain) {
    console.error(`  ↳ 이미 있는 ${path.basename(file)} 에 덧붙인다(발췌본을 따로 만들지 않는다).`);
  }

  const add = [];
  for (const one of artsIn.split(/[,，]/).map(x => x.trim()).filter(Boolean)) {
    const m = /^제\s*(\d+)조(?:의\s*(\d+))?$/.exec(one.replace(/\s+/g, ''));
    if (!m) die(`"${one}" 은 조문 표기가 아니다. 제10조 / 제10조의2 꼴로 쓰라.`);
    // ⚠같은 조문번호로 **장·절 제목 줄**이 먼저 들어 있는 법이 있다(응답의 `조문여부`가 '전문').
    //   실측 2026-08-30: 전기통신사업법은 `제7장 벌칙` 이라는 제목 줄이 조문번호 94 를 달고
    //   실제 제94조(벌칙 본문)보다 **앞에** 온다. 필터 없이 find 하면 제목 줄을 집어 와서
    //   "제94조"라는 이름 아래 `제7장 벌칙` 다섯 글자만 저장된다 — 받아 놓고도 근거가 안 열린다.
    //   그래서 `조문여부 === '조문'` 인 것을 먼저 찾고, 없을 때만 나머지에서 찾는다.
    const same = x => String(x['조문번호']) === m[1] &&
      String(x['조문가지번호'] || '') === (m[2] || '');
    let u = units.find(x => same(x) && x['조문여부'] === '조문') || units.find(same);
    // ⚠못 찾았다고 곧바로 "없다"라고 하지 않는다(2026-08-31, 사서 실측).
    //   같은 조문에 대해 첫 --apply 는 "원문에 제20조 이 없다 — 받아 온 조문 40개" 로 죽고
    //   곧바로 다시 돌리니 정상 저장된 사례가 있었다. 응답이 JSON 으로 파싱은 됐는데
    //   내용이 그때만 달랐던 것으로, 재현은 못 했다(같은 MST 를 세 번 다시 불러 봤으나
    //   세 번 다 조문 40개·제20조 1건으로 같았다 — 그래서 원인을 단정하지 않는다).
    //   확실한 것은 하나다 — **한 번 못 찾은 것을 "원문에 없다"로 말하면 안 된다.**
    //   그래서 본문을 한 번 다시 받아 보고, 그래도 없을 때만 멈춘다. 멈출 때의 문구도
    //   "없다"가 아니라 "두 번 받아 봤지만 못 찾았다"로 쓴다.
    if (!u) {
      console.error(`  ↻ ${one} 을 못 찾았다 — 본문을 한 번 다시 받아 본다(받아 온 조문 ${units.length}개).`);
      const again = await api(`https://www.law.go.kr/DRF/lawService.do?OC=${OC}&type=JSON&target=law&MST=${mst}`);
      let u2 = (((again || {})['법령'] || {})['조문'] || {})['조문단위'] || [];
      if (!Array.isArray(u2)) u2 = [u2];
      if (u2.length) {
        units = u2;
        u = units.find(x => same(x) && x['조문여부'] === '조문') || units.find(same);
      }
    }
    if (!u) die(`「${hit['법령명한글']}」 에서 ${one} 을 못 찾았다 — 본문을 두 번 받아 봤지만 없었다(받아 온 조문 ${units.length}개). 조문 번호를 확인하라. 번호가 맞다면 잠시 뒤 다시 시도하라 — "원문에 없다"가 아니라 "못 찾았다"이다.`);
    const r = renderArticle(u);
    if (had.includes(`[${r.label}]`)) {
      console.log(`  ⏭️  이미 있음: ${r.label} ${r.title}`);
      continue;
    }
    add.push(r);
  }
  if (!add.length) { console.log('덧붙일 조문이 없다(전부 이미 있음).'); return; }

  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  // ★머리줄에는 **조 제목만** 둔다(2026-08-27, 시험 중 발견).
  //   왜 받았는지를 머리줄에 같이 적으면 `cite_row.js` 가 그 문장을 통째로 조 제목으로 읽어
  //   근거 조문 표의 요지 칸에 메모가 그대로 들어간다(실측으로 확인). 메모는 다음 줄에 따로 적는다.
  const blocks = add.map(r =>
    `[${r.label}] ${r.title}\n※ ${why} (${today} 조문단위 추가수집)\n${r.text}\n`);

  console.log(`\n파일: ${path.relative(LEGAL, file)}${had ? '' : '  ★새로 만든다'}`);
  console.log(blocks.join('\n'));
  if (!APPLY) { console.log('(--apply 를 붙이면 실제로 덧붙인다)'); return; }

  fs.mkdirSync(dir, { recursive: true });
  const head = had ? '' :
    `${hit['법령명한글']} — 타법연결용 발췌 (전체 아님)\n\n`;
  fs.appendFileSync(file, (had && !had.endsWith('\n') ? '\n' : '') + head + '\n' + blocks.join('\n'));
  const metaPath = path.join(dir, '_meta.json');
  let meta = {};
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch (e) { /* 없으면 새로 만든다 */ }
  meta['법령명'] = hit['법령명한글'];
  meta['소관부처'] = hit['소관부처명'] || meta['소관부처'] || '';
  meta['시행일'] = String(hit['시행일자'] || meta['시행일'] || '');
  // ★이미 적힌 비고를 덮어쓰지 않는다(2026-08-28). 종전에는 무조건 이 문장으로 갈아 끼워서,
  //   사람이 적어 둔 메모가 지워졌다 — 실제로 2건이 사라졌고 그중 하나는 하필
  //   *"동일 폴더를 여러 기준법이 공유 — 병합 시 인용출처 삭제 금지"* 라는 **경고 자체**였다.
  //   비어 있을 때만 기본 문구를 넣는다.
  if (!meta['비고']) meta['비고'] = '연결조문만 발췌 수집, 전체 아님 — 신선도 점검 대상에서 제외된다';
  meta['수집일'] = meta['수집일'] || today;
  // ⚠`추가수집` 이 **문자열**인 _meta.json 이 실제로 13개 있다(2026-08-30 전수 확인 — 항만법·선원법·
  //   해운법·해양환경관리법·전기사업법 등, 사람이 한 줄 메모로 적어 둔 것). 종전 코드는 배열이라고
  //   단정하고 `.push` 를 불러서 **조문을 파일에 덧붙인 바로 다음에 예외로 죽었다** — 원문은 들어갔는데
  //   기록만 안 남고, 화면에는 스택 트레이스가 떠서 실패한 것처럼 보인다(전기사업법 제7·61조에서 실제 발생).
  //   문자열이면 배열의 첫 항목으로 옮겨 담아 **사람이 적어 둔 메모를 잃지 않는다.**
  const prev = meta['추가수집'];
  meta['추가수집'] = Array.isArray(prev) ? prev : (prev ? [prev] : []);
  meta['추가수집'].push({ 일자: today, 조문: add.map(r => r.label), 사유: why });
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  // ★폴더를 새로 만들었으면 **지도도 같이 채운다**(2026-08-30, L-212).
  //   챗봇은 `_dashboard/law_raw_paths.json`(법 이름 → raw 폴더)으로 원문 폴더를 찾는다.
  //   지도에 없으면 **원문이 디스크에 있는데도 "원문 폴더를 못 찾음"으로 죽는다.**
  //   종전에는 이 도구가 폴더만 만들고 지도를 손대지 않아, 나중에 `sync_law_paths.py` 를
  //   사람이 기억해서 돌려야 했다 — 그리고 사람은 잊는다. 실제로 2026-08-28 에 한 번
  //   맞춰 놓고도 2026-08-30 에 다시 2건이 밀려 있었다(그중 하나는 누가 언제 만든지도 모른다).
  //   ⚠이미 있는 열쇠는 덮어쓰지 않는다 — 사람이 손으로 넣은 별칭이 있을 수 있다.
  try {
    const mapPath = path.join(LEGAL, '_dashboard', 'law_raw_paths.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const key = path.basename(dir);
    if (!map[key]) {
      map[key] = path.relative(path.resolve(LEGAL, '..', '..', '..'), dir).split(path.sep).join('/');
      fs.writeFileSync(mapPath, JSON.stringify(map, null, 1));
      console.log(`   지도(law_raw_paths.json)에 「${key}」 를 새로 넣었다 → ${map[key]}`);
    }
  } catch (e) {
    console.error(`   ⚠지도(law_raw_paths.json) 갱신에 실패했다: ${e.message}`);
    console.error('     원문은 들어갔지만 챗봇이 폴더를 못 찾을 수 있다 — `python3 sync_law_paths.py --apply` 를 돌려라.');
  }

  console.log(`\n✅ ${path.relative(LEGAL, file)} 에 ${add.length}개 조문을 덧붙였다.`);
  console.log('   이제 cite_row.js 로 근거 조문 행을 만들 수 있다.');
})();
