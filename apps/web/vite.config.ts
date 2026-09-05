import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Tauri loads the build from disk, so assets must resolve relatively.
  base: "./",
  build: {
    outDir: "dist",
    target: "chrome110",
    sourcemap: false,
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
