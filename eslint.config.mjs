import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/node_modules/**',
      'dist/**',
      'tmp/**',
      'workspace/**',
      'db/**',
      'pi/**',
      '.*/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  {
    files: ['*.{js,mjs,cjs}', 'scripts/**/*.{js,mjs,cjs}'],
    ...js.configs.recommended,
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
];
