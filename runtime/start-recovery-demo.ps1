param([switch]$ObserveOnly, [ValidateRange(1000, 300000)][int]$IntervalMs = 10000)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$previousDocker = $env:WATCHDOG_DOCKER_EXE
try {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is required for the host Watchdog.' }
    $docker = Get-Command docker -ErrorAction SilentlyContinue
    if ($docker) { $env:WATCHDOG_DOCKER_EXE = $docker.Source }
    else {
        $env:WATCHDOG_DOCKER_EXE = @(
            (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'),
            (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe')
        ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    }
    if (!$env:WATCHDOG_DOCKER_EXE) { throw 'Docker Desktop CLI not found.' }
    & (Join-Path $PSScriptRoot 'new-demo.ps1') -Action start
    if ($LASTEXITCODE -ne 0) { throw 'Demo startup failed; Watchdog was not started.' }
    $runner = Join-Path $repo 'tools/resilience-watchdog/run.mjs'
    $config = Join-Path $repo 'tools/resilience-watchdog/demo.config.json'
    $state = Join-Path $PSScriptRoot 'watchdog/demo-state.json'
    $runnerArgs = @($runner, $config, $state, "$IntervalMs", '--initialize')
    if (!$ObserveOnly) { $runnerArgs += '--apply' }
    Write-Host 'Keep this window open. Ctrl+C stops Watchdog, NOT the demo. Stop Watchdog before stop-new-demo.cmd.'
    Write-Host 'Experimental single-normalizer recovery only; autoscaling and live source ingestion are not enabled.'
    & node @runnerArgs
    if ($LASTEXITCODE -ne 0) { throw 'Watchdog stopped for review. Preserve runtime/watchdog state and logs.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally { $env:WATCHDOG_DOCKER_EXE = $previousDocker }
