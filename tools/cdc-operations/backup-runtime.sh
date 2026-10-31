#!/usr/bin/env bash
# CDC-14 logical backup before moving service ownership. Run on the Swarm
# manager; no secret or raw row is printed to stdout.
set -euo pipefail
umask 077

backup_root=${CDC_BACKUP_ROOT:-/srv/KLTN/.cdc14-backups}
case "$backup_root" in
  /srv/KLTN/.cdc14-backups|/srv/KLTN/.cdc14-backups/*) ;;
  *) echo 'CDC_BACKUP_ROOT must stay under /srv/KLTN/.cdc14-backups' >&2; exit 2 ;;
esac
mkdir -p -- "$backup_root"
backup_dir=$(mktemp -d "$backup_root/pre-cutover-XXXXXXXX")

one_container() {
  local service=$1 ids
  mapfile -t ids < <(docker ps -q --filter "label=com.docker.swarm.service.name=$service")
  if [ "${#ids[@]}" -ne 1 ]; then
    echo "expected exactly one running container for $service" >&2
    exit 2
  fi
  printf '%s' "${ids[0]}"
}

pipeline=$(one_container funnelmetry_vps_live_postgres)
mapper=$(one_container funnelmetry_cdc_target_shadow_order-mapper-db)
docker exec "$pipeline" pg_dump -Fc -U funnelmetry -d funnelmetry_handoff > "$backup_dir/pipeline.dump"
docker exec "$mapper" pg_dump -Fc -U reference_cdc_mapper -d reference_cdc_mapper > "$backup_dir/mapper.dump"
for name in pipeline mapper; do
  test -s "$backup_dir/$name.dump"
  docker exec -i "$pipeline" pg_restore -l < "$backup_dir/$name.dump" > "$backup_dir/$name.toc"
  test -s "$backup_dir/$name.toc"
done
sha256sum "$backup_dir/pipeline.dump" "$backup_dir/mapper.dump" > "$backup_dir/SHA256SUMS"
date -u +%FT%TZ > "$backup_dir/created-at-utc"
echo "CDC-14 logical backups and archive TOCs created at $backup_dir"
