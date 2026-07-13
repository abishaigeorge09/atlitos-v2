import { TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { useThemeColors } from '@/theme/use-theme-colors';
import { cva, type VariantProps } from 'class-variance-authority';
import * as Haptics from 'expo-haptics';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable } from 'react-native';

/**
 * Button. Locked API per SPEC Section 5.1 #1: `variant`
 * primary|ghost|text|destructive, `size` lg|md|sm, `loading`, `disabled`.
 * `secondary` is a documented extension covering DESIGN-LANGUAGE's
 * "secondary uses surface fill + borderStrong outline + text label"
 * component tone (other already-built molecules/organisms in this monorepo
 * depend on it); it is not part of the SPEC's locked 4-value enum. `tone=
 * "danger"` is a second extension for the ghost/text variants, covering the
 * spec's "Accept(primary)+Decline(ghost-danger)" pair pattern without
 * growing the variant enum further.
 *
 * radius.sm on every size (the design language's locked CTA radius).
 * Heights: lg=48 (h-12, the locked mobile primary tap target), md=44 (h-11,
 * meets the 44pt minimum touch target directly), sm=40 (h-10, the design
 * language's compact height) with hitSlop padding the effective target back
 * out to 44pt since the visual box is smaller.
 *
 * expo-haptics light impact fires on press for primary/destructive, the two
 * state-changing variants, not for secondary/ghost/text (non-committal
 * actions), per the task's "haptics light impact on primary actions" rule.
 */
const buttonVariants = cva('flex-row items-center justify-center gap-sm rounded-sm', {
  variants: {
    variant: {
      primary: 'bg-accent active:bg-accent-pressed',
      secondary: 'border border-border-strong bg-surface active:bg-surface-muted',
      destructive: 'bg-danger active:opacity-90',
      ghost: 'bg-transparent active:bg-surface-muted',
      text: 'bg-transparent active:opacity-70',
    },
    size: {
      lg: 'h-12 px-2xl',
      md: 'h-11 px-lg',
      sm: 'h-10 gap-xs px-md',
    },
  },
  defaultVariants: { variant: 'primary', size: 'lg' },
});

const buttonTextVariants = cva('text-center font-sans-semibold text-base', {
  variants: {
    variant: {
      primary: 'text-ink-on-accent',
      secondary: 'text-text',
      destructive: 'text-text-inverse',
      ghost: 'text-text',
      text: 'text-accent',
    },
    tone: {
      default: '',
      danger: '',
    },
  },
  compoundVariants: [
    { variant: 'ghost', tone: 'danger', class: 'text-danger' },
    { variant: 'text', tone: 'danger', class: 'text-danger' },
  ],
  defaultVariants: { variant: 'primary', tone: 'default' },
});

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;

const SPINNER_COLOR_KEY: Record<ButtonVariant, 'inkOnAccent' | 'textInverse' | 'text' | 'accent'> = {
  primary: 'inkOnAccent',
  secondary: 'text',
  destructive: 'textInverse',
  ghost: 'text',
  text: 'accent',
};

const HAPTIC_VARIANTS: ReadonlySet<ButtonVariant> = new Set(['primary', 'destructive']);

type ButtonProps = ComponentProps<typeof Pressable> &
  VariantProps<typeof buttonVariants> & {
    tone?: 'default' | 'danger';
    loading?: boolean;
  };

function Button({
  className,
  variant = 'primary',
  size = 'lg',
  tone = 'default',
  loading,
  disabled,
  onPress,
  children,
  ...props
}: ButtonProps) {
  const colors = useThemeColors();
  const spinnerColor = colors[SPINNER_COLOR_KEY[variant ?? 'primary']];
  const isDisabled = disabled || loading;

  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, tone })}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled, busy: loading }}
        hitSlop={size === 'sm' ? { top: 2, bottom: 2, left: 2, right: 2 } : undefined}
        disabled={isDisabled}
        onPress={(event) => {
          if (HAPTIC_VARIANTS.has(variant ?? 'primary')) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
              // Haptics unavailable (web, simulator without a haptic engine), not fatal.
            });
          }
          onPress?.(event);
        }}
        className={cn(buttonVariants({ variant, size }), isDisabled && 'opacity-50', className)}
        {...props}
      >
        {loading ? <ActivityIndicator color={spinnerColor} /> : children}
      </Pressable>
    </TextClassContext.Provider>
  );
}

export { Button, buttonTextVariants, buttonVariants };
export type { ButtonProps, ButtonVariant };
