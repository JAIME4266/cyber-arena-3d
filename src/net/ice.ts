/**
 * ICE configuration shared by every transport (relay-raced and direct).
 *
 * Trystero's default is a single STUN server — which fails silently whenever
 * both players sit behind symmetric NAT / CGNAT (very common on mobile data
 * and strict home routers): signaling works, offers are exchanged, then the
 * direct link never forms. That is exactly the "host waiting forever, joiner
 * requesting forever" failure this stack is built to kill.
 *
 * Fix layers:
 *   1. several independent STUN servers (redundant path discovery),
 *   2. the free OpenRelay TURN over UDP *and* TCP — TURN relays traffic when
 *      no direct path exists; the TCP variants survive UDP-blocking networks.
 *      Unreachable servers cost nothing: ICE simply skips failed candidates.
 */
export const ICE_SERVERS: RTCIceServer[] = [
  {
    urls: [
      'stun:stun.cloudflare.com:3478',
      'stun:stun.l.google.com:19302',
      'stun:global.stun.twilio.com:3478',
    ],
  },
  {
    urls: [
      'turn:openrelay.metered.ca:80',
      'turn:openrelay.metered.ca:443',
      'turn:openrelay.metered.ca:80?transport=tcp',
      'turn:openrelay.metered.ca:443?transport=tcp',
    ],
    username: 'openrelayproject',
    credential: 'openrelayproject',
  },
]

/** RTCConfiguration used for every RTCPeerConnection this game creates. */
export const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  iceCandidatePoolSize: 4,
}
