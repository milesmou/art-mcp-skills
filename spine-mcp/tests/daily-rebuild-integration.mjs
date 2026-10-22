import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { configManager } = require('../dist/config-manager');
const { toolMap } = require('../dist/tools/registry');
const { editProject, exportProjectDocuments } = require('../dist/spine/rebuild-service');
const { editWeights, deformMesh } = require('../dist/spine/mesh-edit-service');
const { clothMotion } = require('../dist/spine/cloth-motion-service');
const { editEvents, animationRange, manageAttachment } = require('../dist/spine/daily-edit-service');
const { meshWave } = require('../dist/spine/mesh-wave-service');
const { validateRebuildJson, verifyRebuiltSkeleton } = require('../dist/spine/rebuild-validation');
const { projectHash } = require('../dist/spine/project-lock');
const { cliExecutor } = require('../dist/spine/cli-executor');
const cfg = configManager.load({ logLevel: 'error' });

test('Real CLI preserves daily mesh, weights, cloth, event audio, range and attachment edits', { skip: !cfg.spineExe || !fs.existsSync(cfg.spineExe), timeout: 360000 }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-daily-live-'));
  const debugDir = path.resolve('out/daily-operations-check'); fs.mkdirSync(debugDir, { recursive: true });
  const originalExec = cliExecutor.exec;
  cliExecutor.exec = async function(options) {
    const result = await originalExec.call(this, options);
    fs.appendFileSync(path.join(debugDir, 'integration-cli.log'), JSON.stringify(options.args) + '\n' + result.stdout.replace(/^Licensed to:.*$/gm, '') + '\n');
    return result;
  };
  t.after(() => { cliExecutor.exec = originalExec; });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const project = path.join(dir, 'daily.spine'), jsonPath = path.join(dir, 'source.json');
  const target = { skinName: 'default', slotName: 'cloth', attachmentName: 'cloth' };
  const fixture = { skeleton: { spine: '3.8', images: './images/', audio: '', fps: 24 }, bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 12, rotation: 20 }],
    slots: [{ name: 'cloth', bone: 'root', attachment: 'cloth' }], skins: [{ name: 'default', attachments: { cloth: { cloth: {
      type: 'mesh', width: 40, height: 80, uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 2, 3, 0], hull: 4, vertices: [-20, 0, 20, 0, 20, -80, -20, -80]
    } } } }], animations: { dance: { bones: { root: { translate: [{}, { time: 0.5, x: 15 }, { time: 1 }, { time: 1.5, x: -15 }, { time: 2 }] } } }, untouched: {} } };
  fs.writeFileSync(jsonPath, JSON.stringify(fixture));
  const created = await toolMap.spine_rebuild_project.execute({ projectPath: project, jsonPath, skeletonName: 'daily' });
  assert.ok(created.success, created.message);
  const before = projectHash(project); let intended;
  const result = await editProject(project, json => {
    editWeights(json, target, { action: 'set', vertexIndices: [2, 3], influences: [{ boneName: 'root', weight: 0.7 }, { boneName: 'arm', weight: 0.3 }] });
    clothMotion(json, [{ ...target, vertexWeights: [0, 0, 1, 1] }], { animationName: 'dance', maxOffset: 3, fps: 12 });
    meshWave(json, 'cloth', 'cloth', { animationName: 'dance', mode: 'add', amplitude: 0.5, duration: 2, fps: 12, pinnedVertices: [0, 1] });
    editEvents(json, [{ action: 'create', eventName: 'step', int: 1, audio: 'step.wav', volume: 0.7, balance: -0.2 },
      { action: 'keyframe_upsert', animationName: 'dance', eventName: 'step', time: 0.5, string: 'left' },
      { action: 'rename', eventName: 'step', newName: 'footstep' }]);
    animationRange(json, { animationName: 'dance', action: 'copy', targetAnimation: 'excerpt', startTime: 0, endTime: 1, targetTime: 0 });
    manageAttachment(json, target, { action: 'rename', newName: 'coat' });
    manageAttachment(json, { ...target, attachmentName: 'coat' }, { action: 'duplicate', newName: 'coat-copy' });
    validateRebuildJson(json); intended = structuredClone(json);
  });
  assert.ok(result.verified); assert.equal(projectHash(result.backupPath), before);
  const { documents, fps } = await exportProjectDocuments(project, path.join(dir, 'verify'));
  assert.equal(fps, 24); verifyRebuiltSkeleton(intended, documents[0].json);
  assert.equal(documents[0].json.events.footstep.audio, 'step.wav');
  assert.deepEqual(Object.keys(documents[0].json.animations).sort(), ['dance', 'excerpt', 'untouched']);
  const inspected = await toolMap.spine_get_mesh.execute({ projectPath: path.join(dir, 'verify', 'daily.json'), ...target, attachmentName: 'coat' });
  assert.ok(inspected.success, inspected.message); assert.equal(inspected.data.weighted, true);
  const safe = projectHash(project);
  const rejected = await toolMap.spine_edit_weights.execute({ projectPath: project, ...target, attachmentName: 'coat', action: 'normalize' });
  assert.equal(rejected.success, false); assert.equal(rejected.errorCode, 'E_INVALID_ARGUMENT'); assert.equal(projectHash(project), safe);
});
