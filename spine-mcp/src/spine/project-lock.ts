import * as fs from "fs";
import * as path from "path";
import { createHash, randomUUID } from "crypto";
import { ErrorCode, SpineError } from "../utils/error-codes";

/** 磁盘排他锁保护多个 MCP 进程；中断遗留的锁只在所属进程已退出后清理。 */
export async function withProjectLock<T>(project: string, run: () => Promise<T>): Promise<T> {
  const target = path.resolve(project);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const lock = target + ".mcp-lock";
  const token = randomUUID();
  for (let attempt = 0; ; attempt++) {
    try { fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, token }), { flag: "wx" }); break; }
    catch (err: any) {
      if (err.code !== "EEXIST") throw err;
      let owner: any;
      try { owner = JSON.parse(fs.readFileSync(lock, "utf8")); } catch { /* active creator may still be writing */ }
      if (attempt === 0 && Number.isInteger(owner?.pid)) {
        try { process.kill(owner.pid, 0); }
        catch (e: any) { if (e.code === "ESRCH") { fs.unlinkSync(lock); continue; } }
      }
      throw new SpineError(ErrorCode.PROJECT_BUSY, `工程正在被另一个操作编辑：${target}`, "稍后重试；不要在编辑器和 MCP 中同时保存同一文件。");
    }
  }
  try { return await run(); }
  finally {
    try { if (JSON.parse(fs.readFileSync(lock, "utf8")).token === token) fs.unlinkSync(lock); } catch { /* retain unknown lock */ }
  }
}

export function projectHash(project: string): string | null {
  return fs.existsSync(project) ? createHash("sha256").update(fs.readFileSync(project)).digest("hex") : null;
}

export function assertProjectUnchanged(project: string, expected: string | null): void {
  if (projectHash(project) !== expected) throw new SpineError(ErrorCode.PROJECT_CHANGED,
    `工程在操作期间被外部修改，已取消替换：${project}`, "重新读取工程后重试。");
}
