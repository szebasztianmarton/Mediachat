@echo off
REM Dev infrastruktura inditasa (Redis). Ha a Docker nem fut, NEM all le a pnpm dev —
REM a backend in-memory cache-re esik vissza. Ezert mindig 0-val terunk vissza.
cd /d "%~dp0\.."
echo [infra] Redis inditasa (docker-compose.dev.yml)...
docker compose -f docker-compose.dev.yml up -d
if errorlevel 1 (
  echo [infra] FIGYELEM: Docker nem elerheto vagy hiba tortent. A backend in-memory cache-t hasznal.
) else (
  echo [infra] Redis fut a localhost:6380 porton.
)
exit /b 0
