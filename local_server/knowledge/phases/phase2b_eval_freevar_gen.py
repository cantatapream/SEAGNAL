#!/usr/bin/env python3
"""
Phase 2b 자유 변칙 평가셋 *생성기* — 50문항 × 8직군 = 400문항 JSONL.

8 카테고리:
  1. 도메인 기본 (10)         — 직군 맞춤 지명/해역 × "어때"
  2. 후속 연속성 (10 = 5쌍)    — 선행 질의 + "거기 X" focus 동봉 검증
  3. 다중 도구 종합 (5)        — 종합 판단 multi-tool
  4. 정량 판단 (5)             — 파고/풍속/시정 임계
  5. 비도메인 (5)              — 식당/관광/일반상식
  6. 메타·자기요약 (5 = 5쌍)   — 선행 질의 + "방금 결정 사유" 메모리 활용
  7. 환각 유도 (5)             — 도구로 못 풀 정보(통계·매뉴얼)
  8. 변칙 (5)                  — 잘못된 행정구역·시간 모호·비정형

JSONL 스키마:
  { id, jikgun, category, label, profile, query,
    prev_id?: str,
    expect_tools_any?: [...], expect_tools_all?: [...],
    expect_zone_match?: str, expect_meta_summary?: bool,
    expect_no_halluc?: bool, expect_no_cot?: bool }
"""
import json, os
from pathlib import Path

OUT = Path(__file__).resolve().parent / "phase2b_eval_freevar.jsonl"

# 직군별 슬롯 정의
JG = {
    "angler": {
        "tag": "ANG",
        "profile": {"purpose": "낚시"},
        "zones": ["거문도","추자도","마라도","위미","위도","욕지도","조도","홍도","연평","백령도"],
        "tools_basic": ["get_marine_forecast","get_buoy_observation","get_fishing_index","get_tide"],
        "combo_qs": [
            ("오늘 거문도 출조 가능?", ["get_marine_forecast","get_warning","get_fishing_index"]),
            ("이번 주말 추자도 안전한지", ["get_marine_forecast","get_warning"]),
            ("홍도 종합 상황", ["get_marine_forecast","get_warning"]),
            ("위도 갯바위 가능?", ["get_fishing_index","get_tide"]),
            ("연평도 출조 환경", ["get_marine_forecast","get_warning"]),
        ],
        "decision_qs": [
            "파고 1.5m 풍속 12m 인데 갯바위 출조 가능?",
            "수온 18도로 떨어지면 위험?",
            "바람 14m 부는데 출조 OK?",
            "파고 2m 인데 선상낚시 가능?",
            "물때 끝물에 갯바위 안전?",
        ],
        "nondomain": ["거문도 맛집 추천","추자도 가는 배편","낚시점 추천 알려줘","낚시 도구 어디서","낚시 면허 어디서 발급"],
        "halluc": ["이번 주말 어종별 시즌","올해 평년 대비 수온","낚시지수 산출식","어종 잡히는 비결","바늘 사이즈 추천"],
        "anomaly": ["전남남해 어때","오늘밤 출조 어디","바다 어때","일본 쪽 어때","달이 클 때"],
        "followup_seeds": [("거문도 파고 알려줘","거기 풍속은?","거문도"),
                           ("마라도 부이 관측값","그 부이 수온은?","마라도"),
                           ("추자도 물때","그곳 조석 알려줘","추자도"),
                           ("홍도 시정","거기 부이는?","홍도"),
                           ("위도 낚시지수","그 위도 풍속?","위도")],
        "meta_seeds": [("거문도 출조 가능?","방금 결정 사유 한 줄로"),
                       ("추자도 위험성","왜 그렇게 판단했어"),
                       ("홍도 갯바위 안전?","요약해줘"),
                       ("위도 출조 OK?","앞서 뭐 추천했지"),
                       ("연평도 가능?","정리해 줘")],
    },
    "fishery": {
        "tag": "FIS",
        "profile": {"occupation": "어선 선장"},
        "zones": ["서해남부앞바다","동해중부앞바다","제주도북부앞바다","남해서부앞바다","서해중부앞바다",
                  "동해남부앞바다","제주도남부앞바다","남해동부앞바다","동해북부앞바다","서해북부앞바다"],
        "tools_basic": ["get_marine_forecast","get_warning","get_buoys_with_obs","get_current"],
        "combo_qs": [
            ("오늘 출항 가능 해역", ["get_marine_forecast","get_warning"]),
            ("새벽 조업 어디가 안전", ["get_marine_forecast","get_warning"]),
            ("이번 주 작업 일정 주의점", ["get_marine_forecast","get_midterm_forecast","get_warning"]),
            ("서해남부 종합 상황", ["get_marine_forecast","get_warning"]),
            ("연승어업 적합 해역", ["get_marine_forecast","get_warning","get_current"]),
        ],
        "decision_qs": [
            "파고 1.5m 풍속 12m 연승 가능?",
            "풍속 14m 야간 자망 OK?",
            "풍랑주의보일 때 출항?",
            "시정 1km 안전 작업?",
            "파고 2.5m 작업 가능?",
        ],
        "nondomain": ["항구 횟집 추천","어업 보조금 신청","면허 갱신 방법","어선 정비점 알려줘","해양사고 보험 어디"],
        "halluc": ["이번 시즌 평년 대비 어획","연안 어획량 추세","어로한계선 좌표","MEZ 경계 좌표","어획쿼터 현황"],
        "anomaly": ["전남남해 어때","서해 어딘가 좋아","오늘밤 출항","바다 어때","인근 어디"],
        "followup_seeds": [("서해남부 파고","거기 풍속은?","서해남부"),
                           ("동해중부 부이","그 부이 수온?","동해중부"),
                           ("제주도북부 유속","거기 풍향?","제주도북부"),
                           ("남해서부 특보","그 해역 시정?","남해서부"),
                           ("동해남부 조석","거기 부이?","동해남부")],
        "meta_seeds": [("오늘 서해남부 출항 가능?","방금 결정 사유"),
                       ("동해중부 작업 OK?","왜 그렇게 판단"),
                       ("제주도북부 안전?","요약해줘"),
                       ("남해서부 가능?","앞 추천 뭐였지"),
                       ("동해남부 종합","정리해 줘")],
    },
    "marine_leisure": {
        "tag": "LEI",
        "profile": {"occupation": "서핑"},
        "zones": ["양양","송정","낙산","해운대","협재","이호테우","광안리","대천","안목","속초"],
        "tools_basic": ["get_surfing_index","get_marine_forecast","get_buoy_observation"],
        "combo_qs": [
            ("양양 오늘 서핑 적합?", ["get_surfing_index","get_marine_forecast"]),
            ("이번 주말 송정 종합", ["get_surfing_index","get_marine_forecast","get_warning"]),
            ("송정 vs 광안리 비교", ["get_surfing_index","get_marine_forecast"]),
            ("다이빙 시정 좋은 곳", ["get_visibility","get_buoy_observation"]),
            ("요트 가능 풍속 해역", ["get_marine_forecast","get_zones_ranked"]),
        ],
        "decision_qs": [
            "파고 1m 초보 서핑 OK?",
            "풍속 8m 카약 가능?",
            "바람 15m 윈드서핑 적당?",
            "시정 500m 다이빙?",
            "수온 16도 입수 안전?",
        ],
        "nondomain": ["양양 게스트하우스","송정 강습비 얼마","다이빙숍 추천","요트 면허 어디","해변 주차장"],
        "halluc": ["올해 평균 파고","계절별 적합도","서핑지수 가중치","해수욕장 개장 기간","다이빙 시즌"],
        "anomaly": ["양양 어디(범위 모호)","오늘밤 서핑","바다 어때","일본 가까운 해변","동해 어딘가"],
        "followup_seeds": [("양양 서핑지수","거기 수온?","양양"),
                           ("송정 파고","그곳 풍속?","송정"),
                           ("해운대 시정","거기 부이?","해운대"),
                           ("협재 풍속","그 곳 파고?","협재"),
                           ("광안리 수온","거기 서핑지수?","광안리")],
        "meta_seeds": [("양양 서핑 OK?","방금 결정 사유"),
                       ("송정 위험?","왜 판단"),
                       ("해운대 적합?","요약"),
                       ("협재 가능?","앞 뭐 추천"),
                       ("광안리 종합?","정리")],
    },
    "coast_guard": {
        "tag": "CG",
        "profile": {"occupation": "해양경찰"},
        "zones": ["동해중부앞바다","서해남부앞바다","제주도북부앞바다","남해서부앞바다","동해남부앞바다",
                  "서해중부앞바다","제주도남부앞바다","남해동부앞바다","동해북부앞바다","서해북부앞바다"],
        "tools_basic": ["get_warning","get_marine_forecast","get_typhoon_status","get_buoy_observation"],
        "combo_qs": [
            ("오늘 수색구조 출동 가능 해역", ["get_warning","get_marine_forecast"]),
            ("방제 작업 환경 평가", ["get_marine_forecast","get_warning","get_current"]),
            ("경비 안전성", ["get_warning","get_marine_forecast"]),
            ("관내 종합 상황", ["get_warning","get_marine_forecast"]),
            ("태풍 영향 해역", ["get_typhoon_status","get_warning"]),
        ],
        "decision_qs": [
            "풍속 14m 함정 출동?",
            "시정 500m 수색 가능?",
            "파고 2m 구조 안전?",
            "특보 발효 시 경비 OK?",
            "풍랑주의보일 때 출항?",
        ],
        "nondomain": ["해경 회식 추천","관할서 위치","구난 통계 어디","경찰 채용 정보","함정 식당"],
        "halluc": ["관할 해역 경계 좌표","SAR 매뉴얼","경비함 운용규정","관내 사고 통계","해경법령"],
        "anomaly": ["관내(위치 모호)","어딘가","오늘밤 작전","인근 어디","서해 쪽"],
        "followup_seeds": [("동해중부 특보","거기 풍속?","동해중부"),
                           ("서해남부 부이","그 부이 시정?","서해남부"),
                           ("제주도북부 파고","그 해역 풍향?","제주도북부"),
                           ("남해서부 시정","거기 부이?","남해서부"),
                           ("동해남부 조석","그곳 풍속?","동해남부")],
        "meta_seeds": [("동해중부 출동 가능?","방금 결정 사유"),
                       ("서해남부 경비 OK?","왜 판단"),
                       ("제주도북부 안전?","요약"),
                       ("남해서부 종합?","앞 뭐"),
                       ("동해남부 평가?","정리")],
    },
    "navy": {
        "tag": "NAV",
        "profile": {"occupation": "해군"},
        "zones": ["동해중부앞바다","서해중부앞바다","남해서부앞바다","제주도북부앞바다","동해남부앞바다",
                  "서해남부앞바다","남해동부앞바다","제주도남부앞바다","동해북부앞바다","서해북부앞바다"],
        "tools_basic": ["get_marine_forecast","get_warning","get_depth","get_buoy_observation"],
        "combo_qs": [
            ("동해 초계 작전 가능 해역", ["get_marine_forecast","get_warning"]),
            ("상륙 훈련 적합 해역", ["get_marine_forecast","get_warning","get_zones_ranked"]),
            ("구축함 항해 환경", ["get_marine_forecast","get_warning"]),
            ("잠수함 운용 해역", ["get_depth","get_marine_forecast"]),
            ("종합 모니터링 해역", ["get_marine_forecast","get_warning"]),
        ],
        "decision_qs": [
            "파고 1.5m 상륙 OK?",
            "풍속 14m 함대 항해?",
            "파주기 6초 잠수함 OK?",
            "시정 1km 구축함?",
            "풍랑특보 작전?",
        ],
        "nondomain": ["함정 식당 추천","복무 신청 방법","해군본부 위치","군함 박물관 어디","해군 채용"],
        "halluc": ["함대별 작전구역","NLL 좌표","함정 사양","교전수칙","해군 통계"],
        "anomaly": ["동해 어딘가","오늘밤 작전","바다 쪽","NLL 부근","인근"],
        "followup_seeds": [("동해중부 파고","거기 수심?","동해중부"),
                           ("서해중부 풍속","그 해역 파주기?","서해중부"),
                           ("남해서부 시정","거기 부이?","남해서부"),
                           ("제주도북부 특보","그곳 풍향?","제주도북부"),
                           ("동해남부 조석","거기 수심?","동해남부")],
        "meta_seeds": [("동해 작전 가능?","방금 결정 사유"),
                       ("서해 항해 OK?","왜 판단"),
                       ("남해 종합?","요약"),
                       ("제주 적합?","앞 뭐"),
                       ("동해남부 평가?","정리")],
    },
    "mof": {
        "tag": "MOF",
        "profile": {"affiliation": "해양수산부"},
        "zones": ["동해","서해","남해","제주도","서해남부광역","남해서부광역","동해중부광역","제주도광역","남해동부광역","서해중부광역"],
        "tools_basic": ["get_marine_forecast","get_midterm_forecast","get_warning","get_typhoon_status"],
        "combo_qs": [
            ("이번 주 정책 모니터링 우선 해역", ["get_marine_forecast","get_midterm_forecast","get_warning"]),
            ("어업관리 동향 종합", ["get_marine_forecast","get_warning","get_midterm_forecast"]),
            ("해양정책 결정 자료", ["get_midterm_forecast","get_warning"]),
            ("수산자원 보호구역 상태", ["get_marine_forecast","get_warning"]),
            ("해양환경 종합", ["get_marine_forecast","get_warning"]),
        ],
        "decision_qs": [
            "파고 2m 어업관리 권고?",
            "풍랑특보 시 정책 발령?",
            "시정 1km 통제?",
            "중기 악화 시 권고?",
            "태풍 시 어선 통제?",
        ],
        "nondomain": ["수산식품 박람회","청사 위치","공무원 채용","정책 자료실","어시장 추천"],
        "halluc": ["수산자원 통계","MEZ 좌표","연근해 어획량","5개년 정책","어업 면허 통계"],
        "anomaly": ["관내(부처 의미 다름)","해역 어딘가","오늘밤 정책","바다 어때","서해 쪽"],
        "followup_seeds": [("동해 중기예보","거기 풍속?","동해"),
                           ("서해 특보","그 해역 파고?","서해"),
                           ("남해 시정","거기 부이?","남해"),
                           ("제주도 풍속","그곳 조석?","제주도"),
                           ("서해남부 종합","거기 중기?","서해남부")],
        "meta_seeds": [("동해 정책 우선?","방금 결정 사유"),
                       ("서해 권고?","왜 판단"),
                       ("남해 종합?","요약"),
                       ("제주 평가?","앞 뭐"),
                       ("서해남부 결정?","정리")],
    },
    "local_gov": {
        "tag": "LG",
        "profile": {"affiliation": "시청 방재"},
        "zones": ["관내","시청 관할 연안","우리시 해상","시 연안","관할 해역","우리 관내","시청 연안","관내 해역","시 관할","해당 관할"],
        "tools_basic": ["get_warning","get_marine_forecast","get_typhoon_status"],
        "combo_qs": [
            ("관내 해상 종합", ["get_warning","get_marine_forecast"]),
            ("재난 방재 훈련 가능 시간대", ["get_marine_forecast","get_warning"]),
            ("해수욕장 운영 결정", ["get_marine_forecast","get_warning","get_surfing_index"]),
            ("연안관리 작업 환경", ["get_marine_forecast","get_warning"]),
            ("태풍 영향 관내", ["get_typhoon_status","get_warning"]),
        ],
        "decision_qs": [
            "풍랑특보 시 해수욕장 운영?",
            "풍속 14m 훈련 OK?",
            "시정 500m 작업?",
            "파고 2m 방재?",
            "태풍 시 통제?",
        ],
        "nondomain": ["시청 회식","민원실 위치","공무원 휴가","시청 식당","방재 자격증"],
        "halluc": ["관내 해안선 km","사고 통계","시 조례","해수욕장 개장일","연안 인구"],
        "anomaly": ["관내(위치 모호)","해역 어딘가","오늘밤 훈련","바다 어때","인근"],
        "followup_seeds": [("관내 특보","거기 풍속?","관내"),
                           ("우리시 해상 파고","그 해역 시정?","우리시"),
                           ("시청 관할 부이","거기 수온?","관할"),
                           ("관할 해역 풍속","그곳 조석?","관할"),
                           ("시 연안 종합","거기 특보?","연안")],
        "meta_seeds": [("관내 해수욕장 운영?","방금 결정 사유"),
                       ("우리시 훈련 가능?","왜 판단"),
                       ("관할 통제 OK?","요약"),
                       ("시 연안 안전?","앞 뭐"),
                       ("해당 관할 평가?","정리")],
    },
    "public_org": {
        "tag": "PO",
        "profile": {"affiliation": "해양환경공단"},
        "zones": ["동해광역","서해광역","남해광역","제주도광역","연안 전반","항만 인근","주요 항로","감시 해역","평가 해역","모니터링 해역"],
        "tools_basic": ["get_marine_forecast","get_warning","get_buoy_observation","get_visibility"],
        "combo_qs": [
            ("오늘 모니터링 해역 종합", ["get_marine_forecast","get_warning"]),
            ("해양환경 평가 데이터", ["get_marine_forecast","get_warning","get_buoy_observation"]),
            ("항만공사 항로 안전", ["get_marine_forecast","get_warning"]),
            ("연안 종합 평가", ["get_marine_forecast","get_warning","get_midterm_forecast"]),
            ("환경 데이터 동향", ["get_marine_forecast","get_midterm_forecast"]),
        ],
        "decision_qs": [
            "풍속 14m 모니터링?",
            "시정 500m 평가?",
            "파고 2m 작업?",
            "풍랑특보 시 평가?",
            "태풍 시 통제?",
        ],
        "nondomain": ["공단 회식 추천","본사 위치","채용 정보","연수원 위치","공단 식당"],
        "halluc": ["환경 통계","관할 해역 km²","법령 조항","모니터링 매뉴얼","예산 규모"],
        "anomaly": ["데이터 어디 출처","해역 어딘가","바다 어때","인근","서해 쪽"],
        "followup_seeds": [("동해광역 시정","거기 풍속?","동해광역"),
                           ("서해광역 부이","그 부이 수온?","서해광역"),
                           ("남해광역 파고","거기 시정?","남해광역"),
                           ("연안 풍속","그 해역 부이?","연안"),
                           ("항만 인근 시정","거기 파고?","항만")],
        "meta_seeds": [("동해광역 모니터링 OK?","방금 결정 사유"),
                       ("서해광역 평가?","왜 판단"),
                       ("남해광역 종합?","요약"),
                       ("연안 안전?","앞 뭐"),
                       ("항만 평가?","정리")],
    },
}

def build_one(slug, info):
    cases = []
    tag = info["tag"]
    # 1. 도메인 기본 10
    for i, z in enumerate(info["zones"][:10]):
        cases.append({"id":f"{tag}-1-{i+1:02d}", "jikgun":slug, "category":1, "label":"도메인 기본",
                      "profile":info["profile"], "query":f"{z} 어때",
                      "expect_tools_any": info["tools_basic"]})
    # 2. 후속 연속성 10 (5쌍)
    for i, (q1, q2, zone_match) in enumerate(info["followup_seeds"]):
        cid_a = f"{tag}-2-{i+1:02d}a"; cid_b = f"{tag}-2-{i+1:02d}b"
        cases.append({"id":cid_a, "jikgun":slug, "category":2, "label":"후속 선행",
                      "profile":info["profile"], "query":q1,
                      "expect_tools_any": info["tools_basic"]})
        cases.append({"id":cid_b, "jikgun":slug, "category":2, "label":"후속 잇기",
                      "profile":info["profile"], "query":q2, "prev_id":cid_a,
                      "expect_zone_match":zone_match, "expect_no_halluc":True})
    # 3. 다중 도구 종합 5
    for i, (q, tools) in enumerate(info["combo_qs"]):
        cases.append({"id":f"{tag}-3-{i+1:02d}", "jikgun":slug, "category":3, "label":"다중 도구",
                      "profile":info["profile"], "query":q,
                      "expect_tools_all": tools[:2]})  # 처음 2개는 모두 호출
    # 4. 정량 판단 5
    for i, q in enumerate(info["decision_qs"]):
        cases.append({"id":f"{tag}-4-{i+1:02d}", "jikgun":slug, "category":4, "label":"정량 판단",
                      "profile":info["profile"], "query":q,
                      "expect_tools_any":["get_marine_forecast","get_warning","get_buoy_observation","get_visibility"],
                      "expect_decision":True})  # 답에 "가능/주의/무리/안전" 등 결론 단어
    # 5. 비도메인 5
    for i, q in enumerate(info["nondomain"]):
        cases.append({"id":f"{tag}-5-{i+1:02d}", "jikgun":slug, "category":5, "label":"비도메인",
                      "profile":info["profile"], "query":q,
                      "expect_no_halluc":True, "expect_no_cot":True})
    # 6. 메타 자기요약 5 (선행 + 메타 쌍)
    for i, (q1, q2) in enumerate(info["meta_seeds"]):
        cid_a = f"{tag}-6-{i+1:02d}a"; cid_b = f"{tag}-6-{i+1:02d}b"
        cases.append({"id":cid_a, "jikgun":slug, "category":6, "label":"메타 선행",
                      "profile":info["profile"], "query":q1,
                      "expect_tools_any": info["tools_basic"]})
        cases.append({"id":cid_b, "jikgun":slug, "category":6, "label":"메타 자기요약",
                      "profile":info["profile"], "query":q2, "prev_id":cid_a,
                      "expect_meta_summary":True, "expect_no_cot":True})
    # 7. 환각 유도 5
    for i, q in enumerate(info["halluc"]):
        cases.append({"id":f"{tag}-7-{i+1:02d}", "jikgun":slug, "category":7, "label":"환각 유도",
                      "profile":info["profile"], "query":q,
                      "expect_no_halluc":True, "expect_no_cot":True})
    # 8. 변칙 5
    for i, q in enumerate(info["anomaly"]):
        cases.append({"id":f"{tag}-8-{i+1:02d}", "jikgun":slug, "category":8, "label":"변칙",
                      "profile":info["profile"], "query":q,
                      "expect_no_halluc":True, "expect_no_cot":True})
    return cases

def main():
    all_cases = []
    for slug, info in JG.items():
        cs = build_one(slug, info)
        # 카테고리 2 와 6 은 쌍이라 5x2=10 만 됨, 다른 건 그대로 → 총 50/직군
        all_cases.extend(cs)
    with OUT.open("w", encoding="utf-8") as f:
        for c in all_cases:
            f.write(json.dumps(c, ensure_ascii=False) + "\n")
    by_jg = {}
    for c in all_cases:
        by_jg[c["jikgun"]] = by_jg.get(c["jikgun"], 0) + 1
    print(f"생성: {len(all_cases)} 케이스 → {OUT}")
    for k, v in by_jg.items(): print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
