# bproxy

bproxy lets coding agents use the operator's real Chrome session through a narrow, human-in-the-loop CLI.

```text
Agent -> bproxy CLI -> localhost daemon -> Chrome extension -> real page
```

## Install

```bash
npm install -g @dimdasci/bproxy
bproxy --version
```

Install the [bproxy Chrome extension from the Chrome Web Store](https://chromewebstore.google.com/detail/bproxy/hjedkgneajbgjpgepbffdeanekhfffhc). Chrome manages extension updates automatically.

## First run

```bash
bproxy service start
```

Enter the printed pairing code in the extension popup, then verify:

```bash
bproxy doctor
```

## Smoke test

```bash
bproxy tab open --url https://example.com
bproxy text -s <session-id>
bproxy session close -s <session-id>
bproxy service stop
```

See the full documentation at https://dimdasci.github.io/bproxy/ — start with [Install](https://dimdasci.github.io/bproxy/guide/install/) and [Usage](https://dimdasci.github.io/bproxy/guide/usage/).
