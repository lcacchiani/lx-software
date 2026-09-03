import { useState } from "react";
import { AdminEditorSection, DateTimeDisplay } from "../ui";
import type { BoardCharter } from "../../lib/boardModel";
import { BOARD_MAX_CHARTER_FIELD_LEN } from "../../lib/contracts/generated";

export type BoardCharterEditorProps = {
  readonly charter: BoardCharter;
  readonly isSaving: boolean;
  readonly errorMessage?: string | null;
  readonly onSave: (charter: { vision: string; mission: string }) => void;
};

export function BoardCharterEditor({ charter, isSaving, errorMessage, onSave }: BoardCharterEditorProps) {
  const [vision, setVision] = useState(charter.vision);
  const [mission, setMission] = useState(charter.mission);

  const isDirty = vision !== charter.vision || mission !== charter.mission;

  return (
    <AdminEditorSection
      title="Company charter"
      description="Every board member is told the company vision and mission and asked to reconcile their own charter with it."
      footer={
        <>
          <button type="button" className="btn btn-primary" disabled={!isDirty || isSaving} onClick={() => onSave({ vision: vision.trim(), mission: mission.trim() })}>
            {isSaving ? "Saving…" : "Save charter"}
          </button>
          {charter.updatedAt ? (
            <span className="small text-muted">
              Saved <DateTimeDisplay iso={charter.updatedAt} />
            </span>
          ) : null}
          {errorMessage ? <span className="small text-danger">{errorMessage}</span> : null}
        </>
      }
    >
      <div className="row g-3">
        <div className="col-12 col-lg-6">
          <label className="form-label" htmlFor="board-charter-vision">Company vision</label>
          <textarea
            id="board-charter-vision"
            className="form-control"
            rows={3}
            value={vision}
            maxLength={BOARD_MAX_CHARTER_FIELD_LEN}
            placeholder="Where Siu Tin Dei is going and what it will be for parents and providers."
            onChange={(ev) => setVision(ev.target.value)}
          />
          <div className="form-text text-end">{vision.length}/{BOARD_MAX_CHARTER_FIELD_LEN}</div>
        </div>
        <div className="col-12 col-lg-6">
          <label className="form-label" htmlFor="board-charter-mission">Company mission</label>
          <textarea
            id="board-charter-mission"
            className="form-control"
            rows={3}
            value={mission}
            maxLength={BOARD_MAX_CHARTER_FIELD_LEN}
            placeholder="How the company gets there over the next year."
            onChange={(ev) => setMission(ev.target.value)}
          />
          <div className="form-text text-end">{mission.length}/{BOARD_MAX_CHARTER_FIELD_LEN}</div>
        </div>
      </div>
    </AdminEditorSection>
  );
}
