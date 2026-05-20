import { parseArgs } from "node:util";
import {
	expectOk,
	printJson,
	sendCommand,
	summarizeElements,
	trimPnpmDoubleDash,
	waitForWsClient,
} from "./common.ts";

const tabIdHelp = [
	"Missing --tabId.",
	"Discover it from the extension service-worker console:",
	"chrome.tabs.query({ active: true, lastFocusedWindow: true }).then((tabs) => tabs.map(({ id, url, title }) => ({ id, url, title })))",
] as const;

const { values } = parseArgs({
	args: trimPnpmDoubleDash(process.argv.slice(2)),
	allowPositionals: true,
	options: {
		home: { type: "string" },
		session: { type: "string", default: "smoke" },
		tabId: { type: "string" },
		waitForWs: { type: "string", default: "30000" },
	},
});

if (!values.tabId) {
	process.stderr.write(`${tabIdHelp.join("\n")}\n`);
	process.exit(2);
}

const tabId = Number.parseInt(values.tabId, 10);
if (!Number.isInteger(tabId) || tabId < 0) {
	throw new Error(`--tabId must be a non-negative integer, got: ${values.tabId}`);
}

const waitForWsMs = Number.parseInt(values.waitForWs, 10);
if (!Number.isFinite(waitForWsMs) || waitForWsMs <= 0) {
	throw new Error(`--waitForWs must be a positive integer, got: ${values.waitForWs}`);
}

const session = values.session;
const baseOptions = { home: values.home, session };
const wsStatus = await waitForWsClient({ ...baseOptions, timeoutMs: waitForWsMs });

const bind = await sendCommand("session.bind", { tabId }, baseOptions);
expectOk(bind, "session.bind");

const wait = await sendCommand(
	"wait",
	{ strategy: "selector", target: "#smoke-text", timeout: 5000 },
	baseOptions,
);
const waitBody = expectOk(wait, "wait");

const text = await sendCommand("text", { selector: "#smoke-text" }, baseOptions);
const textBody = expectOk(text, "text");
if (!textBody.data.text.includes("bproxy extension smoke fixture")) {
	throw new Error(`Unexpected smoke text result: ${textBody.data.text}`);
}

const elements = await sendCommand("elements", { form: true }, baseOptions);
const elementsBody = expectOk(elements, "elements");
const nameInput = elementsBody.data.elements.find((element) =>
	"selector" in element ? element.selector === "#smoke-name" : false,
);
if (!nameInput) {
	throw new Error("Expected elements(form:true) to include #smoke-name");
}

const fill = await sendCommand(
	"fill",
	{
		target: { selector: "#smoke-name" },
		value: "Ada Lovelace",
		method: "paste",
		world: "isolated",
	},
	baseOptions,
);
const fillBody = expectOk(fill, "fill");
if (fillBody.data.verifiedValue !== "Ada Lovelace") {
	throw new Error(`Unexpected fill verifiedValue: ${fillBody.data.verifiedValue}`);
}

const echo = await sendCommand("text", { selector: "#smoke-output" }, baseOptions);
const echoBody = expectOk(echo, "text(#smoke-output)");
if (!echoBody.data.text.includes("Ada Lovelace")) {
	throw new Error(`Paste echo did not update: ${echoBody.data.text}`);
}

const scroll = await sendCommand("scroll", { by: "1200px", untilStable: true }, baseOptions);
const scrollBody = expectOk(scroll, "scroll");
if (scrollBody.data.after <= scrollBody.data.before) {
	throw new Error(
		`Expected scroll position to increase, got before=${scrollBody.data.before}, after=${scrollBody.data.after}`,
	);
}

const debugLog = await sendCommand("debug.log", { id: fill.request.id, limit: 5 }, baseOptions);
const debugLogBody = expectOk(debugLog, "debug.log");
const debugEntry = debugLogBody.data.entries.find((entry) => entry.id === fill.request.id);
if (!debugEntry) {
	throw new Error(`debug.log did not include fill request id ${fill.request.id}`);
}

printJson({
	session,
	tabId,
	wsClients: wsStatus.data.wsClients.length,
	ids: {
		bind: bind.request.id,
		wait: wait.request.id,
		text: text.request.id,
		elements: elements.request.id,
		fill: fill.request.id,
		echo: echo.request.id,
		scroll: scroll.request.id,
		debugLog: debugLog.request.id,
	},
	results: {
		wait: waitBody.data,
		text: textBody.data,
		elements: summarizeElements(elementsBody.data.elements),
		fill: fillBody.data,
		echo: echoBody.data,
		scroll: scrollBody.data,
		debugEntry,
	},
});
