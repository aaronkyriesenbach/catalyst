# Partition workload clusters by trust boundary

Status: accepted

Workload apps split across two dedicated workload clusters — an **External workload cluster** (holds
every externally-reachable app; owns the external-facing gateway/DNS) and an **Internal workload
cluster** (holds every internal-only app; no external-facing gateway or public DNS entry) — rather than
one shared workload cluster. The split is deliberately not a security necessity: pod-level isolation
within a single cluster is already handled by Kubernetes NetworkPolicies, adopted regardless
([#32](https://github.com/aaronkyriesenbach/catalyst/issues/32)). The value here is hands-on practice
operating and routing across multiple clusters, plus cluster-boundary blast-radius containment as a
bonus — not a gap either cluster alone would otherwise leave open.

"Internal-only" means _not publicly ingress-able_, not _LAN-only_: authorized remote users still reach
the Internal workload cluster through the remote-access/tunnel solution
([#19](https://github.com/aaronkyriesenbach/catalyst/issues/19)), which extends trusted-network
reachability to remote clients without exposing the cluster to the public internet. Both clusters share
the same trust-boundary taxonomy already fixed by the network-segmentation VLANs/zones
([#5](https://github.com/aaronkyriesenbach/catalyst/issues/5)).

Deliberately left open here: _when_ the Internal workload cluster actually gets built, given today's
2-node hardware and the platform cluster's own footprint. Only the end-state topology is decided;
sequencing is an implementation-time call under the existing incremental parallel-build migration
strategy ([#31](https://github.com/aaronkyriesenbach/catalyst/issues/31)).

## Considered Options

- **Single shared workload cluster** — rejected: no multi-cluster operational practice, and the
  trust-boundary split becomes purely a NetworkPolicy convention rather than a structural boundary.
- **Partition by environment (stable vs. experimental) instead of trust boundary** — rejected:
  trust boundary reuses the zone taxonomy already fixed in #5, giving the split one consistent meaning
  everywhere in the design; an environment split would be a second, unrelated axis.
- **Strict LAN-only definition of "internal"** (no remote access at all) — rejected: cuts off legitimate
  remote access to internal-only apps; #19's remote-access tunnel is the intended mechanism for that,
  instead of relaxing the public-ingress boundary.

## Consequences

- #36 (ingress/routing placement) now designs against three clusters total (platform + 2 workload): only
  the External workload cluster ever holds an external-facing gateway/DNS entry; the Internal workload
  cluster and the platform cluster use internal-only routing.
- #21 (service mesh implementation) now has a concrete multi-cluster topology (3 clusters) to design
  cross-cluster mTLS/routing against, if the chosen mesh spans clusters.
- #19 (remote-access/tunnel) is confirmed as the mechanism for reaching the Internal workload cluster
  remotely — already scoped for "external vs. internal-access cases."
- `CONTEXT.md`'s **Workload cluster** entry is resolved: no longer "still open," now contrasts
  **External workload cluster** / **Internal workload cluster**.
- Node budget/timing for building the second workload cluster is not decided here — deferred to
  implementation planning.
