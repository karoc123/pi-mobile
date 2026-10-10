import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { checkArchitecture } from '../check-architecture.mjs';
import { checkDependencies } from '../check-deps.mjs';
import { importSpecifiers } from '../import-graph.mjs';

const root = path.resolve(import.meta.dirname, '../..');

function fixture(t, files, dependencies = {}) {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'tmp/guardrail-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const content = {
    'package.json': JSON.stringify({ dependencies }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        moduleResolution: 'Bundler',
        module: 'ESNext',
        paths: { '@shared/*': ['./src/shared/*'] },
      },
    }),
    'src/shared/contracts.ts': 'export type Value = string;',
    ...files,
  };
  for (const [name, source] of Object.entries(content)) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return directory;
}

test('allowed Svelte, shared types, aliases and backend Node imports pass', (t) => {
  const directory = fixture(t, {
    'src/frontend/App.svelte':
      '<script lang="ts">import type {Value} from "@shared/contracts.js"; import Child from "./Child.svelte"; let value: Value = "ok";</script><Child />',
    'src/frontend/Child.svelte': '<h1>Child</h1>',
    'src/backend/main.ts': 'import "node:fs"; import type {Value} from "../shared/contracts.js";',
  });
  assert.deepEqual(checkArchitecture(directory), []);
  assert.deepEqual(checkDependencies(directory), []);
});

const violations = [
  [
    'frontend to backend from Svelte instance script',
    'layer-boundary',
    {
      'src/frontend/App.svelte': '<script lang="ts">import "../backend/main.js";</script>',
      'src/backend/main.ts': 'export {};',
    },
  ],
  [
    'backend to frontend',
    'layer-boundary',
    {
      'src/backend/main.ts': 'import "../frontend/value.js";',
      'src/frontend/value.ts': 'export {};',
    },
  ],
  [
    'shared to application',
    'layer-boundary',
    {
      'src/shared/contracts.ts': 'export * from "../backend/main.js";',
      'src/backend/main.ts': 'export {};',
    },
  ],
  [
    'cyclic imports',
    'circular',
    {
      'src/backend/a.ts': 'import "./b.js";',
      'src/backend/b.ts': 'import "./a.js";',
    },
  ],
  [
    'Node import from Svelte module script',
    'browser-server',
    {
      'src/frontend/App.svelte': '<script module lang="ts">import "node:test";</script>',
    },
  ],
  [
    'transitive Node import through shared helper',
    'browser-server',
    {
      'src/frontend/App.svelte': '<script>import "../shared/contracts.js";</script>',
      'src/shared/contracts.ts': 'export * from "./helper.js";',
      'src/shared/helper.ts': 'import "fs/promises";',
    },
  ],
  [
    'server SDK import in browser',
    'browser-server',
    {
      'src/frontend/App.svelte': '<script>import "@earendil-works/pi-coding-agent";</script>',
    },
  ],
  [
    'server package in shared contract',
    'shared-contract',
    {
      'src/shared/contracts.ts': 'import "express";',
    },
  ],
  [
    'dynamic import in a Svelte template expression',
    'browser-server',
    {
      'src/frontend/App.svelte': '<button onclick={() => import("node:fs")}>Load</button>',
    },
  ],
  [
    'dynamic literal import from browser',
    'browser-server',
    {
      'src/frontend/main.ts': 'void import("node:fs");',
    },
  ],
];
for (const [name, rule, files] of violations) {
  test(`${name} fails the ${rule} rule`, (t) => {
    const failures = checkArchitecture(fixture(t, files));
    assert.ok(
      failures.some((failure) => failure.startsWith(`${rule}:`)),
      failures.join('\n'),
    );
  });
}

test('dependency checker rejects ranges, undeclared imports and runtime devDependencies', (t) => {
  const directory = fixture(t, {
    'src/backend/main.ts': 'import "declared"; import "missing/subpath";',
    'package.json': JSON.stringify({ devDependencies: { declared: '^1.0.0' } }),
  });
  const failures = checkDependencies(directory);
  assert.ok(failures.some((failure) => failure.includes('exact versions')));
  assert.ok(failures.some((failure) => failure.includes('undeclared dependency missing')));
  assert.ok(failures.some((failure) => failure.includes('runtime dependency declared')));
});

test('scanner captures re-exports, import types, require and ignores comments', () => {
  assert.deepEqual(
    importSpecifiers(
      'value.ts',
      `
    // import 'not-a-dependency';
    export * from 're-export';
    type Value = import('type-package').Value;
    const value = require('required');
    void import('dynamic');
  `,
    ),
    ['re-export', 'type-package', 'required', 'dynamic'],
  );
});

test('unresolvable local imports and computed dynamic imports fail closed', (t) => {
  assert.throws(
    () =>
      checkArchitecture(
        fixture(t, {
          'src/frontend/main.ts': 'import "./missing.js";',
        }),
      ),
    /unresolved local import/,
  );
  assert.throws(() => importSpecifiers('main.ts', 'void import(variable);'), /computed import/);
});

test('policy CLIs return success for allowed imports and fail for forbidden fixtures', (t) => {
  const allowed = fixture(t, { 'src/backend/main.ts': 'import "node:fs";' });
  const forbidden = fixture(t, {
    'src/frontend/App.svelte': '<script>import "node:fs"; import "missing";</script>',
  });
  for (const script of ['check-deps.mjs', 'check-architecture.mjs']) {
    const invoke = (directory) =>
      spawnSync(process.execPath, [path.join(root, 'scripts', script), directory], {
        encoding: 'utf8',
      });
    const positive = invoke(allowed);
    assert.equal(positive.status, 0, positive.stderr);
    const negative = invoke(forbidden);
    assert.equal(negative.status, 1, negative.stderr);
    assert.match(
      negative.stderr,
      script === 'check-deps.mjs' ? /undeclared dependency/ : /browser-server/,
    );
  }
});

test('lint writes reject missing paths and directory-wide fixes', () => {
  for (const args of [[], ['.']]) {
    const result = spawnSync(process.execPath, ['scripts/lint-fix.mjs', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit file paths/);
  }
});

test('format writes require explicit paths and cannot format the full tree', () => {
  for (const args of [['--write'], ['--write', '--all'], ['--write', '.']]) {
    assert.throws(
      () =>
        execFileSync(process.execPath, ['scripts/format.mjs', ...args], {
          cwd: root,
          stdio: 'pipe',
        }),
      (error) => error.status === 1 && error.stderr.toString().includes('explicit file paths'),
    );
  }
});
