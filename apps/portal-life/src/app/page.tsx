import Link from "next/link";
import { ArrowRight, BadgeCheck, Gift, Heart, HeartHandshake } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const highlights = [
  {
    icon: BadgeCheck,
    title: "A clear path from apply to verified",
    description: "Submit your story once, track status and know exactly what is left.",
  },
  {
    icon: Gift,
    title: "A wishlist sponsors can fund",
    description: "Add what you need, watch funding update in real time as sponsors give.",
  },
  {
    icon: Heart,
    title: "Say thank you, publicly",
    description: "Every funded item gets a gratitude post, seen on your public profile.",
  },
];

// Unauthed landing page. Feature screens for the life portal land in a
// later phase behind sign in, see docs/PLAN.md.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b border-border px-6 sm:px-10">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-primary">
            <HeartHandshake className="size-4" strokeWidth={1.75} />
          </div>
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Atlitos Life
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" render={<Link href="/signin" />}>
            Sign in
          </Button>
          <Button render={<Link href="/signup" />}>
            Get started
            <ArrowRight />
          </Button>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center gap-16 px-6 py-20 sm:px-10">
        <div className="flex max-w-2xl flex-col items-center gap-4 text-center">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Atlitos Life
          </span>
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            Support the athletes carrying the sport forward
          </h1>
          <p className="max-w-md text-base text-muted-foreground">
            Apply, verify and give, all from one place built for the UPA community.
          </p>
          <div className="mt-2 flex items-center gap-3">
            <Button size="lg" render={<Link href="/signup" />}>
              Get started
              <ArrowRight />
            </Button>
            <Button size="lg" variant="outline" render={<Link href="/signin" />}>
              Sign in
            </Button>
          </div>
        </div>

        <div className="grid w-full max-w-4xl gap-4 sm:grid-cols-3">
          {highlights.map((item) => {
            const Icon = item.icon;
            return (
              <Card key={item.title} className="text-left">
                <CardHeader>
                  <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-primary">
                    <Icon className="size-4.5" strokeWidth={1.75} />
                  </div>
                  <CardTitle className="mt-2">{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </main>
    </div>
  );
}
