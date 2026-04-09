export const syncStateByDatabase = new WeakMap<object, {
  inFlight: Promise<number> | null;
  rerunRequested: boolean;
}>();
