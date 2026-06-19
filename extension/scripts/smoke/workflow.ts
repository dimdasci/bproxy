import { parseArgs } from "node:util";
import { expectOk, printJson, sendCommand, trimPnpmDoubleDash, waitForWsClient } from "./common.ts";

const { values } = parseArgs({
	args: trimPnpmDoubleDash(process.argv.slice(2)),
	allowPositionals: true,
	options: {
		home: { type: "string" },
		baseUrl: { type: "string" },
		openUrl: { type: "string" },
		navigateUrl: { type: "string" },
		searchSelector: { type: "string", default: "#search" },
		linkLimit: { type: "string", default: "10" },
		nick: { type: "string", default: "smoke1" },
		waitForWs: { type: "string", default: "30000" },
	},
});

const waitForWsMs = parsePositiveInt(values.waitForWs, "--waitForWs");
const linkLimit = parsePositiveInt(values.linkLimit, "--linkLimit");
const baseUrl = values.baseUrl ? normalizeBaseUrl(values.baseUrl) : undefined;
const openUrl = values.openUrl ?? buildUrl(baseUrl, "/search?q=bproxy+smoke");
const navigateUrl = values.navigateUrl ?? buildUrl(baseUrl, "/detail/alpha");
if (!openUrl || !navigateUrl) {
	throw new Error("Provide --baseUrl or both --openUrl and --navigateUrl.");
}

const baseSmokeOptions = { home: values.home, nick: values.nick };
const wsStatus = await waitForWsClient({ ...baseSmokeOptions, timeoutMs: waitForWsMs });

const open = await sendCommand("tab.open", { url: openUrl }, baseSmokeOptions);
const openBody = expectOk(open, "tab.open");
if (!/^[a-z2-7]{6}$/.test(openBody.data.session)) {
	throw new Error(`tab.open returned invalid session id: ${openBody.data.session}`);
}
const expectedFirstTab = "t1" as typeof openBody.data.tab;
if (openBody.data.tab !== expectedFirstTab) {
	throw new Error(`Expected first logical tab handle to be t1, got ${openBody.data.tab}`);
}
if (!openBody.data.bound) {
	throw new Error("tab.open must bind the opened tab by default");
}

const session = openBody.data.session;
const baseOptions = { ...baseSmokeOptions, session };

const text = await sendCommand("text", { selector: "main" }, baseOptions);
const textBody = expectOk(text, "text(main)");
if (!textBody.data.text.includes("bproxy phase 5 smoke fixture")) {
	throw new Error(`Unexpected search-page text result: ${textBody.data.text}`);
}

const links = await sendCommand(
	"links",
	{ selector: values.searchSelector, visibleOnly: true, limit: linkLimit },
	baseOptions,
);
const linksBody = expectOk(links, "links");
if (linksBody.data.links.length < 2) {
	throw new Error(`Expected at least 2 visible links, got ${linksBody.data.links.length}`);
}
if (
	!linksBody.data.links.every(
		(link) => link.href.startsWith("http://") || link.href.startsWith("https://"),
	)
) {
	throw new Error("links must return absolute href values");
}
if (!linksBody.data.links.some((link) => link.text.includes("Alpha result"))) {
	throw new Error("links output did not include the visible Alpha result");
}
if (linksBody.data.links.some((link) => link.href.includes("/detail/hidden"))) {
	throw new Error("links --visible-only unexpectedly included the hidden result");
}

const navigate = await sendCommand("navigate", { url: navigateUrl }, baseOptions);
const navigateBody = expectOk(navigate, "navigate");
if (navigateBody.data.url !== navigateUrl) {
	throw new Error(`navigate returned unexpected url: ${navigateBody.data.url}`);
}

const detailText = await sendCommand("text", { selector: "main" }, baseOptions);
const detailTextBody = expectOk(detailText, "text(main) after navigate");
if (!detailTextBody.data.text.includes("Detail page for alpha")) {
	throw new Error(`Unexpected detail-page text result: ${detailTextBody.data.text}`);
}

const close = await sendCommand("session.close", {}, baseOptions);
const closeBody = expectOk(close, "session.close");
if (closeBody.data.closedTabs < 1) {
	throw new Error(`session.close returned closedTabs=${closeBody.data.closedTabs}`);
}

printJson({
	workflow: "phase5-local-smoke",
	fixture: {
		baseUrl,
		openUrl,
		navigateUrl,
		searchSelector: values.searchSelector,
	},
	wsClients: wsStatus.data.wsClients.length,
	transcript: [
		{
			command: `tab open --url ${openUrl}`,
			requestId: open.request.id,
			response: openBody.data,
		},
		{
			command: `text -s ${session} --selector main`,
			requestId: text.request.id,
			response: textBody.data,
		},
		{
			command: `links -s ${session} --selector ${values.searchSelector} --visible-only --limit ${linkLimit}`,
			requestId: links.request.id,
			response: linksBody.data,
		},
		{
			command: `navigate -s ${session} --url ${navigateUrl}`,
			requestId: navigate.request.id,
			response: navigateBody.data,
		},
		{
			command: `text -s ${session} --selector main`,
			requestId: detailText.request.id,
			response: detailTextBody.data,
		},
		{
			command: `session close -s ${session}`,
			requestId: close.request.id,
			response: closeBody.data,
		},
	],
});

function parsePositiveInt(value: string, flag: string): number {
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`${flag} must be a positive integer, got: ${value}`);
	}
	return parsed;
}

function normalizeBaseUrl(value: string): string {
	return new URL(value).toString().replace(/\/$/, "");
}

function buildUrl(baseUrl: string | undefined, path: string): string | undefined {
	if (!baseUrl) return undefined;
	return new URL(path, `${baseUrl}/`).toString();
}
