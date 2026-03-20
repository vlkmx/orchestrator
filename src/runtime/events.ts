import { EventEmitter } from "node:events";

export type RuntimeEventType =
  | "run_started"
  | "run_finished"
  | "run_failed"
  | "log"
  | "iteration_started"
  | "iteration_finished"
  | "supervisor_decision"
  | "worker_result"
  | "validation_result"
  | "command_started"
  | "command_output"
  | "command_finished"
  | "state_saved";

export interface RuntimeEvent {
  id: number;
  timestamp: string;
  runId: string;
  type: RuntimeEventType;
  message: string;
  data?: Record<string, unknown>;
}

export interface EventSink {
  emitEvent(event: Omit<RuntimeEvent, "id" | "timestamp">): RuntimeEvent;
}

export class InMemoryEventBus extends EventEmitter implements EventSink {
  private sequence = 0;
  private readonly events: RuntimeEvent[] = [];

  constructor(private readonly maxEvents = 2_000) {
    super();
  }

  emitEvent(event: Omit<RuntimeEvent, "id" | "timestamp">): RuntimeEvent {
    const full: RuntimeEvent = {
      ...event,
      id: ++this.sequence,
      timestamp: new Date().toISOString()
    };

    this.events.push(full);
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }

    this.emit("event", full);
    return full;
  }

  getEventsSince(id: number): RuntimeEvent[] {
    return this.events.filter((item) => item.id > id);
  }

  getLatest(limit = 200): RuntimeEvent[] {
    return this.events.slice(-limit);
  }
}
