"use client";

import { Sidebar, SidebarContent, SidebarHeader, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuItem, SidebarMenuButton, SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { FilesProvider } from "@/context/FilesContext";
import { ImageGrid } from "@/components/ImageGrid";
import { Crown } from "lucide-react";

export default function Page() {
  return (
      <SidebarInset className="p-4 md:p-8">
        <div className="mx-auto w-full max-w-6xl">
          <ImageGrid />
        </div>
      </SidebarInset>
  );
}
