"""음악 구간 잇기 + 효과음 큐 얹기 → 48kHz 스테레오 float wav.
사용: python3 mix.py <cues.json> <out.wav> <곡시작:곡끝,...  또는  편별 곡.wav> [끝_페이드초]
  - 구간 사이는 10ms 교차, 끝은 페이드(기본 0.5초). 길이는 cues.json 의 DUR 에 맞춘다."""
import json, subprocess, sys, os
import numpy as np
SR = 48000
D = os.path.dirname(os.path.abspath(__file__))
MP3 = os.path.join(os.path.dirname(D), 'music', 'your_breath.mp3')
SFX = {'click': 'click.wav', 'pop': 'pop_tuk.wav', 'typing': 'typing.wav', 'notify': 'notify.wav'}
BASE = {'click': 0.32, 'pop': 0.30, 'typing': 0.30, 'notify': 0.42}


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ar', str(SR), '-ac', '2', '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, 2).copy()


def main():
    cues = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    segs = [] if sys.argv[3].endswith('.wav') else [tuple(map(float, s.split(':'))) for s in sys.argv[3].split(',')]
    fade = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    dur = cues['dur']
    xf = int(0.010 * SR)
    music = None
    if sys.argv[3].endswith('.wav'):          # 새 배경음(직접 합성한 편별 곡) — 구간 자르기 없이 그대로
        music = decode(sys.argv[3]); segs = []
    else:
        song = decode(MP3)
    for a, b in segs:
        part = song[int(round(a * SR)):int(round(b * SR)) + xf]
        if music is None:
            music = part
        else:   # 앞 구간 끝 xf 와 새 구간 앞 xf 를 겹침
            r = np.linspace(0, 1, xf)[:, None]
            music[-xf:] = music[-xf:] * (1 - r) + part[:xf] * r
            music = np.concatenate([music, part[xf:]])
    n = int(round(dur * SR))
    music = music[:n] if len(music) >= n else np.concatenate([music, np.zeros((n - len(music), 2), np.float32)])
    f0 = n - int(fade * SR)
    music[f0:] *= np.linspace(1, 0, n - f0)[:, None] ** 1.5
    mix = music.astype(np.float64)
    bank = {}
    for t, name, g in cues['cues']:
        if name not in bank:
            bank[name] = decode(os.path.join(D, 'sfx', SFX[name]))
        s = bank[name] * BASE[name] * g
        i = int(round(t * SR))
        if i >= n:
            continue
        m = min(len(s), n - i)
        mix[i:i + m] += s[:m]
    peak = np.abs(mix).max()
    mix.astype(np.float32).tofile(out + '.f32')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', out + '.f32', '-c:a', 'pcm_f32le', out], check=True)
    os.remove(out + '.f32')
    print(f'mix {out}: {n / SR:.3f}s, cues {len(cues["cues"])}, peak {20 * np.log10(peak + 1e-9):.1f} dBFS')


main()
