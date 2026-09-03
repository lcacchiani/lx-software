import { useMemo, useState } from "react";
import { AdminDataTable, AdminDataTableEmptyRow, DateTimeDisplay, TableIconButton } from "../ui";
import {
  formatUsageCost,
  MEETING_MODE_LABELS,
  MEETING_STATUS_BADGE_CLASS,
  memberLabel,
  type BoardMeetingSummary,
  type BoardMember,
} from "../../lib/boardModel";

export type BoardMeetingHistoryProps = {
  readonly meetings: readonly BoardMeetingSummary[];
  readonly members: readonly BoardMember[];
  readonly selectedMeetingId: string | null;
  readonly onOpen: (meetingId: string) => void;
};

const COLUMNS = [
  { key: "when", header: "When" },
  { key: "format", header: "Format" },
  { key: "headline", header: "Headline" },
  { key: "actions", header: "Actions", className: "text-end" },
  { key: "cost", header: "Cost", className: "text-end" },
  { key: "status", header: "Status" },
  { key: "ops", header: <span className="visually-hidden">Operations</span>, className: "text-end" },
] as const;

export function BoardMeetingHistory({ meetings, members, selectedMeetingId, onOpen }: BoardMeetingHistoryProps) {
  const [filter, setFilter] = useState("");
  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) =>
      [m.headline, m.topic, m.mode, m.status, memberLabel(members, m.chair)].join(" ").toLowerCase().includes(q),
    );
  }, [meetings, members, filter]);

  return (
    <AdminDataTable columns={COLUMNS} filterValue={filter} onFilterChange={setFilter} filterPlaceholder="Filter meetings…">
      {rows.length === 0 ? (
        <AdminDataTableEmptyRow colSpan={COLUMNS.length} message="No meetings yet." />
      ) : (
        rows.map((m) => (
          <tr key={m.meetingId} className={m.meetingId === selectedMeetingId ? "table-active" : ""}>
            <td><DateTimeDisplay iso={m.createdAt} /></td>
            <td>
              {MEETING_MODE_LABELS[m.mode]}
              {m.trigger.startsWith("schedule") ? <span className="badge text-bg-light border ms-1">auto</span> : null}
            </td>
            <td className="board-clamp-1">{m.headline || m.topic || <span className="text-muted">—</span>}</td>
            <td className="text-end">{m.actionCount}</td>
            <td className="text-end">{formatUsageCost(m.usage?.cost)}</td>
            <td><span className={`badge ${MEETING_STATUS_BADGE_CLASS[m.status]}`}>{m.status}</span></td>
            <td className="text-end">
              <TableIconButton iconClassName="bi bi-journal-text" ariaLabel="Open meeting" onClick={() => onOpen(m.meetingId)} />
            </td>
          </tr>
        ))
      )}
    </AdminDataTable>
  );
}
