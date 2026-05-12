import crypto from "node:crypto";

const CE_TASK_KIND = "ce_materialized";

/**
 * @param {string} missionId
 * @param {string} planId
 * @param {string} bundleId
 * @param {string} unitId
 * @returns {string} Stable idempotency key (store under payload.ce.materialization_key)
 */
export function materializationKey(missionId, planId, bundleId, unitId) {
  const raw = [missionId, planId || "", bundleId, unitId].join("\0");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * @typedef {Object} CePlanUnit
 * @property {string} id
 * @property {string} [title]
 * @property {string|string[]} [verification]
 * @property {string} [execution_note]
 * @property {string[]} [depends_on]
 * @property {string[]} [patterns_to_follow]
 * @property {string[]} [files]
 */

/**
 * @typedef {Object} CePlanBundle
 * @property {number} [schema_version]
 * @property {string} bundle_id
 * @property {string} [source_ref] — e.g. path to docs/plans/*.md
 * @property {CePlanUnit[]} units
 */

/**
 * Idempotently create ROI tasks for each CE plan unit. Skips a unit when
 * a task with the same payload.ce.materialization_key already exists for the mission.
 *
 * @param {import("./service.mjs").ROIService} service
 * @param {{ mission_id: string, plan_id?: string, bundle: CePlanBundle, kind?: string }} input
 * @returns {{ created: import("./service.mjs").Task[], skipped: { unit_id: string, reason: string }[] }}
 */
export function materializeBundle(service, input) {
  const { mission_id, plan_id: planId = "", bundle } = input;
  const kind = input.kind ?? CE_TASK_KIND;
  if (!bundle?.bundle_id || !Array.isArray(bundle.units)) {
    throw new Error("ce plan bundle: bundle_id and units[] are required");
  }
  const bundleId = bundle.bundle_id;

  // Validate all unit IDs are present and unique before touching the store.
  const intraIds = new Set();
  for (const unit of bundle.units) {
    if (!unit?.id) {
      throw new Error("ce plan bundle: every unit must have an id");
    }
    if (intraIds.has(unit.id)) {
      throw new Error(`ce plan bundle: duplicate unit id ${JSON.stringify(unit.id)} — check bundle authoring`);
    }
    intraIds.add(unit.id);
  }

  const existing = service.taskList({ mission_id }).tasks;
  const keysSeen = new Set(
    existing.map((t) => t.payload?.ce?.materialization_key).filter(Boolean)
  );

  const created = [];
  const skipped = [];

  for (const unit of bundle.units) {
    const matKey = materializationKey(mission_id, planId, bundleId, unit.id);
    if (keysSeen.has(matKey)) {
      skipped.push({ unit_id: unit.id, reason: "materialization_key already present" });
      continue;
    }

    const ver = unit.verification;
    const payload = {
      ce: {
        bundle_id: bundleId,
        schema_version: bundle.schema_version ?? 1,
        unit_id: unit.id,
        source_ref: bundle.source_ref ?? "",
        materialization_key: matKey,
        title: unit.title ?? unit.id,
        verification: ver === undefined ? [] : Array.isArray(ver) ? ver : [String(ver)],
        execution_note: unit.execution_note ?? "",
        patterns_to_follow: unit.patterns_to_follow ?? [],
        files: unit.files ?? [],
        depends_on_unit_ids: unit.depends_on ?? []
      }
    };

    const { task } = service.taskCreate({
      mission_id,
      plan_id: planId,
      run_id: "",
      kind,
      status: "queued",
      payload
    });
    created.push(task);
    keysSeen.add(matKey);
  }

  return { created, skipped };
}
