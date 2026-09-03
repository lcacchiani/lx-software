import { useCallback, useMemo, useState } from "react";
import { FinanceDataLoadOrError } from "../FinanceDataStatus";
import { BoardActionsList } from "./BoardActionsList";
import { BoardBriefEditor } from "./BoardBriefEditor";
import { BoardCharterEditor } from "./BoardCharterEditor";
import { BoardChatOffcanvas } from "./BoardChatOffcanvas";
import { BoardHeaderStrip } from "./BoardHeaderStrip";
import { BoardMeetingHistory } from "./BoardMeetingHistory";
import { BoardMeetingPanel } from "./BoardMeetingPanel";
import { BoardMemberEditor } from "./BoardMemberEditor";
import { BoardMembersStrip } from "./BoardMembersStrip";
import { BoardSettingsCard } from "./BoardSettingsCard";
import { BoardUpdatesComposer } from "./BoardUpdatesComposer";
import { StartMeetingForm } from "./StartMeetingForm";
import { useBoard, useBoardUpdates } from "../../hooks/useBoard";
import { useBoardActions } from "../../hooks/useBoardActions";
import {
  useBoardMeeting,
  useBoardMeetings,
  useCancelBoardMeeting,
  useStartBoardMeeting,
  type StartMeetingVariables,
} from "../../hooks/useBoardMeetings";
import { getAdminApiErrorMessage } from "../../lib/apiAdminClient";
import type { BoardMeetingMode } from "../../lib/boardModel";

type BoardSection = "actions" | "meetings" | "members" | "brief" | "settings";

const CLOSED_MEETING = "__closed__";

const SECTIONS: readonly { readonly id: BoardSection; readonly label: string; readonly icon: string }[] = [
  { id: "actions", label: "Next actions", icon: "bi-list-check" },
  { id: "meetings", label: "Meetings", icon: "bi-people" },
  { id: "members", label: "Board members", icon: "bi-person-badge" },
  { id: "brief", label: "Charter & brief", icon: "bi-journal-richtext" },
  { id: "settings", label: "Settings", icon: "bi-gear" },
];

function errorText(err: unknown): string | null {
  if (!err) return null;
  return getAdminApiErrorMessage(err) ?? (err instanceof Error ? err.message : "Request failed.");
}

export function ExecutiveBoardTab() {
  const board = useBoard();
  const updatesQuery = useBoardUpdates();
  const actions = useBoardActions();
  const meetingsQuery = useBoardMeetings();
  const startMeeting = useStartBoardMeeting();
  const cancelMeeting = useCancelBoardMeeting();

  const [section, setSection] = useState<BoardSection>("actions");
  const [chatPersonaId, setChatPersonaId] = useState<string | null>(null);
  const [editPersonaId, setEditPersonaId] = useState<string | null>(null);
  // null = follow the running meeting (if any); CLOSED_MEETING = user closed the panel.
  const [selectedMeeting, setSelectedMeeting] = useState<string | null>(null);
  const [startForm, setStartForm] = useState<{ mode: BoardMeetingMode; topic: string } | null>(null);

  const overview = board.overview;
  const members = overview?.members ?? [];
  const runningId = overview?.runningMeeting?.meetingId ?? null;
  const selectedMeetingId =
    selectedMeeting === CLOSED_MEETING ? null : selectedMeeting ?? runningId;
  const meetingQuery = useBoardMeeting(selectedMeetingId);

  const openActionsByPersona = useMemo(() => {
    const out: Record<string, number> = {};
    for (const a of actions.actions) {
      if (a.status === "open") out[a.persona] = (out[a.persona] ?? 0) + 1;
    }
    return out;
  }, [actions.actions]);

  const openMeeting = useCallback((meetingId: string) => {
    setSelectedMeeting(meetingId);
    setSection("meetings");
  }, []);

  const runStandup = () => {
    startMeeting.mutate(
      { mode: "standup", chair: overview?.settings.defaultChair },
      { onSuccess: (m) => openMeeting(m.meetingId) },
    );
  };

  const startFromForm = (vars: StartMeetingVariables) => {
    startMeeting.mutate(vars, {
      onSuccess: (m) => {
        setStartForm(null);
        openMeeting(m.meetingId);
      },
    });
  };

  const planDeepDive = (topic = "") => {
    setStartForm({ mode: "deepDive", topic });
    setSection("meetings");
  };

  const chatMember = members.find((m) => m.id === chatPersonaId) ?? null;
  const editMember = members.find((m) => m.id === editPersonaId) ?? null;

  return (
    <div>
      <FinanceDataLoadOrError
        isLoading={board.isLoading}
        isError={board.isError}
        loadErrorMessage="Could not load the Executive Board. Check that the lxsoftware stack is deployed with the board routes."
      />
      {overview ? (
        <>
          <BoardHeaderStrip
            overview={overview}
            onRunStandup={runStandup}
            onPlanDeepDive={() => planDeepDive()}
            onOpenMeeting={openMeeting}
            isStarting={startMeeting.isPending}
            startError={errorText(startMeeting.error)}
          />

          <ul className="nav nav-pills mb-4 flex-nowrap overflow-auto board-section-nav">
            {SECTIONS.map((s) => (
              <li className="nav-item" key={s.id}>
                <button
                  type="button"
                  className={`nav-link ${section === s.id ? "active" : ""}`}
                  onClick={() => setSection(s.id)}
                >
                  <i className={`bi ${s.icon} me-1`} aria-hidden="true" />
                  {s.label}
                  {s.id === "actions" && overview.openActionCount > 0 ? (
                    <span className="badge rounded-pill text-bg-light border ms-2">{overview.openActionCount}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>

          {section === "actions" ? (
            <BoardActionsList
              actions={actions.actions}
              members={members}
              isLoading={actions.isLoading}
              onUpdate={(vars) => actions.update.mutate(vars)}
              onOpenMeeting={openMeeting}
            />
          ) : null}

          {section === "meetings" ? (
            <>
              {startForm ? (
                <StartMeetingForm
                  members={members}
                  defaultChair={overview.settings.defaultChair}
                  initialMode={startForm.mode}
                  initialTopic={startForm.topic}
                  isStarting={startMeeting.isPending}
                  onStart={startFromForm}
                  onCancel={() => setStartForm(null)}
                />
              ) : (
                <div className="d-flex gap-2 mb-3">
                  <button
                    type="button"
                    className="btn btn-outline-primary btn-sm"
                    disabled={Boolean(overview.runningMeeting)}
                    onClick={() => setStartForm({ mode: overview.settings.defaultMode, topic: "" })}
                  >
                    <i className="bi bi-plus-lg me-1" aria-hidden="true" />
                    New meeting…
                  </button>
                </div>
              )}
              {selectedMeetingId ? (
                <BoardMeetingPanel
                  data={meetingQuery.data}
                  isLoading={meetingQuery.isLoading}
                  members={members}
                  onCancel={(id) => cancelMeeting.mutate(id)}
                  isCancelling={cancelMeeting.isPending}
                  onClose={() => setSelectedMeeting(CLOSED_MEETING)}
                />
              ) : null}
              {cancelMeeting.error ? <div className="alert alert-danger py-2 small">{errorText(cancelMeeting.error)}</div> : null}
              <BoardMeetingHistory
                meetings={meetingsQuery.data ?? []}
                members={members}
                selectedMeetingId={selectedMeetingId}
                onOpen={openMeeting}
              />
            </>
          ) : null}

          {section === "members" ? (
            <>
              <p className="text-muted small">
                Eight fixed roles. Each member argues from its own vision, mission and mandate; edit them to
                change how that member thinks. Chat with anyone; the chair can also propose a meeting.
              </p>
              <BoardMembersStrip
                members={members}
                chairId={overview.settings.defaultChair}
                openActionsByPersona={openActionsByPersona}
                onChat={setChatPersonaId}
                onEdit={setEditPersonaId}
              />
            </>
          ) : null}

          {section === "brief" ? (
            <>
              <BoardCharterEditor
                key={`charter-${overview.charter.updatedAt ?? ""}`}
                charter={overview.charter}
                isSaving={board.saveCharter.isPending}
                errorMessage={errorText(board.saveCharter.error)}
                onSave={(c) => board.saveCharter.mutate(c)}
              />
              <BoardBriefEditor
                key={`brief-${overview.brief.updatedAt ?? ""}`}
                brief={overview.brief}
                isSaving={board.saveBrief.isPending}
                errorMessage={errorText(board.saveBrief.error)}
                onSave={(md) => board.saveBrief.mutate(md)}
              />
              <BoardUpdatesComposer
                updates={updatesQuery.data ?? []}
                isPosting={board.postUpdate.isPending}
                errorMessage={errorText(board.postUpdate.error)}
                onPost={(text) => board.postUpdate.mutate(text)}
              />
            </>
          ) : null}

          {section === "settings" ? (
            <BoardSettingsCard
              key={`settings-${overview.settings.updatedAt ?? ""}`}
              overview={overview}
              members={members}
              isSaving={board.saveSettings.isPending}
              errorMessage={errorText(board.saveSettings.error)}
              onSave={(patch) => board.saveSettings.mutate(patch)}
              onRefreshRepo={() => board.refreshRepoSnapshot.mutate()}
              isRefreshingRepo={board.refreshRepoSnapshot.isPending}
              refreshRepoError={errorText(board.refreshRepoSnapshot.error)}
            />
          ) : null}

          <BoardChatOffcanvas
            member={chatMember}
            isChair={chatMember?.id === overview.settings.defaultChair}
            onClose={() => setChatPersonaId(null)}
            onStartMeeting={(mode, topic) => {
              setChatPersonaId(null);
              if (mode === "standup" && !topic) runStandup();
              else {
                setStartForm({ mode, topic });
                setSection("meetings");
              }
            }}
          />

          {editMember ? (
          <BoardMemberEditor
            key={`${editMember.id}-${editMember.updatedAt ?? ""}`}
            member={editMember}
            charter={overview.charter}
            isSaving={board.saveMember.isPending || board.resetMember.isPending}
            errorMessage={errorText(board.saveMember.error) ?? errorText(board.resetMember.error)}
            onSave={(personaId, override) =>
              board.saveMember.mutate({ personaId, override }, { onSuccess: () => setEditPersonaId(null) })
            }
            onReset={(personaId) => board.resetMember.mutate(personaId, { onSuccess: () => setEditPersonaId(null) })}
            onClose={() => setEditPersonaId(null)}
          />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
