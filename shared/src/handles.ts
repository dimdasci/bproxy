import type { ElementTarget } from "./targets";

declare const elementHandleBrand: unique symbol;

export const HANDLE_PATTERN = /^(el|ln)\d+$/;

export type ElementHandle = string & { readonly [elementHandleBrand]: "ElementHandle" };

export interface ElementHandleRef {
	handle: ElementHandle;
}

export type ClientElementTarget = ElementTarget | ElementHandleRef;
