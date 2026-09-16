import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    // Never ship sourcemaps in the production bundle — they let anyone
    // de-obfuscate the minified JS back into readable source in devtools.
    sourcemap: false,
  },
});
