/** Run statistics: WPM, accuracy, streaks. Pure functions, unit-tested. */

export function wpm(correctChars: number, elapsedMs: number): number {
  if (elapsedMs <= 0 || correctChars <= 0) return 0
  return Math.round(correctChars / 5 / (elapsedMs / 60000))
}

export function accuracy(correct: number, wrong: number): number {
  const total = correct + wrong
  if (total <= 0) return 100
  return Math.round((correct / total) * 100)
}

export function rank(score: number): string {
  if (score >= 20000) return 'S — OVERLORD SLAYER'
  if (score >= 12000) return 'A — CYBER ACE'
  if (score >= 7000) return 'B — NODE BREAKER'
  if (score >= 3000) return 'C — RUNNER'
  if (score >= 1000) return 'D — SCRIPT KID'
  return 'E — ROOKIE'
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, seconds | 0)
  return `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function formatScore(n: number): string {
  return n.toLocaleString('en-US')
}

/** Daily challenge seed: same for everyone on the same local date. */
export function dailySeed(date = new Date()): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `daily-${y}-${m}-${d}`
}
