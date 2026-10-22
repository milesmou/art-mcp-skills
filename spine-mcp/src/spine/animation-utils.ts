/** Spine 动画时长来自各时间轴最大 time，标准导出不含 duration 字段。 */
export function animationDuration(anim: any): number {
  let duration = 0;
  const visit = (value: any): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const f of value) if (f && typeof f.time === "number") duration = Math.max(duration, f.time);
    } else for (const child of Object.values(value)) visit(child);
  };
  visit(anim);
  return duration;
}
