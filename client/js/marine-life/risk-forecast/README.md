# 위험예측

`index2.html`의 **해양생활 → 해양안전 → 위험예측** 버튼에 연결된 지도 오버레이다. 처음에는 연안만 켜며, 관광지나 해상 칸을 선택하면 시간축과 상세 시트가 열린다. 해상·연안 스위치는 기존 범례 칸에 쌓인다. 선택한 층을 끄거나 Escape를 누르면 시트와 선택 위험구역을 지운다.

점수·시간축·특보 판정은 `/api/risk-forecast/*` 서버 응답을 사용한다. 이 폴더는 색 보간·좌표·배수 문장과 지도 표시를 맡는다. 자료가 없거나 수집이 실패하면 배너와 상세 행에 표시하며 예시 자료로 대체하지 않는다. 해상 혼잡도는 점으로 표시하고 위험지수에 더하지 않는다.

- `risk_forecast.js`: 버튼·층·선택·60초 자료 갱신 조율
- `risk_api.js`: 15초 제한, 경로별 TTL과 동시 요청 중복 방지
- `risk_map_layer.js`: 육지로 잘린 연안 분할 원·모든 관광지의 선택 중심점, 해상 격자, 본·하위 특보 경계, 21개 섬
- `risk_slider.js`, `risk_sheet.js`: 서버 시간축·자료 신선도와 상세 문장·동일 좌표 관광지 선택 목록
- `risk_format.js`: DMS 정수 초, 16방위, HTML·출처 URL 보호, 색과 숫자 명암
- `risk_basis.js`, `risk_basis_content.js`: 기준 상세 및 서버 PDF 다운로드
- `risk_forecast.css`: 기존 스위치·슬라이더를 재사용하는 표시 스타일

[설치·검증·자료 계약](guide.md) · [화면 명세](../../ocean-map/coastal-risk/risk_forecast_ui.spec.md) · [구현 설계](../../ocean-map/coastal-risk/risk_forecast.impl_design.md)
