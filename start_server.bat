@echo off
echo.
echo ===========================================
echo    Starting local server for CAN Viewer
echo ===========================================
echo.
echo    Opening server at: http://localhost:8000
echo.
echo    Press CTRL+C in this window to stop it.
echo.

:: 'python' - для Windows, навіть якщо це Python 3
python -m http.server

:: 'pause' не дасть вікну закритися одразу, якщо сервер не запуститься
pause