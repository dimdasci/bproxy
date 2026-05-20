import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

interface ManifestShape {
	version?: string;
	content_scripts?: unknown;
	web_accessible_resources?: unknown;
}

const extensionRoot = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(extensionRoot, ".output", "chrome-mv3");
const manifestPath = join(outputDir, "manifest.json");
const packageJsonPath = join(extensionRoot, "package.json");
const forbiddenRuntimePatterns = [/\bMutationObserver\b/u];
const runtimeTextExtensions = new Set([".js", ".html", ".json"]);

await main();

async function main(): Promise<void> {
	await assertOutputExists(outputDir);

	const [manifest, packageJson, runtimeFiles] = await Promise.all([
		readJson<ManifestShape>(manifestPath),
		readJson<{ version: string }>(packageJsonPath),
		listFiles(outputDir),
	]);

	assert(!("content_scripts" in manifest), "manifest must not declare content_scripts");
	assert(
		!("web_accessible_resources" in manifest),
		"manifest must not declare web_accessible_resources",
	);
	assert(
		manifest.version === packageJson.version,
		"manifest version must match package.json version",
	);

	const shippedRuntimeFiles = runtimeFiles.filter((path) => {
		const extension = extname(path);
		return runtimeTextExtensions.has(extension) && !path.endsWith(".map");
	});
	for (const path of shippedRuntimeFiles) {
		const source = await readFile(path, "utf8");
		assertNoForbiddenPatterns(path, source, forbiddenRuntimePatterns);
	}

	const jsAssets = runtimeFiles.filter((path) => extname(path) === ".js");
	assert(jsAssets.length > 0, "expected at least one built JavaScript asset");
	for (const path of jsAssets) {
		const source = await readFile(path, "utf8");
		const sourceMapMatch = /\/\/# sourceMappingURL=(.+\.map)$/mu.exec(source);
		assert(sourceMapMatch, `${fromRoot(path)} must reference a source map`);
		const [, sourceMapFile] = sourceMapMatch;
		assert(sourceMapFile, `${fromRoot(path)} must reference a concrete source map file`);
		const sourceMapPath = join(dirname(path), sourceMapFile);
		await assertOutputExists(sourceMapPath);
	}

	const backgroundPath = join(outputDir, "background.js");
	const backgroundSource = await readFile(backgroundPath, "utf8");
	assert(
		backgroundSource.includes("The background crashed on startup!"),
		"background bundle must preserve a startup crash label",
	);

	const contentPath = join(outputDir, "content-scripts", "content.js");
	const contentSource = await readFile(contentPath, "utf8");
	assert(
		contentSource.includes('The content script "content" crashed on startup!'),
		"content bundle must preserve a startup crash label",
	);

	console.log(`assert-build: ok (${jsAssets.length} JS assets checked)`);
}

async function listFiles(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true });
	const nested = await Promise.all(
		entries.map(async (entry) => {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) return listFiles(path);
			return [path];
		}),
	);
	return nested.flat();
}

async function readJson<T>(path: string): Promise<T> {
	return JSON.parse(await readFile(path, "utf8")) as T;
}

async function assertOutputExists(path: string): Promise<void> {
	try {
		await stat(path);
	} catch {
		throw new Error(`missing build artifact: ${fromRoot(path)}`);
	}
}

function assertNoForbiddenPatterns(
	path: string,
	source: string,
	patterns: readonly RegExp[],
): void {
	for (const pattern of patterns) {
		assert(!pattern.test(source), `${fromRoot(path)} contains forbidden pattern ${pattern}`);
	}
}

function fromRoot(path: string): string {
	return relative(extensionRoot, path) || ".";
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}
