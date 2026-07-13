import { Text } from '@/components/ui/text';
import { cn } from '@/lib/utils';
import { formatINR } from '@atlitos/theme';
import type { Transaction } from '@atlitos/types';
import { Pressable, View } from 'react-native';

export interface TransactionRowProps {
  transaction: Transaction;
  onPress?: () => void;
}

/**
 * SPEC #27: name, date + frequency tag chip (One-time/Monthly), signed
 * amount. Credit rows render green, debit rows render default ink, per v1
 * convention. Row tap is an optional extension (source detail via
 * transaction.kind + refId), rows render identically when omitted.
 */
export function TransactionRow({ transaction, onPress }: TransactionRowProps) {
  const isCredit = transaction.direction === 'credit';
  const date = new Date(transaction.createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      role={onPress ? 'button' : undefined}
      className="min-h-11 flex-row items-center justify-between gap-md py-sm active:opacity-70"
    >
      <View className="flex-1 gap-xs">
        <Text className="text-sm text-text" numberOfLines={1}>
          {transaction.label}
        </Text>
        <View className="flex-row items-center gap-sm">
          <Text className="text-xs text-text-tertiary">{date}</Text>
          {transaction.frequencyTag ? (
            <View className="rounded-pill bg-surface-muted px-sm py-0.5">
              <Text className="font-sans-semibold text-xs text-text-secondary">
                {transaction.frequencyTag === 'one_time' ? 'One time' : 'Monthly'}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <Text className={cn('font-mono-semibold text-base', isCredit ? 'text-success' : 'text-text')}>
        {isCredit ? '+' : '-'}
        {formatINR(transaction.amount)}
      </Text>
    </Pressable>
  );
}

export default TransactionRow;
