---
id: phases.phase3_proactive_rules
phase: 3
status: done
updated: 2026-06-03
source: knowledge/jikgun/*.md (선제 규칙 8직군×8) + _thresholds.json + _SCHEMA.md
---

# Phase 3 — 선제 제안 규칙 기계가독화

8개 직군 파일의 `## 나리야 선제 제안·개인화 규칙` 섹션(규칙 64개)을 트리거 평가기가 즉시 소비할 수 있는 JSON으로 정규화한다.
원본 직군 md 는 사람이 읽는 서술형이라 평가기가 직접 파싱하기 부적합하므로, 본 문서가 기계가독 단일 소스(SSOT)다.

## 1. 스키마 설명

각 규칙은 아래 객체로 표현한다.

```jsonc
{
  "ruleId":   "TR-<약어>-NN",        // 직군약어 ∈ {CG,FISH,LEIS,MOF,NAVY,GOV,ORG,ANGL}
  "jikgun":   "fishery",             // _thresholds.json 의 jikgun slug
  "trigger": {                        // 평가식. 다중 조건은 logic 트리로 표현
    "logic": "AND|OR|SINGLE",
    "conditions": [
      { "metric": "wave_height", "op": ">=", "threshold": 3, "unit": "m" }
    ],
    "context": "코드화 불가한 부가 조건(시간대·발화키워드·이력)을 서술로 보존"
  },
  "ment":        "사용자에게 할 멘트(플레이스홀더 [..] 는 도구결과 주입)",
  "evidenceTool":["근거 앱 도구/화면"],   // 멘트가 인용해야 하는 실제 데이터 출처
  "freqLimit":   "재발동 빈도 제한 정책",
  "needsSafetyPhrase": true             // 안전 면책문구 부착 필요 여부
}
```

### 1.1 표준 metric 키 (직접 평가 가능)
`_SCHEMA.md` 고정 키만 평가기가 수치 비교한다.

| metric | unit | op 허용 |
|---|---|---|
| `wave_height` | m | `>= > <= < ==` |
| `wind_speed` | m/s | `>= > <= < ==` |
| `water_temp` | °C | `>= > <= <` |
| `visibility` | km | `< <= >= >` |
| `typhoon_eta` | h | `<= <` |
| `current_speed` | cm/s | `>= >` |
| `warning` | 특보종류(enum) | `== >= contains in` |
| `tide_phase` | 사리/조금/만조/간조/정조 | `== within` |

`warning` 등급 순서(>= 비교용): `없음 < 예비특보 < 풍랑주의보 < 풍랑경보 < 태풍특보`.

### 1.2 확장 metric 키 (평가기 어댑터 필요 — 표준 외)
원본 규칙이 도입한 비표준 키. 평가기는 어댑터로 매핑하거나, 미지원 시 `context` 서술 게이트로 강등한다.

| 확장 metric | 의미 | 매핑/처리 |
|---|---|---|
| `warning_zone_count` | 특보 발효 해구 수 | 특보 API count 집계 |
| `tide_range` | 조차(cm) | 조석 바텀시트 조차값 |
| `time_window` | 예보 선행 시간(h) / 기간 플래그 | 시계열 인덱스 게이트 |
| `month_range` | 월 범위(예 07~09) | 시스템 날짜 게이트 |
| `wave_height@rank_top` | 전국 파고 순위 | 랭킹 API top-N |
| `user_query_keyword`·`keyword` | 발화 키워드 | NLU 인텐트/키워드 매처(서술 게이트) |
| `wave_height(배/증분/%)` | 예보 대비 비율·증분 | 파생값 계산(실측 vs 예보) |

> 표준화 원칙: 평가기는 1.1 표준 키만 수치 비교로 처리하고, 1.2 확장 키와 `context`(시간대·발화·이력·위치)는 **사전 게이트**로 둔다. 게이트 통과 후에만 수치 조건을 평가한다.

### 1.3 op 표준화
원본의 자유표기를 다음으로 정규화: `delta>=`→`context`(파생값)+`>=`, `within`→`within`(시간 윈도우 전용), `contains`/`in`→ enum/리스트 매칭. 비교 불가 표기(`rank_top`)는 확장 metric 으로 이관.

### 1.4 안전문구 1회 정책
- **needsSafetyPhrase=true**: 생명·법적 위험을 직접 경고하는 규칙(대피·출항금지·고립·저체온·태풍·해파리 등).
- **부착 정책(세션 1회)**: 동일 사용자 세션 내 안전 면책문구는 **최초 1회만** 부착한다. 이미 부착했으면 후속 안전 규칙 멘트에는 생략(중복 피로 방지). 단, **위험 등급이 상승**(예: 주의보→경보, danger 임계 신규 진입)하면 1회 재부착 허용.
- 면책문구 표준형: "긴급 상황은 즉시 122(해양경찰)로 신고하세요. 본 안내는 예보·관측 기반 참고용입니다."

### 1.5 빈도제한 표준값
| freqLimit 코드 | 의미 |
|---|---|
| `once_per_event` | 동일 특보/태풍/사리 이벤트당 1회 |
| `once_per_day` | 1일 1회 |
| `once_per_trip` | 출항/세션당 1회 |
| `on_state_change` | 상태 전이(발효/해제, 임계 진입) 시에만 |
| `cooldown_<h>h` | N시간 쿨다운 후 재발동 |

## 2. 8직군 규칙 JSON

`_thresholds.json` 정합 메모는 각 직군 표 하단에 표기. 멘트 내 `[..]`/`○○`/`[X]` 는 도구결과 주입 슬롯이며 LLM 임의 채움 금지(환각 방지).

### 2.1 fishery (어업종사자) — _thresholds: wave danger 3.0 / wind danger 17 / visib danger 0.3 / water 28(주의보) / temp basis
```json
[
 {"ruleId":"TR-FISH-01","jikgun":"fishery","trigger":{"logic":"OR","conditions":[{"metric":"wave_height","op":">=","threshold":3,"unit":"m"},{"metric":"wind_speed","op":">=","threshold":14,"unit":"m/s"}],"context":"현재 18:00~01:00, 익일 03:00~09:00 해구 시계열 예보"},"ment":"선장님, 내일 새벽 ○○해역 파고가 3미터 이상으로 예보돼 있어요. 풍랑주의보 발효 가능성이 있으니 출항 계획을 다시 확인해보시겠어요?","evidenceTool":["해구별 시계열 예보(~72h)","해상특보 발효현황"],"freqLimit":"once_per_day","needsSafetyPhrase":true},
 {"ruleId":"TR-FISH-02","jikgun":"fishery","trigger":{"logic":"SINGLE","conditions":[{"metric":"wave_height","op":">=","threshold":1.3,"unit":"ratio_vs_forecast"}],"context":"실측이 단기예보 대비 30%↑ 초과(파생값), 최근 앱 접속 2h 이내"},"ment":"지금 실측 파고가 예보보다 높게 나오고 있어요. 출항 전에 한 번 더 확인하시는 게 좋을 것 같아요. 부이 실측값 보여드릴까요?","evidenceTool":["기상부이 관측(파고·풍속)","해상 단기예보"],"freqLimit":"once_per_trip","needsSafetyPhrase":true},
 {"ruleId":"TR-FISH-03","jikgun":"fishery","trigger":{"logic":"SINGLE","conditions":[{"metric":"water_temp","op":">=","threshold":26,"unit":"°C"}],"context":"직군=양식업, GPS 최근접 부이 수온"},"ment":"가까운 부이 수온이 26도를 넘었어요. 고수온 주의보 기준(28도)에 가까워지고 있으니 양식장 점검이나 선제 출하를 고려해보세요.","evidenceTool":["기상부이 관측(수온)","GPS 최근접 부이"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-FISH-04","jikgun":"fishery","trigger":{"logic":"SINGLE","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":48,"unit":"h"}],"context":"태풍 예보 진로 내 사용자 위치 포함"},"ment":"태풍 ○○호가 48시간 안에 이 해역에 영향을 줄 수 있어요. 가두리 시설 결박과 어선 피항 준비를 서두르시는 게 좋겠어요. 태풍 경로 확인해드릴까요?","evidenceTool":["태풍 현황·경로"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-FISH-05","jikgun":"fishery","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":"<","threshold":2,"unit":"m"},{"metric":"wind_speed","op":"<","threshold":10,"unit":"m/s"}],"context":"중기예보 3~10일 중 3일 이상 연속, 근해어업"},"ment":"이번 주 ○요일부터 ○일간 기상이 비교적 안정될 것 같아요. 항차 계획 잡기 좋은 기간이에요. 중기 예보 자세히 볼까요?","evidenceTool":["중기예보(3~10일)"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-FISH-06","jikgun":"fishery","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<","threshold":1,"unit":"km"}],"context":"20:00~05:00, 최근접 해무CCTV/부이, 출항 질문 이력"},"ment":"지금 인근 해역 시정이 1킬로미터 미만으로 짙은 안개가 끼어 있어요. 야간 출항 시 충돌 위험이 높으니 시정이 회복된 후 출항을 고려해보세요.","evidenceTool":["해무 CCTV","기상부이 관측(시정)"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-FISH-07","jikgun":"fishery","trigger":{"logic":"SINGLE","conditions":[{"metric":"wave_height","op":">=","threshold":1.5,"unit":"m_delta_6_12h"}],"context":"근해어업, 항구 5km 이상 이격, 6~12h 후 증분(파생값)"},"ment":"6시간 후부터 파고가 빠르게 높아질 것으로 예보돼 있어요. 지금 귀항을 서두르시는 게 안전할 것 같아요. 현재 항로 파고 보여드릴까요?","evidenceTool":["해구별 시계열 예보(~72h)","기상부이 관측"],"freqLimit":"once_per_trip","needsSafetyPhrase":true},
 {"ruleId":"TR-FISH-08","jikgun":"fishery","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"사리","unit":""},{"metric":"current_speed","op":">=","threshold":120,"unit":"pct_vs_normal"}],"context":"연안어업, 향후 2일 이내 사리, 유속 평시 20%↑(파생값)"},"ment":"내일모레가 사리예요. 조류가 평소보다 강하게 흘러서 자망·통발 작업 시 어구 유실 가능성이 높아요. 조류 방향 미리 확인하시겠어요?","evidenceTool":["조석/물때 바텀시트","유향·유속"],"freqLimit":"once_per_event","needsSafetyPhrase":false}
]
```
정합: 01 파고3·풍속14 = danger(3.0)/caution(14) 일치. 03 수온26 = 주의보(28)-2℃ 조기경보로 타당.

### 2.2 angler (낚시객) — _thresholds: wave danger 2.5 / wind danger 14 / 수온15℃ 입수위험
```json
[
 {"ruleId":"TR-ANGL-01","jikgun":"angler","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"사리","unit":""},{"metric":"wave_height","op":"<","threshold":1.0,"unit":"m"},{"metric":"wind_speed","op":"<","threshold":7,"unit":"m/s"},{"metric":"warning","op":"==","threshold":"없음","unit":""}],"context":"오늘~내일 사리"},"ment":"오늘 사리 물때에 바다 조건도 좋아요! 조류가 활발해서 감성돔·농어 입질이 가장 좋은 날이에요. 출조 타이밍입니다!","evidenceTool":["조석/물때","해상 단기예보","해상특보","생활지수(바다낚시)"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-ANGL-02","jikgun":"angler","trigger":{"logic":"SINGLE","conditions":[{"metric":"tide_phase","op":"within","threshold":60,"unit":"min_before_high_tide"}],"context":"갯바위 낚시 중(위치/문의 추정)"},"ment":"지금 만조까지 약 1시간 남았어요. 갯바위 고립 사고의 80%가 만조 전후에 발생해요. 지금 바로 안전한 곳으로 이동하세요!","evidenceTool":["조석/물때(고조 시각)","해상 단기예보"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-ANGL-03","jikgun":"angler","trigger":{"logic":"SINGLE","conditions":[{"metric":"warning","op":">=","threshold":"풍랑주의보","unit":""}],"context":"위치/조회 해역 특보 발효"},"ment":"현재 이 해역에 풍랑주의보가 발효됐어요. 낚시어선법에 따라 출항이 금지되고, 갯바위 접근도 매우 위험해요. 오늘 출조는 취소하시는 게 좋겠어요.","evidenceTool":["해상특보","해상 단기예보"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-ANGL-04","jikgun":"angler","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"야간만조","unit":""},{"metric":"wave_height","op":">=","threshold":0.7,"unit":"m"}],"context":"일몰 이후 고조 존재"},"ment":"오늘 밤 [시각]에 만조예요. 야간에는 수위 변화를 눈으로 확인하기 어렵기 때문에, 늦어도 [고조 시각 1.5h 전]까지는 갯바위에서 철수해야 안전해요. 구명조끼도 꼭 착용하세요.","evidenceTool":["조석/물때(야간 고조)","해상 단기예보","기상부이 관측"],"freqLimit":"once_per_day","needsSafetyPhrase":true},
 {"ruleId":"TR-ANGL-05","jikgun":"angler","trigger":{"logic":"OR","conditions":[{"metric":"wave_height","op":">=","threshold":1.5,"unit":"m"},{"metric":"warning","op":">=","threshold":"예비특보","unit":""}],"context":"주말 출조 발화 + 중기예보 목표일"},"ment":"이번 주말 [날짜] 날씨가 현재 예보로는 파고가 [수치]로 낚시하기 어려울 수 있어요. 전날 다시 확인하시고, 조건이 좋은 [대안 날짜]로 일정을 조정하는 건 어떨까요?","evidenceTool":["중기예보(3~10일)","해상특보","생활지수(바다낚시)"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-ANGL-06","jikgun":"angler","trigger":{"logic":"SINGLE","conditions":[{"metric":"water_temp","op":">=","threshold":3,"unit":"°C_delta_week"}],"context":"전주 대비 ±3℃ 변화(파생값)"},"ment":"이 해역 수온이 지난주보다 [변화량] 내려갔어요(또는 올랐어요). 감성돔 같은 어종은 수온 변화에 민감해서 포인트를 이동할 수 있어요. 조황 정보를 낚시 커뮤니티에서 한번 확인해보세요.","evidenceTool":["기상부이 관측(수온 시계열)","GPS 최근접 부이"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-ANGL-07","jikgun":"angler","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":">=","threshold":1.5,"unit":"m"},{"metric":"warning","op":"==","threshold":"없음","unit":""}],"context":"실측이 예보 대비 0.5m↑ 또는 유의파고 1.5m↑"},"ment":"지금 실제 파고가 예보보다 높게 측정되고 있어요. 특보가 없어도 너울이 밀려오면 갯바위가 위험할 수 있어요. 바다 상태를 직접 확인하시고 안전에 유의하세요.","evidenceTool":["기상부이 관측(실측 파고)","해상 단기예보","해무 CCTV"],"freqLimit":"cooldown_3h","needsSafetyPhrase":true},
 {"ruleId":"TR-ANGL-08","jikgun":"angler","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"조금","unit":""},{"metric":"wave_height","op":"<","threshold":0.8,"unit":"m"},{"metric":"wind_speed","op":"<","threshold":5,"unit":"m/s"}],"context":"오늘 조금 물때"},"ment":"오늘 조금 물때라 조류가 약하고 바다가 잔잔해요. 볼락·우럭처럼 저층에 붙어 있는 어종을 노리기에 딱 좋은 조건이에요!","evidenceTool":["조석/물때","해상 단기예보","생활지수(바다낚시)"],"freqLimit":"once_per_day","needsSafetyPhrase":false}
]
```
정합: 01 파고1.0 = safe(1.0) 적정, 07 파고1.5 = caution(2.0) 미만이나 너울 보수경고로 타당.

### 2.3 marine_leisure (레저스포츠) — _thresholds: wave danger 2.0 / wind danger 15 / water danger 14 / visib danger 0.5
```json
[
 {"ruleId":"TR-LEIS-01","jikgun":"marine_leisure","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":">=","threshold":0.7,"unit":"m"},{"metric":"wave_height","op":"<=","threshold":2.5,"unit":"m"},{"metric":"warning","op":"==","threshold":"없음","unit":""}],"context":"풍향 오프쇼어(방위각 metric 미정의, 서술 게이트)"},"ment":"지금 바람이 오프쇼어로 불고 파고도 0.7~2m 사이예요. 서핑하기 딱 좋은 조건인데 오늘 바다 나가실 계획 있으세요? 생활지수 서핑 등급도 확인해 드릴게요.","evidenceTool":["부이 관측(풍향)","해역별 단기예보","해상특보","생활지수(서핑)"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-LEIS-02","jikgun":"marine_leisure","trigger":{"logic":"OR","conditions":[{"metric":"warning","op":"==","threshold":"풍랑주의보","unit":""},{"metric":"warning","op":"==","threshold":"풍랑경보","unit":""}],"context":"GPS 주요 해역 특보"},"ment":"현재 이 해역에 풍랑주의보가 발효 중이에요. 수상레저기구 운항이 법적으로 제한되니 오늘 출항·입수는 자제해 주세요. 특보 해제 예상 시점을 72시간 예보로 확인해 볼게요.","evidenceTool":["해상특보","72h 시계열 예보"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-LEIS-03","jikgun":"marine_leisure","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":">=","threshold":1.0,"unit":"m"},{"metric":"wave_height","op":"<=","threshold":2.5,"unit":"m"},{"metric":"warning","op":"==","threshold":"없음","unit":""}],"context":"수~목 + 주말 중기예보(요일 서술 게이트)"},"ment":"이번 주말 동해 파도 예보가 꽤 좋아요. 파고 1.5m 안팎에 특보도 없을 것 같아요. 주말 서핑 여행 계획해 보시겠어요? 전국 파고 랭킹으로 더 좋은 스팟도 비교해 드릴게요.","evidenceTool":["중기예보(3~10일)","전국 파고·풍속 랭킹"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-LEIS-04","jikgun":"marine_leisure","trigger":{"logic":"SINGLE","conditions":[{"metric":"tide_phase","op":"==","threshold":"정조","unit":""}],"context":"직군=다이버/다이빙 이력, 정조 1h 이내(서술 게이트)"},"ment":"약 50분 뒤가 오늘 정조 시간이에요. 조류가 가장 약해지는 타이밍이라 다이빙 입수하기 좋아요. 지금 수온은 [현재값]°C예요.","evidenceTool":["조석/물때 바텀시트","기상부이 수온"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-LEIS-05","jikgun":"marine_leisure","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<","threshold":1.0,"unit":"km"}],"context":"출항/안개 발화 키워드(서술 게이트)"},"ment":"현재 이 해역 시정이 [현재값]km밖에 안 나와요. 해무 CCTV로 직접 지금 바다 상태 확인해 보실 수 있어요. 시정 0.5km 이하면 법적으로 운항이 제한돼요.","evidenceTool":["기상부이 관측(시정)","해무 CCTV"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-LEIS-06","jikgun":"marine_leisure","trigger":{"logic":"SINGLE","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":72,"unit":"h"}],"context":"서핑 발화 이력(서술 게이트)"},"ment":"태풍이 [N]일 뒤 접근 예정이에요. 큰 파도가 들어올 수 있지만 강풍·특보 위험도 함께 높아요. 숙련자도 태풍 접근 24시간 이내엔 입수를 삼가는 게 안전해요. 태풍 경로와 파고 예보 함께 보여드릴게요.","evidenceTool":["태풍 현황·경로","72h 시계열 예보"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-LEIS-07","jikgun":"marine_leisure","trigger":{"logic":"SINGLE","conditions":[{"metric":"water_temp","op":"<","threshold":20,"unit":"°C"}],"context":"2주 평균 대비 3℃↓ 또는 다이빙 발화 이력(서술 게이트)"},"ment":"최근 이 해역 수온이 [현재값]°C로 내려갔어요. 지난주보다 많이 차가워진 편이에요. 5mm 이상 슈트나 드라이슈트 착용을 권장드려요.","evidenceTool":["GPS 최근접 부이(수온)","과거 시계열"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-LEIS-08","jikgun":"marine_leisure","trigger":{"logic":"SINGLE","conditions":[{"metric":"warning","op":"==","threshold":"해파리주의보","unit":""}],"context":"7~9월 + 남해/제주 + 입수 발화(앱 GAP, 외부 연동)"},"ment":"이 시기 남해·제주 해역은 노무라입깃해파리 출현이 잦아요. 입수 전 해파리 출현 현황을 꼭 확인하세요. 해양환경공단 해파리 예보 서비스 링크 바로 안내해 드릴게요.","evidenceTool":["[GAP] 해양환경공단 해파리 예보(외부)"],"freqLimit":"once_per_day","needsSafetyPhrase":true}
]
```
정합: 01 파고 0.7~2.5 = safe(0.8)~danger(2.0) 범위, 서핑 적합 note 와 일치. 02 풍랑주의보 = danger 영역. 07 수온20 = safe(20) 경계, 슈트 권고로 타당. 08 `해파리주의보` 는 _thresholds 미정의 enum — 외부 연동 GAP 으로 처리.

### 2.4 coast_guard (해양경찰) — _thresholds: wave danger 4.0 / wind danger 22 / visib danger 0.3
```json
[
 {"ruleId":"TR-CG-01","jikgun":"coast_guard","trigger":{"logic":"SINGLE","conditions":[{"metric":"warning","op":"==","threshold":"풍랑경보","unit":""}],"context":"원본 OR(wave>=5 OR wind>=21) 은 풍랑경보 정의와 동치 → warning==풍랑경보 단일조건으로 정규화"},"ment":"현재 [해역명]에 풍랑경보가 발효됐습니다. 갯바위 낚시 지수는 '매우 나쁨'이고, 해수욕장·연안 레저 인파가 있다면 즉시 대피 안내가 필요한 상황입니다. 특보 발효 해역 지도를 바로 보여드릴까요?","evidenceTool":["해상특보","생활지수(바다낚시·서핑)"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-CG-02","jikgun":"coast_guard","trigger":{"logic":"AND","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":48,"unit":"h"},{"metric":"wind_speed","op":">=","threshold":25,"unit":"m/s"}],"context":"태풍 경로상 소속 해역 통과"},"ment":"태풍 [태풍명]이 48시간 내 [해역명] 인근을 통과할 예정입니다. 현재 예상 최대 풍속은 [수치]m/s이며, 피항 결정 전에 72시간 시계열 예보를 확인하시겠습니까?","evidenceTool":["태풍 현황·경로","해구별 시계열(~72h)","중기예보"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-CG-03","jikgun":"coast_guard","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"간조","unit":""},{"metric":"wave_height","op":"<=","threshold":0.5,"unit":"m"}],"context":"저조 ±2h, 바다갈라짐 지수 좋음↑"},"ment":"오늘 [저조 시각]에 [지점명] 갯벌이 열립니다. 관광객 집중 예상 시간대이며, [고조 시각]부터 조위가 빠르게 상승합니다. 고립 사고 예방을 위해 현장 순찰 강화가 필요할 수 있습니다.","evidenceTool":["조석/물때(고조·저조)","바다갈라짐 지수"],"freqLimit":"once_per_day","needsSafetyPhrase":true},
 {"ruleId":"TR-CG-04","jikgun":"coast_guard","trigger":{"logic":"SINGLE","conditions":[],"context":"수색/표류/조난/'어디 갔을까' 발화 키워드 전용 게이트(원본 current_speed>=0 은 항상참이라 제거 — 유향·유속은 멘트 슬롯에서 도구결과로 주입)"},"ment":"현재 [위치] 해역의 유향은 [방향], 유속은 [속도]노트입니다. 풍향·풍속과 조합하면 3시간 후 표류 방향은 [방향] 쪽으로 예상됩니다. 유향·유속 지도 레이어를 바로 여시겠습니까?","evidenceTool":["유향·유속 레이어","해역별 단기예보(풍향·풍속)","기상부이 실시간"],"freqLimit":"cooldown_1h","needsSafetyPhrase":false},
 {"ruleId":"TR-CG-05","jikgun":"coast_guard","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<=","threshold":0.5,"unit":"km"}],"context":"선박 이동 집중 시간대(이른 아침·야간)"},"ment":"현재 [CCTV 지점]에서 해무로 시정 [수치]m가 탐지됩니다. 항로 상 시정 불량 구역이 있어 VTS 레이더 집중 모니터링이 필요할 수 있습니다. CCTV 화면을 보여드릴까요?","evidenceTool":["해무 CCTV","기상부이 시정"],"freqLimit":"on_state_change","needsSafetyPhrase":false},
 {"ruleId":"TR-CG-06","jikgun":"coast_guard","trigger":{"logic":"AND","conditions":[{"metric":"warning","op":"==","threshold":"풍랑주의보해제","unit":""},{"metric":"wave_height","op":"<=","threshold":1.5,"unit":"m"}],"context":"전날 해제 + 익일 낚시지수 좋음 + 주말/공휴일"},"ment":"내일 [해역명] 풍랑주의보가 해제되고 파도·바람이 잦아들 전망입니다. 주말과 맞물려 갯바위 낚시·레저 인파가 급증할 수 있습니다. 갯바위 지수와 단기예보를 미리 확인하시겠습니까?","evidenceTool":["해상특보","생활지수(바다낚시)","해상 단기예보"],"freqLimit":"once_per_event","needsSafetyPhrase":false},
 {"ruleId":"TR-CG-07","jikgun":"coast_guard","trigger":{"logic":"SINGLE","conditions":[{"metric":"water_temp","op":"<=","threshold":10,"unit":"°C"}],"context":"수색구조·잠수 발화 감지"},"ment":"현재 [부이명] 해역 수온이 [수치]°C입니다. 10°C 이하에서는 저체온증 의식불명까지 약 30~60분으로, 골든타임이 매우 짧습니다. 수온 정보와 유향·유속을 함께 확인하시겠습니까?","evidenceTool":["기상부이 수온","유향·유속 레이어"],"freqLimit":"cooldown_1h","needsSafetyPhrase":true},
 {"ruleId":"TR-CG-08","jikgun":"coast_guard","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":">=","threshold":1.0,"unit":"m"},{"metric":"tide_phase","op":"==","threshold":"만조","unit":""}],"context":"서핑지수 좋음↑ + 여름 주말 + 해수욕장 개장(7~8월)"},"ment":"오늘 [해수욕장명] 인근 파고와 파도 주기가 이안류 발생 조건에 해당합니다. 연안구조정 배치 및 안전요원 증배 여부를 사전에 검토하실 것을 제안드립니다.","evidenceTool":["서핑 지수","해상 단기예보","기상부이 파고"],"freqLimit":"once_per_day","needsSafetyPhrase":true}
]
```
정합: 01 풍랑경보(파고5/풍속21) = wave danger(4.0) 초과로 명백 위험. 02 풍속25 > danger(22). 04 원본 `current_speed>=0`(항상참) 제거 → `conditions:[]` 발화 키워드 전용 게이트로 정정(유속값은 멘트 슬롯에서 도구결과로 주입, needsSafetyPhrase=false: 정보 제공형).

### 2.5 navy (해군) — _thresholds: wave danger 5.0 / wind danger 25 / wave_period danger 4
```json
[
 {"ruleId":"TR-NAVY-01","jikgun":"navy","trigger":{"logic":"AND","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":72,"unit":"h"},{"metric":"wave_height","op":">=","threshold":5,"unit":"m"}],"context":"태풍 특보 발효"},"ment":"현재 [해역명]에 태풍 [이름]이 72시간 내 접근 예정입니다. 해구별 파고 예보상 [N]시간 후 피항 기준 파고(5m 이상)에 도달 예정입니다. 피항 타이밍을 미리 확인하시겠습니까?","evidenceTool":["태풍 현황·경로","해구별 72h 시계열","해상특보"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-NAVY-02","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"tide_phase","op":"==","threshold":"사리","unit":""}],"context":"원본 warning contains '서해·인천 해역 조회' 는 위치 게이트로 재분류"},"ment":"현재 사리(대조기)로 조차가 평소보다 크게 나타납니다. 입출항 예정이시면 고조 전후 2시간 이내 창조류 이용을 권장합니다. 오늘 고조 시각을 확인해 드릴까요?","evidenceTool":["조석 바텀시트","유향·유속"],"freqLimit":"once_per_event","needsSafetyPhrase":false},
 {"ruleId":"TR-NAVY-03","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<","threshold":1,"unit":"km"}],"context":"야간/새벽 00:00~06:00"},"ment":"현재 [해역명] 해상 시정이 1km 미만으로 관측됩니다. 항해 경계 강화 및 입출항 지연을 검토하시기 바랍니다. CCTV 실시간 화면을 보여드릴까요?","evidenceTool":["해무 CCTV","기상부이 시정"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-NAVY-04","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"wave_height","op":">=","threshold":1.5,"unit":"m"}],"context":"고속단정 운용 문의 발화"},"ment":"현재 위치 인근 부이 실측 파고가 [N]m로 고속단정(RIB) 운용 권장 상한에 근접했습니다. Sea State 4 이상 여부를 확인하시겠습니까?","evidenceTool":["GPS 최근접 부이 실시간 파고","전국 파고 랭킹"],"freqLimit":"cooldown_3h","needsSafetyPhrase":false},
 {"ruleId":"TR-NAVY-05","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"wave_height","op":">=","threshold":3,"unit":"m"}],"context":"원본 warning contains 풍랑주의보 → 파고3m 동치로 정규화, 3~5일 내 훈련 예정"},"ment":"훈련 예정 기간(D+[N]일) 해역의 중기예보에서 풍랑주의보 수준(파고 3m 이상) 기상이 예고됩니다. 훈련 일정 조정을 위한 상세 시계열 예보를 미리 확인해 드릴까요?","evidenceTool":["중기예보(3~10일)","해구별 72h 시계열"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-NAVY-06","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[],"context":"SAR 키워드(익수·표류·침몰) 발화 — 순수 발화 게이트(수치 조건 없음)"},"ment":"표류 예측에 필요한 현재 유향·유속과 풍향·풍속을 한눈에 보여드립니다. 가장 가까운 부이 실측값도 함께 제공할까요?","evidenceTool":["유향·유속","해상 단기예보(풍향·풍속)","GPS 최근접 부이"],"freqLimit":"cooldown_1h","needsSafetyPhrase":false},
 {"ruleId":"TR-NAVY-07","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"wind_speed","op":">=","threshold":17.2,"unit":"m/s"}],"context":"풍속 랭킹 조회 시 보퍼트 8↑ 해역 존재"},"ment":"[해역명]이 현재 보퍼트 8등급(풍속 17m/s 이상) 이상으로 전국 최악 해황입니다. 해당 해역 특보 및 72시간 예보를 바로 확인하시겠습니까?","evidenceTool":["전국 풍속 랭킹","해상특보","해구별 시계열"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-NAVY-08","jikgun":"navy","trigger":{"logic":"SINGLE","conditions":[{"metric":"wind_speed","op":">=","threshold":15,"unit":"m/s"}],"context":"헬기 이착함 문의 발화"},"ment":"현재 풍속이 [N]m/s로 헬기 이착함 운용 기상 기준에 근접했습니다. 갑판풍 방향 및 향후 3시간 풍속 예보를 확인하시겠습니까?","evidenceTool":["부이 실시간 풍속","해상 단기예보","해구별 72h 시계열"],"freqLimit":"cooldown_3h","needsSafetyPhrase":false}
]
```
정합: 01 파고5 = danger(5.0). 04 파고1.5 < safe(2.5) — 고속단정은 함정보다 보수적이라 별도 운용 상한으로 타당(직군 함정 임계와 별개). 06 조건 배열 공란 = 발화 게이트 전용.

### 2.6 mof (해양수산부) — _thresholds: 정책 트리거 = 풍랑특보 발효 / wind danger 17
```json
[
 {"ruleId":"TR-MOF-01","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"warning","op":"==","threshold":"풍랑경보","unit":""},{"metric":"warning_zone_count","op":">=","threshold":2,"unit":"count"}],"context":"확장 metric warning_zone_count"},"ment":"현재 [X]개 해구에 풍랑경보가 발효되어 있습니다. 전 어선 출항 금지 및 피항 기준에 해당합니다. 해구별 파고·풍속 예보 72시간 시계열을 확인하시겠습니까?","evidenceTool":["해상특보(발효 해구 목록)","해구별 시계열","전국 파고/풍속 랭킹"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-MOF-02","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":72,"unit":"h"},{"metric":"wind_speed","op":">=","threshold":33,"unit":"m/s"}],"context":"중심 최대풍속(태풍 강도)"},"ment":"태풍 [이름]이 [X]시간 후 영향권에 들어옵니다. 항만·어항 사전점검, 어선 피항, 양식시설 긴급조치 체크리스트를 브리핑해 드릴까요? 현재 태풍 진행 경로와 해역별 예상 파고를 함께 보여드릴 수 있습니다.","evidenceTool":["태풍 현황·경로","해상 단기예보","해상특보","해양종합정보 지도"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-MOF-03","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"water_temp","op":">=","threshold":26,"unit":"°C"},{"metric":"visibility","op":">=","threshold":10,"unit":"km"},{"metric":"month_range","op":"in","threshold":"07-09","unit":"month"}],"context":"확장 metric month_range"},"ment":"인근 해역 수온이 [X]℃로 고수온 특보 기준(28℃)에 근접하고 있습니다. 양식어장 피해 예방 조치가 필요할 수 있습니다. 현재 관측 수온과 향후 기상 전망을 확인하시겠습니까?","evidenceTool":["기상부이 관측(수온·시정)","GPS 최근접 부이","중기예보"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-MOF-04","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"간조","unit":""},{"metric":"tide_range","op":">=","threshold":500,"unit":"cm"},{"metric":"wind_speed","op":">=","threshold":7,"unit":"m/s"}],"context":"확장 metric tide_range(특대조)"},"ment":"오늘 [X]시에 특대조 간조가 예정되어 있어 바다갈라짐 조건이 형성됩니다. 그러나 현재 풍속 [X]m/s로 연안 체험 안전에 주의가 필요합니다. 조석 일정과 현재 기상을 동시에 확인하시겠습니까?","evidenceTool":["조석/물때","생활지수(바다갈라짐)","해상 단기예보"],"freqLimit":"once_per_day","needsSafetyPhrase":true},
 {"ruleId":"TR-MOF-05","jikgun":"mof","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<=","threshold":1,"unit":"km"}],"context":"낚시 생활지수 보통↑"},"ment":"현재 [해역] 일대에 해무가 발생하여 시정이 [X]km 이하입니다. 소형 어선·낚시어선의 충돌사고 위험이 높습니다. 해무 CCTV 영상과 시정 부이 관측값을 확인하시겠습니까?","evidenceTool":["해무 CCTV","기상부이 관측(시정)","생활지수(바다낚시)","해상 단기예보"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-MOF-06","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"month_range","op":"in","threshold":"02-03","unit":"month"},{"metric":"warning","op":">=","threshold":"풍랑주의보","unit":""},{"metric":"warning_zone_count","op":">=","threshold":3,"unit":"count"}],"context":"어선 사고 취약시기 + 다중 해구 특보"},"ment":"현재 어선 사고 집중 취약시기(2~3월)에 [X]개 해구에 풍랑특보가 발효 중입니다. 전국 파고·풍속 랭킹 및 72시간 시계열 예보를 통해 고위험 해역을 우선 점검하시겠습니까?","evidenceTool":["해상특보(발효 해구 수)","전국 파고/풍속 랭킹","해구별 시계열"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-MOF-07","jikgun":"mof","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"조금","unit":""},{"metric":"wave_height","op":"<=","threshold":1,"unit":"m"}],"context":"어항·공사 질의 발화 + 48시간 내 태풍 영향 없음(태풍 부재가 작업 적기 전제). 원본 typhoon_eta<=48 은 '작업 적기'와 모순(태풍 임박 = 작업 불가)이므로 수치조건에서 제거하고 '태풍 없음'을 context 게이트로 이관"},"ment":"향후 [X]시간 내 소조기 간조가 예정되어 있고 파고가 낮은 작업 적기입니다. 조석 일정과 해역 파고 예보를 함께 확인하시겠습니까?","evidenceTool":["조석/물때","해상 단기예보","유향·유속","수심"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-MOF-08","jikgun":"mof","trigger":{"logic":"SINGLE","conditions":[],"context":"발화 키워드(해상풍력|풍황|입지) 전용 게이트"},"ment":"해상풍력 입지 검토를 위해 현재 해역의 풍속·파고·수심·해류 조건을 요약해 드릴 수 있습니다. 다만 장기 풍황 통계(10년 이상)는 앱 내 제공 범위를 초과하므로 기상청 기후데이터포털 활용을 권장합니다.","evidenceTool":["해상 단기예보","기상부이 관측","유향·유속","수심","[GAP] 기상청 기후데이터포털(외부)"],"freqLimit":"cooldown_24h","needsSafetyPhrase":false}
]
```
정합: 01 풍랑경보 = 정책 트리거 표준. 03 수온26 = 주의보(28)-2℃ 근접. 04 풍속7 = mof safe(12) 미만이나 갯벌 체험 안전 보수경고로 타당. TR-MOF-07 의 원본 typhoon_eta<=48 은 '작업 적기'와 논리 모순(태풍 임박=작업 불가, 게다가 태풍 부재 시 None→미충족으로 정상 케이스가 발동 안 됨)이므로 수치조건에서 제거하고 '48h 내 태풍 없음'을 context 게이트로 이관.

### 2.7 local_gov (지방자치단체) — _thresholds: wave danger 3.0 / wind danger 17 / 해수욕장 통제 파고≥1.5
```json
[
 {"ruleId":"TR-GOV-01","jikgun":"local_gov","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":">=","threshold":1.5,"unit":"m"},{"metric":"time_window","op":"<=","threshold":12,"unit":"h"}],"context":"향후 6~12h 단기예보/최근접 부이"},"ment":"내일 오전 [해역명] 파고가 1.5m를 넘을 것으로 보입니다. 해수욕장 입욕통제 사전 검토 및 안전요원 추가 배치를 고려해 보세요.","evidenceTool":["해구별 72h 시계열","GPS 최근접 부이","해상 단기예보"],"freqLimit":"once_per_day","needsSafetyPhrase":true},
 {"ruleId":"TR-GOV-02","jikgun":"local_gov","trigger":{"logic":"SINGLE","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":48,"unit":"h"}],"context":"태풍 경로상 해역 도달"},"ment":"태풍이 48시간 안에 영향권에 들어올 것으로 예상됩니다. 어항 계류 선박 이동 명령, 해안행사 취소 공지, 대피 권고문 작성을 지금 시작하시겠어요?","evidenceTool":["태풍 현황·경로","해상특보","72h 시계열"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-GOV-03","jikgun":"local_gov","trigger":{"logic":"AND","conditions":[{"metric":"tide_phase","op":"==","threshold":"사리","unit":""},{"metric":"warning","op":"in","threshold":["풍랑경보","태풍특보"],"unit":""}],"context":"사리 ±2일 + 특보 동시"},"ment":"현재 대조기(사리) 기간에 풍랑경보까지 겹쳐 있습니다. 해안 저지대 침수 위험이 평소보다 높으니 대피 안내 방송 및 재난문자 발송을 검토하세요.","evidenceTool":["조석/물때","해상특보","조석 바텀시트"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-GOV-04","jikgun":"local_gov","trigger":{"logic":"AND","conditions":[{"metric":"water_temp","op":">=","threshold":28,"unit":"°C"},{"metric":"time_window","op":">=","threshold":3,"unit":"h"}],"context":"3시간 연속 유지"},"ment":"현재 [부이명] 수온이 28°C를 넘고 있습니다. 국립수산과학원 고수온 경보 발령 여부를 확인하고, 관할 양식어가에 산소공급기 가동 및 사료공급 중단 지시를 고려하세요.","evidenceTool":["기상부이 관측(수온)","GPS 최근접 부이"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-GOV-05","jikgun":"local_gov","trigger":{"logic":"OR","conditions":[{"metric":"wind_speed","op":">=","threshold":10,"unit":"m/s"},{"metric":"wave_height","op":">=","threshold":2,"unit":"m"}],"context":"중기예보 주말"},"ment":"이번 주말 [해역명] 기상 예보가 레저 운영 기준을 초과할 수 있습니다. 행사·레저사업자 사전 통보 및 안전요원 배치 계획을 미리 조정하시겠어요?","evidenceTool":["중기예보(3~10일)","해구별 72h 시계열","생활지수(서핑·낚시)"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-GOV-06","jikgun":"local_gov","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<","threshold":1,"unit":"km"}],"context":"해무 CCTV/부이 시정 저하"},"ment":"현재 [지점명] 해상 시정이 크게 낮아졌습니다. 관광선박 및 낚시어선 출항 통제 또는 운항 자제 권고 공지를 발령할 시점입니다.","evidenceTool":["해무 CCTV","기상부이 관측(시정)"],"freqLimit":"on_state_change","needsSafetyPhrase":true},
 {"ruleId":"TR-GOV-07","jikgun":"local_gov","trigger":{"logic":"AND","conditions":[{"metric":"warning","op":"==","threshold":"생활지수나쁨","unit":""},{"metric":"time_window","op":"==","threshold":"개장기간중","unit":"flag"}],"context":"확장: 생활지수 등급·개장기간 플래그"},"ment":"오늘 낚시·서핑 조건이 나쁨으로 나타납니다. 해수욕장 안내판 및 SNS 채널을 통해 이용 자제 공지를 발송하시겠어요?","evidenceTool":["생활지수(바다낚시·서핑)","해상 단기예보"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-GOV-08","jikgun":"local_gov","trigger":{"logic":"SINGLE","conditions":[{"metric":"wave_height","op":"rank_top","threshold":3,"unit":"national_rank"}],"context":"확장: 전국 파고 랭킹 1~3위"},"ment":"[해역명]이 현재 전국 파고 3위권에 진입했습니다. 도 재난안전대책본부 및 해양수산부에 선제 상황 보고 자료를 준비하시겠어요?","evidenceTool":["전국 파고·풍속 랭킹","해상특보"],"freqLimit":"on_state_change","needsSafetyPhrase":false}
]
```
정합: 01 파고1.5 = local_gov caution(2.5) 미만이나 해수욕장 통제 기준(파고≥1.5, comment 일치). 04 수온28 = 고수온 주의보 기준. 05 풍속10 < safe(12) 이나 레저 운영 기준으로 별개.

### 2.8 public_org (공공기관) — _thresholds: wave danger 4.0 / wind danger 22 / 입출항 통제 풍속≥14
```json
[
 {"ruleId":"TR-ORG-01","jikgun":"public_org","trigger":{"logic":"OR","conditions":[{"metric":"wind_speed","op":">=","threshold":8,"unit":"m/s"},{"metric":"wave_height","op":">=","threshold":0.5,"unit":"m"}],"context":"접안/이안/입항/항만작업 발화"},"ment":"현재 ○○해역 예보 풍속이 [X] m/s입니다. 대형 선박 접안 한계(8~12 m/s)에 근접하고 있어요. 오늘 오후 이후 시계열 예보도 확인해 드릴까요? 크레인 작업 한계(10 m/s)도 함께 알려드릴게요.","evidenceTool":["해구별 시계열(~72h)","기상부이 관측","해상 단기예보"],"freqLimit":"cooldown_3h","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-02","jikgun":"public_org","trigger":{"logic":"OR","conditions":[{"metric":"wave_height","op":">=","threshold":2.0,"unit":"m"},{"metric":"wind_speed","op":">=","threshold":14,"unit":"m/s"}],"context":"조사선/연구선/KIOST/KHOA/FIRA 발화"},"ment":"내일 ○○해구 예보 파고 [X] m, 풍속 [Y] m/s입니다. 연구선 일반 출항 제한 기준(파고 2~3 m, 풍속 14 m/s)과 비교하면 [출항 가능/주의/출항 제한 권고]입니다. 72시간 시계열로 이번 주 최적 출항일도 찾아드릴까요?","evidenceTool":["해구별 시계열(~72h)","단기예보","GPS 최근접 부이"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-03","jikgun":"public_org","trigger":{"logic":"SINGLE","conditions":[],"context":"오염|기름유출|방제|확산 발화 키워드 전용 게이트, KOEM 문맥(원본 current_speed>0 은 항상참이라 제거 — 유향·유속은 멘트 슬롯에서 도구결과로 주입)"},"ment":"현재 ○○해역 유향은 [방향], 유속은 [X] kn입니다. 오염물질이 [방향]으로 확산될 가능성이 높아요. 풍속 [Y] m/s, 풍향 [방향]도 고려하면 방제선 배치 우선 해역을 [방향 예시]쪽으로 권고드려요.","evidenceTool":["유향·유속","기상부이 관측(풍속·풍향)","단기예보"],"freqLimit":"cooldown_1h","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-04","jikgun":"public_org","trigger":{"logic":"SINGLE","conditions":[{"metric":"typhoon_eta","op":"<=","threshold":72,"unit":"h"}],"context":"또는 태풍|대피|고박|항만폐쇄 발화(키워드 대안 분기는 context 게이트)"},"ment":"태풍 [이름]이 [X]시간 후 ○○ 인근 해역에 영향을 줄 것으로 예상됩니다. 현재 예상 최대 파고 [X] m, 풍속 [Y] m/s입니다. 선박 대피·하역 중단 기준(태풍 경보 시 전면 중단)에 맞춰 지금 바로 단계별 일정 확인해 드릴까요?","evidenceTool":["태풍 현황·경로","중기예보","해상특보","해상일기도"],"freqLimit":"once_per_event","needsSafetyPhrase":true},
 {"ruleId":"TR-ORG-05","jikgun":"public_org","trigger":{"logic":"OR","conditions":[{"metric":"wind_speed","op":">=","threshold":14,"unit":"m/s"},{"metric":"warning","op":"==","threshold":"풍랑주의보","unit":""}],"context":"또는 VTS|관제|입출항통제|기상악화통보 발화"},"ment":"현재 ○○해역에 [풍랑주의보/경보]가 [발령 중/발령 예정]입니다. 소형선 입출항 통제 기준에 해당해요. 현재 기상부이 실황(파고 [X] m, 풍속 [Y] m/s)을 선박 통보용으로 정리해 드릴까요? 향후 6~12시간 예보도 함께 드릴게요.","evidenceTool":["해상특보","기상부이 관측","단기예보","해구별 시계열"],"freqLimit":"on_state_change","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-06","jikgun":"public_org","trigger":{"logic":"AND","conditions":[{"metric":"wave_height","op":"<","threshold":1.5,"unit":"m"},{"metric":"wind_speed","op":"<","threshold":12,"unit":"m/s"}],"context":"준설|잠수작업|수중공사|ROV|측량 발화 + 72h 작업창 탐색"},"ment":"○○해역 72시간 예보를 보면, [요일 시간대]에 파고 [X] m 이하, 풍속 [Y] m/s 이하의 작업 가능 창이 있어요. 준설선 작업 한계(파고 1.5 m, 풍속 12 m/s) 기준으로 가장 유리한 시간대를 알려드릴게요.","evidenceTool":["해구별 시계열(~72h)","중기예보","기상부이 관측"],"freqLimit":"once_per_day","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-07","jikgun":"public_org","trigger":{"logic":"SINGLE","conditions":[{"metric":"visibility","op":"<","threshold":1.0,"unit":"km"}],"context":"또는 안개|해무|시정 발화(키워드 대안 분기는 context 게이트)"},"ment":"현재 ○○해역 시정이 약 [X] km로 해무 발생 구간입니다. 해무 CCTV로 실황 확인하시겠어요? VTS 관제 또는 크레인 작업 판단에 필요한 인근 부이 시정값도 함께 보여드릴게요.","evidenceTool":["해무 CCTV","기상부이 관측(시정)","단기예보"],"freqLimit":"on_state_change","needsSafetyPhrase":false},
 {"ruleId":"TR-ORG-08","jikgun":"public_org","trigger":{"logic":"SINGLE","conditions":[{"metric":"tide_phase","op":"==","threshold":"간조","unit":""}],"context":"갯벌|조간대|바다갈라짐|저조|저수위 발화(키워드 분기는 context 게이트)"},"ment":"내일 ○○지역 최저 조위는 [X] cm(기준면)로 [시각]에 예상됩니다. 갯벌 조사 최적 시간대는 저조 전후 약 1~2시간입니다. 해상 기상도 파고 [X] m로 안전 수준이에요. 갯벌 조사 일정 맞춰 드릴까요?","evidenceTool":["조석/물때","조석 바텀시트","생활지수(바다갈라짐)","기상부이 관측"],"freqLimit":"once_per_day","needsSafetyPhrase":false}
]
```
정합: 02 파고2.0 = public_org safe(2.0) 경계, 연구선 출항 기준으로 타당. 05 풍속14 = comment 의 입출항 통제 기준(≥14) 일치. 01 풍속8 = 접안 작업 한계로 직군 임계와 별개.

## 3. 자체검토(2차 pass) 요약

- **임계 정합**: 각 직군 표 하단에 _thresholds.json 대조 메모 기재. 위험 경고형 임계(FISH-01 3m, NAVY-01 5m, CG-01 풍랑경보, GOV-04 28℃)는 직군 danger/특보 기준과 일치. 활동별 운용 임계(접안·고속단정·연구선 등)는 직군 일반 임계와 의도적으로 다르며 context 에 근거 명시.
- **metric/op 표준화**: 표준 8키는 1.1, 비표준은 1.2 확장으로 분리. `delta>=`·비율·증분은 파생값 + context 로 강등, `rank_top`은 확장 metric 으로 이관, `contains/in`은 enum/리스트 매칭으로 정규화. 발화·이력·시간대·위치 조건은 모두 `context` 게이트로 일원화.
- **안전문구 1회 정책**: 1.4 에 세션 1회 부착 + 등급 상승 시 1회 재부착 규칙 정의. `needsSafetyPhrase` 필드로 64개 규칙에 플래그 부여(위험 경고형 true).
- **환각 방지**: 모든 멘트의 수치/방향/시각/해역명은 `[..]`·`○○` 슬롯으로만 표기하고 `evidenceTool` 에 실제 데이터 출처를 명시. LLM 은 슬롯을 도구결과로만 채우고 빈 슬롯은 도구 호출 전 단정 금지. 도구 미보유 GAP(LEIS-08 해파리, MOF-08 장기풍황)은 외부 연동으로 표기.
- **이상 항목 보정(2차 패스 정정 반영)**: CG-04/ORG-03 의 `current_speed>=0/>0`(항상참)은 단순 주석 처리가 아니라 수치조건 자체를 제거하고 `conditions:[]` 발화 키워드 전용 게이트로 정정(NAVY-06·MOF-08 과 동일 패턴으로 일원화). MOF-07 의 typhoon_eta<=48 모순은 수치조건에서 제거하고 '태풍 없음'을 context 게이트로 이관. 단일 조건인데 logic=AND/OR 로 표기됐던 CG-01·NAVY-02/05·ORG-04/07/08 은 logic=SINGLE 로 정규화(키워드 대안 분기는 context 게이트). CG-01·NAVY-02/05 의 원본 `warning contains 위치/특보문자열`은 동치 정규화.

## 4. 트리거 평가기 의사코드

```python
def evaluate_rules(rules, ctx):
    """
    ctx: { jikgun, metrics{표준키: 수치}, derived{파생값}, warning_level,
           tide_phase, typhoon_eta, time_now, gps, utterance, history,
           session_state{ safety_phrase_shown, last_fired{ruleId:ts}, last_warning_level } }
    """
    fired = []
    for r in rules:
        if r["jikgun"] != ctx["jikgun"]:
            continue
        if not pass_context_gate(r["trigger"]["context"], ctx):   # 발화·시간대·이력·위치·확장metric
            continue
        if not eval_conditions(r["trigger"], ctx):                # 표준 수치 비교
            continue
        if not freq_allow(r["freqLimit"], r["ruleId"], ctx):       # 빈도제한
            continue
        ment = fill_slots(r["ment"], r["evidenceTool"], ctx)       # 슬롯을 도구결과로만 주입
        if has_unfilled_slot(ment):                                # 도구결과 없으면 발동 보류(환각 방지)
            continue
        if r["needsSafetyPhrase"]:
            ment = attach_safety_phrase(ment, ctx)                 # 세션 1회 정책
        fired.append({"ruleId": r["ruleId"], "message": ment})
        mark_fired(r["ruleId"], ctx)
    return prioritize(fired)   # 안전 경고형(needsSafetyPhrase) 우선, 동률은 위험 등급순

def eval_conditions(trig, ctx):
    conds = trig["conditions"]
    if not conds:                       # 조건 공란 = 발화 게이트 전용 → 게이트 통과면 참
        return True
    results = [cmp(c, ctx) for c in conds]
    return all(results) if trig["logic"] in ("AND","SINGLE") else any(results)

def cmp(c, ctx):
    val = resolve_metric(c["metric"], ctx)   # 표준키→metrics, 비율/증분→derived, warning→등급정수
    if val is None: return False             # 데이터 없음 = 미충족(환각 방지)
    op = c["op"]
    if op == "==":       return val == c["threshold"]
    if op == ">=":       return val >= c["threshold"]
    if op == ">":        return val >  c["threshold"]
    if op == "<=":       return val <= c["threshold"]
    if op == "<":        return val <  c["threshold"]
    if op == "in":       return val in c["threshold"]
    if op == "contains": return c["threshold"] in val
    if op == "within":   return within_window(val, c["threshold"], c["unit"])
    if op == "rank_top": return val <= c["threshold"]   # 순위는 작을수록 상위
    return False

def attach_safety_phrase(ment, ctx):
    SP = "긴급 상황은 즉시 122(해양경찰)로 신고하세요. 본 안내는 예보·관측 기반 참고용입니다."
    s = ctx["session_state"]
    escalated = ctx["warning_level"] > s.get("last_warning_level", 0)
    if not s["safety_phrase_shown"] or escalated:
        s["safety_phrase_shown"] = True
        s["last_warning_level"] = ctx["warning_level"]
        return ment + " " + SP
    return ment   # 이미 1회 부착 + 등급 미상승 → 생략
```

> 평가기 적용 순서: ① 직군 필터 → ② context 게이트(확장 metric·발화·시간) → ③ 표준 수치 조건 → ④ 빈도제한 → ⑤ 슬롯 주입(환각 가드) → ⑥ 안전문구(1회) → ⑦ 우선순위 정렬.
