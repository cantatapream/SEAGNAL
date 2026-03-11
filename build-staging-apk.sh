#!/bin/bash
# ============================================
# 스테이징 APK 빌드 스크립트
# 사용법: ./build-staging-apk.sh
# ============================================

set -e

echo "===== 스테이징 APK 빌드 시작 ====="

# 프로젝트 루트 디렉토리로 이동
cd "$(dirname "$0")"

# 1. 기존 capacitor.config.json 백업
echo "[1/5] capacitor.config.json 백업 중..."
cp capacitor.config.json capacitor.config.production.json.bak

# 2. 스테이징 config로 교체
echo "[2/5] 스테이징 서버 설정 적용 중..."
cp capacitor.config.staging.json capacitor.config.json
echo "  → 서버 URL: https://seagnal-staging.fly.dev"
echo "  → 앱 ID: com.seagnal.app.staging"
echo "  → 앱 이름: SEA:GNAL(스테이징)"

# 3. Capacitor sync
echo "[3/5] Capacitor 동기화 중..."
npx cap sync android

# 4. 디버그 APK 빌드
echo "[4/5] 디버그 APK 빌드 중..."
cd android
./gradlew assembleDebug
cd ..

# 5. 원래 config 복원
echo "[5/5] 프로덕션 설정 복원 중..."
cp capacitor.config.production.json.bak capacitor.config.json
rm capacitor.config.production.json.bak

echo ""
echo "===== 빌드 완료! ====="
echo ""
echo "APK 위치: android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "설치 방법:"
echo "  adb install android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "※ 프로덕션 앱과 동시 설치 가능 (앱 ID가 다름)"
echo "※ 앱 이름에 '스테이징' 표시로 구분 가능"
