# language: es
@acceptance @content-hub @AC-16
Caracteristica: Preview seguro
  Escenario: Se previsualiza contenido importado
    Dado contenido con marcado HTML
    Cuando se muestra en la interfaz
    Entonces se presenta como texto sin ejecutar scripts ni exponer secretos
