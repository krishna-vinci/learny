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

export interface SettingSectionDefinition {
  key: SettingSectionKey;
  scope: SettingSectionScope;
  label: string;
  icon: LucideIcon;
  component: ComponentType;
}

export const SETTINGS_SECTIONS: SettingSectionDefinition[] = [
  { key: "my-account", scope: "basic", label: "My account", icon: UserIcon, component: MyAccountSection },
  { key: "appearance", scope: "basic", label: "Appearance", icon: PaletteIcon, component: AppearanceSection },
  { key: "sessions", scope: "basic", label: "Sessions", icon: LaptopIcon, component: SessionsSection },
  { key: "access-tokens", scope: "basic", label: "Access tokens", icon: KeyRoundIcon, component: AccessTokenSection },
  { key: "notifications", scope: "basic", label: "Notifications", icon: BellIcon, component: NotificationsSection },
  { key: "data", scope: "basic", label: "Data", icon: DatabaseIcon, component: DataSection },
  { key: "models", scope: "basic", label: "Models", icon: CogIcon, component: ModelsSection },
  { key: "services", scope: "basic", label: "Services", icon: ServerIcon, component: ServicesSection },
  { key: "members", scope: "admin", label: "Members", icon: UsersIcon, component: MembersSection },
  { key: "instance", scope: "admin", label: "Instance", icon: Settings2Icon, component: InstanceSection },
  { key: "sso", scope: "admin", label: "SSO", icon: KeyIcon, component: SSOSection },
  { key: "backups", scope: "admin", label: "Backups", icon: DatabaseBackupIcon, component: BackupsSection },
  { key: "general", scope: "basic", label: "General", icon: LogOutIcon, component: GeneralSection },
];

export const DEFAULT_SETTING_SECTION: SettingSectionKey = "my-account";

export function isSettingSectionKey(value: string): value is SettingSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}
