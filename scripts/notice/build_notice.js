#!/usr/bin/env node
/**
 * 파일명: scripts/notice/build_notice.js
 * 역할  : 패치노트 원본(.md + 옆 폴더 사진)을 게시판에 올릴 파일 하나로 묶고, 게시판 칸 모양 미리보기를 만든다.
 *         사진(![설명](shots/a.jpg))을 파일 안(data:image/jpeg;base64)으로 넣어 → <이름>.upload.md
 *         같은 변환기(client/js/notice/board/markdown_import.js)로 그린 미리보기 → <이름>.preview.html (게시글 칸 폭·색 + style.css .promo-md 단계 규칙 그대로)
 *         한 꼭지(문단·목록 항목) 3줄 넘으면 실패(사용자 2026-10-20 — 휴대폰 본문 폭 약 318px 에서 글자 너비로 어림, threeLines)
 * [연계] NOTICE.md(작성 규칙) · client/js/notice/board/markdown_import.js(toHtml — 앱 [마크다운 파일 불러오기]와 같은 변환) · docs/notice/<날짜_이름>/
 * [실행] node scripts/notice/build_notice.js docs/notice/2026-10-20_ai-briefing-risk/patchnote.md [출력폴더]
 *        출력폴더를 안 주면 원본 옆에 만든다. 사진 한 장 600KB·합계 4MB 를 넘으면 실패(게시글 저장 한도 5MB — server_config express.json).
 */
'use strict';
const fs = require('fs'), path = require('path');
const MD = require('../../client/js/notice/board/markdown_import.js');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const ONE_MAX = 600 * 1024, ALL_MAX = 4 * 1024 * 1024, MAX_LINES = 3;
const STYLE = path.join(__dirname, '../../client/style.css');
// 단계별 글자 크기·들여쓰기(px) — style.css .promo-md 와 같은 값. 본문 칸 폭 318px = 휴대폰 390px 화면에서 창 358 − 좌우 여백 20×2.
const BOX = 318, LEVEL = { p: { font: 15, pad: 0 }, 0: { font: 15, pad: 18 }, 1: { font: 14, pad: 36 }, 2: { font: 13, pad: 54 } };

/**
 * 원본 글의 상대 경로 사진을 파일 안 사진으로 바꾼다. 없는 사진·너무 큰 사진은 throw.
 * 예: inline('![a](shots/1.jpg)', '/x') → '![a](data:image/jpeg;base64,…)'
 * @param {string} md @param {string} dir - 원본 폴더 @returns {{md:string, sizes:Array<[string,number]>}} [연계] ← main
 */
function inline(md, dir) {
    const sizes = [];
    const out = md.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, (m, alt, src) => {
        if (/^(?:data:|https:)/i.test(src)) return m;
        const file = path.resolve(dir, src), mime = MIME[path.extname(file).toLowerCase()];
        if (!mime) throw new Error('사진 꼴이 아님(jpg·png·webp·gif): ' + src);
        if (!fs.existsSync(file)) throw new Error('사진 없음: ' + src);
        const buf = fs.readFileSync(file); if (buf.length > ONE_MAX) throw new Error('사진이 600KB 를 넘음: ' + src + ' ' + buf.length);
        sizes.push([src, buf.length]);
        return '![' + alt + '](data:' + mime + ';base64,' + buf.toString('base64') + ')';
    });
    return { md: out, sizes };
}

/**
 * 글자 너비(em) 어림 — 한글·한자·전각 1 · 영문·숫자 0.6 · 띄어쓰기 0.3 · 그 밖 기호 0.4. 예: em('가 a') → 1.9 @param {string} t @returns {number} [연계] ← threeLines
 */
function em(t) { let n = 0; for (const ch of t) n += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : /[A-Za-z0-9]/.test(ch) ? 0.6 : /\s/.test(ch) ? 0.3 : 0.4; return n; }

/**
 * 문단·목록 항목마다 휴대폰 줄 수를 어림해 MAX_LINES(3) 넘는 것을 돌려준다(사진만 든 문단·제목은 빼고).
 * 예: threeLines('<li>…아주 긴 글…</li>') → [{lines:4, text:'…'}]
 * @param {string} html - toHtml 결과 @returns {Array<{lines:number, text:string}>} [연계] ← main(실패) · NOTICE.md 3
 */
function threeLines(html) {
    const out = [];
    for (const m of html.matchAll(/<(p|li)(?: class="ql-indent-(\d)")?>([\s\S]*?)<\/\1>/g)) {
        if (/<img /.test(m[3])) continue;
        const text = m[3].replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
        const lv = m[1] === 'p' ? LEVEL.p : LEVEL[m[2] || 0], lines = Math.ceil(em(text) * lv.font / (BOX - lv.pad));
        if (lines > MAX_LINES) out.push({ lines, text });
    }
    return out;
}

/**
 * 게시글 상세 칸(#promo-detail-content — 휴대폰 390px 폭에서 본문 약 318px, 배경 var(--card-bg) #161b2d, 글 #cbd5e1, 줄간격 1.8, 사진 폭 맞춤·둥근 모서리 8px)을 흉내 낸 미리보기.
 * 예: preview({title:'10월 패치노트', html:'<p>…</p>'}) → '<!doctype html>…'
 * @param {{title:string, html:string}} r @returns {string} [연계] ← main · 실제 모양은 앱 [마크다운 파일 불러오기] 뒤 편집기에서 최종 확인
 */
function preview(r) {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (r.title || '패치노트') + ' — 미리보기</title><style>' +
        'body{margin:0;background:#0b1220;font-family:"Noto Sans KR",system-ui,sans-serif;display:flex;justify-content:center;padding:24px 0}' +
        '.card{width:358px;background:#161b2d;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.5);padding:10px 20px 20px;box-sizing:border-box}' +
        'h1.t{margin:0 0 4px;font-size:1.3rem;font-weight:700;color:#fff;line-height:1.3}.meta{font-size:.8rem;color:#64748b;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:8px}' +
        '.c{color:#cbd5e1}.c img{max-width:100%;height:auto;border-radius:8px}.c a{color:#06c}.c li{list-style:none;position:relative}.c li::before{display:inline-block}' + mdCss() +
        '</style></head><body><div class="card"><h1 class="t">' + (r.title || '(제목 없음)') + '</h1><div class="meta">미리보기 — 실제 게시판 칸 폭(휴대폰)·색·단계 규칙에 맞춤</div><div class="c ql-editor promo-md">' + r.html + '</div></div></body></html>';
}

/** style.css 의 .promo-md 덩어리(promo-md:start~end)를 그대로 꺼낸다 — 미리보기가 앱과 같은 단계 규칙을 쓰게. @returns {string} [연계] ← preview */
function mdCss() { const s = fs.readFileSync(STYLE, 'utf8'), a = s.indexOf('/* promo-md:start'), b = s.indexOf('/* promo-md:end */'); if (a < 0 || b < 0) throw new Error('style.css 에 promo-md 덩어리가 없음'); return s.slice(a, b); }

/** 실행. @returns {void} [연계] ← 명령줄 */
function main() {
    const src = process.argv[2]; if (!src) { console.error('쓰는 법: node scripts/notice/build_notice.js <원본.md> [출력폴더]'); process.exit(2); }
    const dir = path.dirname(path.resolve(src)), outDir = path.resolve(process.argv[3] || dir), base = path.basename(src).replace(/\.md$/i, '');
    const { md, sizes } = inline(fs.readFileSync(src, 'utf8'), dir), all = sizes.reduce((a, [, n]) => a + n, 0);
    if (all > ALL_MAX) throw new Error('사진 합계가 4MB 를 넘음: ' + all);
    const r = MD.toHtml(md);
    if (r.warnings.length) throw new Error('넣지 못한 사진: ' + r.warnings.join(' / '));
    const long = threeLines(r.html);
    if (long.length) throw new Error('3줄 넘는 꼭지 ' + long.length + '개(휴대폰 어림) — 줄여 쓰세요:\n' + long.map((x) => '  ' + x.lines + '줄: ' + x.text).join('\n'));
    fs.mkdirSync(outDir, { recursive: true });
    const up = path.join(outDir, base + '.upload.md'), pv = path.join(outDir, base + '.preview.html');
    fs.writeFileSync(up, md); fs.writeFileSync(pv, preview(r));
    console.log('제목: ' + (r.title || '(없음 — 맨 처음 # 제목을 쓰세요)'));
    for (const [s, n] of sizes) console.log('  사진 ' + s + ' ' + Math.round(n / 1024) + 'KB');
    console.log('사진 ' + sizes.length + '장 · 합계 ' + Math.round(all / 1024) + 'KB · 올릴 파일 ' + Math.round(fs.statSync(up).size / 1024) + 'KB');
    console.log('→ ' + up + '\n→ ' + pv);
}
if (require.main === module) { try { main(); } catch (e) { console.error('실패: ' + e.message); process.exit(1); } }
module.exports = { inline, preview, threeLines, em };
