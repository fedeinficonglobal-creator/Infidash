# language: es
@acceptance @content-hub @AC-14
Caracteristica: Permisos editoriales
  Escenario: Un viewer intenta escribir
    Dado un usuario viewer
    Cuando intenta aprobar o ejecutar una acción
    Entonces la API rechaza la operación
