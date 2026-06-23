import { PROTOCOL_VERSION, VERSION } from "@bproxy/shared";
import { bootstrapItem, type PairingBootstrap } from "../../background/storage";
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
	PAIRING_RATE_LIMITED: "Too many failed pairing attempts. Wait a minute and try again.",
	INVALID_PAYLOAD_SHAPE: "Daemon returned an unexpected response.",
	INVALID_WS_URL: "Daemon WebSocket URL is not loopback — refusing to pair.",
	UNSUPPORTED_PROTOCOL_VERSION: "Daemon protocol version is unsupported by this extension.",
	BOOTSTRAP_EXPIRED: "Daemon bootstrap is already expired. Re-issue a code.",
	MISSING_NONCE: "Daemon response missing nonce — refusing to pair.",
	PAIR_TRANSPORT_ERROR: "Could not reach the daemon at http://127.0.0.1:9615. Is it running?",
	PAIR_NOTIFY_FAILED: "Paired, but failed to wake the background worker. Try reopening the popup.",
};

export interface ConnectionStatusViewModel {
	text: string;
	tone: "muted" | "ok";
	submitLabel: string;
}

interface PopupInitDeps {
	storage: { getValue(): Promise<PairingBootstrap | null> };
	now: () => number;
}

function $<T extends HTMLElement>(id: string): T {
	const el = document.getElementById(id);
	if (!el) throw new Error(`#${id} not found in popup DOM`);
	return el as T;
}

function setStatus(state: "idle" | "pending" | "success" | "error", text: string): void {
	const status = $<HTMLOutputElement>("status");
	status.dataset["state"] = state;
	status.textContent = text;
}

export function formatVersionInfo(
	version: unknown = VERSION,
	protocolVersion: unknown = PROTOCOL_VERSION,
): string {
	const versionText = typeof version === "string" ? version : "";
	const protocolText =
		typeof protocolVersion === "number" || typeof protocolVersion === "string"
			? String(protocolVersion)
			: "";
	const extensionPart = `Extension ${versionText}`.trimEnd();
	const protocolPart = `Protocol ${protocolText}`.trimEnd();
	return `${extensionPart} · ${protocolPart}`;
}

export function getConnectionStatusViewModel(
	bootstrap: PairingBootstrap | null,
	now: number,
): ConnectionStatusViewModel {
	if (
		bootstrap &&
		typeof bootstrap.extensionToken === "string" &&
		bootstrap.extensionToken.length > 0 &&
		typeof bootstrap.expiresAt === "number" &&
		bootstrap.expiresAt > now
	) {
		return {
			text: "Paired with local daemon",
			tone: "ok",
			submitLabel: "Re-pair with new code",
		};
	}
	return {
		text: "Not paired",
		tone: "muted",
		submitLabel: "Pair extension",
	};
}

function renderVersionInfo(text: string): void {
	$<HTMLSpanElement>("version-info").textContent = text;
}

function createStatusDot(tone: ConnectionStatusViewModel["tone"]): SVGSVGElement {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("width", "8");
	svg.setAttribute("height", "8");
	svg.setAttribute("viewBox", "0 0 8 8");

	const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
	circle.setAttribute("cx", "4");
	circle.setAttribute("cy", "4");
	circle.setAttribute("r", "4");
	circle.setAttribute("fill", tone === "ok" ? "var(--c-ok)" : "var(--c-muted)");
	svg.append(circle);

	return svg;
}

function renderConnectionStatus(model: ConnectionStatusViewModel): void {
	const status = $<HTMLParagraphElement>("connection-status");
	status.replaceChildren(createStatusDot(model.tone), document.createTextNode(model.text));
	$<HTMLButtonElement>("submit").textContent = model.submitLabel;
}

function renderResult(result: PairingResult): void {
	if (result.ok) {
		renderConnectionStatus({
			text: "Paired with local daemon",
			tone: "ok",
			submitLabel: "Re-pair with new code",
		});
		setStatus("success", "Paired with local daemon. You can close this popup.");
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

export async function initializePopup(
	deps: PopupInitDeps = {
		storage: bootstrapItem,
		now: () => Date.now(),
	},
): Promise<void> {
	renderVersionInfo(formatVersionInfo());
	const bootstrap = await deps.storage.getValue().catch(() => null);
	renderConnectionStatus(getConnectionStatusViewModel(bootstrap, deps.now()));
	setStatus("idle", "");
}

if (typeof document !== "undefined") {
	document.addEventListener("DOMContentLoaded", () => {
		$<HTMLFormElement>("pair-form").addEventListener("submit", (ev) => {
			void onSubmit(ev);
		});
		void initializePopup();
	});
}
