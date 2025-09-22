"use client"

import * as React from "react"
import {
  AudioWaveform,
  BookOpen,
  Bot,
  Command,
  Frame,
  GalleryVerticalEnd,
  Home,
  ImageIcon,
  LucideIcon,
  Map,
  PieChart,
  Settings2,
  SortAsc,
  SquareTerminal,
  Tag,
  Upload,
  Wand2,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { CollectionSwitcher } from "@/components/collection-switcher"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"

import { useRemainingQuota, useUser } from "@/context/UserContext"
import { SidebarQuota } from "./QuotaPill"
import { useFiles } from "@/context/FilesContext"

export type NavItem = {
  title: string;
  url: string;
};

export type NavSection = {
  title: string;
  url: string;
  icon: LucideIcon;
  isActive?: boolean;
  items?: NavItem[];
};

export type ProjectLink = {
  name: string;
  url: string;
  icon: LucideIcon;
};

export const navMain: NavSection[] = [
  { 
    title: "Home",
    url: "/",
    icon: Home,
  },
  {
    title: "Tagging",
    url: "/tagging",
    icon: Tag,
    items: [
      { title: "Auto Tags",      url: "/tagging/auto" },
      { title: "Taxonomy",       url: "/tagging/taxonomy" },
      { title: "Review Queue",   url: "/tagging/review" },
    ],
  },
  {
    title: "Organize",
    url: "/organize",
    icon: SortAsc,
    items: [
      { title: "Rename Presets", url: "/organize/presets" },
      { title: "Batch Jobs",     url: "/organize/batches" },
      { title: "Rules & Sorting",url: "/organize/rules" },
    ],
  },
  {
    title: "Automations",
    url: "/automations",
    icon: Wand2,
    items: [
      { title: "Workflows",      url: "/automations/workflows" },
      { title: "Schedules",      url: "/automations/schedules" },
      { title: "Integrations",   url: "/automations/integrations" },
    ],
  },
  {
    title: "Documentation",
    url: "/docs",
    icon: BookOpen,
    items: [
      { title: "Introduction",   url: "/docs/introduction" },
      { title: "Get Started",    url: "/docs/get-started" },
      { title: "Guides",         url: "/docs/guides" },
      { title: "Changelog",      url: "/docs/changelog" },
    ],
  },
  {
    title: "Settings",
    url: "/settings",
    icon: Settings2,
    items: [
      { title: "General",        url: "/settings/general" },
      { title: "Team",           url: "/settings/team" },
    ],
  },
];


export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { user, setCollection } = useUser();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <CollectionSwitcher collections={user.collections} currentCollection={user.currentCollection} setCurrentCollectionAction={setCollection} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
      <SidebarQuota />
        <NavUser user={user.profile} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
