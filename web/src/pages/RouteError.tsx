// Friendly replacement for React Router's default "Unexpected Application Error" screen
// (docs/UX.md: plain words, one clear next step).
import { Link, useRouteError } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function RouteError() {
  const error = useRouteError();
  console.error("studium: page failed to render", error);
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-4 py-10 text-foreground">
      <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
      <p className="text-sm text-muted-foreground">
        Your notes are safe. Reloading usually fixes this. If it keeps happening, go back to Today and try again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button className="h-11 md:h-9" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Link to="/today" className={cn(buttonVariants({ variant: "outline" }), "h-11 md:h-9")}>
          Go to Today
        </Link>
      </div>
    </main>
  );
}
