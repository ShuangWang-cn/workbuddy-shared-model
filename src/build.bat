@echo off
rem ---- rebuild the shared-model exe (ASCII-only on purpose: cmd.exe parses .bat by GBK here) ----
rem The exe has a Chinese name; we get it from _exe_name.py so this file stays ASCII.
cd /d "%~dp0"
set PY=%USERPROFILE%\.workbuddy\binaries\python\envs\wbbridge-exe\Scripts\python.exe
if not exist "%PY%" (
  echo [ERROR] python venv not found: %PY%
  echo         create it with:  python -m venv "%%USERPROFILE%%\.workbuddy\binaries\python\envs\wbbridge-exe"
  echo         then:            pip install pyinstaller pywebview cryptography
  pause
  exit /b 1
)
rem 2026-10-07: build via spec.
rem   DO NOT add --clean : this box has a SAFE_DELETE_BULK_CONFIRM_REQUIRED guard and
rem   --clean trips it, hanging the build. The spec carries the exe name, webview
rem   collection and index.html.
for /f "delims=" %%N in ('"%PY%" _exe_name.py') do set EXENAME=%%N
if "%EXENAME%"=="" (
  echo [ERROR] could not read exe name from spec
  pause
  exit /b 1
)
echo [INFO] exe name = "%EXENAME%"
"%PY%" -m PyInstaller "%EXENAME%.spec" --noconfirm
if errorlevel 1 (
  echo [ERROR] pyinstaller failed, see message above
  pause
  exit /b 1
)
copy /y "dist\%EXENAME%.exe" "..\exe\%EXENAME%.exe" >nul
if errorlevel 1 (
  echo [ERROR] copy to ..\exe\ failed
) else (
  echo [OK] rebuilt and copied to ..\exe\
  echo [NOTE] ..\exe\ should contain ONLY the .exe plus the workbuddy-llm folder.
)
pause