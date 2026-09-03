import {
  BOARD_PERSONA_DEFAULTS,
  type BoardActionPriority,
  type BoardActionStatus,
  type BoardMeetingMode,
} from "./contracts/generated";

export type { BoardActionPriority, BoardActionStatus, BoardMeetingMode };

export type BoardCharterField = "vision" | "mission" | "mandate";
export const BOARD_CHARTER_FIELDS: readonly BoardCharterField[] = [
  "vision",
  "mission",
  "mandate",
];

export type BoardMember = {
  readonly id: string;
  readonly title: string;
  readonly shortName: string;
  readonly focusAreas: readonly string[];
  readonly kpisOwned: readonly string[];
  readonly vision: string;
  readonly mission: string;
  readonly mandate: string;
  readonly displayName: string;
  readonly defaults: Readonly<Record<BoardCharterField, string>>;
  readonly isOverridden: Readonly<Record<BoardCharterField | "displayName", boolean>>;
  readonly profileHash: string;
  readonly updatedAt?: string | null;
};

export type BoardMemberOverride = {
  readonly vision?: string;
  readonly mission?: string;
  readonly mandate?: string;
  readonly displayName?: string;
};

export type BoardSettings = {
  readonly schedule: { readonly morningEnabled: boolean; readonly eveningEnabled: boolean };
  readonly defaultMode: BoardMeetingMode;
  readonly defaultChair: string;
  readonly shareFinanceSummary: boolean;
  readonly shareRepoSnapshot: boolean;
  readonly models: { readonly chat: string; readonly standup: string; readonly deepDive: string };
  readonly dailyBudgetUsd: number;
  readonly updatedAt?: string | null;
};

export type BoardCharter = {
  readonly vision: string;
  readonly mission: string;
  readonly updatedAt?: string | null;
};

export type BoardBrief = {
  readonly markdown: string;
  readonly updatedAt?: string | null;
};

export type BoardUsage = {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly cost: number;
  readonly calls?: number;
};

export type BoardUsageToday = BoardUsage & { readonly budgetUsd: number };

export type BoardMeetingStatus = "running" | "succeeded" | "failed" | "cancelled";

export type BoardMeetingSummary = {
  readonly meetingId: string;
  readonly status: BoardMeetingStatus;
  readonly mode: BoardMeetingMode;
  readonly chair: string;
  readonly topic: string;
  readonly trigger: string;
  readonly phase: string;
  readonly phases: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly headline: string;
  readonly actionCount: number;
  readonly usage: BoardUsage;
  readonly errorMessage?: string | null;
};

export type BoardAgendaItem = {
  readonly title: string;
  readonly question: string;
  readonly whyNow?: string;
};

export type BoardMinutesAction = {
  readonly title: string;
  readonly detail: string;
  readonly persona: string;
  readonly priority: BoardActionPriority;
  readonly effort: string;
  readonly dueInDays: number | null;
  readonly metric: string;
  readonly dependsOn?: readonly string[];
  readonly existingActionId?: string;
};

export type BoardMinutes = {
  readonly headline: string;
  readonly agenda: readonly { readonly title: string; readonly question: string }[];
  readonly discussion: readonly {
    readonly agendaIndex: number;
    readonly summary: string;
    readonly consensus: "agree" | "split" | "deferred";
  }[];
  readonly decisions: readonly { readonly text: string; readonly proposedBy: string; readonly rationale: string }[];
  readonly risks: readonly { readonly text: string; readonly owner: string; readonly severity: "high" | "medium" | "low" }[];
  readonly actions: readonly BoardMinutesAction[];
  readonly questionsForOwner: readonly string[];
};

export type BoardMeetingDetail = BoardMeetingSummary & {
  readonly agenda: readonly BoardAgendaItem[];
  readonly conflicts: readonly {
    readonly topic: string;
    readonly summary: string;
    readonly askedOf: readonly string[];
    readonly question: string;
  }[];
  readonly minutes: BoardMinutes | null;
  readonly roster: readonly { readonly id: string; readonly displayName: string; readonly title: string }[];
  readonly contextPackHash?: string;
  readonly contextPackChars?: number;
  readonly memberProfileHashes: Readonly<Record<string, string>>;
  readonly models: Readonly<Record<string, string>>;
  readonly createdActionIds: readonly string[];
  readonly reaffirmedActionIds: readonly string[];
  readonly turnCount: number;
};

export type BoardTurn = {
  readonly seq: number;
  readonly phase: string;
  readonly personaId: string;
  readonly displayName: string;
  readonly title: string;
  readonly text: string;
  readonly usage?: BoardUsage;
  readonly model?: string;
  readonly createdAt: string;
};

export type BoardAction = {
  readonly actionId: string;
  readonly title: string;
  readonly detail: string;
  readonly persona: string;
  readonly priority: BoardActionPriority;
  readonly effort: string;
  readonly metric: string;
  readonly dependsOn: readonly string[];
  readonly status: BoardActionStatus;
  readonly note: string;
  readonly meetingId: string;
  readonly reaffirmedByMeetingIds: readonly string[];
  readonly dueAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type BoardChatMessage = {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly createdAt: string;
  readonly usage?: BoardUsage;
  readonly model?: string;
  readonly suggestedMeeting?: { readonly mode: BoardMeetingMode; readonly topic: string };
  /** Client-only: reply still being generated. */
  readonly isPending?: boolean;
};

export type BoardUpdate = {
  readonly updateId: string;
  readonly text: string;
  readonly createdAt: string;
};

export type BoardRepoSnapshotMeta = {
  readonly repo: string;
  readonly fetchedAt: string;
  readonly openIssuesCount: number;
  readonly docs: readonly string[];
  readonly commits: number;
  readonly ci: { readonly name: string; readonly status: string; readonly conclusion: string | null } | null;
  readonly chars: number;
};

export type BoardOverview = {
  readonly settings: BoardSettings;
  readonly charter: BoardCharter;
  readonly brief: BoardBrief;
  readonly members: readonly BoardMember[];
  readonly chairDefault: string;
  readonly openActionCount: number;
  readonly runningMeeting: BoardMeetingSummary | null;
  readonly latestMeeting: BoardMeetingSummary | null;
  readonly usageToday: BoardUsageToday;
  readonly models: { readonly chat: string; readonly standup: string; readonly deepDive: string };
  readonly repoSnapshot: BoardRepoSnapshotMeta | null;
  readonly repoSnapshotEnabled: boolean;
  readonly repo: string;
};

export const BOARD_API_BASE = "/siu-tin-dei/board";

export const MEETING_MODE_LABELS: Readonly<Record<BoardMeetingMode, string>> = {
  standup: "Stand-up",
  deepDive: "Deep dive",
};

export const PRIORITY_LABELS: Readonly<Record<BoardActionPriority, string>> = {
  now: "Now",
  next: "Next",
  later: "Later",
};

export const PRIORITY_BADGE_CLASS: Readonly<Record<BoardActionPriority, string>> = {
  now: "text-bg-danger",
  next: "text-bg-warning",
  later: "text-bg-secondary",
};

export const PHASE_LABELS: Readonly<Record<string, string>> = {
  prepare: "Preparing context",
  agenda: "Chair drafts the agenda",
  positions: "Members give positions",
  challenge: "Chair challenges, members respond",
  synthesis: "Chair writes the minutes",
  persist: "Saving actions",
  done: "Done",
};

export const MEETING_STATUS_BADGE_CLASS: Readonly<Record<BoardMeetingStatus, string>> = {
  running: "text-bg-primary",
  succeeded: "text-bg-success",
  failed: "text-bg-danger",
  cancelled: "text-bg-secondary",
};

/** Merge contract defaults with an owner override into the effective profile (mirrors the Lambda). */
export function mergeMemberProfile(
  base: Pick<BoardMember, "id" | "title" | "shortName" | "focusAreas" | "kpisOwned"> &
    Readonly<Record<BoardCharterField, string>>,
  override: BoardMemberOverride | null | undefined,
): Omit<BoardMember, "profileHash"> {
  const ov = override ?? {};
  const isOverridden = {
    vision: Boolean(ov.vision?.trim()),
    mission: Boolean(ov.mission?.trim()),
    mandate: Boolean(ov.mandate?.trim()),
    displayName: Boolean(ov.displayName?.trim()),
  };
  return {
    id: base.id,
    title: base.title,
    shortName: base.shortName,
    focusAreas: base.focusAreas,
    kpisOwned: base.kpisOwned,
    defaults: { vision: base.vision, mission: base.mission, mandate: base.mandate },
    vision: isOverridden.vision ? ov.vision!.trim() : base.vision,
    mission: isOverridden.mission ? ov.mission!.trim() : base.mission,
    mandate: isOverridden.mandate ? ov.mandate!.trim() : base.mandate,
    displayName: isOverridden.displayName ? ov.displayName!.trim() : base.shortName,
    isOverridden,
  };
}

export function defaultMemberProfiles(): readonly Omit<BoardMember, "profileHash">[] {
  return BOARD_PERSONA_DEFAULTS.map((p) => mergeMemberProfile(p, null));
}

export function memberInitials(member: Pick<BoardMember, "displayName" | "shortName">): string {
  const name = member.displayName.trim();
  if (!name) return member.shortName.slice(0, 3).toUpperCase();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function memberLabel(
  members: readonly Pick<BoardMember, "id" | "displayName" | "shortName">[],
  personaId: string,
): string {
  const found = members.find((m) => m.id === personaId);
  if (!found) return personaId ? personaId.toUpperCase() : "Board";
  return found.displayName === found.shortName
    ? found.shortName
    : `${found.displayName} (${found.shortName})`;
}

export function groupActionsByPriority(
  actions: readonly BoardAction[],
): Readonly<Record<BoardActionPriority, readonly BoardAction[]>> {
  const out: Record<BoardActionPriority, BoardAction[]> = { now: [], next: [], later: [] };
  for (const a of actions) {
    const key: BoardActionPriority = a.priority in out ? a.priority : "later";
    out[key].push(a);
  }
  for (const key of Object.keys(out) as BoardActionPriority[]) {
    out[key].sort((a, b) => {
      const da = a.dueAt ?? "9999";
      const db = b.dueAt ?? "9999";
      if (da !== db) return da < db ? -1 : 1;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
    });
  }
  return out;
}

export type MeetingProgress = {
  readonly index: number;
  readonly total: number;
  readonly percent: number;
  readonly label: string;
};

export function meetingPhaseProgress(
  meeting: Pick<BoardMeetingSummary, "phase" | "phases" | "status">,
): MeetingProgress {
  const phases = meeting.phases.length > 0 ? meeting.phases : ["prepare", "agenda", "positions", "synthesis", "persist"];
  if (meeting.status !== "running") {
    return {
      index: phases.length,
      total: phases.length,
      percent: 100,
      label: PHASE_LABELS[meeting.status === "succeeded" ? "done" : meeting.phase] ?? meeting.status,
    };
  }
  const idx = Math.max(0, phases.indexOf(meeting.phase));
  return {
    index: idx,
    total: phases.length,
    percent: Math.round(((idx + 0.5) / phases.length) * 100),
    label: PHASE_LABELS[meeting.phase] ?? meeting.phase,
  };
}

export function formatUsageCost(usd: number | undefined | null): string {
  const value = typeof usd === "number" && Number.isFinite(usd) ? usd : 0;
  if (value === 0) return "USD 0.00";
  if (value < 0.01) return `USD ${value.toFixed(4)}`;
  return `USD ${value.toFixed(2)}`;
}

export function formatTokens(tokens: number | undefined | null): string {
  const value = typeof tokens === "number" && Number.isFinite(tokens) ? tokens : 0;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k tokens`;
  return `${value} tokens`;
}

export function boardMemberPath(personaId: string): string {
  return `${BOARD_API_BASE}/members/${encodeURIComponent(personaId)}`;
}

export function boardChatPath(personaId: string): string {
  return `${BOARD_API_BASE}/chat/${encodeURIComponent(personaId)}`;
}

export function boardChatJobPath(personaId: string, jobId: string): string {
  return `${boardChatPath(personaId)}/jobs/${encodeURIComponent(jobId)}`;
}

export function boardMeetingPath(meetingId: string): string {
  return `${BOARD_API_BASE}/meetings/${encodeURIComponent(meetingId)}`;
}

export function boardActionPath(actionId: string): string {
  return `${BOARD_API_BASE}/actions/${encodeURIComponent(actionId)}`;
}
