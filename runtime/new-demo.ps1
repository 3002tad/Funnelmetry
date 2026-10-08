param([ValidateSet('start', 'stop', 'status')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$config = Join-Path $PSScriptRoot 'demo-new.env'
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerExe = if ($dockerCommand) { $dockerCommand.Source } else {
    @((Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'),
      (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe')) |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
$previousPath = $env:PATH
try {
    if (!$dockerExe) { throw 'Docker CLI not found. Install Docker Desktop.' }
    if (!(Test-Path -LiteralPath $config)) { throw 'Missing runtime/demo-new.env. See runtime/NEW_DEMO.md.' }
    $env:PATH = (Split-Path -Parent $dockerExe) + [IO.Path]::PathSeparator + $previousPath
    & $dockerExe info --format '{{.ServerVersion}}' 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop (Linux containers), then retry.' }
    $arguments = @('compose', '-p', 'funnelmetry-demo-new', '--env-file', $config,
      '-f', (Join-Path $repo 'infra/compose.handoff.yml'),
      '-f', (Join-Path $repo 'infra/compose.handoff-pipeline.yml'),
      '-f', (Join-Path $repo 'infra/compose.handoff-analytics.yml'),
      '-f', (Join-Path $repo 'infra/compose.handoff-monitoring.yml'))
    & $dockerExe @arguments config --quiet
    if ($LASTEXITCODE -ne 0) { throw 'Invalid demo config.' }
    if ($Action -eq 'start') {
        & $dockerExe @arguments up -d --pull never --wait --wait-timeout 180
    } elseif ($Action -eq 'stop') {
        & $dockerExe @arguments stop
    } else {
        & $dockerExe @arguments ps -a
    }
    if ($LASTEXITCODE -ne 0) { throw 'Demo operation failed; no reset or volume cleanup attempted.' }
    if ($Action -eq 'start') {
        $binding = @(& $dockerExe @arguments port dashboard-web 8080)
        if ($LASTEXITCODE -ne 0 -or $binding.Count -ne 1 -or $binding[0] -notmatch '^127\.0\.0\.1:([0-9]+)$') {
            throw 'Cannot verify the loopback UI port. Containers were not stopped or reset.'
        }
        $demoUrl = 'http://127.0.0.1:' + $Matches[1]
        try {
            $page = Invoke-WebRequest -Uri ($demoUrl + '/') -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0
            if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'id="root"') {
                throw 'Unexpected UI response.'
            }
        } catch { throw 'UI is not reachable from this host. Containers are preserved; inspect status before retrying.' }
        # Anonymous read only: verifies nginx -> API routing without loading credentials.
        $probeScript = 'fetch("http://dashboard-web:8080/api/v2/admin/event-feed", {redirect:"error", signal:AbortSignal.timeout(10000)}).then(r=>{if(r.status!==401)process.exit(1)}).catch(()=>process.exit(1))'
        $probeScript | & $dockerExe @arguments exec -T dashboard-api node --input-type=module -
        if ($LASTEXITCODE -ne 0) {
            throw 'API routing/auth boundary verification failed. Containers and data are preserved.'
        }
        Write-Host "Demo services started. Verified UI: $demoUrl and anonymous API access denied."
        Write-Host 'Readiness is not evidence of live ingestion, zero backlog, or completed downstream processing.'
        Write-Host 'Offline fresh demo: Medusa ingestion and Qwen are NOT enabled.'
        Write-Host 'Admin email/password are in runtime/demo-new.env; create Analyst in Users for analytics.'
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally { $env:PATH = $previousPath }
