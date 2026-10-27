"use client";

import React from "react";
import { Cloud, Pause, Play, RotateCw } from "lucide-react";
import { useApp } from "@/lib/context";
import { useJournal } from "@/lib/journal/context";
import { Button } from "@/components/ui";
import { formatString } from "@/lib/i18n";

/**
 * Settings → Cloud and data → «Screenshots in the cloud» (0005-C, plan #90 section 1.4): how many are in the cloud,
 * the upload of the ones still only on this device with «Stop» / «Continue», failed ones with «Retry», no space.
 * Only for an account with the cloud on.
 */
export function ScreenshotsCloudCard() {
  const { dict } = useApp();
  const { screenshotsCloud: s, pauseScreenshotUploads, resumeScreenshotUploads, syncMode } = useJournal();
  const t = dict.journalSettings.screenshotsCloud;
  if (!s || s.total === 0) return null;
  const percent = Math.round((s.inCloud / s.total) * 100);
  const done = s.inCloud >= s.total && s.waiting === 0;

  return (
    <div className="card space-y-3" data-testid="screenshots-cloud">
      <h4 className="h4 flex items-center gap-2">
        <Cloud size={18} className="text-acc" aria-hidden="true" />
        <span>{t.title}</span>
      </h4>
      <div className="space-y-1.5">
        <p className="text-sm text-tx" data-testid="screenshots-cloud-count">
          {formatString(t.inCloud, { x: s.inCloud, y: s.total })}
        </p>
        <div
          className="h-2 w-full overflow-hidden rounded-full border border-line bg-s1"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={s.total}
          aria-valuenow={s.inCloud}
          aria-label={t.title}
        >
          <div className="h-full bg-acc transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-mu" role="status" data-testid="screenshots-cloud-state">
          {done ? t.allIn : s.paused ? t.paused : s.uploading ? t.uploading : syncMode === "manual" ? t.manualWaits : t.waiting}
        </p>
        {s.failed > 0 && (
          <p className="text-xs text-rose-300" data-testid="screenshots-cloud-failed">
            {formatString(t.failed, { n: s.failed })}
          </p>
        )}
        {s.noSpace > 0 && <p className="text-xs text-amber-300">{t.noSpace}</p>}
      </div>
      {!done && (
        <div className="flex flex-wrap gap-2">
          {s.paused ? (
            <Button size="sm" variant="secondary" onClick={() => void resumeScreenshotUploads()} data-testid="screenshots-cloud-continue">
              <Play size={14} aria-hidden="true" />
              <span>{t.continue}</span>
            </Button>
          ) : (
            s.waiting > s.failed + s.noSpace && (
              <Button size="sm" variant="secondary" onClick={pauseScreenshotUploads} data-testid="screenshots-cloud-stop">
                <Pause size={14} aria-hidden="true" />
                <span>{t.stop}</span>
              </Button>
            )
          )}
          {s.failed > 0 && !s.paused && (
            <Button size="sm" variant="secondary" onClick={() => void resumeScreenshotUploads()} data-testid="screenshots-cloud-retry">
              <RotateCw size={14} aria-hidden="true" />
              <span>{t.retry}</span>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
