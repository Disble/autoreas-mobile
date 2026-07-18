/**
 * Creates a stable fake SQLite handle for season-rating-intent tests.
 * The tests only need identity, not a real database implementation.
 */
export function createMockRawDb() {
  return { name: 'raw-db' };
}
