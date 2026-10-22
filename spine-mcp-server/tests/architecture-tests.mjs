import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { requireAdapter, registeredAdapters } = require('../dist/spine/adapters/registry');
const { withProjectContext, adapterForJson, projectMetadata } = require('../dist/spine/project-context');
const { runInProjectContext, currentProjectContext } = require('../dist/spine/execution-context');
const { configManager } = require('../dist/config-manager');
const { cliExecutor } = require('../dist/spine/cli-executor');
const { readSkeletonData } = require('../dist/spine/runtime-core');
const { validateRebuildJson } = require('../dist/spine/rebuild-validation');
const { createProjectFromJson } = require('../dist/spine/rebuild-service');
const { toolMap } = require('../dist/tools/registry');
const { renderRuntimeFrame, renderRuntimeFrameToPng, isRuntimeRenderAvailable } = require('../dist/spine/render-runtime');
const { renderFrameToRgba } = require('../dist/spine/render-service');
const childProcess = require('node:child_process');
const fixture = (version = '3.8.99') => ({ skeleton: { spine: version }, bones: [{ name: 'root' }], animations: {} });
function temp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-architecture-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function mockSpawns(t, output) {
  const previous = childProcess.spawn, saved = { ...configManager.get() }, calls = [];
  configManager.load({ spineExe: process.execPath, spineVersion: '3.8', cliTimeoutMs: 5000, logLevel: 'error' });
  childProcess.spawn = (exe, args) => {
    calls.push({ exe, args });
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from(output(args))); child.emit('close', 0); });
    return child;
  };
  t.after(() => { childProcess.spawn = previous; configManager.load(saved); });
  return calls;
}

test('Registry advertises frozen 3.8 support and a metadata-only 4.2 placeholder', () => {
  assert.deepEqual(registeredAdapters().map(a => a.family), ['3.8', '4.2']);
  const a = requireAdapter('3.8.99', 'mesh.deform');
  assert.ok(Object.isFrozen(a)); assert.ok(Object.isFrozen(a.capabilities));
  assert.ok(Object.isFrozen(a.capabilities['mesh.deform']));
  const pending = requireAdapter('4.2.75', 'metadata.read');
  assert.equal(pending.status, 'planned');
  for (const [name, state] of Object.entries(pending.capabilities)) assert.equal(state.supported, name === 'metadata.read');
  assert.throws(() => requireAdapter('4.2', 'project.rebuild'), { code: 'E_UNSUPPORTED_CAPABILITY' });
  assert.throws(() => requireAdapter('4.1.0'), { code: 'E_UNSUPPORTED_VERSION' });
  assert.throws(() => requireAdapter('3.80.1'), { code: 'E_UNSUPPORTED_VERSION' });
});

test('4.2 metadata is queryable without CLI, while JSON read, runtime, preview and rebuild reject before writing', async t => {
  const dir = temp(t), source = path.join(dir, 'future.json'), project = path.join(dir, 'future.spine');
  const json = { ...fixture('4.2.75'), physics: [{ name: 'cloth', bone: 'root', inertia: 1 }] };
  fs.writeFileSync(source, JSON.stringify(json));
  const calls = mockSpawns(t, () => { throw new Error('CLI must not run'); });
  assert.deepEqual(await projectMetadata(source), { sourceVersion: '4.2.75' });
  const result = await toolMap.spine_get_capabilities.execute({ projectPath: source });
  assert.equal(result.success, true); assert.equal(result.data.adapters[0].status, 'planned');
  assert.equal(result.data.migrationSupported, false);
  const read = await toolMap.spine_get_project_info.execute({ projectPath: source });
  assert.equal(read.errorCode, 'E_UNSUPPORTED_CAPABILITY');
  const describe = await toolMap.spine_describe.execute({ skeletonJson: source });
  assert.equal(describe.errorCode, 'E_UNSUPPORTED_CAPABILITY');
  assert.throws(() => readSkeletonData(json), { code: 'E_UNSUPPORTED_CAPABILITY' });
  assert.throws(() => validateRebuildJson(json), { code: 'E_UNSUPPORTED_CAPABILITY' });
  await assert.rejects(renderRuntimeFrame({ skeletonJsonPath: source }), { code: 'E_UNSUPPORTED_CAPABILITY' });
  await assert.rejects(renderFrameToRgba(json), { code: 'E_UNSUPPORTED_CAPABILITY' });
  await assert.rejects(createProjectFromJson(project, json, 'future'), { code: 'E_UNSUPPORTED_CAPABILITY' });
  assert.equal(calls.length, 0);
  assert.deepEqual(fs.readdirSync(dir), ['future.json']);
  assert.deepEqual(JSON.parse(fs.readFileSync(source, 'utf8')), json);
});

test('Two asynchronous project jobs pin independent editor patches and snapshot global configuration', async t => {
  const dir = temp(t), projects = ['3.8.75', '3.8.99'].map(v => path.join(dir, `${v}.spine`));
  for (const p of projects) fs.writeFileSync(p, 'unchanged');
  const calls = mockSpawns(t, args => {
    const file = args[args.indexOf('-i') + 1], version = path.basename(file, '.spine');
    const selected = args[1] === 'project' ? version : args[1];
    return `Spine Launcher 4.3.06\nSpine ${selected} Professional\nSpine version: ${version}\n`;
  });
  const contexts = []; let release;
  const barrier = new Promise(resolve => { release = resolve; });
  const jobs = projects.map(p => withProjectContext(p, 'legacy.edit', async () => {
    const context = currentProjectContext(); contexts.push(context);
    if (contexts.length === 2) {
      configManager.load({ spineExe: 'missing-after-snapshot', spineVersion: '4.2.75', cliTimeoutMs: 1, logLevel: 'error' });
      release();
    }
    await barrier;
    assert.ok(Object.isFrozen(context)); assert.equal(currentProjectContext(), context);
    await cliExecutor.exec({ args: ['-i', p] });
    return context;
  }));
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map(c => c.editorVersion), ['3.8.75', '3.8.99']);
  for (const c of results) assert.equal(c.spineExe, process.execPath);
  assert.deepEqual(calls.filter(c => c.args[1] !== 'project').map(c => c.args[1]).sort(), ['3.8.75', '3.8.99']);
  for (const p of projects) assert.equal(fs.readFileSync(p, 'utf8'), 'unchanged');
  assert.equal(currentProjectContext(), undefined);
});

test('Context rejects cross-series JSON, version flag overrides and launcher fallback', async t => {
  mockSpawns(t, () => 'Spine 3.8.99 Professional\n');
  const context = { projectPath: path.resolve('fixture.spine'), sourceVersion: '3.8.75', family: '3.8', editorVersion: '3.8.75',
    spineExe: process.execPath, cliTimeoutMs: 5000, adapter: requireAdapter('3.8') };
  await runInProjectContext(context, async () => {
    assert.throws(() => adapterForJson(fixture('4.2.75'), 'metadata.read'), { code: 'E_VERSION_CONFLICT' });
    await assert.rejects(cliExecutor.exec({ args: ['-u', '3.8.99', '-i', 'fixture.spine'] }), { code: 'E_VERSION_CONFLICT' });
    await assert.rejects(cliExecutor.exec({ args: ['-u', '3.8.75', '--update', '3.8.99', '-i', 'fixture.spine'] }), { code: 'E_VERSION_CONFLICT' });
    await assert.rejects(cliExecutor.exec({ args: ['-i', 'fixture.spine'], execution: configManager.get() }), { code: 'E_VERSION_CONFLICT' });
    await assert.rejects(cliExecutor.exec({ args: ['-i', 'fixture.spine'] }), { code: 'E_VERSION_CONFLICT' });
  });
});

test('Native 4.2 projects allow read-only metadata probing but never enter an editing callback', async t => {
  const dir = temp(t), p = path.join(dir, 'future.spine'); fs.writeFileSync(p, 'original');
  const calls = mockSpawns(t, () => 'Spine 4.2.75 Professional\nSpine version: 4.2.75\n');
  let edited = false;
  await assert.rejects(withProjectContext(p, 'legacy.edit', async () => { edited = true; }), { code: 'E_UNSUPPORTED_CAPABILITY' });
  assert.equal(edited, false); assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['-u', 'project', '-i', p]);
  assert.equal(fs.readFileSync(p, 'utf8'), 'original');
  assert.deepEqual(fs.readdirSync(dir), ['future.spine']);
});

test('Explicit editor patch is honored within a family and rejected across families', async t => {
  const dir = temp(t), p = path.join(dir, 'source.spine'); fs.writeFileSync(p, 'original');
  mockSpawns(t, () => 'Spine 3.8.99 Professional\nSpine version: 3.8.99\n');
  configManager.load({ spineVersion: '3.8.75', logLevel: 'error' });
  await withProjectContext(p, 'project.read', async () => assert.equal(currentProjectContext().editorVersion, '3.8.75'));
  configManager.load({ spineVersion: '4.2.75', logLevel: 'error' });
  await assert.rejects(withProjectContext(p, 'project.read', async () => {}), { code: 'E_VERSION_CONFLICT' });
});

test('Nested jobs on another project restore the outer immutable context', async t => {
  const dir = temp(t), a = path.join(dir, 'a.spine'), b = path.join(dir, 'b.spine');
  fs.writeFileSync(a, 'a'); fs.writeFileSync(b, 'b');
  mockSpawns(t, () => 'Spine 3.8.99 Professional\nSpine version: 3.8.99\n');
  await withProjectContext(a, 'project.read', async () => {
    const outer = currentProjectContext();
    await withProjectContext(b, 'project.read', async () => {
      assert.equal(currentProjectContext().projectPath, b);
      assert.notEqual(currentProjectContext(), outer);
    });
    assert.equal(currentProjectContext(), outer);
  });
});

test('3.8 official preview renders in an isolated VM and preserves the public PNG API', async t => {
  const sentinel = { unrelated: true }, saved = globalThis.spine;
  globalThis.spine = sentinel;
  t.after(() => { if (saved === undefined) delete globalThis.spine; else globalThis.spine = saved; });
  if (!isRuntimeRenderAvailable()) { t.skip('optional node-canvas is unavailable'); return; }
  assert.equal(globalThis.spine, sentinel);
  const sharp = require('sharp'), dir = temp(t);
  const imagePath = path.join(dir, 'page.png'), atlasPath = path.join(dir, 'test.atlas'), skeletonJsonPath = path.join(dir, 'test.json');
  await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ff4020' } }).png().toFile(imagePath);
  fs.writeFileSync(atlasPath, 'page.png\nsize: 8,8\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\npart\n  rotate: false\n  xy: 0,0\n  size: 8,8\n  orig: 8,8\n  offset: 0,0\n  index: -1\n');
  const json = fixture(); json.slots = [{ name: 'slot', bone: 'root', attachment: 'part' }];
  json.skins = [{ name: 'default', attachments: { slot: { part: { width: 8, height: 8 } } } }];
  json.animations = { idle: {} }; fs.writeFileSync(skeletonJsonPath, JSON.stringify(json));
  const options = { skeletonJsonPath, atlasPath, imagePath, width: 64, height: 64, animationName: 'idle', outputPath: path.join(dir, 'preview.png') };
  const frame = await renderRuntimeFrame(options);
  assert.equal(frame.rgba.length, 64 * 64 * 4); assert.ok(frame.rgba.some((v, i) => i % 4 === 3 && v > 0));
  const result = await renderRuntimeFrameToPng(options);
  assert.equal(result.width, 64); assert.equal(result.animationName, 'idle');
  assert.equal((await sharp(options.outputPath).metadata()).format, 'png');
  assert.equal(globalThis.spine, sentinel);
});
