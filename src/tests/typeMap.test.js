import { describe, it, expect } from 'vitest'
import { PROPERTY_TYPES, getType, deriveNOI } from '../components/analyze/typeMap.js'

describe('Analyze workspace type map', () => {
  it('exposes the 7 supported types and excludes Lending', () => {
    const ids = PROPERTY_TYPES.map(t => t.id)
    expect(ids).toEqual([
      'residential', 'self_storage', 'multifamily', 'commercial', 'mhp_rv', 'mixed_use', 'ios_land'
    ])
    expect(ids).not.toContain('lending')
  })

  it('routes Multifamily through the existing storage/income engine (no new engine)', () => {
    const mf = getType('multifamily')
    const calc = mf.buildCalc({ noi: 120000 })
    expect(calc.type).toBe('storage_group_a')
    expect(calc.inputs.noi).toBe(120000)
  })

  it('routes Self Storage through storage_group_a', () => {
    expect(getType('self_storage').buildCalc({ noi: 90000 }).type).toBe('storage_group_a')
  })

  it('routes Commercial through commercial_dscr', () => {
    expect(getType('commercial').buildCalc({ noi: 200000 }).type).toBe('commercial_dscr')
  })

  it('routes MHP/RV through mhp_noi and chains to storage', () => {
    const calc = getType('mhp_rv').buildCalc({ lots: 40, lotRent: 350 })
    expect(calc.type).toBe('mhp_noi')
    expect(calc.chainToStorage).toBe(true)
  })

  it('residential flip uses MAO, rental uses DSCR', () => {
    const r = getType('residential')
    expect(r.buildCalc({ arv: 300000, rehab: 50000 }, 'flip').type).toBe('residential_mao')
    expect(r.buildCalc({ noi: 24000, purchase: 200000 }, 'rental').type).toBe('residential_dscr')
  })

  it('IOS/Land has no engine but analyzes income when present (else intake-only)', () => {
    const land = getType('ios_land')
    expect(land.implemented).toBe(false)
    expect(land.buildCalc({ noi: 0 })).toBeNull()           // raw land → intake only
    expect(land.buildCalc({ noi: 50000 }).type).toBe('storage_group_a') // income → income engine
  })

  it('deriveNOI uses explicit NOI, else gross × (1 − expense ratio), default 40%', () => {
    expect(deriveNOI({ noi: 100000 })).toBe(100000)
    expect(deriveNOI({ grossIncome: 100000, expenseRatio: 30 })).toBe(70000)
    expect(deriveNOI({ grossIncome: 100000 })).toBe(60000)
    expect(deriveNOI({})).toBe(0)
  })
})
