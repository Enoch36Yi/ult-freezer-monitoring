import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin the file-tracing root to this directory. Without it Next walks up
  // looking for a lockfile and can infer a root outside the project (the
  // OneDrive parent), which makes deploy-time tracing non-deterministic.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
