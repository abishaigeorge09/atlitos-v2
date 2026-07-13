import { cn } from '@/lib/utils';
import { Slot } from '@rn-primitives/slot';
import * as React from 'react';
import { Text as RNText } from 'react-native';

/**
 * react-native-reusables Text primitive, trimmed to this proof spike's
 * needs. Full app screens keep using src/theme/text-style.ts (`textStyle`)
 * for the @atlitos/theme typography scale (display/title/h1/body/...), this
 * component only exists so className based UI primitives (Button, Card) can
 * propagate a Tailwind text color/className to their child <Text> via
 * TextClassContext, the pattern react-native-reusables components expect.
 */
const TextClassContext = React.createContext<string | undefined>(undefined);

function Text({
  className,
  asChild = false,
  ...props
}: React.ComponentProps<typeof RNText> & { asChild?: boolean }) {
  const textClass = React.useContext(TextClassContext);
  const Component = asChild ? Slot : RNText;
  return <Component className={cn('text-base text-text', textClass, className)} {...props} />;
}

export { Text, TextClassContext };
