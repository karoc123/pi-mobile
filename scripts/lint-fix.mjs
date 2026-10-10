import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const files = process.argv.slice(2);
if (
  files.length === 0 ||
  files.some((file) => file.startsWith('-') || !statSync(path.resolve(root, file)).isFile())
) {
  console.error('Lint writes require explicit file paths: npm run lint:fix -- <files>');
  process.exit(1);
}
try {
  execFileSync(
    process.execPath,
    [
      path.join(
        path.dirname(fileURLToPath(import.meta.resolve('eslint/package.json'))),
        'bin/eslint.js',
      ),
      '--fix',
      ...files,
    ],
    {
      cwd: root,
      stdio: 'inherit',
    },
  );
} catch (error) {
  process.exit(error.status ?? 1);
}
