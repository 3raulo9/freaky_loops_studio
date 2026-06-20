import { ref, reactive, computed, watch, toRaw } from 'vue'
import { applyTheme } from '../themes.js'
import { fillSample, sampleDuration } from '../browserLibrary.js'
import { createPluginNode, makeWasmPlayFn } from '../audio/wasmPlugin.js'
import { sendToHost, onHostMessage, isDesktop } from '../desktop/ipc.js'
import { createCustomSynthNode, makeCustomSynthPlayFn } from '../audio/customSynthPlugin.js'
import { createSubterraNode, makeSubterraPlayFn } from '../audio/subterraPlugin.js'
import { playKick, playSnare, playHiHat, playClash } from '../audio/synths.js'
import { parseMidi } from '../midi/midiParser.js'
import { convertMidiToTracks } from '../midi/midiImport.js'
import { makeGMPlayFn, preloadGMInstrument, gmSustains } from '../audio/gmSynth.js'
import { GM_INSTRUMENTS, GM_CATEGORIES } from '../midi/gmDictionary.js'
import { DRUM_MODULE_DEFS } from '../audio/drumModules.js'
import { playMelodicNote } from '../audio/melodic.js'
import { createEffect, makeEffect, EFFECT_DEFS } from '../audio/effects.js'
import { detectBpm, timeStretch, timeStretchSegments, buildWarpSegments, tempoRatio, WARP_MODES } from '../audio/warp.js'
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
    name: 'FM ORGAN', color: '#9b59b6', sustains: true,
    params: { pitch: 60, decay: 0.6, draw: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.05, max: 2.0, decimals: 2 },
      { key: 'draw',  label: 'DRAW',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMOrgan,
  },
  brass: {
    name: 'FM BRASS', color: '#e67e22', sustains: true,
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
    name: 'FM PAD', color: '#3498db', sustains: true,
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
    name: 'FM FLUTE', color: '#16a085', sustains: true,
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
    name: 'FM STRINGS', color: '#6c9bd2', sustains: true,
    params: { pitch: 60, decay: 3.0, ensemble: 0.5 },
    knobs: [
      { key: 'pitch',    label: 'NOTE',  min: 24,  max: 96,  decimals: 0 },
      { key: 'decay',    label: 'DECAY', min: 0.5, max: 6.0, decimals: 2 },
      { key: 'ensemble', label: 'ENS',   min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMStrings,
  },
  cello: {
    name: 'FM CELLO', color: '#8b6914', sustains: true,
    params: { pitch: 48, decay: 1.5, bow: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 72,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 4.0, decimals: 2 },
      { key: 'bow',   label: 'BOW',   min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMCello,
  },
  trumpet: {
    name: 'FM TRUMPET', color: '#cc4400', sustains: true,
    params: { pitch: 67, decay: 0.8, bright: 0.8 },
    knobs: [
      { key: 'pitch',  label: 'NOTE',  min: 48,  max: 96,  decimals: 0 },
      { key: 'decay',  label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'bright', label: 'BRITE', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMTrumpet,
  },
  clarinet: {
    name: 'FM CLARINET', color: '#5c8a5e', sustains: true,
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
    name: 'FM WOBBLE', color: '#4a4e69', sustains: true,
    params: { pitch: 36, decay: 0.6, rate: 0.5 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 24,  max: 60,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.1, max: 2.0, decimals: 2 },
      { key: 'rate',  label: 'RATE',  min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMWobble,
  },
  choir: {
    name: 'FM CHOIR', color: '#c77dff', sustains: true,
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
    name: 'FM MOOG', color: '#660099', sustains: true,
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
    name: 'FM HARMONICA', color: '#cd853f', sustains: true,
    params: { pitch: 60, decay: 0.9, reedy: 0.6 },
    knobs: [
      { key: 'pitch', label: 'NOTE',  min: 48,  max: 84,  decimals: 0 },
      { key: 'decay', label: 'DECAY', min: 0.2, max: 2.5, decimals: 2 },
      { key: 'reedy', label: 'REEDY', min: 0,   max: 1,   decimals: 2 },
    ],
    fn: playFMHarmonica,
  },
  oboe: {
    name: 'FM OBOE', color: '#2e8b57', sustains: true,
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

// Infer the continuous-voice flag for projects saved before `sustains` existed,
// from the GM program (sampled voices) or the FM/synth play-function key.
function deriveChannelSustains(ch) {
  if (ch.params?.gmProgram != null) return gmSustains(ch.params.gmProgram)
  const fk = ch.fnKey
  if (fk === 'melodic') return true
  if (typeof fk === 'string' && fk.startsWith('fm:')) return !!FM_PRESETS[fk.slice(3)]?.sustains
  return false
}

// ─── Constants ─────────────────────────────────────────────────────────────────
export const PIANO_LOW   = 0
export const PIANO_HIGH  = 127
export const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
export const PIANO_KEYS  = Array.from({ length: PIANO_HIGH - PIANO_LOW + 1 }, (_, i) => PIANO_HIGH - i)
export const TICKS_PER_STEP = 120   // 1/16 note at 480 PPQ
export const STEPS_PITCH    = 72    // C5 — steps mode stores notes here in pianoNotes[]
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
export const NUM_MX_RETURNS = 2

export function midiToLabel(m) { return NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1) }
export function isBlackKey(m)  { return [1, 3, 6, 8, 10].includes(m % 12) }

// Migrate a note from old step-based format to tick-based format (backward compat for saved projects)
function migrateNote(n) {
  if (n.startTick !== undefined) return { ...n }
  return { ...n, startTick: (n.step ?? 0) * TICKS_PER_STEP, durationTicks: (n.duration ?? 1) * TICKS_PER_STEP }
}

const KB_SEMITONES = {
  // Lower octave — white: Z X C V B N M , . /   black: S D G H J L ;
  KeyZ:0, KeyS:1, KeyX:2, KeyD:3, KeyC:4, KeyV:5, KeyG:6, KeyB:7, KeyH:8, KeyN:9, KeyJ:10, KeyM:11,
  Comma:12, KeyL:13, Period:14, Semicolon:15, Slash:16,
  // Upper octave — white: Q W E R T Y U I O P [ ]   black: 2 3 5 6 7 9 0
  KeyQ:12, Digit2:13, KeyW:14, Digit3:15, KeyE:16, KeyR:17, Digit5:18, KeyT:19, Digit6:20, KeyY:21, Digit7:22, KeyU:23, KeyI:24,
  Digit9:25, KeyO:26, Digit0:27, KeyP:28, BracketLeft:29, BracketRight:31,
}

// ─── Audio node registry (AudioWorkletNode per channel, outside reactivity) ───
const wasmNodes         = new Map()  // channelId -> AudioWorkletNode (WASM plugins)
const customSynthNodes  = new Map()  // channelId -> AudioWorkletNode (Custom Synth)
const subterraNodes     = new Map()  // channelId -> AudioWorkletNode (SUBTERRA bass)
const channelFxChains   = new Map()  // channelId -> (live FX handle | null)[] aligned to ch.effects
const audioFileBufs     = new Map()  // channelId -> AudioBuffer (user audio files)
const audioClipBufs     = new Map()  // clipId    -> AudioBuffer (playlist audio clips)
const chopBufs          = new Map()  // channelId -> AudioBuffer (CHOP slicer)
const forgeBufsA        = new Map()  // channelId -> AudioBuffer (FORGE deck A)
const forgeBufsB        = new Map()  // channelId -> AudioBuffer (FORGE deck B)
const forgeBufsA_rev    = new Map()  // channelId -> reversed AudioBuffer (FORGE deck A)
const forgeBufsB_rev    = new Map()  // channelId -> reversed AudioBuffer (FORGE deck B)
const reversedAudioFileBufs = new Map()  // channelId -> reversed AudioBuffer (sampler reverse mode)
const pingpongAudioFileBufs = new Map()  // channelId -> doubled [fwd+rev] AudioBuffer (ping-pong loop)
const xfadeLoopBufs         = new Map()  // channelId -> crossfaded copy for seamless FWD loop
const warpedClipBufs        = new Map()  // clipId    -> { sig, buf } cached time-stretched playlist clip
const warpedSampleBufs      = new Map()  // channelId -> { sig, buf } cached time-stretched sampler buffer
const samplerZoneBufs       = new Map()  // channelId+':'+zoneId -> AudioBuffer (multisample zones)
const _samplerRR            = new Map()  // channelId -> round-robin counter
const sampleEditHistory     = new Map()  // channelId -> [{ buf, params }] undo stack for destructive sample edits

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
    // Continuous-voice flag: when true, a held live note sustains until release
    // (set on synth/FM/GM channels whose timbre rings continuously). Plucked and
    // percussive voices leave this false and keep their natural decay.
    sustains:    false,
    midiChannelThrough:  false,
    truncateSwingNotes:  true,
    groupId:        null,
    activeModules:  [],
    // Per-channel insert FX chain (processed between the channel panner and the
    // mixer/master). Each entry: { type, enabled, ...params }. See audio/effects.js.
    effects:        [],
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

  // Reactive version counter keyed by channelId — increments when an audio buffer
  // is loaded or cleared so that computed refs in SamplerChannel.vue re-evaluate.
  const audioFileVersions = reactive({})
  // Reactive undo-stack depth per sampler channel (drives the EDIT ↶ UNDO button).
  const sampleHistoryDepth = reactive({})
  // Same pattern for playlist Audio Clips: keyed by clip ID.
  const audioClipVersions = reactive({})
  // CHOP and FORGE slicer version counters (same "silent dependency" pattern).
  const chopVersions  = reactive({})
  const forgeVersions = reactive({})   // keyed by channelId+'_A' or channelId+'_B'

  // ── Pattern system ─────────────────────────────────────────────────────────────
  // patterns[]: metadata (id, name, color)
  // patternData[patternId][channelId] = { steps: bool[], pianoNotes: Note[] }
  let _pid = 0
  const patterns = reactive([
    { id: 'p1', name: 'Pattern 1', color: '#4ecdc4' },
  ])
  const patternData = reactive({ p1: {} })
  const patternLengthOverrides = reactive({})   // patId → tick count (manual loop-point override)
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
        stepModX:       Array(32).fill(0.5),
        stepModY:       Array(32).fill(0.5),
        stepShift:      Array(32).fill(0),
        stepRep:        Array(32).fill(0),
      })
    }
    const d = patternData[patternId][channelId]
    if (!d.stepVelocities) d.stepVelocities = Array(32).fill(0.8)
    if (!d.stepPans)       d.stepPans       = Array(32).fill(0)
    if (!d.stepPitches)    d.stepPitches    = Array(32).fill(0)
    if (!d.stepModX)       d.stepModX       = Array(32).fill(0.5)
    if (!d.stepModY)       d.stepModY       = Array(32).fill(0.5)
    if (!d.stepShift)      d.stepShift      = Array(32).fill(0)
    if (!d.stepRep)        d.stepRep        = Array(32).fill(0)
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

  // Drum type → channel config for imported MIDI channel 9 tracks
  const _DRUM_IMPORT = {
    kick:  { type: 'drum', instrumentType: 'kick',  color: '#e74c3c',
             params: { pitch: 60, decay: 0.55, punch: 0.65 },
             knobs: [
               { key: 'pitch', label: 'PITCH', min: 30,  max: 140, decimals: 0 },
               { key: 'decay', label: 'DECAY', min: 0.15, max: 1.6, decimals: 2 },
               { key: 'punch', label: 'PUNCH', min: 0,    max: 1,   decimals: 2 },
             ], fn: playKick },
    snare: { type: 'drum', instrumentType: 'snare', color: '#f39c12',
             params: { snap: 0.7, tone: 210, decay: 0.28 },
             knobs: [
               { key: 'snap',  label: 'SNAP',  min: 0,   max: 1,   decimals: 2 },
               { key: 'tone',  label: 'TONE',  min: 80,  max: 700, decimals: 0 },
               { key: 'decay', label: 'DECAY', min: 0.04, max: 0.9, decimals: 2 },
             ], fn: playSnare },
    hihat: { type: 'drum', instrumentType: 'hihat', color: '#2ecc71',
             params: { decay: 0.07, tone: 0.5, mix: 0.75 },
             knobs: [
               { key: 'decay', label: 'DECAY', min: 0.01, max: 0.45, decimals: 2 },
               { key: 'tone',  label: 'TONE',  min: 0,    max: 1,    decimals: 2 },
               { key: 'mix',   label: 'MIX',   min: 0,    max: 1,    decimals: 2 },
             ], fn: playHiHat },
    clash: { type: 'drum', instrumentType: 'clash', color: '#9b59b6',
             params: { decay: 1.2, tone: 0.45, ring: 0.4 },
             knobs: [
               { key: 'decay', label: 'DECAY', min: 0.2, max: 4.0, decimals: 2 },
               { key: 'tone',  label: 'TONE',  min: 0,   max: 1,   decimals: 2 },
               { key: 'ring',  label: 'RING',  min: 0,   max: 1,   decimals: 2 },
             ], fn: playClash },
  }

  /**
   * Import a MIDI binary buffer into the channel rack.
   *
   * Creates a new named pattern for the file, adds one channel per active MIDI
   * track using the closest matching FM synth preset (GM program → FM_PRESETS key),
   * populates every channel's pianoNotes from the MIDI note data, and sets the
   * project BPM to the file's primary tempo.
   *
   * The result is a fully editable project: notes in the piano roll, patterns in
   * the playlist, instruments swappable via the channel rack — just like music
   * composed natively in the app.
   */
  function importMidiFile(buffer, filename = 'MIDI IMPORT') {
    const parsed = parseMidi(buffer)
    const { bpm: midiBpm, patternName, tracks } = convertMidiToTracks(parsed, filename)

    if (tracks.length === 0) return { channelCount: 0 }

    // Sync project tempo to the MIDI file
    bpm.value = midiBpm

    // Create a new pattern named after the file
    const patId = 'p' + (++_pid + 1)
    patterns.push({ id: patId, name: patternName, color: '#e91e63' })
    patternData[patId] = {}
    currentPatternId.value = patId

    let firstCh  = null
    let maxTick  = 0

    for (const track of tracks) {
      let ch
      if (track.drumType) {
        const cfg = _DRUM_IMPORT[track.drumType] ?? _DRUM_IMPORT.kick
        ch = makeChannel({ name: track.name, mode: 'piano', ...cfg })
      } else {
        const prog = Math.max(0, Math.min(127, track.gmProgram ?? 0))
        ch = makeChannel({
          name:     track.name,
          color:    gmChannelColor(prog),
          type:     'gm',
          mode:     'piano',
          sustains: gmSustains(prog),
          fn:       makeGMPlayFn(prog),
          params:   makeGMParams(prog),
          knobs:    gmKnobs(),
        })
      }

      channels.push(ch)
      if (!firstCh) firstCh = ch

      // Assign the notes array in one shot — single reactive trigger instead of N pushes.
      // Plain object copies; individual note properties don't need deep Vue tracking.
      const notes = track.notes.map(n => ({ ...n }))
      getPatData(ch.id, patId).pianoNotes = notes

      // Track the furthest tick so we can set a length override below
      if (notes.length > 0) {
        const last = notes[notes.length - 1]
        const end  = last.startTick + (last.durationTicks ?? TICKS_PER_STEP)
        if (end > maxTick) maxTick = end
      }
    }

    // Pin the pattern length so getPatternAutoLengthTicks never has to scan all notes.
    // Rounded up to the nearest bar (480 × 4 ticks).
    if (maxTick > 0) {
      const barTicks    = TICKS_PER_STEP * 16  // one 4/4 bar at 1/16 resolution = 1920 ticks
      const roundedTick = Math.ceil(maxTick / barTicks) * barTicks
      setPatternLengthOverride(patId, roundedTick)
    }

    if (audioCtx) rebuildGains()
    if (firstCh) selectedChannelId.value = firstCh.id

    // Kick off sample loading in the background so instruments are ready before play.
    if (audioCtx) {
      for (const track of tracks) {
        if (!track.drumType && track.gmProgram != null) {
          preloadGMInstrument(audioCtx, track.gmProgram)
        }
      }
    }

    return { channelCount: tracks.length }
  }

  function removePattern(id) {
    if (patterns.length <= 1) return
    const idx = patterns.findIndex(p => p.id === id)
    if (idx < 0) return
    patterns.splice(idx, 1)
    delete patternData[id]
    delete patternLengthOverrides[id]
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

  function movePatternUp(id) {
    const idx = patterns.findIndex(p => p.id === id)
    if (idx <= 0) return
    const [pat] = patterns.splice(idx, 1)
    patterns.splice(idx - 1, 0, pat)
  }

  function movePatternDown(id) {
    const idx = patterns.findIndex(p => p.id === id)
    if (idx < 0 || idx >= patterns.length - 1) return
    const [pat] = patterns.splice(idx, 1)
    patterns.splice(idx + 1, 0, pat)
  }

  function findNextEmptyPattern() {
    const cur = patterns.findIndex(p => p.id === currentPatternId.value)
    const start = cur >= 0 ? cur + 1 : 0
    for (let i = start; i < patterns.length; i++) {
      const pData = patternData[patterns[i].id] || {}
      const isEmpty = !Object.values(pData).some(cd =>
        (cd.steps || []).some(Boolean) || (cd.pianoNotes || []).length > 0
      )
      if (isEmpty) { currentPatternId.value = patterns[i].id; return patterns[i].id }
    }
    addPattern()
    return currentPatternId.value
  }

  // ── Playlist tracks & clips ────────────────────────────────────────────────────
  const playlistTracks = reactive([
    { id: 'pt1', name: 'Track 1', color: '#e74c3c', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: 52 },
    { id: 'pt2', name: 'Track 2', color: '#3498db', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: 52 },
  ])
  let _clipId = 0
  const playlistClips = reactive([])

  // Time markers on the ruler
  const timeMarkers = reactive([])   // { id, cell, label, color }
  let _markerId = 0

  const autoScroll     = ref(true)   // follow playhead in Playlist and PianoRoll during playback
  const usePlaylist    = ref(false)
  const playlistTool   = ref('draw')    // 'draw' | 'paint' | 'erase' | 'select'
  const cellWidth      = ref(80)        // px per cell (zoom)
  const trackHeight    = ref(52)        // px per track (vertical zoom)
  const clipFocusMode  = ref('pattern') // 'pattern' | 'automation'

  function addPlaylistTrack() {
    const idx   = playlistTracks.length + 1
    const color = COLORS[idx % COLORS.length]
    playlistTracks.push({ id: 'pt' + idx + Date.now(), name: 'Track ' + idx, color, muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: trackHeight.value })
  }

  function removePlaylistTrack(id) {
    const idx = playlistTracks.findIndex(t => t.id === id)
    if (idx < 0 || playlistTracks.length <= 1) return
    playlistTracks.splice(idx, 1)
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      const c = playlistClips[i]
      if (c.trackId === id) {
        if (c.type === 'audio') { audioClipBufs.delete(c.id); delete audioClipVersions[c.id] }
        playlistClips.splice(i, 1)
      }
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
    // The right fragment's slip offset must account for the cells it has been cut from:
    // it starts `leftWidth` cells into the pattern (shifted by leftWidth*totalSteps steps).
    const rightSlip = (clip.slipOffset ?? 0) + leftWidth * totalSteps.value
    playlistClips.push({
      id: 'c' + (++_clipId),
      trackId: clip.trackId,
      cell: atCell,
      patternId: clip.patternId,
      width: rightWidth,
      slipOffset: rightSlip,
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
    clip.width      = Math.max(1, Math.min(PLAYLIST_CELLS - clip.cell, newWidth))
    clip._userWidth = clip.width   // mark manual override so auto-stretch won't shrink below this
  }

  // Slip tool: shift the internal playback window by `deltaSteps` steps.
  // Positive = play later material first; clamped to the pattern's total step range.
  function setSlipOffset(clipId, deltaSteps) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    const patLen     = Math.ceil(getPatternLengthTicks(clip.patternId) / TICKS_PER_STEP)
    const maxSlip    = Math.max(0, patLen - (clip.width || 1) * totalSteps.value)
    clip.slipOffset  = Math.max(0, Math.min(maxSlip, Math.round(deltaSteps)))
  }

  function removeClip(clipId) {
    const idx = playlistClips.findIndex(c => c.id === clipId)
    if (idx < 0) return
    if (playlistClips[idx].type === 'audio') {
      audioClipBufs.delete(clipId)
      delete audioClipVersions[clipId]
    }
    playlistClips.splice(idx, 1)
  }

  // Track consolidation: collapse runs of adjacent/overlapping same-pattern clips
  // on a lane into single unified blocks (the in-box analog of an offline bounce).
  function consolidateTrack(trackId) {
    const lane = playlistClips.filter(c => c.trackId === trackId).sort((a, b) => a.cell - b.cell)
    if (lane.length < 2) return 0
    pushUndo()
    const merged = []
    for (const c of lane) {
      const last = merged[merged.length - 1]
      const w = c.width || 1
      if (last && last.patternId === c.patternId && c.cell <= last.cell + last.width) {
        last.width = Math.max(last.width, c.cell + w - last.cell)   // extend the block
      } else {
        merged.push({ patternId: c.patternId, cell: c.cell, width: w, muted: c.muted, slipOffset: c.slipOffset ?? 0 })
      }
    }
    for (let i = playlistClips.length - 1; i >= 0; i--) if (playlistClips[i].trackId === trackId) playlistClips.splice(i, 1)
    merged.forEach(m => playlistClips.push({ id: 'c' + (++_clipId), trackId, ...m }))
    markDirty()
    return lane.length - merged.length            // how many clips were absorbed
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

  function clonePlaylistTrack(id) {
    const srcIdx = playlistTracks.findIndex(t => t.id === id)
    if (srcIdx < 0) return
    const src   = playlistTracks[srcIdx]
    const newId = 'pt' + Date.now()
    playlistTracks.splice(srcIdx + 1, 0, { ...src, id: newId, name: src.name + ' (copy)', _soloed: false })
    playlistClips.filter(c => c.trackId === id)
      .forEach(c => playlistClips.push({ ...c, id: 'c' + (++_clipId), trackId: newId }))
    automationClips.filter(a => a.trackId === id)
      .forEach(a => automationClips.push({ ...a, id: 'a' + (++_autoId), trackId: newId, nodes: a.nodes.map(n => ({ ...n })) }))
  }

  function movePlaylistTrackUp(id) {
    const idx = playlistTracks.findIndex(t => t.id === id)
    if (idx <= 0) return
    const [t] = playlistTracks.splice(idx, 1)
    playlistTracks.splice(idx - 1, 0, t)
  }

  function movePlaylistTrackDown(id) {
    const idx = playlistTracks.findIndex(t => t.id === id)
    if (idx < 0 || idx >= playlistTracks.length - 1) return
    const [t] = playlistTracks.splice(idx, 1)
    playlistTracks.splice(idx + 1, 0, t)
  }

  function setTrackColor(id, color) {
    const t = playlistTracks.find(t => t.id === id)
    if (t) t.color = color
  }

  function autoNameTrack(id) {
    const firstClip = [...playlistClips].filter(c => c.trackId === id).sort((a, b) => a.cell - b.cell)[0]
    if (!firstClip) return
    const pat = patterns.find(p => p.id === firstClip.patternId)
    if (!pat) return
    const t = playlistTracks.find(t => t.id === id)
    if (t) { t.name = pat.name; t.color = pat.color }
  }

  // ── Insert / Delete time ──────────────────────────────────────────────────────
  function insertTime(fromCell, numCells) {
    playlistClips.forEach(c  => { if (c.cell >= fromCell) c.cell += numCells })
    automationClips.forEach(a => { if (a.cell >= fromCell) a.cell += numCells })
    timeMarkers.forEach(m   => { if (m.cell >= fromCell) m.cell += numCells })
  }

  function deleteTime(fromCell, toCell) {
    const span = toCell - fromCell
    for (let i = playlistClips.length - 1; i >= 0; i--) {
      const c = playlistClips[i], end = c.cell + (c.width || 1)
      if (c.cell >= fromCell && end <= toCell) { playlistClips.splice(i, 1) }
      else if (c.cell >= toCell)               { c.cell -= span }
    }
    for (let i = automationClips.length - 1; i >= 0; i--) {
      const a = automationClips[i], end = a.cell + (a.width || 1)
      if (a.cell >= fromCell && end <= toCell) { automationClips.splice(i, 1) }
      else if (a.cell >= toCell)               { a.cell -= span }
    }
    for (let i = timeMarkers.length - 1; i >= 0; i--) {
      const m = timeMarkers[i]
      if (m.cell >= fromCell && m.cell < toCell) { timeMarkers.splice(i, 1) }
      else if (m.cell >= toCell)                 { m.cell -= span }
    }
  }

  // ── Beat / Bar slice ──────────────────────────────────────────────────────────
  function beatSliceClip(clipId, mode = 'bar') {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip || (mode === 'bar' && (clip.width || 1) <= 1)) return
    const totalBars = clip.width || 1
    const startCell = clip.cell, startSlip = clip.slipOffset ?? 0
    const tid = clip.trackId, pid = clip.patternId, mt = clip.muted
    const count        = mode === 'bar' ? totalBars : totalBars * 4
    const barFrac      = mode === 'bar' ? 1 : 0.25
    const stepsPerSlice = mode === 'bar' ? totalSteps.value : Math.ceil(totalSteps.value / 4)
    removeClip(clipId)
    for (let i = 0; i < count; i++) {
      playlistClips.push({
        id: 'c' + (++_clipId), trackId: tid,
        cell: startCell + i * barFrac, patternId: pid,
        width: barFrac, slipOffset: startSlip + i * stepsPerSlice, muted: mt,
      })
    }
  }

  // ── Duplicate selected clips (Ctrl+B) ─────────────────────────────────────────
  function duplicateClips(clipIds) {
    const clips = playlistClips.filter(c => clipIds.has(c.id))
    if (!clips.length) return new Set()
    const minStart = Math.min(...clips.map(c => c.cell))
    const maxEnd   = Math.max(...clips.map(c => c.cell + (c.width || 1)))
    const offset   = maxEnd - minStart
    const newIds   = new Set()
    clips.forEach(c => {
      const newId = 'c' + (++_clipId)
      playlistClips.push({ ...c, id: newId, cell: c.cell + offset })
      if (c.type === 'audio') {
        const buf = audioClipBufs.get(c.id)
        if (buf) { audioClipBufs.set(newId, buf); audioClipVersions[newId] = 1 }
      }
      newIds.add(newId)
    })
    return newIds
  }

  // ── FL Studio Arrangements (multiple Playlist layouts) ─────────────────────────
  const playlists = reactive([{ id: 'pl1', name: 'Arrangement 1' }])
  const currentPlaylistId = ref('pl1')
  const _playlistSnapshots = reactive({})

  function _saveCurrentPlaylistSnapshot() {
    _playlistSnapshots[currentPlaylistId.value] = {
      tracks:    playlistTracks.map(t => ({ ...t })),
      clips:     playlistClips.map(c => ({ ...c })),
      markers:   timeMarkers.map(m => ({ ...m })),
      autoClips: automationClips.map(a => ({ ...a, nodes: a.nodes.map(n => ({ ...n })) })),
    }
  }

  function _loadPlaylistSnapshot(id) {
    const data = _playlistSnapshots[id]
    if (!data) return
    playlistTracks.splice(0, playlistTracks.length, ...data.tracks.map(t => ({ ...t, _soloed: false })))
    playlistClips.splice(0, playlistClips.length, ...data.clips.map(c => ({ ...c })))
    timeMarkers.splice(0, timeMarkers.length, ...data.markers.map(m => ({ ...m })))
    automationClips.splice(0, automationClips.length, ...data.autoClips.map(a => ({ ...a, nodes: a.nodes.map(n => ({ ...n })) })))
  }

  function switchPlaylist(id) {
    if (id === currentPlaylistId.value) return
    _saveCurrentPlaylistSnapshot()
    currentPlaylistId.value = id
    if (!_playlistSnapshots[id]) {
      _playlistSnapshots[id] = {
        tracks: [
          { id: 'pt1', name: 'Track 1', color: '#e74c3c', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
          { id: 'pt2', name: 'Track 2', color: '#3498db', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null },
        ],
        clips: [], markers: [], autoClips: [],
      }
    }
    _loadPlaylistSnapshot(id)
  }

  function clonePlaylist(name) {
    _saveCurrentPlaylistSnapshot()
    const newId = 'pl' + Date.now()
    playlists.push({ id: newId, name: name || 'Arrangement ' + (playlists.length + 1) })
    _playlistSnapshots[newId] = {
      tracks:    playlistTracks.map(t => ({ ...t })),
      clips:     playlistClips.map(c => ({ ...c })),
      markers:   timeMarkers.map(m => ({ ...m })),
      autoClips: automationClips.map(a => ({ ...a, nodes: a.nodes.map(n => ({ ...n })) })),
    }
    currentPlaylistId.value = newId
  }

  function addPlaylist() {
    const newId = 'pl' + Date.now()
    playlists.push({ id: newId, name: 'Arrangement ' + (playlists.length + 1) })
    _saveCurrentPlaylistSnapshot()
    _playlistSnapshots[newId] = {
      tracks: [
        { id: 'pt1', name: 'Track 1', color: '#e74c3c', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: 52 },
        { id: 'pt2', name: 'Track 2', color: '#3498db', muted: false, _soloed: false, locked: false, collapsed: false, groupParentId: null, height: 52 },
      ],
      clips: [], markers: [], autoClips: [],
    }
    currentPlaylistId.value = newId
    _loadPlaylistSnapshot(newId)
  }

  function renamePlaylist(id, name) {
    const pl = playlists.find(p => p.id === id)
    if (pl && name.trim()) pl.name = name.trim()
  }

  function deletePlaylist(id) {
    if (playlists.length <= 1) return
    _saveCurrentPlaylistSnapshot()
    const idx = playlists.findIndex(p => p.id === id)
    if (idx < 0) return
    playlists.splice(idx, 1)
    delete _playlistSnapshots[id]
    if (currentPlaylistId.value === id) {
      const newId = playlists[Math.max(0, idx - 1)].id
      currentPlaylistId.value = newId
      _loadPlaylistSnapshot(newId)
    }
  }

  function mergePlaylist(sourceId, position = 'end', mode = 'merge') {
    _saveCurrentPlaylistSnapshot()
    const src  = _playlistSnapshots[sourceId]
    const dest = _playlistSnapshots[currentPlaylistId.value]
    if (!src || !dest) return
    let offset = 0
    if (position === 'end' && dest.clips.length)
      offset = Math.max(...dest.clips.map(c => c.cell + (c.width || 1)))
    const srcClips = src.clips.map(c => ({ ...c, id: 'c' + (++_clipId), cell: c.cell + offset }))
    if (mode === 'replace') {
      dest.clips = srcClips
    } else if (mode === 'insert') {
      const srcLen = src.clips.length ? Math.max(...src.clips.map(c => c.cell + (c.width || 1))) : 0
      dest.clips   = dest.clips.map(c => ({ ...c, cell: c.cell + srcLen })).concat(srcClips)
    } else {
      dest.clips = dest.clips.concat(srcClips)
    }
    _loadPlaylistSnapshot(currentPlaylistId.value)
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

  // ── Transpose all notes in a pattern by semitones ─────────────────────────────
  function transposePatternNotes(patId, semitones) {
    const pd = patternData[patId]
    if (!pd) return
    Object.values(pd).forEach(d => {
      if (!d?.pianoNotes) return
      d.pianoNotes.forEach(n => { n.pitch = Math.max(0, Math.min(127, (n.pitch ?? 60) + semitones)) })
    })
  }

  // ── Swap which pattern a playlist clip references ─────────────────────────────
  function selectSourcePattern(clipId, patternId) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    clip.patternId = patternId
    delete clip._label
    delete clip._color
  }

  // ── Mute / Unmute all clips on a playlist track ───────────────────────────────
  function muteAllClipsOnTrack(trackId, muted) {
    playlistClips.filter(c => c.trackId === trackId).forEach(c => { c.muted = muted })
  }

  // ── UI state ─────────────────────────────────────────────────────────────────
  const selectedChannelId  = ref(channels[0].id)
  const selectedChannel    = computed(() => channels.find(c => c.id === selectedChannelId.value) ?? channels[0])
  const mainView           = ref('sequencer')
  const pianoRollOpen      = ref(false)
  const renderModalOpen    = ref(false)
  const themeModalOpen     = ref(false)
  const midiRouterOpen     = ref(false)
  const currentTheme       = ref(localStorage.getItem('fls-theme') ?? 'white')
  applyTheme(currentTheme.value)
  const kbOctave           = ref(4)
  const gridSnap           = ref('1/4')
  const keyboardInputMode  = ref(false)

  // ── Snap-to-grid / quantization engine (PPQ time base) ────────────────────────
  //   All canvas mouse vectors quantize to internal Ticks. The tick duration and
  //   grid-cell size derive from tempo + PPQ. Alt holds → freeform (1-tick) mode.
  const ppq         = ref(96)        // pulses per quarter note (96–960)
  const altFreeform = ref(false)     // Alt held during a drag → bypass snapping
  function tickDurationSec() { return 60 / (bpm.value * ppq.value) }

  // τ (TicksPerGridCell) for a snap mode. gridSnap is bar-relative — a Playlist
  // "cell" = 1 bar = 4 beats = ppq·4 ticks.
  function ticksPerGridCell(mode = gridSnap.value, ppqv = ppq.value) {
    const bar = ppqv * 4
    switch (mode) {
      case 'bar':  case 'cell': return bar
      case '1/2':  return bar / 2
      case '1/3':  return bar / 3        // triplet
      case '1/4':  case 'line': return bar / 4   // beat (line defaults here)
      case '1/6':  return bar / 6
      case '1/8':  return bar / 8
      case '1/16': return bar / 16
      case '1/32': return bar / 32
      case 'none': return 1
      default:     return bar
    }
  }

  // Magnet collision clamp: round to nearest grid line (Line/divisions) or floor
  // to the cell start (Cell). Alt/None → freeform at single-tick resolution.
  function snapTicks(rawTicks, mode = gridSnap.value, tauOverride) {
    if (altFreeform.value || mode === 'none') return Math.max(0, Math.round(rawTicks))
    const tau = tauOverride ?? ticksPerGridCell(mode)
    const fn = mode === 'cell' ? Math.floor : Math.round
    return Math.max(0, fn(rawTicks / tau) * tau)
  }

  // Convenience for bar-unit consumers (Playlist). `lineTau` lets the view pass a
  // zoom-adaptive τ for Line mode (Level-of-Detail grid).
  function snapBars(rawBars, mode = gridSnap.value, lineTau) {
    const bar = ppq.value * 4
    return snapTicks(rawBars * bar, mode, mode === 'line' ? lineTau : undefined) / bar
  }

  // Continuously track the Alt modifier so any active drag can go freeform.
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', e => { if (e.altKey) altFreeform.value = true })
    window.addEventListener('keyup',   e => { if (e.key === 'Alt' || !e.altKey) altFreeform.value = false })
    window.addEventListener('blur',    () => { altFreeform.value = false })
  }

  // ── Title bar state ───────────────────────────────────────────────────────────
  //   isDirty flips on any project mutation (asterisk in the title); cleared on
  //   save / load. extendedHudOpen toggles the detachable Extended Hint Panel.
  const projectName     = ref('Untitled')
  const projectDirty    = ref(false)
  const extendedHudOpen = ref(false)
  function markDirty() { projectDirty.value = true }

  // ── Window manager (MDI-style orchestration) ──────────────────────────────────
  //   The toolbar's shortcut panel is the master orchestrator. Each window has a
  //   tri-state lifecycle (hidden → obscured → focused) and may be "detached"
  //   into a free-floating window. mainView remains the docked main pane.
  // Browser is shown by default on first visit; the user's choice is remembered.
  const browserOpen       = ref((() => {
    try { const v = localStorage.getItem('fl.browser.open'); return v === null ? true : v === '1' }
    catch { return true }
  })())
  watch(browserOpen, v => { try { localStorage.setItem('fl.browser.open', v ? '1' : '0') } catch (_) {} })

  // ── Playlist clip auto-stretch (Unified Pattern Architecture) ─────────────────
  // When piano notes push the effective pattern length beyond the current clip
  // width, expand the clip automatically.  Never shrinks below the user's last
  // manual resize (tracked via clip._userWidth) — users can still force-truncate.
  watch(
    [patternData, patternLengthOverrides],
    () => {
      playlistClips.forEach(clip => {
        const autoLen  = getPatternLengthTicks(clip.patternId)
        const autoWidth = Math.max(1, Math.ceil(autoLen / (totalSteps.value * TICKS_PER_STEP)))
        // Only grow: if the user manually set a smaller width, respect it unless the
        // pattern has grown past it.
        const minWidth = clip._userWidth ?? 0
        const newWidth = Math.max(minWidth, autoWidth)
        if (clip.width !== newWidth) clip.width = newWidth
      })
    },
    { deep: true },
  )
  const activeArrangement = ref('default')
  const detachedWindows   = reactive({})   // id → { x, y, w, h, z }
  let   _winZ        = 200
  let   _prevMainView = 'sequencer'
  const WINDOW_VIEW  = { rack: 'sequencer', playlist: 'playlist', mixer: 'mixer' }

  // Resolve a window's current lifecycle state for the shortcut LED.
  function windowState(id) {
    if (detachedWindows[id]) return 'detached'
    if (id === 'piano')   return !pianoRollOpen.value ? 'hidden' : (mainView.value === 'sequencer' ? 'focused' : 'obscured')
    if (id === 'browser') return browserOpen.value ? 'focused' : 'hidden'
    if (id in WINDOW_VIEW) return mainView.value === WINDOW_VIEW[id] ? 'focused' : 'hidden'
    return 'hidden'
  }

  // Tri-state click: hidden → show+focus, obscured → bring-to-front, focused → hide.
  function activateWindow(id) {
    if (detachedWindows[id]) { detachedWindows[id].z = ++_winZ; return }   // detached → focus
    if (id === 'piano') {
      if (!pianoRollOpen.value)            { mainView.value = 'sequencer'; pianoRollOpen.value = true }
      else if (mainView.value !== 'sequencer') mainView.value = 'sequencer'   // obscured → reveal
      else                                  pianoRollOpen.value = false       // focused → hide
      return
    }
    if (id === 'browser') { browserOpen.value = !browserOpen.value; return }
    if (id in WINDOW_VIEW) {
      const target = WINDOW_VIEW[id]
      if (mainView.value === target) {                                        // focused → restore prior
        mainView.value = _prevMainView !== target ? _prevMainView : 'sequencer'
      } else {                                                               // hidden → show+focus
        _prevMainView = mainView.value
        mainView.value = target
      }
    }
  }

  function detachWindow(id) {
    if (detachedWindows[id]) return
    const n = Object.keys(detachedWindows).length
    detachedWindows[id] = { x: 140 + n * 28, y: 96 + n * 28, w: 720, h: 380, z: ++_winZ }
    if (id === 'piano')   pianoRollOpen.value = true
    if (id === 'browser') browserOpen.value   = true
  }
  function redockWindow(id) { delete detachedWindows[id] }
  function toggleDetach(id) { detachedWindows[id] ? redockWindow(id) : detachWindow(id) }
  function focusWindow(id)  { if (detachedWindows[id]) detachedWindows[id].z = ++_winZ }

  // Layout hydration presets — reshape several windows in one shot.
  function applyArrangement(name) {
    activeArrangement.value = name
    if (name === 'default')      { mainView.value = 'sequencer'; pianoRollOpen.value = false; browserOpen.value = false }
    else if (name === 'clean')   { mainView.value = 'playlist';  pianoRollOpen.value = false; browserOpen.value = false }
    else if (name === 'browser-mixer') { mainView.value = 'mixer'; browserOpen.value = true }
  }

  // ── Mixer tracks (0 = master, 1-8 = inserts) ─────────────────────────────
  const mixerTracks = reactive([
    { id: 'mx0', name: 'MASTER', kind: 'master', color: '#e74c3c', volume: 1.0, pan: 0, muted: false, _soloed: false, eq: { low: 0, mid: 0, high: 0 }, fxSlots: [], phaseInvert: false, sends: {}, sidechain: { source: null, amount: 0, attack: 0.01, release: 0.18 } },
    ...Array.from({ length: NUM_MX_INSERTS }, (_, i) => ({
      id: 'mx' + (i + 1),
      name: 'MIX ' + (i + 1),
      kind: 'insert',
      color: COLORS[i % COLORS.length],
      volume: 1.0, pan: 0, muted: false, _soloed: false,
      eq: { low: 0, mid: 0, high: 0 },
      fxSlots: [],
      phaseInvert: false,
      sends: {},                       // returnTrackId → amount (0..1)
      sidechain: { source: null, amount: 0, attack: 0.01, release: 0.18 },
    })),
    // ── Return buses (receive sends, output to master) ──
    ...Array.from({ length: NUM_MX_RETURNS }, (_, i) => ({
      id: 'rtn' + (i + 1),
      name: 'RETURN ' + String.fromCharCode(65 + i),   // A, B, …
      kind: 'return',
      color: i === 0 ? '#1abc9c' : '#9b59b6',
      volume: 1.0, pan: 0, muted: false, _soloed: false,
      eq: { low: 0, mid: 0, high: 0 },
      fxSlots: [ makeEffect('reverb') ],   // a default send-effect so returns are useful out of the box
      phaseInvert: false,
      sends: {},
      sidechain: { source: null, amount: 0, attack: 0.01, release: 0.18 },
    })),
  ])
  const returnTrackIdxStart = 1 + NUM_MX_INSERTS   // first return's index in mixerTracks

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
  // Each mode preserves its own playhead so switching PAT ↔ SONG never clobbers
  // the position you were at in the other mode.
  const _savedPatCell  = ref(0)
  const _savedSongCell = ref(0)
  watch(usePlaylist, (nowSong) => {
    // Snapshot the outgoing mode's position before stopPlay() can clear it
    if (nowSong) _savedPatCell.value  = displayCell.value
    else         _savedSongCell.value = displayCell.value
    // Mode switch always stops playback
    stopPlay()
    // Restore the incoming mode's last-known playhead position
    if (nowSong) {
      displayCell.value       = _savedSongCell.value
      playbackStartCell.value = _savedSongCell.value
    } else {
      displayCell.value       = _savedPatCell.value
      playbackStartCell.value = _savedPatCell.value
    }
  })

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

  // Loop Record — when OFF the playhead runs indefinitely past the pattern end,
  // capturing a continuous take; when ON it overdubs inside the fixed loop window.
  const loopRecord = ref(true)

  // Count-in: N bars of metronome clicks before recording actually starts.
  const recordCountIn     = ref(false)
  const recordCountInBars = ref(2)    // 1 | 2 | 4
  const countInBarsLeft   = ref(0)    // reactive countdown display (0 = not counting)

  // Recording behaviour flags
  const disarmOnStop         = ref(false)  // unarm record when Stop is pressed
  const recordStartsPlayback = ref(true)   // arming record also starts playback
  const rememberSeekTime     = ref(false)  // Stop keeps playhead at current position
  const halfSpeed            = ref(false)  // play at half BPM for easier recording
  const recordBlend          = ref(true)   // true = overdub; false = overwrite existing notes

  // Non-reactive map: keys currently held during a live recording session.
  // key-code → { pitch, audioStartTime }
  const liveRecordNotes = new Map()

  // Score logger — a circular buffer that silently captures every MIDI key event
  // regardless of arm state (≤ 30 min of history).
  // Each entry: { pitch, t0, t1 }  where t0/t1 are performance.now()/1000.
  const scoreLogBuffer  = []
  const SCORE_LOG_MAX_S = 30 * 60   // 30 minutes

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
    if (recordStartsPlayback.value && !isPlaying.value) startPlay()
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
          stepModX:  [...(d.stepModX  || Array(32).fill(0.5))],
          stepModY:  [...(d.stepModY  || Array(32).fill(0.5))],
          stepShift: [...(d.stepShift || Array(32).fill(0))],
          stepRep:   [...(d.stepRep   || Array(32).fill(0))],
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
        if (s.stepModX)       s.stepModX.forEach((v, i) => { d.stepModX[i] = v })
        if (s.stepModY)       s.stepModY.forEach((v, i) => { d.stepModY[i] = v })
        if (s.stepShift)      s.stepShift.forEach((v, i) => { d.stepShift[i] = v })
        if (s.stepRep)        s.stepRep.forEach((v, i) => { d.stepRep[i] = v })
      })
    })
  }

  function pushUndo() {
    undoStack.push(snapshotState())
    if (undoStack.length > MAX_UNDO) undoStack.shift()
    redoStack.length = 0
    projectDirty.value = true   // any undoable edit dirties the project
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
  let outputGain      = null   // terminal Main Volume stage (global output trim)
  let masterLimiter   = null   // brickwall limiter before output (anti-clip)
  let scopeAnalyserL  = null   // dedicated per-channel scope taps (stereo visualizer)
  let scopeAnalyserR  = null
  let trackGains      = []

  // ── Main Volume & Master Pitch (terminal scaling operators) ───────────────────
  //   Volume value is normalized [0,1] with 0 dB unity hard-wired at 0.8; the
  //   top 20% gives extra headroom. Pitch is bipolar [-1,1] scaled by a
  //   configurable semitone range, applied as a global cents offset to pitched
  //   generators just before they're scheduled.
  const masterVolume     = ref(0.8)   // 0.8 = unity (0 dB)
  const masterPitch      = ref(0)     // [-1, 1], 0 = neutral
  const masterPitchRange = ref(2)     // semitones, 1–48
  const masterPitchSemis = computed(() => masterPitch.value * masterPitchRange.value)

  // Perceptual mapping: linear amplitude = (v / 0.8) so that 0.8→1.0 (0 dB),
  // 1.0→1.25 (+1.9 dB). dB = 20·log10(amplitude).
  function volToGain(v) { return Math.max(0, v / 0.8) }
  function setMasterVolume(v) {
    masterVolume.value = Math.max(0, Math.min(1, v))
    if (outputGain) outputGain.gain.value = volToGain(masterVolume.value)
  }
  function setMasterPitch(v)      { masterPitch.value = Math.max(-1, Math.min(1, v)) }
  function setMasterPitchRange(r) { masterPitchRange.value = Math.max(1, Math.min(48, Math.round(r))) }

  // ── Browser sample preview (mixer-bypass path) ────────────────────────────────
  //   Previews route into a dedicated gain straight to the output, bypassing the
  //   channel/mixer graph. Clicking a new asset aborts the in-flight stream.
  const browserWidth = ref(220)
  const previewingId = ref(null)
  let previewGain = null, previewSrc = null
  function _ensurePreview() {
    initAudio()
    if (!previewGain) { previewGain = audioCtx.createGain(); previewGain.gain.value = 0.7; previewGain.connect(audioCtx.destination) }
  }
  function stopPreview() {
    if (previewSrc) { try { previewSrc.stop() } catch (_) {} ; try { previewSrc.disconnect() } catch (_) {} ; previewSrc = null }
    previewingId.value = null
  }

  // Render a sample spec into a cached AudioBuffer (DSP lives in browserLibrary).
  const _assetBufCache = new Map()
  function _renderSpec(spec, key) {
    if (_assetBufCache.has(key)) return _assetBufCache.get(key)
    const sr = audioCtx.sampleRate
    const buf = audioCtx.createBuffer(1, Math.ceil(sr * sampleDuration(spec)), sr)
    fillSample(buf.getChannelData(0), sr, spec)
    _assetBufCache.set(key, buf)
    return buf
  }

  function previewAsset(asset) {
    _ensurePreview()
    stopPreview()                                   // abort any in-flight preview
    const src = audioCtx.createBufferSource()
    src.buffer = _renderSpec(asset.spec, asset.id)
    src.connect(previewGain)
    src.onended = () => { if (previewSrc === src) { previewSrc = null; previewingId.value = null } }
    src.start()
    previewSrc = src
    previewingId.value = asset.id
  }

  // Play function for a dropped-sample channel: schedules the rendered buffer.
  function makeSampleFn(spec) {
    const key = 'spec:' + JSON.stringify(spec)
    return (ctx, when, params, dest) => {
      const src = ctx.createBufferSource()
      src.buffer = _renderSpec(spec, key)
      if (params.pitch != null) src.playbackRate.value = Math.pow(2, (params.pitch - 60) / 12)
      const g = ctx.createGain(); g.gain.value = params.velocity ?? 0.8
      src.connect(g); g.connect(dest)
      src.start(when)
    }
  }

  // Play function for an audio-file sampler channel — full professional signal chain.
  function makeAudioFileFn(channelId) {
    return (ctx, when, params, dest) => {
      // ── Multisample zone selection ───────────────────────────────────────
      //   When the channel has mapped zones, pick the zone(s) whose key + velocity
      //   ranges contain this note, then round-robin between equal matches.
      const zoneSel = _selectSamplerZone(channelId, params)

      // Warp-aware forward buffer: when warp is on, this is a tempo-stretched
      // copy (pitch from the note still applies on top via playbackRate).
      const fwdBuf = zoneSel?.buf ?? getWarpedSampleBuf(channelId, params) ?? audioFileBufs.get(channelId)
      if (!fwdBuf) return

      // ── Slicer: the played note selects a slice region ──────────────────────
      const sliceMarkers = (!zoneSel && params.sliceMode) ? (params.sliceMarkers ?? []) : null
      let sliceRegion = null
      if (sliceMarkers && sliceMarkers.length >= 2) {
        const sorted = [...sliceMarkers].sort((a, b) => a.pos - b.pos)
        const sIdx = ((Math.round(params.pitch ?? 60) - (params.rootNote ?? 60)) % sorted.length + sorted.length) % sorted.length
        const s0 = Math.max(0, Math.min(1, sorted[sIdx].pos))
        const s1 = sIdx + 1 < sorted.length ? sorted[sIdx + 1].pos : 1
        sliceRegion = { start: s0, end: Math.max(s0 + 0.001, Math.min(1, s1)) }
      }

      // Zones + slices always play one-shot forward (the note picks which one).
      const loopMode = (zoneSel || sliceRegion) ? 'off'  : (params.loopMode ?? 'off')
      const reverse  = (zoneSel || sliceRegion) ? false  : (params.reverse  ?? false)

      // ── Buffer selection ─────────────────────────────────────────────────
      let buf
      if (loopMode === 'pingpong') {
        buf = pingpongAudioFileBufs.get(channelId) ?? fwdBuf
      } else if (loopMode === 'fwd' && xfadeLoopBufs.has(channelId)) {
        buf = xfadeLoopBufs.get(channelId)        // seamless crossfaded loop
      } else if (reverse) {
        buf = reversedAudioFileBufs.get(channelId) ?? fwdBuf
      } else {
        buf = fwdBuf
      }

      // ── Pitch / tuning ───────────────────────────────────────────────────
      //   Slices play untransposed (the note selects the slice, not the pitch).
      const rootNote  = zoneSel ? (zoneSel.zone.rootNote ?? 60) : (params.rootNote ?? 60)
      const keyTrack  = sliceRegion ? 0 : (params.keyTrack ?? 1)
      const fineTune  = params.fineTune ?? 0
      const deltaSemi = (params.pitch - rootNote) * keyTrack + fineTune / 100

      // ── Start / end offsets (zones use the whole buffer; slices their region) ─
      const fwdStart = sliceRegion ? sliceRegion.start
                     : zoneSel ? 0 : Math.max(0, Math.min(1, params.startOffset ?? 0))
      const fwdEnd   = sliceRegion ? sliceRegion.end
                     : zoneSel ? 1 : Math.max(fwdStart + 0.001, Math.min(1, params.endOffset ?? 1))

      let offset, playDur
      if (loopMode === 'pingpong') {
        offset  = (buf.duration / 2) * fwdStart
        playDur = undefined
      } else if (reverse) {
        offset  = buf.duration * (1 - fwdEnd)
        playDur = buf.duration * (fwdEnd - fwdStart)
      } else {
        offset  = buf.duration * fwdStart
        playDur = buf.duration * (fwdEnd - fwdStart)
      }

      // ── Velocity sensitivity ─────────────────────────────────────────────
      const velSens = params.velSens  ?? 1
      const vel     = params.velocity ?? 0.8
      const peak    = Math.max(0, 1 - velSens + velSens * vel)

      // ── Granular engine ──────────────────────────────────────────────────
      //   A cloud of short overlapping grains scanned from a position in the
      //   sample — pitch (from the note) and time are independent, giving
      //   pad / texture playback. Self-contained: its own amp envelope; filter
      //   and LFO are bypassed for this mode.
      const playMode = (zoneSel || sliceRegion) ? 'classic' : (params.playMode ?? 'classic')
      if (playMode === 'granular') {
        const dG   = Math.max(0, params.envDelay ?? 0)
        const aG   = Math.max(0.001, params.envAttack  ?? 0.005)
        const cG   = Math.max(0.001, params.envDecay   ?? 0.1)
        const sG   = Math.max(0,     params.envSustain ?? 0.8)
        const rG   = Math.max(0.02,  params.envRelease ?? 0.2)
        const rate = Math.pow(2, deltaSemi / 12)
        const gSize    = Math.max(0.01, Math.min(0.5, params.grainSize ?? 0.08))
        const scan     = Math.max(0, Math.min(1, params.grainScan ?? 0.5))
        const density  = Math.max(0.1, Math.min(1, params.grainDensity ?? 0.5))   // overlap
        const spray    = Math.max(0, Math.min(1, params.grainSpray ?? 0.15))      // position jitter
        const panSpread = Math.max(0, Math.min(1, params.grainPan ?? 0))          // stereo spread
        const motion   = (params.grainMotion ?? 0)                               // scan drift over life
        const shape    = params.grainShape ?? 'hann'
        const regStart = buf.duration * fwdStart
        const regLen   = buf.duration * (fwdEnd - fwdStart)
        const hold     = Math.max(0.3, aG + cG + 0.4)
        const lifeT    = dG + aG + cG + hold + rG
        const t0g      = when + dG

        const ampG = ctx.createGain()
        ampG.gain.setValueAtTime(0, when)
        _applyEnvPhase(ampG.gain, 0,      peak,      t0g,             aG, params.envAttackCurve  ?? 0)
        _applyEnvPhase(ampG.gain, peak,   peak * sG, t0g + aG,        cG, params.envDecayCurve   ?? -0.5)
        _applyEnvPhase(ampG.gain, peak*sG, 0,        t0g + aG + cG + hold, rG, params.envReleaseCurve ?? -0.5)
        ampG.connect(dest)

        // Denser overlap = smaller hop (more simultaneous grains → smoother cloud).
        const hop = Math.max(0.004, (gSize / 2) * (1.05 - density))
        let lastSrc = null
        for (let t = 0; t < lifeT; t += hop) {
          const gsrc = ctx.createBufferSource(); gsrc.buffer = buf; gsrc.playbackRate.value = rate
          const gg = ctx.createGain()
          const gt = t0g + t, half = gSize / 2
          // Grain window: Hann (smooth) vs triangular (sharper) vs gate (buzzy).
          if (shape === 'gate') {
            gg.gain.setValueAtTime(1, gt)
          } else if (shape === 'tri') {
            gg.gain.setValueAtTime(0, gt)
            gg.gain.linearRampToValueAtTime(1, gt + half)
            gg.gain.linearRampToValueAtTime(0, gt + gSize)
          } else {
            gg.gain.setValueAtTime(0, gt)
            gg.gain.setTargetAtTime(1, gt, half * 0.4)
            gg.gain.setValueAtTime(1, gt + half)
            gg.gain.setTargetAtTime(0, gt + half, half * 0.4)
            gg.gain.linearRampToValueAtTime(0, gt + gSize)
          }
          // Optional stereo spread: alternate grains left/right.
          if (panSpread > 0.001) {
            const pn = ctx.createStereoPanner()
            pn.pan.value = (Math.random() * 2 - 1) * panSpread
            gsrc.connect(gg); gg.connect(pn); pn.connect(ampG)
          } else {
            gsrc.connect(gg); gg.connect(ampG)
          }
          // Scan position drifts across the grain's lifetime when motion ≠ 0.
          const driftedScan = Math.max(0, Math.min(1, scan + motion * (t / Math.max(0.001, lifeT))))
          const center = regStart + regLen * driftedScan
          const jitter = (Math.random() * 2 - 1) * (regLen * 0.5 * spray)
          let off = center + jitter
          off = Math.max(0, Math.min(buf.duration - gSize * rate - 0.001, off))
          gsrc.start(gt, off, gSize * rate)
          lastSrc = gsrc
        }
        return { src: lastSrc, ampGain: ampG }
      }

      // ── Volume ADSR with curve topology (Lesson 6) ───────────────────────
      const delay  = Math.max(0, params.envDelay   ?? 0)
      const atk    = Math.max(0.001, params.envAttack  ?? 0.005)
      const dec    = Math.max(0.001, params.envDecay   ?? 0.1)
      const sus    = Math.max(0,     params.envSustain ?? 0.8)
      const rel    = Math.max(0.001, params.envRelease ?? 0.2)
      const atkC   = params.envAttackCurve  ?? 0      // -1=exp  0=linear  +1=log
      const decC   = params.envDecayCurve   ?? -0.5   // default: slightly exponential
      const relC   = params.envReleaseCurve ?? -0.5
      const isLooping = loopMode !== 'off'

      const t0 = when + delay           // attack start
      const t1 = t0 + atk              // decay start
      const t2 = t1 + dec              // sustain start

      const ampGain = ctx.createGain()
      ampGain.gain.setValueAtTime(0, when)
      _applyEnvPhase(ampGain.gain, 0,         peak,      t0, atk, atkC)
      _applyEnvPhase(ampGain.gain, peak,       peak*sus,  t1, dec, decC)
      if (!isLooping && playDur != null) {
        const playEnd  = t0 + playDur
        const relStart = Math.max(t2, playEnd - rel)
        const relDur   = Math.max(0.002, playEnd - relStart)
        _applyEnvPhase(ampGain.gain, peak*sus, 0, relStart, relDur, relC)
      }

      // ── Filter + filter envelope ─────────────────────────────────────────
      const filterType = params.filterType ?? 'off'
      let filterNode = null
      if (filterType !== 'off') {
        filterNode = ctx.createBiquadFilter()
        filterNode.type = filterType
        const cutNorm    = Math.max(0, Math.min(1, params.filterCutoff ?? 1.0))
        const baseCutoff = 20 * Math.pow(2, Math.log2(20000 / 20) * cutNorm)
        const nyq        = ctx.sampleRate / 2 - 1
        filterNode.frequency.value = Math.min(baseCutoff, nyq)
        filterNode.Q.value = Math.max(0.001, (params.filterReso ?? 0) * 20 + 0.001)

        const fAmt = params.fEnvAmount ?? 0
        if (Math.abs(fAmt) > 0.001) {
          const fAtk = Math.max(0.001, params.fEnvAttack  ?? 0.01)
          const fDec = Math.max(0.001, params.fEnvDecay   ?? 0.2)
          const fSus = Math.max(0,     params.fEnvSustain ?? 0)
          const octRange = fAmt * 4
          const peakFreq = baseCutoff * Math.pow(2, octRange)
          const susFreq  = baseCutoff * Math.pow(2, octRange * fSus)
          const clampF   = f => Math.max(20, Math.min(nyq, f))
          filterNode.frequency.setValueAtTime(baseCutoff, t0)
          filterNode.frequency.linearRampToValueAtTime(clampF(peakFreq), t0 + fAtk)
          filterNode.frequency.linearRampToValueAtTime(clampF(susFreq),  t0 + fAtk + fDec)
        }
      }

      // ── Source node ──────────────────────────────────────────────────────
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = Math.pow(2, deltaSemi / 12)

      if (loopMode === 'fwd') {
        src.loop = true
        const lsF = Math.max(0, Math.min(1, params.loopStart ?? fwdStart))
        const leF = Math.max(0, Math.min(1, params.loopEnd   ?? fwdEnd))
        src.loopStart = buf.duration * lsF
        src.loopEnd   = buf.duration * Math.max(lsF + 0.001, leF)
      } else if (loopMode === 'pingpong') {
        src.loop = true
        src.loopStart = 0
        src.loopEnd   = buf.duration
      }

      // ── Pitch envelope (detune in cents → 0) ─────────────────────────────
      const pAmt = params.pEnvAmount ?? 0     // semitones at the peak
      if (Math.abs(pAmt) > 0.001) {
        const pAtk = Math.max(0.001, params.pEnvAttack ?? 0.002)
        const pDec = Math.max(0.001, params.pEnvDecay  ?? 0.15)
        const cents = pAmt * 100
        src.detune.setValueAtTime(0, when)
        src.detune.linearRampToValueAtTime(cents, t0 + pAtk)
        src.detune.linearRampToValueAtTime(0,     t0 + pAtk + pDec)
      }

      // ── Two assignable LFOs: pitch | filter | volume | pan ───────────────
      let panner = null
      const lfos = []
      const attachLfo = (lDest, lRate, lDepth, lShape) => {
        if (lDest === 'off' || !(lDepth > 0.0001)) return
        const osc = ctx.createOscillator()
        osc.type = lShape || 'sine'
        osc.frequency.value = 0.05 + (lRate ?? 0.3) * 14            // ~0.05–14 Hz
        const g = ctx.createGain()
        osc.connect(g)
        if (lDest === 'pitch')                       { g.gain.value = lDepth * 1200; g.connect(src.detune) }
        else if (lDest === 'filter' && filterNode)   { g.gain.value = lDepth * 4000; g.connect(filterNode.frequency) }
        else if (lDest === 'volume')                 { g.gain.value = lDepth * 0.5;  g.connect(ampGain.gain) }
        else if (lDest === 'pan') { if (!panner) panner = ctx.createStereoPanner(); g.gain.value = Math.min(1, lDepth); g.connect(panner.pan) }
        else return
        osc.start(when)
        lfos.push(osc)
      }
      attachLfo(params.lfoDest  ?? 'off', params.lfoRate,  params.lfoDepth  ?? 0, params.lfoShape)
      attachLfo(params.lfo2Dest ?? 'off', params.lfo2Rate, params.lfo2Depth ?? 0, params.lfo2Shape)

      // ── Connect: src → [filter →] ampGain → [panner →] dest ──────────────
      if (filterNode) {
        src.connect(filterNode); filterNode.connect(ampGain)
      } else {
        src.connect(ampGain)
      }
      if (panner) { ampGain.connect(panner); panner.connect(dest) }
      else        { ampGain.connect(dest) }

      // Stop the LFOs when a one-shot voice ends so they can be GC'd.
      if (lfos.length) src.onended = () => { lfos.forEach(o => { try { o.stop() } catch (_) {} }) }

      isLooping ? src.start(when, offset) : src.start(when, offset, playDur)

      // Expose the voice so callers (e.g. the Sampler audition keyboard) can
      // release held / looping notes; the sequencer simply ignores the return.
      return { src, ampGain }
    }
  }

  // Pick a multisample zone for a note, with round-robin between equal matches.
  // Returns { zone, buf } or null when the channel has no mapped zones / no match.
  function _selectSamplerZone(channelId, params) {
    const ch = channels.find(c => c.id === channelId)
    const zones = ch?.params?.zones
    if (!zones || !zones.length) return null
    const note   = Math.round(params.pitch ?? 60)
    const vel127 = Math.round((params.velocity ?? 0.8) * 127)
    const matches = zones.filter(z =>
      note   >= (z.loKey ?? 0)   && note   <= (z.hiKey ?? 127) &&
      vel127 >= (z.loVel ?? 0)   && vel127 <= (z.hiVel ?? 127))
    if (!matches.length) return null
    // Round-robin across the matching zones (so layered samples alternate).
    const rr  = _samplerRR.get(channelId) ?? 0
    const sel = matches[rr % matches.length]
    _samplerRR.set(channelId, rr + 1)
    const buf = samplerZoneBufs.get(channelId + ':' + sel.id)
    if (!buf) return null
    return { zone: sel, buf }
  }

  // Create a new Channel Rack sampler channel from a real audio file (File object).
  async function addAudioFileChannel(file) {
    initAudio()
    let buf
    try {
      const ab = await file.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) {
      console.error('[Sampler] Failed to decode audio file:', e)
      return null
    }
    const base = file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
    const ch = makeChannel({
      name: base.length > 14 ? base.slice(0, 14) : base,
      color: '#ff9f43',
      type: 'audiofile', mode: 'steps', sustains: false,
      instrumentType: 'audiofile',
      sampleName: file.name,
      audioFileMissing: false,
      params: {
        pitch: 60, rootNote: 60, fineTune: 0, keyTrack: 1,
        startOffset: 0, endOffset: 1,
        envDelay: 0, envAttack: 0.005, envDecay: 0.1, envSustain: 0.8, envRelease: 0.2,
        envAttackCurve: 0, envDecayCurve: -0.5, envReleaseCurve: -0.5,
        filterType: 'off', filterCutoff: 1.0, filterReso: 0,
        fEnvAmount: 0, fEnvAttack: 0.01, fEnvDecay: 0.2, fEnvSustain: 0,
        reverse: false, loopMode: 'off', loopStart: 0, loopEnd: 1, loopXfade: 0,
        velSens: 1, velocity: 0.8,
        ..._autoWarpDefaults(buf), warpMode: 'complex', warpMarkers: [],
        pEnvAmount: 0, pEnvAttack: 0.002, pEnvDecay: 0.15,
        lfoDest: 'off', lfoRate: 0.3, lfoDepth: 0, lfoShape: 'sine',
        lfo2Dest: 'off', lfo2Rate: 0.2, lfo2Depth: 0, lfo2Shape: 'triangle',
        playMode: 'classic', grainSize: 0.08, grainScan: 0.5,
        grainDensity: 0.5, grainSpray: 0.15, grainPan: 0, grainMotion: 0, grainShape: 'hann',
        arpEnabled: false, arpMode: 'up', arpRate: '1/16', arpGate: 0.5, arpRange: 1,
        sliceMode: false, sliceMarkers: [],
        zones: [],
      },
      knobs: [{ key: 'pitch', label: 'NOTE', min: 0, max: 127, decimals: 0 }],
      fn: () => {},
    })
    audioFileBufs.set(ch.id, buf)
    warpedSampleBufs.delete(ch.id)
    _buildSamplerDerivedBufs(ch.id, buf)
    ch.fn = makeAudioFileFn(ch.id)
    // Signal reactivity update
    audioFileVersions[ch.id] = 1
    channels.push(ch)
    rebuildGains()
    selectedChannelId.value = ch.id
    mainView.value = 'sequencer'
    markDirty()
    return ch
  }

  // Reload / replace the audio buffer for an existing sampler channel.
  async function loadAudioFileForChannel(channelId, file) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    initAudio()
    let buf
    try {
      const ab = await file.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) {
      console.error('[Sampler] Failed to decode audio file:', e)
      return
    }
    audioFileBufs.set(channelId, buf)
    warpedSampleBufs.delete(channelId)
    _clearSampleHistory(channelId)        // a fresh file starts a clean undo history
    _buildSamplerDerivedBufs(channelId, buf)
    const base = file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
    ch.name = base.length > 14 ? base.slice(0, 14) : base
    ch.sampleName = file.name
    ch.audioFileMissing = false
    const wasAudioFile = ch.type === 'audiofile'
    ch.type = 'audiofile'
    ch.sustains = false
    ch.instrumentType = 'audiofile'
    // Only reset params / knobs when converting FROM another instrument type.
    if (!wasAudioFile) {
      ch.params = {
        pitch: 60, rootNote: 60, fineTune: 0, keyTrack: 1,
        startOffset: 0, endOffset: 1,
        envDelay: 0, envAttack: 0.005, envDecay: 0.1, envSustain: 0.8, envRelease: 0.2,
        envAttackCurve: 0, envDecayCurve: -0.5, envReleaseCurve: -0.5,
        filterType: 'off', filterCutoff: 1.0, filterReso: 0,
        fEnvAmount: 0, fEnvAttack: 0.01, fEnvDecay: 0.2, fEnvSustain: 0,
        reverse: false, loopMode: 'off', loopStart: 0, loopEnd: 1, loopXfade: 0,
        velSens: 1, velocity: 0.8,
        warpEnabled: false, sampleBpm: null, warpMode: 'complex', warpMarkers: [],
        pEnvAmount: 0, pEnvAttack: 0.002, pEnvDecay: 0.15,
        lfoDest: 'off', lfoRate: 0.3, lfoDepth: 0, lfoShape: 'sine',
        lfo2Dest: 'off', lfo2Rate: 0.2, lfo2Depth: 0, lfo2Shape: 'triangle',
        playMode: 'classic', grainSize: 0.08, grainScan: 0.5,
        grainDensity: 0.5, grainSpray: 0.15, grainPan: 0, grainMotion: 0, grainShape: 'hann',
        arpEnabled: false, arpMode: 'up', arpRate: '1/16', arpGate: 0.5, arpRange: 1,
        sliceMode: false, sliceMarkers: [],
        zones: [],
      }
      ch.knobs  = [{ key: 'pitch', label: 'NOTE', min: 0, max: 127, decimals: 0 }]
    }
    // Always (re)detect tempo + auto-warp for the freshly loaded buffer.
    Object.assign(ch.params, _autoWarpDefaults(buf))
    if (ch.params.warpMode == null) ch.params.warpMode = 'complex'
    if (!Array.isArray(ch.params.warpMarkers)) ch.params.warpMarkers = []
    _clearWarpCache(channelId)
    ch.fn = makeAudioFileFn(channelId)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  function getAudioFileBuf(channelId) {
    return audioFileBufs.get(channelId) ?? null
  }

  // ── Multisample zones (velocity layers / key zones / round-robin) ────────────
  let _zid = 0
  function getSamplerZones(channelId) {
    return channels.find(c => c.id === channelId)?.params?.zones ?? []
  }

  // Add a zone from an audio file. Defaults span the whole keyboard so a single
  // dropped file is immediately playable; the user narrows ranges afterward.
  async function addSamplerZone(channelId, file, opts = {}) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return null
    initAudio()
    let buf
    try {
      const ab = await file.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) { console.error('[Sampler] zone decode failed:', e); return null }
    const id = 'z' + (++_zid) + Date.now().toString(36)
    samplerZoneBufs.set(channelId + ':' + id, buf)
    if (!ch.params.zones) ch.params.zones = []
    ch.params.zones.push({
      id,
      name:    file.name.replace(/\.[a-z0-9]+$/i, ''),
      loKey:   opts.loKey   ?? 0,
      hiKey:   opts.hiKey   ?? 127,
      loVel:   opts.loVel   ?? 0,
      hiVel:   opts.hiVel   ?? 127,
      rootNote: opts.rootNote ?? 60,
    })
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
    return id
  }

  function removeSamplerZone(channelId, zoneId) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params?.zones) return
    const i = ch.params.zones.findIndex(z => z.id === zoneId)
    if (i < 0) return
    ch.params.zones.splice(i, 1)
    samplerZoneBufs.delete(channelId + ':' + zoneId)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  function updateSamplerZone(channelId, zoneId, patch) {
    const z = channels.find(c => c.id === channelId)?.params?.zones?.find(z => z.id === zoneId)
    if (!z) return
    Object.assign(z, patch)
    markDirty()
  }

  // Normalize audio file to peak 0 dBFS — modifies in place and rebuilds derived bufs.
  function normalizeAudioFile(channelId) {
    const buf = audioFileBufs.get(channelId)
    if (!buf) return
    _pushSampleHistory(channelId)
    let maxAbs = 0
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i])
        if (v > maxAbs) maxAbs = v
      }
    }
    if (maxAbs < 0.0001) return
    const gain = 1 / maxAbs
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c)
      for (let i = 0; i < d.length; i++) d[i] *= gain
    }
    _buildSamplerDerivedBufs(channelId, buf)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
  }

  // Build (or clear) a crossfaded loop buffer for seamless looping (Lesson 7).
  // Call after adjusting loopStart/loopEnd or loopXfade. loopXfade=0 clears it.
  function buildLoopXfade(channelId) {
    const src = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!src || !ch) return

    const xfadeFrac = ch.params.loopXfade ?? 0
    if (xfadeFrac < 0.001) {
      xfadeLoopBufs.delete(channelId)
      audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
      return
    }

    const lsSample = Math.floor((ch.params.loopStart ?? 0) * src.length)
    const leSample = Math.floor((ch.params.loopEnd   ?? 1) * src.length)
    const loopLen  = leSample - lsSample
    if (loopLen < 16) return

    // Cross-fade length: fraction of loop, capped at 45% so fades never overlap
    const xfLen = Math.min(Math.floor(xfadeFrac * loopLen), Math.floor(loopLen * 0.45))
    if (xfLen < 4) return

    // Copy full buffer then apply equal-power crossfade at loop boundary
    const out = audioCtx.createBuffer(src.numberOfChannels, src.length, src.sampleRate)
    for (let c = 0; c < src.numberOfChannels; c++) {
      const s = src.getChannelData(c)
      const d = out.getChannelData(c)
      d.set(s)  // full copy
      for (let i = 0; i < xfLen; i++) {
        const endIdx   = leSample - xfLen + i  // near loop end
        const startIdx = lsSample + i           // near loop start
        const t        = i / xfLen
        d[endIdx] = s[endIdx] * Math.cos(t * Math.PI * 0.5)   // fade out
                  + s[startIdx] * Math.sin(t * Math.PI * 0.5)  // fade in
      }
    }
    xfadeLoopBufs.set(channelId, out)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
  }

  // Snap a sampler playback marker (startOffset / endOffset / loopStart / loopEnd)
  // to the nearest zero-crossing within 50ms of its current position.
  function snapToZero(channelId, paramName) {
    const buf = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!buf || !ch) return
    const data     = buf.getChannelData(0)
    const N        = buf.length
    const frac     = Math.max(0, Math.min(1, ch.params[paramName] ?? 0))
    const center   = Math.round(frac * N)
    const maxDist  = Math.min(N, Math.round(buf.sampleRate * 0.05))  // ±50 ms window
    for (let d = 0; d < maxDist; d++) {
      for (const dir of [1, -1]) {
        const idx = center + dir * d
        if (idx < 1 || idx >= N) continue
        if (data[idx] === 0 || (data[idx - 1] >= 0 && data[idx] < 0) || (data[idx - 1] <= 0 && data[idx] > 0)) {
          ch.params[paramName] = idx / N
          markDirty()
          return
        }
      }
    }
  }

  // ── Sample-edit undo history ─────────────────────────────────────────────────
  //   Destructive ops mutate the AudioBuffer directly, so before each one we snap a
  //   copy of the buffer plus the params an op can reset (offsets / loop / markers).
  //   undoSampleEdit() pops one step back. Capped to bound memory.
  const SAMPLE_HISTORY_MAX = 20
  const _HIST_PARAM_KEYS = ['startOffset', 'endOffset', 'loopStart', 'loopEnd',
    'warpMarkers', 'sliceMarkers', 'sliceMode', 'reverse', 'sampleBpm', 'warpEnabled']

  function _cloneBuffer(buf) {
    const out = audioCtx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
    for (let c = 0; c < buf.numberOfChannels; c++) out.getChannelData(c).set(buf.getChannelData(c))
    return out
  }

  function _pushSampleHistory(channelId) {
    const buf = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!buf || !ch?.params) return
    const snap = { buf: _cloneBuffer(buf), params: {} }
    for (const k of _HIST_PARAM_KEYS) {
      const v = ch.params[k]
      snap.params[k] = Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v
    }
    const stack = sampleEditHistory.get(channelId) ?? []
    stack.push(snap)
    while (stack.length > SAMPLE_HISTORY_MAX) stack.shift()
    sampleEditHistory.set(channelId, stack)
    sampleHistoryDepth[channelId] = stack.length
  }

  function _clearSampleHistory(channelId) {
    sampleEditHistory.delete(channelId)
    sampleHistoryDepth[channelId] = 0
  }

  function canUndoSampleEdit(channelId) {
    return (sampleHistoryDepth[channelId] ?? 0) > 0
  }

  // Revert the last destructive edit on a sampler channel (one step back).
  function undoSampleEdit(channelId) {
    const stack = sampleEditHistory.get(channelId)
    const ch    = channels.find(c => c.id === channelId)
    if (!stack || !stack.length || !ch?.params) return
    const snap = stack.pop()
    sampleHistoryDepth[channelId] = stack.length
    audioFileBufs.set(channelId, snap.buf)
    for (const k of _HIST_PARAM_KEYS) if (k in snap.params) ch.params[k] = snap.params[k]
    _buildSamplerDerivedBufs(channelId, snap.buf)
    _clearWarpCache(channelId)
    xfadeLoopBufs.delete(channelId)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  // ── Destructive sample processing (built-in wave editor) ─────────────────────
  //   A toolbox of offline DSP operations that bake permanently into the sampler's
  //   buffer (Normalize / Amplify / DC-offset / Invert / Fades / Swap / Trim / Crop
  //   / Reverse / Silence). After any op we rebuild the derived buffers (reverse,
  //   ping-pong), drop the warp + crossfade caches and bump the reactive version.
  function processSampleAudio(channelId, op, arg) {
    const src = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!src || !ch?.params) return
    initAudio()
    const nch = src.numberOfChannels, len = src.length, sr = src.sampleRate
    let out = src                     // most ops mutate in place
    let lengthChanged = false

    const SIL = 0.0008                // ≈ -62 dBFS silence threshold

    if (op === 'normalize') { normalizeAudioFile(channelId); return }

    // Snapshot for undo before mutating (normalize handles its own snapshot above).
    _pushSampleHistory(channelId)

    if (op === 'amplify') {
      const db   = (arg ?? 0)
      const gain = Math.pow(10, db / 20)
      for (let c = 0; c < nch; c++) {
        const d = src.getChannelData(c)
        for (let i = 0; i < len; i++) d[i] = Math.max(-1, Math.min(1, d[i] * gain))
      }
    } else if (op === 'dcoffset') {
      for (let c = 0; c < nch; c++) {
        const d = src.getChannelData(c)
        let m = 0; for (let i = 0; i < len; i++) m += d[i]; m /= len
        for (let i = 0; i < len; i++) d[i] -= m
      }
    } else if (op === 'invert') {
      for (let c = 0; c < nch; c++) {
        const d = src.getChannelData(c)
        for (let i = 0; i < len; i++) d[i] = -d[i]
      }
    } else if (op === 'reverse') {
      for (let c = 0; c < nch; c++) {
        const d = src.getChannelData(c)
        for (let i = 0, j = len - 1; i < j; i++, j--) { const t = d[i]; d[i] = d[j]; d[j] = t }
      }
      ch.params.reverse = false       // baked in — clear the live-reverse toggle
    } else if (op === 'fadein' || op === 'fadeout') {
      const fadeN = Math.max(1, Math.min(len, Math.floor(Math.min(len / 3, sr * 0.25))))
      for (let c = 0; c < nch; c++) {
        const d = src.getChannelData(c)
        for (let i = 0; i < fadeN; i++) {
          const t = Math.sin((i / fadeN) * Math.PI * 0.5)   // equal-power curve
          if (op === 'fadein') d[i] *= t
          else                 d[len - 1 - i] *= t
        }
      }
    } else if (op === 'swapstereo') {
      if (nch >= 2) {
        const L = src.getChannelData(0), R = src.getChannelData(1)
        for (let i = 0; i < len; i++) { const t = L[i]; L[i] = R[i]; R[i] = t }
      }
    } else if (op === 'silence') {
      for (let c = 0; c < nch; c++) src.getChannelData(c).fill(0)
    } else if (op === 'crop' || op === 'trimsilence') {
      let a, b
      if (op === 'crop') {
        a = Math.floor(Math.max(0, Math.min(1, ch.params.startOffset ?? 0)) * len)
        b = Math.ceil (Math.max(0, Math.min(1, ch.params.endOffset   ?? 1)) * len)
      } else {
        a = 0; b = len
        const peakAt = i => { let p = 0; for (let c = 0; c < nch; c++) p = Math.max(p, Math.abs(src.getChannelData(c)[i])); return p }
        while (a < len && peakAt(a) < SIL) a++
        while (b > a   && peakAt(b - 1) < SIL) b--
      }
      const newLen = Math.max(1, b - a)
      if (newLen !== len) {
        out = audioCtx.createBuffer(nch, newLen, sr)
        for (let c = 0; c < nch; c++) out.getChannelData(c).set(src.getChannelData(c).subarray(a, b))
        lengthChanged = true
      }
    }

    if (out !== src) audioFileBufs.set(channelId, out)
    if (lengthChanged) {
      ch.params.startOffset = 0; ch.params.endOffset = 1
      ch.params.loopStart   = 0; ch.params.loopEnd   = 1
      ch.params.warpMarkers = []; ch.params.sliceMarkers = []
    }
    _buildSamplerDerivedBufs(channelId, audioFileBufs.get(channelId))
    _clearWarpCache(channelId)
    xfadeLoopBufs.delete(channelId)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  // Detect the fundamental pitch of a sampler's audio (normalized autocorrelation
  // over a window taken from the sample start) and set the root note to match —
  // the building block behind "load a vocal, hit detect, play it in tune".
  function detectSamplePitch(channelId) {
    const buf = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!buf || !ch?.params) return null
    const sr   = buf.sampleRate
    const data = buf.getChannelData(0)
    let start  = Math.floor(Math.max(0, Math.min(1, ch.params.startOffset ?? 0)) * data.length)
    const N    = Math.min(data.length - start, Math.max(2048, Math.floor(sr * 0.3)))
    if (N < 1024) { start = 0 }
    const M = Math.min(N, data.length - start)
    if (M < 1024) return null

    // De-mean + RMS gate
    const x = new Float32Array(M)
    let mean = 0
    for (let i = 0; i < M; i++) { x[i] = data[start + i]; mean += x[i] }
    mean /= M
    let rms = 0
    for (let i = 0; i < M; i++) { x[i] -= mean; rms += x[i] * x[i] }
    rms = Math.sqrt(rms / M)
    if (rms < 1e-4) return null

    const minLag = Math.floor(sr / 2000)             // up to ~2 kHz
    const maxLag = Math.min(M - 1, Math.floor(sr / 50))   // down to ~50 Hz
    let bestLag = -1, best = 0
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0, e0 = 0, e1 = 0
      for (let i = 0; i + lag < M; i++) { sum += x[i] * x[i + lag]; e0 += x[i] * x[i]; e1 += x[i + lag] * x[i + lag] }
      const norm = sum / (Math.sqrt(e0 * e1) + 1e-9)
      if (norm > best) { best = norm; bestLag = lag }
    }
    if (bestLag < 0 || best < 0.5) return null        // not pitched enough
    const freq = sr / bestLag
    const midi = Math.round(69 + 12 * Math.log2(freq / 440))
    if (midi < 0 || midi > 127) return null
    ch.params.rootNote = midi
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
    return midi
  }

  // ── Slicer: transient detection + slice markers (chop a loop in the channel) ──
  //   Detects onset peaks and stores them as fractional slice positions. With slice
  //   mode on, each played note (relative to the root) triggers the matching slice.
  function detectSampleSlices(channelId, sensitivity = 0.5) {
    const buf = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!buf || !ch?.params) return
    const sr   = buf.sampleRate
    const data = buf.getChannelData(0)
    const N    = data.length
    const win  = Math.max(1, Math.floor(sr * 0.01))   // 10 ms energy frames
    const frames = Math.floor(N / win)
    const env = new Float32Array(frames)
    for (let f = 0; f < frames; f++) {
      let e = 0
      for (let i = 0; i < win; i++) { const v = data[f * win + i]; e += v * v }
      env[f] = Math.sqrt(e / win)
    }
    let maxE = 0; for (let f = 0; f < frames; f++) maxE = Math.max(maxE, env[f])
    if (maxE < 1e-4) return
    const thresh   = maxE * (0.12 + (1 - sensitivity) * 0.4)
    const minGapFr = Math.max(1, Math.floor((sr * 0.05) / win))   // ≥50 ms apart
    const markers  = [{ pos: 0 }]
    let lastF = -minGapFr
    for (let f = 1; f < frames - 1; f++) {
      const rising = env[f] - env[f - 1]
      if (env[f] > thresh && rising > thresh * 0.35 && f - lastF >= minGapFr) {
        markers.push({ pos: (f * win) / N })
        lastF = f
      }
    }
    ch.params.sliceMarkers = markers
    ch.params.sliceMode = true
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  function setSampleSlices(channelId, markers) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return
    ch.params.sliceMarkers = (markers ?? []).slice().sort((a, b) => a.pos - b.pos)
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  function clearSampleSlices(channelId) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return
    ch.params.sliceMarkers = []
    ch.params.sliceMode = false
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
  }

  // Dump a sliced sampler's slices to a fresh pattern, one slice per step in order
  // (the classic "slices → sequencer" workflow). Each step carries a pitch offset
  // selecting its slice; slice playback in makeAudioFileFn reads that offset.
  function sliceSamplerToSequencer(channelId) {
    const ch = channels.find(c => c.id === channelId)
    const slices = ch?.params?.sliceMarkers ?? []
    const n = slices.length
    if (!ch || n < 2) return null
    ch.params.sliceMode = true
    const root = ch.params.rootNote ?? 60

    const id    = 'p' + (++_pid + 1)
    const color = ch.color ?? COLORS[patterns.length % COLORS.length]
    patterns.push({ id, name: ((ch.name || 'SLICE') + ' SLICES').slice(0, 16), color })
    patternData[id] = {}

    const d = getPatData(channelId, id)
    // Piano-roll: one ascending note per slice (note = root + sliceIndex).
    d.pianoNotes = Array.from({ length: n }, (_, i) => ({
      startTick:    i * TICKS_PER_STEP,
      durationTicks: TICKS_PER_STEP,
      pitch:        root + i,
      velocity:     0.8,
    }))
    // Step representation: step i fires slice i (stepPitch is the semitone offset).
    const cap = 32
    d.steps       = Array.from({ length: cap }, (_, i) => i < n)
    d.stepPitches = Array.from({ length: cap }, (_, i) => i % n)

    currentPatternId.value = id
    pickerPatternId.value  = id
    audioFileVersions[channelId] = (audioFileVersions[channelId] ?? 0) + 1
    markDirty()
    return id
  }

  // ── Playlist Audio Clips ───────────────────────────────────────────────────────

  async function addAudioClip(trackId, cell, file) {
    initAudio()
    let buf
    try {
      const ab = await file.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) { console.error('[AudioClip] Failed to decode:', e); return }

    const secPerCell = getSecPerCell()
    const detectedBpm = (() => { try { return detectBpm(buf) } catch (_) { return null } })()
    const widthCells = Math.max(1, Math.ceil(buf.duration / secPerCell))
    const id = 'c' + (++_clipId)
    const track = playlistTracks.find(t => t.id === trackId)
    const color = track?.color ?? '#4ecdc4'

    playlistClips.push({
      id, trackId, cell,
      type:       'audio',
      width:      widthCells,
      sampleName: file.name,
      color,
      volume:     1,
      startOffset: 0,
      endOffset:   1,
      muted:       false,
      audioFileMissing: false,
      // ── Warp (tempo follow) ── auto-enabled for loop-length material
      warpEnabled: !!detectedBpm && buf.duration >= 2.0,
      clipBpm:     detectedBpm,    // null when undetectable
      warpMode:    'complex',
      mixerTrack:  0,              // 0 = master; route audio through a mixer insert
    })
    audioClipBufs.set(id, buf)
    audioClipVersions[id] = 1
    markDirty()
  }

  async function loadAudioClipFile(clipId, file) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    initAudio()
    let buf
    try {
      const ab = await file.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) { console.error('[AudioClip] Failed to decode:', e); return }

    audioClipBufs.set(clipId, buf)
    warpedClipBufs.delete(clipId)
    clip.sampleName = file.name
    clip.audioFileMissing = false
    if (clip.clipBpm == null) { try { clip.clipBpm = detectBpm(buf) } catch (_) {} }
    if (clip.warpMode == null) clip.warpMode = 'complex'
    const secPerCell = getSecPerCell()
    clip.width = Math.max(1, Math.ceil(buf.duration / secPerCell))
    audioClipVersions[clipId] = (audioClipVersions[clipId] ?? 0) + 1
    markDirty()
  }

  function getAudioClipBuf(clipId) {
    return audioClipBufs.get(clipId) ?? null
  }

  // Create a playlist audio clip directly from an in-memory AudioBuffer (used by
  // the audio recorder and by resample/consolidate features).
  function addAudioClipFromBuffer(trackId, cell, buf, name = 'RECORDING') {
    if (!buf) return null
    const secPerCell = getSecPerCell()
    const widthCells = Math.max(1, Math.ceil(buf.duration / secPerCell))
    const id = 'c' + (++_clipId)
    const track = playlistTracks.find(t => t.id === trackId)
    const color = track?.color ?? '#e74c3c'
    playlistClips.push({
      id, trackId, cell, type: 'audio', width: widthCells,
      sampleName: name, color, volume: 1, startOffset: 0, endOffset: 1,
      muted: false, audioFileMissing: false,
      warpEnabled: false, clipBpm: bpm.value, warpMode: 'complex', mixerTrack: 0,
    })
    audioClipBufs.set(id, buf)
    audioClipVersions[id] = 1
    markDirty()
    return id
  }

  // Resolve the buffer a clip should actually play: the raw buffer, or a cached
  // time-stretched copy when warp is enabled and a clip BPM is known. Re-renders
  // only when the stretch signature (clip BPM, project BPM, mode) changes.
  function getWarpedClipBuf(clip) {
    const raw = audioClipBufs.get(clip.id)
    if (!raw) return null
    if (!clip.warpEnabled || !clip.clipBpm) return raw
    const mode  = clip.warpMode ?? 'complex'
    const ratio = tempoRatio(clip.clipBpm, bpm.value)
    if (mode === 'repitch' || Math.abs(ratio - 1) < 0.002) return raw
    const sig = clip.clipBpm + ':' + bpm.value + ':' + mode
    const cached = warpedClipBufs.get(clip.id)
    if (cached && cached.sig === sig) return cached.buf
    let buf
    try { buf = timeStretch(audioCtx, raw, ratio, mode) } catch (_) { buf = raw }
    warpedClipBufs.set(clip.id, { sig, buf })
    return buf
  }

  // Playback rate for a warped clip: 1.0 for true time-stretch modes, or the
  // tempo ratio for repitch (where pitch is allowed to follow tempo).
  function warpClipRate(clip) {
    if (!clip.warpEnabled || !clip.clipBpm) return 1
    if ((clip.warpMode ?? 'complex') === 'repitch') return bpm.value / clip.clipBpm
    return 1
  }

  // Toggle / set warp on a clip and invalidate its cached render.
  function setClipWarp(clipId, patch) {
    const clip = playlistClips.find(c => c.id === clipId)
    if (!clip) return
    Object.assign(clip, patch)
    warpedClipBufs.delete(clipId)
    markDirty()
  }

  // Re-detect a clip's tempo from its audio (e.g. after manual reset).
  function redetectClipBpm(clipId) {
    const clip = playlistClips.find(c => c.id === clipId)
    const raw  = clip && audioClipBufs.get(clipId)
    if (!raw) return
    try { clip.clipBpm = detectBpm(raw) } catch (_) {}
    warpedClipBufs.delete(clipId)
    markDirty()
  }

  // Warp-aware forward buffer for a sampler channel. Returns a cached
  // time-stretched copy when warp is enabled and a sample BPM is known; null
  // otherwise (caller falls back to the raw buffer). 'repitch' is a no-op here
  // since note pitch already drives playbackRate.
  function getWarpedSampleBuf(channelId, params) {
    if (!params?.warpEnabled || !audioCtx) return null
    const raw = audioFileBufs.get(channelId)
    if (!raw) return null
    const mode = params.warpMode ?? 'complex'
    if (mode === 'repitch') return null

    // Warp markers (≥2) → piecewise stretch; otherwise uniform tempo ratio.
    const markers = params.warpMarkers
    if (markers && markers.length >= 2) {
      const sig = 'm:' + bpm.value + ':' + mode + ':' + markers.map(m => m.pos.toFixed(4) + '@' + m.beat).join(',')
      const cached = warpedSampleBufs.get(channelId)
      if (cached && cached.sig === sig) return cached.buf
      const segs = buildWarpSegments(markers, bpm.value, raw.duration)
      if (!segs) return null
      let buf
      try { buf = timeStretchSegments(audioCtx, raw, segs, mode) } catch (_) { return null }
      warpedSampleBufs.set(channelId, { sig, buf })
      return buf
    }

    if (!params.sampleBpm) return null
    const ratio = tempoRatio(params.sampleBpm, bpm.value)
    if (Math.abs(ratio - 1) < 0.002) return null
    const sig = params.sampleBpm + ':' + bpm.value + ':' + mode
    const cached = warpedSampleBufs.get(channelId)
    if (cached && cached.sig === sig) return cached.buf
    let buf
    try { buf = timeStretch(audioCtx, raw, ratio, mode) } catch (_) { return null }
    warpedSampleBufs.set(channelId, { sig, buf })
    return buf
  }

  // Toggle/set sampler warp params and invalidate the cached stretch.
  function setSamplerWarp(channelId, patch) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return
    Object.assign(ch.params, patch)
    warpedSampleBufs.delete(channelId)
    markDirty()
  }

  // Re-detect a sampler's source tempo from its loaded audio.
  function redetectSampleBpm(channelId) {
    const raw = audioFileBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!raw || !ch?.params) return
    try { ch.params.sampleBpm = detectBpm(raw) } catch (_) {}
    warpedSampleBufs.delete(channelId)
    markDirty()
  }

  // ── Warp markers (sampler) — pin a sample position to a musical beat ─────────
  function _ensureWarpMarkers(ch) { if (!Array.isArray(ch.params.warpMarkers)) ch.params.warpMarkers = [] }

  function addSampleWarpMarker(channelId, pos) {
    const ch  = channels.find(c => c.id === channelId)
    const raw = audioFileBufs.get(channelId)
    if (!ch?.params || !raw) return
    _ensureWarpMarkers(ch)
    const p = Math.max(0, Math.min(1, pos))
    // Infer a default beat from the sample tempo (user can edit afterward).
    const beatsTotal = (ch.params.sampleBpm ? raw.duration * (ch.params.sampleBpm / 60) : raw.duration * 2)
    const beat = Math.round(p * beatsTotal)
    ch.params.warpMarkers.push({ pos: p, beat })
    // Note: not sorted in place (buildWarpSegments sorts a copy) so marker
    // indices stay stable while dragging.
    _clearWarpCache(channelId)
    markDirty()
  }

  function updateSampleWarpMarker(channelId, idx, patch) {
    const ch = channels.find(c => c.id === channelId)
    const m  = ch?.params?.warpMarkers?.[idx]
    if (!m) return
    Object.assign(m, patch)
    _clearWarpCache(channelId)
    markDirty()
  }

  function removeSampleWarpMarker(channelId, idx) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params?.warpMarkers) return
    ch.params.warpMarkers.splice(idx, 1)
    _clearWarpCache(channelId)
    markDirty()
  }

  function clearSampleWarpMarkers(channelId) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return
    ch.params.warpMarkers = []
    _clearWarpCache(channelId)
    markDirty()
  }

  // ── Audio input recording (getUserMedia → playlist clip / sampler) ───────────
  const audioInputReady   = ref(false)   // mic permission granted + graph built
  const inputMonitor      = ref(false)   // pass mic to the speakers (off by default)
  const isRecordingAudio  = ref(false)
  const inputLevel        = ref(0)        // 0..1 live input meter
  let _micStream = null, _micSource = null, _monitorGain = null, _inputAnalyser = null
  let _mediaRecorder = null, _recChunks = [], _recTarget = null, _recLevelRAF = null, _recAutoStop = null

  async function enableAudioInput() {
    if (audioInputReady.value) return true
    if (!navigator.mediaDevices?.getUserMedia) { console.warn('[Rec] getUserMedia unavailable'); return false }
    initAudio()
    try {
      _micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      })
    } catch (e) { console.error('[Rec] mic access denied:', e); return false }
    _micSource   = audioCtx.createMediaStreamSource(_micStream)
    _monitorGain = audioCtx.createGain()
    _monitorGain.gain.value = inputMonitor.value ? 1 : 0
    _inputAnalyser = audioCtx.createAnalyser(); _inputAnalyser.fftSize = 512
    _micSource.connect(_inputAnalyser)
    _micSource.connect(_monitorGain)
    _monitorGain.connect(audioCtx.destination)
    audioInputReady.value = true
    _pollInputLevel()
    return true
  }

  function _pollInputLevel() {
    if (!_inputAnalyser) return
    const buf = new Uint8Array(_inputAnalyser.fftSize)
    const tick = () => {
      _inputAnalyser.getByteTimeDomainData(buf)
      let peak = 0
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i] - 128) / 128; if (v > peak) peak = v }
      inputLevel.value = peak
      _recLevelRAF = requestAnimationFrame(tick)
    }
    tick()
  }

  function setInputMonitor(on) {
    inputMonitor.value = !!on
    if (_monitorGain) _monitorGain.gain.value = on ? 1 : 0
  }

  // Begin recording. `target` = { trackId, cell } for a playlist clip, or
  // { channelId } to load the result into an existing sampler channel.
  async function startAudioRecording(target = {}) {
    if (isRecordingAudio.value) return false
    const ok = await enableAudioInput()
    if (!ok) return false
    _recChunks = []
    _recTarget = target
    let mime = ''
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) { mime = m; break }
    }
    try {
      _mediaRecorder = mime ? new MediaRecorder(_micStream, { mimeType: mime }) : new MediaRecorder(_micStream)
    } catch (e) { console.error('[Rec] MediaRecorder init failed:', e); return false }
    _mediaRecorder.ondataavailable = e => { if (e.data?.size) _recChunks.push(e.data) }
    _mediaRecorder.onstop = _finalizeRecording
    _mediaRecorder.start()
    isRecordingAudio.value = true

    // ── Transport sync ──
    // Optionally start the song so you record in time; the clip lands at `cell`.
    if (target.withPlayback && !isPlaying.value) {
      usePlaylist.value = true
      if (target.cell != null) seekTo(target.cell)
      startPlay()
    }
    // Optionally auto-stop after a fixed number of bars (loop-length take).
    if (target.bars && target.bars > 0) {
      const ms = target.bars * getSecPerCell() * 1000
      _recAutoStop = setTimeout(() => stopAudioRecording(), ms + 80)
    }
    return true
  }

  function stopAudioRecording() {
    if (_recAutoStop) { clearTimeout(_recAutoStop); _recAutoStop = null }
    if (!isRecordingAudio.value || !_mediaRecorder) return
    try { _mediaRecorder.stop() } catch (_) {}
    isRecordingAudio.value = false
  }

  async function _finalizeRecording() {
    const chunks = _recChunks; _recChunks = []
    const target = _recTarget || {}
    _mediaRecorder = null
    if (!chunks.length) return
    const blob = new Blob(chunks, { type: chunks[0].type || 'audio/webm' })
    let buf
    try {
      const ab = await blob.arrayBuffer()
      buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
    } catch (e) { console.error('[Rec] decode failed:', e); return }

    if (target.channelId) {
      // Load straight into an existing sampler channel.
      audioFileBufs.set(target.channelId, buf)
      warpedSampleBufs.delete(target.channelId)
      _buildSamplerDerivedBufs(target.channelId, buf)
      const ch = channels.find(c => c.id === target.channelId)
      if (ch) {
        ch.sampleName = 'RECORDING'; ch.audioFileMissing = false
        if (ch.params) { try { ch.params.sampleBpm = detectBpm(buf) } catch (_) {} }
        ch.fn = makeAudioFileFn(target.channelId)
      }
      audioFileVersions[target.channelId] = (audioFileVersions[target.channelId] ?? 0) + 1
    } else {
      const trackId = target.trackId ?? playlistTracks[0]?.id
      const cell    = target.cell ?? 0
      if (trackId != null) addAudioClipFromBuffer(trackId, cell, buf, 'RECORDING')
    }
    markDirty()
  }

  function disableAudioInput() {
    stopAudioRecording()
    if (_recLevelRAF) { cancelAnimationFrame(_recLevelRAF); _recLevelRAF = null }
    if (_micStream) { _micStream.getTracks().forEach(t => t.stop()); _micStream = null }
    try { _micSource?.disconnect() } catch (_) {}
    try { _monitorGain?.disconnect() } catch (_) {}
    _micSource = _monitorGain = _inputAnalyser = null
    audioInputReady.value = false
    inputLevel.value = 0
  }

  // ── CHOP slicer ────────────────────────────────────────────────────────────────

  function makeEqualSlices(n) {
    return Array.from({ length: n }, (_, i) => ({ start: i / n, end: (i + 1) / n }))
  }

  // Warp-aware source buffer for a slicer (CHOP/FORGE). Stretches the whole
  // source to the project tempo so slice fractions stay valid and the sliced
  // loop is tempo-locked. Cached per channel+tag.
  function _getWarpedSliceBuf(rawBuf, params, cacheKey) {
    if (!rawBuf || !params?.warpEnabled || !params.sampleBpm || !audioCtx) return null
    const mode = params.warpMode ?? 'complex'
    if (mode === 'repitch') return null
    const ratio = tempoRatio(params.sampleBpm, bpm.value)
    if (Math.abs(ratio - 1) < 0.002) return null
    const sig = 'slc:' + params.sampleBpm + ':' + bpm.value + ':' + mode
    const cached = warpedSampleBufs.get(cacheKey)
    if (cached && cached.sig === sig) return cached.buf
    let buf
    try { buf = timeStretch(audioCtx, rawBuf, ratio, mode) } catch (_) { return null }
    warpedSampleBufs.set(cacheKey, { sig, buf })
    return buf
  }

  // Auto-warp heuristic: detect tempo, and enable warp automatically for
  // loop-length material (≥ ~2 s) while leaving short one-shots unwarped.
  function _autoWarpDefaults(buf) {
    let detected = null
    try { detected = detectBpm(buf) } catch (_) {}
    return { sampleBpm: detected, warpEnabled: !!detected && (buf?.duration ?? 0) >= 2.0 }
  }

  // Invalidate every cached warped buffer belonging to a channel.
  function _clearWarpCache(channelId) {
    for (const k of [...warpedSampleBufs.keys()]) {
      if (k === channelId || k.startsWith(channelId + ':')) warpedSampleBufs.delete(k)
    }
  }

  // Set warp params on a slicer (CHOP/FORGE) and invalidate its cached stretch.
  function setSlicerWarp(channelId, patch) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.params) return
    Object.assign(ch.params, patch)
    _clearWarpCache(channelId)
    markDirty()
  }
  function redetectSlicerBpm(channelId) {
    const ch  = channels.find(c => c.id === channelId)
    const raw = chopBufs.get(channelId) ?? forgeBufsA.get(channelId)
    if (!ch?.params || !raw) return
    try { ch.params.sampleBpm = detectBpm(raw) } catch (_) {}
    _clearWarpCache(channelId)
    markDirty()
  }

  function makeChopFn(channelId) {
    return (ctx, when, params, dest) => {
      const raw = chopBufs.get(channelId)
      const buf = _getWarpedSliceBuf(raw, params, channelId + ':chop') ?? raw
      if (!buf) return
      const slices = params.slices
      if (!slices?.length) return
      const rootNote = params.rootNote ?? 60
      const idx      = ((Math.round(params.pitch ?? rootNote) - rootNote) % slices.length + slices.length) % slices.length
      const sl       = slices[idx]
      const speed    = params.speed     ?? 1.0
      const pitchOff = params.pitchOffset ?? 0
      const gate     = params.gate      ?? 1.0
      const startSec = buf.duration * (sl.start ?? 0)
      const sliceLen = buf.duration * ((sl.end ?? 1) - (sl.start ?? 0))
      const playLen  = sliceLen * gate
      if (playLen <= 0) return
      const src = ctx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = speed * Math.pow(2, pitchOff / 12)
      const g = ctx.createGain(); g.gain.value = params.velocity ?? 0.8
      src.connect(g); g.connect(dest)
      src.start(when, startSec, playLen / src.playbackRate.value)
    }
  }

  async function addChopChannel(file) {
    const sliceCount = 16
    const ch = reactive({
      id: String(++_cid),
      name: 'CHOP', color: COLORS[channels.length % COLORS.length],
      type: 'chop', mode: 'steps', sustains: false,
      volume: 0.8, pan: 0, mixerTrack: 0,
      muted: false, _soloed: false, selected: false,
      zipped: false, loopEnabled: false, loopLength: sliceCount,
      cutSelf: false, swingMix: 1.0, groupId: null,
      params: { pitch: 60, rootNote: 60, sliceCount, slices: makeEqualSlices(sliceCount), speed: 1.0, pitchOffset: 0, gate: 1.0, velocity: 0.8,
                warpEnabled: false, sampleBpm: null, warpMode: 'complex' },
      knobs: [],
      fn: () => {},
      activeModules: [], effects: [],
      instrumentType: 'chop',
      sampleName: '',
      audioFileMissing: false,
    })
    if (file) {
      initAudio()
      try {
        const ab  = await file.arrayBuffer()
        const buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
        chopBufs.set(ch.id, buf)
        const base = file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
        ch.name = base.length > 12 ? base.slice(0, 12) : base
        ch.sampleName = file.name
        ch.audioFileMissing = false
        Object.assign(ch.params, _autoWarpDefaults(buf))
        chopVersions[ch.id] = 1
      } catch (e) { console.error('[CHOP] decode failed:', e) }
    }
    ch.fn = makeChopFn(ch.id)
    channels.push(ch)
    rebuildGains()
    // Auto-init steps: step N → slice N (so each step fires a different chop)
    const d = getPatData(ch.id)
    d.steps = Array.from({ length: 32 }, (_, i) => i < sliceCount)
    d.stepPitches = Array.from({ length: 32 }, (_, i) => i)
    selectedChannelId.value = ch.id
    markDirty()
  }

  async function loadChopFile(channelId, file) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    initAudio()
    try {
      const ab  = await file.arrayBuffer()
      const buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
      chopBufs.set(channelId, buf)
      _clearWarpCache(channelId)
      const base = file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
      ch.name = base.length > 12 ? base.slice(0, 12) : base
      ch.sampleName = file.name
      ch.audioFileMissing = false
      if (!ch.params.slices?.length) ch.params.slices = makeEqualSlices(ch.params.sliceCount ?? 16)
      if (ch.params.warpMode == null) ch.params.warpMode = 'complex'
      Object.assign(ch.params, _autoWarpDefaults(buf))
      ch.fn = makeChopFn(channelId)
      chopVersions[channelId] = (chopVersions[channelId] ?? 0) + 1
      markDirty()
    } catch (e) { console.error('[CHOP] decode failed:', e) }
  }

  function getChopBuf(channelId) { return chopBufs.get(channelId) ?? null }

  // ── Slice → MIDI / Drum Rack ─────────────────────────────────────────────────
  //   Turn a CHOP/FORGE channel's slices into a playable sequence: a new pattern
  //   that triggers each slice in order, laid out chromatically from the root
  //   note. Both slicers already map note → slice, so the channel itself is the
  //   "drum rack"; this generates the MIDI clip that plays it.
  function sliceToMidi(channelId, { spacingSteps = 1 } = {}) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch || (ch.type !== 'chop' && ch.type !== 'forge')) return null
    const slices = ch.params?.slices ?? []
    const n = slices.length
    if (!n) return null
    const root = ch.params.rootNote ?? 60

    const id    = 'p' + (++_pid + 1)
    const color = ch.color ?? COLORS[patterns.length % COLORS.length]
    patterns.push({ id, name: ((ch.name || 'SLICE') + ' SEQ').slice(0, 16), color })
    patternData[id] = {}

    const d = getPatData(channelId, id)
    // Piano-roll representation: one ascending note per slice.
    d.pianoNotes = Array.from({ length: n }, (_, i) => ({
      startTick:    i * spacingSteps * TICKS_PER_STEP,
      durationTicks: TICKS_PER_STEP,
      pitch:        root + i,
      velocity:     0.8,
    }))
    // Step representation (stepPitch == slice index → slice N on step N).
    const cap = 32
    d.steps       = Array.from({ length: cap }, (_, i) => i < n && i % spacingSteps === 0)
    d.stepPitches = Array.from({ length: cap }, (_, i) => Math.floor(i / spacingSteps) % n)

    currentPatternId.value = id
    pickerPatternId.value  = id
    markDirty()
    return id
  }

  function detectChopTransients(channelId, sensitivity = 1.5) {
    const buf = chopBufs.get(channelId)
    const ch  = channels.find(c => c.id === channelId)
    if (!buf || !ch) return
    const data   = buf.getChannelData(0)
    const N      = data.length
    const WINDOW = 512
    const onsets = [0]
    let prevEnergy = 0
    for (let i = WINDOW; i < N; i += WINDOW) {
      let sum = 0
      const end = Math.min(i + WINDOW, N)
      for (let j = i; j < end; j++) sum += data[j] * data[j]
      const energy = sum / (end - i)
      if (energy > prevEnergy * sensitivity && energy > 0.0005) onsets.push(i / N)
      prevEnergy = prevEnergy * 0.7 + energy * 0.3
    }
    if (onsets[onsets.length - 1] < 0.99) onsets.push(1)
    const slices = []
    for (let i = 0; i < onsets.length - 1; i++) slices.push({ start: onsets[i], end: onsets[i + 1] })
    ch.params.slices    = slices
    ch.params.sliceCount = slices.length
    const d = getPatData(ch.id)
    d.stepPitches = Array.from({ length: 32 }, (_, i) => i % slices.length)
    markDirty()
  }

  // ── FORGE dual-deck slicer ──────────────────────────────────────────────────────

  function makeForgeF(channelId) {
    return (ctx, when, params, dest) => {
      const slices = params.slices
      if (!slices?.length) return
      const rootNote = params.rootNote ?? 60
      const idx = ((Math.round(params.pitch ?? rootNote) - rootNote) % slices.length + slices.length) % slices.length
      const sl  = slices[idx]
      const blend    = Math.max(0, Math.min(1, params.deckBlend ?? 0))
      const velocity = params.velocity ?? 0.8

      const playDeck = (buf, revBuf, deckGain) => {
        if (!buf || deckGain < 0.001) return
        const dir     = sl.dir ?? 'fwd'
        const useRev  = dir === 'rev' && revBuf
        const abuf    = useRev ? revBuf : buf
        // For reversed: slice [start,end] lives at [1-end, 1-start] in the reversed buffer
        const sliceStart = useRev ? (1 - (sl.end ?? 1)) : (sl.start ?? 0)
        const startSec   = abuf.duration * sliceStart
        const sliceLen   = abuf.duration * ((sl.end ?? 1) - (sl.start ?? 0))
        if (sliceLen <= 0) return
        const src = ctx.createBufferSource()
        src.buffer = abuf
        src.playbackRate.value = Math.pow(2, (sl.pitch ?? 0) / 12)
        const playDur = sliceLen / src.playbackRate.value
        const g    = ctx.createGain()
        const peak = (sl.vol ?? 1) * deckGain * velocity
        const atk  = Math.max(0, sl.attack  ?? 0)
        const rel  = Math.max(0, sl.release ?? 0)
        if (atk > 0.001 || rel > 0.001) {
          g.gain.setValueAtTime(0, when)
          const atkEnd = when + Math.min(atk, playDur * 0.5)
          g.gain.linearRampToValueAtTime(peak, atkEnd)
          const relStart = Math.max(atkEnd, when + playDur - Math.min(rel, playDur * 0.5))
          if (relStart > atkEnd) g.gain.setValueAtTime(peak, relStart)
          g.gain.linearRampToValueAtTime(0, when + playDur)
        } else {
          g.gain.value = peak
        }
        if ((sl.pan ?? 0) !== 0) {
          const panner = ctx.createStereoPanner()
          panner.pan.value = Math.max(-1, Math.min(1, sl.pan))
          src.connect(g); g.connect(panner); panner.connect(dest)
        } else {
          src.connect(g); g.connect(dest)
        }
        src.start(when, startSec, playDur)
      }

      // Warp both decks (forward + reversed) by the same tempo ratio when enabled.
      const wA    = _getWarpedSliceBuf(forgeBufsA.get(channelId),     params, channelId + ':fA')    ?? forgeBufsA.get(channelId)
      const wArev = _getWarpedSliceBuf(forgeBufsA_rev.get(channelId), params, channelId + ':fArev') ?? forgeBufsA_rev.get(channelId)
      const wB    = _getWarpedSliceBuf(forgeBufsB.get(channelId),     params, channelId + ':fB')    ?? forgeBufsB.get(channelId)
      const wBrev = _getWarpedSliceBuf(forgeBufsB_rev.get(channelId), params, channelId + ':fBrev') ?? forgeBufsB_rev.get(channelId)
      playDeck(wA, wArev, 1 - blend)
      playDeck(wB, wBrev, blend)
    }
  }

  function _makeForgeSlices(n) {
    return makeEqualSlices(n).map(s => ({ ...s, vol: 1, pan: 0, pitch: 0, dir: 'fwd', attack: 0, release: 0 }))
  }

  function _makeReversedBuf(buf) {
    const rev = audioCtx.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate)
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const src = buf.getChannelData(c)
      const dst = rev.getChannelData(c)
      for (let i = 0; i < buf.length; i++) dst[i] = src[buf.length - 1 - i]
    }
    return rev
  }

  // Pre-compute reversed + ping-pong [fwd+rev] AudioBuffers for sampler channel.
  function _buildSamplerDerivedBufs(channelId, srcBuf) {
    const nch = srcBuf.numberOfChannels
    const len = srcBuf.length

    const rev = audioCtx.createBuffer(nch, len, srcBuf.sampleRate)
    for (let c = 0; c < nch; c++) {
      const s = srcBuf.getChannelData(c)
      const d = rev.getChannelData(c)
      for (let i = 0; i < len; i++) d[i] = s[len - 1 - i]
    }
    reversedAudioFileBufs.set(channelId, rev)

    const pp = audioCtx.createBuffer(nch, len * 2, srcBuf.sampleRate)
    for (let c = 0; c < nch; c++) {
      const s = srcBuf.getChannelData(c)
      const d = pp.getChannelData(c)
      for (let i = 0; i < len; i++) {
        d[i]       = s[i]
        d[len + i] = s[len - 1 - i]
      }
    }
    pingpongAudioFileBufs.set(channelId, pp)
  }

  // Generate a curve array for ADSR stage shaping (tension: -1=exponential, 0=linear, +1=logarithmic)
  function _envCurve(from, to, tension, N = 128) {
    const arr = new Float32Array(N)
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1)
      const exp = tension < 0
        ? 1 + Math.abs(tension) * 4   // concave: fast initial change, slow tail
        : 1 / (1 + tension * 4)        // convex: slow initial change, fast end
      arr[i] = from + (to - from) * Math.pow(Math.max(0, Math.min(1, t)), exp)
    }
    return arr
  }

  // Schedule one ADSR phase with optional curve shaping.
  function _applyEnvPhase(param, from, to, startT, dur, tension) {
    if (dur < 0.0002) return
    param.setValueAtTime(from, startT)
    if (Math.abs(tension) < 0.02) {
      param.linearRampToValueAtTime(to, startT + dur)
    } else {
      // Tiny offset so setValueAtTime anchor doesn't conflict with curve start
      param.setValueCurveAtTime(_envCurve(from, to, tension), startT + 0.0001, dur - 0.0001)
    }
  }

  function addForgeChannel() {
    const sliceCount = 16
    const ch = reactive({
      id: String(++_cid),
      name: 'FORGE', color: COLORS[(channels.length + 3) % COLORS.length],
      type: 'forge', mode: 'piano', sustains: false,
      volume: 0.8, pan: 0, mixerTrack: 0,
      muted: false, _soloed: false, selected: false,
      zipped: false, loopEnabled: false, loopLength: 16,
      cutSelf: false, swingMix: 1.0, groupId: null,
      params: { pitch: 60, rootNote: 60, sliceCount, slices: _makeForgeSlices(sliceCount), deckBlend: 0, deckAName: '', deckBName: '', velocity: 0.8,
                warpEnabled: false, sampleBpm: null, warpMode: 'complex' },
      knobs: [],
      fn: () => {},
      activeModules: [], effects: [],
      instrumentType: 'forge',
      deckAMissing: false, deckBMissing: false,
    })
    ch.fn = makeForgeF(ch.id)
    channels.push(ch)
    rebuildGains()
    selectedChannelId.value = ch.id
    markDirty()
  }

  async function loadForgeDeck(channelId, deck, file) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    initAudio()
    try {
      const ab  = await file.arrayBuffer()
      const buf = await new Promise((res, rej) => audioCtx.decodeAudioData(ab, res, rej))
      const rev = _makeReversedBuf(buf)
      if (deck === 'A') {
        forgeBufsA.set(channelId, buf); forgeBufsA_rev.set(channelId, rev)
        ch.params.deckAName = file.name
        ch.deckAMissing = false
        forgeVersions[channelId + '_A'] = (forgeVersions[channelId + '_A'] ?? 0) + 1
      } else {
        forgeBufsB.set(channelId, buf); forgeBufsB_rev.set(channelId, rev)
        ch.params.deckBName = file.name
        ch.deckBMissing = false
        forgeVersions[channelId + '_B'] = (forgeVersions[channelId + '_B'] ?? 0) + 1
      }
      if (!ch.params.slices?.length) ch.params.slices = _makeForgeSlices(ch.params.sliceCount ?? 16)
      if (ch.params.warpMode == null) ch.params.warpMode = 'complex'
      // Detect tempo from deck A (the primary deck) and auto-warp loop-length material.
      if (deck === 'A') Object.assign(ch.params, _autoWarpDefaults(buf))
      _clearWarpCache(channelId)
      ch.fn = makeForgeF(channelId)
      markDirty()
    } catch (e) { console.error('[FORGE] decode failed:', e) }
  }

  function getForgeBuf(channelId, deck) {
    return (deck === 'A' ? forgeBufsA : forgeBufsB).get(channelId) ?? null
  }

  function cloneAudioClip(clipId) {
    const src = playlistClips.find(c => c.id === clipId)
    if (!src || src.type !== 'audio') return
    const buf = audioClipBufs.get(clipId)
    const newId = 'c' + (++_clipId)
    playlistClips.push({ ...src, id: newId, cell: src.cell + (src.width || 1) })
    if (buf) {
      audioClipBufs.set(newId, buf)
      audioClipVersions[newId] = 1
    }
    markDirty()
  }

  // Create a new Channel Rack channel from a dropped browser asset.
  function addSampleChannel(asset) {
    initAudio()
    const base = asset.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
    const ch = makeChannel({
      name: base.length > 14 ? base.slice(0, 14) : base,
      color: asset.color || '#4ecdc4',
      type: 'sample', mode: 'steps', volume: 0.8,
      instrumentType: 'sample',
      sampleSpec: { ...asset.spec }, sampleName: asset.name,
      params: { pitch: 60, velocity: 0.8 },
      knobs: [{ key: 'pitch', label: 'PITCH', min: 24, max: 96, decimals: 0 }],
      fn: makeSampleFn(asset.spec),
    })
    channels.push(ch)
    rebuildGains()
    selectedChannelId.value = ch.id
    mainView.value = 'sequencer'
    markDirty()
    return ch
  }

  // ── MIDI input, sync telemetry & Multilink ────────────────────────────────────
  //   Sync LED states: idle(grey) | unhandled(green) | volatile(orange) | global(blue).
  //   Incoming CC is bound to internal params via a Multilink table; the 7-bit
  //   integer is run through a transfer curve + parameter smoothing before apply.
  const midiEnabled     = ref(false)
  const midiSyncState   = ref('idle')
  const midiActivity    = ref(0)          // bumps on every inbound message → blink
  const midiLastLabel   = ref('')         // e.g. "CC10 = 64"
  const midiLearnTarget = ref(null)       // target id awaiting a CC to bind
  const midiLinks       = reactive([])    // { cc, ch, target, mode, smoothing, global, target_n, cur }

  const MIDI_TARGETS = {
    'master.volume': { label: 'Main Volume',  apply: v => setMasterVolume(v) },
    'master.pitch':  { label: 'Master Pitch', apply: v => setMasterPitch(v * 2 - 1) },
    'tempo':         { label: 'Tempo',        apply: v => { bpm.value = Math.round(40 + v * 180) } },
  }

  const MIDI_LS = 'fl.midi.links'
  function saveMidiLinks() {
    try {
      localStorage.setItem(MIDI_LS, JSON.stringify(
        midiLinks.filter(l => l.global).map(({ cc, ch, target, mode, smoothing, global }) => ({ cc, ch, target, mode, smoothing, global }))
      ))
    } catch (_) {}
  }
  function loadMidiLinks() {
    try { (JSON.parse(localStorage.getItem(MIDI_LS)) || []).forEach(l => midiLinks.push({ ...l, target_n: 0, cur: 0 })) } catch (_) {}
  }

  async function initMidi() {
    if (!navigator.requestMIDIAccess) return false
    try {
      const access = await navigator.requestMIDIAccess()
      midiEnabled.value = true
      const attach = () => access.inputs.forEach(inp => { inp.onmidimessage = handleMidi })
      attach()
      access.onstatechange = attach
      return true
    } catch (_) { return false }
  }

  // Transfer curve: linear 1:1, or log (low-end sensitivity, compressed top).
  function midiCurve(mode, x) {
    return mode === 'log' ? Math.log10(1 + 9 * x) : x
  }

  function handleMidi(e) {
    const [status, d1, d2] = e.data
    const type = status & 0xf0
    const ch   = status & 0x0f
    midiActivity.value++

    if (type === 0xb0) {                              // Control Change
      midiLastLabel.value = `CC${d1} = ${d2}`
      if (midiLearnTarget.value) {                   // learn mode: bind this CC
        addMidiLink(midiLearnTarget.value, d1, ch)
        midiLearnTarget.value = null
        return
      }
      const link = midiLinks.find(l => l.cc === d1 && (l.ch == null || l.ch === ch))
      if (link) {
        link.target_n = d2 / 127
        startMidiSmoothing()
        midiSyncState.value = link.global ? 'global' : 'volatile'
      } else {
        midiSyncState.value = 'unhandled'            // valid packet, no registered target
      }
    } else if (type === 0x90 && d2 > 0) {            // Note On
      midiLastLabel.value = `Note ${d1}`
      midiSyncState.value = 'unhandled'
    } else {
      midiSyncState.value = 'unhandled'
    }
  }

  function addMidiLink(target, cc, ch) {
    let l = midiLinks.find(x => x.target === target)
    if (l) { l.cc = cc; l.ch = ch }
    else { midiLinks.push({ cc, ch, target, mode: 'linear', smoothing: 0.3, global: false, target_n: 0, cur: 0 }) }
    saveMidiLinks()
  }
  function removeMidiLink(target) {
    const i = midiLinks.findIndex(l => l.target === target)
    if (i >= 0) midiLinks.splice(i, 1)
    saveMidiLinks()
  }
  function setLinkMode(target, mode)  { const l = midiLinks.find(x => x.target === target); if (l) { l.mode = mode; saveMidiLinks() } }
  function toggleLinkGlobal(target)   { const l = midiLinks.find(x => x.target === target); if (l) { l.global = !l.global; saveMidiLinks() } }
  function armMidiLearn(target)       { midiLearnTarget.value = target; if (!midiEnabled.value) initMidi() }
  function cancelMidiLearn()          { midiLearnTarget.value = null }

  // Parameter smoothing: a low-pass glide from cur → target_n so a violent knob
  // snap eases to its value rather than teleporting (prevents engine clicks).
  let _midiSmoothRaf = null
  function startMidiSmoothing() { if (!_midiSmoothRaf) _midiSmoothRaf = requestAnimationFrame(midiSmoothTick) }
  function midiSmoothTick() {
    let active = false
    midiLinks.forEach(l => {
      const diff = l.target_n - l.cur
      if (Math.abs(diff) > 0.0005) { l.cur += diff * (1 - l.smoothing); active = true }
      else l.cur = l.target_n
      const t = MIDI_TARGETS[l.target]
      if (t) t.apply(Math.max(0, Math.min(1, midiCurve(l.mode, l.cur))))
    })
    _midiSmoothRaf = active ? requestAnimationFrame(midiSmoothTick) : null
  }

  // Feed a raw MIDI byte array (used by virtual input / tests).
  function injectMidi(bytes) { handleMidi({ data: bytes }) }

  loadMidiLinks()

  let trackPanners    = []
  let cutGains        = []   // per-channel cut-self GainNode (null when cutSelf=false)
  let mixerInsertNodes = []  // [{ eqLow, eqMid, eqHigh, gain, panner, analyser }] per insert
  const audioLoad      = ref(0)   // audio-processing load: T_process / T_window (%)
  const audioUnderruns = ref(0)   // buffer-deadline misses (dropouts)
  let _loadSmooth      = 0

  // ── Polyphonic voice table ────────────────────────────────────────────────────
  //   Each scheduled/live generator registers an audio-time [start, end) window.
  //   The System Monitor polls getVoiceCount() to read how many are sounding now.
  const _voices = []
  function registerVoice(start, dur) {
    _voices.push({ start, end: start + Math.max(0.05, Math.min(4, dur || 0.28)) })
  }
  function getVoiceCount() {
    if (!audioCtx) return 0
    const now = audioCtx.currentTime
    let n = 0
    for (let i = _voices.length - 1; i >= 0; i--) {
      if (_voices[i].end <= now) _voices.splice(i, 1)        // free decayed voice
      else if (_voices[i].start <= now) n++                  // currently outputting
    }
    return n
  }

  function initAudio() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)()
      masterGain = audioCtx.createGain()
      masterGain.gain.value = mixerTracks[0].volume
      analyserNode = audioCtx.createAnalyser()
      analyserNode.fftSize = 256
      // Terminal output trim — the global Main Volume scales the whole mix just
      // before it exits to the hardware driver. Independent of the mixer master.
      outputGain = audioCtx.createGain()
      outputGain.gain.value = volToGain(masterVolume.value)
      // Brickwall limiter — catches the summed peaks when several voices land on
      // the same step so the mix can't exceed full-scale and hard-clip at the
      // hardware output (the gritty "particle" crackle on dense patterns).
      masterLimiter = audioCtx.createDynamicsCompressor()
      masterLimiter.threshold.value = -3      // engage just below full scale
      masterLimiter.knee.value      = 0       // hard knee → true limiting
      masterLimiter.ratio.value     = 20      // 20:1 ≈ brickwall
      masterLimiter.attack.value    = 0.002
      masterLimiter.release.value   = 0.1
      // Meters tap pre-limiter (analyserNode) so the user still sees true levels;
      // the limiter sits last, just before the output trim and destination.
      masterGain.connect(analyserNode)
      analyserNode.connect(masterLimiter)
      masterLimiter.connect(outputGain)
      outputGain.connect(audioCtx.destination)
      // Stereo scope taps: split the master into L/R analysers so the visualizer
      // can draw a true stereo waveform / spectrum, independent of fftSize tweaks.
      const split = audioCtx.createChannelSplitter(2)
      scopeAnalyserL = audioCtx.createAnalyser(); scopeAnalyserL.fftSize = 2048
      scopeAnalyserR = audioCtx.createAnalyser(); scopeAnalyserR.fftSize = 2048
      masterGain.connect(split)
      split.connect(scopeAnalyserL, 0)
      split.connect(scopeAnalyserR, 1)
      buildMixerInserts()
      _startSidechainLoop()
    }
    if (audioCtx.state === 'suspended') audioCtx.resume()
    rebuildGains()
  }

  function buildMixerInserts() {
    mixerInsertNodes = []
    mixerTracks.slice(1).forEach(mt => {
      const eqLow     = audioCtx.createBiquadFilter()
      const eqMid     = audioCtx.createBiquadFilter()
      const eqHigh    = audioCtx.createBiquadFilter()
      const phaseGain = audioCtx.createGain()
      const duckGain  = audioCtx.createGain()   // sidechain ducking lives here (1 = open)
      const gain      = audioCtx.createGain()
      const panner    = audioCtx.createStereoPanner()
      const analyser  = audioCtx.createAnalyser()
      analyser.fftSize = 256
      eqLow.type  = 'lowshelf';   eqLow.frequency.value  = 80;   eqLow.gain.value  = mt.eq.low
      eqMid.type  = 'peaking';    eqMid.frequency.value  = 1000; eqMid.Q.value = 1; eqMid.gain.value = mt.eq.mid
      eqHigh.type = 'highshelf';  eqHigh.frequency.value = 8000; eqHigh.gain.value = mt.eq.high
      phaseGain.gain.value = mt.phaseInvert ? -1 : 1
      duckGain.gain.value  = 1
      gain.gain.value  = mt.muted ? 0 : mt.volume
      panner.pan.value = mt.pan
      eqLow.connect(eqMid); eqMid.connect(eqHigh)
      phaseGain.connect(duckGain); duckGain.connect(gain); gain.connect(panner)
      panner.connect(analyser); analyser.connect(masterGain)
      const node = { eqLow, eqMid, eqHigh, phaseGain, duckGain, gain, panner, analyser, fxHandles: [], sendGains: {} }
      mixerInsertNodes.push(node)
      // Wire FX chain: eqHigh → [enabled fx slots] → phaseGain
      _wireMixerFxChain(node, mt)
    })
    // Second pass: post-fader send taps into the return buses.
    mixerTracks.slice(1).forEach((mt, i) => _wireMixerSends(mixerInsertNodes[i], mt))
  }

  // (Re)build the post-fader send taps from one track into the return buses.
  function _wireMixerSends(node, mt) {
    if (!node) return
    Object.values(node.sendGains).forEach(g => { try { g.disconnect() } catch (_) {} })
    node.sendGains = {}
    const sends = mt.sends ?? {}
    for (const rtnId of Object.keys(sends)) {
      const amt = sends[rtnId]
      if (!amt || amt <= 0) continue
      const rtnIdx  = mixerTracks.findIndex(t => t.id === rtnId)
      const rtnNode = rtnIdx >= 1 ? mixerInsertNodes[rtnIdx - 1] : null
      if (!rtnNode || rtnNode === node) continue   // skip missing / self-send
      const sg = audioCtx.createGain()
      sg.gain.value = amt
      node.panner.connect(sg)        // post-fader, post-pan tap
      sg.connect(rtnNode.eqLow)
      node.sendGains[rtnId] = sg
    }
  }

  function _wireMixerFxChain(node, mt) {
    try { node.eqHigh.disconnect() } catch (_) {}
    node.fxHandles.forEach(h => h?.dispose?.())
    node.fxHandles = (mt.fxSlots ?? []).map(fx => {
      if (!fx || !fx.enabled) return null
      try { return createEffect(audioCtx, fx) } catch (_) { return null }
    })
    let tail = node.eqHigh
    for (const h of node.fxHandles) {
      if (!h) continue
      tail.connect(h.input); tail = h.output
    }
    tail.connect(node.phaseGain)
  }

  function rebuildMixerInsert(trackIdx) {
    const node = mixerInsertNodes[trackIdx - 1]
    const mt   = mixerTracks[trackIdx]
    if (!node || !mt || !audioCtx) return
    _wireMixerFxChain(node, mt)
  }

  // ── Sends ────────────────────────────────────────────────────────────────────
  // amount 0..1 from a source track (index into mixerTracks) to a return bus.
  function setMixerSend(trackIdx, returnTrackId, amount) {
    const mt = mixerTracks[trackIdx]
    if (!mt || trackIdx === 0) return
    if (!mt.sends) mt.sends = {}
    const amt = Math.max(0, Math.min(1, amount))
    if (amt <= 0) delete mt.sends[returnTrackId]
    else mt.sends[returnTrackId] = amt
    const node = mixerInsertNodes[trackIdx - 1]
    if (node) {
      // Live-update an existing tap, or rewire if it didn't exist yet.
      const sg = node.sendGains[returnTrackId]
      if (sg && amt > 0) sg.gain.value = amt
      else _wireMixerSends(node, mt)
    }
    markDirty()
  }

  // ── Sidechain (envelope-follower duck keyed off another track) ───────────────
  function setMixerSidechain(trackIdx, patch) {
    const mt = mixerTracks[trackIdx]
    if (!mt) return
    mt.sidechain = { ...(mt.sidechain ?? { source: null, amount: 0, attack: 0.01, release: 0.18 }), ...patch }
    // When fully disabled, make sure the duck gain is wide open again.
    if ((!mt.sidechain.source && mt.sidechain.source !== 0) || mt.sidechain.amount <= 0) {
      const node = mixerInsertNodes[trackIdx - 1]
      if (node?.duckGain) node.duckGain.gain.value = 1
    }
    markDirty()
  }

  // Source level for a track index: 0 (master) → analyserNode, ≥1 → its analyser.
  function _trackLevel(srcIdx, scratch) {
    const an = srcIdx === 0 ? analyserNode : mixerInsertNodes[srcIdx - 1]?.analyser
    if (!an) return 0
    an.getByteTimeDomainData(scratch)
    let peak = 0
    for (let i = 0; i < scratch.length; i++) { const v = Math.abs(scratch[i] - 128) / 128; if (v > peak) peak = v }
    return peak
  }

  let _scAF = null
  const _scScratch = new Uint8Array(256)
  const _scSmooth  = {}   // trackIdx → smoothed source level
  function _tickSidechains() {
    if (!audioCtx) { _scAF = null; return }
    mixerTracks.forEach((mt, idx) => {
      if (idx === 0) return
      const sc = mt.sidechain
      const node = mixerInsertNodes[idx - 1]
      if (!node?.duckGain) return
      if (!sc || sc.amount <= 0 || (sc.source == null)) return
      const lvl = _trackLevel(sc.source, _scScratch)
      // Asymmetric smoothing: fast attack (duck quickly), slower release.
      const prev = _scSmooth[idx] ?? 0
      const coef = lvl > prev ? 0.6 : 0.12
      const sm   = prev + (lvl - prev) * coef
      _scSmooth[idx] = sm
      // duck = 1 - amount * level → louder source = more ducking.
      node.duckGain.gain.value = Math.max(0, 1 - sc.amount * sm)
    })
    _scAF = requestAnimationFrame(_tickSidechains)
  }
  function _startSidechainLoop() { if (!_scAF) _tickSidechains() }

  // Build the live insert-FX handles for a channel, aligned 1:1 with ch.effects
  // (disabled effects → null so the UI index still maps to a handle slot).
  function buildChannelFx(ch) {
    const list = ch.effects ?? []
    return list.map(fx => {
      if (!fx || !fx.enabled) return null
      try { return createEffect(audioCtx, fx) } catch (_) { return null }
    })
  }

  function disposeChannelFx() {
    channelFxChains.forEach(chain => chain?.forEach(h => h?.dispose?.()))
    channelFxChains.clear()
  }

  function rebuildGains() {
    if (!audioCtx || !masterGain) return
    // Disconnect WASM nodes from old track gains before they are destroyed
    wasmNodes.forEach(node => { try { node.disconnect() } catch (_) {} })
    trackGains.forEach(g => { try { g.disconnect() } catch (e) {} })
    trackPanners.forEach(p => { try { p.disconnect() } catch (e) {} })
    cutGains.forEach(cg => { if (cg) try { cg.disconnect() } catch (e) {} })
    disposeChannelFx()                       // tear down previous FX graphs (stop LFOs)
    trackGains = []; trackPanners = []; cutGains = []
    channels.forEach(ch => {
      const g = audioCtx.createGain(); g.gain.value = ch.volume
      const p = audioCtx.createStereoPanner(); p.pan.value = ch.pan
      g.connect(p)
      const mtIdx = ch.mixerTrack || 0
      const dest = (mtIdx >= 1 && mixerInsertNodes[mtIdx - 1])
        ? mixerInsertNodes[mtIdx - 1].eqLow
        : masterGain
      // Insert the channel's FX chain between its panner and the mixer/master.
      const chain = buildChannelFx(ch)
      channelFxChains.set(ch.id, chain)
      let tail = p
      for (const h of chain) { if (!h) continue; tail.connect(h.input); tail = h.output }
      tail.connect(dest)
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
      if (ch.type === 'subterra') {
        const node = subterraNodes.get(ch.id)
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

  function setMixerTrackColor(trackIdx, color) {
    const mt = mixerTracks[trackIdx]
    if (mt) { mt.color = color; markDirty() }
  }

  function toggleMixerPhaseInvert(trackIdx) {
    const mt = mixerTracks[trackIdx]
    if (!mt || trackIdx === 0) return
    mt.phaseInvert = !mt.phaseInvert
    const node = mixerInsertNodes[trackIdx - 1]
    if (node?.phaseGain) node.phaseGain.gain.value = mt.phaseInvert ? -1 : 1
    markDirty()
  }

  function addMixerTrackFx(trackIdx, type) {
    const mt = mixerTracks[trackIdx]
    if (!mt) return
    const fx = makeEffect(type)
    if (!fx) return
    if (!mt.fxSlots) mt.fxSlots = []
    mt.fxSlots.push(fx)
    if (trackIdx > 0) rebuildMixerInsert(trackIdx)
    markDirty()
  }

  function removeMixerTrackFx(trackIdx, slotIdx) {
    const mt = mixerTracks[trackIdx]
    if (!mt?.fxSlots || slotIdx < 0 || slotIdx >= mt.fxSlots.length) return
    mt.fxSlots.splice(slotIdx, 1)
    if (trackIdx > 0) rebuildMixerInsert(trackIdx)
    markDirty()
  }

  function updateMixerTrackFxParam(trackIdx, slotIdx, key, val) {
    const mt = mixerTracks[trackIdx]
    if (!mt?.fxSlots?.[slotIdx]) return
    mt.fxSlots[slotIdx][key] = val
    if (trackIdx > 0) mixerInsertNodes[trackIdx - 1]?.fxHandles?.[slotIdx]?.update(key, val)
    markDirty()
  }

  function toggleMixerTrackFxEnabled(trackIdx, slotIdx) {
    const mt = mixerTracks[trackIdx]
    if (!mt?.fxSlots?.[slotIdx]) return
    mt.fxSlots[slotIdx].enabled = !mt.fxSlots[slotIdx].enabled
    if (trackIdx > 0) rebuildMixerInsert(trackIdx)
    markDirty()
  }

  function moveMixerTrackFxSlot(trackIdx, slotIdx, dir) {
    const mt = mixerTracks[trackIdx]
    if (!mt?.fxSlots) return
    const b = slotIdx + dir
    if (b < 0 || b >= mt.fxSlots.length) return
    const tmp = mt.fxSlots[slotIdx]; mt.fxSlots[slotIdx] = mt.fxSlots[b]; mt.fxSlots[b] = tmp
    if (trackIdx > 0) rebuildMixerInsert(trackIdx)
    markDirty()
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

  // Swap an insert track with its neighbour (drag / Alt+arrow reorder). The track
  // descriptor + its routed channels move together; node settings are re-applied
  // to the new positions and the routing graph rebuilt.
  function moveMixerTrack(idx, dir) {
    const a = idx, b = idx + dir
    if (a < 1 || b < 1 || a > NUM_MX_INSERTS || b > NUM_MX_INSERTS) return false
    const t = mixerTracks[a]; mixerTracks[a] = mixerTracks[b]; mixerTracks[b] = t   // swap descriptors
    // Channels routed to either lane follow their track to its new slot.
    channels.forEach(ch => { if (ch.mixerTrack === a) ch.mixerTrack = -b; else if (ch.mixerTrack === b) ch.mixerTrack = -a })
    channels.forEach(ch => { if (ch.mixerTrack < 0) ch.mixerTrack = -ch.mixerTrack })
    // Re-apply each swapped descriptor's settings to the node living at that slot.
    ;[a, b].forEach(i => {
      const mt = mixerTracks[i], n = mixerInsertNodes[i - 1]
      if (!n) return
      n.gain.gain.value   = mt.muted ? 0 : mt.volume
      n.panner.pan.value  = mt.pan
      n.eqLow.gain.value  = mt.eq.low
      n.eqMid.gain.value  = mt.eq.mid
      n.eqHigh.gain.value = mt.eq.high
      if (n.phaseGain) n.phaseGain.gain.value = mt.phaseInvert ? -1 : 1
      _wireMixerFxChain(n, mt)
    })
    if (audioCtx) rebuildGains()
    markDirty()
    return true
  }

  // ── Loop region (red ruler selection — temporary playback loop override) ────────
  // null when inactive; overrides pattern-length for the scheduler when set.
  const loopRegion = ref(null)   // { startTick: number, endTick: number }
  function setLoopRegion(startTick, endTick) {
    const st = Math.max(0, startTick)
    const et = Math.max(st + TICKS_PER_STEP, endTick)
    loopRegion.value = { startTick: st, endTick: et }
  }
  function clearLoopRegion() { loopRegion.value = null }

  // ── Pattern length API ─────────────────────────────────────────────────────────
  // Auto-length = furthest note end tick across all piano channels in the pattern.
  // Falls back to totalSteps * TICKS_PER_STEP when the pattern has no piano notes.
  function getPatternAutoLengthTicks(patId) {
    const pid = patId ?? currentPatternId.value
    // If a manual override exists, skip the O(N) scan entirely
    if (patternLengthOverrides[pid] != null) return patternLengthOverrides[pid]
    const pd  = patternData[pid]
    let maxTick = totalSteps.value * TICKS_PER_STEP
    if (pd) {
      for (const d of Object.values(pd)) {
        if (!d?.pianoNotes) continue
        for (const n of d.pianoNotes) {
          const end = (n.startTick ?? 0) + (n.durationTicks ?? TICKS_PER_STEP)
          if (end > maxTick) maxTick = end
        }
      }
    }
    return maxTick
  }

  function getPatternLengthTicks(patId) {
    const pid = patId ?? currentPatternId.value
    return patternLengthOverrides[pid] ?? getPatternAutoLengthTicks(pid)
  }

  function setPatternLengthOverride(patId, ticks) { patternLengthOverrides[patId] = ticks }
  function clearPatternLengthOverride(patId)       { delete patternLengthOverrides[patId] }

  // ── Play-time note index ───────────────────────────────────────────────────────
  // Built from raw (non-Proxy) note data at play start so the scheduler hot path
  // never touches Vue Proxies. Key: "patId:chId", Value: Map<stepIndex, Note[]>.
  // stepIndex = Math.floor(note.startTick / TICKS_PER_STEP) — matches patternStep.
  let _playNotes = null

  function compilePlayNotes() {
    const rawPD = toRaw(patternData)
    const idx = new Map()
    for (const pid of Object.keys(rawPD)) {
      const pd = rawPD[pid]
      if (!pd) continue
      for (const cid of Object.keys(pd)) {
        const notes = toRaw(pd[cid]?.pianoNotes)
        if (!notes?.length) continue
        const byStep = new Map()
        for (const n of notes) {
          if (n.muted) continue
          const s = Math.floor((n.startTick ?? 0) / TICKS_PER_STEP)
          if (!byStep.has(s)) byStep.set(s, [])
          byStep.get(s).push(n)
        }
        idx.set(`${pid}:${cid}`, byStep)
      }
    }
    _playNotes = idx
  }

  // ── Scheduler ─────────────────────────────────────────────────────────────────
  const LOOK_AHEAD = 0.12
  const TICK_MS    = 25
  let schedulerTimer = null
  let nextNoteTime   = 0
  // Audio-clip scheduling: track which clips have been queued for the current play session.
  const _scheduledAudioClipIds = new Set()
  let   _activeAudioClipNodes  = []
  let schedStep      = 0
  let schedCell      = 0
  const noteQueue    = []
  let countInStepsLeft = 0   // steps remaining in pre-record count-in (0 = no count-in)
  let playbackStartAudioTime   = 0
  let playbackStartCellSeconds = 0
  let _lastBeat = -1   // last beat index emitted to beatTick (metronome pulse)

  // Returns clip descriptors for the given playlist cell.
  // Each descriptor carries the offset into the clip so multi-bar patterns
  // play the correct bar, and the clip boundary so truncated clips are silent
  // beyond their visible end.  slipOffset (in steps) shifts the playback window.
  function getClipsForCell(cell) {
    if (!usePlaylist.value) {
      // Channel-rack mode: single "virtual" clip with no boundary
      return [{ patternId: currentPatternId.value, clipOffset: 0, clipWidth: 0x7FFFFFFF, slipOffset: 0 }]
    }
    const playingTrackIds = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
    const cellMod = cell % PLAYLIST_CELLS
    return playlistClips
      .filter(c => {
        const w = c.width || 1
        // Audio clips are scheduled separately by scheduleAudioClips — excluding
        // them here stops an audio clip from triggering phantom pattern notes.
        return c.type !== 'audio' && cellMod >= c.cell && cellMod < c.cell + w && playingTrackIds.has(c.trackId) && !c.muted
      })
      .map(c => ({
        patternId:  c.patternId,
        clipOffset: cellMod - c.cell,   // cells into this clip (0 = first bar)
        clipWidth:  c.width || 1,       // total cells the clip spans
        slipOffset: c.slipOffset ?? 0,  // step shift for the slip tool
      }))
  }

  // Keep old name as a shim so any external callers still work
  function getPatternsForCell(cell) { return getClipsForCell(cell).map(c => c.patternId) }

  function scheduleStep(step, baseWhen, cell) {
    noteQueue.push({ step, time: baseWhen, cell: cell % PLAYLIST_CELLS, isSong: usePlaylist.value })
    syncVolumes()
    const secPerBeat = 60 / bpm.value
    const secPerStep = secPerBeat / 4                 // Δstep (a 16th note)
    const clips = getClipsForCell(cell)
    const rawChannels = toRaw(channels)
    rawChannels.forEach((ch, ci) => {
      if (ch.muted) return
      // Global swing (S∈[0,1]): even steps delayed by up to Δstep/3 → triplet groove.
      const swingMix = ch.swingMix ?? 1.0
      const swingOff = step % 2 === 1 ? swing.value * swingMix * (secPerStep / 3) : 0
      const when = baseWhen + swingOff
      const dest     = trackGains[ci] ?? audioCtx.destination
      const cutDest  = cutGains[ci]   ?? dest   // route through cutGain if cutSelf
      clips.forEach(({ patternId, clipOffset, clipWidth, slipOffset }) => {
        const d = getPatData(ch.id, patternId)
        if (ch.mode === 'steps') {
          // Step channels always loop within their loop-length window.
          const loopLen = ch.loopEnabled && ch.loopLength > 0 && ch.loopLength < totalSteps.value
            ? ch.loopLength : null
          const s = loopLen !== null ? step % loopLen : step
          if (d.steps[s]) {
            const vel      = d.stepVelocities?.[s] ?? 0.8
            const pitchOff = d.stepPitches?.[s]    ?? 0
            // Cut-self: a 2 ms fade-out/in de-clicks the choke.
            if (cutGains[ci]) {
              const cg = cutGains[ci].gain
              cg.cancelScheduledValues(when)
              cg.setValueAtTime(cg.value, when)
              cg.linearRampToValueAtTime(0.0001, when + 0.002)
              cg.linearRampToValueAtTime(1.0,    when + 0.004)
            }
            const basePitch = (ch.params.pitch ?? 60) + pitchOff
            if (ch.params.arpEnabled && ch.type === 'audiofile') {
              // Per-step ratchet/arp: the arp fills one step (lower the rate for rolls).
              _scheduleArp(audioCtx, ch, [basePitch], when, secPerStep, cutDest, { ...ch.params, velocity: vel })
            } else {
              ch.fn(audioCtx, when, { ...ch.params, pitch: basePitch, velocity: vel }, cutDest)
              registerVoice(when, (ch.params.release ?? ch.params.decay ?? 0.2) + 0.1)
            }
          }
        } else {
          // Piano channels: compute the absolute step within the pattern.
          // clipOffset advances by 1 each cell, so multi-bar patterns play the
          // correct bar on each successive cell.  slipOffset shifts the window.
          const patternStep = clipOffset * totalSteps.value + step + slipOffset
          // Enforce non-destructive clip boundary (Step 9: truncated clips play silence).
          if (patternStep >= clipWidth * totalSteps.value) return
          const secPerTick    = (60 / bpm.value) / 4 / TICKS_PER_STEP
          const stepStartTick = patternStep * TICKS_PER_STEP
          // Clip boundary in ticks: notes must not sustain past this point (Step 7).
          // This prevents note bleed when two clips play back-to-back on the same track.
          const clipEndTick = (slipOffset + clipWidth * totalSteps.value) * TICKS_PER_STEP
          // O(1) lookup into the pre-compiled step index — no Proxy, no .filter scan.
          const _byStep = _playNotes?.get(`${patternId}:${ch.id}`)
          const _stepNotes = _byStep?.get(patternStep)
          if (_stepNotes) {
            const rawParams = toRaw(ch.params)
            const arpOn = ch.params.arpEnabled && ch.type === 'audiofile'
            // Arp: group notes that start on the same tick into a chord, then
            // arpeggiate each chord across its (longest) note length.
            const arpGroups = arpOn ? new Map() : null
            for (const note of _stepNotes) {
              if (note.muted) continue
              const noteWhen    = when + (note.startTick - stepStartTick) * secPerTick
              const nominalGate = Math.max(0.05, (note.durationTicks ?? TICKS_PER_STEP) * secPerTick - 0.02)
              const ticksToEnd  = clipEndTick - note.startTick
              const gate = ticksToEnd > 0
                ? Math.min(nominalGate, Math.max(0.01, ticksToEnd * secPerTick - 0.005))
                : nominalGate
              if (arpOn) {
                let g = arpGroups.get(note.startTick)
                if (!g) { g = { when: noteWhen, span: 0, pitches: [], vel: note.velocity ?? 1 }; arpGroups.set(note.startTick, g) }
                g.pitches.push(note.pitch + masterPitchSemis.value)
                if (gate > g.span) g.span = gate
              } else {
                ch.fn(audioCtx, noteWhen, { ...rawParams, pitch: note.pitch + masterPitchSemis.value, velocity: note.velocity ?? 1, gate }, dest)
                registerVoice(noteWhen, gate + 0.12)
              }
            }
            if (arpGroups) for (const g of arpGroups.values())
              _scheduleArp(audioCtx, ch, g.pitches, g.when, g.span, dest, { ...rawParams, velocity: g.vel })
          }
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
    const secPerBeat = 60 / bpm.value * (halfSpeed.value ? 2 : 1)
    const secPerStep = secPerBeat / 4
    const steps = totalSteps.value
    // Loop Record OFF + armed → let the playhead run indefinitely so the user
    // can capture a continuous take beyond the pattern boundary.
    const infiniteRecord = !loopRecord.value && recordArmed.value && !usePlaylist.value
    // Otherwise: loop region → pattern-length override → auto-length.
    const loopEndTick = infiniteRecord
      ? null
      : (loopRegion.value?.endTick ?? (usePlaylist.value ? steps * TICKS_PER_STEP : getPatternLengthTicks(currentPatternId.value)))
    const effectiveSteps = infiniteRecord
      ? 0x3FFFFFFF   // ~1 billion — playhead never wraps during recording
      : (usePlaylist.value ? steps : Math.max(steps, Math.ceil(loopEndTick / TICKS_PER_STEP)))
    // Buffer-deadline miss: if the next event is already in the past, the
    // scheduler fell behind its window → register a dropout (underrun).
    if (nextNoteTime < audioCtx.currentTime - 0.001) audioUnderruns.value++
    // Count-in phase: fire metronome clicks, push beat events to noteQueue,
    // but do NOT schedule notes or advance the pattern step counter.
    while (countInStepsLeft > 0 && nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
      if (countInStepsLeft % 4 === 0) {
        const isAccent = countInStepsLeft % steps === 0
        scheduleMetroClick(nextNoteTime, isAccent)
        const barsLeft = Math.ceil((countInStepsLeft - 1) / steps)
        noteQueue.push({ countIn: true, time: nextNoteTime, barsLeft, accent: isAccent })
      }
      nextNoteTime += secPerStep
      countInStepsLeft--
    }
    if (countInStepsLeft > 0) return   // still counting in — skip note scheduling

    while (nextNoteTime < audioCtx.currentTime + LOOK_AHEAD) {
      // Pass base grid time — per-channel swing applied inside scheduleStep
      scheduleStep(schedStep % effectiveSteps, nextNoteTime, schedCell)
      // Metronome: one click per beat (4 steps/beat), accent on the downbeat (always at totalSteps boundary).
      if (metronomeOn.value && schedStep % 4 === 0) {
        scheduleMetroClick(nextNoteTime, metroAccent.value && schedStep % steps === 0)
      }
      nextNoteTime += secPerStep
      schedStep++
      if (schedStep % effectiveSteps === 0 && usePlaylist.value) schedCell++
    }
    scheduleAudioClips()
    // Audio processing load = compute time of this block / its time-window deadline.
    const elapsed = performance.now() - t0
    const load = (elapsed / TICK_MS) * 100
    if (load >= 100) audioUnderruns.value++          // compute overran its slice
    _loadSmooth = _loadSmooth * 0.8 + load * 0.2
    audioLoad.value = Math.min(100, Math.round(_loadSmooth))
  }

  function _stopActiveAudioClipNodes() {
    const now = audioCtx?.currentTime ?? 0
    _activeAudioClipNodes.forEach(({ src }) => {
      try { src.stop(now) } catch (_) {}
      try { src.disconnect() } catch (_) {}
    })
    _activeAudioClipNodes = []
    _scheduledAudioClipIds.clear()
  }

  function scheduleAudioClips() {
    if (!usePlaylist.value || !audioCtx) return
    const now        = audioCtx.currentTime
    const horizon    = now + LOOK_AHEAD + 0.5   // wider window; clips scheduled once
    const secPerCell = getSecPerCell()

    for (const clip of playlistClips) {
      if (clip.type !== 'audio' || clip.muted) continue
      if (_scheduledAudioClipIds.has(clip.id)) continue

      // Warp-aware buffer + rate (time-stretch modes → rate 1; repitch → rate).
      const buf  = getWarpedClipBuf(clip)
      if (!buf) continue
      const rate = warpClipRate(clip)

      const clipStart  = playbackStartAudioTime + (clip.cell - playbackStartCell.value) * secPerCell
      const startFrac  = clip.startOffset ?? 0
      const endFrac    = clip.endOffset   ?? 1
      // Real-time duration of the selected region (rate compresses repitch clips).
      const sampLen    = buf.duration * (endFrac - startFrac) / rate
      const clipEnd    = clipStart + sampLen

      if (clipEnd   < now     ) { _scheduledAudioClipIds.add(clip.id); continue }
      if (clipStart > horizon  ) continue

      _scheduledAudioClipIds.add(clip.id)

      // When seeking into the middle of a clip, offset the sample playback.
      // start()'s offset/duration args are in BUFFER seconds, so scale the
      // real-time seek by the playback rate.
      const seekOffset   = Math.max(0, now - clipStart)
      const sampleOffset = buf.duration * startFrac + seekOffset * rate
      const remaining    = (sampLen - seekOffset) * rate
      if (remaining <= 0) continue

      const when = Math.max(now + 0.005, clipStart)

      const src = audioCtx.createBufferSource()
      src.buffer = buf
      src.playbackRate.value = rate
      const g = audioCtx.createGain()
      g.gain.value = clip.volume ?? 1
      src.connect(g)
      // Route through the clip's mixer track insert (EQ/FX/pan/volume) when set,
      // otherwise straight to the mixer master bus.
      const mtIdx = clip.mixerTrack || 0
      const dest  = (mtIdx >= 1 && mixerInsertNodes[mtIdx - 1])
        ? mixerInsertNodes[mtIdx - 1].eqLow
        : masterGain
      g.connect(dest)
      src.start(when, sampleOffset, remaining)
      _activeAudioClipNodes.push({ src, g })
    }
  }

  function getSecPerCell() {
    return totalSteps.value * (60 / bpm.value) / 4
  }

  function getPlayheadTimeSeconds() {
    if (!isPlaying.value || !audioCtx) return displayCell.value * getSecPerCell()
    return playbackStartCellSeconds + Math.max(0, audioCtx.currentTime - playbackStartAudioTime)
  }

  // In PAT mode the timecode loops within the pattern so the timer resets to 0
  // each time the pattern completes.  In SONG mode it returns the absolute
  // song-position time.
  function getTimecodeSeconds() {
    if (!usePlaylist.value && isPlaying.value) {
      const absTime = getPlayheadTimeSeconds()
      const patTicks  = getPatternLengthTicks(currentPatternId.value)
      const secPerStep = (60 / bpm.value * (halfSpeed.value ? 2 : 1)) / 4
      const patLenSec  = (patTicks / TICKS_PER_STEP) * secPerStep
      if (patLenSec > 0) return absTime % patLenSec
      return absTime
    }
    return getPlayheadTimeSeconds()
  }

  // Live playlist scrub: instantly relocates the SONG-mode playhead during
  // active playback.  Flushes the scheduler buffer and resumes from `cell`.
  // No-op in PAT mode (the playlist playhead is frozen during pattern play).
  function seekTo(targetCell) {
    if (!usePlaylist.value) return
    const cell = Math.max(0, Math.min(PLAYLIST_CELLS - 1, Math.floor(targetCell)))
    displayCell.value      = cell
    playbackStartCell.value = cell
    if (!isPlaying.value || !audioCtx) return
    clearInterval(schedulerTimer)
    schedulerTimer  = null
    noteQueue.length = 0
    schedStep = 0
    schedCell = cell
    nextNoteTime              = audioCtx.currentTime + 0.02
    playbackStartAudioTime    = audioCtx.currentTime
    playbackStartCellSeconds  = cell * getSecPerCell()
    _lastBeat = -1
    _stopActiveAudioClipNodes()
    schedulerTimer = setInterval(tick, TICK_MS)
  }

  function drawLoop() {
    if (!isPlaying.value) return
    const now = audioCtx?.currentTime ?? 0
    while (noteQueue.length && noteQueue[0].time <= now + 0.01) {
      const entry = noteQueue.shift()
      if (entry.countIn) {
        // Count-in beat: flash visual indicators but don't advance playhead.
        countInBarsLeft.value = entry.barsLeft ?? 0
        beatAccent.value = entry.accent ?? false
        beatTick.value++
      } else {
        displayStep.value = entry.step
        if (entry.isSong) displayCell.value = entry.cell
        // Emit a beat pulse when the audio-locked playhead crosses a beat. This is
        // read off the look-ahead queue (already latency-compensated) so the visual
        // flash lands with the audible click, not after it.
        const beat = Math.floor(entry.step / 4)
        if (beat !== _lastBeat) {
          _lastBeat = beat
          beatAccent.value = entry.step === 0   // downbeat of the cell
          beatTick.value++
        }
      }
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
    _scheduledAudioClipIds.clear(); _activeAudioClipNodes = []
    noteQueue.length = 0; displayStep.value = -1; displayCell.value = startCell
    _lastBeat = -1
    // Overwrite mode: clear existing piano notes before recording starts (blend = false).
    if (recordArmed.value && !recordBlend.value && (recordFilters.value & RECORD_FLAGS.NOTES)) {
      const ch = selectedChannel.value
      if (ch?.mode === 'piano') {
        const d = getPatData(ch.id)
        d.pianoNotes.length = 0
      }
    }
    // Count-in: when record is armed and count-in is enabled, tick N bars before recording.
    if (recordArmed.value && recordCountIn.value) {
      countInStepsLeft = recordCountInBars.value * totalSteps.value
      countInBarsLeft.value = recordCountInBars.value
    } else {
      countInStepsLeft = 0
      countInBarsLeft.value = 0
    }
    compilePlayNotes()                  // snapshot notes as plain JS before entering hot loop
    isPlaying.value = true              // engine confirmed → transport state syncs
    transportState.value = 'playing'
    schedulerTimer = setInterval(tick, TICK_MS)
    requestAnimationFrame(drawLoop)
  }

  function pausePlay() {
    finalizeRecordedNotes()
    isPlaying.value = false
    transportState.value = 'paused'
    clearInterval(schedulerTimer); schedulerTimer = null
    noteQueue.length = 0; displayStep.value = -1
    countInStepsLeft = 0; countInBarsLeft.value = 0
    _playNotes = null   // rebuilt on next play so edits are picked up
    _stopActiveAudioClipNodes()
    // Playhead stays at current position (pause)
  }

  function stopPlay() {
    finalizeRecordedNotes()
    isPlaying.value = false
    transportState.value = 'stopped'
    clearInterval(schedulerTimer); schedulerTimer = null
    noteQueue.length = 0; displayStep.value = -1
    _stopActiveAudioClipNodes()
    if (rememberSeekTime.value) {
      // Keep playhead at the stopped position so next Play resumes from here.
      playbackStartCell.value = displayCell.value
    } else {
      displayCell.value = 0; playbackStartCell.value = 0
    }
    _lastBeat = -1
    countInStepsLeft = 0; countInBarsLeft.value = 0
    if (disarmOnStop.value) recordArmed.value = false
    _playNotes = null   // rebuilt on next play so edits are picked up
  }

  function togglePlay() {
    if (transportState.value === 'arming') return   // ignore clicks mid-handshake
    isPlaying.value ? pausePlay() : startPlay()
  }

  // Channel types whose DSP runs in a live AudioWorklet — they cannot be reproduced
  // inside an OfflineAudioContext, so the offline renderer skips them and the
  // realtime capture path records them through the live graph instead.
  const _WORKLET_TYPES = new Set(['wasm', 'custom', 'subterra'])
  function _offlineRenderable(ch) { return !_WORKLET_TYPES.has(ch?.type) }

  // ── Shared render scheduler ────────────────────────────────────────────────────
  //   Flattens a pattern- or song-render into a flat, channel-tagged event list
  //   using the EXACT same per-cell / per-step resolution as the live scheduler
  //   (scheduleStep), so an exported file lines up with playback: multi-bar
  //   patterns, slip offsets, clip boundaries, per-channel loop length, swing,
  //   cut-self and the sampler arp are all honoured. Both render paths consume it.
  //   Event kinds: 'note' (ch.fn), 'arp' (_scheduleArp), 'cut' (cut-self de-click);
  //   `cut:true` routes the note through the channel's cut-self gain.
  function _compileRenderSchedule({ mode = 'song', patternId: renderPatId = currentPatternId.value, bars = 2 } = {}) {
    const bpmV         = bpm.value
    const swingV       = swing.value
    const secPerStep   = (60 / bpmV) / 4
    const secPerTick   = secPerStep / TICKS_PER_STEP
    const stepsPerCell = totalSteps.value
    const masterPitch  = masterPitchSemis.value
    const rawChannels  = toRaw(channels)
    const START        = 0.01
    const isSong       = mode === 'song'
    const events       = []

    // Timeline length in steps.
    let totalRenderSteps, patSteps
    if (isSong) {
      const playing = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
      let cells = 0
      for (const c of playlistClips) {
        if (c.muted || !playing.has(c.trackId)) continue
        cells = Math.max(cells, c.cell + (c.width || 1))
      }
      totalRenderSteps = Math.max(stepsPerCell, cells * stepsPerCell)
      patSteps = stepsPerCell
    } else {
      patSteps = Math.max(stepsPerCell, Math.ceil(getPatternLengthTicks(renderPatId) / TICKS_PER_STEP))
      totalRenderSteps = patSteps * Math.max(1, bars)
    }

    // Raw (no-Proxy) per-(pattern:channel) note index, built lazily.
    const byStepCache = new Map()
    const offByStep = (pid, cid) => {
      const key = pid + ':' + cid
      if (byStepCache.has(key)) return byStepCache.get(key)
      const notes = toRaw(patternData[pid]?.[cid]?.pianoNotes)
      let bs = null
      if (notes?.length) {
        bs = new Map()
        for (const n of notes) {
          if (n.muted) continue
          const s = Math.floor((n.startTick ?? 0) / TICKS_PER_STEP)
          if (!bs.has(s)) bs.set(s, [])
          bs.get(s).push(n)
        }
      }
      byStepCache.set(key, bs)
      return bs
    }

    const clipsForCell = (cell) => {
      if (!isSong) return [{ patternId: renderPatId, clipOffset: 0, clipWidth: 0x7FFFFFFF, slipOffset: 0 }]
      const playingTrackIds = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
      return playlistClips
        .filter(c => c.type !== 'audio' && cell >= c.cell && cell < c.cell + (c.width || 1) && playingTrackIds.has(c.trackId) && !c.muted)
        .map(c => ({ patternId: c.patternId, clipOffset: cell - c.cell, clipWidth: c.width || 1, slipOffset: c.slipOffset ?? 0 }))
    }

    for (let abs = 0; abs < totalRenderSteps; abs++) {
      const cell = isSong ? Math.floor(abs / stepsPerCell) : 0
      const step = isSong ? (abs % stepsPerCell) : (abs % patSteps)
      const clips = clipsForCell(cell)
      rawChannels.forEach((ch, ci) => {
        if (ch.muted) return
        const swingMix = ch.swingMix ?? 1
        const swingOff = step % 2 === 1 ? swingV * swingMix * (secPerStep / 3) : 0
        const when = START + abs * secPerStep + swingOff
        clips.forEach(({ patternId, clipOffset, clipWidth, slipOffset }) => {
          const d = getPatData(ch.id, patternId)
          if (ch.mode === 'steps') {
            const loopLen = ch.loopEnabled && ch.loopLength > 0 && ch.loopLength < stepsPerCell ? ch.loopLength : null
            const s = loopLen !== null ? step % loopLen : step
            if (!d.steps[s]) return
            const vel      = d.stepVelocities?.[s] ?? 0.8
            const pitchOff = d.stepPitches?.[s]    ?? 0
            if (ch.cutSelf) events.push({ kind: 'cut', ci, when })
            const basePitch = (ch.params.pitch ?? 60) + pitchOff
            if (ch.params.arpEnabled && ch.type === 'audiofile') {
              events.push({ kind: 'arp', ci, cut: true, when, span: secPerStep, pitches: [basePitch], baseParams: { ...ch.params, velocity: vel } })
            } else {
              events.push({ kind: 'note', ci, cut: true, when, params: { ...ch.params, pitch: basePitch, velocity: vel } })
            }
          } else {
            const patternStep = clipOffset * stepsPerCell + step + slipOffset
            if (patternStep >= clipWidth * stepsPerCell) return
            const stepStartTick = patternStep * TICKS_PER_STEP
            const clipEndTick   = (slipOffset + clipWidth * stepsPerCell) * TICKS_PER_STEP
            const byStep    = offByStep(patternId, ch.id)
            const stepNotes = byStep?.get(patternStep)
            if (!stepNotes) return
            const arpOn = ch.params.arpEnabled && ch.type === 'audiofile'
            const arpGroups = arpOn ? new Map() : null
            for (const note of stepNotes) {
              if (note.muted) continue
              const noteWhen    = when + (note.startTick - stepStartTick) * secPerTick
              const nominalGate = Math.max(0.05, (note.durationTicks ?? TICKS_PER_STEP) * secPerTick - 0.02)
              const ticksToEnd  = clipEndTick - note.startTick
              const gate = ticksToEnd > 0 ? Math.min(nominalGate, Math.max(0.01, ticksToEnd * secPerTick - 0.005)) : nominalGate
              if (arpOn) {
                let g = arpGroups.get(note.startTick)
                if (!g) { g = { when: noteWhen, span: 0, pitches: [], vel: note.velocity ?? 1 }; arpGroups.set(note.startTick, g) }
                g.pitches.push(note.pitch + masterPitch)
                if (gate > g.span) g.span = gate
              } else {
                events.push({ kind: 'note', ci, cut: false, when: noteWhen, params: { ...ch.params, pitch: note.pitch + masterPitch, velocity: note.velocity ?? 1, gate } })
              }
            }
            if (arpGroups) for (const g of arpGroups.values())
              events.push({ kind: 'arp', ci, cut: false, when: g.when, span: g.span, pitches: g.pitches, baseParams: { ...ch.params, velocity: g.vel } })
          }
        })
      })
    }

    return { events, totalRenderSteps, secPerStep, START }
  }

  // ── Faithful offline render ────────────────────────────────────────────────────
  //   Renders the project (song or single pattern) to an AudioBuffer through a full
  //   offline rebuild of the live signal chain: per-channel volume/pan + insert FX,
  //   mixer-track EQ/FX/volume/pan + sends, playlist audio clips, and the master
  //   limiter — so the export sounds like playback. Worklet-plugin channels are
  //   skipped (captured separately in real time and mixed in afterwards).
  async function renderProjectToBuffer(opts = {}) {
    const {
      mode = 'song',
      patternId: renderPatId = currentPatternId.value,
      bars = 2,
      sampleRate = 44100,
      tail = 3.5,
      normalize = true,
    } = opts

    const bpmV         = bpm.value
    const secPerStep   = (60 / bpmV) / 4
    const stepsPerCell = totalSteps.value
    const secPerCell   = stepsPerCell * secPerStep
    const rawChannels  = toRaw(channels)
    const START        = 0.01

    const { events, totalRenderSteps } = _compileRenderSchedule({ mode, patternId: renderPatId, bars })

    // Total run length: last scheduled voice end, extended by any audio clip that
    // rings past it, plus the requested tail.
    let contentSec = totalRenderSteps * secPerStep
    for (const ev of events) {
      const end = ev.when + (ev.kind === 'arp' ? ev.span : (ev.params?.gate ?? 0.35))
      if (end > contentSec) contentSec = end
    }

    // Resolve playlist audio clips (song mode only — the playlist owns them).
    const playingTracks = new Set(playlistTracks.filter(t => !t.muted).map(t => t.id))
    const audioClips = []
    if (mode === 'song') {
      for (const clip of playlistClips) {
        if (clip.type !== 'audio' || clip.muted || !playingTracks.has(clip.trackId)) continue
        const buf = getWarpedClipBuf(clip)
        if (!buf) continue
        const rate      = warpClipRate(clip)
        const startFrac = clip.startOffset ?? 0
        const endFrac   = clip.endOffset   ?? 1
        const sampLen   = buf.duration * (endFrac - startFrac) / rate
        const when      = START + clip.cell * secPerCell
        audioClips.push({ clip, buf, rate, startFrac, sampLen, when })
        if (when + sampLen > contentSec) contentSec = when + sampLen
      }
    }

    const totalFrames = Math.max(1, Math.ceil(sampleRate * (contentSec + tail)))
    const offCtx = new OfflineAudioContext(2, totalFrames, sampleRate)

    // Master bus: mixer-master fader → brickwall limiter → destination. (Mirrors
    // initAudio; the post-limiter monitor trim is a live-only control, excluded.)
    const masterGainOff = offCtx.createGain()
    masterGainOff.gain.value = mixerTracks[0]?.muted ? 0 : (mixerTracks[0]?.volume ?? 1)
    const limiter = offCtx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value      = 0
    limiter.ratio.value     = 20
    limiter.attack.value    = 0.002
    limiter.release.value   = 0.1
    masterGainOff.connect(limiter)
    limiter.connect(offCtx.destination)

    // Mixer inserts (mirror buildMixerInserts). Sidechain ducking is dynamic in the
    // live engine; offline leaves the duck gain open (EQ + FX + sends still render).
    const inserts = mixerTracks.slice(1).map(mt => {
      const eqLow  = offCtx.createBiquadFilter()
      const eqMid  = offCtx.createBiquadFilter()
      const eqHigh = offCtx.createBiquadFilter()
      const gain   = offCtx.createGain()
      const panner = offCtx.createStereoPanner()
      eqLow.type  = 'lowshelf';  eqLow.frequency.value  = 80;   eqLow.gain.value  = mt.eq.low
      eqMid.type  = 'peaking';   eqMid.frequency.value  = 1000; eqMid.Q.value = 1; eqMid.gain.value = mt.eq.mid
      eqHigh.type = 'highshelf'; eqHigh.frequency.value = 8000; eqHigh.gain.value = mt.eq.high
      gain.gain.value  = mt.muted ? 0 : mt.volume
      panner.pan.value = mt.pan
      eqLow.connect(eqMid); eqMid.connect(eqHigh)
      let tail = eqHigh
      ;(mt.fxSlots ?? []).forEach(fx => {
        if (!fx || !fx.enabled) return
        let h; try { h = createEffect(offCtx, fx) } catch (_) { h = null }
        if (h) { tail.connect(h.input); tail = h.output }
      })
      const phase = offCtx.createGain(); phase.gain.value = mt.phaseInvert ? -1 : 1
      tail.connect(phase); phase.connect(gain); gain.connect(panner)
      panner.connect(masterGainOff)
      return { id: mt.id, eqLow, panner, sendGains: {} }
    })
    const insertById = id => inserts.find(n => n.id === id)
    // Post-fader send taps into the return buses.
    mixerTracks.slice(1).forEach((mt, i) => {
      const node = inserts[i]
      const sends = mt.sends ?? {}
      for (const rtnId of Object.keys(sends)) {
        const amt = sends[rtnId]
        if (!amt || amt <= 0) continue
        const rtn = insertById(rtnId)
        if (!rtn || rtn === node) continue
        const sg = offCtx.createGain(); sg.gain.value = amt
        node.panner.connect(sg); sg.connect(rtn.eqLow)
        node.sendGains[rtnId] = sg
      }
    })
    const insertDest = mtIdx => (mtIdx >= 1 && inserts[mtIdx - 1]) ? inserts[mtIdx - 1].eqLow : masterGainOff

    // Pre-decode GM soundfonts into THIS offline context.
    const gmProgs = [...new Set(
      rawChannels.filter(c => !c.muted && _offlineRenderable(c) && c.params?.gmProgram != null)
                 .map(c => Math.max(0, Math.min(127, c.params.gmProgram)))
    )]
    if (gmProgs.length) {
      try { await Promise.all(gmProgs.map(p => preloadGMInstrument(offCtx, p))) } catch (_) {}
    }

    // Per-channel routing: fn → [cut] → gain(vol) → pan → insert FX → mixer/master.
    const gainNode = new Array(rawChannels.length).fill(null)
    const cutNode  = new Array(rawChannels.length).fill(null)
    rawChannels.forEach((ch, ci) => {
      if (ch.muted || !_offlineRenderable(ch)) return
      const g = offCtx.createGain(); g.gain.value = ch.volume ?? 1
      const p = offCtx.createStereoPanner(); p.pan.value = ch.pan ?? 0
      g.connect(p)
      let tail = p
      ;(ch.effects ?? []).forEach(fx => {
        if (!fx || !fx.enabled) return
        let h; try { h = createEffect(offCtx, fx) } catch (_) { h = null }
        if (h) { tail.connect(h.input); tail = h.output }
      })
      tail.connect(insertDest(ch.mixerTrack || 0))
      gainNode[ci] = g
      if (ch.cutSelf) { const cg = offCtx.createGain(); cg.gain.value = 1; cg.connect(g); cutNode[ci] = cg }
    })

    // Dispatch the schedule into the offline graph.
    for (const ev of events) {
      const ci = ev.ci
      const ch = rawChannels[ci]
      if (!ch || !_offlineRenderable(ch) || !gainNode[ci]) continue
      const dest = ev.cut ? (cutNode[ci] ?? gainNode[ci]) : gainNode[ci]
      if (ev.kind === 'cut') {
        const cg = cutNode[ci]; if (!cg) continue
        cg.gain.cancelScheduledValues(ev.when)
        cg.gain.setValueAtTime(cg.gain.value, ev.when)
        cg.gain.linearRampToValueAtTime(0.0001, ev.when + 0.002)
        cg.gain.linearRampToValueAtTime(1.0,    ev.when + 0.004)
      } else if (ev.kind === 'arp') {
        _scheduleArp(offCtx, ch, ev.pitches, ev.when, ev.span, dest, ev.baseParams)
      } else {
        try { ch.fn(offCtx, ev.when, ev.params, dest) } catch (_) {}
      }
    }

    // Playlist audio clips.
    for (const a of audioClips) {
      const src = offCtx.createBufferSource()
      src.buffer = a.buf
      src.playbackRate.value = a.rate
      const g = offCtx.createGain(); g.gain.value = a.clip.volume ?? 1
      src.connect(g)
      g.connect(insertDest(a.clip.mixerTrack || 0))
      src.start(a.when, a.buf.duration * a.startFrac, a.sampLen * a.rate)
    }

    const rendered = await offCtx.startRendering()
    if (normalize) {
      let peak = 0
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c)
        for (let i = 0; i < data.length; i++) { const v = Math.abs(data[i]); if (v > peak) peak = v }
      }
      if (peak > 0 && peak < 0.97) {
        const gnorm = 0.97 / peak
        for (let c = 0; c < rendered.numberOfChannels; c++) {
          const data = rendered.getChannelData(c)
          for (let i = 0; i < data.length; i++) data[i] *= gnorm
        }
      }
    }
    return rendered
  }

  // ── Real-time render capture (live AudioWorklet plugin channels) ────────────────
  //   OfflineAudioContext can't host the plugin worklets, so those channels are
  //   played through the *live* graph and captured at the limited master bus. Uses
  //   the same compiled schedule as the offline render, filtered to worklet
  //   channels, so the captured part lines up with the offline remainder when mixed.
  async function renderRealtimeToBuffer(opts = {}) {
    const { tail = 3, normalize = true, onProgress } = opts

    initAudio()
    if (isPlaying.value) stopPlay()
    try { await audioCtx.resume() } catch (_) {}

    const rawChannels = toRaw(channels)
    const { events } = _compileRenderSchedule(opts)
    const wk = events
      .filter(e => { const ch = rawChannels[e.ci]; return ch && !_offlineRenderable(ch) })
      .sort((a, b) => a.when - b.when)

    if (!wk.length) return audioCtx.createBuffer(2, 1, audioCtx.sampleRate)

    // GM soundfonts used by any worklet-adjacent channel (rare, but harmless).
    const gmProgs = [...new Set(
      rawChannels.filter(c => !c.muted && c.params?.gmProgram != null)
                 .map(c => Math.max(0, Math.min(127, c.params.gmProgram)))
    )]
    if (gmProgs.length) {
      try { await Promise.all(gmProgs.map(p => preloadGMInstrument(audioCtx, p))) } catch (_) {}
    }

    // Capture only as long as the worklet parts actually play, plus the tail.
    let contentSec = 0
    for (const ev of wk) {
      const end = ev.when + (ev.kind === 'arp' ? ev.span : (ev.params?.gate ?? 0.35))
      if (end > contentSec) contentSec = end
    }
    const captureSec = contentSec

    // Recorder tap on the limited master bus (post mixer + limiter, pre monitor trim).
    const rec      = audioCtx.createScriptProcessor(4096, 2, 2)
    const chunksL  = []
    const chunksR  = []
    const startAt  = audioCtx.currentTime + 0.3
    const endAt    = startAt + captureSec + tail
    let   armed    = false
    rec.onaudioprocess = (e) => {
      if (!armed) { if (audioCtx.currentTime < startAt) return; armed = true }
      if (audioCtx.currentTime > endAt + 0.2) return
      chunksL.push(e.inputBuffer.getChannelData(0).slice(0))
      chunksR.push(e.inputBuffer.getChannelData(1).slice(0))
    }
    masterLimiter.connect(rec)
    const sink = audioCtx.createGain(); sink.gain.value = 0   // keep the processor pulled without re-outputting
    rec.connect(sink); sink.connect(audioCtx.destination)

    // Real-time lookahead dispatch: fire events ~0.3 s before they sound.
    const LOOK = 0.3
    let ei = 0
    await new Promise(resolve => {
      const iv = setInterval(() => {
        const now = audioCtx.currentTime
        while (ei < wk.length && startAt + wk[ei].when <= now + LOOK) {
          const ev = wk[ei++]
          const ci = ev.ci
          const ch = rawChannels[ci]
          const dest = ev.cut ? (cutGains[ci] ?? trackGains[ci] ?? masterGain) : (trackGains[ci] ?? masterGain)
          try {
            if (ev.kind === 'cut') {
              const cg = cutGains[ci]
              if (cg) {
                const t = startAt + ev.when
                cg.gain.cancelScheduledValues(t)
                cg.gain.setValueAtTime(cg.gain.value, t)
                cg.gain.linearRampToValueAtTime(0.0001, t + 0.002)
                cg.gain.linearRampToValueAtTime(1.0, t + 0.004)
              }
            } else if (ev.kind === 'arp') {
              _scheduleArp(audioCtx, ch, ev.pitches, startAt + ev.when, ev.span, dest, ev.baseParams)
            } else {
              ch.fn(audioCtx, startAt + ev.when, ev.params, dest)
            }
          } catch (_) {}
        }
        if (onProgress) onProgress(Math.max(0, Math.min(0.99, (now - startAt) / (captureSec + tail))))
        if (now >= endAt) { clearInterval(iv); resolve() }
      }, 25)
    })

    try { masterLimiter.disconnect(rec) } catch (_) {}
    try { rec.disconnect() } catch (_) {}
    try { sink.disconnect() } catch (_) {}
    rec.onaudioprocess = null

    // Assemble captured chunks into an AudioBuffer.
    const sr     = audioCtx.sampleRate
    const want   = Math.max(1, Math.ceil((captureSec + tail) * sr))
    const total  = chunksL.reduce((a, c) => a + c.length, 0)
    const frames = Math.min(want, total || 1)
    const buf    = audioCtx.createBuffer(2, frames, sr)
    const outL = buf.getChannelData(0), outR = buf.getChannelData(1)
    let off = 0
    for (let i = 0; i < chunksL.length && off < frames; i++) {
      const cL = chunksL[i], cR = chunksR[i]
      for (let j = 0; j < cL.length && off < frames; j++, off++) { outL[off] = cL[j]; outR[off] = cR[j] }
    }

    if (normalize) {
      let peak = 0
      for (let i = 0; i < frames; i++) { const a = Math.abs(outL[i]), b = Math.abs(outR[i]); if (a > peak) peak = a; if (b > peak) peak = b }
      if (peak > 0 && peak < 0.97) {
        const g = 0.97 / peak
        for (let i = 0; i < frames; i++) { outL[i] *= g; outR[i] *= g }
      }
    }
    return buf
  }

  // ── Keyboard live play ────────────────────────────────────────────────────────
  const pressedKeys     = new Set()
  const pressedKeyPitch = new Map()  // key code → MIDI pitch (so keyUp knows what to stop)

  // Held-voice registry for continuous built-in synths (sawtooth / FM / GM).
  // Maps `${channelId}:${pitch}` → { release(when) }. A live note on a sustaining
  // voice is kept open and only ends when the key is released — so the sound lasts
  // exactly as long as the key is held, with a release tail.
  const liveVoices = new Map()
  const HOLD_MAX   = 30   // s — upper bound a single held note can sustain (oscillator safety cap)

  function _releaseLiveVoice(key, when) {
    const v = liveVoices.get(key)
    if (!v) return
    liveVoices.delete(key)
    try { v.release(when) } catch (_) {}
  }

  // ── Arpeggiator (Sampler "misc functions" arp) ───────────────────────────────
  //   Note rates are expressed in beats so the arp always follows project tempo.
  //   Works in three contexts: step sequencer (ratchets per step), piano roll
  //   (held chords arpeggiate across the note length), and live audition.
  const ARP_DIVISIONS = {
    '1/4': 1, '1/4T': 2 / 3, '1/8': 0.5, '1/8T': 1 / 3,
    '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125,
  }

  // Build the ordered pitch ladder a chord arpeggiates through.
  function _arpLadder(basePitches, range, mode) {
    const sorted = [...new Set(basePitches)].sort((a, b) => a - b)
    let lad = []
    for (let o = 0; o < Math.max(1, range || 1); o++) for (const p of sorted) lad.push(p + 12 * o)
    if (mode === 'down') lad.reverse()
    else if (mode === 'updown' && lad.length > 2) lad = lad.concat(lad.slice(1, -1).reverse())
    return lad
  }

  // Offline arp expansion used by the scheduler: schedule a run of notes across
  // `spanSec`, starting at `when`. Pitches must already include any master shift.
  function _scheduleArp(ctx, ch, basePitches, when, spanSec, dest, baseParams) {
    if (!ch.fn) return
    const secPerBeat = 60 / bpm.value
    const stepSec = Math.max(0.02, (ARP_DIVISIONS[ch.params.arpRate] ?? 0.25) * secPerBeat)
    const mode = ch.params.arpMode ?? 'up'
    const lad  = _arpLadder(basePitches, ch.params.arpRange ?? 1, mode)
    if (!lad.length) return
    const gateFrac = ch.params.arpGate ?? 0.5
    // Each arp note is a discrete one-shot (never inherit fwd/ping-pong looping,
    // which would leave every arp note ringing forever).
    const np = { ...baseParams, loopMode: 'off' }
    let i = 0
    for (let t = 0; t < spanSec - 0.0005; t += stepSec) {
      const pitch = mode === 'random' ? lad[(Math.random() * lad.length) | 0] : lad[i % lad.length]
      const gate  = Math.max(0.02, stepSec * gateFrac)
      ch.fn(ctx, when + t, { ...np, pitch, gate }, dest)
      if (ctx === audioCtx) registerVoice(when + t, gate + 0.1)
      i++
    }
  }

  // Live arp clock — drives held audition / QWERTY notes for arp-enabled samplers.
  const _liveArp = new Map()        // channelId -> { held:[], idx, nextTime }
  let _arpClockOn = false

  function _arpDest(ch) {
    const ci = channels.indexOf(ch)
    return (ci >= 0 && trackGains[ci]) ? trackGains[ci] : audioCtx.destination
  }

  function _ensureArpClock() {
    if (_arpClockOn) return
    _arpClockOn = true
    const loop = () => {
      if (!_liveArp.size || !audioCtx) { _arpClockOn = false; return }
      const now = audioCtx.currentTime, ahead = now + 0.12
      const secPerBeat = 60 / bpm.value
      for (const [cid, st] of _liveArp) {
        const ch = channels.find(c => c.id === cid)
        if (!ch || !st.held.length || !ch.params?.arpEnabled) { _liveArp.delete(cid); continue }
        const stepSec = Math.max(0.03, (ARP_DIVISIONS[ch.params.arpRate] ?? 0.25) * secPerBeat)
        const mode = ch.params.arpMode ?? 'up'
        const lad  = _arpLadder(st.held, ch.params.arpRange ?? 1, mode)
        if (!lad.length) continue
        if (st.nextTime < now) st.nextTime = now + 0.02
        while (st.nextTime < ahead) {
          const pitch = (mode === 'random' ? lad[(Math.random() * lad.length) | 0] : lad[st.idx % lad.length]) + masterPitchSemis.value
          const gate  = Math.max(0.02, stepSec * (ch.params.arpGate ?? 0.5))
          ch.fn(audioCtx, st.nextTime, { ...ch.params, loopMode: 'off', pitch, velocity: 1, gate }, _arpDest(ch))
          registerVoice(st.nextTime, gate + 0.1)
          st.idx++
          st.nextTime += stepSec
        }
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  function _liveArpNoteOn(ch, pitch) {
    let st = _liveArp.get(ch.id)
    if (!st) { st = { held: [], idx: 0, nextTime: 0 }; _liveArp.set(ch.id, st) }
    if (!st.held.includes(pitch)) st.held.push(pitch)
    _ensureArpClock()
  }
  function _liveArpNoteOff(ch, pitch) {
    const st = _liveArp.get(ch.id)
    if (!st) return
    st.held = st.held.filter(p => p !== pitch)
    if (!st.held.length) _liveArp.delete(ch.id)
  }

  // sustain=true → held voice that lasts until stopNote (live keyboard / piano keys).
  // sustain=false → brief one-shot audition (note drawing) with the instrument's
  // own natural decay; never leaves a voice open.
  function playNote(ch, pitch, sustain = true) {
    if (!audioCtx) initAudio()
    const ci   = channels.indexOf(ch)
    const dest = (ci >= 0 && trackGains[ci]) ? trackGains[ci] : audioCtx.destination
    const when = audioCtx.currentTime + 0.005
    const p    = pitch + masterPitchSemis.value
    const key  = ch.id + ':' + pitch

    // Retrigger: release any voice already sounding for this exact key first.
    _releaseLiveVoice(key, when)

    // VST2 instrument (native host): forward the note over IPC; audio comes from
    // the native engine, not the Web Audio graph.
    if (ch.type === 'vst') {
      sendToHost('vstNoteOn', { id: ch.id, pitch: p, velocity: 100 })
      // One-shot audition (drawing a note): auto-release so it doesn't hang.
      // Held notes (sustain=true, live keyboard) are released by stopNote on key-up.
      if (!sustain) setTimeout(() => sendToHost('vstNoteOff', { id: ch.id, pitch: p }), 250)
      registerVoice(when, 0.2)
      return
    }

    // Continuous built-in synths (sawtooth + FM): sustain the note open-ended via a
    // generous gate, routed through a dedicated release-gain so note-off applies a
    // controllable release tail regardless of the instrument's internal envelope.
    if (sustain && ch.sustains && ch.type === 'melodic') {
      const relGain = audioCtx.createGain()
      relGain.gain.value = 1
      relGain.connect(dest)
      ch.fn(audioCtx, when, { ...ch.params, pitch: p, velocity: 1, gate: HOLD_MAX, hold: true }, relGain)
      const relTime = Math.max(0.06, Math.min(2.5, ch.params.release ?? ch.params.decay ?? 0.4))
      liveVoices.set(key, {
        release(t) {
          const tt = Math.max(t ?? audioCtx.currentTime, audioCtx.currentTime)
          try {
            relGain.gain.cancelScheduledValues(tt)
            relGain.gain.setValueAtTime(Math.max(relGain.gain.value, 0.0001), tt)
            relGain.gain.exponentialRampToValueAtTime(0.0001, tt + relTime)
          } catch (_) {}
          setTimeout(() => { try { relGain.disconnect() } catch (_) {} }, (relTime + 0.2) * 1000)
        },
      })
      registerVoice(when, 1)
      return
    }

    // Continuous GM voices: loop-sustain the sample until note-off (node.stop runs
    // the ADSR release).
    if (sustain && ch.sustains && ch.type === 'gm') {
      const node = ch.fn(audioCtx, when, { ...ch.params, pitch: p, velocity: 1, hold: true }, dest)
      if (node) {
        liveVoices.set(key, {
          release(t) {
            const tt = Math.max(t ?? audioCtx.currentTime, audioCtx.currentTime)
            try { node.stop(tt) } catch (_) {}
          },
        })
      }
      registerVoice(when, 1)
      return
    }

    // Arp-enabled sampler: feed the live arp clock instead of one held voice.
    if (ch.type === 'audiofile' && ch.params?.arpEnabled) {
      _liveArpNoteOn(ch, pitch)
      registerVoice(when, 0.2)
      return
    }

    // Audio-file sampler: capture the returned voice so a held / looping note can
    // be released on note-off (a looping sample would otherwise ring forever). This
    // is what lets the live keyboard audition the sampler with its current settings.
    if (ch.type === 'audiofile') {
      const voice = ch.fn(audioCtx, when, { ...ch.params, pitch: p, velocity: 1 }, dest)
      if (voice && voice.src) {
        const entry = {
          release(t) {
            const tt   = Math.max(t ?? audioCtx.currentTime, audioCtx.currentTime)
            const relT = Math.max(0.02, Math.min(1.5, ch.params.envRelease ?? 0.2))
            try {
              const g = voice.ampGain.gain
              g.cancelScheduledValues(tt)
              g.setValueAtTime(Math.max(g.value, 0.0001), tt)
              g.exponentialRampToValueAtTime(0.0001, tt + relT)
              voice.src.stop(tt + relT + 0.03)
            } catch (_) {}
          },
        }
        liveVoices.set(key, entry)
        const prevEnded = voice.src.onended
        voice.src.onended = (e) => {
          if (typeof prevEnded === 'function') { try { prevEnded.call(voice.src, e) } catch (_) {} }
          if (liveVoices.get(key) === entry) liveVoices.delete(key)
        }
      }
      registerVoice(when, 0.5)
      return
    }

    // Plucked / percussive / one-shot voices: fire-and-forget, natural decay.
    ch.fn(audioCtx, when, { ...ch.params, pitch: p, velocity: 1 }, dest)
    registerVoice(when, (ch.params.release ?? ch.params.decay ?? 0.35) + 0.15)
  }

  // Stop an active note. Continuous built-in synths (sawtooth/FM/GM) release their
  // held voice here; plugin channels (WASM/JS/Custom/SUBTERRA) get a noteOff message.
  // Plucked/percussive Web-Audio voices self-stop, so this is a no-op for them.
  function stopNote(ch, pitch) {
    if (!ch || !audioCtx) return
    const t = audioCtx.currentTime + 0.005
    if (ch.type === 'audiofile' && ch.params?.arpEnabled) _liveArpNoteOff(ch, pitch)
    _releaseLiveVoice(ch.id + ':' + pitch, t)
    if (ch.type === 'vst') {
      sendToHost('vstNoteOff', { id: ch.id, pitch: pitch + masterPitchSemis.value })
    } else if (ch.type === 'wasm') {
      const node = wasmNodes.get(ch.id)
      if (node) node.port.postMessage({ type: 'noteOff', pitch, time: t })
    } else if (ch.type === 'custom') {
      const node = customSynthNodes.get(ch.id)
      if (node) node.port.postMessage({ type: 'noteOff', pitch, time: t })
    } else if (ch.type === 'subterra') {
      const node = subterraNodes.get(ch.id)
      if (node) node.port.postMessage({ type: 'noteOff', pitch, time: t })
    }
  }

  // ── Sampler audition (the preview keyboard in the Sampler panel) ─────────────
  //   Thin wrappers over playNote/stopNote so the on-screen keys behave EXACTLY
  //   like the QWERTY keys — hold, release, retrigger and proper mixer routing all
  //   handled by the unified voice path (audiofile voices now live in liveVoices).
  function auditionNoteOn(channelId, pitch) {
    const ch = channels.find(c => c.id === channelId)
    if (ch) playNote(ch, pitch)
  }
  function auditionNoteOff(channelId, pitch) {
    const ch = channels.find(c => c.id === channelId)
    if (ch) stopNote(ch, pitch)
  }

  // Safety net: if the window loses focus mid-hold the keyup may never arrive, so
  // release every held voice (otherwise a looping GM sample could ring forever).
  if (typeof window !== 'undefined') {
    window.addEventListener('blur', () => {
      _liveArp.clear()
      if (!audioCtx || !liveVoices.size) return
      const t = audioCtx.currentTime
      for (const key of [...liveVoices.keys()]) _releaseLiveVoice(key, t)
      pressedKeys.clear()
      pressedKeyPitch.clear()
    })
  }

  // Panic — instantly silence everything currently playing.
  // Stops the sequencer, releases held keys, sends all-notes-off to plugin
  // nodes, and briefly ducks the master gain to swallow any in-flight Web
  // Audio oscillator tails.
  function panicAll() {
    if (isPlaying.value) stopPlay()
    pressedKeys.clear()
    pressedKeyPitch.clear()
    _liveArp.clear()
    if (!audioCtx) return

    const t = audioCtx.currentTime
    // Release every held continuous voice immediately.
    for (const key of [...liveVoices.keys()]) _releaseLiveVoice(key, t)
    customSynthNodes.forEach(node => {
      try { node.port.postMessage({ type: 'allNotesOff', time: t }) } catch (_) {}
    })
    subterraNodes.forEach(node => {
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
    // Ctrl/Cmd combos are editor shortcuts (copy/paste/select-all/undo…), not
    // QWERTY musical keys — let them through to component handlers without
    // sounding a note. (Panic above is the one Ctrl shortcut we handle here.)
    if (e.ctrlKey || e.metaKey) return
    if (e.repeat) return
    // Keep the instrument playable while a slider is focused: let the musical keys
    // through when the focused element is a range slider (it ignores letter keys
    // anyway), so you can tweak a control and hear the change on the keyboard.
    const _tag = e.target.tagName
    const _slider = _tag === 'INPUT' && e.target.type === 'range'
    if (!_slider && (_tag === 'INPUT' || _tag === 'SELECT' || _tag === 'TEXTAREA')) return
    // Octave shift moved off [ and ] (now note keys) to - and =
    if (e.code === 'Minus')  { kbOctave.value = Math.max(0, kbOctave.value - 1); return }
    if (e.code === 'Equal')  { kbOctave.value = Math.min(8, kbOctave.value + 1); return }
    const semi = KB_SEMITONES[e.code]
    if (semi === undefined || pressedKeys.has(e.code)) return
    if (keyboardInputMode.value) e.preventDefault()
    pressedKeys.add(e.code)
    const pitch = 12 * (kbOctave.value + 1) + semi
    pressedKeyPitch.set(e.code, pitch)
    playNote(selectedChannel.value, pitch)

    // ── Score logger: always capture MIDI input (30-min rolling buffer) ──────────
    const t0 = performance.now() / 1000
    scoreLogBuffer.push({ pitch, t0, t1: null })
    const cutoff = t0 - SCORE_LOG_MAX_S
    while (scoreLogBuffer.length && scoreLogBuffer[0].t0 < cutoff) scoreLogBuffer.shift()

    // ── Live MIDI recording: arm + playing + NOTES filter + piano channel ────────
    if (audioCtx && isPlaying.value && recordArmed.value &&
        (recordFilters.value & RECORD_FLAGS.NOTES) &&
        selectedChannel.value?.mode === 'piano') {
      liveRecordNotes.set(e.code, { pitch, audioStartTime: audioCtx.currentTime })
    }
  }

  function handleKeyUp(e) {
    pressedKeys.delete(e.code)
    const pitch = pressedKeyPitch.get(e.code)
    if (pitch !== undefined) {
      stopNote(selectedChannel.value, pitch)
      pressedKeyPitch.delete(e.code)
    }

    // ── Score logger: close the note entry ───────────────────────────────────────
    const logEntry = [...scoreLogBuffer].reverse().find(n => n.pitch === pitch && n.t1 === null)
    if (logEntry) logEntry.t1 = performance.now() / 1000

    // ── Live recording: finalise and push the completed note ─────────────────────
    if (liveRecordNotes.has(e.code)) {
      const { pitch: rPitch, audioStartTime } = liveRecordNotes.get(e.code)
      liveRecordNotes.delete(e.code)
      if (audioCtx && isPlaying.value) {
        const secPerTick    = (60 / bpm.value) / 4 / TICKS_PER_STEP
        const startTick     = Math.max(0, Math.round((audioStartTime - playbackStartAudioTime) / secPerTick))
        const endTick       = Math.round((audioCtx.currentTime - playbackStartAudioTime) / secPerTick)
        const durationTicks = Math.max(TICKS_PER_STEP, endTick - startTick)
        const ch = selectedChannel.value
        if (ch?.mode === 'piano') {
          getPatData(ch.id).pianoNotes.push({ startTick, pitch: rPitch, velocity: 0.8, durationTicks })
        }
      }
    }
  }

  // Finalise any notes still held when the transport stops mid-recording.
  function finalizeRecordedNotes() {
    if (!liveRecordNotes.size) return
    const ch = selectedChannel.value
    liveRecordNotes.forEach(({ pitch: rPitch, audioStartTime }) => {
      if (!audioCtx || ch?.mode !== 'piano') return
      const secPerTick    = (60 / bpm.value) / 4 / TICKS_PER_STEP
      const startTick     = Math.max(0, Math.round((audioStartTime - playbackStartAudioTime) / secPerTick))
      const endTick       = Math.round((audioCtx.currentTime - playbackStartAudioTime) / secPerTick)
      const durationTicks = Math.max(TICKS_PER_STEP, endTick - startTick)
      getPatData(ch.id).pianoNotes.push({ startTick, pitch: rPitch, velocity: 0.8, durationTicks })
    })
    liveRecordNotes.clear()
  }

  // ── Score logger dump ──────────────────────────────────────────────────────────
  // Extract the last captured MIDI performance from the rolling buffer into the
  // currently selected piano channel, then open the Piano Roll to show the result.
  function dumpScoreLog() {
    const completed = scoreLogBuffer.filter(n => n.t1 !== null && n.t1 > n.t0)
    if (!completed.length) return
    const ch = channels.find(c => c.id === selectedChannelId.value)
    if (!ch || ch.mode !== 'piano') return

    pushUndo()
    const refTime    = completed[0].t0
    const secPerTick = (60 / bpm.value) / 4 / TICKS_PER_STEP
    const patData    = getPatData(ch.id)
    completed.forEach(({ pitch, t0, t1 }) => {
      const startTick     = Math.max(0, Math.round((t0 - refTime) / secPerTick))
      const durationTicks = Math.max(TICKS_PER_STEP, Math.round((t1 - t0) / secPerTick))
      patData.pianoNotes.push({ startTick, pitch, velocity: 0.8, durationTicks })
    })
    scoreLogBuffer.length = 0   // clear after dump
    pianoRollOpen.value = true
  }

  // ── Pattern editing ───────────────────────────────────────────────────────────
  function toggleStep(channelId, step) {
    pushUndo()
    const d = getPatData(channelId)
    d.steps[step] = !d.steps[step]
    const startTick = step * TICKS_PER_STEP
    const idx = d.pianoNotes.findIndex(n => n.startTick === startTick && n.pitch === STEPS_PITCH)
    if (d.steps[step]) {
      if (idx < 0) d.pianoNotes.push({ startTick, pitch: STEPS_PITCH, velocity: d.stepVelocities?.[step] ?? 0.8, durationTicks: TICKS_PER_STEP })
    } else {
      if (idx >= 0) d.pianoNotes.splice(idx, 1)
    }
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

  // Rebuild all C5 (STEPS_PITCH) pianoNotes from the steps[] boolean array.
  // Called whenever steps data changes on a steps-mode channel so the playlist
  // length calculation (which reads only pianoNotes) sees the correct pattern width.
  function syncStepsToPianoNotes(channelId, patternId) {
    const d = getPatData(channelId, patternId)
    for (let i = d.pianoNotes.length - 1; i >= 0; i--) {
      if (d.pianoNotes[i].pitch === STEPS_PITCH) d.pianoNotes.splice(i, 1)
    }
    d.steps.forEach((on, si) => {
      if (on) d.pianoNotes.push({
        startTick:     si * TICKS_PER_STEP,
        pitch:         STEPS_PITCH,
        velocity:      d.stepVelocities?.[si] ?? 0.8,
        durationTicks: TICKS_PER_STEP,
      })
    })
  }

  // Rebuild steps[] from C5 pianoNotes (used when switching back to steps mode
  // after the user may have drawn or erased C5 notes in the piano roll).
  function syncPianoNotesToSteps(channelId, patternId) {
    const d = getPatData(channelId, patternId)
    d.steps.fill(false)
    d.pianoNotes.forEach(n => {
      if (n.pitch === STEPS_PITCH) {
        const si = Math.round((n.startTick ?? 0) / TICKS_PER_STEP)
        if (si >= 0 && si < d.steps.length) d.steps[si] = true
      }
    })
  }

  // Switch a channel between 'steps' and 'piano' mode, keeping data in sync.
  function setChannelMode(channelId, mode) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch || ch.mode === mode) return
    if (mode === 'piano') {
      // Mirror steps → C5 pianoNotes across every pattern so piano roll shows them
      Object.keys(patternData).forEach(pid => {
        if (patternData[pid]?.[channelId]) syncStepsToPianoNotes(channelId, pid)
      })
    } else if (mode === 'steps') {
      // Rebuild steps[] from C5 pianoNotes in case user edited them in piano roll
      Object.keys(patternData).forEach(pid => {
        if (patternData[pid]?.[channelId]) syncPianoNotesToSteps(channelId, pid)
      })
    }
    ch.mode = mode
  }

  // ── Step-state bitmask ops (compact channel-lane representation) ───────────────
  //   A lane's on/off state maps to one integer bitmask; pattern transforms are
  //   pure bitwise ops. BigInt scales the mask cleanly past 32 steps.
  function getStepMask(channelId, len = totalSteps.value, patternId) {
    const s = getSteps(channelId, patternId)
    let m = 0n
    for (let i = 0; i < len; i++) if (s[i]) m |= (1n << BigInt(i))
    return m
  }
  function setStepMask(channelId, mask, len = totalSteps.value, patternId) {
    const s = getSteps(channelId, patternId)
    for (let i = 0; i < len; i++) s[i] = ((mask >> BigInt(i)) & 1n) === 1n
    syncStepsToPianoNotes(channelId, patternId)
  }
  function rotateSteps(channelId, dir = 1, len = totalSteps.value) {
    pushUndo()
    const full = (1n << BigInt(len)) - 1n
    let m = getStepMask(channelId, len) & full
    m = dir > 0
      ? ((m << 1n) | (m >> BigInt(len - 1))) & full     // shift → (wrap top to bottom)
      : ((m >> 1n) | (m << BigInt(len - 1))) & full     // shift ← (wrap bottom to top)
    setStepMask(channelId, m, len)
  }
  function invertSteps(channelId, len = totalSteps.value) {
    pushUndo()
    const full = (1n << BigInt(len)) - 1n
    setStepMask(channelId, (~getStepMask(channelId, len)) & full, len)
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
      sustains: true,   // sawtooth synth is a continuous voice
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function addFMChannel(presetKey) {
    const preset = FM_PRESETS[presetKey]
    if (!preset) return
    const ch = makeChannel({
      name:     preset.name,
      color:    preset.color,
      sustains: !!preset.sustains,
      params:   { ...preset.params },
      knobs:    preset.knobs.map(k => ({ ...k })),
      fn:       preset.fn,
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  // One color per GM category (16 categories, index matches GM_CATEGORIES order)
  const GM_CAT_COLORS = [
    '#f59e0b','#f97316','#84cc16','#22c55e','#0d9488',
    '#3b82f6','#6366f1','#eab308','#ef4444','#10b981',
    '#ec4899','#8b5cf6','#a855f7','#d97706','#dc2626','#6b7280',
  ]

  function gmChannelColor(program) {
    const idx = GM_CATEGORIES.findIndex(c => program >= c.range[0] && program <= c.range[1])
    return GM_CAT_COLORS[idx] ?? '#6b7280'
  }

  // Default params + editable knobs shared by every GM instrument channel
  // (created from the picker or imported from MIDI). Gives the sample-based GM
  // voices the same DAW-style controls as the FM synths: a NOTE knob that sets
  // the pitch in step-sequencer mode, a full ADSR amplitude envelope and an
  // output level. NOTE is overridden per-note in piano-roll mode.
  function makeGMParams(prog) {
    return { gmProgram: prog, pitch: 60, attack: 0, decay: 0.4, sustain: 0.9, release: 0.3, level: 1.0 }
  }
  function gmKnobs() {
    return [
      { key: 'pitch',   label: 'NOTE',  min: 24,   max: 96,  decimals: 0 },
      { key: 'attack',  label: 'ATCK',  min: 0,    max: 1.5, decimals: 2 },
      { key: 'decay',   label: 'DECAY', min: 0.01, max: 3.0, decimals: 2 },
      { key: 'sustain', label: 'SUS',   min: 0,    max: 1,   decimals: 2 },
      { key: 'release', label: 'REL',   min: 0.01, max: 3.0, decimals: 2 },
      { key: 'level',   label: 'LEVEL', min: 0,    max: 1.5, decimals: 2 },
    ]
  }

  function addGMChannel(program) {
    const prog = Math.max(0, Math.min(127, program))
    const name = (GM_INSTRUMENTS[prog] ?? 'SYNTH').split(/[\s(]/)[0].toUpperCase().slice(0, 10)
    const ch = makeChannel({
      name,
      color:    gmChannelColor(prog),
      type:     'gm',
      mode:     'piano',
      sustains: gmSustains(prog),
      fn:       makeGMPlayFn(prog),
      params:   makeGMParams(prog),
      knobs:    gmKnobs(),
    })
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
    if (audioCtx) preloadGMInstrument(audioCtx, prog)
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

  // ── VST2 plugin channels (native desktop host) ──────────────────────────────
  //   Each VST channel maps to ONE plugin instance in the C# host, keyed by the
  //   channel id, so many plugins (mixed 32/64-bit) run at once. The play fn
  //   forwards notes over IPC; audio comes from the native engine, not Web Audio,
  //   so ctx/dest are ignored.
  function makeVstPlayFn(channelId) {
    return function playVstNote(ctx, time, { pitch = 60, velocity = 1, gate = null } = {}, _dest) {
      const delayMs = Math.max(0, (time - ctx.currentTime) * 1000)
      const vel = Math.max(1, Math.min(127, Math.round((velocity ?? 1) * 127)))
      const send = (offsetMs, fn) => {
        const d = delayMs + offsetMs
        if (d <= 4) fn(); else setTimeout(fn, d)
      }
      send(0, () => sendToHost('vstNoteOn', { id: channelId, pitch, velocity: vel }))
      if (gate !== null) send(gate * 1000, () => sendToHost('vstNoteOff', { id: channelId, pitch }))
    }
  }

  function addVstChannel(name = 'VST', path = '', id = undefined) {
    const ch = makeChannel({
      ...(id ? { id } : {}),     // adopt the host's id for console-driven loads
      name:    (name || 'VST').toUpperCase().slice(0, 14),
      color:   '#1abc9c',
      type:    'vst',
      mode:    'piano',
      vstPath: path,
      knobs:   [],
      params:  {},
    })
    ch.fn = makeVstPlayFn(ch.id)   // bind the play fn to the now-known channel id
    channels.push(ch)
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
    return ch
  }

  // Create the VST channel immediately (so a slot appears), then ask the host to
  // pick a .dll and load it INTO that channel id. Mixed bitness is fine: 64-bit
  // loads in-process, 32-bit via the bridge — both keyed by this id.
  function addVstPlugin() {
    if (!isDesktop) return
    const ch = addVstChannel('VST', '')
    ch._vstLoading = true          // dropped again if the pick is cancelled / fails
    sendToHost('pickVst', { id: ch.id })
  }

  // Toggle a specific channel's plugin editor window (native host renders the GUI).
  function openVstEditor(id) {
    if (isDesktop && id) sendToHost('openVstEditor', { id })
  }

  // Host → UI: a plugin finished loading, failed, or the picker was cancelled.
  if (isDesktop) {
    onHostMessage((msg) => {
      const id = msg.payload?.id
      if (msg.type === 'vstLoaded') {
        const ch = id && channels.find(c => c.id === id)
        if (ch) {
          ch.name = (msg.payload.name || ch.name || 'VST').toUpperCase().slice(0, 14)
          ch.vstPath = msg.payload.path || ch.vstPath
          ch._vstLoading = false
        } else {
          addVstChannel(msg.payload?.name, msg.payload?.path, id)   // console-driven load
        }
      } else if (msg.type === 'vstError' || msg.type === 'vstCancelled') {
        // Drop a placeholder channel that never managed to load a plugin.
        const ch = id && channels.find(c => c.id === id)
        if (ch && ch._vstLoading) removeChannel(ch.id)
      }
    })
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

  function addSubterraChannel() {
    const ch = makeChannel({
      name:  'SUBTERRA ' + (channels.filter(c => c.type === 'subterra').length + 1),
      color: '#ff5a3c',
      type:  'subterra',
      mode:  'piano',
      knobs: [],
      params: {},
      fn: () => {},
    })
    channels.push(ch)
    initAudio()
    createSubterraNode(audioCtx).then(node => {
      subterraNodes.set(ch.id, node)
      const idx = channels.findIndex(c => c.id === ch.id)
      if (trackGains[idx]) node.connect(trackGains[idx])
      ch.fn = makeSubterraPlayFn(() => subterraNodes.get(ch.id))
    }).catch(err => console.error('[Subterra] Node init failed:', err))
    if (audioCtx) rebuildGains()
    selectedChannelId.value = ch.id
  }

  function getSubterraNode(channelId) {
    return subterraNodes.get(channelId) ?? null
  }

  // ── Per-channel insert FX ────────────────────────────────────────────────────
  //   Effects live as plain reactive data on ch.effects[]; the audible graph is
  //   (re)built in rebuildGains. Parameter tweaks update the running node in place
  //   so knob drags stay click-free; structural changes rebuild the chain.
  function addChannelEffect(channelId, type) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    const fx = makeEffect(type)
    if (!fx) return
    if (!ch.effects) ch.effects = []
    ch.effects.push(fx)
    initAudio()
    rebuildGains()
    markDirty()
  }

  function removeChannelEffect(channelId, idx) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.effects || idx < 0 || idx >= ch.effects.length) return
    ch.effects.splice(idx, 1)
    if (audioCtx) rebuildGains()
    markDirty()
  }

  function reorderChannelEffects(channelId, from, to) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch?.effects) return
    if (from < 0 || to < 0 || from >= ch.effects.length || to >= ch.effects.length) return
    const [moved] = ch.effects.splice(from, 1)
    ch.effects.splice(to, 0, moved)
    if (audioCtx) rebuildGains()
    markDirty()
  }

  function updateChannelEffect(channelId, idx, key, value) {
    const ch = channels.find(c => c.id === channelId)
    const fx = ch?.effects?.[idx]
    if (!fx) return
    fx[key] = value
    markDirty()
    // Enabling/disabling changes the graph topology → full rebuild.
    if (key === 'enabled') { if (audioCtx) rebuildGains(); return }
    // Otherwise tweak the running node in place for a glitch-free knob drag.
    const handle = channelFxChains.get(channelId)?.[idx]
    if (handle) handle.update(key, value)
    else if (audioCtx) rebuildGains()
  }

  // ── Instrument hot-swap (drag/drop replace) ──────────────────────────────────
  //   Rewrites the instrument-defining fields of an existing channel in place,
  //   keeping its id, pattern data, volume/pan/mixer routing, loop + FX settings.
  //   `spec` is the same payload used by addInstrumentChannel:
  //     { t:'synth' } | { t:'fm', key } | { t:'gm', program } | { t:'custom' }
  //     | { t:'subterra' } | { t:'wasm' } | { t:'sample', asset } | { t:'audiofile', file }
  function configureChannelInstrument(ch, spec) {
    // Tear down any worklet node previously bound to this channel id.
    for (const map of [customSynthNodes, subterraNodes, wasmNodes]) {
      if (map.has(ch.id)) { try { map.get(ch.id).disconnect() } catch (_) {} ; map.delete(ch.id) }
    }
    // Release any cached audio buffers from previous instrument types.
    if (audioFileBufs.has(ch.id)) {
      audioFileBufs.delete(ch.id)
      reversedAudioFileBufs.delete(ch.id)
      pingpongAudioFileBufs.delete(ch.id)
      xfadeLoopBufs.delete(ch.id)
      audioFileVersions[ch.id] = (audioFileVersions[ch.id] ?? 0) + 1
    }
    chopBufs.delete(ch.id);   delete chopVersions[ch.id]
    forgeBufsA.delete(ch.id); forgeBufsB.delete(ch.id)
    forgeBufsA_rev.delete(ch.id); forgeBufsB_rev.delete(ch.id)
    delete forgeVersions[ch.id + '_A']; delete forgeVersions[ch.id + '_B']
    ch.activeModules = []
    ch.instrumentType = ''
    ch.sampleSpec = undefined
    ch.sampleName = undefined
    ch.audioFileMissing = undefined
    ch.wasmStatus = undefined
    ch.wasmName   = undefined
    ch.wasmError  = undefined

    switch (spec.t) {
      case 'synth': {
        ch.type = 'melodic'; ch.sustains = true
        ch.name = 'SYNTH'; ch.color = '#4ecdc4'
        ch.params = { pitch: 60, decay: 0.4, attack: 0.01, wave: 'sawtooth' }
        ch.knobs = [
          { key: 'pitch',  label: 'NOTE',  min: 24,    max: 96,  decimals: 0 },
          { key: 'decay',  label: 'DECAY', min: 0.05,  max: 2.0, decimals: 2 },
          { key: 'attack', label: 'ATCK',  min: 0.001, max: 0.2, decimals: 3 },
        ]
        ch.fn = playMelodicNote
        break
      }
      case 'fm': {
        const preset = FM_PRESETS[spec.key]; if (!preset) return
        ch.type = 'melodic'; ch.sustains = !!preset.sustains
        ch.name = preset.name; ch.color = preset.color
        ch.params = { ...preset.params }
        ch.knobs  = preset.knobs.map(k => ({ ...k }))
        ch.fn = preset.fn
        break
      }
      case 'gm': {
        const prog = Math.max(0, Math.min(127, spec.program ?? 0))
        ch.type = 'gm'; ch.mode = ch.mode === 'steps' ? 'steps' : 'piano'
        ch.sustains = gmSustains(prog)
        ch.name = (GM_INSTRUMENTS[prog] ?? 'SYNTH').split(/[\s(]/)[0].toUpperCase().slice(0, 10)
        ch.color = gmChannelColor(prog)
        ch.fn = makeGMPlayFn(prog)
        ch.params = makeGMParams(prog)
        ch.knobs = gmKnobs()
        if (audioCtx) preloadGMInstrument(audioCtx, prog)
        break
      }
      case 'sample': {
        const asset = spec.asset; if (!asset) return
        const base = asset.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
        ch.type = 'sample'; ch.sustains = false
        ch.name = base.length > 14 ? base.slice(0, 14) : base
        ch.color = asset.color || '#4ecdc4'
        ch.instrumentType = 'sample'
        ch.sampleSpec = { ...asset.spec }
        ch.sampleName = asset.name
        ch.params = { pitch: 60, velocity: 0.8 }
        ch.knobs = [{ key: 'pitch', label: 'PITCH', min: 24, max: 96, decimals: 0 }]
        ch.fn = makeSampleFn(asset.spec)
        break
      }
      case 'chop': {
        ch.type = 'chop'; ch.mode = 'steps'; ch.sustains = false
        ch.name = 'CHOP'; ch.instrumentType = 'chop'
        const sc = 16
        ch.params = { pitch: 60, rootNote: 60, sliceCount: sc, slices: makeEqualSlices(sc), speed: 1.0, pitchOffset: 0, gate: 1.0, velocity: 0.8 }
        ch.knobs = []; ch.sampleName = ''; ch.audioFileMissing = false
        ch.fn = makeChopFn(ch.id)
        if (spec.file) loadChopFile(ch.id, spec.file)
        break
      }
      case 'forge': {
        ch.type = 'forge'; ch.mode = 'piano'; ch.sustains = false
        ch.name = 'FORGE'; ch.instrumentType = 'forge'
        const sc2 = 16
        ch.params = { pitch: 60, rootNote: 60, sliceCount: sc2, slices: _makeForgeSlices(sc2), deckBlend: 0, deckAName: '', deckBName: '', velocity: 0.8 }
        ch.knobs = []; ch.deckAMissing = false; ch.deckBMissing = false
        ch.fn = makeForgeF(ch.id)
        break
      }
      case 'audiofile': {
        const file = spec.file; if (!file) return
        const base = file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase()
        ch.type = 'audiofile'; ch.sustains = false
        ch.name = base.length > 14 ? base.slice(0, 14) : base
        ch.color = '#ff9f43'
        ch.instrumentType = 'audiofile'
        ch.sampleName = file.name
        ch.audioFileMissing = false
        ch.params = { pitch: 60, rootNote: 60, startOffset: 0, endOffset: 1, useLoop: false, loopStart: 0, loopEnd: 1, velocity: 0.8 }
        ch.knobs = [{ key: 'pitch', label: 'NOTE', min: 0, max: 127, decimals: 0 }]
        ch.fn = () => {}
        // Async decode — fn is replaced once the buffer is ready.
        loadAudioFileForChannel(ch.id, file)
        break
      }
      case 'custom': {
        ch.type = 'custom'; ch.mode = 'piano'; ch.sustains = false
        ch.name = 'CUSTOM'; ch.color = '#00d4ff'
        ch.knobs = []; ch.params = {}; ch.fn = () => {}
        initAudio()
        createCustomSynthNode(audioCtx).then(node => {
          customSynthNodes.set(ch.id, node)
          const idx = channels.findIndex(c => c.id === ch.id)
          if (trackGains[idx]) { try { node.disconnect() } catch (_) {} ; node.connect(trackGains[idx]) }
          ch.fn = makeCustomSynthPlayFn(() => customSynthNodes.get(ch.id))
        }).catch(err => console.error('[CustomSynth] Node init failed:', err))
        break
      }
      case 'subterra': {
        ch.type = 'subterra'; ch.mode = 'piano'; ch.sustains = false
        ch.name = 'SUBTERRA'; ch.color = '#ff5a3c'
        ch.knobs = []; ch.params = {}; ch.fn = () => {}
        initAudio()
        createSubterraNode(audioCtx).then(node => {
          subterraNodes.set(ch.id, node)
          const idx = channels.findIndex(c => c.id === ch.id)
          if (trackGains[idx]) { try { node.disconnect() } catch (_) {} ; node.connect(trackGains[idx]) }
          ch.fn = makeSubterraPlayFn(() => subterraNodes.get(ch.id))
        }).catch(err => console.error('[Subterra] Node init failed:', err))
        break
      }
      case 'wasm': {
        ch.type = 'wasm'; ch.mode = 'piano'; ch.sustains = false
        ch.name = 'PLUGIN'; ch.color = '#7b2fff'
        ch.knobs = []; ch.params = {}; ch.fn = () => {}
        ch.wasmStatus = 'idle'; ch.wasmName = ''; ch.wasmError = ''
        break
      }
      default: return
    }
  }

  function replaceChannelInstrument(channelId, spec) {
    const ch = channels.find(c => c.id === channelId)
    if (!ch) return
    initAudio()
    configureChannelInstrument(ch, spec)
    rebuildGains()
    selectedChannelId.value = ch.id
    mainView.value = 'sequencer'
    markDirty()
  }

  // Add a brand-new channel from an instrument spec (drag from the +SYNTH picker
  // onto an empty area of the rack). Reuses the existing per-type add helpers so
  // naming/numbering stays consistent.
  function addInstrumentChannel(spec) {
    switch (spec.t) {
      case 'synth':     addChannel(); break
      case 'fm':        addFMChannel(spec.key); break
      case 'gm':        addGMChannel(spec.program); break
      case 'custom':    addCustomSynthChannel(); break
      case 'subterra':  addSubterraChannel(); break
      case 'wasm':      addWasmChannel(); break
      case 'sample':    if (spec.asset) addSampleChannel(spec.asset); break
      case 'audiofile': if (spec.file)  addAudioFileChannel(spec.file); break
      case 'chop':      addChopChannel(); break
      case 'forge':     addForgeChannel(); break
    }
  }

  // ── Shared instrument drag (custom pointer-drag with a visible ghost) ─────────
  //   Used by both the +SYNTH picker and the browser sample list so dragging an
  //   instrument works identically and reliably (native HTML5 DnD is fragile and
  //   gives no visual feedback). A floating ghost (rendered by StudioApp) follows
  //   the cursor; the channel row underneath is reported via `overChannelId` so the
  //   rack can highlight it. Dropping over a row replaces that channel's instrument;
  //   over empty rack space it adds a new channel. Below the 5px movement threshold
  //   it is treated as a click and runs the caller-supplied `onClick` (if any).
  const instrumentDrag = reactive({
    active: false, spec: null, label: '', color: '#4ecdc4', x: 0, y: 0, overChannelId: null,
  })
  let _instPending = null

  function _instRowAt(x, y) {
    const el = (typeof document !== 'undefined') && document.elementFromPoint(x, y)
    return el?.closest?.('.channel-row')?.dataset?.chid ?? null
  }
  function _instRackAt(x, y) {
    const el = (typeof document !== 'undefined') && document.elementFromPoint(x, y)
    return !!el?.closest?.('.channel-rack')
  }

  function _instMove(e) {
    const p = _instPending; if (!p) return
    if (!p.dragging) {
      if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 5) return
      p.dragging = true
      instrumentDrag.active = true
      instrumentDrag.spec   = p.spec
      instrumentDrag.label  = p.label
      instrumentDrag.color  = p.color
      p.onDragStart?.()
    }
    instrumentDrag.x = e.clientX
    instrumentDrag.y = e.clientY
    instrumentDrag.overChannelId = _instRowAt(e.clientX, e.clientY)
  }

  function _instUp(e) {
    window.removeEventListener('mousemove', _instMove)
    window.removeEventListener('mouseup',   _instUp)
    const p = _instPending; _instPending = null
    instrumentDrag.active = false
    instrumentDrag.overChannelId = null
    if (!p) return
    if (!p.dragging) { p.onClick?.(); return }
    const chId = _instRowAt(e.clientX, e.clientY)
    if (chId)                              replaceChannelInstrument(chId, p.spec)
    else if (_instRackAt(e.clientX, e.clientY)) addInstrumentChannel(p.spec)
  }

  // ev: the originating mousedown event. opts: { onClick, onDragStart }.
  function startInstrumentDrag(spec, label, color, ev, opts = {}) {
    if (ev.button !== 0) return
    ev.preventDefault()
    _instPending = {
      spec, label, color: color || '#4ecdc4',
      startX: ev.clientX, startY: ev.clientY, dragging: false,
      onClick: opts.onClick, onDragStart: opts.onDragStart,
    }
    window.addEventListener('mousemove', _instMove)
    window.addEventListener('mouseup',   _instUp)
  }

  function removeChannel(id) {
    const idx = channels.findIndex(c => c.id === id)
    if (idx < 0 || channels.length <= 1) return
    // Free the native plugin instance (in-process host or 32-bit bridge process).
    if (channels[idx]?.type === 'vst') sendToHost('vstUnload', { id })
    // Clean up Custom Synth node
    if (customSynthNodes.has(id)) {
      try { customSynthNodes.get(id).disconnect() } catch (_) {}
      customSynthNodes.delete(id)
    }
    // Clean up SUBTERRA node
    if (subterraNodes.has(id)) {
      try { subterraNodes.get(id).disconnect() } catch (_) {}
      subterraNodes.delete(id)
    }
    // Clean up WASM node if this is a plugin channel
    if (wasmNodes.has(id)) {
      try { wasmNodes.get(id).disconnect() } catch (_) {}
      wasmNodes.delete(id)
    }
    // Release audio file / slicer buffers
    audioFileBufs.delete(id); reversedAudioFileBufs.delete(id)
    pingpongAudioFileBufs.delete(id); xfadeLoopBufs.delete(id)
    _clearSampleHistory(id)
    delete audioFileVersions[id]
    chopBufs.delete(id);      delete chopVersions[id]
    forgeBufsA.delete(id);    forgeBufsB.delete(id)
    forgeBufsA_rev.delete(id); forgeBufsB_rev.delete(id)
    delete forgeVersions[id + '_A']; delete forgeVersions[id + '_B']
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
  function getStepModX(channelId, patternId)        { return getPatData(channelId, patternId).stepModX }
  function getStepModY(channelId, patternId)        { return getPatData(channelId, patternId).stepModY }
  function getStepShift(channelId, patternId)       { return getPatData(channelId, patternId).stepShift }
  function getStepRep(channelId, patternId)         { return getPatData(channelId, patternId).stepRep }

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
  function setStepModX(channelId, step, val, patternId) {
    getPatData(channelId, patternId).stepModX[step] = Math.max(0, Math.min(1, val))
  }
  function setStepModY(channelId, step, val, patternId) {
    getPatData(channelId, patternId).stepModY[step] = Math.max(0, Math.min(1, val))
  }
  function setStepShift(channelId, step, val, patternId) {
    getPatData(channelId, patternId).stepShift[step] = Math.max(-1, Math.min(1, val))
  }
  function setStepRep(channelId, step, val, patternId) {
    getPatData(channelId, patternId).stepRep[step] = Math.max(0, Math.min(1, val))
  }

  // ── Global loop mode + batch ops ──────────────────────────────────────────
  const globalLoopMode             = ref('step')   // 'step' | 'beat' | 'all' | 'advanced'
  const colorfulLoopControls       = ref(false)
  const alwaysShowAdvancedLoopControls = ref(false)
  const muteRemovedSteps           = ref(false)

  function assignToFreeMixerTracks(channelIds) {
    let nextTrack = 1
    channelIds.forEach(id => {
      const ch = channels.find(c => c.id === id)
      if (!ch) return
      while (nextTrack < mixerTracks.length) {
        const used = channels.some(c => c.id !== id && c.mixerTrack === nextTrack)
        if (!used) break
        nextTrack++
      }
      if (nextTrack < mixerTracks.length) { ch.mixerTrack = nextTrack++ }
    })
    if (audioCtx) rebuildGains()
  }

  function transposeChannelNotes(channelIds, semitones) {
    if (!semitones) return
    pushUndo()
    channelIds.forEach(chId => {
      const d = getPatData(chId)
      d.pianoNotes.forEach(n => { n.pitch = Math.max(0, Math.min(127, n.pitch + semitones)) })
      d.stepPitches.forEach((p, i) => { d.stepPitches[i] = Math.max(-12, Math.min(12, p + semitones)) })
    })
  }

  // ── Fill steps ─────────────────────────────────────────────────────────────
  function fillSteps(channelId, every) {
    pushUndo()
    const d = getPatData(channelId)
    for (let i = 0; i < totalSteps.value; i++) {
      d.steps[i] = i % every === 0
    }
    syncStepsToPianoNotes(channelId)
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
      effects: (src.effects ?? []).map(e => ({ ...e })),
      fn:      src.fn,
      groupId: src.groupId,
    })
    // For audiofile channels, share the AudioBuffer reference and wire a new play fn.
    if (src.type === 'audiofile') {
      ch.sampleName = src.sampleName
      ch.audioFileMissing = src.audioFileMissing ?? false
      const srcBuf = audioFileBufs.get(src.id)
      if (srcBuf) {
        audioFileBufs.set(ch.id, srcBuf)
        audioFileVersions[ch.id] = 1
        const revBuf = reversedAudioFileBufs.get(src.id)
        const ppBuf  = pingpongAudioFileBufs.get(src.id)
        const xfBuf  = xfadeLoopBufs.get(src.id)
        if (revBuf) reversedAudioFileBufs.set(ch.id, revBuf)
        if (ppBuf)  pingpongAudioFileBufs.set(ch.id, ppBuf)
        if (xfBuf)  xfadeLoopBufs.set(ch.id, xfBuf)
      }
      ch.fn = makeAudioFileFn(ch.id)
    }
    if (src.type === 'chop') {
      ch.sampleName = src.sampleName; ch.audioFileMissing = src.audioFileMissing ?? false
      const b = chopBufs.get(src.id)
      if (b) { chopBufs.set(ch.id, b); chopVersions[ch.id] = 1 }
      ch.fn = makeChopFn(ch.id)
    }
    if (src.type === 'forge') {
      ch.deckAMissing = src.deckAMissing ?? false; ch.deckBMissing = src.deckBMissing ?? false
      const bA = forgeBufsA.get(src.id); const bB = forgeBufsB.get(src.id)
      if (bA) { forgeBufsA.set(ch.id, bA); forgeVersions[ch.id + '_A'] = 1 }
      if (bB) { forgeBufsB.set(ch.id, bB); forgeVersions[ch.id + '_B'] = 1 }
      const revA = forgeBufsA_rev.get(src.id); const revB = forgeBufsB_rev.get(src.id)
      if (revA) forgeBufsA_rev.set(ch.id, revA)
      if (revB) forgeBufsB_rev.set(ch.id, revB)
      ch.fn = makeForgeF(ch.id)
    }
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
        stepModX:       [...(d.stepModX       || Array(32).fill(0.5))],
        stepModY:       [...(d.stepModY       || Array(32).fill(0.5))],
        stepShift:      [...(d.stepShift      || Array(32).fill(0))],
        stepRep:        [...(d.stepRep        || Array(32).fill(0))],
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
    projectName.value = name
    projectDirty.value = false   // saved → clean
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
        sustains:    ch.sustains ?? false,
        groupId:     ch.groupId,
        params:         { ...ch.params },
        knobs:          ch.knobs.map(k => ({ ...k })),
        fnKey:          FN_KEY_MAP.get(ch.fn) ?? 'melodic',
        activeModules:  [...(ch.activeModules ?? [])],
        effects:        (ch.effects ?? []).map(e => ({ ...e })),
        instrumentType: ch.instrumentType ?? '',
        sampleSpec:     ch.sampleSpec ? { ...ch.sampleSpec } : undefined,
        sampleName:     ch.sampleName,
        vstPath:        ch.vstPath,
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
              stepModX:       [...(d.stepModX       || Array(32).fill(0.5))],
              stepModY:       [...(d.stepModY       || Array(32).fill(0.5))],
              stepShift:      [...(d.stepShift      || Array(32).fill(0))],
              stepRep:        [...(d.stepRep        || Array(32).fill(0))],
            }
          })
        })
        return out
      })(),
      patternLengthOverrides: { ...patternLengthOverrides },
      currentPatternId: currentPatternId.value,
      playlistTracks:   playlistTracks.map(t => ({ ...t })),
      playlistClips:    playlistClips.map(c => ({ ...c })),
      timeMarkers:      timeMarkers.map(m => ({ ...m })),
      automationClips:  automationClips.map(a => ({ ...a, nodes: a.nodes.map(n => ({ ...n })) })),
      mixerTracks: mixerTracks.map(mt => ({
        id:          mt.id,
        name:        mt.name,
        kind:        mt.kind,
        color:       mt.color,
        volume:      mt.volume,
        pan:         mt.pan,
        muted:       mt.muted,
        eq:          { ...mt.eq },
        fxSlots:     (mt.fxSlots ?? []).map(fx => fx ? { ...fx } : null),
        phaseInvert: mt.phaseInvert ?? false,
        sends:       { ...(mt.sends ?? {}) },
        sidechain:   { ...(mt.sidechain ?? { source: null, amount: 0, attack: 0.01, release: 0.18 }) },
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
        projectName.value  = file.name.replace(/\.(freak|json)$/i, '')
        projectDirty.value = false   // freshly loaded → clean
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

    // Release all audio file / clip / slicer buffers from the previous project.
    audioFileBufs.clear(); reversedAudioFileBufs.clear()
    pingpongAudioFileBufs.clear(); xfadeLoopBufs.clear()
    Object.keys(audioFileVersions).forEach(k => delete audioFileVersions[k])
    audioClipBufs.clear(); Object.keys(audioClipVersions).forEach(k => delete audioClipVersions[k])
    chopBufs.clear();      Object.keys(chopVersions).forEach(k => delete chopVersions[k])
    forgeBufsA.clear();    forgeBufsB.clear()
    forgeBufsA_rev.clear(); forgeBufsB_rev.clear()
    Object.keys(forgeVersions).forEach(k => delete forgeVersions[k])

    // Channels
    channels.splice(0, channels.length, ...(p.channels ?? []).map(ch => reactive({
      id:          ch.id,
      name:        ch.name,
      color:       ch.color,
      // GM channels are identified by a saved program number; normalise older
      // projects (saved before the dedicated 'gm' type existed) so the rack
      // shows their instrument controls instead of the melodic wave selector.
      type:        ch.params?.gmProgram != null ? 'gm' : (ch.type ?? 'melodic'),
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
      // Continuous-voice flag; derive it for projects saved before it existed.
      sustains:    ch.sustains ?? deriveChannelSustains(ch),
      groupId:     ch.groupId     ?? null,
      params:         { ...(ch.params ?? {}) },
      knobs:          (ch.knobs ?? []).map(k => ({ ...k })),
      // GM voices use a per-program closure that isn't in FN_KEY_MAP, so rebuild
      // it from the saved program number instead of the (meaningless) fnKey.
      fn:             ch.params?.gmProgram != null
                        ? makeGMPlayFn(ch.params.gmProgram)
                        : ch.type === 'vst'
                          ? makeVstPlayFn(ch.id)
                          : ch.type === 'sample' && ch.sampleSpec
                            ? makeSampleFn(ch.sampleSpec)
                            : (ch.type === 'audiofile' || ch.type === 'chop' || ch.type === 'forge')
                              ? () => {}  // buffers not serialized; user must reload
                              : (FN_FROM_KEY[ch.fnKey] ?? playMelodicNote),
      activeModules:    [...(ch.activeModules ?? [])],
      effects:          (ch.effects ?? []).map(e => ({ ...e })),
      instrumentType:   ch.instrumentType ?? '',
      sampleSpec:       ch.sampleSpec ? { ...ch.sampleSpec } : undefined,
      sampleName:       ch.sampleName,
      vstPath:          ch.vstPath,
      // Buffers are not serializable; mark missing so the UI can prompt reload.
      audioFileMissing: (ch.type === 'audiofile' || ch.type === 'chop') ? true : undefined,
      deckAMissing: ch.type === 'forge' && ch.params?.deckAName ? true : undefined,
      deckBMissing: ch.type === 'forge' && ch.params?.deckBName ? true : undefined,
    })))

    // Desktop: re-instantiate each saved VST plugin into the native host by id,
    // so multi-plugin projects come back with their instruments loaded.
    if (isDesktop) {
      for (const ch of channels) {
        if (ch.type === 'vst' && ch.vstPath) sendToHost('loadVst', { id: ch.id, path: ch.vstPath })
      }
    }

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
          stepModX:       [...(d.stepModX       ?? Array(32).fill(0.5))],
          stepModY:       [...(d.stepModY       ?? Array(32).fill(0.5))],
          stepShift:      [...(d.stepShift      ?? Array(32).fill(0))],
          stepRep:        [...(d.stepRep        ?? Array(32).fill(0))],
        })
      })
    })

    // Mirror steps → C5 pianoNotes for any steps-mode channels in the loaded project
    channels.forEach(ch => {
      if (ch.mode === 'steps') {
        Object.keys(patternData).forEach(pid => {
          if (patternData[pid]?.[ch.id]) syncStepsToPianoNotes(ch.id, pid)
        })
      }
    })

    // Pattern length overrides
    Object.keys(patternLengthOverrides).forEach(k => delete patternLengthOverrides[k])
    Object.assign(patternLengthOverrides, p.patternLengthOverrides ?? {})

    const firstPatId = patterns[0]?.id ?? 'p1'
    currentPatternId.value = p.currentPatternId ?? firstPatId
    pickerPatternId.value  = p.currentPatternId ?? firstPatId

    // Playlist
    playlistTracks.splice(0, playlistTracks.length, ...(p.playlistTracks ?? []).map(t => ({ ...t, _soloed: false })))
    playlistClips.splice(0, playlistClips.length, ...(p.playlistClips ?? []).map(c => ({
      ...c,
      // AudioBuffer is not serializable — mark audio clips missing so Playlist prompts reload.
      audioFileMissing: c.type === 'audio' ? true : c.audioFileMissing,
    })))
    timeMarkers.splice(0, timeMarkers.length, ...(p.timeMarkers ?? []).map(m => ({ ...m })))
    automationClips.splice(0, automationClips.length, ...(p.automationClips ?? []).map(a => ({
      ...a, nodes: (a.nodes ?? []).map(n => ({ ...n })),
    })))

    // Mixer
    ;(p.mixerTracks ?? []).forEach((mt, i) => {
      if (!mixerTracks[i]) return
      mixerTracks[i].name        = mt.name        ?? mixerTracks[i].name
      mixerTracks[i].color       = mt.color        ?? mixerTracks[i].color
      mixerTracks[i].volume      = mt.volume       ?? 1.0
      mixerTracks[i].pan         = mt.pan          ?? 0
      mixerTracks[i].muted       = mt.muted        ?? false
      mixerTracks[i]._soloed     = false
      mixerTracks[i].phaseInvert = mt.phaseInvert  ?? false
      mixerTracks[i].fxSlots     = (mt.fxSlots ?? []).map(fx => fx ? { ...fx } : null)
      mixerTracks[i].sends       = { ...(mt.sends ?? {}) }
      mixerTracks[i].sidechain   = { ...(mixerTracks[i].sidechain ?? {}), ...(mt.sidechain ?? {}) }
      if (mt.kind) mixerTracks[i].kind = mt.kind
      if (mt.eq) Object.assign(mixerTracks[i].eq, mt.eq)
    })
    // Rebuild the mixer graph so loaded FX / sends / sidechain take effect.
    if (audioCtx) buildMixerInserts()

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

    // Warm up GM sample sets so loaded projects are audible without a first-note delay.
    if (audioCtx) {
      channels.forEach(ch => {
        if (ch.params?.gmProgram != null) preloadGMInstrument(audioCtx, ch.params.gmProgram)
      })
    }

    undoStack.length = 0
    redoStack.length = 0
  }

  // ── Public API ────────────────────────────────────────────────────────────────
  _store = {
    pushUndo,
    // Channels
    channels, selectedChannelId, selectedChannel,
    soloChannel, addChannel, addFMChannel, addGMChannel, addWasmChannel, loadWasmForChannel,
    addVstPlugin, addVstChannel, openVstEditor,
    addCustomSynthChannel, getCustomSynthNode,
    addSubterraChannel, getSubterraNode,
    GM_CATEGORIES, GM_CAT_COLORS, GM_INSTRUMENTS,
    removeChannel, moveChannel,
    // Instrument hot-swap (drag/drop replace) + spec-based add
    replaceChannelInstrument, addInstrumentChannel,
    // Shared instrument drag (visible pointer-drag for picker + browser samples)
    instrumentDrag, startInstrumentDrag,
    // Per-channel insert FX
    addChannelEffect, removeChannelEffect, reorderChannelEffects, updateChannelEffect,
    // Patterns
    patterns, currentPatternId, pickerPatternId, patternData,
    getPatData, getSteps, getPianoNotes,
    addPattern, removePattern, duplicatePattern, importMidiFile,
    movePatternUp, movePatternDown, findNextEmptyPattern,
    // Pattern editing
    toggleStep, togglePianoNote, hasNote, clearChannel, clearAll,
    setChannelMode, syncStepsToPianoNotes,
    // Step bitmask ops
    getStepMask, setStepMask, rotateSteps, invertSteps,
    // Step graph
    getStepVelocities, setStepVelocity,
    getStepPans, setStepPan,
    getStepPitches, setStepPitch,
    getStepModX, setStepModX,
    getStepModY, setStepModY,
    getStepShift, setStepShift,
    getStepRep, setStepRep,
    fillSteps,
    // Channel groups
    channelGroups, addGroup, removeGroup, renameGroup, assignChannelsToGroup,
    // Graph editor
    graphEditorOpen, graphParam,
    // Channel operations
    cloneChannel, sortChannelsBy, colorChannelsRandom, colorChannelsGradient,
    setCutSelf, splitByChannel,
    assignToFreeMixerTracks, transposeChannelNotes,
    // Global loop + batch flags
    globalLoopMode, colorfulLoopControls, alwaysShowAdvancedLoopControls, muteRemovedSteps,
    // Playlist
    autoScroll,
    playlistTracks, playlistClips, timeMarkers, usePlaylist,
    playlistTool, cellWidth, trackHeight, clipFocusMode, displayCell, playbackStartCell,
    addPlaylistTrack, removePlaylistTrack, soloPlaylistTrack,
    placeClip, removeClip, moveClip, resizeClip, splitClip, setSlipOffset, makeUniqueClip, consolidateTrack,
    addTimeMarker, removeTimeMarker,
    PLAYLIST_CELLS,
    // Track groups/lock/ops
    groupTrackWithAbove, ungroupTrack, toggleTrackCollapse, setTrackLocked,
    clonePlaylistTrack, movePlaylistTrackUp, movePlaylistTrackDown, setTrackColor, autoNameTrack,
    // Insert/Delete time
    insertTime, deleteTime,
    // Beat slice + duplicate
    beatSliceClip, duplicateClips,
    // Arrangements
    playlists, currentPlaylistId, switchPlaylist, clonePlaylist, addPlaylist, renamePlaylist, deletePlaylist, mergePlaylist,
    // Automation
    automationClips, addAutomationClip, removeAutomationClip,
    addAutoNode, removeAutoNode, resizeAutomationClip,
    // Utilities
    getUnusedPatternIds, transposePatternNotes, selectSourcePattern, muteAllClipsOnTrack,
    // UI state
    mainView, pianoRollOpen, renderModalOpen, themeModalOpen, midiRouterOpen, currentTheme, kbOctave,
    gridSnap, keyboardInputMode,
    // Snap / quantization engine
    ppq, altFreeform, tickDurationSec, ticksPerGridCell, snapTicks, snapBars,
    // Title bar
    projectName, projectDirty, extendedHudOpen,
    // Browser preview + docking + sample drop
    browserWidth, previewingId, previewAsset, stopPreview, addSampleChannel,
    // Audio file sampler (Channel Rack)
    addAudioFileChannel, loadAudioFileForChannel, getAudioFileBuf, audioFileVersions,
    normalizeAudioFile, buildLoopXfade, snapToZero,
    processSampleAudio, detectSamplePitch,
    undoSampleEdit, canUndoSampleEdit, sampleHistoryDepth,
    detectSampleSlices, setSampleSlices, clearSampleSlices, sliceSamplerToSequencer,
    setSamplerWarp, redetectSampleBpm,
    addSampleWarpMarker, updateSampleWarpMarker, removeSampleWarpMarker, clearSampleWarpMarkers,
    getSamplerZones, addSamplerZone, removeSamplerZone, updateSamplerZone,
    // Audio clips (Playlist timeline)
    addAudioClip, loadAudioClipFile, getAudioClipBuf, cloneAudioClip, audioClipVersions,
    addAudioClipFromBuffer,
    setClipWarp, redetectClipBpm, WARP_MODES,
    // Audio input recording
    audioInputReady, inputMonitor, isRecordingAudio, inputLevel,
    enableAudioInput, disableAudioInput, setInputMonitor,
    startAudioRecording, stopAudioRecording,
    // CHOP quick slicer
    addChopChannel, loadChopFile, getChopBuf, chopVersions, detectChopTransients,
    sliceToMidi, setSlicerWarp, redetectSlicerBpm,
    // FORGE deep slicer
    addForgeChannel, loadForgeDeck, getForgeBuf, forgeVersions,
    // Window manager
    browserOpen, activeArrangement, detachedWindows,
    windowState, activateWindow, toggleDetach, redockWindow, focusWindow, applyArrangement,
    // Sequencer
    bpm, totalSteps, swing, isPlaying, displayStep,
    togglePlay, startPlay, stopPlay, pausePlay,
    getPlayheadTimeSeconds, getTimecodeSeconds, seekTo, audioLoad,
    // System telemetry
    audioUnderruns, getVoiceCount,
    // Main volume & master pitch
    masterVolume, masterPitch, masterPitchRange, masterPitchSemis,
    setMasterVolume, setMasterPitch, setMasterPitchRange,
    // MIDI sync + Multilink
    midiEnabled, midiSyncState, midiActivity, midiLastLabel, midiLearnTarget, midiLinks, MIDI_TARGETS,
    initMidi, armMidiLearn, cancelMidiLearn, addMidiLink, removeMidiLink, setLinkMode, toggleLinkGlobal, injectMidi,
    // Transport status + record
    transportState, beatTick, beatAccent,
    RECORD_FLAGS, recordFilters, recordArmed, recordWarning,
    toggleRecordFilter, toggleRecordArm, loopRecord, dumpScoreLog,
    recordCountIn, recordCountInBars, countInBarsLeft,
    disarmOnStop, recordStartsPlayback, rememberSeekTime, halfSpeed, recordBlend,
    // Metronome
    metronomeOn, metronomeSound, metroAccent,
    getAnalyser: () => analyserNode,
    getScopeAnalysers: () => ({ L: scopeAnalyserL, R: scopeAnalyserR }),
    // Undo / Redo
    canUndo, canRedo, undoAction, redoAction,
    // Keyboard
    playNote, stopNote, handleKeyDown, handleKeyUp, panicAll,
    // Sampler audition (preview keyboard)
    auditionNoteOn, auditionNoteOff,
    // Mixer
    mixerTracks, EFFECT_DEFS,
    setMixerTrackVolume, setMixerTrackPan, setMixerEq,
    muteMixerTrack, soloMixerTrack, renameMixerTrack, setMixerTrackColor,
    getMixerAnalyser, assignChannelToMixerTrack, moveMixerTrack,
    toggleMixerPhaseInvert,
    addMixerTrackFx, removeMixerTrackFx, updateMixerTrackFxParam,
    toggleMixerTrackFxEnabled, moveMixerTrackFxSlot,
    setMixerSend, setMixerSidechain, NUM_MX_RETURNS, returnTrackIdxStart,
    // Scale snap
    snapScale,
    // Pattern length (infinite canvas)
    getPatternLengthTicks, setPatternLengthOverride, clearPatternLengthOverride,
    // Loop region (red ruler selection — temporary playback override)
    loopRegion, setLoopRegion, clearLoopRegion,
    // Project save / load
    saveProject, loadProjectFile,
    // Render / export: faithful offline render (+ real-time capture for plugins)
    renderProjectToBuffer,
    renderRealtimeToBuffer,
    // Drum modules
    addDrumModule, removeDrumModule,
  }
  return _store
}
