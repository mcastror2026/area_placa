// Utilidades de analisis de imagen para estimar el crecimiento de un hongo
// dentro de la placa Petri. Todo el calculo se hace sobre los pixeles del
// canvas ya escalado; el area en porcentaje es invariante a la escala.

// Luminosidad percibida (0-255) a partir de RGB.
export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// Saturacion (0-1) en el modelo HSV, util para distinguir el hongo (grisaceo,
// poco saturado) del agar teñido (mas saturado/verdoso).
export function saturation(r, g, b) {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === 0) return 0
  return (max - min) / max
}

/**
 * Analiza el crecimiento dentro de un circulo.
 *
 * @param {ImageData} imageData  Pixeles del canvas (RGBA).
 * @param {object} circle        { cx, cy, r } en pixeles del canvas.
 * @param {object} opts
 *   @param {number} opts.threshold   Umbral de luminosidad 0-255.
 *   @param {boolean} opts.brighter   true = el hongo es MAS claro que el agar.
 * @returns {{ plateAreaPx:number, growthPx:number, growthPercent:number, mask:Uint8Array }}
 */
export function analyzeGrowth(imageData, circle, opts) {
  const { data, width, height } = imageData
  const { cx, cy, r } = circle
  const { threshold, brighter } = opts

  const mask = new Uint8Array(width * height)
  const r2 = r * r
  let plateAreaPx = 0
  let growthPx = 0

  const xMin = Math.max(0, Math.floor(cx - r))
  const xMax = Math.min(width - 1, Math.ceil(cx + r))
  const yMin = Math.max(0, Math.floor(cy - r))
  const yMax = Math.min(height - 1, Math.ceil(cy + r))

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx
      if (dx * dx + dy * dy > r2) continue // fuera del circulo de la placa
      plateAreaPx++

      const i = (y * width + x) * 4
      const lum = luminance(data[i], data[i + 1], data[i + 2])
      const isGrowth = brighter ? lum >= threshold : lum <= threshold
      if (isGrowth) {
        growthPx++
        mask[y * width + x] = 1
      }
    }
  }

  const growthPercent = plateAreaPx > 0 ? (growthPx / plateAreaPx) * 100 : 0
  return { plateAreaPx, growthPx, growthPercent, mask }
}

// Sugerencia automatica de umbral: metodo de Otsu sobre la luminosidad de los
// pixeles dentro del circulo. Devuelve un umbral 0-255 que separa dos clases.
export function suggestThreshold(imageData, circle) {
  const { data, width, height } = imageData
  const { cx, cy, r } = circle
  const r2 = r * r
  const hist = new Array(256).fill(0)
  let total = 0

  const xMin = Math.max(0, Math.floor(cx - r))
  const xMax = Math.min(width - 1, Math.ceil(cx + r))
  const yMin = Math.max(0, Math.floor(cy - r))
  const yMax = Math.min(height - 1, Math.ceil(cy + r))

  for (let y = yMin; y <= yMax; y++) {
    const dy = y - cy
    for (let x = xMin; x <= xMax; x++) {
      const dx = x - cx
      if (dx * dx + dy * dy > r2) continue
      const i = (y * width + x) * 4
      const lum = Math.round(luminance(data[i], data[i + 1], data[i + 2]))
      hist[lum]++
      total++
    }
  }

  if (total === 0) return 128

  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]

  let sumB = 0
  let wB = 0
  let maxVar = -1
  let threshold = 128

  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > maxVar) {
      maxVar = between
      threshold = t
    }
  }

  return threshold
}
