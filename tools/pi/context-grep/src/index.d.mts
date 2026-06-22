export interface TextContent {
	type: "text";
	text: string;
}

export interface OtherContent {
	type: string;
	[key: string]: unknown;
}

export type ToolContent = TextContent | OtherContent;

export interface EnrichSearchToolResultInput {
	toolName: "bash" | "grep";
	content: ToolContent[];
	cwd: string;
	command?: string;
	inputPath?: string;
	signal?: AbortSignal;
	sessionState: {
		availability: "unknown" | "ready" | "unavailable";
	};
	onAstGrepUnavailable?: () => void;
}

export function enrichSearchToolResult(
	input: EnrichSearchToolResultInput,
): Promise<ToolContent[] | null>;
