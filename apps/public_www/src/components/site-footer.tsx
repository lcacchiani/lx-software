export function SiteFooter() {
  return (
    <footer className="border-top bg-white mt-auto">
      <div className="container d-flex flex-column flex-md-row gap-2 py-4">
        <span className="text-muted">
          © {new Date().getFullYear()} LX Software. All rights reserved.
        </span>
        <span className="text-muted ms-md-auto">
          Built with Vite, React Router, TanStack Query, and Bootstrap 5.
        </span>
      </div>
    </footer>
  )
}
