"""최종 인코딩: 음량 -14 LUFS(2단계 loudnorm) → AAC 128k → x264 2-pass veryslow, 19,900,000바이트 이하 확인.
사용: python3 encode.py <영상(중간본 mp4 또는 concat 목록 .txt)> <mix.wav> <out.mp4> [여유비율=0.95]"""
import json, os, re, subprocess, sys
LIMIT = 19_900_000


def run(cmd, **kw):
    return subprocess.run(cmd, check=True, **kw)


def main():
    vin, mix, out = sys.argv[1:4]
    margin = float(sys.argv[4]) if len(sys.argv) > 4 else 0.95
    work = out + '.work'; os.makedirs(work, exist_ok=True)
    vargs = ['-f', 'concat', '-safe', '0', '-i', vin] if vin.endswith('.txt') else ['-i', vin]
    # 1) 음량 재기
    r = subprocess.run(['ffmpeg', '-hide_banner', '-i', mix, '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'],
                       capture_output=True, text=True)
    m = json.loads(re.search(r'\{[^{}]*"input_i"[^{}]*\}', r.stderr).group(0))
    af = (f"loudnorm=I=-14:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    aud = os.path.join(work, 'audio.m4a')
    run(['ffmpeg', '-v', 'error', '-y', '-i', mix, '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '128k', aud])
    chk = subprocess.run(['ffmpeg', '-hide_banner', '-i', aud, '-af', 'ebur128=peak=true', '-f', 'null', '-'], capture_output=True, text=True).stderr
    I = re.findall(r'I:\s+(-?[\d.]+) LUFS', chk)[-1]; TP = re.findall(r'Peak:\s+(-?[\d.]+) dBFS', chk)[-1]
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mix], capture_output=True, text=True).stdout)
    ab = os.path.getsize(aud)
    vk = int((LIMIT * margin - ab - 60_000) * 8 / dur / 1000)
    print(f'음량 I={I} LUFS, 참 정점 {TP} dBFS, 음성 {ab} B, 길이 {dur:.3f}s → 영상 목표 {vk} kbps')
    x = ['-c:v', 'libx264', '-preset', 'veryslow', '-b:v', f'{vk}k', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-g', '120', '-r', '60']
    log = os.path.join(work, 'x264')
    run(['ffmpeg', '-v', 'error', '-y', *vargs, '-t', f'{dur:.3f}', *x, '-pass', '1', '-passlogfile', log, '-an', '-f', 'null', '-'])
    run(['ffmpeg', '-v', 'error', '-y', *vargs, '-i', aud, '-map', '0:v', '-map', '1:a', '-t', f'{dur:.3f}', *x, '-pass', '2', '-passlogfile', log,
         '-c:a', 'copy', '-movflags', '+faststart', out])
    sz = os.path.getsize(out)
    print(f'{out}: {sz:,} 바이트 — {"통과" if sz <= LIMIT else "초과!"} (한도 {LIMIT:,})')


main()
