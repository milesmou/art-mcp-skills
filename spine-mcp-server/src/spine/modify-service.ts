/** 常规编辑统一走后台 JSON 重建，不调用编辑器 UI。 */
import { editProject, exportProjectDocuments, selectSkeleton, RebuildResult } from './rebuild-service';
import { createTempDir, removeDir } from '../utils/file-utils';
import { getProjectInfo } from './info-service';

export type ModifyResult = RebuildResult;
export function modifyProject(projectPath: string, modifyFn: (json: any) => unknown, skeletonName?: string): Promise<ModifyResult> {
  return editProject(projectPath, modifyFn, skeletonName);
}

export async function readJsonForExport(projectPath: string, skeletonName?: string): Promise<any> {
  const temp = createTempDir('spine-read-');
  try { return selectSkeleton((await exportProjectDocuments(projectPath, temp)).documents, skeletonName).json; }
  finally { removeDir(temp); }
}

export async function getFps(projectPath: string): Promise<number> {
  return (await getProjectInfo(projectPath)).fps || 30;
}
