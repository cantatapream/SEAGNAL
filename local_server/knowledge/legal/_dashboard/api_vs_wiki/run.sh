#!/usr/bin/env bash
# run.sh — 위키 vs 법제처 API 비교 실험을 **임시 작업 사본** 안에서 돌린다.
#
# [왜 사본인가] A 방식(지금 챗봇)은 돌면서 파일을 쓴다 — 지식 후보 큐(_candidates/queue.jsonl),
#   오래 걸린 답변 보관(data/pending_answers.json), 설정(data/nariya_config.json). 이 저장소
#   작업본에 쓰이면 커밋에 섞이거나 남의 작업과 엉킬 수 있어, 지금 커밋(HEAD) 그대로의 사본을
#   따로 만들어 그 안에서만 돌리고, 끝나면 사본째 지운다. 결과(JSONL)만 이 폴더 results/ 로 나온다.
# [운영 영향 없음] 운영 서버(fly.dev)를 부르지 않는다. 앱 코드를 고치지 않는다.
#
# 사용: bash run.sh pilot            # 시험 10문항 × A·B·C
#       bash run.sh main             # 본실험 40문항 × A·B·C
#       ARMS="c" bash run.sh pilot   # 특정 방식만
#       ONLY="법률-04,시행령-03" bash run.sh rest   # 고른 문항만
#       AVW_TRACE=1 LLM=luna …       # 루나에게 보낸 글·받은 글을 <방식>.trace.jsonl 로 남긴다(원인 조사용)
#       LLM=luna bash run.sh pilot   # ★GPT 루나(ChatGPT 정액제, Codex CLI)로 — codex 가 로그인된 VM 에서만
# 필요: Gemini 는 환경변수 GEMINI_API_KEY_26_8. 루나는 `codex` 명령(로그인돼 있어야 한다).
#   루나 모드는 실험 전용 비밀을 매번 새로 만들고, 실험 전용 작업자(avw_worker.js)가 이 실험 서버에만 붙는다 —
#   운영 서버·운영 작업자(nrya-codex-worker)는 건드리지 않는다.
set -euo pipefail
SET="${1:-pilot}"
ARMS="${ARMS:-a b c}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HERE" rev-parse --show-toplevel)"
REL="${HERE#$REPO/}"
TREE="${AVW_TREE:-${TMPDIR:-/tmp}/avw_tree_$$}"
STAMP="$(TZ=Asia/Seoul date +%Y%m%d_%H%M)"
LLM="${LLM:-gemini}"
OUTDIR="$HERE/results/${SET}_${STAMP}$([ "$LLM" = luna ] && echo _luna || true)"

if [ "$LLM" = luna ]; then
  command -v "${CODEX_BIN:-codex}" >/dev/null || { echo "codex 명령이 없다 — 루나 모드는 codex 가 로그인된 VM 에서 돌린다." >&2; exit 3; }
  export AVW_LLM=luna
  export NRYA_CODEX_SECRET="$(python3 -c 'import secrets;print(secrets.token_hex(24))')"   # 실험 전용, 매번 새로
  unset GEMINI_API_KEY_26_8 GEMINI_API_KEY   # 루나 결과에 Gemini 답이 새어 들지 않게 키를 아예 뺀다
elif [ -z "${GEMINI_API_KEY_26_8:-}" ]; then
  echo "GEMINI_API_KEY_26_8 가 없다 — README 「키 넣기」를 보라." >&2; exit 3
fi
[ -d "$REPO/local_server/node_modules" ] || (cd "$REPO/local_server" && npm ci --no-audit --no-fund)

echo "[사본] $TREE (HEAD $(git -C "$REPO" rev-parse --short HEAD))"
git -C "$REPO" worktree add --detach "$TREE" HEAD >/dev/null
cleanup() { git -C "$REPO" worktree remove --force "$TREE" >/dev/null 2>&1 || true; }
trap cleanup EXIT
ln -s "$REPO/local_server/node_modules" "$TREE/local_server/node_modules"
# 실험 장치 자체는 지금 작업본의 것을 쓴다(아직 커밋 안 한 수정도 시험할 수 있게). 앱 코드는 HEAD 그대로다.
mkdir -p "$TREE/$REL" && cp "$HERE"/*.js "$HERE"/questions.json "$TREE/$REL/"
mkdir -p "$TREE/local_server/data"
python3 -c "import json,sys;d=json.load(open(sys.argv[1]));d.pop('_note',None);d.update({'answerModel':'gpt-6-luna','codexForUsers':True} if sys.argv[3]=='luna' else {});json.dump(d,open(sys.argv[2],'w'))" \
  "$HERE/prod_config.json" "$TREE/local_server/data/nariya_config.json" "$LLM"
# 2차 원문 직독 경로는 토큰이 있어야 켜진다(github_raw.hasToken). 사본에는 원문(raw/)이 그대로 있어
# 디스크에서 먼저 읽으므로, 실제 GitHub 호출은 일어나지 않는다 — 켜기만 하는 자리표시 값이다.
export GITHUB_RAW_TOKEN="${GITHUB_RAW_TOKEN:-local-disk-only}"

mkdir -p "$OUTDIR"
for ARM in $ARMS; do
  echo "== 방식 $ARM =="
  (cd "$TREE/local_server" && node "$TREE/$REL/run_arms.js" --arm "$ARM" --set "$SET" --out "$OUTDIR/$ARM.jsonl" ${ONLY:+--only "$ONLY"})
done
python3 "$HERE/score.py" "$OUTDIR" | tee "$OUTDIR/score.txt"
echo "결과: $OUTDIR"
