import type { ComponentPropsWithoutRef } from "react";

type ButtonLinkProps = ComponentPropsWithoutRef<"a"> & {
  variant?: "primary" | "secondary" | "inverse";
};

const variants = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover",
  secondary: "border border-line bg-surface text-ink hover:bg-subtle",
  inverse: "bg-surface text-brand hover:bg-subtle",
};

/** A navigation action stays an anchor; it never simulates a form submission. */
export function ButtonLink({ variant = "primary", className = "", children, ...props }: ButtonLinkProps) {
  return (
    <a className={`inline-flex min-h-12 items-center justify-center gap-3 rounded-lg px-5 py-3 text-sm font-semibold transition-colors duration-150 ${variants[variant]} ${className}`} {...props}>
      {children}
    </a>
  );
}
