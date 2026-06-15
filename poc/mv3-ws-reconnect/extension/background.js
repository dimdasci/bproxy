const TOKEN = "test-token-deadbeef";
const WS_URL = "ws://127.0.0.1:9090/ws";

let socket = null;
let reconnectTimer = null;
let attempt = 0;

function base64url(input) {
	return btoa(input).replaceAll("+", "-").replaceAll("/", "_").split("=")[0];
}

function connect() {
	if (socket && socket.readyState !== WebSocket.CLOSED) return;
	console.log("[poc] connecting to", WS_URL);
	const protocols = ["bproxy.v1", `auth.${base64url(TOKEN)}`];
	socket = new WebSocket(WS_URL, protocols);

	socket.addEventListener("open", () => {
		console.log("[poc] open, negotiated protocol:", socket.protocol);
		attempt = 0;
		socket.send(
			JSON.stringify({
				protocol_version: 1,
				id: crypto.randomUUID(),
				action: "navigate",
				params: { url: "https://example.com" },
				session: "default",
				deadline: Date.now() + 30000,
				destructive: true,
			}),
		);
	});

	socket.addEventListener("message", (event) => {
		console.log("[poc] received:", event.data);
	});

	socket.addEventListener("close", (event) => {
		console.log("[poc] close:", event.code, event.reason || "(no reason)");
		scheduleReconnect();
	});

	socket.addEventListener("error", () => {
		console.warn("[poc] error");
	});
}

function scheduleReconnect() {
	attempt += 1;
	const delay = Math.min(30_000, 1_000 * 2 ** attempt);
	console.log(`[poc] reconnecting in ${delay}ms (attempt ${attempt})`);
	if (reconnectTimer) clearTimeout(reconnectTimer);
	reconnectTimer = setTimeout(connect, delay);
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);

chrome.alarms.create("keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name === "keepalive" && (!socket || socket.readyState !== WebSocket.OPEN)) {
		connect();
	}
});

connect();
