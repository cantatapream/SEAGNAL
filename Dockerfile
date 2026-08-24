# =============================================================================
# Dockerfile — SEAGNAL 서버 컨테이너 이미지 빌드 정의
# =============================================================================
# [역할]
#   Node.js 20 기반 Slim 이미지에 SEAGNAL 서버(local_server/) 를 빌드하여
#   Fly.io NRT(도쿄) 리전에 배포할 수 있는 컨테이너 이미지 생성.
#
# [환경 특이사항]
#   - Fly.io NRT: IPv6 외부 연결 불가 → DNS 우선순위를 IPv4 first 로 강제
#   - 의존성: 루트 package.json 에 통합 (local_server/package.json 도 복사하여 안전망)
#   - 데이터 디렉토리: /app/data (fly volume mount)
#
# [빌드/실행]
#   fly deploy : Fly.io 가 자동으로 이 Dockerfile 빌드 후 NRT 배포
#
# [연계]
#   - fly.toml      : 마운트/리전/머신 사양 정의
#   - package.json  : start 스크립트 = "node local_server/server.js"
# =============================================================================

FROM node:20-slim

# ----------------------------------------------------------------------------
# 타임존: 서버 로그/cron 스케줄을 KST(UTC+9) 기준으로 정렬 — 2026-05
# ----------------------------------------------------------------------------
# node:20-slim 은 tzdata 가 빠져 있어 ENV TZ 만으로는 적용 안 됨 →
# tzdata 설치 + symlink 로 zoneinfo 활성화.
# 효과: 서버 로그(log() 의 toLocaleString('ko-KR')), node-cron 스케줄,
#       KHOA 호출의 (date, hour) 계산이 모두 일관된 KST 로 동작.
# ----------------------------------------------------------------------------
ENV TZ=Asia/Seoul

# ----------------------------------------------------------------------------
# 파이썬 3 — 법령 정기점검 스크립트가 자식 프로세스로 실행된다 (2026-08-24 추가)
# ----------------------------------------------------------------------------
# 서버는 파이썬 스크립트를 두 개 돌린다:
#   · 매일 새벽 1시 KST — services/legal_amendment_scanner.js
#       → _dashboard/loop/detect_law_changes.py (법령 개정 감지 → '개정검토' 방)
#   · 매주 일요일 새벽  — services/admrul_fresh_scanner.js
#       → _dashboard/loop/admrul_fresh.py (행정규칙 원문 신선도 → '원문신선도' 방)
# 둘 다 `spawn('python3', ...)` 로 부른다. 그런데 이 줄이 생기기 전까지 이미지에
# 파이썬을 설치하는 곳이 아무 데도 없었다 — 개정감지가 실서비스에서 실제로 돌고
# 있었는지 확인할 방법이 없어(컨테이너 접속 불가) **환경에 기대지 않고 명시적으로 넣는다.**
# 두 스크립트 모두 표준 라이브러리만 쓰므로 pip 설치는 필요 없다.
# ----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends tzdata python3 \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/* \
    && python3 --version

WORKDIR /app

# Fly.io NRT 리전에서 IPv6 외부 연결 불가 → IPv4 강제 사용
ENV NODE_OPTIONS="--dns-result-order=ipv4first"

# 루트 및 local_server의 의존성 파일 복사
COPY package.json ./
# 필요한 경우 local_server 패키지도 복사 (의존성을 루트로 합쳤으므로 필수는 아니지만 안전을 위해)
COPY local_server/package.json ./local_server/

# 의존성 설치
RUN npm install --legacy-peer-deps

# 전체 소스 복사
COPY . .

# 서비스 워커 캐시 버전 자동 bump (C안 단위 3-B)
# sw.js 의 __CACHE_VERSION__ 플레이스홀더를 빌드 시점 타임스탬프로 치환.
# 매 배포마다 새 캐시 키가 되어 사용자의 옛 캐시가 자동 무효화됨.
RUN node local_server/scripts/bump_cache_version.js

# 포트 노출
EXPOSE 3001

# 서버 실행
CMD [ "npm", "start" ]
