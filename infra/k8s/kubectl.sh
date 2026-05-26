#!/usr/bin/env bash
# Wrapper: use k3s embedded kubectl when standalone kubectl is not installed.
exec k3s kubectl "$@"
