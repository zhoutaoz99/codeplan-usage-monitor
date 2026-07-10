import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: {
      entry: resolve(__dirname, "src/content/bootstrap.ts"),
      formats: ["iife"],
      name: "CodePlanContent",
      fileName: () => "content-bootstrap.js"
    },
    rollupOptions: {
      output: { inlineDynamicImports: true }
    }
  }
});
