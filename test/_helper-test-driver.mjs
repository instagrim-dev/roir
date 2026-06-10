/**
 * Shared in-process driver for editorial-loop and convergence-loop tests.
 *
 * Calls ROIService directly in-process (no Node subprocess per call) but
 * sources its verb→method map from the canonical lifecycle helper registry
 * so the two cannot drift. Treat this driver as the **fast** path; the
 * **contract** path is the lifecycle helper itself, exercised by
 * `test/lifecycle-helper-contract.test.mjs` and `pnpm run smoke:integration`.
 *
 * If you find yourself adding a verb here, add it to
 * `scripts/lifecycle.mjs` (`VERBS`) instead — this driver picks it up
 * automatically.
 */

import { openDatabase } from "../src/db.mjs";
import { ROIService } from "../src/service.mjs";
import { VERB_TO_METHOD, dispatchVerb } from "../scripts/lifecycle.mjs";

export function createTestService(sqlitePath) {
  const db = openDatabase(sqlitePath);
  const service = new ROIService({ db });
  return {
    db,
    service,
    async call(verb, args = {}) {
      const method = VERB_TO_METHOD.get(verb);
      if (!method || typeof service[method] !== "function") {
        throw new Error(`unknown verb: ${verb}`);
      }
      return dispatchVerb({ db, service, verb, method, args });
    }
  };
}
