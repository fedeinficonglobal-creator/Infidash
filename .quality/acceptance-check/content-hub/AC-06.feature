# language: es
@acceptance @content-hub @AC-06
Caracteristica: Reserva única de trabajos
  Escenario: Dos workers reclaman un trabajo
    Dado un trabajo pendiente
    Cuando dos workers intentan reservarlo
    Entonces solo una reserva efectiva obtiene el lease
