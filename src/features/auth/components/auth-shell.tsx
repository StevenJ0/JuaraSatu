import type { ReactNode } from "react";
import { Brand } from "@/components/brand";

export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-12 font-sans">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex justify-center">
          <Brand href="/" />
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6">
          {children}
        </div>
      </div>
    </main>
  );
}
