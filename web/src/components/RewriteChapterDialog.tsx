import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

export function RewriteChapterDialog({
  set,
  path,
  open,
  onOpenChange,
}: {
  set: string;
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rewrite in teaching voice?"
      description="Keeps facts and sources; you can undo the rewrite from History."
      confirmLabel="Rewrite"
      onConfirm={async () => {
        try {
          await api.jobs.create({ kind: "rewrite-chapter", set, path });
          await queryClient.invalidateQueries({ queryKey: ["jobs"] });
        } catch (error) {
          toast.error(friendlyMessage(error, "Couldn't start the rewrite. Try again."));
        }
      }}
    />
  );
}
