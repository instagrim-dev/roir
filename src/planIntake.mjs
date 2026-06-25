const KNOWN_HOSTS = [
  ["claude", /\bclaude(?: code)?\b/i],
  ["codex", /\bcodex\b/i],
  ["copilot", /\bcopilot\b/i],
  ["cursor", /\bcursor\b/i],
  ["ce", /\bcompound engineering\b|\bce:plan\b|\bce plan\b/i],
];

const PLAN_HEADING_RE = /^(?:#{1,6}\s*)?(?:implementation\s+)?plan(?:\s+mode|\s+\d+|\s*[:\-].*)?$/i;
const CHECKBOX_RE = /^[-*]\s+\[(?: |x|X)\]\s+(.+)$/;
const BULLET_RE = /^[-*]\s+(.+)$/;
const NUMBERED_RE = /^\d+[.)]\s+(.+)$/;
const LABEL_RE = /^(?:step|task|phase|wave)\s+\d+\s*[:.)-]\s*(.+)$/i;
const VERIFY_LABEL_RE = /^(?:verification|validation|acceptance|test(?:s)?|oracle(?:s)?|check(?:s)?)\s*[:\-]\s*(.+)$/i;
const VERIFY_SECTION_RE = /^(?:#{1,6}\s*)?(?:verification|validation|acceptance(?:\s+criteria)?|test(?:s)?|oracle(?:s)?|check(?:s)?)(?:\s+targets?)?\s*:?\s*$/i;
const SECTION_HEADING_RE = /^(?:#{1,6}\s*)?[A-Za-z][A-Za-z0-9 /_-]{0,60}:?\s*$/;

function cleanLine(line) {
  return String(line ?? "").replace(/\r/g, "").replace(/^>\s?/, "").trim();
}

function stripDecoration(text) {
  return text.replace(/\*\*/g, "").replace(/`([^`]+)`/g, "$1").trim();
}

function detectSourceKind(text, explicitKind = "") {
  if (explicitKind) return explicitKind;
  for (const [kind, re] of KNOWN_HOSTS) {
    if (re.test(text)) return kind;
  }
  if (/<plan\b/i.test(text)) return "cursor";
  if (/^##\s+My request for Codex:/im.test(text)) return "codex";
  return "inline";
}

function extractCandidate(line) {
  const cleaned = stripDecoration(cleanLine(line));
  if (!cleaned) return "";
  for (const re of [CHECKBOX_RE, NUMBERED_RE, LABEL_RE, BULLET_RE]) {
    const match = cleaned.match(re);
    if (match?.[1]) return stripDecoration(match[1]);
  }
  return "";
}

function isPlanSignal(line) {
  const cleaned = cleanLine(line);
  return PLAN_HEADING_RE.test(cleaned) || /^#{1,6}\s+(steps|tasks|phases|waves)\b/i.test(cleaned);
}

function isVerificationSection(line) {
  return VERIFY_SECTION_RE.test(cleanLine(line));
}

function isSectionHeading(line) {
  const cleaned = cleanLine(line);
  return SECTION_HEADING_RE.test(cleaned) && !extractCandidate(cleaned);
}

function isNonAction(candidate) {
  return /^(?:plan|steps?|tasks?|todo|implementation|notes?|context|goal|requirements?)\s*:?$/i.test(candidate);
}

function splitVerification(candidate) {
  const match = candidate.match(VERIFY_LABEL_RE);
  return match ? stripDecoration(match[1]) : null;
}

function planNameFor(action, index) {
  const name = action.replace(/[.;]\s*$/, "");
  return name.length <= 72 ? name : `Plan ${index + 1}`;
}

export function normalizeInlinePlan(input = {}) {
  const text = String(input.text ?? "");
  if (!text.trim()) {
    throw new Error("plan intake: text is required");
  }

  const sourceKind = detectSourceKind(text, input.source_kind);
  const stage = String(input.stage ?? "outline").trim() || "outline";
  const lines = text.split("\n").map(cleanLine);
  const actions = [];
  const verificationTargets = [];
  let sawPlanSignal = false;
  let inVerificationSection = false;
  let inIgnoredSection = false;

  for (const line of lines) {
    if (!line) continue;
    if (isPlanSignal(line)) {
      sawPlanSignal = true;
      inVerificationSection = false;
      inIgnoredSection = false;
      continue;
    }
    if (isVerificationSection(line)) {
      inVerificationSection = true;
      inIgnoredSection = false;
      continue;
    }
    if (isSectionHeading(line)) {
      inVerificationSection = false;
      inIgnoredSection = true;
      continue;
    }
    if (inIgnoredSection) continue;
    const candidate = extractCandidate(line);
    if (!candidate || isNonAction(candidate)) continue;
    const verification = splitVerification(candidate);
    if (verification) {
      verificationTargets.push(verification);
      continue;
    }
    if (inVerificationSection) {
      verificationTargets.push(candidate);
      continue;
    }
    actions.push(candidate);
  }

  const uniqueActions = [...new Set(actions)].slice(0, 12);
  const uniqueVerification = [...new Set(verificationTargets)].slice(0, 12);
  const requiresVerificationTargets = uniqueActions.length > 0 && uniqueVerification.length === 0;
  const plans = uniqueActions.map((action, index) => ({
    name: planNameFor(action, index),
    scope: input.mission_title || "Imported inline plan",
    inputs: [`plan_intake:${sourceKind}`],
    actions: [action],
    verification_targets: uniqueVerification,
    dependencies: [],
    wave: index + 1,
  }));

  return {
    source_kind: sourceKind,
    stage,
    confidence: sawPlanSignal || plans.length > 0 ? "medium" : "low",
    requires_verification_targets: requiresVerificationTargets,
    plans,
    brief_patch: {
      constraints: [`Imported inline plan source: ${sourceKind}`],
      assumptions: [
        "Inline plan normalization preserves task intent, not host-specific prose or UI chrome.",
      ],
      success_criteria: uniqueVerification.length ? uniqueVerification : [],
    },
    warnings: [
      ...(plans.length ? [] : ["No obvious plan steps were detected; use roi:clarify before plan_generate."]),
      ...(requiresVerificationTargets
        ? ["No verification targets were detected; roi:outline must add runnable verification_targets before plan_generate."]
        : []),
    ],
  };
}
