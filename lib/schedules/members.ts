import type { SupabaseClient } from '@supabase/supabase-js'
import { SCHEDULE_RECIPIENTS_MAX } from '../config'
import { normaliseRecipients } from './validate'

/** Every member of the workspace, for the review email — owners, admins and
 *  members alike (any of them may read, edit and send). Oldest first, capped
 *  like a schedule's own list. */
export async function memberEmails(admin: SupabaseClient, clientId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('users')
    .select('email')
    .eq('client_id', clientId)
    .order('created_at')
  if (error) throw new Error(`members: read failed: ${error.message}`)
  const emails = ((data ?? []) as { email: string | null }[]).map((r) => r.email ?? '').filter(Boolean)
  return normaliseRecipients(emails).slice(0, SCHEDULE_RECIPIENTS_MAX)
}
