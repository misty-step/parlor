import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://parlor.mistystep.io",
  output: "static",
  trailingSlash: "always",
  devToolbar: { enabled: false },
  markdown: {
    shikiConfig: { themes: { light: "github-light", dark: "github-dark-default" } },
  },
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
