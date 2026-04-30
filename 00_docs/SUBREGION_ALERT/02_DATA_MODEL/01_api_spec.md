# 자식해역 특보 표출 — 2.1 방재기상 API 명세

## 0. 본 파일의 위치

본 파일은 `02_DATA_MODEL/` 시리즈의 첫 번째 파일이며, 자식해역 정보를 가져오는 **방재기상시스템 API**의 엔드포인트와 호출 방법을 정리합니다.

---

## 1. 기본 정보

### 1.1 시스템

- 시스템 명: 모바일 방재기상시스템 (Mobile Disaster Prevention Weather System)
- 운영: 기상청
- 웹 페이지: https://afso.kma.go.kr/m/wrnSpec.jsp

### 1.2 페이지 구조

웹 페이지는 단순한 래퍼이며, 실제 데이터는 다음 흐름으로 표출됩니다.

```
wrnSpec.jsp (래퍼)
   └─ <iframe src="/afsOut/mmr/warning/retMmrSeaWeatherStatus.kfrm">
        └─ <script src="/afsOut/mmr/warning/seaWarningStatus.js">
             └─ AJAX 호출 → /afsOut/mmr/warning/retMmrWarningSeaNow.kajx
```

### 1.3 본 작업의 호출 대상

- 엔드포인트: `POST /afsOut/mmr/warning/retMmrWarningSeaNow.kajx`
- 호스트: `afso.kma.go.kr`
- 전체 URL: `https://afso.kma.go.kr/afsOut/mmr/warning/retMmrWarningSeaNow.kajx`

---

## 2. 요청 명세

### 2.1 HTTP 메서드 및 헤더

```
POST /afsOut/mmr/warning/retMmrWarningSeaNow.kajx HTTP/1.1
Host: afso.kma.go.kr
Content-Type: application/x-www-form-urlencoded; charset=UTF-8
X-Requested-With: XMLHttpRequest
Referer: https://afso.kma.go.kr/afsOut/mmr/warning/retMmrSeaWeatherStatus.kfrm
User-Agent: Mozilla/5.0 (...)
```

### 2.2 요청 파라미터 (form-urlencoded)

| 파라미터 | 값 | 의미 |
|---|---|---|
| `tmFc` | `YYYYMMDDHHMI` 형식 | 조회 기준 시각. 보통 현재 시각 |
| `stnId` | `108` | 본청 코드. 전국 통합 조회 시 108 |
| `fe` | `f` | 발표(`f`) 또는 발효(`e`) 모드. 본 작업은 `f` |
| `mmr` | `mmr` | 모바일 방재 호출 식별자 |
| `tmFe` | (빈 문자열) | 발효 시각 별도 지정 (미사용) |

### 2.3 요청 예시

```
POST /afsOut/mmr/warning/retMmrWarningSeaNow.kajx
Body: tmFc=202604302200&stnId=108&fe=f&mmr=mmr&tmFe=
```

### 2.4 함수 형태

```
function buildAfsoRequest():
  now = formatDateTime(currentTime(), "YYYYMMDDHHMI")
  return {
    method: "POST",
    url: "https://afso.kma.go.kr/afsOut/mmr/warning/retMmrWarningSeaNow.kajx",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": "https://afso.kma.go.kr/afsOut/mmr/warning/retMmrSeaWeatherStatus.kfrm"
    },
    body: `tmFc=${now}&stnId=108&fe=f&mmr=mmr&tmFe=`
  }
```

---

## 3. 응답 명세

### 3.1 응답 형식

- HTTP Status: 200 OK (정상)
- Content-Type: `application/json; charset=UTF-8`
- Body: JSON

### 3.2 응답 최상위 구조

```json
{
  "meta": {
    "msg": "",
    "err": "false",
    "errCd": "",
    "txId": "TxId_172.20.134.66_8082_n_1f865"
  },
  "data": {
    "input": {
      "tmFc": "202604302200",
      "stnId": "108",
      "fe": "f",
      "mmr": "mmr",
      "tmFe": ""
    },
    "metData": [
      ... // 해역별 행 배열
    ],
    "rMetData": [
      ... // 보조 데이터 (본 작업 미사용)
    ]
  }
}
```

### 3.3 meta 필드

| 필드 | 의미 |
|---|---|
| `msg` | 메시지 (정상 시 빈 문자열) |
| `err` | 오류 여부 ("true" / "false") |
| `errCd` | 오류 코드 |
| `txId` | 트랜잭션 ID (디버깅용) |

### 3.4 data 필드

| 필드 | 의미 |
|---|---|
| `input` | 요청 파라미터 echo |
| `metData` | 해역별 특보 정보 배열 (본 작업의 핵심 데이터) |
| `rMetData` | 보조 데이터 (본 작업에서는 사용하지 않음) |

---

## 4. metData 배열의 행 구조

### 4.1 한 행의 필드

```json
{
  "tmFc": "202604301400",
  "tmEfOrg": "",
  "tmEf": "202604301400",
  "tmEd": "202605010600",
  "t07": "",
  "t08": "",
  "regUp": "S1232000",
  "regUpKo": "제주도서부앞바다",
  "regId": "S2122000",
  "regKo": "가파도연안바다",
  "wrnSeq": "1",
  "wrnTp": "풍랑",
  "wrnLvlName": "주의보",
  "wrnLvl": "2",
  "wrnCmd": "",
  "stnId": "108",
  "wrnGrd": "",
  "typ": "",
  "cnt": "",
  "rpt": ""
}
```

### 4.2 빈 행 (특보 없음 신호)

```json
{
  "tmFc": "",
  "tmEfOrg": "",
  "tmEf": "",
  "tmEd": "",
  "t07": "",
  "t08": "",
  "regUp": "S1131000",
  "regUpKo": "동해남부앞바다",
  "regId": "S1131100",
  "regKo": "울산앞바다",
  "wrnSeq": "99",  ← "99"가 빈 행 식별자
  "wrnTp": "",
  "wrnLvlName": "",
  "wrnLvl": "",
  "wrnCmd": "",
  "stnId": "",
  "wrnGrd": "",
  "typ": "",
  "cnt": "",
  "rpt": ""
}
```

각 필드의 상세 의미는 `02_response_fields.md` 참조.

---

## 5. 호출 빈도 및 예상 응답 크기

### 5.1 호출 빈도

- 1분마다 1회 호출 (스케줄러)
- 부모 통보문 폴링과 같은 사이클에서 순차 실행

### 5.2 응답 크기

- 정상 응답: 약 30~50 KB (해역 수에 따라)
- 모든 해역이 빈 행이라도 응답 크기 비슷 (전체 트리가 항상 포함됨)

### 5.3 응답 시간

- 평균: 100~500ms
- 최대: 2초 이내 (정상 운영 시)
- 타임아웃 권장: 5초

---

## 6. 인증 / 세션

### 6.1 인증 방식

방재기상시스템은 별도의 API 키 또는 인증 토큰을 요구하지 않습니다. 다만 다음 헤더가 권장됩니다.

- `X-Requested-With: XMLHttpRequest` (AJAX임을 표시)
- `Referer: 페이지 경로` (CSRF 방지용으로 보일 수 있음)
- `User-Agent: 브라우저 형식` (봇 차단 방지)

### 6.2 jsessionid

응답 또는 페이지에 `jsessionid`가 등장할 수 있으나, 본 API 호출에는 필수가 아닙니다.

### 6.3 IP 제한

- 알려진 IP 제한 없음
- 단, 과도한 호출 시 차단 가능성 (1분 간격 호출은 안전)

---

## 7. 오류 응답 형태

### 7.1 정상 시

```json
{
  "meta": { "err": "false", "errCd": "" },
  "data": { "metData": [ ... ] }
}
```

### 7.2 오류 시

```json
{
  "meta": { "err": "true", "errCd": "...", "msg": "..." },
  "data": null
}
```

### 7.3 HTTP 5xx

서버 오류 시 HTTP 500 등이 반환될 수 있음.

### 7.4 우리 앱의 오류 처리

자세한 오류 분류 및 처리는 `03_OPERATIONS/01_error_classification.md` 참조.

---

## 8. 호출 시점 기준 시각의 정밀도

### 8.1 `tmFc` 파라미터의 정밀도

- 분 단위까지 (초 단위 미지원): `YYYYMMDDHHMI`
- 즉, 같은 1분 안의 호출은 모두 같은 `tmFc`를 사용

### 8.2 응답 데이터의 시각 정밀도

응답에 포함되는 `tmFc`, `tmEf`, `tmEd`도 모두 분 단위까지의 정밀도.

---

## 9. 본 파일 다음 작업

- 다음 파일: `02_response_fields.md`
- 주제: 응답 필드 의미 상세 (regId, wrnSeq, tmEd 등)
