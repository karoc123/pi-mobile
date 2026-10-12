import { builtinModules } from 'node:module';
import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelte from 'eslint-plugin-svelte';

const serverPackages = [
  '@earendil-works/pi-coding-agent',
  '@earendil-works/pi-ai',
  'express',
  'cookie-parser',
  'chokidar',
  'ws',
];

const nodeBuiltinPaths = [
  ...builtinModules.map((name) => ({
    name,
    message: 'Node builtins are not allowed in frontend or shared code.',
  })),
  ...builtinModules.map((name) => ({
    name: `node:${name}`,
    message: 'Node builtins are not allowed in frontend or shared code.',
  })),
];

const serverPackagePaths = serverPackages.map((name) => ({
  name,
  message: `Server package "${name}" cannot be imported in frontend or shared code.`,
}));

export default tseslint.config(
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
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.{ts,svelte}', 'playwright/**/*.ts', '*.ts'],
  })),
  ...svelte.configs['flat/recommended'].map((config) => ({
    ...config,
    files: ['src/**/*.svelte'],
  })),
  {
    files: ['src/**/*.svelte'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'SvelteDirective[kind=EventHandler]',
          message: 'Use callback event attributes with Svelte 5 Runes.',
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  {
    files: ['src/**/*.{ts,svelte}', 'playwright/**/*.ts', '*.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['src/frontend/**/*.{ts,svelte}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...nodeBuiltinPaths,
            ...serverPackagePaths,
            {
              name: 'svelte',
              importNames: ['createEventDispatcher'],
              message: 'Use callback props with Svelte 5 Runes.',
            },
          ],
          patterns: [
            {
              group: ['@backend/**', '**/backend/**', '**/backend', 'node:*'],
              message: 'Frontend code cannot import backend code or Node builtins.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [...nodeBuiltinPaths, ...serverPackagePaths],
          patterns: [
            {
              group: [
                '@backend/**',
                '**/backend/**',
                '**/backend',
                '@frontend/**',
                '**/frontend/**',
                '**/frontend',
                'node:*',
              ],
              message: 'Shared contracts cannot import frontend, backend, or Node builtins.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/backend/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@frontend/**', '**/frontend/**', '**/frontend'],
              message: 'Backend code cannot import frontend code.',
            },
          ],
        },
      ],
    },
  },
);
