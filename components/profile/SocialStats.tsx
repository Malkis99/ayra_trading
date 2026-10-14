"use client";

import React, { useEffect, useState } from "react";
import { Heart, UserCheck, Users } from "lucide-react";
import { useApp } from "@/lib/context";
import { useGame } from "@/lib/game-context";
import { useAuth } from "@/lib/auth/auth-context";
import { Modal } from "@/components/ui";
import { EmptyState } from "@/components/ui";
import { cn } from "@/components/ui/cn";
import { canSeeSocialCounts, defaultSocialRepository, formatSocialCount, localProfileId } from "@/lib/social/repository";
import type { SocialCounts } from "@/lib/social/types";

type ListKind = "followers" | "following";

/**
 * Followers / following / profile likes of the shown profile (only real numbers: 0 until Community brings events).
 * Followers and following open their list (an empty state until Community). Hidden profiles: only the owner sees it.
 */
export function SocialStats({ viewerId }: { viewerId?: string | null }) {
  const { dict, lang } = useApp();
  const { gameState } = useGame();
  const { user } = useAuth();
  const s = dict.profile.social;
  const ownerId = localProfileId(user?.id);
  const visibility = gameState.profileDetails?.visibility;
  const viewer = viewerId === undefined ? ownerId : viewerId;
  const [counts, setCounts] = useState<SocialCounts>({ followers: 0, following: 0, likes: 0 });
  const [list, setList] = useState<ListKind | null>(null);

  useEffect(() => {
    let alive = true;
    defaultSocialRepository.getCounts(ownerId).then((c) => alive && setCounts(c));
    return () => {
      alive = false;
    };
  }, [ownerId]);

  if (!canSeeSocialCounts(viewer, ownerId, visibility)) return null;

  const item = (kind: ListKind | "likes", Icon: typeof Users, label: string, value: number) => {
    const body = (
      <>
        <span className="flex items-center gap-1.5 text-[11px] text-mu">
          <Icon size={13} className="text-vi" aria-hidden="true" />
          {label}
        </span>
        <span className="text-lg font-semibold tabular-nums text-tx" data-testid={`social-${kind}`}>
          {formatSocialCount(value, lang)}
        </span>
      </>
    );
    const cls = "flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-xl border border-line/70 bg-s2/40 px-3 py-2 text-left";
    if (kind === "likes") return <div className={cls}>{body}</div>;
    return (
      <button
        type="button"
        onClick={() => setList(kind)}
        aria-haspopup="dialog"
        className={cn(cls, "transition hover:border-vi/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vi")}
      >
        {body}
      </button>
    );
  };

  return (
    <section aria-label={s.title} data-testid="social-stats" className="space-y-1.5">
      <div className="flex gap-2">
        {item("followers", Users, s.followers, counts.followers)}
        {item("following", UserCheck, s.following, counts.following)}
        {item("likes", Heart, s.likes, counts.likes)}
      </div>
      {visibility === "hidden" && <p className="text-[11px] text-mu">{s.hiddenNote}</p>}
      <Modal
        isOpen={list !== null}
        onClose={() => setList(null)}
        title={list === "following" ? s.following : s.followers}
        closeLabel={s.close}
        size="sm"
        sheetOnMobile
        data-testid="social-list"
      >
        <EmptyState icon={<Users size={22} aria-hidden="true" />} title={s.empty} description={s.emptyHint} />
      </Modal>
    </section>
  );
}
