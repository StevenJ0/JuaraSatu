import type { ReactNode } from "react";

type IconName = "arrow-right" | "arrow-up-right" | "check" | "box" | "notes" | "chart";

const paths: Record<IconName, ReactNode> = {
  "arrow-right": <><path d="M4 12h16M14 6l6 6-6 6" /></>,
  "arrow-up-right": <><path d="M6 18 18 6M6 6h12v12" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  box: <><path d="m12 3 9 5v9l-9 5-9-5V8l9-5Z" /><path d="m3 8 9 5 9-5M12 13v9M8 5l9 5" /></>,
  notes: <><path d="M8 4H5v17h14V4h-3M8 3h8v4H8zM8 12h8M8 16h5" /></>,
  chart: <><path d="M4 4v16h17M8 16v-5M13 16V7M18 16v-3" /></>,
};

/** Icons accompany text; standalone controls must carry their own name. */
export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
}
