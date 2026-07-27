import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ command }) => {
  const port = 5174;

  return {
    root: "src/webview",
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@/webview": path.resolve(__dirname, "./src/webview"),
      },
    },
    base: "./",
    server:
      command === "serve"
        ? {
            port,
            strictPort: true,
            cors: { origin: "*" },
            headers: { "Access-Control-Allow-Origin": "*" },
          }
        : undefined,
    build: {
      assetsInlineLimit: 10000,
      outDir: path.resolve(__dirname, "dist/webview"),
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules")) {
              return "vendor"; // 所有 node_modules 中的代码打包成 vendor.[hash].js
            }
          },
        },
      },
    },
  };
});
