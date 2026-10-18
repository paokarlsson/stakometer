// Reconnect after a dropped Bluetooth link, shared by the PM5 and the bike trainer (spec §9.2).

export const RECONNECT_DELAYS_S = [1, 2, 4, 8, 16];

/**
 * Calls `setup` after each delay until it succeeds. Returns true when connected again, false
 * when every attempt failed or `cancelled()` turned true (the user disconnected).
 */
export async function retryConnect(
  setup: () => Promise<void>,
  cancelled: () => boolean,
  label: string,
  delays: readonly number[] = RECONNECT_DELAYS_S,
): Promise<boolean> {
  for (const delay of delays) {
    await new Promise((r) => setTimeout(r, delay * 1000));
    if (cancelled()) return false;
    try {
      await setup();
      return true;
    } catch (err) {
      console.warn(`${label} reconnect failed:`, err);
    }
  }
  return false;
}
