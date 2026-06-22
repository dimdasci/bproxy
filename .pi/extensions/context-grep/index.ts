import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBashToolResult, isGrepToolResult } from "@earendil-works/pi-coding-agent";
import { enrichSearchToolResult } from "../../../tools/pi/context-grep/src/index.mjs";

export default function contextGrep(pi: ExtensionAPI) {
	const sessionState = {
		availability: "unknown" as "unknown" | "ready" | "unavailable",
		warnedUnavailable: false,
	};

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;

		const onAstGrepUnavailable = () => {
			if (sessionState.warnedUnavailable || !ctx.hasUI) return;
			sessionState.warnedUnavailable = true;
			ctx.ui.notify(
				"context-grep: ast-grep unavailable; leaving raw search output unchanged",
				"warning",
			);
		};

		if (isGrepToolResult(event)) {
			const content = await enrichSearchToolResult({
				toolName: "grep",
				content: event.content,
				cwd: ctx.cwd,
				inputPath: event.input.path,
				signal: ctx.signal,
				sessionState,
				onAstGrepUnavailable,
			});
			return content ? { content } : undefined;
		}

		if (isBashToolResult(event)) {
			const content = await enrichSearchToolResult({
				toolName: "bash",
				content: event.content,
				cwd: ctx.cwd,
				command: event.input.command,
				signal: ctx.signal,
				sessionState,
				onAstGrepUnavailable,
			});
			return content ? { content } : undefined;
		}
	});
}
