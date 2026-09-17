# language: es
@acceptance @content-hub @AC-12
Caracteristica: Publicación parcial
  Escenario: Una red falla
    Dado una publicación distribuida en varias redes
    Cuando una red falla
    Entonces se muestra separada y solo ella se reintenta
