/**
 * Direct-invite codec tests: the fallback path must never strand a player
 * with an undecodable code.
 */
import { describe, expect, it } from 'vitest'
import {
  decodeInvite,
  encodeInvite,
  INVITE_PREFIX,
  type InvitePayload,
} from '../../src/net/direct'

const fakeSdp = (n = 4000): string =>
  'v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\ns=-\r\n' +
  Array.from({ length: n }, (_, i) => `a=fingerprint:${i}`).join('\r\n')

describe('invite codec', () => {
  it('round-trips an offer payload', async () => {
    const p: InvitePayload = { v: 1, t: 'o', s: fakeSdp() }
    const code = await encodeInvite(p)
    expect(code.startsWith(`${INVITE_PREFIX}.`)).toBe(true)
    expect(await decodeInvite(code)).toEqual(p)
  })

  it('round-trips an answer payload', async () => {
    const p: InvitePayload = { v: 1, t: 'a', s: fakeSdp(2000) }
    expect(await decodeInvite(await encodeInvite(p))).toEqual(p)
  })

  it('compresses a realistic data-channel offer under messaging-app limits', async () => {
    // A real data-channel-only offer with gathered ICE candidates is
    // ~1–1.5 KB of highly repetitive text.
    const sdp = [
      'v=0',
      'o=- 4611731031006093558 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'a=group:BUNDLE 0',
      'a=msid-semantic: WMS',
      'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
      'c=IN IP4 0.0.0.0',
      'a=ice-ufrag:EsAw',
      'a=ice-pwd:P2uYro0UCOQ4zxjNWXSvHGXe',
      'a=ice-options:trickle',
      'a=fingerprint:sha-256 D2:FA:0E:C3:22:59:5E:14:95:69:92:3D:13:B4:84:24:2C:C2:A2:C0:3E:FD:34:8E:5E:EA:6F:AF:52:CE:66:0F',
      'a=setup:actpass',
      'a=mid:0',
      'a=sctp-port:5000',
      'a=candidate:842163049 1 udp 1677729535 192.168.1.42 54400 typ srflx raddr 0.0.0.0 rport 0 generation 0 ufrag EsAw network-cost 999',
      'a=candidate:842163050 1 udp 1677729535 172.17.0.1 54401 typ host generation 0 ufrag EsAw network-cost 999',
      'a=candidate:393465245 1 tcp 1518280447 192.168.1.42 9 typ host tcptype active generation 0 ufrag EsAw network-cost 999',
      'a=end-of-candidates',
    ].join('\r\n')
    expect(sdp.length).toBeGreaterThan(700)
    expect(sdp.length).toBeLessThan(1600)
    const code = await encodeInvite({ v: 1, t: 'o', s: sdp })
    expect(code.length).toBeGreaterThan(50)
    expect(code.length).toBeLessThan(2000)
    expect((await decodeInvite(code)).s).toBe(sdp)
  })

  it('tolerates whitespace and line breaks added by messengers', async () => {
    const code = await encodeInvite({ v: 1, t: 'a', s: 'sdp-body' })
    const mangled = code.slice(0, 40) + '\n' + code.slice(40, 80) + '  \n' + code.slice(80)
    expect(await decodeInvite(mangled)).toEqual({ v: 1, t: 'a', s: 'sdp-body' })
  })

  it('rejects foreign codes and garbage', async () => {
    await expect(decodeInvite('hello world')).rejects.toThrow(/invite code/i)
    await expect(decodeInvite('c3d9.abc')).rejects.toThrow()
    await expect(decodeInvite('')).rejects.toThrow()
  })

  it('rejects malformed payloads with wrong types', async () => {
    const bad = (json: string): string => {
      const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `${INVITE_PREFIX}.${b64}`
    }
    // Uncompressed-looking prefix path is handled by the decoder only for
    // c3d0; for c3d1 the body must be deflate. Craft via the plain prefix
    // instead to exercise schema validation.
    const plain = (json: string): string => {
      const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `c3d0.${b64}`
    }
    await expect(decodeInvite(plain('{"v":2,"t":"o","s":"x"}'))).rejects.toThrow(/malformed/i)
    await expect(decodeInvite(plain('{"v":1,"t":"x","s":"x"}'))).rejects.toThrow(/malformed/i)
    await expect(decodeInvite(plain('{"v":1,"t":"o","s":""'))).rejects.toThrow()
    await expect(decodeInvite(bad('not-json-at-all'))).rejects.toThrow()
  })
})
