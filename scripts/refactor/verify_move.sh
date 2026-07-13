#!/usr/bin/env bash
# ============================================================================
# 파일명: scripts/refactor/verify_move.sh
# 역할  : [V1 이동 무결성] 지정 커밋 범위의 변경이 "내용 무변경 순수 이동"인지
#         검사한다. rename(R100) 과 index.html 계열 경로 수정 외의 변경이
#         있으면 실패 — 대원칙 "이동 ≠ 수정"의 기계적 검증.
# 사용  : bash scripts/refactor/verify_move.sh [기준커밋]   (기본: HEAD~1)
# ============================================================================
set -euo pipefail
BASE="${1:-HEAD~1}"

# 허용 목록: 이동의 물리적 결과로 수정될 수밖에 없는 파일 (§13.1 유일한 예외)
ALLOW_MODIFY_RE='^(local_server/index2\.html|local_server/sw\.js|client/index\.html|client/sw\.js|scripts/refactor/)'

echo "[verify_move] 검사 범위: ${BASE}..HEAD"
VIOLATIONS=0

while IFS=$'\t' read -r status f1 f2; do
    case "$status" in
        R100) ;; # 내용 100% 동일한 순수 이동 — 통과
        R*)
            echo "  ❌ 내용이 바뀐 이동(R<100): $f1 → $f2"
            VIOLATIONS=$((VIOLATIONS+1)) ;;
        M)
            if [[ "$f1" =~ $ALLOW_MODIFY_RE ]]; then
                echo "  ⚠ 허용된 수정(경로 갱신): $f1"
            else
                echo "  ❌ 이동 커밋에 코드 수정 포함: $f1"
                VIOLATIONS=$((VIOLATIONS+1))
            fi ;;
        A)
            if [[ "$f1" =~ $ALLOW_MODIFY_RE ]] || [[ "$f1" == *.md ]]; then
                echo "  ⚠ 허용된 추가(문서/도구): $f1"
            else
                echo "  ❌ 이동 커밋에 신규 파일 포함: $f1"
                VIOLATIONS=$((VIOLATIONS+1))
            fi ;;
        D)
            echo "  ❌ 이동 커밋에 삭제 포함: $f1"
            VIOLATIONS=$((VIOLATIONS+1)) ;;
    esac
done < <(git diff --name-status -M100 "${BASE}..HEAD")

if [ "$VIOLATIONS" -gt 0 ]; then
    echo "[verify_move] ❌ 실패 — 위반 ${VIOLATIONS}건. 순수 이동이 아닙니다."
    exit 1
fi
echo "[verify_move] ✅ 통과 — 모든 변경이 순수 이동(R100) + 허용된 경로 갱신뿐"
