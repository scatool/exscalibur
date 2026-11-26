import { defineConfig } from "vite-plus";
import { configDefaults } from "vite-plus/test/config";

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, "test/repositories/**"],
  },
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
