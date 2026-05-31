import type { BproxyForwardedRequest } from "@bproxy/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, el, type FakeDocument, type FakeElement } from "../../test/fixtures/fake-dom";
import {
	createMainWorldExecutor,
	type MainWorldExecuteDetails,
	type MainWorldScriptingSeam,
} from "../main-world";

type GlobalSnapshot = {
	document: Document | undefined;
	location: Location | undefined;
};

const originalGlobals: GlobalSnapshot = {
	document: globalThis.document,
	location: globalThis.location,
};

afterEach(() => {
	setPageGlobals(undefined, undefined);
});

describe("createMainWorldExecutor", () => {
	it("executes eval in MAIN world and returns plain data", async () => {
		const page = pageDoc();
		setPageGlobals(page, "https://example.test/eval");

		const executeScript = vi.fn(async (details: MainWorldExecuteDetails) => [
			{ result: details.func(...details.args) },
		]);
		const mainWorld = createMainWorldExecutor({
			scripting: { executeScript } as MainWorldScriptingSeam,
		});

		const result = await mainWorld.executeEval(evalRequest());

		expect(executeScript).toHaveBeenCalledTimes(1);
		expect(executeScript).toHaveBeenCalledWith(
			expect.objectContaining({
				target: { tabId: 42 },
				world: "MAIN",
			}),
		);
		expect(result).toEqual({
			data: { result: 2 },
			page: {
				url: "https://example.test/eval",
				title: "Editor",
				state: "ready",
				busy: false,
			},
		});
	});

	it("surfaces thrown eval details for real-site debugging", async () => {
		const page = pageDoc();
		setPageGlobals(page, "https://www.linkedin.com/feed/");

		const mainWorld = createMainWorldExecutor({
			scripting: {
				executeScript: async (details: MainWorldExecuteDetails) => [
					{ result: details.func(...details.args) },
				],
			} as MainWorldScriptingSeam,
		});

		await expect(
			mainWorld.executeEval(
				evalRequest({
					params: {
						code: 'throw new EvalError("Refused to evaluate a string as JavaScript")',
					},
				}),
			),
		).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message: "MAIN-world eval failed: Refused to evaluate a string as JavaScript",
			details: {
				name: "EvalError",
				message: "Refused to evaluate a string as JavaScript",
			},
		});
	});

	it("reports likely string-eval blocking when eval result is null but probe succeeds", async () => {
		const page = pageDoc();
		setPageGlobals(page, "https://www.linkedin.com/feed/");

		const executeScript = vi
			.fn<MainWorldScriptingSeam["executeScript"]>()
			.mockResolvedValueOnce([{ result: null }])
			.mockResolvedValueOnce([
				{
					result: {
						ok: true,
						result: { probe: true, value: 2 },
						page: {
							url: "https://www.linkedin.com/feed/",
							title: "Editor",
							readyState: "complete",
							busyHint: false,
						},
					},
				},
			]);
		const mainWorld = createMainWorldExecutor({
			scripting: { executeScript } as MainWorldScriptingSeam,
		});

		await expect(mainWorld.executeEval(evalRequest())).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message:
				"MAIN-world eval returned null while a non-eval MAIN-world probe succeeded. This page may block string evaluation for extension-injected MAIN-world code (for example via CSP).",
			details: {
				executions: [{ result: null }],
				executionsLength: 1,
				hasFirstExecution: true,
				hasResultField: true,
				firstExecution: { result: null },
				firstResult: null,
				firstResultType: "null",
				probe: {
					ok: true,
					result: { probe: true, value: 2 },
				},
			},
		});
	});

	it("executes runtime-api fill as a single MAIN-world script call and returns plain data", async () => {
		const editor = el("div", { attrs: { id: "editor" } });
		const handle = {
			text: "",
			setText(next: string) {
				this.text = `${next}\n`;
			},
			getText() {
				return this.text;
			},
		};
		(editor as FakeElement & { __quill?: typeof handle }).__quill = handle;
		const page = pageDoc(editor);
		setPageGlobals(page, "https://example.test/editor");

		const executeScript = vi.fn(async (details: MainWorldExecuteDetails) => [
			{ result: details.func(...details.args) },
		]);
		const mainWorld = createMainWorldExecutor({
			scripting: { executeScript } as MainWorldScriptingSeam,
		});

		const result = await mainWorld.executeRuntimeApiFill(fillRequest());

		expect(executeScript).toHaveBeenCalledTimes(1);
		expect(executeScript).toHaveBeenCalledWith(
			expect.objectContaining({
				target: { tabId: 42 },
				world: "MAIN",
			}),
		);
		expect(result).toEqual({
			data: { filled: true, verifiedValue: "hello from main" },
			page: {
				url: "https://example.test/editor",
				title: "Editor",
				state: "ready",
				busy: false,
			},
		});
		const [{ func }] = executeScript.mock.calls[0] as [
			MainWorldExecuteDetails<readonly unknown[], unknown>,
		];
		const source = func.toString();
		expect(source).not.toMatch(/chrome-extension|bproxy|quill|lexical|monaco|slate|prosemirror/i);
	});

	it("normalizes MAIN-world failures without leaking the thrown editor error", async () => {
		const editor = el("div", { attrs: { id: "editor" } });
		const handle = {
			setText() {
				throw new Error("page exploded");
			},
			getText() {
				return "";
			},
		};
		(editor as FakeElement & { __quill?: typeof handle }).__quill = handle;
		const page = pageDoc(editor);
		setPageGlobals(page, "https://example.test/editor");

		const mainWorld = createMainWorldExecutor({
			scripting: {
				executeScript: async (details: MainWorldExecuteDetails) => [
					{ result: details.func(...details.args) },
				],
			} as MainWorldScriptingSeam,
		});

		await expect(mainWorld.executeRuntimeApiFill(fillRequest())).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message: "Runtime editor write failed",
		});
	});
});

function evalRequest(
	overrides: Partial<BproxyForwardedRequest<"eval">> = {},
): BproxyForwardedRequest<"eval"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-eval-main",
		action: "eval",
		params: overrides.params ?? { code: "return 1 + 1;" },
		session: overrides.session ?? "default",
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function fillRequest(
	overrides: Partial<BproxyForwardedRequest<"fill">> = {},
): BproxyForwardedRequest<"fill"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-fill-main",
		action: "fill",
		params: overrides.params ?? {
			target: { selector: "#editor" },
			value: "hello from main",
			method: "runtime-api",
			world: "main",
		},
		session: overrides.session ?? "default",
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function pageDoc(...children: FakeElement[]): FakeDocument {
	const page = doc(
		el("html", {
			children: [el("body", { children })],
		}),
	);
	(page as FakeDocument & { title: string; readyState: DocumentReadyState }).title = "Editor";
	(page as FakeDocument & { title: string; readyState: DocumentReadyState }).readyState =
		"complete";
	return page;
}

function setPageGlobals(page: FakeDocument | undefined, href: string | undefined): void {
	Reflect.set(
		globalThis,
		"document",
		(page as unknown as Document | undefined) ?? originalGlobals.document,
	);
	Reflect.set(
		globalThis,
		"location",
		href !== undefined ? ({ href } as Location) : originalGlobals.location,
	);
}
