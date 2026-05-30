// Optional modules users can attach to drum instruments.
// Each module adds a set of params (with defaults) and knob specs.
// `instruments` lists which drum types support the module.

export const DRUM_MODULE_DEFS = {
  envelope: {
    id:          'envelope',
    label:       'ENVELOPE',
    instruments: ['kick', 'snare', 'hihat', 'clash'],
    params: { attack: 0.002, sustain: 0.0, release: 0.05 },
    knobs: [
      { key: 'attack',  label: 'ATCK', min: 0.001, max: 0.3,  decimals: 3 },
      { key: 'sustain', label: 'SUS',  min: 0,     max: 1.0,  decimals: 2 },
      { key: 'release', label: 'REL',  min: 0.005, max: 2.0,  decimals: 3 },
    ],
  },
  transient: {
    id:          'transient',
    label:       'TRANSIENT',
    instruments: ['kick', 'snare'],
    params: { clickLevel: 0.5, clickTone: 0.5, clickDecay: 0.008 },
    knobs: [
      { key: 'clickLevel', label: 'CLVL',  min: 0,     max: 1,    decimals: 2 },
      { key: 'clickTone',  label: 'CTONE', min: 0,     max: 1,    decimals: 2 },
      { key: 'clickDecay', label: 'CDCY',  min: 0.001, max: 0.06, decimals: 3 },
    ],
  },
  pitchEnv: {
    id:          'pitchEnv',
    label:       'PITCH ENV',
    instruments: ['kick', 'snare'],
    params: { pitchStart: 150, pitchEnd: 45, pitchDecay: 0.03 },
    knobs: [
      { key: 'pitchStart', label: 'P.SRT', min: 30,   max: 800,  decimals: 0 },
      { key: 'pitchEnd',   label: 'P.END', min: 20,   max: 400,  decimals: 0 },
      { key: 'pitchDecay', label: 'P.DCY', min: 0.005, max: 0.5, decimals: 3 },
    ],
  },
  distortion: {
    id:          'distortion',
    label:       'DISTORTION',
    instruments: ['kick', 'snare', 'hihat', 'clash'],
    params: { drive: 0.4, crunch: 0.2, distMix: 0.5 },
    knobs: [
      { key: 'drive',   label: 'DRIVE', min: 0, max: 1, decimals: 2 },
      { key: 'crunch',  label: 'CRNCH', min: 0, max: 1, decimals: 2 },
      { key: 'distMix', label: 'MIX',   min: 0, max: 1, decimals: 2 },
    ],
  },
  filter: {
    id:          'filter',
    label:       'FILTER',
    instruments: ['kick', 'snare', 'hihat', 'clash'],
    params: { lpCutoff: 16000, hpCutoff: 30, filterQ: 1.0 },
    knobs: [
      { key: 'lpCutoff', label: 'LP',   min: 200,  max: 18000, decimals: 0 },
      { key: 'hpCutoff', label: 'HP',   min: 20,   max: 4000,  decimals: 0 },
      { key: 'filterQ',  label: 'RESO', min: 0.1,  max: 15,    decimals: 1 },
    ],
  },
  body: {
    id:          'body',
    label:       'BODY',
    instruments: ['kick', 'snare'],
    params: { subLevel: 0.5, bodyTune: 1.0, bodyDecay: 0.45 },
    knobs: [
      { key: 'subLevel',  label: 'SUB',  min: 0,   max: 1.5, decimals: 2 },
      { key: 'bodyTune',  label: 'TUNE', min: 0.5, max: 2.0, decimals: 2 },
      { key: 'bodyDecay', label: 'BDCY', min: 0.05, max: 2.5, decimals: 2 },
    ],
  },
  fx: {
    id:          'fx',
    label:       'FX',
    instruments: ['kick', 'snare', 'hihat', 'clash'],
    params: { reverbSend: 0.0, delaySend: 0.0, width: 0.0 },
    knobs: [
      { key: 'reverbSend', label: 'VERB', min: 0, max: 1, decimals: 2 },
      { key: 'delaySend',  label: 'DLY',  min: 0, max: 1, decimals: 2 },
      { key: 'width',      label: 'WDTH', min: 0, max: 1, decimals: 2 },
    ],
  },
}
