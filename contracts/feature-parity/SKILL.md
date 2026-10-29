---
name: feature-parity
description: The canonical list of what the product does, and which clients do it. Read before shipping a feature on any platform, before deciding a client is finished, and whenever something exists on the web that does not exist elsewhere.
---

# Feature parity

The physics contracts make every client compute the same numbers. This one
makes them *do the same things*. A client that is numerically perfect and
missing half the product is still the wrong product.

**The rule: a feature that exists on one platform is specified here and
tracked on all of them.** Shipping something on the web and not recording
it is the failure this contract exists to prevent, because the gap is
invisible from inside the web codebase.

## The manifest

`contracts/features.json` is the source of truth, not a table in a readme.
It is machine-readable so any client can read it and so a gate can check
it, and because a hand-maintained table drifts the moment someone is in a
hurry.

Every feature declares a status for every platform:

| Status | Meaning |
|---|---|
| `shipped` | Implemented and working. Must name the files. |
| `partial` | Partly implemented. Must say what is missing. |
| `planned` | Specified, not built here yet. |
| `n/a` | Deliberately not applicable. Must say why. |

`website/src/feature-parity.test.ts` enforces the structure: every feature
covers every platform, statuses come from the vocabulary, anything
`shipped` or `partial` names paths **that actually exist**, and anything
`partial` or `n/a` explains itself. A path that is deleted or renamed
turns the build red, so a feature cannot quietly stop existing.

The gate prints the parity table on every run, so the gap between web and
the rest is in front of whoever is working rather than in a document
nobody opens.

## What this does and does not require

It does **not** require every platform to have every feature. A phone is
not a television and neither is a browser, and `n/a` is a legitimate
answer when it carries a reason.

It **does** require that the difference is deliberate, written down, and
visible. "Nobody noticed iOS had no moons" is the outcome being prevented.

## Adding a feature

1. Add it to `contracts/features.json` **first**, with its status on every
   platform. For a platform that will not have it yet, that is `planned`.
2. Build it.
3. Set that platform's status to `shipped` and name the files.
4. Leave the other platforms at `planned`. That entry is now the record
   that they owe it.

## Removing or renaming a file

The gate checks declared paths exist. If a refactor moves a file, update
the manifest in the same change. That is not busywork: it is the only
thing keeping the manifest from becoming fiction.

## What a new client must provide

- An entry under its platform key for **every** feature in the manifest,
  with no blanks.
- A reason on every `partial` and every `n/a`.
- Real paths on everything it claims to have shipped.
- Honesty about `partial`. A feature that renders but does not work is
  partial, not shipped.
