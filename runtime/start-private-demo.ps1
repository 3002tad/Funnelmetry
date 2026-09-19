# Resume the existing Laptop 2 installation; not a fresh-install/bootstrap script.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$web = Join-Path $repo 'apps/dashboard-web'
$api = 'funnelmetry-private-dashboard-qwen'
$base = @('funnelmetry-private-postgres-1', 'funnelmetry-private-kafka-1', 'funnelmetry-private-ts-pipeline-1')
$workers = @('input-gateway', 'canonical-normalizer', 'canonical-ledger-writer', 'ingress-telemetry-writer', 'journey-processor', 'funnel-processor', 'kpi-projector') | ForEach-Object { "funnelmetry-private-$_-1" }

function Invoke-Docker {
    param([string[]]$DockerArgs)
    & docker @DockerArgs
    if ($LASTEXITCODE -ne 0) { throw "Docker command failed: $($DockerArgs[0]). No data was deleted." }
}

function Wait-Healthy([string]$Name) {
    for ($i = 0; $i -lt 60; $i++) {
        $state = & docker inspect --format '{{.State.Health.Status}}' $Name
        if ($LASTEXITCODE -ne 0) { throw "Cannot inspect $Name" }
        if ($state -eq 'healthy') { return }
        Start-Sleep -Seconds 2
    }
    throw "Timed out waiting for $Name. Check its Docker logs."
}

function Wait-Http([string]$Url) {
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "Not ready: $Url"
}

try {
    Get-Command docker, node -ErrorAction Stop | Out-Null
    $vite = Join-Path $web 'node_modules/vite/bin/vite.js'
    if (!(Test-Path $vite)) { throw "Missing UI dependencies. Run npm ci in $web first." }
    & docker info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Starting Docker Desktop...'
        Invoke-Docker @('desktop', 'start', '--timeout', '120')
    }
    # Preflight metadata only: never dump container environment/secrets.
    foreach ($name in ($base + $workers + @($api))) {
        & docker inspect --format '{{.Name}}' $name 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Missing container $name. This launcher requires the existing private installation." }
    }
    $running = @(& docker ps --format '{{.Names}}')
    $portOwner = @(Get-NetTCPConnection -State Listen -LocalPort 32000 -ErrorAction SilentlyContinue)
    if ($portOwner.Count -gt 0 -and $api -notin $running) {
        throw 'Port 32000 is in use by another API. Stop the old demo API first.'
    }
    Write-Host 'Starting private infrastructure...'
    Invoke-Docker (@('start') + $base)
    Wait-Healthy $base[0]
    Wait-Healthy $base[1]
    Write-Host 'Starting processing workers and dashboard API...'
    Invoke-Docker (@('start') + $workers + @($api))
    Wait-Healthy 'funnelmetry-private-input-gateway-1'
    Wait-Http 'http://127.0.0.1:32000/health'
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort 5180 -ErrorAction SilentlyContinue)
    if ($listener.Count -gt 0) {
        $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener[0].OwningProcess)"
        $sameUi = $false
        foreach ($match in [regex]::Matches([string]$owner.CommandLine, '"([^"]+vite\.js)"')) {
            if ([IO.Path]::GetFullPath($match.Groups[1].Value) -eq [IO.Path]::GetFullPath($vite)) { $sameUi = $true }
        }
        if (!$sameUi) {
            throw 'Port 5180 is already in use. Close the existing UI process and run this launcher again.'
        }
    } else {
        Start-Process -FilePath (Get-Command node).Source -ArgumentList @("`"$vite`"", '--host', '127.0.0.1', '--port', '5180', '--strictPort') -WorkingDirectory $web -WindowStyle Hidden -RedirectStandardOutput (Join-Path $PSScriptRoot 'private-ui.log') -RedirectStandardError (Join-Path $PSScriptRoot 'private-ui-error.log') | Out-Null
    }
    Wait-Http 'http://127.0.0.1:5180'
    foreach ($name in $workers) {
        $state = & docker inspect --format '{{.State.Running}}' $name
        if ($LASTEXITCODE -ne 0 -or $state -ne 'true') { throw "Worker not running: $name" }
    }
    Write-Host 'UI and API ready: http://localhost:5180'
    Write-Host 'Worker processes running; this is not an end-to-end event acceptance test.'
    if (!$NoBrowser) { Start-Process 'http://localhost:5180' }
} catch {
    Write-Host "Startup stopped: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
