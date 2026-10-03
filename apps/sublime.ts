import { applyModifiers, withIscsiVolumes, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { buildAwsExternalSecret, buildFileConfigMap, readFile } from "../utils";

const name = "sublime";
const configConfigMapName = `${name}-config`;
const opensubtitlesSecretName = `${name}-opensubtitles-credentials`;
const subdlSecretName = `${name}-subdl-credentials`;

const whisperPort = 8081;
const whisperModelFile = "ggml-large-v3-turbo-q5_0.bin";
const whisperModelsVolume = "whisper-models";

const configConfigMap = buildFileConfigMap(configConfigMapName, {
	"config.yaml": await readFile("./sublime/config.yaml", import.meta.url),
});

const opensubtitlesSecret = buildAwsExternalSecret(opensubtitlesSecretName, [
	{
		remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
		property: "API_KEY",
		secretKey: "API_KEY",
	},
	{
		remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
		property: "USERNAME",
		secretKey: "USERNAME",
	},
	{
		remoteKey: "lab53/cluster0/sublime/opensubtitles-credentials",
		property: "PASSWORD",
		secretKey: "PASSWORD",
	},
]);

const subdlSecret = buildAwsExternalSecret(subdlSecretName, [
	{
		remoteKey: "lab53/cluster0/sublime/subdl-credentials",
		property: "API_KEY",
		secretKey: "API_KEY",
	},
]);

const base: WorkloadApp = {
	kind: "workload",
	name,
	podSpec: {
		containers: [
			{
				name: "main",
				image: "ghcr.io/aaronkyriesenbach/sublime:0.4.0",
				env: [
					{
						name: "SUBLIME_OPENSUBTITLES_API_KEY",
						valueFrom: {
							secretKeyRef: {
								name: opensubtitlesSecretName,
								key: "API_KEY",
							},
						},
					},
					{
						name: "SUBLIME_OPENSUBTITLES_USERNAME",
						valueFrom: {
							secretKeyRef: {
								name: opensubtitlesSecretName,
								key: "USERNAME",
							},
						},
					},
					{
						name: "SUBLIME_OPENSUBTITLES_PASSWORD",
						valueFrom: {
							secretKeyRef: {
								name: opensubtitlesSecretName,
								key: "PASSWORD",
							},
						},
					},
					{
						name: "SUBLIME_SUBDL_API_KEY",
						valueFrom: {
							secretKeyRef: {
								name: subdlSecretName,
								key: "API_KEY",
							},
						},
					},
				],
				volumeMounts: [
					{ name: "config", mountPath: "/config", readOnly: true },
				],
			},
			{
				name: "whisper",
				image: "ghcr.io/ggml-org/whisper.cpp:main",
				command: ["whisper-server"],
				args: [
					"--host",
					"127.0.0.1",
					"--port",
					String(whisperPort),
					"-m",
					`/models/${whisperModelFile}`,
					"-t",
					"4",
					// Drops non-speech tokens such as [MUSIC].
					"--suppress-nst",
					// Returns an empty result instead of HTTP 500 for chunks with no speech.
					"-nlp",
				],
				// Model is ~1 GiB resident plus ~14 MiB per minute of chunk audio, so the
				// limit is a hard cap with headroom rather than something to tune down;
				// CPU can be throttled freely at the cost of speed.
				resources: {
					requests: { cpu: "1", memory: "1536Mi" },
					limits: { cpu: "4", memory: "1536Mi" },
				},
				volumeMounts: [
					{
						name: whisperModelsVolume,
						mountPath: "/models",
						readOnly: true,
					},
				],
			},
		],
		initContainers: [
			{
				name: "download-whisper-model",
				image: "docker.int.lab53.net/curlimages/curl:8.12.1",
				command: [
					"sh",
					"-c",
					`[ -f /models/${whisperModelFile} ] || curl -fL -o /models/${whisperModelFile} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${whisperModelFile}`,
				],
				volumeMounts: [
					{ name: whisperModelsVolume, mountPath: "/models" },
				],
			},
		],
		volumes: [
			{ name: "config", configMap: { name: configConfigMapName } },
			{ name: whisperModelsVolume, emptyDir: {} },
		],
	},
	extraResources: [configConfigMap, opensubtitlesSecret, subdlSecret],
};

export default applyModifiers(
	base,
	withIscsiVolumes({
		main: [{ name: "data", mountPath: "/data", backup: true }],
	}),
	withNasMounts({
		main: [
			{ mountPath: "/movies", subPath: "movies" },
			{ mountPath: "/tv", subPath: "tv" },
		],
	}),
);
