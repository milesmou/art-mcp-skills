import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const { runWeightSolver } = require('../dist/spine/external-tools');
const { configManager } = require('../dist/config-manager');
const { toolMap } = require('../dist/tools/registry');
const { exportProjectDocuments } = require('../dist/spine/rebuild-service');
const { inspectMesh } = require('../dist/spine/mesh-edit-service');
const { projectHash } = require('../dist/spine/project-lock');
const cfg = configManager.load({ logLevel: 'error' });

test('Real libigl computes bounded, smooth weights with exact pins on a planar grid', { timeout: 120000 }, async () => {
  const vertices = [], triangles = [];
  for (let y = 0; y <= 4; y++) for (let x = 0; x <= 4; x++) vertices.push([x, y]);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const i = y * 5 + x; triangles.push([i, i + 1, i + 5], [i + 1, i + 6, i + 5]); }
  const result = await runWeightSolver({ vertices, triangles, bones: [[0, 0, 0, 4], [4, 0, 4, 4]],
    pins: [0, 5, 10, 15, 20].map(vertexIndex => ({ vertexIndex, boneIndex: 0 })).concat([4, 9, 14, 19, 24].map(vertexIndex => ({ vertexIndex, boneIndex: 1 }))) });
  assert.equal(result.backend, 'libigl-bbw'); assert.equal(result.weights.length, 25);
  for (const w of result.weights) { assert.ok(w.every(v => v >= 0 && v <= 1)); assert.ok(Math.abs(w.reduce((a, b) => a + b) - 1) < 1e-8); }
  assert.ok(result.weights[12][0] > 0.2 && result.weights[12][0] < 0.8);
  assert.ok(result.weights[11][0] > result.weights[13][0]);
  assert.deepEqual(result.weights[0], [1, 0]); assert.deepEqual(result.weights[4], [0, 1]);
  await assert.rejects(runWeightSolver({ vertices, triangles: [[0, 0, 1]], bones: [[0, 0, 1, 1]] }), /Degenerate/);
});

test('Real Spine CLI preserves generated topology and BBW weights; official pack verifies multiple pages',
  { skip: !cfg.spineExe || !fs.existsSync(cfg.spineExe), timeout: 360000 }, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-external-live-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const images = path.join(dir, 'images'); fs.mkdirSync(images);
    const imagePath = path.join(images, 'part.png');
    await sharp({ create: { width: 48, height: 48, channels: 4, background: '#ff8855' } }).png().toFile(imagePath);
    for (const [name, color] of [['other', '#44ff88'], ['third', '#8866ff']]) await sharp({ create: { width: 48, height: 48, channels: 4, background: color } }).png().toFile(path.join(images, `${name}.png`));
    const source = path.join(dir, 'source.json'), project = path.join(dir, 'hero.spine');
    fs.writeFileSync(source, JSON.stringify({ skeleton: { spine: '3.8', images: './images/', fps: 24 },
      bones: [{ name: 'root' }, { name: 'left', parent: 'root', x: -18, y: -24, rotation: 90, length: 48 }, { name: 'right', parent: 'root', x: 18, y: -24, rotation: 90, length: 48 }],
      slots: [{ name: 'slot', bone: 'root', attachment: 'part' }], skins: [{ name: 'default', attachments: { slot: { part: { width: 48, height: 48 } } } }],
      animations: { idle: { bones: { left: { rotate: [{}, { time: 1, angle: 15 }] } } } } }));
    async function call(name, args) { const result = await toolMap[name].execute(args); assert.ok(result.success, `${name}: ${result.message}`); return result; }
    await call('spine_rebuild_project', { projectPath: project, jsonPath: source, skeletonName: 'hero' });
    const target = { projectPath: project, slotName: 'slot', attachmentName: 'part' };
    const hash = projectHash(project);
    await call('spine_generate_mesh', { ...target, imagePath, spacing: 12, dryRun: true });
    assert.equal(projectHash(project), hash);
    const generated = await call('spine_generate_mesh', { ...target, imagePath, spacing: 12 });
    assert.ok(generated.data.verified); assert.ok(generated.data.vertexCount > 4);
    const before = (await exportProjectDocuments(project, path.join(dir, 'mesh'))).documents[0].json;
    const positions = inspectMesh(before, { slotName: 'slot', attachmentName: 'part' }).vertices;
    const meshedHash = projectHash(project);
    await call('spine_auto_weights', { ...target, bones: ['left', 'right'], dryRun: true });
    assert.equal(projectHash(project), meshedHash);
    const weighted = await call('spine_auto_weights', { ...target, bones: ['left', 'right'] });
    assert.ok(weighted.data.verified); assert.equal(weighted.data.backend, 'libigl-bbw');
    const after = (await exportProjectDocuments(project, path.join(dir, 'weighted'))).documents[0].json;
    const inspected = inspectMesh(after, { slotName: 'slot', attachmentName: 'part' });
    assert.equal(inspected.weighted, true); assert.equal(inspected.vertexCount, positions.length);
    positions.forEach((v, i) => { assert.ok(Math.abs(v.worldX - inspected.vertices[i].worldX) < 0.03); assert.ok(Math.abs(v.worldY - inspected.vertices[i].worldY) < 0.03); });
    assert.equal(after.animations.idle.bones.left.rotate[1].angle, 15);
    const packed = await call('spine_pack_atlas', { inputDir: images, outputDir: path.join(dir, 'packed'), atlasName: 'hero',
      projectPath: project, settings: { maxWidth: 64, maxHeight: 64, rotation: true, premultiplyAlpha: true, paddingX: 2, paddingY: 2, stripWhitespaceX: false, stripWhitespaceY: false } });
    assert.ok(packed.data.pages.length >= 3, JSON.stringify(packed.data));
    assert.ok(packed.data.pages.every(p => p.width <= 64 && p.height <= 64));
    const reportDir = path.resolve('out/external-tools-check'); fs.mkdirSync(reportDir, { recursive: true });
    fs.writeFileSync(path.join(reportDir, 'result.json'), JSON.stringify({ generatedVertices: generated.data.vertexCount, weightedVertices: inspected.vertexCount,
      backend: weighted.data.backend, atlasPages: packed.data.pages.map(({ width, height }) => ({ width, height })), verified: true }, null, 2));
  });
