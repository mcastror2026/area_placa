# Calculadora de area de crecimiento de hongos

Aplicacion web (React + Vite) que estima el **area y el porcentaje de crecimiento
de un hongo** en una placa Petri a partir de una fotografia. Todo el
procesamiento de imagen ocurre en el navegador (Canvas API); no se sube ninguna
imagen a un servidor.

## Como funciona

1. **Cargas una foto** de la placa Petri.
2. **Calibras el circulo de la placa**: haces clic para fijar el centro y ajustas
   el radio con el control deslizante para que el circulo coincida con el borde
   interior de la placa. Opcionalmente indicas el diametro real (por defecto
   90 mm) para obtener el area en cm² reales.
3. **Ajustas el umbral de deteccion**: el hongo suele ser mas claro que el agar.
   Un umbral de luminosidad separa los pixeles de "crecimiento" del fondo. Puedes
   moverlo manualmente o pulsar **Umbral automatico (Otsu)** para una sugerencia.
   El overlay rojo muestra en vivo que pixeles se cuentan como crecimiento.
4. **Lees los resultados**: porcentaje de la placa colonizado, area de la placa y
   area de crecimiento en pixeles y cm².

## Metodo de calculo

- Area de la placa = pixeles dentro del circulo de calibracion.
- Area de crecimiento = pixeles dentro del circulo cuya luminosidad supera el
  umbral (o esta por debajo, si el hongo es mas oscuro que el agar).
- Porcentaje = area de crecimiento / area de la placa x 100.
- Conversion a unidades reales mediante el diametro indicado:
  `mm por pixel = diametro_real / (2 x radio_en_pixeles)`.

> Es una estimacion basada en umbral de color. La precision depende de la
> iluminacion, el contraste entre hongo y agar, y de una buena calibracion del
> circulo. Para medidas cuantitativas, fotografia siempre en condiciones de luz
> similares.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de produccion en dist/
npm run preview  # sirve el build
```

## Stack

- React 18 + Vite 5
- Canvas API para el analisis de pixeles (sin dependencias de vision por
  computador externas)
