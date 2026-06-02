// qaSelfCheck.test.js — proves the read-only persistence diagnostic never throws
// and reports config state gracefully when Google creds aren't present (test env).

import { describe, it, expect } from 'vitest'
import { qaSelfCheck } from '../../api/qaSelfCheck.js'

function run() {
  return new Promise((resolve) => {
    const res = { status() { return this }, json(o) { resolve(o) } }
    qaSelfCheck({ method: 'GET' }, res)
  })
}

describe('qa-selfcheck (read-only persistence diagnostic)', () => {
  it('returns a structured result without throwing when Google is unconfigured', async () => {
    const out = await run()
    expect(out).toHaveProperty('ok')
    expect(out).toHaveProperty('drive')
    expect(out).toHaveProperty('sheet')
    expect(typeof out.drive.ok).toBe('boolean')
    expect(typeof out.sheet.ok).toBe('boolean')
    // In the test env there is no service account → not ok, but it must report cleanly.
    expect(out.ok).toBe(false)
    expect(out.google_configured).toBe(false)
  })
})
