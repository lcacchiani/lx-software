import { NavLink } from 'react-router-dom'

const navLinks = [
  { label: 'home', to: '/' },
  { label: 'projects', to: '/projects' },
  { label: 'contact', to: '/contact' },
]

export function Sidebar() {
  return (
    <aside className="sidebar">
      <div>
        <NavLink to="/" className="site-title" style={{ textDecoration: 'none' }}>
          LX Software
        </NavLink>
        <p className="site-subtitle">software development · hong kong</p>
      </div>

      <nav className="nav-section">
        <p className="nav-title">navigation</p>
        <ul className="nav-list">
          {navLinks.map((link) => (
            <li key={link.to}>
              <NavLink
                to={link.to}
                className={({ isActive }) =>
                  `nav-link${isActive ? ' active' : ''}`
                }
                end={link.to === '/'}
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="contact-section">
        <p className="contact-title">contact</p>
        <div className="contact-item">
          <a href="mailto:hello@lx-software.com">hello@lx-software.com</a>
        </div>
        <div className="contact-item">Hong Kong</div>
        <div className="contact-item" style={{ marginTop: '1rem' }}>
          <a href="https://github.com/lx-software" target="_blank" rel="noopener noreferrer">
            github
          </a>
        </div>
      </div>
    </aside>
  )
}
