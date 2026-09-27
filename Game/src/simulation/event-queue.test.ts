import { describe, expect, it } from 'vitest';
import { EventQueue } from './event-queue';

describe('EventQueue', () => {
  it('orders events by time and breaks equal timestamps by schedule order', () => {
    const queue = new EventQueue<string>();
    queue.schedule(30, 'later');
    queue.schedule(20, 'tie-first');
    queue.schedule(10, 'earlier');
    queue.schedule(20, 'tie-second');

    const applied: Array<{ payload: string; order: number }> = [];
    queue.advanceTo(
      30,
      () => undefined,
      (event) => {
        applied.push({ payload: event.payload, order: event.order });
      },
    );

    expect(applied).toEqual([
      { payload: 'earlier', order: 2 },
      { payload: 'tie-first', order: 1 },
      { payload: 'tie-second', order: 3 },
      { payload: 'later', order: 0 },
    ]);
  });

  it('processes events scheduled during apply at or before the target, in queue order', () => {
    const queue = new EventQueue<string>();
    queue.schedule(5, 'start');
    queue.schedule(5, 'queued-same');
    queue.schedule(8, 'middle');

    const applied: string[] = [];
    queue.advanceTo(
      10,
      () => undefined,
      (event) => {
        applied.push(event.payload);
        if (event.payload !== 'start') return;
        queue.schedule(5, 'generated-same');
        queue.schedule(10, 'generated-target');
        queue.schedule(20, 'generated-later');
        expect(() => queue.schedule(4, 'too-early')).toThrow(/past/);
      },
    );

    expect(applied).toEqual([
      'start',
      'queued-same',
      'generated-same',
      'middle',
      'generated-target',
    ]);
    expect(queue.pendingCount).toBe(1);
    expect(queue.currentTime).toBe(10);

    queue.advanceTo(
      20,
      () => undefined,
      (event) => {
        applied.push(event.payload);
      },
    );
    expect(applied.at(-1)).toBe('generated-later');
    expect(queue.pendingCount).toBe(0);
  });

  it('materializes before every applied event and once more at the target', () => {
    const queue = new EventQueue<string>();
    queue.schedule(7, 'second');
    queue.schedule(5, 'first-a');
    queue.schedule(5, 'first-b');

    const trace: string[] = [];
    queue.advanceTo(
      9,
      (time) => {
        trace.push(`materialize:${time}`);
      },
      (event) => {
        trace.push(`apply:${event.payload}`);
      },
    );

    expect(trace).toEqual([
      'materialize:5',
      'apply:first-a',
      'materialize:5',
      'apply:first-b',
      'materialize:7',
      'apply:second',
      'materialize:9',
    ]);
  });

  it('keeps invalidated generations queued until extraction and then skips them', () => {
    const queue = new EventQueue<string>();
    queue.setGeneration('movement:1', 4);
    const stale = queue.schedule(10, 'stale-completion', 'movement:1');
    queue.schedule(10, 'kept');
    queue.schedule(15, 'future-stale', 'movement:1');
    queue.setGeneration('movement:1', 5);
    const fresh = queue.schedule(10, 'fresh-completion', 'movement:1');

    expect(stale.generation).toBe(4);
    expect(fresh.generation).toBe(5);
    expect(queue.generation('movement:1')).toBe(5);
    expect(queue.pendingCount).toBe(4);

    const applied: string[] = [];
    const materialized: number[] = [];
    queue.advanceTo(
      10,
      (time) => {
        materialized.push(time);
      },
      (event) => {
        applied.push(event.payload);
      },
    );

    expect(applied).toEqual(['kept', 'fresh-completion']);
    expect(materialized).toEqual([10, 10, 10]);
    expect(queue.pendingCount).toBe(1);

    queue.advanceTo(
      15,
      (time) => {
        materialized.push(time);
      },
      (event) => {
        applied.push(event.payload);
      },
    );

    expect(applied).toEqual(['kept', 'fresh-completion']);
    expect(materialized).toEqual([10, 10, 10, 15]);
    expect(queue.pendingCount).toBe(0);
    expect(queue.currentTime).toBe(15);
  });

  it('does not apply an event invalidated by materialize', () => {
    const queue = new EventQueue<string>();
    queue.setGeneration('movement:1', 4);
    queue.schedule(5, 'cancelled', 'movement:1');
    queue.schedule(5, 'same-time');
    queue.schedule(8, 'later');

    const applied: string[] = [];
    const materialized: number[] = [];
    queue.advanceTo(
      10,
      (time) => {
        materialized.push(time);
        if (time === 5 && queue.generation('movement:1') === 4) {
          queue.setGeneration('movement:1', 5);
        }
      },
      (event) => {
        applied.push(event.payload);
      },
    );

    expect(applied).toEqual(['same-time', 'later']);
    expect(materialized).toEqual([5, 5, 8, 10]);
    expect(queue.currentTime).toBe(10);
    expect(queue.pendingCount).toBe(0);
  });

  it('rejects a backward target and scheduling before the current time', () => {
    const queue = new EventQueue<string>();
    const applied: string[] = [];
    queue.schedule(1, 'once');
    queue.advanceTo(
      10,
      () => undefined,
      (event) => {
        applied.push(event.payload);
      },
    );

    expect(applied).toEqual(['once']);
    expect(() =>
      queue.advanceTo(
        9,
        () => undefined,
        () => undefined,
      ),
    ).toThrow(/precede/);
    expect(queue.currentTime).toBe(10);
    expect(() => queue.schedule(9, 'late')).toThrow(/past/);

    queue.schedule(10, 'at-horizon');
    queue.advanceTo(
      10,
      () => undefined,
      (event) => {
        applied.push(event.payload);
      },
    );

    expect(applied).toEqual(['once', 'at-horizon']);
    expect(queue.currentTime).toBe(10);
    expect(queue.pendingCount).toBe(0);
  });
});
