@echo off
cd /d "%~dp0"
.venv_dev\Scripts\python.exe -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
