import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzeGrowth,
  computeHistogram,
  autoThreshold,
} from './imageAnalysis'
import './App.css'

const MAX_W = 680 // ancho maximo del canvas en pixeles

const METHODS = [
  { id: 'default', name: 'Default (IsoData)' },
  { id: 'otsu', name: 'Otsu' },
  { id: 'mean', name: 'Mean' },
  { id: 'triangle', name: 'Triangle' },
]

export default function App() {
  const canvasRef = useRef(null)
  const baseDataRef = useRef(null)
  const dragRef = useRef(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hasImage, setHasImage] = useState(false)
  const [mode, setMode] = useState('roi') // 'roi' | 'scale'

  const [roi, setRoi] = useState({ cx: 0, cy: 0, rx: 0, ry: 0 })
  const [range, setRange] = useState({ min: 128, max: 255 })
  const [brighter, setBrighter] = useState(true)
  const [method, setMethod] = useState('default')
  const [overlay, setOverlay] = useState(true)
  const [particles, setParticles] = useState({ minSize: 0, largestOnly: false })

  const [scaleLine, setScaleLine] = useState(null) // {x1,y1,x2,y2} px
  const [scale, setScale] = useState(null) // {pixelsPerUnit, unit}
  const [known, setKnown] = useState({ dist: 90, unit: 'mm' })

  const [results, setResults] = useState(null)
  const [rows, setRows] = useState([])
  const [label, setLabel] = useState('')

  const loadImage = useCallback((file) => {
    if (!file) return
    const img = new Image()
    img.onload = () => {
      const s = Math.min(1, MAX_W / img.width)
      const w = Math.round(img.width * s)
      const h = Math.round(img.height * s)
      const canvas = canvasRef.current
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      baseDataRef.current = ctx.getImageData(0, 0, w, h)
      setSize({ w, h })
      setHasImage(true)
      const r = Math.round(Math.min(w, h) * 0.45)
      setRoi({ cx: Math.round(w / 2), cy: Math.round(h / 2), rx: r, ry: r })
      setScaleLine(null)
      setScale(null)
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }, [])

  // Redibujo: imagen + overlay + ROI eliptica + linea de escala.
  useEffect(() => {
    if (!hasImage || !baseDataRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const base = baseDataRef.current

    const res = analyzeGrowth(base, roi, range, particles)
    setResults({
      roiAreaPx: res.roiAreaPx,
      growthPx: res.growthPx,
      growthPercent: res.growthPercent,
      meanGray: res.meanGray,
      minGray: res.minGray,
      maxGray: res.maxGray,
    })

    const composed = new ImageData(
      new Uint8ClampedArray(base.data),
      base.width,
      base.height,
    )
    if (overlay) {
      const d = composed.data
      const m = res.mask
      for (let p = 0; p < m.length; p++) {
        if (m[p]) {
          const i = p * 4
          d[i] = Math.round(d[i] * 0.35 + 255 * 0.65)
          d[i + 1] = Math.round(d[i + 1] * 0.35)
          d[i + 2] = Math.round(d[i + 2] * 0.35)
        }
      }
    }
    ctx.putImageData(composed, 0, 0)

    // ROI eliptica
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(roi.cx, roi.cy, Math.max(1, roi.rx), Math.max(1, roi.ry), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(roi.cx, roi.cy, 3, 0, Math.PI * 2)
    ctx.fill()

    // Linea de escala
    if (scaleLine) {
      ctx.strokeStyle = '#facc15'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(scaleLine.x1, scaleLine.y1)
      ctx.lineTo(scaleLine.x2, scaleLine.y2)
      ctx.stroke()
      for (const [px, py] of [[scaleLine.x1, scaleLine.y1], [scaleLine.x2, scaleLine.y2]]) {
        ctx.beginPath()
        ctx.arc(px, py, 4, 0, Math.PI * 2)
        ctx.fillStyle = '#facc15'
        ctx.fill()
      }
    }
  }, [hasImage, roi, range, overlay, particles, scaleLine])

  // --- Interaccion con el canvas (pointer) ---
  const toCanvas = (e) => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    return {
      x: Math.round((e.clientX - rect.left) * sx),
      y: Math.round((e.clientY - rect.top) * sy),
    }
  }

  const onPointerDown = (e) => {
    if (!hasImage) return
    canvasRef.current.setPointerCapture(e.pointerId)
    const p = toCanvas(e)
    dragRef.current = { start: p, mode }
    if (mode === 'scale') {
      setScaleLine({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    } else {
      setRoi((r) => ({ ...r, cx: p.x, cy: p.y }))
    }
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const p = toCanvas(e)
    if (drag.mode === 'scale') {
      setScaleLine((l) => (l ? { ...l, x2: p.x, y2: p.y } : l))
    } else {
      const dx = p.x - drag.start.x
      const dy = p.y - drag.start.y
      const d = Math.round(Math.sqrt(dx * dx + dy * dy))
      if (d > 3) setRoi((r) => ({ ...r, rx: d, ry: d }))
    }
  }

  const onPointerUp = (e) => {
    if (dragRef.current) {
      try { canvasRef.current.releasePointerCapture(e.pointerId) } catch { /* noop */ }
    }
    dragRef.current = null
  }

  // --- Set Scale ---
  const applyScale = () => {
    if (!scaleLine || !known.dist) return
    const dx = scaleLine.x2 - scaleLine.x1
    const dy = scaleLine.y2 - scaleLine.y1
    const lenPx = Math.sqrt(dx * dx + dy * dy)
    if (lenPx < 1) return
    setScale({ pixelsPerUnit: lenPx / known.dist, unit: known.unit || 'u' })
  }

  // --- Umbral automatico ---
  const applyAuto = () => {
    if (!baseDataRef.current) return
    const { hist, total } = computeHistogram(baseDataRef.current, roi)
    const t = autoThreshold(hist, total, method)
    setRange(brighter ? { min: t, max: 255 } : { min: 0, max: t })
  }

  const setMin = (v) => setRange((r) => ({ ...r, min: Math.min(v, r.max) }))
  const setMax = (v) => setRange((r) => ({ ...r, max: Math.max(v, r.min) }))

  // Conversion a unidades reales.
  const areaUnit = scale ? scale.unit + '²' : 'px²'
  const toArea = (px) => (scale ? px / (scale.pixelsPerUnit * scale.pixelsPerUnit) : px)
  const fmtArea = (px) => {
    const v = toArea(px)
    return scale ? v.toFixed(2) : Math.round(v).toLocaleString()
  }

  // --- Tabla de resultados (Measure) ---
  const measure = () => {
    if (!results) return
    setRows((rs) => [
      ...rs,
      {
        n: rs.length + 1,
        label: label || `Medida ${rs.length + 1}`,
        roiArea: toArea(results.roiAreaPx),
        growthArea: toArea(results.growthPx),
        percent: results.growthPercent,
        mean: results.meanGray,
        min: results.minGray,
        max: results.maxGray,
        unit: areaUnit,
      },
    ])
    setLabel('')
  }

  const exportCsv = () => {
    const header = [
      'n', 'etiqueta', `area_crecimiento_${areaUnit}`, 'porcentaje',
      `area_roi_${areaUnit}`, 'media_gris', 'min_gris', 'max_gris',
    ]
    const lines = rows.map((r) => [
      r.n,
      `"${r.label}"`,
      r.growthArea.toFixed(scale ? 4 : 0),
      r.percent.toFixed(2),
      r.roiArea.toFixed(scale ? 4 : 0),
      r.mean.toFixed(1),
      r.min.toFixed(0),
      r.max.toFixed(0),
    ].join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'medidas_crecimiento.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="app">
      <header>
        <h1>Calculadora de area de crecimiento de hongos</h1>
        <p className="subtitle">
          Herramienta tipo ImageJ enfocada en medir el area de crecimiento de un
          hongo en una placa Petri. Carga o captura una foto, calibra la escala,
          ajusta la ROI y el umbral, y mide.
        </p>
      </header>

      <div className="layout">
        <section className="canvas-panel">
          <div className="file-row">
            <label className="btn-file">
              Seleccionar imagen
              <input type="file" accept="image/*"
                onChange={(e) => loadImage(e.target.files?.[0])} />
            </label>
            <label className="btn-file">
              Tomar foto
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => loadImage(e.target.files?.[0])} />
            </label>
          </div>

          {hasImage && (
            <div className="tool-row">
              <span>Herramienta:</span>
              <button
                className={mode === 'roi' ? 'active' : ''}
                onClick={() => setMode('roi')}
              >Ajustar ROI</button>
              <button
                className={mode === 'scale' ? 'active' : ''}
                onClick={() => setMode('scale')}
              >Definir escala (linea)</button>
            </div>
          )}

          <div className="canvas-wrap">
            {!hasImage && <div className="placeholder">Sin imagen cargada</div>}
            <canvas
              ref={canvasRef}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              style={{ display: hasImage ? 'block' : 'none', touchAction: 'none' }}
            />
          </div>
          {hasImage && (
            <p className="hint">
              {mode === 'roi'
                ? 'Arrastra desde el centro de la placa hacia el borde para dibujar la ROI; afina con los sliders.'
                : 'Arrastra una linea sobre una distancia conocida (p. ej. el diametro de la placa) y define la escala.'}
            </p>
          )}
        </section>

        <section className="controls">
          <fieldset disabled={!hasImage}>
            <legend>Escala (Set Scale)</legend>
            <div className="scale-status">
              {scale
                ? `1 ${scale.unit} = ${scale.pixelsPerUnit.toFixed(2)} px`
                : 'Sin calibrar (resultados en px)'}
            </div>
            <div className="row">
              <label className="mini">
                Distancia conocida
                <input type="number" min="0" step="any" value={known.dist}
                  onChange={(e) => setKnown((k) => ({ ...k, dist: +e.target.value }))} />
              </label>
              <label className="mini">
                Unidad
                <input type="text" value={known.unit} size="4"
                  onChange={(e) => setKnown((k) => ({ ...k, unit: e.target.value }))} />
              </label>
            </div>
            <button type="button" onClick={applyScale} disabled={!scaleLine}>
              Definir escala con la linea
            </button>
          </fieldset>

          <fieldset disabled={!hasImage}>
            <legend>ROI de la placa (elipse)</legend>
            <label>Centro X: {roi.cx}
              <input type="range" min="0" max={size.w} value={roi.cx}
                onChange={(e) => setRoi((r) => ({ ...r, cx: +e.target.value }))} />
            </label>
            <label>Centro Y: {roi.cy}
              <input type="range" min="0" max={size.h} value={roi.cy}
                onChange={(e) => setRoi((r) => ({ ...r, cy: +e.target.value }))} />
            </label>
            <label>Radio X: {roi.rx} px
              <input type="range" min="1" max={size.w} value={roi.rx}
                onChange={(e) => setRoi((r) => ({ ...r, rx: +e.target.value }))} />
            </label>
            <label>Radio Y: {roi.ry} px
              <input type="range" min="1" max={size.h} value={roi.ry}
                onChange={(e) => setRoi((r) => ({ ...r, ry: +e.target.value }))} />
            </label>
          </fieldset>

          <fieldset disabled={!hasImage}>
            <legend>Umbral (Threshold)</legend>
            <label>Min: {range.min}
              <input type="range" min="0" max="255" value={range.min}
                onChange={(e) => setMin(+e.target.value)} />
            </label>
            <label>Max: {range.max}
              <input type="range" min="0" max="255" value={range.max}
                onChange={(e) => setMax(+e.target.value)} />
            </label>
            <div className="row">
              <label className="mini grow">
                Metodo
                <select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
              <button type="button" onClick={applyAuto}>Aplicar auto</button>
            </div>
            <label className="check">
              <input type="checkbox" checked={brighter}
                onChange={(e) => setBrighter(e.target.checked)} />
              Fondo oscuro (el hongo es mas claro)
            </label>
            <label className="check">
              <input type="checkbox" checked={overlay}
                onChange={(e) => setOverlay(e.target.checked)} />
              Mostrar overlay de deteccion
            </label>
          </fieldset>

          <fieldset disabled={!hasImage}>
            <legend>Particulas (Analyze Particles)</legend>
            <label className="mini">
              Ignorar manchas menores a (px²)
              <input type="number" min="0" step="1" value={particles.minSize}
                onChange={(e) => setParticles((p) => ({ ...p, minSize: +e.target.value }))} />
            </label>
            <label className="check">
              <input type="checkbox" checked={particles.largestOnly}
                onChange={(e) => setParticles((p) => ({ ...p, largestOnly: e.target.checked }))} />
              Solo la region conectada mas grande
            </label>
          </fieldset>

          {results && (
            <div className="results">
              <h2>Medida actual</h2>
              <div className="big">{results.growthPercent.toFixed(1)}%</div>
              <div className="big-label">de la placa colonizado</div>
              <ul>
                <li>Area placa: <b>{fmtArea(results.roiAreaPx)}</b> {areaUnit}</li>
                <li>Area crecimiento: <b>{fmtArea(results.growthPx)}</b> {areaUnit}</li>
                <li>Gris medio: <b>{results.meanGray.toFixed(1)}</b> (min {results.minGray.toFixed(0)} / max {results.maxGray.toFixed(0)})</li>
              </ul>
              <div className="measure-row">
                <input type="text" placeholder="Etiqueta (ej. dia 3)" value={label}
                  onChange={(e) => setLabel(e.target.value)} />
                <button type="button" onClick={measure}>Medir → tabla</button>
              </div>
            </div>
          )}
        </section>
      </div>

      {rows.length > 0 && (
        <section className="table-panel">
          <div className="table-head">
            <h2>Resultados ({rows.length})</h2>
            <div>
              <button type="button" onClick={exportCsv}>Exportar CSV</button>
              <button type="button" className="ghost" onClick={() => setRows([])}>Limpiar</button>
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th><th>Etiqueta</th><th>Area crec. ({areaUnit})</th>
                  <th>%</th><th>Area ROI ({areaUnit})</th>
                  <th>Media</th><th>Min</th><th>Max</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.n}>
                    <td>{r.n}</td>
                    <td>{r.label}</td>
                    <td>{scale ? r.growthArea.toFixed(2) : Math.round(r.growthArea).toLocaleString()}</td>
                    <td>{r.percent.toFixed(1)}</td>
                    <td>{scale ? r.roiArea.toFixed(2) : Math.round(r.roiArea).toLocaleString()}</td>
                    <td>{r.mean.toFixed(1)}</td>
                    <td>{r.min.toFixed(0)}</td>
                    <td>{r.max.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
