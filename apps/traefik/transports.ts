import { ServersTransport } from "@kubernetes-models/traefik/traefik.io/v1alpha1";

export const insecureTransport = new ServersTransport({
  metadata: {
    name: "insecure",
  },
  spec: {
    insecureSkipVerify: true,
  },
});
