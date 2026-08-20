# pinned/ — 라이브 검증 "같은 질문 다시 묻기"용 고정 문항

## 왜 있나
라이브 검증은 법마다 질문 하나를 골라 실제 챗봇에 물어 근거를 대조한다. 그런데 문항을
**매번 새로 고르면** 고치기 전후를 비교할 수 없다 — 다른 질문을 본 것이라 "고쳐졌나?"에
답을 못 한다(2026-08-18, 사용자 지적으로 정리).

그래서 한 라운드에서 실제로 물었던 질문을 그대로 박아 두고, 다음 실행 때 **글자 하나
바꾸지 않고 다시 묻는다.**

## 파일
- `r22_questions.json` — 22라운드 라이브 검증에서 실제로 물은 문항 65건.
  각 항목: `{law, question, expected, prev, pass}`. `prev` 는 그때의 판정
  (`missing_evidence` 30 · `confirmed` 23 · `clarify` 12).
- `pin22_batch0..9.json` — 위 65건을 10묶음으로 나눈 것(`{laws:[...], round, pass}`).
  각 law 객체는 `audit18_groups.json` 의 법 정보에 `question`·`expected`·`prev` 를 얹은 것.

## 쓰는 법
```
Workflow({scriptPath: '…/loop/live_verify.js',
          args: {lawsPath: '…/loop/pinned/pin22_batch0.json', round: 22, pass: 3}})
```
`laws[].question` 이 있으면 `live_verify.js` 가 **문항을 고르지 않고** 그 질문을 그대로 묻는다.
결과에 `transitions`(전 → 후 분포)·`recovered`(못 꺼내던 것이 살아난 법)·`regressed`
(되던 것이 깨진 법)가 함께 나온다.

## 읽는 법
- `recovered` = 이번에 고친 것이 실제로 사용자 앞에서 살아난 건수.
- `regressed` = **가장 중요하다.** 고치다 멀쩡하던 것을 깨뜨렸다는 뜻이라 0이어야 한다.
  `confirmed` 23건을 함께 다시 묻는 이유가 이것이다(되돌이 검사).
- `clarify` 12건은 되묻기를 빠져나오지 못한 것 — 답 자체에 도달을 못 했으므로 근거 대조가
  성립하지 않는다. 개선 여부는 여기서도 볼 수 있다.

## 주의
- 이 파일들은 **한 라운드의 기록**이다. 다음 라운드에서 새로 물은 문항이 생기면
  `r<N>_questions.json` 으로 따로 만든다(덮어쓰지 않는다 — 라운드 간 비교가 목적이므로).
- 질문 문장을 손으로 고치지 마라. 고치는 순간 그 문항은 전후 비교 대상에서 빠진다.
