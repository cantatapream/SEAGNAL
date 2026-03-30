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
