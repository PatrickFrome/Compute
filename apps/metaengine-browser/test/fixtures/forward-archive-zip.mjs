// Inert independent ZIP fixture writer, retained from Stream6 archive controls.
import {crc32, deflateRawSync} from 'node:zlib';
export function zip(entries, {zip64 = false, zip64EndOnly = false, zip64CentralOnly = false, comment = Buffer.alloc(0)} = {}) {
  const centralZip64 = zip64 || zip64CentralOnly, endZip64 = centralZip64 || zip64EndOnly;
  const local = [], central = [], offsets = [];
  let position = 0;
  for (const row of entries) {
    const bytes = Buffer.from(row.bytes ?? ''), method = row.method ?? 0;
    const compressed = row.compressedBytes ?? (method === 8 ? deflateRawSync(bytes) : bytes);
    const name = Buffer.from(row.name), localName = Buffer.from(row.localName ?? row.name);
    const descriptor = row.descriptor ?? false, signed = row.signedDescriptor !== false;
    const flags = row.flags ?? (0x800 | (descriptor ? 8 : 0));
    const size = row.size ?? bytes.length, compressedSize = row.compressedSize ?? compressed.length;
    const crc = row.crc ?? crc32(bytes), mode = row.mode ?? (row.name.endsWith('/') ? 0o40755 : 0o100644);
    const extra = (values, suffix = Buffer.alloc(0), enabled = zip64) => {
      if (!enabled) return suffix;
      const field = Buffer.alloc(4 + values.length * 8);
      field.writeUInt16LE(1, 0); field.writeUInt16LE(values.length * 8, 2);
      values.forEach((value, index) => field.writeBigUInt64LE(BigInt(value), 4 + index * 8));
      return Buffer.concat([field, suffix]);
    };
    const localExtra = extra([descriptor ? 0 : size, descriptor ? 0 : compressedSize], row.localExtra);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    header.writeUInt32LE(descriptor ? 0 : crc, 14);
    header.writeUInt32LE(zip64 ? 0xffffffff : (descriptor ? 0 : compressedSize), 18);
    header.writeUInt32LE(zip64 ? 0xffffffff : (descriptor ? 0 : size), 22);
    header.writeUInt16LE(localName.length, 26); header.writeUInt16LE(localExtra.length, 28);
    const tail = descriptor ? Buffer.alloc((zip64 ? 20 : 12) + (signed ? 4 : 0)) : Buffer.alloc(0);
    if (descriptor) {
      if (signed) tail.writeUInt32LE(0x08074b50, 0);
      const start = signed ? 4 : 0;
      tail.writeUInt32LE(crc, start);
      if (zip64) { tail.writeBigUInt64LE(BigInt(compressedSize), start + 4); tail.writeBigUInt64LE(BigInt(size), start + 12); }
      else { tail.writeUInt32LE(compressedSize, start + 4); tail.writeUInt32LE(size, start + 8); }
    }
    const centralExtra = extra([size, compressedSize, position], row.centralExtra, centralZip64);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE((3 << 8) | 45, 4); cd.writeUInt16LE(centralZip64 ? 45 : 20, 6);
    cd.writeUInt16LE(flags, 8); cd.writeUInt16LE(method, 10); cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(centralZip64 ? 0xffffffff : compressedSize, 20); cd.writeUInt32LE(centralZip64 ? 0xffffffff : size, 24);
    cd.writeUInt16LE(name.length, 28); cd.writeUInt16LE(centralExtra.length, 30);
    cd.writeUInt32LE(row.attributes ?? ((mode << 16) >>> 0), 38);
    cd.writeUInt32LE(centralZip64 ? 0xffffffff : position, 42);
    offsets.push({local: position, data: position + header.length + localName.length + localExtra.length});
    local.push(header, localName, localExtra, compressed, tail);
    central.push(Buffer.concat([cd, name, centralExtra]));
    position += header.length + localName.length + localExtra.length + compressed.length + tail.length;
  }
  const centralOffset = position;
  for (let index = 0; index < central.length; index++) { offsets[index].central = position; position += central[index].length; }
  const centralSize = position - centralOffset, end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(endZip64 ? 0xffff : entries.length, 8); end.writeUInt16LE(endZip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(endZip64 ? 0xffffffff : centralSize, 12); end.writeUInt32LE(endZip64 ? 0xffffffff : centralOffset, 16);
  end.writeUInt16LE(comment.length, 20);
  const zip64Records = [];
  if (endZip64) {
    const record = Buffer.alloc(56), locator = Buffer.alloc(20);
    record.writeUInt32LE(0x06064b50, 0); record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12); record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(entries.length), 24); record.writeBigUInt64LE(BigInt(entries.length), 32);
    record.writeBigUInt64LE(BigInt(centralSize), 40); record.writeBigUInt64LE(BigInt(centralOffset), 48);
    locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(position), 8); locator.writeUInt32LE(1, 16);
    zip64Records.push(record, locator); position += 76;
  }
  return {bytes: Buffer.concat([...local, ...central, ...zip64Records, end, comment]),
    offsets, centralOffset, eocdOffset: position};
}
