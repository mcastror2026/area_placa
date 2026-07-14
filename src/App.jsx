import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  analyzeGrowth,
  computeHistogram,
  autoThreshold,
  magicWandAdd,
  paintBrush,
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
  const manualMaskRef = useRef(null)

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hasImage, setHasImage] = useState(false)
  const [tab, setTab] = useState('medir') // 'medir' | 'avanzado' | 'resultados'
  const [tool, setTool] = useState('roi') // 'roi' | 'scale' | 'wand' | 'brush'

  const [roi, setRoi] = useState({ cx: 0, cy: 0, rx: 0, ry: 0 })
  const [range, setRange] = useState({ min: 128, max: 255 })
  const [brighter, setBrighter] = useState(true)
  const [method, setMethod] = useState('default')
  const [overlay, setOverlay] = useState(true)
  const [particles, setParticles] = useState({ minSize: 0, largestOnly: false })

  // Ajuste manual del crecimiento (varita / pincel).
  const [maskActive, setMaskActive] = useState(false)
  const [maskVersion, setMaskVersion] = useState(0)
  const [wandTol, setWandTol] = useState(40)
  const [brush, setBrush] = useState({ size: 24, erase: false })

  // Calibracion: por diametro de la placa (simple) o por linea (avanzado).
  const [calibMode, setCalibMode] = useState('diameter')
  const [plateDiameter, setPlateDiameter] = useState(90) // mm
  const [scaleLine, setScaleLine] = useState(null) // {x1,y1,x2,y2}
  const [lineScale, setLineScale] = useState(null) // {pixelsPerUnit, unit}
  const [known, setKnown] = useState({ dist: 10, unit: 'mm' })

  const [results, setResults] = useState(null)
  const [rows, setRows] = useState([])
  const [label, setLabel] = useState('')

  // Escala efectiva. En modo diametro se deriva sola de la placa dibujada.
  const scale = useMemo(() => {
    if (calibMode === 'diameter') {
      const pxDiameter = roi.rx + roi.ry
      if (plateDiameter > 0 && pxDiameter > 0) {
        return { pixelsPerUnit: pxDiameter / plateDiameter, unit: 'mm' }
      }
      return null
    }
    return lineScale
  }, [calibMode, plateDiameter, roi.rx, roi.ry, lineScale])

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
      setLineScale(null)
      manualMaskRef.current = null
      setMaskActive(false)
      setMaskVersion(0)
      setTool('roi')
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }, [])

  // Redibujo: imagen + overlay + circulo de la placa + linea de escala.
  useEffect(() => {
    if (!hasImage || !baseDataRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const base = baseDataRef.current

    const manual = maskActive ? manualMaskRef.current : null
    const res = analyzeGrowth(base, roi, range, particles, manual)
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

    // Circulo / elipse de la placa
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.ellipse(roi.cx, roi.cy, Math.max(1, roi.rx), Math.max(1, roi.ry), 0, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(roi.cx, roi.cy, 3, 0, Math.PI * 2)
    ctx.fill()

    // Linea de escala (modo avanzado)
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
  }, [hasImage, roi, range, overlay, particles, scaleLine, maskActive, maskVersion])

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

  const ensureMask = () => {
    const n = size.w * size.h
    if (!manualMaskRef.current || manualMaskRef.current.length !== n) {
      manualMaskRef.current = new Uint8Array(n)
    }
    return manualMaskRef.current
  }

  const paintAt = (p) => {
    const mask = ensureMask()
    paintBrush(mask, size.w, size.h, p.x, p.y, brush.size, brush.erase ? 0 : 1)
    setMaskActive(true)
    setMaskVersion((v) => v + 1)
  }

  const wandAt = (p) => {
    if (!baseDataRef.current) return
    const mask = ensureMask()
    magicWandAdd(baseDataRef.current, roi, mask, p.x, p.y, wandTol)
    setMaskActive(true)
    setMaskVersion((v) => v + 1)
  }

  const onPointerDown = (e) => {
    if (!hasImage) return
    canvasRef.current.setPointerCapture(e.pointerId)
    const p = toCanvas(e)
    dragRef.current = { start: p, tool }
    if (tool === 'scale') {
      setScaleLine({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    } else if (tool === 'brush') {
      paintAt(p)
    } else if (tool === 'wand') {
      wandAt(p)
    } else {
      setRoi((r) => ({ ...r, cx: p.x, cy: p.y }))
    }
  }

  const onPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const p = toCanvas(e)
    if (drag.tool === 'scale') {
      setScaleLine((l) => (l ? { ...l, x2: p.x, y2: p.y } : l))
    } else if (drag.tool === 'brush') {
      paintAt(p)
    } else if (drag.tool === 'roi') {
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

  const seedFromThreshold = () => {
    if (!baseDataRef.current) return
    const res = analyzeGrowth(baseDataRef.current, roi, range, null, null)
    const mask = ensureMask()
    mask.set(res.mask)
    setMaskActive(true)
    setMaskVersion((v) => v + 1)
  }

  const clearManual = () => {
    if (manualMaskRef.current) manualMaskRef.current.fill(0)
    setMaskActive(false)
    setMaskVersion((v) => v + 1)
  }

  const applyLineScale = () => {
    if (!scaleLine || !known.dist) return
    const dx = scaleLine.x2 - scaleLine.x1
    const dy = scaleLine.y2 - scaleLine.y1
    const lenPx = Math.sqrt(dx * dx + dy * dy)
    if (lenPx < 1) return
    setLineScale({ pixelsPerUnit: lenPx / known.dist, unit: known.unit || 'u' })
  }

  const applyAuto = () => {
    if (!baseDataRef.current) return
    const { hist, total } = computeHistogram(baseDataRef.current, roi)
    const t = autoThreshold(hist, total, method)
    setRange(brighter ? { min: t, max: 255 } : { min: 0, max: t })
  }

  const setMin = (v) => setRange((r) => ({ ...r, min: Math.min(v, r.max) }))
  const setMax = (v) => setRange((r) => ({ ...r, max: Math.max(v, r.min) }))

  // Sensibilidad (0-100): version amigable del umbral. Mas sensibilidad detecta
  // crecimiento mas tenue.
  const sensitivity = brighter
    ? Math.round(((255 - range.min) / 255) * 100)
    : Math.round((range.max / 255) * 100)
  const setSensitivity = (s) => {
    const t = Math.round((s / 100) * 255)
    setRange(brighter ? { min: 255 - t, max: 255 } : { min: 0, max: t })
  }

  // Conversion a unidades reales.
  const areaUnit = scale ? scale.unit + '²' : 'px²'
  const toArea = (px) => (scale ? px / (scale.pixelsPerUnit * scale.pixelsPerUnit) : px)
  const fmtArea = (px) => {
    const v = toArea(px)
    return scale ? v.toFixed(2) : Math.round(v).toLocaleString()
  }

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
      `area_placa_${areaUnit}`, 'media_gris', 'min_gris', 'max_gris',
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

  const avgRadius = Math.round((roi.rx + roi.ry) / 2)

  return (
    <div className="app">
      <header>
        <h1>Area de crecimiento de hongos</h1>
        <p className="subtitle">
          Mide cuanto ha crecido un hongo en una placa Petri a partir de una foto.
        </p>
      </header>

      <div className="layout">
        <section className="canvas-panel">
          <div className="file-row">
            <label className="btn-file">
              📁 Elegir foto
              <input type="file" accept="image/*"
                onChange={(e) => loadImage(e.target.files?.[0])} />
            </label>
            <label className="btn-file">
              📷 Tomar foto
              <input type="file" accept="image/*" capture="environment"
                onChange={(e) => loadImage(e.target.files?.[0])} />
            </label>
          </div>

          {hasImage && (
            <div className="tool-row">
              <button className={tool === 'roi' ? 'active' : ''}
                onClick={() => setTool('roi')}>⭕ Placa</button>
              <button className={tool === 'wand' ? 'active' : ''}
                onClick={() => setTool('wand')}>🪄 Varita</button>
              <button className={tool === 'brush' ? 'active' : ''}
                onClick={() => setTool('brush')}>🖌️ Pincel</button>
              {calibMode === 'line' && (
                <button className={tool === 'scale' ? 'active' : ''}
                  onClick={() => setTool('scale')}>📏 Escala</button>
              )}
            </div>
          )}

          <div className="canvas-wrap">
            {!hasImage && <div className="placeholder">Elige o toma una foto de la placa</div>}
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
              {tool === 'roi' && 'Toca el centro de la placa y arrastra hasta el borde para marcarla.'}
              {tool === 'scale' && 'Arrastra una linea sobre una distancia conocida y define la escala.'}
              {tool === 'wand' && 'Toca sobre el hongo: selecciona automaticamente la mancha de color similar.'}
              {tool === 'brush' && 'Pinta o borra el area del hongo arrastrando el dedo.'}
            </p>
          )}
        </section>

        <section className="controls">
          <div className="tabs">
            <button className={tab === 'medir' ? 'on' : ''} onClick={() => setTab('medir')}>Medir</button>
            <button className={tab === 'avanzado' ? 'on' : ''} onClick={() => setTab('avanzado')}>Avanzado</button>
            <button className={tab === 'resultados' ? 'on' : ''} onClick={() => setTab('resultados')}>
              Resultados{rows.length ? ` (${rows.length})` : ''}
            </button>
          </div>

          {/* ---------- TAB MEDIR ---------- */}
          {tab === 'medir' && (
            <>
              <fieldset disabled={!hasImage}>
                <legend>1. La placa</legend>
                <label className="mini">
                  Diametro real de la placa (mm)
                  <input type="number" min="1" step="1" value={plateDiameter}
                    onChange={(e) => setPlateDiameter(+e.target.value)} />
                </label>
                <label>Tamaño del circulo
                  <input type="range" min="10" max={Math.round(Math.max(size.w, size.h) / 2) || 100}
                    value={avgRadius}
                    onChange={(e) => { const v = +e.target.value; setRoi((r) => ({ ...r, rx: v, ry: v })) }} />
                </label>
                <p className="tiny">Ajusta el circulo azul hasta que coincida con el borde de la placa.</p>
              </fieldset>

              <fieldset disabled={!hasImage}>
                <legend>2. Deteccion del hongo</legend>
                <label>Sensibilidad: {sensitivity}%
                  <input type="range" min="0" max="100" value={sensitivity}
                    onChange={(e) => setSensitivity(+e.target.value)} />
                </label>
                <button type="button" onClick={applyAuto}>Detectar automaticamente</button>
                <label className="check">
                  <input type="checkbox" checked={brighter}
                    onChange={(e) => setBrighter(e.target.checked)} />
                  El hongo es mas claro que el fondo
                </label>
                <label className="check">
                  <input type="checkbox" checked={overlay}
                    onChange={(e) => setOverlay(e.target.checked)} />
                  Resaltar en rojo lo detectado
                </label>
              </fieldset>

              <fieldset disabled={!hasImage}>
                <legend>3. Retocar a mano (opcional)</legend>
                <p className="tiny">
                  {maskActive ? 'Estas retocando a mano.' : 'Usa la Varita o el Pincel de arriba para corregir la deteccion.'}
                </p>
                <label>Varita: tolerancia {wandTol}
                  <input type="range" min="1" max="150" value={wandTol}
                    onChange={(e) => setWandTol(+e.target.value)} />
                </label>
                <label>Pincel: tamaño {brush.size}
                  <input type="range" min="2" max="80" value={brush.size}
                    onChange={(e) => setBrush((b) => ({ ...b, size: +e.target.value }))} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={brush.erase}
                    onChange={(e) => setBrush((b) => ({ ...b, erase: e.target.checked }))} />
                  Pincel en modo borrar
                </label>
                <button type="button" className="ghost-btn" onClick={clearManual} disabled={!maskActive}>
                  Deshacer retoques
                </button>
              </fieldset>
            </>
          )}

          {/* ---------- TAB AVANZADO ---------- */}
          {tab === 'avanzado' && (
            <>
              <fieldset disabled={!hasImage}>
                <legend>Calibracion de escala</legend>
                <div className="radio-row">
                  <label className="check">
                    <input type="radio" name="calib" checked={calibMode === 'diameter'}
                      onChange={() => setCalibMode('diameter')} />
                    Por diametro de la placa
                  </label>
                  <label className="check">
                    <input type="radio" name="calib" checked={calibMode === 'line'}
                      onChange={() => { setCalibMode('line'); setTool('scale') }} />
                    Por linea (distancia conocida)
                  </label>
                </div>
                {calibMode === 'line' && (
                  <>
                    <div className="row">
                      <label className="mini">Distancia
                        <input type="number" min="0" step="any" value={known.dist}
                          onChange={(e) => setKnown((k) => ({ ...k, dist: +e.target.value }))} />
                      </label>
                      <label className="mini">Unidad
                        <input type="text" value={known.unit} size="4"
                          onChange={(e) => setKnown((k) => ({ ...k, unit: e.target.value }))} />
                      </label>
                    </div>
                    <button type="button" onClick={applyLineScale} disabled={!scaleLine}>
                      Definir escala con la linea
                    </button>
                  </>
                )}
                <div className="scale-status">
                  {scale ? `1 ${scale.unit} = ${scale.pixelsPerUnit.toFixed(2)} px` : 'Sin calibrar (resultados en px)'}
                </div>
              </fieldset>

              <fieldset disabled={!hasImage}>
                <legend>Placa: posicion y forma (elipse)</legend>
                <label>Centro X: {roi.cx}
                  <input type="range" min="0" max={size.w} value={roi.cx}
                    onChange={(e) => setRoi((r) => ({ ...r, cx: +e.target.value }))} />
                </label>
                <label>Centro Y: {roi.cy}
                  <input type="range" min="0" max={size.h} value={roi.cy}
                    onChange={(e) => setRoi((r) => ({ ...r, cy: +e.target.value }))} />
                </label>
                <label>Radio X: {roi.rx}
                  <input type="range" min="1" max={size.w} value={roi.rx}
                    onChange={(e) => setRoi((r) => ({ ...r, rx: +e.target.value }))} />
                </label>
                <label>Radio Y: {roi.ry}
                  <input type="range" min="1" max={size.h} value={roi.ry}
                    onChange={(e) => setRoi((r) => ({ ...r, ry: +e.target.value }))} />
                </label>
              </fieldset>

              <fieldset disabled={!hasImage}>
                <legend>Umbral manual (Threshold)</legend>
                <label>Min: {range.min}
                  <input type="range" min="0" max="255" value={range.min}
                    onChange={(e) => setMin(+e.target.value)} />
                </label>
                <label>Max: {range.max}
                  <input type="range" min="0" max="255" value={range.max}
                    onChange={(e) => setMax(+e.target.value)} />
                </label>
                <div className="row">
                  <label className="mini grow">Metodo automatico
                    <select value={method} onChange={(e) => setMethod(e.target.value)}>
                      {METHODS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </select>
                  </label>
                  <button type="button" onClick={applyAuto}>Aplicar</button>
                </div>
              </fieldset>

              <fieldset disabled={!hasImage}>
                <legend>Limpieza de ruido (Analyze Particles)</legend>
                <label className="mini">Ignorar manchas menores a (px²)
                  <input type="number" min="0" step="1" value={particles.minSize}
                    onChange={(e) => setParticles((p) => ({ ...p, minSize: +e.target.value }))} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={particles.largestOnly}
                    onChange={(e) => setParticles((p) => ({ ...p, largestOnly: e.target.checked }))} />
                  Solo la mancha mas grande
                </label>
              </fieldset>
            </>
          )}

          {/* ---------- RESULTADO ACTUAL (visible en Medir y Avanzado) ---------- */}
          {results && tab !== 'resultados' && (
            <div className="results">
              <div className="big">{results.growthPercent.toFixed(1)}%</div>
              <div className="big-label">de la placa colonizado</div>
              <ul>
                <li>Area del hongo: <b>{fmtArea(results.growthPx)}</b> {areaUnit}</li>
                <li>Area de la placa: <b>{fmtArea(results.roiAreaPx)}</b> {areaUnit}</li>
              </ul>
              <div className="measure-row">
                <input type="text" placeholder="Etiqueta (ej. dia 3)" value={label}
                  onChange={(e) => setLabel(e.target.value)} />
                <button type="button" onClick={measure}>Guardar medida</button>
              </div>
            </div>
          )}

          {/* ---------- TAB RESULTADOS ---------- */}
          {tab === 'resultados' && (
            rows.length === 0 ? (
              <p className="tiny" style={{ padding: '12px 4px' }}>
                Aun no has guardado medidas. Pulsa “Guardar medida” en la pestaña Medir.
              </p>
            ) : (
              <div className="table-panel">
                <div className="table-head">
                  <h2>{rows.length} medida{rows.length > 1 ? 's' : ''}</h2>
                  <div>
                    <button type="button" onClick={exportCsv}>Exportar CSV</button>
                    <button type="button" className="ghost" onClick={() => setRows([])}>Limpiar</button>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>Etiqueta</th><th>Hongo ({areaUnit})</th>
                        <th>%</th><th>Placa ({areaUnit})</th>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}
        </section>
      </div>

      <footer className="app-footer">Versión 1.0 MC</footer>
    </div>
  )
}
