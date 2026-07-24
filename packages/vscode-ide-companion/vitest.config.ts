import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@/webview": path.resolve(__dirname, "./src/webview"),
      vscode: path.resolve(__dirname, "./src/tests/__mocks__/vscode.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    // Exclude extension tests that require VS Code runtime
    exclude: ["node_modules", "dist", "src/extension.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "**/*.d.ts", "src/tests/**", "**/index.ts"],
    },
  },
});
