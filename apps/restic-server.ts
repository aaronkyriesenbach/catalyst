import { Project } from "../constants";
import { applyModifiers, withNasMounts } from "../modifiers";
import type { WorkloadApp } from "../types";
import { image } from "../utils";

const base: WorkloadApp = {
	kind: "workload",
	name: "restic-server",
	project: Project.SYSTEM,
	podSpec: {
		containers: [
			{
				name: "main",
				image: image("resticServer"),
				command: ["rest-server"],
				args: ["--no-auth", "--path", "/data"],
				ports: [{ name: "http", containerPort: 8000 }],
			},
		],
	},
};

export default applyModifiers(
	base,
	withNasMounts({
		main: [{ mountPath: "/data", subPath: "backups/volsync" }],
	}),
);
