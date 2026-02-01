@echo off
setlocal
cd /d "%~dp0"

echo [1/4] Git 초기 설정 중...
git init
:: 사용자 식별 정보 등록 (이 단계를 추가했습니다)
git config user.email "cantatapream@example.com"
git config user.name "SEAGNAL_USER"

git remote add origin https://github.com/cantatapream/SEAGNAL.git 2>nul
git remote set-url origin https://github.com/cantatapream/SEAGNAL.git

echo [2/4] 바뀐 파일 수집 중...
git add .

echo [3/4] 백업 이름표 작성 중...
set timestamp=%date% %time%
git commit -m "Backup at %timestamp%"

echo [4/4] 깃허브로 전송 중 (로그인 창이 뜨면 로그인해 주세요)...
git branch -M main
git push -u origin main

echo.
echo ==========================================
echo ✅ 백업이 완료되었습니다!
echo 창을 닫으려면 아무 키나 누르세요.
echo ==========================================
pause
