import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'

export type D2DEvent =
  | 'project.opened'
  | 'project.closed'
  | 'job.queued'
  | 'job.started'
  | 'job.progress'
  | 'job.completed'
  | 'job.failed'
  | 'job.cancelled'
  | 'store.changed'
  | 'settings.changed'

class D2DEventBus extends EventEmitter {
  // Main→Renderer に IPC チャンネル経由でイベントを転送する
  forward(event: D2DEvent, payload: unknown): void {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(`d2d:${event}`, payload)
      }
    }
  }

  emitAndForward(event: D2DEvent, payload: unknown): void {
    this.emit(event, payload)
    this.forward(event, payload)
  }
}

let bus: D2DEventBus | null = null

export function getEventBus(): D2DEventBus {
  if (!bus) bus = new D2DEventBus()
  return bus
}
