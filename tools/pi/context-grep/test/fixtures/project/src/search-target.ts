export interface SearchShape {
	id: string;
}

export type SearchResult = {
	ok: boolean;
};

export class SearchRunner {
	run(query: string) {
		const nested = () => {
			return query.toUpperCase();
		};
		return nested();
	}
}

export function helper(value: string) {
	return value.trim();
}

export const handleThing = async (value: string) => {
	return helper(value);
};
