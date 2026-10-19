# 공모전 첨부 영상 3편 — 제작 코드

기획: `../SEAGNAL_영상_최종기획안.md` (11절이 최종 결정). 사용자 피드백(2026-10-19)으로 바뀐 점:
1편 문제 장면은 질문이 파출소로 쏟아지게, 30~48초는 「기능 8개 × 2초」 투어, 2·3편은 장면마다 카메라 확대·이동,
배경음은 Mixkit 곡 대신 **직접 합성**(음향감독 에이전트, 박자표는 기획안 3절과 같음).

## 순서
```bash
cd docs/contest_2026/video/build
./setup.sh                                   # 캡처 복사·챗봇 띠 잇기·글꼴·효과음
./renall.sh ep1.html out/ep1 4020            # 프레임 렌더(60fps, 3구간 병렬) → out/ep1/list.txt
python3 mix.py out/ep1/cues.json out/ep1/mix.wav <배경음 ep1.wav> 0.05
python3 encode.py out/ep1/list.txt out/ep1/mix.wav out/SEAGNAL_영상1.mp4   # -14 LUFS · 2-pass · 19,900,000바이트 확인
```
2편 2436프레임(40.6초), 3편 3510프레임(58.5초).

## 파일
- `engine.js` 스프링·마스크 글·커서·조리개·숫자 굴림·리퀴드 글라스 / `common.js` 2·3편 공용(로고·머리말·상자)
- `ep1~3.js` 장면(모든 상태를 `seek(t)` 한 번으로 계산 — 프레임 사이 상태 없음)
- `render.js` Playwright 프레임 렌더 · `mix.py` 음악+효과음 · `encode.py` 최종 인코딩 · `glitch.py` 한 프레임 튐 검사
- `data/map.js` 특보구역 44+49·육지·관광지 1,354곳(지도 단위 px) · `data/risk.js` 위험예측 오늘·내일 단계(앱 API, 2026-10-19 17:46 받음) · `data/code.js` 1편 터미널의 실제 코드(push_helpers.js 236~330행)

## 사실 근거(화면 글)
상자 위치는 캡처를 픽셀로 재서 맞췄다(각 `Box(...)` 옆 주석). 숫자는 게시글 수정본 값이며 시행착오는 「400건 넘게」(origin/main 고유 번호 412개), 법령은 「70여 개」.
챗봇 질문·생각 중·첫 단락은 앱 모양대로 재구성(화면에 「재구성 화면」 표시), 2편 📢 발표 알림도 재구성(「재구성」 표시).
