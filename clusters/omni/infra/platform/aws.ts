import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as random from "@pulumi/random";
import { awsSecretKey } from "@catalyst/infra/aws-keys";
import { clusterName } from "../common";
import { config } from "./context";
import { dexAdminPassword } from "./dex";

const suffix = new random.RandomId("backup-bucket-suffix", { byteLength: 4 });

export const backupBucket = new aws.s3.Bucket("omni-backups", {
  bucket: pulumi.interpolate`lab53-omni-backups-${suffix.hex}`,
});

new aws.s3.BucketPublicAccessBlock("omni-backups", {
  bucket: backupBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

new aws.s3.BucketVersioning("omni-backups", {
  bucket: backupBucket.id,
  versioningConfiguration: { status: "Enabled" },
});

new aws.s3.BucketServerSideEncryptionConfiguration("omni-backups", {
  bucket: backupBucket.id,
  rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" } }],
});

new aws.s3.BucketLifecycleConfiguration("omni-backups", {
  bucket: backupBucket.id,
  rules: [
    {
      id: "expire-old-snapshots",
      status: "Enabled",
      filter: { prefix: "omni/etcd/" },
      expiration: { days: 30 },
      noncurrentVersionExpiration: { noncurrentDays: 30 },
    },
  ],
});

const backupUser = new aws.iam.User("omni-backup", { name: "omni-backup" });

new aws.iam.UserPolicy("omni-backup", {
  user: backupUser.name,
  policy: backupBucket.arn.apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:PutObject", "s3:ListBucket"],
          Resource: [arn, `${arn}/omni/etcd/*`],
        },
      ],
    }),
  ),
});

const backupKey = new aws.iam.AccessKey("omni-backup", {
  user: backupUser.name,
});

export const backupCredentials = {
  accessKeyId: backupKey.id,
  secretAccessKey: pulumi.secret(backupKey.secret),
};

const secrets: Readonly<Record<string, pulumi.Input<string>>> = {
  "etcd-encryption-key": config.requireSecret("etcdEncryptionKey"),
  "dex-admin-password": dexAdminPassword,
};

for (const [name, value] of Object.entries(secrets)) {
  const secret = new aws.secretsmanager.Secret(name, {
    name: awsSecretKey(clusterName, "omni", name),
  });

  new aws.secretsmanager.SecretVersion(name, {
    secretId: secret.id,
    secretString: value,
  });
}
