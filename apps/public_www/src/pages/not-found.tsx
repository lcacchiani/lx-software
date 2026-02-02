import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <section className="container py-5 text-center">
      <h1 className="display-6 fw-semibold">Page not found</h1>
      <p className="text-muted">
        The page you are looking for does not exist. Let us get you back to the
        LX Software public website.
      </p>
      <Link className="btn btn-primary" to="/">
        Return home
      </Link>
    </section>
  )
}
