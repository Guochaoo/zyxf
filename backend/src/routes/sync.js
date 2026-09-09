import { Router } from 'express';
import path from 'node:path';
import { db, transaction } from '../db.js';
import { listOssObjects } from '../oss.js';
import { requireAdmin } from '../auth.js';
import { buildFolderIndex, nextSortOrder } from '../dbHelpers.js';
import { adminBypassLimiter } from '../limiter.js';
import { cleanObjectSegment, ossPrefix, placeholderKeyForFolderFromMap } from '../storagePath.js';
import { normalizeExt } from '../extPolicy.js';

// Every IP may sync at most 5 times per minute (admins bypass, like download limits).
const syncLimiter = adminBypassLimiter(60 * 1000, 5, '同步过于频繁，请 1 分钟后再试');

const router = Router();

// SQLite 绑定参数上限为 32766（Node 24 捆绑的 SQLite 编译值；999 是 3.32 前的旧默认）。
// 分批 DELETE/FIX 每批远低于该上限，留足余量（BUG-08）。
// DELETE 用 1 参数/行；fixExt 的 CASE 用 3 参数/行（WHEN id, THEN ext, WHERE id IN）。
const DELETE_BATCH = 500;
const FIX_EXT_BATCH = 300;

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
router.post('/', requireAdmin, syncLimiter, async (req, res, next) => {
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

    const tx = transaction(() => {
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
      // 批量修复：先查出不一致行，再用 CASE 单条 SQL 批量 UPDATE，避免逐行 UPDATE。
      const mismatched = db
        .prepare('SELECT id, name, ext FROM files')
        .all()
        .map((f) => ({ id: f.id, correct: normalizeExt(path.extname(f.name)) || null, cur: f.ext ?? null }))
        .filter((x) => x.correct !== x.cur);
      // fixExt 的批量 CASE：每条记录的 UPDATE 需要 2 个参数（WHEN id THEN correct），
      // WHERE id IN 需要 1 个参数/id。为了不触及参数上限并保持统计准确，分批执行。
      for (let i = 0; i < mismatched.length; i += FIX_EXT_BATCH) {
        const chunk = mismatched.slice(i, i + FIX_EXT_BATCH);
        const whenPart = chunk.map(() => 'WHEN ? THEN ?').join(' ');
        const idList = chunk.map((c) => c.id);
        const sql = `UPDATE files SET ext = CASE id ${whenPart} ELSE ext END WHERE id IN (${idList
          .map(() => '?')
          .join(', ')})`;
        db.prepare(sql).run(...chunk.flatMap((c) => [c.id, c.correct]), ...idList);
        counts.repaired_files += chunk.length;
      }

      // Drop local records whose OSS object is gone. Skip when the listing is
      // empty — an empty bucket must never wipe the library (misconfig guard).
      if (objects.length > 0) {
        const staleFileIds = db
          .prepare('SELECT id, oss_key FROM files')
          .all()
          .filter((f) => !keySet.has(f.oss_key))
          .map((f) => f.id);
        // 批量删除：收集待删 id 后分批 IN 删除，避免逐行 DELETE（BUG-08）。
        for (let i = 0; i < staleFileIds.length; i += DELETE_BATCH) {
          const chunk = staleFileIds.slice(i, i + DELETE_BATCH);
          const ph = chunk.map(() => '?').join(', ');
          const info = db.prepare(`DELETE FROM files WHERE id IN (${ph})`).run(...chunk);
          counts.removed_files += info.changes;
        }

        // Prune folders with no placeholder object and no remaining content.
        // 逐行 DELETE 改为：收集整棵死树的节点 id（后序），再分批 IN 删除（BUG-08）。
        // N+1 修复：一次加载全库 folders / files 到内存 map，再在内存里对整棵
        // 树判活 + 收集死树，placeholder key 也从内存 map 计算，不再每层/每节点查库。
        const { folderMap, childrenOf } = buildFolderIndex(
          db.prepare('SELECT id, name, parent_id FROM folders').all()
        );
        const folderHasFiles = new Set(
          db.prepare('SELECT DISTINCT folder_id FROM files').all().map((r) => r.folder_id)
        );
        const folderAlive = (folderId) => {
          const children = childrenOf.get(folderId);
          if (children) for (const cid of children) if (folderAlive(cid)) return true;
          if (folderHasFiles.has(folderId)) return true;
          const ph = placeholderKeyForFolderFromMap(folderId, folderMap);
          return !!ph && keySet.has(ph);
        };
        const collectDeadTree = (folderId, ids) => {
          const children = childrenOf.get(folderId);
          if (children) for (const cid of children) collectDeadTree(cid, ids);
          ids.push(folderId);
        };
        // 先汇总所有已死根的子树 id，再统一分批删除，避免每棵树的重复构建与逐行 DELETE。
        const deadFolderIds = [];
        for (const root of db.prepare('SELECT id FROM folders WHERE parent_id IS NULL').all()) {
          if (!folderAlive(root.id)) collectDeadTree(root.id, deadFolderIds);
        }
        for (let i = 0; i < deadFolderIds.length; i += DELETE_BATCH) {
          const chunk = deadFolderIds.slice(i, i + DELETE_BATCH);
          const ph = chunk.map(() => '?').join(', ');
          db.prepare(`DELETE FROM folders WHERE id IN (${ph})`).run(...chunk);
          counts.removed_folders += chunk.length;
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
