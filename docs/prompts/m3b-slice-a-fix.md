Follow-up on Slice A. The orchestrator verified it with real models: two drafts ran in the background, the placeholders, indicator and toasts worked, and Open landed on the new note. Fix two issues found at 390px:

1. **The activity panel stays open across navigation.** On the phone, after tapping a toast's **Open** (or any link), the bottom sheet is still open over the new page. Close the panel on every route change (`useLocation`) and when a toast action navigates. The phone sheet must also close on Escape and on a backdrop tap.
2. **The panel is cluttered with old history.** It lists yesterday's failed "Cards for …" jobs loaded from the job log. Show:
   - all queued and running jobs
   - jobs that finished during this browser session
   - otherwise, jobs finished in the last 2 hours
   Older ones only appear on the Jobs page, behind the existing "View all jobs" link. Put the filter in `web/src/lib/job-transitions.ts` (or a sibling) with a unit test.

Then run tsc, biome on changed files, the related vitest files, and the web build. Web only; don't commit. Report changed files and test results.
