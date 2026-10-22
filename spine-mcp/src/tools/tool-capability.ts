import type { Capability } from "../spine/adapters/types";

const capabilities: Record<string, Capability> = {
  spine_pack_atlas: "atlas.pack", spine_generate_mesh: "mesh.generate", spine_auto_weights: "mesh.autoWeights",
  spine_get_mesh: "mesh.inspect", spine_edit_weights: "mesh.weights", spine_deform_mesh: "mesh.deform",
  spine_cloth_motion: "animation.cloth", spine_animation_range: "animation.range", spine_set_curve: "animation.curves",
  spine_edit_events: "events.edit", spine_manage_attachment: "attachment.manage", spine_rebuild_project: "project.rebuild",
  spine_export_animation: "project.export", spine_clean_animation: "project.clean",
  spine_render_preview: "runtime.preview", spine_export_video: "runtime.preview", spine_export_sheet: "runtime.preview",
};
const readers = new Set(["spine_get_project_info", "spine_inspect_json", "spine_describe", "spine_list_animations",
  "spine_list_events", "spine_list_constraints", "spine_get_attachments", "spine_get_animation_detail",
  "spine_check_project", "spine_validate_references"]);
export function toolCapability(name: string): Capability {
  return capabilities[name] ?? (readers.has(name) ? "project.read" : "legacy.edit");
}
