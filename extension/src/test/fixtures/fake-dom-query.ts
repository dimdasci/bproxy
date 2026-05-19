export interface QueryRootLike {
	children: QueryElementLike[];
}

export interface QueryElementLike extends QueryRootLike {
	tagName: string;
	id: string;
	parentElement: QueryElementLike | null;
	getAttribute(name: string): string | null;
	hasAttribute(name: string): boolean;
	getRootNode(): QueryRootLike;
}

type ParsedSegment = {
	tag?: string;
	id?: string;
	classes: string[];
	attrs: Array<{ name: string; value?: string }>;
	nthOfType?: number;
};

export function queryWithin(root: QueryRootLike, selector: string): QueryElementLike[] {
	const matches: QueryElementLike[] = [];
	const seen = new Set<QueryElementLike>();
	for (const group of splitSelectorGroups(selector)) {
		for (const candidate of descendantsOf(root)) {
			if (!matchesGroup(candidate, group) || seen.has(candidate)) continue;
			seen.add(candidate);
			matches.push(candidate);
		}
	}
	return matches;
}

export function matchesAnySelector(element: QueryElementLike, selector: string): boolean {
	return splitSelectorGroups(selector).some((group) => matchesGroup(element, group));
}

function* descendantsOf(root: QueryRootLike): Iterable<QueryElementLike> {
	const stack = [...root.children].reverse();
	while (stack.length > 0) {
		const current = stack.pop() as QueryElementLike;
		yield current;
		for (const child of [...current.children].reverse()) stack.push(child);
	}
}

function matchesGroup(element: QueryElementLike, selector: string): boolean {
	const segments = selector
		.split(">")
		.map((segment) => segment.trim())
		.filter(Boolean)
		.map(parseSegment);
	if (segments.length === 0) return false;
	if (!matchesSegment(element, segments[segments.length - 1] as ParsedSegment)) return false;
	let current: QueryElementLike | null = element;
	for (let offset = segments.length - 2; offset >= 0; offset -= 1) {
		current = current?.parentElement ?? null;
		if (!current || !matchesSegment(current, segments[offset] as ParsedSegment)) return false;
	}
	return true;
}

function parseSegment(segment: string): ParsedSegment {
	let rest = segment.replace(/^:scope/, "").trim();
	const parsed: ParsedSegment = { classes: [], attrs: [] };
	const tagMatch = rest.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
	if (tagMatch) {
		parsed.tag = tagMatch[0].toLowerCase();
		rest = rest.slice(tagMatch[0].length);
	}
	while (rest.length > 0) {
		rest =
			consumeId(rest, parsed) ??
			consumeClass(rest, parsed) ??
			consumeAttr(rest, parsed) ??
			consumeNth(rest, parsed) ??
			unsupported(segment);
	}
	return parsed;
}

function consumeId(rest: string, parsed: ParsedSegment): string | undefined {
	const match = rest.match(/^#([a-zA-Z0-9_\-\\]+)/);
	if (!match) return undefined;
	parsed.id = unescapeCss(match[1] as string);
	return rest.slice(match[0].length);
}

function consumeClass(rest: string, parsed: ParsedSegment): string | undefined {
	const match = rest.match(/^\.([a-zA-Z0-9_\-]+)/);
	if (!match) return undefined;
	parsed.classes.push(match[1] as string);
	return rest.slice(match[0].length);
}

function consumeAttr(rest: string, parsed: ParsedSegment): string | undefined {
	const match = rest.match(/^\[([^=\]]+)(?:="((?:\\.|[^"])*)")?\]/);
	if (!match) return undefined;
	parsed.attrs.push({
		name: match[1] as string,
		value: match[2] !== undefined ? unescapeCss(match[2] as string) : undefined,
	});
	return rest.slice(match[0].length);
}

function consumeNth(rest: string, parsed: ParsedSegment): string | undefined {
	const match = rest.match(/^:nth-of-type\((\d+)\)/);
	if (!match) return undefined;
	parsed.nthOfType = Number.parseInt(match[1] as string, 10);
	return rest.slice(match[0].length);
}

function unsupported(segment: string): never {
	throw new Error(`Unsupported selector segment: ${segment}`);
}

function matchesSegment(element: QueryElementLike, parsed: ParsedSegment): boolean {
	return (
		matchesTag(element, parsed) &&
		matchesId(element, parsed) &&
		matchesClasses(element, parsed.classes) &&
		matchesAttributes(element, parsed.attrs) &&
		matchesNth(element, parsed.nthOfType)
	);
}

function matchesTag(element: QueryElementLike, parsed: ParsedSegment): boolean {
	return !parsed.tag || element.tagName.toLowerCase() === parsed.tag;
}

function matchesId(element: QueryElementLike, parsed: ParsedSegment): boolean {
	return !parsed.id || element.id === parsed.id;
}

function matchesClasses(element: QueryElementLike, classes: string[]): boolean {
	if (classes.length === 0) return true;
	const current = new Set((element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
	return classes.every((name) => current.has(name));
}

function matchesAttributes(
	element: QueryElementLike,
	attrs: Array<{ name: string; value?: string }>,
): boolean {
	return attrs.every((attr) => {
		if (!element.hasAttribute(attr.name)) return false;
		return attr.value === undefined || element.getAttribute(attr.name) === attr.value;
	});
}

function matchesNth(element: QueryElementLike, nthOfType: number | undefined): boolean {
	return nthOfType === undefined || nthOfType === indexWithinType(element);
}

function indexWithinType(element: QueryElementLike): number {
	const parent = element.parentElement;
	const siblings = parent ? parent.children : element.getRootNode().children;
	const sameTag = siblings.filter((candidate) => candidate.tagName === element.tagName);
	return sameTag.indexOf(element) + 1;
}

function splitSelectorGroups(selector: string): string[] {
	return selector
		.split(",")
		.map((part) => part.trim())
		.filter(Boolean);
}

function unescapeCss(value: string): string {
	return value.replace(/\\(.)/g, "$1");
}
