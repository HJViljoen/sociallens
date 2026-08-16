import type { Platform, PlatformAdapter } from '../types'
import { tiktok } from './tiktok'
import { youtube } from './youtube'
import { instagram } from './instagram'
import { reddit } from './reddit'

/** Platform → adapter registry. The only place gather knows about specific platforms. */
export const adapters: Record<Platform, PlatformAdapter> = { tiktok, youtube, instagram, reddit }
