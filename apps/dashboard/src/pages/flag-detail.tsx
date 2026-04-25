import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useApi } from '@/hooks/use-api'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

interface Rule {
  id: string
  description?: string
  conditions: Array<{ attribute: string; operator: string; values: (string | number)[] }>
  variantKey: string
}

interface FlagEnvConfig {
  id: string
  enabled: boolean
  environmentId: string
  defaultVariantKey: string
  rules: Rule[]
  rollout: Record<string, number>
  version: number
  environment: { key: string; name: string }
}

interface FlagDetail {
  id: string
  key: string
  name: string
  description?: string
  type: 'BOOLEAN' | 'MULTIVARIATE'
  variants: Array<{ key: string; value: unknown }>
  envConfigs: FlagEnvConfig[]
}

interface RollupPoint {
  hour: string
  flagKey: string
  variantKey: string
  count: number
}

export function FlagDetailPage() {
  const { projectId, flagId } = useParams<{ projectId: string; flagId: string }>()
  const { request } = useApi()
  const [flag, setFlag] = useState<FlagDetail | null>(null)
  const [analytics, setAnalytics] = useState<RollupPoint[]>([])
  const [activeEnv, setActiveEnv] = useState<string>('production')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!flagId) return
    Promise.all([
      request<FlagDetail>(`/v1/flags/${flagId}`),
      request<RollupPoint[]>(`/v1/flags/${flagId}/analytics`),
    ]).then(([f, a]) => {
      setFlag(f)
      setAnalytics(a)
    }).catch(console.error)
  }, [flagId, request])

  const activeConfig = flag?.envConfigs.find((c) => c.environment.key === activeEnv)

  async function toggleEnv() {
    if (!flag || !activeConfig) return
    setSaving(true)
    try {
      const updated = await request<FlagEnvConfig>(
        `/v1/flags/${flag.id}/environments/${activeConfig.environmentId}`,
        { method: 'PUT', body: JSON.stringify({ enabled: !activeConfig.enabled }) },
      )
      setFlag((prev) => prev && {
        ...prev,
        envConfigs: prev.envConfigs.map((c) =>
          c.environmentId === activeConfig.environmentId ? { ...c, ...updated } : c,
        ),
      })
    } finally {
      setSaving(false)
    }
  }

  // Aggregate analytics data for chart
  const chartData = analytics.reduce<Record<string, Record<string, number>>>((acc, point) => {
    const hour = new Date(point.hour).toLocaleString('en', { month: 'short', day: 'numeric', hour: 'numeric' })
    if (!acc[hour]) acc[hour] = { hour: hour as unknown as number }
    acc[hour]![point.variantKey] = (acc[hour]![point.variantKey] ?? 0) + point.count
    return acc
  }, {})
  const chartPoints = Object.values(chartData)
  const variantKeys = [...new Set(analytics.map((a) => a.variantKey))]
  const COLORS = ['#8b5cf6', '#06b6d4', '#f59e0b', '#10b981']

  if (!flag) {
    return <div className="p-8"><div className="h-8 w-48 animate-pulse rounded bg-muted" /></div>
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{flag.name}</h1>
          <code className="mt-1 text-sm text-muted-foreground">{flag.key}</code>
          {flag.description && <p className="mt-2 text-sm text-muted-foreground">{flag.description}</p>}
        </div>
        <Badge variant="secondary">{flag.type}</Badge>
      </div>

      {/* Environment tabs */}
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        {flag.envConfigs.map((c) => (
          <button
            key={c.environmentId}
            onClick={() => setActiveEnv(c.environment.key)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
              activeEnv === c.environment.key
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {c.environment.name}
          </button>
        ))}
      </div>

      {activeConfig && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader><CardTitle>Status</CardTitle></CardHeader>
            <CardContent className="flex items-center gap-3">
              <Switch checked={activeConfig.enabled} onCheckedChange={toggleEnv} disabled={saving} />
              <span className={activeConfig.enabled ? 'text-emerald-600 font-medium' : 'text-muted-foreground'}>
                {activeConfig.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Default Variant</CardTitle></CardHeader>
            <CardContent>
              <Badge>{activeConfig.defaultVariantKey}</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Variants</CardTitle></CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {flag.variants.map((v) => (
                <Badge key={v.key} variant="secondary">{v.key}</Badge>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Targeting rules */}
      {activeConfig && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Targeting Rules</CardTitle>
            <Button size="sm" variant="outline">Add Rule</Button>
          </CardHeader>
          <CardContent>
            {activeConfig.rules.length === 0 ? (
              <p className="text-sm text-muted-foreground">No targeting rules. All users get the default variant.</p>
            ) : (
              <div className="space-y-3">
                {activeConfig.rules.map((rule, i) => (
                  <div key={rule.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-muted-foreground">Rule {i + 1}</span>
                      <Badge>{rule.variantKey}</Badge>
                    </div>
                    {rule.conditions.map((c, j) => (
                      <div key={j} className="text-sm font-mono">
                        <span className="text-primary">{c.attribute}</span>
                        {' '}
                        <span className="text-muted-foreground">{c.operator}</span>
                        {' '}
                        <span>{c.values.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Rollout */}
      {activeConfig && Object.keys(activeConfig.rollout).length > 0 && (
        <Card>
          <CardHeader><CardTitle>Percentage Rollout</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {Object.entries(activeConfig.rollout).map(([variantKey, pct]) => (
              <div key={variantKey} className="flex items-center gap-3">
                <span className="w-24 text-sm font-medium">{variantKey}</span>
                <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                  <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="w-10 text-right text-sm text-muted-foreground">{pct}%</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Analytics chart */}
      {chartPoints.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Evaluations (last 7 days)</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={chartPoints}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                {variantKeys.map((key, i) => (
                  <Line
                    key={key}
                    type="monotone"
                    dataKey={key}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
