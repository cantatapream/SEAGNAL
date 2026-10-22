#!/bin/bash
# 영상 제작 준비: 캡처 복사(영문 이름) · 글꼴 · 효과음 · 지도 자료. build 폴더 안에서 실행.
set -e
I=../../images
mkdir -p assets fonts sfx data out
c() { cp "$I/$1" "assets/$2"; }
c S09-1_특보정보탭.png s09_1.png; c S09-2_해양종합정보탭.png s09_2.png; c S09-3_해양안전_사고분석.png s09_3.png; c S09-4_해양생활_바다낚시.png s09_4.png
c S09-5_공지사항_전체.png s09_5.png; c S12-2_특보구역카드_전체화면.png s12_2.png; c S13-1_특보알림_전체.png s13_1.png; c S13-3_안전권고팝업_발표.png s13_3.png
c S14-1_챗봇답변_크롭.png s14_1.png; c S18-6_특보구역색칠.png s18_6.png; c S19-1_해점정보.png s19_1.png; c S19-3_해점정보_합본.png s19_3.png
c S20-1_태풍_기상청.png s20_1.png; c S20-2_태풍_JMA.png s20_2.png; c S26-2_설정_관심해역.png s26_2.png; c S26-3_설정_푸시알림.png s26_3.png
c S26-4_설정_기타_글자크기.png s26_4.png; c S31-2_연안_바텀시트_영도.png s31_2.png; c S32_지도_연안만.png s32_c.png; c S33-1_브리핑_총평_PC.png s33_1.png
c S33-2_브리핑_관광지카드.png s33_2.png; c S33-3_브리핑_관할설정.png s33_3.png; c S_판포포구_위험예측_위.png pp_top.png; c S_판포포구_위험예측_아래.png pp_bot.png
for i in 1 2 3 4 5 6; do c V_챗봇답변_0$i.jpg v0$i.jpg; done
python3 stitch_chat.py
# 글꼴(Pretendard 1.3.9 · Archivo · Geist Mono — npm 패키지에서)
T=$(mktemp -d); (cd $T && npm pack pretendard@1.3.9 @fontsource-variable/archivo@5 geist@1 >/dev/null && for f in *.tgz; do mkdir -p ${f%.tgz}; tar xzf $f -C ${f%.tgz}; done)
cp $T/pretendard-1.3.9/package/dist/public/static/Pretendard-{ExtraBold,Bold,SemiBold,Medium,Regular}.otf fonts/
cp $T/fontsource-variable-archivo-*/package/files/archivo-latin-standard-normal.woff2 fonts/archivo.woff2
cp $T/geist-*/package/dist/fonts/geist-mono/GeistMono-{Regular,SemiBold}.woff2 fonts/
python3 make_sfx.py sfx click pop typing notify
# 지도 자료(origin/main) — data/map.js 는 이미 커밋돼 있어 다시 만들 때만 필요
# git show origin/main:client/land_mask_korea.json > data/land_mask_korea.json  (그 밖 mapdata.py 머리말 참고)
echo 준비 끝
