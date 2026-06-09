#!/usr/bin/env bash
# ============================================================================
# watch_and_finish.sh — 파고·풍속 배치가 모두 끝나면 자동으로:
#   1) combine_reports.js (파고+풍속 결합 전국 종합)
#   2) marginSweep.js     (면적 마진 분석, lead 12/24)
#   을 실행하고, 핵심 리포트를 추적 경로(reports/)로 복사해 커밋·푸시한다.
#
# 자격증명은 환경변수(KMA_DMDW_USER_ID/PWD)로 받는다(스크립트에 하드코딩 금지).
# 실행: KMA_DMDW_USER_ID=.. KMA_DMDW_USER_PWD=.. nohup ./watch_and_finish.sh &
# ============================================================================
cd "$(dirname "$0")"
LOG=out/logs/watch.log
mkdir -p out/logs reports
echo "[watch $(date +%H:%M:%S)] 시작 — runLeadtime 종료 대기" >> "$LOG"

# 1) 모든 runLeadtime.js 프로세스가 끝날 때까지 대기 (최대 6시간 안전장치)
for i in $(seq 1 360); do
  if ! pgrep -f "runLeadtime.js" >/dev/null 2>&1; then break; fi
  sleep 60
done
echo "[watch $(date +%H:%M:%S)] 배치 종료 감지 — 취합 시작" >> "$LOG"

# 2) 결합 종합 + 면적 마진
node combine_reports.js >> "$LOG" 2>&1
node marginSweep.js --lead=24 >> "$LOG" 2>&1
cp -f out/MARGIN_sweep.md reports/MARGIN_sweep_lead24.md 2>/dev/null
node marginSweep.js --lead=12 >> "$LOG" 2>&1
cp -f out/MARGIN_sweep.md reports/MARGIN_sweep_lead12.md 2>/dev/null

# 3) 핵심 리포트를 추적 경로로 복사
cp -f out/SUMMARY_national.md reports/SUMMARY_national.md 2>/dev/null
for f in out/leadtime_*_wind_*.md; do [ -f "$f" ] && cp -f "$f" "reports/$(basename "$f")"; done
# 파고(옛 파일명) 청별 최신만 복사
for code in jeju busn gwju degu gawn dajn; do
  latest=$(ls -t out/leadtime_${code}_2*.md 2>/dev/null | head -1)
  [ -n "$latest" ] && cp -f "$latest" "reports/wave_${code}.md"
done

# 4) 커밋·푸시 (네트워크 재시도)
git add reports/ >> "$LOG" 2>&1
git commit -q -m "report(analysis): 파고+풍속 결합 전국 종합 + 면적 마진 분석 (배치 자동 취합)" >> "$LOG" 2>&1
for i in 1 2 3 4; do
  if git push origin claude/stoic-cannon-h2eu4m >> "$LOG" 2>&1; then break; fi
  sleep $((2 ** i))
done
echo "[watch $(date +%H:%M:%S)] 완료" >> "$LOG"
