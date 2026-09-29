import { Router } from 'express';
import path from 'node:path';
import { db, transaction } from '../db.js';
import { listOssObjects } from '../oss.js';
import { buildFolderIndex, makeSortOrderCursor } from '../dbHelpers.js';
import { tieredLimiter } from '../limiter.js';
import { cleanObjectSegment, ossPrefix, placeholderKeyForFolderFromMap } from '../storagePath.js';
import { normalizeExt } from '../extPolicy.js';
import { mimeOf } from '../mime.js';
import { invalidateLibraryCaches } from '../libraryCaches.js';

// 游客亦可触发同步（用于共享 OSS 桶的多部署刷新），按身份分层限流：
// 游客 2 次/分钟 < 登录用户 5 次/分钟 < 管理员豁免（同下载/对话的既有约定）。
const syncLimiter = tieredLimiter({
  windowMs: 60 * 1000,
  guest: 2,
  user: 5,
  message: '同步过于频繁，请 1 分钟后再试',
});

const router = Router();

// SQLite 绑定参数上限为 32766（Node 24 捆绑的 SQLite 编译值；999 是 3.32 前的旧默认）。
// BUG-08：每批远低于 SQLite 的绑定参数上限（DELETE 1 参数/行，fixExt 的 CASE 3 参数/行）。
const DELETE_BATCH = 500;
const FIX_EXT_BATCH = 300;
const DAY_MS = 24 * 60 * 60 * 1000;

// IMPROVE-26 的年龄闸门：只剪「已经存在这么久」的死文件夹（默认 7 天，设 0 = 不设限）。
// 带占位对象的文件夹在 OSS 里本来就算活，所以这道闸门专门保护「建库时没写占位对象」的
// 历史遗留目录——给运维一个先用 dry_run 观察、发现异常再处理的窗口，而不是下一次刷新
// 就把它们全删掉。每次请求现读，便于测试与运维临时调整。
const DEFAULT_PRUNE_MIN_AGE_DAYS = 7;
const pruneMinAgeDays = () => {
  const raw = Number(process.env.FOLDER_PRUNE_MIN_AGE_DAYS);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_PRUNE_MIN_AGE_DAYS;
};

// 干跑（?dry_run=1）在提交前主动抛出它来回滚整个事务，同时把「会发生什么」留在内存里
// 返回给调用方：上线前用它核对占位对象覆盖率与将删清单，一个字节都不落库。
const DRY_RUN = Symbol('sync dry run');

// IMPROVE-13：一次性建「parentId -> (清洗段名 -> id)」索引，新建时就地登记。
function buildChildNameIndex() {
  const rows = db.prepare('SELECT id, name, parent_id FROM folders').all();
  const index = new Map(); // parentId(NaN 表示根) -> Map(cleanedName -> id)
  for (const r of rows) {
    const pid = r.parent_id == null ? null : r.parent_id;
    let bucket = index.get(pid);
    if (!bucket) {
      bucket = new Map();
      index.set(pid, bucket);
    }
    const key = cleanObjectSegment(r.name);
    if (!bucket.has(key)) bucket.set(key, r.id);
  }
  return index;
}

/**
 * Sync the local SQLite library with the shared OSS bucket:
 *  - imports files/folders that exist in OSS but not in the local DB
 *    (deployments sharing one bucket only see their own uploads otherwise)
 *  - drops local records whose OSS object no longer exists
 *  - prunes dead folders at **any depth**（子树里既没有文件、也没有占位对象），叠加年龄闸门
 *  - `?dry_run=1` 只算不写：整条写集在提交前回滚，响应里给「会新增/会删除什么」
 * OSS is the source of truth; the empty-listing case never removes records.
 */
router.post('/', syncLimiter, async (req, res, next) => {
  try {
    const dryRun = req.query.dry_run === '1';
    const pruneDays = pruneMinAgeDays();
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
    // 剪枝（或干跑时=将被剪）的文件夹路径，由事务体填充、随响应返回
    let prunedFolderPaths = [];

    const tx = transaction(() => {
      const childNameIndex = buildChildNameIndex();
      // IMPROVE-14：游标只在本次事务内使用，避免每个新行都 prepare + 查一次 MAX(sort_order)。
      const nextSo = makeSortOrderCursor(db);
      const findFolderBySegment = (segment, parentId) =>
        childNameIndex.get(parentId === null ? null : parentId)?.get(segment) ?? null;

      const ensureFolderChain = (segments) => {
        let parentId = null;
        for (const seg of segments) {
          const hit = findFolderBySegment(seg, parentId);
          if (hit != null) {
            parentId = hit;
            continue;
          }
          const so = nextSo('folders', 'parent_id', parentId);
          const info = db
            .prepare(
              'INSERT INTO folders (name, parent_id, sort_order, created_at) VALUES (?, ?, ?, ?)'
            )
            .run(seg, parentId, so, Date.now());
          counts.added_folders += 1;
          // 登记进索引：同一批后续对象/占位符无需再查库就能命中这个新文件夹。
          // 登记的键必须是**父级** id（而不是新行自己的 id），否则同一层会被反复新建。
          let bucket = childNameIndex.get(parentId);
          if (!bucket) {
            bucket = new Map();
            childNameIndex.set(parentId, bucket);
          }
          bucket.set(seg, info.lastInsertRowid);
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
        const so = nextSo('files', 'folder_id', folderId);
        const ext = normalizeExt(path.extname(fname)) || null;
        insertFile.run(
          folderId,
          fname,
          key,
          obj.size ?? 0,
          // 与上传注册保持一致：MIME 由扩展名派生（BUG-26）。
          mimeOf(ext) || null,
          ext,
          null,
          so,
          Date.now()
        );
        counts.added_files += 1;
      }

      // Normalize the ext column from the file name — older imports stored the
      // whole filename there, which breaks mime/imm routing for previews.
      // 批量修复：先查出不一致行，再用 CASE 单条 SQL 批量 UPDATE，避免逐行 UPDATE。
      // 本次会被删除的失联行先算出来：后面的 ext 修复与统计都要排除它们，否则
      // 同一行会同时计入 repaired_files 与 removed_files，一次同步的汇总自相矛盾。
      const staleIds = new Set(
        objects.length > 0
          ? db
              .prepare('SELECT id, oss_key FROM files')
              .all()
              .filter((f) => !keySet.has(f.oss_key))
              .map((f) => f.id)
          : []
      );

      const mismatched = db
        .prepare('SELECT id, name, ext FROM files')
        .all()
        .map((f) => ({ id: f.id, correct: normalizeExt(path.extname(f.name)) || null, cur: f.ext ?? null }))
        .filter((x) => x.correct !== x.cur && !staleIds.has(x.id));
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
        const staleFileIds = [...staleIds];
        // 批量删除：收集待删 id 后分批 IN 删除，避免逐行 DELETE（BUG-08）。
        for (let i = 0; i < staleFileIds.length; i += DELETE_BATCH) {
          const chunk = staleFileIds.slice(i, i + DELETE_BATCH);
          const ph = chunk.map(() => '?').join(', ');
          const info = db.prepare(`DELETE FROM files WHERE id IN (${ph})`).run(...chunk);
          counts.removed_files += info.changes;
        }

        // ---- Prune dead folders (IMPROVE-26) ----
        // 判活规则不变：子树里有文件 / 有活着的子节点 / OSS 里有自己的占位对象。
        // 改动只在「从哪里开始找」：原先只遍历 parent_id IS NULL 的顶层，顶层活着就完全
        // 不往下走，于是挂在活根下的死文件夹永远收不回来（与函数自述的 "prunes folders
        // that are empty" 不符）。现在对整棵树后序遍历，并叠加年龄闸门。
        // 安全性质：被判死的节点按定义「子树里既没有文件、也没有占位对象」，所以
        // files.folder_id 上的 ON DELETE CASCADE 不会连带删掉任何文件行。
        // 判活结果加 memo：原实现对每个顶层重复递归整棵子树，深树/宽树上是重复计算。
        const { folderMap, childrenOf } = buildFolderIndex(
          db.prepare('SELECT id, name, parent_id FROM folders').all()
        );
        const createdAtOf = new Map(
          db.prepare('SELECT id, created_at FROM folders').all().map((r) => [r.id, r.created_at])
        );
        const folderHasFiles = new Set(
          db.prepare('SELECT DISTINCT folder_id FROM files').all().map((r) => r.folder_id)
        );
        const aliveMemo = new Map();
        const folderAlive = (folderId) => {
          if (aliveMemo.has(folderId)) return aliveMemo.get(folderId);
          let alive = folderHasFiles.has(folderId);
          if (!alive) {
            for (const cid of childrenOf.get(folderId) ?? []) {
              if (folderAlive(cid)) {
                alive = true;
                break;
              }
            }
          }
          if (!alive) {
            const ph = placeholderKeyForFolderFromMap(folderId, folderMap);
            alive = !!ph && keySet.has(ph);
          }
          aliveMemo.set(folderId, alive);
          return alive;
        };

        const minAgeMs = pruneDays * DAY_MS;
        const deadFolderIds = [];
        const collectDeadNode = (folderId) => {
          for (const cid of childrenOf.get(folderId) ?? []) collectDeadNode(cid);
          if (folderAlive(folderId)) return;
          // 年龄闸门：本次刚导入/刚建的行必然年轻，天然不会被同一轮同步剪掉。
          // 用「age < 闸门」而不是「created_at > cutoff」比大小：闸门设 0 时不会卡在
          // 同一毫秒的边界上，created_at 取到未来值（时钟回拨）也一律先留着。
          if (Date.now() - (createdAtOf.get(folderId) ?? 0) < minAgeMs) return;
          deadFolderIds.push(folderId);
        };
        for (const root of db.prepare('SELECT id FROM folders WHERE parent_id IS NULL').all()) {
          collectDeadNode(root.id);
        }

        // 先算路径再删：删完 folderMap 就取不到名字了，而响应里要能看出剪了谁。
        prunedFolderPaths = deadFolderIds.map((folderId) => {
          const segs = [];
          let cur = folderId;
          while (cur != null) {
            const node = folderMap.get(cur);
            if (!node) break;
            segs.unshift(node.name);
            cur = node.parent_id ?? null;
          }
          return segs.join('/');
        });

        for (let i = 0; i < deadFolderIds.length; i += DELETE_BATCH) {
          const chunk = deadFolderIds.slice(i, i + DELETE_BATCH);
          const ph = chunk.map(() => '?').join(', ');
          db.prepare(`DELETE FROM folders WHERE id IN (${ph})`).run(...chunk);
          counts.removed_folders += chunk.length;
        }
      }

      if (dryRun) throw DRY_RUN; // 干跑：算完即回滚，一个字节都不落库
    });
    try {
      tx();
    } catch (e) {
      if (e !== DRY_RUN) throw e;
    }
    // 干跑没有写库，缓存无需失效（也别让一次只读探测把前端缓存打掉）。
    if (!dryRun) invalidateLibraryCaches();

    res.json({
      ok: true,
      dry_run: dryRun,
      prune_min_age_days: pruneDays,
      scanned: objects.length,
      added: { folders: counts.added_folders, files: counts.added_files },
      removed: {
        folders: counts.removed_folders,
        files: counts.removed_files,
        // 被剪（干跑时=将被剪）的文件夹路径，最多 20 条，便于在响应里核对
        folder_paths: prunedFolderPaths.slice(0, 20),
      },
      repaired_files: counts.repaired_files,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
