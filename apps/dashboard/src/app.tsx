import { Routes, Route, Navigate } from 'react-router-dom'
import { SignIn, SignUp, useAuth } from '@clerk/clerk-react'
import { AppLayout } from './layouts/app-layout'
import { ProjectsPage } from './pages/projects'
import { FlagsPage } from './pages/flags'
import { FlagDetailPage } from './pages/flag-detail'
import { ApiKeysPage } from './pages/api-keys'
import { AuditPage } from './pages/audit'

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth()
  if (!isLoaded) return <div className="flex h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>
  if (!isSignedIn) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

export function App() {
  return (
    <Routes>
      <Route
        path="/sign-in/*"
        element={<div className="flex h-screen items-center justify-center"><SignIn routing="path" path="/sign-in" /></div>}
      />
      <Route
        path="/sign-up/*"
        element={<div className="flex h-screen items-center justify-center"><SignUp routing="path" path="/sign-up" /></div>}
      />
      <Route
        element={<AuthGuard><AppLayout /></AuthGuard>}
      >
        <Route index element={<Navigate to="/projects" replace />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:projectId" element={<Navigate to="flags" replace />} />
        <Route path="/projects/:projectId/flags" element={<FlagsPage />} />
        <Route path="/projects/:projectId/flags/:flagId" element={<FlagDetailPage />} />
        <Route path="/projects/:projectId/api-keys" element={<ApiKeysPage />} />
        <Route path="/projects/:projectId/audit" element={<AuditPage />} />
      </Route>
    </Routes>
  )
}
