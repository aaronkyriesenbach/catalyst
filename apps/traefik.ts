import {
  GatewayClass,
  Gateway,
} from "@kubernetes-models/gateway-api/gateway.networking.k8s.io/v1";
import { AppConfig } from "../types";

const gatewayClass = new GatewayClass({
  metadata: {
    name: "traefik",
  },
  spec: {
    controllerName: "traefik.io/gateway-controller",
  },
});

const gateway = new Gateway({
  metadata: {
    name: "traefik",
  },
  spec: {
    gatewayClassName: "traefik",
    listeners: [
      {
        name: "http",
        protocol: "HTTP",
        port: 80,
      },
      {
        name: "https",
        protocol: "HTTPS",
        port: 443,
      },
    ],
  },
});

const config: AppConfig = {
  name: "traefik",
  extraResources: [gatewayClass, gateway],
};

export default config;
