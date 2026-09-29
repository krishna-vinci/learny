// Modeled on Memos' settingSections.ts (MIT) — https://github.com/usememos/memos
import {
  CogIcon,
  KeyRoundIcon,
  LaptopIcon,
  LogOutIcon,
  type LucideIcon,
  ServerIcon,
  Settings2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import AccessTokenSection from "./AccessTokenSection";
import GeneralSection from "./GeneralSection";
import InstanceSection from "./InstanceSection";
import MembersSection from "./MembersSection";
import ModelsSection from "./ModelsSection";
import MyAccountSection from "./MyAccountSection";
import ServicesSection from "./ServicesSection";
import SessionsSection from "./SessionsSection";

export type SettingSectionKey =
  | "my-account"
  | "sessions"
  | "access-tokens"
  | "models"
  | "services"
  | "general"
  | "members"
  | "instance";

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
  { key: "sessions", scope: "basic", label: "Sessions", icon: LaptopIcon, component: SessionsSection },
  { key: "access-tokens", scope: "basic", label: "Access tokens", icon: KeyRoundIcon, component: AccessTokenSection },
  { key: "models", scope: "basic", label: "Models", icon: CogIcon, component: ModelsSection },
  { key: "services", scope: "basic", label: "Services", icon: ServerIcon, component: ServicesSection },
  { key: "members", scope: "admin", label: "Members", icon: UsersIcon, component: MembersSection },
  { key: "instance", scope: "admin", label: "Instance", icon: Settings2Icon, component: InstanceSection },
  { key: "general", scope: "basic", label: "General", icon: LogOutIcon, component: GeneralSection },
];

export const DEFAULT_SETTING_SECTION: SettingSectionKey = "my-account";

export function isSettingSectionKey(value: string): value is SettingSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}
