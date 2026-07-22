import { DRILL_DIFFICULTIES, SPORTS, type Db, type DrillDifficulty, type Sport } from "@atlitos/types";
import { AlertTriangle, GraduationCap, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { fetchDrills, type DrillListFilters } from "./api";

// AT-133, PRD-04 FR-49: every drill with title, sport, skill category,
// difficulty, XP value and active state. The admin list is the ONE surface
// that sees inactive drills (the consumer Learn surface filters active = true);
// the default read here is unfiltered on active, by design.
//
// PERMISSIVE-OR: every narrowing the admin chooses (sport, difficulty, active)
// is applied as its own explicit filter in fetchDrills, never assumed from RLS.

type DrillRow = Db.DrillRow;
type LoadState = "loading" | "error" | "ready";

const ACTIVE_TABS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "inactive", label: "Inactive" },
] as const;

export function DrillsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const sportParam = (searchParams.get("sport") as Sport | null) ?? null;
  const difficultyParam = (searchParams.get("difficulty") as DrillDifficulty | null) ?? null;
  const activeParam = searchParams.get("active") ?? "all";

  const [drills, setDrills] = useState<DrillRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  const filters = useMemo<DrillListFilters>(() => {
    const next: DrillListFilters = {};
    if (sportParam) next.sport = sportParam;
    if (difficultyParam) next.difficulty = difficultyParam;
    if (activeParam === "active") next.active = true;
    if (activeParam === "inactive") next.active = false;
    return next;
  }, [sportParam, difficultyParam, activeParam]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      try {
        const rows = await fetchDrills(filters);
        if (cancelled) return;
        setDrills(rows);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  const activeCount = drills.filter((d) => d.active).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Drills</h1>
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
            Reference drills players complete to earn XP and move along their roadmap.
          </p>
        </div>
        <Button onClick={() => navigate("/drills/create")}>
          <Plus size={16} strokeWidth={1.75} />
          New drill
        </Button>
      </div>

      <div style={{ display: "flex", gap: "var(--space-lg)", flexWrap: "wrap", alignItems: "flex-end" }}>
        <FilterGroup label="Sport">
          <Chip active={!sportParam} onClick={() => setParam("sport", null)}>
            All
          </Chip>
          {SPORTS.map((sport) => (
            <Chip key={sport} active={sportParam === sport} onClick={() => setParam("sport", sport)}>
              {sport}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Difficulty">
          <Chip active={!difficultyParam} onClick={() => setParam("difficulty", null)}>
            All
          </Chip>
          {DRILL_DIFFICULTIES.map((difficulty) => (
            <Chip
              key={difficulty}
              active={difficultyParam === difficulty}
              onClick={() => setParam("difficulty", difficulty)}
            >
              {difficulty}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="State">
          {ACTIVE_TABS.map((tab) => (
            <Chip
              key={tab.key}
              active={activeParam === tab.key || (tab.key === "all" && activeParam === "all")}
              onClick={() => setParam("active", tab.key === "all" ? null : tab.key)}
            >
              {tab.label}
            </Chip>
          ))}
        </FilterGroup>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading drills...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load drills"
            description="Something went wrong reading the drill catalog. Try again."
          />
        ) : drills.length === 0 ? (
          <EmptyState
            icon={<GraduationCap size={32} strokeWidth={1.75} />}
            title="No drills found"
            description="No drills match these filters. Create one to get started."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Title", "Sport", "Skill category", "Difficulty", "XP value", "State"].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-tertiary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {drills.map((drill) => (
                <tr
                  key={drill.id}
                  onClick={() => navigate(`/drills/show/${drill.id}`)}
                  style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                >
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                    {drill.title}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {drill.sport}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {drill.skill_category}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone="neutral">{drill.difficulty}</Badge>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>{drill.xp_value}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Badge tone={drill.active ? "success" : "neutral"}>
                      {drill.active ? "active" : "inactive"}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
        <Mono style={{ fontWeight: 600 }}>{activeCount}</Mono> of{" "}
        <Mono style={{ fontWeight: 600 }}>{drills.length}</Mono> shown are active. Inactive drills stay
        in the catalog but never appear to players.
      </p>
    </div>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--color-text-tertiary)",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", gap: "var(--space-xs)", flexWrap: "wrap" }}>{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "var(--space-xs) var(--space-md)",
        borderRadius: "var(--radius-pill)",
        border: active ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
        backgroundColor: active ? "var(--color-accent-tint)" : "transparent",
        color: active ? "var(--color-accent)" : "var(--color-text-secondary)",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        textTransform: "capitalize",
      }}
    >
      {children}
    </button>
  );
}
