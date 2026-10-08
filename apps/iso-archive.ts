import { CronJob } from "kubernetes-models/batch/v1";
import { weeklyOn } from "../cron";
import { nasVolume, nasVolumeMounts } from "../modifiers";
import type { StaticApp } from "../types";
import { buildFileConfigMap, readFile } from "../utils";

const name = "iso-archive";
const scriptsConfigMapName = `${name}-scripts`;
const scriptFileName = "archive-isos.sh";
const targets = ["debian", "ubuntu", "nixos", "arch", "windows"];

// Digest-pinned: the 3.22 tag moves with every LinuxServer rebuild.
const image =
	"ghcr.io/linuxserver/baseimage-alpine@sha256:ab81abc99e45ef5b045a6c6f41fb2f3ac3651b89f81b0942e1d8861650605cb0";

const scripts = buildFileConfigMap(scriptsConfigMapName, {
	[scriptFileName]: await readFile(
		`../scripts/${scriptFileName}`,
		import.meta.url,
	),
});

const cronJob = new CronJob({
	metadata: { name },
	spec: {
		schedule: weeklyOn("sun", 3),
		concurrencyPolicy: "Forbid",
		successfulJobsHistoryLimit: 1,
		failedJobsHistoryLimit: 3,
		jobTemplate: {
			spec: {
				backoffLimit: 1,
				activeDeadlineSeconds: 8 * 60 * 60,
				template: {
					spec: {
						restartPolicy: "Never",
						automountServiceAccountToken: false,
						securityContext: {
							runAsNonRoot: true,
							runAsUser: 1000,
							runAsGroup: 1000,
						},
						containers: [
							{
								name: "archive",
								image,
								command: [
									"bash",
									`/scripts/${scriptFileName}`,
									...targets,
								],
								env: [
									{ name: "ISO_ROOT", value: "/images" },
									{ name: "ISO_KEEP", value: "3" },
									{ name: "HOME", value: "/tmp" },
								],
								volumeMounts: [
									{
										name: "scripts",
										mountPath: "/scripts",
										readOnly: true,
									},
									// quickget's here-documents need a writable TMPDIR; the image's /tmp isn't.
									{ name: "tmp", mountPath: "/tmp" },
									...nasVolumeMounts([
										{
											mountPath: "/images",
											subPath: "images",
										},
									]),
								],
							},
						],
						volumes: [
							{
								name: "scripts",
								configMap: { name: scriptsConfigMapName },
							},
							{ name: "tmp", emptyDir: {} },
							nasVolume(),
						],
					},
				},
			},
		},
	},
});

const config: StaticApp = {
	kind: "static",
	name,
	resources: [scripts, cronJob],
};

export default config;
