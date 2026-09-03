import { DateTimeDisplay } from "../ui";
import {
  formatUsageCost,
  meetingPhaseProgress,
  MEETING_MODE_LABELS,
  type BoardOverview,
} from "../../lib/boardModel";

export type BoardHeaderStripProps = {
  readonly overview: BoardOverview;
  readonly onRunStandup: () => void;
  readonly onPlanDeepDive: () => void;
  readonly onOpenMeeting: (meetingId: string) => void;
  readonly isStarting: boolean;
  readonly startError?: string | null;
};

export function BoardHeaderStrip({
  overview,
  onRunStandup,
  onPlanDeepDive,
  onOpenMeeting,
  isStarting,
  startError,
}: BoardHeaderStripProps) {
  const running = overview.runningMeeting;
  const latest = overview.latestMeeting;
  const usage = overview.usageToday;
  const budgetPct =
    usage.budgetUsd > 0 ? Math.min(100, Math.round((usage.cost / usage.budgetUsd) * 100)) : 0;
  const isBudgetOut = usage.budgetUsd > 0 && usage.cost >= usage.budgetUsd;

  return (
    <div className="card shadow-sm mb-4">
      <div className="card-body">
        <div className="row g-3 align-items-start">
          <div className="col-12 col-lg-6">
            {running ? (
              <>
                <div className="d-flex align-items-center gap-2 mb-1">
                  <span className="spinner-border spinner-border-sm text-primary" role="status" aria-hidden="true" />
                  <span className="fw-semibold">
                    {MEETING_MODE_LABELS[running.mode]} in progress
                  </span>
                  <span className="badge text-bg-primary">{meetingPhaseProgress(running).label}</span>
                </div>
                <div className="progress mb-2" style={{ height: 6 }} aria-hidden="true">
                  <div
                    className="progress-bar progress-bar-striped progress-bar-animated"
                    style={{ width: `${meetingPhaseProgress(running).percent}%` }}
                  />
                </div>
                <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onOpenMeeting(running.meetingId)}>
                  Watch the meeting
                </button>
              </>
            ) : latest ? (
              <>
                <div className="text-uppercase small text-muted">Latest meeting</div>
                <div className="fw-semibold">{latest.headline || `${MEETING_MODE_LABELS[latest.mode]} meeting`}</div>
                <div className="small text-muted">
                  <DateTimeDisplay iso={latest.createdAt} /> · {latest.actionCount} action
                  {latest.actionCount === 1 ? "" : "s"} · {formatUsageCost(latest.usage?.cost)}
                </div>
                <button type="button" className="btn btn-sm btn-link px-0" onClick={() => onOpenMeeting(latest.meetingId)}>
                  Read the minutes
                </button>
              </>
            ) : (
              <>
                <div className="text-uppercase small text-muted">No meetings yet</div>
                <div className="text-muted small">
                  Write the company brief, then run the first stand-up. The board reads the brief, your
                  updates and open actions before every meeting.
                </div>
              </>
            )}
          </div>
          <div className="col-6 col-lg-2">
            <div className="text-uppercase small text-muted">Open actions</div>
            <div className="h3 mb-0">{overview.openActionCount}</div>
          </div>
          <div className="col-6 col-lg-2">
            <div className="text-uppercase small text-muted">Spend today</div>
            <div className={`fw-semibold ${isBudgetOut ? "text-danger" : ""}`}>
              {formatUsageCost(usage.cost)}
              <span className="text-muted small"> / {formatUsageCost(usage.budgetUsd)}</span>
            </div>
            <div className="progress mt-1" style={{ height: 4 }} aria-hidden="true">
              <div className={`progress-bar ${isBudgetOut ? "bg-danger" : ""}`} style={{ width: `${budgetPct}%` }} />
            </div>
          </div>
          <div className="col-12 col-lg-2 d-grid gap-2">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={onRunStandup}
              disabled={isStarting || Boolean(running) || isBudgetOut}
            >
              {isStarting ? "Starting…" : "Run stand-up"}
            </button>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              onClick={onPlanDeepDive}
              disabled={isStarting || Boolean(running) || isBudgetOut}
            >
              Deep dive…
            </button>
          </div>
        </div>
        {startError ? <div className="alert alert-danger py-2 mt-3 mb-0 small">{startError}</div> : null}
      </div>
    </div>
  );
}
