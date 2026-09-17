# language: es
@acceptance @content-hub @AC-09
Caracteristica: Timeout ambiguo de Postiz
  Escenario: Postiz acepta pero responde tarde
    Dado un timeout posterior al envío
    Cuando el workflow registra el resultado
    Entonces pasa a unknown y se reconcilia sin reenvío ciego
