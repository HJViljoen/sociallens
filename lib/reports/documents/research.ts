import type { SupabaseClient } from '@supabase/supabase-js'
import { answerQuestion } from '../../agent/answer'
import { outcomeOf, type AgentOutcome } from '../../agent/types'
import { DOCUMENT_RESEARCH_PARALLEL } from '../../config'
import { quoteRef } from '../../renderables/quotes-freeze'
import type { ResearchQuestion } from './questions'

/**
 * The research job: the researcher's questions, asked of the Consumer
 * Intelligence Agent one wave at a time. Each answer keeps the agent's own
 * sentences (grounded points, with the insight ids and conversation counts
 * the engine computed), the judgement, and the quotes AS REFS with their
 * words kept only in memory for the picker; nothing here is stored. The
 * engine's calls go to ai_call_log (persist: true), no thread is written.
 *
 * Two errors are not answers: a workspace with no searchable index (the
 * agent's own distinct message) blocks the build, and a run that has not
 * completed does too. Anything else marks that one question failed and the
 * others go on: a brief with six answers beats no brief.
 */

export interface ResearchQuote {
  ref: string
  /** In memory only; frozen to '' the moment it is stored. */
  text: string
  commentId: string | null
  videoId: string | null
}

export interface ResearchPoint {
  /** G3: the index the writer cites. Numbered across all answers. */
  id: string
  text: string
  insightIds: string[]
  themeLabels: string[]
  conversationCount: number
  quotes: ResearchQuote[]
  questionId: string
}

export interface ResearchAnswer {
  question: ResearchQuestion
  answer: string
  outcome: AgentOutcome | 'failed' | 'unasked'
  grounded: ResearchPoint[]
  judgement: { text: string; basedOn: string[] }[]
  silent: boolean
  conversationCount: number
  costUsd: number
  ms: number
  error?: string
}

export class BuildBlockedError extends Error {}

export async function runResearch(
  admin: SupabaseClient,
  args: { clientId: string; companyName: string; runId: string; questions: ResearchQuestion[]; budgetUsd: number; parallel?: number },
): Promise<{ answers: ResearchAnswer[]; costUsd: number; stoppedForBudget: boolean }> {
  const parallel = Math.max(1, args.parallel ?? DOCUMENT_RESEARCH_PARALLEL)
  const answers: ResearchAnswer[] = []
  let cost = 0
  let g = 0
  let stoppedForBudget = false

  for (let w = 0; w < args.questions.length; w += parallel) {
    if (cost >= args.budgetUsd) {
      stoppedForBudget = true
      for (const q of args.questions.slice(w)) answers.push(unasked(q))
      break
    }
    const wave = args.questions.slice(w, w + parallel)
    const results = await Promise.all(wave.map(async (q): Promise<ResearchAnswer> => {
      const started = Date.now()
      try {
        const a = await answerQuestion(admin, { clientId: args.clientId, companyName: args.companyName, question: q.text, runId: args.runId, allowNearest: false, persist: true })
        return {
          question: q,
          answer: a.answer,
          outcome: outcomeOf(a),
          grounded: a.grounded.map((p) => ({
            id: '',
            text: p.text,
            insightIds: p.insightIds,
            themeLabels: p.themeRefs.map((t) => t.label),
            conversationCount: p.conversationCount,
            quotes: p.quotes
              .map((qq) => ({ ref: qq.commentId ? quoteRef.comment(qq.commentId) : qq.videoId ? quoteRef.video(qq.videoId) : '', text: qq.text, commentId: qq.commentId, videoId: qq.videoId }))
              .filter((qq) => qq.ref),
            questionId: q.id,
          })),
          judgement: a.judgement.map((j) => ({ text: j.text, basedOn: j.basedOn })),
          silent: a.silent,
          conversationCount: a.grounded.reduce((n, p) => n + p.conversationCount, 0),
          costUsd: a.costUsd,
          ms: Date.now() - started,
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (/no searchable index|No completed run/i.test(message)) throw new BuildBlockedError(message)
        console.error(`[document research] ${q.id} failed:`, message)
        return { ...unasked(q), outcome: 'failed', error: message, ms: Date.now() - started }
      }
    }))
    for (const r of results) {
      // Grounded ids are numbered in question order so the writer's G-refs
      // are stable across a re-run with the same answers.
      for (const p of r.grounded) p.id = `G${++g}`
      // Judgement cites the agent's own per-answer ids (g1, g2); remap onto ours.
      const local = new Map<string, string>()
      cost += r.costUsd
      answers.push({ ...r, judgement: r.judgement.map((j) => ({ ...j, basedOn: j.basedOn.map((b) => local.get(b) ?? b) })) })
    }
  }
  return { answers, costUsd: cost, stoppedForBudget }
}

const unasked = (q: ResearchQuestion): ResearchAnswer => ({
  question: q, answer: '', outcome: 'unasked', grounded: [], judgement: [], silent: false, conversationCount: 0, costUsd: 0, ms: 0,
})

/** Every grounded point across the answers, in G order. */
export const allPoints = (answers: ResearchAnswer[]): ResearchPoint[] => answers.flatMap((a) => a.grounded)
