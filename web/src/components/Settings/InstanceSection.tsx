// Modeled on Memos' InstanceSection.tsx (MIT) — https://github.com/usememos/memos
// Trimmed to the two fields T1 exposes (`server/src/accounts/settings.ts`); SSO
// providers land in slice (b), backups/notifications in later slices.
import { useEffect, useState } from "react";
import { ApiError } from "@/api/client";
import { useAdminInstance, useUpdateAdminInstance } from "@/api/queries";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/lib/notify";
import SettingGroup from "./SettingGroup";
import SettingRow from "./SettingRow";
import SettingSection from "./SettingSection";

const InstanceSection = () => {
  const { data, isLoading } = useAdminInstance();
  const updateInstance = useUpdateAdminInstance();
  const [instanceUrl, setInstanceUrl] = useState("");
  const [urlDirty, setUrlDirty] = useState(false);

  useEffect(() => {
    if (data && !urlDirty) setInstanceUrl(data.instanceUrl);
  }, [data, urlDirty]);

  async function saveUrl() {
    try {
      await updateInstance.mutateAsync({ instanceUrl });
      setUrlDirty(false);
      toast.success("Instance URL saved");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save instance URL.");
    }
  }

  async function toggleDisallowPasswordAuth(checked: boolean) {
    try {
      await updateInstance.mutateAsync({ disallowPasswordAuth: checked });
      toast.success(checked ? "Password sign-in disabled for non-admins" : "Password sign-in enabled");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update setting.");
    }
  }

  if (isLoading || !data) {
    return (
      <SettingSection title="Instance">
        <RowsSkeleton rows={2} />
      </SettingSection>
    );
  }

  return (
    <SettingSection title="Instance" description="Instance-wide settings, visible to every member.">
      <SettingGroup>
        <SettingRow label="Instance URL" description="Used to build absolute links, e.g. in notifications.">
          <div className="flex w-full gap-2">
            <Input
              value={instanceUrl}
              onChange={(e) => {
                setInstanceUrl(e.target.value);
                setUrlDirty(true);
              }}
              placeholder="https://studium.example.com"
              className="h-11 sm:h-8"
            />
            <Button className="h-11 shrink-0 sm:h-8" disabled={!urlDirty} onClick={() => void saveUrl()}>
              Save
            </Button>
          </div>
        </SettingRow>
        <SettingRow
          label="Disallow password sign-in"
          description="Regular members must use SSO. Admins can always sign in with a password (at /auth/admin) to avoid lockout."
        >
          <Switch
            checked={data.disallowPasswordAuth}
            onCheckedChange={(checked) => void toggleDisallowPasswordAuth(checked)}
          />
        </SettingRow>
      </SettingGroup>
    </SettingSection>
  );
};

export default InstanceSection;
