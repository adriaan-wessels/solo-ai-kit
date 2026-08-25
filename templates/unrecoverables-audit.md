# The unrecoverables audit: checklist template

An unrecoverable is an artifact with no recovery path: a signing key,
an encryption key, the only copy of user data. Almost everything else
in this operating model fails toward a rollback. These fail toward
permanent loss, so they get their own periodic audit. Run it every few
months (the periodic process review is a natural anchor) and file every
gap to the tracker.

Evidence for the cost-benefit: one day of this audit on a mature,
heavily reviewed project found four real gaps of exactly this class: a
keystore escrow nobody had ever proven; a migration path that could
corrupt data before its backup ran; a restore that had never been tried
on real data; and a deletion list one table short.

## The checklist

1. **List every unrecoverable, and prove each escrow BY USE.** Signing
   keys, encryption keys, the only copy of user data. For each one,
   prove the recovery path by using it: fetch the escrowed copy and
   exercise it once. An escrow you have never used is an assumption,
   not a backup.
2. **Drill a real restore.** Against real data, with the real key, not
   a test fixture. A restore path that has only ever seen fixtures is
   untested where it matters.
3. **Diff the deletion list against the live schema, mechanically.** If
   the product deletes user data, enumerate the tables the deletion
   touches and diff that list against the live schema by script, not by
   eye. A table added after the deletion code shipped is how "delete my
   account" quietly stops being true.
4. **Feed corrupted bytes to every parser that reads untrusted input.**
   Backups, imports, sync payloads. Each parser must fail clean and
   report, never corrupt state downstream.

## Filing

File each gap as its own issue, with a priority from the milestone-exit
question (kit README, principles). A gap in this class is rarely P3:
the failure it hides is the kind no later fix can undo.
