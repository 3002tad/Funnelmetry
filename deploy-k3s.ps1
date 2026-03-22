# ============================================================================
# K3s Deployment Automation Script (PowerShell)
# Build Docker images and deploy to K3s in WSL
# ============================================================================

param(
    [switch]$BuildOnly,
    [switch]$DeployOnly,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

# Colors for output
function Write-Header {
    param([string]$Text)
    Write-Host "`n" -NoNewline
    Write-Host "=" * 80
    Write-Host "[>>>] $Text" -ForegroundColor Cyan
    Write-Host "=" * 80
}

function Write-Success {
    param([string]$Text)
    Write-Host "[OK] $Text" -ForegroundColor Green
}

function Write-Error {
    param([string]$Text)
    Write-Host "[ERR] $Text" -ForegroundColor Red
}

$RepoRoot = "D:\Detai\Business-Data-Streaming---Processing-Pipeline"
$InfraPath = "$RepoRoot\infra"
$K8sPath = "$RepoRoot\k8s"

# ============================================================================
# Step 1: Build Docker Images
# ============================================================================

if (-not $DeployOnly) {
    Write-Header "STEP 1: Building Docker Images"
    
    Push-Location $InfraPath
    
    Write-Host "Building images..."
    docker-compose build api-generator producer spark-streaming dashboard-api frontend generator-ui
    
    if ($LASTEXITCODE -eq 0) {
        Write-Success "Docker images built successfully"
    } else {
        Write-Error "Docker build failed"
        exit 1
    }
    
    Pop-Location
}

if ($BuildOnly) {
    Write-Success "Build completed. Exiting (BuildOnly flag set)"
    exit 0
}

# ============================================================================
# Step 2: Deploy to K3s (via WSL)
# ============================================================================

if (-not $SkipBuild) {
    Write-Header "STEP 2: Verifying K3s Environment"
    
    $wslCheck = wsl.exe -e sudo k3s kubectl get nodes 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "K3s is not running or not accessible in WSL"
        Write-Host "Run this in WSL Ubuntu first:"
        Write-Host "  sudo systemctl start k3s"
        exit 1
    }
    
    Write-Success "K3s is running and accessible"
}

Write-Header "STEP 3: Deploying K3s Manifest"

$K8sManifest = "$K8sPath\k3s-stack.yaml"
$K8sManifestWSL = "/mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/k8s/k3s-stack.yaml"

Write-Host "Applying K3s manifest..."
wsl.exe -e sudo k3s kubectl apply -f $K8sManifestWSL

if ($LASTEXITCODE -eq 0) {
    Write-Success "K3s manifest applied successfully"
} else {
    Write-Error "Failed to apply K3s manifest"
    exit 1
}

Write-Header "STEP 4: Waiting for Pods to Start"

Write-Host "Waiting 30 seconds for pods to initialize..."
Start-Sleep -Seconds 30

Write-Host "`nChecking pod status..."
wsl.exe -e sudo k3s kubectl get pods -n realtime

Write-Header "STEP 5: Getting Access URLs"

$wslIp = (wsl.exe hostname -I).Trim()

Write-Host ""
Write-Host "[INFO] Access URLs:"
Write-Host "  Dashboard UI:     http://$wslIp`:30173"
Write-Host "  Generator UI:     http://$wslIp`:30174"
Write-Host "  Dashboard API:    http://$wslIp`:30080/health"
Write-Host "  Generator API:    http://$wslIp`:30070/health"

Write-Host ""
Write-Host "[INFO] Monitor pods with:"
Write-Host "  wsl.exe -e sudo k3s kubectl get pods -n realtime -w"

Write-Host "`n[*] View logs with:"
Write-Host "  wsl.exe -e sudo k3s kubectl logs -n realtime pod-name"

Write-Host "COMPLETE: K3s deployment succeeded!"
Write-Host ""
Write-Host "[*] To delete all resources:"
Write-Host "  wsl.exe -e sudo k3s kubectl delete namespace realtime"
Write-Host ""
