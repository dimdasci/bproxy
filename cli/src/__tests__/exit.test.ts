import { describe, expect, it } from "vitest";
import {
	type ExitPlan,
	executeExitPlan,
	exitFromResponse,
	exitProtocolError,
	exitSuccess,
	exitUsageError,
} from "../exit.js";
import type { BproxyResponse } from "../types.js";

/** Fake writable stream that captures written data. */
function fakeStream(): NodeJS.WritableStream & { data: string } {
	const stream = {
		data: "",
		write(chunk: string | Uint8Array): boolean {
			stream.data += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
			return true;
		},
		end() {
			return stream;
		},
	} as unknown as NodeJS.WritableStream & { data: string };
	return stream;
}

describe("exitFromResponse", () => {
	it("maps ok:true response to exit code 0", () => {
		const response = {
			protocol_version: 1,
			id: "req-1",
			ok: true,
			data: { text: "hello" },
			page: { url: "https://example.com", title: "Test", state: "ready", busy: false },
			replay: false,
		} as BproxyResponse;

		const plan = exitFromResponse(response);
		expect(plan.code).toBe(0);
		expect(plan.stdout).toBe(response);
		expect(plan.stderr).toBeUndefined();
	});

	it("maps ok:false response to exit code 1", () => {
		const response = {
			protocol_version: 1,
			id: "req-2",
			ok: false,
			error: { code: "TIMEOUT", message: "Request timed out" },
		} as BproxyResponse;

		const plan = exitFromResponse(response);
		expect(plan.code).toBe(1);
		expect(plan.stdout).toBe(response);
		expect(plan.stderr).toBeUndefined();
	});
});

describe("exitSuccess", () => {
	it("creates exit 0 plan with data on stdout", () => {
		const plan = exitSuccess({ running: true, pid: 123 });
		expect(plan).toEqual({ code: 0, stdout: { running: true, pid: 123 } });
	});
});

describe("exitProtocolError", () => {
	it("creates exit 1 plan with error data on stdout", () => {
		const data = { ok: false, error: { code: "NOT_FOUND" } };
		const plan = exitProtocolError(data);
		expect(plan).toEqual({ code: 1, stdout: data });
	});
});

describe("exitUsageError", () => {
	it("creates exit 2 plan with message on stderr", () => {
		const plan = exitUsageError("Missing required flag --url");
		expect(plan).toEqual({ code: 2, stderr: "Missing required flag --url" });
	});

	it("has no stdout payload", () => {
		const plan = exitUsageError("error");
		expect(plan.stdout).toBeUndefined();
	});
});

describe("executeExitPlan", () => {
	it("writes stdout JSON and calls exit with code 0", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();
		let exitCode: number | undefined;

		const plan: ExitPlan = { code: 0, stdout: { ok: true } };
		executeExitPlan(plan, {
			stdout,
			stderr,
			exit: (code) => {
				exitCode = code;
			},
		});

		expect(stdout.data).toBe('{"ok":true}\n');
		expect(stderr.data).toBe("");
		expect(exitCode).toBe(0);
	});

	it("writes stderr message and calls exit with code 2", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();
		let exitCode: number | undefined;

		const plan: ExitPlan = { code: 2, stderr: "daemon not running" };
		executeExitPlan(plan, {
			stdout,
			stderr,
			exit: (code) => {
				exitCode = code;
			},
		});

		expect(stdout.data).toBe("");
		expect(stderr.data).toBe("daemon not running\n");
		expect(exitCode).toBe(2);
	});

	it("writes protocol error to stdout and exits 1", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();
		let exitCode: number | undefined;

		const plan: ExitPlan = {
			code: 1,
			stdout: { ok: false, error: { code: "TIMEOUT" } },
		};
		executeExitPlan(plan, {
			stdout,
			stderr,
			exit: (code) => {
				exitCode = code;
			},
		});

		expect(JSON.parse(stdout.data)).toEqual({ ok: false, error: { code: "TIMEOUT" } });
		expect(stderr.data).toBe("");
		expect(exitCode).toBe(1);
	});

	it("can write both stdout and stderr for exit 1 partial-success warnings", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();
		let exitCode: number | undefined;

		const plan: ExitPlan = {
			code: 1,
			stdout: { ok: false, error: { code: "HUMAN_REQUIRED" } },
			stderr: "Warning: session terminated but some Chrome tabs may not have been closed.",
		};
		executeExitPlan(plan, {
			stdout,
			stderr,
			exit: (code) => {
				exitCode = code;
			},
		});

		expect(JSON.parse(stdout.data)).toEqual({ ok: false, error: { code: "HUMAN_REQUIRED" } });
		expect(stderr.data).toContain("session terminated");
		expect(exitCode).toBe(1);
	});

	it("does not pollute stdout when only stderr is present", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();

		executeExitPlan({ code: 2, stderr: "error" }, { stdout, stderr, exit: () => {} });

		expect(stdout.data).toBe("");
	});

	it("does not pollute stderr when only stdout is present", () => {
		const stdout = fakeStream();
		const stderr = fakeStream();

		executeExitPlan({ code: 0, stdout: { data: 1 } }, { stdout, stderr, exit: () => {} });

		expect(stderr.data).toBe("");
	});
});
