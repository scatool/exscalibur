import { defineConfig } from "vite-plus";
import { configDefaults } from "vite-plus/test/config";

export default defineConfig({
  test: {
    // Downloaded integration-test repositories contain their own test files.
    exclude: [...configDefaults.exclude, "test/repositories/**"],
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
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
