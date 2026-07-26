# ApesDb Observability

Private LGTM stack for ApesDb on Docker Swarm and Dokploy. Applications send OTLP to Alloy over the shared `apesdb-telemetry` overlay network. Only Grafana joins Dokploy's routing network.

## Components

- Grafana 13.1.1
- Grafana Alloy 1.18.0
- Loki 3.7.4 with 30-day retention
- Tempo 3.0.2 with 14-day retention
- Prometheus 3.13.1 with 90-day retention
- node-exporter and cAdvisor on every Swarm node

This configuration uses local volumes and one replica of each stateful service. It is intended for a small, single-node installation. Move Loki and Tempo to object storage and replace Prometheus with a scalable metrics backend before making the stack highly available.

The stack has two private network planes:

- `apesdb-telemetry` connects ApesDb to Alloy's OTLP receiver.
- `observability` is an internal overlay connecting Alloy and Grafana to Loki, Tempo, Prometheus, and the infrastructure exporters.

Only Grafana joins Dokploy's routing network. No service publishes a host port.

## Swarm Preparation

The stack runs a one-shot `prepare-swarm-node` job on a manager during deployment. It initializes Loki and Tempo volume ownership for their non-root UID, labels that node `observability=true` through the Docker socket, force-reconciles the label-constrained services so stale or failed tasks are replaced, then exits.

This is intentionally limited to a manager-only replicated job because access to `/var/run/docker.sock` grants Docker administration privileges. The completed task does not retain running socket access.

If automatic preparation fails, apply the equivalent label manually on the manager:

```bash
docker node update --label-add observability=true "$(docker info --format '{{.Swarm.NodeID}}')"
```

The observability stack creates the named, attachable `apesdb-telemetry` overlay network during its first deployment. Deploy this stack before ApesDb, whose Compose file consumes that network as an external network.

Dokploy creates and manages its own routing network during installation. Check its actual name with `docker network ls` and set `DOKPLOY_NETWORK` if it is not `dokploy-network`; this stack deliberately does not attempt to recreate that platform-owned network.

## Dokploy Deployment

1. Copy `.env.example` to `.env` and replace every example value.
2. Create a Compose application in Dokploy from this directory or repository using `compose.yml`.
3. Add the Grafana domain in Dokploy with container port `3000`, and set `GRAFANA_ROOT_URL` to its public HTTPS URL.
4. Put a Cloudflare Access policy in front of the Grafana hostname.
5. Do not create routes for Alloy, Loki, Tempo, Prometheus, node-exporter, or cAdvisor.

Dokploy owns and injects the Grafana Traefik labels. Do not add equivalent labels to `compose.yml`, because duplicate labels make Docker reject the stack. The Cloudflare Tunnel hostname should forward to Dokploy's Traefik HTTP origin while preserving the original Host header; no host port should be published.

## Grafana Google Login

Create a Google OAuth 2.0 Web application with this exact authorized redirect URI:

```text
https://<grafana-domain>/login/google
```

Set `GRAFANA_GOOGLE_CLIENT_ID`, `GRAFANA_GOOGLE_CLIENT_SECRET`, and the two permitted administrator addresses as ordinary Dokploy environment variables:

```dotenv
GRAFANA_GOOGLE_ADMIN_EMAIL_1=admin.one@example.com
GRAFANA_GOOGLE_ADMIN_EMAIL_2=admin.two@example.com
```

Compose constructs Grafana's role expression from these values. Both addresses receive `GrafanaAdmin`; every other address produces no role and is rejected because strict role mapping is enabled.

Google auto-login is enabled on the first rollout, but basic login remains available as a break-glass path. If OAuth fails, open:

```text
https://<grafana-domain>/login?disableAutoLogin=true
```

Sign in with `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD`. To roll back through Dokploy, set `GRAFANA_GOOGLE_ENABLED=false` and `GRAFANA_GOOGLE_AUTO_LOGIN=false`, then redeploy. Basic authentication and the login form should remain enabled unless another tested recovery mechanism exists.

If deploying directly from a Swarm manager:

```bash
set -a
. ./.env
set +a
docker stack deploy --compose-file compose.yml apesdb-observability
```

Docker Swarm does not load `.env` for `docker stack deploy`; the shell export above is intentional. Dokploy supplies its configured environment variables itself.

## Continuous Deployment

The GitHub Actions workflow in `.github/workflows/deploy.yml` validates the Compose and component configurations, connects to the Dokploy host through Tailscale, and triggers the Dokploy Compose deployment. The deployment creates `apesdb-telemetry` automatically if it does not exist.

The workflow also rejects published host ports or additional services on Dokploy's routing network, fails before deployment when required Actions configuration is absent, and confirms Tailscale connectivity before calling Dokploy.

Configure `DOKPLOY_COMPOSE_ID` as a repository Actions variable. It must identify the observability Compose application and cannot be reused from the ApesDb Compose application.

Configure these as repository or organization Actions secrets and grant this repository access to them:

- `TS_OAUTH_CLIENT_ID`
- `TS_AUDIENCE`
- `DOKPLOY_API_TOKEN`

The Tailscale configuration and Dokploy API token can be shared with ApesDb.

## ApesDb Connection

The ApesDb stack joins the same external telemetry network and sends OTLP/gRPC to:

```text
http://alloy:4317
```

If Dokploy prefixes the Alloy service name with the stack name and does not create the `alloy` network alias, set ApesDb's `OTEL_EXPORTER_OTLP_ENDPOINT` to the resolvable service name shown by `docker service ls`, for example `http://apesdb-observability_alloy:4317`.

## Operations

Back up the named volumes for Grafana, Loki, Tempo, and Prometheus. A Swarm named volume is local to the node selected by `node.labels.observability`; moving a service to another node does not move its data.

Monitor Alloy's own logs for rejected or dropped telemetry. Keep the OTLP receivers and backend ports private; Cloudflare Tunnel is only needed for Grafana.
