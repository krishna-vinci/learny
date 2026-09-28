// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Upstream's footer holds locale + theme selects; this app has no i18n and no theme
// switcher yet, so it is a minimal static line.
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

const AuthFooter = ({ className }: Props) => {
  return (
    <div className={cn("mx-auto mt-4 w-full max-w-xs text-center text-xs text-muted-foreground", className)}>
      Self-hosted with Studium
    </div>
  );
};

export default AuthFooter;
