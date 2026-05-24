import { dirname, relative, resolve } from "node:path";
import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import { slug as githubSlug } from "github-slugger";

/**
 * Rewrites relative .md links to absolute route URLs.
 *
 * Markdown source files cross-reference each other with relative paths
 * (e.g. `../decisions.md#adr-010`). Starlight serves those files at URL
 * paths one segment deeper than the source, so a naive relative href
 * resolves to the wrong route. This plugin resolves each .md link against
 * the current file's location within the content root and emits an absolute
 * route URL (`/decisions/#adr-010`).
 *
 * Path segments are slugified with github-slugger — the same library Astro
 * uses in its glob loader (see astro/dist/content/utils.js) — so that file
 * names like `00.5-doc-reconciliation.md` produce the correct route
 * `/plans/phases/005-doc-reconciliation/` (dots stripped).
 *
 * Runs at remark level (MDAST link nodes), so it covers every `[text](url)`
 * in the markdown source. Raw HTML `<a>` tags are not rewritten — none
 * exist in the current docs.
 */
function remarkRewriteMdLinks() {
	// Content root: views/src/content/docs/ (the symlink target of ../docs)
	const contentRoot = resolve(dirname(new URL(import.meta.url).pathname), "src/content/docs");

	return (tree, file) => {
		// file.path is absolute, e.g. /.../views/src/content/docs/solution/cli.md
		const filePath = file.path || file.history?.[0];
		if (!filePath) return;

		const fileDir = dirname(filePath);

		function walk(node) {
			if (node.type === "link" && typeof node.url === "string") {
				const url = node.url;

				// Skip external, protocol, anchor-only, and non-.md links
				if (
					url.startsWith("http://") ||
					url.startsWith("https://") ||
					url.startsWith("//") ||
					url.startsWith("#") ||
					url.startsWith("mailto:")
				) {
					// leave as-is
				} else {
					// Split off #fragment
					const hashIdx = url.indexOf("#");
					const rawPath = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
					const fragment = hashIdx >= 0 ? url.slice(hashIdx) : "";

					if (rawPath.endsWith(".md") || rawPath.endsWith(".mdx")) {
						// Resolve relative to current file, then make relative to content root
						const absTarget = resolve(fileDir, rawPath);
						let routePath = relative(contentRoot, absTarget);

						// Normalise to posix separators (Windows safety)
						routePath = routePath.split("\\").join("/");

						// Strip .md / .mdx extension
						routePath = routePath.replace(/\.mdx?$/, "");

						// Slugify each segment the way Astro's glob loader does
						routePath = routePath
							.split("/")
							.map((s) => githubSlug(s))
							.join("/");

						// index files map to their parent directory
						if (routePath === "index" || routePath.endsWith("/index")) {
							routePath = routePath.replace(/\/?index$/, "");
						}

						// Emit absolute URL: /decisions/#adr-010
						node.url = "/" + routePath + "/" + fragment;
					}
				}
			}
			if (node.children) {
				for (const child of node.children) walk(child);
			}
		}
		walk(tree);
	};
}

/** Converts ```mermaid fenced blocks to <pre class="mermaid"> for CDN rendering. */
function remarkMermaid() {
	return (tree) => {
		function walk(node) {
			if (node.children) {
				for (let i = 0; i < node.children.length; i++) {
					const child = node.children[i];
					if (child.type === "code" && child.lang === "mermaid") {
						// value is trusted checked-in source; no sanitization needed
						node.children[i] = { type: "html", value: `<pre class="mermaid">${child.value}</pre>` };
					} else {
						walk(child);
					}
				}
			}
		}
		walk(tree);
	};
}

export default defineConfig({
	markdown: {
		remarkPlugins: [remarkRewriteMdLinks, remarkMermaid],
		syntaxHighlight: { excludeLangs: ["mermaid"] },
	},
	integrations: [
		starlight({
			title: "bproxy — Design",
			description: "Architecture views and design docs for bproxy.",
			sidebar: [
				{
					label: "Overview",
					items: [{ label: "Introduction", link: "/" }],
				},
				{
					label: "Views",
					collapsed: false,
					items: [{ autogenerate: { directory: "views" } }],
				},
				{
					label: "Solution Specs",
					items: [{ autogenerate: { directory: "solution" } }],
				},
			],
			components: {
				PageFrame: "./src/components/PageFrame.astro",
			},
			customCss: ["./src/styles/custom.css"],
			head: [
				{
					tag: "script",
					attrs: { type: "module" },
					content: `
            import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
            // 'loose' allows HTML in labels (strict strips entities); safe for checked-in source
            mermaid.initialize({ startOnLoad: true, theme: 'neutral', securityLevel: 'loose' });
          `,
				},
			],
		}),
	],
});
