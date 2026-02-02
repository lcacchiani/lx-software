export function ContactPage() {
  return (
    <section className="container py-5">
      <div className="row g-4">
        <div className="col-12 col-lg-6">
          <h1 className="display-6 fw-semibold">Contact</h1>
          <p className="text-muted">
            Share your goals and timelines, and we will respond with a focused
            plan for your public website.
          </p>
        </div>
        <div className="col-12 col-lg-6">
          <div className="bg-white border rounded-4 p-4 shadow-sm">
            <h2 className="h5 fw-semibold mb-3">Reach us</h2>
            <dl className="row mb-0">
              <dt className="col-4 text-muted">Email</dt>
              <dd className="col-8 mb-2">hello@lx-software.com</dd>
              <dt className="col-4 text-muted">Location</dt>
              <dd className="col-8 mb-2">Hong Kong</dd>
              <dt className="col-4 text-muted">Response</dt>
              <dd className="col-8">Within 2 business days</dd>
            </dl>
          </div>
        </div>
      </div>
    </section>
  )
}
