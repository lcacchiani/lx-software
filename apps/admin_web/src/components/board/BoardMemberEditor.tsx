import { useState } from "react";
import { BoardOffcanvas } from "./BoardOffcanvas";
import {
  BOARD_CHARTER_FIELDS,
  type BoardCharter,
  type BoardCharterField,
  type BoardMember,
  type BoardMemberOverride,
} from "../../lib/boardModel";
import {
  BOARD_MAX_CHARTER_FIELD_LEN,
  BOARD_MAX_DISPLAY_NAME_LEN,
} from "../../lib/contracts/generated";

export type BoardMemberEditorProps = {
  readonly member: BoardMember;
  readonly charter: BoardCharter;
  readonly isSaving: boolean;
  readonly errorMessage?: string | null;
  readonly onSave: (personaId: string, override: BoardMemberOverride) => void;
  readonly onReset: (personaId: string) => void;
  readonly onClose: () => void;
};

const FIELD_HELP: Readonly<Record<BoardCharterField, { readonly label: string; readonly help: string }>> = {
  vision: { label: "Vision", help: "The long-term outcome this member steers towards." },
  mission: { label: "Mission", help: "What this member does day to day to get there." },
  mandate: { label: "Mandate", help: "Scope of authority and the questions they must always answer in a meeting." },
};

type Draft = Record<BoardCharterField | "displayName", string>;

function draftFromMember(m: BoardMember): Draft {
  return {
    vision: m.isOverridden.vision ? m.vision : "",
    mission: m.isOverridden.mission ? m.mission : "",
    mandate: m.isOverridden.mandate ? m.mandate : "",
    displayName: m.isOverridden.displayName ? m.displayName : "",
  };
}

/** Mount with `key={member.id + member.updatedAt}` so a saved member re-seeds the draft. */
export function BoardMemberEditor({ member, charter, isSaving, errorMessage, onSave, onReset, onClose }: BoardMemberEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => draftFromMember(member));
  const [showPreview, setShowPreview] = useState(false);

  const effective = (field: BoardCharterField): string => draft[field].trim() || member.defaults[field];
  const hasAnyOverride = Object.values(draft).some((v) => v.trim().length > 0);

  const previewLines = [
    `You are ${draft.displayName.trim() || member.shortName}, ${member.title} (${member.shortName}).`,
    `Your vision: ${effective("vision")}`,
    `Your mission: ${effective("mission")}`,
    `Your mandate: ${effective("mandate")}`,
    `Focus areas: ${member.focusAreas.join("; ")}.`,
    `KPIs you own: ${member.kpisOwned.join("; ")}.`,
    charter.vision ? `Company vision: ${charter.vision}` : "",
    charter.mission ? `Company mission: ${charter.mission}` : "",
  ].filter(Boolean);

  return (
    <BoardOffcanvas
      isOpen
      wide
      title={`Edit ${member.displayName}`}
      subtitle={`${member.title} · blank fields fall back to the built-in defaults`}
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="btn btn-primary"
            disabled={isSaving}
            onClick={() => onSave(member.id, { ...draft })}
          >
            {isSaving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary"
            disabled={isSaving || !Object.values(member.isOverridden).some(Boolean)}
            onClick={() => onReset(member.id)}
          >
            Reset to defaults
          </button>
          <button type="button" className="btn btn-link" onClick={onClose} disabled={isSaving}>
            Close
          </button>
        </>
      }
    >
      <div className="mb-3">
        <label className="form-label" htmlFor="board-member-displayname">
          Display name <span className="text-muted">(optional)</span>
        </label>
        <input
          id="board-member-displayname"
          className="form-control"
          value={draft.displayName}
          maxLength={BOARD_MAX_DISPLAY_NAME_LEN}
          placeholder={member.shortName}
          onChange={(ev) => setDraft((d) => ({ ...d, displayName: ev.target.value }))}
        />
      </div>

      {BOARD_CHARTER_FIELDS.map((field) => {
        const value = draft[field];
        const isCustom = value.trim().length > 0;
        return (
          <div className="mb-3" key={field}>
            <div className="d-flex justify-content-between align-items-baseline">
              <label className="form-label mb-1" htmlFor={`board-member-${field}`}>
                {FIELD_HELP[field].label}
                {isCustom ? <span className="badge text-bg-info ms-2">Customised</span> : <span className="badge text-bg-light border ms-2">Default</span>}
              </label>
              <span className="small text-muted">
                {value.length}/{BOARD_MAX_CHARTER_FIELD_LEN}
                {isCustom ? (
                  <>
                    {" · "}
                    <button type="button" className="btn btn-link btn-sm p-0 align-baseline" onClick={() => setDraft((d) => ({ ...d, [field]: "" }))}>
                      Use default
                    </button>
                  </>
                ) : null}
              </span>
            </div>
            <textarea
              id={`board-member-${field}`}
              className="form-control"
              rows={3}
              value={value}
              maxLength={BOARD_MAX_CHARTER_FIELD_LEN}
              placeholder={member.defaults[field]}
              onChange={(ev) => setDraft((d) => ({ ...d, [field]: ev.target.value }))}
            />
            <div className="form-text">{FIELD_HELP[field].help}</div>
          </div>
        );
      })}

      {errorMessage ? <div className="alert alert-danger py-2 small">{errorMessage}</div> : null}

      <div className="mt-auto">
        <button
          type="button"
          className="btn btn-link btn-sm px-0"
          aria-expanded={showPreview}
          onClick={() => setShowPreview((v) => !v)}
        >
          <i className={`bi ${showPreview ? "bi-chevron-down" : "bi-chevron-right"} me-1`} aria-hidden="true" />
          Effective prompt preview
        </button>
        {showPreview ? (
          <pre className="small bg-light border rounded p-2 mb-0 text-wrap">{previewLines.join("\n")}</pre>
        ) : null}
        {!hasAnyOverride ? (
          <div className="form-text">This member currently uses the built-in charter.</div>
        ) : null}
      </div>
    </BoardOffcanvas>
  );
}
