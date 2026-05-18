# ============================================================================
# K3s Deployment Automation Script (PowerShell)
#
# Steps:
#   1. Build Docker images (docker compose, Windows side)
#   2. Save each image to .tar
#   3. Import .tar into K3s containerd (sudo k3s ctr images import)
#   4. kubectl apply -f k3s-stack.yaml
#   5. Show pod status & access URLs
#
# Usage:
#   .\deploy-k3s.ps1                # Full pipeline
#   .\deploy-k3s.ps1 -BuildOnly     # Stop after image build
#   .\deploy-k3s.ps1 -ImportOnly    # Skip build, only import + apply
#   .\deploy-k3s.ps1 -DeployOnly    # Skip build & import, only kubectl apply
# ============================================================================

param(
    [switch]$BuildOnly,
    [switch]$ImportOnly,
    [switch]$DeployOnly
)

$ErrorActionPreference = "Stop"

function Write-Header { param([string]$Text)
    Write-Host "`n$('=' * 80)" -ForegroundColor Cyan
    Write-Host "[>>>] $Text" -ForegroundColor Cyan
    Write-Host "$('=' * 80)" -ForegroundColor Cyan
}
function Write-Ok    { param([string]$Text) Write-Host "[OK]  $Text" -ForegroundColor Green }
function Write-Warn  { param([string]$Text) Write-Host "[!!]  $Text" -ForegroundColor Yellow }
function Write-Err   { param([string]$Text) Write-Host "[ERR] $Text" -ForegroundColor Red }

$RepoRoot   = "D:\Detai\Business-Data-Streaming---Processing-Pipeline"
$InfraPath  = "$RepoRoot\infra"
$K8sPath    = "$RepoRoot\infra\k8s"
$TmpPath    = "$env:TEMP\k3s-images"
$ManifestWSL = "/mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/infra/k8s/k3s-stack.yaml"

# Image mapping: docker compose default tag -> GHCR-style name used in K3s manifest
$ImageMap = [ordered]@{
    "infra-api-generator:latest"   = "ghcr.io/3002tad/realtime-api-generator:latest"
    "infra-producer:latest"        = "ghcr.io/3002tad/realtime-producer-poller:latest"
    "infra-spark-streaming:latest" = "ghcr.io/3002tad/realtime-spark-streaming:latest"
    "infra-dashboard-api:latest"   = "ghcr.io/3002tad/realtime-dashboard-api:latest"
    "infra-dashboard-ui:latest"    = "ghcr.io/3002tad/realtime-dashboard-ui:latest"
    "infra-generator-ui:latest"    = "ghcr.io/3002tad/realtime-generator-ui:latest"
}

# ============================================================================
# Step 1: Build images via docker compose
# ============================================================================
if (-not $ImportOnly -and -not $DeployOnly) {
    Write-Header "STEP 1/4 -Building Docker images"
    Push-Location $InfraPath
    docker compose build api-generator producer spark-streaming dashboard-api dashboard-ui generator-ui
    if ($LASTEXITCODE -ne 0) { Write-Err "docker compose build failed"; exit 1 }
    Pop-Location
    Write-Ok "All 6 images built"
    if ($BuildOnly) { exit 0 }
}

# ============================================================================
# Step 2: Verify K3s is running in WSL
# ============================================================================
Write-Header "STEP 2/4 -Verifying K3s in WSL"
$null = wsl.exe -d Ubuntu -e sudo k3s kubectl get nodes 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Err "K3s not running. In WSL Ubuntu, run:"
    Write-Host "    sudo systemctl start k3s"
    Write-Host "  or install: curl -sfL https://get.k3s.io | sh -"
    exit 1
}
Write-Ok "K3s is healthy"

# ============================================================================
# Step 3: Save images to tar + import into K3s containerd
# (Docker Desktop images are NOT visible to K3s without this step)
# ============================================================================
if (-not $DeployOnly) {
    Write-Header "STEP 3/4 -Importing images into K3s containerd"

    if (-not (Test-Path $TmpPath)) { New-Item -ItemType Directory -Path $TmpPath | Out-Null }

    foreach ($entry in $ImageMap.GetEnumerator()) {
        $localTag = $entry.Key   # e.g. infra-dashboard-api:latest (from docker compose)
        $k3sTag   = $entry.Value # e.g. ghcr.io/3002tad/realtime-dashboard-api:latest

        # Re-tag to match what K3s manifest expects
        docker tag $localTag $k3sTag
        if ($LASTEXITCODE -ne 0) { Write-Err "docker tag failed for $localTag"; exit 1 }

        $tarName = ($k3sTag -replace "[:/]", "_") + ".tar"
        $tarPath = Join-Path $TmpPath $tarName
        $tarWSL  = "/mnt/" + $tarPath.Substring(0,1).ToLower() + ($tarPath.Substring(2) -replace '\\','/')

        Write-Host "  - $k3sTag"
        docker save -o $tarPath $k3sTag
        if ($LASTEXITCODE -ne 0) { Write-Err "docker save failed for $k3sTag"; exit 1 }

        wsl.exe -d Ubuntu -e sudo k3s ctr images import $tarWSL | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Err "k3s ctr import failed for $k3sTag"; exit 1 }

        Remove-Item $tarPath -Force
    }
    Write-Ok "All 6 images imported into K3s"
}

# ============================================================================
# Step 4: Apply manifest
# ============================================================================
Write-Header "STEP 4/4 -Applying K3s manifest"
wsl.exe -d Ubuntu -e sudo k3s kubectl apply -f $ManifestWSL
if ($LASTEXITCODE -ne 0) { Write-Err "kubectl apply failed"; exit 1 }
Write-Ok "Manifest applied"

# ============================================================================
# Status & Access URLs
# ============================================================================
Write-Header "Pod status (waiting 15s for scheduler)"
Start-Sleep -Seconds 15
wsl.exe -d Ubuntu -e sudo k3s kubectl get pods -n realtime -o wide

$wslIp = (wsl.exe -d Ubuntu hostname -I).Trim().Split()[0]
Write-Host ""
Write-Host "Access URLs (NodePort on WSL IP $wslIp)" -ForegroundColor Cyan
Write-Host "  Dashboard UI:  http://${wslIp}:30173  (login: admin / admin123)"
Write-Host "  Generator UI:  http://${wslIp}:30174"
Write-Host "  Dashboard API: http://${wslIp}:30080/health"
Write-Host "  Generator API: http://${wslIp}:30070/health"

Write-Host ""
Write-Host "Helpful commands:" -ForegroundColor Yellow
Write-Host "  Watch pods:    wsl -d Ubuntu -e sudo k3s kubectl get pods -n realtime -w"
Write-Host "  Pod logs:      wsl -d Ubuntu -e sudo k3s kubectl logs -n realtime <pod>"
Write-Host "  Describe pod:  wsl -d Ubuntu -e sudo k3s kubectl describe pod -n realtime <pod>"
Write-Host "  Tear down:     wsl -d Ubuntu -e sudo k3s kubectl delete namespace realtime"
Write-Host ""
Write-Ok "Deployment complete"
