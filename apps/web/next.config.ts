import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const directory = path.dirname(fileURLToPath(import.meta.url));

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.resolve(directory, '../..'),
};

export default config;
