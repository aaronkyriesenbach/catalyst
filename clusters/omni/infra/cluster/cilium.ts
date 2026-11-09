// Values follow the Talos "Cilium without kube-proxy + Gateway API" guide;
// the encryption, L2 announcement and Hubble blocks are additions for this cluster.
export const ciliumValues = {
  ipam: { mode: "kubernetes" },
  kubeProxyReplacement: true,
  k8sServiceHost: "localhost",
  k8sServicePort: 7445,
  securityContext: {
    capabilities: {
      ciliumAgent: [
        "CHOWN",
        "KILL",
        "NET_ADMIN",
        "NET_RAW",
        "IPC_LOCK",
        "SYS_ADMIN",
        "SYS_RESOURCE",
        "DAC_OVERRIDE",
        "FOWNER",
        "SETGID",
        "SETUID",
      ],
      cleanCiliumState: ["NET_ADMIN", "SYS_ADMIN", "SYS_RESOURCE"],
    },
  },
  cgroup: { autoMount: { enabled: false }, hostRoot: "/sys/fs/cgroup" },
  gatewayAPI: { enabled: true, enableAlpn: true, enableAppProtocol: true },
  encryption: { enabled: true, type: "wireguard", nodeEncryption: true },
  l2announcements: { enabled: true },
  k8sClientRateLimit: { qps: 20, burst: 40 },
  hubble: { enabled: true, relay: { enabled: true }, ui: { enabled: true } },
} as const;
