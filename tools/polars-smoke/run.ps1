$ErrorActionPreference = 'Stop'
$image = 'funnelmetry-polars-smoke:0.1.0'
docker build -t $image $PSScriptRoot
if ($LASTEXITCODE -ne 0) { throw 'Polars image build failed' }
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 --env PYTHONDONTWRITEBYTECODE=1 --entrypoint python $image -m unittest -v
if ($LASTEXITCODE -ne 0) { throw 'Polars tests failed' }
# One read-only SQL snapshot; no payload, identity or database credentials exported.
$snapshot = Get-Content -Raw (Join-Path $PSScriptRoot 'snapshot.sql') | docker exec -i funnelmetry-private-postgres-1 psql -X -qAt -v ON_ERROR_STOP=1 -U funnelmetry -d funnelmetry
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL snapshot failed; start the private demo first' }
$snapshot | docker run --rm -i --network none --read-only --cap-drop ALL --security-opt no-new-privileges --memory 256m --cpus 1 --env POLARS_MAX_THREADS=1 $image
if ($LASTEXITCODE -ne 0) { throw 'Polars comparison did not pass; inspect report above' }
