import { db, accounts } from "@/db";
import { getSetting, setSetting } from "./settings";
import { rebuildAccount } from "./rebuild";

const FLAG = "exitTimesBackfilled";

/**
 * Trades saved before sell times were stored cannot be split by the day each part was
 * sold. Rebuilding an account from its fills adds those times and leaves notes, tags and
 * ratings untouched (rows are matched by their stable key). Runs once per database.
 */
export function backfillExitTimes(): void {
  if (getSetting(FLAG) === "1") return;
  try {
    for (const account of db.select({ id: accounts.id }).from(accounts).all()) {
      rebuildAccount(account.id);
    }
    setSetting(FLAG, "1");
  } catch (error) {
    // Leave the flag unset so the next start tries again; never block startup.
    console.error("Could not add sell times to saved trades:", error);
  }
}
