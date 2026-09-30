import { toast } from "@/lib/notify";
import { openActivityPanel } from "./activity-store";

/** A1: the shared "the job is now backgrounded" affordance shown by every start point. */
export function showJobStartedToast(title: string, verb = "Drafting"): void {
  toast.success(`${verb} "${title}"…`, { action: { label: "View", onClick: () => openActivityPanel() } });
}
