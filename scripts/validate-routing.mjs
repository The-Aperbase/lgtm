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

if (!Object.hasOwn(compose.services.alloy.networks, "telemetry")) {
  throw new Error("Alloy must join the shared telemetry network.");
}

if (compose.networks.observability.internal !== true) {
  throw new Error("The observability backend network must remain internal.");
}

if (compose.networks.telemetry.attachable !== true || compose.networks.telemetry.driver !== "overlay") {
  throw new Error("The telemetry network must remain an attachable overlay.");
}

const nodePreparation = compose.services["prepare-swarm-node"];
if (nodePreparation.deploy?.mode !== "replicated-job") {
  throw new Error("Swarm node preparation must remain a one-shot replicated job.");
}

if (!nodePreparation.deploy?.placement?.constraints?.includes("node.role == manager")) {
  throw new Error("Swarm node preparation must run only on a manager.");
}

const mountsDockerSocket = nodePreparation.volumes?.some(
  (volume) => volume.source === "/var/run/docker.sock" && volume.target === "/var/run/docker.sock",
);
if (!mountsDockerSocket) {
  throw new Error("Swarm node preparation requires the manager Docker socket.");
}

console.log("Routing validation passed.");
