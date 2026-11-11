# Видео в браузере

`lessons/media-video` · выжимка по актуальному тексту темы, 2026-11-11.

<details>
<summary><b>Ядро</b> — что нужно помнить</summary>

- **Что это:** `<video>` — проигрыватель с собственным ходом загрузки и показа; JS видит его через события и просит, а не командует.
- **Зачем знать:** `play()` отклоняется, кодек решает больше расширения, потоковый JavaScript-плеер может подавать сегменты через MSE.
- **Как работает:**
  1. В записанном прогоне файла события шли так: `loadedmetadata` → `loadeddata` → `canplay` → `canplaythrough` → `play` → `playing` → `pause` → `ended`.
  2. `play()` — промис: выполняется с `playing`, отклоняется `NotAllowedError`, `AbortError` или `NotSupportedError`.
  3. Автоплей зависит от политики браузера и настроек. Muted обычно помогает, но отказ обрабатывают у каждой попытки, включая запуск кнопкой.
  4. MSE: init задаёт формат, сегменты добавляют медиа-данные. `appendBuffer` выполняют последовательно, ждут `updateend`, отдельно обрабатывают HTTP, `error` и `abort`; в конце — `endOfStream()`.
  5. Кончился буфер — `waiting` и `readyState` вниз, но `paused` остаётся `false`.

</details>

<details>
<summary><b>Карта</b> — знать, что это существует</summary>

- `canPlayType`, `MediaSource.isTypeSupported`, `mediaCapabilities.decodingInfo` и их ответы в трёх движках → «раздел Контейнер и кодек».
- Плейлисты HLS и смена качества новым init-сегментом → «раздел MediaSource».
- Таблицы `readyState` и `networkState`, перемотка до ключевого кадра → «раздел Буфер и readyState».
- `requestVideoFrameCallback`, кадр на холст, Picture-in-Picture, `srcObject` → «раздел Кадр за кадром».

</details>

<details>
<summary><b>Подвох</b> — крайние случаи и частые ошибки</summary>

- `play()` без `catch` — необработанный отказ в консоли.
- 404 даёт `error.code` 4, как неподдержанный формат, а не 2.
- `codecs="vp9"`: `canPlayType` — `"probably"`, `decodingInfo` в Chromium и WebKit — «нет».
- На стенде Chromium требовал `muted` даже у ролика без звуковой дорожки, Firefox разрешал запуск без него. Это записанное поведение указанных сборок.
- `page.evaluate` в Playwright засчитывается как жест: автоплей в тестах «работает».
- WebKit на перемотке без данных не шлёт `waiting`.

</details>

<details>
<summary><b>Детали</b> — не учить, смотреть в теме</summary>

- HLS по ссылке на плейлист играют Chromium 153 и WebKit, Firefox — нет → «раздел MediaSource».
- AV1 в WebKit на M1 не поддержан; `powerEfficient` у AV1 — `false` везде → «раздел Контейнер и кодек».
- В конкретном прогоне ffmpeg без настройки интервала: H.264 — раз в 250 кадров, VP9 — раз в 128 → «раздел Буфер и readyState».
- В прогоне Chromium 20 кадров ролика дали 20 вызовов requestVideoFrameCallback против примерно 120 requestAnimationFrame. При нагрузке уведомления о кадрах могут быть пропущены → «раздел Кадр за кадром».

</details>
