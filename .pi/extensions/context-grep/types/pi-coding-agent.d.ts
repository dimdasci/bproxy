declare module "@earendil-works/pi-coding-agent" {
	export interface TextContent {
		type: "text";
		text: string;
	}

	export interface ImageContent {
		type: string;
		[key: string]: unknown;
	}

	export type ToolContent = TextContent | ImageContent;

	export interface BashToolResultEvent {
		toolName: "bash";
		content: ToolContent[];
		isError: boolean;
		input: {
			command: string;
			timeout?: number;
		};
	}

	export interface GrepToolResultEvent {
		toolName: "grep";
		content: ToolContent[];
		isError: boolean;
		input: {
			path?: string;
		};
	}

	export type ToolResultEvent = BashToolResultEvent | GrepToolResultEvent;

	export interface ExtensionContext {
		cwd: string;
		hasUI: boolean;
		signal?: AbortSignal;
		ui: {
			notify(message: string, level: "info" | "warning" | "error"): void;
		};
	}

	export interface ExtensionAPI {
		on(
			event: "tool_result",
			handler: (
				event: ToolResultEvent,
				ctx: ExtensionContext,
			) =>
				| Promise<{ content?: ToolContent[] } | undefined>
				| { content?: ToolContent[] }
				| undefined,
		): void;
	}

	export function isBashToolResult(event: ToolResultEvent): event is BashToolResultEvent;
	export function isGrepToolResult(event: ToolResultEvent): event is GrepToolResultEvent;
}
