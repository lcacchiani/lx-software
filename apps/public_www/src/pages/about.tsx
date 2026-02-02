export function AboutPage() {
  return (
    <section className="container py-5">
      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <h1 className="display-6 fw-semibold">About LX Software</h1>
          <p className="text-muted">
            We partner with teams that need a public website that is polished,
            fast, and easy to evolve. Our work blends product thinking, clean
            engineering, and modern delivery practices.
          </p>
          <p className="text-muted">
            This site is built on Vite, React Router, TanStack Query, and
            Bootstrap 5, making it lightweight to maintain while keeping the
            experience responsive and reliable.
          </p>
        </div>
        <div className="col-12 col-lg-5">
          <div className="bg-white border rounded-4 p-4 shadow-sm">
            <h2 className="h5 fw-semibold mb-3">Focus areas</h2>
            <ul className="list-unstyled mb-0">
              <li className="mb-2">Public website strategy</li>
              <li className="mb-2">Content and messaging systems</li>
              <li className="mb-2">Infrastructure-ready delivery</li>
              <li>Performance and accessibility</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
