import type {NextConfig} from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // React Compiler stays off for now per PRD §F1 — re-evaluate once it's stable.
  poweredByHeader: false,
};

export default nextConfig;
