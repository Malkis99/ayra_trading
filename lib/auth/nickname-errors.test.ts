import { describe, it, expect } from "vitest";
import { nicknameErrorKey } from "./auth-context";

describe("nickname save errors from the server", () => {
  it("maps Postgres errors to clear messages", () => {
    expect(nicknameErrorKey("23505", "duplicate key value violates unique constraint")).toBe("errorNicknameTaken");
    expect(nicknameErrorKey("23514", "violates check constraint nickname_format_check")).toBe("errorLatin");
    expect(nicknameErrorKey("P0001", "nickname_change_cooldown")).toBe("nicknameCooldown");
    expect(nicknameErrorKey("42501", "permission denied")).toBe("genericError");
    expect(nicknameErrorKey(null, null)).toBe("genericError");
  });
});
