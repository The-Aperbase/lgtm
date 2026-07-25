# LGTM

Single-node [LGTM](https://grafana.com/go/webinar/getting-started-with-grafana-lgtm-stack/) observability stack for Docker Swarm on Dokploy:

- **L**oki for logs
- **G**rafana for querying and visualization
- **T**empo for traces
- **M**imir for metrics
- OpenTelemetry Collector as the only public telemetry ingress

The stack keeps all signals for seven days, targets an 8 GB node, and uses Docker named volumes so the stateful services can be included in Dokploy volume backups. It is intentionally single-node and is not highly available.

## Public endpoints

| Endpoint | Purpose | Authentication |
| --- | --- | --- |
| `https://$GRAFANA_DOMAIN` | Grafana | Strict Google OAuth email allowlist |
| `https://$OTEL_DOMAIN` | OTLP/HTTP and OTLP/gRPC | `Authorization: Bearer $OTEL_API_KEY` |

Loki, Tempo, Mimir, and the Collector ports are not published directly on the host. Traefik routes OTLP/gRPC to port 4317 over h2c by content type and routes remaining OTLP requests to port 4318.

## 1. DNS and Google OAuth

Create `A` or `AAAA` records for the Grafana and OTLP hostnames pointing at the Dokploy node.

Create a Google OAuth 2.0 **Web application**:

- Authorized JavaScript origin: `https://<GRAFANA_DOMAIN>`
- Authorized redirect URI: `https://<GRAFANA_DOMAIN>/login/google`

Record the client ID and client secret for the Dokploy environment.

## 2. Configure the Dokploy Stack

Create a Dokploy Compose service with:

- Provider: this GitHub repository
- Branch: `main`
- Compose type: **Stack**
- Compose path: `deploy-compose.yml`

Set these values in Dokploy's environment editor:

```dotenv
GRAFANA_DOMAIN=grafana.example.com
OTEL_DOMAIN=otel.example.com
OTEL_API_KEY=<random API key>
GRAFANA_GOOGLE_CLIENT_ID=<Google OAuth client ID>
GRAFANA_GOOGLE_CLIENT_SECRET=<Google OAuth client secret>
GRAFANA_ADMIN_PASSWORD=<random fallback password>
GRAFANA_GOOGLE_ROLE_ATTRIBUTE_PATH="email == 'first.admin@example.com' && 'GrafanaAdmin' || email == 'second.admin@example.com' && 'GrafanaAdmin' || email == 'viewer@example.com' && 'Viewer'"
```

Generate strong random values with:

```bash
openssl rand -hex 32
```

The role expression has no fallback. Grafana's strict role mapping therefore rejects every Google account not explicitly present. The first two comparisons grant server and organization administrator access; any later comparisons should return `Viewer`.

Keep runtime values in Dokploy. Do not commit a populated `.env` file.

### Optional lockout-recovery variables

These defaults keep Grafana locked to Google:

```dotenv
GRAFANA_BASIC_AUTH_ENABLED=false
GRAFANA_DISABLE_LOGIN_FORM=true
GRAFANA_GOOGLE_AUTO_LOGIN=true
```

If an incorrect OAuth or role expression locks out both administrators, temporarily set basic auth to `true`, disable Google auto-login, show the login form, and redeploy:

```dotenv
GRAFANA_BASIC_AUTH_ENABLED=true
GRAFANA_DISABLE_LOGIN_FORM=false
GRAFANA_GOOGLE_AUTO_LOGIN=false
```

Log in as `admin` with `GRAFANA_ADMIN_PASSWORD`, correct the OAuth configuration, and restore the secure defaults immediately.

## 3. Configure GitHub Actions deployment

The deployment follows the same flow as ApesDb: GitHub Actions connects to `dokbox` through Tailscale and calls Dokploy's `compose.deploy` API.

Add these repository Actions secrets:

| Secret | Value |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | Tailscale OAuth client ID used by the existing CI tag |
| `TS_AUDIENCE` | Tailscale workload identity audience |
| `DOKPLOY_API_TOKEN` | Dokploy API token |
| `DOKPLOY_COMPOSE_ID` | ID of the LGTM Compose service |

The first push validates the stack and safely skips deployment while these secrets are absent. After creating the Dokploy service and adding all four secrets, run **Validate and deploy** manually. Every later push to `main` redeploys automatically.

Pull requests run the separate **Compose validation** workflow.

## 4. Configure OpenTelemetry clients

### OTLP/HTTP

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<API_KEY>
```

### OTLP/gRPC

```dotenv
OTEL_EXPORTER_OTLP_ENDPOINT=https://otel.example.com
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer%20<API_KEY>
```

Some SDK configuration APIs accept the literal header value `Bearer <API_KEY>` instead of the percent-encoded environment-variable form.

Rotate the telemetry key by changing `OTEL_API_KEY` in Dokploy and redeploying. Update clients immediately; the stack intentionally accepts only the current key.

## Validation

Render the stack locally with a populated `.env`:

```bash
docker stack config -c deploy-compose.yml
```

The CI workflow additionally validates the Collector, Loki, Tempo, and Mimir configuration files with their pinned container images.

## Operations

### Readiness

After deployment, confirm every service has one running replica:

```bash
docker stack services <stack-name>
```

Then verify:

1. OTLP requests without the Bearer header are rejected.
2. Authenticated test metrics, logs, and traces appear in Grafana Explore.
3. Both administrator emails receive `GrafanaAdmin`.
4. A listed viewer receives `Viewer`.
5. An unlisted Google account is rejected.

### Persistence and backups

Back up all four named volumes through Dokploy:

- Grafana data
- Loki data
- Tempo data
- Mimir data

All volumes are local to the manager node. Restore them to the same volume names before redeploying the stack.

### Rollback

Use Dokploy's deployment history to redeploy the previous successful revision. Swarm services use `stop-first` updates because the stateful volumes must never be mounted by two replicas simultaneously.
