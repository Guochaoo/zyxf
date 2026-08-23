import { Router } from 'express';
import { searchLibrary } from '../searchService.js';

const router = Router();

router.get('/', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json({ folders: [], files: [] });
  res.json(searchLibrary(q));
});

export default router;
