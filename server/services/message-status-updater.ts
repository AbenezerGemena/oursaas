export class MessageStatusUpdater {
  constructor() {}

  startCronJob(intervalSeconds: number = 60) {
    console.log(`[MessageStatusUpdater] Disabled — message statuses are updated via WhatsApp webhooks`);
  }
}
