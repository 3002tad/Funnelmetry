# Build all k3s images (Sprint 1 + 2) and import into WSL k3s.
# Run from repo root in PowerShell.

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location $Root

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker CLI not found. Start Docker Desktop first."
}

$images = @(
  @{ Name = "tracking-api:dev"; Context = "services/tracking-api" },
  @{ Name = "streaming-processor:dev"; Context = "services/streaming-processor" },
  @{ Name = "dashboard-api:dev"; Context = "services/dashboard-api" },
  @{ Name = "dashboard-ui:dev"; Context = "clients/dashboard"; BuildArgs = @("--build-arg", "VITE_DASHBOARD_API_URL=") }
)

foreach ($img in $images) {
  Write-Host "Building $($img.Name) ..."
  if ($img.BuildArgs) {
    docker build -t $img.Name @($img.BuildArgs) $img.Context
  } else {
    docker build -t $img.Name $img.Context
  }
}

foreach ($img in $images) {
  Write-Host "Importing $($img.Name) into k3s ..."
  docker save $img.Name | wsl -d Ubuntu -- sudo k3s ctr images import -
}

Write-Host "Done."
