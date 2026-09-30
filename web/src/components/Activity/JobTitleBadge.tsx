import { useEffect, useState } from "react";
import { useJobs } from "@/api/queries";
import { isActiveJob } from "@/lib/job-transitions";

// A6: while jobs are queued or running, prefix the tab title with "(n) " so a backgrounded
// tab shows activity at a glance. The base title is captured once — stripping any stale
// badge from a previous mount — so count changes never compound prefixes.
export function JobTitleBadge() {
  const { data: jobs = [] } = useJobs();
  const runningCount = jobs.filter(isActiveJob).length;
  const [baseTitle] = useState(() => document.title.replace(/^\(\d+\)\s+/, ""));

  useEffect(() => {
    document.title = runningCount > 0 ? `(${runningCount}) ${baseTitle}` : baseTitle;
  }, [runningCount, baseTitle]);

  return null;
}

export default JobTitleBadge;
