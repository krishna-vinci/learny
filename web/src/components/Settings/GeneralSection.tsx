// Pre-existing Settings content ("Sign out"), moved here unchanged and wrapped in
// SettingSection so it fits the M3a Memos-style section layout.
import { LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSignOut } from "@/pages/useSignOut";
import SettingSection from "./SettingSection";

const GeneralSection = () => {
  const { signOut, signingOut } = useSignOut();

  return (
    <SettingSection title="General">
      <Button
        variant="outline"
        className="h-11 w-full justify-start md:w-auto"
        onClick={() => void signOut()}
        disabled={signingOut}
      >
        <LogOutIcon className="size-4" aria-hidden="true" />
        {signingOut ? "Signing out…" : "Sign out"}
      </Button>
    </SettingSection>
  );
};

export default GeneralSection;
