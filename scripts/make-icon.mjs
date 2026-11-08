// Renders assets/icon.png (256x256): a rounded gradient tile with a four-point sparkle.
// Dependency-free: rasterizes with signed distances and writes the PNG with node:zlib.
import { writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const SIZE = 256
const SS = 4 // supersampling per axis

const mix = (a, b, t) => a + (b - a) * t
const clamp = (v) => Math.max(0, Math.min(1, v))

function roundedRect(x, y, r) {
  const h = SIZE / 2
  const qx = Math.abs(x - h) - (h - r)
  const qy = Math.abs(y - h) - (h - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

// A sparkle: |dx|^p + |dy|^p <= R^p with p < 1 gives concave star arms.
function sparkle(x, y, cx, cy, radius) {
  const dx = Math.abs(x - cx) / radius
  const dy = Math.abs(y - cy) / radius
  return Math.pow(dx, 0.5) + Math.pow(dy, 0.5) <= 1
}

function sample(x, y) {
  if (roundedRect(x, y, 56) > 0) {
    return [0, 0, 0, 0]
  }
  // Diagonal gradient violet -> indigo -> cyan.
  const t = clamp((x + y) / (2 * SIZE))
  const c1 = [124, 58, 237]
  const c2 = [37, 99, 235]
  const c3 = [6, 182, 212]
  const col = t < 0.5 ? c1.map((v, i) => mix(v, c2[i], t * 2)) : c2.map((v, i) => mix(v, c3[i], (t - 0.5) * 2))
  if (sparkle(x, y, 118, 138, 82) || sparkle(x, y, 190, 66, 34) || sparkle(x, y, 74, 62, 20)) {
    return [255, 255, 255, 255]
  }
  return [...col, 255]
}

const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0
  for (let x = 0; x < SIZE; x++) {
    const acc = [0, 0, 0, 0]
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)
        acc[0] += s[0] * s[3]
        acc[1] += s[1] * s[3]
        acc[2] += s[2] * s[3]
        acc[3] += s[3]
      }
    }
    const o = y * (SIZE * 4 + 1) + 1 + x * 4
    const a = acc[3] / (SS * SS)
    raw[o] = acc[3] ? Math.round(acc[0] / acc[3]) : 0
    raw[o + 1] = acc[3] ? Math.round(acc[1] / acc[3]) : 0
    raw[o + 2] = acc[3] ? Math.round(acc[2] / acc[3]) : 0
    raw[o + 3] = Math.round(a)
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
])
mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon.png', png)
console.log(`assets/icon.png ${png.length} bytes`)
