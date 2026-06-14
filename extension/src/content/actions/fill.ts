import type { ActionResult, BproxyError, FillMethod } from "@bproxy/shared";
import {
	applyDirectFill,
	applyPasteFill,
	assertIsolatedFillMethod,
	readEditableValue,
} from "../events";
import { nextIntervalMs, type PollingDeps, tabNotVisibleError } from "../polling";
import type { ContentRpcHandlers, ContentRpcRequest } from "../rpc";
import { resolveElementTarget } from "../targeting";

type FillActionName = Extract<keyof ContentRpcHandlers, "fill" | "fill-form">;
type FillHandlers = Required<Pick<ContentRpcHandlers, FillActionName>>;

type FillField = ContentRpcRequest<"fill-form">["params"]["fields"][number];

export interface FillActionDeps extends PollingDeps {
	document?: Document;
}

const FIELD_DELAY_MIN_MS = 500;
const FIELD_DELAY_MAX_MS = 2000;

export function createFillHandlers(deps: FillActionDeps = {}): FillHandlers {
	return {
		fill: (request) => handleFill(request, deps),
		"fill-form": (request) => handleFillForm(request, deps),
	};
}

export function handleFill(
	request: ContentRpcRequest<"fill">,
	deps: FillActionDeps = {},
): ActionResult["fill"] {
	assertDocumentVisible(deps.document);
	assertIsolatedFillMethod(request.params.method, request.params.world);

	const element = resolveElementTarget(request.params.target, { document: getDocument(deps) });
	const verifiedValue = performWrite(element, request.params.method, request.params.value);
	return {
		filled: verifiedValue === request.params.value,
		verifiedValue,
	};
}

export async function handleFillForm(
	request: ContentRpcRequest<"fill-form">,
	deps: FillActionDeps = {},
): Promise<ActionResult["fill-form"]> {
	assertDocumentVisible(deps.document);
	for (const field of request.params.fields) {
		assertIsolatedFillMethod(field.method, field.world);
	}

	const results: ActionResult["fill-form"]["results"] = [];
	for (const [index, field] of request.params.fields.entries()) {
		results.push(fillField(field, deps));
		if (index < request.params.fields.length - 1) {
			await sleep(getFieldDelayMs(deps), deps);
		}
	}

	return { results };
}

function fillField(
	field: FillField,
	deps: FillActionDeps,
): ActionResult["fill-form"]["results"][number] {
	try {
		const element = resolveElementTarget(field.target, { document: getDocument(deps) });
		const verifiedValue = performWrite(element, field.method, field.value);
		return {
			target: field.target,
			filled: verifiedValue === field.value,
			verifiedValue,
		};
	} catch (error) {
		if (!isRecoverableFieldError(error)) throw error;
		return {
			target: field.target,
			filled: false,
			verifiedValue: readValueIfPossible(error, field, deps),
		};
	}
}

function performWrite(element: Element, method: FillMethod, value: string): string {
	switch (method) {
		case "direct":
			return applyDirectFill(element, value);
		case "paste":
			return applyPasteFill(element, value);
		case "runtime-api":
			throw runtimeApiRejectedError();
	}
}

function isRecoverableFieldError(error: unknown): error is BproxyError {
	return (
		isBproxyError(error) &&
		(error.code === "ELEMENT_NOT_FOUND" || error.code === "ELEMENT_NOT_ACTIONABLE")
	);
}

function readValueIfPossible(error: BproxyError, field: FillField, deps: FillActionDeps): string {
	if (error.code === "ELEMENT_NOT_FOUND") return "";
	try {
		const element = resolveElementTarget(field.target, { document: getDocument(deps) });
		const editableValue = readEditableValue(element);
		if (editableValue) return editableValue;
		const candidate = element as Element & { value?: unknown };
		if (typeof candidate.value === "string") return candidate.value;
		return element.textContent ?? "";
	} catch {
		return "";
	}
}

function assertDocumentVisible(doc: Document | undefined): void {
	if (doc?.visibilityState === "hidden") throw tabNotVisibleError();
}

function getDocument(deps: FillActionDeps): Document {
	return deps.document ?? document;
}

function getFieldDelayMs(deps: FillActionDeps): number {
	const random =
		deps.random ?? (() => crypto.getRandomValues(new Uint32Array(1))[0]! / 0x100000000);
	return nextIntervalMs(FIELD_DELAY_MIN_MS, FIELD_DELAY_MAX_MS, random);
}

async function sleep(ms: number, deps: FillActionDeps): Promise<void> {
	const sleeper =
		deps.sleep ?? ((delay: number) => new Promise<void>((resolve) => setTimeout(resolve, delay)));
	await sleeper(ms);
}

function isBproxyError(value: unknown): value is BproxyError {
	return (
		typeof value === "object" &&
		value !== null &&
		"code" in value &&
		typeof value.code === "string" &&
		"message" in value &&
		typeof value.message === "string"
	);
}

function runtimeApiRejectedError(): BproxyError {
	return {
		code: "SCRIPT_ERROR",
		category: "execution",
		retry: "conditional",
		message: "fill method runtime-api must be executed in MAIN world by the background worker",
	};
}
