import { notFound } from 'next/navigation'
import { renderTokenSecret, verifyRenderToken } from '@/lib/render-token'
import { PrintRoot, printStyleFrom } from '@/components/print/print-root'

// Print-mode HTML for one snapshot, fetched by the export route's headless
// Chrome. proxy.ts lets /render through without a session; the token is the
// gate (lib/render-token.ts) and it names exactly one snapshot.
//
// Stage 1 T2: the frame and the gate. The body — snapshot → resolveQuotes →
// PrintDeck / PrintTile / AgentThreadPrint — lands in T9.

export default async function RenderPage({
  params, searchParams,
}: {
  params: Promise<{ snapshotId: string }>
  searchParams: Promise<{ t?: string; tile?: string; style?: string }>
}) {
  const [{ snapshotId }, sp] = await Promise.all([params, searchParams])
  const token = verifyRenderToken(sp.t, renderTokenSecret())
  if (!token || token.snapshotId !== snapshotId) notFound()

  return (
    <PrintRoot style={printStyleFrom(sp.style)}>
      <div className="p-6 font-mono text-[11px] text-muted-foreground">render: snapshot {snapshotId}{token.tileKey ? ` · tile ${token.tileKey}` : ''}</div>
    </PrintRoot>
  )
}
