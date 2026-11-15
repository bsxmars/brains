/** Порог — сигнал спроса. enqueue в start может превысить его без исключения. */
export function probeQueue(highWaterMark = 2) {
  const rows: { queued: number; desired: number | null }[] = [];
  new ReadableStream<number>({
    start(controller) {
      rows.push({ queued: 0, desired: controller.desiredSize });
      for (let queued = 1; queued <= highWaterMark + 1; queued++) {
        controller.enqueue(queued);
        rows.push({ queued, desired: controller.desiredSize });
      }
      controller.close();
    },
  }, new CountQueuingStrategy({ highWaterMark }));
  return rows;
}
