import { useProfile } from '@atlitos/api';
import { ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';

import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { supabase } from '@/lib/supabase';
import { useContentTermsStore } from '@/store/content-terms-store';
import { useSessionStore } from '@/store/session-store';

/**
 * The one time content rules sheet (0138). Mounted once in the root layout;
 * opened by ensureContentTerms(). "I agree" records acceptance on the server,
 * refreshes the profile, and resolves the waiting post with true.
 */
export function ContentTermsGate() {
  const visible = useContentTermsStore((s) => s.visible);
  const settle = useContentTermsStore((s) => s.settle);
  const refreshMe = useSessionStore((s) => s.refreshMe);
  const profileApi = useProfile(supabase);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setSaving(true);
    setError(null);
    try {
      await profileApi.acceptContentTerms();
      await refreshMe();
      settle(true);
    } catch {
      setError('Could not save that. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ConfirmSheet
      visible={visible}
      icon={ShieldCheck}
      title="Our content rules"
      body="There is no tolerance for objectionable content or abusive users. We review every report within 24 hours, remove content that breaks the content policy, and remove the account that posted it."
      confirmLabel="I agree"
      cancelLabel="Not now"
      loading={saving}
      errorMessage={error}
      onConfirm={() => void agree()}
      onCancel={() => {
        setError(null);
        settle(false);
      }}
    />
  );
}
