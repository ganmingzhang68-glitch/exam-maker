import assert from 'node:assert/strict';
import test from 'node:test';
import { isCorsOriginAllowed, readRuntimeConfig, validateRuntimeConfig } from '../src/config/runtime.js';

test('development runtime config keeps local defaults', () => {
  const config = readRuntimeConfig({});
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.port, 3001);
  assert.deepEqual(config.corsOrigins, ['http://localhost:5173']);
  assert.equal(config.trustProxy, false);
});

test('production runtime config parses proxy and explicit origins', () => {
  const env = {
    NODE_ENV: 'production',
    PORT: '3100',
    TRUST_PROXY: 'true',
    CORS_ORIGIN: 'https://exam.example.com/, https://admin.example.com',
    JWT_SECRET: 'a-secure-production-secret-with-32-characters',
  };
  const config = readRuntimeConfig(env);
  validateRuntimeConfig(config, env);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3100);
  assert.equal(config.trustProxy, true);
  assert.equal(isCorsOriginAllowed('https://exam.example.com', config), true);
  assert.equal(isCorsOriginAllowed('https://other.example.com', config), false);
});

test('production rejects weak secrets and wildcard credential origins', () => {
  const weakSecretEnv = { NODE_ENV: 'production', CORS_ORIGIN: 'https://exam.example.com', JWT_SECRET: 'short' };
  assert.throws(() => validateRuntimeConfig(readRuntimeConfig(weakSecretEnv), weakSecretEnv), /JWT_SECRET/);

  const wildcardEnv = {
    NODE_ENV: 'production',
    CORS_ORIGIN: '*',
    JWT_SECRET: 'a-secure-production-secret-with-32-characters',
  };
  assert.throws(() => validateRuntimeConfig(readRuntimeConfig(wildcardEnv), wildcardEnv), /CORS_ORIGIN/);

  const placeholderEnv = {
    NODE_ENV: 'production',
    CORS_ORIGIN: 'https://exam.example.com',
    JWT_SECRET: 'replace-with-a-random-secret-at-least-32-characters-long',
  };
  assert.throws(() => validateRuntimeConfig(readRuntimeConfig(placeholderEnv), placeholderEnv), /JWT_SECRET/);
});

test('runtime config rejects invalid ports', () => {
  assert.throws(() => readRuntimeConfig({ PORT: '70000' }), /PORT/);
  assert.throws(() => readRuntimeConfig({ PORT: 'not-a-number' }), /PORT/);
});
