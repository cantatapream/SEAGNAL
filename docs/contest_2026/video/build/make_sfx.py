# 효과음 합성기 — 외부 음원 없이 numpy 로 만든다 (48kHz, 모노, 16비트 wav)
# 사용: python3 make_sfx.py <출력폴더> [click pop typing notify ...]
#   click  : 마우스 딸깍 (누름 + 0.045초 뒤 뗌)
#   pop    : 「툭」 — 아이콘이 0에서 튀어나올 때 (음높이가 떨어지는 짧은 저음 + 아주 짧은 잡음)
#   typing : 자판 다다닥 (한 타 = 낮은 몸통음 + 잡음, 간격·음높이를 조금씩 흔듦)
#   notify : 알림 두 음 (E6 → A6, 사인파 + 2배음, 빠른 감쇠) — 특정 휴대폰 회사 소리를 흉내 내지 않은 일반 두 음
import numpy as np, wave, sys, os

SR = 48000
rng = np.random.default_rng(7)          # 같은 소리가 매번 나오게 씨앗 고정

def t_(dur): return np.arange(int(SR * dur)) / SR

def env(dur, attack, decay):
    """빠른 상승 후 지수 감쇠 (decay = 1/e 까지 걸리는 초)"""
    t = t_(dur); a = np.clip(t / max(attack, 1e-4), 0, 1)
    return a * np.exp(-np.maximum(t - attack, 0) / decay)

def bandnoise(dur, lo, hi):
    """lo~hi Hz 만 남긴 백색잡음 (FFT 마스크)"""
    n = int(SR * dur); x = rng.standard_normal(n)
    X = np.fft.rfft(x); f = np.fft.rfftfreq(n, 1 / SR)
    X[(f < lo) | (f > hi)] = 0
    y = np.fft.irfft(X, n); return y / (np.abs(y).max() + 1e-9)

def tick(dur=0.03, lo=2000, hi=7000, decay=0.006, tone=3200, tone_amp=0.5):
    e = env(dur, 0.0005, decay)
    return e * (bandnoise(dur, lo, hi) + tone_amp * np.sin(2 * np.pi * tone * t_(dur)))

def click():
    press = tick(0.04, 1800, 6500, 0.005, 3000, 0.6)
    rel = 0.5 * tick(0.03, 2500, 8000, 0.004, 4200, 0.4)
    out = np.zeros(int(SR * 0.1)); out[:len(press)] += press
    k = int(SR * 0.045); out[k:k + len(rel)] += rel
    return out

def pop():
    dur = 0.16; t = t_(dur)
    f = 90 + 230 * np.exp(-t / 0.018)                 # 320Hz → 90Hz 로 빠르게 떨어짐
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * env(dur, 0.001, 0.045)
    snap = 0.25 * bandnoise(dur, 1500, 6000) * env(dur, 0.0003, 0.004)
    return body + snap

def key(pitch=1.0):
    dur = 0.07; t = t_(dur)
    thock = np.sin(2 * np.pi * 190 * pitch * t) * env(dur, 0.001, 0.012)
    clack = bandnoise(dur, 900 * pitch, 5000 * pitch) * env(dur, 0.0005, 0.006)
    return 0.6 * thock + 0.7 * clack

def typing(n=14):
    out = np.zeros(int(SR * (0.1 * n + 0.2))); pos = 0.0
    for i in range(n):
        k = key(pitch=rng.uniform(0.9, 1.12)) * rng.uniform(0.7, 1.0)
        s = int(pos * SR); out[s:s + len(k)] += k
        pos += rng.uniform(0.055, 0.11)                # 다다닥: 한 타 55~110ms
    return out[:int(SR * (pos + 0.1))]

def notify():
    def note(freq, dur=0.35):
        t = t_(dur); e = env(dur, 0.004, 0.09)
        return e * (np.sin(2 * np.pi * freq * t) + 0.3 * np.sin(2 * np.pi * 2 * freq * t))
    a, b = note(1318.5), note(1760.0)
    out = np.zeros(int(SR * 0.5)); out[:len(a)] += a
    k = int(SR * 0.11); out[k:k + len(b)] += b
    return out

def save(path, x, peak_db=-3.0):
    x = x / (np.abs(x).max() + 1e-9) * 10 ** (peak_db / 20)   # 정점을 -3dBFS 로 맞춤(최종 음량은 섞은 뒤 loudnorm)
    fade = int(SR * 0.003); x[-fade:] *= np.linspace(1, 0, fade)
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype('<i2').tobytes())
    print(path, '%.3f s' % (len(x) / SR))

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    names = sys.argv[2:] or ['click', 'pop']
    fn = {'click': click, 'pop': pop, 'typing': typing, 'notify': notify}
    for n in names: save(os.path.join(out, {'pop': 'pop_tuk'}.get(n, n) + '.wav'), fn[n]())
