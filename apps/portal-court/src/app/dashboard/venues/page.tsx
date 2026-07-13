"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ImagePlus,
  Loader2,
  MapPin,
  Plus,
  Trash2,
} from "lucide-react";
import { SPORTS, type Sport } from "@atlitos/types";

import { PageHeader } from "@/components/page-header";
import { ErrorState } from "@/components/error-state";
import { useVenueScope, type VenueRow } from "@/components/venue-scope";
import { createClient } from "@/lib/supabase/client";
import type { Database as AppDatabase } from "@atlitos/types";
import { sportLabel } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { venueStatusPill, StatusPill } from "@/components/status-pill";

type CourtRow = AppDatabase["public"]["Tables"]["courts"]["Row"];
type VenuePhotoRow = AppDatabase["public"]["Tables"]["venue_photos"]["Row"];

interface DraftCourt {
  sport: Sport;
  name: string;
  capacity: string;
  basePricePerHour: string;
}

function emptyDraftCourt(): DraftCourt {
  return { sport: SPORTS[0], name: "", capacity: "", basePricePerHour: "" };
}

export default function VenuesPage() {
  const scope = useVenueScope();

  if (scope.status === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader eyebrow="Venues" title="Venues and courts" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (scope.status === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader eyebrow="Venues" title="Venues and courts" />
        <ErrorState description={scope.error ?? "Could not load your venues."} onRetry={scope.refresh} />
      </div>
    );
  }

  if (scope.status === "empty") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        <PageHeader
          eyebrow="Venues"
          title="Venues and courts"
          description="Add your first venue, upload photos and submit for verification to start taking bookings."
        />
        <CreateVenueForm onCreated={scope.refresh} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader eyebrow="Venues" title="Venues and courts" />
      <div className="flex flex-col gap-6">
        {scope.venues.map((venue) => (
          <VenueCard key={venue.id} venue={venue} />
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Add another venue</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateVenueForm onCreated={scope.refresh} />
        </CardContent>
      </Card>
    </div>
  );
}

function CreateVenueForm({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [description, setDescription] = useState("");
  const [courts, setCourts] = useState<DraftCourt[]>([emptyDraftCourt()]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateCourt(index: number, patch: Partial<DraftCourt>) {
    setCourts((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (courts.some((c) => !c.name.trim() || !c.basePricePerHour)) {
      setError("Every court needs a name and a base price.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_venue_verification", {
      p_payload: {
        name,
        address,
        city,
        pincode,
        description: description || null,
        courts: courts.map((c) => ({
          sport: c.sport,
          name: c.name.trim(),
          capacity: c.capacity || null,
          basePricePerHour: c.basePricePerHour,
        })),
      },
    });
    setSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    setName("");
    setAddress("");
    setCity("");
    setPincode("");
    setDescription("");
    setCourts([emptyDraftCourt()]);
    onCreated();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="venue-name">Venue name</Label>
          <Input id="venue-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Gachibowli Box Cricket Turf" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="venue-city">City</Label>
          <Input id="venue-city" required value={city} onChange={(e) => setCity(e.target.value)} placeholder="Hyderabad" />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <Label htmlFor="venue-address">Address</Label>
          <Input id="venue-address" required value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Survey No. 64, Financial District Road" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="venue-pincode">Pincode</Label>
          <Input id="venue-pincode" required value={pincode} onChange={(e) => setPincode(e.target.value)} placeholder="500032" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="venue-description">Description</Label>
        <Textarea id="venue-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Two floodlit box cricket turfs, synthetic pitch." />
      </div>

      <div className="flex flex-col gap-3">
        <Label>Courts</Label>
        {courts.map((court, index) => (
          <div key={index} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-4">
            <Select value={court.sport} onChange={(e) => updateCourt(index, { sport: e.target.value as Sport })}>
              {SPORTS.map((s) => (
                <option key={s} value={s}>
                  {sportLabel(s)}
                </option>
              ))}
            </Select>
            <Input placeholder="Court name" required value={court.name} onChange={(e) => updateCourt(index, { name: e.target.value })} />
            <Input placeholder="Capacity" type="number" min={1} value={court.capacity} onChange={(e) => updateCourt(index, { capacity: e.target.value })} />
            <div className="flex items-center gap-2">
              <Input placeholder="Base price/hr" type="number" min={0} step="0.01" required value={court.basePricePerHour} onChange={(e) => updateCourt(index, { basePricePerHour: e.target.value })} />
              {courts.length > 1 ? (
                <Button type="button" variant="ghost" size="icon" onClick={() => setCourts((prev) => prev.filter((_, i) => i !== index))}>
                  <Trash2 className="size-4" strokeWidth={1.75} />
                </Button>
              ) : null}
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={() => setCourts((prev) => [...prev, emptyDraftCourt()])}>
          <Plus className="size-4" strokeWidth={1.75} />
          Add another court
        </Button>
      </div>

      {error ? (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      ) : null}

      <Button type="submit" disabled={submitting} className="w-fit">
        {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
        Submit for verification
      </Button>
    </form>
  );
}

function VenueCard({ venue }: { venue: VenueRow }) {
  const [courts, setCourts] = useState<CourtRow[] | null>(null);
  const [photos, setPhotos] = useState<VenuePhotoRow[] | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    const supabase = createClient();
    const [courtsResult, photosResult] = await Promise.all([
      supabase.from("courts").select("*").eq("venue_id", venue.id).order("created_at", { ascending: true }),
      supabase.from("venue_photos").select("*").eq("venue_id", venue.id).order("position", { ascending: true }),
    ]);

    if (courtsResult.error || photosResult.error) {
      setError(courtsResult.error?.message ?? photosResult.error?.message ?? "Failed to load venue detail.");
      setStatus("error");
      return;
    }

    setCourts(courtsResult.data ?? []);
    setPhotos(photosResult.data ?? []);
    setStatus("ready");
  }, [venue.id]);

  useEffect(() => {
    load();
  }, [load]);

  const sports = useMemo(() => Array.from(new Set((courts ?? []).map((c) => c.sport))), [courts]);
  const pill = venueStatusPill(venue.status);
  const supabase = useMemo(() => createClient(), []);

  async function toggleCourtActive(court: CourtRow) {
    await supabase.from("courts").update({ active: !court.active }).eq("id", court.id);
    load();
  }

  async function handlePhotoUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      const path = `${venue.id}/${crypto.randomUUID()}-${file.name}`;
      const { error: uploadError } = await supabase.storage.from("venue-media").upload(path, file);
      if (!uploadError) {
        await supabase.from("venue_photos").insert({ venue_id: venue.id, storage_path: path, position: photos?.length ?? 0 });
      }
    }
    setUploading(false);
    load();
  }

  async function deletePhoto(photo: VenuePhotoRow) {
    await supabase.storage.from("venue-media").remove([photo.storage_path]);
    await supabase.from("venue_photos").delete().eq("id", photo.id);
    load();
  }

  return (
    <Card>
      <CardHeader className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <CardTitle className="text-lg">{venue.name}</CardTitle>
            <StatusPill label={pill.label} tone={pill.tone} />
          </div>
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin className="size-3.5" strokeWidth={1.75} />
            {venue.address}, {venue.city} {venue.pincode}
          </p>
          {venue.status === "rejected" && venue.rejection_reason ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              Rejected. {venue.rejection_reason}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-1.5">
            {sports.map((s) => (
              <Badge key={s} variant="outline">
                {sportLabel(s)}
              </Badge>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {status === "loading" ? <Skeleton className="h-24 w-full" /> : null}
        {status === "error" ? <ErrorState description={error ?? "Failed to load."} onRetry={load} /> : null}

        {status === "ready" ? (
          <>
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Courts</span>
              {(courts ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No courts added yet.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {(courts ?? []).map((court) => (
                    <div key={court.id} className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-foreground">
                          {court.name} <span className="font-normal text-muted-foreground">({sportLabel(court.sport)})</span>
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          ₹{court.base_price_per_hour}/hr{court.capacity ? ` · capacity ${court.capacity}` : ""}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{court.active ? "Active" : "Inactive"}</span>
                        <Switch checked={court.active} onCheckedChange={() => toggleCourtActive(court)} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <AddCourtForm venueId={venue.id} onAdded={load} />
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium text-foreground">Photos</span>
              <div className="flex flex-wrap gap-3">
                {(photos ?? []).map((photo) => (
                  <div key={photo.id} className="group relative size-24 overflow-hidden rounded-lg border border-border bg-secondary">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={supabase.storage.from("venue-media").getPublicUrl(photo.storage_path).data.publicUrl}
                      alt="Venue"
                      className="size-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => deletePhoto(photo)}
                      className="absolute top-1 right-1 rounded-md bg-card/90 p-1 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" strokeWidth={1.75} />
                    </button>
                  </div>
                ))}
                <label className="flex size-24 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground">
                  {uploading ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5" strokeWidth={1.75} />}
                  <span className="text-xs">Upload</span>
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handlePhotoUpload(e.target.files)} />
                </label>
              </div>
              {(photos ?? []).length < 3 ? (
                <p className="text-xs text-muted-foreground">Add at least 3 photos before submitting for verification.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AddCourtForm({ venueId, onAdded }: { venueId: string; onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DraftCourt>(emptyDraftCourt());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim() || !draft.basePricePerHour) {
      setError("Name and base price are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase.from("courts").insert({
      venue_id: venueId,
      sport: draft.sport,
      name: draft.name.trim(),
      capacity: draft.capacity ? Number(draft.capacity) : null,
      base_price_per_hour: Number(draft.basePricePerHour),
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setDraft(emptyDraftCourt());
    setOpen(false);
    onAdded();
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setOpen(true)}>
        <Plus className="size-4" strokeWidth={1.75} />
        Add a court
      </Button>
    );
  }

  return (
    <form onSubmit={handleAdd} className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-4">
      <Select value={draft.sport} onChange={(e) => setDraft((d) => ({ ...d, sport: e.target.value as Sport }))}>
        {SPORTS.map((s) => (
          <option key={s} value={s}>
            {sportLabel(s)}
          </option>
        ))}
      </Select>
      <Input placeholder="Court name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
      <Input placeholder="Capacity" type="number" min={1} value={draft.capacity} onChange={(e) => setDraft((d) => ({ ...d, capacity: e.target.value }))} />
      <div className="flex items-center gap-2">
        <Input placeholder="Base price/hr" type="number" min={0} step="0.01" value={draft.basePricePerHour} onChange={(e) => setDraft((d) => ({ ...d, basePricePerHour: e.target.value }))} />
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? <Loader2 className="size-4 animate-spin" /> : "Save"}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive sm:col-span-4">{error}</p> : null}
    </form>
  );
}
