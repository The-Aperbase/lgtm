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

1. Enable a maintenance page or otherwise prevent all requests from reaching Grafana.
2. Scale Grafana to zero. Keep it at zero whenever data is being backed up or loaded.
3. Take a final immutable copy of `grafana.db`. If SQLite WAL files exist, copy the complete directory rather than only the main database file. This backup defines the last accepted SQLite write.
4. Set `GRAFANA_DATABASE_TYPE=postgres` and redeploy exactly one Grafana task while the maintenance route remains active. Wait for it to create and migrate the native PostgreSQL schema, then immediately scale Grafana back to zero before loading data.
5. Compare the SQLite and PostgreSQL table and column inventories. Resolve every mismatch before loading data.
6. Empty the Grafana-created PostgreSQL tables without dropping its schema, constraints, defaults, or indexes.
7. Load the SQLite rows with a rehearsed data-only migration. If using pgloader, disable schema, table, and index creation; exclude `sqlite_sequence`; reset sequences; and fail the cutover if any rows are rejected.
8. Reset every PostgreSQL sequence to a value greater than the corresponding table's maximum ID.
9. With `GRAFANA_DATABASE_TYPE=postgres` still set, redeploy one Grafana replica and complete verification before restoring public traffic.

Never run SQLite-backed and PostgreSQL-backed Grafana tasks concurrently. They create divergent state.

Grafana does not receive application telemetry. Alloy continues sending metrics, logs, and traces to Prometheus, Loki, and Tempo during this maintenance window. Grafana-managed alert evaluation and notifications pause while Grafana is scaled to zero, and UI changes, logins, and Git webhooks cannot be accepted. Repository polling resumes after startup and reconciles the latest Git state.

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

## Password Rotation

`POSTGRES_PASSWORD` is only applied when PostgreSQL initializes an empty data directory. Changing `GRAFANA_DATABASE_PASSWORD` in Dokploy later does not update the password stored by the existing PostgreSQL role.

Rotate the password through a controlled maintenance procedure:

1. Generate the new password without removing the current Dokploy value.
2. Connect to PostgreSQL through a trusted administrative session and change the `grafana` role password with `ALTER ROLE`.
3. Immediately update `GRAFANA_DATABASE_PASSWORD` in Dokploy and redeploy Grafana.
4. Verify a new Grafana database connection, then invalidate any exposed copies of the old password.

The PostgreSQL healthcheck uses a local connection and can remain healthy when Grafana has the wrong password. Include an authenticated Grafana request in rotation verification.
