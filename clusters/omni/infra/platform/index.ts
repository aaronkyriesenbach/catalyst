import { backupBucket } from "./aws";
import { dexAdminPassword } from "./dex";
import { gatewayName } from "./gateway";
import { deployOmni } from "./omni";

deployOmni();

export const dexAdminUsername = "aaron";
export const dexAdminPasswordOutput = dexAdminPassword;
export const gateway = gatewayName;
export const backupBucketName = backupBucket.bucket;
