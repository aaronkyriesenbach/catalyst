import {
	applyModifiers,
	withIscsiVolumes,
	withNasMounts,
	withOidcAuth,
} from "../modifiers";
import { readiness, startup, tcpCheck } from "../probes";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const base: WorkloadApp = {
	kind: "workload",
	name: "qbittorrent",
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("qbittorrent"),
				env: [
					{ name: "PUID", value: "1000" },
					{ name: "PGID", value: "1000" },
					{ name: "TZ", value: "America/New_York" },
					{ name: "WEBUI_PORT", value: "8080" },
				],
				ports: [
					{ name: "http", containerPort: 8080 },
					{ name: "torrent-tcp", containerPort: 6881 },
					{
						name: "torrent-udp",
						containerPort: 6881,
						protocol: "UDP",
					},
				],
				readinessProbe: readiness(tcpCheck(8080)),
				startupProbe: startup(tcpCheck(8080), 120),
			},
		],
		// securityContext: {},
	},
	webPort: 8080,
	subDomain: "etree",
};

export default applyModifiers(
	base,
	withIscsiVolumes({
		main: [{ name: "config", mountPath: "/config" }],
	}),
	withNasMounts({
		main: [{ mountPath: "/downloads", subPath: "etree" }],
	}),
	withOidcAuth({ middleware: { enabled: true } }),
);
