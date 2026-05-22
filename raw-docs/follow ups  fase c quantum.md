# Quantum Creators — Follow-ups Fase C
 
Secuencia de follow-ups para leads que **ya recibieron el enlace de discovery call pero todavía no han agendado**.
 
| Campo | Valor |
|---|---|
| Fase | C — Discovery-call link enviado |
| Fuente | `setting_system.json` |
| Cuenta | `quantumcreators.es` |
 
## Regla de seguridad
 
- Si el lead **responde** → no enviar el siguiente follow-up genérico. Contestar el contexto o resolver la fricción de agenda.
- Si el lead **agenda** → detener la secuencia.
## Variables de automatización
 
| Variable | Valor |
|---|---|
| `{nombre}` | Nombre del lead, si se puede personalizar con seguridad |
| `{discovery_call}` | `https://www.quantumcreators.es/llamada-de-discovery` |
| `{nurture_youtube}` | `https://youtu.be/yoW6-LMURb8?si=oEgEmdnHe4MnKdCd` |
| `jefe` / `reina` | Adaptar por género solo si está claro. Si no, usar variante neutra. |
 
## Timeline
 
| Slot | Cuándo se envía | Formato |
|---|---|---|
| 1C | 15 min después del envío del enlace de discovery call | Texto |
| 2C | 2 h después de 1C | Texto |
| 3C | 1 día después de 2C | Meme + texto |
| 4C | 1 día después de 3C | Meme + texto |
| 5C | 1 día después de 4C | Meme + texto |
| 6C | 1 día después de 5C | Meme + texto |
| 7C | 1 día después de 6C | Meme + texto |
| 8C | 1 día después de 7C | Meme + texto final / nurture |
 
> Del slot 3C en adelante: **1 día después del follow-up anterior, salvo que la conversación pida una respuesta directa.**
>
> Condición común a todos los slots: usar si el lead recibió el enlace de discovery call y todavía no agenda ni responde.
 
---
 
## 1C — Texto
 
**Cuándo:** 15 min después de enviar el enlace de discovery call.
**Asset:** —
 
```
Eyy {nombre}, te va bien alguno de los huecos del calendario o te busco otro momento?
```
 
## 2C — Texto
 
**Cuándo:** 2 h después de 1C.
**Asset:** —
 
```
Buenas jefe (si es un chico) / reina (si es una chica) ¿Lo dejamos reservado hoy y así ya queda cerrado?
```
 
## 3C — Meme + texto
 
**Cuándo:** 1 día después de 2C.
**Asset:** `agendar_o_mirar_otro_lado.jpg` (500 × 756 px)
 
```
Ey {nombre}, cómo va todo! Estoy organizando la agenda del equipo para la semana que viene. Tienes 30 minutos libres para reservar?
```
 
## 4C — Meme + texto
 
**Cuándo:** 1 día después de 3C.
**Asset:** `habra_reservado_hueco.jpg` (905 × 514 px)
 
```
Aviso que vendrán más follow ups 😉. Si ningún hueco te encaja, dime y te busco otro momento.
```
 
## 5C — Meme + texto
 
**Cuándo:** 1 día después de 4C.
**Asset:** `Screenshot_20260429_165532_Chrome.jpg` (918 × 514 px)
 
```
👆
```
 
## 6C — Meme + texto
 
**Cuándo:** 1 día después de 5C.
**Asset:** `Screenshot_20260416_141152_Chrome.jpg` (1040 × 699 px)
 
```
Ey {nombre}, paso por aquí para animarte a reservar un hueco. Independientemente de que compres o no, será una llamada de mucho valor para ti. Me quedo por aquí por si tienes algún problema 😊
```
 
## 7C — Meme + texto
 
**Cuándo:** 1 día después de 6C.
**Asset:** `sigo_esperando_mensajes.jpg` (910 × 899 px)
 
```
Si al final te animas a reservar un hueco, pincha aquí. Son solo dos minutos: {discovery_call}
```
 
## 8C — Meme + texto final / nurture
 
**Cuándo:** 1 día después de 7C.
**Asset:** `no_quemar_negocio_reserva.jpg` (912 × 668 px)
 
```
Si no te encaja reservar ahora, sin problema. Te dejo por aquí igualmente el video explicando nuestro sistema por si te sirve más adelante: {nurture_youtube}
```
 
---
 
_Quantum Creators — Secuencia C / No agenda. Generado desde la configuración viva del sistema (`setting_system.json`)._
 
