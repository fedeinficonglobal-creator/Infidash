# language: es
@acceptance @content-hub @AC-11
Caracteristica: Fechas editoriales
  Escenario: Una pieza sin fecha
    Dado un contenido sin fecha programada
    Cuando se intenta programar
    Entonces no se envía a publicación
