// 1C integration: batches, exports, connection settings, import history (Agent 1).
// Endpoints are added by the owning workstream; the module exists from the base commit so the
// registry, the Nest module list and the api-client have a slot that merges without conflicts.
import { defineModule } from '../endpoint';

export const onec = defineModule('onec', {});
