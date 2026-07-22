import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
  },
  build: {
    rollupOptions: {
      output: {
        // AT-151 (perf pass). The admin app shipped as a single ~750 kB JS
        // chunk, which tripped rollup's >500 kB warning and meant every deploy
        // re-downloaded react, refine and supabase-js even when only a page
        // changed. Splitting the three big, rarely-changing vendor libraries
        // into their own chunks keeps each under the limit and lets the browser
        // cache them across releases. Grouping only, no behaviour change: the
        // same modules load, just in separate files.
        manualChunks(id: string) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@refinedev")) return "refine";
          if (id.includes("@supabase")) return "supabase";
          if (id.includes("/react-router") || id.includes("/react-dom") || id.includes("/react/")) {
            return "react";
          }
          return "vendor";
        },
      },
    },
  },
});
