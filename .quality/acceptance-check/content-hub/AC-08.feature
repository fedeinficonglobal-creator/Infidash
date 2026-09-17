# language: es
@acceptance @content-hub @AC-08
Caracteristica: Identificadores externos aislados
  Escenario: Dos sitios reutilizan el mismo post ID
    Dado dos cuentas distintas con post ID 123
    Cuando se persisten sus publicaciones
    Entonces permanecen independientes por cuenta
