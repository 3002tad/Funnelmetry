$ErrorActionPreference = 'Stop'
$savedKey = $env:TS_AUTHKEY
$savedRegistry = $env:PRIVATE_GATEWAY_BACKEND_KEYS_JSON
$savedImage = $env:TAILSCALE_IMAGE
Push-Location (Join-Path $PSScriptRoot '..')
try {
    $env:TS_AUTHKEY = 'validation-only-not-a-real-key'
    $env:PRIVATE_GATEWAY_BACKEND_KEYS_JSON = '{}'
    $env:TAILSCALE_IMAGE = 'tailscale/tailscale:stable'
    $raw = & docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress config --format json
    if ($LASTEXITCODE -ne 0) { throw 'Compose validation failed' }
    $config = ($raw -join "`n") | ConvertFrom-Json
    $gateway = $config.services.'input-gateway'
    $sidecar = $config.services.'ts-pipeline'
    if ($gateway.ports.Count -or $sidecar.ports.Count -or $config.services.postgres.ports.Count) { throw 'Unexpected host ports' }
    if ($gateway.network_mode -ne 'service:ts-pipeline' -or $gateway.environment.INPUT_GATEWAY_HOST -ne '127.0.0.1') { throw 'Invalid private bind' }
    if ($gateway.environment.INPUT_GATEWAY_BROWSER_KEYS_JSON -ne '{}' -or $gateway.environment.INPUT_GATEWAY_BACKEND_KEYS_JSON -ne '{}') { throw 'Unexpected bootstrap credentials' }
    if (-not $gateway.depends_on.'kafka-topics' -or -not $gateway.depends_on.'postgres-migrations' -or -not $gateway.depends_on.'ts-pipeline') { throw 'Missing startup dependency' }
    if (($config.services.postgres.healthcheck.test -join ' ') -notmatch 'pg_isready -h 127\.0\.0\.1') { throw 'Postgres readiness must require TCP' }
    if ($sidecar.environment.TS_USERSPACE -ne 'false' -or $sidecar.environment.TS_AUTH_ONCE -ne 'true') { throw 'Invalid Tailscale mode' }
    if ('NET_ADMIN' -notin $sidecar.cap_add -or -not ($sidecar.devices | Where-Object target -eq '/dev/net/tun')) { throw 'Missing kernel networking capability' }
    if (-not ($sidecar.volumes | Where-Object target -eq '/var/lib/tailscale')) { throw 'Missing persistent state' }
    $serve = Get-Content infra/tailscale/serve.json -Raw | ConvertFrom-Json
    if ($serve.AllowFunnel.'${TS_CERT_DOMAIN}:443' -ne $false) { throw 'Funnel must be disabled' }
    if ($serve.Web.'${TS_CERT_DOMAIN}:443'.Handlers.'/'.Proxy -ne 'http://127.0.0.1:31000') { throw 'Incorrect Serve target' }
    # An empty auth key must fail before any runtime operation.
    $env:TS_AUTHKEY = ''
    $ErrorActionPreference = 'Continue'
    & docker compose -p funnelmetry-private -f infra/compose.v2.yml -f infra/compose.private-ingress.yml --profile private-ingress config --quiet 2>$null
    $missingKeyExit = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    if ($missingKeyExit -eq 0) { throw 'Missing key did not fail closed' }
    Write-Output 'PASS: private-ingress configuration checks (no containers started)'
} finally {
    $env:TS_AUTHKEY = $savedKey
    $env:PRIVATE_GATEWAY_BACKEND_KEYS_JSON = $savedRegistry
    $env:TAILSCALE_IMAGE = $savedImage
    Pop-Location
}
