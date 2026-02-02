import { Outlet } from 'react-router-dom'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

export function SiteLayout() {
  return (
    <div className="min-vh-100 d-flex flex-column">
      <SiteHeader />
      <main className="flex-grow-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  )
}
