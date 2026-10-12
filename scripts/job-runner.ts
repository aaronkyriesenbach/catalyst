import { mkdirSync } from "node:fs";
import { join } from "node:path";

export type Job = {
	label: string;
	args: string[];
};

type JobResult = {
	label: string;
	exitCode: number;
};

const concurrency = 4;

async function runJob(outDir: string, job: Job): Promise<JobResult> {
	const { ARGOCD_ENV_APP: _ignored, ...env } = process.env;
	const proc = Bun.spawn(["bun", "run", ...job.args], {
		stdout: "pipe",
		stderr: "pipe",
		// A stray ARGOCD_ENV_APP would turn the enumerate-all render into a single-app one.
		env,
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	await Promise.all([
		Bun.write(join(outDir, `${job.label}.out`), stdout),
		Bun.write(join(outDir, `${job.label}.err`), stderr),
		Bun.write(join(outDir, `${job.label}.exit`), `${exitCode}\n`),
	]);

	return { label: job.label, exitCode };
}

export async function runJobs(outDir: string, jobs: Job[]): Promise<boolean> {
	mkdirSync(outDir, { recursive: true });

	const results: JobResult[] = [];
	const queue = [...jobs];

	async function worker(): Promise<void> {
		for (let job = queue.shift(); job; job = queue.shift()) {
			results.push(await runJob(outDir, job));
		}
	}

	await Promise.all(Array.from({ length: concurrency }, worker));

	console.log(`Rendered ${results.length} outputs into ${outDir}`);

	const failures = results.filter((result) => result.exitCode !== 0);

	for (const failure of failures) {
		console.error(`FAILED (${failure.exitCode}): ${failure.label}`);
	}

	return failures.length === 0;
}
