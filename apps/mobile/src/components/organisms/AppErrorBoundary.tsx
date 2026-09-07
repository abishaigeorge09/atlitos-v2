import { Button } from '@/components/organisms/_shared';
import { textStyle } from '@/theme/text-style';
import { getTheme, spacing } from '@atlitos/theme';
import { TriangleAlert } from 'lucide-react-native';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Appearance, Text, View } from 'react-native';

/**
 * The app had no error boundary at all. A render error anywhere in the tree
 * unmounted everything and left a blank screen with no way out but a force
 * quit, and a release build shows no red box to explain it.
 *
 * This is the last line of defence, not error handling. Screens still handle
 * their own failures (every list has an error state); this catches the ones
 * nobody predicted, which is by definition the class that reaches real users.
 *
 * A class component on purpose: componentDidCatch has no hooks equivalent,
 * which also means it cannot call useThemeColors(). It reads the colour set
 * directly off the scheme instead, and only on the failure path.
 *
 * `reset()` clears the error and re-renders the children. That works for a
 * transient failure (a bad response, a race on mount) and does not for a
 * deterministic one, which throws again and lands back here. That is honest:
 * the button says "Try again", not "Fixed".
 */

interface Props {
  children: ReactNode;
  /** Reported alongside the error so a crash can be traced to a surface. */
  surface?: string;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Console only for now. When a crash reporter is added, this is its one
    // call site for render errors, which is why `surface` is threaded through
    // rather than reconstructed from the stack.
    console.error('[AppErrorBoundary]', this.props.surface ?? 'root', error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

    const colors = getTheme(Appearance.getColorScheme() === 'dark' ? 'dark' : 'light').colors;

    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: spacing.md,
          padding: spacing['3xl'],
          backgroundColor: colors.bg,
        }}
      >
        <TriangleAlert size={48} color={colors.textTertiary} strokeWidth={1.75} />
        <Text style={[textStyle('h3'), { color: colors.text, textAlign: 'center' }]}>
          Something went wrong
        </Text>
        <Text style={[textStyle('callout'), { color: colors.textSecondary, textAlign: 'center' }]}>
          This screen ran into a problem and stopped. Your account and your data are not
          affected. Try again, and if it keeps happening please contact support.
        </Text>
        <Button onPress={this.reset} style={{ marginTop: spacing.sm }}>
          <Text style={[textStyle('label'), { color: colors.inkOnAccent }]}>Try again</Text>
        </Button>
      </View>
    );
  }
}
