import { describe, expect, it } from 'vitest'
import {
  buildClassifySystemPrompt,
  buildClassifyUserPrompt,
  planClassifyBatches,
  validateClassifyResponse,
  type ClassifyInput,
} from './classify-meta'
import type { ClassifyMetaOutput } from './schemas'

const input = (id: string, over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  id,
  platform: 'tiktok',
  account_name: 'acc',
  caption: 'A day with my new running blade',
  hashtags: ['#runningblade'],
  transcript: null,
  transcript_status: null,
  ...over,
})

describe('planClassifyBatches', () => {
  it('takes only unclassified videos, chunked in order', () => {
    const videos = [
      { id: 'a', classified_type: 'story' },
      { id: 'b', classified_type: null },
      { id: 'c', classified_type: null },
      { id: 'd', classified_type: null },
    ]
    expect(planClassifyBatches(videos, 2)).toEqual([['b', 'c'], ['d']])
    expect(planClassifyBatches([{ id: 'a', classified_type: 'story' }])).toEqual([])
  })
})

describe('buildClassifyUserPrompt', () => {
  it('numbers blocks and includes transcript only when usable', () => {
    const prompt = buildClassifyUserPrompt([
      input('a'),
      input('b', { transcript: 'hello from the transcript', transcript_status: 'ok' }),
      input('c', { transcript: 'la la la', transcript_status: 'lyrics', caption: null, hashtags: null }),
    ])
    expect(prompt).toContain('[v1] platform: tiktok')
    expect(prompt).toContain('[v2]')
    expect(prompt).toContain('transcript: hello from the transcript')
    expect(prompt).not.toContain('la la la') // lyrics-status transcript excluded
    expect(prompt).toContain('caption: (none)')
  })

  it('system prompt carries the enum vocabularies', () => {
    const sys = buildClassifySystemPrompt()
    expect(sys).toContain('tutorial')
    expect(sys).toContain('personal-story')
    expect(sys).toContain('null')
  })
})

describe('validateClassifyResponse', () => {
  const ids = ['id-a', 'id-b']
  const item = (ref: string): ClassifyMetaOutput['videos'][number] => ({
    ref,
    classified_type: 'story',
    hook_style: null,
    hook_text: '  My journey ',
    topics: [' Amputee ', 'Running', '', 'x', 'y', 'z'],
    sentiment: 'positive',
  })

  it('maps refs to batch ids, trims hook_text, normalizes and caps topics', () => {
    const out = validateClassifyResponse({ videos: [item('v1')] }, ids)
    const got = out.get('id-a')
    expect(got?.hook_text).toBe('My journey')
    expect(got?.topics).toEqual(['amputee', 'running', 'x', 'y'])
  })

  it('drops unknown, out-of-range and duplicate refs — never guesses', () => {
    const out = validateClassifyResponse(
      { videos: [item('v0'), item('v3'), item('nope'), item('v2'), item('v2')] },
      ids,
    )
    expect([...out.keys()]).toEqual(['id-b'])
  })
})
