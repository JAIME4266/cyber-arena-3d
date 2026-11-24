/** Progressive typing curriculum and adaptive enemy-pace helpers. */

export type TrainingStage = 1 | 2 | 3

export const HOME_ROW_KEYS: readonly string[] = ['F', 'J', 'A', 'S', 'D', 'G', 'H', 'K', 'L', ';']
export const INDEX_MIDDLE_KEYS: readonly string[] = ['E', 'I', 'R', 'U']

export const STAGE_ONE_WORDS: readonly string[] = [
  'fad', 'sad', 'had', 'all', 'fall', 'hall', 'half', 'glass', 'flash',
  'lag', 'lags', 'lass', 'ask', 'asks', 'gas', 'dash', 'salsa', 'jag',
]

export const STAGE_TWO_WORDS: readonly string[] = [
  'fire', 'rise', 'fast', 'laser', 'shield', 'guard', 'ready', 'range',
  'flare', 'high', 'rush', 'safer', 'aside', 'raid', 'slide', 'fresh',
]

export const STAGE_THREE_WORDS: readonly string[] = [
  'target', 'sprint', 'trigger', 'reload', 'impact', 'danger', 'operator',
  'barrage', 'armored', 'training', 'defender', 'precision',
]

export function trainingStage(kills: number): TrainingStage {
  if (kills < 50) return 1
  if (kills < 100) return 2
  return 3
}

export function enemyWordLength(kind: 'RUNNER' | 'GRUNT' | 'ELITE' | 'BOSS', stage: TrainingStage): number {
  if (kind === 'BOSS') return stage >= 3 ? 7 : stage === 2 ? 5 : 3
  if (kind === 'RUNNER') return stage === 1 ? 3 : stage === 2 ? 4 : 5
  if (kind === 'GRUNT') return stage === 1 ? 4 : stage === 2 ? 5 : 6
  return stage === 1 ? 4 : stage === 2 ? 5 : 7
}

export function adaptiveEnemySpeedScale(wpm: number): number {
  if (wpm <= 15) return 0.55
  if (wpm >= 100) return 1
  return 0.55 + ((wpm - 15) / 85) * 0.45
}

export function selectTrainingWord(kind: 'RUNNER' | 'GRUNT' | 'ELITE' | 'BOSS', kills: number, index: number): string {
  const stage = trainingStage(kills)
  const pool = stage === 1 ? STAGE_ONE_WORDS : stage === 2 ? STAGE_TWO_WORDS : STAGE_THREE_WORDS
  const desired = enemyWordLength(kind, stage)
  const matching = pool.filter(word => word.length <= desired)
  const sameLength = matching.filter(word => word.length === desired)
  const candidates = sameLength.length ? sameLength : matching
  if (!candidates.length) return stage === 1 ? 'had' : stage === 2 ? 'fire' : 'target'
  return candidates[Math.abs(index) % candidates.length]!
}
