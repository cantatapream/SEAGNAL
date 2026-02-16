@echo off
setlocal

:: ============================================================================
:: SEAGNAL Fly.io Data Backup Script
:: ============================================================================
:: This script downloads critical data files from the Fly.io server to the local machine.
:: It creates a timestamped backup folder for each run.

:: 1. Set Backup Directory
set BACKUP_ROOT=C:\Users\hyoo1\Desktop\SEAGNAL\server_backups
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set TIMESTAMP=%datetime:~0,8%_%datetime:~8,6%
set TARGET_DIR=%BACKUP_ROOT%\backup_%TIMESTAMP%

echo [INFO] Starting Fly.io Data Backup...
echo [INFO] Target Directory: %TARGET_DIR%

:: 2. Create Directory
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: 3. Download Critical Files
echo [INFO] Downloading visitors.json...
call fly sftp get /app/data/visitors.json "%TARGET_DIR%\visitors.json"

echo [INFO] Downloading visitors_stats.json...
call fly sftp get /app/data/visitors_stats.json "%TARGET_DIR%\visitors_stats.json"

echo [INFO] Downloading tidebed_config.json...
call fly sftp get /app/data/tidebed_config.json "%TARGET_DIR%\tidebed_config.json"

echo [INFO] Downloading notice.json...
call fly sftp get /app/data/notice.json "%TARGET_DIR%\notice.json"

echo [INFO] Downloading promo.json...
call fly sftp get /app/data/promo.json "%TARGET_DIR%\promo.json"

:: 4. Verify & Finish
if exist "%TARGET_DIR%\visitors.json" (
    echo [SUCCESS] Backup completed successfully!
    echo [INFO] Files saved to: %TARGET_DIR%
    start "" "%TARGET_DIR%"
) else (
    echo [ERROR] Backup failed or incomplete. Please check your Fly.io connection.
)

pause
