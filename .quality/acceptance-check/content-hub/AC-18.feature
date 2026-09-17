# language: es
@acceptance @content-hub @AC-18
Caracteristica: Corte y recuperación
  Escenario: Se repite el corte con delta
    Dado datos de dashboard y publicaciones externas existentes
    Cuando se importa el delta y se recupera una incidencia
    Entonces no se pierden los datos existentes
