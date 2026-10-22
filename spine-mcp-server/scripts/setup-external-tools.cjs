// Install into a private environment; never modify the user's global Python packages.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const env = path.join(root, '.venv-external');
const python = process.env.SPINE_TOOLS_PYTHON || 'python';
function run(exe, args) {
  const result = spawnSync(exe, args, { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(python, ['-m', 'venv', env]);
const local = path.join(env, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
run(local, ['-m', 'pip', 'install', '-r', path.join(root, 'scripts/external-tools/requirements.txt')]);
run(local, ['-c', 'import igl; assert callable(igl.bbw); print("libigl BBW ready")']);
