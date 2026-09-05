/**
 * Multi-turn memory.
 *
 * Only the last resolved slots per conversation are kept, which is all a
 * follow-up like "how does that compare to the month before" needs. No
 * transcript is stored, so nothing here can drift away from the data.
 */
import type { Slots } from './types.js';

const MAX_CONVERSATIONS = 200;

const store = new Map<string, Slots>();

export function rememberSlots(conversationId: string | undefined, slots: Slots): void {
  if (!conversationId) return;

  // Cheap LRU: re-inserting moves the key to the end of the iteration order.
  store.delete(conversationId);
  store.set(conversationId, slots);

  if (store.size > MAX_CONVERSATIONS) {
    const oldest = store.keys().next().value;
    if (oldest) store.delete(oldest);
  }
}

export function recallSlots(conversationId: string | undefined): Slots | null {
  if (!conversationId) return null;
  return store.get(conversationId) ?? null;
}

export function forgetSlots(conversationId: string | undefined): void {
  if (conversationId) store.delete(conversationId);
}
