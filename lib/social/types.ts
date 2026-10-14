/**
 * Social data of profiles (spec v1.2: free follows only, profile likes). Minimal model until Community (S10):
 * the local repository stores events in AppStorage, the server one comes with cloud sync (T7b).
 */
export interface Follow {
  followerId: string;
  followeeId: string;
  createdAt: string; // ISO
}

export interface ProfileLike {
  userId: string;
  profileId: string;
  createdAt: string; // ISO
}

export interface SocialCounts {
  followers: number;
  following: number;
  likes: number;
}

export type SocialError = "self" | "duplicate";
export type SocialResult = { ok: true } | { ok: false; error: SocialError };

export interface SocialRepository {
  getCounts(profileId: string): Promise<SocialCounts>;
  listFollowers(profileId: string): Promise<Follow[]>;
  listFollowing(profileId: string): Promise<Follow[]>;
  /** Following yourself is impossible. */
  follow(followerId: string, followeeId: string): Promise<SocialResult>;
  unfollow(followerId: string, followeeId: string): Promise<void>;
  /** Liking your own profile is impossible. */
  likeProfile(userId: string, profileId: string): Promise<SocialResult>;
  unlikeProfile(userId: string, profileId: string): Promise<void>;
}
