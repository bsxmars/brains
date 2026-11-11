import { describe, expect, it } from 'vitest';
import { BT_CODE, HID_CODE, MIDI_CODE, MIDI_SAMPLES, SERIAL_CODE, USB_CODE } from '@/content/lessons/device-hardware/data';

/** Исполняется показанный исходник. Объекты ниже проверяют логику владельца ресурса,
 * а не поддержку USB/HID или совместимость с аппаратурой. Нативные пробы — в e2e. */
const button = { addEventListener() {} };
const logged: unknown[][] = [];
const quiet = { log(...values: unknown[]) { logged.push(values); } };
const compile = (code: string, names: string) => new Function('document', 'navigator', 'console',
  (code.startsWith('const button') ? '' : "const button = document.querySelector('#connect');\n") +
  code + `\nreturn { ${names} };`)({ querySelector: () => button }, {}, quiet);

const { readLine, pingPort } = compile(SERIAL_CODE, 'readLine, pingPort') as {
  readLine: (stream: ReadableStream<string>, signal: AbortSignal) => Promise<string>;
  pingPort: (port: unknown) => Promise<void>;
};

function port(chunks: Uint8Array[], writeError?: Error, readError?: Error) {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let canceled = false;
  const readable = new ReadableStream<Uint8Array>({
    start(value) { controller = value; },
    cancel() { canceled = true; },
  });
  const writable = new WritableStream<Uint8Array>({
    write(bytes) {
      expect(new TextDecoder().decode(bytes)).toBe('ping\n');
      if (writeError) throw writeError;
      if (readError) controller.error(readError);
      else for (const chunk of chunks) controller.enqueue(chunk);
    },
  });
  return {
    readable, writable,
    async open(options: { baudRate: number }) { expect(options.baudRate).toBe(9600); },
    async close() {
      expect(readable.locked, 'вход порта освобождён до close').toBe(false);
      expect(writable.locked, 'выход порта освобождён до close').toBe(false);
      closed = true;
    },
    get closed() { return closed; },
    get canceled() { return canceled; },
  };
}

describe('Serial: границы строки, отмена и блокировки', () => {
  it('UTF-8 и строка восстанавливаются из разрезанных байтов, оба потока свободны перед close', async () => {
    const bytes = new TextEncoder().encode('жук\nследующая строка\n');
    const device = port([bytes.slice(0, 1), bytes.slice(1, 3), bytes.slice(3)]);
    await pingPort(device);
    expect(device.closed).toBe(true);
    expect(device.canceled).toBe(true);
    expect(logged).toContainEqual(['строка:', 'жук']);
  });
  it('readLine отдаёт только первую строку, даже когда в куске их несколько', async () => {
    const stream = new ReadableStream<string>({ start(c) { c.enqueue('ответ\nещё\n'); } });
    expect(await readLine(stream, new AbortController().signal)).toBe('ответ');
    expect(stream.locked).toBe(false);
  });
  it('конец потока до разделителя — ошибка, а читатель освобождён', async () => {
    const stream = new ReadableStream<string>({ start(c) { c.enqueue('хвост'); c.close(); } });
    await expect(readLine(stream, new AbortController().signal)).rejects.toThrow('до конца строки');
    expect(stream.locked).toBe(false);
  });
  it.each([false, true])('отмена (уже отменён: %s) разблокирует ожидающее чтение', async (early) => {
    let canceled = false;
    const stream = new ReadableStream<string>({ cancel() { canceled = true; } });
    const controller = new AbortController();
    const reason = new DOMException('срок ожидания', 'TimeoutError');
    if (early) controller.abort(reason);
    const result = readLine(stream, controller.signal);
    if (!early) controller.abort(reason);
    await expect(result).rejects.toBe(reason);
    expect(canceled).toBe(true);
    expect(stream.locked).toBe(false);
  });
  it('ошибка чтения закрывает порт после завершения pipeTo', async () => {
    const reason = new Error('связь оборвалась');
    const device = port([], undefined, reason);
    await expect(pingPort(device)).rejects.toBe(reason);
    expect(device.closed).toBe(true);
  });
  it('ошибка записи не оставляет writer и порт открытыми', async () => {
    const reason = new Error('запись не прошла');
    const device = port([], reason);
    await expect(pingPort(device)).rejects.toBe(reason);
    expect(device.closed).toBe(true);
  });
});

const { readUsb } = compile(USB_CODE, 'readUsb') as { readUsb: (device: unknown) => Promise<void> };
function usb(failAt?: string) {
  const calls: string[] = [];
  const call = async (name: string) => { calls.push(name); if (name === failAt) throw new Error(name); };
  return {
    calls,
    open: () => call('open'), selectConfiguration: () => call('configuration'),
    claimInterface: () => call('claim'), releaseInterface: () => call('release'), close: () => call('close'),
    async controlTransferOut() { await call('control'); return { status: 'ok' }; },
    async transferIn() { await call('read'); return { status: 'ok', data: new DataView(new ArrayBuffer(0)) }; },
  };
}
describe('USB: освобождение после выбора', () => {
  it.each(['control', 'read', 'release'])('ошибка %s всё равно закрывает устройство', async (at) => {
    const device = usb(at);
    await expect(readUsb(device)).rejects.toThrow(at);
    expect(device.calls.slice(-2)).toEqual(['release', 'close']);
  });
  it('ошибка claim не освобождает незанятый интерфейс, но закрывает устройство', async () => {
    const device = usb('claim');
    await expect(readUsb(device)).rejects.toThrow('claim');
    expect(device.calls).toEqual(['open', 'configuration', 'claim', 'close']);
  });
  it('нормальный путь освобождает интерфейс и закрывает устройство', async () => {
    const device = usb();
    await readUsb(device);
    expect(device.calls).toEqual(['open', 'configuration', 'claim', 'control', 'read', 'release', 'close']);
  });
});

const { watchBattery } = compile(BT_CODE, 'watchBattery') as { watchBattery: (device: unknown) => Promise<() => Promise<void>> };
function battery(notify: boolean, broken = false) {
  const calls: string[] = [];
  class Level extends EventTarget {
    properties = { notify, indicate: false };
    async readValue() { return new DataView(Uint8Array.of(87).buffer); }
    async startNotifications() { calls.push('start'); if (broken) throw new Error('notification'); }
    async stopNotifications() { calls.push('stop'); }
    override addEventListener(...args: Parameters<EventTarget['addEventListener']>) { calls.push('listen'); super.addEventListener(...args); }
    override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) { calls.push('unlisten'); super.removeEventListener(...args); }
  }
  const level = new Level();
  const device = { name: 'test', gatt: {
    connected: false,
    async connect() { this.connected = true; return { getPrimaryService: async () => ({ getCharacteristic: async () => level }) }; },
    disconnect() { this.connected = false; calls.push('disconnect'); },
  } };
  return { calls, device };
}
describe('Bluetooth: подписка принадлежит соединению', () => {
  it('stop сначала снимает обработчик, затем уведомления и соединение', async () => {
    const { device, calls } = battery(true);
    const stop = await watchBattery(device);
    await stop();
    expect(calls).toEqual(['listen', 'start', 'unlisten', 'stop', 'disconnect']);
  });
  it('характеристика только для чтения не получает startNotifications', async () => {
    const { device, calls } = battery(false);
    await (await watchBattery(device))();
    expect(calls).toEqual(['unlisten', 'disconnect']);
  });
  it('ошибка подписки снимает обработчик и отключает GATT', async () => {
    const { device, calls } = battery(true, true);
    await expect(watchBattery(device)).rejects.toThrow('notification');
    expect(calls).toEqual(['listen', 'start', 'unlisten', 'disconnect']);
    expect(device.gatt.connected).toBe(false);
  });
});

it('HID: stop снимает обработчик отчётов и закрывает устройство', async () => {
  const { watchHid } = compile(HID_CODE, 'watchHid');
  const calls: string[] = [];
  const device = { open: async () => calls.push('open'), close: async () => calls.push('close'),
    addEventListener: () => calls.push('listen'), removeEventListener: () => calls.push('unlisten') };
  await (await watchHid(device))();
  expect(calls).toEqual(['open', 'listen', 'unlisten', 'close']);
});

it('MIDI: исходный parser, поздний вход и полная очистка подписок', async () => {
  const calls: string[] = [];
  class Input extends EventTarget {
    type = 'input'; state = 'connected'; name = 'keys';
    async close() { calls.push('close'); }
    override addEventListener(...args: Parameters<EventTarget['addEventListener']>) { calls.push('listen'); super.addEventListener(...args); }
    override removeEventListener(...args: Parameters<EventTarget['removeEventListener']>) { calls.push('unlisten'); super.removeEventListener(...args); }
  }
  const midi = Object.assign(new EventTarget(), { inputs: new Map<string, Input>(), outputs: new Map() });
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const { stopMidi, describe } = await new AsyncFunction('navigator', 'window', 'console',
    MIDI_CODE + '\nreturn { stopMidi, describe };')({ requestMIDIAccess: async () => midi }, { addEventListener() {} }, quiet);
  for (const sample of MIDI_SAMPLES) expect(describe(sample.bytes)).toBe(sample.out);
  const input = new Input();
  midi.dispatchEvent(Object.assign(new Event('statechange'), { port: input }));
  midi.dispatchEvent(Object.assign(new Event('statechange'), { port: input }));
  await stopMidi();
  midi.dispatchEvent(Object.assign(new Event('statechange'), { port: new Input() }));
  expect(calls).toEqual(['listen', 'unlisten', 'close']);
});
