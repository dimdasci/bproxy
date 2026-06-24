import { describe, expect, it, vi } from "vitest";
import type { BadgeState } from "../ws-client";

// The background entrypoint registers a chrome.runtime.onMessage listener
// for popup status queries. This test verifies the handler contract in
// isolation — the same message-matching logic and response shape used by
// the entrypoint, exercised without booting the full WXT defineBackground.

type MessageHandler = (
	msg: unknown,
	sender: unknown,
	sendResponse: (response: unknown) => void,
) => boolean | undefined;

/**
 * Factory matching the entrypoint's inline handler. Takes a state getter
 * (in production, `client.getState()`).
 */
function createStatusQueryHandler(getState: () => BadgeState): MessageHandler {
	return (msg, _sender, sendResponse) => {
		if (
			typeof msg === "object" &&
			msg !== null &&
			(msg as Record<string, unknown>)["type"] === "status.query"
		) {
			sendResponse({ type: "status.response", state: getState() });
			return true;
		}
		return undefined;
	};
}

describe("status.query message handler", () => {
	it("responds with current badge state for status.query messages", () => {
		const handler = createStatusQueryHandler(() => "connected");
		const sendResponse = vi.fn();

		const result = handler({ type: "status.query" }, {}, sendResponse);

		expect(result).toBe(true);
		expect(sendResponse).toHaveBeenCalledWith({
			type: "status.response",
			state: "connected",
		});
	});

	it("returns the live state at call time", () => {
		let state: BadgeState = "disconnected";
		const handler = createStatusQueryHandler(() => state);
		const sendResponse = vi.fn();

		handler({ type: "status.query" }, {}, sendResponse);
		expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ state: "disconnected" }));

		sendResponse.mockClear();
		state = "connecting";
		handler({ type: "status.query" }, {}, sendResponse);
		expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ state: "connecting" }));
	});

	it("ignores non-status.query messages and does not call sendResponse", () => {
		const handler = createStatusQueryHandler(() => "connected");
		const sendResponse = vi.fn();

		expect(handler({ type: "pair.complete" }, {}, sendResponse)).toBeUndefined();
		expect(handler("not an object", {}, sendResponse)).toBeUndefined();
		expect(handler(null, {}, sendResponse)).toBeUndefined();
		expect(handler(42, {}, sendResponse)).toBeUndefined();
		expect(handler({ type: "other" }, {}, sendResponse)).toBeUndefined();
		expect(sendResponse).not.toHaveBeenCalled();
	});

	it("handles all badge states", () => {
		const states: BadgeState[] = ["connected", "disconnected", "connecting", "error"];
		for (const expected of states) {
			const handler = createStatusQueryHandler(() => expected);
			const sendResponse = vi.fn();
			handler({ type: "status.query" }, {}, sendResponse);
			expect(sendResponse).toHaveBeenCalledWith({
				type: "status.response",
				state: expected,
			});
		}
	});
});
