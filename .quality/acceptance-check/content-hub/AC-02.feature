# language: es
@acceptance @content-hub @AC-02
Caracteristica: Importación idempotente
  Escenario: Se reimporta un snapshot
    Dado un snapshot ya importado
    Cuando se importa de nuevo
    Entonces no se duplican los datos y se informa el resultado
