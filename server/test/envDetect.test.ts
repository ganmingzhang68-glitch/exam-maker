import assert from 'node:assert/strict';
import test from 'node:test';
import { detectEnvironment, envReport } from '../src/services/envDetect.js';

test('environment detector honors explicit executable paths and probes Python packages', () => {
  const calls: Array<[string, string[]]> = [];
  const run = (executable: string, args: string[]) => {
    calls.push([executable, args]);
    if (args.join(' ') === '-c import sympy' || args.join(' ') === '-c import numpy') return '';
    if (executable === 'C:\\tools\\python.exe') return 'Python 3.13.2';
    if (executable === 'C:\\tools\\pandoc.exe') return 'pandoc 3.9.0.2\nfeatures';
    if (executable === 'C:\\tools\\xelatex.exe') return 'MiKTeX-XeTeX 4.10';
    if (executable === 'C:\\tools\\soffice.exe') return 'LibreOffice 25.2';
    throw new Error('not found');
  };
  const env = detectEnvironment({
    platform: 'win32', run, findOnPath: () => [], exists: () => false,
    env: {
      PYTHON_EXECUTABLE: 'C:\\tools\\python.exe', PANDOC_EXECUTABLE: 'C:\\tools\\pandoc.exe',
      LATEX_EXECUTABLE: 'C:\\tools\\xelatex.exe', SOFFICE_EXECUTABLE: 'C:\\tools\\soffice.exe',
      AI_API_KEY: 'not-logged', AI_PROVIDER: 'test', AI_MODEL: 'test-model',
    },
  });
  assert.equal(env.python.version, 'Python 3.13.2');
  assert.equal(env.python.hasSympy, true); assert.equal(env.python.hasNumpy, true);
  assert.equal(env.pandoc.executable, 'C:\\tools\\pandoc.exe');
  assert.equal(env.latex.engine, 'xelatex'); assert.equal(env.soffice.available, true);
  assert.equal(JSON.stringify(env).includes('not-logged'), false);
  assert.ok(calls.some(([exe, args]) => exe === 'C:\\tools\\python.exe' && args[1] === 'import sympy'));
});

test('environment detector distinguishes inaccessible executables from missing tools', () => {
  const env = detectEnvironment({
    platform: 'win32', run: () => { throw new Error('EACCES'); }, findOnPath: (names) => names[0] === 'pandoc' ? ['C:\\blocked\\pandoc.exe'] : [], exists: () => false, env: {},
  });
  assert.equal(env.pandoc.availability, 'not_executable');
  assert.equal(env.pandoc.available, false);
  assert.equal(env.soffice.availability, 'not_found');
  assert.match(envReport(env), /已找到但当前后端进程无法执行/);
});
