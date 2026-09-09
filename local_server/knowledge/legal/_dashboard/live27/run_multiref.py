#!/usr/bin/env python3
"""
1차 시험 — 답변 규칙 16(답이 여러 자리에 나뉘어 있으면 전부 인용)의 효과를 잰다.

대상은 `_dashboard/live27/testset_multiref.json` 에 고정해 둔 **기대 근거 2개 이상 82문항**.
문항을 새로 고르지 않는다 — 같은 문항을 같은 자로 재야 전후 비교가 된다(2026-08-18 교훈).

배포 전 기준: 전부 맞음 31/82 = 37.8%
"""
import json, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util
spec = importlib.util.spec_from_file_location(
    'runmod', '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/live27/run.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)

TS = '/home/user/SEAGNAL/local_server/knowledge/legal/_dashboard/live27/testset_multiref.json'
qs = json.load(open(TS, encoding='utf-8'))
m.run(qs, sys.argv[1])
