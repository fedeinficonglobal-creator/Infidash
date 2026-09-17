# language: es
@acceptance @content-hub @AC-03
Caracteristica: Recorridos sin Sheets
  Escenario: Se revisan los workflows activos
    Dado los exports versionados
    Cuando se buscan dependencias de Sheets
    Entonces no existe ninguna lectura o escritura de Sheets
