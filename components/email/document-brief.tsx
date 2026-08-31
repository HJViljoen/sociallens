/* eslint-disable @next/next/no-head-element, @next/next/no-page-custom-font -- an email document, not a page */
import { coverPlainText } from '../../lib/reports/cover'
import { findingHeadlines, inShortSummary, overviewTiles } from '../../lib/reports/documents/overview'
import type { DocumentSnapshotData } from '../../lib/reports/documents/types'
import { fmtInt, platformLabel } from '../../lib/format'
import { EMAIL, FONT } from '../../lib/email/theme'
import { Button, Columns, Hairline, Section, text } from './primitives'

/**
 * The written report in an inbox (T10, 2026-08-31): the three numbers, the
 * summary as it stands, the finding headlines, and the way in. It is a
 * pointer to the document, not a copy of it: the reader opens the full brief
 * or the PDF for the findings themselves.
 *
 * The numbers, the summary and the headlines are read through
 * lib/reports/documents/overview.ts — the same functions the printed deck
 * uses, over data the caller has already run applyEdits over, so what the
 * operator edited is what the inbox shows. No quote ever appears here: a
 * pull quote is a ref at rest, and this email is built without resolving
 * one.
 */

export interface DocumentBriefEmailProps {
  data: DocumentSnapshotData
  shareUrl: string | null
  appUrl: string
  /** Whether the PDF rides along, so the footer can say so. */
  attached: boolean
  preheader?: string
}

const presentation = { role: 'presentation', cellPadding: 0, cellSpacing: 0, border: 0 } as const

function NumberCell({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div style={{ ...text.figure, fontSize: 26 }}>{value}</div>
      <div style={{ ...text.small, fontSize: 11.5, marginTop: 5 }}>{label}</div>
    </div>
  )
}

export function DocumentBriefEmail({ data, shareUrl, appUrl, attached, preheader }: DocumentBriefEmailProps) {
  const tiles = overviewTiles(data)
  const summary = coverPlainText(inShortSummary(data), data.figures)
  const headlines = findingHeadlines(data)
  const m = data.method

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
                        <div style={text.eyebrow}>{data.company} · written from the latest update</div>
                        <div style={{ fontFamily: FONT.serif, fontSize: 22, fontWeight: 500, lineHeight: '1.25', color: EMAIL.ink, marginTop: 8 }}>{data.title}</div>
                        <div style={{ ...text.mono, color: EMAIL.muted, fontSize: 12, marginTop: 6 }}>{data.period}</div>
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0 28px 8px' }}>
                        {tiles.length ? (
                          <table width="100%" {...presentation} style={{ borderCollapse: 'collapse', marginTop: 18, background: EMAIL.inner, borderRadius: 6 }}>
                            <tbody>
                              <tr>
                                <td style={{ padding: '16px 18px' }}>
                                  <Columns cells={tiles.map((t, i) => <NumberCell key={i} value={t.value} label={t.label} />)} />
                                </td>
                              </tr>
                            </tbody>
                          </table>
                        ) : null}
                        {summary ? (
                          <Section title="In short">
                            {summary.split(/\n\n+/).filter(Boolean).map((p, i) => (
                              <p key={i} style={{ ...text.body, margin: i === 0 ? 0 : '10px 0 0' }}>{p}</p>
                            ))}
                          </Section>
                        ) : null}
                        {headlines.length ? (
                          <Section title="Findings in this brief">
                            <table width="100%" {...presentation} style={{ borderCollapse: 'collapse' }}>
                              <tbody>
                                {headlines.map((h, i) => (
                                  <tr key={i}>
                                    <td width={26} style={{ ...text.mono, color: EMAIL.link, fontWeight: 600, padding: '7px 8px 7px 0', verticalAlign: 'top', borderTop: i === 0 ? undefined : `1px solid ${EMAIL.hairline}` }}>{i + 1}</td>
                                    <td style={{ ...text.body, fontWeight: 600, padding: '7px 0', verticalAlign: 'top', borderTop: i === 0 ? undefined : `1px solid ${EMAIL.hairline}` }}>{h}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </Section>
                        ) : null}
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
                          {attached ? 'The PDF is attached. ' : ''}{shareUrl ? 'The full brief opens without an account. ' : ''}
                        </div>
                        <div style={{ ...text.small, fontSize: 11, marginTop: 10, color: EMAIL.faint }}>
                          {m.sources.map(platformLabel).join(', ')} · {fmtInt(m.conversations)} conversations on {fmtInt(m.videos)} videos · {m.period}
                          {m.thin ? ' · a thinner update than usual' : ''}
                        </div>
                        <div style={{ ...text.small, fontSize: 11, marginTop: 10, color: EMAIL.faint }}>
                          Written for {data.company} by Verbatim from public conversation. You are receiving this because you are on {data.company}&rsquo;s update list; an owner or admin changes it in the Studio.
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
