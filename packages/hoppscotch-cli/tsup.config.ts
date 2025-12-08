import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["./src/index.ts"],
  outDir: "./dist/",
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  bundle: true,
  target: "esnext",
  skipNodeModulesBundle: false,
  external: ["form-data", "proxy-agent"],
  esbuildOptions(options) {
    options.bundle = true;
  },
  clean: true,
});
