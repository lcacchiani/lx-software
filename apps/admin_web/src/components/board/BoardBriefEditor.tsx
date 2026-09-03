import { useState } from "react";
import { AdminEditorSection, DateTimeDisplay } from "../ui";
import { BoardMarkdown } from "./BoardMarkdown";
import type { BoardBrief } from "../../lib/boardModel";
import { BOARD_MAX_BRIEF_LEN } from "../../lib/contracts/generated";

export type BoardBriefEditorProps = {
  readonly brief: BoardBrief;
  readonly isSaving: boolean;
  readonly errorMessage?: string | null;
  readonly onSave: (markdown: string) => void;
};

const BRIEF_TEMPLATE = `# Where we are
- Product: …
- Users / providers today: …
- Revenue today: …

# What "live" means
…

# What "profitable" means
…

# Constraints
- Time per week: …
- Budget: …
- Hard deadlines: …

# What I want the board to focus on
…
`;

export function BoardBriefEditor({ brief, isSaving, errorMessage, onSave }: BoardBriefEditorProps) {
  const [markdown, setMarkdown] = useState(brief.markdown);
  const [isPreview, setIsPreview] = useState(false);

  const isDirty = markdown !== brief.markdown;

  return (
    <AdminEditorSection
      title="Company brief"
      description="The single most important input. Written by you, read verbatim by every member before each chat and meeting: current state, targets, constraints and what live and profitable mean."
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!isDirty || isSaving} onClick={() => onSave(markdown)}>
            {isSaving ? "Saving…" : "Save brief"}
          </button>
          {!markdown.trim() ? (
            <button type="button" className="btn btn-outline-secondary" onClick={() => setMarkdown(BRIEF_TEMPLATE)}>
              Insert template
            </button>
          ) : null}
          {brief.updatedAt ? (
            <span className="small text-muted">
              Saved <DateTimeDisplay iso={brief.updatedAt} />
            </span>
          ) : null}
          {errorMessage ? <span className="small text-danger">{errorMessage}</span> : null}
        </>
      }
    >
      <ul className="nav nav-pills nav-sm mb-2 small">
        <li className="nav-item">
          <button type="button" className={`nav-link py-1 ${isPreview ? "" : "active"}`} onClick={() => setIsPreview(false)}>Write</button>
        </li>
        <li className="nav-item">
          <button type="button" className={`nav-link py-1 ${isPreview ? "active" : ""}`} onClick={() => setIsPreview(true)}>Preview</button>
        </li>
      </ul>
      {isPreview ? (
        <div className="border rounded p-3 bg-light board-brief-preview">
          {markdown.trim() ? <BoardMarkdown text={markdown} /> : <span className="text-muted">Nothing to preview yet.</span>}
        </div>
      ) : (
        <>
          <textarea
            className="form-control font-monospace small"
            rows={14}
            value={markdown}
            maxLength={BOARD_MAX_BRIEF_LEN}
            placeholder="Markdown. Use the template button below to start."
            aria-label="Company brief (Markdown)"
            onChange={(ev) => setMarkdown(ev.target.value)}
          />
          <div className="form-text text-end">{markdown.length.toLocaleString()}/{BOARD_MAX_BRIEF_LEN.toLocaleString()}</div>
        </>
      )}
    </AdminEditorSection>
  );
}
