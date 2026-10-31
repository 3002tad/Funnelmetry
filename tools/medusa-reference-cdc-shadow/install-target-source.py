#!/usr/bin/env python3
"""Provision the three exact Medusa CDC-11 shadow source profiles.

Runs on the source owner host with Docker access. It never changes a Medusa
business table, starts Connect, or changes Pipeline analytical authority.
Credentials and the ownership journal stay outside Git in a mode-700 directory.
"""

import argparse
import hashlib
import json
import os
import re
import secrets
import subprocess
from pathlib import Path


SPECS = {
    "order": ("cdc-order-v2-shadow.json", "funnelmetry-medusa-cdc-order-v2-shadow.v1",
              "cdc_order_v2_e1", "funnelmetry_cdc_order_v2_e1",
              ("public.order:id,deleted_at", "public.order_cart:id,order_id,cart_id",
               "public.cart:id,completed_at")),
    "catalog": ("cdc-catalog-shadow.json", "funnelmetry-medusa-cdc-catalog-shadow.v2",
                "cdc_catalog", "funnelmetry_cdc_catalog_shadow",
                ("public.product:id,title,handle,status,collection_id,updated_at,deleted_at",
                 "public.product_variant:id,product_id,title,sku,manage_inventory,allow_backorder,updated_at,deleted_at",
                 "public.product_category:id,name,parent_category_id,is_active,is_internal,updated_at,deleted_at",
                 "public.product_category_product:product_id,product_category_id")),
    "inventory_price": ("cdc-inventory-price-shadow.json",
                        "funnelmetry-medusa-cdc-inventory-price-shadow.v3",
                        "cdc_inventory_price_v2", "funnelmetry_cdc_inventory_price_shadow_v2",
                        ("public.product_sales_channel:id,product_id,sales_channel_id,deleted_at",
                         "public.sales_channel:id,name,is_disabled,deleted_at",
                         "public.sales_channel_stock_location:id,sales_channel_id,stock_location_id,deleted_at",
                         "public.stock_location:id,name,deleted_at",
                         "public.product_variant_inventory_item:id,variant_id,inventory_item_id,required_quantity,deleted_at",
                         "public.inventory_item:id,sku,requires_shipping,deleted_at",
                         "public.inventory_level:id,inventory_item_id,location_id,stocked_quantity,reserved_quantity,incoming_quantity,deleted_at",
                         "public.reservation_item:id,inventory_item_id,location_id,quantity,allow_backorder,deleted_at",
                         "public.product_variant_price_set:id,variant_id,price_set_id,deleted_at",
                         "public.price_set:id,deleted_at",
                         "public.price:id,price_set_id,currency_code,amount,price_list_id,min_quantity,max_quantity,rules_count,deleted_at",
                         "public.price_list:id,status,starts_at,ends_at,type,rules_count,deleted_at",
                         "public.price_rule:id,price_id,attribute,operator,value,priority,deleted_at",
                         "public.price_list_rule:id,price_list_id,attribute,value,deleted_at",
                         "public.region:id,currency_code,deleted_at",
                         "public.currency:code,decimal_digits,deleted_at")),
    "cart": ("cdc-cart-line-item.json", "funnelmetry-medusa-cdc-cart-line-item.v1",
             "cdc_cart_line_item_v1", "funnelmetry_cdc_cart_line_item_v1",
             ("public.cart_line_item:id,cart_id,product_id,variant_id,quantity,created_at,updated_at,deleted_at",)),
}

LEGACY_PROFILES = ("order", "catalog", "inventory_price")


def digest(document):
    return hashlib.sha256(json.dumps(document, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def load_profiles(root, names=LEGACY_PROFILES):
    profiles = {}
    for name in names:
        filename, version, role, publication, columns = SPECS[name]
        document = json.loads((root / filename).read_text(encoding="utf-8"))
        if (document.get("schema_version") != version or
                document.get("generated_by") != "funnelmetry-medusa-ci" or
                document.get("status") != ("ACTIVE_REFERENCE" if name == "cart" else "SHADOW_ONLY") or
                document.get("snapshot_mode") != "initial" or
                document.get("publication") != publication or
                document.get("slot") != publication or
                document.get("table_columns") != list(columns) or
                document.get("source_id") != "medusa-reference" or
                document.get("runtime_activation") != "OPERATOR_CONTROLLED_SEPARATE_FROM_INSTALLER" or
                not re.fullmatch(r"cdc_cart_epoch[0-9]+" if name == "cart"
                                 else r"cdc11_[a-z_]+_epoch[0-9]+",
                                 document.get("coverage_epoch_id", ""))):
            raise ValueError(f"{name} profile differs from approved CDC-11 source scope")
        profiles[name] = document
    epochs = {p["coverage_epoch_id"] for p in profiles.values()}
    prefixes = {p["topic_prefix"] for p in profiles.values()}
    if len(epochs) != len(names) or len(prefixes) != len(names):
        raise ValueError("CDC source epochs/topic prefixes collide")
    return profiles


def quote_identifier(value):
    if not re.fullmatch(r"[a-z][a-z0-9_]*", value):
        raise ValueError("unsafe SQL identifier")
    return '"' + value + '"'


def table_spec(entry):
    table, fields = entry.split(":", 1)
    schema, name = table.split(".", 1)
    if schema != "public":
        raise ValueError("only public schema is approved")
    columns = fields.split(",")
    if len(columns) != len(set(columns)):
        raise ValueError("duplicate column")
    return name, columns


def run_psql(container, statement):
    result = subprocess.run(
        ["docker", "exec", "-i", container, "psql", "-X", "-U", "medusa",
         "-d", "medusa", "-At", "-v", "ON_ERROR_STOP=1"],
        input=statement, text=True, capture_output=True, check=False)
    if result.returncode:
        # psql stderr can include a password or privileged SQL. Never echo it.
        raise RuntimeError(f"Medusa source SQL failed (exit {result.returncode}); inspect protected logs")
    return result.stdout.strip()


def source_preflight(container, profiles):
    if run_psql(container, "SELECT current_database() || '|' || current_setting('wal_level');") != "medusa|logical":
        raise ValueError("source must be the logical-WAL Medusa database")
    cap = run_psql(container, "SELECT pg_size_bytes(current_setting('max_slot_wal_keep_size'));")
    if not cap.isdecimal() or int(cap) < 256 * 1024 * 1024:
        raise ValueError("source WAL slot cap is unbounded or below shadow minimum")
    for name, document in profiles.items():
        for entry in document["table_columns"]:
            table, columns = table_spec(entry)
            actual = json.loads(run_psql(container,
                "SELECT COALESCE(json_agg(column_name)::text,'[]') "
                "FROM information_schema.columns WHERE table_schema='public' "
                f"AND table_name='{table}';"))
            if not set(columns).issubset(actual):
                raise ValueError(f"{name}: approved columns missing from {table}")
            pk = json.loads(run_psql(container,
                "SELECT COALESCE(json_agg(k.column_name ORDER BY k.ordinal_position)::text,'[]') "
                "FROM information_schema.table_constraints c JOIN information_schema.key_column_usage k "
                "ON k.constraint_name=c.constraint_name AND k.table_schema=c.table_schema "
                "AND k.table_name=c.table_name WHERE c.constraint_type='PRIMARY KEY' "
                f"AND c.table_schema='public' AND c.table_name='{table}';"))
            if not pk or not set(pk).issubset(columns):
                raise ValueError(f"{name}: primary key missing from {table} allowlist")


def resources(container, role, publication):
    value = run_psql(container,
        "SELECT json_build_object("
        f"'role',EXISTS(SELECT 1 FROM pg_roles WHERE rolname='{role}'),"
        f"'publication',EXISTS(SELECT 1 FROM pg_publication WHERE pubname='{publication}'),"
        f"'slot',EXISTS(SELECT 1 FROM pg_replication_slots WHERE slot_name='{publication}'));")
    return json.loads(value)


def private_directory(path):
    if path.is_symlink() or not path.is_dir() or path.stat().st_mode & 0o077:
        raise ValueError("state directory must be a real mode-700 directory outside Git")
    if (path / ".git").exists() or any(parent.name == ".git" for parent in path.parents):
        raise ValueError("state directory must be outside Git")


def write_private(path, data):
    if path.exists() or path.is_symlink():
        raise ValueError(f"protected {path.name} already exists")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise


def apply_one(container, state_dir, name, document):
    _, _, role, publication, columns = SPECS[name]
    journal = state_dir / f"{name}.json"
    credential = state_dir / f"{name}.env"
    if journal.exists() or credential.exists() or any(resources(container, role, publication).values()):
        raise ValueError(f"{name}: existing resources need verify/recovery; apply is first-use only")
    password = secrets.token_hex(32)
    write_private(credential, f"{document['source_db_url_ref']}=postgresql://{role}:{password}@medusa-cdc-postgres:5432/medusa\n")
    table_grants = []
    publication_tables = []
    for entry in columns:
        table, fields = table_spec(entry)
        qualified = f'public.{quote_identifier(table)}'
        listed = ",".join(quote_identifier(field) for field in fields)
        table_grants.append(f"GRANT SELECT ({listed}) ON {qualified} TO {quote_identifier(role)};")
        publication_tables.append(f"{qualified} ({listed})")
    statement = "\n".join([
        "BEGIN;",
        f"CREATE ROLE {quote_identifier(role)} WITH LOGIN REPLICATION PASSWORD '{password}';",
        f"GRANT USAGE ON SCHEMA public TO {quote_identifier(role)};",
        *table_grants,
        f"CREATE PUBLICATION {quote_identifier(publication)} FOR TABLE " +
            ", ".join(publication_tables) + " WITH (publish='insert,update,delete');",
        "COMMIT;",
    ])
    run_psql(container, statement)
    write_private(journal, json.dumps({"profile_sha256": digest(document), "role": role,
                                      "publication": publication, "slot": publication,
                                      "credential_file": credential.name,
                                      "status": "SOURCE_PREPARED"}, sort_keys=True) + "\n")
    return {"profile": name, "status": "SOURCE_PREPARED", "slot": "NOT_CREATED"}


def verify_one(container, state_dir, name, document):
    _, _, role, publication, columns = SPECS[name]
    journal_path = state_dir / f"{name}.json"
    credential_path = state_dir / f"{name}.env"
    for path in (journal_path, credential_path):
        if path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
            raise ValueError(f"{name}: protected ownership/credential file missing")
    journal = json.loads(journal_path.read_text(encoding="utf-8"))
    if journal != {"profile_sha256": digest(document), "role": role,
                   "publication": publication, "slot": publication,
                   "credential_file": credential_path.name, "status": "SOURCE_PREPARED"}:
        raise ValueError(f"{name}: source ownership journal drifted")
    owned = resources(container, role, publication)
    if not owned["role"] or not owned["publication"]:
        raise ValueError(f"{name}: role or publication disappeared")
    flags = run_psql(container,
        f"SELECT puballtables::int || '|' || pubinsert::int || '|' || pubupdate::int || '|' || "
        f"pubdelete::int || '|' || pubtruncate::int FROM pg_publication WHERE pubname='{publication}';")
    if flags != "0|1|1|1|0":
        raise ValueError(f"{name}: publication operations drifted")
    actual_rows = json.loads(run_psql(container,
        "SELECT COALESCE(json_agg(json_build_object('table',schemaname||'.'||tablename,"
        f"'columns',attnames) ORDER BY tablename)::text,'[]') FROM pg_publication_tables WHERE pubname='{publication}';"))
    actual = {row["table"]: set(row["columns"]) for row in actual_rows}
    expected = {entry.split(":", 1)[0]: set(entry.split(":", 1)[1].split(",")) for entry in columns}
    if len(actual_rows) != len(columns) or actual != expected:
        raise ValueError(f"{name}: publication column allowlist drifted")
    role_flags = run_psql(container,
        f"SELECT rolcanlogin::int || '|' || rolreplication::int || '|' || rolsuper::int "
        f"FROM pg_roles WHERE rolname='{role}';")
    if role_flags != "1|1|0":
        raise ValueError(f"{name}: replication role privilege drifted")
    return {"profile": name, "status": "SOURCE_PREPARED", "slot": "PRESENT" if owned["slot"] else "NOT_CREATED"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "apply", "verify"))
    parser.add_argument("--profile-dir", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--postgres-container", required=True)
    parser.add_argument("--profile", choices=tuple(SPECS))
    args = parser.parse_args()
    if not re.fullmatch(r"medusa_reference-postgres-[0-9]+", args.postgres_container):
        raise ValueError("explicit Medusa reference PostgreSQL container name required")
    names = (args.profile,) if args.profile else LEGACY_PROFILES
    profiles = load_profiles(args.profile_dir, names)
    source_preflight(args.postgres_container, profiles)
    if args.command == "plan":
        result = {"status": "SOURCE_PLAN_ONLY", "profiles": [
            {"name": name, "profile_sha256": digest(document),
             "role": SPECS[name][2], "publication": SPECS[name][3],
             "tables": len(SPECS[name][4]), "snapshot": "initial"}
            for name, document in profiles.items()]}
    else:
        private_directory(args.state_dir)
        if args.command == "apply":
            # Do not partially install because of pre-existing resources.
            for name in names:
                role, publication = SPECS[name][2:4]
                if any(resources(args.postgres_container, role, publication).values()) or \
                        (args.state_dir / f"{name}.json").exists():
                    raise ValueError(f"{name}: refusing partial/pre-existing source installation")
            result = {"status": "SOURCE_APPLIED", "profiles": [
                apply_one(args.postgres_container, args.state_dir, name, profiles[name]) for name in names]}
        else:
            result = {"status": "SOURCE_VERIFIED", "profiles": [
                verify_one(args.postgres_container, args.state_dir, name, profiles[name]) for name in names]}
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, RuntimeError, OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"cdc-target-source: {error}") from None
