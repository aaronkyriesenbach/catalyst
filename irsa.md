# Self-Hosted IRSA on K3s

This document describes how to set up IAM Roles for Service Accounts (IRSA) on a
self-hosted K3s cluster, replacing long-lived AWS access keys with short-lived
STS credentials obtained via OIDC federation.

## Background

IRSA works by configuring the Kubernetes API server as an OIDC token issuer,
publishing the public signing keys (JWKS) to a publicly accessible URL, and
registering that URL as an IAM OIDC Identity Provider in AWS. A mutating
admission webhook (`amazon-eks-pod-identity-webhook`) watches for pods whose
ServiceAccount has an `eks.amazonaws.com/role-arn` annotation and automatically
injects a projected service account token plus environment variables. The AWS SDK
in the application uses these to call `sts:AssumeRoleWithWebIdentity`, exchanging
the token for temporary credentials — no code changes required.

```
┌──────────────────────────────────────────────────────────────┐
│  K3s Cluster                                                 │
│                                                              │
│  kube-apiserver signs SA tokens with sa-signer.key           │
│  (--service-account-issuer=https://S3_BUCKET_URL)            │
│                                                              │
│  pod-identity-webhook (MutatingWebhook)                      │
│    - Reads SA annotation: eks.amazonaws.com/role-arn         │
│    - Injects: AWS_ROLE_ARN, AWS_WEB_IDENTITY_TOKEN_FILE      │
│    - Mounts projected token at /var/run/secrets/...          │
│                                                              │
│  Pod                                                         │
│    - AWS SDK reads token file                                │
│    - Calls sts:AssumeRoleWithWebIdentity                     │
│    - Receives temporary credentials (1h default)             │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  AWS                                                         │
│                                                              │
│  IAM OIDC Identity Provider                                  │
│    - Registered with issuer URL = S3 bucket                  │
│    - Audience: sts.amazonaws.com                             │
│                                                              │
│  STS validates token by fetching JWKS from the S3 bucket     │
│    - Verifies signature against public key                   │
│    - Checks issuer, audience, and subject claims             │
│    - Returns temporary credentials                           │
│                                                              │
│  S3 Bucket (public, 2 static JSON files):                    │
│    /.well-known/openid-configuration                         │
│    /keys.json                                                │
└──────────────────────────────────────────────────────────────┘
```

### What Gets Exposed Publicly

Only two static JSON files containing **public keys**. These can verify that a
token was signed by your cluster but cannot forge tokens. The signing private key
never leaves the K3s control plane node. This is the same trust model used by
every OIDC provider (Google, Auth0, etc.).

### Cost

Effectively $0/month. S3 storage for two ~1KB files is negligible, GET request
pricing is $0.0004/1000 (STS caches JWKS aggressively), the IAM OIDC Identity
Provider is free, and STS API calls are free.

---

## Part 1: Infrastructure Setup (One-Time)

These steps happen outside Kubernetes — on the K3s control plane node and in AWS.
They can be scripted or managed with Terraform but cannot be GitOps-managed since
they operate below the Kubernetes API layer.

### 1.1 Generate the SA Signing Keypair

Generate an RSA-2048 keypair dedicated to signing projected service account
tokens. This is separate from K3s's default SA key.

```bash
# Generate the private key
openssl genpkey -algorithm RSA \
  -out /var/lib/rancher/k3s/server/tls/irsa-signer.key \
  -pkeyopt rsa_keygen_bits:2048

# Extract the public key
openssl rsa \
  -in /var/lib/rancher/k3s/server/tls/irsa-signer.key \
  -pubout \
  -out /var/lib/rancher/k3s/server/tls/irsa-signer.pub

# Restrict permissions
chmod 600 /var/lib/rancher/k3s/server/tls/irsa-signer.key
chmod 644 /var/lib/rancher/k3s/server/tls/irsa-signer.pub
```

On HA K3s (multiple server nodes), copy both files to the same path on every
server node.

### 1.2 Generate the OIDC Discovery Documents

Two JSON files are needed. Set the variables first:

```bash
export S3_BUCKET="your-oidc-bucket"
export AWS_REGION="us-east-1"
export ISSUER_URL="https://s3.${AWS_REGION}.amazonaws.com/${S3_BUCKET}"
```

**`discovery.json`** (uploaded as `.well-known/openid-configuration`):

```bash
cat > discovery.json <<EOF
{
  "issuer": "${ISSUER_URL}",
  "jwks_uri": "${ISSUER_URL}/keys.json",
  "authorization_endpoint": "urn:kubernetes:programmatic_authorization",
  "response_types_supported": ["id_token"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "claims_supported": ["sub", "iss"]
}
EOF
```

**`keys.json`** (JWKS derived from the public key):

The `amazon-eks-pod-identity-webhook` repo includes a helper tool for this:

```bash
git clone https://github.com/aws/amazon-eks-pod-identity-webhook.git /tmp/webhook
go run /tmp/webhook/hack/self-hosted/main.go \
  -key /var/lib/rancher/k3s/server/tls/irsa-signer.pub \
  > keys.json
```

Verify both files contain valid JSON before proceeding:
```bash
jq . discovery.json
jq . keys.json
```

### 1.3 Create the S3 Bucket and Upload

```bash
# Create the bucket
aws s3api create-bucket \
  --bucket "$S3_BUCKET" \
  --region "$AWS_REGION" \
  --create-bucket-configuration LocationConstraint="$AWS_REGION"

# Allow public reads via bucket policy (ACL-based public access was blocked by
# AWS globally in April 2023, so use a bucket policy instead)
aws s3api put-public-access-block \
  --bucket "$S3_BUCKET" \
  --public-access-block-configuration \
    BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false

aws s3api put-bucket-policy \
  --bucket "$S3_BUCKET" \
  --policy '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::'"$S3_BUCKET"'/*"
    }]
  }'

# Upload the discovery documents
aws s3 cp discovery.json \
  "s3://${S3_BUCKET}/.well-known/openid-configuration" \
  --content-type application/json

aws s3 cp keys.json \
  "s3://${S3_BUCKET}/keys.json" \
  --content-type application/json

# Verify they're publicly accessible
curl -s "${ISSUER_URL}/.well-known/openid-configuration" | jq .
curl -s "${ISSUER_URL}/keys.json" | jq .
```

### 1.4 Create the IAM OIDC Identity Provider

```bash
# Compute the TLS thumbprint of the S3 endpoint's root CA
THUMBPRINT=$(openssl s_client \
  -connect "s3.${AWS_REGION}.amazonaws.com:443" \
  -servername "s3.${AWS_REGION}.amazonaws.com" \
  -showcerts 2>/dev/null </dev/null \
  | openssl x509 -fingerprint -noout -sha1 \
  | sed 's/SHA1 Fingerprint=//;s/://g' \
  | tr 'A-F' 'a-f')

aws iam create-open-id-connect-provider \
  --url "$ISSUER_URL" \
  --client-id-list "sts.amazonaws.com" \
  --thumbprint-list "$THUMBPRINT"
```

The thumbprint is the SHA-1 of Amazon's root CA for S3's TLS chain. It almost
never changes. If it does, update it with:

```bash
aws iam update-open-id-connect-provider-thumbprint \
  --open-id-connect-provider-arn "$OIDC_PROVIDER_ARN" \
  --thumbprint-list "$NEW_THUMBPRINT"
```

### 1.5 Configure K3s API Server Flags

Edit `/etc/rancher/k3s/config.yaml`:

```yaml
kube-apiserver-arg:
  # New IRSA issuer — must be listed first (first issuer is used for new tokens)
  - "service-account-issuer=https://s3.us-east-1.amazonaws.com/your-oidc-bucket"
  # Keep existing issuer so current SA tokens remain valid
  - "service-account-issuer=https://kubernetes.default.svc.cluster.local"
  # Signing key (private)
  - "service-account-signing-key-file=/var/lib/rancher/k3s/server/tls/irsa-signer.key"
  # Verification keys — MUST include both original K3s key and new IRSA key,
  # otherwise existing SA tokens across the cluster will fail validation
  - "service-account-key-file=/var/lib/rancher/k3s/server/tls/server-ca.crt"
  - "service-account-key-file=/var/lib/rancher/k3s/server/tls/irsa-signer.pub"
  # Audiences — must include sts.amazonaws.com for IRSA tokens and the default
  # audience for existing cluster-internal tokens
  - "api-audiences=sts.amazonaws.com,https://kubernetes.default.svc.cluster.local"
```

> **Important**: Before editing, verify the path of K3s's original SA
> verification key. It's typically `/var/lib/rancher/k3s/server/tls/server-ca.crt`
> but can vary. Check with:
> ```bash
> ps aux | grep kube-apiserver | grep -o 'service-account-key-file=[^ ]*'
> ```

Apply the changes:

```bash
sudo systemctl restart k3s

# Verify the flags took effect
ps aux | grep kube-apiserver | grep service-account-issuer

# Watch for errors
sudo journalctl -fu k3s | grep -iE "apiserver|error"
```

On HA K3s, update the config on every server node and restart them one at a time.
Plan for a brief API server interruption during restart (seconds on single-node).

### Terraform Alternative

The S3 bucket, OIDC provider, and per-workload IAM roles can be managed with
Terraform. The K3s config file change is the one part that doesn't fit into
Terraform — use Ansible, cloud-init, or a manual process for that.

```hcl
variable "s3_bucket"  { type = string }
variable "aws_region" { type = string }

resource "aws_s3_bucket" "oidc" {
  bucket = var.s3_bucket
}

resource "aws_s3_bucket_public_access_block" "oidc" {
  bucket                  = aws_s3_bucket.oidc.id
  block_public_acls       = false
  ignore_public_acls      = false
  block_public_policy     = false
  restrict_public_buckets = false
}

resource "aws_s3_bucket_policy" "oidc_public_read" {
  bucket = aws_s3_bucket.oidc.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = "*"
      Action    = "s3:GetObject"
      Resource  = "${aws_s3_bucket.oidc.arn}/*"
    }]
  })
}

resource "aws_s3_object" "discovery" {
  bucket       = aws_s3_bucket.oidc.id
  key          = ".well-known/openid-configuration"
  source       = "discovery.json"
  content_type = "application/json"
  etag         = filemd5("discovery.json")
}

resource "aws_s3_object" "jwks" {
  bucket       = aws_s3_bucket.oidc.id
  key          = "keys.json"
  source       = "keys.json"
  content_type = "application/json"
  etag         = filemd5("keys.json")
}

data "tls_certificate" "oidc" {
  url = "https://s3.${var.aws_region}.amazonaws.com/${aws_s3_bucket.oidc.id}"
}

resource "aws_iam_openid_connect_provider" "k3s" {
  url             = "https://s3.${var.aws_region}.amazonaws.com/${aws_s3_bucket.oidc.id}"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.oidc.certificates[0].sha1_fingerprint]
}
```

---

## Part 2: Cluster Setup (GitOps-Manageable)

These components live inside Kubernetes and can be managed through the normal
Git-based workflow.

### 2.1 Pod Identity Webhook

The `amazon-eks-pod-identity-webhook` is a mutating admission controller that
watches for ServiceAccounts annotated with `eks.amazonaws.com/role-arn`. When a
pod using such a ServiceAccount is created, the webhook injects:

- `AWS_ROLE_ARN` env var (the IAM role ARN from the annotation)
- `AWS_WEB_IDENTITY_TOKEN_FILE` env var (path to the projected token)
- `AWS_DEFAULT_REGION` env var (if configured)
- A projected service account token volume mount (audience: `sts.amazonaws.com`)

The webhook requires cert-manager (already installed) for its TLS certificate.

#### Option A: Raw Manifests

The upstream repo provides four manifests in
[`deploy/`](https://github.com/aws/amazon-eks-pod-identity-webhook/tree/master/deploy).
Apply them with `make cluster-up`, which runs `sed` to substitute the image tag
and then `kubectl apply`:

```bash
git clone https://github.com/aws/amazon-eks-pod-identity-webhook.git
cd amazon-eks-pod-identity-webhook
make cluster-up IMAGE=public.ecr.aws/eks/amazon-eks-pod-identity-webhook:v0.6.13
```

This creates all resources in the `default` namespace. To use a different
namespace, edit the namespace fields in the manifests before applying.

The manifests create:
- `ServiceAccount`, `Role`, `RoleBinding`, `ClusterRole`, `ClusterRoleBinding`
  (RBAC for the webhook)
- `Deployment` (the webhook itself)
- `ClusterIssuer` named `selfsigned` + `Certificate` named
  `pod-identity-webhook` (cert-manager resources for webhook TLS)
- `Service` (port 443)
- `MutatingWebhookConfiguration` with
  `cert-manager.io/inject-ca-from` annotation (cert-manager's CA injector
  auto-populates the `caBundle`)

> **Note**: The manifests create a `ClusterIssuer` named `selfsigned`. If you
> already have one with that name, remove it from the deployment manifest and
> update the `Certificate` to reference your existing issuer.

#### Option B: Community Helm Chart (Recommended)

A community Helm chart is maintained at
[`jkroepke/helm-charts`](https://github.com/jkroepke/helm-charts/tree/main/charts/amazon-eks-pod-identity-webhook):

```bash
helm repo add jkroepke https://jkroepke.github.io/helm-charts
helm install pod-identity-webhook jkroepke/amazon-eks-pod-identity-webhook \
  --namespace kube-system \
  --create-namespace \
  --set config.defaultAwsRegion=us-east-1 \
  --set config.tokenAudience=sts.amazonaws.com \
  --set config.stsRegionalEndpoint=true
```

If you have an existing cert-manager `ClusterIssuer` you'd like to reuse for the
webhook's TLS certificate:

```yaml
pki:
  certManager:
    enabled: true
    existingIssuer:
      enabled: true
      kind: ClusterIssuer
      name: selfsigned-bootstrap  # your existing issuer name
```

#### Webhook CLI Flags Reference

| Flag | Default | Description |
|------|---------|-------------|
| `--in-cluster` | `false` | Must be `false` (cert-manager mode). The old `true` (CSR mode) is deprecated. |
| `--namespace` | `default` | Namespace where the webhook runs |
| `--token-audience` | `sts.amazonaws.com` | Audience set on projected tokens. Must match `--api-audiences` on kube-apiserver and the IAM OIDC provider's client ID. |
| `--token-expiration` | `86400` | Projected token lifetime in seconds (24h). Kubelet auto-rotates at ~80% of lifetime. |
| `--annotation-prefix` | `eks.amazonaws.com` | Prefix for ServiceAccount annotations (`<prefix>/role-arn`). |
| `--aws-default-region` | _(none)_ | If set, injects `AWS_DEFAULT_REGION` into pods. |
| `--sts-regional-endpoint` | `false` | If true, injects `AWS_STS_REGIONAL_ENDPOINTS=regional` to use regional STS endpoints. |

---

## Part 3: Per-Workload Setup

Adding a new workload to use IRSA requires an IAM role in AWS and a ServiceAccount
annotation in Kubernetes. The OIDC provider, S3 bucket, webhook, and apiserver
configuration are never touched again.

### 3.1 Create an IAM Role

Each workload gets its own IAM role with a trust policy scoped to a specific
ServiceAccount:

```bash
OIDC_PROVIDER_ARN="arn:aws:iam::123456789012:oidc-provider/s3.us-east-1.amazonaws.com/your-oidc-bucket"
OIDC_HOST="s3.us-east-1.amazonaws.com/your-oidc-bucket"
NAMESPACE="my-namespace"
SA_NAME="my-sa"

aws iam create-role \
  --role-name "k3s-${NAMESPACE}-${SA_NAME}" \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Federated": "'"${OIDC_PROVIDER_ARN}"'"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "'"${OIDC_HOST}"':sub": "system:serviceaccount:'"${NAMESPACE}"':'"${SA_NAME}"'",
          "'"${OIDC_HOST}"':aud": "sts.amazonaws.com"
        }
      }
    }]
  }'
```

Then attach permissions for the specific AWS services the workload needs:

```bash
aws iam put-role-policy \
  --role-name "k3s-${NAMESPACE}-${SA_NAME}" \
  --policy-name "my-permissions" \
  --policy-document '{...}'
```

### 3.2 Annotate the ServiceAccount

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-sa
  namespace: my-namespace
  annotations:
    eks.amazonaws.com/role-arn: "arn:aws:iam::123456789012:role/k3s-my-namespace-my-sa"
```

### 3.3 Reference the ServiceAccount in the Workload

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-namespace
spec:
  template:
    spec:
      serviceAccountName: my-sa
      containers:
        - name: app
          image: my-app:latest
          # No AWS credential env vars needed.
          # The webhook injects these automatically:
          #   AWS_ROLE_ARN=arn:aws:iam::123456789012:role/...
          #   AWS_WEB_IDENTITY_TOKEN_FILE=/var/run/secrets/eks.amazonaws.com/serviceaccount/token
          #   AWS_DEFAULT_REGION=us-east-1  (if configured on the webhook)
```

### Trust Policy Scoping Options

The trust policy `Condition` controls which ServiceAccounts can assume the role:

| Scope | Condition | Example Value |
|-------|-----------|---------------|
| Exact SA | `StringEquals` on `:sub` | `system:serviceaccount:prod:my-sa` |
| All SAs in a namespace | `StringLike` on `:sub` | `system:serviceaccount:prod:*` |
| Multiple specific SAs | Multiple `Statement` entries | One per SA |
| All SAs in cluster | `StringLike` on `:sub` | `system:serviceaccount:*:*` (avoid) |

Multiple ServiceAccounts can assume the same role by listing multiple conditions
or using wildcards. The IAM role is the trust boundary — one role can serve
multiple consumers if appropriate.

### Terraform Module for Per-Workload Roles

```hcl
variable "workloads" {
  type = map(object({
    namespace  = string
    sa_name    = string
    policy_json = string
  }))
}

resource "aws_iam_role" "workload" {
  for_each = var.workloads

  name = "k3s-${each.key}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.k3s.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${aws_iam_openid_connect_provider.k3s.url}:sub" = "system:serviceaccount:${each.value.namespace}:${each.value.sa_name}"
          "${aws_iam_openid_connect_provider.k3s.url}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "workload" {
  for_each = var.workloads

  role   = aws_iam_role.workload[each.key].name
  name   = "permissions"
  policy = each.value.policy_json
}
```

---

## Part 4: Migrating Existing Workloads

This cluster currently has three workloads using static AWS credentials stored
in Kubernetes secrets (`aws-credentials` and `route53-creds`). All three use the
AWS SDK's standard credential chain, which means they support IRSA transparently
once the webhook injects the right environment variables.

### 4.1 external-dns (Route53)

The external-dns Helm chart's `serviceAccount.annotations` value configures IRSA.
Remove the static credential env vars from the values file.

**Before** (`apps/external-dns/external-values.yaml`):
```yaml
env:
  - name: AWS_DEFAULT_REGION
    value: us-east-1
  - name: AWS_ACCESS_KEY_ID
    valueFrom:
      secretKeyRef:
        name: aws-credentials
        key: access-key-id
  - name: AWS_SECRET_ACCESS_KEY
    valueFrom:
      secretKeyRef:
        name: aws-credentials
        key: secret-access-key
```

**After**:
```yaml
env:
  - name: AWS_DEFAULT_REGION
    value: us-east-1

serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/k3s-external-dns
```

The `AWS_DEFAULT_REGION` env var is kept because external-dns needs it for the
Route53 client configuration. The `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
env vars are removed — the webhook injects `AWS_ROLE_ARN` and
`AWS_WEB_IDENTITY_TOKEN_FILE` instead.

**IAM policy for external-dns**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets",
        "route53:ListTagsForResources"
      ],
      "Resource": "arn:aws:route53:::hostedzone/*"
    },
    {
      "Effect": "Allow",
      "Action": "route53:ListHostedZones",
      "Resource": "*"
    }
  ]
}
```

> **Note**: The internal external-dns instance uses the Unifi webhook provider and
> does not use AWS credentials. No changes needed for it.

### 4.2 ddns-route53

ddns-route53 uses `aws-sdk-go-v2` and calls `config.LoadDefaultConfig()`.
Static credentials are only applied if explicitly provided — when omitted, the
SDK falls back to the standard credential chain, which includes IRSA.

Remove the `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` env vars from the
deployment in `apps/external-dns.ts`, and ensure the deployment's
ServiceAccount is annotated with the IAM role ARN.

ddns-route53 can share the same IAM role as external-dns since both need the same
Route53 permissions, or it can have its own role for isolation.

### 4.3 cert-manager (Route53 DNS01 Solver)

cert-manager supports IRSA natively via ambient credentials. When the cert-manager
controller pod runs with a ServiceAccount that has IRSA credentials, the Route53
DNS01 solver uses them automatically.

**Before** (`apps/cert-manager/issuers.ts`):
```typescript
dns01: {
  route53: {
    region: "us-east-1",
    accessKeyIDSecretRef: {
      name: "route53-creds",
      key: "access-key-id",
    },
    secretAccessKeySecretRef: {
      name: "route53-creds",
      key: "secret-access-key",
    },
  },
},
```

**After**:
```typescript
dns01: {
  route53: {
    region: "us-east-1",
  },
},
```

Remove the `accessKeyIDSecretRef` and `secretAccessKeySecretRef` fields entirely.
cert-manager will use the ambient credentials from the IRSA-annotated
ServiceAccount.

The cert-manager Helm chart supports configuring the ServiceAccount annotation:
```yaml
# cert-manager Helm values
serviceAccount:
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/k3s-cert-manager
```

**IAM policy for cert-manager**:
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "route53:GetChange",
      "Resource": "arn:aws:route53:::change/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "route53:ChangeResourceRecordSets",
        "route53:ListResourceRecordSets"
      ],
      "Resource": "arn:aws:route53:::hostedzone/*"
    },
    {
      "Effect": "Allow",
      "Action": "route53:ListHostedZonesByName",
      "Resource": "*"
    }
  ]
}
```

### 4.4 Cleanup

After verifying all three workloads can authenticate via IRSA:

1. Delete the `aws-credentials` and `route53-creds` secrets from the cluster
2. Deactivate and then delete the IAM access keys in AWS
3. Remove any references to the old secret names from the repo

---

## Part 5: Adding Future Workloads

When a new application needs access to an AWS service (e.g., Secrets Manager,
S3, SQS), the process is:

1. **Create an IAM role** with a trust policy scoped to the application's
   ServiceAccount (see [3.1](#31-create-an-iam-role))
2. **Attach a permissions policy** for the specific AWS service
3. **Annotate the ServiceAccount** with
   `eks.amazonaws.com/role-arn: arn:aws:iam::<account>:role/<role-name>`
4. **Deploy the pod** with `serviceAccountName` set

No changes to the OIDC provider, S3 bucket, webhook, or apiserver are needed.

### Example: Granting Secrets Manager Access

```bash
# Create the role
aws iam create-role \
  --role-name k3s-my-app-secrets \
  --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789012:oidc-provider/s3.us-east-1.amazonaws.com/your-oidc-bucket"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "s3.us-east-1.amazonaws.com/your-oidc-bucket:sub": "system:serviceaccount:my-app:my-app-sa",
          "s3.us-east-1.amazonaws.com/your-oidc-bucket:aud": "sts.amazonaws.com"
        }
      }
    }]
  }'

# Attach Secrets Manager permissions
aws iam put-role-policy \
  --role-name k3s-my-app-secrets \
  --policy-name secretsmanager \
  --policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Action": [
        "secretsmanager:GetSecretValue",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:123456789012:secret:my-app/*"
    }]
  }'
```

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: my-app-sa
  namespace: my-app
  annotations:
    eks.amazonaws.com/role-arn: "arn:aws:iam::123456789012:role/k3s-my-app-secrets"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-app
  namespace: my-app
spec:
  template:
    spec:
      serviceAccountName: my-app-sa
      containers:
        - name: app
          image: my-app:latest
```

The application code uses the AWS SDK normally with no explicit credentials:
```python
import boto3
client = boto3.client('secretsmanager')
secret = client.get_secret_value(SecretId='my-app/db-password')
```

---

## Part 6: Credential Lifecycle

### Token Rotation

Projected service account tokens have a configurable lifetime (default: 24h,
set via `--token-expiration` on the webhook). Kubelet automatically rotates the
token file at ~80% of its lifetime — so a 24h token is refreshed at ~19h. The
pod does not restart; the file at `AWS_WEB_IDENTITY_TOKEN_FILE` is silently
updated.

AWS STS credentials obtained via `AssumeRoleWithWebIdentity` expire in 1 hour by
default (configurable up to 12h via `DurationSeconds`). The AWS SDK re-reads the
token file and calls STS again automatically when credentials expire.

### SA Signing Key Rotation

Rotating the signing key is a multi-step process. The old and new public keys
must coexist in the JWKS and in the apiserver's `--service-account-key-file`
flags during the transition.

```
Step 1: Generate new keypair
Step 2: Append new public key to JWKS (keys.json) — do NOT remove old key yet
Step 3: Upload merged keys.json to S3
Step 4: Update K3s config:
        - service-account-signing-key-file → new private key
        - service-account-key-file → both old and new public keys
Step 5: Restart K3s
Step 6: Wait one full token lifetime (24h) for all pods to get new tokens
Step 7: Remove old public key from keys.json and re-upload to S3
Step 8: Remove old service-account-key-file entry from K3s config
Step 9: Restart K3s
```

This requires two K3s restarts spread across ~24 hours. Key rotation should be
infrequent (annually or on suspected compromise).

### What Happens if S3 Goes Down

- Pods with cached STS credentials continue working until those credentials
  expire (~1h default)
- New `AssumeRoleWithWebIdentity` calls may fail if STS can't fetch the JWKS
  (STS caches it, so brief outages are usually transparent)
- IAM's JWKS cache duration is not publicly documented but has been observed at
  minutes to hours

S3 has 99.99% availability. For additional redundancy, the JWKS could be
replicated to CloudFront or a second static host.

---

## Reference: What Lives Where

| Component | Managed How | Touched When |
|-----------|-------------|--------------|
| SA signing keypair | Manual on K3s node (or Ansible) | One-time setup, then only on key rotation |
| K3s apiserver flags | `/etc/rancher/k3s/config.yaml` | One-time setup |
| S3 bucket + OIDC docs | Terraform or CLI script | One-time setup, then only on key rotation |
| IAM OIDC provider | Terraform or CLI | One-time setup |
| Pod identity webhook | Git (K8s manifests in this repo) | Deploy once, update on version bumps |
| IAM roles + policies | Terraform or CLI | Per workload |
| ServiceAccount annotations | Git (in this repo) | Per workload |
