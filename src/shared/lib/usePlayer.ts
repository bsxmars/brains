import { computed, onScopeDispose, ref, watch } from 'vue';
import { useReducedMotion } from './useReducedMotion';
import type { useStepper } from './useStepper';

/**
 * Автоматическое проигрывание пошагового демо.
 *
 * Зачем оно нужно. Все одиннадцать степперов курса умеют одно: читатель жмёт «шаг» и смотрит
 * очередной кадр. Так видно **состояния**, но не виден **процесс** — а объясняем мы именно
 * процесс: как задача проходит через очередь, как копируются объекты между поколениями, как
 * фиксируется кадр. Разница та же, что между раскадровкой и фильмом. Поэтому проигрыватель
 * надстраивается над существующим `useStepper`, а не заменяет его: ручной режим остаётся
 * главным, автоплей — вторым способом посмотреть то же самое.
 *
 * Скорость — множитель, а не миллисекунды: у разных демо свой естественный шаг, и автор
 * задаёт его один раз пропом `interval`, а читатель ускоряет или замедляет относительно него.
 *
 * На последнем шаге проигрывание останавливается само. Зацикливать нельзя: у процессов
 * в курсе есть конец, и «вернуться в начало» без спроса — значит соврать, будто он бесконечный.
 */
export interface PlayerOptions {
  /** Пауза между шагами при обычной скорости, мс. По умолчанию 900 — успеть прочитать подпись. */
  interval?: number;
  /** Доступные множители скорости. */
  speeds?: number[];
}

export function usePlayer(stepper: ReturnType<typeof useStepper>, options: PlayerOptions = {}) {
  const { interval = 900, speeds = [0.5, 1, 2] } = options;

  const reduced = useReducedMotion();
  const playing = ref(false);
  const speed = ref(1);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const pause = () => {
    playing.value = false;
    clear();
  };

  const play = () => {
    // С последнего шага «играть» означает «показать сначала»: иначе кнопка выглядит сломанной.
    if (stepper.atEnd.value) stepper.reset();
    playing.value = true;
  };

  const toggle = () => (playing.value ? pause() : play());

  const setSpeed = (value: number) => {
    speed.value = value;
  };

  /**
   * Шаг планируется `setTimeout`'ом, а не `setInterval`: интервал не считается с изменением
   * скорости на лету и копит отставание, если вкладка уходила в фон. Здесь каждый следующий
   * шаг планируется после предыдущего — и переключение скорости действует сразу.
   */
  const schedule = () => {
    clear();
    if (!playing.value) return;
    timer = setTimeout(() => {
      stepper.next();
      if (stepper.atEnd.value) pause();
      else schedule();
    }, interval / speed.value);
  };

  watch([playing, speed], schedule);

  // Просьбу не двигать картинку выполняем буквально: идущее проигрывание останавливается.
  watch(reduced, (isReduced) => {
    if (isReduced) pause();
  });

  onScopeDispose(clear);

  return {
    playing,
    speed,
    speeds,
    /** Автоплей запрещён настройкой системы — кнопку показывать не нужно. */
    available: computed(() => !reduced.value),
    play,
    pause,
    toggle,
    setSpeed,
  };
}
