#!/usr/bin/env python3
"""Install the approved count-only CDC reference into the isolated shadow stack.

This is an operator-side companion to medusa-ci-installer. It consumes the
non-secret profile generated in the Medusa checkout and never targets live DBs.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
PROJECT = os.environ.get("COMPOSE_PROJECT_NAME", "funnelmetry_cdc_shadow")
FILES = ("compose.yml", "compose.reference-mapper.yml", "compose.reference-analytics.yml")
COMPOSE = ["docker", "compose", *(part for name in FILES for part in ("-f", str(ROOT / name)))]
CONNECTOR = "medusa-cdc-shadow"
CONNECT_URL = "http://127.0.0.1:8083/connectors"
STATE = ROOT / "private" / "cdc-reference-installer-state.json"
TABLES = {
    "public.order": {"id", "deleted_at"},
    "public.order_cart": {"id", "order_id", "cart_id"},
    "public.cart": {"id", "completed_at"},
}
PROFILE_KEYS = {
    "schema_version", "generated_by", "status", "source_id", "medusa_version",
    "order_fact_authority", "canonical_live_event", "cdc_reference_contract",
    "source_db_url_ref", "source_owner", "pipeline_owner", "snapshot_mode",
    "publication", "slot", "topic_prefix", "fact_topic", "table_columns",
    "rollback_target", "runtime_activation",
}
EXPECTED = {
    "schema_version": "funnelmetry-medusa-cdc-reference-shadow.v1",
    "generated_by": "funnelmetry-medusa-ci",
    "status": "SHADOW_ONLY",
    "source_id": "medusa-reference",
    "medusa_version": "2.19.0",
    "order_fact_authority": "medusa.order_placed",
    "canonical_live_event": "order.placed",
    "cdc_reference_contract": "reference.medusa.order_recorded_state.v1",
    "source_db_url_ref": "FUNNELMETRY_CDC_SHADOW_DATABASE_URL",
    "snapshot_mode": "no_data",
    "publication": "funnelmetry_cdc_shadow",
    "slot": "funnelmetry_cdc_shadow",
    "topic_prefix": "cdc_shadow_medusa",
    "fact_topic": "cdc_shadow_reference.order_recorded_state.v1",
    "rollback_target": "native_order_placed",
    "runtime_activation": "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER",
}


def profile(path):
    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(document, dict) or set(document) != PROFILE_KEYS:
        raise ValueError("CDC profile fields differ from installer v1")
    if any(document[key] != value for key, value in EXPECTED.items()):
        raise ValueError("CDC profile differs from approved shadow reference v1")
    if document["table_columns"] != [
        "public.order:id,deleted_at", "public.order_cart:id,order_id,cart_id",
        "public.cart:id,completed_at",
    ]:
        raise ValueError("CDC profile table/column allowlist differs")
    if not all(isinstance(document[key], str) and document[key].strip()
               for key in ("source_owner", "pipeline_owner")):
        raise ValueError("CDC profile owners are required")
    return document


def fingerprint(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":"))
                          .encode("utf-8")).hexdigest()


def run(command, *, stdin=None, action="command"):
    result = subprocess.run(command, input=stdin, text=True, capture_output=True, check=False)
    if result.returncode:
        # SQL/Connect/Docker errors may echo connection strings or passwords.
        raise RuntimeError(f"{action} failed (exit {result.returncode}); inspect protected runtime logs")
    return result.stdout.strip()


def compose(*args, stdin=None, action="isolated Compose"):
    return run(COMPOSE + list(args), stdin=stdin, action=action)


def check_compose(config):
    if not re.fullmatch(r"funnelmetry_cdc_shadow(?:_[a-z0-9][a-z0-9_-]{0,32})?", PROJECT):
        raise ValueError("COMPOSE_PROJECT_NAME must be an isolated CDC shadow name")
    if config.get("name") != PROJECT:
        raise ValueError("refusing non-shadow Compose project")
    networks = config.get("networks", {})
    if not networks or any(not network.get("internal") for network in networks.values()):
        raise ValueError("all shadow networks must be internal")
    services = config.get("services", {})
    required = {"postgres", "kafka", "connect", "reference-projection-db",
                "reference-mapper", "reference-analytics-db", "reference-analytics-sink"}
    if not required.issubset(services):
        raise ValueError("shadow Compose services are incomplete")
    if any(service.get("ports") or service.get("network_mode") or
           set(service.get("networks", {})) - set(networks)
           for service in services.values()):
        raise ValueError("shadow services must not publish ports or escape private networks")


def secret_url(document):
    path = ROOT / "private" / "connector.env"
    if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("private/connector.env must be a mode-600 regular file")
    fields = dict(line.split("=", 1) for line in path.read_text(encoding="utf-8").splitlines()
                  if line and not line.startswith("#") and "=" in line)
    value = fields.get(document["source_db_url_ref"], "")
    parsed = urlparse(value)
    if (parsed.scheme not in {"postgres", "postgresql"} or parsed.hostname != "postgres"
        or parsed.port != 5432 or parsed.username != "cdc_shadow" or parsed.path != "/medusa"
        or parsed.query or parsed.fragment or not parsed.password
        or not re.fullmatch(r"[A-Za-z0-9]{16,128}", parsed.password)):
        raise ValueError("shadow database URL secret must target cdc_shadow@postgres:5432/medusa")
    return parsed.password


def sql(statement):
    return compose("exec", "-T", "postgres", "psql", "-X", "-U", "medusa",
                   "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1",
                   stdin=statement, action="shadow PostgreSQL query")


def source_preflight():
    if sql("SELECT current_database() || '|' || current_setting('wal_level');") != "medusa|logical":
        raise ValueError("expected isolated Medusa clone with logical WAL")
    if sql("SELECT to_regclass('public.\"order\"') IS NOT NULL;") != "t":
        raise ValueError("Medusa shadow clone has not been restored")
    slots = sql("SELECT COALESCE(json_agg(json_build_object('slot',slot_name,'plugin',plugin,'db',database,'wal_status',wal_status))::text,'[]') FROM pg_replication_slots WHERE slot_name='funnelmetry_cdc_shadow';")
    slot_rows = json.loads(slots)
    if slot_rows and (len(slot_rows) != 1 or slot_rows[0]["plugin"] != "pgoutput"
                      or slot_rows[0]["db"] != "medusa"):
        raise ValueError("shadow replication slot is owned by another configuration")
    if slot_rows and slot_rows[0]["wal_status"] not in {"reserved", "extended"}:
        raise ValueError("shadow replication slot has unsafe WAL status; operator recovery required")
    return bool(slot_rows)


def publication_state():
    flags = sql("SELECT puballtables::int || '|' || pubinsert::int || '|' || pubupdate::int || '|' || pubdelete::int || '|' || pubtruncate::int FROM pg_publication WHERE pubname='funnelmetry_cdc_shadow';")
    if not flags:
        return "absent"
    if flags != "0|1|1|1|0":
        raise ValueError("shadow publication operations differ from approved profile")
    rows = json.loads(sql("SELECT COALESCE(json_agg(json_build_object('table',schemaname||'.'||tablename,'columns',attnames) ORDER BY tablename)::text,'[]') FROM pg_publication_tables WHERE pubname='funnelmetry_cdc_shadow';"))
    actual = {row["table"]: set(row["columns"]) for row in rows}
    if len(rows) != len(TABLES) or actual != TABLES:
        raise ValueError("shadow publication table/column allowlist differs")
    return "exact"


def bootstrap_source(password):
    publication = publication_state()
    role = sql("SELECT rolcanlogin::int || '|' || rolreplication::int FROM pg_roles WHERE rolname='cdc_shadow';")
    if role and role != "1|1":
        raise ValueError("existing cdc_shadow role lacks required capabilities")
    if not role:
        sql(f"CREATE ROLE cdc_shadow WITH LOGIN REPLICATION PASSWORD '{password}';")
    sql('GRANT USAGE ON SCHEMA public TO cdc_shadow;')
    sql('GRANT SELECT (id,deleted_at) ON public."order" TO cdc_shadow;')
    sql('GRANT SELECT (id,order_id,cart_id) ON public.order_cart TO cdc_shadow;')
    sql('GRANT SELECT (id,completed_at) ON public.cart TO cdc_shadow;')
    if publication == "absent":
        sql('CREATE PUBLICATION funnelmetry_cdc_shadow FOR TABLE '
            'public."order" (id,deleted_at), '
            'public.order_cart (id,order_id,cart_id), '
            "public.cart (id,completed_at) WITH (publish='insert,update,delete');")
    if publication_state() != "exact":
        raise ValueError("shadow publication postcondition failed")


def connector_config(password):
    return {
        "connector.class": "io.debezium.connector.postgresql.PostgresConnector",
        "tasks.max": "1", "database.hostname": "postgres", "database.port": "5432",
        "database.user": "cdc_shadow", "database.password": password,
        "database.dbname": "medusa", "topic.prefix": "cdc_shadow_medusa",
        "plugin.name": "pgoutput", "slot.name": "funnelmetry_cdc_shadow",
        "slot.drop.on.stop": "false", "publication.name": "funnelmetry_cdc_shadow",
        "publication.autocreate.mode": "disabled",
        "table.include.list": "public.order,public.order_cart,public.cart",
        "snapshot.mode": "no_data", "provide.transaction.metadata": "true",
        "heartbeat.interval.ms": "10000", "decimal.handling.mode": "string",
        "key.converter": "org.apache.kafka.connect.json.JsonConverter",
        "key.converter.schemas.enable": "false",
        "value.converter": "org.apache.kafka.connect.json.JsonConverter",
        "value.converter.schemas.enable": "false",
    }


def connect(path="", payload=None, method="GET"):
    command = ("exec", "-T", "connect", "curl", "-fsS", "--retry", "20",
               "--retry-connrefused", "--retry-delay", "2", "--max-time", "5",
               "-H", "Content-Type: application/json", "-X", method)
    if payload is not None:
        command += ("--data-binary", "@-")
    return json.loads(compose(*command, CONNECT_URL + path,
                              stdin=json.dumps(payload) if payload is not None else None,
                              action="shadow Kafka Connect REST")) if method != "DELETE" else compose(
        *command, CONNECT_URL + path, action="shadow Kafka Connect delete")


def connector_state(password, *, require=False):
    names = connect()
    if CONNECTOR not in names:
        if require:
            raise ValueError("CDC reference connector is not registered")
        return "absent"
    active = connect(f"/{CONNECTOR}/config")
    expected = connector_config(password)
    if {key: value for key, value in active.items() if key != "name"} != expected:
        raise ValueError("CDC connector config differs; refusing to take ownership")
    return "exact"


def state(document):
    if not STATE.exists():
        return None
    if STATE.is_symlink() or STATE.stat().st_mode & 0o077:
        raise ValueError("unsafe installer state file")
    saved = json.loads(STATE.read_text(encoding="utf-8"))
    if saved.get("profile_sha256") != fingerprint(document) or saved.get("project") != PROJECT:
        raise ValueError("existing installer state belongs to another profile/project")
    return saved


def save_state(document, status):
    STATE.parent.mkdir(mode=0o700, exist_ok=True)
    data = {"profile_sha256": fingerprint(document), "project": PROJECT,
            "connector": CONNECTOR, "status": status}
    descriptor = os.open(STATE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(data, stream, sort_keys=True)
        stream.write("\n")


def check_runtime_compose():
    check_compose(json.loads(compose("config", "--format", "json", action="shadow Compose preflight")))


def install(document):
    # The operator first prepares a private Medusa DB clone; this command never
    # clones or changes the live source. It only owns the shadow reference path.
    existing = state(document)
    password = secret_url(document)
    for script in ("prepare-reference-mapper-private.py", "prepare-reference-analytics-private.py"):
        run(["python3", str(ROOT / script)], action=f"{script} preparation")
    check_runtime_compose()
    compose("up", "-d", "postgres", action="start cloned shadow PostgreSQL")
    slot_exists = source_preflight()
    if existing is not None and not slot_exists:
        raise ValueError("owned shadow replication slot is missing; refusing automatic recreation")
    compose("up", "-d", "kafka", "connect", action="start private CDC transport")
    connector = connector_state(password)
    if slot_exists and connector == "absent" and (not existing or existing.get("status") != "STOPPED"):
        raise ValueError("orphan shadow replication slot; operator must resolve ownership")
    if existing is None and connector == "exact":
        raise ValueError("existing connector has no installer ownership record")
    save_state(document, "INSTALLING")
    bootstrap_source(password)
    if connector == "absent":
        connect(payload={"name": CONNECTOR, "config": connector_config(password)}, method="POST")
    compose("up", "-d", "--build", "reference-projection-db", "reference-mapper",
            "reference-analytics-db", "reference-analytics-sink",
            action="start reference mapper and analytical sink")
    save_state(document, "INSTALLED")
    return {"status": "installed", "project": PROJECT,
            "profile_sha256": fingerprint(document), "runtime_conformance": "VERIFY_REQUIRED"}


def verify(document):
    saved = state(document)
    if not saved or saved.get("status") != "INSTALLED":
        raise ValueError("installer has not completed for this profile")
    password = secret_url(document)
    check_runtime_compose()
    if not source_preflight():
        raise ValueError("owned shadow replication slot is missing; CDC verification failed")
    if publication_state() != "exact" or connector_state(password, require=True) != "exact":
        raise ValueError("CDC source or connector is incomplete")
    status = connect(f"/{CONNECTOR}/status")
    if status.get("connector", {}).get("state") != "RUNNING" or not status.get("tasks") or any(
        task.get("state") != "RUNNING" for task in status["tasks"]
    ):
        raise ValueError("CDC connector/task is not RUNNING")
    running = set(compose("ps", "--status", "running", "--services").splitlines())
    needed = {"postgres", "kafka", "connect", "reference-projection-db",
              "reference-mapper", "reference-analytics-db", "reference-analytics-sink"}
    if not needed.issubset(running):
        raise ValueError("shadow CDC services are not all running")
    mapper_schema = compose("exec", "-T", "reference-projection-db", "psql", "-X", "-U",
                            "reference_mapper", "-d", "reference_projection", "-At",
                            "-v", "ON_ERROR_STOP=1",
                            stdin="SELECT to_regclass('public.fact_state') IS NOT NULL;",
                            action="reference mapper binding")
    analytics_schema = compose("exec", "-T", "reference-analytics-db", "psql", "-X", "-U",
                               "reference_analytics", "-d", "reference_analytics", "-At",
                               "-v", "ON_ERROR_STOP=1",
                               stdin="SELECT to_regclass('public.reference_order_current_state') IS NOT NULL;",
                               action="reference analytical binding")
    if mapper_schema != "t" or analytics_schema != "t":
        raise ValueError("reference mapper or analytical table is missing")
    # Data-level reconciliation is a separate, explicitly run conformance test
    # after synthetic checkout; this check is infrastructure readiness only.
    return {"status": "pass", "runtime": "SHADOW_ONLY", "services": sorted(needed),
            "data_conformance": "NOT_CHECKED"}


def rollback(document):
    saved = state(document)
    if not saved:
        raise ValueError("no installer ownership record; refusing rollback")
    password = secret_url(document)
    check_runtime_compose()
    connector = connector_state(password)
    compose("stop", "reference-mapper", "reference-analytics-sink",
            action="stop reference consumers")
    if connector == "exact":
        connect(f"/{CONNECTOR}", method="DELETE")
    save_state(document, "STOPPED")
    return {"status": "stopped", "retained": ["replication_slot", "publication",
            "kafka_topics", "postgresql_volumes", "credentials"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply", "verify", "rollback"))
    parser.add_argument("--profile", required=True, type=Path,
                        help="installer-generated funnelmetry/cdc-reference-shadow.json")
    args = parser.parse_args(argv)
    document = profile(args.profile)
    if args.command == "plan":
        if not re.fullmatch(r"funnelmetry_cdc_shadow(?:_[a-z0-9][a-z0-9_-]{0,32})?", PROJECT):
            raise ValueError("COMPOSE_PROJECT_NAME must be an isolated CDC shadow name")
        result = {"status": "planned", "mode": "SHADOW_ONLY", "profile_sha256": fingerprint(document),
                  "project": PROJECT, "source_db_secret_ref": document["source_db_url_ref"],
                  "source_owner": document["source_owner"], "pipeline_owner": document["pipeline_owner"],
                  "preconditions": ["private Medusa PostgreSQL clone restored with logical WAL",
                                    "mode-600 private/connector.env with source DB URL reference",
                                    "private Docker Compose network; no published ports"],
                  "actions": ["validate shadow topology", "create exact 3-table publication",
                              "register one Debezium connector", "start durable mapper and sink"],
                  "rollback": "stop consumers and delete exact connector; retain slot/publication/topics/volumes"}
    elif args.command == "apply":
        result = install(document)
    elif args.command == "verify":
        result = verify(document)
    else:
        result = rollback(document)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-reference-installer: {error}") from None
