console.log("[plan-a] attempting chrome.runtime.sendMessage from Node...");
console.log("[plan-a] typeof chrome:", typeof chrome);

try {
	// eslint-disable-next-line no-undef
	chrome.runtime.sendMessage("fake-extension-id", { type: "pair.bootstrap" });
	console.log("[plan-a] call succeeded — surprising. Investigate further.");
} catch (err) {
	console.log("[plan-a] call failed:", err.constructor.name, err.message);
}

console.log(
	"[plan-a] verdict: chrome.* APIs are not available in Node — confirmed gap in ADR-011.",
);
