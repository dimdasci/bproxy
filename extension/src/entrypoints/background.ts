// Background service worker entrypoint.
//
// Task 2 lands an empty-but-loadable shell. Tasks 5-7 will wire the
// WebSocket client, dispatcher, dedupe table, tab/frame tracking, and
// programmatic content-script injection here.
export default defineBackground(() => {
	// Intentionally no-op at this stage; presence of the entrypoint is
	// what makes the bundle loadable in Chrome.
});
