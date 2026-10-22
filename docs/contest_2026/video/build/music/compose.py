#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SEA:GNAL 소개 영상 배경음악 3곡 합성기 — 외부 음원·샘플 없이 numpy/scipy 로 직접 합성한다.

사용:  python3 compose.py [출력폴더]          (기본: 이 파일이 있는 폴더)
결과:  ep1.wav (66.995초) · ep2.wav (40.600초) · ep3.wav (58.500초)
       48kHz 스테레오 24비트, 통합 음량 -16 LUFS 목표, 참 정점 -1 dBTP 이하(리미터 -1.3)
       events.json — 곡마다 킥·임팩트·높은 소리·무음 구간 시각 (measure.py 가 읽는다)
       stems/epN_kick.wav — 킥만 뽑은 검증용 트랙(박자 위치 확인용, 음량 맞춤 안 함)
검증:  python3 measure.py > measure_out.md   (길이·박자·구간 세기·LUFS·클릭·대역·모노)
걸리는 시간: 세 곡 합쳐 약 3분(가산합성 패드가 대부분).

공통 음악 설계
  - 120BPM 4/4 (1박 0.5초, 1마디 2초). D장조.
  - 화성: 쌓기 = D(maj9) · Bm9 · Gmaj9 · A  /  드롭 = G · A · F#m7 · Bm9  /  마지막 강박 = D
  - 모티프: 2마디 펜타토닉 선율 (F#-A-E-D-A / F#-A-B-A-E) — 세 곡이 같이 쓴다.
  - 악기: 킥·클랩·하이햇·셰이커·크래시 / 서브베이스·미드베이스 / 가산합성 패드 /
          마림바·플럭·벨 / 라이저(잡음 스윕) / 임팩트(붐·하강 스윕)
  - 150Hz 아래는 킥·서브(붐 포함)만. 선율 악기는 2~5kHz 를 깎아(presence_dip) 효과음 자리를 비운다.
  - 모든 소리는 짧은 상승·하강 포락선으로 시작·끝(딸깍 잡음 방지). 난수 씨앗 고정.
"""
import json
import os
import sys
import wave

import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 48000
TWO_PI = 2 * np.pi
TARGET_LUFS = -16.0
TP_CEIL_DB = -1.3          # 리미터 목표(참 정점 -1 dBTP 보다 0.3dB 여유)
PAD_SCALE, MEL_SCALE, HAT_SCALE, SUB_SCALE = 0.063, 1.15, 2.7, 0.72   # 버스별 크기(측정으로 맞춘 값)
KICK_SCALE, CLAP_SCALE, PUMP_SCALE = 0.74, 1.2, 1.25
HP25 = signal.butter(2, 25, 'hp', fs=SR, output='sos')
HP15 = signal.butter(2, 15, 'hp', fs=SR, output='sos')   # 마스터 DC 제거(인과 필터 → 앞으로 번지지 않음)


def ns(t):
    """초 → 샘플 수(반올림). 0.495초 = 23760 샘플처럼 박자 격자는 모두 정수로 떨어진다."""
    return int(round(t * SR))


# ───────────────────────── 음이름 ─────────────────────────
_PC = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def midi(name):
    pc, i = _PC[name[0]], 1
    while name[i] in '#b':
        pc += 1 if name[i] == '#' else -1
        i += 1
    return 12 * (int(name[i:]) + 1) + pc


def hzm(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def hz(name):
    return hzm(midi(name))


# 화음표: pad=패드 음(뿌리음 없는 보이싱, 모두 150Hz 위), up=화음 커질 때 얹는 윗음,
#         arp=아르페지오 음, root=베이스 뿌리음, safe=선율이 머물러도 되는 음(피치클래스)
CH = {
    'D':    dict(root='D2',  pad=['F#3', 'A3', 'C#4', 'E4'], up=['A4', 'C#5'], arp=['D5', 'A5', 'F#5', 'E5'], safe={2, 4, 6, 9, 11, 1}),
    'Bm':   dict(root='B1',  pad=['F#3', 'A3', 'C#4', 'D4'], up=['F#4', 'D5'], arp=['B4', 'F#5', 'D5', 'A5'], safe={11, 2, 6, 9, 4, 1}),
    'G':    dict(root='G2',  pad=['F#3', 'A3', 'B3', 'D4'],  up=['G4', 'B4'],  arp=['G4', 'D5', 'B4', 'F#5'], safe={7, 9, 11, 2, 4, 6}),
    'A':    dict(root='A2',  pad=['E3', 'A3', 'C#4', 'E4'],  up=['A4', 'C#5'], arp=['A4', 'E5', 'C#5', 'B4'], safe={9, 11, 1, 4, 6}),
    'Asus': dict(root='A2',  pad=['E3', 'A3', 'B3', 'D4'],   up=['A4', 'D5'],  arp=['A4', 'E5', 'D5', 'B4'], safe={9, 11, 2, 4, 6}),
    'F#m':  dict(root='F#2', pad=['E3', 'A3', 'C#4', 'F#4'], up=['A4', 'C#5'], arp=['F#4', 'C#5', 'A4', 'E5'], safe={6, 9, 1, 4, 11}),
    'Em':   dict(root='E2',  pad=['G3', 'B3', 'D4', 'F#4'],  up=['B4', 'D5'],  arp=['E4', 'B4', 'G4', 'F#5'], safe={4, 6, 7, 9, 11, 2}),
    'DF#':  dict(root='F#2', pad=['F#3', 'A3', 'D4', 'E4'],  up=['A4', 'D5'],  arp=['D5', 'A4', 'F#5', 'E5'], safe={2, 4, 6, 9, 11}),
}

# 공통 모티프(2마디, 박 단위): (박, 음, 세기)
MOTIF = [(0.0, 'F#5', 0.50), (0.5, 'A5', 0.42), (1.5, 'E5', 0.46), (2.0, 'D5', 0.55), (3.0, 'A4', 0.50),
         (4.0, 'F#5', 0.50), (4.5, 'A5', 0.42), (5.5, 'B5', 0.46), (6.5, 'A5', 0.44), (7.0, 'E5', 0.58)]
ARP_PAT = [0, 1, 2, 1, 3, 1, 2, 1, 0, 1, 2, 1, 3, 2, 1, 2]


def adapt(m, chord):
    """선율 음이 화음과 부딪히면(예: F#m 위의 D) 가장 가까운 안전한 음으로 옮긴다."""
    s = CH[chord]['safe']
    for d in (0, -1, 1, -2, 2):
        if (m + d) % 12 in s:
            return m + d
    return m


# ───────────────────────── 신호 도구 ─────────────────────────
def lp_mag(f, fc, order=2):
    return 1.0 / np.sqrt(1.0 + (f / fc) ** (2 * order))


def hp_mag(f, fc, order=2):
    f = np.maximum(f, 1e-6)
    return 1.0 / np.sqrt(1.0 + (fc / f) ** (2 * order))


def presence_dip(f, depth=0.5, center=3200.0, width=0.55):
    """2~5kHz 를 깎는 종 모양 감쇠(효과음 자리 비우기). depth 0.5 → 3.2kHz 에서 -6dB."""
    f = np.maximum(f, 1.0)
    return 1.0 - depth * np.exp(-0.5 * (np.log2(f / center) / width) ** 2)


def smoothstep(u):
    u = np.clip(u, 0.0, 1.0)
    return u * u * (3 - 2 * u)


def colored_noise(rng, n, shape_fn):
    """백색잡음을 FFT 마스크로 깎아 만든 색잡음(실효값 1)."""
    x = rng.standard_normal(n)
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    y = np.fft.irfft(X * shape_fn(f), n)
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-12)


def finish(y, attack=0.001, release=0.005):
    """소리의 앞·뒤를 짧게 여닫는다(시작 0, 끝 0 → 딸깍 잡음 없음)."""
    n = len(y)
    w = np.ones(n)
    a, r = max(2, ns(attack)), max(2, ns(release))
    w[:a] = smoothstep(np.arange(a) / a)
    w[n - r:] *= 1 - smoothstep(np.arange(r) / (r - 1))
    return y * (w if y.ndim == 1 else w[:, None])


def norm_peak(y):
    return y / (np.abs(y).max() + 1e-12)


def tv_filter(x, gain_fn, nfft=2048, hop=256):
    """시간에 따라 바뀌는 필터(STFT). gain_fn(초[프레임,1], 주파수[1,빈]) → 이득."""
    n = len(x)
    win = np.hanning(nfft)
    pad = np.concatenate([np.zeros(nfft), x, np.zeros(nfft)])
    nfr = (len(pad) - nfft) // hop + 1
    idx = np.arange(nfft)[None, :] + hop * np.arange(nfr)[:, None]
    X = np.fft.rfft(pad[idx] * win, axis=1)
    times = (hop * np.arange(nfr) + nfft / 2 - nfft) / SR
    f = np.fft.rfftfreq(nfft, 1 / SR)
    G = gain_fn(np.clip(times, 0, None)[:, None], f[None, :])
    Y = np.fft.irfft(X * G, nfft, axis=1) * win
    out = np.zeros(len(pad))
    ws = np.zeros(len(pad))
    w2 = win ** 2
    for k in range(nfr):
        s = k * hop
        out[s:s + nfft] += Y[k]
        ws[s:s + nfft] += w2
    return out[nfft:nfft + n] / np.maximum(ws[nfft:nfft + n], 1e-3)


# ───────────────────────── 악기 ─────────────────────────
def kick(rng, decay=0.08, dur=0.5, click=0.10):
    """킥: 몸통 120Hz→52Hz 사인(시작부터 40~120Hz 에 에너지가 있어 박자 위치가 또렷) +
    200Hz '톡'(빨리 사라짐) + 아주 짧은 딸깍(1.2~5kHz). 1ms 상승."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = 55 + 65 * np.exp(-t / 0.020)
    body = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / decay)
    body = np.tanh(1.3 * body) / np.tanh(1.3)
    knock = 0.5 * np.sin(TWO_PI * 190 * t) * np.exp(-t / 0.012)
    cl = colored_noise(rng, n, lambda F: hp_mag(F, 1200, 2) * lp_mag(F, 5000, 2)) * np.exp(-t / 0.0015) * click
    y = signal.sosfilt(HP25, body + knock + cl)
    return norm_peak(finish(y, 0.001, min(0.06, dur / 3)))


def boom(dur=1.8, f0=68.0, f1=34.0, tau=0.5, sweep=0.35):
    """임팩트 저음 붐: 68Hz→34Hz 사인, 약한 포화로 배음(작은 스피커에서도 들리게)."""
    n = ns(dur)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / sweep)
    y = np.sin(TWO_PI * np.cumsum(f) / SR) * np.exp(-t / tau)
    y = np.tanh(1.5 * y)
    y = signal.sosfilt(HP25, y)
    return norm_peak(finish(y, 0.002, min(0.08, dur / 4)))


def clap(rng, tail=0.07, dur=0.4):
    """클랩: 0·8.5·17ms 짧은 잡음 세 번 + 26ms 꼬리. 800~2600Hz 중심(2~5kHz 덜어 냄)."""
    n = ns(dur)
    t = np.arange(n) / SR
    nz = colored_noise(rng, n, lambda F: hp_mag(F, 800, 2) * lp_mag(F, 3000, 2) * presence_dip(F, 0.25))
    env = np.zeros(n)
    for off in (0.0, 0.0085, 0.017):
        u = t - off
        env += (u >= 0) * smoothstep(u / 0.0004) * np.exp(-np.maximum(u, 0) / 0.0035)
    u = t - 0.026
    env += (u >= 0) * smoothstep(u / 0.0006) * np.exp(-np.maximum(u, 0) / tail)
    return norm_peak(finish(nz * env, 0.0005, 0.03))


def snare(rng, dur=0.22):
    """필인용 스네어: 190Hz 몸통 + 잡음."""
    n = ns(dur)
    t = np.arange(n) / SR
    body = np.sin(TWO_PI * 190 * t) * np.exp(-t / 0.035)
    nz = colored_noise(rng, n, lambda F: hp_mag(F, 900, 2) * lp_mag(F, 5000, 2) * presence_dip(F, 0.4)) * np.exp(-t / 0.05)
    return norm_peak(finish(0.45 * body + nz * 0.5, 0.0005, 0.02))


def hat(rng, decay=0.018, dur=0.09):
    """하이햇: 6.5~10kHz 잡음, 짧게."""
    n = ns(dur)
    t = np.arange(n) / SR
    nz = colored_noise(rng, n, lambda F: hp_mag(F, 6500, 3) * lp_mag(F, 10000, 4))
    return norm_peak(finish(nz * np.exp(-t / decay), 0.0005, 0.01))


def shaker(rng, dur=0.07):
    n = ns(dur)
    t = np.arange(n) / SR
    nz = colored_noise(rng, n, lambda F: hp_mag(F, 5500, 3) * lp_mag(F, 9500, 4))
    return norm_peak(finish(nz * smoothstep(t / 0.004) * np.exp(-t / 0.02), 0.0005, 0.01))


def crash(rng, decay=0.9, dur=2.6):
    """크래시(스테레오): 4.5~14kHz 잡음, 좌우 다른 잡음."""
    n = ns(dur)
    t = np.arange(n) / SR
    sh = lambda F: hp_mag(F, 4500, 2) * lp_mag(F, 11000, 3) * presence_dip(F, 0.4, 4000)
    e = np.exp(-t / decay)
    y = np.stack([colored_noise(rng, n, sh) * e, colored_noise(rng, n, sh) * e], 1)
    return norm_peak(finish(y, 0.001, 0.2))


def marimba(rng, f0, decay=None, mallet=0.05):
    """마림바: 기음 + 3.93배·9.6배 부분음(빨리 사라짐) + 말렛 잡음."""
    tau = decay if decay else 0.45 * (600 / f0) ** 0.45
    dur = min(2.5, tau * 6)
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for r, a, k in ((1.0, 1.0, 1.0), (3.93, 0.18, 0.16), (9.6, 0.04, 0.05)):
        if r * f0 < 9000:
            y += a * np.sin(TWO_PI * r * f0 * t + rng.uniform(0, TWO_PI)) * np.exp(-t / (tau * k))
    y += mallet * colored_noise(rng, n, lambda F: hp_mag(F, 250, 2) * lp_mag(F, 1800, 2)) * np.exp(-t / 0.0015)
    return norm_peak(finish(y, 0.0012, 0.02))


def bell(rng, f0, decay=1.2):
    """부드러운 벨(스테레오): 1·2·2.76·5.4 배 부분음. 좌우 ±1.5센트."""
    dur = decay * 4.5
    n = ns(dur)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    ph = rng.uniform(0, TWO_PI, 4)
    for ch, c in enumerate((-1.5, 1.5)):
        f = f0 * 2 ** (c / 1200)
        for j, (r, a, k) in enumerate(((1.0, 1.0, 1.0), (2.0, 0.20, 0.5), (2.76, 0.10, 0.3), (5.40, 0.03, 0.12))):
            out[:, ch] += a * np.sin(TWO_PI * r * f * t + ph[j]) * np.exp(-t / (decay * k))
    return norm_peak(finish(out, 0.0015, 0.05))


def pluck(rng, f0, decay=0.25, bright=1.0, maxf=5000, detune=5.0):
    """플럭(스테레오): 톱니파 가산합성, 높은 배음일수록 빨리 사라짐(필터 포락선 흉내)."""
    dur = min(2.0, decay * 5)
    n = ns(dur)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    K = max(1, int(maxf // f0))
    ph = rng.uniform(0, TWO_PI, K)          # 좌우 같은 위상에서 출발 → 모노 합산 안전
    for ch, c in enumerate((-detune, detune)):
        f = f0 * 2 ** (c / 1200)
        for k in range(1, K + 1):
            fk = k * f
            amp = (1.0 / k) * presence_dip(fk, 0.3) * hp_mag(fk, 200, 1)
            tau = decay / (1 + (k - 1) * 0.45 / bright)
            out[:, ch] += amp * np.sin(TWO_PI * fk * t + ph[k - 1]) * np.exp(-t / tau)
    return norm_peak(finish(out, 0.002, 0.02))


def ping(rng, f0, decay=0.07):
    """긴장 쌓기용 짧은 '핑'(사인 + 약한 2배음)."""
    n = ns(decay * 6)
    t = np.arange(n) / SR
    y = np.sin(TWO_PI * f0 * t) * np.exp(-t / decay) + 0.25 * np.sin(TWO_PI * 2 * f0 * t) * np.exp(-t / (decay * 0.5))
    return norm_peak(finish(y, 0.001, 0.01))


def sub_note(f0, dur, attack=0.012, release=0.03):
    """서브베이스: 사인 + 약한 2·3배음."""
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.sin(TWO_PI * f0 * t) + 0.22 * np.sin(TWO_PI * 2 * f0 * t) + 0.06 * np.sin(TWO_PI * 3 * f0 * t)
    return finish(y, attack, release) / 1.1


def midbass(rng, f0, dur=0.21):
    """미드베이스(펌핑 오프비트용): 톱니 배음, 기음은 줄이고(서브가 맡음) 높은 배음은 빨리 닫힘."""
    n = ns(dur)
    t = np.arange(n) / SR
    y = np.zeros(n)
    K = int(1800 // f0)
    for k in range(1, K + 1):
        fk = k * f0
        amp = (1.0 / k) * (0.3 if k == 1 else 1.0) * hp_mag(fk, 120, 2)
        tau = 0.16 / (1 + fk / 450)
        y += amp * np.sin(TWO_PI * fk * t) * np.exp(-t / tau)
    y = np.tanh(1.3 * y)
    return norm_peak(finish(y, 0.003, 0.02))


def riser(rng, dur, f0=350.0, f1=8000.0, power=2.2, tone=0.25):
    """라이저(스테레오): 잡음의 대역이 350Hz→8kHz 로 올라가며 커짐 + 위로 미끄러지는 음."""
    n = ns(dur)
    t = np.arange(n) / SR

    def g(tt, F):
        fc = f0 * (f1 / f0) ** ((tt / dur) ** 1.2)
        return np.exp(-0.5 * (np.log2(np.maximum(F, 1) / fc) / 0.75) ** 2) * presence_dip(F, 0.3)
    y = np.stack([tv_filter(rng.standard_normal(n), g), tv_filter(rng.standard_normal(n), g)], 1)
    y /= np.sqrt(np.mean(y ** 2)) + 1e-12
    amp = (t / dur) ** power
    if tone:
        fr = hz('D4') * 4 ** ((t / dur) ** 1.5)                 # D4 → D6
        ph = TWO_PI * np.cumsum(fr) / SR
        tn = np.sin(ph) + 0.3 * np.sin(2 * ph)
        y += (tone * tn)[:, None]
    y *= amp[:, None]
    return norm_peak(finish(y, 0.01, 0.006))


def downsweep(rng, dur=1.6):
    """드롭 직후 하강 잡음(스테레오): 저역통과가 9kHz→250Hz 로 닫힘."""
    n = ns(dur)
    t = np.arange(n) / SR

    def g(tt, F):
        fc = 250 * (9000 / 250) ** np.exp(-tt / 0.35)
        return lp_mag(F, fc, 2) * hp_mag(F, 150, 2) * presence_dip(F, 0.4)
    y = np.stack([tv_filter(rng.standard_normal(n), g), tv_filter(rng.standard_normal(n), g)], 1)
    y *= (np.exp(-t / 0.45))[:, None]
    return norm_peak(finish(y, 0.002, 0.1))


def pad_chord(rng, notes, fc, maxf=6000.0, detune=8.0):
    """패드(스테레오): 음마다 톱니파 3목소리(가운데·좌·우) 가산합성.
    fc(샘플마다)로 배음을 깎아 '필터가 열리는' 효과. 170Hz 아래·2~5kHz 는 깎는다."""
    n = len(fc)
    t = np.arange(n) / SR
    out = np.zeros((n, 2))
    inv4 = (1.0 / fc) ** 4
    fmax = min(maxf, 4 * fc.max())
    for name in notes:
        f0 = hz(name)
        for c, wl, wr in ((0.0, 0.7, 0.7), (-detune, 1.0, 0.25), (detune, 0.25, 1.0)):
            f = f0 * 2 ** (c / 1200)
            K = max(1, int(fmax // f))
            ph = rng.uniform(0, TWO_PI, K)
            acc = np.zeros(n)
            for k in range(1, K + 1):
                fk = k * f
                g = (1.0 / k) * hp_mag(fk, 170, 2) * presence_dip(fk, 0.3) / np.sqrt(1 + fk ** 4 * inv4)
                acc += g * np.sin(TWO_PI * fk * t + ph[k - 1])
            out[:, 0] += wl * acc
            out[:, 1] += wr * acc
    return out


def make_ir(rng, rt=1.6, pre=0.014, length=None):
    """합성 잔향 임펄스 응답(스테레오, 좌우 다른 잡음). 300Hz 아래·2~5kHz 덜어 냄, 고역은 더 빨리 사라짐."""
    n = ns(length or rt * 1.15)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for c in range(2):
        lo = colored_noise(rng, n, lambda F: hp_mag(F, 300, 2) * lp_mag(F, 2500, 1) * presence_dip(F, 0.4))
        hi = colored_noise(rng, n, lambda F: hp_mag(F, 2500, 1) * lp_mag(F, 7000, 2) * presence_dip(F, 0.4))
        ir[:, c] = lo * np.exp(-6.91 * t / rt) + 0.45 * hi * np.exp(-6.91 * t / (rt * 0.45))
    p = ns(pre)
    ir[:p] = 0
    ir[p:p + ns(0.004)] *= smoothstep(np.arange(ns(0.004)) / ns(0.004))[:, None]
    ir = finish(ir, 0.0001, 0.05)
    return ir / np.sqrt((ir ** 2).sum(0).mean())


def reverb(send, ir):
    return np.stack([signal.fftconvolve(send, ir[:, c])[:len(send)] for c in (0, 1)], 1)


def causal_band(x, lo, hi):
    """인과(앞으로만) 대역 필터 — FFT 마스크와 달리 소리가 시간상 앞으로 번지거나 곡 끝이 처음으로 감기지 않는다."""
    return signal.sosfilt(signal.butter(2, [lo, hi], 'bandpass', fs=SR, output='sos'), x)


def pingpong(send, d=0.375, fb=0.42, taps=6):
    """점8분(0.375초) 핑퐁 딜레이: 왼쪽→오른쪽 번갈아, 갈수록 작아짐."""
    n = len(send)
    s = causal_band(send, 300, 4500)
    out = np.zeros((n, 2))
    for k in range(1, taps + 1):
        D = ns(d * k)
        if D >= n:
            break
        out[D:, (k - 1) % 2] += 0.55 * fb ** (k - 1) * s[:n - D]
    return out


def sidechain(n, times, depth, rec=0.23, pre=0.003, hold=0.0, lead=0.0):
    """킥이 칠 때마다 이득을 (1-depth)로 눌렀다가(hold 초 유지) rec초에 걸쳐 되돌린다(펌핑).
    lead > 0 이면 킥보다 lead 초 먼저 다 눌러 둔다(미리보기 — 킥이 깨끗한 빈자리에 떨어짐)."""
    g = np.ones(n)
    if depth <= 0 or not times:
        return g
    L, P, H, Q = ns(rec), ns(pre), ns(hold), ns(lead)
    seg = np.concatenate([depth * smoothstep(np.arange(P) / P), np.full(Q + H, depth), depth * (1 - smoothstep(np.arange(L) / L))])
    for tk in times:
        s = ns(tk) - P - Q
        a, b = max(s, 0), min(s + len(seg), n)
        if b > a:
            g[a:b] = np.minimum(g[a:b], 1 - seg[a - s:b - s])
    return g


def interp_pts(pts, tt, log=False):
    xs = np.array([p[0] for p in pts])
    ys = np.array([p[1] for p in pts], float)
    if log:
        return np.exp(np.interp(tt, xs, np.log(ys)))
    return np.interp(tt, xs, ys)


# ───────────────────────── 음량(BS.1770) · 마스터 ─────────────────────────
_KB1 = [1.53512485958697, -2.69169618940638, 1.19839281085285]
_KA1 = [1.0, -1.69065929318241, 0.73248077421585]
_KB2 = [1.0, -2.0, 1.0]
_KA2 = [1.0, -1.99004745483398, 0.99007225036621]


def lufs(x):
    """ITU-R BS.1770-4 통합 음량(48kHz 전용 K-가중 계수, 400ms 블록, -70/-10 게이트)."""
    y = signal.lfilter(_KB2, _KA2, signal.lfilter(_KB1, _KA1, x, axis=0), axis=0)
    cs = np.concatenate([[0.0], np.cumsum((y ** 2).sum(1))])
    blk, hop = ns(0.4), ns(0.1)
    st = np.arange(0, len(y) - blk + 1, hop)
    ms = (cs[st + blk] - cs[st]) / blk
    l = -0.691 + 10 * np.log10(ms + 1e-20)
    ms = ms[l > -70]
    rel = -0.691 + 10 * np.log10(ms.mean()) - 10
    ms = ms[(-0.691 + 10 * np.log10(ms)) > rel]
    return -0.691 + 10 * np.log10(ms.mean())


def true_peak_db(x):
    return 20 * np.log10(np.abs(signal.resample_poly(x, 4, 1, axis=0)).max() + 1e-12)


def limiter(x, ceil_db=TP_CEIL_DB, win=0.008):
    """미리보기형 정점 제한기: 4배 과표집 정점 기준, 이득은 최소필터+평균필터로 부드럽게."""
    up = np.abs(signal.resample_poly(x, 4, 1, axis=0)).max(1)
    p = up[:len(x) * 4].reshape(len(x), 4).max(1)
    c = 10 ** (ceil_db / 20)
    g = np.minimum(1.0, c / np.maximum(p, 1e-12))
    W = ns(win)
    g = minimum_filter1d(g, 2 * W + 1, mode='nearest')
    g = uniform_filter1d(g, W + 1, mode='nearest')
    return x * g[:, None], float(g.min())


def write_wav24(path, y):
    q = np.clip(np.round(y * 8388607), -8388608, 8388607).astype('<i4')
    b = np.ascontiguousarray(q).view(np.uint8).reshape(-1, 4)[:, :3].tobytes()
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(3)
        w.setframerate(SR)
        w.writeframes(b)


# ───────────────────────── 곡 틀 ─────────────────────────
class Song:
    BUSES = ('kick', 'drums', 'bass', 'pad', 'mel', 'fx', 'hit')

    def __init__(self, name, dur, offset, seed):
        self.name, self.dur, self.n, self.off = name, dur, ns(dur), offset
        self.rng = np.random.default_rng(seed)
        self.b = {k: np.zeros((self.n, 2)) for k in self.BUSES}
        self.rev = np.zeros(self.n)
        self.dly = np.zeros(self.n)
        self.hitrev = np.zeros(self.n)
        self.kicks, self.events, self.gates, self.sections = [], [], [], []
        self.chords = {}
        self._cache = {}
        self.pad_fc, self.pad_gain, self.up_gain = [(0, 1500)], [(0, 0)], [(0, -60)]

    # 박자 격자
    def T(self, bar, beat=0.0):
        return self.off + 2.0 * (bar - 1) + 0.5 * beat

    def cache(self, key, fn):
        if key not in self._cache:
            self._cache[key] = fn()
        return self._cache[key]

    def add(self, bus, t, y, gain=1.0, pan=0.0, rev=0.0, dly=0.0, ev=None):
        i0 = ns(t)
        if y.ndim == 1:
            th = (pan + 1) * np.pi / 4
            y2 = np.stack([y * np.sqrt(2) * np.cos(th), y * np.sqrt(2) * np.sin(th)], 1)
        else:
            y2 = y
        y2 = y2 * gain
        if i0 < 0:
            y2, i0 = y2[-i0:], 0
        m = min(len(y2), self.n - i0)
        if ev:
            self.events.append([round(t, 4), ev])
        if m <= 0:
            return
        self.b[bus][i0:i0 + m] += y2[:m]
        mono = y2[:m].mean(1)
        if rev:
            (self.hitrev if bus == 'hit' else self.rev)[i0:i0 + m] += mono * rev
        if dly:
            self.dly[i0:i0 + m] += mono * dly

    # ── 드럼 ──
    def kick(self, t, gain=0.85, decay=0.08, sc=True):
        y = self.cache(('kick', decay), lambda: kick(self.rng, decay, dur=min(0.5, decay * 3.5)))
        self.add('kick', t, y, gain * KICK_SCALE, ev='kick')
        if sc:
            self.kicks.append(t)

    def kicks_on(self, bar0, bar1, beats=(0, 1, 2, 3), gain=0.85, until=None):
        for bar in range(bar0, bar1):
            for bt in beats:
                t = self.T(bar, bt)
                if until is None or t < until - 1e-6:
                    self.kick(t, gain)

    def claps(self, bar0, bar1, gain=0.33):
        for bar in range(bar0, bar1):
            for bt in (1, 3):
                y = self.cache(('clap', bt), lambda: clap(self.rng))
                self.add('drums', self.T(bar, bt), y, gain * CLAP_SCALE, rev=0.22)

    def hats(self, bar0, bar1, gain=0.09, ghosts=0.0, open_=False, until=None):
        for bar in range(bar0, bar1):
            for bt in range(4):
                for off, g, pan in ((0.5, 1.0, 0.18), (0.25, ghosts, -0.18), (0.75, ghosts, -0.18)):
                    if g <= 0:
                        continue
                    t = self.T(bar, bt + off)
                    if until is not None and t >= until - 1e-6:
                        continue
                    if open_ and off == 0.5:
                        y = self.cache(('ohat',), lambda: hat(self.rng, 0.085, 0.3))
                        gg = g * 0.75
                    else:
                        v = (bar * 4 + bt + int(off * 4)) % 3
                        y = self.cache(('hat', v), lambda: hat(self.rng))
                        gg = g
                    self.add('drums', t, y, gain * gg * HAT_SCALE, pan=pan, rev=0.04)

    def shakers(self, bar0, bar1, gain=0.05, until=None):
        for bar in range(bar0, bar1):
            for s in range(16):
                t = self.T(bar, s * 0.25)
                if until is not None and t >= until - 1e-6:
                    continue
                y = self.cache(('shk', s % 2), lambda: shaker(self.rng))
                self.add('drums', t, y, gain * HAT_SCALE * 0.8 * (1.0 if s % 2 else 0.55), pan=-0.3)

    def roll(self, t0, t1, step, g0, g1):
        ts = np.arange(t0, t1 - 1e-6, step)
        for i, t in enumerate(ts):
            y = self.cache(('snr', i % 3), lambda: snare(self.rng))
            self.add('drums', t, y, g0 + (g1 - g0) * i / max(1, len(ts) - 1), pan=0.1 * (-1) ** i, rev=0.25)

    def crash(self, t, gain=0.15):
        y = self.cache(('crash',), lambda: crash(self.rng))
        self.add('drums', t, y, gain, rev=0.25, ev='crash')

    # ── 베이스 ──
    def sub(self, bar0, bar1, gain=0.36, until=None, attack=0.012):
        for bar in range(bar0, bar1):
            t0 = self.T(bar)
            d = 2.0 if until is None else min(2.0, until - t0)
            if d <= 0.02:
                continue
            self.add('bass', t0, sub_note(hz(CH[self.chords[bar]]['root']), d, attack), gain * SUB_SCALE)
            if attack >= 0.04:
                self.events.append([round(t0, 4), 'sub_soft'])

    def pump(self, bar0, bar1, gain=0.22, pickups=False, until=None):
        for bar in range(bar0, bar1):
            f = hz(CH[self.chords[bar]]['root'])
            hits = [(bt + 0.5, 1.0) for bt in range(4)]
            if pickups:
                hits += [(1.75, 0.6), (3.75, 0.6)]
            for bt, v in hits:
                t = self.T(bar, bt)
                if until is not None and t >= until - 1e-6:
                    continue
                y = self.cache(('mb', round(f, 2)), lambda: midbass(self.rng, f))
                self.add('bass', t, y, gain * v * PUMP_SCALE)

    # ── 화성 ──
    def pad(self, bar0, bar1, layer='pad', end=None, attack=0.12, release=0.35):
        """bar0~bar1-1 마디의 화음을 패드로. 같은 화음이 이어지면 한 덩어리로."""
        segs = []
        for bar in range(bar0, bar1):
            c = self.chords[bar]
            t0, t1 = self.T(bar), self.T(bar + 1)
            if segs and segs[-1][2] == c:
                segs[-1][1] = t1
            else:
                segs.append([t0, t1, c])
        if end is not None:
            segs = [s for s in segs if s[0] < end]
            segs[-1][1] = min(segs[-1][1], end)
        for t0, t1, c in segs:
            notes = CH[c]['pad'] if layer == 'pad' else CH[c]['up']
            tt = t0 + np.arange(ns(t1 - t0 + release)) / SR
            fc = interp_pts(self.pad_fc, tt, log=True)
            y = pad_chord(self.rng, notes, fc)
            env = smoothstep((tt - t0) / attack) * (1 - smoothstep((tt - t1) / release))
            gdb = interp_pts(self.pad_gain if layer == 'pad' else self.up_gain, tt)
            y *= (env * 10 ** (gdb / 20) * PAD_SCALE)[:, None]
            self.add('pad', t0, finish(y, 0.002, 0.01), 1.0, rev=0.22)

    # ── 선율 ──
    def note(self, inst, m, t, gain, rev=0.25, dly=0.2, pan=0.0, **kw):
        key = (inst, m, tuple(sorted(kw.items())))
        if inst == 'marimba':
            y = self.cache(key, lambda: marimba(self.rng, hzm(m), **kw))
        elif inst == 'pluck':
            y = self.cache(key, lambda: pluck(self.rng, hzm(m), **kw))
        elif inst == 'bell':
            y = self.cache(key, lambda: bell(self.rng, hzm(m), **kw))
        elif inst == 'ping':
            y = self.cache(key, lambda: ping(self.rng, hzm(m), **kw))
        self.add('mel', t, y, gain, pan=pan, rev=rev, dly=dly)

    def motif(self, bar, inst='marimba', gain=0.28, octave=0, rev=0.25, dly=0.2, pan=0.0, **kw):
        for bt, name, vel in MOTIF:
            b = bar + int(bt // 4)
            m = adapt(midi(name) + 12 * octave, self.chords[b])
            self.note(inst, m, self.T(bar, bt), gain * vel / 0.5, rev=rev, dly=dly, pan=pan, **kw)

    def arp(self, bar0, bar1, gain=0.09, decay=0.12, until=None):
        for bar in range(bar0, bar1):
            notes = [midi(x) for x in CH[self.chords[bar]]['arp']]
            for s in range(16):
                t = self.T(bar, s * 0.25)
                if until is not None and t >= until - 1e-6:
                    continue
                v = 1.0 if s % 4 == 0 else (0.72 if s % 2 == 0 else 0.58)
                self.note('pluck', notes[ARP_PAT[s]], t, gain * v, rev=0.15, dly=0.25,
                          pan=0.3 if s % 2 else -0.3, decay=decay, bright=0.8)

    def hi(self, t, name, gain=0.24):
        """'높은 소리 한 번' = 벨."""
        self.note('bell', midi(name), t, gain, rev=0.45, dly=0.18, decay=0.9)
        self.events.append([round(t, 4), 'bell'])

    # ── 효과 ──
    def riser(self, t0, t1, gain=0.28, **kw):
        y = riser(self.rng, t1 - t0, **kw)
        self.add('fx', t0, y, gain, rev=0.18)
        self.events.append([round(t0, 4), 'riser_start'])
        self.events.append([round(t1, 4), 'riser_end'])

    def impact(self, t, size=1.0, chord='G'):
        """드롭 임팩트: 킥(박자 쪽에서 침) + 붐 + 하강 스윕 + 크래시 + 화음 한 방."""
        self.add('fx', t, boom(1.0 * size, 70, 40, 0.20), 0.80 * min(size, 1.2), ev='impact')
        self.add('fx', t, downsweep(self.rng, 1.6), 0.22 * size ** 1.5, rev=0.35)
        self.crash(t, 0.20 * size)
        for nm in CH[chord]['pad'] + CH[chord]['up']:
            self.note('pluck', midi(nm), t, 0.07 * size ** 1.5, rev=0.5, dly=0.0, decay=0.35, bright=0.7)
        y = self.cache(('clap', 9), lambda: clap(self.rng, tail=0.12))
        self.add('drums', t, y, 0.30 * size ** 2, rev=0.4)

    def final_hit(self, t, tail):
        """마지막 강박(로고): D 화음 한 방. 꼬리는 tail 초 안에서 자연 감쇠."""
        rng = self.rng
        self.final_t = t
        n = ns(tail)
        self.add('hit', t, kick(rng, 0.085, dur=tail), 0.65, ev='final')
        self.add('hit', t, boom(tail, 74, 44, 0.075, 0.05), 0.55)
        tt = np.arange(n) / SR
        st = np.zeros((n, 2))
        for i, nm in enumerate(['D4', 'F#4', 'A4', 'D5']):
            f = hz(nm)
            for k, a in ((1, 1.0), (2, 0.35), (3, 0.15), (4.0, 0.08)):
                st[:, i % 2] += a * np.sin(TWO_PI * k * f * tt) * np.exp(-tt / (0.075 / (1 + 0.3 * (k - 1))))
                st[:, 1 - i % 2] += 0.6 * a * np.sin(TWO_PI * k * f * tt) * np.exp(-tt / (0.075 / (1 + 0.3 * (k - 1))))
        st = finish(st, 0.0015, 0.03)
        self.add('hit', t, norm_peak(st), 0.30, rev=0.25)
        b = np.zeros(n)
        f = hz('D6')
        b += np.sin(TWO_PI * f * tt) * np.exp(-tt / 0.10) + 0.15 * np.sin(TWO_PI * 2.76 * f * tt) * np.exp(-tt / 0.03)
        self.add('hit', t, norm_peak(finish(b, 0.0015, 0.03)), 0.16, rev=0.3)
        sp = colored_noise(rng, n, lambda F: hp_mag(F, 5500, 2) * lp_mag(F, 13000, 2)) * np.exp(-tt / 0.05)
        self.add('hit', t, norm_peak(finish(sp, 0.0005, 0.03)), 0.10, rev=0.2)

    def gate(self, c0, c1, o0=None, o1=None):
        """c0~c1 에 걸쳐 0 으로 닫고, (o0~o1 에 걸쳐 다시 연다). 마지막 강박은 이 문 뒤에 더한다."""
        self.gates.append((c0, c1, o0, o1))

    # ── 마스터 ──
    def render(self):
        n = self.n
        sc = lambda d: sidechain(n, self.kicks, d)[:, None]
        mix = self.b['kick'] + self.b['drums'] + self.b['fx']
        # 베이스는 킥 2ms 전에 93% 눌러 0.08초 유지, 0.17초에 걸쳐 되살린다 — 킥 꼬리(55Hz)와 서브가 서로 상쇄돼 저음이 꺼졌다 살아나는 것을 막는다
        mix += self.b['bass'] * sidechain(n, self.kicks, 0.93, rec=0.17, pre=0.008, hold=0.08, lead=0.002)[:, None] + self.b['pad'] * sc(0.45) + self.b['mel'] * sc(0.22) * MEL_SCALE
        ir = make_ir(np.random.default_rng(7), 1.6)
        mix += reverb(self.rev, ir) * sc(0.35)
        mix += pingpong(self.dly) * sc(0.3)
        g = np.ones(n)
        tt = np.arange(n) / SR
        for c0, c1, o0, o1 in self.gates:
            close = 1 - smoothstep((tt - c0) / (c1 - c0))
            if o0 is not None:
                close = np.maximum(close, smoothstep((tt - o0) / (o1 - o0)))
            g = np.minimum(g, close)
        mix = signal.sosfilt(HP15, mix, axis=0) * g[:, None]
        ir_s = make_ir(np.random.default_rng(8), 0.35, pre=0.008, length=0.45)
        mix += signal.sosfilt(HP15, self.b['hit'] + reverb(self.hitrev, ir_s), axis=0)
        y = mix
        gmin = 1.0
        for _ in range(5):
            y = y * 10 ** ((TARGET_LUFS - lufs(y)) / 20)
            y, gm = limiter(y)
            gmin = min(gmin, gm)
        y = finish(y, 0.002, 0.025)        # 파일 처음·끝 샘플 = 0 보장(꼬리는 이미 거의 사라진 뒤)
        self.limiter_min_gain_db = 20 * np.log10(gmin)
        return y


# ───────────────────────── 1편 「묻기 전에 먼저」 66.995초 ─────────────────────────
def ep1():
    s = Song('ep1', 66.995, 0.495, seed=101)
    ch = {1: 'D', 2: 'D', 3: 'Bm', 4: 'G', 5: 'Em', 6: 'G', 7: 'Asus', 8: 'A'}
    for i, bar in enumerate(range(9, 21)):
        ch[bar] = ['D', 'Bm', 'G', 'A'][i % 4]
    ch.update({21: 'Em', 22: 'G', 23: 'Asus', 24: 'A'})
    for i, bar in enumerate(range(25, 33)):
        ch[bar] = ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bm', 'A'][i]
    ch[33] = 'G'
    s.chords = ch
    T = s.T
    # 패드 밝기(Hz)·크기(dB) 자동화
    s.pad_fc = [(0, 380), (T(1), 380), (T(4), 700), (T(7), 1500), (T(8), 2400), (T(8, 2), 1200), (T(9), 1300),
                (T(16), 1800), (T(17), 2600), (T(24), 3000), (T(24, 4), 3600), (T(25), 3000), (T(33), 1500), (70, 1500)]
    s.pad_gain = [(0, -7), (T(1), -7), (T(4), -4), (T(7), -2), (T(8), 0), (T(8, 1.6), -11), (T(8, 2), -4), (T(9), -5),
                  (T(16, 3.9), -5), (T(17), -2), (T(24, 2), -2), (T(24, 4), -8), (T(25), 1), (T(32, 4), 0), (T(33), -6), (70, -6)]
    s.up_gain = [(0, -6), (70, -6)]
    s.sections = [('로고(무음)', 0, T(1)), ('도입 1~3마디', T(1), T(4)), ('도입 4~7마디(긴장)', T(4), T(8)),
                  ('8마디 조리개·필인', T(8), T(9)), ('쌓기 9~14', T(9), T(15)), ('쌓기 15~16 베이스↑', T(15), T(17)),
                  ('쌓기 17~22 화음↑', T(17), T(23)), ('필인·라이저 23~24', T(23), T(25)), ('드롭 25~32', T(25), T(33)),
                  ('숨 고르기', T(33), T(33, 3)), ('직전 무음', T(33, 3), T(34)), ('마지막 강박+꼬리', T(34), 66.995)]

    # ── 도입 1~7마디: 드럼 없음. 패드(필터가 열림) + 마림바 모티프 + 빨라지는 핑 ──
    s.pad(1, 8)
    s.motif(1, gain=0.22)
    s.motif(3, gain=0.25)
    s.motif(5, gain=0.17)                                # 도입 내내 작은 모티프(5~6마디까지)
    for bt in range(4):                                  # 4마디: 4분음
        s.note('ping', midi('A5'), T(4, bt), 0.10, rev=0.2, dly=0.1)
    for st in range(8):                                  # 5마디: 8분음
        s.note('ping', midi('D6') if st == 7 else midi('A5'), T(5, st * 0.5), 0.115, rev=0.2, dly=0.1)
    for st in range(12):                                 # 6마디: 8분 → 16분
        bt = st * 0.5 if st < 4 else 2 + (st - 4) * 0.25
        s.note('ping', midi('A5') if st % 2 == 0 else midi('E5'), T(6, bt), 0.125, rev=0.2, dly=0.1)
    seq = [midi(x) for x in ('A5', 'B5', 'D6', 'E6')]
    for st in range(16):                                 # 7마디: 16분, 위로 올라가며 커짐
        s.note('ping', seq[st % 4] if st >= 8 else seq[0] + (0 if st % 2 == 0 else -5), T(7, st * 0.25),
               0.12 + 0.08 * st / 15, rev=0.2, dly=0.1)
    s.sub(5, 8, gain=0.16, attack=0.3)                   # 아주 작은 서브로 긴장
    s.riser(T(6), T(8), gain=0.16, power=2.6, tone=0.15)
    # ── 8마디: 14.495 조리개(빨려 들어가는 역벨) → 15.495 킥 연타로 터짐 ──
    sw = np.zeros((ns(1.2), 2))
    for nm in CH['A']['pad'] + ['A4', 'E5']:
        b = bell(s.rng, hz(nm), decay=0.5)
        sw[:len(b[:len(sw)])] += b[:len(sw)]
    sw = finish(norm_peak(sw[:ns(1.0)][::-1]), 0.005, 0.004)
    s.add('fx', T(8) + 0.0, sw, 0.18, rev=0.2)
    s.add('fx', T(8, 2), boom(0.7, 70, 40, 0.15, 0.10), 0.55)
    s.crash(T(8, 2), 0.17)
    for t, g, dc in ((T(8, 2), 0.95, 0.12), (T(8, 2.5), 0.70, 0.12), (T(8, 3), 0.75, 0.06), (T(8, 3.25), 0.75, 0.06),
                     (T(8, 3.5), 0.8, 0.06), (T(8, 3.75), 0.85, 0.06)):
        s.kick(t, g, decay=dc)
    s.roll(T(8, 3), T(9), 0.125, 0.10, 0.28)
    s.pad(8, 9)
    s.sub(8, 9, gain=0.2, until=T(8, 1.8))
    # ── 쌓기 9~23마디 ──
    s.kicks_on(9, 15, gain=0.72)
    s.kicks_on(15, 17, gain=0.76)
    s.kicks_on(17, 24, gain=0.80)
    s.kicks_on(24, 25, beats=(0, 1), gain=0.80)
    s.crash(T(9), 0.12)
    s.hats(9, 17, 0.085)
    s.hats(17, 25, 0.09, ghosts=0.45, until=T(24, 2))
    s.claps(11, 23)
    s.shakers(13, 25, 0.045, until=T(24, 2))
    s.pad(9, 25)
    s.pad(17, 25, layer='up')
    s.sub(9, 15, 0.22)
    s.sub(15, 25, 0.30, until=T(24, 2))                  # 28.495 베이스 커짐
    s.pump(15, 25, 0.20, until=T(24, 2))
    for bar in (9, 11, 13, 15):
        s.motif(bar, gain=0.27)
    for bar in (17, 19, 21):
        s.motif(bar, gain=0.22)
        s.motif(bar, 'pluck', gain=0.15, rev=0.2, dly=0.28, decay=0.22, bright=1.0)
    s.arp(15, 17, 0.06)
    s.arp(17, 24, 0.085)
    s.crash(T(17), 0.15)                                 # 32.495 화음 커짐
    s.roll(T(23), T(23, 2), 0.25, 0.10, 0.16)            # 44.495 필인
    s.roll(T(23, 2), T(24, 2), 0.125, 0.14, 0.24)
    s.roll(T(24, 2), T(25), 0.0625, 0.18, 0.34)
    s.riser(T(23), T(25), gain=0.38, power=2.6)          # 47.495 부터 킥 멈추고 라이저가 커짐
    # ── 드롭 25~32마디 (48.495) ──
    s.impact(T(25), 0.9, 'G')
    s.kicks_on(25, 33, gain=0.92)
    s.claps(25, 33, 0.40)
    s.hats(25, 29, 0.095, ghosts=0.45)
    s.hats(29, 33, 0.095, ghosts=0.45, open_=True)
    s.shakers(25, 33, 0.045)
    s.sub(25, 33, 0.36)
    s.pump(25, 33, 0.24, pickups=True)
    s.pad(25, 33)
    s.pad(25, 33, layer='up')
    for bar in (25, 27, 29, 31):
        s.motif(bar, 'pluck', gain=0.20, rev=0.2, dly=0.28, decay=0.24, bright=1.0)
        s.motif(bar, gain=0.20)
    for bar in (29, 31):
        s.motif(bar, 'bell', gain=0.06, octave=1, rev=0.35, dly=0.2, decay=0.4)
    s.arp(25, 33, 0.09)
    s.crash(T(29), 0.13)
    # ── 숨 고르기 64.495~65.995, 65.495 높은 소리, 65.995~66.495 무음, 66.495 마지막 강박 ──
    s.pad(33, 34, end=T(33, 2.95), attack=0.08)
    s.hi(T(33, 2), 'F#6', 0.22)
    s.gate(T(33, 2.9), T(33, 3))
    s.final_hit(T(34), 0.5)
    return s


# ───────────────────────── 2편 「특보 알림 하나를 꼼꼼하게」 40.600초 ─────────────────────────
def ep2():
    s = Song('ep2', 40.6, 0.0, seed=202)
    ch = {1: 'D', 2: 'Bm', 3: 'G', 4: 'Asus'}
    drop = ['G', 'A', 'F#m', 'Bm'] * 3 + ['G', 'A', 'Bm', 'A']
    for i, bar in enumerate(range(5, 21)):
        ch[bar] = drop[i]
    s.chords = ch
    T = s.T
    s.pad_fc = [(0, 800), (T(4), 1500), (T(5), 3000), (T(13), 3000), (T(13, 1), 1700), (T(15), 1700), (T(16), 3000),
                (T(20), 3000), (T(20, 4), 3400), (50, 3400)]
    s.pad_gain = [(0, -5), (T(4), -3), (T(5), 1), (T(13), 1), (T(13, 1), -2), (T(15), -2), (T(16), 1), (50, 1)]
    s.up_gain = [(0, -60), (T(5), -5), (T(13), -5), (T(13, 1), -40), (T(15), -40), (T(16), -5), (50, -5)]
    s.sections = [('숨 고르기 1~4', 0, 7.5), ('직전 무음', 7.5, 8.0), ('드롭 5~12', 8.0, 24.0),
                  ('덜어 냄 13~14', 24.0, 28.0), ('다시 쌓기 15', 28.0, 30.0), ('드롭B 16~19', 30.0, 38.0),
                  ('필인 20', 38.0, 40.0), ('마지막 강박+꼬리', 40.0, 40.6)]
    # ── 1~4마디: 킥 1·2박, 3박 높은 소리, 7.5~8.0 무음 ──
    s.kicks_on(1, 5, beats=(0, 1), gain=0.72)
    for bar in range(1, 5):
        s.add('bass', T(bar), sub_note(hz(CH[ch[bar]]['root']), 1.0), 0.18)
    for bar, nm in zip(range(1, 5), ('A5', 'B5', 'D6', 'E6')):
        s.hi(T(bar, 2), nm, 0.22)
    s.pad(1, 5, end=7.45, attack=0.4)
    s.shakers(3, 5, 0.03, until=7.45)
    s.riser(6.0, 7.45, gain=0.20, power=2.4, tone=0.12)
    s.gate(7.45, 7.5, 7.997, 8.0)
    # ── 8.0 드롭(가장 큼) ──
    s.impact(8.0, 1.8, 'G')
    s.kicks_on(5, 13, gain=0.92)
    s.kicks_on(13, 15, gain=0.84)
    s.kicks_on(15, 21, gain=0.92)
    s.claps(5, 13, 0.40)
    s.claps(13, 15, 0.33)
    s.claps(15, 21, 0.40)
    s.hats(5, 13, 0.095, ghosts=0.45)
    s.hats(13, 16, 0.09)
    s.hats(16, 21, 0.095, ghosts=0.45, open_=True)
    s.shakers(5, 13, 0.045)
    s.shakers(15, 21, 0.045)
    s.sub(5, 21, 0.36)
    s.pump(5, 13, 0.24, pickups=True)
    s.pump(13, 15, 0.21)
    s.pump(15, 21, 0.24, pickups=True)
    s.pad(5, 21, end=40.0)
    s.pad(5, 21, layer='up', end=40.0)
    for bar in (5, 7, 9, 11):
        s.motif(bar, 'pluck', gain=0.20, rev=0.2, dly=0.28, decay=0.24, bright=1.0)
        s.motif(bar, gain=0.20)
    s.motif(13, gain=0.16)                                # 24~28: 마림바만 작게
    for bar in (16, 18):
        s.motif(bar, 'pluck', gain=0.21, rev=0.2, dly=0.28, decay=0.24, bright=1.0)
        s.motif(bar, gain=0.20)
        s.motif(bar, 'bell', gain=0.06, octave=1, rev=0.35, dly=0.2, decay=0.4)
    s.arp(5, 13, 0.09)
    s.arp(15, 16, 0.07)
    s.arp(16, 21, 0.095)
    s.roll(T(15, 2), T(16), 0.125, 0.10, 0.24)
    s.riser(T(15, 1), T(16), gain=0.16, power=2.4, tone=0.0)
    s.crash(T(16), 0.16)                                  # 30.0 (화면 조리개 30.3 근처)
    s.roll(T(20, 2), T(20, 3), 0.125, 0.12, 0.2)
    s.roll(T(20, 3), T(21), 0.0625, 0.18, 0.3)
    s.gate(39.965, 40.0)
    s.final_hit(40.0, 0.6)
    return s


# ───────────────────────── 3편 「사고 나던 곳을 미리」 58.500초 ─────────────────────────
def ep3():
    s = Song('ep3', 58.5, 0.0, seed=303)
    ch = {1: 'D'}
    for i, bar in enumerate(range(2, 10)):
        ch[bar] = ['D', 'Bm', 'G', 'A'][i % 4]
    for i, bar in enumerate(range(10, 16)):
        ch[bar] = ['D', 'Bm', 'G', 'A', 'D', 'Bm'][i]
    ch.update({16: 'Em', 17: 'Asus'})
    for i, bar in enumerate(range(18, 26)):
        ch[bar] = ['G', 'A', 'F#m', 'Bm', 'G', 'A', 'Bm', 'A'][i]
    for i, bar in enumerate(range(26, 30)):
        ch[bar] = ['G', 'DF#', 'Em', 'Asus'][i]
    s.chords = ch
    T = s.T
    s.pad_fc = [(0, 600), (1.0, 900), (2.0, 1400), (14.0, 1600), (18.0, 2600), (30.0, 2600), (30.2, 800),
                (33.0, 1500), (34.0, 3000), (50.0, 3000), (50.05, 1300), (60, 1300)]
    s.pad_gain = [(0, -6), (2.0, -5), (17.95, -5), (18.0, -1), (30.0, -1), (30.2, -7), (33.0, -4), (34.0, 1), (50.0, 0),
                  (50.05, -6), (60, -6)]
    s.up_gain = [(0, -60), (18.0, -6), (30.0, -6), (30.2, -60), (34.0, -5), (50.0, -5), (50.05, -60), (60, -60)]
    s.sections = [('조용한 시작(로고)', 0, 1.0), ('킥 필인', 1.0, 2.0), ('킥 4박 2~7', 2.0, 14.0),
                  ('베이스↑ 8~9', 14.0, 18.0), ('화음↑ 10~15', 18.0, 30.0), ('긴장 16~17', 30.0, 33.0),
                  ('라이저', 33.0, 34.0), ('드롭 18~25', 34.0, 50.0), ('숨 고르기 26~29', 50.0, 57.5),
                  ('직전 무음', 57.5, 58.0), ('마지막 강박+꼬리', 58.0, 58.5)]
    # ── 0~1.0 조용히, 1.0 킥 필인, 2.0 킥 4박 ──
    s.pad(1, 2, attack=0.9)
    s.hi(0.0, 'D6', 0.12)
    for t, g, dc in ((1.0, 0.70, 0.12), (1.25, 0.62, 0.12), (1.5, 0.66, 0.06), (1.625, 0.7, 0.06), (1.75, 0.75, 0.06),
                     (1.875, 0.8, 0.06)):
        s.kick(t, g, decay=dc)
    s.roll(1.5, 2.0, 0.125, 0.08, 0.2)
    s.crash(2.0, 0.14)
    s.kicks_on(2, 8, gain=0.72)
    s.kicks_on(8, 10, gain=0.76)
    s.kicks_on(10, 18, gain=0.80, until=33.0)
    s.hats(2, 10, 0.085, until=33.0)
    s.hats(10, 18, 0.09, ghosts=0.45, until=33.0)
    s.claps(4, 16)
    s.shakers(6, 16, 0.045)
    s.pad(2, 18)
    s.pad(10, 18, layer='up')
    s.sub(2, 8, 0.22)
    s.sub(8, 18, 0.30, until=33.0)                        # 14.0 베이스 커짐
    s.pump(8, 16, 0.21)
    s.pump(16, 18, 0.18, until=33.0)
    for bar in (2, 4, 6, 8):
        s.motif(bar, gain=0.27)
    for bar in (10, 12, 14):                              # 18.0 화음 커짐
        s.motif(bar, gain=0.22)
        s.motif(bar, 'pluck', gain=0.15, rev=0.2, dly=0.28, decay=0.22, bright=1.0)
    s.arp(10, 16, 0.085)
    s.crash(18.0, 0.15)
    # ── 30~34 긴장: 핑(생각 중) 31.0 8분 → 32.0 16분, 33.0 라이저(킥 멈춤) ──
    for st in range(4):
        s.note('ping', midi('A5'), 31.0 + st * 0.25, 0.09 + 0.01 * st, rev=0.2, dly=0.1)
    for st in range(8):
        s.note('ping', midi('A5') if st % 2 == 0 else midi('E5'), 32.0 + st * 0.125, 0.11 + 0.005 * st, rev=0.2, dly=0.1)
    seq = [midi(x) for x in ('A5', 'B5', 'D6', 'E6')]
    for st in range(8):
        s.note('ping', seq[st % 4], 33.0 + st * 0.125, 0.13 + 0.006 * st, rev=0.2, dly=0.1)
    s.roll(32.0, 33.0, 0.125, 0.10, 0.18)
    s.roll(33.0, 34.0, 0.0625, 0.16, 0.32)
    s.riser(32.0, 34.0, gain=0.40, power=2.6)
    # ── 34.0 드롭 ──
    s.impact(34.0, 0.9, 'G')
    s.kicks_on(18, 26, gain=0.92)
    s.claps(18, 26, 0.40)
    s.hats(18, 22, 0.095, ghosts=0.45)
    s.hats(22, 26, 0.095, ghosts=0.45, open_=True)
    s.shakers(18, 26, 0.045)
    s.sub(18, 26, 0.36)
    s.pump(18, 26, 0.24, pickups=True)
    s.pad(18, 26)
    s.pad(18, 26, layer='up')
    for bar in (18, 20, 22, 24):
        s.motif(bar, 'pluck', gain=0.20, rev=0.2, dly=0.28, decay=0.24, bright=1.0)
        s.motif(bar, gain=0.20)
    for bar in (22, 24):
        s.motif(bar, 'bell', gain=0.06, octave=1, rev=0.35, dly=0.2, decay=0.4)
    s.arp(18, 26, 0.09)
    s.crash(42.0, 0.13)
    # ── 50~57.5 숨 고르기: 드럼 없음, 따뜻한 패드 + 작은 마림바 + 51·53·55·57 높은 소리 ──
    s.pad(26, 30, end=57.45, attack=0.15)
    for bar in range(26, 30):
        s.add('bass', T(bar), sub_note(hz(CH[ch[bar]]['root']), 2.0 if bar < 29 else 1.45, 0.05, 0.05), 0.13, ev='sub_soft')
        notes = [midi(x) - 12 for x in CH[ch[bar]]['arp']]
        for st in range(8):
            t = T(bar, st * 0.5)
            if t >= 56.9:
                continue
            s.note('marimba', notes[[0, 1, 2, 1, 3, 1, 2, 1][st]], t, 0.08 if st % 2 == 0 else 0.055, rev=0.3, dly=0.15)
    for t, nm in ((51.0, 'F#6'), (53.0, 'E6'), (55.0, 'D6'), (57.0, 'A5')):
        s.hi(t, nm, 0.22)
    s.gate(57.45, 57.5)
    s.final_hit(58.0, 0.5)
    return s


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    meta = {}
    for fn in (ep1, ep2, ep3):
        s = fn()
        y = s.render()
        path = os.path.join(out, s.name + '.wav')
        write_wav24(path, y)
        os.makedirs(os.path.join(out, 'stems'), exist_ok=True)
        ks = s.b['kick'].copy()
        ks[ns(s.final_t):] += kick(np.random.default_rng(0), 0.085, dur=s.dur - s.final_t)[:, None][:len(ks) - ns(s.final_t)]
        write_wav24(os.path.join(out, 'stems', s.name + '_kick.wav'), ks / (np.abs(ks).max() + 1e-9) * 0.5)
        meta[s.name] = dict(dur=s.dur, samples=s.n, offset=s.off, kicks=sorted(set(round(k, 4) for k in s.kicks)),
                            events=sorted(s.events), gates=s.gates, sections=s.sections,
                            limiter_min_gain_db=round(s.limiter_min_gain_db, 2))
        print(f'{path}: {len(y)} 샘플 = {len(y) / SR:.3f}초, LUFS {lufs(y):.2f}, TP {true_peak_db(y):.2f} dBTP, '
              f'리미터 최대 감쇠 {abs(s.limiter_min_gain_db):.2f} dB', flush=True)
    with open(os.path.join(out, 'events.json'), 'w') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
