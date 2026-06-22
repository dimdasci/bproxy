import { type BproxyForwardedRequest, PROTOCOL_VERSION, type SessionId } from "@bproxy/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { doc, el, type FakeDocument, type FakeElement } from "../../test/fixtures/fake-dom";
import { createMainWorldExecutor, type MainWorldExecuteDetails } from "../main-world";

const TEST_SESSION = "m4q7z2" as SessionId;

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
			scripting: { executeScript },
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
			},
		});

		await expect(mainWorld.executeRuntimeApiFill(fillRequest())).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message: "Runtime editor write failed",
		});
	});
});

function fillRequest(
	overrides: Partial<BproxyForwardedRequest<"fill">> = {},
): BproxyForwardedRequest<"fill"> {
	return {
		protocol_version: PROTOCOL_VERSION,
		id: overrides.id ?? "req-fill-main",
		action: "fill",
		params: overrides.params ?? {
			target: { selector: "#editor" },
			value: "hello from main",
			method: "runtime-api",
			world: "main",
		},
		session: overrides.session ?? TEST_SESSION,
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
		href === undefined ? originalGlobals.location : ({ href } as Location),
	);
}
