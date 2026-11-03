// Groove pool: timing + velocity templates over one bar of 16th notes. A
// channel picks a groove (params.groove) and an amount (params.grooveAmount,
// 0..1); every note on (or near) a 16th then shifts by the groove's offset for
// that step and has its velocity scaled. Offsets are in 16th-note steps.

const N = 16
const flat = v => Array(N).fill(v)

// MPC-style 16th swing: the second 16th of each 8th lands at `pct` % of it.
function swing16(pct) {
  const late = (2 * pct) / 100 - 1
  return { offsets: Array.from({ length: N }, (_, i) => (i % 2 ? late : 0)), vel: flat(1) }
}

// 8th-note swing: the off-beat 8th (and the 16ths that follow it) move later.
function swing8(pct) {
  const late = (4 * pct) / 100 - 2
  return {
    offsets: Array.from({ length: N }, (_, i) => (i % 4 === 2 ? late : i % 4 === 3 ? late * 0.5 : 0)),
    vel: Array.from({ length: N }, (_, i) => (i % 4 === 2 ? 0.85 : 1)),
  }
}

export const GROOVES = {
  none:      { label: 'Off', offsets: flat(0), vel: flat(1) },
  mpc54:     { label: 'Swing 16 · 54%', ...swing16(54) },
  mpc58:     { label: 'Swing 16 · 58%', ...swing16(58) },
  mpc62:     { label: 'Swing 16 · 62%', ...swing16(62) },
  mpc66:     { label: 'Swing 16 · 66% (triplet)', ...swing16(66.7) },
  swing8_58: { label: 'Swing 8 · 58%', ...swing8(58) },
  swing8_66: { label: 'Swing 8 · 66% (shuffle)', ...swing8(66.7) },
  laidback: {
    label: 'Laid back',
    offsets: [0, 0.08, 0.06, 0.1, 0.12, 0.08, 0.06, 0.1, 0, 0.08, 0.06, 0.1, 0.12, 0.08, 0.06, 0.1],
    vel: [1, 0.7, 0.85, 0.7, 0.95, 0.7, 0.85, 0.7, 1, 0.7, 0.85, 0.7, 0.95, 0.7, 0.85, 0.72],
  },
  push: {
    label: 'Push (ahead)',
    offsets: [0, -0.06, -0.04, -0.06, 0, -0.06, -0.04, -0.06, 0, -0.06, -0.04, -0.06, 0, -0.06, -0.04, -0.06],
    vel: [1, 0.8, 0.9, 0.8, 1, 0.8, 0.9, 0.8, 1, 0.8, 0.9, 0.8, 1, 0.8, 0.9, 0.8],
  },
  boombap: {
    label: 'Boom bap',
    offsets: [0, 0.18, 0.04, 0.2, 0.02, 0.18, 0.06, 0.22, 0, 0.18, 0.04, 0.2, 0.02, 0.18, 0.06, 0.22],
    vel: [1, 0.65, 0.8, 0.7, 1, 0.65, 0.85, 0.7, 0.95, 0.65, 0.8, 0.7, 1, 0.65, 0.85, 0.75],
  },
  accent: {
    label: 'Accents only (1 & 3)',
    offsets: flat(0),
    vel: [1, 0.6, 0.75, 0.6, 0.85, 0.6, 0.75, 0.6, 0.95, 0.6, 0.75, 0.6, 0.85, 0.6, 0.75, 0.6],
  },
}

/**
 * Groove adjustment for a note at `tick` (480 PPQ): { dt (steps), vel (×) }.
 * Notes more than a 64th off the 16th grid are left alone.
 */
export function grooveAt(params, tick) {
  const g = params?.groove && params.groove !== 'none' ? GROOVES[params.groove] : null
  const amt = params?.grooveAmount ?? 1
  if (!g || !amt) return { dt: 0, vel: 1 }
  const pos = tick / 120
  const step = Math.round(pos)
  if (Math.abs(pos - step) > 0.25) return { dt: 0, vel: 1 }
  const i = ((step % N) + N) % N
  return { dt: g.offsets[i] * amt, vel: 1 + (g.vel[i] - 1) * amt }
}
