// Motor de analisis tipo ImageJ enfocado en medir el area de crecimiento de un
// hongo dentro de una ROI eliptica (la placa Petri). Todo trabaja sobre los
// pixeles del canvas escalado; el area en % es invariante a la escala y el area
// real se obtiene con la calibracion (px por unidad) del Set Scale.

export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

// Recorre la ROI eliptica y ejecuta un callback por cada pixel interior.
function forEachInEllipse(width, height, roi, fn) {
  const { cx, cy } = roi
  const rx = Math.max(1, roi.rx)
  const ry = Math.max(1, roi.ry)
  const xMin = Math.max(0, Math.floor(cx - rx))
  const xMax = Math.min(width - 1, Math.ceil(cx + rx))
  const yMin = Math.max(0, Math.floor(cy - ry))
  const yMax = Math.min(height - 1, Math.ceil(cy + ry))
  for (let y = yMin; y <= yMax; y++) {
    const ey = (y - cy) / ry
    for (let x = xMin; x <= xMax; x++) {
      const ex = (x - cx) / rx
      if (ex * ex + ey * ey > 1) continue
      fn(x, y)
    }
  }
}

// Histograma de luminosidad (0-255) dentro de la ROI.
export function computeHistogram(imageData, roi) {
  const { data, width, height } = imageData
  const hist = new Array(256).fill(0)
  let total = 0
  forEachInEllipse(width, height, roi, (x, y) => {
    const i = (y * width + x) * 4
    const lum = Math.round(luminance(data[i], data[i + 1], data[i + 2]))
    hist[lum]++
    total++
  })
  return { hist, total }
}

// --- Metodos automaticos de umbral (0-255) sobre un histograma ---

function thrOtsu(hist, total) {
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

// IsoData / intermeans (equivalente al "Default" de ImageJ).
function thrIsoData(hist, total) {
  if (total === 0) return 128
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  let t = Math.round(sum / total) // media como semilla
  for (let iter = 0; iter < 1000; iter++) {
    let wB = 0
    let sB = 0
    for (let i = 0; i <= t; i++) {
      wB += hist[i]
      sB += i * hist[i]
    }
    const wF = total - wB
    const sF = sum - sB
    const mB = wB > 0 ? sB / wB : 0
    const mF = wF > 0 ? sF / wF : 0
    const newT = Math.round((mB + mF) / 2)
    if (newT === t) break
    t = newT
  }
  return t
}

function thrMean(hist, total) {
  if (total === 0) return 128
  let sum = 0
  for (let t = 0; t < 256; t++) sum += t * hist[t]
  return Math.round(sum / total)
}

// Metodo del triangulo (Zack et al.). Trabaja sobre una copia del histograma.
function thrTriangle(hist) {
  const h = hist.slice()
  let min = 0
  let max = 0
  let min2 = 255
  let peak = 0
  let dmax = 0
  for (let i = 0; i < 256; i++) {
    if (h[i] > 0) { min = i; break }
  }
  if (min > 0) min--
  for (let i = 255; i > 0; i--) {
    if (h[i] > 0) { min2 = i; break }
  }
  if (min2 < 255) min2++
  for (let i = 0; i < 256; i++) {
    if (h[i] > dmax) { dmax = h[i]; peak = i }
  }
  let inverted = false
  if (peak - min < min2 - peak) {
    inverted = true
    let l = 0
    let r = 255
    while (l < r) {
      const tmp = h[l]; h[l] = h[r]; h[r] = tmp
      l++; r--
    }
    min = 255 - min2
    peak = 255 - peak
  }
  if (min === peak) return min
  const nx = h[peak]
  const ny = peak - min
  const d = Math.sqrt(nx * nx + ny * ny)
  const ux = nx / d
  const uy = ny / d
  const dRef = ux * min + uy * h[min]
  let split = min
  let splitDist = 0
  for (let i = min + 1; i <= peak; i++) {
    const dist = ux * i + uy * h[i] - dRef
    if (dist > splitDist) { splitDist = dist; split = i }
  }
  split--
  return inverted ? 255 - split : split
}

export function autoThreshold(hist, total, method) {
  switch (method) {
    case 'otsu': return thrOtsu(hist, total)
    case 'mean': return thrMean(hist, total)
    case 'triangle': return thrTriangle(hist)
    case 'default':
    default: return thrIsoData(hist, total)
  }
}

// Etiquetado de componentes conexas (4-conectividad) para "Analyze Particles":
// descarta manchas menores a minSize o conserva solo la region mas grande.
export function filterParticles(mask, width, height, opts) {
  const minSize = opts?.minSize || 0
  const largestOnly = !!opts?.largestOnly
  const labels = new Int32Array(width * height)
  const stack = new Int32Array(width * height)
  const sizes = [0]
  let current = 0
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p] || labels[p] !== 0) continue
    current++
    let sp = 0
    stack[sp++] = p
    labels[p] = current
    let size = 0
    while (sp > 0) {
      const q = stack[--sp]
      size++
      const x = q % width
      const y = (q - x) / width
      if (x > 0) { const n = q - 1; if (mask[n] && labels[n] === 0) { labels[n] = current; stack[sp++] = n } }
      if (x < width - 1) { const n = q + 1; if (mask[n] && labels[n] === 0) { labels[n] = current; stack[sp++] = n } }
      if (y > 0) { const n = q - width; if (mask[n] && labels[n] === 0) { labels[n] = current; stack[sp++] = n } }
      if (y < height - 1) { const n = q + width; if (mask[n] && labels[n] === 0) { labels[n] = current; stack[sp++] = n } }
    }
    sizes[current] = size
  }
  const keep = new Uint8Array(sizes.length)
  if (largestOnly) {
    let best = 0
    let bestSize = -1
    for (let l = 1; l < sizes.length; l++) {
      if (sizes[l] > bestSize) { bestSize = sizes[l]; best = l }
    }
    if (best > 0) keep[best] = 1
  } else {
    for (let l = 1; l < sizes.length; l++) {
      if (sizes[l] >= minSize) keep[l] = 1
    }
  }
  const out = new Uint8Array(mask.length)
  let count = 0
  for (let p = 0; p < mask.length; p++) {
    const l = labels[p]
    if (l && keep[l]) { out[p] = 1; count++ }
  }
  return { mask: out, count }
}

/**
 * Analiza el crecimiento dentro de la ROI.
 * @param {ImageData} imageData
 * @param {{cx,cy,rx,ry}} roi
 * @param {{min:number,max:number}} range  Rango de luminosidad considerado hongo.
 * @param {{minSize:number,largestOnly:boolean}} particleOpts
 */
export function analyzeGrowth(imageData, roi, range, particleOpts) {
  const { data, width, height } = imageData
  const { min, max } = range
  const rawMask = new Uint8Array(width * height)
  let roiAreaPx = 0

  forEachInEllipse(width, height, roi, (x, y) => {
    roiAreaPx++
    const i = (y * width + x) * 4
    const lum = luminance(data[i], data[i + 1], data[i + 2])
    if (lum >= min && lum <= max) rawMask[y * width + x] = 1
  })

  let mask = rawMask
  let growthPx
  if (particleOpts && (particleOpts.minSize > 0 || particleOpts.largestOnly)) {
    const r = filterParticles(rawMask, width, height, particleOpts)
    mask = r.mask
    growthPx = r.count
  } else {
    growthPx = 0
    for (let p = 0; p < rawMask.length; p++) if (rawMask[p]) growthPx++
  }

  // Estadisticas de gris sobre los pixeles finales de crecimiento.
  let sum = 0
  let mn = 255
  let mx = 0
  for (let p = 0; p < mask.length; p++) {
    if (!mask[p]) continue
    const i = p * 4
    const lum = luminance(data[i], data[i + 1], data[i + 2])
    sum += lum
    if (lum < mn) mn = lum
    if (lum > mx) mx = lum
  }
  const meanGray = growthPx > 0 ? sum / growthPx : 0
  const growthPercent = roiAreaPx > 0 ? (growthPx / roiAreaPx) * 100 : 0

  return {
    roiAreaPx,
    growthPx,
    growthPercent,
    meanGray,
    minGray: growthPx > 0 ? mn : 0,
    maxGray: growthPx > 0 ? mx : 0,
    mask,
  }
}
