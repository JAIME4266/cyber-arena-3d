/** localStorage persistence: settings + personal bests. Safe if storage is blocked. */
import type { Settings } from '../ui/menu'

const SETTINGS_KEY = 'ca3d.settings.v2'
const BEST_KEY = 'ca3d.best.v2'

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.6,
  sfxVolume: 0.8,
  shake: true,
  speedlines: true,
  hd: true,
  name: '',
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
  } catch {
    /* storage blocked — settings stay in-memory */
  }
}

export interface Bests {
  score: number
  kills: number
  wpm: number
  dailyScore: number
}

export function loadBests(): Bests {
  try {
    const raw = localStorage.getItem(BEST_KEY)
    if (!raw) return { score: 0, kills: 0, wpm: 0, dailyScore: 0 }
    return { score: 0, kills: 0, wpm: 0, dailyScore: 0, ...(JSON.parse(raw) as Partial<Bests>) }
  } catch {
    return { score: 0, kills: 0, wpm: 0, dailyScore: 0 }
  }
}

export function saveBests(b: Bests): void {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(b))
  } catch {
    /* ignore */
  }
}
