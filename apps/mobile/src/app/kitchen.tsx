import { Redirect } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Divider } from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { OTPInput } from '@/components/ui/otp-input';
import { PriceText } from '@/components/ui/price-text';
import { GearResultCard } from '@/components/ui/gear-result-card';
import { GearResultTile } from '@/components/ui/gear-result-tile';
import { OfferRow } from '@/components/ui/offer-row';
import { ProductCard } from '@/components/ui/product-card';
import { SearchBar } from '@/components/ui/search-bar';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill, type Status } from '@/components/ui/status-pill';
import { Stepper } from '@/components/ui/stepper';
import { Text } from '@/components/ui/text';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';
import type { ColorPalette } from '@atlitos/theme';
import type { NumericVariant, TextVariant } from '@atlitos/theme';

/**
 * Kitchen sink component gallery. A guest reachable, dev only route (not in
 * the tab bar) that renders the real @atlitos design system in one scrollable
 * page so the founder can eyeball every color token, type ramp, button, and
 * primitive at once. Reached at atlitos://kitchen on the simulator and
 * localhost:8081/kitchen on web. Because every component reads from
 * useThemeColors, the whole page auto reflects light or dark from the device
 * appearance.
 */

const COLOR_TOKENS: Array<keyof ColorPalette> = [
  'bg',
  'surface',
  'surfaceMuted',
  'card',
  'overlay',
  'text',
  'textSecondary',
  'textTertiary',
  'textInverse',
  'border',
  'borderStrong',
  'accent',
  'accentPressed',
  'accentTint',
  'inkOnAccent',
  'brandOrange',
  'brandEmber',
  'success',
  'successTint',
  'warning',
  'warningTint',
  'info',
  'infoTint',
  'danger',
  'dangerTint',
];

const TEXT_VARIANTS: TextVariant[] = [
  'display',
  'title',
  'h1',
  'h2',
  'h3',
  'body',
  'callout',
  'label',
  'caption',
  'overline',
];

const NUMERIC_VARIANTS: NumericVariant[] = ['numericDisplay', 'numericLg', 'numericBase', 'numericSm'];

const STATUS_SAMPLES: Status[] = [
  'underReview',
  'verified',
  'pending',
  'confirmed',
  'completed',
  'cancelled',
  'rescheduled',
  'delivered',
  'shipped',
  'inTransit',
  'placed',
  'noShow',
  'expired',
  'requested',
  'accepted',
  'inProgress',
  'declined',
  'rated',
  'membershipActive',
  'membershipLapsed',
];

function SectionHeading({ title }: { title: string }) {
  return (
    <Text style={textStyle('h2')} className="mb-md mt-2xl text-text">
      {title}
    </Text>
  );
}

function Label({ children }: { children: string }) {
  return <Text className="mb-xs font-sans-semibold text-xs text-text-secondary">{children}</Text>;
}

function ColorSwatch({ name, value }: { name: string; value: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ width: 104 }} className="gap-xs">
      <View
        style={{ backgroundColor: value, borderColor: colors.border }}
        className="h-16 w-full rounded-md border"
      />
      <Text className="font-sans-semibold text-xs text-text">{name}</Text>
      <Text style={textStyle('numericSm')} className="text-text-secondary">
        {value}
      </Text>
    </View>
  );
}

// Dev only: a release build sends a deep link here back to the app root.
export default function KitchenRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <KitchenSink />;
}

function KitchenSink() {
  const colors = useThemeColors();
  const [otp, setOtp] = useState('12');
  const [rating, setRating] = useState(4);
  const [query, setQuery] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 80 }}
        showsVerticalScrollIndicator
      >
        <Text style={textStyle('title')} className="text-text">
          Kitchen Sink
        </Text>
        <Text className="mt-xs text-sm text-text-secondary">
          Every color, type style, button, and primitive in the Atlitos design system.
        </Text>

        {/* 1. COLORS */}
        <SectionHeading title="Colors" />
        <Text className="mb-md text-sm text-text-secondary">Toggle device appearance to see dark.</Text>
        <View className="flex-row flex-wrap gap-md">
          {COLOR_TOKENS.map((token) => (
            <ColorSwatch key={token} name={token} value={colors[token]} />
          ))}
        </View>

        {/* 2. TYPOGRAPHY */}
        <SectionHeading title="Typography" />
        <View className="gap-md">
          {TEXT_VARIANTS.map((variant) => (
            <View key={variant}>
              <Label>{variant}</Label>
              <Text style={textStyle(variant)} className="text-text">
                The quick brown fox
              </Text>
            </View>
          ))}
          <Divider />
          <Text className="font-sans-semibold text-sm text-text-secondary">Numeric (JetBrains Mono)</Text>
          {NUMERIC_VARIANTS.map((variant) => (
            <View key={variant}>
              <Label>{variant}</Label>
              <Text style={textStyle(variant)} className="text-text">
                1,234,567.89
              </Text>
            </View>
          ))}
        </View>

        {/* 3. BUTTONS */}
        <SectionHeading title="Buttons" />
        <View className="gap-lg">
          {(['primary', 'secondary', 'destructive', 'ghost', 'text'] as const).map((variant) => (
            <View key={variant} className="gap-sm">
              <Label>{variant}</Label>
              <View className="flex-row flex-wrap items-center gap-sm">
                <Button variant={variant} size="lg">
                  <Text>Large</Text>
                </Button>
                <Button variant={variant} size="md">
                  <Text>Medium</Text>
                </Button>
                <Button variant={variant} size="sm">
                  <Text>Small</Text>
                </Button>
              </View>
            </View>
          ))}

          <View className="gap-sm">
            <Label>loading and disabled</Label>
            <View className="flex-row flex-wrap items-center gap-sm">
              <Button variant="primary" loading>
                <Text>Loading</Text>
              </Button>
              <Button variant="secondary" loading>
                <Text>Loading</Text>
              </Button>
              <Button variant="primary" disabled>
                <Text>Disabled</Text>
              </Button>
            </View>
          </View>

          <View className="gap-sm">
            <Label>tone danger (ghost and text)</Label>
            <View className="flex-row flex-wrap items-center gap-sm">
              <Button variant="ghost" tone="danger">
                <Text>Decline</Text>
              </Button>
              <Button variant="text" tone="danger">
                <Text>Remove</Text>
              </Button>
            </View>
          </View>
        </View>

        {/* 4. CORE COMPONENTS */}
        <SectionHeading title="Core components" />

        <Label>Chip</Label>
        <View className="mb-lg flex-row flex-wrap gap-sm">
          <Chip label="Category" variant="category" />
          <Chip label="Filter" variant="filter" selected />
          <Chip label="Select" variant="select" selected />
          <Chip label="Disabled" variant="filter" disabled />
        </View>

        <Label>Input</Label>
        <View className="mb-lg gap-md">
          <Input type="text" label="Full name" placeholder="Jordan Rivera" />
          <Input type="password" label="Password" required placeholder="Enter a password" />
          <Input type="phone" label="Phone" placeholder="98765 43210" />
          <Input type="text" label="Email" error="Enter a valid email" placeholder="you@atlitos.app" />
          <Input type="multiline" label="Notes" placeholder="Anything the coach should know" />
        </View>

        <Label>Avatar (32, 40, 56, 80)</Label>
        <View className="mb-lg flex-row items-center gap-md">
          <Avatar name="Jordan Rivera" size={32} />
          <Avatar name="Jordan Rivera" size={40} />
          <Avatar name="Jordan Rivera" size={56} verifiedBadge />
          <Avatar name="Jordan Rivera" size={80} verifiedBadge />
        </View>

        <Label>StarRating</Label>
        <View className="mb-lg gap-sm">
          <StarRating mode="display" value={4.2} count={128} />
          <StarRating mode="input" value={rating} onChange={setRating} size={24} />
        </View>

        <Label>StatusPill</Label>
        <View className="mb-lg flex-row flex-wrap gap-sm">
          {STATUS_SAMPLES.map((status) => (
            <StatusPill key={status} status={status} />
          ))}
        </View>

        <Label>PriceText</Label>
        <View className="mb-lg flex-row items-center gap-md">
          <PriceText amount={231000} size="lg" />
          <PriceText amount={4999} size="base" />
          <PriceText amount={4999} size="sm" strike />
        </View>

        <Label>Card</Label>
        <Card className="mb-lg">
          <CardHeader>
            <CardTitle>Session with coach</CardTitle>
            <CardDescription>A soft rounded surface with a hairline border.</CardDescription>
          </CardHeader>
          <CardContent>
            <Text className="text-text-secondary">Card content sits here, using the surface token.</Text>
          </CardContent>
          <CardFooter>
            <Button variant="primary" size="sm">
              <Text>Confirm</Text>
            </Button>
            <Button variant="ghost" size="sm">
              <Text>Later</Text>
            </Button>
          </CardFooter>
        </Card>

        <Label>StatTile</Label>
        <View className="mb-lg flex-row gap-md">
          <StatTile label="Total sessions" value={100} />
          <StatTile label="Completion" value="82%" variant="progress" progress={0.82} />
        </View>

        <Label>Divider</Label>
        <View className="mb-lg gap-md">
          <Divider />
          <View className="h-8 flex-row items-center gap-md">
            <Text className="text-text-secondary">Left</Text>
            <Divider orientation="vertical" />
            <Text className="text-text-secondary">Right</Text>
          </View>
        </View>

        <Label>Skeleton</Label>
        <View className="mb-lg gap-md">
          <Skeleton shape="line" />
          <View className="flex-row items-center gap-md">
            <Skeleton shape="circle" />
            <Skeleton shape="tile" />
          </View>
          <Skeleton shape="card" />
        </View>

        <Label>OTPInput</Label>
        <View className="mb-lg">
          <OTPInput length={6} value={otp} onChange={setOtp} />
        </View>

        <Label>Stepper</Label>
        <View className="mb-lg">
          <Stepper steps={['Profile', 'Verify', 'Preferences', 'Done']} current={1} />
        </View>

        <Label>SearchBar</Label>
        <View className="mb-lg gap-md">
          <SearchBar variant="plain" value={query} onChangeText={setQuery} />
          <SearchBar variant="ai" />
        </View>

        <Label>ProductCard</Label>
        <View className="mb-lg" style={{ width: 180 }}>
          <ProductCard title="Pro grip pickleball paddle" price={4999} originalPrice={6499} variant="grid" />
        </View>

        <SectionHeading title="Shop search, direction A (rejected 17 Sep)" />
        <Label>GearResultCard, full and sparse</Label>
        <View className="mb-lg flex-row gap-md">
          <View style={{ flex: 1 }}>
            <GearResultCard
              imageUri="https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?w=400"
              brand="Yonex"
              title="Yonex Astrox 100 ZZ Badminton Racket"
              fromPrice={18500}
              storeCount={3}
              checkedHoursAgo={2}
            />
          </View>
          <View style={{ flex: 1 }}>
            <GearResultCard title="Cricket bat, Kashmir willow, size 5" fromPrice={null} storeCount={1} checkedHoursAgo={216} />
          </View>
        </View>

        <Label>GearResultCard, a grid of six</Label>
        <View className="mb-lg flex-row flex-wrap gap-md">
          {[
            ['Yonex', 'Yonex Nanoflare 1000 Play', 3700, 2, 5],
            ['Babolat', 'Babolat Pure Drive 2026', 14500, 2, 6],
            ['SG', 'SG Cobra Gold Kashmir Willow Bat', 2299, 3, 1],
            ['Nike', 'Nike Mercurial Vapor 16 Academy', 5995, 4, 12],
            ['Li-Ning', 'Li-Ning Axforce 80 Racket', 9450, 1, 30],
            ['Wilson', 'Wilson US Open Tennis Balls, 3 pack', 599, 3, 2],
          ].map(([brand, title, price, stores, hours]) => (
            <View key={String(title)} style={{ width: '47%' }}>
              <GearResultCard
                brand={String(brand)}
                title={String(title)}
                fromPrice={Number(price)}
                storeCount={Number(stores)}
                checkedHoursAgo={Number(hours)}
              />
            </View>
          ))}
        </View>

        <SectionHeading title="Shop search, direction C (Amazon)" />
        <Label>GearResultTile, a grid of six, full and sparse</Label>
        <View className="mb-lg flex-row flex-wrap" style={{ columnGap: 8, rowGap: 24 }}>
          {[
            ['https://m.media-amazon.com/images/I/71fbmu0JIeL._AC_UL320_.jpg', 'Yonex', 'Astrox 100 ZZ Badminton Racket, 4U G5, unstrung', 18500, 'Amazon.in', 3, null, 2],
            ['https://m.media-amazon.com/images/I/61q4BY4GqXL._AC_UL320_.jpg', 'Babolat', 'Pure Drive 2026 Tennis Racket, unstrung', 14500, 'Tennis Hub', 2, 15999, 6],
            [null, 'SG', 'Cobra Gold Kashmir Willow Cricket Bat, size 5', 2299, 'Flipkart', 3, null, 1],
            [null, 'Nike', 'Mercurial Vapor 16 Academy Football Boots', 5995, 'Decathlon', 4, 6495, 12],
            [null, null, 'Cricket bat, Kashmir willow, size 5', null, null, 1, null, 216],
            [null, 'Wilson', 'US Open Tennis Balls, pack of 3', 599, 'Amazon.in', 1, null, 2],
          ].map(([img, brand, title, price, retailer, stores, prev, hours]) => (
            <View key={String(title)} style={{ width: '48.5%' }}>
              <GearResultTile
                imageUri={img as string | null}
                brand={brand as string | null}
                title={String(title)}
                fromPrice={price as number | null}
                retailer={retailer as string | null}
                storeCount={Number(stores)}
                previousPrice={prev as number | null}
                checkedHoursAgo={Number(hours)}
              />
            </View>
          ))}
        </View>

        <Label>OfferRow dense, cheapest, other, out of stock</Label>
        <View className="mb-lg gap-sm">
          <OfferRow dense retailer="Tennis Hub" price={14500} inStock cheapest checkedHoursAgo={6} />
          <OfferRow dense retailer="Amazon.in" price={15499} inStock checkedHoursAgo={6} previousPrice={15999} />
          <OfferRow dense retailer="Decathlon" price={13990} inStock={false} checkedHoursAgo={288} />
        </View>

        <Label>OfferRow direction A, cheapest, other, out of stock</Label>
        <View className="mb-lg gap-sm">
          <OfferRow retailer="Tennis Hub" price={14500} inStock cheapest checkedHoursAgo={6} />
          <OfferRow retailer="Amazon.in" price={15499} inStock checkedHoursAgo={6} previousPrice={15999} />
          <OfferRow retailer="Decathlon" price={13990} inStock={false} checkedHoursAgo={288} />
        </View>

        <Text className="mt-2xl text-xs text-text-tertiary">
          Skipped: coach card, court card, session card, upa card. Each is tightly coupled to a live entity
          shape, so they are left out of this gallery rather than faked.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
