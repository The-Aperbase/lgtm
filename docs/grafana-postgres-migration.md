# Grafana PostgreSQL Migration

Grafana starts with `GRAFANA_DATABASE_TYPE=sqlite3` so deploying this stack cannot silently replace the existing configuration database. PostgreSQL is initialized in parallel and remains private on the `observability` overlay network.

Grafana does not provide an automatic SQLite-to-PostgreSQL migration. Rehearse this procedure on copied volumes before the production cutover. Keep Grafana at `13.1.1` throughout the migration.

## Preparation

1. Set a unique `GRAFANA_DATABASE_PASSWORD` in Dokploy and deploy with `GRAFANA_DATABASE_TYPE=sqlite3`.
2. Confirm PostgreSQL is healthy and Grafana is still using SQLite.
3. Record the Grafana image digest and the current `GF_SECURITY_SECRET_KEY` value. Existing encrypted datasource credentials require the same secret key after migration.
4. Back up the complete `grafana-data` and `postgres-data` volumes. Verify the backups can be restored.
5. Rehearse the remaining steps against copies and record the source table list, row counts, migration logs, and any type conversions required by the actual Grafana 13 schema.

Do not run a default pgloader SQLite migration against production. Default schema creation can produce types, constraints, and indexes that differ from Grafana's PostgreSQL schema.

## Cutover

1. Enable a maintenance page or otherwise prevent writes through the Grafana route.
2. Scale Grafana to zero and take a final immutable copy of `grafana.db`. If SQLite WAL files exist, copy the complete directory rather than only the main database file.
3. Start exactly one Grafana task with `GRAFANA_DATABASE_TYPE=postgres`. Wait for it to create and migrate the native PostgreSQL schema, then scale Grafana back to zero.
4. Compare the SQLite and PostgreSQL table and column inventories. Resolve every mismatch before loading data.
5. Empty the Grafana-created PostgreSQL tables without dropping its schema, constraints, defaults, or indexes.
6. Load the SQLite rows with a rehearsed data-only migration. If using pgloader, disable schema, table, and index creation; exclude `sqlite_sequence`; reset sequences; and fail the cutover if any rows are rejected.
7. Reset every PostgreSQL sequence to a value greater than the corresponding table's maximum ID.
8. Set `GRAFANA_DATABASE_TYPE=postgres` permanently and start one Grafana replica.

Never run SQLite-backed and PostgreSQL-backed Grafana tasks concurrently. They create divergent state.

## Verification

Before restoring public traffic:

- Compare source and target row counts for every migrated table.
- Verify `migration_log` and Grafana 13 unified-storage migration state.
- Verify users, organizations, teams, service accounts, dashboards, folders, playlists, library panels, alert rules, contact points, silences, and permissions.
- Log in through Google and the break-glass basic authentication path.
- Query every datasource to prove encrypted credentials still decrypt.
- Create, update, and delete a temporary dashboard and annotation.
- Check Grafana logs for migration, SQL, decryption, missing-column, rejected-row, and duplicate-key errors.
- Take a `pg_dump` after acceptance.

## Rollback

1. Stop every PostgreSQL-backed Grafana task.
2. Set `GRAFANA_DATABASE_TYPE=sqlite3`.
3. Restore the pre-cutover `grafana-data` snapshot and the exact original Grafana image and configuration.
4. Start one Grafana task and repeat the application checks.

Swarm service rollback does not restore database contents. Any writes accepted after the PostgreSQL cutover must be reconciled manually if rollback is required.
