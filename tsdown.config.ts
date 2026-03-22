import { defineConfig } from "tsdown";

export default defineConfig({
	entry: ["src/index.ts", "src/encryption.ts", "src/png.ts"],
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
