import { getEventBus } from './events/event-bus'

export async function initBackend(): Promise<void> {
  getEventBus()
}
