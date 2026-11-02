"""report_hazard_types.md 조립 — 표와 본문 숫자를 모두 결과 CSV·저장소 파일에서 읽어 찍는다(손으로 옮기지 않음).
사용: python3 -I 06_build_report.py <repo_root> <work_dir>
"""
import sys, re, json
import numpy as np, pandas as pd
root, W = sys.argv[1:3]
O = W + '/out'; RP = W + '/repro'
rd = lambda f, **k: pd.read_csv(O + '/' + f, **k)
L = []
w = L.append
f2 = lambda x: '%.2f' % x
def rr(r): return '%.2f (%.2f–%.2f)' % (r['RR'], r['lo'], r['hi'])
def mark(r):  # 구간이 1을 포함하면 뚜렷하지 않음
    return '' if (r['lo'] > 1 or r['hi'] < 1) else ' ·'
def md(df):
    cols = list(df.columns)
    out = ['| ' + ' | '.join(str(c) for c in cols) + ' |', '|' + '---|' * len(cols)]
    for _, r in df.iterrows(): out.append('| ' + ' | '.join(str(r[c]) for c in cols) + ' |')
    return '\n'.join(out)

tm = rd('type_models.csv'); mc = rd('model_compare.csv'); eq = rd('equality_tests.csv'); smp = rd('samples_by_type.csv')
var = rd('within_sgg_variation.csv'); ovp = rd('overlap_polygon_pairs.csv'); dist = rd('overlap_distance_by_type.csv')
co = rd('cooccurrence_at_spots.csv'); tsb = rd('type_share_by_bin.csv', dtype={'bin_start': str})
sfit = rd('score_fit.csv'); stab = rd('score_tables.csv'); soe = rd('score_obs_exp.csv'); ssum = rd('score_summary.csv')
scombo = rd('score_by_combo.csv'); sex = rd('score_examples.csv'); sens = rd('sensitivity_se.csv'); seq = rd('sensitivity_equality.csv')
oos = rd('oos_2020_22_to_2023_24.csv'); rep = pd.read_csv(RP + '/spot_hazard_models.csv'); spf = rd('spots_type_features.csv', dtype={'sgg': str})
def T(outcome, model, term):
    r = tm[(tm.outcome == outcome) & (tm.model == model) & (tm.term == term)]; assert len(r) == 1, (outcome, model, term); return r.iloc[0]
def E(outcome, model):
    r = eq[(eq.outcome == outcome) & (eq.model == model)]; assert len(r) == 1; return r.iloc[0]
def M(outcome, model):
    r = mc[(mc.outcome == outcome) & (mc.model == model)]; assert len(r) == 1, (outcome, model); return r.iloc[0]
MA, MA_EQ = 'a 종류별 있음 3개', 'a= 있음 3개 같은 무게(있는 종류 수)'
MB1, MB2, MB2E, MB3, MB3E = 'b1 종류별 개수 구간(0/1/2/3+) 3개', 'b2 종류별 log2(개수+1) 3개', 'b2= 종류별 log2(개수+1) 같은 무게', 'b3 종류별 log2(min(개수,3)+1) 3개', 'b3= 종류별 log2(min(개수,3)+1) 같은 무게'
MA0, MA1, MA2, ML0, ML1, MAPP = 'A0 출발안 구간(전체 개수)', 'A1 출발안 구간 + 사망구역 있음(§4.6)', 'A2 출발안 구간 + 사망·다발 있음', 'L0 전체 log2(개수+1)', 'L1 전체 log2(개수+1) + 있는 종류 수', 'APP 앱 점수 고정(0/.70/1.24/1.74 + 사망 .37)'
TY = [('risk', '연안사고 위험구역'), ('fatal', '사망사고 발생구역'), ('freq', '연안사고 다발구역')]
OUTS = [('n_2023_24', '2023~24 전체 **(주)**'), ('n_all', '2020~24 전체'), ('n_fatal', '2020~24 사망·실종'), ('n_fatal_2023_24', '2023~24 사망·실종'),
        ('n_2020_22', '2020~22 전체(지정 전·대조)'), ('n_fatal_2020_22', '2020~22 사망·실종(지정 전·대조)')]
ev = lambda y: int(tm[tm.outcome == y].events.iloc[0])

# 저장소 코드에서 지금 점수표 읽기(손으로 옮기지 않음)
# 이 보고서는 「U81 이전 앱 점수표」와 비교한다. U81(커밋 1827a30dc)이 HAZARDS·fatalScore 를 지웠으므로 그 직전 판을 git 에서 읽는다.
import subprocess
def _old(rel): return subprocess.run(['git', '-C', root, 'show', '1827a30dc^:' + rel], capture_output=True, text=True, check=True).stdout
pts = _old('local_server/services/risk_points.js'); sc = _old('local_server/services/risk_score.js')
hz_line = re.search(r'const HAZARDS = \[.*?\]\]', pts).group(0); fatal_line = re.search(r'fatalScore:[.\d]+,fatalRr:[.\d]+', pts).group(0)
sc_lines = [(i + 1, l) for i, l in enumerate(sc.split('\n')) if 'hz.count' in l or 'hz.fatal' in l]
pts_ln = [i + 1 for i, l in enumerate(pts.split('\n')) if 'const HAZARDS' in l or 'fatalScore' in l]

e23 = E('n_2023_24', MA); e23b3 = E('n_2023_24', MB3); eall = E('n_all', MA); efat = E('n_fatal', MA); ef23 = E('n_fatal_2023_24', MA)
cl23 = seq[(seq.outcome == 'n_2023_24') & (seq.model == MA) & (seq.se == '시군구 군집')].p.iloc[0]
clall = seq[(seq.outcome == 'n_all') & (seq.model == MA) & (seq.se == '시군구 군집')].p.iloc[0]
a23 = {k: T('n_2023_24', MA, k + '_any') for k, _ in TY}
fa = {k: T('n_fatal', MA, k + '_any') for k, _ in TY}
fit_app = sfit[sfit.table.str.startswith('지금 앱')].iloc[0]; fit_A = sfit[sfit.table.str.startswith('후보 A')].iloc[0]; fit_B = sfit[sfit.table.str.startswith('후보 B')].iloc[0]
fit_A1 = sfit[sfit.table.str.contains('A1')].iloc[0]; fit_L0 = sfit[sfit.table.str.contains('L0')].iloc[0]
stL0 = rd('score_table_L0.csv').set_index('n_total')
oe6 = soe[soe.group == '6+'].iloc[0]; oe0 = soe[soe.group == '0'].iloc[0]
o23 = oos[oos.test == 'n_2023_24'].set_index('structure')
oB, oA, oA1 = o23.loc['후보 B: 종류별 무게·3곳 멈춤(b3)'], o23.loc['후보 A: 종류 같은 무게·3곳 멈춤(b3=)'], o23.loc['지금 구조: 구간 + 사망 있음(A1)']
st3 = stab.set_index('n_zones')
iso = E('n_고립', MA)
g6 = spf[(spf.bin_start == '6+') & (spf.hz_fatal_3km == 0)]
g6txt = '구역 6곳 이상인데 사망구역은 없는 관광지 %d곳(그 구역 %d개 중 위험구역 %d개)' % (len(g6), g6.hz_all_3km.sum(), g6.hz_risk_3km.sum())

w('# 위험구역 종류별 효과 — 관광지 단위 재분석')
w('')
w('작성 2026-10-15 · 대상 질문(사용자 원문): *「위험구역은 실질적으로 위험구역, 사망사고발생구역, 연안사고 다발구역? 인가 이렇게 3개로 나뉘고 있는데 구역의 종류와 관계없이 동일한 점수를 매기는건 아닌지 궁금하고」 → 「위험구역의 종류별 효과 다시 분석 필요.」*')
w('')
w('이 문서의 모든 표·숫자는 `src/` 스크립트가 찍은 값이다(본문 숫자도 이 조립 스크립트가 결과 파일에서 읽어 넣음). 저장소 파일은 읽기만 했다.')
w('')
w('## 요약')
w('')
w('1. **지금 앱은 종류를 가리지 않는다(코드로 확인).** 3km 안 위험구역을 종류 구분 없이 모두 세어 0 / 1~2 / 3~5 / 6곳 이상으로 점수를 주고, 사망사고 발생구역이 1곳이라도 있으면 0.37점만 더한다. 연안사고 다발구역은 따로 대우받지 않는다.')
w('2. **지정 이후(2023~24) 사고로 세 종류를 서로 보정해 재면** 다발구역 %s배 · 사망구역 %s배 · 위험구역 %s배(그 종류가 3km 안에 있을 때; 위험구역은 신뢰구간이 1을 포함)로 순서는 있지만, **"세 종류의 효과가 같다"를 통계로 물리치지 못한다(p=%.2f, 시군구 군집 표준오차로는 p=%.2f) — 「구분 안 됨」.** 2020~24 전체로는 차이가 있지만(p=%.3f, 시군구 군집으로는 p=%.2f) 다발·사망 구역은 법정 기준상 "최근 3년 사고"로 지정돼 지정 전 사고와 순환하므로 부풀었을 수 있다.' % (
    f2(a23['freq'].RR), f2(a23['fatal'].RR), f2(a23['risk'].RR), e23.p, cl23, eall.p, clall))
w('3. **더 분명한 것은 "세는 방법"이다.** 지정 이후 사고에 대한 맞음(AIC, 낮을수록 좋음, 차이 10 이상이면 큰 차이)이 지금 표 → **후보 A(종류마다 따로 세어 3곳에서 멈추고 더함)** 로 %.1f 좋아진다. 그 가운데 %.1f 만큼은 "4단계 구간 + 사망 가산"을 **종류 구분 없이 개수를 매끄럽게(log) 세는 것**으로만 바꿔도 얻고, 종류마다 따로 세는 몫은 %.1f 이다. 지금 표는 %s의 사고를 과대 예상한다(관측÷기대 %.2f).' % (
    fit_app.aic - fit_A.aic, fit_app.aic - fit_L0.aic, fit_L0.aic - fit_A.aic, g6txt, oe6.oe_app))
w('4. 종류별 무게를 따로 주는 것(다발 > 사망 > 위험)은 **지정 전(2020~22)에 정한 모양이 지정 후(2023~24)에도 같은 무게보다 조금 더 잘 맞아(AIC 차이 %.1f) 약한~중간 근거가 있다.** 사망·실종 사고만 보면 2020~24 에서는 사망구역이 두드러지지만(%s배, 다발 %s배) 지정 이후 사망·실종 %d건으로는 구분 안 됨(p=%.2f).' % (
    oA.test_aic - oB.test_aic, f2(fa['fatal'].RR), f2(fa['freq'].RR), ev('n_fatal_2023_24'), ef23.p))
w('5. 그래서 자료가 지지하는 점수표 후보는 둘이다 — **후보 A: 종류마다 1곳 %.2f · 2곳 %.2f · 3곳 이상 %.2f점(세 종류 같은 무게, 합산, 사망 가산 없음)**, **후보 B: 종류별 무게(위험 %.2f/%.2f/%.2f · 사망 %.2f/%.2f/%.2f · 다발 %.2f/%.2f/%.2f)**. 둘 다 지금 표보다 평균이 낮아지고(관광지 평균 %.2f → %.2f / %.2f점) 위험구역만 많은 곳은 크게 내려가며, 세 종류가 다 몰린 곳은 올라간다.' % (
    st3.loc[1, 'candA'], st3.loc[2, 'candA'], st3.loc[3, 'candA'], st3.loc[1, 'candB_risk'], st3.loc[2, 'candB_risk'], st3.loc[3, 'candB_risk'],
    st3.loc[1, 'candB_fatal'], st3.loc[2, 'candB_fatal'], st3.loc[3, 'candB_fatal'], st3.loc[1, 'candB_freq'], st3.loc[2, 'candB_freq'], st3.loc[3, 'candB_freq'],
    ssum[ssum.table == '지금 앱'].iloc[0]['mean'], ssum[ssum.table == '후보 A'].iloc[0]['mean'], ssum[ssum.table == '후보 B'].iloc[0]['mean']))
w('')

# 1. 코드
w('## 1. 지금 앱은 종류를 가리나 — 코드 확인')
w('')
w('- `local_server/services/risk_points.js` %s행: `%s` (점수, 배수, 사망·실종 배수) / `%s`' % ('·'.join(map(str, pts_ln)), hz_line, fatal_line))
for ln, l in sc_lines:
    w('- `local_server/services/risk_score.js` %d행: `%s`' % (ln, l.strip()[:160]))
w('- 즉 **개수(`hz.count`)는 세 종류를 모두 더한 값**이고, 종류가 점수에 들어가는 길은 `hz.fatal`(사망사고 발생구역 1곳 이상 → `fatalScore`) 하나뿐이다. `risk_spots.json` 의 `hazard.count`·`hazard.fatal`·`zones[].구역분류` 는 이 분석이 다시 센 값과 1,354곳 모두 같다(`out/log_00_verify.txt`).')
w('- 출처 대조: 구간 점수 = log2(§4.6 2023~24 구간 배수 1.62/2.36/3.34) — **사망 가산이 없는 모형(A0)** 의 값, 가산 0.37 = log2(1.29) — **구간과 사망을 함께 넣은 모형(A1)** 의 값. 두 모형의 값을 더해 쓰고 있다(§13.1).')
w('')
w('## 2. 방법')
w('')
w('- §4.6(`local_server/tools/coastal_accident_analysis/09_spots.py`, 구간 비교는 `09c_bins_compare.py`)과 같은 틀: 단위 = 해안 관광지 1,354곳, 사고는 3km 안 가장 가까운 관광지 몫, **포아송 회귀 + 시군구 고정효과(같은 시군구 안 관광지끼리 비교) + log(관광지 몫 해안선 칸 수+1)**, 강건 표준오차(HC1), 기준 = 그 종류 0곳.')
w('- 입력: §4.6 이 쓴 중간 파일(`spots_features.csv`·`geo_person.csv`, 2026-10-10 생성)을 그대로 쓰되, **지금 저장소 원자료로 같은 규칙에 따라 다시 계산해 모두 일치함을 확인**했다 — 관광지별 종류별 3km 개수 4열 불일치 0, 사고 3,078건(변사 제외)의 날짜·유형·사망·실종·좌표 불일치 0, 사고→관광지 배정 불일치 0, 해안선 칸 수 불일치 0, `risk_spots.json` 개수·사망 표시 불일치 0(`src/00_verify_inputs.py`, `out/log_00_verify.txt`).')
w('- 결과(사고 수): **2023~24 전체(주 결과)**, 2020~24 전체, 2020~24 사망·실종, 2023~24 사망·실종, 대조로 2020~22(지정 전), 유형별(익수·추락·고립·표류).')
w('- 모형: (a) 종류별 있음 3개 함께 · (b) 종류별 개수 함께 — b1 구간(0/1/2/3+), b2 log2(개수+1), b3 log2(min(개수,3)+1) · (c) 한 종류만 · (d) 지금 앱 구조(A0 구간, A1 구간+사망, APP 앱 점수 그대로 고정) · 같은 무게 모형(a=, b2=, b3=: 세 종류의 계수를 하나로 묶음) · L0 전체 log2(개수+1).')
w('- log2(개수+1) 계수의 뜻: 그 종류가 0곳→1곳, 1곳→3곳, 3곳→7곳으로 늘 때마다 곱해지는 배수. b3 은 3곳 이상을 3곳으로 본다(**3곳에서 멈춤은 b1 표에서 3곳 이상이 2곳보다 크지 않은 것을 보고 정한 사후 선택**이다).')
w('- 세 종류가 같은가: 강건 공분산 Wald 검정(자유도 2), 같은 무게 모형 대비 준-우도비(이탈도 차 ÷ 과산포 ĉ). ĉ = b1 모형의 Pearson χ²/자유도. QAIC = 과산포를 감안한 AIC.')
w('- **법정 지정 기준**(저장소 `local_server/knowledge/legal/raw/02_해양경비구조/연안사고예방에관한법률/별표/연안사고안전관리규정_별표1.txt`, 2026-08-31 수집): 사망사고 발생구역 = "최근 3년간 연안 인명(사망·실종)사고가 발생한 구역", 연안사고 다발구역 = "최근 3년간 3건 이상 연안사고가 발생한 구역(사망사고 발생구역 제외)", 연안사고 관리구역 = "위험성이 높은 구역(위험성 평가 항목)". ⚠ 자료의 「연안사고 위험구역」 이 이 「관리구역」 과 같은 것인지, 2023-01-01 지정에 이 판(版)의 기준이 쓰였는지는 확인하지 못했다.')
w('')

# 3. 재현
w('## 3. §4.6 재현')
w('')
txt = open(root + '/local_server/config/coastal_safety/accident_analysis/v3/report.md').read()
sec = txt[txt.index('### 4.6'):txt.index('### 4.7')]
rows = []
def rp(outcome, term, model='출발안 구간(0/1-2/3-5/6+)'):
    r = rep[(rep.outcome == outcome) & (rep.term == term) & (rep.model == model)].iloc[0]; return '%.2f (%.2f–%.2f)' % (r.RR, r.lo, r.hi)
for b in ['1-2', '3-5', '6+']:
    m_ = re.search(r'^\| %s \| (\d+) \| (\d+) \| [\d.]+ \| ([\d.]+ \([\d.]+–[\d.]+\)) \| ([\d.]+ \([\d.]+–[\d.]+\)) \| ([\d.]+ \([\d.]+–[\d.]+\)) \|' % re.escape(b), sec, re.M)
    for col, i, oc in (('2020~24', 3, 'n_all'), ('2023~24', 4, 'n_2023_24'), ('사망·실종', 5, 'n_fatal')):
        mine = rp(oc, 'bin_start_' + b)
        rows.append({'항목': '%s곳 %s' % (b, col), '보고서 §4.6': m_.group(i), '재현': mine, '같은가': '같음' if mine == m_.group(i) else '**다름**'})
fl = re.search(r'사망사고 발생구역이 3km 안에 1곳 이상\(개수 구간 함께 보정\): 전체 사고 ([\d.]+ \([\d.]+–[\d.]+\)); 2023~24 ([\d.]+ \([\d.]+–[\d.]+\)); 사망·실종 사고 ([\d.]+ \([\d.]+–[\d.]+\))', sec)
for col, i, oc in (('2020~24', 1, 'n_all'), ('2023~24', 2, 'n_2023_24'), ('사망·실종', 3, 'n_fatal')):
    mine = rp(oc, 'fatal_any', '출발안 구간 + 사망사고구역 3km 안 있음')
    rows.append({'항목': '사망구역 가산 %s' % col, '보고서 §4.6': fl.group(i), '재현': mine, '같은가': '같음' if mine == fl.group(i) else '**다름**'})
rt = pd.DataFrame(rows); w(md(rt)); w('')
w('→ %d칸 중 %d칸 같음. 구간안 AIC(출발안 2020~24 / 2023~24)도 `repro/log_09c.txt` 에서 보고서와 같은 5125.5 / 2932.0. 재현이 되어 다음으로 넘어갔다.' % (len(rt), (rt['같은가'] == '같음').sum()))
w('')

# 4. 표본
w('## 4. 표본 수 — 종류별 해당 관광지·사고')
w('')
s = smp.copy()
s['2023~24 관광지당 연간'] = s.per_spot_year_2023_24.map(f2); s['2020~24 관광지당 연간'] = s.per_spot_year_all.map(f2)
s = s.rename(columns={'group': '관광지 묶음', 'spots': '관광지 수', 'n_2023_24': '사고 2023~24', 'n_all': '사고 2020~24', 'n_fatal': '사망·실종 2020~24', 'n_fatal_2023_24': '사망·실종 2023~24'})
w(md(s[['관광지 묶음', '관광지 수', '사고 2023~24', '사고 2020~24', '사망·실종 2020~24', '사망·실종 2023~24', '2023~24 관광지당 연간', '2020~24 관광지당 연간']]))
w('')
v = var.rename(columns={'type': '종류', 'sgg_with_variation': '안에서 있음/없음이 갈리는 시군구', 'sgg_total': '전체 시군구', 'spots_in_those_sgg': '그 시군구 관광지', 'n_2023_24_in_those_sgg': '그 시군구 사고 2023~24'})
w('시군구 고정효과 모형은 **같은 시군구 안에서 그 종류가 있는 곳·없는 곳이 갈리는 경우**에서만 배운다:'); w(''); w(md(v)); w('')
w('- 이 표는 기술 통계다(시군구·해안선 보정 전). 관광지당 연간 사고는 "다발만" 25곳이 가장 높지만 25곳뿐이다.')
rch = {k: int(v) for k, v in re.findall(r"'(위험|사망|다발)'\): (\d+)", re.search(r'관광지 3km 안에 한 번이라도 드는 구역 수\(종류별\): (\{.*?\})', open(O + '/log_02.txt').read()).group(1))}
w('- 관광지 3km 안에 한 번이라도 드는 구역: 위험 %d곳 · 사망 %d곳 · 다발 %d곳(전체 527·201·92). 다발 "있음" 관광지가 %d곳으로 구역 수보다 많은 것은 이웃 관광지가 같은 구역을 함께 세기 때문이다 — **다발구역 효과는 실제로는 %d개 구역에서 나온 정보**다.' % (
    rch['위험'], rch['사망'], rch['다발'], int(smp[smp.group == '연안사고 다발구역 1곳 이상'].spots.iloc[0]), rch['다발']))
w('')

# 5. 겹침
w('## 5. 종류끼리 겹치는가')
w('')
log2t = open(O + '/log_02.txt').read()
reach = re.search(r'관광지 3km 안에 한 번이라도 드는 구역 수\(종류별\): (.*)', log2t).group(1)
reach = reach.replace("np.str_('", '').replace("')", '')
w('**구역 자체(820곳)** — 한 구역은 한 종류만 가진다(속성 `구역분류` 1개).'); w('')
w(md(ovp.rename(columns={'type_pair': '종류 쌍', 'overlapping_pairs_area_gt_1m2': '면적이 겹치는 쌍(>1㎡)', 'touching_only_pairs': '닿기만 하는 쌍'}))); w('')
d = dist.copy(); dd = []
for _, r in d.iterrows():
    row = {'종류': r['type'], '구역 수': int(r['zones']), '면적 중앙값(㎡)': int(round(r['area_median_m2']))}
    for u in ['위험', '사망', '다발']:
        if u == r['type']: continue
        row['가장 가까운 %s: 겹침/≤100m/≤500m, 중앙값' % u] = '%d / %d / %d, %d m' % (r['nearest_%s_le_0m' % u], r['nearest_%s_le_100m' % u], r['nearest_%s_le_500m' % u], round(r['nearest_%s_median_m' % u]))
    dd.append(row)
dd = pd.DataFrame(dd).fillna('—'); w(md(dd)); w('')
same = [l.strip() for l in log2t.split('\n') if l.startswith('장소명:') or l.startswith('주소:') or (l.startswith('    ') and '[(' in l)]
w('- 같은 장소명·주소가 두 번 이상 나오는 경우(공백·「(인근)」·「대한민국」 제거 후 비교): ' + ' / '.join(same).replace("np.str_('", "").replace("')", ""))
w('- 관광지 3km 안에 한 번이라도 드는 구역 수(종류별): %s' % reach)
med = [dist.loc[i, c] for i in dist.index for c in dist.columns if c.endswith('_median_m') and pd.notna(dist.loc[i, c])]
w('- → **같은 장소가 여러 종류로 겹쳐 지정된 경우는 드물다**(종류가 다른 구역끼리 면적이 겹치는 쌍 %d개, 같은 주소 다른 종류 1건). 각 구역에서 가장 가까운 다른 종류 구역까지 거리의 중앙값은 %.1f~%.1f km 다.' % (
    int(ovp[ovp.type_pair.isin(['다발-사망', '다발-위험', '사망-위험'])].overlapping_pairs_area_gt_1m2.sum()), min(med) / 1000, max(med) / 1000))
w('')
w('**관광지에서 함께 나타나는 정도(3km 안)**'); w('')
c = co[co.spots_with_first.notna()].copy()
c = pd.DataFrame({'종류 쌍': c.pair, '앞 종류 있음': c.spots_with_first.astype(int), '뒤 종류 있음': c.spots_with_second.astype(int), '둘 다': c.spots_with_both.astype(int),
                  '뒤가 있는 곳 중 앞도 있는 비율': c.share_of_second_that_also_has_first.map(lambda x: '%.0f%%' % (100 * x)),
                  '있음 상관(전체)': c.phi_any_all.map(f2), '있음 상관(시군구 안)': c.phi_any_within_sgg.map(f2), '개수 순위상관(전체)': c.spearman_counts_all.map(f2)})
w(md(c)); w('')
c2 = co[co.spots_with_first.isna()]
w('- 종류별 개수와 **전체 개수**의 순위상관: ' + ' · '.join('%s %.2f' % (r.pair.split('~')[0].replace('hz_', '').replace('_3km', ''), r.spearman_counts_all) for _, r in c2.iterrows()) + ' — **지금의 전체 개수 구간은 사실상 「연안사고 위험구역」 개수를 따라간다**(위험구역이 820곳 중 527곳).')
t = tsb.copy(); t = pd.DataFrame({'출발안 구간': t.bin_start, '관광지 수': t.spots, '위험 있음': t.risk_any.map(lambda x: '%.0f%%' % (100 * x)), '사망 있음': t.fatal_any.map(lambda x: '%.0f%%' % (100 * x)), '다발 있음': t.freq_any.map(lambda x: '%.0f%%' % (100 * x))})
w(''); w('지금 구간별로 각 종류가 있는 관광지 비율:'); w(''); w(md(t)); w('')
w('- 종류끼리의 상관은 낮다(있음 상관 0.1 안팎) — 세 종류를 한 모형에 함께 넣어도 서로 구분해 잴 여지가 있다. 다만 구간이 올라갈수록 세 종류가 모두 늘어, **구간 배수 안에는 종류 효과가 섞여 있다.**')
w('')

# 6. 주 결과
w('## 6. 종류별 효과 — 지정 이후(2023~24) 사고, 주 결과')
w('')
w('사고 %d건, 관광지 1,354곳, 시군구 60개. 「·」 = 신뢰구간이 1을 포함(뚜렷하지 않음).' % ev('n_2023_24')); w('')
rows = []
for k, lab in TY:
    ra, rb2, rb3 = T('n_2023_24', MA, k + '_any'), T('n_2023_24', MB2, k + '_l2'), T('n_2023_24', MB3, k + '_l2c3')
    short = {'risk': '위험구역', 'fatal': '사망구역', 'freq': '다발구역'}[k]
    rc, rcl = T('n_2023_24', 'c %s만 있음' % short, k + '_any'), T('n_2023_24', 'c %s만 log2' % short, k + '_l2')
    rows.append({'종류': lab, '(a) 있음, 세 종류 함께': rr(ra) + mark(ra), '(b2) log2(개수+1) 1단위, 함께': rr(rb2) + mark(rb2), '(b3) 3곳 멈춤, 함께': rr(rb3) + mark(rb3),
                 '(c) 있음, 이 종류만': rr(rc) + mark(rc), '(c) log2, 이 종류만': rr(rcl) + mark(rcl),
                 '있음 관광지': int(smp[smp.group == lab + ' 1곳 이상'].spots.iloc[0]), '그 관광지 사고 2023~24': int(smp[smp.group == lab + ' 1곳 이상'].n_2023_24.iloc[0])})
w(md(pd.DataFrame(rows))); w('')
rows = []
for k, lab in TY:
    row = {'종류': lab}
    for b in ['1', '2', '3+']:
        r = T('n_2023_24', MB1, '%s_b_%s' % (k, b)); n = smp[smp.group == '%s %s곳' % (lab, b)].iloc[0]
        row['%s곳' % b] = '%s%s [%d곳·%d건]' % (rr(r), mark(r), n.spots, n.n_2023_24)
    rows.append(row)
w('(b1) 종류별 개수 구간 0/1/2/3+ 를 세 종류 함께(기준 = 그 종류 0곳) — [관광지 수·그 관광지 2023~24 사고]:'); w(''); w(md(pd.DataFrame(rows))); w('')
w('- **(c) 한 종류만 넣으면** 세 종류 모두 배수가 커진다 — 다른 종류와 함께 있는 몫까지 떠안기 때문이다. 서로 보정한 (a)(b) 가 종류별 "추가" 배수다.')
w('- (a) 에서 「연안사고 위험구역」 은 다른 두 종류를 보정하면 %s 로 뚜렷하지 않다. 다발·사망은 뚜렷하다.' % rr(a23['risk']))
w('- (b1) 에서 사망·다발은 3곳 이상이 2곳과 거의 같거나 작다(사망 %s → %s, 다발 %s → %s) — 같은 종류 개수를 끝없이 더하는 것은 자료가 받쳐 주지 않는다.' % (
    f2(T('n_2023_24', MB1, 'fatal_b_2').RR), f2(T('n_2023_24', MB1, 'fatal_b_3+').RR), f2(T('n_2023_24', MB1, 'freq_b_2').RR), f2(T('n_2023_24', MB1, 'freq_b_3+').RR)))
w('')

# 7. 기간·결과별
w('## 7. 같은 모형을 다른 기간·결과로')
w('')
for model, terms, title in ((MA, '_any', '(a) 종류별 있음 3개 함께'), (MB3, '_l2c3', '(b3) 종류별 log2(min(개수,3)+1) 함께')):
    rows = []
    for y, ylab in OUTS:
        row = {'결과': ylab, '사고 수': ev(y)}
        for k, lab in TY:
            r = T(y, model, k + terms); row[lab] = rr(r) + mark(r)
        e_ = E(y, model); row['세 종류 같은가 p'] = '%.3f' % e_.p
        rows.append(row)
    w(title + ':'); w(''); w(md(pd.DataFrame(rows))); w('')
w('- 전체 사고에서는 세 기간 모두 **순서가 같다(다발 ≥ 사망 > 위험)**. 2020~22(지정 전)에서 차이가 가장 크고 2023~24 에서 작아진다 — 다발·사망 구역이 "최근 3년 사고"로 지정된다는 법정 기준과 같은 방향(순환성)이지만, 표본 크기 차이(1,533건 대 895건)도 있어 어느 쪽인지 가를 수는 없다.')
w('- **사망·실종 사고**: 2020~24 에서 사망구역 %s, 다발구역 %s — 다발구역은 사고는 늘리지만 사망·실종은 늘리지 않는다. 그러나 이 차이는 2020~22(지정 전, 사망구역의 지정 근거 기간으로 보이는 시기)에 몰려 있고, 지정 이후 사망·실종(%d건)에서는 세 종류가 구분되지 않는다(p=%.2f).' % (
    rr(fa['fatal']), rr(fa['freq']), ev('n_fatal_2023_24'), ef23.p))
w('')

# 8. 같은가 검정
w('## 8. 세 종류가 같은가 — 검정')
w('')
rows = []
for y, ylab in OUTS:
    for model, ml in ((MA, '(a) 있음'), (MB3, '(b3) 3곳 멈춤')):
        e_ = E(y, model)
        se_ = seq[(seq.outcome == y) & (seq.model == model)].set_index('se') if y in set(seq.outcome) else None
        rows.append({'결과': ylab, '모형': ml, 'Wald p(HC1)': '%.3f' % e_.p,
                     'Wald p(시군구 군집)': '%.3f' % se_.loc['시군구 군집', 'p'] if se_ is not None else '—',
                     'Wald p(음이항)': '%.3f' % se_.loc['음이항', 'p'] if se_ is not None else '—',
                     '같은 무게 대비 AIC 차': '%.1f' % e_.d_aic_vs_equal, '준-우도비 p': '%.3f' % e_.quasi_lr_p,
                     '사망÷위험': e_.fatal_over_risk.split(' p=')[0], '다발÷위험': e_.freq_over_risk.split(' p=')[0], '사망÷다발': e_.fatal_over_freq.split(' p=')[0]})
w(md(pd.DataFrame(rows))); w('')
w('- 「같은 무게 대비 AIC 차」 가 음수면 종류별 무게가 더 잘 맞는다(-2 안팎은 차이 없음, -10 이하면 큰 차이).')
w('- **지정 이후(2023~24) 전체 사고: 어느 방식으로도 세 종류가 같다는 것을 물리치지 못한다 → 「구분 안 됨」.** 2020~24 는 HC1·음이항으로는 다르지만 시군구 군집 표준오차로는 p=%.2f 로 경계다.' % clall)
w('')

# 9. 유형별
w('## 9. 사고 유형별 — (a) 종류별 있음 3개 함께')
w('')
rows = []
for t_ in ['익수', '추락', '고립', '표류']:
    for y, per in (('n_' + t_, '2020~24'), ('n_%s_2023_24' % t_, '2023~24')):
        row = {'유형': t_, '기간': per, '사고 수': ev(y)}
        for k, lab in TY:
            r = T(y, MA, k + '_any'); row[lab] = rr(r) + mark(r)
        row['같은가 p'] = '%.3f' % E(y, MA).p
        rows.append(row)
w(md(pd.DataFrame(rows))); w('')
w('- **고립**은 다발구역과 강하게 묶인다(2020~24 다발÷위험 %s). 지정 이후로도 같은 방향이지만 구간이 넓다.' % iso.freq_over_risk.split(' p=')[0])
w('- 익수·표류는 세 종류가 같다는 것을 물리치지 못한다(구분 안 됨). 추락 2023~24 는 위험구역 있음이 %s 로 오히려 낮게 나오지만 사고 %d건이고 2020~24 에서는 %s 라 근거로 쓰지 않는다.' % (
    rr(T('n_추락_2023_24', MA, 'risk_any')), ev('n_추락_2023_24'), rr(T('n_추락', MA, 'risk_any'))))
w('- 유형별 표는 여러 번 비교한 것이라(8칸×2모형) 하나만 뚜렷한 칸은 근거로 쓰지 않는다(보고서 §3.6 원칙).')
w('')

# 10. 모형 비교
w('## 10. 자료 적합 비교 (AIC · QAIC)')
w('')
w('AIC 는 낮을수록 잘 맞는다. 같은 결과 안에서만 비교한다. QAIC 는 과산포(ĉ)를 감안한 값으로 차이가 AIC 보다 작게 나온다. 「앱 점수 고정」 은 지금 앱 숫자를 그대로 두고 시군구·해안선만 추정한 것(숫자 4개를 이 자료에서 따왔으므로 공정 비교는 §13.3 에서 +8).')
w('')
order = [MA0, MA1, MAPP, MA2, ML0, 'L0c3 전체 log2(min(개수,3)+1)', 'L0c6 전체 log2(min(개수,6)+1)', ML1, MA, MA_EQ, MB1, MB2, MB2E, MB3, MB3E, 'N 장소 요인 없음']
rows = []
for model in order:
    row = {'모형': model}
    for y, ylab in OUTS[:4]:
        r = M(y, model); row[ylab.replace(' **(주)**', '(주)') + ' ΔAIC / ΔQAIC'] = '%.1f / %.1f' % (r.d_aic, r.d_qaic)
    rows.append(row)
w(md(pd.DataFrame(rows))); w('')
w('ĉ(b1 기준): ' + ' · '.join('%s %.2f' % (ylab.replace(' **(주)**', ''), M(y, MB1).c_hat_b1) for y, ylab in OUTS[:4]) + '. (ΔAIC 0 = 그 결과에서 가장 잘 맞는 모형)')
w('')
w('- 2023~24: 가장 잘 맞는 것은 종류별 log2 개수(b2, b3)와 그 같은 무게판(b2=, b3=)이다. 지금 앱 구조(A0·A1·APP)는 ΔAIC %.1f~%.1f 로 뒤진다.' % (M('n_2023_24', MAPP).d_aic, M('n_2023_24', MA0).d_aic))
w('- 종류별 무게(b3) 대 같은 무게(b3=): ΔAIC %.1f, ΔQAIC %.1f — **종류 구분의 이득은 작다.** 지금 앱 → 종류별 개수(같은 무게)로 바꾸는 이득(ΔAIC %.1f, 앱 숫자 4개를 모수로 센 공정 비교 §13.3)이 훨씬 크다.' % (
    M('n_2023_24', MB3E).aic - M('n_2023_24', MB3).aic, M('n_2023_24', MB3E).qaic - M('n_2023_24', MB3).qaic, fit_app.aic - fit_A.aic))
w('- **이득 나누기(2023~24, AIC)**: 지금 앱 고정값(+8) %.1f → 같은 구조를 한 모형에서 추정(A1) %.1f → 종류 구분 없이 전체 log2(개수+1)(L0, 계수 1개) %.1f → 종류마다 따로 세어 같은 무게(b3=) %.1f → 종류별 무게(b3) %.1f. **가장 큰 몫(%.1f)은 구간을 매끄러운 log 로 바꾸는 데서** 나오고(A1 은 계수가 4개인데도 로그우도가 L0 보다 나쁘다: %.1f 대 %.1f), 전체 개수를 어디서 멈춰도(3·6곳) L0 보다 낫지 않다(%.1f · %.1f).' % (
    fit_app.aic, M('n_2023_24', MA1).aic, M('n_2023_24', ML0).aic, M('n_2023_24', MB3E).aic, M('n_2023_24', MB3).aic, M('n_2023_24', MA1).aic - M('n_2023_24', ML0).aic,
    M('n_2023_24', MA1).loglik, M('n_2023_24', ML0).loglik, M('n_2023_24', 'L0c3 전체 log2(min(개수,3)+1)').aic, M('n_2023_24', 'L0c6 전체 log2(min(개수,6)+1)').aic))
w('- "왜 종류별로 따로 세는 것이 잘 맞나": 전체 개수가 같아도 여러 종류가 섞인 곳이 사고가 더 많은가를 L1(전체 log2 + 있는 종류 수)로 보면, 2023~24 에서 종류 하나 더 있을 때 %s(뚜렷하지 않음), 2020~24 %s. 위험구역이 많이 몰린 곳을 지금 표가 과대 예상하는 것(§13.3)과 함께 보면, **같은 종류(특히 위험구역)가 여러 곳인 것은 한 곳보다 크게 더 위험하지 않다**는 쪽이 자료에 맞는다.' % (
    rr(T('n_2023_24', ML1, 'types_present')), rr(T('n_all', ML1, 'types_present'))))
w('')

# 11. 표본 밖
w('## 11. 표본 밖 확인 — 지정 전(2020~22)으로 모양을 정하고 지정 후(2023~24)에 맞춰 보기')
w('')
w('2023~24 에서는 모양을 고정하고 크기(기울기) 하나만 추정하므로 모든 점수표가 같은 모수 1개로 비교된다. 기울기 < 1 = 지정 전 무게가 지정 후에는 부풀어 있었다는 뜻.')
w('')
rows = []
for _, r in oos.iterrows():
    rows.append({'학습 → 시험': '%s → %s' % ({'n_2020_22': '2020~22 전체', 'n_fatal_2020_22': '2020~22 사망·실종'}[r.train], {'n_2023_24': '2023~24 전체', 'n_fatal_2023_24': '2023~24 사망·실종'}[r.test]),
                 '점수표 모양': r.structure, '기울기(95% 구간)': '%.2f (%.2f–%.2f)' % (r.slope, r.slope_lo, r.slope_hi), '시험 ΔAIC': '%.1f' % r.d_test_aic})
w(md(pd.DataFrame(rows))); w('')
w('- 전체 사고: 지정 전에 정한 **종류별 무게(b3)** 가 **같은 무게(b3=)** 보다 지정 후 사고에 ΔAIC %.1f 더 잘 맞는다 — 종류별 무게에 대한 **약한~중간 근거**(같은 자료 안 검정 §8 은 구분 안 됨). 지금 구조(A1)는 ΔAIC %.1f 로 가장 뒤진다.' % (oA.test_aic - oB.test_aic, oA1.d_test_aic))
w('- 기울기가 모두 1보다 작다(지정 전 무게가 지정 후에는 0.7~0.9배 수준) — §4.6 이 말한 순환성 방향과 같다.')
w('- 사망·실종(2023~24 %d건)은 모양 사이 차이가 작고 기울기 구간이 매우 넓어 구분 안 됨.' % ev('n_fatal_2023_24'))
w('')

# 12. 민감도
w('## 12. 민감도 — 표준오차 방식과 음이항')
w('')
w('이웃 관광지는 같은 위험구역을 함께 세므로 독립이 아니다. 시군구 군집(60개) 강건 표준오차와 음이항(과산포 허용) 회귀로 다시 쟀다.'); w('')
rows = []
for y in ['n_2023_24', 'n_all', 'n_fatal', 'n_fatal_2023_24']:
    for k, lab in TY:
        row = {'결과': dict(OUTS)[y].replace(' **(주)**', '(주)'), '종류(있음, a)': lab}
        for se_ in ['HC1(본문)', '시군구 군집', '음이항']:
            r = sens[(sens.outcome == y) & (sens.model == MA) & (sens.se == se_) & (sens.term == k + '_any')].iloc[0]; row[se_] = rr(r) + mark(r)
        rows.append(row)
w(md(pd.DataFrame(rows))); w('')
w('- 음이항 과산포 α: ' + ' · '.join('%s %.2f' % (dict(OUTS)[y].replace(' **(주)**', ''), seq[(seq.outcome == y) & (seq.model == MA) & (seq.se == '음이항')].nb_alpha.iloc[0]) for y in ['n_2023_24', 'n_all', 'n_fatal', 'n_fatal_2023_24']) + '. 점추정은 방식과 무관하게 거의 같고, 시군구 군집이 구간을 가장 넓힌다. 결론(2023~24 구분 안 됨)은 바뀌지 않는다.')
cc = rd('crosscheck_conditional.csv')
w('- 검산: (a) 를 시군구 묶음 조건부 포아송(statsmodels `ConditionalPoisson`)으로 다시 적합하면 배수 차이가 최대 %.4f — 본문의 고정효과 포아송과 같다(`src/07_crosscheck.py`).' % cc.abs_diff.max())
w('')

# 13. 점수표
w('## 13. 점수를 종류별로 다르게 줘야 하나 — 함의')
w('')
w('### 13.1 지금 표의 두 가지 문제')
w('')
a1 = {b: T('n_2023_24', MA1, 'bin_start_' + b) for b in ['1-2', '3-5', '6+']}; a1f = T('n_2023_24', MA1, 'fatal_any_start')
a0 = {b: T('n_2023_24', MA0, 'bin_start_' + b) for b in ['1-2', '3-5', '6+']}
w('1. **섞어 쓴 값**: 구간 점수는 사망 항이 없는 모형(A0: %s)에서, 사망 가산은 구간과 사망을 함께 넣은 모형(A1)에서 왔다. A1 안에서는 구간 배수가 %s 로 작아진다 — 사망구역이 있는 곳의 몫이 구간 배수에 이미 들어 있었기 때문이다. 6곳 이상+사망구역의 배수: 지금 앱 2^(1.74+0.37) = %.2f, A1 = %.2f × %.2f = %.2f.' % (
    ' / '.join(f2(a0[b].RR) for b in a0), ' / '.join(f2(a1[b].RR) for b in a1), 2 ** 2.11, a1['6+'].RR, a1f.RR, a1['6+'].RR * a1f.RR))
w('   다만 자료 적합에 주는 손해는 작다(§13.3: 지금 앱 고정 대 A1 ΔAIC %.1f).' % (fit_app.aic - fit_A1.aic))
w('2. **종류를 모르는 개수**: 전체 개수는 거의 「연안사고 위험구역」 개수(순위상관 0.82)이고, 위험구역은 다른 두 종류를 보정하면 효과가 가장 작다(§6). 실제로 %s의 사고를 지금 표는 과대 예상한다(관측÷기대 %.2f, §13.3). 후보 A·B 에서는 %.2f·%.2f.' % (g6txt, oe6.oe_app, oe6.oe_candA, oe6.oe_candB))
w('')
w('### 13.2 자료가 지지하는 점수표 후보 (A안: 점수 = log2 배수, 2023~24 적합값)')
w('')
w('한 종류가 n곳일 때 그 종류 몫 점수. 관광지 점수 = 세 종류 몫의 합(후보에는 사망 가산이 따로 없다 — 사망구역은 자기 줄로 들어감).'); w('')
rows = []
for n in range(0, 5):
    r = st3.loc[n]
    rows.append({'그 종류 개수': '%d곳' % n + (' 이상' if n == 3 else ''), '후보 A(세 종류 같음)': f2(r.candA), '후보 B 위험': f2(r.candB_risk), '후보 B 사망': f2(r.candB_fatal), '후보 B 다발': f2(r.candB_freq),
                 '참고: 멈춤 없음 같은 무게(b2=)': f2(r.ref_b2e)})
rows = [x for x in rows if x['그 종류 개수'] != '4곳']
w(md(pd.DataFrame(rows))); w('')
w('- 후보 A = b3= (계수 1개), 후보 B = b3 (계수 3개, **세 종류 차이는 2023~24 안에서는 구분 안 됨 — §8; 지정 전 자료로 정한 모양이 지정 후에도 조금 더 맞음 — §11**).')
w('- 2020~24 로 적합하면 b3 계수가 ' + ' · '.join('%s %.2f' % ({'risk': '위험', 'fatal': '사망', 'freq': '다발'}[k], np.log2(T('n_all', MB3, k + '_l2c3').RR)) for k, lab in TY) + ' (log2 단위, 순환성 가능).')
w('- 비교: 지금 앱 = 전체 0 / 1~2 / 3~5 / 6+ → 0 / 0.70 / 1.24 / 1.74 + 사망구역 있으면 0.37 (최대 2.11).')
w('- **참고(종류를 쓰지 않고 싶다면)**: L0 = %.2f × log2(전체 개수+1). 전체 개수별 점수 — ' % np.log2(T('n_2023_24', ML0, 'all_l2').RR) + ' · '.join('%d곳 %.2f(지금 구간 %.2f)' % (n, r.L0, r.app) for n, r in stL0.iterrows()) + ' — 지금 구간 값은 사망 가산 전. L0 는 사망 가산 없이도 지금 표보다 잘 맞는다(§13.3) — 다만 종류별로 세는 후보 A 보다는 ΔAIC %.1f 뒤진다.' % (fit_L0.aic - fit_A.aic))
w('')
w('### 13.3 자료 적합(2023~24)과 관측÷기대')
w('')
f = sfit.copy(); f = pd.DataFrame({'점수표': f.table, '이 자료에서 정한 숫자 수': f.score_params, 'AIC': f.aic.map(lambda x: '%.1f' % x), 'ΔAIC': f.d_aic.map(lambda x: '%.1f' % x), 'ΔQAIC': f.d_qaic.map(lambda x: '%.1f' % x)})
w(md(f)); w('')
o = soe.copy(); o = pd.DataFrame({'지금 앱 단계': o.group, '지금 점수': o.app_score.map(f2), '관광지': o.spots, '사고 2023~24': o.observed,
                                  '관측÷기대: 지금 앱': o.oe_app.map(f2), 'A1': o.oe_a1.map(f2), 'L0': o.oe_L0.map(f2), '후보 A': o.oe_candA.map(f2), '후보 B': o.oe_candB.map(f2)})
w('각 점수표를 고정하고 시군구·해안선만 추정했을 때, 지금 앱 단계별 관측 사고 ÷ 기대 사고(1에서 멀수록 그 단계를 틀리게 예상):'); w(''); w(md(o)); w('')
w('### 13.4 관광지 1,354곳 점수가 어떻게 바뀌나')
w('')
s2 = ssum.copy(); s2 = pd.DataFrame({'점수표': s2.table, '평균': s2['mean'].map(f2), '중앙값': s2['median'].map(f2), '최대': s2['max'].map(f2), '0 아닌 최소': s2.min_nonzero.map(f2),
                                     '지금 앱과 순위상관': s2.spearman_vs_app.map(f2), '0.25점 이상 오름': s2.n_up_ge_0_25, '0.25점 이상 내림': s2.n_down_ge_0_25, '변화 0.25점 미만': s2.n_abs_lt_0_25})
w(md(s2)); w('')
cb = scombo.copy(); cb = pd.DataFrame({'3km 안 종류 조합': cb.combo, '관광지': cb.spots, '평균 구역 수': cb.zones_mean.map(f2), '지금 앱': cb.s_app.map(f2), 'A1': cb.s_a1.map(f2), 'L0': cb.s_L0.map(f2),
                                       '후보 A': cb.s_candA.map(f2), '후보 B': cb.s_candB.map(f2), '사고 2023~24(합)': cb.acc_2023_24})
w('종류 조합별 평균 장소 점수:'); w(''); w(md(cb)); w('')
x = sex.copy(); x = pd.DataFrame({'묶음': x.group, '관광지': x.name, '시군구': x.sgg_name, '위험/사망/다발': x.apply(lambda r: '%d/%d/%d' % (r.hz_risk_3km, r.hz_fatal_3km, r.hz_freq_3km), axis=1),
                                  '사고 2023~24 / 2020~24': x.apply(lambda r: '%d / %d' % (r.n_2023_24, r.n_all), axis=1), '지금 앱': x.s_app.map(f2), 'A1': x.s_a1.map(f2), 'L0': x.s_L0.map(f2), '후보 A': x.s_candA.map(f2), '후보 B': x.s_candB.map(f2)})
w('예시(같은 관광지가 두 묶음에 나올 수 있음; 사고 수는 참고용 기술값 — 한 곳의 사고 수로 점수표를 판단하지 않는다):'); w(''); w(md(x)); w('')
w('- 장소 점수는 연안 점수의 한 요소다(`risk_score.js` 는 요소 점수를 더해 0~3점을 0~100 지수로 바꾼다). 후보로 바꾸면 장소 몫의 평균이 내려가 전체 지수 분포도 함께 바뀐다 — 다른 요소와 합친 결과는 이 분석에서 재지 않았다.')
w('')
w('### 13.5 정리 — 「종류별로 다르게 줘야 하나」')
w('')
w('- **지금 표를 바꿀 근거는 자료가 뚜렷하게 준다**: 지금 표 → 후보 A·B 로 지정 이후 사고 적합이 크게 좋아진다(ΔAIC %.1f / %.1f, ΔQAIC %.1f / %.1f). 다만 그 이득의 대부분(ΔAIC %.1f)은 **종류와 무관하게** 4단계 구간을 매끄러운 개수 함수로 바꾸는 데서 나온다(§10).' % (
    fit_app.aic - fit_A.aic, fit_app.aic - fit_B.aic, fit_app.qaic - fit_A.qaic, fit_app.qaic - fit_B.qaic, fit_app.aic - fit_L0.aic))
w('- **종류마다 따로 세는 것(같은 무게)** 은 추가로 ΔAIC %.1f(과산포 감안 ΔQAIC %.1f) 좋아진다 — 구간→log 의 이득보다 작다. 같은 종류(특히 위험구역)가 여러 곳 몰린 것을 덜 쳐 주는 효과다.' % (fit_L0.aic - fit_A.aic, fit_L0.qaic - fit_A.qaic))
w('- **종류마다 무게를 다르게(다발 > 사망 > 위험) 주는 것은 근거가 약하다**: 같은 자료 안에서는 구분 안 됨, 지정 전→지정 후 표본 밖 확인에서는 조금 더 맞음. 단순함을 우선하면 후보 A, 점추정 순서를 반영하려면 후보 B.')
w('- **사망 가산(+0.37)을 따로 두는 지금 방식**은 사망·실종 사고 쪽으로 2020~24 근거가 있으나(사망구역 %s) 지정 이후 사망·실종으로는 확인되지 않는다(구간 함께 넣은 가산 %s, %d건). 후보 A·B 에서는 사망구역이 자기 줄로 들어가므로 별도 가산이 필요 없다.' % (rr(fa['fatal']), rr(T('n_fatal_2023_24', MA1, 'fatal_any_start')), ev('n_fatal_2023_24')))
w('- 이 문서는 분석 결과다. 점수표를 바꿀지는 사용자 결정 사항이다(보고서 §8.7 과 같은 성격).')
w('')

# 14. 한계
w('## 14. 한계')
w('')
w('- **관광지 단위 비교**다. 날짜·방문자와 위험구역 종류의 상호작용(사람이 많은 날 다발구역 효과가 더 커지는가 등)은 재지 않았다. 전체 개수 구간 × 방문자 상호작용은 보고서 §12.6(`31_extras.py`)에 있다.')
w('- 관광지 목록에 **전남이 없다**(보고서 §9) — 전남 위험구역은 이 분석에 거의 들어오지 않는다.')
w('- **순환성**: 다발·사망 구역은 법정 기준상 지정 전 3년 사고로 정해진다(지정에 그 기준이 쓰였는지는 미확인). 2023~24 만 쓰면 순환성은 줄지만 표본이 작아져(%d건, 사망·실종 %d건) 종류 차이를 가를 힘이 약하다 — 「구분 안 됨」은 「같다」가 아니다.' % (ev('n_2023_24'), ev('n_fatal_2023_24')))
w('- 이웃 관광지가 같은 구역을 함께 센다(독립 아님) — 시군구 군집 표준오차로 보완했으나 완전하지 않다.')
w('- 3km 안 개수는 구역까지 거리·구역 크기를 보지 않는다(다발구역 면적 중앙값이 위험구역의 약 %.1f배, §5).' % (dist.set_index('type').loc['다발', 'area_median_m2'] / dist.set_index('type').loc['위험', 'area_median_m2']))
w('- 후보 점수표는 같은 2023~24 자료로 정하고 같은 자료로 적합을 봤다(표본 안). 3곳 멈춤은 사후 선택. 표본 밖 확인(§11)은 모양만 지정 전 자료로 정한 것이다.')
w('- 자료의 「연안사고 위험구역」 이 법정 「연안사고 관리구역」 과 같은 것인지 확인하지 못했다.')
w('- 사고 유형별·사망·실종 2023~24 칸은 사고 수가 작아(추락 %d건, 사망·실종 %d건) 구간이 넓다.' % (ev('n_추락_2023_24'), ev('n_fatal_2023_24')))
w('')
w('## 15. 파일과 재현')
w('')
w('작업 폴더: `local_server/tools/coastal_accident_analysis/u81/hazard_types/`')
w('')
w('한 번에: `bash run_all.sh` (약 1.5분). 단계별:')
w('')
w('```')
w('D=<tools/run_all.sh 가 만든 data 폴더>   # §4.6 이 쓴 중간 파일(04_geo.py 산출) — 00 이 저장소 원자료와 대조')
w('export OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1   # 이 환경에서 다중 스레드 BLAS 가 적합을 약 100배 느리게 함')
w('python3 -I src/00_verify_inputs.py <저장소> $D out   # 입력 대조')
w('python3 -I src/09_spots.py $D repro && python3 -I src/09c_bins_compare.py repro   # §4.6 재현(저장소 스크립트 사본, 수정 없음)')
w('python3 -I src/01_type_models.py $D repro out   # 종류별 모형·검정·표본')
w('python3 -I src/02_overlap.py <저장소> out   # 겹침·동시 출현')
w('python3 -I src/03_scores.py out   # 점수표 후보·관측÷기대·예시')
w('python3 -I src/04_sensitivity.py out   # 시군구 군집·음이항')
w('python3 -I src/05_oos.py out   # 지정 전 → 지정 후 표본 밖')
w('python3 -I src/07_crosscheck.py out   # 조건부 포아송 검산')
w('python3 -I src/06_build_report.py <저장소> .   # 이 문서')
w('```')
w('')
w('결과 CSV: `out/type_models.csv`(모든 계수) · `out/model_compare.csv`(AIC·QAIC) · `out/equality_tests.csv` · `out/samples_by_type.csv` · `out/overlap_*.csv` · `out/cooccurrence_at_spots.csv` · `out/score_*.csv` · `out/sensitivity_*.csv` · `out/oos_2020_22_to_2023_24.csv` · `out/spots_scores.csv`(관광지별 종류 개수·점수).')
open(W + '/report_hazard_types.md', 'w').write('\n'.join(L) + '\n')
print('written', len(L), 'lines')
