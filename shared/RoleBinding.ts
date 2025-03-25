import { KubeRoleBinding, RoleRef, Subject } from "./imports/k8s.ts";
import { Construct } from "npm:constructs";

export default class RoleBinding extends KubeRoleBinding {
  constructor(scope: Construct, props: RoleBindingProps) {
    const { name, roleRef, subjects } = props;

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
      },
      roleRef: roleRef,
      subjects: subjects,
    });
  }
}

export type RoleBindingProps = {
  name: string;
  roleRef: RoleRef;
  subjects?: Subject[];
};
