// Not a Memos port (Memos' MemoExportSection exports memos as JSON/markdown archives;
// Studium exports the whole study tree, server/src/export/routes.ts).
import { DownloadIcon } from "lucide-react";
import { meExportUrl } from "@/api/client";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import SettingGroup from "./SettingGroup";
import SettingSection from "./SettingSection";

const DataSection = () => {
  return (
    <SettingSection title="Data" description="Download your notes, sources, and cards as a zip file.">
      <SettingGroup>
        <div className="flex flex-col gap-2 sm:flex-row">
          <a href={meExportUrl()} className={cn(buttonVariants({ variant: "outline" }), "h-11 sm:h-9")} download>
            <DownloadIcon className="size-4" aria-hidden="true" />
            Download all my data
          </a>
          <a
            href={meExportUrl({ withHistory: true })}
            className={cn(buttonVariants({ variant: "outline" }), "h-11 sm:h-9")}
            download
          >
            <DownloadIcon className="size-4" aria-hidden="true" />
            …with full history
          </a>
        </div>
        <p className="text-xs text-muted-foreground">
          The export excludes your chat transcripts and the local model cache. "With full history" also includes the git
          log for every note.
        </p>
      </SettingGroup>
    </SettingSection>
  );
};

export default DataSection;
