param(
    [switch]$SkipBuild, [switch]$WithPipeline, [switch]$WithAnalytics, [switch]$WithWatchdog, [switch]$WithScale,
    [string]$ApiImage = 'funnelmetry/handoff-api:local',
    [string]$WebImage = 'funnelmetry/handoff-web:local',
    [string]$WorkersImage = 'funnelmetry/handoff-workers:local'
)
$ErrorActionPreference = 'Stop'
if ($WithWatchdog -and !$WithPipeline) { throw 'Watchdog acceptance requires WithPipeline' }
if ($WithScale -and (!$WithPipeline -or $WithWatchdog)) { throw 'Scale test requires Pipeline and a separate run from Watchdog' }
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCommand) { $dockerExe = $dockerCommand.Source } else {
    $dockerExe = @(
        (Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'),
        (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe')
    ) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
    if (!$dockerExe) { throw 'Docker CLI not found. Install Docker Desktop or add docker.exe to PATH.' }
}
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$project = 'funnelmetry-handoff-test-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$compose = Join-Path $repo 'infra/compose.handoff.yml'
$template = Join-Path $repo 'runtime/handoff.env.example'
$settings = @{
    HANDOFF_PROJECT = $project
    HANDOFF_API_IMAGE = $ApiImage
    HANDOFF_WEB_IMAGE = $WebImage
    HANDOFF_WORKERS_IMAGE = $WorkersImage
    HANDOFF_UI_PORT = '0'
    HANDOFF_DB_PASSWORD = [guid]::NewGuid().ToString('N')
    HANDOFF_JWT_SECRET = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
    HANDOFF_ADMIN_EMAIL = "$project@handoff-acceptance.invalid"
    HANDOFF_ADMIN_PASSWORD = [guid]::NewGuid().ToString('N')
    HANDOFF_ENABLE_QWEN = 'false'
    HANDOFF_DASHSCOPE_API_KEY = ''
}
$previous = @{}
$previousPath = $env:PATH
$created = $false
function Invoke-DockerChecked {
    param([string[]]$Arguments)
    & $dockerExe @Arguments
    if ($LASTEXITCODE -ne 0) { throw 'Docker handoff operation failed; no live environment was targeted' }
}
try {
    # Docker invokes its credential helper by name, even when docker.exe is absolute.
    # Scope this PATH adjustment to the current process and restore it on exit.
    $env:PATH = (Split-Path -Parent $dockerExe) + [IO.Path]::PathSeparator + $previousPath
    foreach ($key in $settings.Keys) {
        $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process')
        [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process')
    }
    Invoke-DockerChecked -Arguments @('info', '--format', '{{.OSType}}/{{.Architecture}}')
    if (!$SkipBuild) {
        Invoke-DockerChecked -Arguments @('build', '-f', (Join-Path $repo 'apps/dashboard-api/Dockerfile.analytics'), '-t', $settings.HANDOFF_API_IMAGE, $repo)
        Invoke-DockerChecked -Arguments @('build', '-f', (Join-Path $repo 'apps/dashboard-web/Dockerfile'), '-t', $settings.HANDOFF_WEB_IMAGE, $repo)
        if ($WithPipeline) {
            Invoke-DockerChecked -Arguments @('build', '-f', (Join-Path $repo 'infra/docker/pipeline-workers.Dockerfile'), '-t', $settings.HANDOFF_WORKERS_IMAGE, $repo)
        }
    }
    Invoke-DockerChecked -Arguments @('run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', $settings.HANDOFF_API_IMAGE, 'node', '/workspace/tools/analytics-image-smoke.mjs')
    $common = @('compose', '-p', $project, '--env-file', $template, '-f', $compose)
    if ($WithPipeline) { $common += @('-f', (Join-Path $repo 'infra/compose.handoff-pipeline.yml')) }
    if ($WithAnalytics) { $common += @('-f', (Join-Path $repo 'infra/compose.handoff-analytics.yml')) }
    if ($WithWatchdog) { $common += @('-f', (Join-Path $PSScriptRoot '../resilience-watchdog/compose.test.yml')) }
    if ($WithScale) { $common += @('-f', (Join-Path $PSScriptRoot '../autoscaler/compose.test.yml')) }
    Invoke-DockerChecked -Arguments ($common + @('config', '--quiet'))
    # Random project and port; never reads a real runtime env or mounts source data.
    $created = $true
    Invoke-DockerChecked -Arguments ($common + @('up', '-d', '--wait', '--wait-timeout', '180'))
    # Verify the actual running runtime, not only Dockerfile declarations.
    $runtimeProbe = 'test "$(id -u)" != 0 && test ! -d /app/node_modules && test ! -d /workspace/runtime && ! command -v node && ! touch /usr/share/nginx/html/.handoff-write-probe'
    $runtimeProbe | & $dockerExe @common exec -T dashboard-web sh -es
    if ($LASTEXITCODE -ne 0) { throw 'UI runtime hardening probe failed' }
    $probe = Get-Content (Join-Path $PSScriptRoot 'test/handoff-acceptance.mjs') -Raw -Encoding UTF8
    $probe | & $dockerExe @common exec -T -e HANDOFF_ACCEPTANCE_MODE=initial dashboard-api node --input-type=module
    if ($LASTEXITCODE -ne 0) { throw 'Initial image acceptance failed' }
    if ($WithPipeline) {
        $pipelineProbe = Get-Content (Join-Path $PSScriptRoot 'test/handoff-pipeline.mjs') -Raw -Encoding UTF8
        $pipelineProbe | & $dockerExe @common exec -T -e HANDOFF_PIPELINE_TEST=initial canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Kafka downstream acceptance failed' }
    }
    if ($WithWatchdog) {
        & node (Join-Path $PSScriptRoot '../resilience-watchdog/pipeline-smoke.mjs') $project $dockerExe
        if ($LASTEXITCODE -ne 0) { throw 'Real worker Watchdog recovery acceptance failed' }
    }
    if ($WithScale) {
        $scaleProbe = Get-Content (Join-Path $PSScriptRoot '../autoscaler/kafka-scale-probe.mjs') -Raw -Encoding UTF8
        $scaleProbe | & $dockerExe @common exec -T -e SCALE_STAGE=prepare -e "SCALE_PROJECT=$project" canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Isolated scale preparation failed' }
        Invoke-DockerChecked -Arguments ($common + @('up', '-d', '--no-deps', '--scale', 'canonical-normalizer=2', 'canonical-normalizer'))
        $identityProbe = "import { loadConfig } from './src/config.js'; console.log(loadConfig().instanceId)"
        $identityOne = $identityProbe | & $dockerExe @common exec -T --index 1 canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect replica 1 identity' }
        $identityTwo = $identityProbe | & $dockerExe @common exec -T --index 2 canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0 -or !$identityOne -or !$identityTwo -or $identityOne -eq $identityTwo) { throw 'Replica transactional identities must differ' }
        Write-Host 'PASS: two distinct container-scoped transactional identities'
        $scaleProbe | & $dockerExe @common exec -T -e SCALE_STAGE=two -e "SCALE_PROJECT=$project" canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Two replica membership/identity acceptance failed' }
        $pipelineProbe | & $dockerExe @common exec -T -e HANDOFF_PIPELINE_TEST=scale-enqueue canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Two replica data acceptance failed' }
        $observationJson = & node (Join-Path $PSScriptRoot '../autoscaler/observe.mjs') $project
        if ($LASTEXITCODE -ne 0) { Write-Host $observationJson; throw 'Read-only scale observation failed' }
        $observation = $observationJson | ConvertFrom-Json
        if ($observation.snapshot.lag -ne '0' -or $observation.snapshot.replicas -ne 2 -or
            $observation.snapshot.partitions -ne 2 -or !$observation.snapshot.groupStable -or
            !$observation.snapshot.identityVerified -or !$observation.snapshot.ready -or
            $null -ne $observation.snapshot.hostReplicaLimit -or $observation.snapshot.replayVerified) {
            throw 'Observer must report exact two-replica runtime without inventing scale authorization'
        }
        Write-Host 'PASS: read-only observer sees 2 replicas/2 partitions/lag 0; capacity and release gates remain unverified'
        $beforeScaleIds = @(& $dockerExe @common ps -q canonical-normalizer)
        $scaleDownSince = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds().ToString()
        Invoke-DockerChecked -Arguments ($common + @('up', '-d', '--no-deps', '--scale', 'canonical-normalizer=1', 'canonical-normalizer'))
        $afterScaleIds = @(& $dockerExe @common ps -q canonical-normalizer)
        $removedIds = @($beforeScaleIds | Where-Object { $_ -notin $afterScaleIds })
        if ($removedIds.Count -ne 1) { throw 'Expected exactly one removed replica' }
        $scaleDownUntil = ([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() + 1).ToString()
        $exitCodes = @(& $dockerExe events --since $scaleDownSince --until $scaleDownUntil --filter "container=$($removedIds[0])" --filter event=die --format '{{.Actor.Attributes.exitCode}}')
        if ($LASTEXITCODE -ne 0 -or $exitCodes.Count -ne 1 -or $exitCodes[0] -ne '0') { throw 'Scale-down did not prove a clean exit' }
        Write-Host 'PASS: removed replica exited cleanly (0), not forced kill'
        $scaleProbe | & $dockerExe @common exec -T -e SCALE_STAGE=one -e "SCALE_PROJECT=$project" canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Scale-down membership acceptance failed' }
        $pipelineProbe | & $dockerExe @common exec -T -e HANDOFF_PIPELINE_TEST=scale-replay canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Scale-down replay acceptance failed' }
    }
    Invoke-DockerChecked -Arguments ($common + @('stop'))
    Invoke-DockerChecked -Arguments ($common + @('up', '-d', '--wait', '--wait-timeout', '180'))
    $eventCount = if ($WithPipeline) { '4' } else { '0' }
    if ($WithWatchdog -or $WithScale) { $eventCount = '5' }
    $checkSummary = if ($WithPipeline -and $WithAnalytics) { 'true' } else { 'false' }
    $probe | & $dockerExe @common exec -T -e HANDOFF_ACCEPTANCE_MODE=resume -e "HANDOFF_EXPECT_EVENTS=$eventCount" -e "HANDOFF_CHECK_SUMMARY=$checkSummary" dashboard-api node --input-type=module
    if ($LASTEXITCODE -ne 0) { throw 'Restart persistence acceptance failed' }
    if ($WithPipeline) {
        $pipelineProbe | & $dockerExe @common exec -T -e HANDOFF_PIPELINE_TEST=resume -e "HANDOFF_EXPECT_EVENTS=$eventCount" canonical-normalizer node --input-type=module
        if ($LASTEXITCODE -ne 0) { throw 'Kafka downstream persistence acceptance failed' }
    }
    Write-Host 'PASS: isolated image handoff acceptance; not a live-ingestion or AI certification'
} finally {
    try {
        if ($created -and $project -match '^funnelmetry-handoff-test-[a-f0-9]{12}$') {
            # Validate exact disposable volume ownership before deleting test data.
            $volume = $project + '_handoff-db'
            $ownedVolumes = @(& $dockerExe volume ls --filter "label=com.docker.compose.project=$project" --format '{{.Name}}')
            $expectedVolumes = @($volume)
            if ($WithPipeline) { $expectedVolumes += $project + '_handoff-kafka' }
            $unexpected = @($ownedVolumes | Where-Object { $_ -notin $expectedVolumes })
            if ($LASTEXITCODE -eq 0 -and $ownedVolumes.Count -gt 0 -and $unexpected.Count -eq 0) {
                & $dockerExe @common down --volumes
                if ($LASTEXITCODE -ne 0) { Write-Warning "Cleanup failed for test project $project" }
                else { Write-Host 'Removed only this run''s disposable containers/network/test database. Built images retained.' }
            } else {
                & $dockerExe @common down
                Write-Warning "Test volume ownership unverified; no volumes deleted for $project"
            }
        }
    } finally {
        $env:PATH = $previousPath
        foreach ($key in $previous.Keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    }
}
