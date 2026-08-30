'use client'

import { useState } from 'react'
import { deleteReport } from '@/app/dashboard/studio/actions'

/** Two clicks, no browser dialog: the first arms, the second deletes. */
export function DeleteReport({ id }: { id: string }) {
  const [armed, setArmed] = useState(false)
  return (
    <form action={deleteReport} className="inline-flex items-center gap-2">
      <input type="hidden" name="id" value={id} />
      {armed ? (
        <>
          <button type="submit" className="text-[12px] font-medium text-negative underline underline-offset-2">Delete this report</button>
          <button type="button" onClick={() => setArmed(false)} className="text-[12px] text-muted-foreground hover:text-foreground">Keep it</button>
        </>
      ) : (
        <button type="button" onClick={() => setArmed(true)} className="text-[12px] text-muted-foreground hover:text-negative">Delete…</button>
      )}
    </form>
  )
}
