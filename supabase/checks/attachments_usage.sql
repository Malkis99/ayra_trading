-- AYRA Trading — screenshot space by user (read-only). Run in the SQL Editor after 0005.
-- used_mb    = what counts toward the 200 MB limit (all files except those of deleted screenshots)
-- all_mb     = everything in the folder, also files of deleted screenshots waiting 30 days (400 MB hard cap)
-- waiting_mb = files of deleted screenshots (removed by the cleanup 30 days after the deletion)
-- orphans    = files without a screenshot row (an upload was interrupted; removable after 24 hours)
WITH files AS (
  SELECT
    (storage.foldername(o.name))[1] AS user_id,
    COALESCE((o.metadata ->> 'size')::bigint, 0) AS size,
    a.id IS NULL AS orphan,
    a.deleted_at IS NOT NULL AS waiting
  FROM storage.objects o
  LEFT JOIN public.journal_attachments a ON a.file_path = o.name
  WHERE o.bucket_id = 'journal-attachments'
)
SELECT
  u.email,
  count(*) FILTER (WHERE NOT f.orphan AND NOT f.waiting) AS live_files,
  round(COALESCE(sum(f.size) FILTER (WHERE NOT f.waiting), 0) / 1048576.0, 1) AS used_mb,
  round(sum(f.size) / 1048576.0, 1) AS all_mb,
  round(COALESCE(sum(f.size) FILTER (WHERE f.waiting), 0) / 1048576.0, 1) AS waiting_mb,
  count(*) FILTER (WHERE f.orphan) AS orphans,
  round((SELECT attachment_quota_bytes FROM public.journal_limits WHERE id = 1) / 1048576.0) AS limit_mb,
  round((SELECT attachment_hard_cap_bytes FROM public.journal_limits WHERE id = 1) / 1048576.0) AS hard_cap_mb
FROM files f
LEFT JOIN auth.users u ON u.id::text = f.user_id
GROUP BY u.email
ORDER BY all_mb DESC;
