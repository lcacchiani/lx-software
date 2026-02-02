import { NavLink } from 'react-router-dom'

const navLinks = [
  { label: 'Home', to: '/' },
  { label: 'About', to: '/about' },
  { label: 'Contact', to: '/contact' },
]

export function SiteHeader() {
  return (
    <header className="border-bottom bg-white">
      <nav className="container d-flex flex-wrap align-items-center gap-3 py-3">
        <NavLink className="navbar-brand fw-semibold" to="/">
          LX Software
        </NavLink>
        <span className="text-muted">Public Website</span>
        <div className="ms-auto d-flex gap-3">
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              className={({ isActive }) =>
                `nav-link px-0${isActive ? ' fw-semibold' : ''}`
              }
              to={link.to}
            >
              {link.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </header>
  )
}
