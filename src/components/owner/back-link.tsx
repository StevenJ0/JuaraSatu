import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center gap-1 self-start text-sm font-medium text-muted transition-colors hover:text-ink"
    >
      <ArrowLeft aria-hidden size={16} strokeWidth={1.5} />
      {label}
    </Link>
  );
}
