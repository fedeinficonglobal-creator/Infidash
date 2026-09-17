# language: es
@acceptance @content-hub @AC-13
Caracteristica: Sincronización de Postiz
  Escenario: Se cancela una publicación externa
    Dado una publicación programada
    Cuando la reconciliación recibe la cancelación
    Entonces la interfaz refleja el estado y su última comprobación
