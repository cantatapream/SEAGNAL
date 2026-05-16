================================================================================
  vendor/ — 자체 호스팅된 외부 라이브러리 (A안 자체호스팅 결과물)
================================================================================

목적
----
앱 시작 시 외부 CDN 의존도를 줄여 시작 속도를 안정화하기 위해, 외부 CDN
에서 받아오던 라이브러리들을 우리 서버에 미리 다운로드해 둠.

다운로드 일시: 2026-05-16
다운로드 출처: cdn.jsdelivr.net, cdnjs.cloudflare.com, cdn.quilljs.com

================================================================================
파일 목록 및 출처
================================================================================

quill/quill.min.js                        Quill 1.3.6 (cdn.quilljs.com)
quill/quill.snow.css                      Quill 1.3.6 (cdn.quilljs.com)
chartjs/chart.umd.min.js                  Chart.js 4.5.1 (cdn.jsdelivr.net)
chartjs/chartjs-plugin-datalabels.min.js  chartjs-plugin-datalabels 2.2.0
ol/ol.js                                  OpenLayers 8.2.0 (cdn.jsdelivr.net)
ol/ol.css                                 OpenLayers 8.2.0 (cdn.jsdelivr.net)
fontawesome/css/all.min.css               FontAwesome 6.4.0 (cdnjs)
fontawesome/webfonts/fa-solid-900.woff2   FontAwesome 6.4.0 글꼴 (solid)
fontawesome/webfonts/fa-regular-400.woff2 FontAwesome 6.4.0 글꼴 (regular)
fontawesome/webfonts/fa-brands-400.woff2  FontAwesome 6.4.0 글꼴 (brands)
suncalc/suncalc.min.js                    SunCalc 1.9.0 (cdnjs)
hls.js/hls.min.js                         hls.js 1.5.13 (cdn.jsdelivr.net)

총 용량: 약 2.08 MB

================================================================================
주의 사항
================================================================================

1. FontAwesome CSS 의 폰트 경로는 ../webfonts/ 상대 경로를 사용합니다.
   따라서 fontawesome/css/all.min.css 와 fontawesome/webfonts/ 는
   반드시 같은 부모 폴더(fontawesome/) 아래에 형제로 두어야 합니다.

2. FontAwesome CSS 는 .ttf 파일도 폴백으로 참조하지만,
   Capacitor WebView (Chromium 기반) 는 woff2 만 사용하므로 .ttf 는 다운로드
   하지 않았습니다. 만약 woff2 미지원 환경 지원이 필요해지면 .ttf 도
   동일 webfonts/ 폴더에 추가하세요.

3. Chart.js / chartjs-plugin-datalabels 는 latest 자동 다운 시점의 버전을
   고정한 결과입니다. 업그레이드는 이 폴더의 파일을 새 버전으로 교체하면
   되며, 새 버전과의 호환성은 별도 테스트 필요.

4. 업그레이드 절차:
   - 새 버전 다운: curl -sL -o <대상파일> <CDN URL>
   - 다운로드 후 크기/파일헤더 확인
   - index2.html 의 vendor 경로는 그대로이므로 코드 변경 불필요

================================================================================
원래 외부 URL (필요 시 복원용)
================================================================================

Quill JS:    https://cdn.quilljs.com/1.3.6/quill.min.js
Quill CSS:   https://cdn.quilljs.com/1.3.6/quill.snow.css
Chart.js:    https://cdn.jsdelivr.net/npm/chart.js
DataLabels:  https://cdn.jsdelivr.net/npm/chartjs-plugin-datalabels@2
OL JS:       https://cdn.jsdelivr.net/npm/ol@v8.2.0/dist/ol.js
OL CSS:      https://cdn.jsdelivr.net/npm/ol@v8.2.0/ol.css
FA CSS:      https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css
FA fonts:    https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/webfonts/<file>
SunCalc:     https://cdnjs.cloudflare.com/ajax/libs/suncalc/1.9.0/suncalc.min.js
hls.js:      https://cdn.jsdelivr.net/npm/hls.js@1.5.13/dist/hls.min.js
