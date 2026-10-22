import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { applyJsonEdits, editAnimation, editKeyframes } = require('../dist/spine/edit-service');
const { animationDuration } = require('../dist/spine/animation-utils');
const { validateRebuildJson, verifyRebuiltSkeleton } = require('../dist/spine/rebuild-validation');
const { backupFile, listBackups } = require('../dist/utils/file-utils');
const { withProjectLock, projectHash, assertProjectUnchanged } = require('../dist/spine/project-lock');
const { cliExecutor } = require('../dist/spine/cli-executor');
const { editProject, createProjectFromJson } = require('../dist/spine/rebuild-service');
const { BaseTool } = require('../dist/tools/base.tool');
const { z } = require('zod');
const { updateBoneKeyframe } = require('../dist/spine/json-handler');
const fixture = () => ({ skeleton: { spine: '3.8.99', images: './images/' }, bones: [{ name: 'root' }, { name: 'head', parent: 'root' }], animations: { idle: { bones: { head: { rotate: [{ angle: 0 }, { time: 2, angle: 30 }] } } } } });
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spine-edit-test-'));

test('JSON Patch supports arrays, escaped keys, copy/move and transactional failure', () => {
  const src = { array: [1, 2, 3], 'a/b': { '~key': 4 } };
  const dst = applyJsonEdits(src, [{ op: 'test', path: '/a~1b/~0key', value: 4 }, { op: 'move', from: '/array/0', path: '/array/2' }, { op: 'copy', from: '/a~1b', path: '/copy' }, { op: 'add', path: '/array/-', value: 9 }]);
  assert.deepEqual(dst.array, [2, 3, 1, 9]);
  assert.deepEqual(dst.copy, { '~key': 4 });
  assert.deepEqual(src.array, [1, 2, 3]);
  assert.throws(() => applyJsonEdits(src, [{ op: 'remove', path: '/array/0' }, { op: 'test', path: '/array/0', value: 999 }]));
  assert.deepEqual(src.array, [1, 2, 3]);
});

test('JSON Patch rejects prototype paths, absent values, invalid array indices and parent moves', () => {
  for (const ops of [ [{ op: 'add', path: '/__proto__/polluted', value: true }], [{ op: 'replace', path: '/x' }], [{ op: 'add', path: '/a/02', value: 2 }], [{ op: 'move', from: '/a', path: '/a/sub' }] ]) assert.throws(() => applyJsonEdits({ x: 1, a: [1] }, ops));
  assert.equal({}.polluted, undefined);
});

test('Animation create/replace/merge preserve other animation data and reject conflicts', () => {
  const json = fixture(), original = structuredClone(json.animations.idle);
  editAnimation(json, 'dance', { bones: { head: { rotate: [{ angle: 1 }] } } }, 'create');
  editAnimation(json, 'dance', { bones: { head: { translate: [{ x: 2 }] } } }, 'merge');
  assert.equal(json.animations.dance.bones.head.rotate[0].angle, 1);
  assert.equal(json.animations.dance.bones.head.translate[0].x, 2);
  assert.deepEqual(json.animations.idle, original);
  assert.throws(() => editAnimation(json, 'dance', {}, 'create'));
  assert.throws(() => editAnimation(json, 'missing', {}, 'replace'));
  assert.throws(() => editAnimation(json, 'foo', { nonsense: [] }, 'create'));
  editAnimation(json, 'eventful', { events: [{ time: 0, name: 'beat' }] }, 'create', { beat: { int: 2 } });
  assert.deepEqual(json.events.beat, { int: 2 });
  validateRebuildJson(json);
});

test('Keyframes upsert handles implicit zero, shift/delete ranges and collision rejection', () => {
  const json = fixture(), tl = ['bones', 'head', 'rotate'];
  editKeyframes(json, 'idle', tl, 'upsert', { frames: [{ time: 0, angle: 10 }, { time: 1, angle: 20 }] });
  assert.equal(json.animations.idle.bones.head.rotate.length, 3);
  editKeyframes(json, 'idle', tl, 'shift', { startTime: 1, offset: 1 });
  assert.deepEqual(json.animations.idle.bones.head.rotate.map(f => f.time ?? 0), [0, 2, 3]);
  assert.throws(() => editKeyframes(json, 'idle', tl, 'shift', { startTime: 2, endTime: 2, offset: 1 }));
  assert.equal(editKeyframes(json, 'idle', tl, 'delete', { startTime: 2 }), 2);
});

test('Duration includes deform/events/draw order with no nonstandard duration property', () => {
  assert.equal(animationDuration({ bones: { head: { rotate: [{}, { time: 2 }] } }, events: [{ time: 3 }], deform: { default: { face: { face: [{ time: 4 }] } } } }), 4);
  assert.equal(animationDuration({}), 0);
});

test('Partial bone keyframes use setup-relative zero offsets and unit scale defaults', () => {
  const json = fixture(); Object.assign(json.bones[1], { x: 90, y: 100, scaleX: -1, shearX: 12 });
  updateBoneKeyframe(json, 'idle', 'head', 0.5, { y: 10, scaleY: 1.2, shearY: 4 });
  const tl = json.animations.idle.bones.head;
  assert.equal(tl.translate[0].x, 0); assert.equal(tl.scale[0].x, 1); assert.equal(tl.shear[0].x, 0);
});

test('Rebuild verification normalizes defaults but detects dropped animations, changed rig and curves', () => {
  const a = fixture(), b = structuredClone(a);
  b.bones[0].x = 0; b.animations.idle.bones.head.rotate[0].time = 0;
  verifyRebuiltSkeleton(a, b);
  const lost = structuredClone(a); lost.animations = {};
  assert.throws(() => verifyRebuiltSkeleton(a, lost), /重建回读/);
  const changed = structuredClone(a); changed.bones[1].x = 5;
  assert.throws(() => verifyRebuiltSkeleton(a, changed));
  const curve = structuredClone(a); curve.animations.idle.bones.head.rotate[0].curve = 'stepped';
  assert.throws(() => verifyRebuiltSkeleton(a, curve));
});

test('Rebuild validator rejects invalid references, duplicate names, unknown timelines and malformed weights', () => {
  validateRebuildJson(fixture());
  const refs = fixture(); refs.bones[1].parent = 'ghost';
  const duplicate = fixture(); duplicate.bones[1].name = 'root';
  const unknown = fixture(); unknown.animations.idle.bones.head.foo = [{}];
  const weights = fixture(); weights.slots = [{ name: 's', bone: 'root' }]; weights.skins = [{ name: 'default', attachments: { s: { mesh: { type: 'mesh', uvs: [0, 0], triangles: [], vertices: [-1] } } } }];
  for (const json of [refs, duplicate, unknown, weights]) assert.throws(() => validateRebuildJson(json));
});

test('Backups are unique within one millisecond and preserve each version', t => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, '项目.spine'); fs.writeFileSync(file, 'first'); const first = backupFile(file);
  fs.writeFileSync(file, 'second'); const second = backupFile(file);
  assert.notEqual(first, second); assert.equal(listBackups(file).length, 2);
  assert.equal(fs.readFileSync(first, 'utf8'), 'first');
});

test('Project lock blocks overlapping edits, releases on error, and detects external changes', async t => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, 'project.spine'); fs.writeFileSync(p, 'first');
  await withProjectLock(p, async () => { await assert.rejects(withProjectLock(p, async () => {}), /正在被/); });
  await assert.rejects(withProjectLock(p, async () => { throw new Error('failure'); }));
  await withProjectLock(p, async () => {});
  const hash = projectHash(p); fs.writeFileSync(p, 'external');
  assert.throws(() => assertProjectUnchanged(p, hash), /外部修改/);
});

test('Direct tool calls also validate parameters and apply Zod defaults', async () => {
  class Tool extends BaseTool { name = 'test'; description = 'test'; inputSchema = z.object({ amount: z.number().positive().default(5) }); async run(args) { return { success: true, data: args }; } }
  const tool = new Tool(); assert.equal((await tool.execute({})).data.amount, 5);
  assert.equal((await tool.execute({ amount: -1 })).errorCode, 'E_INVALID_ARGUMENT');
});

test('Rebuild transaction preserves multiple skeletons; failed verification never replaces original', async t => {
  const dir = temp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, '工程.spine');
  const state = { fps: 30, skeletons: { '主角 name': fixture(), accessory: fixture() } };
  fs.writeFileSync(p, JSON.stringify(state));
  const originalExec = cliExecutor.exec; let corrupt = false;
  cliExecutor.exec = async ({ args }) => {
    const input = args[args.indexOf('-i') + 1];
    const output = args.includes('-o') ? args[args.indexOf('-o') + 1] : null;
    if (args.includes('-r')) {
      const json = JSON.parse(fs.readFileSync(input, 'utf8'));
      const doc = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { fps: json.skeleton.fps, skeletons: {} };
      doc.skeletons[args[args.indexOf('-r') + 1]] = json;
      fs.writeFileSync(output, JSON.stringify(doc));
    } else if (args.includes('-e')) {
      fs.mkdirSync(output, { recursive: true });
      for (const [name, source] of Object.entries(JSON.parse(fs.readFileSync(input, 'utf8')).skeletons)) {
        const json = structuredClone(source);
        if (corrupt && path.basename(input).startsWith('.spine-mcp-')) json.animations = {};
        fs.writeFileSync(path.join(output, name + '.json'), JSON.stringify(json));
      }
    } else {
      const doc = JSON.parse(fs.readFileSync(input, 'utf8'));
      return { stdout: `Project info: ${input}\nSpine version: 3.8.99\nDopesheet FPS: ${doc.fps}\n` + Object.keys(doc.skeletons).map(n => `  Skeleton: ${n}\n`).join(''), stderr: '', exitCode: 0, durationMs: 1 };
    }
    return { stdout: '', stderr: '', exitCode: 0, durationMs: 1 };
  };
  t.after(() => { cliExecutor.exec = originalExec; });
  const before = fs.readFileSync(p, 'utf8');
  const dry = await editProject(p, j => editAnimation(j, 'dance', {}, 'create'), '主角 name', true);
  assert.equal(dry.verified, false); assert.equal(fs.readFileSync(p, 'utf8'), before);
  assert.equal(listBackups(p).length, 0);
  await assert.rejects(editProject(p, () => {}), /skeletonName/);
  const result = await editProject(p, j => editAnimation(j, 'dance', {}, 'create'), '主角 name');
  assert.equal(result.verified, true); assert.equal(fs.readFileSync(result.backupPath, 'utf8'), before);
  const after = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.deepEqual(after.skeletons.accessory.animations, state.skeletons.accessory.animations);
  assert.ok(Object.hasOwn(after.skeletons['主角 name'].animations, 'dance'));
  const good = fs.readFileSync(p, 'utf8'); corrupt = true;
  await assert.rejects(editProject(p, j => { j.bones[1].x = 10; }, '主角 name'), /重建回读/);
  assert.equal(fs.readFileSync(p, 'utf8'), good); assert.equal(listBackups(p).length, 1);
  corrupt = false;
  await assert.rejects(editProject(p, j => { j.skeleton.spine = '4.2.75'; }, '主角 name'), /4.2|版本/);
  assert.equal(fs.readFileSync(p, 'utf8'), good); assert.equal(listBackups(p).length, 1);
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.startsWith('.spine-mcp-') || f.endsWith('.mcp-lock')), []);
  corrupt = false;
  const created = await createProjectFromJson(path.join(dir, 'new.spine'), fixture(), 'new');
  assert.equal(created.verified, true);
});
