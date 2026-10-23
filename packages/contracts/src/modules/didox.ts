// Didox incoming invoices: fetch or upload, match products, review and prepare for 1C (Agent 3).
// Endpoints are added by the owning workstream; the module exists from the base commit so the
// registry, the Nest module list and the api-client have a slot that merges without conflicts.
import { defineModule } from '../endpoint';

export const didox = defineModule('didox', {});
