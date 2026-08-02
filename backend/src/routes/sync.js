import { Router } from 'express';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { db } from '../db.js';
import { listOssObjects } from '../oss.js';
import { nextSortOrder } from '../dbHelpers.js';
import { cleanObjectSegment, ossPrefix, placeholderKeyForFolder } from '../storagePath.js';
import { normalizeExt } from '../extPolicy.js';

// Every IP may sync at most 5 times per minute (admins bypass, like download limits).
const syncLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.user?.role === 'admin',
  message: { error: '同步过于频繁，请 1 分钟后再试' },
});

const router = Router();

// Find a folder whose OSS segment (cleaned name) equals `segment`, under parentId.
function findFolderBySegment(segment, parentId) {
  const rows =
    parentId === null
      ? db.prepare('SELECT id, name FROM folders WHERE parent_id IS NULL').all()
      : db.prepare('SELECT id, name FROM folders WHERE parent_id = ?').all(parentId);
  return rows.find((r) => cleanObjectSegment(r.name) === segment) || null;
}

/**
 * Sync the local SQLite library with the shared OSS bucket:
 *  - imports files/folders that exist in OSS but not in the local DB
 *    (deployments sharing one bucket only see their own uploads otherwise)
 *  - drops local records whose OSS object no longer exists
 *  - prunes folders that are empty and have no placeholder object
 * OSS is the source of truth; the empty-listing case never removes records.
 */
router.post('/', syncLimiter, async (req, res, next) => {
  try {
    const objects = await listOssObjects();
    const keySet = new Set(objects.map((o) => o.key));
    const prefixSegs = ossPrefix().split('/').filter(Boolean);
    const counts = {
      added_folders: 0,
      added_files: 0,
      removed_files: 0,
      removed_folders: 0,
      repaired_files: 0,
    };

    const tx = db.transaction(() => {
      const ensureFolderChain = (segments) => {
        let parentId = null;
        for (const seg of segments) {
          const hit = findFolderBySegment(seg, parentId);
          if (hit) {
            parentId = hit.id;
            continue;
          }
          const so = nextSortOrder(db, 'folders', 'parent_id', parentId);
          const info = db
            .prepare(
              'INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)'
            )
            .run(seg, parentId, so, Date.now());
          counts.added_folders += 1;
          parentId = info.lastInsertRowid;
        }
        return parentId;
      };

      const fileByKey = db.prepare('SELECT id FROM files WHERE oss_key = ?');
      const insertFile = db.prepare(
        `INSERT INTO files (folder_id, name, oss_key, size, mime_type, ext, uploader, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const obj of objects) {
        const key = obj.key;
        const rel = key.split('/').filter((s) => s.length);
        if (
          prefixSegs.length &&
          rel.length >= prefixSegs.length &&
          rel.slice(0, prefixSegs.length).join('/') === prefixSegs.join('/')
        ) {
          rel.splice(0, prefixSegs.length);
        }
        if (!rel.length) continue;

        if (key.endsWith('/')) {
          ensureFolderChain(rel); // folder placeholder
          continue;
        }

        if (fileByKey.get(key)) continue;
        const fname = rel.pop();
        const folderId = rel.length ? ensureFolderChain(rel) : null;
        const so = nextSortOrder(db, 'files', 'folder_id', folderId);
        insertFile.run(
          folderId,
          fname,
          key,
          obj.size ?? 0,
          null,
          normalizeExt(path.extname(fname)) || null,
          null,
          so,
          Date.now()
        );
        counts.added_files += 1;
      }

      // Normalize the ext column from the file name — older imports stored the
      // whole filename there, which breaks mime/imm routing for previews.
      const fixExt = db.prepare('UPDATE files SET ext = ? WHERE id = ?');
      for (const f of db.prepare('SELECT id, name, ext FROM files').all()) {
        const correct = normalizeExt(path.extname(f.name)) || null;
        if ((correct ?? null) !== (f.ext ?? null)) {
          fixExt.run(correct, f.id);
          counts.repaired_files += 1;
        }
      }

      // Drop local records whose OSS object is gone. Skip when the listing is
      // empty — an empty bucket must never wipe the library (misconfig guard).
      if (objects.length > 0) {
        for (const f of db.prepare('SELECT id, oss_key FROM files').all()) {
          if (!keySet.has(f.oss_key)) {
            db.prepare('DELETE FROM files WHERE id = ?').run(f.id);
            counts.removed_files += 1;
          }
        }

        // Prune folders with no placeholder object and no remaining content.
        const folderAlive = (folderId) => {
          for (const k of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId)) {
            if (folderAlive(k.id)) return true;
          }
          if (db.prepare('SELECT 1 FROM files WHERE folder_id = ?').get(folderId)) return true;
          const ph = placeholderKeyForFolder(db, folderId);
          return !!ph && keySet.has(ph);
        };
        const deleteTree = (folderId) => {
          for (const k of db.prepare('SELECT id FROM folders WHERE parent_id = ?').all(folderId)) {
            deleteTree(k.id);
          }
          db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
          counts.removed_folders += 1;
        };
        for (const root of db.prepare('SELECT id FROM folders WHERE parent_id IS NULL').all()) {
          if (!folderAlive(root.id)) deleteTree(root.id);
        }
      }
    });
    tx();

    res.json({
      ok: true,
      scanned: objects.length,
      added: { folders: counts.added_folders, files: counts.added_files },
      removed: { folders: counts.removed_folders, files: counts.removed_files },
      repaired_files: counts.repaired_files,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
