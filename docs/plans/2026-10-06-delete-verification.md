# Recoverable deletion verification

Implemented on `codex/delete` in `/home/krishna/learny-worktrees/delete`. No commit, push, merge, deployment, new dependencies, model calls or Anki writes were performed. All filesystem tests and browser flows used temporary study trees.

Learners can delete notes from the reader or set page and undo through an eight-second toast. Linked-data deletion requires a short confirmation; the curriculum row stays by default, with an option to remove it. Chapter matching uses the current id/title/slug rules. A remaining matching note keeps the chapter available; otherwise the chapter becomes planned again. Set deletion requires its exact displayed name. Settings → Recently deleted offers note and set restoration from git history.

Deletion snapshots fresh or externally edited affected files before removing them, then appends a user-authored deletion commit. Restore appends a git revert. Set-exclusive coordination waits for existing file writers, prevents late writes from reviving deleted sets, and refuses deletion while set jobs or tutor replies are active. Preview tokens detect changes between review and deletion. Restore rejects recreated targets and staged edits rather than overwriting new work.

## API

All paths below are relative to `/api/sets` and use the authenticated user's tree.

| Method and path | Behavior |
| --- | --- |
| `GET /:set/deletion?path=notes/example.md` | Preview note deletion and linked-data counts; omit `path` for a set preview. |
| `DELETE /:set/notes` | Delete `{path, token, removeFromPlan?, linkedDataConfirmed?}`. |
| `DELETE /:set` | Delete `{token, confirmation}` after exact set-name confirmation. |
| `GET /recently-deleted` | List unrestored app deletion commits. |
| `POST /:set/restore` | Restore `{sha}` through git revert. |

## Linked-data policies and limitations

- Associated card files and note highlights are deleted. Exported-card markers are counted and the UI explains how to remove those notes in Anki; Anki is never contacted.
- Exclusively referenced media is deleted, including indirect artifact images, visual posters and associated asset credits. Media reachable from surviving documents is kept. Reference detection is conservative: references in examples can retain extra files.
- Chapter media briefs, including briefs left at an earlier chapter number, are cleaned through the tree deletion layer. The concurrent agent's `tree/media-brief.ts`, `jobs/media-plan.ts` and `ingest/figures.ts` were not edited.
- Practice history remains as readable orphan records after note deletion. Tests cover summary, quiz and problem views. Deleting a whole set removes its nonignored practice files along with the set.
- Gitignored files, including originals/chats and already tracked files subsequently ignored, remain on disk after set deletion and are disclosed in the confirmation. They are never added to deletion snapshots. The set disappears from the app because its `PLAN.md` is removed.
- Symlinks anywhere inside the selected set cause deletion to be refused, including unrelated symlinks. This intentionally conservative policy prevents alias or escape deletion. Reserved roots, traversal, other sets and other users' trees are rejected.
- Recently deleted lists app-created deletion commits. Restore conflicts remain visible and actionable. Restore the containing set before restoring a previously deleted note within it.
- Browser verification used Chromium with isolated fixture authentication and real pointer input. Safari/WebKit and a production login were not exercised; per-user isolation is covered by workspace tests.
- The web build emits the existing Vite large-chunk advisory. No implementation blockers remain.

## Changed files

- `server/src/tree/deletion.ts`: confined preview, linked cleanup, transactional deletion, history listing and revert restoration.
- `server/src/tree/deletion-media.ts`: conservative reference graph for exclusive media ownership.
- `server/src/tree/deletion.test.ts`: 18 focused deletion, recovery, confinement, linked-data and failure tests.
- `server/src/tree/lock.ts`: exclusive set mutation barrier, nested file-lock support and deleted-set guards.
- `server/src/tree/lock.test.ts`: contention, late-writer and restored-lock checks.
- `server/src/tree/git.ts`: coordinated git primitives and literal scoped pathspecs.
- `server/src/tree/authoring.ts`: recreate the notes directory when authoring in a restored empty set.
- `server/src/routes/sets.ts`: preview, note/set delete, history and restore endpoints with commit events and error handling.
- `server/src/routes/sets.test.ts`: route round trips, confirmation, history, busy refusal and attack tests.
- `server/src/app.ts`: connect active-task checks and mutation error responses.
- `server/src/jobs/runner.ts`: reject jobs during set deletion and expose complete active-set checks.
- `server/src/jobs/runner.test.ts`: mutation guards and active jobs beyond the display limit.
- `server/src/agent/chat-service.ts`: expose active set replies and reject starts during exclusive mutation.
- `server/src/workspaces/manager.ts`: provide file locks to each workspace job runner.
- `server/src/workspaces/manager.test.ts`: verify user-isolated deletion/history/restore and seed the existing job fixture's set.
- `server/scripts/delete-browser.ts`: repeatable real-click browser checks against temporary trees at both requested sizes.
- `shared/src/deletion.ts`: shared preview, result and history interfaces.
- `shared/src/index.ts`: export deletion interfaces.
- `web/src/api/client.ts`: typed deletion and recovery client calls.
- `web/src/api/queries.ts`: history query key and commit-driven cache refresh.
- `web/src/components/ConfirmDialog.tsx`: keep confirmations open when an action reports an actionable failure.
- `web/src/components/Deletion.tsx`: note deletion menus, linked confirmation, typed set confirmation, undo and recovery hooks.
- `web/src/components/Deletion.test.tsx`: four confirmation, undo, export-notice and error-handling tests.
- `web/src/components/Reader/Reader.tsx`: reader deletion controls and persistent confirmation dialog.
- `web/src/components/Settings/RecentlyDeletedSection.tsx`: recoverable history list and Restore/Open controls.
- `web/src/components/Settings/RecentlyDeletedSection.test.tsx`: history/restore/open/empty-state coverage.
- `web/src/components/Settings/settingSections.ts`: register Recently deleted in settings.
- `web/src/pages/SetHomePage.tsx`: note row deletion and set deletion controls.
- `web/src/pages/SetHomePage.test.tsx`: supply query context for the new controls.
- `docs/plans/2026-10-06-delete.md`: completed implementation checklist.
- `docs/plans/2026-10-06-delete-verification.md`: this report and owner-memory handoff.

## Tests run

Final results after the last code change:

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile --prefer-offline` | Passed; frozen lockfile unchanged. |
| `pnpm --filter @studium/server exec vitest run src/tree/ src/routes/sets.test.ts src/jobs/runner.test.ts src/agent/chat-service.test.ts src/workspaces/manager.test.ts src/app.test.ts src/practice/store.test.ts` | 197 passed, 0 failed across 18 files; includes the whole tree test directory. |
| `pnpm --filter @studium/web exec vitest run src/components/Deletion.test.tsx src/components/Settings/RecentlyDeletedSection.test.tsx src/pages/SetHomePage.test.tsx src/components/Reader/Reader.test.tsx src/api/queries.test.tsx src/api/client.test.ts` | 60 passed, 0 failed across 6 files. |
| `pnpm --filter @studium/server exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/web exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/shared exec tsc --noEmit` | Passed. |
| `pnpm --filter @studium/web build` | Passed, including PWA generation. |
| `pnpm --filter @studium/server exec tsx scripts/delete-browser.ts` | 8 flows passed, 0 page errors; no horizontal overflow. |
| `git diff --check` | Passed. |

Biome checked all 29 changed TypeScript/TSX files, with 0 errors and 0 warnings:

```sh
rtk proxy pnpm exec biome check server/scripts/delete-browser.ts server/src/agent/chat-service.ts server/src/app.ts server/src/jobs/runner.ts server/src/jobs/runner.test.ts server/src/routes/sets.ts server/src/routes/sets.test.ts server/src/tree/authoring.ts server/src/tree/git.ts server/src/tree/lock.ts server/src/tree/lock.test.ts server/src/tree/deletion.ts server/src/tree/deletion-media.ts server/src/tree/deletion.test.ts server/src/workspaces/manager.ts server/src/workspaces/manager.test.ts shared/src/index.ts shared/src/deletion.ts web/src/api/client.ts web/src/api/queries.ts web/src/components/ConfirmDialog.tsx web/src/components/Reader/Reader.tsx web/src/components/Deletion.tsx web/src/components/Deletion.test.tsx web/src/components/Settings/settingSections.ts web/src/components/Settings/RecentlyDeletedSection.tsx web/src/components/Settings/RecentlyDeletedSection.test.tsx web/src/pages/SetHomePage.tsx web/src/pages/SetHomePage.test.tsx
```

During implementation, a focused media test caught an HTML reference parser missing an artifact image; the parser was corrected before the final passing runs. Browser harness startup races were also corrected. No unrelated failures were left unresolved and no full repository suite was run.

At each of 390×844 and 1440×900, real pointer clicks verified reader linked-chapter delete/Undo, set-page immediate note delete/Undo, typed set delete/Recently deleted restore, and note restore from Recently deleted. Restoration checked original bytes. Final browser output and screenshots are under `/tmp/studium-delete-browser-ijb3Yu/`:

- [Browser results](/tmp/studium-delete-browser-ijb3Yu/results.json)
- [Phone set confirmation](/tmp/studium-delete-browser-ijb3Yu/390-set-delete-confirm.png)
- [Phone Recently deleted](/tmp/studium-delete-browser-ijb3Yu/390-recently-deleted.png)
- [Desktop chapter confirmation](/tmp/studium-delete-browser-ijb3Yu/1440-note-delete-confirm.png)
- [Desktop restored set](/tmp/studium-delete-browser-ijb3Yu/1440-set-restored.png)

## Five-line owner-memory log

2026-10-06 · codex/delete: added recoverable note/chapter/set deletion, Undo and Settings → Recently deleted.
Tree deletion uses confined paths, set/file locks, scoped user commits, stale previews and git-revert restoration.
Chapter identity follows id/title/slug; curriculum stays by default; derived cards, highlights and exclusive media/briefs are cleaned.
Gotchas: ignored files stay on disk; exported Anki notes stay in Anki; practice history stays readable; recreated targets block restore.
Validation: 197 server + 60 web tests, three type checks, web build, 29-file Biome and eight Chromium flows passed; no commit/push.
