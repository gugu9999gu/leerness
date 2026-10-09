# SessionStart hooks

Use a matcher group containing typed command handlers:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "leerness update --check --quiet" }
        ]
      }
    ]
  }
}
```

`*`, an empty matcher, or no matcher means every SessionStart event. A literal
`\*` is not a valid JSON escape. `--check` only checks for updates; `--quiet`
suppresses ordinary up-to-date/unknown output. Neither flag installs a package.

Leerness's `auto-update install <project>` manages **Claude Code** settings in
`.claude/settings.local.json`. Versions before 1.36.225 generated flat
`{matcher, command}` entries and failed to recognize nested handlers. Run the
fixed installer to repair those entries. It preserves custom handler options,
unrelated handlers, matcher groups, permissions, and malformed source files.
`auto-update status <project> --json` checks that same Claude file; it is not a
Codex trust or runtime health check.

Codex loads hooks from `.codex/hooks.json`, inline config, or plugins. This
installer does not copy hooks into Codex or approve their trust. Review the hook
in the host after changing its definition. Do not reset trust hashes in config
to hide an error.

If Codex shows an issue, distinguish configuration parsing, trust, executable
lookup, process exit, and timeout. Record the exact issue and hook source file.
Check `Get-Command leerness -All` on Windows and run `leerness --version` and
`leerness update --check` in the same environment and working directory. A
terminal success does not prove the desktop hook's PATH or shell is identical.
Use the host's documented Windows command override with verified absolute paths
when lookup is the diagnosed cause; do not assume another project's installation
or use automatic npm installation as a startup hook.

References checked 2026-09-15:
[Codex hooks](https://learn.chatgpt.com/docs/hooks) and
[Claude Code hooks](https://code.claude.com/docs/en/hooks).
