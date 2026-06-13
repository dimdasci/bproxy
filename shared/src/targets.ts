/** Shadow-DOM route representation (ADR-014) */
export interface ElementRoute {
	hosts: Array<{ selector: string; index?: number }>;
	target: string;
}

/** Target must be exactly one strategy: light-DOM selector or shadow route */
export type ElementTarget =
	| { selector: string; route?: never }
	| { selector?: never; route: ElementRoute };
