import type { BproxyError, BproxyRequest, BproxyResponse, PageState } from "@bproxy/shared";

function pageOk(): PageState {
	return { url: "", title: "", state: "ready", busy: false };
}

export function success(
	cmd: BproxyRequest,
	data: unknown,
	page: PageState = pageOk(),
): BproxyResponse {
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: true,
		data,
		page,
		replay: false,
	} as BproxyResponse;
}

export function failure(cmd: BproxyRequest, error: BproxyError): BproxyResponse {
	return {
		protocol_version: 1,
		id: cmd.id,
		ok: false,
		error,
	};
}
