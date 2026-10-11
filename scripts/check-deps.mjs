import { isBuiltin } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : sourceExtensions.test(file) ? [file] : [];
  });
}

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, '');
}

export function extractImportSpecifiers(source) {
  const clean = stripComments(source);
  const specifiers = new Set();
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^{}]+|\{[^{}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?(?:[^{}]+|\{[^{}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\btype\s+.*?=\s*import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(clean)) !== null) {
      specifiers.add(match[1]);
    }
  }

  return [...specifiers];
}

export function packageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

export function checkDependencies(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const failures = [];
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };

  for (const [name, version] of Object.entries(declared)) {
    if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) {
      failures.push(`${name}: direct dependencies must use exact versions, got ${version}`);
    }
  }

  const srcDir = path.join(root, 'src');
  const files = sourceFiles(srcDir);

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const specifiers = extractImportSpecifiers(source);

    for (const specifier of specifiers) {
      if (
        specifier.startsWith('.') ||
        specifier.startsWith('node:') ||
        isBuiltin(specifier) ||
        specifier.startsWith('@backend') ||
        specifier.startsWith('@frontend') ||
        specifier.startsWith('@shared')
      ) {
        continue;
      }

      const name = packageName(specifier);
      if (!declared[name]) {
        failures.push(`${path.relative(root, file)}: undeclared dependency ${name}`);
      }

      if (
        file.startsWith(path.join(root, 'src/backend') + path.sep) &&
        !file.endsWith('.test.ts') &&
        !manifest.dependencies?.[name]
      ) {
        failures.push(
          `${path.relative(root, file)}: backend runtime dependency ${name} must be in dependencies`,
        );
      }
    }
  }

  return [...new Set(failures)];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkDependencies(
    path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, '..')),
  );
  for (const failure of failures) console.error(failure);
  console.log(failures.length ? 'Dependency policy failed.' : 'Dependency policy passed.');
  process.exitCode = failures.length ? 1 : 0;
}
