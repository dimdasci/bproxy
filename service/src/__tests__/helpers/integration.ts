/**
 * Shared integration test utilities for service route tests.
 *
 * Extracted to eliminate Sonar-flagged duplication (connectClient, waitUntil)
 * across action-contract, round-trip, observability, workflows, etc.
 */
import WebSocket from "ws";

export function connectWsClient(port: number, extensionToken: string): Promise<WebSocket> {
	const auth = Buffer.from(extensionToken).toString("base64url");
	const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, ["bproxy.v1", `auth.${auth}`], {
		headers: { Origin: "chrome-extension://test" },
	});
	return new Promise((resolve, reject) => {
		ws.once("open", () => resolve(ws));
		ws.once("error", reject);
	});
}

export function waitUntil(fn: () => boolean, timeoutMs = 2000): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now();
		const tick = () => {
			if (fn()) return resolve();
			if (Date.now() - start > timeoutMs) return reject(new Error("waitUntil timeout"));
			setTimeout(tick, 10);
		};
		tick();
	});
}
