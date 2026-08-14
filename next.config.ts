import type { NextConfig } from "next";

// The apex used to 307 here to the app. It now serves the marketing site,
// routed by host in proxy.ts. Config-level redirects run BEFORE the proxy, so
// this file must stay out of the way of that routing.
const nextConfig: NextConfig = {};

export default nextConfig;
