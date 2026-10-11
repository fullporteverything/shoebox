// Downscales an upload before it is stored or sent anywhere. Smaller images
// mean less sensitive data at rest and faster reads. Re-encoding through a
// canvas also strips EXIF metadata such as GPS coordinates.

export async function prepareImage(file: Blob, maxSide = 1600): Promise<{ blob: Blob; dataUrl: string }> {
  const bitmap = await loadBitmap(file)
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)
  ctx.drawImage(bitmap, 0, 0, w, h)
  if ('close' in bitmap) (bitmap as ImageBitmap).close()
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.86))
  return { blob, dataUrl: storedCopy(canvas) }
}

async function loadBitmap(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
    } catch {
      /* fall through to <img> decoding */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return img
  } catch {
    throw new Error('This file isn’t an image this browser can read. Use a JPEG, PNG or WebP photo.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(body)
  const u = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i)
  return new Blob([u], { type: mime })
}

// The copy kept in the vault: 1280 px on the long side at quality 0.8 is
// still easy to read and about half the size of what the AI is sent, which
// matters because every stored byte is synced and kept on the server.
const STORE_SIDE = 1280
function storedCopy(src: HTMLCanvasElement): string {
  const scale = Math.min(1, STORE_SIDE / Math.max(src.width, src.height))
  if (scale === 1) return src.toDataURL('image/jpeg', 0.8)
  const c = document.createElement('canvas')
  c.width = Math.round(src.width * scale)
  c.height = Math.round(src.height * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c.toDataURL('image/jpeg', 0.8)
}
