import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div>
      <div style={{ marginBottom: '3rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '1rem' }}>404</h1>
        <p
          className="text-muted"
          style={{ fontSize: '1.1rem', maxWidth: '600px', lineHeight: '1.8' }}
        >
          ERROR: Page not found. The requested resource does not exist in the
          system.
        </p>
      </div>

      <div className="text-dim" style={{ fontSize: '0.875rem' }}>
        &gt; <Link to="/">Return to home</Link>
        <span className="terminal-cursor">_</span>
      </div>
    </div>
  )
}
