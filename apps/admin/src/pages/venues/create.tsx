import { SPORTS, type Sport } from "@atlitos/types";
import { ArrowLeft, Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { Button, Card } from "../../components/ui";
import { Field, Input, inputStyle } from "../../components/form";
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

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
  margin: "0 0 var(--space-md)",
};

export function VenueCreate() {
  const navigate = useNavigate();
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

  const pinValid = /^[0-9]{6}$/.test(pincode.trim());
  const coordsValid =
    (lat.trim() === "" && lng.trim() === "") ||
    (lat.trim() !== "" && lng.trim() !== "" && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));
  const urlValid = bookingUrl.trim() === "" || /^https?:\/\//.test(bookingUrl.trim());
  const courtsValid = courts.length > 0 && courts.every(courtValid);
  const canSave =
    !busy && name.trim().length > 0 && address.trim().length > 0 && city.trim().length > 0 && pinValid && coordsValid && urlValid && courtsValid;

  async function submit() {
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
      navigate(`/venues/show/${(data as { id: string }).id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function updateCourt(index: number, next: CourtDraft) {
    setCourts((prev) => prev.map((c, i) => (i === index ? next : c)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 880 }}>
      <button
        type="button"
        onClick={() => navigate("/venues")}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", border: "none", background: "none", color: "var(--color-text-secondary)", fontSize: 14, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to venues
      </button>

      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>New venue</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          A venue you enter here is verified on save and appears in the Courts tab straight away.
        </p>
      </div>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <Card>
        <p style={label}>Venue</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Field label="Name">
            <Input value={name} onChange={setName} placeholder="Play Arena Sarjapur" />
          </Field>
          <Field label="Address">
            <Input value={address} onChange={setAddress} placeholder="Street and landmark" />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="City" style={{ flex: 2 }}>
              <Input value={city} onChange={setCity} placeholder="Bengaluru" />
            </Field>
            <Field label="Pincode" style={{ flex: 1 }}>
              <Input value={pincode} onChange={setPincode} mono placeholder="560035" />
            </Field>
          </div>
          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="Latitude, optional" style={{ flex: 1 }}>
              <Input value={lat} onChange={setLat} mono placeholder="12.9100" />
            </Field>
            <Field label="Longitude, optional" style={{ flex: 1 }}>
              <Input value={lng} onChange={setLng} mono placeholder="77.6800" />
            </Field>
          </div>
          <Field label="Booking link, optional">
            <Input value={bookingUrl} onChange={setBookingUrl} placeholder="https://playo.co/venue/..." />
          </Field>
          <Field label="Description, optional">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              placeholder="Surface, floodlights, parking, anything an athlete asks before booking."
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
        </div>
        {pincode.trim().length > 0 && !pinValid ? (
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "var(--space-md) 0 0" }}>Pincode must be six digits.</p>
        ) : null}
        {!coordsValid ? (
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "var(--space-md) 0 0" }}>Latitude and longitude go together, both numbers.</p>
        ) : null}
        {!urlValid ? (
          <p style={{ fontSize: 13, color: "var(--color-danger)", margin: "var(--space-md) 0 0" }}>The booking link must start with http:// or https://.</p>
        ) : null}
      </Card>

      <Card>
        <p style={label}>Courts</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {courts.map((court, index) => (
            <div key={index} style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end" }}>
              <Field label="Sport" style={{ width: 150 }}>
                <select value={court.sport} onChange={(event) => updateCourt(index, { ...court, sport: event.target.value as Sport })} style={inputStyle}>
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Court name" style={{ flex: 1 }}>
                <Input value={court.name} onChange={(v) => updateCourt(index, { ...court, name: v })} placeholder="Box 1" />
              </Field>
              <Field label="Capacity, optional" style={{ width: 150 }}>
                <Input value={court.capacity} onChange={(v) => updateCourt(index, { ...court, capacity: v })} mono placeholder="12" />
              </Field>
              <Field label="Price per hour (INR)" style={{ width: 170 }}>
                <Input value={court.pricePerHour} onChange={(v) => updateCourt(index, { ...court, pricePerHour: v })} mono placeholder="1200" />
              </Field>
              {courts.length > 1 ? (
                <Button variant="secondary" aria-label="Remove court" onClick={() => setCourts((prev) => prev.filter((_, i) => i !== index))} style={{ marginBottom: 1 }}>
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
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "var(--space-md) 0 0" }}>
            Each court needs a name and a price per hour of zero or more. Capacity, if given, is a whole number.
          </p>
        ) : null}
      </Card>

      <div>
        <Button disabled={!canSave} onClick={submit}>
          <Save size={16} strokeWidth={1.75} />
          Create venue
        </Button>
      </div>
    </div>
  );
}
