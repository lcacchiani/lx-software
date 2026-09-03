import { useState } from "react";
import { AdminEditorSection, DateTimeDisplay } from "../ui";
import type { BoardUpdate } from "../../lib/boardModel";
import { BOARD_MAX_UPDATE_LEN } from "../../lib/contracts/generated";

export type BoardUpdatesComposerProps = {
  readonly updates: readonly BoardUpdate[];
  readonly isPosting: boolean;
  readonly errorMessage?: string | null;
  readonly onPost: (text: string) => void;
};

export function BoardUpdatesComposer({ updates, isPosting, errorMessage, onPost }: BoardUpdatesComposerProps) {
  const [text, setText] = useState("");

  return (
    <AdminEditorSection
      title="Update the board"
      description="Short notes about what happened since the last meeting (a signed provider, a failed experiment, a decision you took). The ten most recent are read before every meeting."
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isPosting || !text.trim()}
            onClick={() => {
              onPost(text.trim());
              setText("");
            }}
          >
            {isPosting ? "Posting…" : "Post update"}
          </button>
          {errorMessage ? <span className="small text-danger">{errorMessage}</span> : null}
        </>
      }
    >
      <textarea
        className="form-control mb-3"
        rows={3}
        value={text}
        maxLength={BOARD_MAX_UPDATE_LEN}
        placeholder="e.g. Signed two providers in Sai Kung; app-store review rejected the build for missing privacy labels."
        aria-label="Update for the board"
        onChange={(ev) => setText(ev.target.value)}
      />
      {updates.length > 0 ? (
        <ul className="list-group list-group-flush">
          {updates.slice(0, 10).map((u) => (
            <li key={u.updateId} className="list-group-item px-0 py-2">
              <div className="small text-muted">
                <DateTimeDisplay iso={u.createdAt} />
              </div>
              <div className="small">{u.text}</div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small text-muted mb-0">No updates yet.</p>
      )}
    </AdminEditorSection>
  );
}
