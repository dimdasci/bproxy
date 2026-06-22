import type { ActionResult, BproxyError, PageState } from "@bproxy/shared";
import { describe, expect, it, vi } from "vitest";
import {
	createContentRpcHost,
	parseContentRpcResponse,
	registerContentRpcListener,
	toContentRpcRequest,
} from "../rpc";

const PAGE: PageState = {
	url: "https://example.test/",
	title: "Example",
	state: "ready",
	busy: false,
};

function protocolError(message: string): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message,
	};
}

describe("createContentRpcHost", () => {
	it("supports links as a content action", async () => {
		const host = createContentRpcHost({
			handlers: {
				links: () =>
					({
						links: [
							{
								text: "Example",
								href: "https://example.test/",
								target: { selector: "a" },
								visible: true,
							},
						],
						total: 1,
					}) satisfies ActionResult["links"],
			},
			getPageState: () => PAGE,
		});

		const response = await host.handleMessage(
			toContentRpcRequest({
				id: "req-links",
				action: "links",
				params: { selector: "main", visibleOnly: true, limit: 1 },
			}),
		);

		expect(response).toMatchObject({
			kind: "bproxy.content.response",
			id: "req-links",
			ok: true,
			data: {
				links: [
					{
						text: "Example",
						href: "https://example.test/",
						target: { selector: "a" },
						visible: true,
					},
				],
				total: 1,
			},
			page: PAGE,
		});
	});

	it("returns a normalized error for unimplemented content actions", async () => {
		const host = createContentRpcHost({
			handlers: {
				text: () => ({ text: "ok" }),
			},
			getPageState: () => PAGE,
		});

		const response = await host.handleMessage(
			toContentRpcRequest({
				id: "req-1",
				action: "scroll",
				params: {},
			}),
		);

		expect(response).toMatchObject({
			kind: "bproxy.content.response",
			id: "req-1",
			ok: false,
			error: {
				code: "SCRIPT_ERROR",
				message: "Content action is not implemented yet: scroll",
			},
		});
	});

	it("normalizes thrown handler errors into shared envelopes", async () => {
		const host = createContentRpcHost({
			handlers: {
				text: () => {
					throw new Error("boom");
				},
			},
			getPageState: () => PAGE,
		});

		const response = await host.handleMessage(
			toContentRpcRequest({
				id: "req-2",
				action: "text",
				params: {},
			}),
		);

		expect(response).toMatchObject({
			id: "req-2",
			ok: false,
			error: {
				code: "SCRIPT_ERROR",
				message: "boom",
				details: { action: "text", name: "Error" },
			},
		});
	});

	it("registers one listener and preserves request id correlation", async () => {
		let listener:
			| ((
					message: unknown,
					sender: unknown,
					sendResponse: (response?: unknown) => void,
			  ) => boolean | void)
			| undefined;
		const runtimeOnMessage = {
			addListener: vi.fn((cb) => {
				listener = cb;
			}),
		};

		registerContentRpcListener({
			runtimeOnMessage,
			handlers: {
				text: () => ({ text: "hello" }),
			},
			getPageState: () => PAGE,
		});

		expect(runtimeOnMessage.addListener).toHaveBeenCalledTimes(1);
		expect(listener).toBeTypeOf("function");

		const sendResponse = vi.fn();
		const handled = listener?.(
			toContentRpcRequest({
				id: "req-3",
				action: "text",
				params: {},
			}),
			{},
			sendResponse,
		);
		expect(handled).toBe(true);
		await Promise.resolve();
		await Promise.resolve();
		expect(sendResponse).toHaveBeenCalledWith({
			kind: "bproxy.content.response",
			id: "req-3",
			ok: true,
			data: { text: "hello" },
			page: PAGE,
		});
	});
});

describe("parseContentRpcResponse", () => {
	it("rejects mismatched response ids", () => {
		expect(
			parseContentRpcResponse(
				{
					kind: "bproxy.content.response",
					id: "other",
					ok: false,
					error: protocolError("mismatch"),
				},
				"expected",
			),
		).toEqual({ kind: "invalid", error: "content response id did not match request" });
	});
});
