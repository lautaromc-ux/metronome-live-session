# Audio en vivo

## Cargar una pista

1. Entrar como admin.
2. Abrir un proyecto/banda.
3. Editar una canción ya creada.
4. En `Pista de audio`, usar `Agregar pista` o `Reemplazar pista`.
5. Formatos permitidos: `mp3`, `wav`, `m4a`, `aac`.

Los archivos de audio se guardan en IndexedDB del navegador. La metadata queda en localStorage.

## Probar salida L/R

En el show, abrir `Modo Vivo`:

- `Test L` prueba el canal izquierdo.
- `Test R` prueba el canal derecho.
- `Invertir canales` alterna entre `Pista L / Click R` y `Pista R / Click L`.

## Probar en vivo

1. Crear un show.
2. Agregar canciones al orden del show.
3. Seleccionar una canción en `Modo Vivo`.
4. Usar `Iniciar`.

Si la canción tiene pista activa, salen pista + click. Si no tiene pista, sale solo click.

## Limitaciones

- El navegador puede pedir interacción del usuario antes de habilitar audio.
- IndexedDB depende del navegador/dispositivo; no borres datos del sitio si querés conservar pistas.
- Para escenario, probar siempre con interfaz de audio o cable estéreo real.
- El ruteo esperado es pista por un canal y click por el otro.

