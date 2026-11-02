# 위험예측 화면 시안 (보관본)

- `risk_layer_mock.html` — 사용자가 판마다 보고 고친 「위험예측」(연안·해상 위험 예측·분석) 화면 시안 **판 23 + U77·U78 반영** (2026-10-10).
  게시본: https://claude.ai/artifact/94hgf2XdrgSSGbmZJET2wM
- 앱 코드가 아니다. 지도·관광지·해역은 **가상의 예시**이고, 화면 모양·문구 틀·색 규칙·동작만 요구사항이다.
  결정의 근거와 사용자 원문은 `../coastal_safety_forecast.design.md` §1(U1~U78).
- [기준 상세] 창의 「위험지수 산출 근거 보고서(PDF)」 버튼이 가리키는 PDF 는 여기 없다 —
  `local_server/tools/coastal_accident_analysis/40_public_report_pdf.js` 로
  `local_server/config/coastal_safety/accident_analysis/v3/public/*.md` 에서 다시 만든다.
- 최신 요구: 버튼 「위험예측」 한 줄, 처음 연안만 켜짐, 해상 내일 23시·연안 모레 21시까지, 단계 0~19/20~66/67~99/100, 1.5배 노랑·4배 주황·8배 빨강, 특보 없는 오늘·내일 예보 세기 3단계. 실제 앱 연결도 이번 구현 범위다(메인 브리핑은 뒤로 둠).
- 브라우저로 파일을 직접 열어 볼 수 있다(외부 접속 없음).
