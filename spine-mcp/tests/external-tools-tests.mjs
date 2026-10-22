import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { buildImageMesh, generateMesh } = require('../dist/spine/auto-mesh-service');
const { autoWeights } = require('../dist/spine/auto-weights-service');
const external = require('../dist/spine/external-tools');
const { meshInfo, inspectMesh, editWeights } = require('../dist/spine/mesh-edit-service');
const { packOfficialAtlas } = require('../dist/spine/official-pack-service');
const { parseAtlas } = require('../dist/spine/atlas-utils');
const { cliExecutor } = require('../dist/spine/cli-executor');
const { validateRebuildJson } = require('../dist/spine/rebuild-validation');
const { toolMap } = require('../dist/tools/registry');
const { configManager } = require('../dist/config-manager');
const { EventEmitter } = require('node:events');
const { runInProjectContext } = require('../dist/spine/execution-context');
const { requireAdapter } = require('../dist/spine/adapters/registry');
const target = { slotName: 'slot', attachmentName: 'part', skinName: 'default' };
function temp(t) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-external-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; }
async function image(dir, mask = () => true, size = 32) {
  const file = path.join(dir, 'part.png');
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) { const i = (y * size + x) * 4; pixels[i] = 255; pixels[i + 3] = mask(x, y) ? 255 : 0; }
  await sharp(pixels, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file); return file;
}
function fixture() { return { skeleton: { spine: '3.8.99', fps: 24 }, bones: [{ name: 'root', rotation: 12, scaleX: 1.2 },
  { name: 'left', parent: 'root', x: -12, y: -16, length: 32, rotation: 90 },
  { name: 'right', parent: 'root', x: 12, y: -16, length: 32, rotation: 90 }],
  slots: [{ name: 'slot', bone: 'root', attachment: 'part' }], skins: [{ name: 'default', attachments: { slot: { part: { width: 32, height: 32, path: 'textures/part', color: 'ffaaeeff' } } } }], animations: { idle: {} } }; }

test('Alpha trace and constrained triangulation keep concave silhouettes, finite UVs and nondegenerate faces', async t => {
  const file = await image(temp(t), (x, y) => x < 12 || y > 20);
  const mesh = await buildImageMesh({ imagePath: file, spacing: 4, simplify: 0 });
  assert.ok(mesh.hull >= 6); assert.ok(mesh.points.length > mesh.hull);
  assert.equal(mesh.uvs.length, mesh.points.length * 2);
  assert.ok(mesh.uvs.every(v => Number.isFinite(v) && v >= 0 && v <= 1));
  let area = 0;
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const p = mesh.triangles.slice(i, i + 3).map(j => mesh.points[j]);
    const x = p.reduce((s, a) => s + a[0], 0) / 3, y = p.reduce((s, a) => s + a[1], 0) / 3;
    assert.ok(x <= 12 || y >= 21, `triangle spills into concavity: ${x},${y}`);
    const cross = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    assert.notEqual(cross, 0); area += Math.abs(cross) / 2;
  }
  assert.equal(area, 12 * 32 + 20 * 11);
});

test('Regular grids sample the entire boundary and avoid thin border triangles on long attachments', async t => {
  const file = path.join(temp(t), 'hair.png');
  await sharp({ create: { width: 236, height: 799, channels: 4, background: '#ffffffff' } }).png().toFile(file);
  const mesh = await buildImageMesh({ imagePath: file, mode: 'grid', spacing: 57 });
  assert.equal(mesh.points.length, 6 * 16); assert.equal(mesh.hull, 2 * (5 + 15));
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [a, b, c] = mesh.triangles.slice(i, i + 3).map(j => mesh.points[j]);
    const twiceArea = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    assert.ok(Math.abs(twiceArea - 236 / 5 * 799 / 15) < 1e-6);
  }
});

test('Transparent images, islands, tiny components, holes and vertex budgets have explicit behavior', async t => {
  const dir = temp(t);
  let file = await image(dir, () => false);
  await assert.rejects(buildImageMesh({ imagePath: file }), /没有可用轮廓/);
  assert.equal((await buildImageMesh({ imagePath: file, mode: 'grid', spacing: 64 })).points.length, 4);
  file = await image(dir, (x, y) => (x < 8 && y < 8) || (x > 20 && y > 20));
  await assert.rejects(buildImageMesh({ imagePath: file }), /独立区域/);
  const largest = await buildImageMesh({ imagePath: file, islandMode: 'largest' });
  assert.equal(largest.islands, 2); assert.ok(largest.points.every(([x, y]) => x >= 21 && y >= 21));
  file = await image(dir, (x, y) => x === 15 && y === 15);
  assert.equal((await buildImageMesh({ imagePath: file, simplify: 0 })).points.length, 4);
  file = await image(dir, (x, y) => !(x > 8 && x < 24 && y > 8 && y < 24));
  assert.equal((await buildImageMesh({ imagePath: file })).filledHoles, 1);
  await assert.rejects(buildImageMesh({ imagePath: file, spacing: 1, maxVertices: 10 }), /maxVertices/);
  file = await image(dir, (x, y) => (x === 4 && y === 4) || (x === 5 && y === 5));
  await assert.rejects(buildImageMesh({ imagePath: file }), /独立区域/);
});

test('Region mesh conversion preserves setup image transform, UV orientation and attachment identity', async t => {
  const file = await image(temp(t)), json = fixture();
  Object.assign(json.skins[0].attachments.slot.part, { x: 3, y: -5, rotation: 30, scaleX: 1.4, scaleY: 0.7 });
  const original = structuredClone(json.skins[0].attachments.slot.part);
  const result = await generateMesh(json, target, { imagePath: file, spacing: 8 });
  assert.ok(result.vertexCount > 4); validateRebuildJson(json);
  const a = json.skins[0].attachments.slot.part;
  assert.equal(a.path, original.path); assert.equal(a.color, original.color);
  for (let i = 0; i < a.uvs.length; i += 2) {
    const x = (a.uvs[i] - 0.5) * 32 * 1.4, y = (0.5 - a.uvs[i + 1]) * 32 * 0.7;
    assert.ok(Math.abs(a.vertices[i] - (3 + x * Math.cos(Math.PI / 6) - y * Math.sin(Math.PI / 6))) < 1e-8);
    assert.ok(Math.abs(a.vertices[i + 1] - (-5 + x * Math.sin(Math.PI / 6) + y * Math.cos(Math.PI / 6))) < 1e-8);
  }
  await assert.rejects(generateMesh(json, target, { imagePath: file }), /replaceExisting/);
});

test('Topology replacement and BBW reject existing FFD/linked meshes before solver or mutation', async t => {
  const file = await image(temp(t)), json = fixture();
  await generateMesh(json, target, { imagePath: file });
  json.animations.idle.deform = { default: { slot: { part: [{ vertices: [1, 2] }] } } };
  let original = JSON.stringify(json);
  await assert.rejects(autoWeights(json, target, { bones: ['left', 'right'] }), /deformPolicy/);
  await assert.rejects(generateMesh(json, target, { imagePath: file, replaceExisting: true }), /deformPolicy/);
  assert.equal(JSON.stringify(json), original);
  json.skins[0].attachments.slot.linked = { type: 'mesh', parent: 'part' };
  await assert.rejects(autoWeights(json, target, { bones: ['left'], deformPolicy: 'clear' }), /关联网格/);
});

test('Replacing a weighted mesh resamples its setup shape and clears FFD only when explicitly requested', async t => {
  const file = await image(temp(t)), json = fixture();
  await generateMesh(json, target, { imagePath: file, spacing: 16 });
  const attachment = json.skins[0].attachments.slot.part;
  const center = attachment.uvs.findIndex((v, i) => i % 2 === 0 && v === 0.5 && attachment.uvs[i + 1] === 0.5) / 2;
  assert.ok(center >= 0); attachment.vertices[center * 2] += 5;
  editWeights(json, target, { action: 'set', influences: [{ boneName: 'left', weight: 0.6 }, { boneName: 'right', weight: 0.4 }] });
  const centerBefore = inspectMesh(json, target).vertices[center];
  json.animations.idle.deform = { default: { slot: { part: [{ vertices: [1, 2] }] } } };
  const result = await generateMesh(json, target, { imagePath: file, spacing: 8, replaceExisting: true, deformPolicy: 'clear' });
  assert.equal(result.clearedDeformAnimations, 1); assert.equal(json.animations.idle.deform.default.slot.part, undefined);
  assert.equal(meshInfo(json, target).weighted, false); validateRebuildJson(json);
  const at = attachment.uvs.findIndex((v, i) => i % 2 === 0 && v === 0.5 && attachment.uvs[i + 1] === 0.5) / 2;
  const centerAfter = inspectMesh(json, target).vertices[at];
  assert.ok(Math.abs(centerAfter.worldX - centerBefore.worldX) < 1e-5); assert.ok(Math.abs(centerAfter.worldY - centerBefore.worldY) < 1e-5);
});

test('Auto weights map distinct per-vertex influences into Spine bind space without moving setup vertices', async t => {
  const file = await image(temp(t)), json = fixture();
  await generateMesh(json, target, { imagePath: file, spacing: 8 });
  const before = inspectMesh(json, target).vertices;
  const saved = external.runWeightSolver;
  external.runWeightSolver = async input => ({ weights: input.vertices.map((_, i) => i % 2 ? [0.25, 0.75] : [1, 0]), pins: [] });
  t.after(() => { external.runWeightSolver = saved; });
  const result = await autoWeights(json, target, { bones: ['left', 'right'], maxInfluences: 2 });
  assert.equal(result.backend, 'libigl-bbw'); validateRebuildJson(json);
  const after = inspectMesh(json, target).vertices;
  before.forEach((v, i) => { assert.ok(Math.abs(v.worldX - after[i].worldX) < 1e-5); assert.ok(Math.abs(v.worldY - after[i].worldY) < 1e-5); });
  assert.equal(meshInfo(json, target).vertices[0].length, 1); assert.equal(meshInfo(json, target).vertices[1].length, 2);
  external.runWeightSolver = async input => ({ weights: input.vertices.map(() => [NaN, 1]) });
  const original = JSON.stringify(json);
  await assert.rejects(autoWeights(json, target, { bones: ['left', 'right'] }), /无效/);
  assert.equal(JSON.stringify(json), original);
  await assert.rejects(autoWeights(json, target, { bones: ['left', 'left'] }), /重复/);
  await assert.rejects(autoWeights(json, target, { bones: ['missing'] }), /不存在/);
});

const atlasPage = (name, region) => `${name}\nsize: 8,8\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n${region}\n  rotate: false\n  xy: 0,0\n  size: 8,8\n  orig: 8,8\n  offset: 0,0\n  index: -1\n`;
test('Official pack stages settings, verifies all pages and never overwrites an existing output', async t => {
  const dir = temp(t), input = path.join(dir, 'input'), output = path.join(dir, 'output'); fs.mkdirSync(input);
  const saved = cliExecutor.exec; let calls = 0;
  cliExecutor.exec = async ({ args }) => {
    calls++;
    assert.equal(args[args.indexOf('-i') + 1], fs.realpathSync(input));
    const settings = JSON.parse(fs.readFileSync(args[args.indexOf('-p') + 1], 'utf8'));
    assert.equal(settings.rotation, true); assert.equal(settings.outputFormat, 'png');
    const stage = args[args.indexOf('-o') + 1];
    for (const name of ['hero.png', 'hero2.png']) await sharp({ create: { width: 8, height: 8, channels: 4, background: '#ffffff' } }).png().toFile(path.join(stage, name));
    fs.writeFileSync(path.join(stage, 'hero.atlas'), atlasPage('hero.png', 'first') + '\n' + atlasPage('hero2.png', 'second'));
    return { exitCode: 0 };
  };
  t.after(() => { cliExecutor.exec = saved; });
  const result = await packOfficialAtlas({ inputDir: input, outputDir: output, atlasName: 'hero', settings: { rotation: true } });
  assert.equal(result.pages.length, 2); assert.equal(result.files.length, 3);
  const parsed = parseAtlas(fs.readFileSync(result.atlasPaths[0], 'utf8'));
  assert.deepEqual(parsed.pages.map(p => p.name), ['hero.png', 'hero2.png']);
  assert.deepEqual(parsed.regions.map(r => r.page), [0, 1]);
  await assert.rejects(packOfficialAtlas({ inputDir: input, outputDir: output }), /不存在或为空/);
  assert.equal(calls, 1); assert.deepEqual(fs.readdirSync(dir).sort(), ['input', 'output']);
  const cfg = { ...configManager.get() }; t.after(() => configManager.load(cfg));
  configManager.load({ spineVersion: '4.2', logLevel: 'error' });
  const second = { inputDir: input, outputDir: path.join(dir, 'second'), settings: { rotation: true } };
  await assert.rejects(packOfficialAtlas(second), { code: 'E_UNSUPPORTED_CAPABILITY' });
  await runInProjectContext({ projectPath: path.join(dir, 'fixture.spine'), family: '3.8', sourceVersion: '3.8.99', editorVersion: '3.8.99',
    spineExe: cfg.spineExe, cliTimeoutMs: 5000, adapter: requireAdapter('3.8') }, () => packOfficialAtlas(second));
  assert.equal(calls, 2); assert.ok(fs.existsSync(path.join(dir, 'second', 'hero.atlas')));
});

test('Invalid pack output is discarded and input/output paths with spaces are handled as arguments', async t => {
  const dir = temp(t), input = path.join(dir, 'input with spaces'), output = path.join(dir, 'new output'); fs.mkdirSync(input);
  const saved = cliExecutor.exec;
  cliExecutor.exec = async ({ args }) => { fs.writeFileSync(path.join(args[args.indexOf('-o') + 1], 'broken.atlas'), atlasPage('../outside.png', 'part')); };
  t.after(() => { cliExecutor.exec = saved; });
  await assert.rejects(packOfficialAtlas({ inputDir: input, outputDir: output }), /不存在的图片/);
  assert.equal(fs.existsSync(output), false); assert.deepEqual(fs.readdirSync(dir), ['input with spaces']);
  assert.equal((await toolMap.spine_pack_atlas.execute({ inputDir: input, outputDir: output, settings: {}, packSettingsPath: 'x' })).success, false);
});

test('Missing Python/dependencies and solver timeouts return explicit errors instead of fallback weights', async t => {
  const childProcess = require('node:child_process'), savedSpawn = childProcess.spawn, cfg = { ...configManager.get() };
  t.after(() => { childProcess.spawn = savedSpawn; configManager.load(cfg); });
  configManager.load({ externalToolsPython: 'missing-python-executable', externalToolsTimeoutMs: 1000, logLevel: 'error' });
  await assert.rejects(external.runWeightSolver({}), { code: 'E_EXTERNAL_TOOL_MISSING' });
  childProcess.spawn = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stderr.emit('data', Buffer.from("ModuleNotFoundError: No module named 'igl'")); child.emit('close', 1); });
    return child;
  };
  await assert.rejects(external.runWeightSolver({}), { code: 'E_EXTERNAL_TOOL_MISSING' });
  let killed = false;
  childProcess.spawn = () => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => { killed = true; }; return child; };
  configManager.load({ externalToolsTimeoutMs: 20, logLevel: 'error' });
  await assert.rejects(external.runWeightSolver({}), { code: 'E_EXTERNAL_TOOL_TIMEOUT' }); assert.equal(killed, true);
});
