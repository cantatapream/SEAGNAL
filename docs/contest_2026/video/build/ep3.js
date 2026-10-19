/* 3편 「사고 나던 곳을 미리」 — 58.5초. 박: 마디 n = 2(n−1)초. 킥 연타 V1 · 4박 V2 · 저음↑ V14 · 화음↑ V18 · 라이저 V33 · 드롭 V34 · 숨 고르기 V50 · 마지막 강박 V58
   위험예측 색은 실제 앱 값(data/risk.js: /api/risk-forecast/coast/frame, 10-19 17:46 KST 받음). 챗봇 질문·생각 중·첫 단락은 앱 모양대로 재구성(「재구성 화면」 표시). */
'use strict';
const B = (n, b = 1) => 2 * (n - 1) + 0.5 * (b - 1);
const HIT = 58.0;
window.DUR = 58.5;
const BAND = [{ c: '#2fb36b', n: '평소 수준' }, { c: '#f2c230', n: '다소 높음' }, { c: '#fb923c', n: '높음' }, { c: '#e0322c', n: '매우 높음' }];
baseCSS(COMMON_CSS + `
.mapc{position:absolute;left:0;top:0;width:1000px;height:1040px;transform-origin:500px 500px}
.cap{font-weight:800;font-size:72px;letter-spacing:-0.03em;color:${C.navy}}
.desc{font-weight:600;font-size:32px;color:#3B4A63;letter-spacing:-0.02em}
.lg .gc>div{display:flex;align-items:center;gap:12px;height:100%;padding:0 20px;font-weight:700;font-size:24px;color:${C.navy};white-space:nowrap}
.lg i{width:18px;height:18px;border-radius:50%;flex:none}
.datep .gc>div{display:flex;align-items:center;justify-content:center;gap:18px;height:100%;font-weight:800;font-size:28px;color:${C.navy}}
.bar3{position:absolute;left:0;top:0;height:26px;border-radius:13px;background:${C.teal};transform-origin:0 50%}
.blab3{position:absolute;font-weight:700;font-size:27px;color:${C.navy};white-space:nowrap}
.bval{position:absolute;font-weight:800;font-size:30px;color:${C.tealText};white-space:nowrap}
.tpill .gc>div{display:flex;align-items:center;justify-content:center;height:100%;font-weight:800;font-size:34px;color:${C.navy}}
.tag2{position:absolute;padding:6px 14px;border-radius:999px;font-weight:800;font-size:20px;color:#fff;white-space:nowrap;box-shadow:0 6px 14px rgba(0,0,0,.3)}
.ex{position:absolute;width:560px;height:150px;border-radius:24px}
.ex .gc>div{padding:18px 26px}
.ex .t{font-weight:700;font-size:22px;color:#5E6B80}
.ex .w{display:inline-block;position:relative;margin:12px 22px 0 0;font-weight:800;font-size:34px;color:${C.navy}}
.ex .w s{position:absolute;left:-4px;right:-4px;top:52%;height:5px;background:${C.orange};border-radius:3px;transform-origin:0 50%;text-decoration:none}
.flow .gc>div{display:flex;flex-direction:column;justify-content:center;height:100%;padding:0 18px;font-weight:800;font-size:24px;color:${C.navy}}
.flow small{font-weight:600;font-size:18px;color:#5E6B80;margin-top:4px}
.arrow{position:absolute;font-weight:800;font-size:34px;color:${C.tealText}}
.chatbg{position:absolute;left:0;top:0;width:400px;height:816px;background:rgb(5,9,16);overflow:hidden}
.cpanel{position:absolute;left:23px;top:0;width:354px;height:816px;background:linear-gradient(90deg,rgb(35,43,54) 0 2px,rgb(28,42,53) 2px 345px,rgb(9,10,15) 345px 353px,rgb(32,34,43) 353px)}
.cside{position:absolute;top:0;width:23px;height:816px;background:rgb(5,9,16)}
.qb3{position:absolute;left:56px;width:300px;padding:12px 16px;border-radius:16px;background:#F7D84B;color:#1B1B1B;font-weight:600;font-size:15.5px;line-height:1.55}
.blab{position:absolute;left:38px;font-size:12.5px;color:#93A3B8;font-weight:500}
.ans{position:absolute;left:36px;width:320px;padding:12px 12px 12px 12px;border-radius:16px;background:rgb(50,71,90);color:#E9EEF4;font-weight:400;font-size:15.6px;line-height:20px;word-break:keep-all}
.ans b{color:#F2C94C;font-weight:700}
.think{position:absolute;left:36px;width:250px;height:92px;border-radius:16px;background:rgb(49,70,89);padding:14px}
.sk{height:10px;border-radius:5px;background:#5A7088;margin-bottom:8px}
.st{font-size:13px;color:#B9C7D6;font-weight:600;margin-top:6px}
.dots i{display:inline-block;width:6px;height:6px;border-radius:50%;background:#B9C7D6;margin-left:4px}
.inp{position:absolute;left:80px;top:15px;width:238px;height:37px;border-radius:19px;background:rgb(40,57,73);overflow:hidden;display:flex;align-items:center;justify-content:flex-end;padding:0 12px}
.inp span{color:#fff;font-size:14.5px;font-weight:500;white-space:nowrap}
.rc{position:absolute;right:12px;top:58px;font-size:11px;font-weight:700;color:#9AA7B6;border:1px solid #66768A;border-radius:6px;padding:1px 6px;background:rgba(4,11,19,.6)}
.thumb{position:absolute;left:0;top:0;width:210px;height:300px;border-radius:22px;background-size:cover;background-position:top center;box-shadow:0 16px 36px rgba(11,30,63,.25)}
.big{font-weight:800;font-size:124px;letter-spacing:-0.04em;color:${C.navy}}
`);
glassDefs();
const stage = document.getElementById('stage');
const world = mk('div', 'world', stage), hud = mk('div', 'hud', stage), fx = mk('div', 'hud', stage);
const IMG = n => `assets/${n}`;
const logo = Logo(fx);
const M = window.MAP, RK = window.RISK;
const MX = 1240, MY = 540;
const sp = i => [MX + M.spots[i][0], MY + M.spots[i][1]];
const PANPO = 988, YEONGDO = 35;

// ── 지도: 육지 + 관광지 1,354점 (점 3겹: 바탕 남색 · 오늘 색 · 내일 색) ──
const mapc = mk('div', 'mapc', world);
mapc.innerHTML = `<svg width="1000" height="1040" viewBox="-500 -500 1000 1040" style="overflow:visible"><defs><clipPath id="cpLand"><circle id="cpLandC" cx="0" cy="0" r="0"/></clipPath></defs>
<path d="${M.land}" fill="#E7EBF1" clip-path="url(#cpLand)"/><g id="d0"></g><g id="d1"></g><g id="d2"></g></svg>`;
const svg = mapc.querySelector('svg');
const NS = 'http://www.w3.org/2000/svg';
const D = [[], [], []];
const [px0, py0] = M.spots[PANPO];
const dist = M.spots.map(s => Math.hypot(s[0] - px0, s[1] - py0)), dmax = Math.max(...dist);
M.spots.forEach((s, i) => { for (let L = 0; L < 3; L++) { const c = document.createElementNS(NS, 'circle'); c.setAttribute('cx', s[0]); c.setAttribute('cy', s[1]); c.setAttribute('r', 0);
  c.setAttribute('fill', L === 0 ? C.navy : BAND[(L === 1 ? RK.today : RK.tomorrow)[i]].c); svg.querySelector('#d' + L).appendChild(c); D[L].push(c); } });
const tAppear = dist.map(d => B(4) + 0.3 + 1.4 * d / dmax);
const tBloom = RK.today.map((b, i) => B(5, 1 + b) + 0.12 * ((i * 37) % 10) / 10);
const changed = RK.tomorrow.map((b, i) => b !== RK.today[i]);
const tTom = M.spots.map((s, i) => B(6) + 0.35 + 0.5 * ((i * 53) % 100) / 100);
const cnt = (arr, b) => arr.filter(x => x === b).length;

// ── 소개 ───────────────────────────────────────────────
const pill = mk('div', 'win', world);
const pillT = mk('div', 'pilltxt', pill); const pillM = maskText(pillT, '연안 안전', '');
const subA = maskText(hud, '사고 나던 곳을 미리', 'hl'); subA.el.style.cssText += ';left:960px;top:600px;transform:translateX(-50%);font-size:52px';
const subB = maskText(hud, '현직 해양경찰관이 AI와 만든 해양안전 앱 SEA:GNAL', 'sub'); subB.el.style.cssText += ';left:960px;top:684px;transform:translateX(-50%);font-size:28px;color:#5E6B80';
const corner = mk('div', 'corner', hud, '3 / 3 &nbsp;사고 나던 곳을 미리'); corner.style.background = C.bg;   // 확대된 카드가 뒤로 지나가도 읽히게
// 판포포구 설명
function cap(txt, cls, x, y, size) { const m = maskText(hud, txt, cls); m.el.style.left = px(x); m.el.style.top = px(y); if (size) m.el.style.fontSize = px(size); return m; }
const ppT = cap('제주 판포포구', 'cap', 110, 330), ppD1 = cap('저조 때 다이빙 사고가 해마다 되풀이되던 곳', 'desc', 114, 432),
  ppD2 = cap('해양경찰 지정 <b style="color:#E0322C">사망사고 발생구역</b>', 'desc', 114, 432), ppS = cap('2020~2024년 주변 사고 4건 중 3건이 8~9월 · 앱 자료', 'small', 116, 490, 24);
// 머리말
const hA = HL(hud, ['관광지 1,354곳,', '**오늘·내일**'], 110, 120, { size: 84 });
const hB = HL(hud, ['확률이 아니라,', '**평소의 몇 배**'], 110, 120, { size: 84 });
const hC = HL(hud, ['해양경찰관 교대 직전,', '**하루 세 번 브리핑**'], 110, 120, { size: 84 });   // 07:30·17:30·23:00 = 연안 안전 담당 해양경찰관 교대 직전(사용자 설계 의도, 게시글 수정본 59행)
const hCs = cap('같은 브리핑을 누구나, 관할을 골라 봅니다', 'desc', 114, 340);
const hD = HL(hud, ['결론은 규칙이,', '**해설은 AI가**'], 110, 120, { size: 84 });
const hE = HL(hud, ['근거 조문까지,', '**쉬운 말로**'], 110, 120, { size: 84 });
// 범례(오늘·내일 개수)
const LG = BAND.map((b, k) => { const g = Glass(hud, 'lg'); g.el.style.cssText += ';width:290px;height:64px';
  g.gc.innerHTML = `<div><i style="background:${b.c}"></i>${b.n} <span class="n" style="color:#0E9FAD;margin-left:auto"></span></div>`;
  const od = Odo(g.gc.querySelector('.n'), String(Math.max(cnt(RK.today, k), cnt(RK.tomorrow, k))).replace(/\B(?=(\d{3})+(?!\d))/g, ',')); return { g, od, k }; });
const lgSrc = cap('앱 값 · 2026. 10. 19. 17:46 받음', 'small', 116, 590, 22);
const datep = Glass(world, 'datep'); datep.el.style.cssText += ';width:380px;height:68px';
datep.gc.innerHTML = '<div><span style="color:#8A93A3">‹</span><span class="mask" style="position:relative;display:inline-block;height:1.2em;overflow:hidden"><span class="in" style="display:block"><span style="display:block;height:1.2em">10월 19일 (오늘)</span><span style="display:block;height:1.2em">10월 20일 (내일)</span></span></span><span style="color:#0E9FAD">›</span></div>';
const dateRoll = datep.gc.querySelector('.in');
const cnt1354 = Glass(hud); cnt1354.el.style.cssText += ';width:300px;height:76px';
cnt1354.gc.innerHTML = '<div class="gpill" style="font-size:30px">관광지 <span class="o" style="color:#0E9FAD"></span>곳</div>';
const od1354 = Odo(cnt1354.gc.querySelector('.o'), '1,354');
// 막대(앱 [기준 상세]·발표자료 33장 값)
const BARS = [['주말 행사가 있는 날', 2.1, '약 2.1배'], ['사람이 평소의 2배 붐빌 때', 1.96, '1.96배'], ['위험구역 한 종류 3곳 이상', 1.84, '1.84배'], ['8월', 1.67, '1.67배']]
  .map(([l, v, s], i) => ({ bar: mk('div', 'bar3', hud), lab: maskText(hud, l, 'blab3'), val: maskText(hud, s, 'bval'), v, i }));
const barSrc = cap('연안 인명사고 3,075건(2020~2024) 통계 분석', 'small', 116, 760, 22);
const TP = ['07:30', '17:30', '23:00'].map(s => { const g = Glass(hud, 'tpill'); g.el.style.cssText += ';width:180px;height:80px'; g.gc.innerHTML = `<div>${s}</div>`; return g; });
// 브리핑 검사 예시·흐름
const ex = Glass(hud, 'ex'); ex.gc.innerHTML = '<div><div class="t">AI 문장 검사 · 예시</div><span class="w">안전합니다<s></s></span><span class="w">사고가 납니다<s></s></span></div>';
const exS = [...ex.gc.querySelectorAll('s')];
const exNote = cap('단정하는 말은 검사기가 막습니다', 'small', 116, 590, 24);
const FL = [['서버 규칙', '단계·권고'], ['AI', '해설 문단'], ['검사기', '숫자·지명 대조']].map(([a, b]) => { const g = Glass(hud, 'flow'); g.el.style.cssText += ';width:200px;height:96px;border-radius:22px'; g.gc.innerHTML = `<div>${a}<small>${b}</small></div>`; return g; });
const ARR = [0, 1].map(() => mk('div', 'arrow', hud, '→'));
const flN = cap('검사를 못 통과하면 → 규칙 문단', 'small', 116, 790, 24);
// 챗봇 쪽 설명
const aiTag = mk('div', 'tag', hud, 'AI 법률 챗봇 · 심사 기간 공개');
const kb1 = cap('해양 법령 70여 개 · 행정규칙 710종', 'desc', 114, 420), kb2 = cap('별표 2,186건 · 서식 3,105건', 'desc', 114, 470);
const CC = [['쉽게 말하면 — 결론부터', B(18) + 0.2, B(19, 2)], ['근거 조문을 함께', B(19, 2), B(21, 2)], ['처벌·과태료까지', B(21, 2), B(23)], ['어느 AI가 답했는지, 참고용임을 표시', B(23), B(24)]]
  .map(([s, t0, t1]) => ({ m: cap(s, 'cap', 110, 400, 52), t0, t1 }));
// 끝
const bigJ = maskText(world, '판단은 <em>사람이</em>', 'big');
const P3 = ['위험예측', 'AI 연안 안전 브리핑', 'AI 법률 챗봇'].map(s => { const g = Glass(world); g.el.style.cssText += ';height:72px;width:' + (s.length * 30 + 70) + 'px'; g.gc.innerHTML = `<div class="gpill" style="font-size:28px;justify-content:center">${s}</div>`; return g; });
const install = maskText(hud, '구글 플레이 <b style="color:#0E9FAD">SEA:GNAL</b> &nbsp;·&nbsp; seagnal-server.fly.dev', 'sub');
install.el.style.cssText += ';left:960px;top:820px;transform:translateX(-50%);font-size:36px;font-weight:700;color:#0B1E3F';
const credit = maskText(hud, '자료: 기상청·국립해양조사원·해양교통안전공단·해양경찰청·법제처 등 · 배경음: 직접 합성', 'small');
credit.el.style.cssText += ';left:960px;top:885px;transform:translateX(-50%);font-size:22px';
const thumbs = ['s31_2.png', 's33_1.png', 'v06.jpg'].map(f => { const e = mk('div', 'thumb', world); e.style.backgroundImage = `url(${IMG(f)})`; e.style.zIndex = '5'; return e; });   // 원(body)보다 위 — 카드가 원으로 빨려 들어감

// ── 하나의 도형: 알약 → 휴대폰 → 점 / 점 → 휴대폰 → 웹 카드 → 휴대폰(챗봇) → 원 → 선 → 덮개 → 알약 → 점 ──
const body = mk('div', 'win', world);
const pscr = mk('div', 'scr', body); pscr.style.borderRadius = '44px';
const punch = mk('div', 'punch', body);
function shotLayer(src, w, top = 0, bg) { const d = mk('div', 'scr', pscr); if (bg) d.style.background = bg; const im = mk('img', 'shot', d); im.src = IMG(src); im.style.width = px(w); im.style.top = px(top); return d; }
const S = 400 / 980;
const L_pp = mk('div', 'scr', pscr); const ppTop = mk('img', 'shot', L_pp); ppTop.src = IMG('pp_top.png'); ppTop.style.width = '400px';
const ppBot = mk('img', 'shot', L_pp); ppBot.src = IMG('pp_bot.png'); ppBot.style.width = '400px';
const bxPP = Box(L_pp, 56 * S, 886 * S, 784 * S, 52 * S, '#E0322C');
const L_312 = shotLayer('s31_2.png', 400);
const bxIdx = Box(L_312, 64 * S, 878 * S, 204 * S, 204 * S), bx42 = Box(L_312, 387 * S, 954 * S, 119 * S, 46 * S);
const L_333 = shotLayer('s33_3.png', 400);
const L_331 = mk('div', 'scr', pscr); L_331.style.cssText += ';width:544px;height:781px;background:#0B1529'; const im331 = mk('img', 'shot', L_331); im331.src = IMG('s33_1.png'); im331.style.width = '548px';
const K331 = 548 / 595;   // 595×848 → 548×781: 카드 안쪽 높이에 맞춤(오른쪽 4px 잘림)
const tagR = mk('div', 'tag2', L_331, '규칙'); tagR.style.background = C.navy; tagR.style.boxShadow = '0 0 0 2px #fff inset,0 6px 14px rgba(0,0,0,.3)';
const tagA = mk('div', 'tag2', L_331, 'AI'); tagA.style.background = '#0FA3B1';
const chk = mk('div', 'abs', L_331); chk.style.cssText += `;height:3px;width:${500 * K331}px;background:${C.teal}`;
const CK = [[212, 357], [222, 378]].map(([x, y]) => { const e = mk('div', 'tag2', L_331, '✓'); e.style.cssText += `;background:${C.teal};padding:2px 8px;font-size:16px;left:${x * K331}px;top:${y * K331 - 12}px`; return e; });
// 챗봇(재구성 + 실제 캡처 이어 붙인 띠)
const L_chat = mk('div', 'chatbg', pscr);
mk('div', 'cpanel', L_chat);   // 캡처 속 대화창 판(x 23~377)과 같은 판 — 재구성 부분과 실제 캡처가 이어지게(10-19 「화면이 틀어졌다」)
const chatView = mk('div', 'abs', L_chat); chatView.style.cssText += ';left:0;top:48px;width:400px;height:692px;overflow:hidden';
const chatIn = mk('div', 'abs', chatView); chatIn.style.cssText += ';left:0;top:0;width:400px';
const qb = mk('div', 'qb3', chatIn, '낚시어선업을 하려고하는데 요건과 제한사항 등에 대해 알려줘'); qb.style.top = '16px';
const blab = mk('div', 'blab', chatIn, '해양법령 도우미');
const think = mk('div', 'think', chatIn, '<div class="sk" style="width:190px"></div><div class="sk" style="width:130px"></div><div class="st"><span class="tx"></span><span class="dots"><i></i><i></i><i></i></span></div>');
const STEPS = ['생각하고 있습니다', '관련 법령을 찾고 있습니다', '조문 구조를 확인하고 있습니다', '답변을 정리하고 있습니다'];   // ai_chat.js:2776
const ANS1 = '쉽게 말하면, 바다에서 낚시어선업을 하려면 「낚시 관리 및 육성법」에 따라 시장·군수·구청장에게 신고해야 합니다. 이 신고를 하려면 선박의 종류, 톤수, 선령, 설비, 선장의 자격, 전문교육 이수, 보험 가입 등 여러 요건을 갖춰야 하며, 영업 중에도 안전성 검사, 영업구역 준수, 승선정원 및 안전요원 배치, 출입항 신고, 출항 제한 준수, 음주 조종 금지 등 다양한 의무를 지켜야 합니다. 이러한 요건이나 의무를 위반하면 징역, 벌금, 과태료 또는 영업정지·폐쇄와 같은 행정처분을 받을 수 있습니다.';
const ANS2 = '<br><br><b>1. 낚시어선업의 정의 및 적용 범위</b><br><br>*&nbsp; <b>정의</b>: 낚시어선업은 낚시인을 낚시어선에 승선시켜 낚시터로 안내하거나 그 어선에서 낚시를 할 수 있도록 하는 영업을 말합니다. 여기서 낚시어선은 「어선법」에 따라 등록된 어선으로서 낚시어선업에 쓰이는 어선을 의미하며, 낚시어선업자는 「낚시 관리 및 육성법」';
const ans = mk('div', 'ans', chatIn);
const stripW = mk('div', 'abs', chatIn); stripW.style.cssText += ';left:0;width:400px;height:3727px';
const stripI = mk('img', 'shot', stripW); stripI.src = IMG('chat_strip.jpg'); stripI.style.width = '400px';
const bxBasis = Box(stripW, 42, 351, 300, 44), bxPen = Box(stripW, 42, 2006, 300, 64), bxEnd = Box(stripW, 42, 3586, 300, 54);
const head = mk('img', 'shot', L_chat); head.src = IMG('chat_head.png'); head.style.width = '400px';
const foot = mk('div', 'abs', L_chat); foot.style.cssText += ';left:0;top:740px;width:400px;height:76px';
const footI = mk('img', 'shot', foot); footI.src = IMG('chat_foot.png'); footI.style.width = '400px';
const inp = mk('div', 'inp', foot, '<span></span>'); const inpT = inp.firstChild;
[0, 377].forEach(x => { const e = mk('div', 'cside', L_chat); e.style.left = px(x); });   // 캡처(띠·머리·바닥) 양옆에 비치던 뒤 화면 가림
{ const e = mk('div', 'cside', L_chat); e.style.cssText += ';left:0;top:804px;width:400px;height:12px'; }   // 바닥 캡처의 판 아래(y 63~)도 뒤 화면이라 가림
{ const e = mk('div', 'cside', L_chat); e.style.cssText += ';left:357px;top:784px;width:20px;height:20px;background:radial-gradient(circle at 0 0,transparent 17px,rgb(5,9,16) 18px)'; }   // 판 오른쪽 아래 둥근 모서리 밖(빨간 배지가 비침)
const recon = mk('div', 'rc', L_chat, '재구성 화면');
const QTXT = '낚시어선업을 하려고하는데 요건과 제한사항 등에 대해 알려줘';
const LAYERS = [L_pp, L_312, L_333, L_331, L_chat];
const iris = Iris(fx);
const cur = Cursor(world);
let ansFullH = 0;

// ── 커서 ───────────────────────────────────────────────
const PX = 1050, PY = 132;
const CARD = { x: 985, y: 140, w: 560, h: 797 };
const cardPt = (x, y) => [CARD.x + 8 + x * K331, CARD.y + 8 + y * K331];
let YD = [0, 0];
function buildPath() {
  YD = sp(YEONGDO);
  const [hx, hy] = cardPt(545, 805);
  cur.path = [[B(2, 3), 1720, 1000], [B(2, 4) - 0.12, 975, 548], [B(2, 4) + 0.15, 970, 546],
    [B(3, 2) + 0.2, 1250, 840], [B(3, 3) - 0.1, 1250, 840], [B(3, 3) + 0.35, 1250, 540], [B(4), 1400, 640],
    [B(5, 3), 1500, 220], [B(5, 4) + 0.35, MX + 188, 76], [B(6) + 0.1, MX + 190, 76],
    [B(6, 3), YD[0] + 140, YD[1] + 120], [B(6, 4) + 0.3, YD[0] + 4, YD[1] + 4], [B(7), YD[0] + 3, YD[1] + 3],
    [B(7, 3), 1400, 560], [B(8) - 0.1, PX + 120, PY + 395], [B(8, 3), PX + 210, PY + 405],
    [B(9), 700, 470], [B(9, 4), 700, 700], [B(10) - 0.2, PX + 330, PY + 600], [B(10), PX + 330, PY + 600], [B(10) + 0.4, PX + 120, PY + 600],
    [B(11) - 0.2, PX + 116, PY + 519], [B(11, 2), PX + 116, PY + 519],
    [B(12), ...cardPt(380, 300)], [B(12, 3), ...cardPt(140, 330)], [B(13), ...cardPt(260, 350)], [B(13, 3), ...cardPt(260, 410)],
    [B(14), 500, 560], [B(14, 4), 700, 760], [B(15, 3), hx - 2, hy - 2], [B(15, 4), hx, hy],
    [B(16) + 0.15, PX + 200, PY + 773], [B(16, 2) + 0.4, PX + 230, PY + 776], [B(16, 3) + 0.05, PX + 345, PY + 773],
    [B(17), PX + 300, PY + 500], [B(17, 4), PX + 386, PY + 120]];
  for (let t = B(18, 4); t <= B(23, 2); t += 0.25) cur.path.push([t, PX + 386, PY + 120 + 560 * chatScrollU(t)]);
  cur.path.push([B(24), 1300, 760], [B(26), 1100, 760], [B(28) - 0.2, 760, 860], [B(28, 4) - 0.1, 1220, 860]);
  cur.hide = [[B(15, 4) + 0.08, B(16) + 0.1], [B(29), 99]];
  [B(2, 4), B(3, 3) - 0.1, B(6) + 0.05, B(7), B(10), B(11, 2), B(15, 4), B(16) + 0.15, B(16, 3) + 0.05].forEach(t => cur.click(t));
}
// 챗봇 띠 스크롤 진행(0~1): 근거(V37~37.8)·처벌(V41~41.8)에서 잠깐 느려짐
let SCROLL_MAX = 1;
function chatScrollU(t) { return keys(t, [[B(18, 4), 0], [B(19, 3), 0.11], [B(19, 4) + 0.3, 0.125], [B(21, 3), 0.58], [B(21, 4) + 0.3, 0.6], [B(22, 4), 1]], easeIO); }
cue(B(16) + 0.2, 'typing', 0.6); cue(B(16) + 0.85, 'typing', 0.5); cue(B(17, 4), 'pop', 0.3);
[B(5), B(5, 2), B(5, 3), B(5, 4)].forEach(t => cue(t, 'pop', 0.5));
[B(9), B(9, 2), B(9, 3), B(9, 4)].forEach(t => cue(t, 'pop', 0.45));
[B(11), B(11, 2), B(12, 2) + 0.5, B(12, 3) + 0.5].forEach(t => cue(t, 'pop', 0.5));
[B(26), B(26, 2), B(26, 3), B(27), B(27, 2), B(27, 3)].forEach(t => cue(t, 'pop', 0.5));

// ── 카메라 ─────────────────────────────────────────────
let cam = null;
function buildCam() {
  cam = { x: [[B(7), YD[0], { z: .85, f: 1.6 }], [B(7) + 0.6, 960, { z: .9, f: 1.8 }], [B(8) + 0.2, 1130, { z: .85, f: 1.5 }], [B(9), 960, { z: .9, f: 1.6 }],
      [B(12), 1000, { z: .85, f: 1.5 }], [B(15), 960, { z: .9, f: 1.6 }]],
    y: [[B(7), YD[1], { z: .85, f: 1.6 }], [B(7) + 0.6, 540, { z: .9, f: 1.8 }], [B(8) + 0.2, 520, { z: .85, f: 1.5 }], [B(9), 540, { z: .9, f: 1.6 }],
      [B(12), 470, { z: .85, f: 1.5 }], [B(15), 540, { z: .9, f: 1.6 }]],
    z: [[B(7), 2.6, { z: .85, f: 1.6 }], [B(7) + 0.6, 1, { z: .9, f: 1.8 }], [B(8) + 0.2, 1.6, { z: .85, f: 1.5 }], [B(9), 1, { z: .9, f: 1.6 }],
      [B(12), 1.5, { z: .85, f: 1.5 }], [B(15), 1, { z: .9, f: 1.6 }]] };
  // 속도감(사용자 요청 10-19): 장면마다 확대·이동을 더함
  cam.x.push([B(3) + 0.4, 1100, { z: .85, f: 2 }], [B(4) - 0.1, 960, { z: .9, f: 2.2 }], [B(10, 4), 1080, { z: .85, f: 2 }], [B(11, 2) + 0.3, 960, { z: .9, f: 2 }],
    [B(16) + 0.15, 1070, { z: .85, f: 2.2 }], [B(18), 960, { z: .55, f: 2 }]);
  cam.y.push([B(3) + 0.4, 520, { z: .85, f: 2 }], [B(4) - 0.1, 540, { z: .9, f: 2.2 }], [B(10, 4), 640, { z: .85, f: 2 }], [B(11, 2) + 0.3, 540, { z: .9, f: 2 }],
    [B(16) + 0.15, 760, { z: .85, f: 2.2 }], [B(16, 3) + 0.2, 380, { z: .85, f: 2 }], [B(18), 540, { z: .55, f: 2 }]);
  cam.z.push([B(3) + 0.4, 1.35, { z: .85, f: 2 }], [B(4) - 0.1, 1.0, { z: .9, f: 2.2 }], [B(4) + 0.2, 1.06, { z: .9, f: .9 }], [B(5), 1.0, { z: .45, f: 2.4 }],
     [B(10, 4), 1.5, { z: .85, f: 2 }], [B(11, 2) + 0.3, 1.0, { z: .9, f: 2 }],
    [B(16) + 0.15, 1.6, { z: .85, f: 2.2 }], [B(16, 3) + 0.2, 1.4, { z: .85, f: 2 }], [B(18), 1.0, { z: .55, f: 2 }]);
  // 지도: 피어날 때 남해안 쪽 → 날짜 단추 보이게 원위치 → 「내일」 누르면 부산(내일 매우 높음 17곳이 모두 부산 중구·서구·영도구)
  cam.x.push([B(5, 2), 1180, { z: .85, f: 1.8 }], [B(5, 4) - 0.1, 960, { z: .9, f: 2.2 }], [B(6) + 0.25, MX + 128, { z: .85, f: 1.8 }]);
  cam.y.push([B(5, 2), 620, { z: .85, f: 1.8 }], [B(5, 4) - 0.1, 540, { z: .9, f: 2.2 }], [B(6) + 0.25, MY + 92, { z: .85, f: 1.8 }]);
  cam.z.push([B(5, 2), 1.3, { z: .85, f: 1.8 }], [B(5, 4) - 0.1, 1.0, { z: .9, f: 2.2 }], [B(6) + 0.25, 2.0, { z: .85, f: 1.8 }]);
  // 브리핑 카드: 박마다 아래로 훑기 / 끝: 천천히 다가감
  cam.y.push([B(13), 520, { z: .85, f: 2 }], [B(14), 560, { z: .85, f: 2 }]);
  cam.z.push([B(13), 1.55, { z: .7, f: 2.4 }], [B(14), 1.5, { z: .7, f: 2.4 }], [B(24), 1.0, { z: .9, f: 2 }], [B(24) + 0.3, 1.08, { z: .95, f: .5 }],
    [B(26), 1.0, { z: .5, f: 2.2 }], [B(26) + 0.3, 1.07, { z: .97, f: .3 }], [B(29), 1.0, { z: .9, f: 3 }]);
  // 같은 시각 값이 겹치지 않게 정렬(지도 확대 B(5,2)·B(6)+0.25 는 기존 0~1.0 변화와 섞여도 됨)
  for (const k of ['x', 'y', 'z']) cam[k].sort((p, q) => p[0] - q[0]);
}

window.seek = function (t) {
  if (!cam) { logo.measure(); buildPath(); buildCam(); ans.innerHTML = ANS1 + ANS2; ansFullH = ans.offsetHeight; }
  const cz = chain(t, 1, cam.z), cx = chain(t, 960, cam.x), cy = chain(t, 540, cam.y);
  world.style.transform = `translate(${W / 2}px,${H / 2}px) scale(${cz}) translate(${-cx}px,${-cy}px)`;
  // 로고
  let k = 0, mg = 0;
  if (t < 2.1) { k = chain(t, 0, [[0.25, .34, { z: .75, f: 3 }], [0.6, .67, { z: .75, f: 3 }], [1.0, 1, { z: .8, f: 3 }]]); mg = spr(t, 1.2, { z: .8, f: 3 }); }
  if (t >= HIT) { k = mg = 1 - spr(t, HIT, { z: .78, f: 2.6 }); if (t > DUR - 0.03) k = mg = 0; }
  const lOn = t < B(2) || t >= HIT; vis(logo.el, lOn); if (lOn) logo.set(clamp(k, 0, 1.2), clamp(mg));
  // 알약
  vis(pill, false);
  setRise(subA, t, B(2, 2), B(3), 'down'); setRise(subB, t, B(2, 3), B(3), 'down');
  const cOn = t >= B(2, 2) && t < B(29) + 0.05; vis(corner, cOn); if (cOn) corner.style.transform = `scale(${spr(t, B(2, 2), { z: .55, f: 2.4 })})`;

  // ── 하나의 도형 ──
  const [ppx, ppy] = sp(PANPO);
  const r = rectChain(t, { x: logo.cx - 17, y: 523, w: 34, h: 34, r: 17 }, [
    [B(2), { x: 960 - 200, y: 494, w: 400, h: 92, r: 46 }, { z: .62, f: 2.2 }],
    [B(3), { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: .72, f: 1.8 }],
    [B(4), { x: ppx - 7, y: ppy - 7, w: 14, h: 14, r: 7 }, { z: .9, f: 2.2 }],
    [B(7) + 0.55, { x: YD[0] - 5, y: YD[1] - 5, w: 10, h: 10, r: 5 }, { z: 1, f: 6 }],
    [B(7) + 0.6, { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: .75, f: 1.8 }],
    [B(11, 2) + 0.4, { x: CARD.x, y: CARD.y, w: CARD.w, h: CARD.h, r: 26 }, { z: .75, f: 2 }],
    [B(15, 4) + 0.3, { x: 1036, y: 118, w: 428, h: 844, r: 58 }, { z: 1, f: 6 }],
    [B(24), { x: 960 - 60, y: 540 - 60, w: 120, h: 120, r: 60 }, { z: .75, f: 2 }],
    [B(24, 4), { x: 960 - 350, y: 636, w: 700, h: 8, r: 4 }, { z: .8, f: 2 }],
    [B(29), { x: -260, y: -260, w: 2440, h: 1600, r: 0 }, { z: 1, f: 3.2 }],
    [B(29) + 0.32, { x: 960 - 310, y: 494, w: 620, h: 92, r: 46 }, { z: .8, f: 3 }],
    [B(29, 3) + 0.2, { x: logo.cx - 17, y: 523, w: 34, h: 34, r: 17 }, { z: .8, f: 3.4 }]]);
  const bOn = t >= B(2) && t < HIT && !on(t, B(4) + 0.6, B(7) + 0.5);
  vis(body, bOn);
  const phoneOn = on(t, B(3) + 0.1, B(4) + 0.08) || on(t, B(7) + 0.75, B(11, 2) + 0.4) || on(t, B(15, 4) + 0.3, B(24));
  const cardOn = on(t, B(11, 2) + 0.4, B(15, 4) + 0.3);
  if (bOn) {
    const bg = t < B(2) + 0.1 ? C.teal : (phoneOn || cardOn ? '#10141B' : C.navy);
    rectStyle(body, r.x, r.y, r.w, r.h, r.r, bg);
    body.style.boxShadow = phoneOn || cardOn ? '0 0 0 2px #2B3240 inset,0 30px 60px rgba(11,30,63,.22)' : (t < B(29) ? '0 16px 40px rgba(11,30,63,.18)' : 'none');
    const press = cur.clicks.some(c => t - c >= 0 && t - c < 0.2) && t < B(3);
    if (press) body.style.transform += ' scale(0.97)';
  }
  vis(pillT, t >= B(2) && t < B(3) + 0.3); pillT.style.display = (t >= B(2) && t < B(3) + 0.3) ? 'flex' : 'none';
  if (t >= B(2) && t < B(3) + 0.3) { body.appendChild(pillT); } setRise(pillM, t, B(2, 2), B(3), 'up');
  // 화면
  const scrOn = phoneOn || cardOn; vis(pscr, scrOn); vis(punch, phoneOn);
  if (scrOn) {
    const ins = cardOn ? 8 : 14;
    pscr.style.left = px(ins); pscr.style.top = px(ins); pscr.style.width = px(Math.max(0, r.w - 2 * ins)); pscr.style.height = px(Math.max(0, r.h - 2 * ins));
    pscr.style.borderRadius = px(cardOn ? 18 : 44);
    const shut = on(t, B(4) - 0.05, B(4) + 0.1) ? spr(t, B(4) - 0.05, { z: 1, f: 5 }) : (t >= B(24) - 0.2 && t < B(24) ? spr(t, B(24) - 0.2, { z: 1, f: 5 }) : 0);
    pscr.style.clipPath = shut > 0 ? `inset(${50 * shut}% 0 ${50 * shut}% 0)` : 'none';
    LAYERS.forEach(l => vis(l, false));
    let L = null;
    if (t < B(4) + 0.1) L = L_pp; else if (t < B(10) + 0.05) L = L_312; else if (t < B(11, 2) + 0.4) L = L_333; else if (t < B(15, 4) + 0.3) L = L_331; else L = L_chat;
    vis(L, true); L.style.transform = 'none';
    if (L === L_pp) { L.style.transform = `translateY(${816 * (1 - spr(t, B(3) + 0.15, { z: .85, f: 2 }))}px)`;
      const sc = easeIO(prog(t, B(3, 3), 0.45)); ppTop.style.top = px(-816 * sc); ppBot.style.top = px(816 - 816 * sc); bxPP.el.style.transform = `translateY(${816 - 816 * sc}px)`; bxPP.set(t, B(3, 3) + 0.5); }
    if (L === L_312) { const u = spr(t, B(7) + 0.75, { z: .85, f: 2.2 }); L.style.transformOrigin = '200px 400px'; L.style.transform = `scale(${Math.max(0.001, u)})`;
      bxIdx.set(t, B(8)); bx42.set(t, B(8, 2) + 0.1);
      if (t >= B(10) - 0.2) { vis(L_333, true); L_333.style.transform = `translateX(${400 * (1 - spr(t, B(10) - 0.2, { z: .9, f: 2.3 }))}px)`; L.style.transform = `translateX(${-400 * spr(t, B(10) - 0.2, { z: .9, f: 2.3 })}px)`; L_333.style.zIndex = 2; } }
    if (L === L_331) { im331.style.left = '0px';
      tagR.style.left = px(362 * K331); tagR.style.top = px(286 * K331); tagR.style.transform = `scale(${spr(t, B(12, 2) + 0.5, { z: .5, f: 2.6 })})`;
      tagA.style.left = px(138 * K331); tagA.style.top = px(316 * K331); tagA.style.transform = `scale(${spr(t, B(12, 3) + 0.5, { z: .5, f: 2.6 })})`;
      const cs = on(t, B(13), B(13) + 0.85); vis(chk, cs); if (cs) { chk.style.left = px(30 * K331); chk.style.top = px((342 + 72 * easeIO(prog(t, B(13), 0.8))) * K331); }
      CK.forEach((e, i) => { e.style.transform = `scale(${spr(t, B(13) + 0.35 + i * 0.3, { z: .45, f: 3 })})`; }); }
    if (L === L_chat) chatSeek(t);
  }
  // ── 지도 ──
  const mOn = on(t, B(4) - 0.1, B(8) + 0.5); vis(mapc, mOn);
  if (mOn) {
    const mx = t < B(7, 3) ? MX : MX - 1500 * spr(t, B(7, 3), { z: .95, f: 1.7 });
    mapc.style.transform = `translate(${mx - 500}px,${MY - 500}px)`;
    const lc = svg.querySelector('#cpLandC'); lc.setAttribute('cx', px0); lc.setAttribute('cy', py0); lc.setAttribute('r', 1300 * easeO(prog(t, B(4), 1.2)));
    for (let i = 0; i < D[0].length; i++) {
      D[0][i].setAttribute('r', t < tAppear[i] ? 0 : 3.1 * spr(t, tAppear[i], { z: .5, f: 3 }));
      D[1][i].setAttribute('r', t < tBloom[i] ? 0 : 4.0 * spr(t, tBloom[i], { z: .45, f: 3 }));
      D[2][i].setAttribute('r', !changed[i] || t < tTom[i] ? 0 : 4.6 * spr(t, tTom[i], { z: .45, f: 3 }));
    }
  }
  // 판포 설명
  setRise(ppT, t, B(3), B(4), 'up'); setRise(ppD1, t, B(3) + 0.12, B(3, 3), 'up'); setRise(ppD2, t, B(3, 3), B(4), 'up'); setRise(ppS, t, B(3, 3) + 0.25, B(4), 'up');
  hA.set(t, B(4), B(7), 'up');
  const cOn2 = on(t, B(4, 2), B(5)); vis(cnt1354.el, cOn2);
  if (cOn2) { cnt1354.el.style.transform = `translate(110px,350px) scale(${spr(t, B(4, 2), { z: .55, f: 2.4 })})`; od1354.set(1354 * easeO(prog(t, B(4, 2), 1.3))); }
  LG.forEach(({ g, od, k: b }) => { const t0 = B(5, 1 + b), o = on(t, t0, B(7)); vis(g.el, o); if (!o) return;
    g.el.style.transform = `translate(${110 + (b % 2) * 310}px,${350 + Math.floor(b / 2) * 80}px) scale(${spr(t, t0, { z: .55, f: 2.4 }) * (1 - spr(t, B(7), { z: 1, f: 3 }))})`;
    const a = cnt(RK.today, b), z = cnt(RK.tomorrow, b); od.set(lerp(a, z, easeIO(prog(t, B(6) + 0.35, 0.8)))); });
  setRise(lgSrc, t, B(5, 4), B(7), 'up'); lgSrc.el.style.top = '520px';
  const dOn = on(t, B(5, 4), B(7)); vis(datep.el, dOn);
  if (dOn) { datep.el.style.transform = `translate(${MX - 190}px,40px) scale(${spr(t, B(5, 4), { z: .55, f: 2.4 }) * (1 - spr(t, B(7), { z: 1, f: 3 }))})`;
    dateRoll.style.transform = `translateY(${-50 * easeIO(prog(t, B(6) + 0.1, 0.35))}%)`; }
  // 영도
  hB.set(t, B(7), B(10), 'up');
  // 막대
  BARS.forEach(o => { const t0 = B(9, 1 + o.i), y = 400 + o.i * 88, w = 420 * o.v / 2.1;
    const toPill = o.i < 3 ? spr(t, B(10), { z: .75, f: 2.2 }) : 0;
    const on_ = on(t, t0, B(10) + 0.6); vis(o.bar, on_ && !(o.i === 3 && t > B(10) + 0.3));
    if (on_) { const grow = easeO(prog(t, t0, 0.4)) * (1 - (o.i === 3 ? spr(t, B(10), { z: 1, f: 3 }) : 0));
      o.bar.style.width = px(lerp(w, 180, toPill)); o.bar.style.height = px(lerp(26, 80, toPill)); o.bar.style.borderRadius = px(lerp(13, 40, toPill));
      o.bar.style.transform = `translate(${lerp(110, 110 + o.i * 200, toPill)}px,${lerp(y + 40, 400, toPill)}px) scaleX(${grow})`;
      o.bar.style.background = toPill > 0.5 ? 'rgba(255,255,255,.0)' : C.teal; vis(o.bar, toPill < 0.97); }
    setRise(o.lab, t, t0 - 0.05, B(10), 'up'); o.lab.el.style.left = '110px'; o.lab.el.style.top = px(y);
    setRise(o.val, t, t0 + 0.25, B(10), 'up'); o.val.el.style.left = px(110 + w + 16); o.val.el.style.top = px(y + 28); });
  setRise(barSrc, t, B(9, 4), B(10), 'up'); barSrc.el.style.top = '760px';
  TP.forEach((g, i) => { const o = on(t, B(10) + 0.3, B(11, 2) + 0.4); vis(g.el, o); if (!o) return;
    g.el.style.transform = `translate(${110 + i * 200}px,400px) scale(${t < B(11, 2) ? 1 : 1 - easeI(prog(t, B(11, 2), 0.35))})`; });
  hC.set(t, B(10), B(12), 'up'); setRise(hCs, t, B(10, 3), B(12), 'up');
  hD.set(t, B(12), B(15, 4) + 0.1, 'up');
  // 검사 예시·흐름
  const eOn = on(t, B(13, 2), B(15, 3)); vis(ex.el, eOn);
  if (eOn) { ex.el.style.transform = `translate(110px,400px) scale(${spr(t, B(13, 2), { z: .55, f: 2.4 }) * (1 - spr(t, B(15), { z: 1, f: 3 }))})`;
    exS.forEach((s, i) => { s.style.transform = `scaleX(${easeO(prog(t, B(13, 3) + i * 0.4, 0.3))})`; }); }
  setRise(exNote, t, B(13, 4) + 0.3, B(15), 'up'); exNote.el.style.top = '565px';
  FL.forEach((g, i) => { const t0 = B(14, 1 + i), o = on(t, t0, B(15, 2) + 0.4); vis(g.el, o); if (!o) return;
    const [hx, hy] = cardPt(545, 805); const suck = easeI(prog(t, B(15), 0.45));
    g.el.style.transform = `translate(${lerp(110 + i * 255, hx - 100, suck)}px,${lerp(640, hy - 48, suck)}px) scale(${spr(t, t0, { z: .55, f: 2.4 }) * (1 - suck)})`; });
  ARR.forEach((a, i) => { const o = on(t, B(14, 2 + i) + 0.1, B(15)); vis(a, o); if (o) a.style.transform = `translate(${110 + 200 + 12 + i * 255}px,662px) scale(${spr(t, B(14, 2 + i) + 0.1, { z: .5, f: 3 })})`; });
  setRise(flN, t, B(14, 4), B(15), 'up'); flN.el.style.top = '760px';
  // 조리개: 「AI 챗봇」 단추
  let ik = 0; const ti0 = B(15, 4) + 0.05;
  if (on(t, ti0, ti0 + 0.25)) ik = easeI(prog(t, ti0, 0.25)); else if (on(t, ti0 + 0.25, ti0 + 1.0)) ik = 1 - easeO(prog(t, ti0 + 0.45, 0.55));
  const [hbx, hby] = cardPt(545, 805); iris.set(t, hbx, hby, ik, 0.2);
  // 챗봇 쪽 설명
  hE.set(t, B(16) + 0.3, B(24), 'up');
  const tgOn = on(t, B(16, 2) + 0.2, B(24)); vis(aiTag, tgOn); if (tgOn) aiTag.style.transform = `translate(112px,360px) scale(${spr(t, B(16, 2) + 0.2, { z: .55, f: 2.4 })})`;
  setRise(kb1, t, B(16, 3), B(18), 'up'); setRise(kb2, t, B(16, 3) + 0.15, B(18), 'up'); kb1.el.style.top = '430px'; kb2.el.style.top = '482px';
  CC.forEach(c => { setRise(c.m, t, c.t0, c.t1, 'up'); c.m.el.style.top = '430px'; });
  // 끝: 카드 셋 → 원 → 선 → 「판단은 사람이」
  thumbs.forEach((e, i) => { const t0 = B(24) + i * 0.2, o = on(t, t0, B(24, 3) + 0.5); vis(e, o); if (!o) return;
    const suck = easeI(prog(t, B(24, 3), 0.45)), x0 = 960 - 105 + (i - 1) * 300, y0 = 300;
    e.style.transform = `translate(${lerp(x0, 855, suck)}px,${lerp(y0, 390, suck)}px) scale(${spr(t, t0, { z: .55, f: 2.4 }) * (1 - suck)}) rotate(${(i - 1) * 4}deg)`; });
  setRise(bigJ, t, B(26), null); bigJ.el.style.left = px(960 - bigJ.el.offsetWidth / 2); bigJ.el.style.top = '470px'; if (t >= B(29) + 0.02) vis(bigJ.el, false);
  P3.forEach((g, i) => { const t0 = B(27, 1 + i), o = on(t, t0, B(29) + 0.03); vis(g.el, o); if (!o) return;
    const ws = P3.map(q => q.el.offsetWidth), tot = ws.reduce((a, b) => a + b, 0) + 40, x0 = 960 - tot / 2 + ws.slice(0, i).reduce((a, b) => a + b, 0) + i * 20;
    g.el.style.transform = `translate(${x0}px,690px) scale(${spr(t, t0, { z: .55, f: 2.4 })})`; });
  setRise(install, t, B(28), null); setRise(credit, t, B(28, 2), null);
  if (t >= B(29) + 0.03) { vis(install.el, false); vis(credit.el, false); }
  // 선이 「사람이」 밑줄이 됨
  if (t >= B(25) && t < B(29)) {
    const emw = bigJ.inner.querySelector('em').offsetWidth, ex0 = 960 - bigJ.el.offsetWidth / 2 + bigJ.el.offsetWidth - emw - 6;
    const u = spr(t, B(26, 3), { z: .75, f: 2.4 });
    rectStyle(body, lerp(960 - 350, ex0, u), lerp(636, 625, u), lerp(700, emw, u), lerp(8, 10, u), 5, u > 0.3 ? C.teal : C.navy); body.style.boxShadow = 'none';
  }
  cur.set(t);
};

function chatSeek(t) {
  const u = spr(t, B(16), { z: 1, f: 6 });
  // 입력
  const n = Math.floor(clamp((t - (B(16) + 0.15)) / 0.8) * QTXT.length);
  const sent = t >= B(16, 3) + 0.08;
  inpT.textContent = sent ? '' : QTXT.slice(0, n); vis(inp, t >= B(16) + 0.15 && !sent);
  vis(qb, sent); qb.style.transform = `scale(${sent ? spr(t, B(16, 3) + 0.08, { z: .6, f: 2.8 }) : 0})`; qb.style.transformOrigin = '100% 100%';
  const qH = qb.offsetHeight, top2 = 16 + qH + 18;
  blab.style.top = px(top2); vis(blab, t >= B(16, 3) + 0.25);
  const thOn = on(t, B(16, 3) + 0.25, B(18)); vis(think, thOn);
  if (thOn) { think.style.top = px(top2 + 18); const si = Math.min(3, Math.floor((t - (B(16, 3) + 0.25)) / 0.5));
    think.querySelector('.tx').textContent = STEPS[si];
    [...think.querySelectorAll('.dots i')].forEach((d, i) => { d.style.transform = `scale(${0.6 + 0.4 * Math.max(0, Math.sin((t * 6 - i * 0.7)))})`; }); }
  const aOn = t >= B(18); vis(ans, aOn); vis(stripW, false);
  let scroll = 0;
  if (aOn) {
    ans.style.top = px(top2 + 18);
    const nn = Math.floor(clamp((t - B(18)) / 1.25) * ANS1.length);
    const full = t >= B(18) + 1.3;
    ans.innerHTML = ANS1.slice(0, nn) + (full ? ANS2 : '');
    ans.style.borderRadius = full ? '16px 16px 0 0' : '16px';
    const ansB = top2 + 18 + ans.offsetHeight;
    stripW.style.top = px(top2 + 18 + ansFullH - 6); vis(stripW, full);
    const maxS = top2 + 18 + ansFullH - 6 + 3727 - 692;
    if (t < B(18, 4)) scroll = Math.max(0, ansB - 692 + 30);
    else scroll = lerp(Math.max(0, top2 + 18 + ansFullH - 692 + 30), maxS, chatScrollU(t));
    bxBasis.set(t, B(19, 3)); bxPen.set(t, B(21, 3)); bxEnd.set(t, B(23));
  }
  chatIn.style.transform = `translateY(${-scroll}px)`;
  vis(recon, t < B(18, 4));
}
