import * as React from "react";
import { ReactElement } from "react";

import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: React.HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border border-slate-700 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-slate-200",
        className
      )}
      {...props}
    />
  );
}
