import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    plugins: ["typescript"],
    env: {
      node: true,
      vitest: true,
    },
    ignorePatterns: ["test/repositories/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    ignorePatterns: ["test/__snapshots__/**/*.json"],
  },
  staged: {
    "*": "vp check --fix",
  },
});
