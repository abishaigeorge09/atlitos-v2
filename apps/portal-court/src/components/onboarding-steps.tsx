import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export const ONBOARDING_STEPS = [
  { key: "venue-details", label: "Venue details" },
  { key: "courts", label: "Courts" },
  { key: "photos", label: "Photos" },
  { key: "review", label: "Review" },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];

/**
 * PRD-03 3.1's onboarding wizard step rail. Purely visual (navigation
 * between steps happens via each step's own Continue/Back actions, not by
 * clicking a step directly, since later steps depend on state the earlier
 * ones produce, e.g. Photos needs the venue id Courts creates).
 */
export function OnboardingSteps({ current }: { current: OnboardingStepKey }) {
  const currentIndex = ONBOARDING_STEPS.findIndex((s) => s.key === current);

  return (
    <ol className="flex items-center gap-2">
      {ONBOARDING_STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <li key={step.key} className="flex flex-1 items-center gap-2">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs tabular-nums",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && !done && "border-primary text-primary",
                  !active && !done && "border-border text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : index + 1}
              </span>
              <span className={cn("hidden text-sm sm:inline", active ? "font-medium text-foreground" : "text-muted-foreground")}>
                {step.label}
              </span>
            </div>
            {index < ONBOARDING_STEPS.length - 1 ? (
              <span className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
