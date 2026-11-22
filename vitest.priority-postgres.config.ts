import { defineConfig, mergeConfig } from "vitest/config";
import base from "./vitest.config";

export default mergeConfig(base, defineConfig({ test: { environment: "node", include: ["scripts/watchlist-priority-postgres.check.mjs"] } }));
