// A `lead_stages` row → LeadStage. Shared by the browser data layer and the
// server-side Gmail sync, so it lives apart from `data.ts` ("use client").

import type { LeadStage, LeadStageKind, StageRuleKey } from "./types";

type Row = Record<string, unknown>;

export function mapStage(r: Row): LeadStage {
  const kind = typeof r.kind === "string" ? r.kind : "";
  const stall = r.stall_days == null || r.stall_days === "" ? null : Number(r.stall_days);
  return {
    id: typeof r.id === "string" ? r.id : "",
    name: typeof r.name === "string" ? r.name : "",
    position: typeof r.position === "number" ? r.position : Number(r.position) || 0,
    kind: (kind === "won" || kind === "lost" ? kind : "open") as LeadStageKind,
    stallDays: stall !== null && Number.isFinite(stall) ? stall : null,
    ruleKey: typeof r.rule_key === "string" && r.rule_key ? (r.rule_key as StageRuleKey) : null,
    color: typeof r.color === "string" && /^#[0-9a-f]{6}$/i.test(r.color) ? r.color : null,
    icon: typeof r.icon === "string" && r.icon ? r.icon : null,
  };
}
