import { ZipArchive } from 'archiver';
import { Router } from 'express';

import { getAuth } from '../middleware/auth.ts';
import { buildExport } from '../services/export.service.ts';

const router = Router();

const stamp = (): string => new Date().toISOString().slice(0, 10);

router.get('/archive', async (req, res) => {
  const { userId } = getAuth(req);
  const { files } = await buildExport(userId);

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="margin-backup-${stamp()}.zip"`,
  );

  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.on('error', (err) => res.destroy(err));
  zip.pipe(res);
  for (const file of files) zip.append(file.content, { name: file.path });
  await zip.finalize();
});

router.get('/data.json', async (req, res) => {
  const { userId } = getAuth(req);
  const { data } = await buildExport(userId);
  res.setHeader('Content-Disposition', 'attachment; filename="margin-data.json"');
  res.type('application/json').send(JSON.stringify(data, null, 2));
});

router.get('/journal.md', async (req, res) => {
  const { userId } = getAuth(req);
  const { files } = await buildExport(userId);
  const md = files
    .filter((f) => f.path.startsWith('journal/'))
    .map((f) => f.content)
    .join('\n\n---\n\n');
  res.setHeader('Content-Disposition', 'attachment; filename="margin-journal.md"');
  res.type('text/markdown').send(md || '# No journal entries yet\n');
});

router.get('/transactions.csv', async (req, res) => {
  const { userId } = getAuth(req);
  const { files } = await buildExport(userId);
  const csv = files.find((f) => f.path === 'finance/transactions.csv')?.content ?? '';
  res.setHeader('Content-Disposition', 'attachment; filename="margin-transactions.csv"');
  res.type('text/csv').send(csv);
});

export default router;
