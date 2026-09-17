# language: es
@acceptance @content-hub @AC-05
Caracteristica: Edición concurrente
  Escenario: Una edición queda obsoleta
    Dado una revisión actualizada por otro usuario
    Cuando se guarda una versión antigua
    Entonces la API devuelve conflicto 409
