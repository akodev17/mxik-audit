// The plan status once per render (React cache): the app frame and the page share it. Server
// actions read it each time. Everything else is @tasnivo/domain/plan.
import { cache } from 'react';
import { planGates, planStatus as readPlanStatus } from '@tasnivo/domain/plan';

export * from '@tasnivo/domain/plan';

export const planStatus = cache(readPlanStatus);

export const { gate, previewGate, uploadsOpen } = planGates(planStatus);
