# Medusa reference CDC operations

This directory contains operator tooling for the four active Medusa CDC profiles:

- cart line-item changes;
- order current state v2;
- product, variant and category master data;
- inventory and price context.

The historical directory name is retained because deployed operator scripts and recovery units reference it. It does not describe analytical authority or an active shadow environment. Browser behavioral events travel through HTTP ingress; Medusa commerce and master data travel through CDC.

## Boundaries

- Initial/incremental snapshots establish a coverage epoch; snapshot rows do not synthesize cart-add or order-conversion events.
- Slot loss creates an explicit incomplete gap and requires a new epoch/baseline.
- Projection activation requires source-scoped coverage, freshness and quality leases.
- Inventory availability is resolved from location, reservation, stock-management and sales-channel context.
- Catalog price state never rewrites historical order amounts.
- These tools never generate Medusa backend messages, use a backend signing key, or restore API catalog polling.

The Medusa CI installer writes declarative CDC profile files. Replication roles, publications, slots, connectors, snapshots, recovery and quality activation remain operator-owned procedures.
