$ErrorActionPreference = 'Stop'
$project = 'funnelmetry-image-' + [guid]::NewGuid().ToString('N').Substring(0,12)
$compose = Join-Path $PSScriptRoot 'compose.analytics-image.yml'
try {
    docker compose -p $project -f $compose up -d --wait api
    if ($LASTEXITCODE -ne 0) { throw 'Isolated API startup failed' }
    docker compose -p $project -f $compose exec -T api node /workspace/tools/acceptance.mjs test
    if ($LASTEXITCODE -ne 0) { throw 'Packaged API acceptance failed' }
} finally {
    docker compose -p $project -f $compose down
}
