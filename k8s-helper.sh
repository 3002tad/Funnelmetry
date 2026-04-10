#!/bin/bash

# ============================================================================
# K3s Deployment Helper Script (Bash for WSL)
# Monitor and manage K3s deployment
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

function header() {
    echo -e "\n${CYAN}$(printf '=%.0s' {1..80})${NC}"
    echo -e "${CYAN}🚀 $1${NC}"
    echo -e "${CYAN}$(printf '=%.0s' {1..80})${NC}\n"
}

function success() {
    echo -e "${GREEN}✅ $1${NC}"
}

function error() {
    echo -e "${RED}❌ $1${NC}"
}

function info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# ============================================================================
# Main Menu
# ============================================================================

header "K3s Deployment Helper"

case "${1:-menu}" in
    apply)
        header "Applying K3s Manifest"
        sudo k3s kubectl apply -f /mnt/d/Detai/Business-Data-Streaming---Processing-Pipeline/k8s/k3s-stack.yaml
        success "Manifest applied"
        ;;
    
    status)
        header "Checking K3s Status"
        echo "📊 K3s Nodes:"
        sudo k3s kubectl get nodes
        echo -e "\n📦 Pods (realtime namespace):"
        sudo k3s kubectl get pods -n realtime -o wide
        echo -e "\n🔌 Services:"
        sudo k3s kubectl get svc -n realtime
        ;;
    
    watch)
        header "Watching Pods (Live)"
        sudo k3s kubectl get pods -n realtime -w
        ;;
    
    logs)
        POD=${2:-}
        if [ -z "$POD" ]; then
            error "Usage: $0 logs <pod-name>"
            echo "Available pods:"
            sudo k3s kubectl get pods -n realtime --no-headers | awk '{print "  - " $1}'
            exit 1
        fi
        header "Logs for pod: $POD"
        sudo k3s kubectl logs -n realtime "$POD" -f
        ;;
    
    delete)
        header "Deleting K3s Deployment"
        read -p "Are you sure? (y/n) " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            sudo k3s kubectl delete namespace realtime
            success "Namespace deleted"
        else
            info "Cancelled"
        fi
        ;;
    
    health)
        header "Checking Service Health"
        WSL_IP=$(hostname -I | awk '{print $1}')
        
        echo "🔗 Testing endpoints..."
        echo "Dashboard API: http://$WSL_IP:30080/health"
        curl -s http://$WSL_IP:30080/health | jq . || echo "⚠️  Dashboard API not responding"
        
        echo -e "\nGenerator API: http://$WSL_IP:30070/health"
        curl -s http://$WSL_IP:30070/health | jq . || echo "⚠️  Generator API not responding"
        ;;
    
    ip)
        WSL_IP=$(hostname -I | awk '{print $1}')
        echo -e "${CYAN}WSL IP: $WSL_IP${NC}"
        echo -e "\n📍 Access URLs:"
        echo "  Dashboard UI:     http://$WSL_IP:30173"
        echo "  Generator UI:     http://$WSL_IP:30174"
        echo "  Dashboard API:    http://$WSL_IP:30080"
        echo "  Generator API:    http://$WSL_IP:30070"
        ;;
    
    restart)
        header "Restarting K3s Service"
        sudo systemctl restart k3s
        sleep 5
        success "K3s restarted"
        sudo k3s kubectl get nodes
        ;;
    
    menu|help|*)
        header "Available Commands"
        cat << EOF
Commands:
  apply              - Apply K3s manifest
  status             - Check pod/service status
  watch              - Watch pods live (Ctrl+C to exit)
  logs <pod>         - View pod logs (live)
  health             - Check API endpoints health
  ip                 - Show WSL IP and access URLs
  delete             - Delete entire realtime namespace
  restart            - Restart K3s service
  help|menu          - Show this menu

Examples:
  $0 apply
  $0 status
  $0 logs api-generator-xyz123
  $0 watch
  $0 health

Quick start from Windows PowerShell:
  .\\deploy-k3s.ps1              # Build + Deploy all
  .\\deploy-k3s.ps1 -BuildOnly   # Only build Docker images
  .\\deploy-k3s.ps1 -DeployOnly  # Only deploy to K3s
EOF
        ;;
esac
