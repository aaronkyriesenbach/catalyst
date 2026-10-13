import type { IPodSpec, IProbe } from "kubernetes-models/v1";

type ProbeHandler = Pick<IProbe, "httpGet" | "tcpSocket" | "exec">;

const READINESS_TIMING = {
	periodSeconds: 10,
	timeoutSeconds: 3,
	failureThreshold: 3,
} as const;

const STARTUP_PERIOD_SECONDS = 5;

export function httpCheck(path: string, port: number): ProbeHandler {
	return { httpGet: { path, port } };
}

export function tcpCheck(port: number): ProbeHandler {
	return { tcpSocket: { port } };
}

export function execCheck(...command: string[]): ProbeHandler {
	return { exec: { command } };
}

export function readiness(
	handler: ProbeHandler,
	overrides?: Partial<IProbe>,
): IProbe {
	return { ...handler, ...READINESS_TIMING, ...overrides };
}

// Liveness and readiness wait for this probe; `budgetSeconds` is the longest boot tolerated.
export function startup(handler: ProbeHandler, budgetSeconds: number): IProbe {
	return {
		...handler,
		periodSeconds: STARTUP_PERIOD_SECONDS,
		timeoutSeconds: READINESS_TIMING.timeoutSeconds,
		failureThreshold: Math.ceil(budgetSeconds / STARTUP_PERIOD_SECONDS),
	};
}

export function postgresProbes(...isReadyCommand: string[]) {
	const handler = execCheck(...isReadyCommand);

	return {
		startupProbe: startup(handler, 150),
		readinessProbe: readiness(handler),
	};
}

// Without readiness a pod is Ready at container start, so a rollout drops the old pod at once.
export function assertReadinessProbe(
	name: string,
	podSpec: IPodSpec,
	probeExempt?: string,
): void {
	if (probeExempt !== undefined) {
		return;
	}

	if (!podSpec.containers.some((c) => c.readinessProbe !== undefined)) {
		throw new Error(
			`'${name}' has no readinessProbe on any container; add one or set probeExempt with a reason`,
		);
	}
}
