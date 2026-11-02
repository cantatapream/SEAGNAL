"""한 프레임짜리 튐 검사: 이웃 프레임 차이의 3배가 넘는 프레임(앞뒤 둘 다보다 큼)을 찾는다.
사용: python3 glitch.py <영상 또는 concat .txt> [fps=60]"""
import subprocess, sys
import numpy as np
src = sys.argv[1]; fps = int(sys.argv[2]) if len(sys.argv) > 2 else 60
args = ['-f', 'concat', '-safe', '0', '-i', src] if src.endswith('.txt') else ['-i', src]
raw = subprocess.run(['ffmpeg', '-v', 'error', *args, '-vf', 'scale=192:108,format=gray', '-f', 'rawvideo', '-'], capture_output=True, check=True).stdout
v = np.frombuffer(raw, np.uint8).reshape(-1, 108, 192).astype(np.float32)
d = np.abs(np.diff(v, axis=0)).mean(axis=(1, 2))          # d[i] = 프레임 i → i+1 차이
bad = []
for i in range(1, len(d) - 1):
    # 프레임 i+1 이 튐이면: 들어갈 때(d[i])와 나올 때(d[i+1]) 모두 크고, 그 앞뒤(d[i-1], d[i+2])보다 3배 넘음
    if i + 2 < len(d):
        a, b = d[i], d[i + 1]; ref = max(d[i - 1], d[i + 2], 0.3)
        if min(a, b) > 3 * ref and min(a, b) > 2.0:
            bad.append((i + 1, (i + 1) / fps, round(float(a), 2), round(float(b), 2), round(float(ref), 2)))
print(f'프레임 {len(v)}개, 튐 후보 {len(bad)}개')
for b in bad[:40]:
    print(f'  프레임 {b[0]} (V {b[1]:.3f}s): 들어감 {b[2]} 나감 {b[3]} 기준 {b[4]}')
# 가장 큰 변화 10개(전환 순간 확인용)
top = np.argsort(d)[::-1][:10]
print('가장 큰 프레임 변화:', ', '.join(f'V{(i + 1) / fps:.2f}({d[i]:.1f})' for i in sorted(top)))
