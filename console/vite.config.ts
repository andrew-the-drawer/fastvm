import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";
import { fastvmProxy } from "./vite-plugins/fastvm-proxy.ts";

// https://vite.dev/config/
export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    plugins: ["react", "typescript", "oxc"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": [
        "warn",
        {
          allowConstantExport: true,
        },
      ],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  plugins: lazyPlugins(() => [react(), fastvmProxy()]),
  server: {
    // Bind IPv4 explicitly so http://127.0.0.1:5173 works everywhere; on some
    // hosts `localhost` resolves to ::1 only.
    host: "127.0.0.1",
  },
  preview: {
    host: "127.0.0.1",
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
