# Planes Web y RRSS compartidos

Las pestañas Web y RRSS leen y guardan un documento por cliente, área y mes (`YYYY-MM`) en `operational_plans`. Todos los usuarios con acceso al cliente pueden leerlo; solo administradores pueden escribir. La API es `GET`/`PUT /api/clients/:clientId/operational-plans/:domain`, con `period` en la consulta de lectura y `periodKey`, `version` y `rows` en la escritura.

Cada escritura incrementa la versión del documento. Si otro navegador guardó una versión posterior, la API responde `409 STALE_VERSION`; la pantalla mantiene el formulario y ofrece **Recargar plan**. No se fusionan cambios simultáneos de forma silenciosa.

Los antiguos borradores de `localStorage` permanecen en el navegador hasta que un administrador elige un mes y pulsa **Importar filas nuevas**. La pantalla muestra previamente las filas y los recuentos de nuevas, duplicadas y conflictos. La importación añade solo filas nuevas; las que comparten ID con contenido diferente permanecen en el borrador local para revisión manual. Una respuesta de error no borra el borrador.

En Web, los nombres internos `leadsAbril`, `accionMayo`, `leadsMayo` y `wpoMayo` se conservan para leer los borradores antiguos. La pantalla los presenta como métricas del mes anterior y del mes seleccionado. Antes de importar un borrador histórico de abril/mayo, selecciona el mes de mayo del año al que pertenece.
