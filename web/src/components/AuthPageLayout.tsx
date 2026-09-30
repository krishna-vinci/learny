// Adapted from Memos (MIT) — https://github.com/usememos/memos
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import AuthFooter from "./AuthFooter";

interface Props {
  title: string;
  subtitle?: string;
  /** A small badge shown above the title, e.g. AdminSignIn's "Admin" chip. */
  chip?: ReactNode;
  children: ReactNode;
}

export function AuthChip({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <Badge variant="accent" caps className={className}>
      {children}
    </Badge>
  );
}

const AuthPageLayout = ({ title, subtitle, chip, children }: Props) => {
  return (
    <div className="min-h-svh w-full flex flex-col items-center px-4 py-4 sm:py-8">
      <div className="w-full grow flex flex-col justify-center items-center">
        <div className="w-90 max-w-full rounded-xl border border-border bg-card p-7 shadow-sm">
          <div className="mb-6 flex items-center gap-2">
            <span className="text-sm font-semibold text-foreground">Studium</span>
          </div>
          {chip && <div className="mb-2">{chip}</div>}
          <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6 w-full">{children}</div>
        </div>
      </div>
      <AuthFooter />
    </div>
  );
};

export default AuthPageLayout;
