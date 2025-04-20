import { KubeRole, PolicyRule } from "../imports/k8s.ts";
import { Construct } from "npm:constructs";

export default class Role extends KubeRole {
  constructor(scope: Construct, props: RoleProps) {
    const { name, rules } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      rules: rules,
    });
  }
}

export type RoleProps = {
  name: string;
  rules: PolicyRule[];
};
