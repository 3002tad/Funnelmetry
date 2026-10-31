#!/usr/bin/env bash
# Preserve all CDC-11 source identities while changing only deployment ownership.
set -euo pipefail
umask 077
workers_image=${1:?usage: prepare-live-env.sh IMAGE_AT_DIGEST}
if [[ ! "$workers_image" =~ ^ghcr\.io/3002tad/funnelmetry-cdc-workers@sha256:[a-f0-9]{64}$ ]]; then
  echo 'CDC Workers image must pin the reviewed GHCR digest' >&2
  exit 2
fi
old=/srv/KLTN/.cdc-target-shadow.env
new=/srv/KLTN/Funnelmetry-cdc-profile/runtime/cdc-live.env
test -f "$old"
test ! -e "$new"
awk -v image="$workers_image" '
  /^CDC_WORKERS_IMAGE=/ { print "CDC_WORKERS_IMAGE=" image; next }
  /^CDC_STACK_NAME=|^CDC_MAPPER_DATA_VOLUME=/ { next }
  { print }
  END {
    print "CDC_STACK_NAME=funnelmetry_cdc"
    print "CDC_MAPPER_DATA_VOLUME=funnelmetry_cdc_target_shadow_order-mapper-data"
  }
' "$old" > "$new"
chmod 600 "$new"
echo 'CDC-14 ignored runtime env prepared on VPS; source identities preserved'
