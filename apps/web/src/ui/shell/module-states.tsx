'use client';

// Module states (/admin/features) for the frame's client components: the header, the rail, the phone
// menu and the palette. Without a provider every module is ENABLED.
import { createContext, useContext } from 'react';
import { allEnabled, type ModuleStates } from '@tasnivo/contracts/feature-modules';

const Ctx = createContext<ModuleStates>(allEnabled());

export const ModuleStatesProvider = Ctx.Provider;

export const useModuleStates = (): ModuleStates => useContext(Ctx);
