# VM ChatGPT(Codex) 답변 — 운영 기록·이어하기 안내서

> 작성 2026-09-27(KST). 이 문서는 **"어디까지 됐고, 무엇이 어디에 있고, 내일 무엇부터 하면 되나"** 만 모은다.
> 설계 결정·사용자 확정 원문·시험 전체 수치는 설계 문서 [`codex_client.design.md`](codex_client.design.md)에 있다(이 문서와 어긋나면 그쪽과 코드가 우선).

## 1. 한 줄 요약

나리야 챗봇의 AI 판단(질문 이해·검색어 확장·되묻기 판단·답변 작성)을, **관리자 기기 질문에 한해** Gemini 대신
**VM 에 로그인된 ChatGPT 정액제(Codex CLI)** 로 답하게 했다. 앱 서버는 Fly 그대로이고, VM 은 Fly 에 "처리할 질문 있어?"
하고 **밖으로만** 물으러 간다(VM 에 들어오는 문은 없다).

```
[앱 질문] → Fly /api/legal/ask ─(관리자 센터 설정이 ChatGPT 모델 + 관리자 기기 + 작업자 연결됨)→ Fly 대기열
                                                                                     ▲        │
                             VM 작업자(서비스 nrya-codex-worker) ── poll ─────────────┘        │
                                   │ codex exec -m <모델> (ChatGPT 정액제)                     │
                                   └──────────── result ─────────────────────────────────────▶ 답변 이어서 진행
```

## 2. 지금 상태 (2026-09-27 22시 KST 기준)

| 항목 | 상태 | 근거 |
|---|---|---|
| Fly 서버 코드(중계·관리자 센터 설정) | **배포됨** | PR #1335·#1338 머지, Deploy #2161·#2163 성공 |
| Fly 시크릿 `NRYA_CODEX_SECRET` | **설정됨**(사용자가 Fly 웹에서 넣고 Deploy) | poll 창구 응답 404 → 401 로 바뀜을 VM 에서 확인 |
| 관리자 센터 설정 | 답변 AI 모델 **GPT Luna**(기본) · 일반 사용자 적용 **꺼짐**(기본) | `GET /api/legal/config` → `gpt-6-luna False`, 앱 화면 사진 확인 |
| VM 작업자 | **systemd 서비스로 상시 가동**, 코드 `e813814e`(답 전송 재시도 포함) | `journalctl` 에 `모델 gpt-6-luna` 시작 줄 |
| 답변 끝 AI 표시(「※ 이 답변은 … 모델이 답했습니다.」) | **코드 완료·미배포** — PR #1340 | `test_codex_bridge` 33 PASS |
| 작업자 답 전송 재시도(최대 4회) | VM 에는 적용됨(브랜치에서 직접 받음) · main 미머지 — PR #1340 | 가짜 서버로 재현·확인 |
| 검색 문제 2건(인천항 좌표·별표1 25호) | **다른 세션으로 인계** — 이 세션의 초안 코드는 되돌림 | 설계 문서 §6 「확인 안 됨 4건 원인 조사」 |

## 3. 파일 지도

| 파일 | 역할 |
|---|---|
| `local_server/services/codex_bridge.js` | Fly 쪽 중계: 어느 요청을 codex 로 보낼지 결정(`withRequest`), 대기열, 작업자 창구(`poll`·`result`), 답변 끝 표시(`answerLabel`) |
| `local_server/services/gemini_client.js` | 입구 3곳(`hasAnyKey`·`callGeminiRaw`·`callGeminiStream`)에서 codex 표시가 있으면 `codex_bridge` 로 돌린다 |
| `local_server/routes/legal.js` | `/api/legal/ask` 앞 미들웨어, `POST /api/legal/codex/poll`·`/result`, 설정 `answerModel`·`codexForUsers`, 답변 끝 표시 |
| `local_server/scripts/codex_worker.js` | **VM 에서만** 도는 작업자(`codex exec` 호출, 답 전송 재시도) |
| `local_server/scripts/test_codex_bridge.js` | 잠금·설정 조합·왕복·표시 시험(33문항, `verify_all.sh` SUITES 등록) |
| `client/js/ai-chat/ai_chat.js` | 관리자 콘솔 「답변 AI 모델」·「ChatGPT 답변을 일반 사용자에게도 적용」 카드 |
| `local_server/services/codex_client.design.md` | 설계·사용자 확정 원문·시험 결과 전부 |

## 4. 언제 ChatGPT 로 답하나 (결정 순서 — `codex_bridge.withRequest`)

1. Fly 시크릿 `NRYA_CODEX_SECRET` 없음 → **Gemini** (작업자 창구도 404)
2. 요청 본문 `llm:"gemini"` → Gemini (비교 시험 기준군)
3. 요청 본문 `llm:"codex"` + 관리자 토큰 → codex (시험용 — 작업자가 없어도 실패로 드러나게 codex 로 보낸다)
4. 그 밖(앱에서 온 평소 질문): 관리자 센터 모델이 ChatGPT 계열이고 **(관리자 기기 또는 사용자 스위치 켜짐)** 이며
   **작업자가 90초 안에 온 적이 있으면** codex, 아니면 Gemini
- 앱은 관리자 로그인 시 모든 `/api/legal/*` 요청에 관리자 토큰을 자동으로 싣는다 → 관리자 기기 질문은 설정 모델로 간다.
- ⚠「일반 사용자에게도 적용」을 켜면 남이 관리자 개인 ChatGPT 정액제를 쓰게 된다(OpenAI 약관상 계정 공유 위험).
  사용자가 *"책임은 내가 지니까. 진행하고자 해"* 로 확정했고, 기본값은 꺼짐·켤 때 경고창.

## 5. VM 쪽 구성 (무엇을 어떻게 설치했나)

VM: `ubuntu@mois-ai-lab-vm-049`, 저장소 `~/projects/Seagnal`(브랜치 `claude/tender-bardeen-tykz1i` 를 `--depth 1` 로 받음).

| 구성 | 명령·위치 |
|---|---|
| Codex CLI | `sudo npm install -g @openai/codex` (확인 버전 0.157.1) |
| ChatGPT 로그인 | `codex login --device-auth` → 브라우저에서 코드 입력. 정보는 `~/.codex/`(비밀번호와 같다 — 공유·업로드 금지) |
| 비밀 열쇠 | `~/.codex_secret`(`openssl rand -hex 24`, 권한 600). Fly 시크릿 `NRYA_CODEX_SECRET` 과 같은 값 |
| 작업자 서비스 | `/etc/systemd/system/nrya-codex-worker.service` — `User=ubuntu`, `CODEX_MODEL=gpt-6-luna`(서버가 모델을 안 보낼 때의 예비값), `Restart=always` |
| 작업자 기록 | `journalctl -u nrya-codex-worker -f` · 마지막 일감 원본 이벤트 `~/.codex_worker/last.jsonl` |
| 시험 스크립트(VM 홈) | `~/cmp.py`(5문항) · `~/cmp20.py`(20문항 · 현재 codex 만 돌도록 고쳐져 있음) · 결과 `~/cmp20_result*.json` |

자주 쓰는 명령:
```bash
sudo systemctl status nrya-codex-worker --no-pager | head -5     # 살아 있나
sudo systemctl restart nrya-codex-worker                          # 재시작
sudo systemctl stop nrya-codex-worker                             # 끄기(관리자 질문도 Gemini 로 간다)
journalctl -u nrya-codex-worker -f                                # 실시간 기록(Ctrl+C 는 보기만 끈다)
codex   → /status → /quit                                         # 정액제 남은 한도
# 새 작업자 코드 받기(VM 폴더에서 직접 고친 파일이 없을 때만)
cd ~/projects/Seagnal && git fetch --depth 1 origin claude/tender-bardeen-tykz1i && git reset --hard FETCH_HEAD && sudo systemctl restart nrya-codex-worker
```
관리자 토큰(시험 스크립트용):
```bash
read -s -p "관리자 비밀번호: " PW; echo
TOKEN=$(curl -s -X POST https://seagnal-server.fly.dev/api/admin/login -H 'Content-Type: application/json' -d "{\"password\":\"$PW\"}" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("token",""))'); unset PW
echo ${#TOKEN}   # 64 면 성공
```

## 6. 시험 결과 요약 (상세·원문 대조 근거는 설계 문서 §6)

| 시험 | 결과 |
|---|---|
| 연결(어선 등록 1문항) | 4단계 약 24초(Understand 5.7·QueryExpand 5.4·Clarify 4.5·Ask 7.1초), 답이 어선법 제13조① 원문과 일치, 도구 사용 없음 |
| 5문항 Astra(기본 모델) vs Gemini | Astra 답 4·원문 4/4 일치, Gemini 5문항 모두 되묻기. **5시간 한도 −35%p** |
| 같은 5문항 Luna | 답 4·원문 일치. **5시간 한도 −1%p** |
| 20문항 Luna vs Gemini | 답 Luna 14 / Gemini 2. Luna 오답 2(다른 법으로 답 1·다른 법 인용 1), 「확인 안 됨」 4. 한도 −2%p |
| 20문항 Sol | 답 9 · **오답 0** · 되묻기 11. 한도 −17%p |
| 「확인 안 됨」 4건 원인 | 2건 AI(자료가 실렸는데 확정 못 함) · 2건 **검색**(Gemini 도 동일 → 다른 세션 인계) |

판단(사용자와 공유함): 개발·시험용 기본은 **Luna**, 정확도가 중요할 때만 관리자 센터에서 **Sol** 로 바꿔 쓴다.
일반 사용자 적용 스위치는 정확도 확인 전까지 **켜지 않기를 권고**.

## 7. 오늘 겪은 문제와 해결 (재발 시 참고)

| 증상 | 원인 | 조치 |
|---|---|---|
| 한도가 5문항에 35%p 줄었다 | 작업자가 모델을 지정하지 않아 codex 기본 **gpt-6-astra** 사용(생각 강도는 이미 none — 한도는 입력량에서 나감) | 모델 지정(Luna 기본) |
| `test_split_law_ask` 등 시험이 결과를 찍고도 안 끝남 | `codex_bridge` 가 `admin_auth` 를 맨 위에서 불러 그 1시간 `setInterval` 이 프로세스를 붙잡음 | `withRequest` 안에서 늦게 require |
| 시험 20문항 중 1번이 309초 | 작업자의 답 전송이 `fetch failed` 로 끊겼고 재시도가 없어 서버가 5분 시간초과까지 대기 | 전송 최대 4회 재시도(PR #1340) |
| 문서만 바꾼 PR 의 CI 가 1~3초 만에 실패 | GitHub Actions 사용 한도 — 러너가 배정되지 않음 | 사용자가 Billing 한도 변경 후 정상 |
| `test_naver_term_step` 1 FAIL | 그 스위트가 `BOOL_SWITCHES` 끝모양을 정규식으로 봄 — 새 항목을 뒤에 붙였음 | `codexForUsers` 를 목록 앞으로 |
| 규칙집 검사(V5-47) 실패 | 새 스위트 등록 후 규칙집 미재생성 | `python3 scripts/refactor/gen_rulebook.py` |

## 8. 알려진 한계·주의

- **답이 한 번에 뜬다**(Gemini 는 조각 스트리밍, codex 는 완성본). 문항당 20~40초.
- 한 질문이 1분을 넘으면 중간 연결(Fly 프록시)이 끊길 수 있다는 우려가 있으나 **확인하지 못했다**.
- 작업자는 **한 번에 한 질문**만 처리한다. 동시 질문은 줄을 선다.
- Fly 머신은 1대 운영(사용자 확인). 늘리면 메모리 대기열이 갈라져 이 방식은 못 쓴다.
- 비교 시험에서 Gemini 기준군은 반드시 `llm:"gemini"` 를 보내야 한다(관리자 토큰만 싣고 llm 을 비우면 이제 Luna 로 간다).
- `/api/legal/ask` 자체는 인증 없이 열려 있다(버튼만 숨김) — Codex 와 별개로 공공 공개 전에 다룰 일.
- 공공 서비스 전환 전에는 이 모드를 떼어낸다(설계 문서 §8 「떼어내는 법」, 비상 정지는 Fly 시크릿 삭제).

## 9. 다음에 할 일

1. **PR #1340 머지 → 배포**(답변 끝 AI 표시·작업자 재시도·Sol 기록). 머지 전 CI 통과 확인. 배포 후 앱에서 질문해 끝줄 표시 확인.
2. **검색 문제 2건** — 다른 세션에서 진행(인계 프롬프트 사용). 끝나면 20문항을 Luna 로 다시 돌려 「확인 안 됨」이 줄었는지 확인.
3. (선택) 되묻기 2라운드 시험 — 앱에서 되묻기 버튼을 눌러 이어지는지 관리자 기기로 확인.
4. (선택) 20문항 이상으로 Luna 정확도 재확인 후, 일반 사용자 적용 여부를 사용자가 결정.
