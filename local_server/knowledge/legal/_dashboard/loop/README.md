# 감사·수정·재감사 루프 — 자동화 스크립트 체크포인트

> 원본은 세션 스크래치패드(`/tmp/.../scratchpad/`)에서 돌지만, 컨테이너가 사라지면 스크래치패드가 날아가므로
> **여기에 백업**한다. 컨테이너 재시작 시 이 폴더 파일을 스크래치패드로 복사해 상태(`audit_loop_state.json`)의
> phase/round/run_ids로 이어서 재개한다(위키·감사 산출물은 이미 git에 커밋되어 별개로 안전).

## 핵심 (루프)
- `audit_sim.js` — 감사 워크플로(질문 생성→위키만으로 답변→구멍 판정 + 답변방식 준수 점검). args: {groupsPath, groupIndex, round}
- `fix_wiki.js` — 수정 워크플로(감사 리포트대로 페이지 생성·심화·별표/고시 반영). args: {groupsPath, groupIndex}
- `audit_loop_state.json` — 상태(phase, round, run_ids). 오케스트레이터가 읽어 전진
- `audit_groups.json` — 65 tier-1 법을 5그룹으로 쪼갠 것(boot가 groupIndex로 읽음)
- `build_data.json`·`tier1.json` — 법 메타(name/slug/domain/tier/raw/group)
- `gen_index.py` — index.md 목차 재생성(→ 상위 `_dashboard/gen_index.py`와 동일)

## 파이프라인(재사용)
- 수집: `collect.py`·`collect_admrul.py`(고시)·`collect_ordin.py`(조례)·`recollect_byl.py`(별표)·`recollect_jomun.py`(조문)
- 빌드: `full_build.js`(풀깊이)·`wiki_build.js`·`topicmap.js`·`sonnet_pilot.js`(모델 검증)
- lint: `lint_index.py`·`lint_build.py`·`lint_hubs.js`·`lint2.js`(색인·그래프·백본·테마허브)
- 프로토타입: `chatbot_proto.py`(순수코드 검색+점진공개 검증용)
