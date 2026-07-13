import { Building2 } from "lucide-react";

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-24">
      <div className="flex w-full max-w-sm flex-col gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-accent text-primary">
            <Building2 className="size-5" strokeWidth={1.75} />
          </div>
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Atlitos Partners
          </span>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">{children}</div>
      </div>
    </div>
  );
}
