import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://parlor.mistystep.io",
  output: "static",
  trailingSlash: "always",
  markdown: {
    shikiConfig: { theme: "github-light" },
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
