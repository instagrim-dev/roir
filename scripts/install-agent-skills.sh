#!/usr/bin/env bash
# shellcheck disable=SC2016
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: install-agent-skills.sh <target> [options]

Install or link ROI reference skills and (optionally) Cursor slash-command stubs
so hosts other than a bundled Claude Code plugin can load the same flows as
`docs/roi/invocation-skills-and-mcp.md` describes.

Targets
  claude-user       Symlink or copy each skills/* into ~/.claude/skills/
  claude-project    Symlink or copy into ./.claude/skills/ inside the project root
                    (use --dest DIR to override)
  cursor-user       Symlink or copy skills into ~/.cursor/rules/ as .mdc files
  codex             Register roi as a local Codex marketplace plugin in ~/.local/share/roi
                    and enable it in ~/.codex/config.toml (surfaces $roi-drive etc.)
  copilot           Register roi as a Copilot plugin in ~/.copilot/installed-plugins/roi-plugin
                    and enable it in ~/.copilot/settings.json (surfaces $roi-drive etc.)

Options
  -n, --dry-run     Print actions; do not write
  -f, --force       Replace existing files/symlink targets
      --copy        Use cp -R (default: symlink, best for dev when checkout moves)
      --dest DIR    Override destination root (claude-project default: .claude/skills)

Examples
  ./scripts/install-agent-skills.sh claude-user --dry-run
  ./scripts/install-agent-skills.sh claude-user
  ./scripts/install-agent-skills.sh claude-project
  ./scripts/install-agent-skills.sh codex
  ./scripts/install-agent-skills.sh copilot
EOF
}

DRY_RUN=0
MODE=symlink
FORCE=0
DEST_OVERRIDE=""

log() { printf '%s\n' "$*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
ROI_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SKILLS_DIR="$ROI_DIR/skills"

TARGET=""

while [[ $# -gt 0 ]]; do
  case "$1" in
  -h|--help)
    usage
    exit 0
    ;;
  -n|--dry-run) DRY_RUN=1 ;;
  -f|--force) FORCE=1 ;;
  --copy) MODE=copy ;;
  --dest)
    if [[ $# -lt 2 ]]; then
      log "Error: --dest needs a value"
      exit 2
    fi
    DEST_OVERRIDE="$2"
    shift
    ;;
  -*) log "Unknown option: $1"; usage; exit 2 ;;
  *)
    if [[ -z "$TARGET" ]]; then
      TARGET="$1"
    else
      log "Unexpected: $1"
      exit 2
    fi
    ;;
  esac
  shift
done

if [[ -z "$TARGET" ]]; then
  log "Error: target required"
  usage
  exit 2
fi

do_link_or_copy() {
  local src="$1" dest_dir="$2" name="$3"
  local dest="$dest_dir/$name"
  if [[ ! -e "$src" ]]; then
    log "Error: missing source: $src"
    exit 1
  fi
  mkdir -p "$dest_dir"
  if [[ -L "$dest" || -e "$dest" ]]; then
    if [[ "$FORCE" -ne 1 ]]; then
      log "Skip (exists, use --force): $dest"
      return 0
    fi
    rm -rf "$dest"
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ "$MODE" == "symlink" ]]; then
      log "ln -sfn $(cd "$(dirname "$src")" && pwd)/$(basename "$src") $dest"
    else
      log "cp -R $src $dest"
    fi
    return 0
  fi
  if [[ "$MODE" == "symlink" ]]; then
    ln -sfn "$(cd "$(dirname "$src")" && pwd)/$(basename "$src")" "$dest"
  else
    cp -R "$src" "$dest"
  fi
  log "Installed: $name -> $dest"
}

install_claude_dir() {
  local dest_root=$1
  for d in "$SKILLS_DIR"/*/; do
    [[ -d "$d" ]] || continue
    name="$(basename "$d")"
    if [[ -z "$name" || "$name" == ".*" ]]; then
      continue
    fi
    do_link_or_copy "$d" "$dest_root" "$name"
  done
}

case "$TARGET" in
claude-user)
  dest_root="${HOME:-}/.claude/skills"
  if [[ -z "$HOME" ]]; then
    log "Error: HOME is unset; cannot use claude-user"
    exit 1
  fi
  log "Installing skills into: $dest_root (mode=$MODE)"
  install_claude_dir "$dest_root"
  ;;

claude-project)
  dest_root="${DEST_OVERRIDE:-"$ROI_DIR/.claude/skills"}"
  if [[ -n "$DEST_OVERRIDE" ]]; then
    dest_root="$(cd "$dest_root" && pwd)"
  fi
  log "Installing skills into: $dest_root (mode=$MODE)"
  install_claude_dir "$dest_root"
  ;;

cursor-user)
  if [[ -z "$HOME" ]]; then
    log "Error: HOME is unset; cannot use cursor-user"
    exit 1
  fi
  dest_dir="${HOME}/.cursor/rules"
  mkdir -p "$dest_dir"
  # Install the roi-commands.mdc rule into ~/.cursor/rules/
  src_rule="$ROI_DIR/.cursor/rules/roi-commands.mdc"
  if [[ ! -f "$src_rule" ]]; then
    log "Warning: $src_rule not found; skipping Cursor rule install"
  else
    dest="$dest_dir/roi-commands.mdc"
    if [[ -L "$dest" || -e "$dest" ]]; then
      if [[ "$FORCE" -ne 1 ]]; then
        log "Skip (exists, use --force): $dest"
      else
        rm -f "$dest"
        if [[ "$DRY_RUN" -eq 0 ]]; then
          ln -sfn "$src_rule" "$dest"
          log "Installed: roi-commands.mdc -> $dest"
        else
          log "ln -sfn $src_rule $dest"
        fi
      fi
    else
      if [[ "$DRY_RUN" -eq 0 ]]; then
        ln -sfn "$src_rule" "$dest"
        log "Installed: roi-commands.mdc -> $dest"
      else
        log "ln -sfn $src_rule $dest"
      fi
    fi
  fi
  log "Cursor rules: $dest_dir (roi command vocabulary injected into system prompt)"
  ;;

codex)
  if [[ -z "$HOME" ]]; then
    log "Error: HOME is unset; cannot use codex"
    exit 1
  fi
  MARKETPLACE_ROOT="${HOME}/.local/share/roi"
  PLUGIN_DIR="$MARKETPLACE_ROOT/plugins/roi"
  CODEX_CFG="${HOME}/.codex/config.toml"

  if [[ ! -f "$CODEX_CFG" ]]; then
    log "Error: ~/.codex/config.toml not found; run 'codex' once first"
    exit 1
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$PLUGIN_DIR/.codex-plugin" "$PLUGIN_DIR/skills"
    mkdir -p "$MARKETPLACE_ROOT/.agents/plugins"
    cat > "$PLUGIN_DIR/.codex-plugin/plugin.json" <<PLUGIN_JSON
{
  "name": "roi",
  "version": "0.1.0",
  "description": "ROI: Reusable Operational Intelligence — roi:drive, roi:go, and the full mission lifecycle.",
  "skills": "./skills/",
  "interface": {
    "displayName": "ROI",
    "shortDescription": "Mission-driven workflow: roi:drive, roi:go, roi:work, roi:cancel, and more.",
    "category": "Coding",
    "capabilities": ["Interactive", "Read", "Write"]
  }
}
PLUGIN_JSON
    # marketplace.json is required for the Codex desktop app to discover the plugin
    cat > "$MARKETPLACE_ROOT/.agents/plugins/marketplace.json" <<MARKETPLACE_JSON
{
  "name": "roi-plugin",
  "interface": {
    "displayName": "ROI"
  },
  "plugins": [
    {
      "name": "roi",
      "source": {
        "source": "local",
        "path": "./plugins/roi"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Coding"
    }
  ]
}
MARKETPLACE_JSON
    log "Created $MARKETPLACE_ROOT/.agents/plugins/marketplace.json"
    for d in "$SKILLS_DIR"/*/; do
      [[ -d "$d" ]] || continue
      name="$(basename "$d")"
      dest="$PLUGIN_DIR/skills/$name"
      [[ -L "$dest" ]] && rm "$dest"
      ln -sfn "$SKILLS_DIR/$name" "$dest"
      log "Linked skill: $name"
    done

    # Register marketplace in ~/.codex/config.toml if not present
    if ! grep -q '\[marketplaces\.roi-plugin\]' "$CODEX_CFG"; then
      printf '\n[marketplaces.roi-plugin]\nlast_updated = "%s"\nsource_type = "local"\nsource = "%s"\n' \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MARKETPLACE_ROOT" >> "$CODEX_CFG"
      log "Added [marketplaces.roi-plugin] to $CODEX_CFG"
    else
      log "Marketplace entry already present in $CODEX_CFG"
    fi

    # Enable the plugin entry if not present
    if ! grep -q '\[plugins\."roi@roi-plugin"\]' "$CODEX_CFG"; then
      printf '\n[plugins."roi@roi-plugin"]\nenabled = true\n' >> "$CODEX_CFG"
      log "Added [plugins.\"roi@roi-plugin\"] to $CODEX_CFG"
    else
      log "Plugin enable entry already present in $CODEX_CFG"
    fi
    log "Codex: roi plugin registered."
    log "  Next: open Codex app → Settings → Plugins → find ROI → click Install"
    log "  Then restart Codex to pick up \$roi-drive, \$roi-go in the skill picker."
  else
    log "DRY-RUN: would create $PLUGIN_DIR/.codex-plugin/plugin.json"
    log "DRY-RUN: would create $MARKETPLACE_ROOT/.agents/plugins/marketplace.json"
    log "DRY-RUN: would symlink skills into $PLUGIN_DIR/skills/"
    log "DRY-RUN: would append marketplace + plugin entries to $CODEX_CFG"
  fi
  ;;

copilot)
  if [[ -z "$HOME" ]]; then
    log "Error: HOME is unset; cannot use copilot"
    exit 1
  fi
  PLUGIN_ROOT="${HOME}/.copilot/installed-plugins/roi-plugin/roi"
  SETTINGS="${HOME}/.copilot/settings.json"

  if [[ ! -f "$SETTINGS" ]]; then
    log "Error: ~/.copilot/settings.json not found; run 'gh copilot' once first"
    exit 1
  fi

  if [[ "$DRY_RUN" -eq 0 ]]; then
    mkdir -p "$PLUGIN_ROOT/skills"
    for d in "$SKILLS_DIR"/*/; do
      [[ -d "$d" ]] || continue
      name="$(basename "$d")"
      dest="$PLUGIN_ROOT/skills/$name"
      [[ -L "$dest" ]] && rm "$dest"
      ln -sfn "$SKILLS_DIR/$name" "$dest"
      log "Linked skill: $name"
    done

    python3 - "$SETTINGS" "$PLUGIN_ROOT" <<'PYEOF'
import json, sys, pathlib
settings_path = pathlib.Path(sys.argv[1])
plugin_root = sys.argv[2]
with open(settings_path) as f:
    s = json.load(f)
s.setdefault("extraKnownMarketplaces", {})["roi-plugin"] = {
    "source": {"source": "local", "path": str(pathlib.Path(plugin_root).parent.parent)}
}
s.setdefault("enabledPlugins", {})["roi@roi-plugin"] = True
with open(settings_path, "w") as f:
    json.dump(s, f, indent=4)
    f.write("\n")
print("Updated", settings_path)
PYEOF
    log "Copilot: roi plugin registered. Restart gh copilot to pick up \$roi-drive, \$roi-go."
  else
    log "DRY-RUN: would symlink skills into $PLUGIN_ROOT/skills/"
    log "DRY-RUN: would update $SETTINGS extraKnownMarketplaces + enabledPlugins"
  fi
  ;;

*)
  log "Unknown target: $TARGET"
  usage
  exit 2
  ;;

esac
