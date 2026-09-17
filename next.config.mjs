/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep Turbopack scoped to this project. Without it Next walks up to
  // C:\Users\tanmay (a package-lock.json lives there) and watches far more
  // files than needed — extra churn on .next that Windows AV/indexer can
  // lock mid-rename (EPERM rename failures).
  turbopack: { root: process.cwd() },
  allowedDevOrigins: ["127.0.0.1"], // Feed SDK uses ws + protobufjs with fs-based proto loading — keep it
  // unbundled so Node resolves it natively in route handlers.
  serverExternalPackages: ["upstox-js-sdk", "protobufjs", "ws"],
  images: {
    localPatterns: [
      {
        pathname: "/**",
      },
    ],
  },
};

export default nextConfig;
