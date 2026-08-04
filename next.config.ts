import type { NextConfig } from "next";

/** Internal tool: nothing here should be framed, sniffed, indexed, or leak a full referrer. */
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,

  /** Both are reached only through a dynamic import on the server (nodemailer in
   *  lib/email/send.ts, exceljs in lib/import/workbook.ts); leaving them external
   *  keeps the bundler from tracing their optional deps. */
  serverExternalPackages: ["nodemailer", "exceljs"],

  experimental: {
    /** An uploaded lead workbook arrives through a server action, and the default
     *  1 MB action body would refuse a perfectly ordinary 3,000-row sheet. The
     *  real limit is MAX_FILE_BYTES in lib/import/schema.ts, checked server-side;
     *  this only has to be larger than that. */
    serverActions: { bodySizeLimit: "8mb" },
  },

  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
