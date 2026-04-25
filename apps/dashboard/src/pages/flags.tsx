import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Plus, Flag, ToggleLeft, ToggleRight, ChevronRight } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

interface FlagEnvConfig {
  id: string
  enabled: boolean
  environmentId: string
  environment: { key: string; name: string }
}

interface FlagItem {
  id: string
  key: string
  name: string
  type: 'BOOLEAN' | 'MULTIVARIATE'
  createdAt: string
  envConfigs: FlagEnvConfig[]
}

export function FlagsPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { request } = useApi()
  const navigate = useNavigate()
  const [flags, setFlags] = useState<FlagItem[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ key: '', name: '', type: 'BOOLEAN' as const })
  const [togglingId, setTogglingId] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId) return
    request<FlagItem[]>(`/v1/projects/${projectId}/flags`)
      .then(setFlags)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId, request])

  async function createFlag() {
    if (!form.key || !form.name) return
    setCreating(true)
    setError('')
    try {
      const flag = await request<FlagItem>(`/v1/projects/${projectId}/flags`, {
        method: 'POST',
        body: JSON.stringify(form),
      })
      setFlags((prev) => [flag, ...prev])
      setOpen(false)
      setForm({ key: '', name: '', type: 'BOOLEAN' })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create flag')
    } finally {
      setCreating(false)
    }
  }

  async function toggleFlag(flag: FlagItem, envConfig: FlagEnvConfig) {
    const toggleKey = `${flag.id}-${envConfig.environmentId}`
    setTogglingId(toggleKey)
    try {
      await request(`/v1/flags/${flag.id}/environments/${envConfig.environmentId}`, {
        method: 'PUT',
        body: JSON.stringify({ enabled: !envConfig.enabled }),
      })
      setFlags((prev) =>
        prev.map((f) =>
          f.id !== flag.id
            ? f
            : {
                ...f,
                envConfigs: f.envConfigs.map((c) =>
                  c.environmentId === envConfig.environmentId ? { ...c, enabled: !c.enabled } : c,
                ),
              },
        ),
      )
    } catch (e) {
      console.error(e)
    } finally {
      setTogglingId(null)
    }
  }

  const prodConfig = (flag: FlagItem) =>
    flag.envConfigs.find((c) => c.environment.key === 'production')

  return (
    <div className="p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Feature Flags</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and manage flags for this project</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" />
              New Flag
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create feature flag</DialogTitle>
            </DialogHeader>
            <div className="mt-4 space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Flag key</label>
                <Input
                  placeholder="new-checkout-flow"
                  value={form.key}
                  onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/\s+/g, '-') })}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">Lowercase, hyphens only. Cannot be changed.</p>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Display name</label>
                <Input
                  placeholder="New Checkout Flow"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <div className="flex gap-2">
                  {(['BOOLEAN', 'MULTIVARIATE'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setForm({ ...form, type: t })}
                      className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                        form.type === t
                          ? 'border-primary bg-primary/10 text-primary font-medium'
                          : 'border-border hover:bg-muted'
                      }`}
                    >
                      {t === 'BOOLEAN' ? 'Boolean (on/off)' : 'Multivariate (A/B/n)'}
                    </button>
                  ))}
                </div>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={createFlag} disabled={creating || !form.key || !form.name}>
                  {creating ? 'Creating…' : 'Create flag'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : flags.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20">
          <Flag className="h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No flags yet</p>
          <p className="mt-1 text-xs text-muted-foreground">Create your first feature flag to get started</p>
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Flag</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Production</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Environments</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {flags.map((flag) => {
                const prod = prodConfig(flag)
                return (
                  <tr
                    key={flag.id}
                    className="cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => navigate(`/projects/${projectId}/flags/${flag.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{flag.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{flag.key}</div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{flag.type}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      {prod ? (
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          <Switch
                            checked={prod.enabled}
                            onCheckedChange={() => toggleFlag(flag, prod)}
                            disabled={togglingId === `${flag.id}-${prod.environmentId}`}
                          />
                          <span className={prod.enabled ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                            {prod.enabled ? 'On' : 'Off'}
                          </span>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        {flag.envConfigs.map((c) => (
                          <span
                            key={c.id}
                            className={`rounded px-2 py-0.5 text-xs font-medium ${
                              c.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {c.environment.key}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
