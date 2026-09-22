import { Button } from "./Button";
import "./SaveBar.css";

/** Sticky bar that appears when a form is dirty. Refine's
 * UnsavedChangesNotifier feeds `dirty` in App.tsx. Part B B0.5. */
export function SaveBar({
  dirty,
  saving = false,
  onSave,
  onDiscard,
  errorCount = 0,
}: {
  dirty: boolean;
  saving?: boolean;
  onSave: () => void;
  onDiscard: () => void;
  errorCount?: number;
}) {
  if (!dirty) return null;
  return (
    <div className="ak-save-bar" role="region" aria-label="Unsaved changes">
      <span className="ak-save-bar-message">
        {errorCount > 0
          ? `Fix ${errorCount} ${errorCount === 1 ? "field" : "fields"} before saving.`
          : "You have unsaved changes."}
      </span>
      <div className="ak-save-bar-actions">
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>
          Discard
        </Button>
        <Button variant="primary" onClick={onSave} loading={saving} disabled={errorCount > 0}>
          Save
        </Button>
      </div>
    </div>
  );
}
