import { memberInitials, type BoardMember } from "../../lib/boardModel";

export type BoardMembersStripProps = {
  readonly members: readonly BoardMember[];
  readonly chairId: string;
  readonly openActionsByPersona: Readonly<Record<string, number>>;
  readonly onChat: (personaId: string) => void;
  readonly onEdit: (personaId: string) => void;
};

export function BoardMembersStrip({ members, chairId, openActionsByPersona, onChat, onEdit }: BoardMembersStripProps) {
  return (
    <div className="row g-3 mb-4">
      {members.map((m) => {
        const isCustomised = Object.values(m.isOverridden).some(Boolean);
        return (
          <div key={m.id} className="col-12 col-sm-6 col-xl-3">
            <div className="card h-100 shadow-sm board-member-card">
              <div className="card-body d-flex flex-column">
                <div className="d-flex align-items-center gap-3 mb-2">
                  <div className="board-avatar" aria-hidden="true">{memberInitials(m)}</div>
                  <div className="flex-grow-1 min-w-0">
                    <div className="fw-semibold text-truncate">
                      {m.displayName}
                      {m.id === chairId ? (
                        <span className="badge text-bg-dark ms-2" title="Chairs meetings by default">Chair</span>
                      ) : null}
                    </div>
                    <div className="small text-muted text-truncate">{m.title}</div>
                  </div>
                </div>
                <p className="small text-muted flex-grow-1 mb-2 board-clamp-3">{m.mandate}</p>
                <div className="d-flex align-items-center justify-content-between">
                  <div className="small text-muted">
                    {openActionsByPersona[m.id] ?? 0} open
                    {isCustomised ? <span className="badge text-bg-info ms-2">Customised</span> : null}
                  </div>
                  <div className="d-flex gap-1">
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => onChat(m.id)}>
                      <i className="bi bi-chat-dots me-1" aria-hidden="true" />
                      Chat
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      aria-label={`Edit ${m.displayName}`}
                      title="Edit vision, mission and mandate"
                      onClick={() => onEdit(m.id)}
                    >
                      <i className="bi bi-pencil" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
