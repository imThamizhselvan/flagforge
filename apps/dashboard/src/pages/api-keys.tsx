import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { Plus, Copy, Trash2, Eye, EyeOff } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface ApiKeyItem {
  id: string
  keyPrefix: string
  type: 'SERVER' | 'CLIENT'
  createdAt: string
  environment: { key: string; name: string }
  rawKey?: string
}

interface Environment {
  id: string
  key: string
  name: string
}

interface Project {
  id: string
  environments: Environment[]
}

export function ApiKeysPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { request } = useApi()
  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [project, setProject] = useState<Project | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newKey, setNewKey] = useState<ApiKeyItem | null>(null)
  const [showRaw, setShowRaw] = useState(false)
  const [form, setForm] = useState({ environmentId: '', type: 'SERVER' as const })

  useEffect(() => {
    if (!projectId) return
    Promise.all([
      request<ApiKeyItem[]>(`/v1/projects/${projectId}/api-keys`),
      request<Project[]>('/v1/projects').then((ps) => ps.find((p) => p.id === projectId) ?? null),
    ]).then(([k, p]) => {
      setKeys(k)
      setProject(p)
      if (p?.environments[0]) setForm((f) => ({ ...f, environmentId: p.environments[0]!.id }))
    }).catch(console.error).finally(() => setLoading(false))
  }, [projectId, request])

  async function createKey() {
    setCreating(true)
    try {
      const key = await request<ApiKeyItem>(`/v1/projects/${projectId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setNewKey(key)
      setKeys((prev) => [key, ...prev])
      setOpen(false)
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(id: string) {
    await request(`/v1/api-keys/${id}`, { method: 'DELETE' })
    setKeys((prev) => prev.filter((k) => k.id !== id))
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">API Keys</h1>
          <p className="mt-1 text-sm text-muted-foreground">Keys are scoped to a specific environment</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4" /> New Key</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create API key</DialogTitle></DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Environment</label>
                <select
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm"
                  value={form.environmentId}
                  onChange={(e) => setForm({ ...form, environmentId: e.target.value })}
                >
                  {project?.environments.map((env) => (
                    <option key={env.id} value={env.id}>{env.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <div className="flex gap-2">
                  {(['SERVER', 'CLIENT'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, type: t })}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                        form.type === t ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border hover:bg-muted'
                      }`}
                    >
                      {t === 'SERVER' ? 'Server (secret)' : 'Client (public)'}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={createKey} disabled={creating || !form.environmentId}>
                  {creating ? 'Creating…' : 'Create key'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* One-time raw key display */}
      {newKey?.rawKey && (
        <Card className="border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20">
          <CardHeader>
            <CardTitle className="text-emerald-700 dark:text-emerald-400">Save your key</CardTitle>
            <CardDescription>This key will not be shown again.</CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white dark:bg-black/20 border border-emerald-200 px-3 py-2 text-sm font-mono">
              {showRaw ? newKey.rawKey : '•'.repeat(40)}
            </code>
            <Button size="icon" variant="ghost" onClick={() => setShowRaw((s) => !s)}>
              {showRaw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
            <Button size="icon" variant="ghost" onClick={() => navigator.clipboard.writeText(newKey.rawKey!)}>
              <Copy className="h-4 w-4" />
            </Button>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted" />)}</div>
      ) : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Key</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Environment</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {keys.map((key) => (
                <tr key={key.id}>
                  <td className="px-4 py-3 font-mono text-xs">{key.keyPrefix}••••••••</td>
                  <td className="px-4 py-3"><Badge variant="secondary">{key.type}</Badge></td>
                  <td className="px-4 py-3">{key.environment.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{new Date(key.createdAt).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => revokeKey(key.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
