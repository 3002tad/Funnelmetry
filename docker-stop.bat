@echo off
REM ============================================================================
REM Docker Stop - E-commerce Realtime Pipeline
REM ============================================================================

echo ============================================================================
echo     Stopping E-commerce Realtime Pipeline
echo ============================================================================
echo.

cd infra

docker-compose down

if %ERRORLEVEL% EQU 0 (
    echo.
    echo     All services stopped successfully!
    echo.
) else (
    echo.
    echo     ERROR: Failed to stop services
    echo.
)

pause
