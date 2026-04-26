import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, Zap, Building2, ExternalLink } from 'lucide-react'
import { useApi } from '@/hooks/use-api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface BillingInfo {
  plan: 'FREE' | 'PRO' | 'ENTERPRISE'
  stripeCustomerId: string | null
  usage: { projects: number; flags: number }
  limits: {
    FREE: { projects: number; flags: number }
    PRO: { projects: number; flags: number }
  }
}

const FREE_FEATURES = [
  'Up to 2 projects',
  'Up to 10 feature flags',
  '3 environments per project',
  'Boolean & multivariate flags',
  'Basic analytics (7 days)',
]

const PRO_FEATURES = [
  'Unlimited projects',
  'Unlimited feature flags',
  'Unlimited environments',
  'Advanced targeting rules',
  'Analytics (90 days)',
  'Real-time SSE streaming',
  'Audit log history',
  'Priority support',
]

function UsageBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  const pct = limit === -1 ? 0 : Math.min((used / limit) * 100, 100)
  const isUnlimited = limit === -1
  const isWarning = pct > 80

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className={isWarning ? 'text-amber-600 font-medium' : 'font-medium'}>
          {used} {isUnlimited ? '' : `/ ${limit}`}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${isWarning ? 'bg-amber-500' : 'bg-primary'}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  )
}

export function BillingPage() {
  const { request } = useApi()
  const [searchParams] = useSearchParams()
  const [billing, setBilling] = useState<BillingInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [upgrading, setUpgrading] = useState(false)
  const [managingPortal, setManagingPortal] = useState(false)

  const successParam = searchParams.get('success')
  const canceledParam = searchParams.get('canceled')

  useEffect(() => {
    request<BillingInfo>('/v1/billing')
      .then(setBilling)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [request])

  async function handleUpgrade() {
    setUpgrading(true)
    try {
      const { url } = await request<{ url: string }>('/v1/billing/checkout', { method: 'POST' })
      window.location.href = url
    } catch (e) {
      console.error(e)
    } finally {
      setUpgrading(false)
    }
  }

  async function handleManageBilling() {
    setManagingPortal(true)
    try {
      const { url } = await request<{ url: string }>('/v1/billing/portal', { method: 'POST' })
      window.location.href = url
    } catch (e) {
      console.error(e)
    } finally {
      setManagingPortal(false)
    }
  }

  const isPro = billing?.plan === 'PRO'

  return (
    <div className="p-8 space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your plan and usage</p>
      </div>

      {successParam && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 dark:bg-emerald-950/20 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
          <Check className="h-4 w-4 shrink-0" />
          You're now on the Pro plan. All limits have been removed.
        </div>
      )}

      {canceledParam && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
          Checkout was canceled. No changes were made.
        </div>
      )}

      {/* Current plan + usage */}
      {loading ? (
        <div className="h-40 animate-pulse rounded-lg bg-muted" />
      ) : billing && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Current Plan</CardTitle>
                <CardDescription>Your usage this billing period</CardDescription>
              </div>
              <Badge variant={isPro ? 'default' : 'secondary'} className="text-sm px-3 py-1">
                {billing.plan}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageBar
              label="Projects"
              used={billing.usage.projects}
              limit={isPro ? -1 : billing.limits.FREE.projects}
            />
            <UsageBar
              label="Feature flags"
              used={billing.usage.flags}
              limit={isPro ? -1 : billing.limits.FREE.flags}
            />

            {isPro && billing.stripeCustomerId && (
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={handleManageBilling} disabled={managingPortal}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {managingPortal ? 'Opening portal…' : 'Manage billing'}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pricing cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Free */}
        <Card className={!isPro ? 'ring-2 ring-primary' : ''}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <CardTitle>Free</CardTitle>
            </div>
            <div className="mt-2">
              <span className="text-3xl font-bold">$0</span>
              <span className="text-muted-foreground"> / month</span>
            </div>
            <CardDescription>For personal projects and exploration</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {FREE_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                {f}
              </div>
            ))}
            <div className="pt-2">
              <Button variant="outline" className="w-full" disabled>
                {!isPro ? 'Current plan' : 'Downgrade'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Pro */}
        <Card className={isPro ? 'ring-2 ring-primary' : 'border-primary/50'}>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <CardTitle>Pro</CardTitle>
              {!isPro && <Badge className="ml-auto">Recommended</Badge>}
            </div>
            <div className="mt-2">
              <span className="text-3xl font-bold">$29</span>
              <span className="text-muted-foreground"> / month</span>
            </div>
            <CardDescription>For teams shipping production features</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {PRO_FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm">
                <Check className="h-4 w-4 shrink-0 text-primary" />
                {f}
              </div>
            ))}
            <div className="pt-2">
              {isPro ? (
                <Button variant="outline" className="w-full" onClick={handleManageBilling} disabled={managingPortal}>
                  <ExternalLink className="h-3.5 w-3.5" />
                  {managingPortal ? 'Opening…' : 'Manage subscription'}
                </Button>
              ) : (
                <Button className="w-full" onClick={handleUpgrade} disabled={upgrading}>
                  <Zap className="h-4 w-4" />
                  {upgrading ? 'Redirecting…' : 'Upgrade to Pro'}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
