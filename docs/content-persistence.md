# Persistencia editorial

La primera fase añade el esquema PostgreSQL `editorial` sin modificar las tablas existentes de Infidash ni registrar rutas HTTP.

## Migraciones

Configura `DATABASE_URL` y ejecuta:

```bash
npm run db:migrate:editorial
```

El runner toma un advisory lock de PostgreSQL, registra cada archivo y su checksum en `public.schema_migrations`, y aplica cada migración en una transacción. Debe ejecutarse una vez durante el despliegue, antes de arrancar workers o habilitar la futura API de contenidos.

## Importación de Content Hub

El importador usa dry-run por defecto:

```bash
npm run content:import -- --input=../estructura-db-content-hub.json --mapping=./content-hub-mapping.json
```

El archivo de mapeo requiere asociaciones explícitas. No empareja clientes por nombre:

```json
{
  "clients": { "1": "id-cliente-infidash" },
  "accounts": {
    "1:3": "uuid-cuenta-postiz",
    "1:wordpress": "uuid-cuenta-wordpress"
  }
}
```

La clave de `accounts` es `<legacy_client_id>:<legacy_channel_id>` para las publicaciones de la tabla histórica y `<legacy_client_id>:wordpress` para los artículos con ID de WordPress. Para escribir después de revisar el informe, añade `--apply`. Cada fila conserva hash y equivalencia en `editorial.legacy_mappings`; repetir el mismo export la omite y una fila que cambió se informa como conflicto.

El JSON `estructura-db-content-hub.json` incluido junto al repositorio solo contiene metadatos del esquema. Su dry-run es válido, pero informa cero filas. Para migrar datos se necesita un export con arrays `clients`, `content_plan`, `articles`, `article_publications` y `publication_channels`.
