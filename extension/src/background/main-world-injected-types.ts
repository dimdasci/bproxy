export type RuntimeApiPlan = {
	locate: string[];
	write:
		| {
				kind: "method";
				name: string;
				tail?: unknown[];
		  }
		| {
				kind: 1;
		  };
	read?:
		| {
				kind: "method";
				name: string;
		  }
		| {
				kind: 1;
		  };
	trimTrailingNewline?: boolean;
};

export type PageSnapshot = {
	url: string;
	title: string;
	readyState: "loading" | "interactive" | "complete";
	busyHint: boolean;
};
