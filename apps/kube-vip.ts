import { DaemonSet } from "kubernetes-models/apps/v1";
import {
  ClusterRole,
  ClusterRoleBinding,
} from "kubernetes-models/rbac.authorization.k8s.io/v1";
import { ServiceAccount } from "kubernetes-models/v1";
import { Project } from "../constants";
import type { StaticApp } from "../types";
import { image } from "../utils";

const name = "kube-vip";
const namespace = "kube-system";

// kube-vip holds the API server VIP and the Traefik VIP, so losing these objects
// takes down kubectl access and all ingress. Never let Argo prune them or
// cascade-delete them with the Application.
const retainAnnotations = {
  "argocd.argoproj.io/sync-options": "Prune=false,Delete=false",
};

const serviceAccount = new ServiceAccount({
  metadata: { name, namespace, annotations: retainAnnotations },
});

const clusterRole = new ClusterRole({
  metadata: {
    name: "system:kube-vip-role",
    annotations: {
      ...retainAnnotations,
      "rbac.authorization.kubernetes.io/autoupdate": "true",
    },
  },
  rules: [
    {
      apiGroups: [""],
      resources: ["services/status"],
      verbs: ["update"],
    },
    {
      apiGroups: [""],
      resources: ["services", "endpoints"],
      verbs: ["list", "get", "watch", "update"],
    },
    {
      apiGroups: [""],
      resources: ["nodes"],
      verbs: ["list", "get", "watch", "update", "patch"],
    },
    {
      apiGroups: ["coordination.k8s.io"],
      resources: ["leases"],
      verbs: ["list", "get", "watch", "update", "create"],
    },
    {
      apiGroups: ["discovery.k8s.io"],
      resources: ["endpointslices"],
      verbs: ["list", "get", "watch", "update"],
    },
  ],
});

const clusterRoleBinding = new ClusterRoleBinding({
  metadata: {
    name: "system:kube-vip-binding",
    annotations: retainAnnotations,
  },
  roleRef: {
    apiGroup: "rbac.authorization.k8s.io",
    kind: "ClusterRole",
    name: clusterRole.metadata?.name ?? "",
  },
  subjects: [{ kind: "ServiceAccount", name, namespace }],
});

const labels = { "app.kubernetes.io/name": name };

const daemonSet = new DaemonSet({
  metadata: { name, namespace, labels, annotations: retainAnnotations },
  spec: {
    selector: { matchLabels: labels },
    template: {
      metadata: { labels },
      spec: {
        serviceAccountName: name,
        affinity: {
          nodeAffinity: {
            requiredDuringSchedulingIgnoredDuringExecution: {
              nodeSelectorTerms: [
                {
                  matchExpressions: [
                    {
                      key: "node-role.kubernetes.io/master",
                      operator: "Exists",
                    },
                  ],
                },
                {
                  matchExpressions: [
                    {
                      key: "node-role.kubernetes.io/control-plane",
                      operator: "Exists",
                    },
                  ],
                },
              ],
            },
          },
        },
        tolerations: [
          { effect: "NoSchedule", operator: "Exists" },
          { effect: "NoExecute", operator: "Exists" },
        ],
        hostNetwork: true,
        containers: [
          {
            name,
            image: image("kubeVip"),
            imagePullPolicy: "IfNotPresent",
            args: ["manager"],
            env: [
              // ARP mode: Layer 2 VIP advertisement.
              { name: "vip_arp", value: "true" },
              { name: "vip_interface", value: "eth0" },
              // Control plane VIP (API server HA).
              { name: "address", value: "192.168.53.200" },
              { name: "port", value: "6443" },
              { name: "vip_subnet", value: "32" },
              { name: "cp_enable", value: "true" },
              { name: "cp_namespace", value: namespace },
              // Service VIPs for LoadBalancer Services, e.g. Traefik's
              // 192.168.53.201 from the kube-vip.io/loadbalancerIPs annotation.
              { name: "svc_enable", value: "true" },
              // Only one node holds each VIP at a time.
              { name: "vip_leaderelection", value: "true" },
              { name: "vip_leasename", value: "plndr-cp-lock" },
              { name: "vip_leaseduration", value: "5" },
              { name: "vip_renewdeadline", value: "3" },
              { name: "vip_retryperiod", value: "1" },
              // DNS is managed by external-dns.
              { name: "vip_ddns", value: "false" },
            ],
            securityContext: {
              capabilities: { add: ["NET_ADMIN", "NET_RAW"] },
            },
          },
        ],
      },
    },
  },
});

const config: StaticApp = {
  kind: "static",
  name,
  namespace,
  project: Project.SYSTEM,
  // A rollout moves both VIPs, so merges that change the DaemonSet are
  // deliberate; Renovate bumps are PR-only.
  resources: [serviceAccount, clusterRole, clusterRoleBinding, daemonSet],
};

export default config;
