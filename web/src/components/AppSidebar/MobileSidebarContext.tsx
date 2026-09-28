// Local, dependency-free stand-in for Memos' AppSidebarContext (mobile-open state only;
// this app has no memo editor, tags, or views to track alongside it).
import { createContext, useContext, useState } from "react";

interface MobileSidebarContextValue {
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
}

const MobileSidebarContext = createContext<MobileSidebarContextValue | null>(null);

export function MobileSidebarProvider({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <MobileSidebarContext.Provider value={{ mobileOpen, setMobileOpen }}>{children}</MobileSidebarContext.Provider>
  );
}

export function useMobileSidebar() {
  const ctx = useContext(MobileSidebarContext);
  if (!ctx) throw new Error("useMobileSidebar must be used inside <MobileSidebarProvider>");
  return ctx;
}
