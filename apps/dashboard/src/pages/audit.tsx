import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '@/hooks/use-api'
import { Badge } from '@/components/ui/badge'

interface AuditEntry {
  id: string
  actorUserId: string
  action: string
  resourceType: string
  resourceId: string
  diff: unknown
  createdAt: string
}

const actionColor: Record<string, 'default' | 'success' | 'destructive' | 'secondary'> = {
  'flag.created': 'success',
  'flag.updated': 'default',
  'flag_config.updated': 'default',
}

export function AuditPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { request } = useApi()
  const [logs, setLogs] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    request<AuditEntry[]>(`/v1/projects/${projectId}/audit`)
      .then(setLogs)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId, request])

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">All changes made in this project</p>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No audit events yet.</p>
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <div key={log.id} className="flex items-center gap-4 rounded-lg border border-border px-4 py-3 text-sm">
              <span className="w-36 shrink-0 text-muted-foreground text-xs">
                {new Date(log.createdAt).toLocaleString()}
              </span>
              <Badge variant={actionColor[log.action] ?? 'secondary'}>{log.action}</Badge>
              <span className="text-muted-foreground">{log.resourceType}</span>
              <code className="text-xs text-muted-foreground">{log.resourceId.slice(0, 8)}…</code>
              <span className="text-xs text-muted-foreground ml-auto">by {log.actorUserId.slice(0, 12)}…</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
