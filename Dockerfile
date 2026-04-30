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

# 포트 노출
EXPOSE 3001

# 서버 실행
CMD [ "npm", "start" ]
