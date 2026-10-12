import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const write = args.includes('--write');
const all = args.includes('--all');
const paths = args.filter((arg) => arg !== '--write' && arg !== '--all');

if (
  write &&
  (all ||
    paths.length === 0 ||
    paths.some(
      (file) =>
        file.startsWith('-') ||
        !existsSync(path.resolve(root, file)) ||
        !statSync(path.resolve(root, file)).isFile(),
    ))
) {
  console.error('Formatting writes require explicit file paths: npm run format:fix -- <paths>');
  process.exit(1);
}

const gitFiles = (...args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const candidates =
  paths.length > 0
    ? paths
    : all
      ? [
          ...gitFiles('ls-files', '-z'),
          ...gitFiles('ls-files', '--others', '--exclude-standard', '-z'),
        ]
      : [
          ...gitFiles('diff', '--name-only', '--diff-filter=ACMR', '-z', 'HEAD'),
          ...gitFiles('ls-files', '--others', '--exclude-standard', '-z'),
        ];
const files = [...new Set(candidates)].filter((file) => existsSync(path.resolve(root, file)));

if (files.length === 0) {
  console.log('No files to format-check. Use npm run format:all for the full tracked tree.');
} else {
  const prettier = fileURLToPath(import.meta.resolve('prettier/bin/prettier.cjs'));
  try {
    execFileSync(
      process.execPath,
      [prettier, write ? '--write' : '--check', '--ignore-unknown', ...files],
      {
        cwd: root,
        stdio: 'inherit',
      },
    );
  } catch (error) {
    process.exit(error.status ?? 1);
  }
}
