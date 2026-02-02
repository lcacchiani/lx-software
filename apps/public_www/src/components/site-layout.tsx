import { NavLink, Outlet } from 'react-router-dom'

const navLinks = [
  { label: 'home', to: '/' },
  { label: 'projects', to: '/projects' },
  { label: 'contact', to: '/contact' },
]

export function SiteLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* Left Sidebar - 25% */}
      <aside
        style={{
          width: '25%',
          minWidth: '250px',
          padding: '2rem 1.5rem',
          borderRight: '1px solid #006600',
          position: 'fixed',
          height: '100vh',
          overflowY: 'auto',
        }}
      >
        <div style={{ marginBottom: '3rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.5rem' }}>
            LX Software
          </h1>
          <div className="text-dim" style={{ fontSize: '0.875rem' }}>
            Hong Kong
          </div>
        </div>

        <nav style={{ marginBottom: '3rem' }}>
          <div
            className="text-dim"
            style={{ fontSize: '0.75rem', marginBottom: '1rem' }}
          >
            NAVIGATION
          </div>
          {navLinks.map((link) => (
            <NavLink
              key={link.to}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
              to={link.to}
            >
              &gt; {link.label}
            </NavLink>
          ))}
        </nav>

        <div style={{ marginTop: 'auto', paddingTop: '2rem' }}>
          <div
            className="text-dim"
            style={{ fontSize: '0.75rem', marginBottom: '1rem' }}
          >
            CONTACT
          </div>
          <div style={{ fontSize: '0.875rem', lineHeight: '1.8' }}>
            <div>
              <span className="text-dim">email:</span>
              <br />
              <a href="mailto:hello@lx-software.com">hello@lx-software.com</a>
            </div>
            <div style={{ marginTop: '1rem' }}>
              <span className="text-dim">location:</span>
              <br />
              Hong Kong
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content - 75% */}
      <main
        style={{
          marginLeft: '25%',
          width: '75%',
          padding: '2rem 3rem',
        }}
      >
        <Outlet />
      </main>
    </div>
  )
}
