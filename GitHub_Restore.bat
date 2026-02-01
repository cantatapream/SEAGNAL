@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ==========================================
echo 🕒 최근 백업 기록을 불러오고 있습니다...
echo ==========================================
echo.

git fetch origin >nul 2>&1

set count=0
:: 한글이 포함된 로그도 잘 읽어오도록 설정
for /f "tokens=1,2,*" %%a in ('git log origin/main --oneline --format^="%%h [%%ad] %%s" --date^=format:"%%Y-%%m-%%d %%H:%%M" -n 10') do (
    set /a count+=1
    set "id[!count!]=%%a"
    echo [!count!] %%b %%c
)

if %count%==0 (
    echo ❌ 찾을 수 있는 백업 기록이 없습니다.
    pause
    exit /b
)

echo.
echo =====================
set /p choice="👉 복구할 백업 번호를 입력하세요 (취소하려면 Enter): "

if "%choice%"=="" (
    echo ❌ 취소되었습니다.
    pause
    exit /b
)

set selectedID=!id[%choice%]!

if "%selectedID%"=="" (
    echo ❌ 잘못된 번호입니다.
    pause
    exit /b
)

echo.
echo ⚠️ 선택하신 시점[!selectedID!]으로 모든 코드를 되돌리시겠습니까?
set /p confirm="정말로 진행하시겠습니까? (Y/N): "

if /i "%confirm%"=="Y" (
    echo.
    echo 🚀 [!selectedID!] 시점으로 타임머신 가동 중...
    git reset --hard %selectedID%
    echo.
    echo ✅ 복원이 완료되었습니다! 
) else (
    echo.
    echo ❌ 복원이 취소되었습니다.
)

pause
