import { SPORTS, type Sport } from "@atlitos/types";
import { useNotification } from "@refinedev/core";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { SaveBar } from "../../components/kit/SaveBar";
import { Select } from "../../components/kit/Select";
import { Textarea } from "../../components/kit/Textarea";
import { parseRpcError, type CommerceError } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// Admin data entry for court listings (0120 admin_create_venue). One venue and
// its courts land in one transaction, owned by the admin who entered them and
// verified by construction. The optional booking link is the affiliate model
// for courts: when set, the app sends the athlete to the venue's own booking
// site instead of the in-app slot picker.
//
// At least one court is required because the Courts tab lists courts, not
// venues: a venue with no court is invisible to every athlete.

interface CourtDraft {
  sport: Sport;
  name: string;
  capacity: string;
  pricePerHour: string;
}

const EMPTY_COURT: CourtDraft = { sport: SPORTS[0], name: "", capacity: "", pricePerHour: "" };

function courtValid(c: CourtDraft): boolean {
  const price = Number(c.pricePerHour);
  const cap = c.capacity.trim();
  return (
    c.name.trim().length > 0 &&
    c.pricePerHour.trim().length > 0 &&
    Number.isFinite(price) &&
    price >= 0 &&
    (cap.length === 0 || (Number.isInteger(Number(cap)) && Number(cap) > 0))
  );
}

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function VenueCreate() {
  const navigate = useNavigate();
  const { open } = useNotification();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [description, setDescription] = useState("");
  const [bookingUrl, setBookingUrl] = useState("");
  const [courts, setCourts] = useState<CourtDraft[]>([{ ...EMPTY_COURT }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const pinValid = /^[0-9]{6}$/.test(pincode.trim());
  const coordsValid =
    (lat.trim() === "" && lng.trim() === "") ||
    (lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
  const urlValid = bookingUrl.trim() === "" || /^https?:\/\//.test(bookingUrl.trim());
  const courtsValid = courts.length > 0 && courts.every(courtValid);
  const nameValid = name.trim().length > 0;
  const addressValid = address.trim().length > 0;
  const cityValid = city.trim().length > 0;
  const formValid = nameValid && addressValid && cityValid && pinValid && coordsValid && urlValid && courtsValid;
  const dirty =
    name.trim().length > 0 ||
    address.trim().length > 0 ||
    city.trim().length > 0 ||
    pincode.trim().length > 0 ||
    lat.trim().length > 0 ||
    lng.trim().length > 0 ||
    description.trim().length > 0 ||
    bookingUrl.trim().length > 0 ||
    courts.some((c) => c.name.trim().length > 0 || c.pricePerHour.trim().length > 0 || c.capacity.trim().length > 0);
  const errorCount = touched && !formValid ? 1 : 0;

  async function submit() {
    setTouched(true);
    if (!formValid) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error: rpcError } = await supabaseClient.rpc("admin_create_venue", {
        p_name: name.trim(),
        p_address: address.trim(),
        p_city: city.trim(),
        p_pincode: pincode.trim(),
        p_lat: lat.trim() === "" ? null : Number(lat),
        p_lng: lng.trim() === "" ? null : Number(lng),
        p_description: description.trim() || null,
        p_booking_url: bookingUrl.trim() || null,
        p_courts: courts.map((c) => ({
          sport: c.sport,
          name: c.name.trim(),
          capacity: c.capacity.trim() === "" ? null : Number(c.capacity),
          base_price_per_hour: Number(c.pricePerHour),
        })),
      });
      if (rpcError) throw parseRpcError(rpcError.message);
      open?.({ type: "success", message: "Venue created." });
      navigate(`/venues/show/${(data as { id: string }).id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function discard() {
    setName("");
    setAddress("");
    setCity("");
    setPincode("");
    setLat("");
    setLng("");
    setDescription("");
    setBookingUrl("");
    setCourts([{ ...EMPTY_COURT }]);
    setTouched(false);
    setError(null);
  }

  function updateCourt(index: number, next: CourtDraft) {
    setCourts((prev) => prev.map((c, i) => (i === index ? next : c)));
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Operations", to: "/venues" }, { label: "Venues", to: "/venues" }]}
        title="Add venue"
        description="A venue you enter here is verified on save and appears in the Courts tab straight away."
      />

      {error ? (
        <Card>
          <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "0 0 var(--space-md)" }}>Venue</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Field label="Name" error={touched && !nameValid ? "Name is required." : undefined}>
            <Input value={name} onChange={setName} placeholder="Play Arena Sarjapur" invalid={touched && !nameValid} />
          </Field>
          <Field label="Address" error={touched && !addressValid ? "Address is required." : undefined}>
            <Input value={address} onChange={setAddress} placeholder="Street and landmark" invalid={touched && !addressValid} />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="City" error={touched && !cityValid ? "City is required." : undefined}>
              <Input value={city} onChange={setCity} placeholder="Bengaluru" invalid={touched && !cityValid} />
            </Field>
            <Field label="Pincode" error={pincode.trim().length > 0 && !pinValid ? "Pincode must be six digits." : undefined}>
              <Input value={pincode} onChange={setPincode} mono placeholder="560035" invalid={pincode.trim().length > 0 && !pinValid} />
            </Field>
          </div>
          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="Latitude" hint="Optional" error={!coordsValid ? "Latitude and longitude go together, both numbers." : undefined}>
              <Input value={lat} onChange={setLat} mono placeholder="12.9100" invalid={!coordsValid} />
            </Field>
            <Field label="Longitude" hint="Optional" error={!coordsValid ? "Latitude and longitude go together, both numbers." : undefined}>
              <Input value={lng} onChange={setLng} mono placeholder="77.6800" invalid={!coordsValid} />
            </Field>
          </div>
          <Field label="Booking link" hint="Optional" error={!urlValid ? "The booking link must start with http:// or https://." : undefined}>
            <Input value={bookingUrl} onChange={setBookingUrl} placeholder="https://playo.co/venue/..." invalid={!urlValid} />
          </Field>
          <Field label="Description" hint="Optional">
            <Textarea
              value={description}
              onChange={setDescription}
              rows={3}
              placeholder="Surface, floodlights, parking, anything an athlete asks before booking."
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: "var(--text-md)", fontWeight: 600, margin: "0 0 var(--space-md)" }}>Courts</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {courts.map((court, index) => (
            <div key={index} style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end" }}>
              <Field label="Sport">
                <Select value={court.sport} onChange={(v) => updateCourt(index, { ...court, sport: v as Sport })} options={SPORTS.map((s) => ({ value: s, label: s }))} />
              </Field>
              <Field label="Court name">
                <Input value={court.name} onChange={(v) => updateCourt(index, { ...court, name: v })} placeholder="Box 1" />
              </Field>
              <Field label="Capacity" hint="Optional">
                <Input value={court.capacity} onChange={(v) => updateCourt(index, { ...court, capacity: v })} mono placeholder="12" />
              </Field>
              <Field label="Price / hour, INR">
                <Input value={court.pricePerHour} onChange={(v) => updateCourt(index, { ...court, pricePerHour: v })} mono placeholder="1200" />
              </Field>
              {courts.length > 1 ? (
                <Button variant="secondary" aria-label="Remove court" onClick={() => setCourts((prev) => prev.filter((_, i) => i !== index))}>
                  <Trash2 size={16} strokeWidth={1.75} />
                </Button>
              ) : null}
            </div>
          ))}
          <div>
            <Button variant="secondary" onClick={() => setCourts((prev) => [...prev, { ...EMPTY_COURT }])}>
              <Plus size={16} strokeWidth={1.75} />
              Add court
            </Button>
          </div>
        </div>
        {!courtsValid ? (
          <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
            Each court needs a name and a price per hour of zero or more. Capacity, if given, is a whole number.
          </p>
        ) : null}
      </Card>

      <SaveBar dirty={dirty} saving={busy} errorCount={errorCount} onSave={() => void submit()} onDiscard={discard} />
    </div>
  );
}
