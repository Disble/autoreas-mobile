import path from 'node:path';

/** The directory holding the shared contract fixtures, one subdirectory per queue. */
export const CONTRACT_FIXTURES_DIR = path.resolve(__dirname, '..', 'contract-fixtures');

/** The fixture subdirectories, read in this order by both runners. */
export const CONTRACT_FIXTURE_GROUPS = ['anime-outbox', 'season-rating'] as const;
