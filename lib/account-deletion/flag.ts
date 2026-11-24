/** Q4.7-Б1: the account deletion is on (the owner sets it after migration 0023 is applied). Off by default. */
export const accountDeletionEnabled = () => process.env.NEXT_PUBLIC_AYRA_ACCOUNT_DELETION === "1";
