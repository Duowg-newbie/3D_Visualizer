@echo off
cd /d "%~dp0"
echo Mo trinh duyet tai http://localhost:8000
start "" http://localhost:8000
python -m http.server 8000
