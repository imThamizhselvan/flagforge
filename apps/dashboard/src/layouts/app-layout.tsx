import { NavLink, Outlet, useParams } from 'react-router-dom'
import { OrganizationSwitcher, UserButton } from '@clerk/clerk-react'
import { Flag, FolderOpen, Key, ScrollText, LayoutDashboard, CreditCard } from 'lucide-react'
import { cn } from '@/lib/utils'

const navItems = (projectId: string) => [
  { to: `/projects/${projectId}`, icon: LayoutDashboard, label: 'Overview', end: true },
  { to: `/projects/${projectId}/flags`, icon: Flag, label: 'Flags' },
  { to: `/projects/${projectId}/api-keys`, icon: Key, label: 'API Keys' },
  { to: `/projects/${projectId}/audit`, icon: ScrollText, label: 'Audit Log' },
]

export function AppLayout() {
  const { projectId } = useParams<{ projectId: string }>()

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-56 flex-col border-r border-border bg-card">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Flag className="h-5 w-5 text-primary" />
          <span className="font-semibold text-sm">FlagForge</span>
        </div>

        <div className="border-b border-border p-3">
          <OrganizationSwitcher
            appearance={{ elements: { rootBox: 'w-full', organizationSwitcherTrigger: 'w-full text-xs' } }}
          />
        </div>

        {projectId && (
          <nav className="flex-1 space-y-1 p-2">
            {navItems(projectId).map(({ to, icon: Icon, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ))}
          </nav>
        )}

        {!projectId && (
          <div className="flex-1 p-2">
            <NavLink
              to="/projects"
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted',
                )
              }
            >
              <FolderOpen className="h-4 w-4" />
              Projects
            </NavLink>
          </div>
        )}

        <div className="border-t border-border p-3 space-y-1">
          <NavLink
            to="/billing"
            className={({ isActive }) =>
              cn(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                isActive ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )
            }
          >
            <CreditCard className="h-4 w-4" />
            Billing
          </NavLink>
          <div className="px-3 py-2">
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
