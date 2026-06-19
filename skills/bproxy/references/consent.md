# Consent & Interstitial Handling

## Cookie banners — try in order:

### 1. Known CMP selectors (try first, zero exploration)

| CMP | Selector |
|-----|----------|
| OneTrust | `#onetrust-accept-btn-handler` |
| CookieBot | `#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll` |
| Didomi | `#didomi-notice-agree-button` |
| Quantcast | `.qc-cmp2-summary-buttons button[mode="primary"]` |
| Klaro | `.cm-btn-accept` |
| TrustArc | `.truste_popframe .call` |
| GDPR generic | `[data-testid*="accept"], [id*="accept-cookies"]` |

```bash
bproxy click -n <nick> -s <id> --selector "#onetrust-accept-btn-handler"
```

If `ELEMENT_NOT_FOUND` → next CMP. If clicked → done.

### 2. Check for cross-origin consent iframe

```bash
bproxy dom -n <nick> -s <id> --selector "iframe[src*='consent'], iframe[src*='sourcepoint'], iframe[src*='onetrust'], iframe[title*='consent']"
```

If iframe found → **unreachable** (browser security boundary) → `require-human`.

### 3. Custom same-document banner

Probe structure:
```bash
bproxy dom -n <nick> -s <id> --selector "[role='dialog'], [data-testid*='BottomBar'], [id*='consent'], [class*='banner']" --depth 4
```

Find accept button by DOM position — usually first/most prominent button in the container.
Build a positional selector: `<container> > div > button:first-child` or similar.

## Login walls, CAPTCHAs, age gates

→ `require-human --reason "description"` immediately. Don't attempt.

## After human resolves

```bash
bproxy session resume -n <nick> -s <id>
# continue automation
```
