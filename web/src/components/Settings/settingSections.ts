// Modeled on Memos' settingSections.ts (MIT) — https://github.com/usememos/memos
import {
  BellIcon,
  CogIcon,
  DatabaseBackupIcon,
  DatabaseIcon,
  KeyIcon,
  KeyRoundIcon,
  LaptopIcon,
  LogOutIcon,
  type LucideIcon,
  PaletteIcon,
  ServerIcon,
  Settings2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import AccessTokenSection from "./AccessTokenSection";
import AppearanceSection from "./AppearanceSection";
import BackupsSection from "./BackupsSection";
import DataSection from "./DataSection";
import GeneralSection from "./GeneralSection";
import InstanceSection from "./InstanceSection";
import MembersSection from "./MembersSection";
import ModelsSection from "./ModelsSection";
import MyAccountSection from "./MyAccountSection";
import NotificationsSection from "./NotificationsSection";
import ServicesSection from "./ServicesSection";
import SessionsSection from "./SessionsSection";
import SSOSection from "./SSOSection";

export type SettingSectionKey =
  | "my-account"
  | "appearance"
  | "sessions"
  | "access-tokens"
  | "notifications"
  | "data"
  | "models"
  | "services"
  | "general"
  | "members"
  | "instance"
  | "sso"
  | "backups";

type SettingSectionScope = "basic" | "admin";

/** Phone/desktop settings navigation is grouped so 13 items read as three short lists. */
export type SettingSectionGroup = "personal" | "learning" | "admin";

export const SETTING_GROUP_LABELS: Record<SettingSectionGroup, string> = {
  personal: "Personal",
  learning: "Learning",
  admin: "Admin",
};

export interface SettingSectionDefinition {
  key: SettingSectionKey;
  scope: SettingSectionScope;
  group: SettingSectionGroup;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const SETTINGS_SECTIONS: SettingSectionDefinition[] = [
  {
    key: "my-account",
    scope: "basic",
    group: "personal",
    label: "My account",
    icon: UserIcon,
    component: MyAccountSection,
  },
  {
    key: "appearance",
    scope: "basic",
    group: "personal",
    label: "Appearance",
    icon: PaletteIcon,
    component: AppearanceSection,
  },
  {
    key: "sessions",
    scope: "basic",
    group: "personal",
    label: "Sessions",
    icon: LaptopIcon,
    component: SessionsSection,
  },
  {
    key: "access-tokens",
    scope: "basic",
    group: "personal",
    label: "Access tokens",
    icon: KeyRoundIcon,
    component: AccessTokenSection,
  },
  {
    key: "notifications",
    scope: "basic",
    group: "personal",
    label: "Notifications",
    icon: BellIcon,
    component: NotificationsSection,
  },
  { key: "data", scope: "basic", group: "personal", label: "Data", icon: DatabaseIcon, component: DataSection },
  { key: "models", scope: "basic", group: "learning", label: "Models", icon: CogIcon, component: ModelsSection },
  {
    key: "services",
    scope: "basic",
    group: "learning",
    label: "Services",
    icon: ServerIcon,
    component: ServicesSection,
  },
  { key: "members", scope: "admin", group: "admin", label: "Members", icon: UsersIcon, component: MembersSection },
  {
    key: "instance",
    scope: "admin",
    group: "admin",
    label: "Instance",
    icon: Settings2Icon,
    component: InstanceSection,
  },
  { key: "sso", scope: "admin", group: "admin", label: "SSO", icon: KeyIcon, component: SSOSection },
  {
    key: "backups",
    scope: "admin",
    group: "admin",
    label: "Backups",
    icon: DatabaseBackupIcon,
    component: BackupsSection,
  },
  { key: "general", scope: "basic", group: "personal", label: "General", icon: LogOutIcon, component: GeneralSection },
];

export const DEFAULT_SETTING_SECTION: SettingSectionKey = "my-account";

export function isSettingSectionKey(value: string): value is SettingSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}
