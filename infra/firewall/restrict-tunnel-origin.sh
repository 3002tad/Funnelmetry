#!/usr/bin/env bash
# Keep a Swarm host-published HTTP origin reachable only from the local tunnel.
set -euo pipefail

port="${1:-}"
external_interface="${2:-}"
if [[ ! "$port" =~ ^[0-9]+$ ]] || (( port < 1024 || port > 65535 )); then
  echo 'Expected an unprivileged TCP origin port' >&2
  exit 2
fi
if [[ ! "$external_interface" =~ ^[a-zA-Z0-9_.:-]+$ ]]; then
  echo 'Expected an external network interface name' >&2
  exit 2
fi

for firewall in iptables ip6tables; do
  command -v "$firewall" >/dev/null
  for chain in DOCKER-USER INPUT; do
    if ! "$firewall" -w -S "$chain" >/dev/null 2>&1; then
      echo "$firewall $chain chain is unavailable" >&2
      exit 1
    fi
    if [[ "$chain" == DOCKER-USER ]]; then
      spec=(-i "$external_interface" -p tcp -m conntrack --ctorigdstport "$port" -j DROP)
    else
      spec=(-i "$external_interface" -p tcp --dport "$port" -j DROP)
    fi
    if ! "$firewall" -w -C "$chain" "${spec[@]}" >/dev/null 2>&1; then
      "$firewall" -w -I "$chain" 1 "${spec[@]}"
    fi
  done
done
