import path from 'node:path';
import { lstat, opendir, realpath } from 'node:fs/promises';

export const ARCHIVE_LIMITS = Object.freeze({ files: 500, fileBytes: 15 * 1024 * 1024, totalBytes: 50 * 1024 * 1024, entries: 5000, depth: 32 });
const excludedDirectories = new Set(['node_modules', 'vendor']);
const archiveError = (message, code = 'ARCHIVE_INVALID') => Object.assign(new Error(message), { code });
const cancelled = signal => { if (signal?.aborted) throw archiveError('La préparation de l’archive a été annulée.', 'ARCHIVE_ABORTED'); };
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => { for (let bit = 0; bit < 8; bit++) value = value & 1 ? (0xedb88320 ^ (value >>> 1)) : value >>> 1; return value >>> 0; });
function crc32(bytes) { let value = 0xffffffff; for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; }
function zipDate(info) {
  const date = new Date(Number(info.mtimeMs)), year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return { time: date.getHours() << 11 | date.getMinutes() << 5 | Math.floor(date.getSeconds() / 2), date: (year - 1980) << 9 | (date.getMonth() + 1) << 5 | date.getDate() };
}
async function inventory(directory, { signal, limits }) {
  const rootInfo = await lstat(directory, { bigint: true });
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw archiveError('Le dossier de cette mission n’est pas accessible.');
  const root = await realpath(directory), files = []; let bytes = 0, seen = 0, excluded = 0;
  const visit = async (relative, depth) => {
    cancelled(signal);
    if (depth > limits.depth) throw archiveError('Ce dossier contient trop de sous-dossiers pour être archivé. Ouvrez son dossier de travail.', 'ARCHIVE_LIMIT');
    const absolute = path.join(root, relative), before = await lstat(absolute, { bigint: true });
    if (before.isSymbolicLink() || !before.isDirectory() || await realpath(absolute) !== absolute) throw archiveError('Un lien symbolique empêche la préparation de l’archive. Ouvrez le dossier de travail.', 'ARCHIVE_FORBIDDEN');
    for await (const entry of await opendir(absolute)) {
      cancelled(signal);
      if (++seen > limits.entries) throw archiveError('Ce dossier contient trop d’éléments pour être archivé. Ouvrez son dossier de travail.', 'ARCHIVE_LIMIT');
      const name = entry.name, itemPath = relative ? `${relative}/${name}` : name;
      if (name.startsWith('.') || entry.isDirectory() && excludedDirectories.has(name)) { excluded++; continue; }
      if (itemPath.length > 1000 || /[\x00-\x1f\x7f\\:]/.test(name) || name !== name.trim()) throw archiveError('Un nom de fichier empêche la préparation de l’archive. Ouvrez le dossier de travail.', 'ARCHIVE_FORBIDDEN');
      const info = await lstat(path.join(root, itemPath), { bigint: true });
      if (info.isSymbolicLink()) throw archiveError('Un lien symbolique empêche la préparation de l’archive. Ouvrez le dossier de travail.', 'ARCHIVE_FORBIDDEN');
      if (info.isDirectory()) { await visit(itemPath, depth + 1); continue; }
      if (!info.isFile()) throw archiveError('Un fichier spécial empêche la préparation de l’archive. Ouvrez le dossier de travail.', 'ARCHIVE_FORBIDDEN');
      if (files.length >= limits.files || info.size > BigInt(limits.fileBytes) || info.size > BigInt(limits.totalBytes - bytes)) throw archiveError('L’archive dépasse les limites du bureau : 500 fichiers, 15 Mo par fichier et 50 Mo au total. Ouvrez le dossier de travail.', 'ARCHIVE_LIMIT');
      const encodedName = Buffer.from(itemPath, 'utf8');
      if (encodedName.length > 65535) throw archiveError('Un nom de fichier est trop long pour cette archive.', 'ARCHIVE_LIMIT');
      files.push({ path: itemPath, name: encodedName, info, size: Number(info.size), ...zipDate(info) }); bytes += Number(info.size);
    }
    const after = await lstat(absolute, { bigint: true });
    if (!sameFile(before, after) || after.isSymbolicLink() || await realpath(absolute) !== absolute) throw archiveError('Le dossier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
  };
  await visit('', 0);
  if (!sameFile(rootInfo, await lstat(directory, { bigint: true })) || await realpath(directory) !== root) throw archiveError('Le dossier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
  files.sort((a, b) => Buffer.compare(a.name, b.name));
  return { files, bytes, excluded, rootInfo, root };
}

// One buffer contains the entire ZIP: content is read directly into it, without
// collecting a second copy of each file. ZIP64 is unnecessary at these limits.
export class MissionArchives {
  constructor({ openFile, limits = ARCHIVE_LIMITS } = {}) {
    if (typeof openFile !== 'function') throw new TypeError('Un lecteur de fichiers de mission est requis.');
    this.openFile = openFile; this.limits = { ...ARCHIVE_LIMITS, ...limits }; this.busy = false;
    for (const [key, value] of Object.entries(this.limits)) if (!Object.hasOwn(ARCHIVE_LIMITS, key) || !Number.isSafeInteger(value) || value < 1 || value > ARCHIVE_LIMITS[key]) throw new TypeError('Les limites d’archive sont invalides.');
  }
  async create(directory, { signal } = {}) {
    if (this.busy) throw archiveError('Une archive est déjà en préparation. Réessayez dans quelques instants.', 'ARCHIVE_BUSY');
    this.busy = true;
    try {
      cancelled(signal);
      const snapshot = await inventory(directory, { signal, limits: this.limits });
      const totalSize = snapshot.bytes + snapshot.files.reduce((size, file) => size + 30 + 46 + file.name.length * 2, 22);
      const zip = Buffer.alloc(totalSize); let offset = 0;
      for (const file of snapshot.files) {
        cancelled(signal);
        let opened;
        try {
          opened = await this.openFile(directory, file.path);
          const before = await opened.handle.stat({ bigint: true });
          if (!before.isFile() || !sameFile(file.info, before) || opened.size !== file.size) throw archiveError('Un fichier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
          file.offset = offset;
          const start = offset + 30 + file.name.length;
          for (let position = 0; position < file.size;) {
            cancelled(signal);
            const { bytesRead } = await opened.handle.read(zip, start + position, Math.min(64 * 1024, file.size - position), position);
            if (!bytesRead) throw archiveError('Un fichier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
            position += bytesRead;
          }
          cancelled(signal);
          if (!sameFile(before, await opened.handle.stat({ bigint: true }))) throw archiveError('Un fichier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
          // Reopen through the trusted reader to detect replacement of a file or
          // any parent after the descriptor was opened; never follow a link.
          const current = await this.openFile(directory, file.path);
          try { if (!sameFile(before, await current.handle.stat({ bigint: true }))) throw archiveError('Un fichier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED'); }
          finally { await current.handle.close(); }
          file.crc = crc32(zip.subarray(start, start + file.size));
          zip.writeUInt32LE(0x04034b50, offset); zip.writeUInt16LE(20, offset + 4); zip.writeUInt16LE(0x800, offset + 6);
          zip.writeUInt16LE(file.time, offset + 10); zip.writeUInt16LE(file.date, offset + 12); zip.writeUInt32LE(file.crc, offset + 14);
          zip.writeUInt32LE(file.size, offset + 18); zip.writeUInt32LE(file.size, offset + 22); zip.writeUInt16LE(file.name.length, offset + 26);
          file.name.copy(zip, offset + 30); offset = start + file.size;
        } finally { await opened?.handle.close(); }
      }
      const centralOffset = offset;
      for (const file of snapshot.files) {
        cancelled(signal);
        zip.writeUInt32LE(0x02014b50, offset); zip.writeUInt16LE(20, offset + 4); zip.writeUInt16LE(20, offset + 6); zip.writeUInt16LE(0x800, offset + 8);
        zip.writeUInt16LE(file.time, offset + 12); zip.writeUInt16LE(file.date, offset + 14); zip.writeUInt32LE(file.crc, offset + 16);
        zip.writeUInt32LE(file.size, offset + 20); zip.writeUInt32LE(file.size, offset + 24); zip.writeUInt16LE(file.name.length, offset + 28);
        zip.writeUInt32LE(file.offset, offset + 42); file.name.copy(zip, offset + 46); offset += 46 + file.name.length;
      }
      const current = await inventory(directory, { signal, limits: this.limits });
      if (!sameFile(snapshot.rootInfo, current.rootInfo) || snapshot.root !== current.root || snapshot.excluded !== current.excluded || snapshot.files.length !== current.files.length || snapshot.files.some((file, index) => file.path !== current.files[index].path || !sameFile(file.info, current.files[index].info))) throw archiveError('Le dossier a changé pendant la préparation. Réessayez depuis la livraison.', 'ARCHIVE_CHANGED');
      cancelled(signal);
      zip.writeUInt32LE(0x06054b50, offset); zip.writeUInt16LE(snapshot.files.length, offset + 8); zip.writeUInt16LE(snapshot.files.length, offset + 10);
      zip.writeUInt32LE(offset - centralOffset, offset + 12); zip.writeUInt32LE(centralOffset, offset + 16);
      return { bytes: zip, fileCount: snapshot.files.length, excludedEntries: snapshot.excluded, sourceBytes: snapshot.bytes };
    } catch (cause) {
      if (cause.code?.startsWith('ARCHIVE_') || cause.code?.startsWith('MISSION_FILE_')) throw cause;
      throw archiveError('Le dossier n’est pas accessible pour préparer son archive. Ouvrez le dossier de travail.');
    } finally { this.busy = false; }
  }
}
