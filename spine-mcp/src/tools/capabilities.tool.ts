import { z } from "zod";
import { BaseTool } from "./base.tool";
import { findAdapter, registeredAdapters } from "../spine/adapters/registry";
import { projectMetadata } from "../spine/project-context";
import { versionFamily } from "../spine/version-policy";

export class GetCapabilitiesTool extends BaseTool {
  name = "spine_get_capabilities";
  description = "查询版本适配器及能力矩阵。可传 projectPath 检测工程，或 version 查询版本；省略则列出全部。3.8 已支持，4.2 仅预留，尚不可读取、编辑或重建；查询版本/JSON 不需要启动编辑器。";
  inputSchema = z.object({ projectPath: z.string().min(1).optional(), version: z.string().min(1).optional() })
    .refine(v => !(v.projectPath && v.version), "projectPath 与 version 只能提供一个");
  async run(args: { projectPath?: string; version?: string }): Promise<any> {
    const metadata = args.projectPath ? await projectMetadata(args.projectPath) : undefined;
    const version = metadata?.sourceVersion ?? args.version;
    const adapters = version ? [findAdapter(version)].filter(Boolean) : registeredAdapters();
    return { success: true, message: "版本及能力矩阵已读取", data: {
      ...(version ? { version, family: versionFamily(version), recognized: !!findAdapter(version), ...metadata } : {}),
      adapters: adapters.map(a => ({ family: a!.family, status: a!.status, capabilities: a!.capabilities })),
      migrationSupported: false,
      preservation: "仅承诺对应适配器已验证的可导出数据；编辑器专有信息依赖原工程备份。已知不支持的结构拒绝重建。",
    } };
  }
}
