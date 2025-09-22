"use client";

import { Crown } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PricingBanner() {
  // Purely cosmetic placeholder for future subscriptions
  return (
    <div className="flex items-center gap-3 rounded-xl border px-3 py-2">
      <Crown className="h-4 w-4" />
      <div className="text-sm leading-tight">
        <div className="font-medium">Starter</div>
        <div className="text-muted-foreground">Up to 200 images / month</div>
      </div>
      <div className="ml-3">
        <Button size="sm" variant="outline">Manage</Button>
      </div>
    </div>
  );
}

