import type { SQLiteDatabase } from 'expo-sqlite';

/** Fixed clock reading every test builds its manifest timestamps relative to. */
export const NOW = 1_700_000_000_000;

/** A dummy `SQLiteDatabase` handle: every dependency that would read it is faked. */
export const FAKE_DB = {} as SQLiteDatabase;
