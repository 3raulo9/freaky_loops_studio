import { ref, reactive, computed } from 'vue'
import { applyTheme } from '../themes.js'
import { createPluginNode, makeWasmPlayFn } from '../audio/wasmPlugin.js'
import { createCustomSynthNode, makeCustomSynthPlayFn } from '../audio/customSynthPlugin.js'
import { playKick, playSnare, playHiHat, playClash } from '../audio/synths.js'
import { DRUM_MODULE_DEFS } from '../audio/drumModules.js'
import { playMelodicNote } from '../audio/melodic.js'
import {
  playFMBell, playFMRhodes, playFMBass, playFMOrgan, playFMBrass,
  playFMMarimba, playFMClav, playFMPad, playFMPluck, playFMFlute, playFMMetal,
  playFMGuitar, playFMBassGuitar,
  playFMVibe, playFMXylophone, playFMStrings, playFMCello, playFMTrumpet,
  playFMClarinet, playFMSitar, playFMSteelDrum, playFMGlocken, playFMWobble,
  playFMChoir, playFMWurly, playFMKalimba, playFMDistGtr, playFMMoog,
  playFMTimpani, playFMCeleste, playFMKoto, playFMHarmonica, playFMOboe,
  playFMTabla,
} from '../audio/fm.js'

// ─── Function key map (for project serialization) ─────────────────────────────
export const FN_KEY_MAP = new Map([
  [playKick,          'kick'],
  [playSnare,         'snare'],
  [playHiHat,         'hihat'],
  [playClash,         'clash'],
  [playMelodicNote,   'melodic'],
  [playFMBell,        'fm:bell'],
  [playFMRhodes,      'fm:rhodes'],
  [playFMBass,        'fm:bass'],
  [playFMOrgan,       'fm:organ'],
  [playFMBrass,       'fm:brass'],
  [playFMMarimba,     'fm:marimba'],
  [playFMClav,        'fm:clav'],
  [playFMPad,         'fm:pad'],
  [playFMPluck,       'fm:pluck'],
  [playFMFlute,       'fm:flute'],
  [playFMMetal,       'fm:metal'],
  [playFMGuitar,      'fm:guitar'],
  [playFMBassGuitar,  'fm:bassguitar'],
  [playFMVibe,        'fm:vibe'],
  [playFMXylophone,   'fm:xylophone'],
  [playFMStrings,     'fm:strings'],
  [playFMCello,       'fm:cello'],
  [playFMTrumpet,     'fm:trumpet'],
  [playFMClarinet,    'fm:clarinet'],
  [playFMSitar,       'fm:sitar'],
  [playFMSteelDrum,   'fm:steeldrum'],
  [playFMGlocken,     'fm:glocken'],
  [playFMWobble,      'fm:wobble'],
  [playFMChoir,       'fm:choir'],
  [playFMWurly,       'fm:wurly'],
  [playFMKalimba,     'fm:kalimba'],
  [playFMDistGtr,     'fm:distgtr'],
  [playFMMoog,        'fm:moog'],
  [playFMTimpani,     'fm:timpani'],
  [playFMCeleste,     'fm:celeste'],
  [playFMKoto,        'fm:koto'],
  [playFMHarmonica,   'fm:harmonica'],
  [playFMOboe,        'fm:oboe'],
  [playFMTabla,       'fm:tabla'],
])

export const FN_FROM_KEY = {
  kick:              playKick,
  snare:             playSnare,
  hihat:             playHiHat,
  clash:             playClash,
  melodic:           playMelodicNote,
  'fm:bell':         playFMBell,
  'fm:rhodes':       playFMRhodes,
  'fm:bass':         playFMBass,
  'fm:organ':        playFMOrgan,
  'fm:brass':        playFMBrass,
  'fm:marimba':      playFMMarimba,
  'fm:clav':         playFMClav,
  'fm:pad':          playFMPad,
  'fm:pluck':        playFMPluck,
  'fm:flute':        playFMFlute,
  'fm:metal':        playFMMetal,
  'fm:guitar':       playFMGuitar,
  'fm:bassguitar':   playFMBassGuitar,
  'fm:vibe':         playFMVibe,
  'fm:xylophone':    playFMXylophone,
  'fm:strings':      playFMStrings,
  'fm:cello':        playFMCello,
  'fm:trumpet':      playFMTrumpet,
  'fm:clarinet':     playFMClarinet,
  'fm:sitar':        playFMSitar,
  'fm:steeldrum':    playFMSteelDrum,
  'fm:glocken':      playFMGlocken,
  'fm:wobble':       playFMWobble,
  'fm:choir':        playFMChoir,
  'fm:wurly':        playFMWurly,
  'fm:kalimba':      playFMKalimba,
  'fm:distgtr':      playFMDistGtr,
  'fm:moog':         playFMMoog,
  'fm:timpani':      playFMTimpani,
  'fm:celeste':      playFMCeleste,
  'fm:koto':         playFMKoto,
  'fm:harmonica':    playFMHarmonica,
  'fm:oboe':         playFMOboe,
  'fm:tabla':        playFMTabla,
}

// ─── FM channel presets ────────────────────────────────────────────────────────
export const FM_PRESETS = {
  bell: {
    name: 'FM BELL', color: '#4ecdc4',
    params: { pitch: 72, decay: 1.8, mod: 6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.3, max: 4.0, decimals: 2 },
      { key: 'mod',   label: 'MOD',   min: 0.5, max: 14,  decimals: 1 },
    ],
    fn: playFMBell,
  },
  rhodes: {
    name: 'FM RHODES', color: '#f39c12',
    params: { pitch: 60, decay: 1.0, bite: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 3.0, decimals: 2 },
      { key: 'bite',  label: 'BITE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMRhodes,
  },
  bass: {
    name: 'FM BASS', color: '#e74c3c',
    params: { pitch: 36, decay: 0.5, fmDrive: 0.5 },
    knobs: [
      { key: 'pitch',   label: 'NOTE',  min: 24,  max: 72,  decimals: 0 },
      { key: 'decay',   label: 'DECAY', min: 0.1, max: 1.5, decimals: 2 },
      { key: 'fmDrive', label: 'DRIVE', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMBass,
  },
  organ: {
    name: 'FM ORGAN', color: '#9b59b6',
    params: { pitch: 60, decay: 0.6, draw: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.05, max: 2.0, decimals: 2 },
      { key: 'draw',  label: 'DRAW',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMOrgan,
  },
  brass: {
    name: 'FM BRASS', color: '#e67e22',
    params: { pitch: 60, decay: 0.7, bright: 0.7 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',   min: 24,  max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY',  min: 0.1, max: 2.0, decimals: 2 },
      { key: 'bright', label: 'BRITE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMBrass,
  },
  marimba: {
    name: 'FM MARIMBA', color: '#2ecc71',
    params: { pitch: 60, decay: 0.35, hardness: 0.5 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 36,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.08, max: 1.2, decimals: 2 },
      { key: 'hardness', label: 'HARD',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMMarimba,
  },
  clav: {
    name: 'FM CLAV', color: '#1abc9c',
    params: { pitch: 60, decay: 0.25, edge: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 36,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.05, max: 0.8, decimals: 2 },
      { key: 'edge',  label: 'EDGE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMClav,
  },
  pad: {
    name: 'FM PAD', color: '#3498db',
    params: { pitch: 60, decay: 2.5, depth: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.5, max: 6.0, decimals: 2 },
      { key: 'depth', label: 'DEPTH', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMPad,
  },
  pluck: {
    name: 'FM PLUCK', color: '#e91e63',
    params: { pitch: 60, decay: 0.5, bright: 0.6 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'bright', label: 'BRITE', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMPluck,
  },
  flute: {
    name: 'FM FLUTE', color: '#16a085',
    params: { pitch: 72, decay: 1.2, breath: 0.4 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',   min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY',  min: 0.2, max: 3.0, decimals: 2 },
      { key: 'breath', label: 'BRTH',   min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMFlute,
  },
  metal: {
    name: 'FM METAL', color: '#7f8c8d',
    params: { pitch: 48, decay: 0.6, grit: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 2.5, decimals: 2 },
      { key: 'grit',  label: 'GRIT',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMMetal,
  },
  guitar: {
    name: 'FM GUITAR', color: '#d4a843',
    params: { pitch: 64, decay: 0.8, tone: 0.65 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 36,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 2.5, decimals: 2 },
      { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMGuitar,
  },
  bassguitar: {
    name: 'BASS GUITAR', color: '#8b4513',
    params: { pitch: 40, decay: 1.0, pick: 0.55 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 60,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 2.5, decimals: 2 },
      { key: 'pick',  label: 'PICK',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMBassGuitar,
  },
  vibe: {
    name: 'FM VIBRAPHONE', color: '#a8e6cf',
    params: { pitch: 65, decay: 2.0, hardness: 0.4 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 36,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.5, max: 5.0, decimals: 2 },
      { key: 'hardness', label: 'HARD',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMVibe,
  },
  xylophone: {
    name: 'FM XYLOPHONE', color: '#dda0dd',
    params: { pitch: 72, decay: 0.18, hardness: 0.6 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.05, max: 0.6, decimals: 2 },
      { key: 'hardness', label: 'HARD',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMXylophone,
  },
  strings: {
    name: 'FM STRINGS', color: '#6c9bd2',
    params: { pitch: 60, decay: 3.0, ensemble: 0.5 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.5, max: 6.0, decimals: 2 },
      { key: 'ensemble', label: 'ENS',   min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMStrings,
  },
  cello: {
    name: 'FM CELLO', color: '#8b6914',
    params: { pitch: 48, decay: 1.5, bow: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 72,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 4.0, decimals: 2 },
      { key: 'bow',   label: 'BOW',   min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMCello,
  },
  trumpet: {
    name: 'FM TRUMPET', color: '#cc4400',
    params: { pitch: 67, decay: 0.8, bright: 0.8 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'bright', label: 'BRITE', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMTrumpet,
  },
  clarinet: {
    name: 'FM CLARINET', color: '#5c8a5e',
    params: { pitch: 60, decay: 1.0, reedy: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 3.0, decimals: 2 },
      { key: 'reedy', label: 'REEDY', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMClarinet,
  },
  sitar: {
    name: 'FM SITAR', color: '#c4851c',
    params: { pitch: 60, decay: 1.2, jivari: 0.5 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',   min: 36,  max: 84,  decimals: 0 },
      { key: 'decay',  label: 'DECAY',  min: 0.3, max: 3.0, decimals: 2 },
      { key: 'jivari', label: 'JIVARI', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMSitar,
  },
  steeldrum: {
    name: 'FM STEEL DRM', color: '#20b2aa',
    params: { pitch: 60, decay: 1.0, ring: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.3, max: 3.0, decimals: 2 },
      { key: 'ring',  label: 'RING',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMSteelDrum,
  },
  glocken: {
    name: 'FM GLOCKEN', color: '#b8a9c9',
    params: { pitch: 72, decay: 1.5, brightness: 0.7 },
    knobs: [
      { key: 'pitch',      label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',      label: 'DECAY', min: 0.3, max: 4.0, decimals: 2 },
      { key: 'brightness', label: 'BRITE', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMGlocken,
  },
  wobble: {
    name: 'FM WOBBLE', color: '#4a4e69',
    params: { pitch: 36, decay: 0.6, rate: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 60,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'rate',  label: 'RATE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMWobble,
  },
  choir: {
    name: 'FM CHOIR', color: '#c77dff',
    params: { pitch: 60, decay: 2.5, vowel: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.5, max: 6.0, decimals: 2 },
      { key: 'vowel', label: 'VOWEL', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMChoir,
  },
  wurly: {
    name: 'FM WURLY', color: '#d4691e',
    params: { pitch: 60, decay: 1.2, bark: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 36,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 3.0, decimals: 2 },
      { key: 'bark',  label: 'BARK',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMWurly,
  },
  kalimba: {
    name: 'FM KALIMBA', color: '#8fbc8f',
    params: { pitch: 60, decay: 0.8, tone: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 2.5, decimals: 2 },
      { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMKalimba,
  },
  distgtr: {
    name: 'FM DIST GTR', color: '#ff4500',
    params: { pitch: 52, decay: 1.0, gain: 0.7 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 72,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 3.0, decimals: 2 },
      { key: 'gain',  label: 'GAIN',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMDistGtr,
  },
  moog: {
    name: 'FM MOOG', color: '#660099',
    params: { pitch: 48, decay: 0.7, cutoff: 0.5 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',   min: 24,  max: 72,  decimals: 0 },
      { key: 'decay',  label: 'DECAY',  min: 0.1, max: 2.0, decimals: 2 },
      { key: 'cutoff', label: 'CUTOFF', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMMoog,
  },
  timpani: {
    name: 'FM TIMPANI', color: '#556b2f',
    params: { pitch: 48, decay: 1.5, tension: 0.5 },
    knobs: [
      { key: 'pitch',   label: 'NOTE',  min: 24,  max: 60,  decimals: 0 },
      { key: 'decay',   label: 'DECAY', min: 0.3, max: 4.0, decimals: 2 },
      { key: 'tension', label: 'TENS',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMTimpani,
  },
  celeste: {
    name: 'FM CELESTE', color: '#b0e0e6',
    params: { pitch: 72, decay: 1.5, softness: 0.5 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.3, max: 4.0, decimals: 2 },
      { key: 'softness', label: 'SOFT',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMCeleste,
  },
  koto: {
    name: 'FM KOTO', color: '#dc143c',
    params: { pitch: 60, decay: 1.0, snap: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 36,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 3.0, decimals: 2 },
      { key: 'snap',  label: 'SNAP',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMKoto,
  },
  harmonica: {
    name: 'FM HARMONICA', color: '#cd853f',
    params: { pitch: 60, decay: 0.9, reedy: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 2.5, decimals: 2 },
      { key: 'reedy', label: 'REEDY', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMHarmonica,
  },
  oboe: {
    name: 'FM OBOE', color: '#2e8b57',
    params: { pitch: 65, decay: 1.0, nasal: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 3.0, decimals: 2 },
      { key: 'nasal', label: 'NASAL', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMOboe,
  },
  tabla: {
    name: 'FM TABLA', color: '#b5651d',
    params: { pitch: 55, decay: 0.6, resonance: 0.5 },
    knobs: [
      { key: 'pitch',     label: 'NOTE',  min: 36,  max: 72,  decimals: 0 },
      { key: 'decay',     label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'resonance', label: 'RESO',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMTabla,
  },
}

// ─── Constants ─────────────────────────────────────────────────────────────────
export const PIANO_LOW   = 0
export const PIANO_HIGH  = 127
export const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const PIANO_KEYS  = Array.from({ length: PIANO_HIGH - PIANO_LOW + 1 }, (_, i) => PIANO_HIGH - i)
export const TICKS_PER_STEP = 120   // 1/16 note at 480 PPQ
export const PLAYLIST_BARS  = 32
export const PLAYLIST_CELLS = 32

export const SCALE_DEFS = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  harmMinor:  [0, 2, 3, 5, 7, 8, 11],
  pentatonic: [0, 2, 4, 7, 9],
  minPent:    [0, 3, 5, 7, 10],
  blues:      [0, 3, 5, 6, 7, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  locrian:    [0, 1, 3, 5, 6, 8, 10],
  chromatic:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

export const NUM_MX_INSERTS = 8

export function midiToLabel(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1) }
export function isBlackKey(m)  { return [1, 3, 6, 8, 10].includes(m % 12) }

// Migrate a note from old step-based format to tick-based format (backward compat for saved projects)
function migrateNote(n) {
  if (n.startTick !== undefined) return { ...n }
  return { ...n, startTick: (n.step ?? 0) * TICKS_PER_STEP, durationTicks: (n.duration ?? 1) * TICKS_PER_STEP }
}

const KB_SEMITONES = {
  KeyZ:0, KeyS:1, KeyX:2, KeyD:3, KeyC:4, KeyV:5, KeyG:6, KeyB:7, KeyH:8, KeyN:9, KeyJ:10, KeyM:11,
  KeyQ:12, Digit2:13, KeyW:14, Digit3:15, KeyE:16, KeyR:17, Digit5:18, KeyT:19, Digit6:20, KeyY:21, Digit7:22, KeyU:23, KeyI:24,
}

// ─── Audio node registry (AudioWorkletNode per channel, outside reactivity) ───
const wasmNodes         = new Map()  // channelId -> AudioWorkletNode (WASM plugins)
const customSynthNodes  = new Map()  // channelId -> AudioWorkletNode (Custom Synth)

// ─── Channel factory ───────────────────────────────────────────────────────────
let _cid = 0
const COLORS = ['#e74c3c','#f39c12','#2ecc71','#9b59b6','#4ecdc4','#e67e22','#1abc9c','#e91e63','#3498db','#16a085']

function makeChannel(overrides = {}) {
  return reactive({
    id:    String(++_cid),
    name:  'SYNTH',
    color: '#4ecdc4',
    type:  'melodic',
    mode:  'piano',
    volume:     0.8,
    pan:        0,
    mixerTrack: 0,
    muted:      false,
    _soloed:    false,
    selected:   false,
    zipped:     false,
    loopEnabled: false,
    loopLength:  16,
    cutSelf:     false,
    swingMix:    1.0,
    groupId:        null,
    activeModules:  [],
    instrumentType: '',
    params: { pitch: 60, decay: 0.4, attack: 0.01, wave: 'sawtooth' },
    knobs: [
      { key: 'pitch',  label: 'NOTE',  min: 24,   max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY', min: 0.05, max: 2.0, decimals: 2 },
      { key: 'attack', label: 'ATCK',  min: 0.001, max: 0.2, decimals: 3 },
    ],
    fn: playMelodicNote,
    ...overrides,
  })
}

// ─── Singleton store ───────────────────────────────────────────────────────────
let _store = null

export function useStudio() {
  if (_store) return _store

  // ── Channels (instrument definitions, no step data here) ─────────────────────
  const channels = reactive([
    makeChannel({
      name: 'KICK', color: '#e74c3c', type: 'drum', mode: 'steps', volume: 0.9,
      instrumentType: 'kick',
      params: { pitch: 60, decay: 0.55, punch: 0.65 },
      knobs: [
        { key: 'pitch', label: 'PITCH', min: 30,  max: 140, decimals: 0 },
        { key: 'decay', label: 'DECAY', min: 0.15, max: 1.6, decimals: 2 },
        { key: 'punch', label: 'PUNCH', min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playKick,
    }),
    makeChannel({
      name: 'SNARE', color: '#f39c12', type: 'drum', mode: 'steps', volume: 0.8,
      instrumentType: 'snare',
      params: { snap: 0.7, tone: 210, decay: 0.28 },
      knobs: [
        { key: 'snap',  label: 'SNAP',  min: 0,   max: 1,   decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 80,  max: 700, decimals: 0 },
        { key: 'decay', label: 'DECAY', min: 0.04, max: 0.9, decimals: 2 },
      ],
      fn: playSnare,
    }),
    makeChannel({
      name: 'HI-HAT', color: '#2ecc71', type: 'drum', mode: 'steps', volume: 0.65,
      instrumentType: 'hihat',
      params: { decay: 0.07, tone: 0.5, mix: 0.75 },
      knobs: [
        { key: 'decay', label: 'DECAY', min: 0.01, max: 0.45, decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
        { key: 'mix',   label: 'MIX',   min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playHiHat,
    }),
    makeChannel({
      name: 'CLASH', color: '#9b59b6', type: 'drum', mode: 'steps', volume: 0.7,
      instrumentType: 'clash',
      params: { decay: 1.2, tone: 0.45, ring: 0.4 },
      knobs: [
        { key: 'decay', label: 'DECAY', min: 0.2, max: 4.0, decimals: 2 },
        { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
        { key: 'ring',  label: 'RING',  min: 0,   max: 1,   decimals: 2 },
      ],
      fn: playClash,
    }),
  ])

  // ── Pattern system ─────────────────────────────────────────────────────────────
  // patterns[]: metadata (id, name, color)
  // patternData[patternId][channelId] = { steps: bool[], pianoNotes: Note[] }
  let _pid = 0
  const patterns = reactive([
    { id: 'p1', name: 'Pattern 1', color: '#4ecdc4' },
  ])
  const patternData = reactive({ p1: {} })
  const currentPatternId = ref('p1')
  const pickerPatternId  = ref('p1')   // selected in playlist picker

  function getPatData(channelId, patternId = currentPatternId.value) {
    if (!patternData[patternId]) patternData[patternId] = {}
    if (!patternData[patternId][channelId]) {
      patternData[patternId][channelId] = reactive({
        steps:          Array(32).fill(false),
        pianoNotes:     [],
        stepVelocities: Array(32).fill(0.8),
        stepPans:       Array(32).fill(0),
        stepPitches:    Array(32).fill(0),
      })
    }
    const d = patternData[patternId][channelId]
    if (!d.stepVelocities) d.stepVelocities = Array(32).fill(0.8)
    if (!d.stepPans)       d.stepPans       = Array(32).fill(0)
    if (!d.stepPitches)    d.stepPitches    = Array(32).fill(0)
    return d
  }

  // Expose helpers for templates/components
  function getSteps(channelId, patternId)      { return getPatData(channelId, patternId).steps }
  function getPianoNotes(channelId, patternId) { return getPatData(channelId, patternId).pianoNotes }

  function addPattern() {
    const id    = 'p' + (++_pid + 1)
    const num   = patterns.length + 1
    const color = COLORS[patterns.length % COLORS.length]
    patterns.push({ id, name: 'Pattern ' + num, color })
    patternData[id] = {}
    currentPatternId.value = id
  }

  function removePattern(id) {
    if (patterns.length <= 1) return
    const idx = patterns.findIndex(p => p.id === id)
    if (idx < 0) return
    patterns.splice(idx, 1)
    delete patternData[id]
    if (currentPatternId.value === id) currentPatternId.value = patterns[0].id
    if (pickerPatternId.value === id)  pickerPatternId.value  = patterns[0].id
    // Remove all playlist clips that used this pattern
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      if (playlistClips[i].patternId === id) playlistClips.splice(i, 1)
    }
  }

  function duplicatePattern(id) {
    const src = patterns.find(p => p.id === id)
    if (!src) return
    const newId  = 'p' + (++_pid + 1)
    const newPat = { id: newId, name: src.name + ' (copy)', color: src.color }
    patterns.push(newPat)
    patternData[newId] = {}
    if (patternData[id]) {
      Object.keys(patternData[id]).forEach(cid => {
        patternData[newId][cid] = reactive({
          steps:      [...(patternData[id][cid].steps || Array(32).fill(false))],
          pianoNotes: (patternData[id][cid].pianoNotes || []).map(n => ({ ...n })),
        })
      })
    }
    currentPatternId.value = newId
  }

  // ── Playlist tracks & clips ────────────────────────────────────────────────────
  const playlistTracks = reactive([
    { id: 'pt1', name: 'Track 1', color: '#e74c3c', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
    { id: 'pt2', name: 'Track 2', color: '#3498db', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
  ])
  let _clipId = 0
  const playlistClips = reactive([])

  // Time markers on the ruler
  const timeMarkers = reactive([])   // { id, cell, label, color }
  let _markerId = 0

  const usePlaylist    = ref(false)
  const playlistTool   = ref('draw')    // 'draw' | 'paint' | 'erase' | 'select'
  const cellWidth      = ref(80)        // px per cell (zoom)
  const trackHeight    = ref(52)        // px per track (vertical zoom)
  const clipFocusMode  = ref('pattern') // 'pattern' | 'automation'

  function addPlaylistTrack() {
    const idx   = playlistTracks.length + 1
    const color = COLORS[idx % COLORS.length]
    playlistTracks.push({ id: 'pt' + idx + Date.now(), name: 'Track ' + idx, color, muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null })
  }

  function removePlaylistTrack(id) {
    const idx = playlistTracks.findIndex(t => t.id === id)
    if (idx < 0 || playlistTracks.length <= 1) return
    playlistTracks.splice(idx, 1)
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      if (playlistClips[i].trackId === id) playlistClips.splice(i, 1)
    }
  }

  function soloPlaylistTrack(id) {
    const already = playlistTracks.find(t => t.id === id)?._soloed
    if (already) {
      playlistTracks.forEach(t => { t.muted = false; t._soloed = false })
    } else {
      playlistTracks.forEach(t => { t._soloed = false; t.muted = t.id !== id })
      const t = playlistTracks.find(t => t.id === id)
      if (t) { t.muted = false; t._soloed = true }
    }
  }

  function placeClip(trackId, cell, patternId, width = 1) {
    const w = Math.max(1, width)
    const collision = playlistClips.find(c =>
      c.trackId === trackId &&
      cell < c.cell + (c.width || 1) &&
      cell + w > c.cell
    )
    if (collision) return
    playlistClips.push({ id: 'c' + (++_clipId), trackId, cell, patternId: patternId ?? pickerPatternId.value, width: w, slipOffset: 0, muted: false })
  }

  function splitClip(clipId, atCell) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const leftWidth = atCell - clip.cell
    if (leftWidth <= 0 || leftWidth >= (clip.width || 1)) return
    const rightWidth = (clip.width || 1) - leftWidth
    clip.width = leftWidth
    playlistClips.push({
      id: 'c' + (++_clipId),
      trackId: clip.trackId,
      cell: atCell,
      patternId: clip.patternId,
      width: rightWidth,
      slipOffset: 0,
      muted: clip.muted || false,
    })
  }

  function makeUniqueClip(clipId) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const srcPat = patterns.find(p => p.id === clip.patternId)
    if (!srcPat) return
    const newId = 'p' + (++_pid + 1)
    patterns.push({ id: newId, name: srcPat.name + ' *', color: srcPat.color })
    patternData[newId] = {}
    const srcData = patternData[clip.patternId]
    if (srcData) {
      Object.keys(srcData).forEach(cid => {
        const d = srcData[cid]
        if (d) patternData[newId][cid] = reactive({
          steps: [...(d.steps || Array(32).fill(false))],
          pianoNotes: (d.pianoNotes || []).map(n => ({ ...n })),
        })
      })
    }
    clip.patternId = newId
  }

  function moveClip(clipId, newTrackId, newCell) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const w = clip.width || 1
    const collision = playlistClips.find(c =>
      c.id !== clipId && c.trackId === newTrackId &&
      newCell < c.cell + (c.width || 1) && newCell + w > c.cell
    )
    if (collision) return
    clip.trackId = newTrackId
    clip.cell    = Math.max(0, Math.min(PLAYLIST_CELLS - w, newCell))
  }

  function resizeClip(clipId, newWidth) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    clip.width = Math.max(1, Math.min(PLAYLIST_CELLS - clip.cell, newWidth))
  }

  function removeClip(clipId) {
    const idx = playlistClips.findIndex(c => c.id === clipId)
    if (idx >= 0) playlistClips.splice(idx, 1)
  }

  function addTimeMarker(cell, label = 'Marker') {
    timeMarkers.push({ id: 'm' + (++_markerId), cell, label })
  }

  function removeTimeMarker(id) {
    const idx = timeMarkers.findIndex(m => m.id === id)
    if (idx >= 0) timeMarkers.splice(idx, 1)
  }

  // ── Track grouping / locking ───────────────────────────────────────────────────
  function groupTrackWithAbove(trackId) {
    const idx = playlistTracks.findIndex(t => t.id === trackId)
    if (idx <= 0) return
    const parent = playlistTracks[idx - 1]
    // Don't nest already-child tracks
    if (parent.groupParentId) return
    playlistTracks[idx].groupParentId = parent.id
  }

  function ungroupTrack(trackId) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.groupParentId = null
  }

  function toggleTrackCollapse(trackId) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.collapsed = !t.collapsed
  }

  function setTrackLocked(trackId, val) {
    const t = playlistTracks.find(t => t.id === trackId)
    if (t) t.locked = val
  }

  // ── Automation clips ───────────────────────────────────────────────────────────
  const automationClips = reactive([])
  let _autoId = 0

  function addAutomationClip(trackId, cell, targetChannelId = null, targetParam = 'volume') {
    automationClips.push({
      id: 'a' + (++_autoId), trackId, cell, width: 4,
      targetChannelId, targetParam,
      nodes: [
        { x: 0,   y: 0.75, tension: 0 },
        { x: 0.5, y: 0.75, tension: 0 },
        { x: 1,   y: 0.75, tension: 0 },
      ],
    })
  }

  function removeAutomationClip(id) {
    const idx = automationClips.findIndex(a => a.id === id)
    if (idx >= 0) automationClips.splice(idx, 1)
  }

  function addAutoNode(clipId, x, y) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip) return
    clip.nodes.push({ x, y, tension: 0 })
    clip.nodes.sort((a, b) => a.x - b.x)
  }

  function removeAutoNode(clipId, nodeIdx) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip || clip.nodes.length <= 2) return
    clip.nodes.splice(nodeIdx, 1)
  }

  function resizeAutomationClip(clipId, newWidth) {
    const clip = automationClips.find(a => a.id === clipId)
    if (!clip) return
    clip.width = Math.max(1, Math.min(PLAYLIST_CELLS - clip.cell, newWidth))
  }

  // ── Unused patterns helper ────────────────────────────────────────────────────
  function getUnusedPatternIds() {
    const used = new Set(playlistClips.map(c => c.patternId))
    return patterns.filter(p => !used.has(p.id)).map(p => p.id)
  }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const selectedChannelId  = ref(channels[0].id)
  const selectedChannel    = computed(() => channels.find(c => c.id === selectedChannelId.value) ?? channels[0])
  const mainView           = ref('sequencer')
  const pianoRollOpen      = ref(false)
  const renderModalOpen    = ref(false)
  const themeModalOpen     = ref(false)
  const currentTheme       = ref(localStorage.getItem('fls-theme') ?? 'void')
  applyTheme(currentTheme.value)
  const kbOctave           = ref(4)
  const gridSnap           = ref('1/4')
  const keyboardInputMode  = ref(false)

  // ── Mixer tracks (0 = master, 1-8 = inserts) ─────────────────────────────
  const mixerTracks = reactive([
    { id: 'mx0', name: 'MASTER', color: '#e74c3c', volume: 1.0, pan: 0, muted: false, _soloed: false, eq: { low: 0, mid: 0, high: 0 } },
    ...Array.from({ length: NUM_MX_INSERTS }, (_, i) => ({
      id: 'mx' + (i + 1),
      name: 'MIX ' + (i + 1),
      color: COLORS[i % COLORS.length],
      volume: 1.0, pan: 0, muted: false, _soloed: false,
      eq: { low: 0, mid: 0, high: 0 },
    }))
  ])

  // ── Scale snap state ──────────────────────────────────────────────────────
  const snapScale = reactive({ enabled: false, tonic: 0, scale: 'major' })

  // ── Channel groups (named display filter groups) ───────────────────────────
  const channelGroups = reactive([])
  let _gid = 0

  // ── Graph editor UI state ─────────────────────────────────────────────────
  const graphEditorOpen = ref(false)
  const graphParam      = ref('velocity') // 'velocity' | 'pan' | 'pitch'

  // ── Sequencer state ───────────────────────────────────────────────────────────
  const bpm         = ref(120)
  const totalSteps  = ref(16)
  const swing       = ref(0)
  const isPlaying        = ref(false)
  const displayStep      = ref(-1)
  const displayCell      = ref(0)
  const playbackStartCell = ref(0)

  // ── Transport status (one-directional: UI dispatches intent, engine acks) ──────
  //   'stopped' | 'arming' | 'playing' | 'paused'. The Play button only
  //   illuminates once the audio clock has actually started running, never on
  //   the raw click — this keeps the UI from desyncing if the engine stalls.
  const transportState = ref('stopped')
  //   Increments once per beat off the audio-locked playhead. The Record button
  //   and Metronome subscribe to this to flash in time with the beat.
  const beatTick   = ref(0)
  const beatAccent = ref(false)   // true when the just-emitted beat is a downbeat

  // ── Metronome ─────────────────────────────────────────────────────────────────
  //   A toggle that injects a click into the mix on every beat. The click sound
  //   is a swappable asset pointer changed live without interrupting playback.
  const metronomeOn    = ref(false)
  const metronomeSound = ref('beep')   // 'beep' | 'tick' | 'cowbell' | 'hat'
  const metroAccent    = ref(true)     // accent the bar downbeat

  // ── Record arm + capture-filter bitmask ───────────────────────────────────────
  //   Record is not a plain boolean — it's a filter mask over what gets captured.
  const RECORD_FLAGS   = { NOTES: 1, AUDIO: 2, AUTOMATION: 4, CLIPS: 8 }
  const recordFilters  = ref(RECORD_FLAGS.NOTES | RECORD_FLAGS.AUTOMATION)
  const recordArmed    = ref(false)
  const recordWarning  = ref(false)
  let   recordWarnTimer = null

  function toggleRecordFilter(flag) {
    recordFilters.value ^= flag
    if (recordFilters.value === 0) recordArmed.value = false   // can't stay armed empty
  }
  function toggleRecordArm() {
    if (recordArmed.value) { recordArmed.value = false; return }
    if (recordFilters.value === 0) {           // refuse to arm with no capture filters
      recordWarning.value = true
      clearTimeout(recordWarnTimer)
      recordWarnTimer = setTimeout(() => { recordWarning.value = false }, 1400)
      return
    }
    recordArmed.value = true
  }

  // ── Undo / Redo ───────────────────────────────────────────────────────────────
  const undoStack = reactive([])
  const redoStack = reactive([])
  const canUndo   = computed(() => undoStack.length > 0)
  const canRedo   = computed(() => redoStack.length > 0)
  const MAX_UNDO  = 50

  function snapshotState() {
    const patSnap = {}
    Object.keys(patternData).forEach(pid => {
      patSnap[pid] = {}
      Object.keys(patternData[pid]).forEach(cid => {
        const d = patternData[pid][cid]
        patSnap[pid][cid] = {
          steps: [...d.steps],
          pianoNotes: d.pianoNotes.map(n => ({ ...n })),
          stepVelocities: [...(d.stepVelocities || Array(32).fill(0.8))],
          stepPans: [...(d.stepPans || Array(32).fill(0))],
          stepPitches: [...(d.stepPitches || Array(32).fill(0))],
        }
      })
    })
    return { patSnap }
  }

  function restoreState(snapshot) {
    Object.keys(snapshot.patSnap).forEach(pid => {
      if (!patternData[pid]) patternData[pid] = {}
      Object.keys(snapshot.patSnap[pid]).forEach(cid => {
        const d = getPatData(cid, pid)
        const s = snapshot.patSnap[pid][cid]
        s.steps.forEach((v, i) => { d.steps[i] = v })
        d.pianoNotes.length = 0
        s.pianoNotes.forEach(n => d.pianoNotes.push({ ...n }))
        if (s.stepVelocities) s.stepVelocities.forEach((v, i) => { d.stepVelocities[i] = v })
        if (s.stepPans)       s.stepPans.forEach((v, i) => { d.stepPans[i] = v })
        if (s.stepPitches)    s.stepPitches.forEach((v, i) => { d.stepPitches[i] = v })
      })
    })
  }

  function pushUndo() {
    undoStack.push(snapshotState())
    if (undoStack.length > MAX_UNDO) undoStack.shift()
    redoStack.length = 0
  }

  function undoAction() {
    if (!undoStack.length) return
    redoStack.push(snapshotState())
    restoreState(undoStack.pop())
  }

  function redoAction() {
    if (!redoStack.length) return
    undoStack.push(snapshotState())
    restoreState(redoStack.pop())
  }

  // ── Audio engine ──────────────────────────────────────────────────────────────
  let audioCtx        = null
  let masterGain      = null
  let analyserNode    = null
  let trackGains      = []
  let trackPanners    = []
  let cutGains        = []   // per-channel cut-self GainNode (null when cutSelf=false)
  let mixerInsertNodes = []  // [{ eqLow, eqMid, eqHigh, gain, panner, analyser }] per insert
  const audioLoad     = ref(0)
  let _loadSmooth     = 0

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      masterGain = audioCtx.createGain()
      masterGain.gain.value = mixerTracks[0].volume
      analyserNode = audioCtx.createAnalyser()
      analyserNode.fftSize = 256
      masterGain.connect(analyserNode)
      analyserNode.connect(audioCtx.destination)
      buildMixerInserts()
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    rebuildGains()
  }

  function buildMixerInserts() {
    mixerInsertNodes = []
    mixerTracks.slice(1).forEach(mt => {
      const eqLow    = audioCtx.createBiquadFilter()
      const eqMid    = audioCtx.createBiquadFilter()
      const eqHigh   = audioCtx.createBiquadFilter()
      const gain     = audioCtx.createGain()
      const panner   = audioCtx.createStereoPanner()
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      eqLow.type  = 'lowshelf';   eqLow.frequency.value  = 80;   eqLow.gain.value  = mt.eq.low
      eqMid.type  = 'peaking';    eqMid.frequency.value  = 1000; eqMid.Q.value = 1; eqMid.gain.value = mt.eq.mid
      eqHigh.type = 'highshelf';  eqHigh.frequency.value = 8000; eqHigh.gain.value = mt.eq.high
      gain.gain.value   = mt.muted ? 0 : mt.volume
      panner.pan.value  = mt.pan
      eqLow.connect(eqMid); eqMid.connect(eqHigh); eqHigh.connect(gain)
      gain.connect(panner); panner.connect(analyser); analyser.connect(masterGain)
      mixerInsertNodes.push({ eqLow, eqMid, eqHigh, gain, panner, analyser })
    })
  }

  function rebuildGains() {
    if (!audioCtx || !masterGain) return
    // Disconnect WASM nodes from old track gains before they are destroyed
    wasmNodes.forEach(node => { try { node.disconnect() } catch (_) {} })
    trackGains.forEach(g => { try { g.disconnect() } catch (e) {} })
    trackPanners.forEach(p => { try { p.disconnect() } catch (e) {} })
    cutGains.forEach(cg => { if (cg) try { cg.disconnect() } catch (e) {} })
    trackGains = []; trackPanners = []; cutGains = []
    channels.forEach(ch => {
      const g = audioCtx.createGain(); g.gain.value = ch.volume
      const p = audioCtx.createStereoPanner(); p.pan.value = ch.pan
      g.connect(p)
      const mtIdx = ch.mixerTrack || 0
      const dest = (mtIdx >= 1 && mixerInsertNodes[mtIdx - 1])
        ? mixerInsertNodes[mtIdx - 1].eqLow
        : masterGain
      p.connect(dest)
      trackGains.push(g); trackPanners.push(p)
      // Cut-self gain node: sits between fn output and trackGain
      if (ch.cutSelf) {
        const cg = audioCtx.createGain(); cg.gain.value = 1.0
        cg.connect(g)
        cutGains.push(cg)
      } else {
        cutGains.push(null)
      }
    })
    // Reconnect plugin + custom-synth nodes to their new track gains
    channels.forEach((ch, i) => {
      if (ch.type === 'wasm') {
        const node = wasmNodes.get(ch.id)
        if (node) node.connect(trackGains[i])
      }
      if (ch.type === 'custom') {
        const node = customSynthNodes.get(ch.id)
        if (node) { try { node.disconnect() } catch(_){} ; node.connect(trackGains[i]) }
      }
    })
  }

  function syncVolumes() {
    channels.forEach((ch, i) => {
      if (trackGains[i])   trackGains[i].gain.value = ch.volume
      if (trackPanners[i]) trackPanners[i].pan.value = ch.pan
    })
  }

  // ── Mixer controls ────────────────────────────────────────────────────────
  function setMixerTrackVolume(trackIdx, vol) {
    const mt = mixerTracks[trackIdx]; if (!mt) return
    mt.volume = vol
    if (trackIdx === 0) { if (masterGain) masterGain.gain.value = mt.muted ? 0 : vol }
    else { const n = mixerInsertNodes[trackIdx - 1]?.gain; if (n) n.gain.value = mt.muted ? 0 : vol }
  }

  function setMixerTrackPan(trackIdx, pan) {
    const mt = mixerTracks[trackIdx]; if (!mt) return
    mt.pan = pan
    if (trackIdx > 0) { const n = mixerInsertNodes[trackIdx - 1]?.panner; if (n) n.pan.value = pan }
  }

  function setMixerEq(trackIdx, band, val) {
    const mt = mixerTracks[trackIdx]; if (!mt || trackIdx === 0) return
    mt.eq[band] = val
    const nodes = mixerInsertNodes[trackIdx - 1]; if (!nodes) return
    if (band === 'low')  nodes.eqLow.gain.value  = val
    if (band === 'mid')  nodes.eqMid.gain.value  = val
    if (band === 'high') nodes.eqHigh.gain.value = val
  }

  function muteMixerTrack(trackIdx) {
    const mt = mixerTracks[trackIdx]; if (!mt) return
    mt.muted = !mt.muted
    if (trackIdx === 0) { if (masterGain) masterGain.gain.value = mt.muted ? 0 : mt.volume }
    else { const n = mixerInsertNodes[trackIdx - 1]?.gain; if (n) n.gain.value = mt.muted ? 0 : mt.volume }
  }

  function soloMixerTrack(trackIdx) {
    const already = mixerTracks[trackIdx]?._soloed
    mixerTracks.forEach((mt, i) => {
      mt._soloed = !already && i === trackIdx
      mt.muted   = !already && i !== trackIdx && i !== 0
    })
    _syncAllMixerGains()
  }

  function renameMixerTrack(trackIdx, name) {
    const mt = mixerTracks[trackIdx]
    if (mt && name.trim()) mt.name = name.trim()
  }

  function _syncAllMixerGains() {
    mixerTracks.forEach((mt, i) => {
      const g = i === 0 ? masterGain : mixerInsertNodes[i - 1]?.gain
      const p = i === 0 ? null : mixerInsertNodes[i - 1]?.panner
      if (g) g.gain.value = mt.muted ? 0 : mt.volume
      if (p) p.pan.value  = mt.pan
    })
  }

  function getMixerAnalyser(trackIdx) {
    if (trackIdx === 0) return analyserNode
    return mixerInsertNodes[trackIdx - 1]?.analyser ?? null
  }

  function assignChannelToMixerTrack(channelId, trackIdx) {
    const ch = channels.find(c => c.id === channelId); if (!ch) return
    ch.mixerTrack = Math.max(0, Math.min(NUM_MX_INSERTS, trackIdx))
    if (audioCtx) rebuildGains()
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────────
  const LOOK_AHEAD = 0.12
  const TICK_MS    = 25
  let schedulerTimer = null
  let nextNoteTime   = 0
  let schedStep      = 0
  let schedCell      = 0
  const noteQueue    = []
  let playbackStartAudioTime   = 0
  let playbackStartCellSeconds = 0
  let _lastBeat = -1   // last beat index emitted to beatTick (metronome pulse)

  function getPatternsForCell(cell) {
    if (!usePlaylist.value) return [currentPatternId.value]
    const playingTrackIds = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
    return playlistClips
      .filter(c => {
        const w = c.width || 1
        const cellMod = cell % PLAYLIST_CELLS
        return cellMod >= c.cell && cellMod < c.cell + w && playingTrackIds.has(c.trackId) && !c.muted
      })
      .map(c => c.patternId)
  }

  function scheduleStep(step, baseWhen, cell) {
    noteQueue.push({ step, time: baseWhen, cell: cell % PLAYLIST_CELLS })
    syncVolumes()
    const secPerBeat = 60 / bpm.value
    const pids = getPatternsForCell(cell)
    channels.forEach((ch, ci) => {
      if (ch.muted) return
      // Per-channel swing: multiply global swing by this channel's swingMix (0–1)
      const swingMix = ch.swingMix ?? 1.0
      const swingOff = step % 2 === 1 ? swing.value * swingMix * secPerBeat * 0.5 : 0
      const when = baseWhen + swingOff
      const dest     = trackGains[ci] ?? audioCtx.destination
      const cutDest  = cutGains[ci]   ?? dest   // route through cutGain if cutSelf
      pids.forEach(pid => {
        const d = getPatData(ch.id, pid)
        if (ch.mode === 'steps') {
          // Per-channel loop length: map step back into loopLength range
          const loopLen = ch.loopEnabled && ch.loopLength > 0 && ch.loopLength < totalSteps.value
            ? ch.loopLength : null
          const s = loopLen !== null ? step % loopLen : step
          if (d.steps[s]) {
            const vel = d.stepVelocities?.[s] ?? 0.8
            // Cut-self: instantly silence previous note, then let new one through
            if (cutGains[ci]) {
              cutGains[ci].gain.setValueAtTime(0.0001, when)
              cutGains[ci].gain.setValueAtTime(1.0,    when + 0.001)
            }
            ch.fn(audioCtx, when, { ...ch.params, velocity: vel }, cutDest)
          }
        } else {
          // Schedule all piano notes whose startTick falls within this step's window.
          // Using a range check (not rounding) means two notes within the same 1/16-note
          // window (e.g. at tick 0 and tick 60) both fire, at their precise sub-step offset.
          const secPerTick   = (60 / bpm.value) / 4 / TICKS_PER_STEP
          const stepStartTick = step * TICKS_PER_STEP
          const stepEndTick   = stepStartTick + TICKS_PER_STEP
          d.pianoNotes.filter(n => n.startTick >= stepStartTick && n.startTick < stepEndTick && !n.muted).forEach(note => {
            const noteWhen = when + (note.startTick - stepStartTick) * secPerTick
            const gate = Math.max(0.05, (note.durationTicks ?? TICKS_PER_STEP) * secPerTick - 0.02)
            ch.fn(audioCtx, noteWhen, { ...ch.params, pitch: note.pitch, velocity: note.velocity ?? 1, gate }, dest)
          })
        }
      })
    })
  }

  // Metronome click — a swappable click asset rendered straight into the master
  // bus. Switching `metronomeSound` just repoints which synth path this takes.
  function scheduleMetroClick(when, accent) {
    if (!audioCtx || !masterGain) return
    const sound = metronomeSound.value
    const g = audioCtx.createGain()
    g.connect(masterGain)
    const vol = accent ? 0.34 : 0.2

    if (sound === 'hat') {
      const dur = 0.03
      const buf = audioCtx.createBuffer(1, Math.ceil(audioCtx.sampleRate * dur), audioCtx.sampleRate)
      const data = buf.getChannelData(0)
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1
      const src = audioCtx.createBufferSource(); src.buffer = buf
      const hp  = audioCtx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = accent ? 9000 : 7000
      src.connect(hp); hp.connect(g)
      g.gain.setValueAtTime(vol, when)
      g.gain.exponentialRampToValueAtTime(0.0001, when + dur)
      src.start(when); src.stop(when + dur + 0.01)
      return
    }

    const osc = audioCtx.createOscillator()
    if      (sound === 'cowbell') { osc.type = 'square'; osc.frequency.value = accent ? 845 : 560 }
    else if (sound === 'tick')    { osc.type = 'square'; osc.frequency.value = accent ? 2100 : 1400 }
    else                          { osc.type = 'sine';   osc.frequency.value = accent ? 1600 : 1000 }
    osc.connect(g)
    g.gain.setValueAtTime(0.0001, when)
    g.gain.exponentialRampToValueAtTime(vol, when + 0.002)
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05)
    osc.start(when); osc.stop(when + 0.06)
  }

  function tick() {
    if (!audioCtx) return
    const t0 = performance.now()
    const secPerBeat = 60 / bpm.value
    const secPerStep = secPerBeat / 4
    const steps = totalSteps.value
    while (nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
      // Pass base grid time — per-channel swing applied inside scheduleStep
      scheduleStep(schedStep % steps, nextNoteTime, schedCell)
      // Metronome: one click per beat (4 steps/beat), accent on the cell downbeat.
      if (metronomeOn.value && schedStep % 4 === 0) {
        scheduleMetroClick(nextNoteTime, metroAccent.value && schedStep % steps === 0)
      }
      nextNoteTime += secPerStep
      schedStep++
      if (schedStep % steps === 0) schedCell++
    }
    const elapsed = performance.now() - t0
    _loadSmooth = _loadSmooth * 0.85 + (elapsed * 40) * 0.15
    audioLoad.value = Math.min(100, Math.round(_loadSmooth))
  }

  function getSecPerCell() {
    return totalSteps.value * (60 / bpm.value) / 4
  }

  function getPlayheadTimeSeconds() {
    if (!isPlaying.value || !audioCtx) return displayCell.value * getSecPerCell()
    return playbackStartCellSeconds + Math.max(0, audioCtx.currentTime - playbackStartAudioTime)
  }

  function drawLoop() {
    if (!isPlaying.value) return
    const now = audioCtx?.currentTime ?? 0
    while (noteQueue.length && noteQueue[0].time <= now + 0.01) {
      displayStep.value = noteQueue[0].step
      displayCell.value = noteQueue[0].cell
      // Emit a beat pulse when the audio-locked playhead crosses a beat. This is
      // read off the look-ahead queue (already latency-compensated) so the visual
      // flash lands with the audible click, not after it.
      const beat = Math.floor(noteQueue[0].step / 4)
      if (beat !== _lastBeat) {
        _lastBeat = beat
        beatAccent.value = noteQueue[0].step === 0   // downbeat of the cell
        beatTick.value++
      }
      noteQueue.shift()
    }
    requestAnimationFrame(drawLoop)
  }

  // Dispatch a "start" intent and wait for the engine to acknowledge (the audio
  // clock actually running) before committing isPlaying. Strict one-way flow.
  async function startPlay() {
    if (transportState.value === 'arming' || transportState.value === 'playing') return
    initAudio()
    transportState.value = 'arming'

    // Engine acknowledgment: the click is only an intent — the transport does
    // not illuminate until the soundcard clock confirms it is producing audio.
    try { await audioCtx.resume() } catch (_) {}
    if (audioCtx.state !== 'running') {
      await new Promise(resolve => {
        const onChange = () => {
          if (audioCtx.state === 'running') { audioCtx.removeEventListener('statechange', onChange); resolve() }
        }
        audioCtx.addEventListener('statechange', onChange)
        setTimeout(resolve, 250)   // safety: never hang the UI on a stuck driver
      })
    }
    // Aborted mid-handshake (user hit Stop while arming)?
    if (transportState.value !== 'arming') return

    const startCell = playbackStartCell.value
    schedStep = 0; schedCell = startCell
    nextNoteTime = audioCtx.currentTime + 0.05
    playbackStartAudioTime   = audioCtx.currentTime
    playbackStartCellSeconds = startCell * getSecPerCell()
    noteQueue.length = 0; displayStep.value = -1; displayCell.value = startCell
    _lastBeat = -1
    isPlaying.value = true              // engine confirmed → transport state syncs
    transportState.value = 'playing'
    schedulerTimer = setInterval(tick, TICK_MS)
    requestAnimationFrame(drawLoop)
  }

  function pausePlay() {
    isPlaying.value = false
    transportState.value = 'paused'
    clearInterval(schedulerTimer); schedulerTimer = null
    noteQueue.length = 0; displayStep.value = -1
    // Playhead stays at current position (pause)
  }

  function stopPlay() {
    isPlaying.value = false
    transportState.value = 'stopped'
    clearInterval(schedulerTimer); schedulerTimer = null
    noteQueue.length = 0; displayStep.value = -1
    displayCell.value = 0; playbackStartCell.value = 0
    _lastBeat = -1
  }

  function togglePlay() {
    if (transportState.value === 'arming') return   // ignore clicks mid-handshake
    isPlaying.value ? pausePlay() : startPlay()
  }

  // ── Keyboard live play ────────────────────────────────────────────────────────
  const pressedKeys     = new Set()
  const pressedKeyPitch = new Map()  // key code → MIDI pitch (so keyUp knows what to stop)

  function playNote(ch, pitch) {
    if (!audioCtx) initAudio()
    const ci   = channels.indexOf(ch)
    const dest = (ci >= 0 && trackGains[ci]) ? trackGains[ci] : audioCtx.destination
    const when = audioCtx.currentTime + 0.005
    ch.fn(audioCtx, when, { ...ch.params, pitch, velocity: 1 }, dest)
  }

  // Stop an active note — essential for WASM/JS/Custom Synth plugins which
  // sustain until noteOff. For Web Audio (FM/melodic) channels the oscillators
  // are already scheduled to stop on their own, so this is a no-op for them.
  function stopNote(ch, pitch) {
    if (!ch || !audioCtx) return
    const t = audioCtx.currentTime + 0.005
    if (ch.type === 'wasm') {
      const node = wasmNodes.get(ch.id)
      if (node) node.port.postMessage({ type: 'noteOff', pitch, time: t })
    } else if (ch.type === 'custom') {
      const node = customSynthNodes.get(ch.id)
      if (node) node.port.postMessage({ type: 'noteOff', pitch, time: t })
    }
  }

  // Panic — instantly silence everything currently playing.
  // Stops the sequencer, releases held keys, sends all-notes-off to plugin
  // nodes, and briefly ducks the master gain to swallow any in-flight Web
  // Audio oscillator tails.
  function panicAll() {
    if (isPlaying.value) stopPlay()
    pressedKeys.clear()
    pressedKeyPitch.clear()
    if (!audioCtx) return

    const t = audioCtx.currentTime
    customSynthNodes.forEach(node => {
      try { node.port.postMessage({ type: 'allNotesOff', time: t }) } catch (_) {}
    })
    wasmNodes.forEach(node => {
      try {
        for (let pitch = 0; pitch < 128; pitch++) {
          node.port.postMessage({ type: 'noteOff', pitch, time: t })
        }
      } catch (_) {}
    })

    if (masterGain) {
      try {
        const now  = audioCtx.currentTime
        const prev = mixerTracks[0].muted ? 0 : mixerTracks[0].volume
        masterGain.gain.cancelScheduledValues(now)
        masterGain.gain.setValueAtTime(masterGain.gain.value, now)
        masterGain.gain.linearRampToValueAtTime(0, now + 0.005)
        masterGain.gain.setValueAtTime(0, now + 0.3)
        masterGain.gain.linearRampToValueAtTime(prev, now + 0.31)
      } catch (_) {}
    }
  }

  function handleKeyDown(e) {
    // Global panic shortcut — works even from inputs, before any other guards.
    if (e.code === 'Digit7' && e.ctrlKey && e.shiftKey) {
      e.preventDefault()
      panicAll()
      return
    }
    if (e.repeat || ['INPUT','SELECT','TEXTAREA'].includes(e.target.tagName)) return
    if (e.code === 'BracketLeft')  { kbOctave.value = Math.max(0, kbOctave.value - 1); return }
    if (e.code === 'BracketRight') { kbOctave.value = Math.min(8, kbOctave.value + 1); return }
    const semi = KB_SEMITONES[e.code]
    if (semi === undefined || pressedKeys.has(e.code)) return
    if (keyboardInputMode.value) e.preventDefault()
    pressedKeys.add(e.code)
    const pitch = 12 * (kbOctave.value + 1) + semi
    pressedKeyPitch.set(e.code, pitch)
    playNote(selectedChannel.value, pitch)
  }

  function handleKeyUp(e) {
    pressedKeys.delete(e.code)
    const pitch = pressedKeyPitch.get(e.code)
    if (pitch !== undefined) {
      stopNote(selectedChannel.value, pitch)
      pressedKeyPitch.delete(e.code)
    }
  }

  // ── Pattern editing ───────────────────────────────────────────────────────────
  function toggleStep(channelId, step) {
    pushUndo()
    const d = getPatData(channelId); d.steps[step] = !d.steps[step]
  }

  function togglePianoNote(channelId, step, pitch) {
    pushUndo()
    const d = getPatData(channelId)
    const startTick = step * TICKS_PER_STEP
    const idx = d.pianoNotes.findIndex(n => n.startTick === startTick && n.pitch === pitch)
    if (idx >= 0) d.pianoNotes.splice(idx, 1)
    else          d.pianoNotes.push({ startTick, pitch, velocity: 1, durationTicks: TICKS_PER_STEP })
  }

  function hasNote(channelId, step, pitch) {
    const startTick = step * TICKS_PER_STEP
    return getPatData(channelId).pianoNotes.some(n => n.startTick === startTick && n.pitch === pitch)
  }

  function clearChannel(channelId) {
    pushUndo()
    const d = getPatData(channelId); d.steps.fill(false); d.pianoNotes.length = 0
  }

  function clearAll() {
    pushUndo()
    channels.forEach(ch => {
      const d = getPatData(ch.id); d.steps.fill(false); d.pianoNotes.length = 0
    })
  }

  // ── Channel solo ──────────────────────────────────────────────────────────────
  function soloChannel(id) {
    const already = channels.find(c => c.id === id)?._soloed
    if (already) {
      channels.forEach(c => { c.muted = false; c._soloed = false })
    } else {
      channels.forEach(c => { c._soloed = false; c.muted = c.id !== id })
      const ch = channels.find(c => c.id === id)
      if (ch) { ch.muted = false; ch._soloed = true }
    }
  }

  // ── Channel management ────────────────────────────────────────────────────────
  let colorCursor = 4

  function addChannel() {
    const ch = makeChannel({
      name:  'SYNTH ' + (channels.filter(c => c.type === 'melodic').length + 1),
      color: COLORS[colorCursor++ % COLORS.length],
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function addFMChannel(presetKey) {
    const preset = FM_PRESETS[presetKey]
    if (!preset) return
    const ch = makeChannel({
      name:   preset.name,
      color:  preset.color,
      params: { ...preset.params },
      knobs:  preset.knobs.map(k => ({ ...k })),
      fn:     preset.fn,
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function addWasmChannel() {
    const ch = makeChannel({
      name:  'PLUGIN ' + (channels.filter(c => c.type === 'wasm').length + 1),
      color: '#7b2fff',
      type:  'wasm',
      mode:  'piano',
      wasmStatus: 'idle',
      wasmName:   '',
      wasmError:  '',
      knobs: [],
      params: {},
      fn: () => {},  // no-op until WASM is loaded
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  // Called from the UI when the user uploads a .wasm file.
  // Loads the binary into a new AudioWorkletNode and wires it to the track gain.
  // content: ArrayBuffer (WASM binary) or string (JS plugin source)
  async function loadWasmForChannel(channelId, content, fileName) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return

    ch.wasmStatus = 'loading'
    ch.wasmError  = ''
    ch.wasmName   = fileName

    try {
      initAudio()  // ensure AudioContext exists
      const node = await createPluginNode(audioCtx, content)

      // Disconnect any existing node for this channel
      if (wasmNodes.has(channelId)) {
        try { wasmNodes.get(channelId).disconnect() } catch (_) {}
      }
      wasmNodes.set(channelId, node)

      // Connect node → track gain for this channel
      const idx = channels.findIndex(c => c.id === channelId)
      if (trackGains[idx]) node.connect(trackGains[idx])

      // Assign the play function (getNode thunk keeps the reference live)
      ch.fn = makeWasmPlayFn(() => wasmNodes.get(channelId))
      ch.wasmStatus = 'ready'
    } catch (err) {
      ch.wasmStatus = 'error'
      ch.wasmError  = err.message
    }
  }

  function addCustomSynthChannel() {
    const ch = makeChannel({
      name:  'CUSTOM ' + (channels.filter(c => c.type === 'custom').length + 1),
      color: '#00d4ff',
      type:  'custom',
      mode:  'piano',
      knobs: [],
      params: {},
      fn: () => {},
    })
    channels.push(ch)
    initAudio()
    createCustomSynthNode(audioCtx).then(node => {
      customSynthNodes.set(ch.id, node)
      const idx = channels.findIndex(c => c.id === ch.id)
      if (trackGains[idx]) node.connect(trackGains[idx])
      ch.fn = makeCustomSynthPlayFn(() => customSynthNodes.get(ch.id))
    }).catch(err => console.error('[CustomSynth] Node init failed:', err))
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function getCustomSynthNode(channelId) {
    return customSynthNodes.get(channelId) ?? null
  }

  function removeChannel(id) {
    const idx = channels.findIndex(c => c.id === id)
    if (idx < 0 || channels.length <= 1) return
    // Clean up Custom Synth node
    if (customSynthNodes.has(id)) {
      try { customSynthNodes.get(id).disconnect() } catch (_) {}
      customSynthNodes.delete(id)
    }
    // Clean up WASM node if this is a plugin channel
    if (wasmNodes.has(id)) {
      try { wasmNodes.get(id).disconnect() } catch (_) {}
      wasmNodes.delete(id)
    }
    channels.splice(idx, 1)
    if (audioCtx) rebuildGains()
    if (selectedChannelId.value === id) selectedChannelId.value = channels[0].id
    if (pianoRollOpen.value && selectedChannelId.value === id) pianoRollOpen.value = false
  }

  function moveChannel(id, dir) {
    const idx = channels.findIndex(c => c.id === id)
    const t   = idx + dir
    if (t < 0 || t >= channels.length) return
    const [ch] = channels.splice(idx, 1)
    channels.splice(t, 0, ch)
  }

  // ── Channel group management ───────────────────────────────────────────────
  function addGroup(name) {
    const id = 'g' + (++_gid)
    channelGroups.push({ id, name })
    return id
  }
  function removeGroup(id) {
    const idx = channelGroups.findIndex(g => g.id === id)
    if (idx >= 0) {
      channels.forEach(ch => { if (ch.groupId === id) ch.groupId = null })
      channelGroups.splice(idx, 1)
    }
  }
  function renameGroup(id, name) {
    const g = channelGroups.find(g => g.id === id)
    if (g && name.trim()) g.name = name.trim()
  }
  function assignChannelsToGroup(channelIds, groupId) {
    channelIds.forEach(id => {
      const ch = channels.find(c => c.id === id)
      if (ch) ch.groupId = groupId
    })
  }

  // ── Step graph data ────────────────────────────────────────────────────────
  function getStepVelocities(channelId, patternId) { return getPatData(channelId, patternId).stepVelocities }
  function getStepPans(channelId, patternId)        { return getPatData(channelId, patternId).stepPans }
  function getStepPitches(channelId, patternId)     { return getPatData(channelId, patternId).stepPitches }

  function setStepVelocity(channelId, step, val, patternId) {
    const d = getPatData(channelId, patternId)
    d.stepVelocities[step] = Math.max(0, Math.min(1, val))
  }
  function setStepPan(channelId, step, val, patternId) {
    const d = getPatData(channelId, patternId)
    d.stepPans[step] = Math.max(-1, Math.min(1, val))
  }
  function setStepPitch(channelId, step, val, patternId) {
    const d = getPatData(channelId, patternId)
    d.stepPitches[step] = Math.max(-12, Math.min(12, Math.round(val)))
  }

  // ── Fill steps ─────────────────────────────────────────────────────────────
  function fillSteps(channelId, every) {
    pushUndo()
    const d = getPatData(channelId)
    for (let i = 0; i < totalSteps.value; i++) {
      d.steps[i] = i % every === 0
    }
  }

  // ── Clone channel ──────────────────────────────────────────────────────────
  function cloneChannel(id) {
    const src = channels.find(c => c.id === id)
    if (!src) return null
    const ch = makeChannel({
      name:    src.name,
      color:   src.color,
      type:    src.type,
      mode:    src.mode,
      volume:  src.volume,
      pan:     src.pan,
      mixerTrack: src.mixerTrack,
      params:  { ...src.params },
      knobs:   src.knobs.map(k => ({ ...k })),
      fn:      src.fn,
      groupId: src.groupId,
    })
    const idx = channels.indexOf(src)
    channels.splice(idx + 1, 0, ch)
    if (audioCtx) rebuildGains()
    return ch.id
  }

  // ── Sort channels ──────────────────────────────────────────────────────────
  function _hexToHue(hex) {
    if (!hex || hex.length < 7) return 0
    const r = parseInt(hex.slice(1,3), 16) / 255
    const g = parseInt(hex.slice(3,5), 16) / 255
    const b = parseInt(hex.slice(5,7), 16) / 255
    const max = Math.max(r,g,b), min = Math.min(r,g,b)
    if (max === min) return 0
    const d = max - min
    let h
    if (max === r)      h = ((g - b) / d + (g < b ? 6 : 0)) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else                h = ((r - g) / d + 4) / 6
    return h
  }
  function sortChannelsBy(by) {
    const arr = [...channels]
    if      (by === 'name')  arr.sort((a, b) => a.name.localeCompare(b.name))
    else if (by === 'track') arr.sort((a, b) => a.mixerTrack - b.mixerTrack)
    else if (by === 'color') arr.sort((a, b) => _hexToHue(a.color) - _hexToHue(b.color))
    channels.splice(0, channels.length, ...arr)
  }

  // ── Color channels ─────────────────────────────────────────────────────────
  function colorChannelsRandom(channelIds) {
    channelIds.forEach(id => {
      const ch = channels.find(c => c.id === id)
      if (ch) ch.color = COLORS[Math.floor(Math.random() * COLORS.length)]
    })
  }
  function colorChannelsGradient(channelIds, fromColor, toColor) {
    const hexToRgb = h => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)]
    const rgbToHex = (r,g,b) => '#' + [r,g,b].map(v => Math.round(v).toString(16).padStart(2,'0')).join('')
    const from = hexToRgb(fromColor), to = hexToRgb(toColor)
    channelIds.forEach((id, i) => {
      const t = channelIds.length <= 1 ? 0 : i / (channelIds.length - 1)
      const ch = channels.find(c => c.id === id)
      if (ch) ch.color = rgbToHex(from[0] + t*(to[0]-from[0]), from[1] + t*(to[1]-from[1]), from[2] + t*(to[2]-from[2]))
    })
  }

  // ── Cut-self toggle ───────────────────────────────────────────────────────────
  function setCutSelf(channelId, value) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    ch.cutSelf = value
    if (audioCtx) rebuildGains()
  }

  // ── Split pattern by channel ──────────────────────────────────────────────────
  // Creates a new pattern for each channel that has content in the given pattern.
  function splitByChannel(patternId) {
    const srcPat = patterns.find(p => p.id === patternId)
    if (!srcPat) return false
    let createdAny = false
    channels.forEach(ch => {
      const d = patternData[patternId]?.[ch.id]
      if (!d) return
      const hasContent = d.steps?.some(Boolean) || d.pianoNotes?.length > 0
      if (!hasContent) return
      createdAny = true
      const newId = 'p' + (++_pid + 1)
      patterns.push({ id: newId, name: srcPat.name + ' — ' + ch.name, color: ch.color })
      patternData[newId] = {}
      patternData[newId][ch.id] = reactive({
        steps:          [...(d.steps          || Array(32).fill(false))],
        pianoNotes:     (d.pianoNotes || []).map(n => ({ ...n })),
        stepVelocities: [...(d.stepVelocities || Array(32).fill(0.8))],
        stepPans:       [...(d.stepPans       || Array(32).fill(0))],
        stepPitches:    [...(d.stepPitches    || Array(32).fill(0))],
      })
    })
    return createdAny
  }

  // ── Project save / load ───────────────────────────────────────────────────────
  // ── Drum module management ──────────────────────────────────────────────────
  function addDrumModule(channelId, moduleId) {
    const ch  = channels.find(c => c.id === channelId)
    const mod = DRUM_MODULE_DEFS[moduleId]
    if (!ch || !mod || ch.activeModules.includes(moduleId)) return
    ch.activeModules.push(moduleId)
    Object.assign(ch.params, mod.params)
  }

  function removeDrumModule(channelId, moduleId) {
    const ch  = channels.find(c => c.id === channelId)
    const mod = DRUM_MODULE_DEFS[moduleId]
    if (!ch || !mod) return
    ch.activeModules = ch.activeModules.filter(id => id !== moduleId)
    for (const key of Object.keys(mod.params)) delete ch.params[key]
  }

  function saveProject(name = 'project') {
    const project = {
      version: 1,
      bpm:        bpm.value,
      totalSteps: totalSteps.value,
      swing:      swing.value,
      snapScale:  { ...snapScale },
      channels: channels.map(ch => ({
        id:          ch.id,
        name:        ch.name,
        color:       ch.color,
        type:        ch.type,
        mode:        ch.mode,
        volume:      ch.volume,
        pan:         ch.pan,
        mixerTrack:  ch.mixerTrack,
        muted:       ch.muted,
        zipped:      ch.zipped,
        loopEnabled: ch.loopEnabled,
        loopLength:  ch.loopLength,
        cutSelf:     ch.cutSelf  ?? false,
        swingMix:    ch.swingMix ?? 1.0,
        groupId:     ch.groupId,
        params:         { ...ch.params },
        knobs:          ch.knobs.map(k => ({ ...k })),
        fnKey:          FN_KEY_MAP.get(ch.fn) ?? 'melodic',
        activeModules:  [...(ch.activeModules ?? [])],
        instrumentType: ch.instrumentType ?? '',
      })),
      channelGroups: channelGroups.map(g => ({ ...g })),
      patterns:      patterns.map(p => ({ ...p })),
      patternData: (() => {
        const out = {}
        Object.keys(patternData).forEach(pid => {
          out[pid] = {}
          Object.keys(patternData[pid]).forEach(cid => {
            const d = patternData[pid][cid]
            out[pid][cid] = {
              steps:          [...d.steps],
              pianoNotes:     d.pianoNotes.map(n => ({ ...n })),
              stepVelocities: [...(d.stepVelocities || Array(32).fill(0.8))],
              stepPans:       [...(d.stepPans       || Array(32).fill(0))],
              stepPitches:    [...(d.stepPitches    || Array(32).fill(0))],
            }
          })
        })
        return out
      })(),
      currentPatternId: currentPatternId.value,
      playlistTracks:   playlistTracks.map(t => ({ ...t })),
      playlistClips:    playlistClips.map(c => ({ ...c })),
      timeMarkers:      timeMarkers.map(m => ({ ...m })),
      automationClips:  automationClips.map(a => ({ ...a, nodes: a.nodes.map(n => ({ ...n })) })),
      mixerTracks: mixerTracks.map(mt => ({
        id:     mt.id,
        name:   mt.name,
        color:  mt.color,
        volume: mt.volume,
        pan:    mt.pan,
        muted:  mt.muted,
        eq:     { ...mt.eq },
      })),
    }

    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = name + '.freak'
    a.click()
    URL.revokeObjectURL(url)
  }

  function loadProjectFile(file) {
    if (!file) return
    const reader = new FileReader()
    reader.onload = e => {
      try {
        _applyProject(JSON.parse(e.target.result))
      } catch (err) {
        console.error('[FreakyLoops] Failed to load project:', err)
        alert('Failed to load project. The file may be corrupted or in an unsupported format.')
      }
    }
    reader.readAsText(file)
  }

  function _applyProject(p) {
    if (isPlaying.value) pausePlay()

    bpm.value        = p.bpm        ?? 120
    totalSteps.value = p.totalSteps ?? 16
    swing.value      = p.swing      ?? 0
    if (p.snapScale) Object.assign(snapScale, p.snapScale)

    // Channels
    channels.splice(0, channels.length, ...(p.channels ?? []).map(ch => reactive({
      id:          ch.id,
      name:        ch.name,
      color:       ch.color,
      type:        ch.type        ?? 'melodic',
      mode:        ch.mode        ?? 'piano',
      volume:      ch.volume      ?? 0.8,
      pan:         ch.pan         ?? 0,
      mixerTrack:  ch.mixerTrack  ?? 0,
      muted:       ch.muted       ?? false,
      _soloed:     false,
      selected:    false,
      zipped:      ch.zipped      ?? false,
      loopEnabled: ch.loopEnabled ?? false,
      loopLength:  ch.loopLength  ?? 16,
      cutSelf:     ch.cutSelf     ?? false,
      swingMix:    ch.swingMix    ?? 1.0,
      groupId:     ch.groupId     ?? null,
      params:         { ...(ch.params ?? {}) },
      knobs:          (ch.knobs ?? []).map(k => ({ ...k })),
      fn:             FN_FROM_KEY[ch.fnKey] ?? playMelodicNote,
      activeModules:  [...(ch.activeModules ?? [])],
      instrumentType: ch.instrumentType ?? '',
    })))

    // Channel groups
    channelGroups.splice(0, channelGroups.length, ...(p.channelGroups ?? []).map(g => ({ ...g })))

    // Patterns metadata
    patterns.splice(0, patterns.length, ...(p.patterns ?? []).map(pt => ({ ...pt })))

    // Pattern data
    Object.keys(patternData).forEach(k => delete patternData[k])
    Object.keys(p.patternData ?? {}).forEach(pid => {
      patternData[pid] = {}
      Object.keys(p.patternData[pid]).forEach(cid => {
        const d = p.patternData[pid][cid]
        patternData[pid][cid] = reactive({
          steps:          [...(d.steps          ?? Array(32).fill(false))],
          pianoNotes:     (d.pianoNotes ?? []).map(migrateNote),
          stepVelocities: [...(d.stepVelocities ?? Array(32).fill(0.8))],
          stepPans:       [...(d.stepPans       ?? Array(32).fill(0))],
          stepPitches:    [...(d.stepPitches    ?? Array(32).fill(0))],
        })
      })
    })

    const firstPatId = patterns[0]?.id ?? 'p1'
    currentPatternId.value = p.currentPatternId ?? firstPatId
    pickerPatternId.value  = p.currentPatternId ?? firstPatId

    // Playlist
    playlistTracks.splice(0, playlistTracks.length, ...(p.playlistTracks ?? []).map(t => ({ ...t, _soloed: false })))
    playlistClips.splice(0, playlistClips.length, ...(p.playlistClips ?? []).map(c => ({ ...c })))
    timeMarkers.splice(0, timeMarkers.length, ...(p.timeMarkers ?? []).map(m => ({ ...m })))
    automationClips.splice(0, automationClips.length, ...(p.automationClips ?? []).map(a => ({
      ...a, nodes: (a.nodes ?? []).map(n => ({ ...n })),
    })))

    // Mixer
    ;(p.mixerTracks ?? []).forEach((mt, i) => {
      if (!mixerTracks[i]) return
      mixerTracks[i].name    = mt.name   ?? mixerTracks[i].name
      mixerTracks[i].color   = mt.color  ?? mixerTracks[i].color
      mixerTracks[i].volume  = mt.volume ?? 1.0
      mixerTracks[i].pan     = mt.pan    ?? 0
      mixerTracks[i].muted   = mt.muted  ?? false
      mixerTracks[i]._soloed = false
      if (mt.eq) Object.assign(mixerTracks[i].eq, mt.eq)
    })

    // Update selected channel
    selectedChannelId.value = channels[0]?.id ?? ''

    // Advance ID counters to prevent collisions with loaded IDs
    _cid = Math.max(_cid, ...channels.map(ch => parseInt(ch.id) || 0))
    _pid = Math.max(_pid, ...patterns.map(pt => parseInt(pt.id.replace(/^p/, '')) || 0))
    _clipId   = Math.max(_clipId,   ...playlistClips.map(c  => parseInt(c.id.replace(/^c/, ''))  || 0))
    _markerId = Math.max(_markerId, ...timeMarkers.map(m    => parseInt(m.id.replace(/^m/, ''))  || 0))
    _autoId   = Math.max(_autoId,   ...automationClips.map(a => parseInt(a.id.replace(/^a/, '')) || 0))
    _gid      = Math.max(_gid,      ...channelGroups.map(g  => parseInt(g.id.replace(/^g/, ''))  || 0))

    if (audioCtx) rebuildGains()
    undoStack.length = 0
    redoStack.length = 0
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  _store = {
    pushUndo,
    // Channels
    channels, selectedChannelId, selectedChannel,
    soloChannel, addChannel, addFMChannel, addWasmChannel, loadWasmForChannel,
    addCustomSynthChannel, getCustomSynthNode,
    removeChannel, moveChannel,
    // Patterns
    patterns, currentPatternId, pickerPatternId, patternData,
    getPatData, getSteps, getPianoNotes,
    addPattern, removePattern, duplicatePattern,
    // Pattern editing
    toggleStep, togglePianoNote, hasNote, clearChannel, clearAll,
    // Step graph
    getStepVelocities, setStepVelocity,
    getStepPans, setStepPan,
    getStepPitches, setStepPitch,
    fillSteps,
    // Channel groups
    channelGroups, addGroup, removeGroup, renameGroup, assignChannelsToGroup,
    // Graph editor
    graphEditorOpen, graphParam,
    // Channel operations
    cloneChannel, sortChannelsBy, colorChannelsRandom, colorChannelsGradient,
    setCutSelf, splitByChannel,
    // Playlist
    playlistTracks, playlistClips, timeMarkers, usePlaylist,
    playlistTool, cellWidth, trackHeight, clipFocusMode, displayCell, playbackStartCell,
    addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
    placeClip, removeClip, moveClip, resizeClip, splitClip, makeUniqueClip,
    addTimeMarker, removeTimeMarker,
    PLAYLIST_CELLS,
    // Track groups/lock
    groupTrackWithAbove, ungroupTrack, toggleTrackCollapse, setTrackLocked,
    // Automation
    automationClips, addAutomationClip, removeAutomationClip,
    addAutoNode, removeAutoNode, resizeAutomationClip,
    // Utilities
    getUnusedPatternIds,
    // UI state
    mainView, pianoRollOpen, renderModalOpen, themeModalOpen, currentTheme, kbOctave,
    gridSnap, keyboardInputMode,
    // Sequencer
    bpm, totalSteps, swing, isPlaying, displayStep,
    togglePlay, startPlay, stopPlay, pausePlay,
    getPlayheadTimeSeconds, audioLoad,
    // Transport status + record
    transportState, beatTick, beatAccent,
    RECORD_FLAGS, recordFilters, recordArmed, recordWarning,
    toggleRecordFilter, toggleRecordArm,
    // Metronome
    metronomeOn, metronomeSound, metroAccent,
    getAnalyser: () => analyserNode,
    // Undo / Redo
    canUndo, canRedo, undoAction, redoAction,
    // Keyboard
    playNote, stopNote, handleKeyDown, handleKeyUp, panicAll,
    // Mixer
    mixerTracks,
    setMixerTrackVolume, setMixerTrackPan, setMixerEq,
    muteMixerTrack, soloMixerTrack, renameMixerTrack,
    getMixerAnalyser, assignChannelToMixerTrack,
    // Scale snap
    snapScale,
    // Project save / load
    saveProject, loadProjectFile,
    // Drum modules
    addDrumModule, removeDrumModule,
  }
  return _store
}
