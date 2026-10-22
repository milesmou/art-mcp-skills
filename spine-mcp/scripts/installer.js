/**
 * 安装向导：检测 Node.js / Spine 环境，生成 .env 配置。
 * 用法：node scripts/installer.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const SPINE_CANDIDATES = [
  process.env.SPINE_EXE,
  'D:/Applications/Spine/Spine.com',
  'D:/cocos/Spine/Spine.com',
  'C:/Program Files/Spine/Spine.com',
  'C:/Spine/Spine.com',
];

function exists(p) {
  return !!p && fs.existsSync(p);
}

function findSpine() {
  for (const c of SPINE_CANDIDATES) {
    if (exists(c)) return c;
  }
  // 递归搜索常见盘符
  const search = ['D:/cocos', 'C:/cocos', 'D:/', 'C:/'];
  for (const base of search) {
    if (!fs.existsSync(base)) continue;
    try {
      const dirs = fs.readdirSync(base, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && /spine/i.test(d.name)) {
          const spine = path.join(base, d.name, 'Spine.com');
          if (fs.existsSync(spine)) return spine;
        }
      }
    } catch (e) {}
  }
  return null;
}

function findNode() {
  return process.execPath;
}

async function main() {
  console.log('========================================');
  console.log(' Spine MCP — 安装向导');
  console.log('========================================\n');

  // 1. 检测 Node
  const node = findNode();
  console.log(`[1/3] Node.js : ${node ? node : '未找到'}`);
  if (!node) {
    console.error('错误：需要 Node.js 20+。请先安装 Node.js。');
    process.exit(1);
  }

  // 2. 检测 Spine
  const spine = findSpine();
  console.log(`[2/3] Spine   : ${spine ? spine : '⚠️ 未自动检测到，将使用默认路径'}`);

  // 3. 写入 .env
  const envPath = path.join(ROOT, '.env');
  const envContent = [
    `# 由安装向导自动生成 ${new Date().toISOString()}`,
    `SPINE_EXE=${spine || 'D:/Applications/Spine/Spine.com'}`,
    `SPINE_VERSION=${process.env.SPINE_VERSION?.trim() || '3.8'}`,
    'LOG_LEVEL=info',
  ].join('\n');
  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`[3/3] 已写入配置: ${envPath}`);

  // 安装依赖 + 构建
  console.log('\n正在安装依赖并构建...');
  if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
    execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
  }
  execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

  console.log('\n========================================');
  console.log(' ✅ 安装完成！');
  console.log(' 下一步：');
  console.log('  1. 运行 node dist/index.js check 验证 Spine CLI 配置');
  console.log('  2. 按 README.md 将 MCP 配置加入 AI 客户端（Trae / Cursor 等）');
  console.log('  3. 重启 AI 客户端，连接 Spine MCP 服务');
  console.log('========================================');
}

main().catch((e) => {
  console.error('安装失败：', e);
  process.exit(1);
});
