import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return (
    <div className="not-found fade-in">
      <div className="not-found-code">404</div>
      <p className="not-found-message">
        the page you are looking for does not exist
      </p>
      <Link to="/">return home</Link>
    </div>
  )
}
