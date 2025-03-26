import { ServersTransport, ServersTransportSpec } from "./imports/serverstransport-traefik.io.ts";
import { Construct } from "npm:constructs";

export default class ServerTransport extends ServersTransport {
  constructor(scope: Construct, props: ServerTransportProps) {
    const { name, spec } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      spec: spec,
    });
  }
}

export type ServerTransportProps = {
  name: string;
  spec: ServersTransportSpec;
};
