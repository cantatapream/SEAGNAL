@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ==========================================
echo 📝 백업 메모를 작성해 주세요 (한글 가능).
echo ==========================================
set /p msg="👉 작업 내용을 입력하세요 (예: 조석 달력 수정 완료): "

if "%msg%"=="" (
    set msg="Backup at %date% %time%"
)

echo.
echo [1/3] 바뀐 파일 수집 중...
git add .

echo [2/3] 백업 이름표 작성 중: [%msg%]
git commit -m "%msg%" --quiet

echo [3/3] 깃허브로 전송 중...
git push origin main --quiet

echo.
echo ==========================================
echo ✅ [%msg%] 이름으로 백업이 완료되었습니다.
echo ==========================================
pause
