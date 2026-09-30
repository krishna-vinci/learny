// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Generic confirm dialog used for reversible destructive actions (revoke session, delete
// token, archive a member). For the one irreversible action (purge a user's data), pass
// `typedConfirmValue` to require the admin to type it back before the confirm button enables.
import { type ReactNode, useEffect, useState } from "react";
import { Button, type ButtonVariant } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Extra content shown under the description (e.g. a list of affected paths). */
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: ButtonVariant;
  /** When set, the confirm button stays disabled until the admin types this value back. */
  typedConfirmValue?: string;
  onConfirm: () => void | Promise<void>;
}

function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmVariant = "default",
  typedConfirmValue,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  }

  const locked = typedConfirmValue !== undefined && typed !== typedConfirmValue;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {typedConfirmValue !== undefined && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm-typed-value">
              Type <span className="font-mono font-semibold">{typedConfirmValue}</span> to confirm
            </Label>
            <Input
              id="confirm-typed-value"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" className="h-11 sm:h-8" onClick={() => onOpenChange(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={confirmVariant}
            className="h-11 sm:h-8"
            onClick={() => void handleConfirm()}
            disabled={pending || locked}
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default ConfirmDialog;
