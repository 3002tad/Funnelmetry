@echo off
REM ============================================================================
REM Docker Start - E-commerce Realtime Pipeline
REM ============================================================================

echo ============================================================================
echo     Starting E-commerce Realtime Pipeline (Docker Mode)
echo ============================================================================
echo.

cd infra

echo [1/2] Building Docker images...
docker-compose build

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Docker build failed!
    pause
    exit /b 1
)

echo.
echo [2/2] Starting all services...
docker-compose up -d

if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Docker start failed!
    pause
    exit /b 1
)

echo.
echo ============================================================================
echo     ALL SERVICES STARTED SUCCESSFULLY!
echo ============================================================================
echo.
echo Services running:
docker-compose ps
echo.
echo Access the application:
echo   - Generator UI:  http://localhost:5174
echo   - Dashboard:     http://localhost:5173
echo   - API Health:    http://localhost:7070/health
echo.
echo To view logs:        docker-compose logs -f
echo To stop services:    docker-compose down
echo.
pause
