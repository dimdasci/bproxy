import { parseArgs } from "node:util";
import type { Action, ActionParams } from "@bproxy/shared";
import { parseJsonObject, printJson, sendCommand, trimPnpmDoubleDash } from "./common.ts";

const usageLines = [
	"usage: smoke:command [--home <dir>] [--nick <nick>] [--session <id>] [--id <request-id>] [--timeout <ms>] [--destructive] [--raw] <action> [params-json]",
	"example: smoke:command --home ./.tmp/bproxy-smoke-demo debug.status",
	'example: smoke:command --home ./.tmp/bproxy-smoke-demo --session m4q7z2 text \'{"selector":"main"}\'',
] as const;

const { values, positionals } = parseArgs({
	args: trimPnpmDoubleDash(process.argv.slice(2)),
	allowPositionals: true,
	options: {
		home: { type: "string" },
		nick: { type: "string", default: "smoke1" },
		session: { type: "string" },
		id: { type: "string" },
		timeout: { type: "string", default: "30000" },
		destructive: { type: "boolean" },
		raw: { type: "boolean", default: false },
	},
});

const [actionInput, paramsInput] = positionals;
if (!actionInput || positionals.length > 2) {
	usage(2);
}

const timeoutMs = Number.parseInt(values.timeout, 10);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
	throw new Error(`--timeout must be a positive integer, got: ${values.timeout}`);
}

const action = actionInput as Action;
const params = (paramsInput ? parseJsonObject(paramsInput, "params") : {}) as ActionParams[Action];
const result = await sendCommand(action, params, {
	home: values.home,
	nick: values.nick,
	session: values.session,
	id: values.id,
	timeoutMs,
	destructive: values.destructive,
});

printJson(values.raw ? result.body : { request: result.request, response: result.body });
process.exit(result.body.ok ? 0 : 1);

function usage(code: number): never {
	process.stderr.write(`${usageLines.join("\n")}\n`);
	process.exit(code);
}
