import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const { readSkeletonData, sampleSkeleton, getCoreRuntime } = require('../dist/spine/runtime-core');
const { meshInfo, worldVertices, inspectMesh, deformMesh, editWeights } = require('../dist/spine/mesh-edit-service');
const { clothMotion } = require('../dist/spine/cloth-motion-service');
const { meshWave } = require('../dist/spine/mesh-wave-service');
const { editEvents, animationRange, manageAttachment } = require('../dist/spine/daily-edit-service');
const { validateRebuildJson, verifyRebuiltSkeleton } = require('../dist/spine/rebuild-validation');
const { toolMap } = require('../dist/tools/registry');
const { configManager } = require('../dist/config-manager');
const { cliExecutor } = require('../dist/spine/cli-executor');
const { editKeyframes } = require('../dist/spine/edit-service');

const target = { skinName: 'default', slotName: 'cloth', attachmentName: 'cloth' };
function fixture(weighted = false) {
  const points = [-20, 0, 20, 0, 20, -80, -20, -80];
  return { skeleton: { spine: '3.8', images: '', audio: '' },
    bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 12, y: 7, rotation: 32, scaleX: 1.2, scaleY: 0.8 }],
    slots: [{ name: 'cloth', bone: 'root', attachment: 'cloth' }],
    skins: [{ name: 'default', attachments: { cloth: { cloth: { type: 'mesh', width: 40, height: 80, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], hull: 4,
      vertices: weighted ? points.flatMap((v, i) => i % 2 ? [] : [2, 0, v, points[i + 1], 0.6, 1, v - 10, points[i + 1] - 5, 0.4]) : points } } } }],
    animations: { dance: { bones: { root: { translate: [{}, { time: 0.5, x: 15, y: 4 }, { time: 1 }, { time: 1.5, x: -15, y: 4 }, { time: 2 }] } } }, untouched: {} } };
}
const poseVertices = (json, time = 0, name = 'dance', t = target) => worldVertices(sampleSkeleton(readSkeletonData(json), name, time, t.skinName), t);
function close(a, b, tolerance = 0.002) { assert.equal(a.length, b.length); a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < tolerance, `${i}: ${v} != ${b[i]}`)); }

test('Mesh inspection distinguishes positive-integer unweighted coordinates from weighted vertices', () => {
  const j = fixture(); j.skins[0].attachments.cloth.cloth.vertices[0] = 12;
  assert.equal(inspectMesh(j, target).weighted, false);
  assert.equal(inspectMesh(fixture(true), target).vertices[0].influences.length, 2);
  assert.throws(() => inspectMesh(j, { ...target, skinName: 'missing' }), /附件不存在/);
});

for (const weighted of [false, true]) test(`World-space FFD moves exact logical vertices with weighted=${weighted}`, () => {
  const j = fixture(weighted), before = poseVertices(j, 0.5), offsets = [0, 0, 2, 3, -4, 2, 0, -1];
  deformMesh(j, target, { animationName: 'dance', frames: [{ time: 0.5, offsets }] });
  close(poseVertices(j, 0.5), before.map((v, i) => v + offsets[i]));
  validateRebuildJson(j);
  deformMesh(j, target, { animationName: 'dance', mode: 'add', frames: [{ time: 0.5, offsets }] });
  close(poseVertices(j, 0.5), before.map((v, i) => v + offsets[i] * 2));
  assert.throws(() => deformMesh(j, target, { animationName: 'dance', frames: [{ time: 0, offsets: [1, 2] }] }));
});

test('Slot-space FFD follows rotated and scaled slot coordinates', () => {
  const j = fixture(); j.slots[0].bone = 'arm';
  const before = poseVertices(j, 0), sk = sampleSkeleton(readSkeletonData(j), 'dance'), bone = sk.findSlot('cloth').bone;
  const offsets = [1, 2, 1, 2, 1, 2, 1, 2];
  deformMesh(j, target, { animationName: 'dance', space: 'slot', frames: [{ time: 0, offsets }] });
  close(poseVertices(j), before.map((v, i) => v + (i % 2 ? bone.c + 2 * bone.d : bone.a + 2 * bone.b)));
});

test('Weight editing binds, normalizes, prunes and smooths while preserving setup outline', () => {
  const j = fixture(), original = worldVertices(sampleSkeleton(readSkeletonData(j)), target);
  editWeights(j, target, { action: 'set', vertexIndices: [0, 1], influences: [{ boneName: 'arm', weight: 2 }, { boneName: 'root', weight: 1 }] });
  assert.equal(meshInfo(j, target).weighted, true);
  close(worldVertices(sampleSkeleton(readSkeletonData(j)), target), original);
  editWeights(j, target, { action: 'smooth', strength: 0.5 });
  editWeights(j, target, { action: 'normalize' });
  editWeights(j, target, { action: 'prune', threshold: 0.9 });
  const info = meshInfo(j, target);
  for (const v of info.vertices) assert.ok(Math.abs(v.reduce((s, i) => s + i.weight, 0) - 1) < 1e-8);
  close(worldVertices(sampleSkeleton(readSkeletonData(j)), target), original);
  validateRebuildJson(j);
  assert.throws(() => editWeights(j, target, { action: 'set', influences: [{ boneName: 'missing', weight: 1 }] }));
  assert.throws(() => editWeights(j, target, { action: 'normalize', vertexIndices: [99] }));
});

test('Weight edits reject existing FFD unless explicitly clearing it, and reject linked dependents', () => {
  const j = fixture(true);
  deformMesh(j, target, { animationName: 'dance', frames: [{ time: 0, offsets: [1, 2, 1, 2, 1, 2, 1, 2] }] });
  const before = structuredClone(j);
  assert.throws(() => editWeights(j, target, { action: 'normalize' }), /deformPolicy/);
  assert.deepEqual(j, before);
  const result = editWeights(j, target, { action: 'normalize', deformPolicy: 'clear' });
  assert.equal(result.clearedDeformAnimations, 1);
  assert.equal(j.animations.dance.deform.default.cloth.cloth, undefined);
  j.skins[0].attachments.cloth.linked = { type: 'mesh', parent: 'cloth' };
  assert.throws(() => editWeights(j, target, { action: 'normalize' }), /关联网格/);
});

test('Weight smoothing is independent of vertex selection order', () => {
  const a = fixture(true), b = structuredClone(a);
  editWeights(a, target, { action: 'smooth', vertexIndices: [0, 1, 2, 3] });
  editWeights(b, target, { action: 'smooth', vertexIndices: [3, 2, 1, 0] });
  assert.deepEqual(a, b);
});

test('Partial weight edits leave unselected influence coordinates and weights unchanged', () => {
  const j = fixture(true), before = meshInfo(j, target).vertices;
  editWeights(j, target, { action: 'set', vertexIndices: [2], influences: [{ boneName: 'arm', weight: 1 }] });
  const after = meshInfo(j, target).vertices;
  for (const index of [0, 1, 3]) assert.deepEqual(after[index], before[index]);
});

test('Normalizing already normalized weights preserves distinct influence bind coordinates', () => {
  const j = fixture(true), before = structuredClone(j);
  editWeights(j, target, { action: 'normalize' });
  assert.deepEqual(j, before);
});

test('Weighted mesh wave layers onto an existing animation and honors pinned vertices', () => {
  const j = fixture(true), before = structuredClone(j), original = structuredClone(j.animations.dance.bones);
  const result = meshWave(j, 'cloth', 'cloth', { animationName: 'dance', mode: 'add', amplitude: 2, duration: 2, cycles: 1, pinnedVertices: [0] });
  assert.equal(result.weighted, true); assert.equal(result.animationName, 'dance');
  assert.deepEqual(j.animations.dance.bones, original);
  close(poseVertices(j, 0).slice(0, 2), poseVertices(before, 0).slice(0, 2));
  close(poseVertices(j, 0), poseVertices(j, 2));
  validateRebuildJson(j);
  const legacy = fixture(); legacy.skins[0].attachments.cloth.cloth.vertices[0] = 12;
  meshWave(legacy, 'cloth', 'cloth', { duration: 1 });
  assert.ok(legacy.animations['cloth-wave']);
});

for (const weighted of [false, true]) test(`Cloth motion pins anchors, stays bounded and loops with weighted=${weighted}`, () => {
  const j = fixture(weighted), before = structuredClone(j);
  const result = clothMotion(j, [{ ...target, vertexWeights: [0, 0, 1, 1] }], { animationName: 'dance', maxOffset: 4 });
  assert.equal(result.keyframesPerMesh, 61); assert.equal(result.triangleFlips, 0);
  assert.ok(result.maxWorldOffset > 0.1 && result.maxWorldOffset <= 4.001);
  close(poseVertices(j, 0), poseVertices(j, 2));
  for (let i = 0; i <= 60; i++) {
    const a = poseVertices(before, i / 30), b = poseVertices(j, i / 30);
    close(a.slice(0, 4), b.slice(0, 4));
    for (let k = 0; k < 4; k++) assert.ok(Math.hypot(b[k * 2] - a[k * 2], b[k * 2 + 1] - a[k * 2 + 1]) <= 4.02);
  }
  validateRebuildJson(j);
  assert.throws(() => clothMotion(j, [target], { animationName: 'dance' }), /已有形变/);
});

test('Cloth rejects nonloops and invalid masks; can bake non-looping follow', () => {
  const j = fixture(); j.animations.dance.bones.root.translate.at(-1).x = 30;
  assert.throws(() => clothMotion(j, [target], { animationName: 'dance' }), /未闭环/);
  assert.throws(() => clothMotion(j, [{ ...target, vertexWeights: [1] }], { animationName: 'dance' }), /vertexWeights/);
  const result = clothMotion(j, [target], { animationName: 'dance', loop: false, maxOffset: 2 });
  assert.equal(result.loop, false); validateRebuildJson(j);
});

test('Event management synchronizes references, edits keys and requires explicit cascade deletion', () => {
  const j = fixture();
  editEvents(j, [{ action: 'create', eventName: 'step', int: 1, audio: 'step.wav', volume: 0.7 },
    { action: 'keyframe_upsert', animationName: 'dance', eventName: 'step', time: 0.5, int: 2 },
    { action: 'rename', eventName: 'step', newName: 'foot' },
    { action: 'update', eventName: 'foot', string: 'left' }]);
  assert.equal(j.animations.dance.events[0].name, 'foot');
  assert.equal(j.events.foot.audio, 'step.wav');
  editEvents(j, [{ action: 'keyframe_shift', eventName: 'foot', animationName: 'dance', offset: 0.2 }]);
  assert.equal(j.animations.dance.events[0].time, 0.7);
  validateRebuildJson(j);
  assert.throws(() => editEvents(j, [{ action: 'delete', eventName: 'foot' }]), /cascade/);
  editEvents(j, [{ action: 'delete', eventName: 'foot', cascade: true }]);
  assert.deepEqual(j.animations.dance.events, []);
  assert.throws(() => editEvents(j, [{ action: 'create', eventName: '__proto__' }]));
});

test('Range copy handles all timeline types and literal names with dots/slashes', () => {
  const j = fixture(); j.animations.dance.bones['literal.name/arm'] = { rotate: [{ angle: 2 }, { time: 1, angle: 3 }] };
  j.events = { a: {} }; j.animations.dance.events = [{ time: 0.5, name: 'a' }, { time: 0.5, name: 'a' }];
  const original = structuredClone(j.animations.dance);
  animationRange(j, { animationName: 'dance', action: 'copy', startTime: 0, endTime: 1, targetAnimation: 'excerpt', targetTime: 2 });
  assert.deepEqual(j.animations.dance, original);
  assert.equal(j.animations.excerpt.events[0].time, 2.5);
  assert.equal(j.animations.excerpt.bones['literal.name/arm'].rotate[0].time, 2);
  assert.throws(() => animationRange(j, { animationName: 'dance', action: 'shift', startTime: 0.5, endTime: 0.5, offset: 0.5 }), /冲突/);
  assert.deepEqual(j.animations.dance, original);
  animationRange(j, { animationName: 'dance', action: 'delete', timelinePaths: [['bones', 'literal.name/arm', 'rotate']] });
  assert.deepEqual(j.animations.dance.bones['literal.name/arm'].rotate, []);
});

test('Range reverse transforms Bezier interpolation and quantization detects collisions', () => {
  const j = fixture(); j.animations.dance = { bones: { root: { translate: [{ x: 0, curve: 0.2, c2: 0.1, c3: 0.7, c4: 0.8 }, { time: 2, x: 20 }] } } };
  const before = structuredClone(j);
  animationRange(j, { animationName: 'dance', action: 'reverse', startTime: 0, endTime: 2 });
  for (let i = 0; i <= 20; i++) close(poseVertices(j, i / 10), poseVertices(before, 2 - i / 10), 0.03);
  j.animations.dance.bones.root.translate = [{ time: 0.01 }, { time: 0.02 }];
  assert.throws(() => animationRange(j, { animationName: 'dance', action: 'quantize', fps: 10 }), /冲突/);
  animationRange(j, { animationName: 'dance', action: 'quantize', fps: 10, collision: 'replace' });
  assert.equal(j.animations.dance.bones.root.translate.length, 1);
  j.animations.dance.bones.root.translate = [{ curve: 'stepped' }, { time: 1, x: 2 }];
  assert.throws(() => animationRange(j, { animationName: 'dance', action: 'reverse', endTime: 1 }), /阶跃/);
});

test('Attachment rename updates skin placeholders, switch keys, FFD, linked parents and texture path', () => {
  const j = fixture();
  deformMesh(j, target, { animationName: 'dance', frames: [{ time: 0, offsets: [1, 0, 0, 0, 0, 0, 0, 0] }] });
  j.animations.dance.slots = { cloth: { attachment: [{ name: 'cloth' }] } };
  j.skins[0].attachments.cloth.linked = { type: 'mesh', parent: 'cloth' };
  manageAttachment(j, target, { action: 'rename', newName: 'coat' });
  assert.equal(j.slots[0].attachment, 'coat'); assert.equal(j.animations.dance.slots.cloth.attachment[0].name, 'coat');
  assert.equal(j.skins[0].attachments.cloth.coat.path, 'cloth'); assert.equal(j.skins[0].attachments.cloth.linked.parent, 'coat');
  assert.ok(j.animations.dance.deform.default.cloth.coat);
  validateRebuildJson(j);
  manageAttachment(j, { ...target, attachmentName: 'coat' }, { action: 'duplicate', newName: 'coat-copy' });
  assert.ok(j.animations.dance.deform.default.cloth['coat-copy']); validateRebuildJson(j);
});

test('Region conversion preserves its transformed four corners and allows subsequent FFD', () => {
  const j = fixture(); j.skins[0].attachments.cloth.cloth = { width: 40, height: 80, x: 3, y: 6, scaleX: 1.2, scaleY: 0.7, rotation: 23 };
  const sk = sampleSkeleton(readSkeletonData(j)), a = sk.findSlot('cloth').attachment, expected = new Float32Array(8);
  a.computeWorldVertices(sk.findSlot('cloth').bone, expected, 0, 2);
  manageAttachment(j, target, { action: 'convert_to_mesh' });
  close(worldVertices(sampleSkeleton(readSkeletonData(j)), target), Array.from(expected), 0.01);
  validateRebuildJson(j);
});

test('Daily tools validate input before accessing any project', async () => {
  for (const [name, args] of [ ['spine_edit_weights', { action: 'set', influences: [{ boneName: 'root', weight: -1 }] }],
    ['spine_cloth_motion', { targets: [], animationName: 'dance' }], ['spine_animation_range', { action: 'quantize', fps: 0 }],
    ['spine_edit_events', { operations: [{ action: 'create', eventName: 'a', int: 0.5 }] }] ]) {
    const result = await toolMap[name].execute({ projectPath: 'missing', ...target, ...args });
    assert.equal(result.errorCode, 'E_INVALID_ARGUMENT', name);
  }
});

test('Generic keyframe editing preserves simultaneous events with different names', () => {
  const j = fixture(); j.events = { a: {}, b: {} };
  editKeyframes(j, 'dance', ['events'], 'upsert', { frames: [{ time: 1, name: 'a' }, { time: 1, name: 'b' }] });
  assert.equal(j.animations.dance.events.length, 2);
  editKeyframes(j, 'dance', ['events'], 'upsert', { frames: [{ time: 1, name: 'b', int: 5 }] });
  assert.equal(j.animations.dance.events.length, 2); assert.equal(j.animations.dance.events[1].int, 5);
  validateRebuildJson(j);
});

test('FFD bounds are checked and missing hull edges normalize without ignoring changed topology', () => {
  const j = fixture(), explicit = structuredClone(j);
  explicit.skins[0].attachments.cloth.cloth.edges = [0, 2, 2, 4, 4, 6, 6, 0];
  verifyRebuiltSkeleton(j, explicit);
  explicit.skins[0].attachments.cloth.cloth.edges.push(0, 4);
  assert.throws(() => verifyRebuiltSkeleton(j, explicit));
  j.animations.dance.deform = { default: { cloth: { cloth: [{ vertices: [1], offset: 8 }] } } };
  assert.throws(() => validateRebuildJson(j), /顶点数量或 offset/);
});

test('CLI rejects explicit errors and integrity failures even when Spine exits with status 0', async t => {
  const childProcess = require('node:child_process'), original = childProcess.spawn;
  const config = { ...configManager.get() }; let stdout = '';
  configManager.load({ spineExe: process.execPath, spineVersion: '3.8', logLevel: 'error' });
  childProcess.spawn = () => {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
    queueMicrotask(() => { child.stdout.emit('data', Buffer.from(stdout)); child.emit('close', 0); });
    return child;
  };
  t.after(() => { childProcess.spawn = original; configManager.load(config); });
  for (const output of ['ERROR: Unable to import skeleton.\n', 'Spine integrity check failed.\n']) {
    stdout = output; await assert.rejects(cliExecutor.exec({ args: ['-i', 'fixture.spine'] }), /Spine CLI 执行失败/);
  }
  stdout = 'Complete.\n'; assert.equal((await cliExecutor.exec({ args: ['-i', 'fixture.spine'] })).exitCode, 0);
});

test('Batch curve tool handles literal path segments and removes stale Bezier fields', async t => {
  const service = require('../dist/spine/rebuild-service'), original = service.editProject;
  const j = fixture(); j.bones[1].name = 'a.b/c';
  j.animations.dance.bones['a.b/c'] = { rotate: [{}, { time: 1, angle: 2 }] };
  service.editProject = async (_path, edit) => { await edit(j); validateRebuildJson(j); return { verified: false }; };
  t.after(() => { service.editProject = original; });
  const args = { projectPath: 'fixture.spine', animationName: 'dance', timeline: ['bones', 'a.b/c', 'rotate'], keyframeIndices: [0, 1], curve: 'bezier', c1x: 0.2, c1y: 0.1, c2x: 0.7, c2y: 0.9 };
  assert.equal((await toolMap.spine_set_curve.execute(args)).success, true);
  assert.equal(j.animations.dance.bones['a.b/c'].rotate[0].c3, 0.7);
  assert.equal((await toolMap.spine_set_curve.execute({ ...args, curve: 'linear' })).success, true);
  assert.equal(j.animations.dance.bones['a.b/c'].rotate[0].c3, undefined);
  assert.equal((await toolMap.spine_set_curve.execute({ ...args, c2y: undefined })).success, false);
  assert.equal((await toolMap.spine_set_curve.execute({ ...args, timeline: ['events'] })).success, false);
});
