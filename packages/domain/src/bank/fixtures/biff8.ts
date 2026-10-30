// A minimal BIFF8 (legacy .xls) writer for fixtures and tests: one sheet in an OLE compound file. It writes shared
// strings, NUMBER and RK cells; a real Excel writes more (MULRK, FORMULA, a mini stream), see xls.test.ts.

/** A minimal BIFF8 workbook of one sheet: shared strings (split over CONTINUE records), numbers, RK. */
export function biff8(sheetName: string, cells: (string | number | null)[][]): Buffer {
  const rec = (type: number, data: Buffer): Buffer => {
    const head = Buffer.alloc(4);
    head.writeUInt16LE(type, 0);
    head.writeUInt16LE(data.length, 2);
    return Buffer.concat([head, data]);
  };
  const strings: string[] = [];
  const index = new Map<string, number>();
  for (const row of cells) for (const c of row) if (typeof c === 'string' && c !== '' && !index.has(c)) { index.set(c, strings.length); strings.push(c); }
  // SST: header, then strings; a record holds at most 8224 bytes, characters continue with a flags byte.
  const MAX = 8224;
  const sstParts: Buffer[] = [];
  let part: number[] = [];
  const startCount = Buffer.alloc(8);
  startCount.writeUInt32LE(strings.length, 0);
  startCount.writeUInt32LE(strings.length, 4);
  part.push(...startCount);
  for (const s of strings) {
    // eslint-disable-next-line no-control-regex
    const wide = /[^\u0000-ÿ]/.test(s);
    if (part.length + 3 > MAX) { sstParts.push(Buffer.from(part)); part = []; }
    part.push(s.length & 0xff, s.length >> 8, wide ? 1 : 0);
    for (const ch of s) {
      const bytes = wide ? [ch.charCodeAt(0) & 0xff, ch.charCodeAt(0) >> 8] : [ch.charCodeAt(0)];
      if (part.length + bytes.length > MAX) { sstParts.push(Buffer.from(part)); part = [wide ? 1 : 0]; }
      part.push(...bytes);
    }
  }
  sstParts.push(Buffer.from(part));
  const sst = Buffer.concat(sstParts.map((p, i) => rec(i === 0 ? 0x00fc : 0x003c, p)));

  const bof = (dt: number): Buffer => {
    const b = Buffer.alloc(16);
    b.writeUInt16LE(0x0600, 0);
    b.writeUInt16LE(dt, 2);
    b.writeUInt16LE(0x0dbb, 4);
    b.writeUInt16LE(0x07cc, 6);
    return rec(0x0809, b);
  };
  const eof = rec(0x000a, Buffer.alloc(0));
  const name = Buffer.concat([Buffer.from([sheetName.length, 1]), Buffer.from(sheetName, 'utf16le')]);
  const boundsheet = (offset: number): Buffer => rec(0x0085, Buffer.concat([(() => { const b = Buffer.alloc(6); b.writeUInt32LE(offset, 0); return b; })(), name]));
  const globalsLength = bof(5).length + boundsheet(0).length + sst.length + eof.length;
  const globals = Buffer.concat([bof(5), boundsheet(globalsLength), sst, eof]);

  const sheet: Buffer[] = [bof(0x10)];
  cells.forEach((row, r) => row.forEach((value, c) => {
    if (value === null || value === '') return;
    const head = Buffer.alloc(6);
    head.writeUInt16LE(r, 0);
    head.writeUInt16LE(c, 2);
    if (typeof value === 'string') {
      const i = Buffer.alloc(4);
      i.writeUInt32LE(index.get(value) ?? 0, 0);
      sheet.push(rec(0x00fd, Buffer.concat([head, i])));
    } else if (Number.isInteger(value) && Math.abs(value) < 2 ** 29) {
      const rk = Buffer.alloc(4);
      rk.writeInt32LE((value << 2) | 2, 0);
      sheet.push(rec(0x027e, Buffer.concat([head, rk])));
    } else {
      const n = Buffer.alloc(8);
      n.writeDoubleLE(value, 0);
      sheet.push(rec(0x0203, Buffer.concat([head, n])));
    }
  }));
  sheet.push(eof);
  let stream = Buffer.concat([globals, ...sheet]);
  // Streams under 4096 bytes would go to the mini stream; padding past the last EOF keeps this one regular.
  if (stream.length < 4096) stream = Buffer.concat([stream, Buffer.alloc(4096 - stream.length)]);
  return compoundFile(stream);
}

/** An OLE compound file (v3, 512-byte sectors) holding one stream named Workbook. */
export function compoundFile(stream: Buffer): Buffer {
  const S = 512;
  const dataSectors = Math.ceil(stream.length / S);
  let fatSectors = 1;
  while (dataSectors + 1 + fatSectors > fatSectors * (S / 4)) fatSectors++;
  const dirSector = dataSectors;
  const fat = Buffer.alloc(fatSectors * S, 0xff);
  for (let i = 0; i < dataSectors; i++) fat.writeUInt32LE(i === dataSectors - 1 ? 0xfffffffe : i + 1, i * 4);
  fat.writeUInt32LE(0xfffffffe, dirSector * 4);
  for (let i = 0; i < fatSectors; i++) fat.writeUInt32LE(0xfffffffd, (dirSector + 1 + i) * 4);
  const dir = Buffer.alloc(S);
  const entry = (at: number, name: string, type: number, child: number, start: number, size: number): void => {
    dir.write(name, at, 'utf16le');
    dir.writeUInt16LE((name.length + 1) * 2, at + 0x40);
    dir[at + 0x42] = type;
    dir[at + 0x43] = 1;
    dir.writeUInt32LE(0xffffffff, at + 0x44);
    dir.writeUInt32LE(0xffffffff, at + 0x48);
    dir.writeUInt32LE(child, at + 0x4c);
    dir.writeUInt32LE(start, at + 0x74);
    dir.writeUInt32LE(size, at + 0x78);
  };
  entry(0, 'Root Entry', 5, 1, 0xfffffffe, 0);
  entry(128, 'Workbook', 2, 0xffffffff, 0, stream.length);
  const header = Buffer.alloc(S);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 0x18);
  header.writeUInt16LE(0x0003, 0x1a);
  header.writeUInt16LE(0xfffe, 0x1c);
  header.writeUInt16LE(9, 0x1e);
  header.writeUInt16LE(6, 0x20);
  header.writeUInt32LE(fatSectors, 0x2c);
  header.writeUInt32LE(dirSector, 0x30);
  header.writeUInt32LE(4096, 0x38);
  header.writeUInt32LE(0xfffffffe, 0x3c);
  header.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i++) header.writeUInt32LE(i < fatSectors ? dirSector + 1 + i : 0xffffffff, 0x4c + i * 4);
  const data = Buffer.alloc(dataSectors * S);
  stream.copy(data);
  return Buffer.concat([header, data, dir, fat]);
}
