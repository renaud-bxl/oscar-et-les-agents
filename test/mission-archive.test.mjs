import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, mkdir, writeFile, rm, symlink, rename, appendFile } from 'node:fs/promises';
import { MissionArchives, ARCHIVE_LIMITS } from '../lib/mission-archive.mjs';
import { openMissionDownload } from '../server.mjs';

async function fixture(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'oscar-archive-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
function entries(zip) {
  const end = zip.length - 22; assert.equal(zip.readUInt32LE(end), 0x06054b50);
  let central = zip.readUInt32LE(end + 16); const result = new Map();
  for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
    assert.equal(zip.readUInt32LE(central), 0x02014b50); assert.equal(zip.readUInt16LE(central + 8), 0x800);
    const length = zip.readUInt16LE(central + 28), name = zip.subarray(central + 46, central + 46 + length).toString('utf8'), local = zip.readUInt32LE(central + 42);
    assert.equal(zip.readUInt32LE(local), 0x04034b50); assert.equal(zip.readUInt16LE(local + 6), 0x800); assert.equal(zip.readUInt16LE(local + 8), 0);
    const start = local + 30 + zip.readUInt16LE(local + 26), size = zip.readUInt32LE(central + 24);
    assert.equal(zip.readUInt32LE(local + 14), zip.readUInt32LE(central + 16));
    result.set(name, { bytes: zip.subarray(start, start + size), crc: zip.readUInt32LE(central + 16) }); central += 46 + length;
  }
  assert.equal(central, end); return result;
}

test('ZIP UTF-8 : fichiers binaires, chemins accentués, fichiers vides et CRC standard intacts', async t => {
  const root = await fixture(t); await mkdir(path.join(root, 'Créations'));
  const binary = Buffer.from(Array.from({ length: 2560 }, (_, index) => index % 256));
  await writeFile(path.join(root, 'Créations', 'affiche été.bin'), binary); await writeFile(path.join(root, 'vide.txt'), ''); await writeFile(path.join(root, 'crc.txt'), '123456789');
  const archive = await new MissionArchives({ openFile: openMissionDownload }).create(root), files = entries(archive.bytes);
  assert.deepEqual([...files.keys()], ['Créations/affiche été.bin', 'crc.txt', 'vide.txt']);
  assert.deepEqual(files.get('Créations/affiche été.bin').bytes, binary); assert.equal(files.get('crc.txt').crc, 0xcbf43926); assert.equal(files.get('vide.txt').bytes.length, 0);
  assert.equal(archive.fileCount, 3); assert.equal(archive.excludedEntries, 0); assert.equal(archive.sourceBytes, binary.length + 9);
});

test('les fichiers cachés et dépendances sont exclus explicitement, sans inclure leur contenu', async t => {
  const root = await fixture(t);
  for (const folder of ['.cache', 'node_modules', 'vendor', 'site', 'site/node_modules']) await mkdir(path.join(root, folder), { recursive: true });
  for (const folder of ['.cache', 'node_modules', 'vendor', 'site/node_modules']) await writeFile(path.join(root, folder, 'secret.txt'), 'NE PAS ARCHIVER');
  await writeFile(path.join(root, '.env'), 'NE PAS ARCHIVER'); await writeFile(path.join(root, 'site', 'index.html'), '<p>Un site</p>');
  const archive = await new MissionArchives({ openFile: openMissionDownload }).create(root);
  assert.deepEqual([...entries(archive.bytes).keys()], ['site/index.html']); assert.equal(archive.excludedEntries, 5); assert(!archive.bytes.includes(Buffer.from('NE PAS ARCHIVER')));
});

test('un dossier vide produit une vraie archive vide', async t => {
  const archive = await new MissionArchives({ openFile: openMissionDownload }).create(await fixture(t)); assert.equal(archive.bytes.length, 22); assert.equal(entries(archive.bytes).size, 0);
});

test('les liens symboliques internes, externes et parents liés ne sont jamais suivis', async t => {
  const root = await fixture(t), outside = await fixture(t); await writeFile(path.join(outside, 'secret.txt'), 'NE PAS LIRE'); await writeFile(path.join(root, 'notes.txt'), 'notes');
  const service = new MissionArchives({ openFile: openMissionDownload });
  for (const target of [path.join(root, 'notes.txt'), path.join(outside, 'secret.txt'), outside]) {
    await symlink(target, path.join(root, 'lien')); await assert.rejects(service.create(root), { code: 'ARCHIVE_FORBIDDEN' }); await rm(path.join(root, 'lien'));
  }
  await symlink(outside, path.join(root, 'dossier-lie')); await assert.rejects(service.create(path.join(root, 'dossier-lie')), { code: 'ARCHIVE_INVALID' });
});

test('les limites refusent tout le ZIP au lieu de tronquer les fichiers ou le contenu', async t => {
  const root = await fixture(t); await writeFile(path.join(root, 'a'), '12345'); await writeFile(path.join(root, 'b'), '12345');
  for (const limits of [{ files: 1 }, { fileBytes: 4 }, { totalBytes: 9 }, { entries: 1 }]) {
    const service = new MissionArchives({ openFile: openMissionDownload, limits }); await assert.rejects(service.create(root), { code: 'ARCHIVE_LIMIT' }); assert.equal(service.busy, false);
  }
  await mkdir(path.join(root, 'un', 'deux'), { recursive: true }); await assert.rejects(new MissionArchives({ openFile: openMissionDownload, limits: { depth: 1 } }).create(root), { code: 'ARCHIVE_LIMIT' });
  assert.deepEqual(ARCHIVE_LIMITS, { files: 500, fileBytes: 15728640, totalBytes: 52428800, entries: 5000, depth: 32 });
  assert.throws(() => new MissionArchives({ openFile: openMissionDownload, limits: { totalBytes: 52428801 } }), TypeError);
});

test('les noms incompatibles avec le lecteur sûr ne deviennent pas des chemins ZIP dangereux', async t => {
  const root = await fixture(t);
  for (const name of ['nom:flux', ' chemin', 'chemin ', 'dir\\fichier', 'retour\nligne']) {
    await writeFile(path.join(root, name), 'contenu'); await assert.rejects(new MissionArchives({ openFile: openMissionDownload }).create(root), { code: 'ARCHIVE_FORBIDDEN' }); await rm(path.join(root, name));
  }
});

test('la mutation pendant la lecture et le remplacement après ouverture annulent le ZIP', async t => {
  const root = await fixture(t); await writeFile(path.join(root, 'notes.txt'), '123456789'); let changed = false;
  const service = new MissionArchives({ openFile: async (directory, relative) => {
    const opened = await openMissionDownload(directory, relative);
    if (!changed) { changed = true; await appendFile(path.join(root, relative), 'modification'); }
    return opened;
  } });
  await assert.rejects(service.create(root), { code: 'ARCHIVE_CHANGED' }); assert.equal(service.busy, false);
  changed = false;
  const replacement = new MissionArchives({ openFile: async (directory, relative) => {
    const opened = await openMissionDownload(directory, relative);
    if (!changed) { changed = true; await rename(path.join(root, relative), path.join(root, 'ancien.txt')); await writeFile(path.join(root, relative), 'remplacement'); }
    return opened;
  } });
  await assert.rejects(replacement.create(root), { code: 'ARCHIVE_CHANGED' });
});

test('un fichier ajouté dans un sous-dossier après inventaire ne disparaît pas silencieusement du ZIP', async t => {
  const root = await fixture(t); await mkdir(path.join(root, 'livraison')); await writeFile(path.join(root, 'livraison', 'notes.txt'), 'contenu'); let added = false;
  const service = new MissionArchives({ openFile: async (directory, relative) => {
    if (!added) { added = true; await writeFile(path.join(root, 'livraison', 'nouveau.txt'), 'nouveau'); }
    return openMissionDownload(directory, relative);
  } });
  await assert.rejects(service.create(root), { code: 'ARCHIVE_CHANGED' });
});

test('annuler ferme les fichiers et libère le verrou sans livraison partielle', async t => {
  const root = await fixture(t); await writeFile(path.join(root, 'notes.txt'), Buffer.alloc(200000)); const controller = new AbortController(); let closed = 0;
  const service = new MissionArchives({ openFile: async (directory, relative) => {
    const opened = await openMissionDownload(directory, relative), realClose = opened.handle.close.bind(opened.handle);
    opened.handle.close = async () => { closed++; return realClose(); }; controller.abort(); return opened;
  } });
  await assert.rejects(service.create(root, { signal: controller.signal }), { code: 'ARCHIVE_ABORTED' }); assert.equal(closed, 1); assert.equal(service.busy, false);
  const preAborted = AbortSignal.abort(); await assert.rejects(service.create(root, { signal: preAborted }), { code: 'ARCHIVE_ABORTED' });
});

test('une seule préparation peut réserver la mémoire et une lecture échouée ferme son descripteur', async t => {
  const root = await fixture(t); await writeFile(path.join(root, 'notes.txt'), 'contenu'); let release, entered, closed = 0;
  const started = new Promise(resolve => { entered = resolve; });
  const service = new MissionArchives({ openFile: async (directory, relative) => {
    const opened = await openMissionDownload(directory, relative), realClose = opened.handle.close.bind(opened.handle);
    opened.handle.close = async () => { closed++; return realClose(); }; entered(); await new Promise(resolve => { release = resolve; });
    opened.handle.read = async () => { throw new Error('échec simulé'); }; return opened;
  } });
  const pending = service.create(root); await started; await assert.rejects(service.create(root), { code: 'ARCHIVE_BUSY' }); release(); await assert.rejects(pending, { code: 'ARCHIVE_INVALID' }); assert.equal(closed, 1); assert.equal(service.busy, false);
});
