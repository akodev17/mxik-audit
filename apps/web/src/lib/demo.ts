// Demo mode as the web app sees it: isDemoOrg once per render (React cache); server actions and
// route handlers read it each time. Everything else is @tasnivo/domain/demo.
import { cache } from 'react';
import { isDemoOrg as readIsDemoOrg } from '@tasnivo/domain/demo';

export * from '@tasnivo/domain/demo';

export const isDemoOrg = cache(readIsDemoOrg);
