# Despliegue y corte del módulo editorial

Esta guía despliega la sección **Contenidos**, migra datos del Content Hub anterior y sustituye los workflows basados en Sheets. Ningún paso publica automáticamente en WordPress o Postiz.

## 1. Preparación y respaldo

1. Registra el SHA de la versión de Infidash y exporta los workflows activos de n8n.
2. Haz un backup verificable de PostgreSQL antes de aplicar migraciones. Conserva también el export completo de Content Hub y una copia de las hojas hasta terminar la validación.
3. Inventaría por cliente el `public.clients.id`, zona horaria, cuenta WordPress, cuentas Postiz y los tres workflows. No relaciones clientes solo por nombre.
4. Prepara una base o esquema de staging con datos representativos. La migración se prueba allí antes de producción.

Variables requeridas por Infidash:

```text
DATABASE_URL=postgresql://...
DATABASE_SSL=require
EDITORIAL_DB_POOL_MAX=10
EDITORIAL_DB_IDLE_TIMEOUT_MS=30000
EDITORIAL_DB_CONNECTION_TIMEOUT_MS=5000
```

## 2. Aplicación de esquema

Con `DATABASE_URL` apuntando primero a staging:

```bash
npm ci
npm run lint
npm run test
npm run build
npm run db:migrate:editorial
```

El runner usa un advisory lock, una transacción por migración y checksums en `public.schema_migrations`. No edites una migración ya aplicada: añade otra migración incremental.

Comprueba después:

```sql
SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename;
SELECT table_name FROM information_schema.tables WHERE table_schema = 'editorial' ORDER BY table_name;
```

## 3. Cuentas, configuración y token de n8n

1. Inserta `editorial.client_settings` y `editorial.publishing_accounts` con IDs reales. Mantén `enabled = false` durante las pruebas.
2. Genera un token aleatorio de alta entropía fuera de PostgreSQL y calcula su SHA-256. Guarda únicamente el hash hexadecimal en `editorial.service_tokens`.
3. Limita `scopes` y `allowed_client_ids`. Para el dispatcher piloto suelen ser necesarios `jobs:claim`, `jobs:heartbeat`, `jobs:result`, `context:read`, `events:write` y `research:write`.
4. Guarda el token en el almacén de secretos de n8n como `INFIDASH_SERVICE_TOKEN`; configura allí también `INFIDASH_INTERNAL_API_URL`. No copies el token al entorno del frontend ni a los JSON exportados.

Ejemplo de registro, sustituyendo los valores antes de ejecutar:

```sql
INSERT INTO editorial.service_tokens
  (id, name, token_hash, scopes, allowed_client_ids)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'n8n-dispatcher', '<sha256-hex>',
   '["jobs:claim","jobs:heartbeat","jobs:result","context:read","events:write","research:write"]'::jsonb,
   '["<client-id-infidash>"]'::jsonb);
```

Usa un UUID real, rota el token al cambiar de entorno y desactiva el anterior con `active = false` tras verificar el nuevo.

## 4. Importación

El archivo de estructura incluido no contiene filas. Solicita un export de datos y crea un mapping explícito según [content-persistence.md](content-persistence.md).

```bash
npm run content:import -- --input=../content-hub-export.json --mapping=./content-hub-mapping.json
```

Revisa conflictos, recuentos y fechas sin interpretar. Después aplica sobre staging:

```bash
npm run content:import -- --input=../content-hub-export.json --mapping=./content-hub-mapping.json --apply
```

Repite el mismo comando para verificar idempotencia: debe omitir las filas ya importadas. Una fila de origen modificada se informa como conflicto y requiere una decisión explícita; no se sobrescribe silenciosamente.

## 5. Piloto y corte

1. Importa los cinco workflows sanitizados en staging y mantenlos inactivos.
2. Incorpora en los tres children de Inficon los nodos reales de fuentes, IA, WordPress y Postiz siguiendo [content-workflows.md](content-workflows.md).
3. Valida: generación de plan, borrador WordPress, aprobación, programación futura, timeout ambiguo y reconciliación. Confirma que un borrador queda `draft`, una programación `scheduled` y solo evidencia externa produce `published`.
4. Activa primero los workflows children y el reconciliador. Activa el dispatcher al final.
5. Desactiva los triggers antiguos de Inficon antes de habilitar `client_settings.enabled`. Debe existir una sola ruta de escritura.
6. Observa al menos un ciclo editorial completo. Migra el resto de clientes por lotes pequeños, repitiendo el mismo checklist.
7. Conserva Sheets en solo lectura durante el periodo acordado. Retira sus credenciales cuando los 15 clientes estén validados.

## 6. Verificación posterior

Comprueba por cliente:

- recuentos de calendarios, propuestas, contenidos y publicaciones;
- elementos sin fecha y mappings ausentes;
- trabajos `failed`, `unknown` o con lease vencido;
- fechas deseadas frente a fechas confirmadas;
- IDs externos únicos por cuenta;
- ausencia de escrituras nuevas en Sheets.

La interfaz debe permitir consulta global y por cliente. Un usuario `viewer` solo consulta; las mutaciones requieren `admin`. Un token de servicio limitado a un cliente no puede reservar, renovar o completar trabajos de otro.

## 7. Rollback

### Antes de activar workflows

Despliega la versión anterior de la aplicación. El esquema `editorial` puede permanecer sin uso. No lo borres hasta validar el backup.

### Después de activar el piloto

1. Desactiva dispatcher y children nuevos para detener escrituras.
2. Desactiva `editorial.client_settings.enabled` para el cliente afectado.
3. Reactiva temporalmente el workflow anterior solo si sigue siendo seguro hacerlo y Sheets conserva el estado de corte. No ejecutes ambas rutas a la vez.
4. Restaura la aplicación anterior. Conserva las tablas editoriales para diagnóstico y exporta los eventos y trabajos del intervalo.
5. Reconcilia WordPress/Postiz antes de reintentar. Restaurar PostgreSQL no despublica ni cancela acciones ya aceptadas por servicios externos.

Si una migración de esquema necesita revertirse, restaura el backup completo en una instancia separada y cambia la conexión tras verificarlo. Las migraciones entregadas no incluyen `down` automático porque eliminar `editorial` destruiría historial, mappings y auditoría. `DROP SCHEMA editorial CASCADE` solo es admisible en una base de staging desechable y vacía.

## 8. Criterio de finalización

El corte termina cuando los 15 clientes tienen mapping explícito, los conteos están conciliados, no hay trabajos ambiguos sin revisar, los triggers de Sheets permanecen desactivados y los responsables pueden operar calendario, revisión y publicación desde Infidash.
