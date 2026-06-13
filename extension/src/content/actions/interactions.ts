import type { ActionResult } from "@bproxy/shared";
import { assertInteractableElement, clickElement, focusElement, hoverElement } from "../events";
import {
	type PollingDeps,
	pollUntilStable,
	subtreeSignature,
	tabNotVisibleError,
} from "../polling";
import type { ContentRpcHandlers, ContentRpcRequest } from "../rpc";
import { resolveElementTarget } from "../targeting";

type InteractionActionName = Extract<keyof ContentRpcHandlers, "click" | "hover">;
type InteractionHandlers = Required<Pick<ContentRpcHandlers, InteractionActionName>>;

export interface InteractionActionDeps extends PollingDeps {
	document?: Document;
}

const SETTLE_TIMEOUT_MS = 1200;

export function createInteractionHandlers(deps: InteractionActionDeps = {}): InteractionHandlers {
	return {
		click: (request) => handleClick(request, deps),
		hover: (request) => handleHover(request, deps),
	};
}

export async function handleClick(
	request: ContentRpcRequest<"click">,
	deps: InteractionActionDeps = {},
): Promise<ActionResult["click"]> {
	const doc = getDocument(deps);
	assertDocumentVisible(doc);

	const element = resolveElementTarget(request.params.target, { document: doc });
	assertInteractableElement(element);
	focusElement(element);
	clickElement(element);

	const settled = await waitForSettle(doc, deps);
	return {
		clicked: true,
		disappeared: !isElementConnected(element),
		stable: settled.stable,
	};
}

export async function handleHover(
	request: ContentRpcRequest<"hover">,
	deps: InteractionActionDeps = {},
): Promise<ActionResult["hover"]> {
	const doc = getDocument(deps);
	assertDocumentVisible(doc);

	const element = resolveElementTarget(request.params.target, { document: doc });
	assertInteractableElement(element);
	hoverElement(element);

	const settled = await waitForSettle(doc, deps);
	return {
		hovered: true,
		stable: settled.stable,
		elapsed: settled.elapsed,
	};
}

async function waitForSettle(document_: Document, deps: InteractionActionDeps) {
	return await pollUntilStable(
		{
			read: () => subtreeSignature(document_.body ?? document_.documentElement),
			timeoutMs: SETTLE_TIMEOUT_MS,
		},
		pollingDeps(deps),
	);
}

function assertDocumentVisible(doc: Document): void {
	if (doc.visibilityState === "hidden") throw tabNotVisibleError();
}

function isElementConnected(element: Element): boolean {
	const candidate = element as Element & { isConnected?: boolean };
	if (typeof candidate.isConnected === "boolean") return candidate.isConnected;
	return true;
}

function getDocument(deps: InteractionActionDeps): Document {
	return deps.document ?? document;
}

function pollingDeps(deps: InteractionActionDeps): PollingDeps {
	return {
		document: deps.document,
		now: deps.now,
		random: deps.random,
		sleep: deps.sleep,
	};
}
