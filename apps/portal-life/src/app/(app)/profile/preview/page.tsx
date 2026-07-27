import { BadgeCheck, Eye, Heart, MapPin, Quote, Users } from "lucide-react";

import { requireVerifiedApplication } from "@/lib/empower";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { FundingBar } from "@/components/funding-bar";
import { Money } from "@/components/money";
import { StatusPill, derivedItemPill } from "@/components/status-pill";
import { sportLabel, formatDate, type Sport } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

// The shape public_upa_profile returns (0056). total_raised is ledger derived;
// each item carries its own funded_amount progress.
interface PublicProfile {
  id: string;
  story_headline: string;
  story_body: string;
  sport: Sport;
  region: string;
  state: string;
  photo_url: string | null;
  total_raised: number;
  donor_count: number;
  items: Array<{
    id: string;
    title: string;
    cost: number;
    // Derived from donations by the RPC (0084), not the funded_amount cache.
    funded_amount: number;
    status: "open" | "funded" | "delivered";
  }>;
  supporters: Array<{ display_name: string | null; amount: number; last_at: string }>;
  gratitude: Array<{
    id: string;
    body: string;
    item_title: string | null;
    created_at: string;
  }>;
}

export default async function ProfilePreviewPage() {
  const { application } = await requireVerifiedApplication();
  const supabase = await createClient();

  // FR-23: render from the SAME RPC the consumer public profile uses, so the
  // UPA sees exactly what a sponsor sees, never a diverged preview.
  const { data, error } = await supabase.rpc("public_upa_profile", { p_upa_id: application.id });
  const profile = (data as PublicProfile | null) ?? null;

  const header = (
    <PageHeader
      eyebrow="Profile preview"
      title="What sponsors see"
      description="This is your public profile exactly as a sponsor views it."
    />
  );

  if (error || !profile) {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description="We could not load your profile preview." />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      <div className="flex items-center gap-2 rounded-lg border border-border bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
        <Eye className="size-4" strokeWidth={1.75} />
        Viewing as a sponsor
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 p-6">
          <div className="flex items-start gap-4">
            {profile.photo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.photo_url}
                alt={profile.story_headline}
                className="size-20 shrink-0 rounded-xl object-cover"
              />
            ) : (
              <div className="flex size-20 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
                <BadgeCheck className="size-7" strokeWidth={1.5} />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold text-foreground">{profile.story_headline}</h2>
                <Badge variant="success">
                  <BadgeCheck className="size-3" strokeWidth={2} />
                  Verified
                </Badge>
              </div>
              <span className="flex items-center gap-1.5 font-mono text-xs tabular-nums text-muted-foreground">
                <MapPin className="size-3.5" strokeWidth={1.75} />
                {sportLabel(profile.sport)} · {profile.region}, {profile.state}
              </span>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">{profile.story_body}</p>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Users className="size-4" strokeWidth={1.75} />
              {profile.donor_count} {profile.donor_count === 1 ? "supporter" : "supporters"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Total raised</span>
              <Money amount={profile.total_raised} className="text-lg font-semibold text-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-col gap-3">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Wishlist
        </span>
        {profile.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items on your wishlist yet.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {profile.items.map((item) => {
              const pill = derivedItemPill(item.status, Number(item.funded_amount), Number(item.cost));
              return (
                <Card key={item.id}>
                  <CardContent className="flex flex-col gap-3 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{item.title}</span>
                      <StatusPill label={pill.label} tone={pill.tone} />
                    </div>
                    <FundingBar funded={Number(item.funded_amount)} cost={Number(item.cost)} />
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="preview-supporters">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Supporters
        </span>
        {profile.supporters.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No supporters yet. Sponsors who fund your wishlist show here.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.supporters.map((supporter, index) => (
              <Card key={`${supporter.last_at}-${index}`}>
                <CardContent className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex items-center gap-2.5 text-sm font-medium text-foreground">
                    <Heart className="size-4 text-primary" strokeWidth={1.75} />
                    {supporter.display_name ?? "A Sponsor"}
                  </span>
                  <Money amount={supporter.amount} className="text-sm text-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3" data-testid="preview-gratitude">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Thank you notes
        </span>
        {profile.gratitude.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No thank you notes yet. They appear here once you thank a sponsor.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {profile.gratitude.map((post) => (
              <Card key={post.id}>
                <CardContent className="flex flex-col gap-2 p-5">
                  <Quote className="size-4 text-primary" strokeWidth={1.75} />
                  <p className="text-sm text-muted-foreground">{post.body}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {post.item_title ? (
                      <span className="text-foreground">{post.item_title}</span>
                    ) : null}
                    <span className="font-mono tabular-nums">{formatDate(post.created_at)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
