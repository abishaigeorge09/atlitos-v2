import { ArrowRight, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// P0 shell screen only. Feature screens for the life portal land in a
// later phase, see docs/PLAN.md.
export default function Home() {
  return (
    <div className="flex flex-1 items-center justify-center bg-background px-6 py-24">
      <main className="flex w-full max-w-lg flex-col items-center gap-8 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-accent text-primary">
          <HeartHandshake className="size-7" strokeWidth={1.75} />
        </div>

        <div className="flex flex-col items-center gap-3">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Atlitos Life
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-foreground">
            Support the athletes carrying the sport forward
          </h1>
          <p className="max-w-sm text-base text-muted-foreground">
            Apply, verify and give, all from one place built for the UPA community.
          </p>
        </div>

        <Card className="w-full text-left">
          <CardHeader>
            <CardTitle>Portal shell live</CardTitle>
            <CardDescription>
              Applications, wishlist and my impact arrive in the next build phase.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full">
              Continue
              <ArrowRight />
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
