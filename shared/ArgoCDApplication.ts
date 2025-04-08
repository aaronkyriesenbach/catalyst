import { Application, ApplicationSpecIgnoreDifferences } from "./imports/argoproj.io.ts";
import { Construct } from "npm:constructs";

export class ArgoCDApplication extends Application {
  constructor(scope: Construct, props: ArgoCDApplicationProps) {
    const {
      name,
      spec,
    } = props;

    const {
      namespace = name,
      project = "default",
      serverSideApply,
      ignoreDifferences,
    } = spec ?? {};

    super(scope, crypto.randomUUID(), {
      metadata: {
        name: name,
        namespace: "argocd",
      },
      spec: {
        destination: {
          namespace: namespace,
          server: "https://kubernetes.default.svc",
        },
        project: project,
        source: {
          path: name,
          repoUrl: "https://github.com/aaronkyriesenbach/catalyst",
          targetRevision: Deno.env.get("ARGOCD_APP_SOURCE_TARGET_REVISION") ?? "master",
        },
        syncPolicy: {
          syncOptions: [
            "CreateNamespace=true",
            ...(serverSideApply ? ["ServerSideApply=true"] : []),
          ],
        },
        ignoreDifferences: ignoreDifferences,
      },
    });
  }
}

export type ArgoCDApplicationSpec = {
  namespace?: string;
  project?: string;
  serverSideApply?: boolean;
  ignoreDifferences?: ApplicationSpecIgnoreDifferences[];
};

export type ArgoCDApplicationProps = {
  name: string;
  spec?: ArgoCDApplicationSpec;
};
