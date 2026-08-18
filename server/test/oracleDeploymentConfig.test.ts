import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const deploymentRoot = resolve(repoRoot, 'deploy', 'oracle');
const read = (name: string) => readFileSync(resolve(deploymentRoot, name), 'utf8');

test('Oracle deployment keeps the API private and suppresses query-token proxy logs', () => {
  const nginx = read('nginx.conf');
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3001/);
  assert.match(nginx, /events\|download/);
  assert.match(nginx, /access_log off/);
  assert.match(nginx, /client_max_body_size 52m/);
  assert.doesNotMatch(nginx, /5173/);
});

test('Oracle systemd deployment is single-process, restartable and data-scoped', () => {
  const unit = read('exam-maker.service');
  assert.match(unit, /ExecStart=\/usr\/bin\/node .*server\/dist\/index\.js/);
  assert.match(unit, /Restart=on-failure/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.match(unit, /ReadWritePaths=.*server\/data/);
  assert.doesNotMatch(unit, /pm2|cluster|instances/iu);
});

test('Oracle environment template contains placeholders rather than live secrets', () => {
  const template = read('env.production.example');
  assert.match(template, /^NODE_ENV=production$/m);
  assert.match(template, /^HOST=127\.0\.0\.1$/m);
  assert.match(template, /^JWT_SECRET=replace-/m);
  assert.match(template, /^AI_API_KEY=replace-/m);
  assert.doesNotMatch(template, /^AI_API_KEY=sk-[A-Za-z0-9_-]+$/m);
});

test('Oracle shell scripts use bash, LF endings and safe update/backup primitives', () => {
  for (const name of ['setup-host.sh', 'ensure-swap.sh', 'preflight.sh', 'install-service.sh', 'deploy.sh', 'backup.sh']) {
    const script = read(name);
    assert.match(script, /^#!\/usr\/bin\/env bash\n/);
    assert.equal(script.includes('\r\n'), false, `${name} must use LF endings`);
  }
  assert.match(read('deploy.sh'), /git .*pull --ff-only/);
  assert.match(read('backup.sh'), /systemctl stop/);
  assert.match(read('backup.sh'), /sha256sum/);
});
