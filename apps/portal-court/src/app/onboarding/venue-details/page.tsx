"use client";

import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";

import { Eyebrow } from "@atlitos/ui-web";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { useOnboardingDraft } from "../onboarding-draft";
import { useOnboardingGuard } from "../use-onboarding-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * PRD-03 FR-2: venue details (name, address, city, pincode, latitude and
 * longitude, description) as a draft, held client side only until the
 * Courts step's Continue action calls `submit_venue_verification`. Nothing
 * on this page writes to the database.
 */
export default function VenueDetailsStep() {
  const router = useRouter();
  const draft = useOnboardingDraft();
  const guard = useOnboardingGuard();

  if (guard.status === "checking") {
    return <Skeleton className="h-96 w-full" />;
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    router.push("/onboarding/courts");
  }

  const canContinue = draft.details.name.trim() && draft.details.address.trim() && draft.details.city.trim() && draft.details.pincode.trim();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Eyebrow>Onboarding</Eyebrow>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Tell us about your venue</h1>
        <p className="text-sm text-muted-foreground">
          Start with the basics. You will add courts and photos next.
        </p>
      </div>

      <OnboardingSteps current="venue-details" />

      {guard.status === "edit-rejected" ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Your previous submission was rejected. Update the details below and resubmit.
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <MapPin className="size-4" strokeWidth={1.75} />
            Venue details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="venue-name">Venue name</Label>
                <Input
                  id="venue-name"
                  required
                  value={draft.details.name}
                  onChange={(e) => draft.setDetails({ ...draft.details, name: e.target.value })}
                  placeholder="Gachibowli Box Cricket Turf"
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <Label htmlFor="venue-address">Address</Label>
                <Input
                  id="venue-address"
                  required
                  value={draft.details.address}
                  onChange={(e) => draft.setDetails({ ...draft.details, address: e.target.value })}
                  placeholder="Survey No. 64, Financial District Road"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venue-city">City</Label>
                <Input
                  id="venue-city"
                  required
                  value={draft.details.city}
                  onChange={(e) => draft.setDetails({ ...draft.details, city: e.target.value })}
                  placeholder="Hyderabad"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venue-pincode">Pincode</Label>
                <Input
                  id="venue-pincode"
                  required
                  value={draft.details.pincode}
                  onChange={(e) => draft.setDetails({ ...draft.details, pincode: e.target.value })}
                  placeholder="500032"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venue-lat">Latitude (optional)</Label>
                <Input
                  id="venue-lat"
                  inputMode="decimal"
                  value={draft.details.lat}
                  onChange={(e) => draft.setDetails({ ...draft.details, lat: e.target.value })}
                  placeholder="17.4483"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="venue-lng">Longitude (optional)</Label>
                <Input
                  id="venue-lng"
                  inputMode="decimal"
                  value={draft.details.lng}
                  onChange={(e) => draft.setDetails({ ...draft.details, lng: e.target.value })}
                  placeholder="78.3915"
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venue-description">Description (optional)</Label>
              <Textarea
                id="venue-description"
                value={draft.details.description}
                onChange={(e) => draft.setDetails({ ...draft.details, description: e.target.value })}
                placeholder="Two floodlit box cricket turfs, synthetic pitch."
              />
            </div>

            <Button type="submit" disabled={!canContinue} className="w-fit">
              Continue to courts
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
