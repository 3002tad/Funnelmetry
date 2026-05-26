#!/usr/bin/env bash
# Install k3s on WSL2 Ubuntu (Laptop 1 backend node).
# Run inside Ubuntu: bash infra/k8s/install-k3s-wsl.sh

set -euo pipefail

if ! command -v curl >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y curl
fi

echo "Installing k3s (single-node)..."
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--write-kubeconfig-mode 644" sh -

export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
mkdir -p "$HOME/.kube"
cp /etc/rancher/k3s/k3s.yaml "$HOME/.kube/config"
chmod 600 "$HOME/.kube/config"

if ! grep -q "alias kubectl='k3s kubectl'" "$HOME/.bashrc" 2>/dev/null; then
  echo "alias kubectl='k3s kubectl'" >> "$HOME/.bashrc"
  echo "Added alias kubectl='k3s kubectl' to ~/.bashrc"
fi

echo ""
echo "k3s ready. Nodes:"
k3s kubectl get nodes

echo ""
echo "Kubeconfig: $HOME/.kube/config"
echo "Deploy full stack: k3s kubectl apply -k infra/k8s/sprint3"
echo "From Windows PowerShell:"
echo '  wsl -d Ubuntu -- k3s kubectl get nodes'
