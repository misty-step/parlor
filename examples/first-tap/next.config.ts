import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@parlor/core", "@parlor/auth", "@parlor/react", "@parlor/web"],
};

export default config;
