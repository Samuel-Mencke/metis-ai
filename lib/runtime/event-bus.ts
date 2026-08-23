import { EventEmitter } from "node:events";
import type { ProviderRuntimeEvent } from "./contracts";

export interface EventStreamSubscription {
  unsubscribe: () => void;
}

class RuntimeEventBus {
  private emitter = new EventEmitter();
  private sessionEvents = new Map<string, ProviderRuntimeEvent[]>();

  constructor() {
    this.emitter.setMaxListeners(100);
  }

  public publish(sessionId: string, event: ProviderRuntimeEvent): void {
    const list = this.sessionEvents.get(sessionId) || [];
    list.push(event);
    if (list.length > 2000) list.shift();
    this.sessionEvents.set(sessionId, list);

    this.emitter.emit(`session:${sessionId}`, event);
    this.emitter.emit("event", { sessionId, event });
  }

  public subscribeSession(
    sessionId: string,
    callback: (event: ProviderRuntimeEvent) => void,
  ): EventStreamSubscription {
    const channel = `session:${sessionId}`;
    this.emitter.on(channel, callback);
    return {
      unsubscribe: () => {
        this.emitter.off(channel, callback);
      },
    };
  }

  public getSessionEvents(sessionId: string): ProviderRuntimeEvent[] {
    return this.sessionEvents.get(sessionId) || [];
  }

  public clearSession(sessionId: string): void {
    this.sessionEvents.delete(sessionId);
  }
}

export const runtimeEventBus = new RuntimeEventBus();
