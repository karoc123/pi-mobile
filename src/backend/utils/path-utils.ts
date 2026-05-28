import path from 'node:path';

export function resolveWithin(root: string, relativePath = '.') {
  const candidate = relativePath.trim().length === 0 ? '.' : relativePath;
  const resolved = path.resolve(root, candidate);
  const rel = path.relative(root, resolved);

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes the configured workspace root.');
  }

  return resolved;
}

export function toPosixPath(input: string) {
  return input.split(path.sep).join('/');
}

export function relativeFrom(root: string, absolutePath: string) {
  return toPosixPath(path.relative(root, absolutePath) || '.');
}