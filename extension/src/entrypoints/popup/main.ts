import { bootstrapItem } from "../../background/storage";
import { type PairingErrorCode, type PairingResult, runPairing } from "./pairing";

// Thin DOM wiring for the popup. Real flow logic lives in small helpers:
//
//   - `pairing.ts` handles the claim/bootstrap flow.
//
// This file only binds DOM events, calls that helper with production
// dependencies, and renders status text. The popup never speaks to the page
// DOM and never injects MAIN-world code.

const STATUS_FRIENDLY: Record<PairingErrorCode, string> = {
	PAIRING_CODE_INVALID: "Code not recognized. Re-issue a code in the daemon and try again.",
	PAIRING_CODE_EXPIRED: "Code expired. Re-issue a code in the daemon and try again.",
	PAIRING_CODE_CONSUMED: "Code was already claimed. Issue a fresh code in the daemon.",
	INVALID_PAYLOAD_SHAPE: "Daemon returned an unexpected response.",
	INVALID_WS_URL: "Daemon WebSocket URL is not loopback — refusing to pair.",
	UNSUPPORTED_PROTOCOL_VERSION: "Daemon protocol version is unsupported by this extension.",
	BOOTSTRAP_EXPIRED: "Daemon bootstrap is already expired. Re-issue a code.",
	MISSING_NONCE: "Daemon response missing nonce — refusing to pair.",
	PAIR_TRANSPORT_ERROR: "Could not reach the daemon at http://127.0.0.1:9615. Is it running?",
	PAIR_NOTIFY_FAILED: "Paired, but failed to wake the background worker. Try reopening the popup.",
};

function $<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`#${id} not found in popup DOM`);
	return el as T;
}

function setStatus(state: "idle" | "pending" | "success" | "error", text: string): void {
	const status = $<HTMLDivElement>("status");
	status.dataset["state"] = state;
	status.textContent = text;
}

function renderResult(result: PairingResult): void {
	if (result.ok) {
		setStatus("success", "Paired. You can close this popup.");
		return;
	}
	const friendly = STATUS_FRIENDLY[result.code];
	const detail = result.message ? ` (${result.message})` : "";
	setStatus("error", `${friendly} [${result.code}]${detail}`);
}

async function onSubmit(ev: SubmitEvent): Promise<void> {
	ev.preventDefault();
	const form = ev.target as HTMLFormElement;
	const input = form.elements.namedItem("code") as HTMLInputElement | null;
	const code = input?.value.trim() ?? "";
	if (!code) {
		setStatus("error", "Enter a pairing code.");
		return;
	}

	const submit = $<HTMLButtonElement>("submit");
	submit.disabled = true;
	setStatus("pending", "Pairing…");

	try {
		const result = await runPairing(
			{ code },
			{
				fetch: globalThis.fetch.bind(globalThis),
				storage: bootstrapItem,
				sendMessage: (msg) => chrome.runtime.sendMessage(msg),
				now: () => Date.now(),
			},
		);
		renderResult(result);
	} finally {
		submit.disabled = false;
	}
}

document.addEventListener("DOMContentLoaded", () => {
	$<HTMLFormElement>("pair-form").addEventListener("submit", (ev) => {
		void onSubmit(ev as SubmitEvent);
	});
	setStatus("idle", "Enter the one-time code issued by the daemon.");
});
