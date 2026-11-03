import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "jsdom",
      include: ["test/**/*.component.test.tsx"],
      clearMocks: true,
      restoreMocks: true,
    },
  }),
);
