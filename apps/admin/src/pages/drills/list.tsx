import { DRILL_DIFFICULTIES, SPORTS, type Db, type DrillDifficulty, type Sport } from "@atlitos/types";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { Tabs } from "../../components/kit/Tabs";
import { Mono } from "../../components/mono";
import { fetchDrills, type DrillListFilters } from "./api";

// AT-133, PRD-04 FR-49: every drill with title, sport, skill category,
// difficulty, XP value and active state. The admin list is the ONE surface
// that sees inactive drills (the consumer Learn surface filters active =
// true); the default read here is unfiltered on active, by design.
//
// PERMISSIVE-OR: every narrowing the admin chooses (sport, difficulty,
// active) is applied as its own explicit filter in fetchDrills, never
// assumed from RLS.

type DrillRow = Db.DrillRow;
type LoadState = "loading" | "error" | "ready";
type ActiveTab = "all" | "active" | "inactive";

export function DrillsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const sportParam = (searchParams.get("sport") as Sport | null) ?? "";
  const difficultyParam = (searchParams.get("difficulty") as DrillDifficulty | null) ?? "";
  const activeParam = (searchParams.get("active") as ActiveTab | null) ?? "all";
  const [search, setSearch] = useState("");

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

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams);
    if (!value) next.delete(key);
    else next.set(key, value);
    setSearchParams(next);
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drills;
    return drills.filter((d) => d.title.toLowerCase().includes(q) || d.skill_category.toLowerCase().includes(q));
  }, [drills, search]);

  const columns: DataTableColumn<DrillRow>[] = [
    { key: "title", header: "Title", render: (d) => d.title },
    { key: "sport", header: "Sport", render: (d) => d.sport },
    { key: "skill", header: "Skill category", render: (d) => d.skill_category },
    { key: "difficulty", header: "Difficulty", render: (d) => <Badge tone="neutral">{d.difficulty}</Badge> },
    { key: "xp", header: "XP value", numeric: true, render: (d) => d.xp_value },
    {
      key: "state",
      header: "State",
      render: (d) => <Badge tone={d.active ? "success" : "neutral"}>{d.active ? "active" : "inactive"}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Community" }]}
        title="Drills"
        description="Reference drills players complete to earn XP and move along their roadmap."
        primaryAction={
          <Button variant="primary" onClick={() => navigate("/drills/create")}>
            <Plus size={16} strokeWidth={1.75} />
            Add drill
          </Button>
        }
      />

      <Tabs
        items={[
          { key: "all", label: "All", count: drills.length },
          { key: "active", label: "Active" },
          { key: "inactive", label: "Inactive" },
        ]}
        active={activeParam}
        onChange={(key) => setParam("active", key === "all" ? "" : key)}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by title or skill category"
        filters={
          <>
            <Select
              value={sportParam}
              onChange={(v) => setParam("sport", v)}
              placeholder="All sports"
              options={SPORTS.map((sport) => ({ value: sport, label: sport }))}
            />
            <Select
              value={difficultyParam}
              onChange={(v) => setParam("difficulty", v)}
              placeholder="All difficulties"
              options={DRILL_DIFFICULTIES.map((difficulty) => ({ value: difficulty, label: difficulty }))}
            />
          </>
        }
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "drill" : "drills"}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/drills/show/${row.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load drills" : "No drills found"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading the drill catalog. Try again."
            : "No drills match these filters. Add one to get started."
        }
        emptyAction={
          state === "error" ? undefined : (
            <Button variant="primary" onClick={() => navigate("/drills/create")}>
              <Plus size={16} strokeWidth={1.75} />
              Add drill
            </Button>
          )
        }
      />

      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
        <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{drills.filter((d) => d.active).length}</Mono> of{" "}
        <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{drills.length}</Mono> shown are active. Inactive
        drills stay in the catalog but never appear to players.
      </p>
    </div>
  );
}
