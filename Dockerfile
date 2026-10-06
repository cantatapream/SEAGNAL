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
#
# ★`ca-certificates` 를 꼭 같이 넣는다 (2026-10-07 · 3-81).
#   `node:20-slim` 은 빌드 중에만 ca-certificates 를 쓰고 **지운다**. Node 는 자기 안에 루트 인증서 목록을
#   갖고 있어 괜찮지만, 파이썬(OpenSSL)은 시스템 저장소(/etc/ssl/certs)만 본다 — 그것이 **비어 있었다.**
#   그래서 운영 서버의 파이썬 점검이 law.go.kr 을 한 번도 못 열었다:
#     `SSL: CERTIFICATE_VERIFY_FAILED … self-signed certificate in certificate chain` (×54 · 개정감지 10.07)
#   law.go.kr 인증서는 정상이다(GlobalSign Root R3 — Mozilla·Apple 저장소 신뢰). 우리 쪽에 저장소가 없었을 뿐이다.
#   ⚠검증을 끄는 것으로 「고치지」 않는다 — 저장소를 넣는다.
#   마지막 줄은 **저장소가 비어 있으면 빌드를 멈춘다**(망 없이 센다) — 같은 일이 조용히 되풀이되지 않게.
# ----------------------------------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends tzdata python3 ca-certificates \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/* \
    && python3 --version \
    && python3 -c "import ssl; n = ssl.create_default_context().cert_store_stats()['x509_ca']; print('python CA', n); assert n > 50, 'python 인증서 저장소가 비었다 — ca-certificates'"

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
