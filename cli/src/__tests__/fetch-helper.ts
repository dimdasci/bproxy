/** Extract the URL string from a fetch input regardless of type. */
export function extractUrl(url: string | URL | Request): string {
	if (typeof url === "string") return url;
	if (url instanceof URL) return url.href;
	return url.url;
}
