# language: es
@acceptance @content-hub @AC-15
Caracteristica: Exploración de contenidos
  Escenario: Se cambia de cliente con filtros
    Dado la vista global o una vista de cliente
    Cuando se aplican filtros y paginación
    Entonces se muestran estados de carga, vacío y error sin datos obsoletos
