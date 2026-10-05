import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// separate from vite.config.ts: the test environment needs jsdom + the @ alias,
// while the app build keeps its preview/server settings
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
});
