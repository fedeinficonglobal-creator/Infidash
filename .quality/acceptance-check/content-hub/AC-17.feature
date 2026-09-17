# language: es
@acceptance @content-hub @AC-17
Caracteristica: Regeneración segura
  Escenario: Se regenera un contenido aprobado
    Dado una publicación ya programada
    Cuando se genera una revisión nueva
    Entonces se conserva la aprobada y no se cambia la programación
