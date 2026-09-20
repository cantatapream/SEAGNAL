#!/bin/bash
# ============================================================================
# 파일명: _dashboard/loop/fresh_watchdog.sh
# 역할: 오래 도는 신선도 점검(admrul_fresh.py)이 **중간에 조용히 죽는 것**을 잡아내고,
#       죽으면 이어받아 다시 띄운다. 죽은 순간을 표로 남겨 "왜 죽는지"를 재게 한다.
# ============================================================================
#
# [쓰는 법]
#   bash _dashboard/loop/fresh_watchdog.sh <작업폴더> <legal 폴더 절대경로>
#   예) setsid nohup bash _dashboard/loop/fresh_watchdog.sh /tmp/a1 \
#         /home/user/SEAGNAL/local_server/knowledge/legal > /dev/null 2>&1 &
#   작업폴더에 이렇게 쌓인다:
#     admrul_fresh_report_final.json  최종 산출물(이게 생기면 끝난 것이다)
#     admrul_progress.jsonl           한 건 판정할 때마다 곧바로 덧붙는 누적 기록
#     admrul_fresh_run.log            실행 로그(재시작해도 이어서 덧붙는다)
#     a1_watchdog.tsv                 감시 표본 — 언제 OK/DEAD/STALL/DONE 이었나
#
# [왜 있나 — 2026-09-20]
#   admrul_fresh.py 가 389/824 에서 **오류 한 줄 없이** 사라졌다. 메모리·디스크 여유가 있었고
#   OOM 기록도 없었다. 원인을 모르는 채로는 "다시 돌려 보자"밖에 할 수가 없는데, 한 번이
#   두 시간이라 그 사이 또 죽으면 또 모른다. 그래서 두 가지를 같이 건다 —
#     ① admrul_fresh.py 의 --progress/--resume (한 건마다 적고, 죽으면 이어받는다)
#     ② 이 감시 장치 (60초마다 살았는지 보고, 죽었으면 이어받아 다시 띄우고, 표에 남긴다)
#   ⚠이것은 원인을 고치는 것이 아니다. **원인을 재는 장치**이고, 재는 동안 일이 안 날아가게
#     하는 장치다. a1_watchdog.tsv 에 DEAD 가 쌓이면 그 간격·진행률이 원인 추적의 실마리다.
#
# [★원인을 찾았다 — 2026-09-20 19:00, 이 장치가 찾아냈다]
#   두 번째로 멈췄을 때(127/824) **파이썬만이 아니라 이 감시 셸도 같은 순간에 사라져 있었다.**
#   `sleep` 만 도는 셸 반복문은 스스로 죽지 않는다. 그래서 바깥을 봤더니 —
#       $ uptime
#        up 0 min
#   **기계가 새로 뜬 것이다.** 프로세스가 죽은 게 아니라 컨테이너가 재시작됐다.
#   개발 컨테이너는 한동안 아무 일도 안 하면 회수됐다가 다시 뜬다(환경 설명에 적힌 동작이다).
#   그때 배경 프로세스는 **종류를 가리지 않고 전부** 사라진다 — 오류도 OOM 기록도 안 남는 이유가 이것이다.
#
#   그러므로:
#   · **이 감시 장치도 컨테이너 재시작은 못 견딘다.** 감시가 감시를 되살릴 수는 없다.
#     되살리는 것은 바깥에서 세션을 깨우는 쪽(예약 점검)의 몫이다.
#   · **견디는 것은 --progress 파일뿐이다.** 실제로 127줄이 그대로 살아남았고, 다시 띄우자
#     "이어받기: 이미 판정된 127건은 다시 묻지 않는다 (남은 697건)" 로 그 자리에서 이어졌다.
#   · 즉 **긴 점검은 "한 번에 끝낸다"가 아니라 "몇 번이든 이어받는다"로 설계해야 한다.**
#   ⚠서버(fly.io)에서 도는 주간 정기작업은 이 문제와 무관하다 — 거기는 개발 컨테이너가 아니다.
#     이 교훈은 **사람이 개발 환경에서 손으로 긴 점검을 돌릴 때** 걸리는 것이다.
#
# [연계]
#   - 부름: _dashboard/loop/admrul_fresh.py --out/--progress/--resume
#   - ⚠서버 정기작업(services/admrul_fresh_scanner.js)은 이 스크립트를 쓰지 않는다.
#     그쪽은 --out 만 주는 한 번 실행이다. 이 감시는 사람이 손으로 돌리는 긴 실행용이다.
# ============================================================================
# A-1(admrul_fresh.py) 감시 장치.
#  왜: 2026-09-20 에 389/824 에서 프로세스가 오류 한 줄 없이 사라졌다. 왜 죽는지 모르므로
#      ①죽는 순간을 기록으로 남기고 ②죽으면 이어받아 다시 띄운다.
#  하는 일(60초마다):
#      · 표본을 a1_watchdog.tsv 에 한 줄씩 남긴다(시각·살았나·로그줄·누적줄·로그가 멈춘 초)
#      · 산출물(--out)이 생겼으면 끝난 것이므로 DONE 을 적고 스스로 멈춘다
#      · 프로세스가 없고 산출물도 없으면 DEAD 를 적고 --resume 으로 다시 띄운다
#      · 살아 있는데 로그가 STALL_SEC 넘게 안 늘면 STALL 을 적고 죽인 뒤 이어받아 다시 띄운다
#        (urllib timeout 25초 x 3회라 한 건이 최대 75초쯤 — 900초는 분명히 멈춘 것이다)
SP="$1"; LEGAL="$2"
OUT="$SP/admrul_fresh_report_final.json"
PROG="$SP/admrul_progress.jsonl"
LOG="$SP/admrul_fresh_run.log"
TSV="$SP/a1_watchdog.tsv"
STALL_SEC=900
[ -f "$TSV" ] || echo -e "시각(KST)\t상태\t살았나\t로그줄\t누적줄\t로그멈춘초\t비고" > "$TSV"

launch() {
  cd "$LEGAL" || exit 1
  setsid nohup python3 _dashboard/loop/admrul_fresh.py \
      --out "$OUT" --progress "$PROG" --resume "$PROG" \
      >> "$LOG" 2>&1 < /dev/null &
}

while true; do
  NOW=$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M:%S')
  if pgrep -f "admrul_fresh.py --out $OUT" > /dev/null; then ALIVE=1; else ALIVE=0; fi
  LINES=$(grep -cE '^\[[0-9]+/[0-9]+\]' "$LOG" 2>/dev/null || echo 0)
  JL=$(wc -l < "$PROG" 2>/dev/null || echo 0)
  if [ -f "$LOG" ]; then AGE=$(( $(date +%s) - $(stat -c %Y "$LOG") )); else AGE=-1; fi

  if [ -f "$OUT" ]; then
    echo -e "$NOW\tDONE\t$ALIVE\t$LINES\t$JL\t$AGE\t산출물 생김 — 감시 종료" >> "$TSV"
    exit 0
  fi
  if [ "$ALIVE" = "0" ]; then
    echo -e "$NOW\tDEAD\t0\t$LINES\t$JL\t$AGE\t프로세스 없음 — 이어받아 재시작" >> "$TSV"
    launch; sleep 20; continue
  fi
  if [ "$AGE" -ge "$STALL_SEC" ]; then
    echo -e "$NOW\tSTALL\t1\t$LINES\t$JL\t$AGE\t로그가 ${AGE}초째 안 늚 — 죽이고 이어받아 재시작" >> "$TSV"
    pkill -f "admrul_fresh.py --out $OUT"; sleep 5; launch; sleep 20; continue
  fi
  echo -e "$NOW\tOK\t1\t$LINES\t$JL\t$AGE\t" >> "$TSV"
  sleep 60
done
