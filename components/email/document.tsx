/* eslint-disable @next/next/no-head-element, @next/next/no-page-custom-font -- an email document, not a page */
import type { ReactNode } from 'react'
import { pageModule } from '../pages/registry'
import type { EmailContext } from '../../lib/renderables/types'
import type { DashboardData } from '../../lib/pages/dashboard'
import { coverPlainText } from '../../lib/reports/cover'
import { methodOf, type ReportSnapshotData } from '../../lib/reports/types'
import { fmtInt, platformLabel } from '../../lib/format'
import { EMAIL, FONT } from '../../lib/email/theme'
import { DeltaBlock } from './delta-block'
import { Button, Hairline, Section, text } from './primitives'

/**
 * The digest email (Stage 3): one report snapshot said in an inbox. The
 * delta block leads, then the cover paragraph, then every tile of every
 * section that has an email renderer, in the template's order; the share
 * link and the attached PDF close it. Table layout, inline styles, literal
 * hex — the same constraints as the interim weekly email it replaces, over
 * the same data as the paper.
 */

export interface DigestEmailProps {
  data: ReportSnapshotData
  shareUrl: string | null
  appUrl: string
  /** Whether the PDF rides along, so the footer can say so. */
  attached: boolean
  ctx: EmailContext
  /** The inbox preview line — the subject by default. */
  preheader?: string
}

const presentation = { role: 'presentation', cellPadding: 0, cellSpacing: 0, border: 0 } as const

export function DigestEmail({ data, shareUrl, appUrl, attached, ctx, preheader }: DigestEmailProps) {
  const dashboard = (data.sections.find((s) => s.section.page === 'dashboard')?.data as DashboardData | undefined) ?? null
  const cover = coverPlainText(data.cover.body, data.figures)
  const method = data.sections.length ? methodOf(data.sections[0].data) : null

  const tiles: ReactNode[] = []
  for (const sec of data.sections) {
    const mod = pageModule(sec.section.page)
    if (!mod) continue
    const keys = sec.section.keys ?? Object.keys(mod.renderables)
    let first = true
    for (const k of keys) {
      const r = mod.renderables[k]
      if (!r?.email) continue
      tiles.push(
        <Section key={`${sec.section.id}:${k}`} title={r.title}>
          {first && sec.section.framing ? <div style={{ ...text.small, fontStyle: 'italic', marginBottom: 8 }}>{sec.section.framing}</div> : null}
          {r.email(sec.data, ctx)}
        </Section>,
      )
      first = false
    }
  }

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <title>{data.title}</title>
        <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Serif:ital,wght@0,500;1,400&family=IBM+Plex+Mono:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body style={{ margin: 0, padding: 0, background: EMAIL.canvas, fontFamily: FONT.sans, color: EMAIL.ink, WebkitTextSizeAdjust: '100%' }}>
        {preheader ? <div style={{ display: 'none', maxHeight: 0, overflow: 'hidden', opacity: 0, color: 'transparent' }}>{preheader}</div> : null}
        <table width="100%" {...presentation} style={{ borderCollapse: 'collapse', background: EMAIL.canvas }}>
          <tbody>
            <tr>
              <td align="center" style={{ padding: '24px 12px' }}>
                <table width="100%" {...presentation} style={{ borderCollapse: 'separate', maxWidth: 600, background: EMAIL.card, borderRadius: 6, border: `1px solid ${EMAIL.border}` }}>
                  <tbody>
                    <tr>
                      <td style={{ padding: '24px 28px 4px' }}>
                        <div style={text.eyebrow}>{data.company} · consumer intelligence</div>
                        <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 500, lineHeight: '1.25', color: EMAIL.ink, marginTop: 8 }}>{data.title}</div>
                        <div style={{ ...text.mono, color: EMAIL.muted, fontSize: 12, marginTop: 6 }}>{data.period}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0 28px 8px' }}>
                        <DeltaBlock delta={data.delta} dashboard={dashboard} appUrl={appUrl} />
                        {cover ? (
                          <Section title="In short">
                            <p style={{ ...text.body, margin: 0 }}>{cover}</p>
                          </Section>
                        ) : null}
                        {tiles}
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '18px 28px 24px' }}>
                        <Hairline />
                        <div style={{ marginTop: 8 }}>
                          {shareUrl ? <span style={{ marginRight: 8 }}><Button href={shareUrl} primary>Open the full report</Button></span> : null}
                          <Button href={`${appUrl}/dashboard`}>Open Verbatim</Button>
                        </div>
                        <div style={{ ...text.small, marginTop: 12 }}>
                          {attached ? 'The PDF is attached. ' : ''}{shareUrl ? 'The full report opens without an account; the evidence behind each figure opens on the page. ' : ''}
                        </div>
                        {method ? (
                          <div style={{ ...text.small, fontSize: 11, marginTop: 10, color: EMAIL.faint }}>
                            {method.platforms.map(platformLabel).join(', ')}{method.videos != null ? ` · ${fmtInt(method.videos)} conversations` : ''}{method.comments != null ? ` · ${fmtInt(method.comments)} comments read` : ''}{method.note ? ` · ${method.note}` : ''}
                          </div>
                        ) : null}
                        <div style={{ ...text.small, fontSize: 11, marginTop: 10, color: EMAIL.faint }}>
                          Prepared by {data.company} · with Verbatim. You are receiving this because you are on {data.company}’s update list; an owner or admin changes it in Verbatim under Studio › Schedules.
                        </div>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  )
}
