# 해상 일기도 → 풍랑특보 선행예측 분석 (wave_leadtime)

위험기상일기도(해상풍·유의파고 수치예보)가 **실제 풍랑특보보다 며칠 전에** 해당
해역의 악기상을 그리는지 과거 데이터로 검증하고, 그 임계·리드타임을 도출하는 분석 툴킷.

> 목표: 기상청이 특보를 발표하기 **전에**, 앞으로 나올 예상일기도에서 특정 특보구역의
> 유의파고가 임계(≥3.0m 주의보 / ≥5.0m 경보)에 도달하면 **선제적으로 특보 가능성**을
> 사용자에게 알린다. 그러려면 먼저 "어느 수준이면 / 몇 시간 전에" 특보로 이어지는지를
> 과거 일기도 × 과거 특보로 정량화해야 한다 → 이 툴킷이 그 1단계(데이터 조사·리포트).

## 데이터 소스

| | 내용 | 확보 방식 |
|---|---|---|
| 정답지 | 풍랑·강풍 등 특보 발표/해제 기록 2023-06~2026-06 (9,468행) | `data/warnings_2023-2026.csv` (방재기상플랫폼 export, UTF-8) |
| 예측입력 | 위험기상일기도 GIF (ReWW3 광역 / CoWW3 청별 국지) | dmdw.kma.go.kr 인증 세션 크롤링 |

### dmdw 위험기상일기도 크롤링 레시피 (역설계 확인)
1. `GET /rsw/mfp/mfpMain` → 쿠키 + CSRF
2. `POST /rsw/rest/frm/login_user` (base64(encodeURIComponent) 자격증명, statecode==10)
3. `GET /rsw/mfp/cht/rswChtSvrRetrieve` (위험기상일기도 페이지, CSRF 갱신)
4. `POST /rsw/mfp/cht/rswChtSvrBodyRetrieve` — `cmdType=LIST` + `headData`(prefix) + `tm`(base)
   - **`tm` 은 정확히 run 의 s000 유효시각(KST)=매일 09/21시(00/12 UTC run) 이어야** 프레임 반환
   - 응답 HTML 의 `<img src=".../retChtSvrImgView?...&dirName=&fileName=*.gif">`
5. `GET /rsw/rest/mfp/cht/retChtSvrImgView?cmdType=VIEW&tm=&dirName=&fileName=` → image/gif

한 run 당 s000~s120(3시간 간격, 41~82프레임)의 예보열. **아카이브는 2023-07까지 보존**(전 기간 커버).

### 청별 국지(지방청) 차트 prefix — `frmBValue10`
| 청 코드 | prefix(KIM) | CSV 지역 |
|---|---|---|
| jeju | `kim_cww3_jeju_wave_` | 제주도 |
| busn | `kim_cww3_busn_wave_` | 부산·울산·경상남도 |
| gwju | `kim_cww3_gwju_wave_` | 광주·전라남도 |
| degu | `cww3_degu_wave_`(APPM) | 대구·경상북도 |
| gawn | `kim_cww3_gawn_wave_` | 강원특별자치도 |
| dajn | `kim_cww3_dajn_wave_` | 대전·세종·충청남도 |

## 방법론

각 풍랑 발효 이벤트(청 C, 발효시각 T_ef)에 대해 리드타임 L ∈ {12,24,48,72}h:
1. `T_ef - L` 시점에 가용했던 최신 run(발표지연 `PUB_DELAY_H`=7h 반영, 인과성 보장) 선택
2. 그 run 에서 valid time 이 T_ef 에 가장 가까운(±3h) 프레임
3. 디코딩 → 해역 픽셀의 유의파고 등급 분포 → **maxBand** 산출
4. `maxBand ≥ 3.0` 이면 "L시간 전 이미 주의보급 예측" = **HIT**

집계: 리드타임별 HIT율(재현율) + 음성대조군 거짓경보율(정밀도) + 이벤트별 최초감지 리드타임.

### 색상 분석 정확도 보정 (중요)
GIF 의 유의파고 음영을 RGB→등급 매핑(`palette.js`)하되, 다음 false positive 를 제거:
- **진초록 특보구역 경계선** ↔ 고파고(≥7.5m) 팔레트 충돌 → 진초록 앵커 제외
- **범례 색상막대·고정 마커** → `staticMask.js`(여러 프레임에서 RGB 불변+≥3m 색 픽셀 = 고정 크롬) 자동 마스킹
- **하단 VALID/TIME 빨강 캡션** → 하단 10% 크롭 (매 프레임 내용이 달라 마스크 불가)
- **maxBand 최소면적** `MIN_BAND_PIXELS`=60px → 라벨/노이즈 1~2px 오분류 무시

> 검증(음성대조): 보정 후 잔잔한 날 maxBand≤2.5, 폭풍날 ≥3.5 로 명확히 분리됨.

## 사용법
```bash
KMA_DMDW_USER_ID=... KMA_DMDW_USER_PWD=... \
  node runLeadtime.js --office=제주도 --from=2026-04-01 --to=2026-05-01 \
                      --leads=12,24,48,72 --level=주의보
```
옵션: `--office`(청 CSV 지역명) `--from/--to`(발효 기준 기간) `--leads`(쉼표) `--level`(주의보|경보)
`--limit` `--pubdelay`(기본7) `--nocontrol` `--rebuildmask`. 결과: `out/leadtime_<청>_<stamp>.{json,md}`.

캐시: `cache/list_*`(프레임목록) `cache/gif/*`(원본 GIF) `cache/mask/*`(청별 정적마스크) — 재실행 비용 절감(버전관리 제외).

## 검증 결과 (1차)
`SAMPLE_REPORT_jeju_2026-04.md` — 제주청 2026-04 풍랑주의보 24건:
재현율 12h전 83%·72h전 50%, **거짓경보율 9%**, 24건 중 12건이 72h(3일) 전부터 감지.

## per-zone(특보구역별) 정밀화 — `geoCalib.js`
청 차트는 고정 템플릿이므로 청별 1회 위경도↔픽셀 affine 보정(프레임 박스+격자선에서 derive)
후 `seaZoneCoordinates.js` 의 **부모 특보구역** 위경도를 차트 픽셀로 투영, 그 주변 원형영역만
분석한다. (사용자 합의: 이미지에 연안바다/평수구역 경계가 없으므로 부모 구역 단위로만 매칭)

- **제주청 검증 완료**: 구역 투영 위치 정상(북부=상단/남부=하단/동부=우측), 2025-12-21 강풍 시
  남쪽 구역(남동쪽 2065px·남쪽바깥 1916px = 5.5m) 강하게·북부 약하게 = 실제 공간구조 포착,
  잔잔한 날 0. frame-box 적용으로 청 단위보다 범례 누수 잔여 아티팩트까지 제거됨.
- **남은 작업**: 나머지 5청(busn/gwju/degu/gawn/dajn) 차트 축 라벨 확인 → `CALIB` 보정값 추가.
  그 후 `runLeadtime.js` 에 per-zone 매칭 옵션(CSV 해역명 = seaZoneCoordinates 구역명 1:1) 추가.

## per-zone 운영
- 6청 보정 완료(`geoCalib.CALIB`). degu(대구·경북)는 전용 차트가 APPM(빈 archive)이라 gawn 차트 사용(`OFFICE_CHART`).
- CSV 해역명 → 부모 특보구역 매칭(`zones.js`, 97.4%): 정확매칭 + 집합/지역(region) centroid.
- 러너가 청 단위와 per-zone HIT 를 함께 산출. 구역 샘플 반경은 type별(H 먼바다 55px / I 앞바다 30px).
- `calibrate_offices.js`: 청 차트 프레임+라벨범위로 보정값 재산출(축 라벨은 LABEL_EXTENT 에 기록).

### 발견 (제주 2026-04)
per-zone HIT(≈33%@12h) < 청단위(83%). 버그가 아니라, **제주 풍랑주의보 상당수가 앞바다 대상이고
파고(3m)보다 풍속(≥14m/s)으로 발효**되어 파고 차트만으론 그 구역에 ≥3m 가 안 나타나기 때문.
청 단위는 차트 다른 곳(먼바다)의 ≥3m 를 잡아 과대계상. → 완전한 재현을 위해선 해상풍(풍속) 차트
(`*_wind_ft03_pa4_`)도 병행 분석 필요(다음 단계).

## 진행 현황
- [x] 청 단위 파이프라인(크롤링·색상분석·리드타임·거짓경보율) — 검증
- [x] per-zone 보정·투영·분석(`geoCalib.js`/`zones.js`) — 6청 보정 + 러너 통합
- [ ] 전 기간×6청 (청×연도) 병렬 배치 실행 → 종합 리포트
- [ ] (개선) 해상풍 차트 병행 → 풍속기반 주의보 재현율 보강 / 폴리곤 기반 구역 샘플
