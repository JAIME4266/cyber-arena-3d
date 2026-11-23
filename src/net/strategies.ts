/**
 * Signaling networks + strategy loader.
 *
 * Three fully independent serverless networks are raced in parallel:
 *   - NOSTR   (public relays, widest coverage)
 *   - TORRENT (WebTorrent trackers — a different continent of infrastructure)
 *   - MQTT    (public brokers — third path, different failure domain entirely)
 *
 * Two players connect if ANY network is reachable from BOTH sides. The lists
 * below intentionally span operators/regions: every network blocks or
 * degrades different hosts depending on country, ISP and luck, so breadth is
 * the reliability strategy. All sockets are tiny control channels; they are
 * torn down the moment a link is pinned.
 */
import type { Room } from '@trystero-p2p/nostr'
import type { StrategyName, StrategyStatus } from './transport'

export type JoinRoomFn = (config: JoinConfig, roomId: string) => Room

export interface JoinConfig {
  appId: string
  relayConfig: { urls: string[] }
  rtcConfig: RTCConfiguration
}

export interface StrategyModule {
  name: StrategyName
  joinRoom: JoinRoomFn
  getRelaySockets: () => Record<string, WebSocket>
}

export const NOSTR_RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://relay.snort.social',
  'wss://nostr.mom',
  'wss://relay.nostr.com',
  'wss://nostr-01.yakihonne.com',
  'wss://nostr.azzamo.net',
  'wss://relay.angor.io',
  'wss://nostr.sathoarder.com',
  'wss://relay.nostrhub.fr',
  'wss://nostr.bitcoiner.social',
  // Damus blocks some cloud IPs (home networks are fine) — kept as a bonus path.
  'wss://relay.damus.io',
]

export const TORRENT_TRACKERS = [
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce',
]

export const MQTT_BROKERS = [
  'wss://broker.hivemq.com:8884/mqtt',
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
]

export function relayUrls(name: StrategyName): string[] {
  if (name === 'nostr') return NOSTR_RELAYS
  if (name === 'torrent') return TORRENT_TRACKERS
  return MQTT_BROKERS
}

const loaders: Record<StrategyName, () => Promise<StrategyModule>> = {
  nostr: async () => {
    const m = await import('@trystero-p2p/nostr')
    return { name: 'nostr', joinRoom: m.joinRoom, getRelaySockets: m.getRelaySockets }
  },
  torrent: async () => {
    const m = await import('@trystero-p2p/torrent')
    return { name: 'torrent', joinRoom: m.joinRoom, getRelaySockets: m.getRelaySockets }
  },
  mqtt: async () => {
    const m = await import('@trystero-p2p/mqtt')
    return { name: 'mqtt', joinRoom: m.joinRoom, getRelaySockets: m.getRelaySockets }
  },
}

/**
 * Load every strategy in parallel; a module that fails to fetch (offline
 * moment, blocked CDN path) degrades to `null` and the others carry on.
 * Never rejects.
 */
export async function loadStrategies(): Promise<Partial<Record<StrategyName, StrategyModule>>> {
  const names: StrategyName[] = ['nostr', 'torrent', 'mqtt']
  const settled = await Promise.allSettled(names.map(n => loaders[n]()))
  const out: Partial<Record<StrategyName, StrategyModule>> = {}
  settled.forEach((r, i) => {
    if (r.status === 'fulfilled') out[names[i]] = r.value
    else console.warn(`net: strategy ${names[i]} unavailable`, r.reason)
  })
  return out
}

/** Live socket snapshot for a strategy module ('off' when module missing). */
export function strategyStatus(
  name: StrategyName,
  mod: StrategyModule | undefined,
): StrategyStatus {
  if (!mod) return { name, state: 'off', open: 0, total: 0 }
  const sockets = Object.values(mod.getRelaySockets?.() ?? {})
  const open = sockets.filter(s => s.readyState === WebSocket.OPEN).length
  return {
    name,
    state: open > 0 ? 'ready' : 'connecting',
    open,
    total: sockets.length,
  }
}
