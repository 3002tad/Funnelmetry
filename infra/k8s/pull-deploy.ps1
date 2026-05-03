# ============================================================================
# K3s Pull-Deploy Script (PowerShell)
# Pulls latest images from GHCR + imports to K3s + applies manifest.
# Use this AFTER GitHub Actions builds new images.
#
# Usage:
#   .\pull-deploy.ps1                 # Full pull-deploy
#   .\pull-deploy.ps1 -Tag sha-abc123 # Use specific image tag (default: latest)
#   .\pull-deploy.ps1 -SkipPull       # Skip docker pull (just re-import + apply)
# ============================================================================

param(
    [string]$Tag = "latest",
    [switch]$SkipPull,
    [switch]$ApplyOnly
)

$ErrorActionPreference = "Stop"

function Write-Header { param([string]$Text)
    Write-Host "`n$('=' * 80)" -ForegroundColor Cyan
    Write-Host "[>>>] $Text" -ForegroundColor Cyan
    Write-Host "$('=' * 80)" -ForegroundColor Cyan
}
function Write-Ok  { param([string]$Text) Write-Host "[OK]  $Text" -ForegroundColor Green }
function Write-Err { param([string]$Text) Write-Host "[ERR] $Text" -ForegroundColor Red }

$RepoRoot   = "D:\Detai\Business-Data-Streaming---Processing-Pipeline"
$TmpPath    = "$env:TEMP\k3s-images"
$ManifestWSL = "/mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/infra/k8s/k3s-stack.yaml"

$Images = @(
    "ghcr.io/3002tad/realtime-api-generator",
    "ghcr.io/3002tad/realtime-producer-poller",
    "ghcr.io/3002tad/realtime-spark-streaming",
    "ghcr.io/3002tad/realtime-dashboard-api",
    "ghcr.io/3002tad/realtime-dashboard-ui",
    "ghcr.io/3002tad/realtime-generator-ui"
)

# ============================================================================
# Step 1: Pull from GHCR
# ============================================================================
if (-not $SkipPull -and -not $ApplyOnly) {
    Write-Header "STEP 1/3 - Pulling images from GHCR (tag=$Tag)"
    foreach ($img in $Images) {
        $full = "${img}:${Tag}"
        Write-Host "  - $full"
        docker pull $full
        if ($LASTEXITCODE -ne 0) { Write-Err "docker pull failed for $full"; exit 1 }

        # Tag as :latest so K3s manifest finds it
        if ($Tag -ne "latest") {
            docker tag $full "${img}:latest"
        }
    }
    Write-Ok "All 6 images pulled"
}

# ============================================================================
# Step 2: Import into K3s containerd
# ============================================================================
if (-not $ApplyOnly) {
    Write-Header "STEP 2/3 - Importing images into K3s containerd"
    if (-not (Test-Path $TmpPath)) { New-Item -ItemType Directory -Path $TmpPath | Out-Null }

    foreach ($img in $Images) {
        $latestTag = "${img}:latest"
        $tarName = ($latestTag -replace "[:/]", "_") + ".tar"
        $tarPath = Join-Path $TmpPath $tarName
        $tarWSL  = "/mnt/" + $tarPath.Substring(0,1).ToLower() + ($tarPath.Substring(2) -replace '\\','/')

        Write-Host "  - $latestTag"
        docker save -o $tarPath $latestTag
        if ($LASTEXITCODE -ne 0) { Write-Err "docker save failed for $latestTag"; exit 1 }

        wsl.exe -d Ubuntu -e sudo k3s ctr images import $tarWSL | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Err "k3s ctr import failed for $latestTag"; exit 1 }

        Remove-Item $tarPath -Force
    }
    Write-Ok "All 6 images imported into K3s"
}

# ============================================================================
# Step 3: Apply manifest + force-restart deployments to pick up new images
# ============================================================================
Write-Header "STEP 3/3 - Applying manifest + rolling restart"
wsl.exe -d Ubuntu -e sudo k3s kubectl apply -f $ManifestWSL
if ($LASTEXITCODE -ne 0) { Write-Err "kubectl apply failed"; exit 1 }

# Force rollout so existing pods are replaced with new image (since :latest stays the same)
$Deployments = @("api-generator","producer","spark-streaming","dashboard-api","dashboard-ui","generator-ui")
foreach ($dep in $Deployments) {
    wsl.exe -d Ubuntu -e sudo k3s kubectl rollout restart deployment -n realtime $dep | Out-Null
}
Write-Ok "Manifest applied + deployments rolled"

# ============================================================================
# Status
# ============================================================================
Write-Header "Pod status (waiting 10s for rollout)"
Start-Sleep -Seconds 10
wsl.exe -d Ubuntu -e sudo k3s kubectl get pods -n realtime -o wide

$wslIp = (wsl.exe -d Ubuntu hostname -I).Trim().Split()[0]
Write-Host ""
Write-Host "Access URLs:" -ForegroundColor Cyan
Write-Host "  Dashboard UI:  http://${wslIp}:30173"
Write-Host "  Generator UI:  http://${wslIp}:30174"
Write-Host ""
Write-Ok "Pull-deploy complete"
