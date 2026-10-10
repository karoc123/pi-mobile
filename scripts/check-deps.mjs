import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageName, readImportGraph } from './import-graph.mjs';

export function checkDependencies(root) {
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const failures = [];
  const declared = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const [name, version] of Object.entries(declared)) {
    if (!/^\d+\.\d+\.\d+(?:-[\da-zA-Z.-]+)?(?:\+[\da-zA-Z.-]+)?$/.test(version)) {
      failures.push(`${name}: direct dependencies must use exact versions, got ${version}`);
    }
  }
  for (const [file, dependencies] of readImportGraph(root)) {
    for (const dependency of dependencies) {
      if (dependency.target || dependency.builtin || dependency.specifier.startsWith('.')) continue;
      const name = packageName(dependency.specifier);
      if (!declared[name])
        failures.push(`${path.relative(root, file)}: undeclared dependency ${name}`);
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
