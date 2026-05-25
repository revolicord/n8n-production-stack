import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Trace files from monorepo root so pnpm virtual store is included in standalone
  outputFileTracingRoot: path.join(__dirname, '../../'),
  transpilePackages: ['@dm-api/db'],
  // postgres.js uses native Node.js APIs (net.Socket, Buffer) that break when
  // bundled by webpack — keep it as a runtime require
  serverExternalPackages: ['postgres'],
  typedRoutes: false,
};

export default nextConfig;
