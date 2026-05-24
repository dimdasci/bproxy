import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/bproxy.ts"],
	format: ["esm"],
	target: "node24",
	outDir: "dist",
	clean: true,
	splitting: false,
	sourcemap: true,
	dts: false,
	noExternal: ["@bproxy/shared", "citty"],
	banner: { js: "#!/usr/bin/env node" },
	outExtension() {
		return { js: ".mjs" };
	},
});
