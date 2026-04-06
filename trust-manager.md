1. install trust-manager
2. create one Bundle resource
3. let it keep traefik/internal-root-ca-bundle synced automatically
For your case, the important piece is the Bundle. It would look like this:
apiVersion: trust.cert-manager.io/v1alpha1
kind: Bundle
metadata:
  name: internal-root-ca-bundle
spec:
  sources:
    - secret:
        name: internal-root-ca
        key: tls.crt
  target:
    configMap:
      key: ca.crt
    namespaceSelector:
      matchLabels:
        kubernetes.io/metadata.name: traefik
What that does:
- reads cert-manager/internal-root-ca
- pulls the cert from data.tls.crt
- creates or updates a ConfigMap named internal-root-ca-bundle
- writes it into the traefik namespace
- stores the PEM under data.ca.crt
That matches your BackendTLSPolicy reference:
validation:
  caCertificateRefs:
    - group: ""
      kind: ConfigMap
      name: internal-root-ca-bundle
A couple of details matter:
- Bundle is cluster-scoped
- the target ConfigMap name is the same as the Bundle name
- namespaceSelector controls where it gets written
- for your current CA secret, you likely want key: tls.crt, because that is the key you’ve already been using successfully
So the full architecture becomes:
- cert-manager issues internal-root-ca
- trust-manager copies that CA cert into traefik/internal-root-ca-bundle
- BackendTLSPolicy trusts that ConfigMap