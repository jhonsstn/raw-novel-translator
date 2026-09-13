import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import eslintConfigPrettier from 'eslint-config-prettier/flat';

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  eslintConfigPrettier,
  {
    settings: {
      next: {
        rootDir: 'apps/web',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  globalIgnores(['**/.next/**', '**/dist/**', '**/coverage/**', 'apps/web/next-env.d.ts']),
]);
