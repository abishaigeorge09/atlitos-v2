import { radii, spacing } from '@atlitos/theme';
import type { Clip, TimeSlot, Transaction } from '@atlitos/types';
import {
  Award,
  Dumbbell,
  Monitor,
  Moon,
  PackageSearch,
  Sun,
  Trophy,
} from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Appearance, ScrollView, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdBannerCarousel } from '@/components/molecules/AdBannerCarousel';
import { BillSummary } from '@/components/molecules/BillSummary';
import { CalendarPicker } from '@/components/molecules/CalendarPicker';
import { ClutchPostCard } from '@/components/molecules/ClutchPostCard';
import { MilestoneChip } from '@/components/molecules/MilestoneChip';
import { OrderTimeline } from '@/components/molecules/OrderTimeline';
import { RequestSupportForm } from '@/components/molecules/RequestSupportForm';
import { SlotPicker } from '@/components/molecules/SlotPicker';
import { TransactionRow } from '@/components/molecules/TransactionRow';
import { BookingConfirmation } from '@/components/organisms/BookingConfirmation';
import { CoachProfileSheet } from '@/components/organisms/CoachProfileSheet';
import { CommentsSheet } from '@/components/organisms/CommentsSheet';
import { DonationSheet } from '@/components/organisms/DonationSheet';
import { EarningsHeader } from '@/components/organisms/EarningsHeader';
import { EmptyState } from '@/components/organisms/EmptyState';
import { LoginGateSheet } from '@/components/organisms/LoginGateSheet';
import { ProfileWizard } from '@/components/organisms/ProfileWizard';
import { RateReviewForm } from '@/components/organisms/RateReviewForm';
import { SearchResults } from '@/components/organisms/SearchResults';
import { WishlistGrid } from '@/components/organisms/WishlistGrid';
import { AppBar } from '@/components/ui/app-bar';
import { Avatar } from '@/components/ui/avatar';
import { BottomNav, type BottomNavTab } from '@/components/ui/bottom-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { CoachCard } from '@/components/ui/coach-card';
import { CourtCard } from '@/components/ui/court-card';
import { Divider } from '@/components/ui/divider';
import { Input } from '@/components/ui/input';
import { LocationBar } from '@/components/ui/location-bar';
import { OTPInput } from '@/components/ui/otp-input';
import { PriceText } from '@/components/ui/price-text';
import { ProductCard } from '@/components/ui/product-card';
import { SearchBar } from '@/components/ui/search-bar';
import { SessionCard } from '@/components/ui/session-card';
import { Skeleton } from '@/components/ui/skeleton';
import { StarRating } from '@/components/ui/star-rating';
import { StatTile } from '@/components/ui/stat-tile';
import { StatusPill } from '@/components/ui/status-pill';
import { Stepper } from '@/components/ui/stepper';
import { Text as UIText } from '@/components/ui/text';
import { TrainingsSubNav } from '@/components/ui/trainings-sub-nav';
import { UPACard } from '@/components/ui/upa-card';
import { textStyle } from '@/theme/text-style';
import { useThemeColors } from '@/theme/use-theme-colors';

/**
 * Dev states gallery. Renders every component in packages src/components
 * (ui/molecules/organisms), the 42 numbered components locked by SPEC.md's
 * component library plus the react-native-reusables Card proof from
 * PHASE-1-SPIKE.md and the Text primitive both of those depend on, in every
 * variant and every state the component actually exposes (loading, empty,
 * populated, error, where the component has one). This is the biased
 * approver's visual evidence surface for the phase gate, not a screen an
 * athlete ever sees; it is intentionally dense, not laid out like a product
 * screen.
 *
 * Components with no error affordance in their locked API (most molecules
 * and organisms describe a display or success state only, no per component
 * network error prop) do not get a fabricated error state here, the section
 * note says so instead of inventing one. Sheet shaped organisms
 * (CoachProfileSheet, CommentsSheet, DonationSheet, LoginGateSheet) are
 * previewed inside a fixed height framed card rather than full screen, they
 * are bottom sheets in the real app, not standalone screens.
 *
 * Theme toggle at the top calls `Appearance.setColorScheme`, which both
 * react-native's own `useColorScheme` (what `useThemeColors` reads) and
 * nativewind's `dark:` class resolution subscribe to, so one call flips
 * every component on this screen regardless of which of the two token
 * patterns it uses. No ThemeProvider needed, matching PHASE-1-SPIKE.md's
 * finding that one was not required.
 */

type ThemePreference = 'light' | 'dark' | 'system';

function ThemeToggle() {
  const colors = useThemeColors();
  const systemScheme = useColorScheme();
  const [preference, setPreference] = useState<ThemePreference>('system');

  const cyclePreference = () => {
    const next: ThemePreference =
      preference === 'system' ? 'light' : preference === 'light' ? 'dark' : 'system';
    setPreference(next);
    Appearance.setColorScheme(next === 'system' ? 'unspecified' : next);
  };

  const Icon = preference === 'system' ? Monitor : preference === 'light' ? Sun : Moon;
  const label =
    preference === 'system' ? `System (${systemScheme ?? 'light'})` : preference === 'light' ? 'Light' : 'Dark';

  return (
    <Button variant="secondary" size="sm" onPress={cyclePreference}>
      <Icon size={16} strokeWidth={1.75} color={colors.text} />
      <UIText className="text-sm">{label}</UIText>
    </Button>
  );
}

function Eyebrow({ number, name, note }: { number: string; name: string; note?: string }) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
        <View
          style={{
            borderRadius: radii.xs,
            backgroundColor: colors.accentTint,
            paddingHorizontal: spacing.sm,
            paddingVertical: 2,
          }}
        >
          <Text style={[textStyle('overline'), { color: colors.accent }]}>{number}</Text>
        </View>
        <Text style={[textStyle('overline'), { color: colors.textTertiary }]}>{name}</Text>
      </View>
      {note ? (
        <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{note}</Text>
      ) : null}
    </View>
  );
}

function Section({
  number,
  name,
  note,
  children,
}: {
  number: string;
  name: string;
  note?: string;
  children: ReactNode;
}) {
  const colors = useThemeColors();
  return (
    <View style={{ gap: spacing.md, paddingVertical: spacing.xl }}>
      <Eyebrow number={number} name={name} note={note} />
      <View style={{ gap: spacing.lg }}>{children}</View>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginTop: spacing.md }} />
    </View>
  );
}

function StateLabel({ children }: { children: ReactNode }) {
  const colors = useThemeColors();
  return <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>{children}</Text>;
}

function Row({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>{children}</View>;
}

function Frame({ height, children }: { height: number; children: ReactNode }) {
  const colors = useThemeColors();
  return (
    <View
      style={{
        height,
        borderRadius: radii.xl,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.bg,
        overflow: 'hidden',
      }}
    >
      {children}
    </View>
  );
}

// Mock data ------------------------------------------------------------

const AVATAR_URI = 'https://picsum.photos/seed/atlitos-avatar/200/200';
const COURT_IMAGE = 'https://picsum.photos/seed/atlitos-court/600/400';
const PRODUCT_IMAGE = 'https://picsum.photos/seed/atlitos-product/500/500';
const UPA_IMAGE = 'https://picsum.photos/seed/atlitos-upa/600/400';
const CLIP_THUMB = 'https://picsum.photos/seed/atlitos-clip/450/800';
const BANNER_A = 'https://picsum.photos/seed/atlitos-banner-a/900/400';
const BANNER_B = 'https://picsum.photos/seed/atlitos-banner-b/900/400';

const TIME_SLOTS: TimeSlot[] = [
  { from: '06:00', to: '07:00' },
  { from: '07:00', to: '08:00' },
  { from: '17:00', to: '18:00' },
  { from: '18:00', to: '19:00' },
  { from: '19:00', to: '20:00' },
];

const MOCK_CLIP: Clip = {
  id: 'clip-1',
  ownerId: 'user-1',
  channel: 'Cric World',
  thumbUrl: CLIP_THUMB,
  caption: 'Match winning six in the last over',
  sport: 'cricket',
  status: 'published',
  likes: 482,
  commentCount: 36,
  createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
  likedByMe: true,
  topComment: { id: 'c1', clipId: 'clip-1', userId: 'u2', username: 'ravi_k', text: 'What a shot', createdAt: '' },
};

const MOCK_TRANSACTION_CREDIT: Transaction = {
  id: 'tx-1',
  userId: 'user-1',
  kind: 'session',
  label: 'Coaching session with Arjun Mehta',
  amount: 1200,
  direction: 'credit',
  frequencyTag: 'one_time',
  createdAt: new Date().toISOString(),
};

const MOCK_TRANSACTION_DEBIT: Transaction = {
  id: 'tx-2',
  userId: 'user-1',
  kind: 'commerce',
  label: 'Order, Yonex badminton racket',
  amount: 3499,
  direction: 'debit',
  frequencyTag: 'monthly',
  createdAt: new Date().toISOString(),
};

export default function GalleryScreen() {
  const colors = useThemeColors();

  const [bottomTab, setBottomTab] = useState<BottomNavTab>('home');
  const [subNavTab, setSubNavTab] = useState<'stats' | 'coaches' | 'trainees' | 'payments' | 'earnings' | 'chat' | 'analytics'>(
    'stats',
  );
  const [chipSelected, setChipSelected] = useState(true);
  const [otp, setOtp] = useState('42');
  const [starInput, setStarInput] = useState(3);
  const [calendarDate, setCalendarDate] = useState<string | undefined>(undefined);
  const [slot, setSlot] = useState<TimeSlot | undefined>(undefined);
  const [wizardStep, setWizardStep] = useState(1);
  const [donationChecked, setDonationChecked] = useState(true);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: spacing.lg,
          paddingVertical: spacing.md,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <View>
          <Text style={[textStyle('h3'), { color: colors.text }]}>States gallery</Text>
          <Text style={[textStyle('caption'), { color: colors.textTertiary }]}>
            42 components, every variant and state
          </Text>
        </View>
        <ThemeToggle />
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingBottom: spacing['5xl'] }}
        showsVerticalScrollIndicator={false}
      >
        {/* 01 Button */}
        <Section number="01" name="Button" note="variant x size, plus loading and disabled states">
          <StateLabel>Populated, variant x size</StateLabel>
          <Row>
            <Button variant="primary" size="lg"><UIText>Primary lg</UIText></Button>
            <Button variant="primary" size="md"><UIText>Primary md</UIText></Button>
            <Button variant="primary" size="sm"><UIText>Primary sm</UIText></Button>
          </Row>
          <Row>
            <Button variant="secondary" size="lg"><UIText>Secondary</UIText></Button>
            <Button variant="destructive" size="lg"><UIText>Destructive</UIText></Button>
            <Button variant="ghost" size="lg"><UIText>Ghost</UIText></Button>
            <Button variant="text" size="lg"><UIText>Text</UIText></Button>
          </Row>
          <Row>
            <Button variant="ghost" tone="danger" size="md"><UIText>Ghost danger</UIText></Button>
            <Button variant="text" tone="danger" size="md"><UIText>Text danger</UIText></Button>
          </Row>
          <StateLabel>Loading</StateLabel>
          <Row>
            <Button variant="primary" loading><UIText>Confirm</UIText></Button>
            <Button variant="secondary" loading><UIText>Confirm</UIText></Button>
          </Row>
          <StateLabel>Disabled</StateLabel>
          <Row>
            <Button variant="primary" disabled><UIText>Confirm</UIText></Button>
            <Button variant="secondary" disabled><UIText>Confirm</UIText></Button>
          </Row>
        </Section>

        {/* 02 Input */}
        <Section number="02" name="Input" note="type x label/required, populated, empty and error">
          <StateLabel>Empty</StateLabel>
          <Input type="text" label="Full name" placeholder="Enter your name" required />
          <StateLabel>Populated</StateLabel>
          <Input type="text" label="Full name" defaultValue="Arjun Mehta" required />
          <StateLabel>Password</StateLabel>
          <Input type="password" label="Password" defaultValue="hunter2hunter" />
          <StateLabel>Phone and pincode</StateLabel>
          <Input type="phone" label="Phone number" defaultValue="9876543210" />
          <Input type="pincode" label="Pincode" defaultValue="560001" />
          <StateLabel>Multiline</StateLabel>
          <Input type="multiline" label="Notes" placeholder="Add a note" />
          <StateLabel>Error</StateLabel>
          <Input type="text" label="Email" defaultValue="not-an-email" error="Enter a valid email address" />
        </Section>

        {/* 03 OTPInput */}
        <Section number="03" name="OTPInput" note="populated and error">
          <StateLabel>Populated</StateLabel>
          <OTPInput value={otp} onChange={setOtp} />
          <StateLabel>Error</StateLabel>
          <OTPInput value="42" onChange={() => {}} error />
        </Section>

        {/* 04 SearchBar */}
        <Section number="04" name="SearchBar" note="plain and ai variant, empty and populated">
          <StateLabel>Plain, empty</StateLabel>
          <SearchBar variant="plain" />
          <StateLabel>AI, populated</StateLabel>
          <SearchBar variant="ai" defaultValue="under 19 badminton coach near me" />
        </Section>

        {/* 05 Chip */}
        <Section number="05" name="Chip" note="category, filter and select, selected and unselected">
          <Row>
            <Chip label="Cricket" variant="category" selected={chipSelected} onPress={() => setChipSelected((v) => !v)} />
            <Chip label="Football" variant="category" selected={false} />
            <Chip label="Under 30 min" variant="filter" selected />
            <Chip label="Verified only" variant="filter" selected={false} />
            <Chip label="Beginner" variant="select" selected />
            <Chip label="Advanced" variant="select" selected={false} />
            <Chip label="Unavailable" variant="category" selected={false} disabled />
          </Row>
        </Section>

        {/* 06 StarRating */}
        <Section number="06" name="StarRating" note="display and input mode">
          <StateLabel>Display, with count</StateLabel>
          <StarRating mode="display" value={4.2} count={318} />
          <StateLabel>Input, live</StateLabel>
          <StarRating mode="input" value={starInput} onChange={setStarInput} size={28} />
        </Section>

        {/* 07 Avatar */}
        <Section number="07" name="Avatar" note="sizes, photo vs initials, verified badge">
          <Row>
            <Avatar uri={AVATAR_URI} size={32} />
            <Avatar uri={AVATAR_URI} size={40} />
            <Avatar uri={AVATAR_URI} size={56} verifiedBadge />
            <Avatar uri={AVATAR_URI} size={80} verifiedBadge />
          </Row>
          <StateLabel>No photo, initials fallback</StateLabel>
          <Row>
            <Avatar name="Priya Nair" size={40} />
            <Avatar name="Rohit Sharma" size={56} verifiedBadge />
          </Row>
        </Section>

        {/* 08 StatusPill */}
        <Section number="08" name="StatusPill" note="every status in the locked enum">
          <Row>
            <StatusPill status="underReview" />
            <StatusPill status="verified" />
            <StatusPill status="pending" />
            <StatusPill status="completed" />
            <StatusPill status="cancelled" />
            <StatusPill status="rescheduled" />
            <StatusPill status="delivered" />
            <StatusPill status="shipped" />
          </Row>
        </Section>

        {/* 09 PriceText */}
        <Section number="09" name="PriceText" note="size scale, plus struck discount pairing">
          <Row>
            <PriceText amount={2500} size="sm" />
            <PriceText amount={2500} size="base" />
            <PriceText amount={231000} size="lg" />
          </Row>
          <StateLabel>Discount pair</StateLabel>
          <Row>
            <PriceText amount={3499} strike size="sm" />
            <PriceText amount={2799} size="base" />
          </Row>
        </Section>

        {/* 10 Stepper */}
        <Section number="10" name="Stepper" note="first, middle and last step active">
          <Stepper steps={['Sport', 'Profile', 'Availability', 'Review']} current={0} />
          <Stepper steps={['Sport', 'Profile', 'Availability', 'Review']} current={2} />
          <Stepper steps={['Sport', 'Profile', 'Availability', 'Review']} current={3} />
        </Section>

        {/* 11 Divider */}
        <Section number="11" name="Divider" note="horizontal and vertical">
          <Divider />
          <View style={{ flexDirection: 'row', height: 32, alignItems: 'center', gap: spacing.md }}>
            <UIText>Left</UIText>
            <Divider orientation="vertical" />
            <UIText>Right</UIText>
          </View>
        </Section>

        {/* 12 Skeleton */}
        <Section number="12" name="Skeleton" note="loading state for every shape">
          <StateLabel>Loading</StateLabel>
          <Row>
            <Skeleton shape="circle" />
            <Skeleton shape="tile" />
          </Row>
          <Skeleton shape="line" />
          <Skeleton shape="line" width="60%" />
          <Skeleton shape="card" />
        </Section>

        {/* 13 AppBar */}
        <Section number="13" name="AppBar" note="brand, brand life, back and back with title">
          <Frame height={56}>
            <AppBar variant="brand" hasUnreadNotifications avatarUri={AVATAR_URI} />
          </Frame>
          <Frame height={56}>
            <AppBar variant="brandLife" avatarUri={AVATAR_URI} />
          </Frame>
          <Frame height={56}>
            <AppBar variant="back" />
          </Frame>
          <Frame height={56}>
            <AppBar variant="backTitle" title="Session details" />
          </Frame>
        </Section>

        {/* 14 BottomNav */}
        <Section number="14" name="BottomNav" note="each tab active in turn">
          <Frame height={72}>
            <BottomNav activeTab={bottomTab} onTabPress={setBottomTab} />
          </Frame>
        </Section>

        {/* 15 TrainingsSubNav */}
        <Section number="15" name="TrainingsSubNav" note="player role and coach role tab sets">
          <StateLabel>Player</StateLabel>
          <Frame height={48}>
            <TrainingsSubNav role="player" active={subNavTab} onChange={setSubNavTab} />
          </Frame>
          <StateLabel>Coach</StateLabel>
          <Frame height={48}>
            <TrainingsSubNav role="coach" active="trainees" onChange={() => {}} />
          </Frame>
        </Section>

        {/* 16 LocationBar */}
        <Section number="16" name="LocationBar">
          <LocationBar location="Koramangala, Bengaluru" />
        </Section>

        {/* 17 StatTile */}
        <Section number="17" name="StatTile" note="default and progress variant">
          <Row>
            <StatTile label="Total sessions" value={100} icon={Dumbbell} />
            <StatTile label="Badges earned" value={12} icon={Trophy} variant="progress" progress={0.6} />
          </Row>
        </Section>

        {/* 18 SessionCard */}
        <Section number="18" name="SessionCard" note="upcoming, request (accept or decline) and history">
          <SessionCard
            variant="upcoming"
            date="12 Aug"
            timeSlot="6:00 PM to 7:00 PM"
            personName="Arjun Mehta"
            sessionType="1:1"
            focusArea="Batting technique"
            location="SRM Sports Arena"
          />
          <SessionCard
            variant="request"
            date="14 Aug"
            timeSlot="7:00 AM to 8:00 AM"
            personName="Priya Nair"
            sessionType="1:1"
            focusArea="Footwork drills"
            location="Koramangala Turf"
            onAccept={() => {}}
            onDecline={() => {}}
          />
          <SessionCard
            variant="history"
            date="2 Jul"
            timeSlot="5:00 PM to 6:00 PM"
            personName="Rohit Sharma"
            sessionType="Group"
            focusArea="Match simulation"
            location="HSR Courts"
          />
        </Section>

        {/* 19 CoachCard */}
        <Section number="19" name="CoachCard">
          <CoachCard
            avatarUri={AVATAR_URI}
            name="Arjun Mehta"
            rating={4.7}
            sport="Cricket"
            experienceYears={8}
            priceFrom={800}
            distanceKm={2.4}
          />
        </Section>

        {/* 20 CourtCard */}
        <Section number="20" name="CourtCard">
          <CourtCard imageUri={COURT_IMAGE} name="SRM Sports Arena" location="Koramangala, Bengaluru" pricePerHour={900} />
        </Section>

        {/* 21 ProductCard */}
        <Section number="21" name="ProductCard" note="grid, row and cartLine, wishlisted and not">
          <StateLabel>Grid</StateLabel>
          <Row>
            <View style={{ width: 180 }}>
              <ProductCard imageUri={PRODUCT_IMAGE} title="Yonex Astrox 88D badminton racket" price={12999} originalPrice={15999} wishlisted variant="grid" />
            </View>
            <View style={{ width: 180 }}>
              <ProductCard imageUri={PRODUCT_IMAGE} title="Cricket kit bag" price={3499} variant="grid" />
            </View>
          </Row>
          <StateLabel>Row</StateLabel>
          <ProductCard imageUri={PRODUCT_IMAGE} title="Nivia football, size 5" price={899} variant="row" />
          <StateLabel>Cart line</StateLabel>
          <ProductCard imageUri={PRODUCT_IMAGE} title="Nivia football, size 5" price={899} quantity={2} variant="cartLine" />
        </Section>

        {/* 22 UPACard */}
        <Section number="22" name="UPACard" note="home variant and hub variant with funding progress">
          <UPACard photoUri={UPA_IMAGE} name="Meena K" headline="Aspiring badminton player from Hubli, needs a racket and coaching support" variant="home" />
          <UPACard
            photoUri={UPA_IMAGE}
            name="Meena K"
            headline="Aspiring badminton player from Hubli, needs a racket and coaching support"
            variant="hub"
            raisedAmount={18000}
            goalAmount={40000}
          />
        </Section>

        {/* 23 ClutchPostCard */}
        <Section number="23" name="ClutchPostCard" note="feed variant and thumb grid variant">
          <StateLabel>Feed</StateLabel>
          <Frame height={420}>
            <ClutchPostCard clip={MOCK_CLIP} variant="feed" />
          </Frame>
          <StateLabel>Thumb grid</StateLabel>
          <Row>
            <View style={{ width: 110, height: 110 }}>
              <ClutchPostCard clip={MOCK_CLIP} variant="thumb" />
            </View>
            <View style={{ width: 110, height: 110 }}>
              <ClutchPostCard clip={{ ...MOCK_CLIP, id: 'clip-2', likes: 12 }} variant="thumb" />
            </View>
          </Row>
        </Section>

        {/* 24 MilestoneChip */}
        <Section number="24" name="MilestoneChip" note="earned and locked">
          <Row>
            <MilestoneChip iconName="Trophy" label="First win" earned />
            <MilestoneChip iconName="Flame" label="5 day streak" earned />
            <MilestoneChip iconName="Target" label="50 sessions" earned={false} />
            <MilestoneChip iconName="UnknownIcon" label="Unmapped icon fallback" earned />
          </Row>
        </Section>

        {/* 25 BillSummary */}
        <Section number="25" name="BillSummary" note="the shared money pattern, with and without the donation row">
          <BillSummary
            rows={[
              { label: 'Court, 1 hour', amount: 900 },
              { label: 'Convenience fee', amount: 40, emphasis: 'muted' },
            ]}
            donationRow={{ label: 'Round up for UPA fund', amount: 60, checked: donationChecked, onToggle: () => setDonationChecked((v) => !v) }}
            total={1000}
          />
          <Divider />
          <BillSummary rows={[{ label: 'Coaching session', amount: 1200 }]} total={1200} />
        </Section>

        {/* 26 OrderTimeline */}
        <Section number="26" name="OrderTimeline">
          <OrderTimeline
            events={[
              { date: 'May 18', event: 'Order placed', location: 'Bengaluru, KA' },
              { date: 'May 19', event: 'Order has been shipped', location: 'Delhi, DL' },
              { date: 'May 20', event: 'Out for delivery', location: 'Bengaluru, KA' },
            ]}
          />
        </Section>

        {/* 27 TransactionRow */}
        <Section number="27" name="TransactionRow" note="credit and debit, monthly and one time">
          <TransactionRow transaction={MOCK_TRANSACTION_CREDIT} />
          <Divider />
          <TransactionRow transaction={MOCK_TRANSACTION_DEBIT} />
        </Section>

        {/* 28 CalendarPicker */}
        <Section number="28" name="CalendarPicker" note="past dates disabled, selected day in accent">
          <CalendarPicker value={calendarDate} onChange={setCalendarDate} />
        </Section>

        {/* 29 SlotPicker */}
        <Section number="29" name="SlotPicker" note="selected, disabled and open slots">
          <SlotPicker slots={TIME_SLOTS} value={slot} onChange={setSlot} disabledSlots={[TIME_SLOTS[1]]} />
        </Section>

        {/* 30 AdBannerCarousel */}
        <Section number="30" name="AdBannerCarousel" note="promo and productGallery variant, empty renders nothing">
          <StateLabel>Promo</StateLabel>
          <AdBannerCarousel
            banners={[
              { id: 'b1', imageUrl: BANNER_A },
              { id: 'b2', imageUrl: BANNER_B },
            ]}
            variant="promo"
          />
          <StateLabel>Product gallery</StateLabel>
          <View style={{ width: 220 }}>
            <AdBannerCarousel banners={[{ id: 'p1', imageUrl: PRODUCT_IMAGE }]} variant="productGallery" />
          </View>
          <StateLabel>Empty (renders null, no crash)</StateLabel>
          <AdBannerCarousel banners={[]} />
        </Section>

        {/* 31 RequestSupportForm */}
        <Section number="31" name="RequestSupportForm" note="empty and submitting">
          <StateLabel>Empty</StateLabel>
          <RequestSupportForm onSubmit={() => {}} />
          <StateLabel>Submitting</StateLabel>
          <RequestSupportForm onSubmit={() => {}} submitting />
        </Section>

        {/* 32 CoachProfileSheet */}
        <Section number="32" name="CoachProfileSheet" note="framed as a sheet preview, scrollable inside">
          <Frame height={520}>
            <CoachProfileSheet
              name="Arjun Mehta"
              sport="Cricket"
              avatarUrl={AVATAR_URI}
              rating={4.7}
              ratingCount={128}
              experienceYears={8}
              specializations={['Batting', 'Fielding', 'Fitness']}
              sessionsOffered={[
                { label: '1:1 coaching', duration: '60 min', price: 1200 },
                { label: 'Group coaching', duration: '90 min', price: 600 },
              ]}
              availability={['Mon, 6 to 8 AM', 'Wed, 6 to 8 AM', 'Sat, 4 to 6 PM']}
              pricingTiers={[
                { label: 'Single session', price: 1200 },
                { label: '10 session pack', price: 10500, description: 'Save 12 percent' },
              ]}
              onBookSession={() => {}}
              onMessageCoach={() => {}}
            />
          </Frame>
        </Section>

        {/* 33 BookingConfirmation */}
        <Section number="33" name="BookingConfirmation" note="success state, with and without a secondary action">
          <BookingConfirmation
            title="Booking confirmed"
            message="Your court is reserved and ready."
            bookingId="ATL2409188"
            lines={[
              { label: 'Court, 1 hour', amount: '₹900' },
              { label: 'Convenience fee', amount: '₹40' },
            ]}
            total="₹940"
            primaryLabel="View booking"
            onPrimaryPress={() => {}}
            secondaryLabel="Explore more"
            onSecondaryPress={() => {}}
          />
        </Section>

        {/* 34 RateReviewForm */}
        <Section number="34" name="RateReviewForm" note="input state and submitted success state">
          <StateLabel>Input</StateLabel>
          <RateReviewForm entityName="Arjun Mehta" entitySubtitle="Cricket coach" bookingId="ATL2409188" onSubmit={() => {}} />
          <StateLabel>Submitted</StateLabel>
          <RateReviewForm entityName="Arjun Mehta" entitySubtitle="Cricket coach" bookingId="ATL2409188" onSubmit={() => {}} submitted />
        </Section>

        {/* 35 EarningsHeader */}
        <Section number="35" name="EarningsHeader" note="player (no pending) and coach (with pending)">
          <EarningsHeader balance={24500} thisMonth={8200} onSend={() => {}} onTransfer={() => {}} />
          <EarningsHeader balance={24500} thisMonth={8200} pending={1500} onSend={() => {}} onTransfer={() => {}} />
        </Section>

        {/* 36 ProfileWizard */}
        <Section number="36" name="ProfileWizard" note="middle step, framed">
          <Frame height={280}>
            <ProfileWizard
              steps={[
                { id: 'sport', label: 'Sport', content: <UIText className="p-lg">Pick your primary sport</UIText> },
                { id: 'profile', label: 'Profile', content: <UIText className="p-lg">Add your name and photo</UIText> },
                { id: 'review', label: 'Review', content: <UIText className="p-lg">Confirm your details</UIText> },
              ]}
              currentIndex={wizardStep}
              onNext={() => setWizardStep((s) => Math.min(2, s + 1))}
              onBack={() => setWizardStep((s) => Math.max(0, s - 1))}
              onFinish={() => {}}
            />
          </Frame>
        </Section>

        {/* 37 LoginGateSheet */}
        <Section number="37" name="LoginGateSheet">
          <Frame height={260}>
            <LoginGateSheet onLogin={() => {}} onRegister={() => {}} onClose={() => {}} />
          </Frame>
        </Section>

        {/* 38 SearchResults */}
        <Section number="38" name="SearchResults" note="populated with segments, and empty">
          <StateLabel>Populated</StateLabel>
          <Frame height={360}>
            <SearchResults
              query="badminton coach"
              segments={['coaches', 'courts']}
              activeSegment="coaches"
              onSegmentChange={() => {}}
              results={[
                { id: 'r1', title: 'Arjun Mehta', subtitle: 'Cricket, 8 yrs experience', imageUrl: AVATAR_URI, price: '₹800', rankReason: 'Near you', onPress: () => {} },
                { id: 'r2', title: 'Priya Nair', subtitle: 'Badminton, 5 yrs experience', imageUrl: AVATAR_URI, price: '₹600', onPress: () => {} },
              ]}
            />
          </Frame>
          <StateLabel>Empty</StateLabel>
          <Frame height={160}>
            <SearchResults query="curling instructor" results={[]} emptyLabel="No results, try a different sport or location." />
          </Frame>
        </Section>

        {/* 39 DonationSheet */}
        <Section number="39" name="DonationSheet" note="preset amount selected and fund a specific item">
          <Frame height={520}>
            <DonationSheet causeTitle="Meena K, badminton fund" presetAmounts={[100, 250, 500, 1000]} platformFee={20} onDonate={() => {}} />
          </Frame>
          <Frame height={560}>
            <DonationSheet
              causeTitle="Meena K, badminton fund"
              presetAmounts={[100, 250, 500]}
              fundItem={{ label: 'Racket and shuttlecocks', cost: 4500 }}
              platformFee={20}
              onDonate={() => {}}
            />
          </Frame>
        </Section>

        {/* 40 WishlistGrid */}
        <Section number="40" name="WishlistGrid" note="product variant and upa variant with funding progress">
          <StateLabel>Product</StateLabel>
          <Frame height={280}>
            <WishlistGrid
              variant="product"
              items={[
                { kind: 'product', id: 'w1', title: 'Yonex Astrox 88D racket', price: 12999, imageUrl: PRODUCT_IMAGE, onPress: () => {}, onRemove: () => {} },
                { kind: 'product', id: 'w2', title: 'Cricket kit bag', price: 3499, imageUrl: PRODUCT_IMAGE, onPress: () => {}, onRemove: () => {} },
              ]}
            />
          </Frame>
          <StateLabel>UPA, with funding progress</StateLabel>
          <Frame height={280}>
            <WishlistGrid
              variant="upa"
              items={[
                { kind: 'upa', id: 'u1', title: 'Racket and shuttlecocks', cost: 4500, fundedAmount: 1800, imageUrl: UPA_IMAGE, onPress: () => {}, onFund: () => {} },
              ]}
              numColumns={2}
            />
          </Frame>
        </Section>

        {/* 41 CommentsSheet */}
        <Section number="41" name="CommentsSheet" note="populated and empty">
          <StateLabel>Populated</StateLabel>
          <Frame height={360}>
            <CommentsSheet
              comments={[
                { id: 'c1', author: 'ravi_k', text: 'What a shot', timestamp: '2h' },
                { id: 'c2', author: 'meena.b', text: 'Legendary finish to the over', timestamp: '1h' },
              ]}
              onSubmit={() => {}}
              onClose={() => {}}
            />
          </Frame>
          <StateLabel>Empty</StateLabel>
          <Frame height={220}>
            <CommentsSheet comments={[]} onSubmit={() => {}} onClose={() => {}} />
          </Frame>
        </Section>

        {/* 42 EmptyState */}
        <Section number="42" name="EmptyState" note="the empty state itself, with and without a CTA">
          <Frame height={260}>
            <EmptyState icon={PackageSearch} title="No orders yet" body="Everything you order shows up here." ctaLabel="Browse gear" onCtaPress={() => {}} />
          </Frame>
          <Frame height={220}>
            <EmptyState icon={Award} title="No badges yet" body="Complete sessions to start earning milestones." />
          </Frame>
        </Section>

        {/* Bonus: Card, the react-native-reusables proof component, and the Text primitive both of these compose. */}
        <Section number="+" name="Card and Text" note="react-native-reusables proof components from PHASE-1-SPIKE.md, composed by several sections above">
          <Card>
            <CardHeader>
              <CardTitle>Book a court</CardTitle>
              <CardDescription>Instant confirmation, no back and forth.</CardDescription>
            </CardHeader>
            <CardContent>
              <UIText className="text-text-secondary">
                Nativewind styled card, themed with atlitos theme tokens.
              </UIText>
            </CardContent>
            <CardFooter>
              <Button className="flex-1"><UIText>Reserve now</UIText></Button>
            </CardFooter>
          </Card>
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}
