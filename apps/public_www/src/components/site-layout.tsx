import { Outlet } from 'react-router-dom'
import { Sidebar } from './sidebar'

export function SiteLayout() {
  return (
    <div className="site-container">
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
