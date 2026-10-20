#!/usr/bin/env node
/**
 * 파일명: scripts/notice/build_notice.js
 * 역할  : 패치노트 원본(.md + 옆 폴더 사진)을 게시판에 올릴 파일 하나로 묶고, 게시판 칸 모양 미리보기를 만든다.
 *         사진(![설명](shots/a.jpg))을 파일 안(data:image/jpeg;base64)으로 넣어 → <이름>.upload.md
 *         같은 변환기(client/js/notice/board/markdown_import.js)로 그린 미리보기 → <이름>.preview.html (게시글 칸 폭·색 — 대략)
 * [연계] NOTICE.md(작성 규칙) · client/js/notice/board/markdown_import.js(toHtml — 앱 [마크다운 파일 불러오기]와 같은 변환) · docs/notice/<날짜_이름>/
 * [실행] node scripts/notice/build_notice.js docs/notice/2026-10-20_ai-briefing-risk/patchnote.md [출력폴더]
 *        출력폴더를 안 주면 원본 옆에 만든다. 사진 한 장 600KB·합계 4MB 를 넘으면 실패(게시글 저장 한도 5MB — server_config express.json).
 */
'use strict';
const fs = require('fs'), path = require('path');
const MD = require('../../client/js/notice/board/markdown_import.js');
const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };
const ONE_MAX = 600 * 1024, ALL_MAX = 4 * 1024 * 1024;

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
 * 게시글 상세 칸(#promo-detail-content — 휴대폰 390px 폭에서 본문 약 318px, 배경 var(--card-bg) #161b2d, 글 #cbd5e1, 줄간격 1.8, 사진 폭 맞춤·둥근 모서리 8px)을 흉내 낸 미리보기.
 * 예: preview({title:'10월 패치노트', html:'<p>…</p>'}) → '<!doctype html>…'
 * @param {{title:string, html:string}} r @returns {string} [연계] ← main · 실제 모양은 앱 [마크다운 파일 불러오기] 뒤 편집기에서 최종 확인
 */
function preview(r) {
    return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + (r.title || '패치노트') + ' — 미리보기</title><style>' +
        'body{margin:0;background:#0b1220;font-family:"Noto Sans KR",system-ui,sans-serif;display:flex;justify-content:center;padding:24px 0}' +
        '.card{width:358px;background:#161b2d;border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.5);padding:10px 20px 20px;box-sizing:border-box}' +
        'h1.t{margin:0 0 4px;font-size:1.3rem;font-weight:700;color:#fff;line-height:1.3}.meta{font-size:.8rem;color:#64748b;margin-bottom:8px;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:8px}' +
        '.c{color:#cbd5e1;line-height:1.8;font-size:14px}.c h2{font-size:1.25em;color:#e2e8f0;margin:1em 0 .3em}.c h3{font-size:1.1em;color:#e2e8f0;margin:.9em 0 .3em}.c p{margin:0}' +
        '.c img{max-width:100%;height:auto;border-radius:8px;margin:10px 0}.c ul,.c ol{padding-left:1.4em;margin:0}.c blockquote{border-left:4px solid #ccc;margin:5px 0;padding-left:16px}.c a{color:#06c}' +
        '</style></head><body><div class="card"><h1 class="t">' + (r.title || '(제목 없음)') + '</h1><div class="meta">미리보기 — 실제 게시판 칸 폭(휴대폰)·색에 맞춤</div><div class="c">' + r.html + '</div></div></body></html>';
}

/** 실행. @returns {void} [연계] ← 명령줄 */
function main() {
    const src = process.argv[2]; if (!src) { console.error('쓰는 법: node scripts/notice/build_notice.js <원본.md> [출력폴더]'); process.exit(2); }
    const dir = path.dirname(path.resolve(src)), outDir = path.resolve(process.argv[3] || dir), base = path.basename(src).replace(/\.md$/i, '');
    const { md, sizes } = inline(fs.readFileSync(src, 'utf8'), dir), all = sizes.reduce((a, [, n]) => a + n, 0);
    if (all > ALL_MAX) throw new Error('사진 합계가 4MB 를 넘음: ' + all);
    const r = MD.toHtml(md);
    if (r.warnings.length) throw new Error('넣지 못한 사진: ' + r.warnings.join(' / '));
    fs.mkdirSync(outDir, { recursive: true });
    const up = path.join(outDir, base + '.upload.md'), pv = path.join(outDir, base + '.preview.html');
    fs.writeFileSync(up, md); fs.writeFileSync(pv, preview(r));
    console.log('제목: ' + (r.title || '(없음 — 맨 처음 # 제목을 쓰세요)'));
    for (const [s, n] of sizes) console.log('  사진 ' + s + ' ' + Math.round(n / 1024) + 'KB');
    console.log('사진 ' + sizes.length + '장 · 합계 ' + Math.round(all / 1024) + 'KB · 올릴 파일 ' + Math.round(fs.statSync(up).size / 1024) + 'KB');
    console.log('→ ' + up + '\n→ ' + pv);
}
if (require.main === module) { try { main(); } catch (e) { console.error('실패: ' + e.message); process.exit(1); } }
module.exports = { inline, preview };
