import { useCallback, useEffect, useRef, useState } from 'react'
import { analyzeGrowth, suggestThreshold } from './imageAnalysis'
import './App.css'

const MAX_W = 680 // ancho maximo del canvas en pixeles

export default function App() {
  const canvasRef = useRef(null)
  const baseDataRef = useRef(null) // ImageData del canvas con la imagen escalada
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hasImage, setHasImage] = useState(false)

  const [circle, setCircle] = useState({ cx: 0, cy: 0, r: 0 })
  const [threshold, setThreshold] = useState(128)
  const [brighter, setBrighter] = useState(true)
  const [showOverlay, setShowOverlay] = useState(true)
  const [realDiameter, setRealDiameter] = useState(90) // mm (placa estandar)

  const [results, setResults] = useState(null)

  // Carga la imagen seleccionada, la escala y la dibuja en el canvas.
  const loadImage = useCallback((file) => {
    if (!file) return
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_W / img.width)
      const w = Math.round(img.width * scale)
      const h = Math.round(img.height * scale)
      const canvas = canvasRef.current
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(img, 0, 0, w, h)
      baseDataRef.current = ctx.getImageData(0, 0, w, h)
      setSize({ w, h })
      setHasImage(true)
      const r = Math.round(Math.min(w, h) * 0.45)
      setCircle({ cx: Math.round(w / 2), cy: Math.round(h / 2), r })
      URL.revokeObjectURL(img.src)
    }
    img.src = URL.createObjectURL(file)
  }, [])

  // Redibuja: imagen base + overlay de crecimiento + circulo de la placa.
  useEffect(() => {
    if (!hasImage || !baseDataRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const base = baseDataRef.current

    const { growthPx, plateAreaPx, growthPercent, mask } = analyzeGrowth(
      base,
      circle,
      { threshold, brighter },
    )
    setResults({ growthPx, plateAreaPx, growthPercent })

    // Componer imagen con overlay tintado.
    const composed = new ImageData(
      new Uint8ClampedArray(base.data),
      base.width,
      base.height,
    )
    if (showOverlay) {
      const d = composed.data
      for (let p = 0; p < mask.length; p++) {
        if (mask[p]) {
          const i = p * 4
          d[i] = Math.round(d[i] * 0.35 + 255 * 0.65) // tinte rojo semitransp.
          d[i + 1] = Math.round(d[i + 1] * 0.35)
          d[i + 2] = Math.round(d[i + 2] * 0.35)
        }
      }
    }
    ctx.putImageData(composed, 0, 0)

    // Contorno del circulo de la placa + centro.
    ctx.strokeStyle = '#22d3ee'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(circle.cx, circle.cy, circle.r, 0, Math.PI * 2)
    ctx.stroke()
    ctx.fillStyle = '#22d3ee'
    ctx.beginPath()
    ctx.arc(circle.cx, circle.cy, 4, 0, Math.PI * 2)
    ctx.fill()
  }, [hasImage, circle, threshold, brighter, showOverlay])

  // Clic en el canvas = fijar el centro de la placa.
  const onCanvasClick = (e) => {
    if (!hasImage) return
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    const sx = canvas.width / rect.width
    const sy = canvas.height / rect.height
    const cx = Math.round((e.clientX - rect.left) * sx)
    const cy = Math.round((e.clientY - rect.top) * sy)
    setCircle((c) => ({ ...c, cx, cy }))
  }

  const autoThreshold = () => {
    if (!baseDataRef.current) return
    setThreshold(suggestThreshold(baseDataRef.current, circle))
  }

  // Conversion a unidades reales usando el diametro de la placa.
  let real = null
  if (results && realDiameter > 0 && circle.r > 0) {
    const mmPerPx = realDiameter / (2 * circle.r)
    const mm2PerPx = mmPerPx * mmPerPx
    const plateAreaMm2 = Math.PI * Math.pow(realDiameter / 2, 2)
    const growthAreaMm2 = results.growthPx * mm2PerPx
    real = {
      plateAreaCm2: plateAreaMm2 / 100,
      growthAreaCm2: growthAreaMm2 / 100,
    }
  }

  return (
    <div className="app">
      <header>
        <h1>Calculadora de area de crecimiento de hongos</h1>
        <p className="subtitle">
          Sube una foto de la placa Petri, ajusta el circulo de la placa y el
          umbral de deteccion para estimar el porcentaje y el area de crecimiento.
        </p>
      </header>

      <div className="layout">
        <section className="canvas-panel">
          <input
            type="file"
            accept="image/*"
            onChange={(e) => loadImage(e.target.files?.[0])}
          />
          <div className="canvas-wrap">
            {!hasImage && (
              <div className="placeholder">Sin imagen cargada</div>
            )}
            <canvas
              ref={canvasRef}
              onClick={onCanvasClick}
              style={{ display: hasImage ? 'block' : 'none' }}
            />
          </div>
          {hasImage && (
            <p className="hint">
              Haz clic sobre la placa para fijar el centro; ajusta el radio con
              el control de la derecha.
            </p>
          )}
        </section>

        <section className="controls">
          <fieldset disabled={!hasImage}>
            <legend>Calibracion de la placa</legend>

            <label>
              Centro X: {circle.cx}
              <input
                type="range" min="0" max={size.w} value={circle.cx}
                onChange={(e) => setCircle((c) => ({ ...c, cx: +e.target.value }))}
              />
            </label>
            <label>
              Centro Y: {circle.cy}
              <input
                type="range" min="0" max={size.h} value={circle.cy}
                onChange={(e) => setCircle((c) => ({ ...c, cy: +e.target.value }))}
              />
            </label>
            <label>
              Radio: {circle.r} px
              <input
                type="range" min="1" max={Math.round(Math.max(size.w, size.h) / 2)}
                value={circle.r}
                onChange={(e) => setCircle((c) => ({ ...c, r: +e.target.value }))}
              />
            </label>
            <label className="inline">
              Diametro real de la placa (mm)
              <input
                type="number" min="1" step="1" value={realDiameter}
                onChange={(e) => setRealDiameter(+e.target.value)}
              />
            </label>
          </fieldset>

          <fieldset disabled={!hasImage}>
            <legend>Deteccion del crecimiento</legend>
            <label>
              Umbral de luminosidad: {threshold}
              <input
                type="range" min="0" max="255" value={threshold}
                onChange={(e) => setThreshold(+e.target.value)}
              />
            </label>
            <button type="button" onClick={autoThreshold}>
              Umbral automatico (Otsu)
            </button>
            <label className="check">
              <input
                type="checkbox" checked={brighter}
                onChange={(e) => setBrighter(e.target.checked)}
              />
              El hongo es mas claro que el agar
            </label>
            <label className="check">
              <input
                type="checkbox" checked={showOverlay}
                onChange={(e) => setShowOverlay(e.target.checked)}
              />
              Mostrar overlay de deteccion
            </label>
          </fieldset>

          {results && (
            <div className="results">
              <h2>Resultados</h2>
              <div className="big">{results.growthPercent.toFixed(1)}%</div>
              <div className="big-label">de la placa colonizado</div>
              <ul>
                <li>
                  Area de la placa: <b>{results.plateAreaPx.toLocaleString()}</b> px
                  {real && <> ({real.plateAreaCm2.toFixed(2)} cm²)</>}
                </li>
                <li>
                  Area de crecimiento: <b>{results.growthPx.toLocaleString()}</b> px
                  {real && <> ({real.growthAreaCm2.toFixed(2)} cm²)</>}
                </li>
              </ul>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
