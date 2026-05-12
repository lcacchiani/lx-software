export function DashboardSessionCard({
  isLoading,
  isError,
  sub,
  email,
}: {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly sub: string | undefined;
  readonly email: string | undefined;
}) {
  return (
    <div className="card mt-3 shadow-sm">
      <div className="card-body">
        <h2 className="h6 text-uppercase text-muted">Session</h2>
        {isLoading ? (
          <p className="mb-0 small text-muted">Loading profile…</p>
        ) : isError ? (
          <p className="mb-0 small text-danger">
            Could not load profile. Check API configuration and sign-in.
          </p>
        ) : (
          <dl className="row small mb-0">
            <dt className="col-sm-3">Subject</dt>
            <dd className="col-sm-9">{sub ?? "—"}</dd>
            <dt className="col-sm-3">Email</dt>
            <dd className="col-sm-9">{email ?? "—"}</dd>
          </dl>
        )}
      </div>
    </div>
  );
}
