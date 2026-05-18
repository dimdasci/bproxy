import { describe, expect, it } from "vitest";
import { evaluateAuth } from "../auth";

const port = 9615;
const daemonToken = "abc123";
const extensionToken = "deadbeef";

interface H {
	[k: string]: string | undefined;
}

function call(url: string, method: "GET" | "POST", headers: H) {
	return evaluateAuth({
		url,
		method,
		headers,
		port,
		daemonToken,
		extensionToken,
		validPairingCodes: new Set(["GOOD-CODE"]),
		bodyPairingCode: headers["x-test-body-code"],
	});
}

describe("evaluateAuth — four-layer gate", () => {
	it("rejects when Host header is missing", () => {
		expect(call("/", "POST", { authorization: `Bearer ${daemonToken}` }).ok).toBe(false);
	});

	it("rejects when Host header points elsewhere", () => {
		expect(
			call("/", "POST", { host: "example.com:9615", authorization: `Bearer ${daemonToken}` }).ok,
		).toBe(false);
	});

	it("rejects when Sec-Fetch-Site is cross-site", () => {
		expect(
			call("/", "POST", {
				host: `127.0.0.1:${port}`,
				"sec-fetch-site": "cross-site",
				authorization: `Bearer ${daemonToken}`,
			}).ok,
		).toBe(false);
	});

	it("accepts POST / with valid Host + bearer token", () => {
		expect(
			call("/", "POST", {
				host: `127.0.0.1:${port}`,
				authorization: `Bearer ${daemonToken}`,
			}).ok,
		).toBe(true);
	});

	it("rejects POST / with wrong bearer", () => {
		expect(call("/", "POST", { host: `127.0.0.1:${port}`, authorization: "Bearer nope" }).ok).toBe(
			false,
		);
	});

	it("accepts POST /pair/claim with valid pairing code, no bearer required", () => {
		expect(
			call("/pair/claim", "POST", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"x-test-body-code": "GOOD-CODE",
			}).ok,
		).toBe(true);
	});

	it("rejects POST /pair/claim with unknown pairing code", () => {
		expect(
			call("/pair/claim", "POST", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"x-test-body-code": "BAD",
			}).ok,
		).toBe(false);
	});

	it("accepts GET /ws when Sec-WebSocket-Protocol carries the extension token", () => {
		const auth = Buffer.from(extensionToken).toString("base64url");
		expect(
			call("/ws", "GET", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"sec-websocket-protocol": `bproxy.v1, auth.${auth}`,
			}).ok,
		).toBe(true);
	});

	it("rejects GET /ws with wrong extension token", () => {
		const auth = Buffer.from("wrong").toString("base64url");
		expect(
			call("/ws", "GET", {
				host: `127.0.0.1:${port}`,
				origin: "chrome-extension://abc",
				"sec-websocket-protocol": `bproxy.v1, auth.${auth}`,
			}).ok,
		).toBe(false);
	});
});
