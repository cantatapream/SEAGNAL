#!/usr/bin/env bash
# dl_byl_images.sh — 별표/조문 이미지(<img id="N">) 원본을 law.go.kr에서 내려받아 보존한다.
# 역할(초보자용): 기술기준 원문 txt 안에 <img id="숫자">로 박힌 표·산식·도해 이미지를,
#   law.go.kr flDownload.do?flSeq=<숫자>로 받아 각 원문 폴더의 _이미지/<숫자>.png 로 저장한다.
#   ①도해·그림은 챗봇 표시용 원본 보존 ②표·수치는 다음 단계(비전 OCR)의 입력.
# [연계] 입력 raw/**/행정규칙/*.txt(<img id>) · 출력 같은 폴더 _이미지/<id>.png · 다음단계 byl_ocr_cell(비전)
# 사용법: bash dl_byl_images.sh "<파일glob 또는 파일목록파일>"  (인자 없으면 기술기준 전체)
set -u
ROOT="/home/user/SEAGNAL/local_server/knowledge/legal"
cd "$ROOT" || exit 1

# 대상 파일: 인자로 파일 목록을 받거나, 기본=기술기준(설비·구조·기관·만재흘수·복원성·방화)
if [ $# -ge 1 ] && [ -f "$1" ]; then
  mapfile -t FILES < "$1"
else
  mapfile -t FILES < <(grep -rl '<img id=' raw --include='*.txt' 2>/dev/null \
    | grep -E '설비기준|구조기준|구조및설비|기관기준|만재흘수|복원성기준|방화구조|규격및시설')
fi

dl_one() { # $1=id  $2=outdir
  local id="$1" out="$2/$1.png" gif="$2/$1.gif"
  [ -s "$out" ] && return 0            # 이미 있으면 skip
  curl -s -o "$gif" --max-time 30 "https://www.law.go.kr/LSW/flDownload.do?flSeq=${id}" 2>/dev/null
  [ -s "$gif" ] || { echo "FAIL_DL $id"; return 1; }
  python3 -c "from PIL import Image;Image.open('$gif').convert('RGB').save('$out')" 2>/dev/null \
    || { echo "FAIL_CONV $id"; rm -f "$gif"; return 1; }
  rm -f "$gif"
  return 0
}
export -f dl_one

tot=0; ok=0; fail=0
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  dir="$(dirname "$f")/_이미지"
  mkdir -p "$dir"
  ids=$(grep -o '<img id="[0-9]*"' "$f" | grep -o '[0-9]*' | sort -u)
  n=$(echo "$ids" | grep -c '[0-9]')
  echo "── $(basename "$f"): 고유 $n개"
  for id in $ids; do
    tot=$((tot+1))
    if dl_one "$id" "$dir"; then ok=$((ok+1)); else fail=$((fail+1)); fi
  done
done
echo "════ 다운로드 완료: 시도 $tot · 성공 $ok · 실패 $fail ════"
