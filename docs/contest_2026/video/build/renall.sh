#!/bin/bash
# 사용: renall.sh <page.html> <outdir> <총프레임>  — 3구간 병렬 렌더 후 목록 파일
P=$1; O=$2; N=$3; mkdir -p $O; export NODE_PATH=$(npm root -g)
A=$((N/3)); B2=$((2*N/3))
node render.js $P frames 0 $A $O/a.mp4 > $O/a.log 2>&1 &
node render.js $P frames $A $B2 $O/b.mp4 > $O/b.log 2>&1 &
node render.js $P frames $B2 $N $O/c.mp4 > $O/c.log 2>&1 &
node render.js $P cues $O/cues.json
wait
printf "file 'a.mp4'\nfile 'b.mp4'\nfile 'c.mp4'\n" > $O/list.txt
python3 glitch.py $O/list.txt | head -1
