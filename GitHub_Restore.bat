@echo off
setlocal
cd /d "%~dp0"

echo ⚠️ 정말로 마지막 깃허브 백업 상태로 모든 코드를 되돌리시겠습니까?
echo (현재 수정 중인 저장되지 않은 내용은 사라집니다.)
pause

echo [1/1] 깃허브에서 최신 상태 가져와서 덮어쓰는 중...
git fetch origin
git reset --hard origin/main

echo.
echo ==========================================
echo ✅ 복원이 완료되었습니다!
echo ==========================================
pause
