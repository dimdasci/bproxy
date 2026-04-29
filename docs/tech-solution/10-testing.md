# 10. Testing Strategy

[← Index](./README.md) · Prev: [Build & Distribution](./09-build.md) · Next: [Implementation Order →](./11-implementation-order.md)

---

## Unit: proxy service

Spin up the proxy, connect a mock WebSocket client (simulates extension), send HTTP requests, assert responses. Test: command forwarding, timeout handling, disconnect errors.

## Unit: content script actions

Load `content.js` in a jsdom or real browser context against local HTML fixture files. Test each action: click, type, text, elements, eval.

## Integration: end-to-end

1. Start proxy service.
2. Launch Chrome with `--load-extension=extension/`.
3. Run CLI commands against a local test page served by a static HTTP server.
4. Assert CLI JSON output.

This is the test that matters most. Run it manually during development. Automate later if the project grows.

## Test fixtures

```
test/
├── fixtures/
│   ├── basic.html        # links, buttons, inputs, text
│   ├── spa.html           # client-side navigation, async content loading
│   ├── hydration.html     # SSR content + delayed JS hydration
│   └── shadow.html        # shadow DOM elements
├── test-proxy.js
├── test-content.js
└── run.js                 # orchestrates all tests
```
