param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^ghcr\.io/[a-z0-9][a-z0-9_.-]*/funnelmetry$')]
    [string]$Registry,
    [switch]$Publish
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$gitSafe = 'safe.directory=' + $repo.Replace('\', '/')
$revision = & git -c $gitSafe -C $repo rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -notmatch '^[a-f0-9]{40}$') { throw 'Cannot identify source commit' }
$dirty = & git -c $gitSafe -C $repo status --porcelain
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit reviewed changes first. Dirty worktree cannot be published as a pinned release.' }
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerExe = if ($dockerCommand) { $dockerCommand.Source } else {
    @((Join-Path $env:LOCALAPPDATA 'Programs/DockerDesktop/resources/bin/docker.exe'),
      (Join-Path $env:ProgramFiles 'Docker/Docker/resources/bin/docker.exe')) |
      Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1
}
if (!$dockerExe) { throw 'Docker CLI not found' }
$previousPath = $env:PATH
$images = [ordered]@{
    api = @{ file = 'apps/dashboard-api/Dockerfile.analytics'; image = "$Registry/handoff-api`:sha-$revision" }
    web = @{ file = 'apps/dashboard-web/Dockerfile'; image = "$Registry/handoff-web`:sha-$revision" }
    workers = @{ file = 'infra/docker/pipeline-workers.Dockerfile'; image = "$Registry/handoff-workers`:sha-$revision" }
}
try {
    $env:PATH = (Split-Path -Parent $dockerExe) + [IO.Path]::PathSeparator + $previousPath
    foreach ($item in $images.Values) {
        & $dockerExe build --label "org.opencontainers.image.revision=$revision" -f (Join-Path $repo $item.file) -t $item.image $repo
        if ($LASTEXITCODE -ne 0) { throw 'Release image build failed; nothing published' }
    }
    & powershell -NoProfile -File (Join-Path $PSScriptRoot 'v2-e2e/run-handoff.ps1') -SkipBuild -WithPipeline -WithAnalytics -ApiImage $images.api.image -WebImage $images.web.image -WorkersImage $images.workers.image
    if ($LASTEXITCODE -ne 0) { throw 'Acceptance failed; nothing published' }
    # Recheck after testing: do not publish a worktree changed during the build.
    $afterRevision = & git -c $gitSafe -C $repo rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $afterRevision -ne $revision) { throw 'Source commit changed during build' }
    $afterDirty = & git -c $gitSafe -C $repo status --porcelain
    if ($LASTEXITCODE -ne 0 -or $afterDirty) { throw 'Source changed during build; nothing published' }
    foreach ($item in $images.Values) {
        if ($Publish) {
            & $dockerExe push $item.image
            if ($LASTEXITCODE -ne 0) { throw 'Push failed; earlier images may already be published. Do not declare release complete.' }
        }
        & $dockerExe image inspect $item.image --format '{{json .RepoTags}} {{.Id}} {{json .RepoDigests}} {{.Os}}/{{.Architecture}}'
        if ($LASTEXITCODE -ne 0) { throw 'Cannot record image identity' }
    }
    Write-Host "Commit: $revision. Published: $Publish. Scope: isolated downstream handoff; not live source/AI acceptance."
} finally { $env:PATH = $previousPath }
