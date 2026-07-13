import { Text, TextClassContext } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import type { ComponentProps } from 'react';
import { View } from 'react-native';

/**
 * react-native-reusables Card, adapted to Atlitos tokens: radius.xl
 * (rounded-xl -> 20px via tailwind.config.js), surface/border colors from
 * @atlitos/theme, per DESIGN-LANGUAGE.md's "Cards: soft rounded (lg/xl),
 * hairline border in light mode".
 */
function Card({ className, ...props }: ComponentProps<typeof View>) {
  return (
    <TextClassContext.Provider value="text-text">
      <View
        className={cn('flex flex-col gap-md rounded-xl border border-border bg-card p-lg', className)}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

function CardHeader({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn('flex flex-col gap-xs', className)} {...props} />;
}

function CardTitle({ className, ...props }: ComponentProps<typeof Text>) {
  return (
    <Text
      role="heading"
      aria-level={3}
      className={cn('font-sans-semibold text-xl leading-tight', className)}
      {...props}
    />
  );
}

function CardDescription({ className, ...props }: ComponentProps<typeof Text>) {
  return <Text className={cn('text-sm text-text-secondary', className)} {...props} />;
}

function CardContent({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn(className)} {...props} />;
}

function CardFooter({ className, ...props }: ComponentProps<typeof View>) {
  return <View className={cn('flex flex-row items-center gap-sm', className)} {...props} />;
}

export { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle };
