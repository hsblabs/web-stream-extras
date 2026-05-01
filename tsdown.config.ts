import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/base64/index.ts",
		"src/encryption/index.ts",
		"src/jsonl.ts",
		"src/text/index.ts",
		"src/png.ts",
		"src/cobs/index.ts",
	],
	outDir: "dist",
	target: "es2022",
	format: "esm",
	outExtensions() {
		return {
			js: ".js",
			dts: ".d.ts",
		};
	},
	clean: true,
	dts: true,
	treeshake: true,
	sourcemap: false,
	minify: true,
	exports: true,
});
