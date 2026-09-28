import { usePush } from '@atlitos/api';
import { BellRing } from 'lucide-react-native';
import { useState } from 'react';

import { ConfirmSheet } from '@/components/organisms/ConfirmSheet';
import { registerForPushTokenAsync } from '@/lib/push';
import { supabase } from '@/lib/supabase';
import { usePushPrimerStore } from '@/store/push-primer-store';

/** The explanation shown before the system notification prompt (3.6). */
export function PushPrimerGate() {
  const visible = usePushPrimerStore((s) => s.visible);
  const hide = usePushPrimerStore((s) => s.hide);
  const push = usePush(supabase);
  const [busy, setBusy] = useState(false);

  async function turnOn() {
    setBusy(true);
    try {
      const result = await registerForPushTokenAsync({ prompt: true });
      if (result) await push.register({ token: result.token, platform: result.platform });
    } catch {
      // Non fatal: the in app notifications list still works without push.
    } finally {
      setBusy(false);
      hide();
    }
  }

  return (
    <ConfirmSheet
      visible={visible}
      icon={BellRing}
      title="Get session updates"
      body="We will tell you when a coach confirms, reschedules or messages you. Nothing else unless you turn it on in Settings."
      confirmLabel="Turn on notifications"
      cancelLabel="Not now"
      loading={busy}
      onConfirm={() => void turnOn()}
      onCancel={hide}
    />
  );
}
