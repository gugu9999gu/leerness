# Harness authoring language

Choose the language for new harness prose independently of the language used
to explain results to the user:

```sh
leerness init . --language ko --authoring-language en
leerness migrate . --authoring-language en
```

`--authoring-language` accepts `en`, `ko`, or `inherit`. It is an installation
option for `init` and `migrate`, not `migrate audit|apply|plan` or other commands.
An omitted option preserves the saved choice. `inherit` removes the override:

```sh
leerness migrate . --authoring-language inherit
```

The existing `.leerness/manifest.json` holds the optional `authoringLanguage`
field. Absent means inherit. The existing `language` field and `LANGUAGE` file
keep their project/user language meaning. No second settings file is created.
Ordinary installation and updates never opt an existing Korean project into
English. Mode changes and project adapter regeneration retain the saved choice.

The choice selects the available core templates and adds guidance to AGENTS.md,
CLAUDE.md and, when installed, language-policy.md. It also reaches handoff and
the existing delegation brief. Minimal installs retain the guidance in their
agent instructions even when language-policy.md is omitted. `status --json`
and `handoff --json` expose `authoringPolicy` with the selection, effective
language, project language and whether it was explicitly selected.

Existing authored state, custom instructions, quoted source, identifiers and
evidence are preserved under the existing merge rules. Changing the selection
subtracts the previous generated policy before merging custom instructions, so
opposite-language guidance does not accumulate. Session-close generated empty
state and next-step placeholders use the effective authoring language; original
task rows and evidence keep their original text. Its existing handoff replacement
policy is unchanged: do not use this option to preserve arbitrary notes in a
generated handoff body.

Delegation still respects `--raw` and the `delegation-brief` toggle. The original
task text is unchanged. User-facing explanations should follow the user's
requested language, falling back to the project language. A provider receives
instructions, not a language enforcement mechanism.

## Limits and verification

English template coverage is partial. This option does not translate history,
repair damaged characters, prove that a model obeyed instructions, or promise
that every legacy CLI message, generated document or interactive agent route is
English. Byte-preservation checks remain separate; see
[managed text storage](managed-text-storage.md).

Malformed, duplicate or unsupported CLI options fail before installation.
The manifest is read as bounded UTF-8 (64 KiB). Invalid bytes, unsafe targets and
oversized input stop selection instead of silently choosing a language. A bad
saved selection can be replaced explicitly with `en`, `ko` or `inherit`. The
installer retains its existing recovery policy for malformed JSON/non-object
manifests, reports the recovery, and regenerates default metadata; it cannot
recover unreadable historical settings. This is not a transaction across all
installation files or protection against every concurrent edit.

Run `npm run test:authoring-language` for isolated real CLI tests and delegated
brief capture. These tests do not invoke models, change a global installation,
or modify the user's projects. A subset can be selected with
`node scripts/authoring-language-probe.js --match <text>`.
