/**
 * The arena world: sky dome, floor, grid, energy barrier (custom GLSL),
 * pylons, power-generator obstacles, a procedural neon city merged into a
 * handful of draw calls, and drifting dust.
 *
 * Everything is generated from canvas textures at runtime — zero asset
 * downloads, instant boot, and a cohesive cyber look.
 */
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ARENA, OBSTACLES } from '../core/constants'
import { assets } from './assets'

function makeTexture(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, repeat = 1): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = size
  const ctx = c.getContext('2d')!
  draw(ctx, size)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.repeat.set(repeat, repeat)
  t.anisotropy = 8
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class World {
  readonly keyLight: THREE.DirectionalLight
  readonly playerLight: THREE.PointLight
  readonly boomLight: THREE.PointLight
  private readonly barrierMat: THREE.ShaderMaterial
  private readonly dust: THREE.Points
  private readonly sky: THREE.Mesh
  private readonly disposables: Array<{ dispose(): void }> = []
  private heroAdded = false
  private readonly offAssetsReady: () => void

  constructor(scene: THREE.Scene) {
    scene.background = new THREE.Color(0x05070f)
    scene.fog = new THREE.FogExp2(0x180a38, 0.0036)

    /* ---------- lights ---------- */
    scene.add(new THREE.HemisphereLight(0x6f8cff, 0x20103a, 1.05))
    this.keyLight = new THREE.DirectionalLight(0xa8d4ff, 1.6)
    this.keyLight.castShadow = true
    this.keyLight.shadow.mapSize.set(1024, 1024)
    Object.assign(this.keyLight.shadow.camera, { near: 10, far: 200, left: -48, right: 48, top: 48, bottom: -48 })
    this.keyLight.shadow.bias = -0.0005
    scene.add(this.keyLight, this.keyLight.target)
    const rim = new THREE.DirectionalLight(0xe02bd8, 0.9)
    rim.position.set(-40, 30, -60)
    scene.add(rim)
    this.playerLight = new THREE.PointLight(0x38bdf8, 2.2, 40)
    this.boomLight = new THREE.PointLight(0xffaa55, 0, 50)
    scene.add(this.playerLight, this.boomLight)

    /* ---------- sky dome ---------- */
    const skyTex = makeTexture(1024, (g, s) => {
      const grad = g.createLinearGradient(0, 0, 0, s)
      for (const [stop, color] of [[0, '#02030a'], [0.35, '#0b1233'], [0.5, '#3b1363'], [0.58, '#7a1f8f'], [0.6, '#0a1226'], [1, '#05070f']] as const) {
        grad.addColorStop(stop, color)
      }
      g.fillStyle = grad
      g.fillRect(0, 0, s, s)
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(255,255,255,${0.2 + Math.random() * 0.8})`
        g.fillRect(Math.random() * s, Math.random() * s * 0.5, Math.random() < 0.1 ? 2 : 1, 1.5)
      }
      const moon = g.createRadialGradient(700, 150, 4, 700, 150, 90)
      moon.addColorStop(0, 'rgba(255,240,255,1)')
      moon.addColorStop(0.2, 'rgba(240,171,252,.5)')
      moon.addColorStop(1, 'rgba(240,171,252,0)')
      g.fillStyle = moon
      g.fillRect(560, 10, 280, 280)
    })
    skyTex.wrapS = skyTex.wrapT = THREE.ClampToEdgeWrapping
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(900, 32, 16),
      new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }),
    )
    scene.add(this.sky)

    /* ---------- floor ---------- */
    const floorTex = makeTexture(256, (g, s) => {
      g.fillStyle = 'rgb(9,16,36)'
      g.fillRect(0, 0, s, s)
      for (let i = 0; i < 900; i++) {
        g.fillStyle = `rgba(140,180,255,${Math.random() * 0.07})`
        g.fillRect(Math.random() * s, Math.random() * s, 2, 2)
      }
      g.strokeStyle = 'rgba(70,110,180,.95)'
      g.lineWidth = 5
      g.strokeRect(0, 0, s, s)
      g.lineWidth = 1.5
      g.strokeStyle = 'rgba(50,80,140,.6)'
      g.beginPath()
      g.moveTo(s / 2, 0); g.lineTo(s / 2, s)
      g.moveTo(0, s / 2); g.lineTo(s, s / 2)
      g.stroke()
    }, 70)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000),
      new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.5, metalness: 0.35 }),
    )
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    scene.add(floor)

    const grid = new THREE.GridHelper(ARENA * 2, 36, 0x38bdf8, 0x15375e)
    grid.position.y = 0.07
    const gm = grid.material as THREE.Material
    gm.transparent = true
    gm.opacity = 0.45
    grid.renderOrder = 1
    scene.add(grid)

    /* ---------- center decal ---------- */
    const decalTex = makeTexture(512, (g, s) => {
      g.strokeStyle = '#38bdf8'
      for (const [i, r] of [240, 190, 120].entries()) {
        g.globalAlpha = 0.9 - i * 0.25
        g.lineWidth = 6
        g.beginPath()
        g.arc(s / 2, s / 2, r, 0, 7)
        g.stroke()
      }
      g.globalAlpha = 0.7
      g.lineWidth = 3
      for (let a = 0; a < 8; a++) {
        const c = Math.cos((a * Math.PI) / 4)
        const n = Math.sin((a * Math.PI) / 4)
        g.beginPath()
        g.moveTo(s / 2 + c * 190, s / 2 + n * 190)
        g.lineTo(s / 2 + c * 240, s / 2 + n * 240)
        g.stroke()
      }
    })
    const decal = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 64),
      new THREE.MeshBasicMaterial({ map: decalTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    )
    decal.rotation.x = -Math.PI / 2
    decal.position.y = 0.08
    decal.renderOrder = 1
    scene.add(decal)

    /* ---------- city (merged into ~4 draw calls) ---------- */
    this.buildCity(scene)

    /* ---------- energy barrier ---------- */
    this.barrierMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        t: { value: 0 },
        pp: { value: new THREE.Vector3() },
        col: { value: new THREE.Color(0x22d3ee) },
        col2: { value: new THREE.Color(0xe879f9) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        void main() {
          vUv = uv;
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vW;
        uniform float t;
        uniform vec3 pp;
        uniform vec3 col;
        uniform vec3 col2;
        void main() {
          float L = vW.x + vW.z;
          vec2 q = abs(fract(vec2(L * 0.22, vW.y * 0.4)) - 0.5);
          float g = smoothstep(0.44, 0.5, max(q.x, q.y));
          float sw = smoothstep(0.85, 1.0, sin(L * 0.1 - t * 1.8) * 0.5 + 0.5);
          float ed = (1.0 - smoothstep(0.0, 0.1, vUv.y)) + smoothstep(0.93, 1.0, vUv.y);
          float nr = 1.0 - smoothstep(3.0, 34.0, distance(vW.xz, pp.xz));
          float a = 0.06 + 0.3 * pow(1.0 - vUv.y, 2.0) + g * 0.16 + sw * 0.22 + ed * 0.8 + nr * (0.3 + g * 0.6);
          gl_FragColor = vec4(mix(col, col2, 0.5 + 0.5 * sin(L * 0.04 + t * 0.5)) * 1.3, clamp(a, 0.0, 1.0));
        }`,
    })
    const dark = new THREE.MeshStandardMaterial({ color: 0x0d1424, roughness: 0.4, metalness: 0.9 })
    for (const [x, z, ry] of [[0, -ARENA, 0], [0, ARENA, 0], [ARENA, 0, Math.PI / 2], [-ARENA, 0, Math.PI / 2]] as const) {
      const g = new THREE.Group()
      g.position.set(x, 0, z)
      g.rotation.y = ry
      scene.add(g)
      const base = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 1.4, 1.6), dark)
      base.position.y = 0.7
      base.receiveShadow = true
      g.add(base)
      const strip = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 0.22, 1.7), new THREE.MeshBasicMaterial({ color: 0x22d3ee }))
      strip.position.y = 1.45
      g.add(strip)
      const pane = new THREE.Mesh(new THREE.PlaneGeometry(ARENA * 2, 7.4), this.barrierMat)
      pane.position.y = 5.2
      g.add(pane)
      const rail = new THREE.Mesh(new THREE.BoxGeometry(ARENA * 2, 0.16, 0.16), new THREE.MeshBasicMaterial({ color: 0xe879f9 }))
      rail.position.y = 8.9
      g.add(rail)
    }

    /* ---------- pylons ---------- */
    {
      const N = 28
      const pylons = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 10, 2.6), dark, N)
      const led1 = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 7.5, 2.8), new THREE.MeshBasicMaterial({ color: 0x22d3ee }), N)
      const led2 = new THREE.InstancedMesh(new THREE.BoxGeometry(2.8, 7.5, 0.5), new THREE.MeshBasicMaterial({ color: 0x22d3ee }), N)
      const mt = new THREE.Matrix4()
      let n = 0
      for (let i = -3; i <= 3; i++) {
        const o = i * 30
        for (const [x, z] of [[o, -ARENA], [o, ARENA], [-ARENA, o], [ARENA, o]] as const) {
          mt.makeTranslation(x, 5, z)
          for (const m of [pylons, led1, led2]) m.setMatrixAt(n, mt)
          n++
        }
      }
      pylons.castShadow = true
      scene.add(pylons, led1, led2)
    }

    /* ---------- obstacles (power generators) ---------- */
    const metalTex = makeTexture(256, (g, s) => {
      g.fillStyle = '#141d30'
      g.fillRect(0, 0, s, s)
      g.strokeStyle = '#0a101d'
      g.lineWidth = 4
      for (let x = 0; x <= s; x += 64) {
        g.beginPath()
        g.moveTo(x, 0)
        g.lineTo(x, s * 0.8)
        g.stroke()
      }
      g.fillStyle = '#facc15'
      g.fillRect(0, s * 0.84, s, s * 0.16)
      g.fillStyle = '#111'
      for (let x = -s; x < s * 2; x += 32) {
        g.beginPath()
        g.moveTo(x, s)
        g.lineTo(x + 16, s)
        g.lineTo(x + 46, s * 0.84)
        g.lineTo(x + 30, s * 0.84)
        g.fill()
      }
    })
    OBSTACLES.forEach((o, i) => {
      const g = new THREE.Group()
      const tex = metalTex.clone()
      tex.needsUpdate = true
      tex.repeat.set((o.hw * 2) / 8, 1)
      const body = new THREE.Mesh(
        new THREE.BoxGeometry(o.hw * 2, o.h, o.hd * 2),
        new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.8 }),
      )
      body.position.y = o.h / 2
      body.castShadow = body.receiveShadow = true
      g.add(body)
      const neon = new THREE.MeshBasicMaterial({ color: i % 2 ? 0xe879f9 : 0x38bdf8 })
      const trim = new THREE.Mesh(new THREE.BoxGeometry(o.hw * 2 + 0.5, 0.6, o.hd * 2 + 0.5), neon)
      trim.position.y = o.h
      g.add(trim)
      for (const s of [-1, 1]) {
        for (const f of [1, -1]) {
          const st = new THREE.Mesh(new THREE.BoxGeometry(0.4, o.h * 0.6, 0.2), neon)
          st.position.set(s * o.hw * 0.6, o.h * 0.55, f * (o.hd + 0.1))
          g.add(st)
        }
      }
      const core = new THREE.Mesh(
        new THREE.CylinderGeometry(1.5, 1.5, 1.2, 12),
        new THREE.MeshStandardMaterial({ color: 0x111827, emissive: i % 2 ? 0xe879f9 : 0x38bdf8, emissiveIntensity: 1.5 }),
      )
      core.position.y = o.h + 0.9
      g.add(core)
      g.position.set(o.x, 0, o.z)
      scene.add(g)
    })

    /* ---------- dust ---------- */
    const dg = new THREE.BufferGeometry()
    const dp = new Float32Array(1800)
    for (let i = 0; i < 1800; i += 3) {
      dp[i] = (Math.random() - 0.5) * 200
      dp[i + 1] = 1 + Math.random() * 40
      dp[i + 2] = (Math.random() - 0.5) * 200
    }
    dg.setAttribute('position', new THREE.BufferAttribute(dp, 3))
    this.dust = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0x7dd3fc, size: 0.5, transparent: true, opacity: 0.55, depthWrite: false }))
    scene.add(this.dust)

    this.disposables.push(skyTex, floorTex, decalTex, metalTex, dark)

    /* ---------- hero skyline (artist building model) ---------- */
    this.offAssetsReady = assets.onReady(() => this.addHeroBuildings(scene))
  }

  /**
   * A ring of the artist-authored building model breaks up the procedural
   * city with real architecture — placed deterministically outside the arena.
   */
  private addHeroBuildings(scene: THREE.Scene): void {
    if (this.heroAdded) return
    const tpl = assets.get('building')
    if (!tpl) return
    this.heroAdded = true

    // Deterministic scatter on a ring outside the barrier (LCG, fixed seed).
    let rngState = 0x9e3779b9
    const rand = (): number => {
      rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0
      return rngState / 0xffffffff
    }
    const ring = new THREE.Group()
    ring.name = 'heroBuildings'
    const COUNT = 14
    for (let i = 0; i < COUNT; i++) {
      const angle = (i / COUNT) * Math.PI * 2 + rand() * 0.35
      const dist = 165 + rand() * 110
      const x = Math.cos(angle) * dist
      const z = Math.sin(angle) * dist
      // Skip the four street axes so the skyline doesn't block sightlines.
      if (Math.abs(Math.cos(angle)) > 0.94 || Math.abs(Math.sin(angle)) > 0.94) continue
      const h = 62 + rand() * 95
      const b = tpl.scene.clone(true)
      b.scale.set(h, h, h)
      b.position.set(x, -tpl.minY * h, z)
      b.rotation.y = Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.4
      ring.add(b)
    }
    ring.traverse(o => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = false
        mesh.receiveShadow = false
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const m of mats) {
          const std = m as THREE.MeshStandardMaterial
          if (std.isMeshStandardMaterial) std.envMapIntensity = 0.9
        }
      }
    })
    scene.add(ring)
    this.disposables.push({ dispose: (): void => { ring.removeFromParent() } })
  }

  /**
   * Procedural city on a street grid — but unlike the original (which drew
   * ~270 separate meshes), each building's UVs are baked at build time so the
   * entire city merges into 3 draw calls: buildings, neon bands, pillars.
   */
  private buildCity(scene: THREE.Scene): void {
    const winTex = makeTexture(128, (g, s) => {
      g.fillStyle = '#04060d'
      g.fillRect(0, 0, s, s)
      const colors = ['#7dd3fc', '#f0abfc', '#fde68a', '#a5b4fc']
      for (let y = 4; y < s; y += 12) {
        for (let x = 4; x < s; x += 12) {
          if (Math.random() < 0.38) {
            g.fillStyle = colors[(Math.random() * 4) | 0]
            g.fillRect(x, y, 7, 8)
          }
        }
      }
    }, 1)
    const buildingGeos: THREE.BufferGeometry[] = []
    const bandGeos: THREE.BufferGeometry[] = []
    const pillarGeos: THREE.BufferGeometry[] = []
    const pillarColors: number[] = []
    const bandColors: number[] = []
    const NEON = [0x22d3ee, 0xe879f9, 0xfacc15, 0x818cf8]
    const tmpColor = new THREE.Color()

    for (let gx = -5; gx <= 5; gx++) {
      for (let gz = -5; gz <= 5; gz++) {
        const cx = gx * 48
        const cz = gz * 48
        if (Math.max(Math.abs(cx), Math.abs(cz)) < ARENA + 36 || Math.random() < 0.2) continue
        const w = 20 + Math.random() * 14
        const d = 20 + Math.random() * 14
        const h = 40 + Math.random() * 70 + Math.hypot(cx, cz) * 0.25
        // Bake per-building texture density into UVs (single shared material).
        const geo = new THREE.BoxGeometry(w, h, d)
        const uv = geo.attributes.uv as THREE.BufferAttribute
        for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 9), uv.getY(i) * (h / 9))
        geo.translate(cx, h / 2, cz)
        buildingGeos.push(geo)
        // Neon base band (vertex-colored).
        const band = new THREE.BoxGeometry(w + 1, 0.7, d + 1)
        band.translate(cx, 0.35, cz)
        tmpColor.setHex(NEON[(gx + gz + 10) % 4]!)
        const count = band.attributes.position.count
        for (let i = 0; i < count; i++) bandColors.push(tmpColor.r, tmpColor.g, tmpColor.b)
        bandGeos.push(band)
        // Light pillar on one corner.
        const ph = h * (0.4 + Math.random() * 0.5)
        const pil = new THREE.BoxGeometry(1.2, ph, 1.2)
        pil.translate(cx - Math.sign(cx || 1) * w / 2, 4 + ph / 2, cz - Math.sign(cz || 1) * d / 2)
        const pcount = pil.attributes.position.count
        for (let i = 0; i < pcount; i++) pillarColors.push(tmpColor.r, tmpColor.g, tmpColor.b)
        pillarGeos.push(pil)
      }
    }

    if (buildingGeos.length) {
      const buildings = new THREE.Mesh(
        mergeGeometries(buildingGeos)!,
        new THREE.MeshBasicMaterial({ map: winTex, color: 0xaab4d8 }),
      )
      scene.add(buildings)
      const bands = new THREE.Mesh(
        mergeGeometries(bandGeos)!,
        new THREE.MeshBasicMaterial({ vertexColors: true }),
      )
      scene.add(bands)
      const pillars = new THREE.Mesh(
        mergeGeometries(pillarGeos)!,
        new THREE.MeshBasicMaterial({ vertexColors: true }),
      )
      scene.add(pillars)
      for (const g of [...buildingGeos, ...bandGeos, ...pillarGeos]) g.dispose()
    }
    this.disposables.push(winTex)
  }

  update(dt: number, px: number, pz: number, cameraPos: THREE.Vector3): void {
    this.barrierMat.uniforms.t.value += dt
    ;(this.barrierMat.uniforms.pp.value as THREE.Vector3).set(px, 0, pz)
    this.dust.rotation.y += dt * 0.01
    this.sky.position.copy(cameraPos)
    this.keyLight.position.set(px + 30, 70, pz + 40)
    this.keyLight.target.position.set(px, 0, pz)
    this.playerLight.position.set(px, 6, pz)
  }

  boom(x: number, z: number, color: number, intensity = 10): void {
    this.boomLight.position.set(x, 5, z)
    this.boomLight.color.setHex(color)
    this.boomLight.intensity = intensity
  }

  decayBoom(dt: number): void {
    this.boomLight.intensity = Math.max(0, this.boomLight.intensity - dt * 40)
  }

  dispose(): void {
    this.offAssetsReady()
    for (const d of this.disposables) d.dispose()
    this.barrierMat.dispose()
  }
}
