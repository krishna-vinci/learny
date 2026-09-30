import { toast } from "react-hot-toast";
import { openActivityPanel } from "./activity-store";

/** A1: the shared "the job is now backgrounded" affordance shown by every start point. */
export function showJobStartedToast(title: string, verb = "Drafting"): void {
  const toastId = toast.success(
    <span className="flex min-w-0 items-center gap-2">
      <span className="min-w-0">
        {verb} "{title}"…
      </span>
      <button
        type="button"
        className="min-h-11 shrink-0 text-primary underline underline-offset-2 md:min-h-0"
        onClick={() => {
          toast.dismiss(toastId);
          openActivityPanel();
        }}
      >
        View
      </button>
    </span>,
    { duration: 8000 },
  );
}
