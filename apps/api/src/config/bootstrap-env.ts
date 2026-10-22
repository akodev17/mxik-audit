// Side effect only: import this before anything from @tasnivo/domain. Domain modules read their
// environment when first imported (sessionOptions reads SESSION_SECRET), and ES modules evaluate
// imports in order, so main.ts imports this file first.
import { loadRootEnv } from './load-env';

loadRootEnv();
