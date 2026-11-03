import type { ReactNode } from "react";
import { Brand } from "@/components/brand";
import { Card } from "@/components/owner/card";
import { OwnerTheme } from "@/components/owner/owner-theme";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <OwnerTheme>
      <main className="flex min-h-screen items-center justify-center px-4 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-6 flex justify-center">
            <Brand href="/" />
          </div>
          <Card>{children}</Card>
        </div>
      </main>
    </OwnerTheme>
  );
}
