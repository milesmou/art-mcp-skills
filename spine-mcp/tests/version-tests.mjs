import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SUPPORTED_SPINE_VERSION, isSupportedSpineVersion } = require('../dist/constants');
const { versionValidator } = require('../dist/spine/version-validator');
const { parseProjectJson } = require('../dist/spine/project-reader');
const { checkProject } = require('../dist/spine/check-service');
const modifyService = require('../dist/spine/modify-service');
const { configManager } = require('../dist/config-manager');
const { cliExecutor } = require('../dist/spine/cli-executor');

test('Version matching accepts all 3.8 patches and rejects other series or malformed values', () => {
  assert.equal(SUPPORTED_SPINE_VERSION, '3.8');
  for (const v of ['3.8', '3.8.0', '3.8.55', '3.8.75', '3.8.99', '3.8.123']) {
    assert.equal(isSupportedSpineVersion(v), true, v);
    assert.equal(versionValidator.isSupported(v), true, v);
  }
  for (const v of ['3.7.99', '3.9.0', '4.0.0', '3.80.1', '3.8x', '3.8.99.1', '3.8.99-beta', '', 'unknown', null, 3.8]) {
    assert.equal(isSupportedSpineVersion(v), false, String(v));
    assert.equal(versionValidator.isSupported(v), false, String(v));
  }
});

test('JSON detection, project reading and health checks agree on 3.8 compatibility', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-version-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const originalRead = modifyService.readJsonForExport;
  modifyService.readJsonForExport = async file => JSON.parse(fs.readFileSync(file, 'utf8'));
  t.after(() => { modifyService.readJsonForExport = originalRead; });
  for (const version of ['3.8', '3.8.0', '3.8.55', '3.8.75', '3.8.99', '3.8.123', '3.7.99', '4.0.0', '3.80.1']) {
    const json = { skeleton: { spine: version }, bones: [{ name: 'root' }], animations: {} };
    const file = path.join(dir, `${version}.json`);
    fs.writeFileSync(file, JSON.stringify(json));
    const expected = isSupportedSpineVersion(version);
    const detected = await versionValidator.detect(file);
    assert.equal(detected.isSupported, expected, version);
    assert.equal(Boolean(detected.warning), !expected, version);
    assert.equal(Boolean(parseProjectJson(json).compatibilityWarning), !expected, version);
    assert.equal((await checkProject(file)).version.compatible, expected, version);
  }
});

test('Binary project detection uses editor/project version instead of launcher version', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-version-info-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'fixture.spine');
  fs.writeFileSync(file, 'fixture');
  const original = cliExecutor.execToString;
  t.after(() => { cliExecutor.execToString = original; });
  for (const version of ['3.8', '3.8.75', '3.8.99', '4.0.0']) {
    cliExecutor.execToString = async () => `Spine Launcher 4.3.06\nSpine version: ${version}\n`;
    const result = await versionValidator.detect(file);
    assert.equal(result.version, version);
    assert.equal(result.isSupported, isSupportedSpineVersion(version));
  }
  cliExecutor.execToString = async () => 'Spine Launcher 4.3.06\nSpine 3.8.75 Professional\n';
  assert.equal((await versionValidator.detect(file)).version, '3.8.75');
  cliExecutor.execToString = async () => 'Spine Launcher 4.3.06\n';
  await assert.rejects(versionValidator.detect(file), /无法.*识别版本/);
});

test('Default configuration selects 3.8 and preserves explicit patch overrides', t => {
  const savedConfig = { ...configManager.get() };
  const savedEnv = process.env.SPINE_VERSION;
  t.after(() => {
    if (savedEnv === undefined) delete process.env.SPINE_VERSION;
    else process.env.SPINE_VERSION = savedEnv;
    configManager.load(savedConfig);
  });
  process.env.SPINE_VERSION = '';
  assert.equal(configManager.load({ spineExe: process.execPath, logLevel: 'error' }).spineVersion, '3.8');
  process.env.SPINE_VERSION = '  ';
  assert.equal(configManager.load({ logLevel: 'error' }).spineVersion, '3.8');
  process.env.SPINE_VERSION = ' 3.8.75 ';
  assert.equal(configManager.load({ logLevel: 'error' }).spineVersion, '3.8.75');
  assert.equal(configManager.load({ spineVersion: ' 3.8.99 ', logLevel: 'error' }).spineVersion, '3.8.99');
});

test('CLI passes the selected 3.8 series or patch version without duplicating explicit flags', async t => {
  const childProcess = require('node:child_process');
  const originalSpawn = childProcess.spawn;
  const savedConfig = { ...configManager.get() };
  const calls = [];
  childProcess.spawn = (exe, args, options) => {
    calls.push({ exe, args, options });
    const child = new EventEmitter();
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  };
  t.after(() => { childProcess.spawn = originalSpawn; configManager.load(savedConfig); });
  configManager.load({ spineExe: process.execPath, spineVersion: '3.8', logLevel: 'error' });
  await cliExecutor.exec({ args: ['-i', 'fixture.spine'] });
  assert.deepEqual(calls.at(-1).args, ['-u', '3.8', '-i', 'fixture.spine']);
  assert.equal(calls.at(-1).options.windowsHide, true);
  configManager.load({ spineExe: process.execPath, spineVersion: '3.8.75', logLevel: 'error' });
  await cliExecutor.exec({ args: ['-i', 'fixture.spine'] });
  assert.deepEqual(calls.at(-1).args, ['-u', '3.8.75', '-i', 'fixture.spine']);
  for (const flag of ['-u', '--update']) {
    await cliExecutor.exec({ args: [flag, '3.8.99', '-i', 'fixture.spine'] });
    assert.deepEqual(calls.at(-1).args, [flag, '3.8.99', '-i', 'fixture.spine']);
  }
});
