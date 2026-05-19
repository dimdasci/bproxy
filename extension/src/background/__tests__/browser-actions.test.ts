import type { BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import { createBrowserActionHandler } from "../browser-actions";

const PAGE: PageState = {
	url: "https://example.test/",
	title: "Example",
	state: "ready",
	busy: false,
};

describe("createBrowserActionHandler", () => {
	it("requires runtime-api fill to use world main", async () => {
		const mainWorld = {
			executeRuntimeApiFill: vi.fn(async () => ({ data: { filled: true, verifiedValue: "x" }, page: PAGE })),
			executeEval: vi.fn(async () => ({ data: { result: "ok" }, page: PAGE })),
		};
		const handler = createBrowserActionHandler({ mainWorld });

		await expect(
			handler.handleMainWorldFill(
				fillRequest({ params: { target: { selector: "#editor" }, value: "x", method: "runtime-api", world: "isolated" } }),
			),
		).rejects.toMatchObject({
			code: "SCRIPT_ERROR",
			message: 'fill method runtime-api requires world "main"',
		});
		expect(mainWorld.executeRuntimeApiFill).not.toHaveBeenCalled();
	});

	it("returns EVAL_DISABLED by default and does not execute MAIN-world eval", async () => {
		const mainWorld = {
			executeRuntimeApiFill: vi.fn(async () => ({ data: { filled: true, verifiedValue: "x" }, page: PAGE })),
			executeEval: vi.fn(async () => ({ data: { result: "ok" }, page: PAGE })),
		};
		const handler = createBrowserActionHandler({ mainWorld });

		await expect(handler.handleBrowserAction(evalRequest())).rejects.toMatchObject({
			code: "EVAL_DISABLED",
			category: "policy",
		});
		expect(mainWorld.executeEval).not.toHaveBeenCalled();
	});
});

function fillRequest(
	overrides: Partial<BproxyForwardedRequest<"fill">> = {},
): BproxyForwardedRequest<"fill"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-fill",
		action: "fill",
		params:
			overrides.params ??
			{
				target: { selector: "#editor" },
				value: "x",
				method: "runtime-api",
				world: "main",
			},
		session: overrides.session ?? "default",
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}

function evalRequest(
	overrides: Partial<BproxyForwardedRequest<"eval">> = {},
): BproxyForwardedRequest<"eval"> {
	return {
		protocol_version: 1,
		id: overrides.id ?? "req-eval",
		action: "eval",
		params: overrides.params ?? { code: "return 1;" },
		session: overrides.session ?? "default",
		deadline: overrides.deadline ?? 10_000,
		destructive: overrides.destructive ?? true,
		target: overrides.target ?? { tabId: 42 },
	};
}
