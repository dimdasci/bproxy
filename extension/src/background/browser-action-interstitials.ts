import type { BproxyError } from "@bproxy/shared";
import { humanRequiredError } from "./browser-action-support";
import type { TabLike } from "./tabs";

interface InterstitialRule {
	message: string;
	reason: string;
	suggestedAction?: string;
	matches(url: string, title: string): boolean;
}

const CAPTCHA_URL_PATTERNS = [/\/sorry\b/i, /recaptcha|hcaptcha|turnstile|captcha/i];
const CAPTCHA_TITLE_PATTERNS = [/unusual traffic|verify you are human|captcha/i];
const CHALLENGE_PATTERNS = [/challenge|interstitial/i];
const CHALLENGE_TITLE_PATTERNS = [/just a moment|attention required/i];
const CONSENT_PATTERNS = [/consent|privacy/i];
const CONSENT_TITLE_PATTERNS = [/before you continue|consent/i];
const SIGNIN_URL_PATTERNS = [/(?:sign-?in|signin|login|auth)/i];
const SIGNIN_TITLE_PATTERNS = [/(?:sign in|log in)/i];

const INTERSTITIAL_RULES: readonly InterstitialRule[] = [
	{
		message: "CAPTCHA detected",
		reason: "captcha",
		suggestedAction:
			"Resolve the CAPTCHA or verification challenge in the browser, then run `bproxy session resume`.",
		matches: (url, title) =>
			matchesAny(url, CAPTCHA_URL_PATTERNS) || matchesAny(title, CAPTCHA_TITLE_PATTERNS),
	},
	{
		message: "Challenge page detected",
		reason: "challenge",
		suggestedAction: "Resolve the interstitial in the browser, then run `bproxy session resume`.",
		matches: (url, title) =>
			matchesAny(url, CHALLENGE_PATTERNS) || matchesAny(title, CHALLENGE_TITLE_PATTERNS),
	},
	{
		message: "Consent page detected",
		reason: "consent",
		matches: (url, title) =>
			matchesAny(url, CONSENT_PATTERNS) || matchesAny(title, CONSENT_TITLE_PATTERNS),
	},
	{
		message: "Sign-in required",
		reason: "signin",
		matches: (url, title) =>
			matchesAny(url, SIGNIN_URL_PATTERNS) && matchesAny(title, SIGNIN_TITLE_PATTERNS),
	},
];

export function detectInterstitial(tab: TabLike & { id: number }): BproxyError | null {
	const title = tab.title ?? "";
	const url = tab.url ?? "";
	const matched = INTERSTITIAL_RULES.find((rule) => rule.matches(url, title));
	if (!matched) return null;
	return humanRequiredError(matched.message, {
		reason: matched.reason,
		tabId: tab.id,
		url,
		title,
		suggestedAction: matched.suggestedAction,
	});
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}
