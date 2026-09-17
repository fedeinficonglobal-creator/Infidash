# language: es
@acceptance @content-hub @AC-10
Caracteristica: Recuperación de lease
  Escenario: Un worker cae
    Dado un lease vencido
    Cuando otro worker reclama el trabajo
    Entonces el callback antiguo no puede sustituir el resultado nuevo
