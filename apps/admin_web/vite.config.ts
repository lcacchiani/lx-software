import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  base: "/",
  build: {
    outDir: "dist",
  },
  plugins: [react()],
  // `.env.mock` should set this; pin it in mock mode so Playwright and
  // `npm run dev:mock` never fall through to the login screen.
  define:
    mode === "mock"
      ? { "import.meta.env.VITE_ADMIN_MOCK": JSON.stringify("1") }
      : undefined,
}));
