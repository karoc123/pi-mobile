import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { packageName, readImportGraph } from './import-graph.mjs';

const serverPackages = new Set([
  '@earendil-works/pi-coding-agent',
  'express',
  'cookie-parser',
  'chokidar',
  'ws',
]);

export function checkArchitecture(root) {
  const graph = readImportGraph(root);
  const layer = (file) => path.relative(path.join(root, 'src'), file).split(path.sep)[0];
  const display = (file) => path.relative(root, file);
  const failures = new Set();
  for (const [file, dependencies] of graph) {
    for (const { target, builtin, specifier } of dependencies) {
      if (
        target &&
        ((layer(file) === 'frontend' && layer(target) === 'backend') ||
          (layer(file) === 'backend' && layer(target) === 'frontend') ||
          (layer(file) === 'shared' && layer(target) !== 'shared'))
      ) {
        failures.add(`layer-boundary: ${display(file)} -> ${display(target)}`);
      }
      if (layer(file) === 'shared' && (builtin || serverPackages.has(packageName(specifier)))) {
        failures.add(`shared-contract: ${display(file)} -> ${specifier}`);
      }
    }
  }

  const visited = new Set();
  const active = new Set();
  function visit(file, chain) {
    if (active.has(file)) {
      failures.add(`circular: ${[...chain, file].map(display).join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    active.add(file);
    for (const dependency of graph.get(file)) {
      if (dependency.target) visit(dependency.target, [...chain, file]);
    }
    active.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);

  for (const file of graph.keys()) {
    if (layer(file) !== 'frontend' || file.endsWith('.test.ts')) continue;
    const reachable = new Set();
    function browserVisit(current, chain) {
      if (reachable.has(current)) return;
      reachable.add(current);
      for (const dependency of graph.get(current)) {
        const trace = [...chain, display(current), dependency.specifier].join(' -> ');
        if (
          dependency.builtin ||
          serverPackages.has(packageName(dependency.specifier)) ||
          (dependency.target && layer(dependency.target) === 'backend')
        ) {
          failures.add(`browser-server: ${trace}`);
        }
        if (dependency.target) browserVisit(dependency.target, [...chain, display(current)]);
      }
    }
    browserVisit(file, []);
  }
  return [...failures];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkArchitecture(
    path.resolve(process.argv[2] ?? path.resolve(import.meta.dirname, '..')),
  );
  for (const failure of failures) console.error(failure);
  console.log(failures.length ? 'Architecture policy failed.' : 'Architecture policy passed.');
  process.exitCode = failures.length ? 1 : 0;
}
