import { assertSimTimeUs, type SimTimeUs } from './sim-time';

/**
 * One queued simulation event.
 * `order` is unique inside the attempt and increases on every schedule.
 */
export interface ScheduledEvent<T> {
  readonly at: SimTimeUs;
  readonly order: number;
  readonly payload: T;
  readonly generationKey: string | null;
  readonly generation: number | null;
}

/**
 * Simulation queue ordered by `(at, order)`.
 * A newer generation leaves older events in the heap; they are skipped only
 * when their timestamp is extracted.
 */
export class EventQueue<T> {
  private readonly heap: ScheduledEvent<T>[] = [];
  private readonly generations = new Map<string, number>();
  private time: SimTimeUs = 0;
  /** Earliest legal schedule time while materialize or apply is running. */
  private floor: SimTimeUs | null = null;
  private nextOrder = 0;

  get currentTime(): SimTimeUs {
    return this.time;
  }

  /** Heap size, including events a newer generation has already invalidated. */
  get pendingCount(): number {
    return this.heap.length;
  }

  generation(key: string): number {
    this.assertGenerationKey(key);
    return this.generations.get(key) ?? 0;
  }

  /** Records the live generation. A lower value is rejected so stale events stay stale. */
  setGeneration(key: string, generation: number): void {
    this.assertGenerationKey(key);
    if (!Number.isSafeInteger(generation) || generation < 0) {
      throw new RangeError('Generation must be a nonnegative safe integer');
    }
    const current = this.generations.get(key) ?? 0;
    if (generation < current) {
      throw new RangeError('Generation cannot decrease');
    }
    this.generations.set(key, generation);
  }

  schedule(at: SimTimeUs, payload: T, generationKey?: string): ScheduledEvent<T> {
    const time = assertSimTimeUs(at);
    if (time < this.schedulingFloor()) {
      throw new RangeError('Cannot schedule an event in the past');
    }

    const stamp = this.stamp(generationKey);
    const event: ScheduledEvent<T> = {
      at: time,
      order: this.takeOrder(),
      payload,
      generationKey: stamp.key,
      generation: stamp.generation,
    };
    this.push(event);
    return this.snapshot(event);
  }

  /**
   * Materializes to each selected event at or before `targetTime`, applies it
   * when that event is still live, then materializes to the target itself.
   * Events queued by `apply` at or before the target join this same pass.
   */
  advanceTo(
    targetTime: SimTimeUs,
    materialize: (time: SimTimeUs) => void,
    apply: (event: ScheduledEvent<T>) => void,
  ): void {
    const target = assertSimTimeUs(targetTime);
    if (target < this.time) {
      throw new RangeError('Simulation target must not precede current simulation time');
    }

    for (;;) {
      const next = this.peekDue(target);
      if (next === undefined) break;

      this.floor = next.at;
      try {
        materialize(next.at);
        const event = this.pop();
        if (event !== next) {
          throw new RangeError('Event queue changed while materializing');
        }
        this.time = event.at;
        // materialize may bump the generation after this event was selected.
        if (!this.isStale(event)) apply(this.snapshot(event));
      } finally {
        this.floor = null;
      }
    }

    this.floor = target;
    try {
      materialize(target);
    } finally {
      this.floor = null;
    }
    this.time = target;
  }

  private schedulingFloor(): SimTimeUs {
    return this.floor ?? this.time;
  }

  private stamp(generationKey: string | undefined): {
    readonly key: string | null;
    readonly generation: number | null;
  } {
    if (generationKey === undefined) return { key: null, generation: null };
    this.assertGenerationKey(generationKey);
    return {
      key: generationKey,
      generation: this.generations.get(generationKey) ?? 0,
    };
  }

  private assertGenerationKey(key: string): void {
    if (key.length === 0) throw new RangeError('Generation key must be non-empty');
  }

  private takeOrder(): number {
    const order = this.nextOrder;
    if (!Number.isSafeInteger(order)) {
      throw new RangeError('Event order exceeded the safe integer range');
    }
    this.nextOrder += 1;
    return order;
  }

  private isStale(event: ScheduledEvent<T>): boolean {
    if (event.generationKey === null || event.generation === null) return false;
    const current = this.generations.get(event.generationKey) ?? 0;
    return event.generation !== current;
  }

  /** Drops due stale events. Later stale events stay queued. */
  private peekDue(target: SimTimeUs): ScheduledEvent<T> | undefined {
    while (true) {
      const top = this.heap[0];
      if (top === undefined || top.at > target) return undefined;
      if (!this.isStale(top)) return top;
      this.pop();
    }
  }

  private snapshot(event: ScheduledEvent<T>): ScheduledEvent<T> {
    return {
      at: event.at,
      order: event.order,
      payload: event.payload,
      generationKey: event.generationKey,
      generation: event.generation,
    };
  }

  private push(event: ScheduledEvent<T>): void {
    this.heap.push(event);
    this.siftUp(this.heap.length - 1);
  }

  private pop(): ScheduledEvent<T> {
    const heap = this.heap;
    const top = heap[0];
    if (top === undefined) throw new RangeError('Cannot extract from an empty event queue');
    const last = heap.pop();
    if (last === undefined || heap.length === 0) return top;
    heap[0] = last;
    this.siftDown(0);
    return top;
  }

  private siftUp(index: number): void {
    const heap = this.heap;
    const event = heap[index];
    if (event === undefined) return;
    let cursor = index;
    while (cursor > 0) {
      const parentIndex = Math.floor((cursor - 1) / 2);
      const parent = heap[parentIndex];
      if (parent === undefined || !comesBefore(event, parent)) break;
      heap[cursor] = parent;
      cursor = parentIndex;
    }
    heap[cursor] = event;
  }

  private siftDown(index: number): void {
    const heap = this.heap;
    const event = heap[index];
    if (event === undefined) return;
    const length = heap.length;
    let cursor = index;
    while (true) {
      const leftIndex = cursor * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallest = event;
      let smallestIndex = cursor;

      if (leftIndex < length) {
        const left = heap[leftIndex];
        if (left !== undefined && comesBefore(left, smallest)) {
          smallest = left;
          smallestIndex = leftIndex;
        }
      }
      if (rightIndex < length) {
        const right = heap[rightIndex];
        if (right !== undefined && comesBefore(right, smallest)) {
          smallest = right;
          smallestIndex = rightIndex;
        }
      }
      if (smallestIndex === cursor) break;
      heap[cursor] = smallest;
      cursor = smallestIndex;
    }
    heap[cursor] = event;
  }
}

function comesBefore<T>(left: ScheduledEvent<T>, right: ScheduledEvent<T>): boolean {
  if (left.at !== right.at) return left.at < right.at;
  return left.order < right.order;
}
