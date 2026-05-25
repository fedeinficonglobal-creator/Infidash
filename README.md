# Infidash

Infidash es un dashboard para agencias con autenticación local, SQLite persistente y vistas operativas para clientes, ventas, tráfico, SEO, RRSS, insights IA, reportes e integraciones.

## Requisitos

- Node.js 18+ recomendado
- npm

## Scripts

- `npm run dev` — levanta el frontend Vite en `http://127.0.0.1:3000`
- `npm run api` — levanta la API Express en `http://127.0.0.1:4000`
- `npm run build` — build de producción
- `npm run preview` — preview del build
- `npm run lint` — comprobación TypeScript para frontend y backend
- `npm run test` — suite de regresión
- `npm run clean` — borra `dist/` y `server.js` (no toca `data/`)

## Variables de entorno

Copia `.env.example` a tu entorno local y ajusta lo necesario:

- `API_PORT` — puerto del backend Express
- `PORT` — fallback del puerto en algunos entornos
- `INFIDASH_DB_PATH` — ruta del fichero SQLite
- `INFIDASH_BACKUP_DIR` — carpeta de backups SQLite
- `APP_URL` — URL pública/local del frontend cuando haga falta generar enlaces o callbacks

## Arranque local

1. Instala dependencias:
   ```bash
   npm install
   ```
2. Arranca la API:
   ```bash
   npm run api
   ```
3. En otra terminal, arranca el frontend:
   ```bash
   npm run dev
   ```
4. Abre `http://127.0.0.1:3000`

## Datos y persistencia

- La base de datos vive en `./data/infidash.sqlite` por defecto.
- El contenido de `data/` se genera en tiempo de ejecución y no se versiona.
- La app se inicializa con datos semilla para poder probar login y dashboard desde el primer arranque.

## Verificación rápida

```bash
npm run lint
npm run test
npm run build
```

## Notas operativas

- La autenticación usa sesión/token con roles `admin` y `viewer`.
- Los backups SQLite se crean desde la API y se guardan en `data/backups/` por defecto.
- Si borras `data/`, la siguiente ejecución volverá a crear la base y las semillas.
