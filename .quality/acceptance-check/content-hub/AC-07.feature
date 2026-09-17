# language: es
@acceptance @content-hub @AC-07
Caracteristica: Estados reales de publicación
  Escenario: Se programa una publicación
    Dado una revisión aprobada
    Cuando Postiz confirma la programación
    Entonces la publicación pasa a scheduled sin marcar published
