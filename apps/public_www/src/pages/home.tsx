import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { defaultSiteContent, fetchSiteContent } from '../lib/content'

export function HomePage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['site-content'],
    queryFn: fetchSiteContent,
  })

  const content = data ?? defaultSiteContent
  const errorMessage =
    error instanceof Error ? error.message : 'Unable to load content.'

  return (
    <section className="container py-5">
      <div className="row align-items-center g-4">
        <div className="col-12 col-lg-6">
          <span className="badge text-bg-primary mb-3">
            LX Software Public Website
          </span>
          <h1 className="display-5 fw-semibold">
            Build the public presence your team deserves.
          </h1>
          <p className="lead text-muted">{content.mission}</p>
          <div className="d-flex flex-wrap gap-2">
            <Link className="btn btn-primary" to="/contact">
              Start a project
            </Link>
            <Link className="btn btn-outline-secondary" to="/about">
              Learn more
            </Link>
          </div>
        </div>
        <div className="col-12 col-lg-6">
          <div className="bg-white border rounded-4 p-4 shadow-sm">
            <h2 className="h5 fw-semibold mb-3">What we deliver</h2>
            <ul className="list-unstyled mb-0">
              {content.highlights.map((item) => (
                <li
                  key={item.title}
                  className="highlight-item border-bottom pb-3 mb-3"
                >
                  <h3 className="h6 fw-semibold mb-1">{item.title}</h3>
                  <p className="text-muted mb-0">{item.description}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="mt-5">
        {isLoading && (
          <div className="d-flex align-items-center gap-2">
            <div className="spinner-border spinner-border-sm" />
            <span className="text-muted">Loading highlights...</span>
          </div>
        )}
        {isError && (
          <div className="alert alert-warning mt-3" role="alert">
            {errorMessage}
          </div>
        )}
      </div>
    </section>
  )
}
