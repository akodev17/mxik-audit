// The demo request form's fixed values, free of server-only imports so the client form can use them.
export const USE_CASES = ['own_company', 'clients', 'evaluation', 'other'] as const;
export type UseCase = (typeof USE_CASES)[number];

export const DEMO_LIMITS = { name: 100, company: 150, email: 200 } as const;
