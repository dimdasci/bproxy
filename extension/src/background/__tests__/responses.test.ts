import type { BproxyError, BproxyForwardedRequest, PageState } from "@bproxy/shared";
import { describe, expect, it } from "vitest";
import { errorResponse, successResponse } from "../responses";

function req(id: string): BproxyForwardedRequest<"text"> {
	return {
		protocol_version: 1,
		id,
		action: "text",
		params: {},
		session: "default",
		deadline: 0,
		destructive: false,
		target: { tabId: 17 },
	};
}

const PAGE: PageState = {
	url: "https://example.com",
	title: "Example",
	state: "ready",
	busy: false,
};

describe("response builders", () => {
	it("successResponse copies id, sets protocol_version=1, ok=true, replay=false by default", () => {
		const res = successResponse({
			request: req("abc"),
			data: { text: "hello" },
			page: PAGE,
		});

		expect(res).toEqual({
			protocol_version: 1,
			id: "abc",
			ok: true,
			data: { text: "hello" },
			page: PAGE,
			replay: false,
		});
	});

	it("successResponse stamps replay:true when requested", () => {
		const res = successResponse({
			request: req("abc"),
			data: { text: "hello" },
			page: PAGE,
			replay: true,
		});
		expect(res.replay).toBe(true);
	});

	it("successResponse always includes the page state", () => {
		const res = successResponse({ request: req("abc"), data: { text: "" }, page: PAGE });
		expect(res.page).toBe(PAGE);
	});

	it("errorResponse copies id, sets protocol_version=1, ok=false, and the error payload", () => {
		const err: BproxyError = {
			code: "ELEMENT_NOT_FOUND",
			category: "target",
			retry: "never",
			message: "selector matched nothing",
		};
		const res = errorResponse({ request: req("xyz"), error: err });

		expect(res).toEqual({
			protocol_version: 1,
			id: "xyz",
			ok: false,
			error: err,
		});
	});

	it("errorResponse does not include page", () => {
		const err: BproxyError = {
			code: "TIMEOUT",
			category: "transport",
			retry: "conditional",
			message: "x",
		};
		const res = errorResponse({ request: req("abc"), error: err });
		expect((res as { page?: PageState }).page).toBeUndefined();
	});
});
