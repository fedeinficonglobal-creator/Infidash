# language: es
@acceptance @content-hub @AC-04
Caracteristica: Plan editorial durable
  Escenario: El plan generado es válido
    Dado una petición generate_plan
    Cuando se crea el trabajo
    Entonces persiste calendario, target y piezas de forma atómica
