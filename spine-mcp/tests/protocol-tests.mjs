import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP advertises JSON Schema for all tools, and validates calls without a Spine installation', async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const client = new Client({ name: 'protocol-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'dist/index.js'), 'mcp'], cwd: root, env: { ...process.env, LOG_LEVEL: 'error' }, stderr: 'pipe' });
  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.name, 'spine-mcp');
    const { tools } = await client.listTools();
    assert.equal(tools.length, 85); assert.equal(new Set(tools.map(t => t.name)).size, 85);
    for (const name of ['spine_pack_atlas', 'spine_generate_mesh', 'spine_auto_weights']) assert.ok(tools.some(t => t.name === name), name);
    for (const t of tools) { assert.equal(t.inputSchema.type, 'object', t.name); assert.ok(t.inputSchema.properties, t.name); assert.equal(t.inputSchema.def, undefined); }
    const edit = tools.find(t => t.name === 'spine_edit_animation');
    assert.ok(edit.inputSchema.required.includes('projectPath'));
    assert.ok(edit.inputSchema.properties.animationName);
    assert.equal((await client.callTool({ name: 'spine_list_effects', arguments: {} })).isError, false);
    const caps = await client.callTool({ name: 'spine_get_capabilities', arguments: { version: '4.2.75' } });
    assert.equal(caps.isError, false);
    assert.match(JSON.stringify(caps), /planned/);
    assert.equal((await client.callTool({ name: 'spine_edit_keyframes', arguments: { projectPath: 'absent', animationName: 'idle', timeline: [] } })).isError, true);
  } finally { await client.close(); }
});
