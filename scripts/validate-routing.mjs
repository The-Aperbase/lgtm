import { readFileSync } from "node:fs";

const composePath = process.argv[2] ?? "/tmp/observability-compose.json";
const compose = JSON.parse(readFileSync(composePath, "utf8"));

const servicesWithPorts = Object.entries(compose.services)
  .filter(([, service]) => (service.ports ?? []).length > 0)
  .map(([name]) => name);

if (servicesWithPorts.length > 0) {
  throw new Error(`Services must not publish host ports: ${servicesWithPorts.join(", ")}`);
}

const routedServices = Object.entries(compose.services)
  .filter(([, service]) => Object.hasOwn(service.networks, "dokploy"))
  .map(([name]) => name);

if (routedServices.length !== 1 || routedServices[0] !== "grafana") {
  throw new Error(`Only Grafana may join the Dokploy routing network; found: ${routedServices.join(", ")}`);
}

const grafanaLabels = compose.services.grafana.deploy?.labels ?? {};
const requiredGrafanaLabels = {
  "traefik.enable": "true",
  "traefik.http.routers.lgtm-grafana.entrypoints": "web",
  "traefik.http.routers.lgtm-grafana.service": "lgtm-grafana",
  "traefik.http.services.lgtm-grafana.loadbalancer.server.port": "3000",
};

for (const [label, expected] of Object.entries(requiredGrafanaLabels)) {
  if (grafanaLabels[label] !== expected) {
    throw new Error(`Grafana routing label ${label} must be ${expected}.`);
  }
}

if (!grafanaLabels["traefik.http.routers.lgtm-grafana.rule"]?.startsWith("Host(`")) {
  throw new Error("Grafana must have a host-based Traefik router.");
}

if (!Object.hasOwn(compose.services.alloy.networks, "telemetry")) {
  throw new Error("Alloy must join the shared telemetry network.");
}

if (compose.networks.observability.internal !== true) {
  throw new Error("The observability backend network must remain internal.");
}

if (compose.networks.telemetry.attachable !== true || compose.networks.telemetry.driver !== "overlay") {
  throw new Error("The telemetry network must remain an attachable overlay.");
}

console.log("Routing validation passed.");
