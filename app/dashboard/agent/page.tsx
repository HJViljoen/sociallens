import { getSessionContext } from '@/lib/auth'
import { AgentComposer } from '@/components/agent-composer'
import { AgentCrowdRing } from '@/components/agent-stage'
import { AgentHistory, type ThreadRow } from '@/components/agent-history'
import { isPlatformAdmin } from '@/lib/agent/access'

// The Verbatim Agent — arrive with a question from your own work, get an answer
// built from what your customers actually said.
//
// This page does not scroll. The composer and the figure hold the centre of the
// frame and the crowd stands around them; that composition IS the page, and a
// scrollbar would let it drift off the top. Earlier questions therefore live in
// a sheet parked off the bottom edge rather than in a column underneath.
//
// No subheading either. The profile page lost its tagline in the July pass for
// the same reason: a description is read once and then it is furniture.

export default async function AgentPage() {
  const { supabase, clientId, userId } = await getSessionContext()
  // Computed server-side and passed down — never a client-side check.
  const canSend = await isPlatformAdmin(userId)

  const { data: rows } = await supabase
    .from('agent_threads')
    .select('id, title, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50)
  const threads = (rows ?? []) as ThreadRow[]

  return (
    // .agent-fixed is the hook a CSS rule uses to stop <main> scrolling and
    // make it a column (see globals.css). flex-1 + min-h-0 then takes exactly
    // the height left over — which is the whole pane normally, and the pane
    // minus the billing banner when a tenant has one, instead of assuming.
    //
    // NOT overflow-hidden here: that would clip the history sheet, which
    // reaches past the dashboard's padding to sit flush with the bottom edge.
    // The clipping happens at <main> instead, one level up.
    <div className="agent-fixed relative flex-1 min-h-0">
      <AgentCrowdRing />
      <div className="agent-centre-in relative z-10 grid h-full place-items-center">
        <div className="w-full pb-24">  {/* clears the taller peek below */}
          <AgentComposer canSend={canSend} showFigure />
        </div>
      </div>
      <AgentHistory threads={threads} />
    </div>
  )
}
