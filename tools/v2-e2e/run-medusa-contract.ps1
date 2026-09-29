param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$project = 'funnelmetry-contract-' + [guid]::NewGuid().ToString('N').Substring(0, 12)
$compose = Join-Path $PSScriptRoot 'compose.medusa-contract.yml'
$previousDatabase = $env:TEST_DATABASE_URL
$previousBrowser = $env:TEST_ORDER_BROWSER
try {
    $env:TEST_ORDER_BROWSER = if ($Browser) { '1' } else { '0' }
    docker compose -p $project -f $compose up -d --wait postgres
    if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL did not start' }
    $binding = docker compose -p $project -f $compose port postgres 5432
    if ($LASTEXITCODE -ne 0 -or $binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected test database port binding' }
    $env:TEST_DATABASE_URL = "postgres://test:isolated-test-only@127.0.0.1:$($Matches[1])/medusa_contract_test"
    node --test (Join-Path $PSScriptRoot 'test/medusa-downstream.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Medusa downstream contract test failed' }
    node --test (Join-Path $PSScriptRoot 'test/catalog-reference.test.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Catalog reference contract test failed' }
} finally {
    $env:TEST_DATABASE_URL = $previousDatabase
    $env:TEST_ORDER_BROWSER = $previousBrowser
    # Only the uniquely named project created by this run; no demo volumes involved.
    docker compose -p $project -f $compose down
}
