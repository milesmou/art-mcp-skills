import { AsyncLocalStorage } from "async_hooks";
import type { SpineAdapter } from "./adapters/types";

export interface ProjectExecutionContext {
  readonly projectPath: string;
  readonly sourceVersion: string;
  readonly family: string;
  readonly editorVersion: string;
  readonly spineExe: string;
  readonly cliTimeoutMs: number;
  readonly adapter: SpineAdapter;
}
const storage = new AsyncLocalStorage<Readonly<ProjectExecutionContext>>();
export const currentProjectContext = (): Readonly<ProjectExecutionContext> | undefined => storage.getStore();
export function withoutProjectContext<T>(run: () => T): T { return storage.exit(run); }
export function runInProjectContext<T>(context: ProjectExecutionContext, run: () => T): T {
  return storage.run(Object.freeze({ ...context }), run);
}
