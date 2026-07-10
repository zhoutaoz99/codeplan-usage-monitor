import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, "dashboard.html"),
        options: resolve(__dirname, "options.html")
      }
    }
  }
});
