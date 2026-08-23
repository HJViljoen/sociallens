import { inngest } from '@/inngest/client'

// Keep-warm (2026-08-23). Every 5 minutes, GET the public /health page so the
// Vercel function that serves the dashboard never sits cold — a cold instance
// added ~0.75s to the first navigation after a quiet spell. /health also does
// one cheap DB read. Cost: ~8.6k runs/month on Inngest, ~8.6k tiny function
// invocations on Vercel. Never throws on a bad ping (a warm-up must not page
// anyone); the measured latency is returned so Inngest's run log shows it.

const DEFAULT_APP_URL = 'https://app.verbatimintel.com'

export const keepWarm = inngest.createFunction(
  { id: 'keep-warm', retries: 0, triggers: [{ cron: '*/5 * * * *' }] },
  async ({ step }) => {
    return step.run('ping-health', async () => {
      const base = (process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, '')
      const t0 = Date.now()
      try {
        const res = await fetch(`${base}/health`, { cache: 'no-store', headers: { 'user-agent': 'verbatim-keep-warm' } })
        const body = (await res.text()).slice(0, 80)
        return { status: res.status, ms: Date.now() - t0, body }
      } catch (e) {
        return { status: 0, ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }
      }
    })
  },
)
