import { spaceTabChannel } from "@/lib/auth/space-channel";

/** A response belongs to the space that started it, even across A → B → A in the same tab. */
export function captureMarketAccount(readUserId: () => string | null) {
  const userId = readUserId();
  let invalidated = false;
  const unsubscribe = spaceTabChannel.subscribe(message => {
    if (message.fromSpaceId !== message.toSpaceId) invalidated = true;
  });
  return { userId, current: () => !invalidated && readUserId() === userId, dispose: unsubscribe };
}
