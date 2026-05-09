/**
 * Placeholder for the future Expenses tab: documents categories and parity
 * with the Income sheet before persistence and API work land.
 */
export function ExpensesPlanPanel() {
  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <h2 className="h6 text-uppercase text-muted">Expenses (planned)</h2>
        <p className="text-muted mb-3">
          This tab will mirror the Income workflow: a small form to add or edit rows and a
          filterable table listing saved entries. Each row will use the same fields as
          income (category, description, amount, currency), backed by a dedicated DynamoDB
          item and a PUT endpoint such as /finance/expenses, with expense records included
          on the existing GET /finance response alongside houses and income.
        </p>
        <p className="small text-muted mb-2">Planned categories (fixed list, like Income):</p>
        <ul className="small mb-0">
          <li>Utility</li>
          <li>Saving</li>
          <li>Investment</li>
          <li>Rent</li>
          <li>Insurance</li>
          <li>Retirement</li>
        </ul>
      </div>
    </div>
  );
}
