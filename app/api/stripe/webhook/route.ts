import type Stripe from 'stripe'
import { stripe } from '@/lib/stripe'
import { createAdminClient } from '@/lib/supabase-admin'

// Stripe webhook. Stripe calls this with its own signature (no Supabase session),
// so it's excluded from the auth proxy and writes via the service role. This is
// the ONLY source of truth for subscription entitlement — never trust the
// checkout return URL. Point a Stripe webhook endpoint at /api/stripe/webhook
// and set STRIPE_WEBHOOK_SECRET to its signing secret.

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

export async function POST(req: Request): Promise<Response> {
  if (!stripe || !webhookSecret) {
    return new Response('Stripe not configured', { status: 503 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  // Signature verification needs the exact raw body.
  const body = await req.text()
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    console.error('[stripe] webhook signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  const admin = createAdminClient()

  // Idempotency (T0-11). Stripe retries deliveries and can deliver out of
  // order; every delivery used to be applied. Claiming the event id first
  // makes a redelivery a no-op. A claim failure that is NOT a duplicate falls
  // through and processes, since dropping a real billing event is worse.
  const { error: claimErr } = await admin
    .from('stripe_events')
    .insert({ id: event.id, type: event.type })
  if (claimErr?.code === '23505') {
    return Response.json({ received: true, duplicate: true })
  }
  if (claimErr) console.error(`[stripe] could not record ${event.id}: ${claimErr.message}`)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const clientId = session.client_reference_id
        if (clientId) {
          // Read the subscription's real status rather than assuming 'active'
          // (T0-11): a checkout can complete into `incomplete` or `trialing`,
          // and writing 'active' over it granted access the subscription did
          // not. Falls back to the session's own payment status.
          const subscriptionId = asId(session.subscription)
          let status: string = session.payment_status === 'paid' ? 'active' : 'incomplete'
          if (subscriptionId && stripe) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId)
              status = sub.status
            } catch (e) {
              console.error(`[stripe] could not read subscription ${subscriptionId}:`, e)
            }
          }
          await admin
            .from('clients')
            .update({
              stripe_customer_id: asId(session.customer),
              stripe_subscription_id: subscriptionId,
              subscription_status: status,
              plan: status,
            })
            .eq('id', clientId)
        }
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = asId(sub.customer)
        if (customerId) {
          const canceled = event.type === 'customer.subscription.deleted'
          await admin
            .from('clients')
            .update({
              stripe_subscription_id: sub.id,
              subscription_status: canceled ? 'canceled' : sub.status,
              plan: canceled ? 'canceled' : 'active',
            })
            .eq('stripe_customer_id', customerId)
        }
        break
      }

      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break
    }
  } catch (err) {
    console.error(`[stripe] handler error for ${event.type}:`, err)
    return new Response('Handler error', { status: 500 }) // Stripe will retry
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

// Stripe fields are `string | { id } | null` depending on expansion.
function asId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null
  return typeof ref === 'string' ? ref : ref.id
}
