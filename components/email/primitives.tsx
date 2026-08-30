/* eslint-disable @next/next/no-img-element -- an email carries plain <img>, never next/image */
import type { CSSProperties, ReactNode } from 'react'
import { EMAIL, FONT } from '../../lib/email/theme'

/**
 * Email primitives (Stage 3): tables and inline styles only — no classes, no
 * CSS variables, no flex or grid, nothing an email client would drop. Every
 * piece takes the same shape on the dashboard, on paper and here; only the
 * markup differs, because Outlook still lays out with Word.
 */

const T: CSSProperties = { borderCollapse: 'collapse', borderSpacing: 0 }
const presentation = { role: 'presentation', cellPadding: 0, cellSpacing: 0, border: 0 } as const

export const text = {
  eyebrow: { fontFamily: FONT.mono, fontSize: 11, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', color: EMAIL.faint } as CSSProperties,
  label: { fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, color: EMAIL.muted, textTransform: 'uppercase', letterSpacing: '.6px' } as CSSProperties,
  body: { fontFamily: FONT.sans, fontSize: 14, lineHeight: '1.5', color: EMAIL.ink } as CSSProperties,
  small: { fontFamily: FONT.sans, fontSize: 12, lineHeight: '1.45', color: EMAIL.muted } as CSSProperties,
  mono: { fontFamily: FONT.mono, fontSize: 12, color: EMAIL.ink2 } as CSSProperties,
  figure: { fontFamily: FONT.mono, fontSize: 22, fontWeight: 600, lineHeight: '1', color: EMAIL.ink, letterSpacing: '-.02em' } as CSSProperties,
}

/** A titled block: eyebrow-style heading, then its rows. */
export function Section({ title, meta, children }: { title: string; meta?: string | null; children: ReactNode }) {
  return (
    <table width="100%" {...presentation} style={{ ...T, marginTop: 22 }}>
      <tbody>
        <tr>
          <td style={{ padding: '0 0 6px' }}>
            <table width="100%" {...presentation} style={T}>
              <tbody>
                <tr>
                  <td style={text.label}>{title}</td>
                  {meta ? <td align="right" style={{ ...text.mono, color: EMAIL.faint, fontSize: 11 }}>{meta}</td> : null}
                </tr>
              </tbody>
            </table>
          </td>
        </tr>
        <tr>
          <td>{children}</td>
        </tr>
      </tbody>
    </table>
  )
}

/** One row with a hairline beneath: a label over a sentence, a chip on the right. */
export function Row({ label, chip, href, linkText, children }: { label?: string; chip?: ReactNode; href?: string | null; linkText?: string; children: ReactNode }) {
  return (
    <table width="100%" {...presentation} style={{ ...T, borderBottom: `1px solid ${EMAIL.hairline}` }}>
      <tbody>
        <tr>
          <td style={{ padding: '11px 0', verticalAlign: 'top' }}>
            {label ? <div style={text.eyebrow}>{label}</div> : null}
            <div style={{ ...text.body, marginTop: label ? 3 : 0 }}>{children}</div>
            {href ? (
              <div style={{ marginTop: 4 }}>
                <a href={href} style={{ color: EMAIL.link, fontFamily: FONT.sans, fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>{linkText ?? 'See the detail'} →</a>
              </div>
            ) : null}
          </td>
          {chip ? <td align="right" style={{ padding: '11px 0 11px 12px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>{chip}</td> : null}
        </tr>
      </tbody>
    </table>
  )
}

/** A pill. `tone` up/down is a movement that cleared its band; neutral is a state. */
export function Chip({ tone, children }: { tone: 'up' | 'down' | 'neutral'; children: ReactNode }) {
  const style: CSSProperties = tone === 'neutral'
    ? { background: EMAIL.inner, color: EMAIL.muted, fontWeight: 600 }
    : tone === 'up' ? { background: EMAIL.greenTint, color: EMAIL.up, fontWeight: 700 } : { background: EMAIL.downTint, color: EMAIL.down, fontWeight: 700 }
  return <span style={{ display: 'inline-block', fontFamily: FONT.sans, fontSize: 11, padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap', ...style }}>{children}</span>
}

/** A stacked proportion bar drawn with table cells — the one chart every client renders. */
export function Bar({ segments, height = 8 }: { segments: { pct: number; color: string; label?: string }[]; height?: number }) {
  const shown = segments.filter((s) => s.pct > 0)
  if (!shown.length) return null
  return (
    <table width="100%" {...presentation} style={{ ...T, tableLayout: 'fixed' }}>
      <tbody>
        <tr>
          {shown.map((s, i) => (
            <td key={i} width={`${Math.max(1, Math.round(s.pct))}%`} height={height} title={s.label} style={{ background: s.color, height, lineHeight: `${height}px`, fontSize: 1, borderRight: i < shown.length - 1 ? `2px solid ${EMAIL.card}` : undefined }}>&nbsp;</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

/** A ranked row: label · a single bar · the count. */
export function RankedRow({ label, pct, color, count, badge, dot }: { label: ReactNode; pct: number; color: string; count: string; badge?: ReactNode; dot?: boolean }) {
  const w = Math.max(1, Math.min(100, Math.round(pct)))
  return (
    <table width="100%" {...presentation} style={T}>
      <tbody>
        <tr>
          <td style={{ ...text.body, fontSize: 12.5, padding: '3px 8px 3px 0', width: '46%', verticalAlign: 'middle' }}>
            {dot ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: color, marginRight: 6, verticalAlign: 'middle' }} /> : null}
            <span style={{ verticalAlign: 'middle' }}>{label}</span>
            {badge ? <span style={{ marginLeft: 6, verticalAlign: 'middle' }}>{badge}</span> : null}
          </td>
          <td style={{ verticalAlign: 'middle', padding: '3px 0' }}>
            <table width="100%" {...presentation} style={T}>
              <tbody>
                <tr>
                  <td width={`${w}%`} height={6} style={{ background: color, height: 6, fontSize: 1, lineHeight: '6px', borderRadius: 2 }}>&nbsp;</td>
                  {w < 100 ? <td style={{ fontSize: 1, lineHeight: '6px' }}>&nbsp;</td> : null}
                </tr>
              </tbody>
            </table>
          </td>
          <td align="right" style={{ ...text.mono, fontWeight: 600, padding: '3px 0 3px 10px', width: 44, verticalAlign: 'middle', whiteSpace: 'nowrap' }}>{count}</td>
        </tr>
      </tbody>
    </table>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return <span style={{ display: 'inline-block', fontFamily: FONT.sans, fontSize: 10, fontWeight: 500, padding: '1px 6px', borderRadius: 10, background: EMAIL.greenTint, color: EMAIL.link }}>{children}</span>
}

/** A big figure with its unit and a line under it. */
export function Stat({ value, unit, note }: { value: ReactNode; unit?: string; note?: ReactNode }) {
  return (
    <div>
      <span style={text.figure}>{value}</span>
      {unit ? <>{' '}<span style={{ ...text.small, marginLeft: 4 }}>{unit}</span></> : null}
      {note ? <div style={{ ...text.small, marginTop: 4 }}>{note}</div> : null}
    </div>
  )
}

/** Signed change beside a figure, coloured only when the direction is good or bad. */
export function DeltaText({ value, unit = '', decimals = 0, good = 'neutral' }: { value: number | null | undefined; unit?: string; decimals?: 0 | 1; good?: 'up' | 'down' | 'neutral' }) {
  if (value == null || Number.isNaN(value)) return null
  const v = decimals ? Math.round(value * 10) / 10 : Math.round(value)
  if (v === 0) return <span style={{ ...text.mono, fontSize: 11, color: EMAIL.faint }}>no change</span>
  const favourable = good === 'neutral' ? null : good === 'up' ? v > 0 : v < 0
  const color = favourable === null ? EMAIL.muted : favourable ? EMAIL.up : EMAIL.down
  return <span style={{ ...text.mono, fontSize: 11, fontWeight: 600, color }}>{v > 0 ? '+' : '−'}{Math.abs(v).toLocaleString('en-US')}{unit}</span>
}

export function Quote({ text: t, cite }: { text: string; cite?: ReactNode }) {
  return (
    <table width="100%" {...presentation} style={{ ...T, marginTop: 6 }}>
      <tbody>
        <tr>
          <td width={2} style={{ background: EMAIL.border, fontSize: 1 }}>&nbsp;</td>
          <td style={{ padding: '2px 0 2px 10px' }}>
            <div style={{ fontFamily: FONT.serif, fontSize: 14, fontStyle: 'italic', lineHeight: '1.45', color: EMAIL.ink }}>“{t}”</div>
            {cite ? <div style={{ ...text.small, fontSize: 11, marginTop: 3 }}>{cite}</div> : null}
          </td>
        </tr>
      </tbody>
    </table>
  )
}

export function Button({ href, children, primary }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a href={href} style={{ display: 'inline-block', fontFamily: FONT.sans, fontSize: 13, fontWeight: 600, textDecoration: 'none', padding: '9px 16px', borderRadius: 6, background: primary ? EMAIL.green : EMAIL.card, color: primary ? EMAIL.card : EMAIL.ink, border: primary ? `1px solid ${EMAIL.green}` : `1px solid ${EMAIL.border}` }}>{children}</a>
  )
}

/** An inline image the runner rendered (`cid:`), or nothing — the caller says it in words beside it. */
export function Img({ src, alt, width }: { src: string | null; alt: string; width: number }) {
  if (!src) return null
  return <img src={src} alt={alt} width={width} style={{ display: 'block', width, maxWidth: '100%', height: 'auto', border: 0, borderRadius: 4 }} />
}

/** Two or three cells across, equal width. */
export function Columns({ cells }: { cells: ReactNode[] }) {
  const w = `${Math.floor(100 / Math.max(1, cells.length))}%`
  return (
    <table width="100%" {...presentation} style={{ ...T, tableLayout: 'fixed' }}>
      <tbody>
        <tr>
          {cells.map((c, i) => (
            <td key={i} width={w} style={{ verticalAlign: 'top', padding: i === 0 ? '0 8px 0 0' : i === cells.length - 1 ? '0 0 0 8px' : '0 8px' }}>{c}</td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}

export function Hairline() {
  return <div style={{ borderTop: `1px solid ${EMAIL.hairline}`, height: 0, fontSize: 1, lineHeight: 0, margin: '10px 0' }}>&nbsp;</div>
}
