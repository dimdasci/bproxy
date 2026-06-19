import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type {
	Action,
	ActionParams,
	BproxyRequest,
	BproxyResponse,
	BproxySuccessResponse,
	ElementInfo,
} from "@bproxy/shared";

const DESTRUCTIVE_ACTIONS = new Set<Action>([
	"navigate",
	"fill",
	"fill-form",
	"select",
	"scroll",
	"tab.open",
	"tab.close",
	"tab.pin",
	"tab.unpin",
	"session.close",
]);

export interface SendCommandOptions {
	home?: string;
	nick?: string;
	session?: string;
	id?: string;
	timeoutMs?: number;
	destructive?: boolean;
	intervalMs?: number;
}

export interface DaemonState {
	stateDir: string;
	port: number;
	token: string;
}

export interface CommandResult<A extends Action> {
	request: BproxyRequest<A>;
	response: Response;
	body: BproxyResponse<A>;
}

export interface SummarizedElement {
	selector?: string;
	tag: string;
	label?: string;
	placeholder?: string;
	type?: string;
}

export function trimPnpmDoubleDash(args: readonly string[]): string[] {
	if (args[0] !== "--") return [...args];
	return args.slice(1);
}

export function resolveStateDir(home?: string): string {
	return resolve(home ?? process.env["BPROXY_HOME"] ?? join(homedir(), ".bproxy"));
}

export function readDaemonState(home?: string): DaemonState {
	const stateDir = resolveStateDir(home);
	const port = Number.parseInt(readRequiredFile(join(stateDir, "port"), "daemon port").trim(), 10);
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Invalid daemon port in ${join(stateDir, "port")}`);
	}

	const tokenPath = join(stateDir, "token");
	assertOwnerMode600(tokenPath);
	const token = readRequiredFile(tokenPath, "daemon token").trim();
	if (token.length === 0) {
		throw new Error(`Daemon token file is empty: ${tokenPath}`);
	}

	return { stateDir, port, token };
}

export function buildRequest<A extends Action>(
	action: A,
	params: ActionParams[A],
	options: SendCommandOptions = {},
): BproxyRequest<A> {
	return {
		protocol_version: 1,
		id: options.id ?? randomUUID(),
		action,
		nick: (options.nick ?? "smoke1") as BproxyRequest<A>["nick"],
		params,
		session: (options.session ?? "") as BproxyRequest<A>["session"],
		deadline: Date.now() + (options.timeoutMs ?? 30_000),
		destructive: options.destructive ?? isDestructive(action),
	};
}

export async function sendCommand<A extends Action>(
	action: A,
	params: ActionParams[A],
	options: SendCommandOptions = {},
): Promise<CommandResult<A>> {
	const daemon = readDaemonState(options.home);
	const request = buildRequest(action, params, options);
	const response = await fetch(`http://127.0.0.1:${daemon.port}/`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${daemon.token}`,
		},
		body: JSON.stringify(request),
	});
	const raw = await response.text();
	return {
		request,
		response,
		body: parseResponse<A>(raw, response.status),
	};
}

export async function waitForWsClient(
	options: SendCommandOptions = {},
): Promise<BproxySuccessResponse<"debug.status">> {
	const timeoutMs = options.timeoutMs ?? 30_000;
	const intervalMs = options.intervalMs ?? 500;
	const deadline = Date.now() + timeoutMs;

	while (Date.now() <= deadline) {
		const result = await sendCommand("debug.status", {}, options);
		const body = expectOk(result, "debug.status");
		if (body.data.wsClients.length > 0) return body;
		await sleep(intervalMs);
	}

	throw new Error(
		`Timed out waiting for an extension WebSocket client. Pair the extension popup and retry (state dir: ${resolveStateDir(options.home)}).`,
	);
}

export function parseJsonObject(raw: string, label: string): Record<string, unknown> {
	const parsed = parseUnknownJson(raw, label);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${label} JSON must be an object`);
	}
	return parsed as Record<string, unknown>;
}

export function printJson(value: unknown, pretty = true): void {
	process.stdout.write(`${JSON.stringify(value, null, pretty ? "\t" : undefined)}\n`);
}

export function expectOk<A extends Action>(
	result: CommandResult<A>,
	label: string,
): BproxySuccessResponse<A> {
	if (result.body.ok) return result.body;
	throw new Error(`${label} failed: ${result.body.error.code}: ${result.body.error.message}`);
}

export function summarizeElements(elements: readonly ElementInfo[]): SummarizedElement[] {
	return elements.slice(0, 5).map((element) => ({
		selector: "selector" in element ? element.selector : undefined,
		tag: element.tag,
		label: element.label,
		placeholder: element.placeholder,
		type: element.type,
	}));
}

function parseResponse<A extends Action>(raw: string, status: number): BproxyResponse<A> {
	const parsed = parseUnknownJson(raw, `daemon response (${status})`);
	return parsed as BproxyResponse<A>;
}

function parseUnknownJson(raw: string, label: string): unknown {
	try {
		return JSON.parse(raw) as unknown;
	} catch (error) {
		throw new Error(
			`Invalid ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

function isDestructive(action: Action): boolean {
	return DESTRUCTIVE_ACTIONS.has(action);
}

function assertOwnerMode600(path: string): void {
	if (!existsSync(path)) {
		throw new Error(`Daemon token file not found: ${path}`);
	}
	const stats = statSync(path);
	const mode = stats.mode & 0o777;
	if (mode !== 0o600) {
		throw new Error(
			`Insecure daemon token permissions for ${path}: found ${mode.toString(8)}, expected 600`,
		);
	}
	const uid = process.getuid?.();
	if (uid !== undefined && stats.uid !== uid) {
		throw new Error(
			`Daemon token owner mismatch for ${path}: found uid ${stats.uid}, expected ${uid}`,
		);
	}
}

function readRequiredFile(path: string, label: string): string {
	if (!existsSync(path)) {
		throw new Error(`${label} file not found: ${path}`);
	}
	return readFileSync(path, "utf8");
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
