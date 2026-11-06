@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Dang tu dong lay cac file 3D va anh goc tu D:\Dataset\results_dataset...
echo.
python import_dataset.py
echo.
pause
