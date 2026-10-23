import { allEndpoints } from '@tasnivo/contracts';
for (const e of allEndpoints()) console.log([e.operationId, e.method, e.path, e.auth, e.role ?? '', e.allowUnverified ? 'UNV' : '', e.multipart ? 'MP' : '', e.responds].join('\t'));
