#!/usr/bin/env bash
# Restore both logical archives in an isolated, disposable PostgreSQL instance.
set -euo pipefail
backup_dir=${1:?usage: verify-backup-restore.sh BACKUP_DIR}
case "$backup_dir" in
  /srv/KLTN/.cdc14-backups/pre-cutover-*) ;;
  *) echo 'backup path outside CDC-14 archive root' >&2; exit 2 ;;
esac
test -s "$backup_dir/pipeline.dump"
test -s "$backup_dir/mapper.dump"
(cd "$backup_dir" && sha256sum -c SHA256SUMS >/dev/null)

container=$(docker run -d --network none --tmpfs /var/lib/postgresql/data:rw,size=512m \
  --label funnelmetry.cdc14.restore=temporary \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:15-alpine)
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT

ready=0
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
test "$ready" -eq 1
docker exec "$container" createdb -U postgres funnelmetry_handoff
docker exec "$container" createdb -U postgres reference_cdc_mapper
docker exec -i "$container" pg_restore --no-owner --no-privileges \
  -U postgres -d funnelmetry_handoff < "$backup_dir/pipeline.dump"
docker exec -i "$container" pg_restore --no-owner --no-privileges \
  -U postgres -d reference_cdc_mapper < "$backup_dir/mapper.dump"
docker exec "$container" psql -X -U postgres -d funnelmetry_handoff -Atqc \
  "SELECT count(*) > 0 FROM reference_cdc_v2_order_current_state"
docker exec "$container" psql -X -U postgres -d reference_cdc_mapper -Atqc \
  "SELECT count(*) > 0 FROM reference_cdc_v2_epochs"
echo 'CDC-14 isolated restore completed for Pipeline and mapper archives'
