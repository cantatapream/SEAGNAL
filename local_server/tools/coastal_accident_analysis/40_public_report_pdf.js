/**
 * 위험지수 산출 근거 보고서(해상·연안) 원고(.md)를 PDF 로 만든다.
 * 앱의 위험예측 [기준 상세] 창에서 내려받는 일반인용 보고서다.
 *
 * [연계]
 *  - 원고: local_server/config/coastal_safety/accident_analysis/v3/public/{해상,연안}_위험지수_산출근거.md
 *  - 숫자 근거: 같은 폴더의 *.sources.md (배포하지 않음) → 원 보고서 v3/report.md
 *  - 글꼴: client/assets/vendor/fonts/fonts.css (Noto Sans KR 자체 호스팅 — 외부 접속 없음)
 *  - 브라우저: playwright 의 Chromium (전역 설치본)
 * [사용]
 *  NODE_PATH=$(npm root -g) node local_server/tools/coastal_accident_analysis/40_public_report_pdf.js
 *  → 같은 폴더에 .pdf 와 미리보기용 .html 을 쓴다.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const DIR = process.env.REPORT_DIR || path.join(ROOT, 'local_server/config/coastal_safety/accident_analysis/v3/public');
const FONT_CSS = path.join(ROOT, 'client/assets/vendor/fonts/fonts.css');
const DOCS = ['해상_위험지수_산출근거', '연안_위험지수_산출근거'];

/**
 * 글자 안의 HTML 특수문자를 막고 **굵게** 만 살린다.
 * 예: inline('a < b **c**') → 'a &lt; b <b>c</b>'
 * @param {string} s 한 줄 글
 * @returns {string} HTML 조각
 */
function inline(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}

/**
 * 원고에 쓰는 마크다운 일부(제목·문단·목록·표·굵게·구분선)만 HTML 로 바꾼다.
 * 원고 작성 규칙이 이 범위로 정해져 있어 외부 변환기를 쓰지 않는다.
 * @param {string} md 원고 전체
 * @returns {string} 본문 HTML
 */
function mdToHtml(md) {
  const L = md.replace(/\r/g, '').split('\n');
  const out = [];
  let i = 0;
  const cells = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  while (i < L.length) {
    const l = L[i];
    if (!l.trim()) { i++; continue; }
    let m;
    if ((m = l.match(/^(#{1,4})\s+(.*)$/))) { out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (l.trim().startsWith('|') && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
      const head = cells(l);
      const align = cells(L[i + 1]).map((c) => (/^-+:$/.test(c) ? 'r' : /^:-+:$/.test(c) ? 'c' : ''));
      i += 2;
      const rows = [];
      while (i < L.length && L[i].trim().startsWith('|')) { rows.push(cells(L[i])); i++; }
      const td = (t, k, tag) => `<${tag}${align[k] ? ` class="${align[k]}"` : ''}>${inline(t || '')}</${tag}>`;
      out.push('<table><thead><tr>' + head.map((h, k) => td(h, k, 'th')).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + head.map((_, k) => td(r[k], k, 'td')).join('') + '</tr>').join('') + '</tbody></table>');
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items = [];
      while (i < L.length && /^\s*([-*]|\d+\.)\s+/.test(L[i])) {
        const depth = L[i].match(/^\s*/)[0].length >= 2 ? 1 : 0;
        items.push({ depth, text: L[i].replace(/^\s*([-*]|\d+\.)\s+/, '') });
        i++;
        while (i < L.length && L[i].trim() && /^\s{2,}\S/.test(L[i]) && !/^\s*([-*]|\d+\.)\s+/.test(L[i])) { items[items.length - 1].text += ' ' + L[i].trim(); i++; }
      }
      const tag = ordered ? 'ol' : 'ul';
      let h = `<${tag}>`, open = false;
      items.forEach((it) => {
        if (it.depth && !open) { h += '<ul>'; open = true; }
        if (!it.depth && open) { h += '</ul>'; open = false; }
        h += `<li>${inline(it.text)}</li>`;
      });
      if (open) h += '</ul>';
      out.push(h + `</${tag}>`);
      continue;
    }
    if (/^>\s?/.test(l)) {
      const q = [];
      while (i < L.length && /^>\s?/.test(L[i])) { q.push(L[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${inline(q.join(' '))}</blockquote>`);
      continue;
    }
    const p = [];
    while (i < L.length && L[i].trim() && !/^(#{1,4}\s|\s*([-*]|\d+\.)\s+|\s*\||>|-{3,}\s*$)/.test(L[i])) { p.push(L[i].trim()); i++; }
    out.push(`<p>${inline(p.join(' '))}</p>`);
  }
  return out.join('\n');
}

const CSS = `
@page{size:A4;margin:18mm 16mm 20mm}
body{font-family:'Noto Sans KR',sans-serif;font-size:10pt;line-height:1.7;color:#1b2430;word-break:keep-all;overflow-wrap:break-word}
h1{font-size:20pt;line-height:1.35;margin:0 0 6pt;color:#0c2a5b}
h2{font-size:14pt;margin:20pt 0 6pt;padding-bottom:3pt;border-bottom:2px solid #0c2a5b;color:#0c2a5b;break-after:avoid}
h3{font-size:11.5pt;margin:14pt 0 4pt;color:#16437e;break-after:avoid}
h4{font-size:10.5pt;margin:10pt 0 3pt;break-after:avoid}
p{margin:0 0 6pt}
ul,ol{margin:0 0 6pt;padding-left:16pt}
li{margin:1pt 0}
table{width:100%;border-collapse:collapse;margin:4pt 0 10pt;font-size:9pt;break-inside:auto}
tr{break-inside:avoid}
th{background:#e8eef7;font-weight:700;text-align:left}
th,td{border:1px solid #c5d0de;padding:3pt 5pt;vertical-align:top}
td.r,th.r{text-align:right;font-variant-numeric:tabular-nums}
td.c,th.c{text-align:center}
blockquote{margin:6pt 0;padding:6pt 10pt;background:#f3f6fa;border-left:3px solid #8aa4c8}
hr{border:0;border-top:1px solid #c5d0de;margin:12pt 0}
b{font-weight:700}
`;

(async () => {
  const browser = await chromium.launch();
  for (const name of DOCS) {
    const src = path.join(DIR, name + '.md');
    if (!fs.existsSync(src)) { console.log('없음(건너뜀):', src); continue; }
    const md = fs.readFileSync(src, 'utf8');
    const title = (md.match(/^#\s+(.*)$/m) || [, name])[1];
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>${inline(title)}</title>` +
      `<link rel="stylesheet" href="file://${FONT_CSS}"><style>${CSS}</style></head><body>${mdToHtml(md)}</body></html>`;
    const htmlPath = path.join(DIR, name + '.html');
    fs.writeFileSync(htmlPath, html);
    const page = await browser.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: path.join(DIR, name + '.pdf'), format: 'A4', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;font-size:7pt;color:#7a8595;text-align:center;font-family:sans-serif">${inline(title)} · <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    await page.close();
    console.log('PDF:', path.join(DIR, name + '.pdf'));
  }
  await browser.close();
})();
