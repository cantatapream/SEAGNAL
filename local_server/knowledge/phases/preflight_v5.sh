#!/usr/bin/env bash
# preflight_v5.sh — v5 자유변칙 측정(440 케이스) 사전점검 (C1~C5 자동화)
# 출처: v5_measurement_synthesis.md §1 / v5_measurement_frame_A.md §1
#
# 사용:
#   bash knowledge/phases/preflight_v5.sh           # 모든 체크 수행
#   bash knowledge/phases/preflight_v5.sh --skip-c5 # C5(평가셋 N=3) 생략 (시간 절약, 비권장)
#   bash knowledge/phases/preflight_v5.sh --quiet   # PASS 라인 생략
#
# 종료 코드: 0 = 모두 PASS, 1 = 어느 C 실패. exit code 로 run_v5.sh 가 분기.
# 환경 변수: PORT(기본 3001), SEAGNAL_ROOT(자동 검출).

set -u  # 변수 미정 차단. set -e 는 의도적 미사용(실패시에도 보고 후 종료).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_SERVER="$(cd "$SCRIPT_DIR/../.." && pwd)"      # .../SEAGNAL/local_server
SEAGNAL_ROOT="${SEAGNAL_ROOT:-$(cd "$LOCAL_SERVER/.." && pwd)}"
PORT="${PORT:-3001}"
SKIP_C5=0; QUIET=0
for a in "$@"; do
  case "$a" in
    --skip-c5) SKIP_C5=1 ;;
    --quiet)   QUIET=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  esac
done

# ---- 헬퍼 -------------------------------------------------------------
RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; RST=$'\033[0m'
FAIL_CODES=""   # 실패한 C 라벨 누적 (예: " C2 C5")
log_pass() { [ "$QUIET" = "1" ] || printf "%sPASS%s  %-3s %s\n" "$GRN" "$RST" "$1" "$2"; }
log_warn() { printf "%sWARN%s  %-3s %s\n" "$YLW" "$RST" "$1" "$2"; }
log_fail() { printf "%sFAIL%s  %-3s %s\n" "$RED" "$RST" "$1" "$2"; FAIL_CODES="$FAIL_CODES $1"; }
hdr()      { printf "\n=== %s ===\n" "$1"; }

# 파일 크기(byte). stat -c (GNU) / -f%z (BSD) 양립.
fsize() { stat -c%s "$1" 2>/dev/null || stat -f%z "$1" 2>/dev/null || echo 0; }
# mtime → 현재 시각 차(초). 없으면 9999999.
fage()  {
  local t; t="$(stat -c%Y "$1" 2>/dev/null || stat -f%m "$1" 2>/dev/null || echo 0)"
  [ "$t" = "0" ] && { echo 9999999; return; }
  echo $(( $(date +%s) - t ))
}

cd "$LOCAL_SERVER" || { echo "cannot cd $LOCAL_SERVER"; exit 1; }
hdr "v5 preflight — $(date -u +%FT%TZ) (root=$LOCAL_SERVER port=$PORT)"

# ---- C1: 서버 health -------------------------------------------------
hdr "C1 local server health"
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
H_BODY="$(curl -s --max-time 5 "$HEALTH_URL" 2>/dev/null)"
H_CODE="$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' "$HEALTH_URL" 2>/dev/null)"
if [ "$H_CODE" = "200" ] && printf '%s' "$H_BODY" | grep -q '"ok"\s*:\s*true'; then
  log_pass C1 "health 200 + ok:true"
else
  log_fail C1 "health code=$H_CODE body=$(printf '%s' "$H_BODY" | head -c 80)"
fi

# ---- C2: marine.kma 데이터 적재 --------------------------------------
hdr "C2 marine.kma data freshness"
# 실제 경로: local_server/data/marine_{buoys,vs,wh_buoys}.json (services/cache_manager.js L77-80)
C2_OK=1
for f in data/marine_buoys.json data/marine_vs.json data/marine_wh_buoys.json; do
  if [ ! -f "$f" ]; then
    log_fail C2 "missing $f"
    C2_OK=0; continue
  fi
  sz="$(fsize "$f")"
  age="$(fage "$f")"
  if [ "$sz" -lt 1024 ]; then
    log_fail C2 "$f size=${sz}B < 1KB"; C2_OK=0
  elif [ "$age" -gt 86400 ]; then
    log_warn C2 "$f age=${age}s > 24h (stale; 적재잡 권장)"
    # 24h 초과는 SOP 상 합격 기준 미달 → FAIL 처리
    log_fail C2 "$f mtime > 24h"; C2_OK=0
  else
    [ "$QUIET" = "1" ] || printf "      %s  size=%sB age=%ss\n" "$f" "$sz" "$age"
  fi
done
[ "$C2_OK" = "1" ] && log_pass C2 "marine 3 files ≥ 1KB & mtime ≤ 24h"

# ---- C3: 임베딩 캐시 hit ---------------------------------------------
hdr "C3 embedding cache"
# 실제 경로: knowledge/graph/{topic,tool}_embeddings.json (services/topic_embedding.js L27,171)
C3_OK=1
TOPIC_F="knowledge/graph/topic_embeddings.json"
TOOL_F="knowledge/graph/tool_embeddings.json"
for f in "$TOPIC_F" "$TOOL_F"; do
  if [ ! -f "$f" ]; then
    log_fail C3 "missing $f"; C3_OK=0
  fi
done
if [ "$C3_OK" = "1" ]; then
  # topic 수 169, tool 수 19~20 기대
  TN=$(python3 -c "import json,sys;d=json.load(open('$TOPIC_F'));print(len(d.get('topics',[])))" 2>/dev/null || echo 0)
  TL=$(python3 -c "import json,sys;d=json.load(open('$TOOL_F'));print(len(d.get('tools',[])))" 2>/dev/null || echo 0)
  if [ "$TN" -ne 169 ]; then
    log_warn C3 "topics=$TN (expected 169) — 그래프 변경 시 정상, 측정 메타에 기록"
  fi
  if [ "$TL" -lt 19 ] || [ "$TL" -gt 22 ]; then
    log_warn C3 "tools=$TL (expected 19~20)"
  fi
  if [ "$TN" -ge 100 ] && [ "$TL" -ge 15 ]; then
    log_pass C3 "topic=$TN tool=$TL"
  else
    log_fail C3 "topic=$TN tool=$TL — 캐시 비어있음 의심"
  fi
fi

# ---- C4: 직군 임계표 로드 --------------------------------------------
hdr "C4 jikgun thresholds"
TH_F="knowledge/jikgun/_thresholds.json"
if [ ! -f "$TH_F" ]; then
  log_fail C4 "missing $TH_F"
else
  # 8 직군 + _default = 9 키 기대 (실측 확인)
  KEYS=$(python3 -c "
import json,sys
d=json.load(open('$TH_F'))
need=['fishery','angler','marine_leisure','coast_guard','navy','mof','local_gov','public_org']
j=d.get('jikgun',{})
miss=[k for k in need if k not in j]
print(len(j), ','.join(miss) if miss else 'ALL_OK')
" 2>/dev/null)
  CNT=$(echo "$KEYS" | awk '{print $1}')
  MISS=$(echo "$KEYS" | awk '{print $2}')
  if [ "$MISS" = "ALL_OK" ] && [ "${CNT:-0}" -ge 9 ]; then
    log_pass C4 "9 jikgun keys (8 직군 + _default)"
  else
    log_fail C4 "missing=$MISS count=$CNT"
  fi
fi

# ---- C5: 평가셋 무회귀 (N=3) -----------------------------------------
hdr "C5 baseline eval N=3"
if [ "$SKIP_C5" = "1" ]; then
  log_warn C5 "skipped (--skip-c5) — 자유변칙 측정 판정 권한 약화"
else
  # 인자 처리: 본 러너는 --n=3 형태(L90) 지원.
  C5_OUT="/tmp/v5_preflight_c5_$(date +%Y%m%d_%H%M%S).log"
  ( cd "$LOCAL_SERVER" && timeout 600 python3 -u knowledge/phases/phase2b_eval_runner.py --n=3 ) > "$C5_OUT" 2>&1
  C5_RC=$?
  PASS_LINE=$(grep -Eo 'PASS [0-9]+/[0-9]+' "$C5_OUT" | tail -1)
  if [ "$C5_RC" = "0" ] && echo "$PASS_LINE" | grep -qE '^PASS (10/10|[1-9][0-9]?/\1)$' ; then
    log_pass C5 "$PASS_LINE  (log=$C5_OUT)"
  else
    # 10/10 외 조합도 보고
    log_fail C5 "rc=$C5_RC ${PASS_LINE:-no-pass-line} (log=$C5_OUT)"
  fi
fi

# ---- 보조 점검 (FAIL 아님, 메타로만 기록) ----------------------------
hdr "AUX inputs"
JSONL="knowledge/phases/phase2b_eval_freevar.jsonl"
if [ -f "$JSONL" ]; then
  LN=$(wc -l < "$JSONL" | tr -d ' ')
  if [ "$LN" = "440" ]; then
    log_pass AUX "phase2b_eval_freevar.jsonl lines=440"
  else
    log_warn AUX "phase2b_eval_freevar.jsonl lines=$LN (expected 440)"
  fi
else
  log_fail AUX "missing $JSONL"
fi
RUNNER="knowledge/phases/phase2b_eval_freevar_runner.py"
if [ -f "$RUNNER" ]; then
  SHA="$(git -C "$SEAGNAL_ROOT" log -1 --format=%h -- "$LOCAL_SERVER/$RUNNER" 2>/dev/null || echo n/a)"
  log_pass AUX "runner SHA=$SHA"
fi
# Gemini key / 외부 키 존재만 확인 (값 미노출)
for k in GEMINI_API_KEY KMA_DMDW_USER_ID KMA_DMDW_PWD TIDEBED_KEY; do
  if [ -n "${!k:-}" ]; then
    [ "$QUIET" = "1" ] || printf "      env %s set\n" "$k"
  else
    log_warn AUX "env $k unset — 가드만으로 거짓 PASS 위험"
  fi
done

# ---- 결과 -------------------------------------------------------------
hdr "RESULT"
if [ -z "$FAIL_CODES" ]; then
  printf "%sALL PASS%s — v5 측정 가동 가능. run_v5.sh 실행 권장.\n" "$GRN" "$RST"
  exit 0
else
  printf "%sFAIL%s — 실패 항목:%s\n" "$RED" "$RST" "$FAIL_CODES"
  printf "조치: C1 서버 재기동 / C2 marine 적재잡 / C3 임베딩 warmup / C4 임계표 복구 / C5 골든 회귀.\n"
  printf "재시도: bash knowledge/phases/preflight_v5.sh\n"
  exit 1
fi
