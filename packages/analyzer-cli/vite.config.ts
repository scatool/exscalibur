import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: "src/cli.ts",
    deps: {
      onlyBundle: false,
    },
    exports: {
      bin: {
        exscalibur: "src/cli.ts",
      },
    },
  },
});
