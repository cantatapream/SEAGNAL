#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""compose.py 가 만든 ep1~3.wav 를 측정해 마크다운 표로 찍는다(소리를 들을 수 없으니 숫자로 확인).
사용: python3 measure.py > measure_out.md
  1 길이  2 킥 시작점(40~120Hz) vs 박자 격자  3 마디·구간별 대역 RMS, 무음 구간
  4 ffmpeg ebur128 (통합 LUFS·참 정점)  5 클릭·튐·DC  6 대역 비율 vs Your Breath  7 모노 합산
"""
import json
import os
import re
import subprocess
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d

SR = 48000
D = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(os.path.dirname(os.path.dirname(D)), 'music', 'your_breath.mp3')
META = json.load(open(os.path.join(D, 'events.json')))
EXPECT = {'ep1': 66.995, 'ep2': 40.6, 'ep3': 58.5}
KEY = {'ep1': [15.495, 16.495, 46.495, 46.995, 48.495, 66.495],
       'ep2': [0.0, 0.5, 8.0, 40.0],
       'ep3': [1.0, 2.0, 32.5, 34.0, 58.0]}
SILENT = {'ep1': [(0.0, 0.495), (65.995, 66.495)], 'ep2': [(7.5, 8.0)], 'ep3': [(57.5, 58.0)]}


def load_wav(p):
    with wave.open(p) as w:
        n, ch, sw, sr = w.getnframes(), w.getnchannels(), w.getsampwidth(), w.getframerate()
        b = np.frombuffer(w.readframes(n), np.uint8)
    assert sw == 3 and sr == SR and ch == 2
    b = b.reshape(-1, 3)
    i = (b[:, 0].astype(np.int32) | (b[:, 1].astype(np.int32) << 8) | (b[:, 2].astype(np.int32) << 16))
    i = np.where(i >= 1 << 23, i - (1 << 24), i)
    return (i / 8388608.0).reshape(-1, 2), n


def decode(p):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-ar', str(SR), '-ac', '2', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).astype(np.float64)


def db(x):
    return 20 * np.log10(np.maximum(x, 1e-12))


def band(x, lo, hi):
    if lo and hi:
        sos = signal.butter(4, [lo, hi], 'bandpass', fs=SR, output='sos')
    elif lo:
        sos = signal.butter(4, lo, 'highpass', fs=SR, output='sos')
    else:
        sos = signal.butter(4, hi, 'lowpass', fs=SR, output='sos')
    return signal.sosfiltfilt(sos, x, axis=0)


def rms(x):
    return np.sqrt(np.mean(x ** 2)) if len(x) else 0.0


_KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
_KA1 = [1.0, -1.69065929318241, 0.73248077421585]
_KB2 = [1.0, -2.0, 1.0]
_KA2 = [1.0, -1.99004745483398, 0.99007225036621]


def kweight(x):
    return signal.lfilter(_KB2, _KA2, signal.lfilter(_KB1, _KA1, x, axis=0), axis=0)


def seg_lufs(kx, a, b):
    s = kx[int(round(a * SR)):int(round(b * SR))]
    return -0.691 + 10 * np.log10((s ** 2).mean(0).sum() + 1e-20)


def ebur128(p):
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', p, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    summ = out[out.rfind('Summary:'):]
    I = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summ).group(1))
    LRA = float(re.search(r'LRA:\s+(-?[\d.]+) LU', summ).group(1))
    TP = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', summ).group(1))
    return I, LRA, TP


def onsets(x, rise_db=5.0, min_db=-30.0):
    """40~120Hz 대역(영위상 버터워스 4차, 앞뒤로 걸어 지연 0) 의 힐베르트 포락선에서 시작점 검출.
    후보 = 10ms 사이에 rise_db 이상 커지는 곳(사이드체인으로 천천히 되살아나는 베이스는 걸리지 않음).
    시작점 = 후보 앞 40ms 안의 바닥과 뒤 30ms 안의 봉우리 사이 50% 를 처음 넘는 샘플."""
    PADMS = 50                                                  # 0초 킥도 잡히게 앞에 50ms 무음을 붙였다 뺀다
    m = np.concatenate([np.zeros(PADMS * 48), x.mean(1)])
    b = band(m, 40, 120)
    env = np.abs(signal.hilbert(b))
    e1 = env[:len(env) // 48 * 48].reshape(-1, 48).max(1)      # 1ms 해상도
    L = db(e1)
    rise = np.zeros_like(L)
    rise[10:] = L[10:] - L[:-10]
    cand, _ = signal.find_peaks(rise, height=rise_db, distance=40)
    res = []
    for c in cand:
        a = max(0, c - 40)
        j = a + int(np.argmin(e1[a:c + 1]))
        ti = c + int(np.argmax(e1[c:c + 31]))
        floor, top = e1[j], e1[ti]
        pre = np.median(e1[max(0, c - 50):max(1, c - 12)])      # 맥놀이(킥 꼬리×서브) 골짜기는 앞 수준과 봉우리가 비슷 → 제외
        if db(top) < min_db or db(top) - db(pre) < 4.0:
            continue
        thr = floor + 0.5 * (top - floor)
        k = np.nonzero(env[j * 48:(ti + 1) * 48] >= thr)[0]
        if len(k):
            res.append(((j * 48 + k[0]) / SR - PADMS / 1000, db(top)))
    return res


def main():
    print('# 측정 결과 (measure.py 자동 출력)\n')
    ref = decode(REF) if os.path.exists(REF) else None   # 기준곡이 없으면 대역 비교표에서 그 줄만 뺀다
    data = {k: load_wav(os.path.join(D, k + '.wav')) for k in ('ep1', 'ep2', 'ep3')}

    # 0. 검출기 보정: 킥 하나만 알려진 시각에 놓고 같은 검출기로 잰다
    import importlib.util
    spec = importlib.util.spec_from_file_location('compose', os.path.join(D, 'compose.py'))
    C = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(C)
    test = np.zeros((SR * 3, 2))
    k = C.kick(np.random.default_rng(1))
    for t0 in (0.5, 1.25, 2.0):
        i0 = int(round(t0 * SR))
        test[i0:i0 + len(k)] += k[:, None] * 0.8
    det = np.array([t for t, _ in onsets(test)])
    cal = [round(float(det[np.argmin(np.abs(det - t0))] - t0) * 1000, 2) for t0 in (0.5, 1.25, 2.0)]

    # 1. 길이
    print('## 1. 길이\n\n| 파일 | 샘플 수 | 초 | 요구 | 일치 |\n|---|---:|---:|---:|---|')
    for k, (x, n) in data.items():
        print(f'| {k}.wav | {n} | {n / SR:.6f} | {EXPECT[k]:.3f} | {"예" if n == round(EXPECT[k] * SR) else "아니오"} |')

    # 2. 박자
    print('\n## 2. 킥 대역(40~120Hz) 시작점 vs 격자\n')
    print('검출기: 모노 → 40~120Hz 버터워스 4차(앞뒤로 걸어 지연 0) → 힐베르트 포락선. 10ms 사이 5dB 넘게 커지고 '
          '앞 12~50ms 중앙값보다 4dB 넘게 큰 봉우리를 후보로 잡고, 바닥~봉우리 50% 를 처음 넘는 샘플을 시작점으로 한다. '
          f'보정: 킥 하나만 0.5·1.25·2.0초에 놓고 재면 오차 {cal} ms.\n')
    # 2-a 킥만 뽑은 트랙
    print('### 2-a. 킥만 따로 뽑은 트랙 (compose.py 가 stems/epN_kick.wav 로 씀 — 놓은 위치 자체 확인)\n')
    print('| 곡 | 놓은 킥 | 찾은 킥 | 오차 최대(ms) | 못 찾은 킥 |\n|---|---:|---:|---:|---|')
    for k in data:
        xs, _ = load_wav(os.path.join(D, 'stems', k + '_kick.wav'))
        ts = np.array([t for t, _ in onsets(xs)])
        kicks = sorted(META[k]['kicks'] + [e[0] for e in META[k]['events'] if e[1] == 'final'])
        dv = [np.min(np.abs(ts - kt)) * 1000 for kt in kicks]
        found = [d for d in dv if d <= 30]
        miss = [f'{kt:.3f}' for kt, d in zip(kicks, dv) if d > 30]
        print(f'| {k} | {len(kicks)} | {len(found)} | {max(found):.2f} | {", ".join(miss) or "없음"} |')
    # 2-b 완성 믹스
    print('\n### 2-b. 완성 믹스\n')
    print('| 곡 | 놓은 킥 | 찾은 킥 | 오차 중앙값(ms) | 95%(ms) | 최대(ms) | 5ms 넘는 킥 | 못 찾은 킥 |\n|---|---:|---:|---:|---:|---:|---:|---|')
    keyrows, notes = [], []
    for k, (x, n) in data.items():
        off = META[k]['offset']
        ons = onsets(x)
        ts = np.array([t for t, _ in ons])
        kicks = sorted(META[k]['kicks'] + [e[0] for e in META[k]['events'] if e[1] == 'final'])
        ka = np.array(kicks)
        dv = np.array([np.min(np.abs(ts - kt)) * 1000 for kt in kicks])
        fd = dv[dv <= 30]
        over = [f'{kt:.3f}({d:.1f})' for kt, d in zip(kicks, dv) if 5 < d <= 30]
        miss = [f'{kt:.3f}' for kt, d in zip(kicks, dv) if d > 30]
        print(f'| {k} | {len(kicks)} | {len(fd)} | {np.median(fd):.2f} | {np.percentile(fd, 95):.2f} | {fd.max():.2f} | '
              f'{len(over)} {" ".join(over)} | {", ".join(miss) or "없음"} |')
        # 2-c 킥이 아닌 검출(킥 ±30ms 밖)을 분류
        soft = np.array([e[0] for e in META[k]['events'] if e[1] == 'sub_soft'] or [-9])
        cls = {'킥 뒤 100~260ms 서브 되살아남(사이드체인)': [], '천천히 커지는 서브 음(시작은 마디 첫 박)': [], '그 밖(미분류)': []}
        for t, lv in ons:
            if np.min(np.abs(ka - t)) <= 0.03:
                continue
            g = abs(((t - off) / 0.125 - round((t - off) / 0.125)) * 0.125) * 1000
            prev = ka[ka <= t]
            since = (t - prev[-1]) * 1000 if len(prev) else 1e9
            ps = soft[soft <= t]
            if 100 <= since <= 260:
                cls['킥 뒤 100~260ms 서브 되살아남(사이드체인)'].append((t, g, lv, since))
            elif len(ps) and t - ps[-1] <= 0.45:
                cls['천천히 커지는 서브 음(시작은 마디 첫 박)'].append((t, g, lv, (t - ps[-1]) * 1000))
            else:
                cls['그 밖(미분류)'].append((t, g, lv, since))
        kick_lv = np.median([lv for t, lv in ons if np.min(np.abs(ka - t)) <= 0.03])
        line = f'{k} — 킥이 아닌 검출(킥 ±30ms 밖) 분류 (킥 봉우리 중앙값 {kick_lv:.0f}dBFS): '
        parts = []
        for name, v in cls.items():
            if v:
                parts.append(f'{name} {len(v)}개(봉우리 {min(a[2] for a in v):.0f}~{max(a[2] for a in v):.0f}dBFS)')
            else:
                parts.append(f'{name} 0개')
        line += ' · '.join(parts)
        if cls['그 밖(미분류)']:
            line += ' — 미분류: ' + ', '.join(f'{t:.3f}초(격자에서 {g:.1f}ms, {lv:.0f}dBFS)' for t, g, lv, _ in cls['그 밖(미분류)'])
        notes.append(line)
        for kt in KEY[k]:
            j = int(np.argmin(np.abs(ts - kt)))
            keyrows.append((k, kt, ts[j], (ts[j] - kt) * 1000))
    print('\n### 2-c. 킥이 아닌 검출\n')
    for line in notes:
        print('- ' + line)
    print('\n### 2-d. 주요 시각 (완성 믹스)\n\n| 곡 | 요구 시각(초) | 검출 시작점(초) | 차이(ms) |\n|---|---:|---:|---:|')
    for k, kt, t, d in keyrows:
        print(f'| {k} | {kt:.3f} | {t:.4f} | {d:+.2f} |')

    # 3. 마디별·구간별 세기
    print('\n## 3. 구간 세기\n')
    print('대역: 저 <150Hz · 중 150~2kHz · 현(효과음 자리) 2~5kHz · 고 >5kHz. 값은 RMS dBFS(두 채널 평균). '
          'LUFS 는 K-가중 평균(게이트 없음).\n')
    for k, (x, n) in data.items():
        m = x
        lo, mid, pr, hi = band(m, None, 150), band(m, 150, 2000), band(m, 2000, 5000), band(m, 5000, None)
        kx = kweight(x)
        print(f'### {k} 구간\n\n| 구간 | 시작~끝(초) | LUFS | 전체 | 저 | 중 | 현 2~5k | 고 |\n|---|---|---:|---:|---:|---:|---:|---:|')
        for name, a, b in META[k]['sections']:
            sl = slice(int(round(a * SR)), int(round(b * SR)))
            print(f'| {name} | {a:.3f}~{b:.3f} | {seg_lufs(kx, a, b):.1f} | {db(rms(m[sl])):.1f} | {db(rms(lo[sl])):.1f} | '
                  f'{db(rms(mid[sl])):.1f} | {db(rms(pr[sl])):.1f} | {db(rms(hi[sl])):.1f} |')
        print(f'\n<details><summary>{k} 마디별</summary>\n\n| 마디 | 시작(초) | LUFS | 전체 | 저 | 중 | 현 | 고 |\n|---:|---:|---:|---:|---:|---:|---:|---:|')
        off = META[k]['offset']
        bar = 1
        while off + 2 * (bar - 1) < n / SR - 1e-6:
            a = off + 2 * (bar - 1)
            b = min(a + 2, n / SR)
            sl = slice(int(round(a * SR)), int(round(b * SR)))
            print(f'| {bar} | {a:.3f} | {seg_lufs(kx, a, b):.1f} | {db(rms(m[sl])):.1f} | {db(rms(lo[sl])):.1f} | '
                  f'{db(rms(mid[sl])):.1f} | {db(rms(pr[sl])):.1f} | {db(rms(hi[sl])):.1f} |')
            bar += 1
        print('\n</details>\n')
    print('### 무음(거의 무음) 구간\n\n| 곡 | 구간(초) | RMS dBFS | 정점 dBFS |\n|---|---|---:|---:|')
    for k, (x, n) in data.items():
        for a, b in SILENT[k]:
            s = x[int(round(a * SR)):int(round(b * SR))]
            print(f'| {k} | {a:.3f}~{b:.3f} | {db(rms(s)):.1f} | {db(np.abs(s).max()):.1f} |')
    print('\n### 드롭 전후 (K-가중 음량, 게이트 없음)\n\n| 곡 | 드롭(초) | 직전 1초 LUFS | 직후 0.4초 LUFS | 직후 2초 LUFS | 드롭 구간 평균 LUFS |\n|---|---:|---:|---:|---:|---:|')
    for k, t, pre_a, pre_b, d1 in (('ep1', 48.495, 47.495, 48.495, 64.495), ('ep2', 8.0, 6.5, 7.5, 24.0),
                                   ('ep3', 34.0, 33.0, 34.0, 50.0)):
        kx = kweight(data[k][0])
        print(f'| {k} | {t} | {seg_lufs(kx, pre_a, pre_b):.1f} | {seg_lufs(kx, t, t + 0.4):.1f} | '
              f'{seg_lufs(kx, t, t + 2):.1f} | {seg_lufs(kx, t, d1):.1f} |')
    print('\n(ep2 의 "직전 1초"는 무음 7.5~8.0 앞의 6.5~7.5 를 썼다.)\n')

    # 4. 음량
    print('## 4. 음량 (ffmpeg ebur128)\n\n| 곡 | 통합 LUFS | LRA LU | 참 정점 dBTP |\n|---|---:|---:|---:|')
    for k in data:
        I, LRA, TP = ebur128(os.path.join(D, k + '.wav'))
        print(f'| {k} | {I:.1f} | {LRA:.1f} | {TP:.1f} |')

    # 5. 클릭·DC·끝
    print('\n## 5. 클릭·튐·DC·끝\n')
    print('클릭 검사: 2차 차분 |x[n]-2x[n-1]+x[n-2]| 이 주변 10ms 실효값의 10배를 넘고 -60dBFS 이상인 샘플 수. '
          '튀는 소리가 하나 있으면 이 비율이 커진다(가우스 잡음이면 대개 5 아래).\n')
    print('| 곡 | 의심 샘플 수 | 최대 비율 | 그 시각(초) | 최대 이웃차(dBFS) | DC 좌 | DC 우 | 첫 샘플 | 끝 샘플 | 끝 50ms RMS dBFS |')
    print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
    for k, (x, n) in data.items():
        cnt, best, bt = 0, 0.0, 0.0
        for c in range(2):
            d2 = np.zeros(n)
            d2[2:] = x[2:, c] - 2 * x[1:-1, c] + x[:-2, c]
            loc = np.sqrt(uniform_filter1d(d2 ** 2, 480) + 1e-20)
            r = np.abs(d2) / loc
            mask = (r > 10) & (np.abs(d2) > 1e-3)
            cnt += int(mask.sum())
            j = int(np.argmax(np.where(np.abs(d2) > 1e-3, r, 0)))
            if r[j] > best:
                best, bt = float(r[j]), j / SR
        d1 = db(np.abs(np.diff(x, axis=0)).max())
        dc = x.mean(0)
        print(f'| {k} | {cnt} | {best:.1f} | {bt:.3f} | {d1:.1f} | {dc[0]:.2e} | {dc[1]:.2e} | {x[0, 0]:.1e} | '
              f'{x[-1, 0]:.1e},{x[-1, 1]:.1e} | {db(rms(x[-2400:])):.1f} |')

    print('\n꼬리 감쇠 (마지막 강박부터 50ms 창마다 RMS dBFS — 끝으로 갈수록 자연히 작아지는지):\n')
    print('| 곡 | 강박(초) | ' + ' | '.join(f'+{i * 50}~{(i + 1) * 50}ms' for i in range(12)) + ' |\n|---|---:|' + '---:|' * 12)
    for k, (x, n) in data.items():
        tf = [e[0] for e in META[k]['events'] if e[1] == 'final'][0]
        cells = []
        for i in range(12):
            a0, b0 = int(round((tf + i * 0.05) * SR)), int(round((tf + (i + 1) * 0.05) * SR))
            cells.append(f'{db(rms(x[a0:min(b0, n)])):.0f}' if a0 < n else '—')
        print(f'| {k} | {tf} | ' + ' | '.join(cells) + ' |')

    # 6. 대역 비율
    print('\n## 6. 대역 비율 (그 구간 전체 에너지 대비 dB, 모노 합)\n')
    edges = [20, 60, 150, 500, 2000, 5000, 10000, 20000]
    hdr = ' | '.join(f'{a}~{b}' for a, b in zip(edges[:-1], edges[1:]))
    print(f'| 대상 | {hdr} |\n|---|' + '---:|' * 7)

    def shares(seg):
        mm = seg.mean(1)
        X = np.abs(np.fft.rfft(mm)) ** 2
        f = np.fft.rfftfreq(len(mm), 1 / SR)
        tot = X[(f >= 20) & (f < 20000)].sum()
        return [10 * np.log10(X[(f >= a) & (f < b)].sum() / tot) for a, b in zip(edges[:-1], edges[1:])]
    rows = [] if ref is None else [('Your Breath 전체', ref), ('Your Breath 0.5~48.5초(종전 1편 사용 구간)', ref[int(0.5 * SR):int(48.5 * SR)])]
    for k, (x, n) in data.items():
        rows.append((f'{k} 전체', x))
    rows += [('ep1 드롭 48.495~64.495', data['ep1'][0][int(48.495 * SR):int(64.495 * SR)]),
             ('ep2 드롭 8~24', data['ep2'][0][8 * SR:24 * SR]),
             ('ep3 드롭 34~50', data['ep3'][0][34 * SR:50 * SR])]
    for name, seg in rows:
        print(f'| {name} | ' + ' | '.join(f'{v:.1f}' for v in shares(seg)) + ' |')

    # 7. 모노
    print('\n## 7. 모노 합산\n\n값 = 모노((L+R)/2) 에너지 ÷ 두 채널 평균 에너지 (dB). 0 = 완전 같음, -3 = 서로 무관, '
          '-3 보다 많이 낮으면 위상 상쇄.\n')
    print('| 곡 | 상관계수 | 전체 | <150Hz | 150~2k | 2~5k | >5k | 1초 창 최저(전체) |\n|---|---:|---:|---:|---:|---:|---:|---:|')
    for k, (x, n) in data.items():
        def ratio(s):
            mo = ((s[:, 0] + s[:, 1]) / 2) ** 2
            st = (s[:, 0] ** 2 + s[:, 1] ** 2) / 2
            return 10 * np.log10(mo.sum() / max(st.sum(), 1e-20))
        bands = [x, band(x, None, 150), band(x, 150, 2000), band(x, 2000, 5000), band(x, 5000, None)]
        win = []
        for i in range(0, n - SR, SR):
            s = x[i:i + SR]
            if rms(s) > 10 ** (-50 / 20):
                win.append(ratio(s))
        cc = np.corrcoef(x[:, 0], x[:, 1])[0, 1]
        print(f'| {k} | {cc:.3f} | ' + ' | '.join(f'{ratio(b):.2f}' for b in bands) + f' | {min(win):.2f} |')


main()
