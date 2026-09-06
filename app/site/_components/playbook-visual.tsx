import type { ReactNode } from 'react'
import { QuoteCard, BriefRow, ThemeMapGrid, FaceOffLegendRows, FaceOffOwnsBlock, PersonaCard } from './mocks'
import { analyst, brief, personas, reportCovers, type DocumentCheck, type Question } from '../_data/sample'
import { replyInboxRows, formatRows, contentPlan, objectionSheet, type PanelKind, type StepVisual, type Playbook } from '../_data/playbooks'

// Renders every PanelKind ("what you're looking at") and StepVisual ("what
// you'll see" under a step) variant named in _data/playbooks.ts. Reuses the
// home page's extracted mocks (mocks.tsx) for the visuals that are pixel-
// consistent product surfaces (theme map, face-off, persona card, quote card,
// brief lines); everything else is built from the same static `.demo` scaffold
// classes the How it works page uses (`.demo .row`, `.demo .kv`, `.demo .chip`,
// `.demo .doc`) — no innerHTML anywhere.
//
// The mocks' CSS reveals bars/tiles only under an `.is-on` ancestor (added on
// scroll by the client-only <Reveal>, home page only). Playbook pages don't
// animate on scroll (DESIGN.md, plan §4: "reading pages don't move"), so every
// mock here is rendered with `staticReveal`, which inlines the revealed state
// directly — always visible, no JS required.

function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`)
}

function InboxRow({ row }: { row: (typeof replyInboxRows)[number] }) {
  const chipClass = row.intent === 'buying' ? ' g' : row.intent === 'objection' ? ' a' : ''
  const label = row.intent === 'buying' ? 'Buying signal' : row.intent === 'objection' ? 'Objection' : 'Question'
  return (
    <div className="row">
      <div>
        <span className="voice">“{row.text}”</span>
        <div className="k">{row.src}</div>
      </div>
      <span className={`chip${chipClass}`}>{label}</span>
    </div>
  )
}

function ReportCoverMock({ index }: { index: number }) {
  const c = reportCovers[index]
  return (
    <div className="cover" style={{ cursor: 'default' }}>
      <div>
        <div className="ct">{c.title}</div>
        <div className="for">{c.audience}</div>
      </div>
      <div className="tiles">
        {c.tiles.map((t, j) => (
          <i key={j} className={t || undefined} />
        ))}
      </div>
      <div className="foot">
        <span>
          {c.sections} {c.sections === 1 ? 'section' : 'sections'}
        </span>
        <span>{c.pages} pages</span>
      </div>
    </div>
  )
}

function LinkMock() {
  return (
    <div className="link-mock" aria-hidden="true">
      <div className="url">verbatimintel.com/r/7k2m…q9d</div>
      <div className="opts">
        <span>Expires: 7 days</span>
        <span className="on">30 days</span>
        <span>90 days</span>
        <span>Never</span>
      </div>
      <div className="opts">
        <span className="on">Password</span>
        <span>Revoke</span>
        <span>Opened 3 times</span>
      </div>
    </div>
  )
}

/** The "what you're looking at" panel. */
export function PlaybookPanel({ panel }: { panel: PanelKind }) {
  switch (panel.kind) {
    case 'themeMap':
      return (
        <div className="panel">
          <div className="panel-title">
            <b>What your market talks about</b>
            <span>Sized by conversations this week</span>
          </div>
          <ThemeMapGrid staticReveal />
        </div>
      )
    case 'faceOff':
      return (
        <div className="panel">
          <div className="panel-title">
            <b>The face-off</b>
            <span>This week, against your closest competitor</span>
          </div>
          <div className="face">
            <FaceOffLegendRows staticReveal />
            <FaceOffOwnsBlock />
          </div>
        </div>
      )
    case 'profile': {
      const p = personas[panel.persona]
      return (
        <div className="panel">
          <div className="panel-title">
            <b>{p.name}</b>
            <span>{p.share}% of the conversation</span>
          </div>
          <PersonaCard persona={p} staticReveal />
        </div>
      )
    }
    case 'replyInbox':
      return (
        <div className="demo">
          {replyInboxRows.map((r, i) => (
            <InboxRow key={i} row={r} />
          ))}
        </div>
      )
    case 'document': {
      const doc = analyst[2] as DocumentCheck
      return (
        <div className="demo">
          <div className="doc">
            {doc.paragraphs.map((para, pi) => (
              <p key={pi}>
                {para.map((seg, si) => (!seg.mark ? <span key={si}>{seg.text}</span> : <mark key={si} className={seg.mark}>{seg.text}</mark>))}
              </p>
            ))}
          </div>
        </div>
      )
    }
    default:
      return assertNever(panel)
  }
}

function renderStepVisual(show: StepVisual): ReactNode {
  switch (show.kind) {
    case 'brief':
      return (
        <div className="brief">
          {show.lines.map((idx) => (
            <BriefRow key={idx} line={brief[idx]} />
          ))}
        </div>
      )
    case 'quote':
      return <QuoteCard q={show.quote} />
    case 'sayHear':
      return (
        <>
          {show.rows.map((r, i) => (
            <div key={i}>
              <div className="kv">
                <span className="k">You say</span>
                <span>“{r.claim}.”</span>
              </div>
              <div className="kv">
                <span className="k">They hear</span>
                <span>
                  <span className={`chip ${r.verdict === 'echoed' ? 'g' : 'a'}`}>{r.verdict === 'echoed' ? 'Echoed' : 'Pushed back'}</span> {r.detail}
                </span>
              </div>
            </div>
          ))}
        </>
      )
    case 'inboxRows':
      return (
        <>
          {show.rows.map((i) => (
            <InboxRow key={i} row={replyInboxRows[i]} />
          ))}
        </>
      )
    case 'formatRows':
      return (
        <>
          {formatRows.map((f) => (
            <div className="row" key={f.format}>
              <span>{f.format}</span>
              <span className="chip">{f.conversations} conversations</span>
            </div>
          ))}
        </>
      )
    case 'contentPlan':
      return (
        <>
          {contentPlan.map((c, i) => (
            <div className="kv" key={c.post}>
              <span className="k">{i + 1}</span>
              <span>
                <b>{c.post}.</b> {c.note}
              </span>
            </div>
          ))}
        </>
      )
    case 'objectionSheet':
      return (
        <>
          {objectionSheet.map((o) => (
            <div className="kv" key={o.objection}>
              <span className="k">{o.objection}</span>
              <span>{o.answer}</span>
            </div>
          ))}
        </>
      )
    case 'standings':
      return (
        <>
          <div className="row">
            <span>Northline</span>
            <span className="chip g">You</span>
          </div>
          <div className="row">
            <span>Ridgeway</span>
            <span className="chip a">Winning the long-trip buyer</span>
          </div>
          <div className="row">
            <span>Trailform, Cairnline</span>
            <span className="chip">Rest of the category</span>
          </div>
        </>
      )
    case 'faceOffRows':
      return (
        <div className="face">
          <FaceOffLegendRows staticReveal />
        </div>
      )
    case 'faceOffOwns':
      return (
        <div className="face">
          <FaceOffOwnsBlock />
        </div>
      )
    case 'analystAnswer': {
      const q = analyst[show.item] as Question
      const e = q.evidence[show.evidence]
      return (
        <>
          <p className="body">{q.answer}</p>
          <div className="row">
            <div>
              <span className="voice">{e.quote}</span>
              <div className="k">{e.src}</div>
            </div>
          </div>
        </>
      )
    }
    case 'claimRow': {
      const c = (analyst[2] as DocumentCheck).claims[show.claim]
      const chipClass = c.k === 'ok' ? ' g' : c.k === 'no' ? ' r' : ''
      return (
        <div className="row">
          <span>{c.t}</span>
          <span className={`chip${chipClass}`}>{c.b}</span>
        </div>
      )
    }
    case 'fileChip': {
      const doc = analyst[2] as DocumentCheck
      return (
        <div className="row">
          <span className="voice">{doc.file}</span>
          <span className="chip">{doc.meta}</span>
        </div>
      )
    }
    case 'profile': {
      const p = personas[show.persona]
      return (
        <div className="panel">
          <PersonaCard persona={p} staticReveal />
        </div>
      )
    }
    case 'phrasesAndQuote': {
      const p = personas[show.persona]
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {p.talk.map((t) => (
              <span key={t} className="chip voice">
                “{t}”
              </span>
            ))}
          </div>
          <QuoteCard q={show.quote} />
        </>
      )
    }
    case 'reportCover':
      return <ReportCoverMock index={show.cover} />
    case 'reportCoverLink':
      return (
        <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
          <ReportCoverMock index={show.cover} />
          <LinkMock />
        </div>
      )
    default:
      return assertNever(show)
  }
}

/** The "what you'll see" visual beneath one step. Always wrapped in `.demo`
 * (`.pb-step .demo` in site.css gives it its spacing under the step body). */
export function PlaybookStepVisual({ show }: { show: StepVisual }) {
  return <div className="demo">{renderStepVisual(show)}</div>
}

/** The "what you send on" artefact: the named report cover (+ link mock for a
 * shared link), or a plain chip when the send-on has no matching report
 * template (the analyst's checked-brief answer in check-a-brief-before-it-goes-out). */
export function SendOnVisual({ sendOn }: { sendOn: Playbook['sendOn'] }) {
  if (sendOn.kind === 'report' || sendOn.kind === 'link') {
    const idx = reportCovers.findIndex((c) => c.title === sendOn.template)
    if (idx >= 0) {
      return (
        <div style={{ display: 'grid', gap: 16, maxWidth: 320 }}>
          <ReportCoverMock index={idx} />
          {sendOn.kind === 'link' && <LinkMock />}
        </div>
      )
    }
  }
  return (
    <div className="demo">
      <div className="row">
        <span className="voice">{sendOn.title}</span>
        <span className="chip g">Exported</span>
      </div>
    </div>
  )
}
