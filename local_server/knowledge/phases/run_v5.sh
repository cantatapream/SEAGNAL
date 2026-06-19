#!/usr/bin/env bash
# run_v5.sh — v5 자유변칙 측정 실행 자동화 (preflight → BG 가동 → 모니터링 → 자동 복구)
# 출처: v5_measurement_synthesis.md §2~§3 / v5_measurement_frame_A.md §2~§3
#
# 사용:
#   bash knowledge/phases/run_v5.sh                # 표준 가동 (preflight 통과시)
#   bash knowledge/phases/run_v5.sh --no-preflight # preflight 스킵 (긴급)
#   bash knowledge/phases/run_v5.sh --auto-restart # 서버 죽음 검출 시 1회 자동 재시작 + 재가동
#   bash knowledge/phases/run_v5.sh --dry-run      # 명령만 출력, 실행 안 함
#
# 동작:
#   1) preflight_v5.sh 호출 (PASS → 진행, FAIL → 중단)
#   2) /tmp/freevar.log 이전 로그 타임스탬프 백업
#   3) nohup background 가동 + PID 저장 + disown
#   4) 측정 메타 캡처 (/tmp/freevar_meta.txt)
#   5) 폴링: 30초 헤더 / 5분 stall / 60분 timeout / 케이스 라인 진행률
#   6) (옵션) 서버 5xx/hang 감지시 서버 재가동 → 측정 재시작 (1회 한정)
#   7) 종합 블록 등장시 종료 + 결과 요약 한 줄
#
# 환경 변수: PORT(기본 3001), POLL_INTERVAL_S(기본 30), STALL_LIMIT_S(기본 300),
#            MAX_RUN_S(기본 3900 = 65분), SERVER_START_CMD(자동 재시작 시 사용)

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SERVER="$(cd "$SCRIPT_DIR/../.." && pwd)"
SEAGNAL_ROOT="${SEAGNAL_ROOT:-$(cd "$LOCAL_SERVER/.." && pwd)}"
PORT="${PORT:-3001}"
POLL_INTERVAL_S="${POLL_INTERVAL_S:-30}"
STALL_LIMIT_S="${STALL_LIMIT_S:-300}"
MAX_RUN_S="${MAX_RUN_S:-3900}"
SERVER_START_CMD="${SERVER_START_CMD:-cd $LOCAL_SERVER && nohup node server.js > /tmp/local_server.log 2>&1 &}"

NO_PREFLIGHT=0; AUTO_RESTART=0; DRY=0
for a in "$@"; do
  case "$a" in
    --no-preflight) NO_PREFLIGHT=1 ;;
    --auto-restart) AUTO_RESTART=1 ;;
    --dry-run)      DRY=1 ;;
    -h|--help)      sed -n '2,20p' "$0"; exit 0 ;;
  esac
done

LOG=/tmp/freevar.log
PIDF=/tmp/freevar.pid
META=/tmp/freevar_meta.txt
TS() { date -u +%FT%TZ; }
say() { printf "[%s] %s\n" "$(TS)" "$*"; }

cd "$LOCAL_SERVER" || { echo "cannot cd $LOCAL_SERVER"; exit 1; }

# ---- 1) preflight ----------------------------------------------------
if [ "$NO_PREFLIGHT" = "0" ]; then
  say "preflight 시작…"
  if [ "$DRY" = "1" ]; then
    say "DRY: bash knowledge/phases/preflight_v5.sh"
  else
    bash "$SCRIPT_DIR/preflight_v5.sh"
    RC=$?
    if [ "$RC" != "0" ]; then
      say "preflight FAIL(rc=$RC) — 측정 중단. 항목 조치 후 재실행."
      exit 1
    fi
  fi
  say "preflight PASS"
else
  say "preflight 스킵 (--no-preflight)"
fi

# ---- 2) 이전 로그 보존 -----------------------------------------------
if [ -f "$LOG" ]; then
  BAK="/tmp/freevar_prev_$(date +%Y%m%d_%H%M%S).log"
  if [ "$DRY" = "1" ]; then
    say "DRY: mv -f $LOG $BAK"
  else
    mv -f "$LOG" "$BAK"
    say "이전 로그 보존: $BAK"
  fi
fi

# ---- 3) BG 가동 ------------------------------------------------------
start_runner() {
  if [ "$DRY" = "1" ]; then
    say "DRY: nohup python3 -u knowledge/phases/phase2b_eval_freevar_runner.py > $LOG 2>&1 &"
    echo 99999 > "$PIDF"
    return
  fi
  nohup python3 -u knowledge/phases/phase2b_eval_freevar_runner.py > "$LOG" 2>&1 &
  echo $! > "$PIDF"
  disown
  say "러너 가동 PID=$(cat "$PIDF") LOG=$LOG"
}
start_runner

# ---- 4) 메타 캡처 ----------------------------------------------------
capture_meta() {
  {
    echo "=== v5 measurement meta ==="
    date -u +"start_utc=%Y-%m-%dT%H:%M:%SZ"
    echo "git_head=$(git -C "$SEAGNAL_ROOT" rev-parse HEAD 2>/dev/null || echo n/a)"
    echo "dirty:"
    git -C "$SEAGNAL_ROOT" status --porcelain 2>/dev/null | head -20
    echo "pid=$(cat "$PIDF" 2>/dev/null)"
    echo "port=$PORT"
  } > "$META"
  say "메타 캡처 → $META"
}
[ "$DRY" = "0" ] && capture_meta

# ---- 5) 폴링 ---------------------------------------------------------
START=$(date +%s)
LAST_PROGRESS_AT=$START
LAST_N=-1
RESTART_USED=0

server_alive() {
  curl -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:${PORT}/api/health" 2>/dev/null | grep -q '^200$'
}

current_progress() {
  # 진행률 헬퍼 (synthesis §3.6 변형). 마지막 [n/440] 라인 추출.
  awk '/^  \[[0-9]+\/440\]/ {n=$1; t=$3}
       END {if(n!=""){gsub(/[\[\]\/440]/,"",n); gsub(/s/,"",t); printf "%s|%s", n, t}}' "$LOG" 2>/dev/null
}

last_done_block() {
  # 종합 PASS 블록 등장 여부
  grep -qE '종합 PASS|====\s*종합' "$LOG" 2>/dev/null
}

header_seen() {
  grep -q '=== Phase 2b' "$LOG" 2>/dev/null
}

abort_runner() {
  local pid; pid="$(cat "$PIDF" 2>/dev/null)"
  if [ -n "${pid:-}" ] && kill -0 "$pid" 2>/dev/null; then
    say "러너 종료 시도 PID=$pid"
    kill -TERM "$pid" 2>/dev/null
    sleep 5
    kill -0 "$pid" 2>/dev/null && kill -KILL "$pid" 2>/dev/null
  fi
}

# 폴링 루프
say "모니터링 시작 (poll=${POLL_INTERVAL_S}s stall=${STALL_LIMIT_S}s max=${MAX_RUN_S}s)"
if [ "$DRY" = "1" ]; then
  say "DRY: 폴링 생략"
  exit 0
fi

while :; do
  NOW=$(date +%s)
  ELAPSED=$(( NOW - START ))

  # (a) 종료 조건: 종합 블록
  if last_done_block; then
    say "종합 블록 감지 — 측정 완료. 경과 ${ELAPSED}s"
    tail -n 30 "$LOG" | grep -E '종합|p50|p95|평균|직군' | head -20
    # 영구 보관본 권장 위치만 안내 (synthesis §8.2)
    say "보관 권장: cp $LOG knowledge/phases/freevar_v5.log; cp $META knowledge/phases/freevar_v5_meta.txt"
    exit 0
  fi

  # (b) 가동 직후 30초 헤더 없음 → 즉시 종료
  if [ "$ELAPSED" -lt 60 ] && [ "$ELAPSED" -gt 30 ] && ! header_seen; then
    say "헤더 미출력 30s — 서버/EVAL 경로 의심. 종료."
    abort_runner; exit 2
  fi

  # (c) 60분 초과
  if [ "$ELAPSED" -gt "$MAX_RUN_S" ]; then
    say "MAX_RUN_S=${MAX_RUN_S}s 초과 — 강제 종료 (외부 의존성 장애 의심)."
    abort_runner; exit 3
  fi

  # (d) 진행률 추출
  P="$(current_progress)"
  if [ -n "$P" ]; then
    N=$(echo "$P" | cut -d'|' -f1)
    T=$(echo "$P" | cut -d'|' -f2)
    if [ "$N" != "$LAST_N" ]; then
      LAST_N="$N"
      LAST_PROGRESS_AT=$NOW
      ETA="?"
      if [ "${N:-0}" -gt 0 ]; then
        ETA=$(awk -v n="$N" -v t="$T" 'BEGIN{printf "%.0f", (440-n)*t/n}')
      fi
      say "진행 ${N}/440 elapsed_runner=${T}s eta=${ETA}s wall=${ELAPSED}s"
    fi
  fi

  # (e) stall 검사 (마지막 진행 후 STALL_LIMIT_S 초 무진행)
  IDLE=$(( NOW - LAST_PROGRESS_AT ))
  if [ "$IDLE" -gt "$STALL_LIMIT_S" ] && [ "$ELAPSED" -gt 60 ]; then
    say "stall ${IDLE}s — 서버 hang/timeout 의심."
    if [ "$AUTO_RESTART" = "1" ] && [ "$RESTART_USED" = "0" ]; then
      RESTART_USED=1
      abort_runner
      if ! server_alive; then
        say "서버 사망 — 자동 재가동 시도 ($SERVER_START_CMD)"
        bash -c "$SERVER_START_CMD"
        # 헬스 회복 대기 (최대 30s)
        for i in 1 2 3 4 5 6; do
          sleep 5
          server_alive && break
        done
      fi
      if server_alive; then
        say "서버 복구 OK — 러너 재시작 (1회 한정)"
        mv -f "$LOG" "/tmp/freevar_aborted_$(date +%Y%m%d_%H%M%S).log"
        start_runner
        capture_meta
        START=$(date +%s); LAST_PROGRESS_AT=$START; LAST_N=-1
        continue
      else
        say "서버 복구 실패 — 측정 중단."
        exit 4
      fi
    else
      say "자동 재시작 비활성 또는 이미 사용됨 — 중단."
      abort_runner; exit 5
    fi
  fi

  # (f) 서버 사망 직접 감지 (옵션)
  if ! server_alive; then
    say "헬스 실패 — 서버 죽음 의심."
    if [ "$AUTO_RESTART" = "1" ] && [ "$RESTART_USED" = "0" ]; then
      RESTART_USED=1
      abort_runner
      say "서버 자동 재가동 ($SERVER_START_CMD)"
      bash -c "$SERVER_START_CMD"
      for i in 1 2 3 4 5 6; do sleep 5; server_alive && break; done
      if server_alive; then
        mv -f "$LOG" "/tmp/freevar_aborted_$(date +%Y%m%d_%H%M%S).log"
        start_runner; capture_meta
        START=$(date +%s); LAST_PROGRESS_AT=$START; LAST_N=-1
        continue
      fi
      say "서버 복구 실패."
      exit 4
    else
      abort_runner; exit 5
    fi
  fi

  # (g) 러너 프로세스 죽음
  RPID=$(cat "$PIDF" 2>/dev/null)
  if [ -n "${RPID:-}" ] && ! kill -0 "$RPID" 2>/dev/null; then
    # 진행률 마지막 확인. 종합 블록 없으면 비정상 종료.
    if last_done_block; then
      say "러너 종료 + 종합 블록 — 정상 완료."
      exit 0
    else
      say "러너 PID=$RPID 사망 + 종합 블록 없음 — 비정상."
      tail -n 30 "$LOG"
      exit 6
    fi
  fi

  sleep "$POLL_INTERVAL_S"
done
