/** @type {import('next').NextConfig} */
if (
  (process.env.AYRA_E2E_AUTH_MOCK === "1" || process.env.AYRA_E2E_AUTH_MOCK === "true") &&
  (process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production") &&
  process.env.CI !== "true" &&
  process.env.CI !== "1" &&
  !process.env.PLAYWRIGHT
) {
  throw new Error("AYRA_E2E_AUTH_MOCK cannot be enabled in production builds!");
}

const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // Separate build output for the fake-Supabase e2e suite (see e2e/fake-supabase/run-app.mjs)
  distDir: process.env.AYRA_NEXT_DIST_DIR || ".next",
};
export default nextConfig;
