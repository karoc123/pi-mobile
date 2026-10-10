import { isBuiltin } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseJavaScript } from '@babel/parser';
import { parse as parseSvelte } from 'svelte/compiler';

const sourceExtensions = /\.(?:[cm]?[jt]sx?|svelte)$/;

export function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : sourceExtensions.test(file) ? [file] : [];
  });
}

export function importSpecifiers(file, source = readFileSync(file, 'utf8')) {
  const component = file.endsWith('.svelte') ? parseSvelte(source) : null;
  const scripts = component
    ? [component.instance, component.module]
        .filter(Boolean)
        .map((script) => source.slice(script.content.start, script.content.end))
    : [source];
  const imports = new Set();
  const asts = scripts.map((script) =>
    parseJavaScript(script, {
      sourceType: 'unambiguous',
      plugins:
        file.endsWith('tsx') || file.endsWith('jsx') ? ['typescript', 'jsx'] : ['typescript'],
    }),
  );
  if (component) asts.push(component.html);
  for (const ast of asts) {
    function addLiteral(node) {
      if (
        node?.type === 'StringLiteral' ||
        (node?.type === 'Literal' && typeof node.value === 'string')
      )
        imports.add(node.value);
      else if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
        imports.add(node.quasis[0].value.cooked);
      } else throw new Error(`${file}: computed import/require cannot be architecture-checked`);
    }
    function visit(node) {
      if (!node || typeof node !== 'object') return;
      if (
        ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(
          node.type,
        ) &&
        node.source
      ) {
        addLiteral(node.source);
      } else if (node.type === 'TSImportType') addLiteral(node.source);
      else if (node.type === 'TSExternalModuleReference') addLiteral(node.expression);
      else if (node.type === 'ImportExpression') addLiteral(node.source);
      else if (
        node.type === 'CallExpression' &&
        node.callee.type === 'Identifier' &&
        node.callee.name === 'require'
      ) {
        addLiteral(node.arguments[0]);
      }
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object' && 'type' in value) visit(value);
      }
    }
    visit(ast);
  }
  return [...imports];
}

export function packageName(specifier) {
  return specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];
}

export function readImportGraph(root) {
  const { compilerOptions = {} } = JSON.parse(
    readFileSync(path.join(root, 'tsconfig.json'), 'utf8'),
  );
  const files = sourceFiles(path.join(root, 'src'));
  const knownFiles = new Set(files);
  const graph = new Map();
  for (const file of files) {
    const dependencies = importSpecifiers(file).map((specifier) => {
      if (specifier.startsWith('node:') || isBuiltin(specifier))
        return { specifier, builtin: true };
      let candidates = specifier.startsWith('.')
        ? [path.resolve(path.dirname(file), specifier)]
        : [];
      for (const [alias, targets] of Object.entries(compilerOptions.paths ?? {})) {
        const prefix = alias.endsWith('*') ? alias.slice(0, -1) : alias;
        if (specifier === alias || (alias.endsWith('*') && specifier.startsWith(prefix))) {
          candidates = targets.map((target) =>
            path.resolve(root, target.replace('*', specifier.slice(prefix.length))),
          );
        }
      }
      const target = candidates
        .flatMap((candidate) => [
          candidate,
          candidate.replace(/\.js$/, '.ts'),
          candidate.replace(/\.js$/, '.tsx'),
          candidate.replace(/\.jsx$/, '.tsx'),
          candidate.replace(/\.mjs$/, '.mts'),
          candidate.replace(/\.cjs$/, '.cts'),
          ...['.ts', '.tsx', '.js', '.svelte', '/index.ts', '/index.js'].map(
            (suffix) => candidate + suffix,
          ),
        ])
        .find((candidate) => knownFiles.has(candidate));
      if (candidates.length > 0 && !target && !specifier.endsWith('.css')) {
        throw new Error(`${path.relative(root, file)}: unresolved local import ${specifier}`);
      }
      return { specifier, target };
    });
    graph.set(file, dependencies);
  }
  return graph;
}
