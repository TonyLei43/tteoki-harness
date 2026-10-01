/**
 * WebGPU particle layer for the Home scene: fireflies that drift and pulse at
 * night, petals that float down by day. It renders at one quarter of the
 * banner's resolution and is scaled up without smoothing, so every particle is
 * a crisp pixel block matching the sprites. Colors come from the palette's
 * `--tteoki-*` tokens. Without WebGPU, or when the adapter or device cannot be
 * created, nothing renders; under `prefers-reduced-motion` one still frame
 * renders; the loop pauses while the page is hidden.
 */

import { useEffect, useRef } from 'react'
import css from './PixelScene.module.css'

/** Rendered pixels per canvas pixel. */
const PIXEL = 4

/** Particles drawn per frame. */
const PARTICLES = 28

/** `GPUBufferUsage.UNIFORM` and `GPUBufferUsage.COPY_DST` (WebGPU spec values; the TypeScript DOM library declares no runtime constants). */
const BUFFER_UNIFORM = 0x40
const BUFFER_COPY_DST = 0x08

/** Frame interval: 30 frames per second is enough for drifting pixels. */
const FRAME_MS = 1000 / 30

/** Full-screen triangle and a particle field in premultiplied alpha. */
export const PARTICLE_SHADER = /* wgsl */ `
struct Uniforms {
  size: vec2f,
  time: f32,
  night: f32,
  glow: vec4f,
  petal: vec4f,
}
@group(0) @binding(0) var<uniform> u: Uniforms;

@vertex
fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = array(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  return vec4f(p[i], 0.0, 1.0);
}

fn hash(n: f32) -> f32 {
  return fract(sin(n * 127.1) * 43758.5453);
}

@fragment
fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let pixel = floor(position.xy);
  var color = vec3f(0.0);
  var alpha = 0.0;
  for (var i = 0u; i < ${PARTICLES}u; i++) {
    let k = f32(i);
    let speed = 0.15 + hash(k + 3.0) * 0.35;
    var at: vec2f;
    if (u.night > 0.5) {
      // Fireflies wander around a home spot above the grass.
      let home = vec2f(hash(k) * u.size.x, (0.15 + hash(k + 1.0) * 0.6) * u.size.y);
      at = home + vec2f(sin(u.time * speed + k), cos(u.time * speed * 1.3 + k * 2.0)) * 3.0;
    } else {
      // Petals fall slowly and sway, wrapping from bottom to top.
      let fall = fract(hash(k + 1.0) + u.time * speed * 0.04);
      at = vec2f(hash(k) * u.size.x + sin(u.time * speed + k) * 2.0, fall * u.size.y * 0.85);
    }
    // Manhattan distance: a one-pixel core with a plus-shaped glow, like the pixel stars.
    let d = abs(pixel.x - floor(at.x)) + abs(pixel.y - floor(at.y));
    if (u.night > 0.5) {
      let pulse = 0.35 + 0.65 * (0.5 + 0.5 * sin(u.time * (1.0 + hash(k + 5.0) * 2.0) + k * 7.0));
      let a = select(0.0, pulse, d < 0.5) + select(0.0, pulse * 0.45, d >= 0.5 && d < 1.5);
      color += u.glow.rgb * a;
      alpha += a;
    } else {
      let a = select(0.0, 0.8, d < 0.5);
      color += u.petal.rgb * a;
      alpha += a;
    }
  }
  let a = min(alpha, 1.0);
  return vec4f(min(color, vec3f(a)), a);
}
`

/**
 * Parse a CSS color into linear-ish RGBA channels for the shader.
 * @param value - a computed color such as `rgb(255, 210, 122)` or `#FFD27A`.
 * @returns channels from 0 to 1; transparent black when unparseable.
 */
export function colorChannels(value: string): [number, number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())
  if (hex !== null) {
    const n = Number.parseInt(hex[1] ?? '0', 16)
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1]
  }
  const rgb = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(value)
  if (rgb === null) return [0, 0, 0, 0]
  return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255, 1]
}

/**
 * The particle layer.
 * @param props.night - fireflies at night, petals by day.
 * @returns a pixelated canvas, empty without WebGPU.
 */
export function PixelSky({ night }: { night: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const element = canvas.current
    const gpu = typeof navigator === 'undefined' ? undefined : navigator.gpu
    if (element === null || gpu === undefined) return
    let stopped = false
    let frame = 0
    let device: GPUDevice | undefined
    const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
    void (async () => {
      const adapter = await gpu.requestAdapter()
      if (adapter === null || stopped) return
      device = await adapter.requestDevice()
      if (stopped) { device.destroy(); return }
      const context = element.getContext('webgpu')
      if (context === null || !('getCurrentTexture' in context)) return
      const format = gpu.getPreferredCanvasFormat()
      context.configure({ device, format, alphaMode: 'premultiplied' })
      const module = device.createShaderModule({ code: PARTICLE_SHADER })
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module, entryPoint: 'vs' },
        fragment: { module, entryPoint: 'fs', targets: [{ format }] },
        primitive: { topology: 'triangle-list' },
      })
      const uniforms = device.createBuffer({ size: 48, usage: BUFFER_UNIFORM | BUFFER_COPY_DST })
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: uniforms } }] })
      const started = performance.now()
      let last = 0
      const draw = (now: number): void => {
        if (stopped || device === undefined) return
        if (!still) frame = requestAnimationFrame(draw)
        if (document.hidden || now - last < FRAME_MS) return
        last = now
        const width = Math.max(1, Math.floor(element.clientWidth / PIXEL))
        const height = Math.max(1, Math.floor(element.clientHeight / PIXEL))
        if (element.width !== width || element.height !== height) {
          element.width = width
          element.height = height
        }
        const style = getComputedStyle(element)
        const data = new Float32Array([
          width, height, (now - started) / 1000, night ? 1 : 0,
          ...colorChannels(style.getPropertyValue('--tteoki-glow') || '#FFD27A'),
          ...colorChannels(style.getPropertyValue('--tteoki-blush') || '#F4A3B8'),
        ])
        device.queue.writeBuffer(uniforms, 0, data)
        const encoder = device.createCommandEncoder()
        const pass = encoder.beginRenderPass({
          colorAttachments: [{ view: context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }],
        })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(3)
        pass.end()
        device.queue.submit([encoder.finish()])
      }
      frame = requestAnimationFrame(draw)
    })().catch((error: unknown) => {
      // WebGPU is decoration: a failed adapter, device, or pipeline leaves the static scene.
      console.warn('ui-skin: WebGPU particles unavailable', error)
    })
    return () => {
      stopped = true
      cancelAnimationFrame(frame)
      device?.destroy()
    }
  }, [night])
  return <canvas ref={canvas} className={css.sky} aria-hidden="true" />
}
