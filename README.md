# Calculadora de area de crecimiento de hongos (area_placa)

Aplicacion web (React + Vite) tipo **ImageJ pero enfocada en una sola funcion**:
medir el **area y el porcentaje de crecimiento de un hongo** en una placa Petri
a partir de una fotografia. Todo el procesamiento ocurre en el navegador
(Canvas API); no se sube ninguna imagen a un servidor. Funciona en escritorio y
en el movil (incluye captura directa desde la camara).

## Funciones

- **Carga o captura de imagen**: seleccionar archivo o **Tomar foto** con la
  camara trasera del movil (`capture="environment"`).
- **Set Scale (calibracion)**: dibuja una linea sobre una distancia conocida
  (p. ej. el diametro de la placa) e indica la longitud real + unidad; todas las
  areas se muestran en unidades reales (mm², cm², etc.).
- **ROI eliptica**: define la placa como una elipse (centro + radios X/Y
  independientes) para ajustarte a placas fotografiadas en perspectiva.
- **Threshold**: rango de luminosidad min/max con overlay rojo en vivo y metodos
  automaticos (**Default/IsoData, Otsu, Mean, Triangle**) y opcion de fondo
  oscuro/claro.
- **Analyze Particles**: ignora manchas menores a N px² o conserva solo la
  region conectada mas grande, para eliminar ruido del borde.
- **Ventana de Resultados (Measure)**: cada medida se añade a una tabla
  (etiqueta, area de crecimiento, %area, gris medio/min/max) y se exporta a
  **CSV** — util para seguir el crecimiento dia a dia.

## Metodo de calculo

- Area de la placa = pixeles dentro de la ROI eliptica.
- Area de crecimiento = pixeles dentro de la ROI cuya luminosidad cae en el
  rango [min, max], tras el filtrado de particulas.
- Porcentaje = area de crecimiento / area de la placa x 100.
- Unidades reales: `unidades por pixel = distancia_conocida / longitud_linea_px`;
  el area se convierte dividiendo por `pixeles_por_unidad²`.

> Es una estimacion basada en umbral de color. La precision depende de la
> iluminacion, del contraste entre hongo y agar, y de una buena calibracion de
> la ROI y la escala. Fotografia siempre en condiciones de luz similares para
> comparar entre dias.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de produccion en dist/
npm run preview  # sirve el build
```

## Despliegue en Netlify

El repo incluye `netlify.toml` (build `npm run build`, publish `dist`, Node 20).
En Netlify: **Add new site → Import from Git → GitHub**, elige el repo y
despliega. Cada push a `main` redesplegara automaticamente.

## Stack

- React 18 + Vite 5
- Canvas API para el analisis de pixeles (sin dependencias de vision externas)
