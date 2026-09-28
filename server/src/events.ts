import type { StudiumEvent } from "@studium/shared";

type Subscriber = (e: StudiumEvent) => void;

export class EventHub {
  #subscribers = new Set<Subscriber>();

  publish(e: StudiumEvent): void {
    for (const fn of this.#subscribers) fn(e);
  }

  subscribe(fn: Subscriber): () => void {
    this.#subscribers.add(fn);
    return () => {
      this.#subscribers.delete(fn);
    };
  }
}
