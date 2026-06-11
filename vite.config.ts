import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {
    ignorePatterns: ["test/__snapshots__/**/*.json"],
  },
  staged: {
    "*": "vp check --fix",
  },
});
