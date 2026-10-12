import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { checkDependencies, extractImportSpecifiers } from '../check-deps.mjs';

const root = path.resolve(import.meta.dirname, '../..');

function fixture(t, files, dependencies = {}, devDependencies = {}) {
  mkdirSync(path.join(root, 'tmp'), { recursive: true });
  const directory = mkdtempSync(path.join(root, 'tmp/guardrail-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const content = {
    'package.json': JSON.stringify({ dependencies, devDependencies }),
    ...files,
  };
  for (const [name, source] of Object.entries(content)) {
    const file = path.join(directory, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, source);
  }
  return directory;
}

test('dependency checker allows valid imports and exact versions', (t) => {
  const directory = fixture(
    t,
    {
      'src/frontend/App.svelte':
        '<script lang="ts">import type {Value} from "@shared/contracts.js";</script>',
      'src/backend/main.ts': 'import "node:fs"; import "express";',
    },
    { express: '5.3.0' },
  );
  assert.deepEqual(checkDependencies(directory), []);
});

test('dependency checker rejects ranges, undeclared imports and runtime devDependencies', (t) => {
  const directory = fixture(
    t,
    {
      'src/backend/main.ts': 'import "declared"; import "missing/subpath";',
    },
    {},
    { declared: '^1.0.0' },
  );
  const failures = checkDependencies(directory);
  assert.ok(failures.some((failure) => failure.includes('exact versions')));
  assert.ok(failures.some((failure) => failure.includes('undeclared dependency missing')));
  assert.ok(failures.some((failure) => failure.includes('runtime dependency declared')));
});

test('scanner captures re-exports, import types, require and ignores comments', () => {
  const result = extractImportSpecifiers(
    `
    // import 'not-a-dependency';
    export * from 're-export';
    type Value = import('type-package').Value;
    const value = require('required');
    void import('dynamic');
  `,
  );
  assert.deepEqual(result.sort(), ['dynamic', 're-export', 'required', 'type-package']);
});

test('policy CLI returns success for allowed imports and fails for undeclared dependencies', (t) => {
  const allowed = fixture(
    t,
    { 'src/backend/main.ts': 'import "node:fs"; import "express";' },
    { express: '5.3.0' },
  );
  const forbidden = fixture(t, {
    'src/frontend/App.svelte': '<script>import "missing";</script>',
  });

  const invoke = (directory) =>
    spawnSync(process.execPath, [path.join(root, 'scripts/check-deps.mjs'), directory], {
      encoding: 'utf8',
    });

  const positive = invoke(allowed);
  assert.equal(positive.status, 0, positive.stderr);

  const negative = invoke(forbidden);
  assert.equal(negative.status, 1, negative.stderr);
  assert.match(negative.stderr, /undeclared dependency/);
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

test('Svelte compiler requires Runes and rejects legacy reactive declarations', async () => {
  const { compile } = await import('svelte/compiler');
  const { default: config } = await import('../../svelte.config.js');
  assert.equal(config.compilerOptions.runes, true);
  for (const source of [
    '<script>export let name;</script>',
    '<script>let value = 0; $: value = 1;</script>',
  ]) {
    assert.throws(() => compile(source, config.compilerOptions));
  }
  compile(
    '<script>let value = $state(0);</script><button onclick={() => value++}>{value}</button>',
    config.compilerOptions,
  );
});

test('ESLint rejects legacy event directives and createEventDispatcher', async () => {
  const { ESLint } = await import('eslint');
  const lint = new ESLint({ cwd: root });
  for (const source of [
    '<button on:click={() => {}}>Go</button>',
    '<script>import { createEventDispatcher } from "svelte"; const dispatch = createEventDispatcher();</script><button onclick={() => dispatch("go")}>Go</button>',
  ]) {
    const [result] = await lint.lintText(source, { filePath: 'src/frontend/Legacy.svelte' });
    assert.ok(result.errorCount > 0, JSON.stringify(result.messages));
  }
});
