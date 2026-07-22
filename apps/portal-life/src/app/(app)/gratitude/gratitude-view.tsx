"use client";

import { useCallback, useEffect, useState } from "react";
import { Heart, Loader2, Trash2, Upload } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { WishlistItem, GratitudePost } from "@/lib/empower";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/empty-state";
import { ErrorState } from "@/components/error-state";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

export function GratitudeView({ upaId, userId }: { upaId: string; userId: string }) {
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [posts, setPosts] = useState<GratitudePost[]>([]);
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");

  const reload = useCallback(async () => {
    const supabase = createClient();
    // Own items and own posts, each scoped by the owner's application id.
    const [itemsResult, postsResult] = await Promise.all([
      supabase.from("upa_wishlist_items").select("*").eq("upa_id", upaId),
      supabase
        .from("gratitude_posts")
        .select("*")
        .eq("upa_id", upaId)
        .order("created_at", { ascending: false }),
    ]);
    if (itemsResult.error || postsResult.error) {
      setState("error");
      return;
    }
    setItems(itemsResult.data ?? []);
    setPosts(postsResult.data ?? []);
    setState("ready");
  }, [upaId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const postedItemIds = new Set(posts.map((p) => p.wishlist_item_id));
  const eligibleItems = items.filter(
    (i) => (i.status === "funded" || i.status === "delivered") && !postedItemIds.has(i.id),
  );
  const itemTitle = (id: string) => items.find((i) => i.id === id)?.title ?? "an item";
  const visiblePosts = posts.filter((p) => p.status !== "removed");

  const header = (
    <PageHeader
      eyebrow="Gratitude"
      title="Thank your sponsors"
      description="Once an item is funded, share a note your sponsors can see."
    />
  );

  if (state === "loading") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <div className="h-40 animate-pulse rounded-xl bg-secondary" />
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex flex-1 flex-col gap-6">
        {header}
        <ErrorState description="We could not load your gratitude posts." onRetry={reload} />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {header}

      {eligibleItems.length > 0 ? (
        <Composer upaId={upaId} userId={userId} items={eligibleItems} onPosted={reload} />
      ) : null}

      {visiblePosts.length === 0 ? (
        <EmptyState
          icon={Heart}
          title="No thank you notes yet"
          description="When a wishlist item is funded, you can write a note here that appears on your public profile."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {visiblePosts.map((post) => (
            <Card key={post.id}>
              <CardContent className="flex flex-col gap-3 p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium text-foreground">
                      For {itemTitle(post.wishlist_item_id)}
                    </span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatDate(post.created_at)}
                    </span>
                  </div>
                  <SoftDelete postId={post.id} onDone={reload} />
                </div>
                <p className="text-sm text-muted-foreground">{post.body}</p>
                {post.photo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={post.photo_url}
                    alt="Gratitude"
                    className="max-h-56 w-full rounded-lg object-cover"
                  />
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Composer({
  upaId,
  userId,
  items,
  onPosted,
}: {
  upaId: string;
  userId: string;
  items: WishlistItem[];
  onPosted: () => void;
}) {
  const [itemId, setItemId] = useState("");
  const [body, setBody] = useState("");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePhoto(file: File) {
    setUploading(true);
    const supabase = createClient();
    // gratitude-photos is public; the insert policy requires the caller's own
    // id as the first path segment.
    const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error: uploadError } = await supabase.storage
      .from("gratitude-photos")
      .upload(path, file, { upsert: true });
    if (!uploadError) {
      const { data } = supabase.storage.from("gratitude-photos").getPublicUrl(path);
      setPhotoUrl(data.publicUrl);
    }
    setUploading(false);
  }

  async function publish() {
    if (!itemId) {
      setError("Choose which funded item to thank sponsors for.");
      return;
    }
    if (!body.trim()) {
      setError("Write a short note before posting.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    // Insert only; status defaults to published (0048). RLS enforces the
    // funded/delivered and one-post-per-item rules (0049).
    const { error: insertError } = await supabase.from("gratitude_posts").insert({
      upa_id: upaId,
      wishlist_item_id: itemId,
      body: body.trim(),
      photo_url: photoUrl,
    });
    setSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setItemId("");
    setBody("");
    setPhotoUrl(null);
    onPosted();
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
          <Heart className="size-4 text-primary" strokeWidth={1.75} />
          Write a thank you
        </span>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grat-item">Funded item</Label>
          <Select id="grat-item" value={itemId} onChange={(e) => setItemId(e.target.value)}>
            <option value="" disabled>
              Choose a funded item
            </option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grat-body">Your note</Label>
          <Textarea
            id="grat-body"
            className="min-h-28"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Tell your sponsors what their support made possible."
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="grat-photo">Photo</Label>
          <div className="flex items-center gap-3">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Attached" className="size-14 rounded-lg object-cover" />
            ) : (
              <div className="flex size-14 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                <Upload className="size-5" strokeWidth={1.75} />
              </div>
            )}
            <Input
              id="grat-photo"
              type="file"
              accept="image/*"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePhoto(file);
              }}
              className="max-w-xs"
            />
            {uploading ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <p className="text-xs text-muted-foreground">Optional.</p>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <div>
          <Button onClick={publish} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Post thank you
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function SoftDelete({ postId, onDone }: { postId: string; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  async function remove() {
    setBusy(true);
    const supabase = createClient();
    // Soft delete only: update status to removed (0049 restricts the update
    // grant to status/deleted_at; the body and photo can never be rewritten).
    const { error } = await supabase
      .from("gratitude_posts")
      .update({ status: "removed", deleted_at: new Date().toISOString() })
      .eq("id", postId);
    setBusy(false);
    if (!error) onDone();
  }
  return (
    <Button variant="ghost" size="icon-sm" aria-label="Remove post" onClick={remove} disabled={busy}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" strokeWidth={1.75} />}
    </Button>
  );
}
