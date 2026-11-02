"""기타(인명, ATY008)를 결과 사고에 더하면 U81 근거(사람·달·위험구역·사망실종)가 어떻게 바뀌나 — 비교 분석(앱 점수표는 안 바꾼다).

왜: 사용자 질문(2026-10-16) — *"관련 사고사례에 기타(인명)도 포함해줘. 그리고 이 기준에 따르면 기타(인명)도 반영하여 다시
    위험지수 분석을 분석해봐야하겠는걸? 이렇게 되면 어떻게 될까?"*
    지금 분석 사고 = 익수 ATY001·추락 ATY002·고립 ATY003·표류 ATY007(변사 ATY005 는 2026-10-10 사용자 결정으로 제외).
    기타(인명) ATY008 은 설계서(coastal_risk.design.md §7.1·§11-Q1)에서 「내용 불명 — 판정 보류」로 빠져 있었다.
    자살 ATY006·변사 ATY005·해양오염 ATY034 는 이 비교에서도 계속 뺀다.
표본 세 가지:
    B    = 지금 분석(4유형) — <저장소> accident_features_person 에서 변사를 뺀 3,075건(window_compare.py 와 같은 방법, v2 와 일치)
    O    = B + 기타(인명) 전부
    Opos = B + 기타(인명) 중 사고자(ACDNT_PRSN) 1명 이상만 — 기타는 사고자 0명 행이 많아(4유형은 거의 없음) 따로 본다
기타 사고 위치 연결(해상특보구역·시군구·관광지)은 03_events.py·04_geo.py 와 같은 규칙을 이 파일에서 다시 짠다
    (중복 = 같은 좌표·날짜·유형 1건 · 특보구역 폴리곤 안 아니면 3km 이내 최근접 · 시군구 = 행정동 경계를 합친 다각형 안 아니면 10km 이내 ·
     관광지 = coastal_spots.json 3km 이내 최근접). 같은 코드로 4유형+변사 3,331건도 다시 연결해 저장된 값과 대조한다(geo_check.csv).
    시군구 경계(vuski/admdongkor HangJeongDong_ver20241231.geojson)는 저장소에 없다 → --admdong 로 주면 다시 연결하고,
    안 주면 이 폴더에 남긴 other_person_geo.csv(앞선 실행의 연결 결과)를 읽는다.
모형(각각 지금 근거와 같은 틀 — 표본 B 는 저장소 결과를 그대로 재현해야 한다. repro_check.csv):
    ① 사람 2배당(앱 crowdScore 0.97 · 1.96배 · 사망·실종 1.54배의 출처) = 07_person.py D2: 층 = 사고 × 그 연월,
       log2(외지인 방문자) + 요일 6 + 공휴일, 군집 = 사고 날짜. 대조: v3/data/person_models.csv
    ② 달 12개월(앱 MONTHS) = month_relative.py 주 모형 M: 층 = 사고 × 그 해, 달 11 + log2(오늘 ÷ 그날부터 30일 기하평균) + 달력.
       대조: v3/data/u81/month_relative/month_relative.csv 「M 주」
    ③ 위험구역(앱 HAZARD_PER_TYPE 후보 A) = hazard_types/01_type_models.py b3=: 관광지 1,354곳 포아송 + 시군구 고정효과 +
       log(관광지 몫 해안선 칸 + 1), HC1. 결과 = 2023~24 전체(주)·2023~24 사망·실종. 종류별 무게(b3)·다른 꼴(b2·b2=·L0·A1·없음) AIC 도.
       대조: v3/data/u81/hazard_types/type_models.csv · model_compare.csv
    ④ 같은 표본 비교(표본 O 안에서): 기타 여부와의 상호작용 — 사람 항 × 기타, 달 11 × 기타(묶음 Wald), 위험구역 × 기타(관광지 × 묶음 2행 쌓기,
       시군구×묶음 고정효과, 관광지 군집 강건 SE). 「기타가 4유형과 같은 모양인가」를 같은 자료 안에서 본다.
    ⑤ 미리보기(선택, --base <base.json>): preview.js 와 같은 입력(10-09 수집 30일 집중률)·같은 실제 scoreCoast 로,
       점수표 숫자만 표본별 새 값으로 바꿔(require 캐시에 바꾼 risk_points 를 넣음 — 앱 파일은 안 건드림) 10-15(목)·10-17(토) 단계 분포를 센다.
사용: OMP_NUM_THREADS=1 python3 -I other_type_compare.py [출력 폴더] [--admdong <HangJeongDong_ver20241231.geojson>] [--base <coast_alt/base.json>]
      출력 폴더 기본 = <저장소>/local_server/config/coastal_safety/accident_analysis/v3/data/u81/other_type (약 3분)
출력: other_person_geo.csv · geo_check.csv · samples.csv · crowd_models.csv · month_models.csv · hazard_models.csv · hazard_compare.csv ·
      same_sample_tests.csv · repro_check.csv · app_values.csv · preview.csv(--base 줄 때)
"""
import sys, os, json, csv, collections, subprocess, warnings
import numpy as np, pandas as pd, statsmodels.api as sm
from scipy.stats import chi2, norm as zdist
HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.dirname(HERE)
REPO = os.path.abspath(os.path.join(TOOLS, '..', '..', '..'))
DATA = os.path.join(REPO, 'local_server', 'config', 'coastal_safety', 'accident_analysis', 'data')
V3 = os.path.join(REPO, 'local_server', 'config', 'coastal_safety', 'accident_analysis', 'v3', 'data')
U81 = os.path.join(V3, 'u81')
args = sys.argv[1:]
def opt(name):
    if name in args:
        i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return None
ADM, BASE = opt('--admdong'), opt('--base')
OUT = args[0] if args else os.path.join(U81, 'other_type')
sys.path.insert(0, TOOLS)
import expo, ccr
os.makedirs(OUT, exist_ok=True)
warnings.filterwarnings('ignore', category=RuntimeWarning)
pd.set_option('display.width', 250)

# ───────────── 1. 기타(인명) 뽑기 + 위치 연결 ─────────────
RAW = json.load(open(REPO + '/client/accident_persons.json'))['rows']   # [lat,lon,ymd,pos,typeCd,orgCd,prsn,rescue,death,missing,...]
af = pd.read_csv(DATA + '/accident_features_person_2020_2024.csv.gz', dtype={'date': str, 'sgg': str})

def extract(codes, label):
    """03_events.py 와 같은 규칙: 2020-01-01~2024-12-31, 같은 좌표·날짜·유형 완전중복은 1건(먼저 나온 행)."""
    seen, out, ndup = set(), [], 0
    for i, r in enumerate(RAW):
        if r[4] in codes and '20200101' <= r[2] <= '20241231':
            k = (r[0], r[1], r[2], r[4])
            if k in seen: ndup += 1; continue
            seen.add(k)
            out.append(dict(pid=i, date=r[2], type=label.get(r[4], r[4]), code=r[4], lat=r[0], lon=r[1], prsn=r[6] or 0, rescue=r[7] or 0,
                            death=r[8] or 0, missing=r[9] or 0, pos=(r[3] or '').strip()))
    return out, ndup

def geocode(rows):
    """04_geo.py 와 같은 규칙(해상특보구역 · 시군구 · 관광지). 시군구 경계 파일(ADM)이 필요하다."""
    import shapely, re
    from shapely.geometry import shape
    from shapely.ops import unary_union
    from shapely.strtree import STRtree
    from pyproj import Transformer
    TR = Transformer.from_crs(4326, 5179, always_xy=True)
    Pj = lambda g: shapely.transform(g, lambda xy: np.column_stack(TR.transform(xy[:, 0], xy[:, 1])))
    def pts(lons, lats):
        x, y = TR.transform(np.asarray(lons, float), np.asarray(lats, float)); return shapely.points(x, y)
    nm = lambda s: re.sub(r'[\s·.]', '', s)
    def assign_poly(points, tree, maxd):
        oi = np.full(len(points), -1); od = np.full(len(points), np.nan)
        for a, b in zip(*tree.query(points, predicate='within')):
            if oi[a] < 0: oi[a] = b; od[a] = 0.0
        rest = np.where(oi < 0)[0]
        if len(rest):
            (ai, bi), dd = tree.query_nearest(points[rest], max_distance=maxd, return_distance=True, all_matches=False)
            for a, b, d in zip(ai, bi, dd): oi[rest[a]] = b; od[rest[a]] = d
        return oi, od
    pP = pts([r['lon'] for r in rows], [r['lat'] for r in rows])
    sea = json.load(open(REPO + '/client/assets/warn_zones.geojson'))['features']
    seaN = [nm(f['properties']['name']) for f in sea]
    si, sd = assign_poly(pP, STRtree([shapely.make_valid(Pj(shape(f['geometry']))) for f in sea]), 3000)
    adm = json.load(open(ADM))['features']; by = collections.defaultdict(list)
    for f in adm: by[f['properties']['sgg']].append(shape(f['geometry']))
    sggC = sorted(by)
    gi, gd = assign_poly(pP, STRtree([Pj(shapely.make_valid(unary_union(by[c]))) for c in sggC]), 10000)
    spots = json.load(open(REPO + '/local_server/config/coastal_safety/coastal_spots.json'))['spots']
    (ai, bi), dd = STRtree(pts([s['lon'] for s in spots], [s['lat'] for s in spots])).query_nearest(pP, max_distance=3000, return_distance=True, all_matches=False)
    sp = np.full(len(rows), -1); spd = np.full(len(rows), np.nan)
    for a, b, d in zip(ai, bi, dd): sp[a] = b; spd[a] = d
    g = pd.DataFrame(rows)
    g['sea_zone'] = [seaN[k] if k >= 0 else None for k in si]; g['sea_d_m'] = np.round(sd)
    g['sgg'] = [sggC[k] if k >= 0 else None for k in gi]; g['sgg_d_m'] = np.round(gd)
    g['spot'] = np.where(sp >= 0, sp, np.nan); g['spot_d_m'] = np.round(spd)
    return g

oth_rows, oth_dup = extract({'ATY008'}, {'ATY008': '기타(인명)'})
GEO = OUT + '/other_person_geo.csv'
if ADM:
    og = geocode(oth_rows)
    og.to_csv(GEO, index=False, encoding='utf-8-sig')
    # 같은 코드로 4유형+변사(저장소 내보내기 3,331건 = 04_geo 결과)를 다시 연결해 대조
    PT = {'ATY001': '익수', 'ATY002': '추락', 'ATY003': '고립', 'ATY007': '표류', 'ATY005': '변사'}
    brows, _ = extract(set(PT), PT)
    bg = geocode(brows).set_index('pid'); a = af.set_index('pid')
    j = a.join(bg[['sea_zone', 'sgg', 'spot']], rsuffix='_re', how='left')
    same = lambda x, y: (x.fillna('∅').astype(str).str.replace(r'\.0$', '', regex=True) == y.fillna('∅').astype(str).str.replace(r'\.0$', '', regex=True))
    gc = [dict(item=c, rows=len(j), same=int(same(j[c], j[c + '_re']).sum()), differ=int((~same(j[c], j[c + '_re'])).sum())) for c in ('sea_zone', 'sgg', 'spot')]
    gc.append(dict(item='re-extracted rows (4유형+변사, 2020~24, 중복 제거)', rows=len(brows), same=int(len(set(bg.index) & set(a.index))), differ=len(set(a.index) - set(bg.index))))
    pd.DataFrame(gc).to_csv(OUT + '/geo_check.csv', index=False, encoding='utf-8-sig'); print(pd.DataFrame(gc).to_string())
else:
    og = pd.read_csv(GEO, dtype={'date': str, 'sgg': str})
    assert len(og) == len(oth_rows) and (og.pid.values == np.array([r['pid'] for r in oth_rows])).all(), '저장된 연결 결과가 지금 원자료와 다르다 — --admdong 로 다시 연결'
print('기타(인명) 2020~24', len(oth_rows), '중복 제거', oth_dup, '· 특보구역 3km 밖', int(og.sea_zone.isna().sum()))

# ───────────── 2. 표본 ─────────────
base = af[af.type != '변사'].copy(); base['other'] = 0
oth = og[og.sea_zone.notna()].copy(); oth['other'] = 1
COLS = ['pid', 'date', 'type', 'sea_zone', 'sgg', 'spot', 'death', 'missing', 'other']
SAMPLES = {'B': base[COLS], 'O': pd.concat([base[COLS], oth[COLS]], ignore_index=True),
           'Opos': pd.concat([base[COLS], oth[oth.prsn > 0][COLS]], ignore_index=True)}
SDESC = {'B': '지금 분석(익수·추락·고립·표류)', 'O': '+ 기타(인명) 전부', 'Opos': '+ 기타(인명) 사고자 1명 이상만'}
for k, s in SAMPLES.items():
    s['fatal'] = (s.death.fillna(0) + s.missing.fillna(0)) > 0; s['late'] = s.date >= '20230101'

dow, hol, month, year = expo.calendar()
v = pd.read_csv(DATA + '/visitors_daily_coastal_sgg_2020_2024.csv.gz', dtype={'sgg': str, 'date': str}); v = v[v.date.isin(expo.DIDX)]
vzi = {s: i for i, s in enumerate(sorted(v.sgg.unique()))}
V = np.full((len(vzi), expo.ND), np.nan); V[v.sgg.map(vzi).values, v.date.map(expo.DIDX).values] = v.outsider.values
V32 = V.astype(np.float32)          # 07_person.py 는 float32 로 읽는다(D2 재현용)
first, last = expo.DIDX[v.date.min()], expo.DIDX[v.date.max()]
pos = np.where(V > 0, V, np.nan); G30 = np.full_like(V, np.nan)
for t in range(first, last + 1):     # month_relative.py window('geo', 30): t..t+29, 유효 날 30 미만이면 NaN
    w = pos[:, t:min(t + 30, last + 1)]; n = np.sum(np.isfinite(w), axis=1)
    G30[:, t] = np.where(n >= 30, np.exp(np.nanmean(np.log(w), axis=1)), np.nan)

smp = []
for k, s in SAMPLES.items():
    o = s[s.other == 1]
    smp.append(dict(sample=k, desc=SDESC[k], events=len(s), other_events=len(o), fatal=int(s.fatal.sum()), other_fatal=int(o.fatal.sum()),
                    with_visitor_sgg=int(s.sgg.isin(vzi).sum()), at_spot=int(s.spot.notna().sum()), at_spot_2023_24=int((s.spot.notna() & s.late).sum()),
                    at_spot_fatal_2023_24=int((s.spot.notna() & s.late & s.fatal).sum())))
oc = pd.DataFrame(oth_rows)
smp.append(dict(sample='기타 원자료', desc='ATY008 2020~24 중복 제거(특보구역 연결 전)', events=len(oc), other_events=len(oc),
                fatal=int(((oc.death + oc.missing) > 0).sum()), other_fatal=int(((oc.death + oc.missing) > 0).sum()),
                with_visitor_sgg=np.nan, at_spot=np.nan, at_spot_2023_24=np.nan, at_spot_fatal_2023_24=np.nan,
                prsn0=int((oc.prsn == 0).sum()), prsn0_with_death_or_missing=int(((oc.prsn == 0) & ((oc.death + oc.missing) > 0)).sum())))
for code, lab in (('ATY001', '익수'), ('ATY002', '추락'), ('ATY003', '고립'), ('ATY007', '표류')):
    rr, _ = extract({code}, {code: lab})
    smp.append(dict(sample='참고 ' + lab, desc='원자료 2020~24 중복 제거', events=len(rr), prsn0=sum(1 for r in rr if r['prsn'] == 0)))
SM = pd.DataFrame(smp); SM.to_csv(OUT + '/samples.csv', index=False, encoding='utf-8-sig'); print(SM.to_string())

# ───────────── 3. 사람(D2)·달(M) — 조건부 포아송 ─────────────
CAL = ['dow%d' % d for d in range(1, 7)] + ['hol']
MN = ['m%d' % i for i in range(2, 13)]
DAYS = np.array([31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]); W = DAYS / DAYS.sum()

def rows_for(s, stratum):
    rec = collections.defaultdict(list)
    for k, r in enumerate(s.itertuples()):
        ci = expo.DIDX[r.date]
        if stratum == 'ym':
            days = np.where((year == year[ci]) & (month == month[ci]))[0]
        else:
            if ci > last: continue
            days = np.where(year == year[ci])[0]; days = days[days <= last]
        vi = vzi.get(r.sgg) if isinstance(r.sgg, str) else None
        if vi is None and stratum != 'ym': continue
        rec['ev'].append(np.full(len(days), k)); rec['day'].append(days); rec['case'].append((days == ci).astype(np.int8))
        if stratum == 'ym':
            rec['vo'].append(V32[vi, days] if vi is not None else np.full(len(days), np.nan, np.float32))
        else:
            rec['vo'].append(V[vi, days]); rec['g30'].append(G30[vi, days])
    md = pd.DataFrame({c: np.concatenate(x) for c, x in rec.items()})
    md['cl'] = s.date.values[md.ev.values]; md['other'] = s.other.values[md.ev.values].astype(float); md['fatal'] = s.fatal.values[md.ev.values]
    for d in range(1, 7): md['dow%d' % d] = (dow[md.day.values] == d).astype(float)
    md['hol'] = hol[md.day.values].astype(float)
    mm = month[md.day.values]
    for i in range(2, 13): md['m%d' % i] = (mm == i).astype(float)
    return md

def wald(r, idx):
    b = r['b'][idx]; Vv = r['V'][np.ix_(idx, idx)]; x = float(b @ np.linalg.solve(Vv, b)); return x, len(idx), float(chi2.sf(x, len(idx)))

crow, mrow, trow = [], [], []
for k, s in SAMPLES.items():
    # ① D2: 층 = 사고 × 연월, 외지인 방문자 > 0
    d2 = rows_for(s, 'ym'); d2 = d2[d2.vo.notna() & (d2.vo > 0)].copy(); d2['x'] = np.log2(d2.vo)
    d2['x_o'] = d2.x * d2.other
    for oc_, q in (('전체 사고', d2), ('사망·실종 사고', d2[d2.fatal])):
        cols = ['x'] + CAL
        r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
        b, se = r['b'][0], r['se'][0]
        crow.append(dict(sample=k, outcome=oc_, n_events=int(r['n_events']), n_other=int(q[q.case == 1].other.sum()), RR2x=np.exp(b), lo=np.exp(b - 1.96 * se), hi=np.exp(b + 1.96 * se),
                         score=b / np.log(2), p=float(2 * zdist.sf(abs(b / se)))))
        if k == 'O':      # ④ 같은 표본: 사람 항 × 기타
            cols = ['x', 'x_o'] + CAL
            r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
            b, se = r['b'][1], r['se'][1]
            trow.append(dict(test='사람(D2) 2배당 배수: 기타 ÷ 4유형', outcome=oc_, ratio=np.exp(b), lo=np.exp(b - 1.96 * se), hi=np.exp(b + 1.96 * se),
                             chi2=(b / se) ** 2, df=1, p=float(2 * zdist.sf(abs(b / se))), other_RR2x=np.exp(r['b'][0] + b), n_other=int(q[q.case == 1].other.sum())))
    # ② M: 층 = 사고 × 그 해, 사람 = log2(오늘 ÷ 30일 기하평균)
    mq = rows_for(s, 'year')
    with np.errstate(divide='ignore', invalid='ignore'): mq['lg'] = np.log2(mq.vo / mq.g30)
    mq = mq.replace([np.inf, -np.inf], np.nan).dropna(subset=['lg'])
    for oc_, q in (('전체 사고', mq), ('사망·실종 사고', mq[mq.fatal])):
        cols = MN + ['lg'] + CAL
        r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
        j = cols.index('lg'); bc, sc = r['b'][j], r['se'][j]
        bb = np.r_[0.0, r['b'][:11]]; Vm = np.zeros((12, 12)); Vm[1:, 1:] = r['V'][:11, :11]
        for i in range(12):
            c = -W.copy(); c[i] += 1; est = c @ bb; se = np.sqrt(c @ Vm @ c)
            mrow.append(dict(sample=k, outcome=oc_, month=i + 1, RR=np.exp(est), lo=np.exp(est - 1.96 * se), hi=np.exp(est + 1.96 * se), score=est / np.log(2),
                             score_lo=(est - 1.96 * se) / np.log(2), score_hi=(est + 1.96 * se) / np.log(2),
                             n_month=int(((q.case == 1) & (month[q.day.values] == i + 1)).sum()), n_events=int(r['n_events']),
                             rel_crowd_RR2x=np.exp(bc), rel_crowd_lo=np.exp(bc - 1.96 * sc), rel_crowd_hi=np.exp(bc + 1.96 * sc)))
        if k == 'O':      # ④ 같은 표본: 사람(상대) × 기타, 달 11 × 기타
            q = q.copy(); q['lg_o'] = q.lg * q.other
            for m_ in MN: q[m_ + '_o'] = q[m_] * q.other
            cols = MN + ['lg'] + CAL + ['lg_o'] + [m_ + '_o' for m_ in MN]
            r = ccr.fit(q.ev.values, q.case.values, q[cols].values.astype(float), cluster=q.cl.values, names=cols)
            j = cols.index('lg_o'); b, se = r['b'][j], r['se'][j]
            trow.append(dict(test='사람(상대, M) 2배당 배수: 기타 ÷ 4유형', outcome=oc_, ratio=np.exp(b), lo=np.exp(b - 1.96 * se), hi=np.exp(b + 1.96 * se),
                             chi2=(b / se) ** 2, df=1, p=float(2 * zdist.sf(abs(b / se))), n_other=int(q[q.case == 1].other.sum())))
            x, df_, p = wald(r, [cols.index(m_ + '_o') for m_ in MN])
            per = np.bincount(month[q[(q.case == 1) & (q.other == 1)].day.values], minlength=13)[1:]
            note = '기타 사고 달별 ' + '/'.join(map(str, per))
            if per.min() == 0:     # 기타 사고가 0건인 달은 그 달 × 기타 계수가 끝없이 커져(발산) 검정값이 뜻이 없다
                x, p, note = np.nan, np.nan, note + ' — 0건인 달이 있어 추정 불가'
            trow.append(dict(test='달 11개 × 기타 묶음(달 모양이 같은가)', outcome=oc_, chi2=x, df=df_, p=p, n_other=int(q[q.case == 1].other.sum()), note=note))
    print(k, 'D2/M 끝')
CR = pd.DataFrame(crow); CR.to_csv(OUT + '/crowd_models.csv', index=False, encoding='utf-8-sig'); print(CR.round(3).to_string())
MR = pd.DataFrame(mrow); MR.to_csv(OUT + '/month_models.csv', index=False, encoding='utf-8-sig')

# ───────────── 4. 위험구역 — 관광지 단위 ─────────────
spf = pd.read_csv(DATA + '/spots_hazard_3km.csv', dtype={'sgg': str})[['spot', 'sgg', 'hz_all_3km', 'hz_fatal_3km', 'hz_freq_3km', 'hz_risk_3km', 'coast_cells_share']]
assert (spf.spot.values == np.arange(len(spf))).all()
spf['log_coast'] = np.log(spf.coast_cells_share + 1)
T3 = [('risk', 'hz_risk_3km'), ('fatal', 'hz_fatal_3km'), ('freq', 'hz_freq_3km')]
for t, c in T3:
    spf[t + '_any'] = (spf[c] > 0).astype(float); spf[t + '_l2'] = np.log2(spf[c] + 1); spf[t + '_l2c3'] = np.log2(spf[c].clip(upper=3) + 1)
spf['l2c3sum'] = sum(spf[t + '_l2c3'] for t, _ in T3); spf['l2sum'] = sum(spf[t + '_l2'] for t, _ in T3); spf['all_l2'] = np.log2(spf.hz_all_3km + 1)
spf['bin_start'] = pd.cut(spf.hz_all_3km, [0, 1, 3, 6, 999], labels=['0', '1-2', '3-5', '6+'], right=False).astype(str)
SGG = pd.get_dummies(spf.sgg, prefix='sgg', drop_first=True, dtype=float)
HM = [('b3= 후보 A(종류 같은 무게·3곳 멈춤)', ['l2c3sum']), ('b3 종류별 무게·3곳 멈춤', ['risk_l2c3', 'fatal_l2c3', 'freq_l2c3']),
      ('b2= 종류 같은 무게·멈춤 없음', ['l2sum']), ('b2 종류별 무게·멈춤 없음', ['risk_l2', 'fatal_l2', 'freq_l2']),
      ('L0 종류 구분 없이 log2(개수+1)', ['all_l2']), ('A1 종전 구간 + 사망구역 있음', ['bin_start', 'fatal_any']), ('N 장소 요인 없음', [])]
def hfit(y, terms, data=spf, extra=None):
    parts = []
    for t in terms:
        if t == 'bin_start': X = pd.get_dummies(data[t], prefix=t, dtype=float).drop(columns=t + '_0'); parts.append(X)
        else: parts.append(data[[t]].astype(float))
    X = sm.add_constant(pd.concat(parts + [data[['log_coast']], SGG], axis=1))
    return sm.GLM(y, X, family=sm.families.Poisson()).fit(cov_type='HC1')
HOUT = [('n_2023_24', '2023~24 전체(주 — 앱 coef)', lambda s: s.late), ('n_fatal_2023_24', '2023~24 사망·실종(앱 fatalRrPerUnit)', lambda s: s.late & s.fatal),
        ('n_all', '2020~24 전체(참고)', lambda s: s.late | ~s.late), ('n_fatal', '2020~24 사망·실종(참고)', lambda s: s.fatal)]
hrow, hcmp = [], []
for k, s in SAMPLES.items():
    ss = s[s.spot.notna()].copy(); ss['spot'] = ss.spot.astype(int)
    for y, ylab, f in HOUT:
        yv = spf.spot.map(ss[f(ss)].groupby('spot').size()).fillna(0).astype(int)
        for nm, terms in HM:
            m = hfit(yv, terms)
            for c in m.params.index:
                if c.startswith('sgg_') or c in ('const', 'log_coast'): continue
                b, se_ = m.params[c], m.bse[c]
                hrow.append(dict(sample=k, outcome=y, outcome_label=ylab, model=nm, term=c, RR=np.exp(b), lo=np.exp(b - 1.96 * se_), hi=np.exp(b + 1.96 * se_),
                                 coef_log2=b / np.log(2), p=m.pvalues[c], events=int(yv.sum())))
            hcmp.append(dict(sample=k, outcome=y, outcome_label=ylab, model=nm, aic=m.aic, loglik=m.llf, pearson_disp=float(m.pearson_chi2 / m.df_resid), events=int(yv.sum())))
HR = pd.DataFrame(hrow); HR.to_csv(OUT + '/hazard_models.csv', index=False, encoding='utf-8-sig')
HC = pd.DataFrame(hcmp); HC['d_aic'] = HC.aic - HC.groupby(['sample', 'outcome']).aic.transform('min'); HC.to_csv(OUT + '/hazard_compare.csv', index=False, encoding='utf-8-sig')
# ④ 같은 표본(O): 관광지 × 묶음(4유형/기타) 2행, 시군구×묶음·해안선×묶음 고정, l2c3sum × 기타, 관광지 군집 SE
so = SAMPLES['O']; so = so[so.spot.notna()].copy(); so['spot'] = so.spot.astype(int)
for y, ylab, f in HOUT[:2]:
    st = []
    for g in (0, 1):
        d = spf[['spot', 'sgg', 'log_coast', 'l2c3sum']].copy(); d['other'] = g
        d['y'] = d.spot.map(so[f(so) & (so.other == g)].groupby('spot').size()).fillna(0).astype(int); st.append(d)
    st = pd.concat(st, ignore_index=True); st['hz_o'] = st.l2c3sum * st.other; st['lc_o'] = st.log_coast * st.other
    st['gsgg'] = st.sgg + '_' + st.other.astype(str)
    X = sm.add_constant(pd.concat([st[['l2c3sum', 'hz_o', 'log_coast', 'lc_o']], pd.get_dummies(st.gsgg, prefix='g', drop_first=True, dtype=float)], axis=1))
    m = sm.GLM(st.y, X, family=sm.families.Poisson()).fit(cov_type='cluster', cov_kwds={'groups': st.spot.values})
    b, se_ = m.params['hz_o'], m.bse['hz_o']
    trow.append(dict(test='위험구역 후보 A 1단위 배수: 기타 ÷ 4유형', outcome=ylab, ratio=np.exp(b), lo=np.exp(b - 1.96 * se_), hi=np.exp(b + 1.96 * se_),
                     chi2=(b / se_) ** 2, df=1, p=float(2 * zdist.sf(abs(b / se_))), other_RR2x=np.exp(m.params['l2c3sum'] + b), n_other=int(st[st.other == 1].y.sum())))
TR_ = pd.DataFrame(trow); TR_.to_csv(OUT + '/same_sample_tests.csv', index=False, encoding='utf-8-sig'); print(TR_.round(4).to_string())

# ───────────── 5. 재현 대조(표본 B = 저장소 결과) ─────────────
rc = []
pm = pd.read_csv(V3 + '/person_models.csv')
for sub, oc_ in (('전체', '전체 사고'), ('사망·실종', '사망·실종 사고')):
    x = pm[pm.model.str.startswith('D2_') & (pm.subset == sub) & (pm.term == 'log2_outsider')].iloc[0]
    n = CR[(CR['sample'] == 'B') & (CR.outcome == oc_)].iloc[0]
    rc.append(dict(item='사람 D2 ' + oc_, old=x.RR, new=n.RR2x, absdiff=abs(x.RR - n.RR2x), n_old=int(x.n_events), n_new=int(n.n_events)))
old = pd.read_csv(U81 + '/month_relative/month_relative.csv'); old = old[old.model.str.startswith('M ')]
for oc_ in ('전체 사고', '사망·실종 사고'):
    o = old[old.outcome == oc_].set_index('month'); n = MR[(MR['sample'] == 'B') & (MR.outcome == oc_)].set_index('month')
    rc.append(dict(item='달 M 12개월 점수 ' + oc_, old=np.nan, new=np.nan, absdiff=float(np.max(np.abs(o.score.values - n.score.values))), n_old=int(o.n_events.iloc[0]), n_new=int(n.n_events.iloc[0])))
    rc.append(dict(item='달 M 사람(상대) 항 ' + oc_, old=o.crowd_rr2x.iloc[0], new=n.rel_crowd_RR2x.iloc[0], absdiff=abs(o.crowd_rr2x.iloc[0] - n.rel_crowd_RR2x.iloc[0]), n_old=int(o.n_events.iloc[0]), n_new=int(n.n_events.iloc[0])))
tm = pd.read_csv(U81 + '/hazard_types/type_models.csv')
for y in ('n_2023_24', 'n_fatal_2023_24', 'n_all', 'n_fatal'):
    x = tm[(tm.outcome == y) & tm.model.str.startswith('b3=')].iloc[0]
    n = HR[(HR['sample'] == 'B') & (HR.outcome == y) & HR.model.str.startswith('b3=')].iloc[0]
    rc.append(dict(item='위험구역 b3= ' + y, old=x.RR, new=n.RR, absdiff=abs(x.RR - n.RR), n_old=int(x.events), n_new=int(n.events),
                   note='' if int(x.events) == int(n.events) else '09_spots.py 는 특보구역 3km 밖 사고도 관광지 몫으로 센다(v2 geo_person 3건, 모두 2020년). '
                        '저장소 내보내기에는 그 3건이 없다 — 2023~24 결과(앱 값)에는 영향 없음. 기타도 같은 규칙으로 3km 밖 2건(2021·2022)을 뺐다'))
RC = pd.DataFrame(rc); RC.to_csv(OUT + '/repro_check.csv', index=False, encoding='utf-8-sig'); print(RC.to_string())

# ───────────── 6. 앱에 넣을 값(표본별) — risk_points.js 와 같은 꼴 ─────────────
av = []
for k in SAMPLES:
    c = CR[CR['sample'] == k].set_index('outcome'); h = HR[(HR['sample'] == k) & HR.model.str.startswith('b3=')].set_index('outcome')
    m_ = MR[MR['sample'] == k]
    av.append(dict(sample=k, crowdScore=round(float(np.log2(c.loc['전체 사고', 'RR2x'])), 2), crowdRr=round(float(c.loc['전체 사고', 'RR2x']), 2),
                   crowdFatalRr=round(float(c.loc['사망·실종 사고', 'RR2x']), 2), hazard_coef=float(h.loc['n_2023_24', 'coef_log2']),
                   hazard_fatalRrPerUnit=float(h.loc['n_fatal_2023_24', 'RR']),
                   months_score=json.dumps([round(float(x), 2) for x in m_[m_.outcome == '전체 사고'].score]),
                   months_rr=json.dumps([round(float(x), 2) for x in m_[m_.outcome == '전체 사고'].RR]),
                   months_fatalRr=json.dumps([round(float(x), 2) for x in m_[m_.outcome == '사망·실종 사고'].RR])))
AV = pd.DataFrame(av); AV.to_csv(OUT + '/app_values.csv', index=False, encoding='utf-8-sig'); print(AV.to_string())

# ───────────── 7. 미리보기(선택) — 실제 scoreCoast, 점수표 숫자만 바꿔서 ─────────────
JS = r"""
'use strict';
const [repo,basePath,ovJson]=process.argv.slice(1);const ov=JSON.parse(ovJson);
const pPath=require.resolve(repo+'/local_server/services/risk_points');const P0=require(pPath);
if(ov){const coef=ov.hazard_coef;const P1={...P0,
  MONTHS:Object.freeze(ov.months.map((score,i)=>Object.freeze({score,rr:P0.MONTHS[i].rr,fatalRr:P0.MONTHS[i].fatalRr}))),
  HAZARD_PER_TYPE:Object.freeze({...P0.HAZARD_PER_TYPE,coef}),
  hazardType(n){const u=Math.log2(Math.min(Math.max(0,n|0),P0.HAZARD_PER_TYPE.cap)+1),score=coef*u;return{score,rr:2**score,fatalRr:1};},
  COAST:Object.freeze({...P0.COAST,crowdScore:ov.crowdScore})};
  require.cache[pPath].exports=P1;}
const S=require(repo+'/local_server/services/risk_score'),P=require(pPath),tour=require(repo+'/local_server/services/tour_concentration_collector');
const fs=require('fs');const spots=new Map(JSON.parse(fs.readFileSync(repo+'/local_server/config/coastal_safety/risk_spots.json')).spots.map(p=>[p.id,p]));
const base=JSON.parse(fs.readFileSync(basePath));const avg=tour.averages30(Object.fromEntries(base.map(o=>[o.id,o.cr30])));
const BANDS=['평소 수준','다소 높음','높음','매우 높음'];const out=[];
for(const day of ['2026-10-15','2026-10-17']){const t=day+'T12:00:00+09:00',now=day+'T09:00:00+09:00',cnt={},each=[],parts={people:[],hazard:[],score:[]};
  for(const o of base){const p=spots.get(o.id);const r=S.scoreCoast({t,now,spot:{...p,ripBeach:null},concentration:o.cr30[day]??null,concentrationBase:avg[o.id]||null,events:[],swell:null,rip:null,warnings:[]});
    cnt[r.band]=(cnt[r.band]||0)+1;each.push(BANDS.indexOf(r.band));parts.people.push(r.factors.find(f=>f.key==='concentration').score);parts.hazard.push(r.factors.find(f=>f.key==='hazard').score);parts.score.push(r.score);}
  const q=a=>{a=a.slice().sort((x,y)=>x-y);return [.1,.5,.9].map(k=>+a[Math.floor(k*(a.length-1))].toFixed(2));};const mean=a=>+(a.reduce((s,x)=>s+x,0)/a.length).toFixed(3);
  out.push({day,month_score:P.MONTHS[9].score,bands:BANDS.map(b=>cnt[b]||0),people_q:q(parts.people),hazard_q:q(parts.hazard),score_q:q(parts.score),people_mean:mean(parts.people),hazard_mean:mean(parts.hazard),score_mean:mean(parts.score),each});}
console.log(JSON.stringify(out));
"""
if BASE:
    pv, ref = [], {}
    scen = [('지금 앱(점수표 그대로)', None)] + [(k, dict(crowdScore=float(r.crowdScore), hazard_coef=float(r.hazard_coef), months=json.loads(r.months_score))) for k, r in AV.set_index('sample').iterrows()]
    for name, ov in scen:
        res = json.loads(subprocess.run(['node', '-e', JS, REPO, BASE, json.dumps(ov)], capture_output=True, text=True, check=True).stdout)
        for d in res:
            e = np.array(d['each']); ref.setdefault(d['day'], e); dlt = e - ref[d['day']]     # 관광지마다 지금 앱 대비 단계 이동
            pv.append(dict(scenario=name, day=d['day'], oct_month_score=d['month_score'], 평소수준=d['bands'][0], 다소높음=d['bands'][1], 높음=d['bands'][2], 매우높음=d['bands'][3],
                           spots_up=int((dlt > 0).sum()), spots_down=int((dlt < 0).sum()),
                           people_p10_50_90='/'.join(map(str, d['people_q'])), hazard_p10_50_90='/'.join(map(str, d['hazard_q'])), score_p10_50_90='/'.join(map(str, d['score_q'])),
                           people_mean=d['people_mean'], hazard_mean=d['hazard_mean'], score_mean=d['score_mean']))
    PV = pd.DataFrame(pv); PV.to_csv(OUT + '/preview.csv', index=False, encoding='utf-8-sig'); print(PV.to_string())
print('written', OUT)
