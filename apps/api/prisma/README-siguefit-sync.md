# SigueFit → plataforma (sync semanal)

Mientras el estudio sigue operando en **SigueFit**, esto mantiene la agenda de
la plataforma como **espejo**. SigueFit es la fuente de verdad; el script no
sincroniza nada solo — lo corrés vos, cuando querés, y por defecto **no escribe
nada** hasta que le pasás `--commit`.

Se corre entero cada vez (es idempotente): dos corridas seguidas con el mismo
archivo dan el mismo resultado.

---

## Una vez por semana

### 1. Exportar de SigueFit

En la **lista de turnos** (la vista de tabla), botón **Exportar**.

- Rango recomendado: **desde 1 semana atrás hasta 2 semanas adelante**.
- Si te da un `.xlsx`, abrilo y **Guardar como → CSV**.
- Guardá el archivo en `apps/api/prisma/siguefit-data/` (esa carpeta está en
  `.gitignore`, no se sube).
- El script usa estas columnas (los nombres pueden variar un poco, los busca
  por aproximación): `Fecha`, `Hora`, `Nombre del Cliente`, `Observación`,
  `Comentarios`. El resto lo ignora.
- El **saldo de cada alumna** sale del `X/Y` que la profe escribe en
  `Comentarios` (ej. `3/8` = va por la clase 3 de un pack de 8). Toma el `X/Y`
  del turno **más reciente** de cada alumna.

### 2. Correr en seco

```bash
cd apps/api
pnpm siguefit:sync -- --file prisma/siguefit-data/export.csv --weeks 2
```

Lee el reporte:

- **Sin match** — nombres que no encontró entre las alumnas cargadas. No los
  toca. Si es una alumna nueva, agregala desde *Alumnos* (o usá
  `--crear-faltantes`, que crea sólo las que no tienen ningún parecido).
- **Saldos** — qué packs va a crear / ajustar. Un `(salto grande, revisá)`
  marca un cambio de más de 2 clases de una semana a la otra: miralo.
- **Grilla** — qué turnos va a crear y cuáles va a cancelar (porque ya no están
  en SigueFit). También avisa si hay un horario que no está en
  *Horarios de clase* o una clase que se pasa de cupo.

### 3. Aplicar

```bash
pnpm siguefit:sync -- --file prisma/siguefit-data/export.csv --weeks 2 --commit
```

### 4. Revisar el calendario

De ahí en adelante lo que ya tenés sigue funcionando solo: el cron completa las
clases que pasaron y descuenta el crédito. Cada semana volvés al paso 1.

---

## Opciones

| Flag | Qué hace |
|---|---|
| `--file <path>` | El CSV exportado de SigueFit. **Obligatorio.** |
| `--weeks <n>` | Semanas hacia adelante que reconcilia la grilla. Default `2`. **Poné el mismo número de semanas que exportaste**, si no cancela turnos de más. |
| `--commit` | Escribe. Sin esto es dry run. |
| `--crear-faltantes` | Crea alumnas para los nombres sin ningún parecido. |
| `--force` | Deja pasar aunque haya muchas cancelaciones (ver abajo). |
| `--tz <zona>` | Fuerza una timezone (default: la del negocio). |

## Salvaguardas

- **Dry run por defecto.** Nada se escribe sin `--commit`.
- **Freno de cancelaciones.** Si el plan cancela más del 30% de los turnos
  futuros (mínimo 5), aborta y pide `--force`. Casi siempre significa que
  exportaste menos semanas de las que tenés cargadas — revisá antes de forzar.
- **No inventa alumnas.** Un nombre que no matchea con seguridad se reporta,
  no se adivina.
- **No toca el pasado.** Clases ya dadas no se modifican.
- **No toca Google Calendar.**

## Supuestos mientras dura el espejo

- No registrás pagos a mano en *Pagos y clases* para estas alumnas: el script
  es dueño de todos los packs. Cuando el estudio haga el cambio real, esto se
  libera y volvés a la operación normal (registrar el pack al renovar, etc.).
- Los servicios **Pack 4 / Pack 8 / Pack 12** existen en *Servicios* con su
  `sessionCount`. Si falta uno, el script te avisa y saltea esas alumnas.

## Cómo está hecho

- Lógica pura y testeada: `apps/api/src/siguefit/*.ts` (+ `*.spec.ts`).
- Pegamento CLI + Prisma: este `prisma/siguefit-sync.ts` (sin test, igual que
  `seed.ts`).
- Es temporal. Cuando el estudio migre, se borra `apps/api/src/siguefit/`,
  `prisma/siguefit-sync.ts` y este README.
