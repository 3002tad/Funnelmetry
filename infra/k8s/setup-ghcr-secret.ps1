# ============================================================================
# GHCR ImagePullSecret Setup (only needed if GHCR packages are PRIVATE)
#
# Creates a docker-registry secret in `realtime` namespace and patches the
# default ServiceAccount to use it for pulling images. After running this,
# all pods in the namespace will be able to pull from private GHCR.
#
# Prerequisites:
#   1. Create a GitHub Personal Access Token (classic) with `read:packages` scope
#      https://github.com/settings/tokens/new?scopes=read:packages
#   2. Pass it via -Token parameter or GHCR_TOKEN env var
#
# Usage:
#   $env:GHCR_TOKEN="ghp_xxxxxxxx"
#   .\setup-ghcr-secret.ps1 -GhcrUser 3002tad
#
#   # OR
#   .\setup-ghcr-secret.ps1 -GhcrUser 3002tad -Token ghp_xxxxxxxx
# ============================================================================

param(
    [Parameter(Mandatory=$true)] [string]$GhcrUser,
    [string]$Token = $env:GHCR_TOKEN,
    [string]$Namespace = "realtime"
)

if (-not $Token) {
    Write-Host "[ERR] No token. Pass -Token <pat> or set `$env:GHCR_TOKEN" -ForegroundColor Red
    Write-Host "Create one at: https://github.com/settings/tokens/new?scopes=read:packages"
    exit 1
}

Write-Host "[INFO] Creating docker-registry secret 'ghcr-cred' in namespace '$Namespace'..."

# Delete old secret if exists (idempotent)
wsl.exe -d Ubuntu -e sudo k3s kubectl delete secret ghcr-cred -n $Namespace --ignore-not-found 2>$null | Out-Null

# Create new
wsl.exe -d Ubuntu -e sudo k3s kubectl create secret docker-registry ghcr-cred `
    --docker-server=ghcr.io `
    --docker-username=$GhcrUser `
    --docker-password=$Token `
    --docker-email="$GhcrUser@users.noreply.github.com" `
    -n $Namespace

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] Failed to create secret" -ForegroundColor Red
    exit 1
}

Write-Host "[INFO] Patching default ServiceAccount to use ghcr-cred for image pulls..."

# Patch the default SA in this namespace so all pods auto-use ghcr-cred
$patch = '{"imagePullSecrets":[{"name":"ghcr-cred"}]}'
wsl.exe -d Ubuntu -e sudo k3s kubectl patch serviceaccount default -n $Namespace -p $patch

if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERR] Failed to patch ServiceAccount" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] GHCR pull secret configured. Existing pods will auto-restart on next rollout." -ForegroundColor Green
Write-Host ""
Write-Host "To force-pull immediately, run:"
Write-Host "  wsl -d Ubuntu -e sudo k3s kubectl rollout restart deployment -n $Namespace --all"
