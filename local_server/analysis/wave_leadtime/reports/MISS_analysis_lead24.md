# 놓친 특보 사례 분석 (lead 24h, 결합 미검출)

결합 미검출 980건 중 974건 분류:

| 원인 | 건수 | 비율 | 의미 |
|---|---|---|---|
| B-radius | 277 | 28% | 반경만 키웠어도 잡힘 → **우리 개선여지** |
| B-nearby | 91 | 9% | 구역 바로 밖에 신호 → 경계/보정 |
| B-justbelow | 152 | 16% | 임계 직하(20kt/2.5m) → 양자화/컷 |
| A-absent | 454 | 47% | 인근 신호 없음 → **일기도 한계(예측 불가)** |

**요약**: 놓친 것 중 **약 53%는 (B) 우리 로직 개선으로 잡을 여지**, **약 47%는 (A) 일기도에 신호 자체가 없어 예측 불가**.

## 표본 (reports/miss_samples/ 에 풍속 이미지 저장)

- [B-justbelow] jeju 2023-06-01T07:00 | 해역 제주도남동쪽안쪽먼바다 | 구역픽셀 제주도남동쪽안쪽먼바다(546,357) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | jeju_2023060107_B-justbelow_wind.gif
- [B-justbelow] jeju 2023-06-02T01:00 | 해역 제주도앞바다(제주도동부앞바다,제주도남부앞바다,제주도서부앞바다) | 구역픽셀 제주도앞바다(428,280) 제주도남부앞바다(425,317) 제주도서부앞바다(378,287) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | jeju_2023060201_B-justbelow_wind.gif
- [B-radius] jeju 2023-06-25T07:00 | 해역 제주도앞바다(제주도서부앞바다) | 구역픽셀 제주도앞바다(428,280) | windOur=15 bigR=25 near=30 wave_bigR=2.5 | jeju_2023062507_B-radius_wind.gif
- [B-radius] busn 2023-06-27T00:00 | 해역 남해동부안쪽먼바다,동해남부남쪽안쪽먼바다,동해남부남쪽바깥먼바다 | 구역픽셀 남해동부안쪽먼바다(274,372) 동해남부남쪽안쪽먼바다(728,185) 동해남부남쪽바깥먼바다(1001,247) | windOur=15 bigR=25 near=25 wave_bigR=2.5 | busn_2023062700_B-radius_wind.gif
- [B-justbelow] busn 2023-07-05T03:00 | 해역 남해동부바깥먼바다 | 구역픽셀 남해동부바깥먼바다(365,449) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | busn_2023070503_B-justbelow_wind.gif
- [B-justbelow] busn 2023-07-07T19:00 | 해역 남해동부바깥먼바다 | 구역픽셀 남해동부바깥먼바다(365,449) | windOur=15 bigR=15 near=20 wave_bigR=2.5 | busn_2023070719_B-justbelow_wind.gif
- [A-absent] gwju 2023-06-01T06:00 | 해역 서해남부남쪽안쪽먼바다,서해남부남쪽바깥먼바다 | 구역픽셀 서해남부남쪽안쪽먼바다(255,250) 서해남부남쪽바깥먼바다(1,288) | windOur=15 bigR=15 near=15 wave_bigR=2 | gwju_2023060106_A-absent_wind.gif
- [A-absent] gwju 2023-06-25T00:00 | 해역 서해남부남쪽바깥먼바다 | 구역픽셀 서해남부남쪽바깥먼바다(1,288) | windOur=undefined bigR=0 near=0 wave_bigR=0 | gwju_2023062500_A-absent_wind.gif
- [A-absent] gwju 2023-06-25T06:00 | 해역 서해남부남쪽안쪽먼바다 | 구역픽셀 서해남부남쪽안쪽먼바다(255,250) | windOur=15 bigR=15 near=15 wave_bigR=1.5 | gwju_2023062506_A-absent_wind.gif
- [A-absent] degu 2023-08-07T22:00 | 해역 동해남부앞바다(경북남부앞바다,경북북부앞바다),동해남부북쪽안쪽먼바다 | 구역픽셀 동해남부앞바다(340,530) 경북북부앞바다(346,437) 동해남부북쪽안쪽먼바다(510,425) | windOur=15 bigR=15 near=15 wave_bigR=2 | degu_2023080722_A-absent_wind.gif
- [A-absent] degu 2023-08-08T15:00 | 해역 동해남부북쪽바깥먼바다 | 구역픽셀 동해남부북쪽바깥먼바다(728,398) | windOur=undefined bigR=0 near=0 wave_bigR=0 | degu_2023080815_A-absent_wind.gif
- [A-absent] degu 2023-08-10T22:00 | 해역 동해남부앞바다(경북남부앞바다) | 구역픽셀 동해남부앞바다(340,530) | windOur=undefined bigR=0 near=0 wave_bigR=0 | degu_2023081022_A-absent_wind.gif
- [B-nearby] gawn 2023-07-10T22:00 | 해역 동해중부바깥먼바다 | 구역픽셀 동해중부바깥먼바다(626,293) | windOur=15 bigR=15 near=25 wave_bigR=2 | gawn_2023071022_B-nearby_wind.gif
- [B-justbelow] gawn 2023-08-07T22:00 | 해역 동해중부앞바다,동해중부안쪽먼바다 | 구역픽셀 동해중부앞바다(253,308) 동해중부안쪽먼바다(365,306) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | gawn_2023080722_B-justbelow_wind.gif
- [A-absent] gawn 2023-08-08T15:00 | 해역 동해중부바깥먼바다 | 구역픽셀 동해중부바깥먼바다(626,293) | windOur=15 bigR=15 near=15 wave_bigR=2 | gawn_2023080815_A-absent_wind.gif
- [B-justbelow] dajn 2023-07-04T19:00 | 해역 서해중부앞바다(충남북부앞바다,충남남부앞바다) | 구역픽셀 서해중부앞바다(557,417) 충남남부앞바다(606,544) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | dajn_2023070419_B-justbelow_wind.gif
- [B-radius] dajn 2024-03-19T16:00 | 해역 서해중부앞바다(충남북부앞바다,충남남부앞바다) | 구역픽셀 서해중부앞바다(557,417) 충남남부앞바다(606,544) | windOur=20 bigR=25 near=25 wave_bigR=2.5 | dajn_2024031916_B-radius_wind.gif
- [B-justbelow] dajn 2024-03-29T09:00 | 해역 서해중부앞바다(충남북부앞바다,충남남부앞바다) | 구역픽셀 서해중부앞바다(557,417) 충남남부앞바다(606,544) | windOur=15 bigR=15 near=15 wave_bigR=2.5 | dajn_2024032909_B-justbelow_wind.gif
