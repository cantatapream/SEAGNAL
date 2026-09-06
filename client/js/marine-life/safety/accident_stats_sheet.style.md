# 바텀시트 디자인 스타일 분석서 — 목업 `marineaccidentdashboard.html` 해부

작성: 2026-09-04 · 상태: **1단계 산출물(디자인 분석). 코드 미반영**
원본: 사용자 제공 `marineaccidentdashboard.html` (757줄, 전문 정독)
짝 문서: `accident_stats_sheet.design.md`(기능 설계 확정서)

> **이 문서의 용도**: 개편 작업의 **모든 단계는 착수 전에 이 문서를 다시 읽고**, 그 단계가 만들
> 화면을 여기 적힌 토큰·비례·질감으로 어떻게 구성할지 먼저 적은 뒤에 코드를 쓴다.
> 목업에 명시된 값은 **그대로**, 목업에 없는 요소는 여기 정리된 **규칙에서 유추**해 만든다.

---

## 0. 한 문장 요약

이 목업의 정체성은 세 가지다.
1. **em 단일 스케일** — 시트 하나에 `font-size: clamp(11.2px, 3.22vw, 15px)` 를 걸고 그 안의 모든 치수를 `em` 으로 적었다. 폭이 바뀌면 글자·여백·모서리·아이콘이 **한 덩어리로** 커지고 작아진다.
2. **3단 깊이의 어두운 층** — 페이지 → 시트 → 카드 → 서브블록으로 갈수록 배경이 한 단계씩 밝아지고, 각 층마다 자기보다 한 단계 밝은 1px 테두리를 두른다. 그림자가 아니라 **명도 차와 테두리**로 깊이를 만든다.
3. **도넛과 막대에 실물 질감** — 단색이 아니라 조각마다 3-stop 그라데이션, 바깥에 흰 림, 안쪽에 검은 코어, 전체에 드롭섀도. 그리고 진입할 때 **한 붓 그리기**로 이어 그린다.

---

## 1. 색 토큰 (목업 `:root` 원문)

| 토큰 | 값 | 쓰임 |
|---|---|---|
| `--bg` | `#050a14` | 페이지 바탕 |
| `--sheet-1` / `--sheet-2` | `#0b1524` / `#081020` | 시트 그라데이션 **위→아래(밝음→어두움)** |
| `--sheet-border` | `#1a293e` | 시트 테두리 |
| `--card` / `--card-br` | `#0c1829` / `#182740` | 카드 바탕 / 테두리 |
| `--sub` / `--sub-br` | `#0f1e33` / `#1b2b45` | 카드 **안** 작은 블록(stat·hint·more) |
| `--txt` | `#eaf1fa` | 본문 (**순백 아님**) |
| `--muted` | `#8194ad` | 라벨·부제 |
| `--dim` | `#61748c` | 각주·단위 |
| `--blue` / `--blue-soft` | `#2b7cf0` / `#3b8bff` | 주강조 / 밝은 파랑(선박) |
| `--teal` | `#16c8a3` | 인명·보조 강조 |
| `--green` | `#25d0a6` | 도넛 3번째 색 |
| `--orange` | `#f9821f` | 도넛/선 4번째 색 |
| `--purple` | `#a35ff0` | 도넛 5번째 색 |
| `--gray` | `#5b6c85` | "기타" 계열 |
| `--track` | `#182842` | 막대 트랙(빈 부분) |

### 현재 앱과의 차이 (반드시 바꿔야 하는 것)
| 항목 | 현재 앱 | 목업 | 판단 |
|---|---|---|---|
| 시트 그라데이션 | `#0c1a3a → #162d5a` (**아래로 갈수록 밝아짐**) | `#0b1524 → #081020` (**아래로 갈수록 어두워짐**) | **뒤집어야 한다.** 목업은 아래로 가라앉는 느낌 |
| 본문색 | `#ffffff` | `#eaf1fa` | 순백은 어두운 배경에서 눈이 아프다 → 바꾼다 |
| 보조색 | `--text-sub #94a3b8` 하나 | `--muted #8194ad` + `--dim #61748c` **2단계** | 라벨과 각주를 구분 → 2단계로 늘린다 |
| 주강조 | `--accent-yellow #ffd740`(건수 숫자) | `--blue #2b7cf0` | 목업엔 노랑이 없다. 건수도 흰색(`--txt`) |
| 파랑 | `--accent-blue #448aff` | `#2b7cf0` / `#3b8bff` | 목업 값으로 |
| 카드 개념 | 없음(`.accident-stats-block` 은 여백만) | 배경+테두리 있는 실제 카드 | **신설** |

**주의**: 위 변경은 **바텀시트 안으로만 한정**한다. `--accent-blue` 등 전역 변수는 앱 전체가 쓰므로 건드리지 않는다. 시트 전용 토큰을 별도 이름(`--ash-*`)으로 새로 정의한다.

---

## 2. 타이포 스케일 — 이 목업의 뼈대

```css
.sheet{ font-size: clamp(11.2px, 3.22vw, 15px); }
```
**시트 안의 모든 치수가 `em`** 이다. 한 곳만 바꾸면 전체가 비례해 움직인다.

### 실측 스케일표 (배수는 시트 font-size 기준)
| 요소 | 크기 | 굵기 | 자간 | 비고 |
|---|---|---|---|---|
| 총건수 `.total-num` | **1.58em** | 800 | -.03em | 가장 큼 |
| 지역명 `.region` | **1.46em** | 800 | -.02em | line-height 1.15 |
| stat 큰 숫자 `.stat-big` | **1.55em** | 800 | -.02em | |
| 카드 제목 `.card-title` | **1.02em** | 800 | -.01em | |
| 도넛 중앙 숫자 `.type-center b` | 1.15em | 800 | -.02em | |
| more 버튼 | .8em | 600 | | |
| 카드 부제 `.card-title em` | .85em | 600 | | `--muted` |
| stat 부가값 `.stat-sub` | .78em | | | `#c2d0e2` |
| 카드 우측 보조 `.card-aside` | .78em | | | `--muted` |
| 기간 1행 `.period-1` | .78em | | | `#b8c7da` (b는 700 `#e6eef8`) |
| 탭 `.tab` | **.76em** | 600 | | 비활성 `#8ea1b9` |
| 행 `.row` | **.76em** | | | |
| hint | .76em | | | `#93a6bf` |
| stat 라벨 `.stat-lab` | .75em | | | `--muted` |
| stat 각주 `.stat-foot` | .75em | 600 | | |
| 범례 `.legend` | .75em | | | `#bccbdd` |
| 총건수 캡션 `.total-cap` | .7em | | | `--muted` |
| 지역 부제 `.region-sub` | .75em | | | `--muted` |
| 칩 값 `.chip-t2` | .72em | 700 | | |
| 단위 `.unit` / 각주 `.foot span` | .72em | | | `--dim` |
| 기간 2행 `.period-2` | .71em | | | `--dim` |
| 칩 라벨 `.chip-t1` | .68em | | | 종류색 |
| 도넛 중앙 캡션 | .68em | | | `--muted` |

**규칙 요약**: 큰 숫자 1.5~1.6em/800 · 제목 1.0em/800 · 본문·탭·행 0.76em · 라벨 0.75em · 각주 0.7~0.72em. **자간은 크기가 클수록 좁힌다**(-.01 → -.03em).

### 글꼴
```
-apple-system, BlinkMacSystemFont, "Pretendard", "Apple SD Gothic Neo",
"Noto Sans KR", "Malgun Gothic", "Segoe UI", Roboto, sans-serif
```
`body { font-feature-settings: "tnum" 1; }` — **숫자 고정폭.** 표에서 자릿수가 흔들리지 않게 하는 장치라 반드시 가져온다.
`html { -webkit-text-size-adjust: 100%; }`, `-webkit-font-smoothing: antialiased`.

---

## 3. 여백·모서리 스케일

### 모서리(radius) — 전부 em
| 값 | 대상 |
|---|---|
| 1.6em | 시트 |
| 1.1em | 카드 |
| 1em | 탭 바 컨테이너 · 손잡이 · 막대(pill) |
| .9em | stat 블록 · 헤더 배지 |
| .85em | 칩 · 닫기 버튼 |
| .8em | more 버튼 · hint |
| .75em | 탭 하나 |
| .55em | 칩 아이콘 박스 |

**규칙**: 바깥일수록 크게. 시트 1.6 > 카드 1.1 > 카드 안 요소 0.75~0.9 > 아이콘 0.55.

### 여백(padding/gap)
| 대상 | 값 |
|---|---|
| 시트 | `.85em 1em 1.2em` (아래가 더 넓다) |
| 카드 | `.95em .9em` |
| 카드 사이 | `margin-bottom .7em` |
| 카드 헤더 아래 | `.85em` |
| stat 블록 | `.85em .6em` |
| stats 칸 사이 | `gap .5em` |
| 행 목록 | `gap .62em` |
| 탭 바 안쪽 | `.28em` / 탭 하나 `.7em .1em` |
| more 버튼 | `.72em` |
| hint | `.65em` |
| 칩 | `.45em .58em` |
| meta 영역 | `.9em 0 .95em` + 아래 1px 구분선 |

### 구분선
- meta 아래: `border-bottom: 1px solid rgba(255,255,255,.055)` — **아주 옅다**
- 탭 사이: `::before` 로 `left:0; top:22%; height:56%; border-left:1px solid rgba(255,255,255,.07)` (활성 탭 좌우는 투명)

---

## 4. 컴포넌트 해부

### 4.1 시트
```css
width:100%; max-width:460px;
background:linear-gradient(180deg, #0b1524 0%, #081020 100%);
border:1px solid #1a293e; border-radius:1.6em;
padding:.85em 1em 1.2em; box-shadow:0 1.5em 3em rgba(0,0,0,.55);
```
**우리 앱에 옮길 때**: 목업은 떠 있는 카드라 사방 테두리·둥근 모서리지만, 우리는 화면 바닥에 붙는 바텀시트다 → **위 두 모서리만 1.6em**, 테두리는 위·좌·우만. 그림자는 위쪽으로(`0 -1.5em 3em`).

### 4.2 손잡이 / 닫기
- 손잡이: `3.4em × .3em`, radius 1em, `#3a4c66`, `margin: 0 auto .35em`
  → 현재 앱은 `40px × 4px, rgba(255,255,255,.2)`. **목업 값으로 교체**(색이 더 또렷하다).
- 닫기: `position:absolute; top:1.1em; right:1em; 2.5em 정사각; radius .85em; border:1px solid #22344d; background:rgba(255,255,255,.02); color:#93a6bf`, svg `1.05em`, stroke-width 2.2
- **헤더는 `margin-top:2.1em`** — 닫기 버튼 자리를 비워 두는 방식이다(현재 앱이 `padding-top:26px` 로 해결한 것과 같은 의도).

### 4.3 헤더
```
[배지 2.7em] [지역명 1.46em/800 + ▼] ........ [총건수 1.58em/800]
             [부제 .75em muted]                [캡션 .7em muted]
```
- 배지: `2.7em` 정사각, radius .9em, `border:1px solid rgba(59,139,255,.35)`, `background:rgba(43,124,240,.12)`, `color:#3b8bff`, svg 1.4em
- 총건수 단위("건")는 `span { font-size:.5em; font-weight:600; color:#a9bad0 }` — **숫자보다 훨씬 작게**
- ※ 지역명 옆 ▼ 화살표는 **우리 설계에서 제거**(기능 설계서 I-4)

### 4.4 칩 (선박/인명)
```css
.chip{ display:flex; gap:.45em; border:1px solid; border-radius:.85em;
       background:rgba(255,255,255,.018); padding:.45em .58em; }
.chip-ic{ 1.7em 정사각; radius .55em; display:grid; place-items:center; }
```
- 선박: 아이콘 배경 `rgba(43,124,240,.16)`, 글자 `--blue-soft`, 테두리 `rgba(43,124,240,.28)`
- 인명: 아이콘 배경 `rgba(22,200,163,.14)`, 글자 `--teal`, 테두리 `rgba(22,200,163,.26)`
- **공식**: 아이콘 배경 = 종류색 alpha .14~.16 / 테두리 = 종류색 alpha .26~.28 / 글자 = 종류색 원본
- 2줄 구성: 라벨 `.68em` + 값 `.72em/700` (`margin-top:.38em`)
- ※ 우리는 여기에 **선택 상태**가 추가된다(목업엔 없음) → §7 참고

### 4.5 탭 바
```css
.tabs{ border:1px solid var(--card-br); border-radius:1em;
       background:rgba(255,255,255,.015); padding:.28em; }
.tab{ flex:1; padding:.7em .1em; border-radius:.75em; font-size:.76em; font-weight:600;
      color:#8ea1b9; gap:.3em; }
.tab svg{ width:1.15em; height:1.15em; opacity:.9; }
.tab.on{ background:#2b7cf0; color:#fff; box-shadow:0 .2em .6em rgba(43,124,240,.35); }
```
아이콘 + 글자가 **가로로** 붙는다(gap .3em). 활성 탭은 파란 알약 + 파란 글로우.
※ 우리는 **비활성(disabled) 상태**가 추가된다(인명일 때 시간대별) → §7 참고

### 4.6 카드
```css
.card{ background:#0c1829; border:1px solid #182740; border-radius:1.1em;
       padding:.95em .9em; margin-bottom:.7em; }
.card-head{ display:flex; align-items:baseline; justify-content:space-between;
            gap:.6em; margin-bottom:.85em; flex-wrap:wrap; }
.card-title{ font-size:1.02em; font-weight:800; letter-spacing:-.01em; }
.card-title em{ font-style:normal; font-size:.85em; font-weight:600; color:#8194ad; margin-left:.15em; }
```
제목은 **"3. 상위 발생 유형 *(Top 5)*"** 처럼 번호 + 이름 + 작은 부제. 오른쪽엔 `.card-aside`(.78em muted).
→ **"(Top 5)" 가 바로 이 `em` 이다.** 아코디언을 펼치면 이 `em` 을 지운다(기능 설계서 작업 8).

### 4.7 stat 블록 (추세 요약)
```css
.stats{ display:grid; grid-template-columns:1fr 1fr 1.42fr; gap:.5em; }
.stat{ background:#0f1e33; border:1px solid #1b2b45; border-radius:.9em;
       padding:.85em .6em; text-align:center;
       display:flex; flex-direction:column; align-items:center; justify-content:center; }
```
**세 번째 칸이 1.42배 넓다** — 도넛이 들어가기 때문. 우리 설계는 도넛을 세로로 쌓기로 했으므로(기능 설계서 C-3) **세 칸을 1fr 1fr 1fr 균등**으로 바꾸고, 도넛 칸은 `제목 / 도넛 / 범례 2줄` 세로 배치로 높이를 맞춘다.

> **★우리 판 정정 [S24-1, 2026-09-05 사용자 지적]**: 목업의 `justify-content:center` 를 그대로 가져왔더니
> **세 칸의 제목 높이가 서로 어긋났다.** 세 칸은 그리드라 높이가 같은데, 가운데 정렬이면 내용이 짧은
> 칸일수록 제목이 아래로 밀린다(목업은 세 칸의 내용 길이가 비슷해 티가 안 났다).
> → 우리 판은 **`justify-content:flex-start`**. 그리고 도넛(`.ash-donut.sm`)은 **4.1em → 5.6em**.
>
> **★2차 정정 [S25-1, 2026-09-06]**: 도넛 칸의 세로 간격이 카드 높이를 불필요하게 키우고 있었다.
> 세 곳을 **1/3** 로 — 제목↔도넛 `0.45→0.15em` · 도넛↔범례 `0.5→0.17em` · 범례 줄 사이 `0.35→0.12em`.
> 도넛 가운데 숫자↔라벨도 `0.25→0.12em`(§5 중앙 텍스트).
- 라벨 `.75em muted` → 큰 값 `1.55em/800`(`margin-top:.5em`) → 부가값 `.78em #c2d0e2`(`.5em`) → 각주 `.75em/600`(`.55em`)
- 단위는 `small { font-size:.52em; font-weight:600; color:#b6c6da }`
- 상승 `.up{color:#3b8bff}` / 하락 `.down{color:#16c8a3}` / 강조 `.drop{color:#16c8a3;font-weight:800}`

### 4.8 막대 행 (`.row`) — 가장 많이 재사용되는 부품
```
[dot .58em] [이름 4.6em 고정] [막대 flex:1 height .5em] [값 5.4em 우측정렬]
```
```css
.row{ display:flex; align-items:center; gap:.45em; font-size:.76em; }
.row .nm{ width:4.6em; flex:none; color:#d3dfee; text-overflow:ellipsis; white-space:nowrap; overflow:hidden; }
.bar{ flex:1; min-width:1.5em; height:.5em; border-radius:1em; background:#182842; overflow:hidden; }
.bar > i{ display:block; height:100%; border-radius:1em; }
.val{ width:5.4em; flex:none; text-align:right; font-weight:700; white-space:nowrap; }
.val em{ font-style:normal; color:#8194ad; font-weight:600; margin-left:.25em; }
```
- 값 표기는 **"5,730건 *(22%)*"** — 절대값 700 굵게 + 괄호 비율은 muted 600
- 이름 칸이 `4.6em` 고정이라 긴 이름은 말줄임. 359px 미만에서 `5em` 으로 넓힌다.
  **★S26-5 정정(2026-09-06): `8.7em` / `9.1em` 으로 넓혔다.** 선박 종류에
  `레저선박(분류없음)` 이 새로 들어오면서 `레저선박…` 으로 잘려 무슨 종류인지 알 수
  없게 됐다. 폭은 눈대중이 아니라 전국 화면에서 모든 목록을 펼쳐 **글자 폭을 실측**해
  잡았다 — 가장 긴 이름 `침수침몰(표본 적음)` 이 시트 기준 6.56em, 이 행 기준 8.63em.
  막대는 그만큼 짧아지지만 가장 짧은 막대도 139.5px 남는다(같은 실측).
- **점(dot)에 광택이 있다**:
```css
.dot{ width:.58em; height:.58em; border-radius:50%;
      background-image:linear-gradient(145deg, rgba(255,255,255,.55), rgba(0,0,0,.35));
      background-blend-mode:overlay;
      box-shadow:0 .08em .16em rgba(0,0,0,.5); }
```
바탕색은 인라인 `style="background:var(--blue)"` 로 주고, 위 그라데이션이 **overlay 로 겹쳐** 입체감을 만든다. 단색 원이 아니다.
- **치명도 게이지 바(우리 신규)** 도 이 `.row` 구조를 그대로 쓰되, `.bar` 안에 회색 조각을 **왼쪽에** 먼저 놓는다 → §7

### 4.8-2 값 칸 폭은 **재서** 정한다 (우리 신규) [S25-2]
`.ash-row .val` 을 좁게 고정해 두면 긴 값이 칸을 넘어 카드 밖으로 삐져나온다.
폭은 눈대중이 아니라 화면에서 글자 폭을 직접 재서 정했다 —
일반 카드 `8.7em`(가장 긴 값 `16,976건 (56%)` = 8.01em) ·
치명도 `.ash-fatal-row .val` `11em`(가장 긴 값 `25.4%(422/1,663건)` = 10.36em).
막대(`.ash-bar`)가 남는 공간을 먹으므로 값 칸을 넓히면 막대가 저절로 좁아진다.
⚠**넘침을 위치로 재면 안 된다** — 칸 폭은 고정이라 글자만 삐져나오면 위치로는 안 잡힌다.
`scrollWidth > clientWidth` 로 봐야 한다(실제로 그렇게 잘못 통과한 적이 있다).

### 4.9-2 카드 제목 아래 안내 한 줄 (우리 신규 · 목업에 없음) [S25-7]
```css
.ash-card-hint{ display:flex; align-items:center; gap:.35em;
  margin:-.5em 0 .5em; font-size:.74em; color:var(--ash-dim); }
.ash-card-hint::before{ content:"\f25a"; font-family:"Font Awesome 6 Free"; font-weight:900; }
```
상자를 두르지 않는다 — 두르면 옛 `.ash-hint` 처럼 다시 자리를 차지한다.
[S24-5 의 `.ash-chart-toast`(그래프 안에 잠깐 뜨던 토스트)는 S25-7 에서 삭제하고 이것으로 대체]

### (삭제됨) 4.9-3 그래프 안 토스트 [S24-5 → S25-7 에서 제거]
```css
.ash-chart-toast{ position:absolute; left:50%; top:.6em; transform:translate(-50%,-.4em);
  padding:.5em .75em; border:1px solid #1b2b45; border-radius:.8em;
  background:rgba(15,30,51,.94); box-shadow:0 .3em .9em rgba(0,0,0,.45);
  color:#93a6bf; font-size:.76em; font-weight:600; text-align:center; line-height:1.35;
  opacity:0; pointer-events:none; transition:opacity .28s ease, transform .28s ease; }
.ash-chart-toast.show{ opacity:1; transform:translate(-50%,0); }
```
힌트(§4.9)와 **같은 톤**이되 떠 있는 것이라 그림자를 준다. `white-space:nowrap` 을 쓰면
휴대폰 폭에서 오른쪽이 잘린다(실제로 잘렸다) — 넘치면 다음 줄로 넘기고 가운데 정렬.

### 4.9 더보기 버튼 / 힌트 — 같은 톤
```css
.more, .hint{ background:#0f1e33; border:1px solid #1b2b45; border-radius:.8em; }
.more{ width:100%; margin-top:.85em; padding:.72em; color:#c6d4e6; font-size:.8em; font-weight:600;
       display:flex; align-items:center; justify-content:center; gap:.35em; }
.more svg{ width:.85em; height:.85em; opacity:.75; }   /* 오른쪽 꺾쇠 › */
.hint{ padding:.65em; font-size:.76em; color:#93a6bf; gap:.45em; }
```
※ 우리는 **아코디언**이라 화살표가 펼침에 따라 `›` → `⌄` 로 바뀌고, 펼친 목록 맨 아래에 **접기 버튼**이 하나 더 붙는다(같은 `.more` 스타일 재사용).

### 4.9-3 치명도 값 칸 설명 한 줄 (우리 신규 · 목업에 없음) [S26-6]
값 칸이 `25.4% (422/1,663건)` 처럼 생겨서 괄호 안 두 숫자가 각각 무엇인지 알 수 없다는
지적을 받았다(2026-09-06). 값 칸 바로 위, 같은 오른쪽 끝에 한 줄을 둔다.
```css
.ash-fatal-legend{ font-size:.72em; color:var(--ash-dim); text-align:right; margin:-.35em 0 .5em; }
.ash-fatal-legend b{ color:#ff5252; font-weight:700; }      /* "사망+실종" */
.ash-fatal-row .val em b{ color:#ff5252; font-weight:700; } /* 괄호 왼쪽 숫자 */
```
`(사망+실종 / 총 사고수)` — 왼쪽 몫만 빨강으로 두어 아래 괄호의 빨간 숫자와 눈으로 잇는다.
전에 이 자리에 있던 "이 구역에서는 …" 줄은 같은 지시로 없앴다.

### 4.9-4 치명도 "이 구역 ↔ 전국" 토글 (우리 신규 · 목업에 없음) [S26-8]
아래 §7 의 **"전국 기준" 배지**를 대신한다(2026-09-06 사용자 확정). 제목 줄 안에 들어가는
아주 작은 토글이라 카드 헤더의 선박↔인명 토글(`.ash-srctoggle`)보다 한 단계 작게 잡았다.
```css
.ash-scopetoggle{ display:inline-flex; gap:.1em; margin-left:.4em; padding:.1em;
  vertical-align:middle; border:1px solid var(--ash-card-br); border-radius:.55em;
  background:rgba(255,255,255,.015); }
.ash-scopetoggle button{ padding:.15em .4em; border-radius:.42em; font-size:.68em;
  font-weight:600; color:#8ea1b9; }
.ash-scopetoggle button.on{ background:var(--ash-blue); color:#fff;
  box-shadow:0 .15em .5em rgba(43,124,240,.35); }
```
전국 통계로 연 시트에서는 바꿀 것이 없으므로 `(전국)` 배지만 남긴다(배지 스타일은 §7 그대로).
토글이 넓어 카드 머리 한 줄이 꽉 차므로, `.ash-card-aside`("선박사고 기준")에
`margin-left:auto` 를 줘서 줄이 바뀌어도 오른쪽 끝에 붙게 한다.

### 4.10 푸터
```css
.foot{ display:flex; gap:1.1em; flex-wrap:wrap; padding:.35em .3em 0; }
.foot span{ font-size:.72em; color:#61748c; position:relative; padding-left:.7em; }
.foot span::before{ content:""; position:absolute; left:0; top:.5em;
                    width:.25em; height:.25em; border-radius:50%; background:#4a5c74; }
```
항목 앞에 **작은 점**이 붙는 목록. 우리 주석("2014·2015년 제외" 등)을 여기에 담는다.

---

## 5. 도넛 — 3겹 구조 (이 목업의 핵심 기법)

### 구조 (`.type-donut`, 8.4em 정사각)
```
① 배경 트랙 : circle r=34, stroke #101d2f, width 16
② 본체      : circle r=34, width 16, 조각별 3-stop 그라데이션
③ 바깥 림   : circle r=40.8, width 2.4, 흰색 그라데이션(opacity .6 → .13 → 0)
④ 안쪽 코어 : circle r=27.5, width 3, 검정 그라데이션(#000814 opacity .06 → .5)
전체: <g transform="rotate(-90 50 50)" filter="url(#tpShadow)">
그림자: feDropShadow dy=2 stdDeviation=2.4 flood-color=#000610 flood-opacity=.6
```
작은 도넛(추세 요약, 4.1em)은 `r=30 / width 15 / 림 r=36.3 width 2.2 / 코어 r=24 width 2.6 / dy 1.8 stdDeviation 2 opacity .55`.

### 조각 그라데이션 공식
```xml
<linearGradient gradientUnits="userSpaceOnUse" gradientTransform="rotate(90 50 50)"
                x1="12" y1="6" x2="88" y2="94">
  <stop offset="0"   stop-color="{밝은색}"/>
  <stop offset=".46" stop-color="{기준색}"/>
  <stop offset="1"   stop-color="{어두운색}"/>
</linearGradient>
```
| 색 | 밝은색 | 기준색 | 어두운색 |
|---|---|---|---|
| 파랑 | `#86b6ff` | `#2b7cf0` | `#12448a` |
| 청록 | `#6cf0d4` | `#1cc9a4` | `#08765f` |
| 보라 | `#dcabff` | `#a35ff0` | `#5d2a9e` |
| 회색 | `#9ea8b6` | `#6d7787` | `#38404d` |

**새 색이 필요하면 이 공식으로 만든다** — 기준색을 정하고 밝은색은 명도를 크게 올리고, 어두운색은 크게 내린다(대략 기준색 대비 ±40% 명도).

### 조각 배치 — `pathLength="100"` 기법
```xml
<circle r="34" pathLength="100" stroke-dasharray="21.2 78.8" stroke-dashoffset="0"/>
<circle r="34" pathLength="100" stroke-dasharray="17.2 82.8" stroke-dashoffset="-22"/>
```
`pathLength="100"` 덕분에 **dasharray 를 백분율 그대로** 쓸 수 있다. 조각 i의
`dasharray = "{비율} {100-비율}"`, `dashoffset = -(앞 조각들의 비율 합 + 조각 사이 간격)`.
목업은 조각 사이에 **0.8 정도의 틈**을 준다(21.2 다음 offset 이 -22).
림·코어도 **똑같은 dasharray/offset** 을 쓴다(같은 조각 위에 겹쳐야 하므로).

### 중앙 텍스트
```css
.type-center{ position:absolute; inset:0; display:flex; flex-direction:column;
              align-items:center; justify-content:center; gap:.25em; }
.type-center b{ font-size:1.15em; font-weight:800; letter-spacing:-.02em; }
.type-center span{ font-size:.68em; color:#8194ad; }
```

---

## 6. 애니메이션

```css
@keyframes drawSeg{ from{ stroke-dasharray:0 100; } }   /* 한 붓 그리기 */
@keyframes barGrow{ from{ width:0; } }                   /* 막대 차오름 */

.s1,.s2,.s3,.s4,.m1,.m2,.m3{ animation:drawSeg .6s linear both paused; }
.bar > i{ animation:barGrow .85s cubic-bezier(.22,.85,.3,1) both paused; }
.reveal .s1, … , .reveal .bar > i{ animation-play-state:running; }
```
**`paused` 로 첫 프레임(0)에 멈춰 뒀다가 `.reveal` 이 붙으면 재생**한다. 이 방식이라 스크롤로 카드가 보일 때 처음부터 그려진다.

### 지속시간·지연을 조각 길이에 비례
| 조각 | duration | delay | 조각 비율 |
|---|---|---|---|
| s1 | .30s | .18s | 21.2 |
| s2 | .25s | .48s | 17.2 |
| s3 | .16s | .73s | 11.2 |
| s4 | .66s | .89s | 47.2 |

**규칙**: `delay(다음) = delay(이전) + duration(이전)` → 끊김 없이 한 바퀴가 이어진다.
`duration ≈ 조각비율 × 0.014초` (21.2×.014≈.30, 47.2×.014≈.66). 코드로 계산해 인라인 style 로 넣는다.

막대는 행마다 `delay` 를 **0.09초씩** 늘린다(.10 / .19 / .28 / .37 / .46 / .55).

### 발동
```js
new IntersectionObserver(cb, { threshold:0.2, rootMargin:'0px 0px -8% 0px' })
// 보이면 .reveal 추가 후 unobserve (한 번만)
```
**접근성**: `@media (prefers-reduced-motion:reduce){ … animation:none; }` 반드시 포함.

**우리 앱 적용 시 주의**: 시트 본문(`.accident-stats-body`)이 스크롤 컨테이너다. IntersectionObserver 의 `root` 를 그 요소로 지정해야 한다(기본값 뷰포트로 두면 오작동).

---

## 7. 목업에 **없어서 유추해야 하는** 것들 (우리 신규 요소)

목업은 정적 시안이라 아래 상태가 없다. **§1~6 규칙에서 유추한 안**을 적어 둔다 — 각 단계 착수 전에 이 안을 다시 검토한다.

| 신규 요소 | 유추한 디자인 |
|---|---|
| **칩 선택 상태** | 선택: 배경을 종류색 alpha `.16` → `.26` 으로 올리고 테두리를 `.28` → `.55`, 글자를 원본색에서 `#fff` 로. 비선택: 현재 목업 상태 그대로. (탭 활성이 "채운 알약"인 것과 같은 어법) |
| **탭 비활성(disabled)** | 글자 `#8ea1b9` → `--dim #61748c`, `opacity:.45`, `cursor:not-allowed`, 아이콘 `opacity:.5`. 배경은 그대로(눌린 것처럼 보이면 안 됨) |
| **아코디언 펼침** | `.more` 버튼의 꺾쇠를 `›`(rotate 0) → `⌄`(rotate 90deg, `transition:.18s`)로. 펼친 목록은 `.rows` 를 그대로 이어 붙이고, 맨 아래 **"접기"** 버튼(같은 `.more` 스타일, 꺾쇠는 `⌃`) |
| **치명도 게이지 바** | `.row` 구조 재사용. `.bar` 안에 `<i class="fatal">`(회색 `--gray #5b6c85`, **왼쪽**) + `<i class="rest">`(종류색) 두 조각. 값은 `"1,053건 <em>(사망·실종 289건)</em>"` |
| **"표본 적음" 회색 처리** | 행 전체 `opacity:.55`, 이름 뒤에 `<em>` 로 "(표본 적음)" — `.val em` 과 같은 muted 600 |
| **특보 타일** | `.stat` 블록과 같은 재질(`--sub`/`--sub-br`/radius .9em). 안은 `아이콘 + 종류명(.72em 종류색) / 건수(1.35em/800) / 비율(.72em muted) / 하단 진행바(.35em, `--track` 위 종류색)`. 이미지의 타일이 정확히 이 구성이다 |
| **특보 종류 색** | 태풍=`--purple #a35ff0` · 풍랑=`--blue #2b7cf0` · 강풍=`--teal #16c8a3`. **경보는 기준색, 주의보는 같은 계열의 밝은색**(도넛 그라데이션의 "밝은색" 값 사용: 보라 `#dcabff`, 파랑 `#86b6ff`, 청록 `#6cf0d4`). 사용자 확정 "같은 종류는 같은 색 계열" |
| **말풍선(툴팁)**<br>**★S26-3 정정** | **2026-09-06: 부르는 방법과 내용이 바뀌었다.** ①길게누르기(0.2초) → **한 번 톡 누르면 뜨고 1초 뒤 저절로 사라짐** ②특보 종류 타일에는 안 붙이고 **"특보 발효 일수" 칸에서만** ③내용은 **해역별 일수 줄만**(겹침·구분선·합계 줄 삭제). 나타나고 사라지는 것은 아래의 opacity 전환 그대로. 아래는 모양 사양(그대로 유효). |
| **말풍선 모양** | 목업 차트의 툴팁을 따른다 — `rect rx:6.5 fill:var(--blue)`, 흰 글자 700. HTML 말풍선으로 만들 땐 `background:#2b7cf0; border-radius:.55em; padding:.5em .7em; color:#fff; box-shadow:0 .3em .9em rgba(0,0,0,.5)` + 삼각 꼬리(위로 뜨면 아래쪽, 아래로 뜨면 위쪽). **글자 크기만 예외 — `.72em`(시트 기준 약 9.6px)은 목업의 "숫자 하나짜리" 툴팁에서 유추한 값이라 우리처럼 다섯 줄짜리 계산 내역에는 너무 작다. `12px` 고정을 쓴다(2026-09-04 판단). 말풍선은 시트 밖 body 에 붙어 시트의 em 스케일을 받지 않기도 한다.** |
| **"전국 기준" 배지**<br>**★S26-8 정정** | **2026-09-06: 치명도 카드에서는 이 배지가 `[이 구역\|전국]` 토글로 바뀌었다(§4.9-4).** 배지는 전국 통계로 연 시트에서 `(전국)` 으로만 남는다. 아래는 배지 모양 사양(그대로 유효). |
| **배지 모양** | 헤더 배지가 아니라 카드 제목 옆 작은 pill: `font-size:.68em`(**시트 기준**. `em` 은 부모를 따르므로 카드 제목(1.02em) 안에서는 `.667em`, stat 라벨(0.75em) 안에서는 `.907em` 으로 보정해야 같은 크기가 된다); font-weight:700; color:#3b8bff; background:rgba(43,124,240,.14); border:1px solid rgba(43,124,240,.3); border-radius:.5em; padding:.12em .45em` |
| **"2016.08~" 배지** | 위와 같은 형태, 색만 `--muted` 계열(`color:#8194ad; background:rgba(129,148,173,.12); border-color:rgba(129,148,173,.28)`) — 강조가 아니라 단서이므로 |
| **시트 안 필터 버튼**(S17) | `.more`/`.hint` 와 같은 재질(`--ash-sub` 바탕 · `--ash-sub-br` 테두리 · radius `.8em`), `padding:.45em .62em`, `font-size:.74em; font-weight:600; color:#c6d4e6`. **값이 걸린 버튼만 활성 탭과 같은 파란 알약**(`background:--ash-blue; color:#fff; box-shadow:0 .2em .6em rgba(43,124,240,.35)`) — 목업이 "지금 고른 것"을 나타내는 어법이 그것 하나뿐이다. 줄바꿈 허용(`flex-wrap`), `gap:.35em` |
| **드래그 손잡이 활성** | 잡는 동안 `#3a4c66` → `#6d84a3` 로 밝히고 높이 `.3em → .38em` |

---

## 8. 반응형

| 분기 | 변화 |
|---|---|
| 기본 | `.stats` 3열(1fr 1fr 1.42fr), 칩 2개가 기간과 한 줄 |
| `≤439px` | `.period` 와 `.chips` 가 각각 전체 폭(칩이 아랫줄로 내려가 절반씩) |
| `≤359px` | `.stats` 2열 + 마지막 칸이 전체 폭 / `.type-body` 세로 배치 / 도넛 8.4em→7.6em / 이름칸 8.7em→9.1em(S26-5 정정 전 4.6em→5em) |
| `≥461px` | 시트 바깥 여백 확대 |

우리 앱은 바텀시트라 `max-width:460px` 대신 **화면 폭 100%** 를 쓴다. 단 큰 화면에서 글자가 과하게 커지지 않도록 `clamp` 상한 15px 은 유지한다.

---

## 9. 옮길 때 지켜야 할 것 (체크리스트)

- [ ] 시트에 `font-size: clamp(11.2px, 3.22vw, 15px)` 한 줄을 걸고, **시트 안 모든 새 CSS 는 `em`** 으로 쓴다. `rem`·`px` 을 섞지 않는다(현재 앱 CSS 가 `rem` 이라 섞이면 스케일이 깨진다).
- [ ] 시트 전용 색 토큰을 `--ash-*` 이름으로 새로 정의한다. **전역 `--accent-*` 변수는 건드리지 않는다.**
- [ ] 시트 그라데이션 방향을 **밝음→어두움**으로 뒤집는다.
- [ ] `font-feature-settings:"tnum" 1` 을 시트에 건다.
- [ ] 3단 깊이(시트/카드/서브블록)를 지킨다 — 카드 안에 카드를 또 넣지 않는다.
- [ ] 도넛은 4겹(트랙·본체·림·코어)을 다 그린다. 한 겹만 그리면 목업의 질감이 안 나온다.
- [ ] `pathLength="100"` 을 반드시 쓴다(비율을 그대로 dasharray 로).
- [ ] 애니메이션은 `paused` + `.reveal` 방식, IntersectionObserver 의 `root` 를 **시트 본문**으로 지정한다.
- [ ] `prefers-reduced-motion` 분기를 넣는다.
- [ ] 목업에 없는 요소는 §7 표의 유추안을 따르고, 단계 착수 전에 그 안을 다시 검토한다.
