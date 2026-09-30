// Loading placeholders that match the size of the rows and cards they stand in for, so nothing
// shifts when data arrives (docs/UX.md rule 13).
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** A stack of list rows (`rows` of `h-11`-ish height). */
export function RowsSkeleton({ rows = 4, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
        <Skeleton key={index} className="h-14 w-full rounded-lg" />
      ))}
    </div>
  );
}

/** A page heading plus a few rows, for full-page loads. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mx-auto w-full max-w-4xl p-4 sm:p-6">
      <Skeleton className="h-6 w-40" />
      <RowsSkeleton rows={rows} className="mt-4" />
    </div>
  );
}

/** Title and a few paragraphs, for the reader while a note loads. */
export function ReaderSkeleton() {
  return (
    <div role="status" aria-label="Loading note" className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <Skeleton className="h-8 w-2/3" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="mt-4 h-6 w-1/2" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    </div>
  );
}
