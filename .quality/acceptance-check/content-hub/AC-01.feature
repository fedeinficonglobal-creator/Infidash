# language: es
@acceptance @content-hub @AC-01
Caracteristica: Aislamiento único de los quince clientes
  Escenario: Una referencia de otro cliente es rechazada
    Dado un recurso editorial perteneciente a otro cliente
    Cuando una API intenta relacionarlo con el cliente actual
    Entonces la FK o la autorización rechaza la operación
