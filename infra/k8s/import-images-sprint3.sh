#!/usr/bin/env bash
# Sprint 3 = sprint2 (no commerce/RabbitMQ images). Kept for script compatibility.
set -euo pipefail
exec bash "$(dirname "$0")/import-images-sprint2.sh"
