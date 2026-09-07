import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://parlor.mistystep.io",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  markdown: {
    shikiConfig: { theme: "github-light" },
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
