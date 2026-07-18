// liveBible.js — the app's ONE connection to the live Bible.
//
// Steve's rule: every time the app is opened it reads the Bible; it never stores
// its own copy. This module fetches the live Bible over the network via the shared
// bible-client (ETag-revalidated, in-memory only, fail-closed) and hydrates the
// constants singleton (src/math/constants.js) so every math module reads live
// numbers. If the Bible cannot be reached, hydrate throws and the app refuses to
// calculate — no fallback, because a stale number is worse than no answer.

import { createBibleClient } from 'shared-underwriting-standards/bible-client'
import { setBibleStandards } from '../math/constants.js'

// maxAgeMs: 0 → revalidate the Bible (cheap ETag 304 when unchanged) on every call.
const client = createBibleClient({ maxAgeMs: 0 })

let lastVersion = null

// Read the live Bible and hydrate the constants singleton. Called at launch
// (main.jsx) and available to call again before a calculation. Throws (fail
// closed) if the Bible is unreachable.
export async function hydrateBibleFromLive() {
  const doc = await client.getBibleDoc()
  setBibleStandards(doc.standards)
  lastVersion = { bibleVersion: doc.bibleVersion, contentHash: doc.contentHash }
  return lastVersion
}

// Alias for the "re-check before every calculation" call site.
export const refreshBibleFromLive = hydrateBibleFromLive

export function lastBibleVersion() { return lastVersion }
export { client as bibleClient }
