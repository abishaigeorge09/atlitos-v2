"use client";

import { Select } from "@/components/ui/select";
import { useVenueScope } from "@/components/venue-scope";

/**
 * PRD-03 3.2's sidebar "venue switcher if the partner owns more than one
 * venue". Renders nothing for the common single-venue demo case; for a
 * multi-venue partner (this repo's own seed fixture ships 8 venues under
 * one demo partner) it is how Slots and Pricing, Live Today, Earnings, and
 * Overview all know which venue they are scoped to, via
 * `useVenueScope().selectedVenueId`.
 */
export function VenueSwitcher() {
  const { venues, selectedVenueId, setSelectedVenueId } = useVenueScope();

  if (venues.length <= 1) return null;

  return (
    <Select
      value={selectedVenueId ?? ""}
      onChange={(e) => setSelectedVenueId(e.target.value)}
      className="w-56"
    >
      {venues.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name}
        </option>
      ))}
    </Select>
  );
}
