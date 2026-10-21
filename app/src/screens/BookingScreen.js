// The booking flow: details of the chosen service (or a general request), when and
// where, then review. The chosen service, its questions and its price come from the
// published catalogue; the server checks everything again when the request is sent.
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Pressable, KeyboardAvoidingView, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, radius, typo, pagePad, maxContentWidth } from '../theme';
import { Button, FieldLabel, Input, ErrorText } from '../components/UI';
import AppIcon from '../components/AppIcon';
import DynamicQuestions, { firstProblem } from '../components/DynamicQuestions';
import { BookForSomeoneElseSection, BookingStepHeader, InlineValidationMessage } from '../components/discover/BookingParts';
import { ScreenHeader } from '../components/discover/Discover';
import { PriceOrQuoteSummary } from '../components/concierge/Concierge';
import { useCatalogue } from '../data/useCatalogue';
import { useBookingDraft, patchDraft, addToCart, removeFromCart, resetDraft, getDraft } from '../data/bookingDraft';
import { isValidDate } from '../data/extras';
import { currentPoint } from '../lib/location';
import { createTask, createBooking, tasksNow, myTasks, useTasks } from '../data/store';
import { useAuth } from '../lib/AuthContext';

const STEPS = ['Details', 'When and where', 'Review'];
const URGENCY = [['flexible', 'Flexible'], ['soon', 'In the next few days'], ['urgent', 'As soon as possible']];

export default function BookingScreen({ navigation, route }) {
  useTasks();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const pad = pagePad(width);
  const { families, loaded, findService } = useCatalogue();
  const draft = useBookingDraft();
  const { serviceId, general, resume, prefill } = route.params || {};

  const found = serviceId ? findService(serviceId) : prefill?.serviceId ? findService(prefill.serviceId) : null;
  const service = found?.service || null;
  const isGeneral = !service;

  const [step, setStep] = useState(resume ? 3 : 1);
  const [title, setTitle] = useState(prefill?.title || '');
  const [outcome, setOutcome] = useState(prefill?.description || '');
  const [context, setContext] = useState('');
  const [urgency, setUrgency] = useState('flexible');
  const [answers, setAnswers] = useState({});
  const [extra, setExtra] = useState('');
  const [multiDay, setMultiDay] = useState(prefill?.taskType === 'ongoing');
  const [dateStr, setDateStr] = useState('');
  const [timeStr, setTimeStr] = useState('');
  const [when, setWhen] = useState('');
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);
  useEffect(() => { scroller.current?.scrollTo({ y: 0, animated: false }); }, [step]);
  useEffect(() => { if (prefill && !draft.location) patchDraft({ location: prefill.location || '' }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const recentPlaces = [...new Set(myTasks(user?.id).map((t) => t.location).filter(Boolean))].slice(0, 3);
  const someone = { forWhom: draft.forWhom, recipientName: draft.recipientName, recipientRelation: draft.recipientRelation, recipientPhone: draft.recipientPhone, consent: draft.consent, shareUpdates: draft.shareUpdates, contactName: draft.contactName };

  function scheduleProblem() {
    if (!dateStr && !timeStr) return null;
    if (!isValidDate(dateStr)) return 'Enter the date as YYYY-MM-DD, for example 2026-11-28.';
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(timeStr)) return 'Enter the time as HH:MM in 24-hour time, for example 14:30.';
    const at = new Date(`${dateStr}T${timeStr}:00`);
    if (at.getTime() < Date.now() - 5 * 60000) return 'That date and time has already passed.';
    if (at.getTime() > Date.now() + 365 * 864e5) return 'Choose a date within the next twelve months.';
    return null;
  }
  const atIso = () => (dateStr && timeStr && !scheduleProblem() ? new Date(`${dateStr}T${timeStr}:00`).toISOString() : null);

  function detailsErrors() {
    const e = {};
    if (service) { const p = firstProblem(service.definition.questions, answers); if (p) e.answers = p; }
    else {
      if (title.trim().length < 3) e.title = 'Tell us briefly what you need done.';
      if (outcome.trim().length < 5) e.outcome = 'Tell us the outcome you want, in a few words.';
    }
    return e;
  }
  function placeErrors() {
    const e = {};
    const sp = scheduleProblem(); if (sp) e.schedule = sp;
    if (draft.location.trim().length < 3) e.location = 'Add the address where the task is to be done.';
    if (draft.forWhom === 'other') {
      if (!draft.recipientName.trim()) e.recipientName = 'Add the name of the person you are booking for.';
      if (!draft.consent) e.consent = 'Please confirm that they know and agree.';
    }
    return e;
  }

  function next() {
    setError('');
    const e = step === 1 ? detailsErrors() : step === 2 ? placeErrors() : {};
    setErrors(e);
    if (Object.keys(e).length) return;
    setStep(step + 1);
  }
  function back() { if (step === 1) navigation.goBack(); else { setErrors({}); setStep(step - 1); } }

  function item() {
    const name = service ? service.definition.title : title.trim();
    return {
      service_id: service ? service.id : null,
      title: name,
      description: service ? extra.trim() : [`Wanted outcome: ${outcome.trim()}`, `Urgency: ${urgency}`, context.trim()].filter(Boolean).join('\n'),
      category: service ? service.category : 'general',
      task_type: multiDay ? 'ongoing' : 'one-time',
      schedule_kind: multiDay ? 'multi_day' : 'single_day',
      scheduled_for: dateStr && timeStr ? new Date(`${dateStr}T${timeStr}:00`).toLocaleString() : when.trim() || 'Flexible',
      scheduled_at: atIso(),
      answers: service ? answers : {},
      _price: service ? service.definition.pricing : null,
    };
  }
  const current = () => item();
  const all = () => (resume ? draft.cart : [...draft.cart, current()]);

  function addAnother() {
    const e = { ...detailsErrors(), ...placeErrors() };
    setErrors(e);
    if (Object.keys(e).length) { setStep(Object.keys(detailsErrors()).length ? 1 : 2); return; }
    addToCart(current());
    navigation.navigate('Home');
  }

  async function submit() {
    setError('');
    const items = all();
    if (!items.length) { setError('Add a task first.'); return; }
    const pe = placeErrors(); if (Object.keys(pe).length && !resume) { setErrors(pe); setStep(2); return; }
    setBusy(true);
    const d = getDraft();
    try {
      let firstId;
      const clean = items.map(({ _price, ...rest }) => rest);
      try {
        const bookingId = await createBooking(clean, {
          location: d.location.trim(), for_whom: d.forWhom, recipient_name: d.recipientName.trim(), recipient_relation: d.recipientRelation.trim(),
          recipient_phone: d.recipientPhone.trim(), recipient_consent: d.forWhom === 'other' ? d.consent : false, share_updates: d.shareUpdates,
          authorized_contact_name: d.contactName.trim(), lat: d.point?.lat, lng: d.point?.lng,
        }, d.requestKey);
        firstId = tasksNow().find((t) => t.bookingId === bookingId)?.id;
      } catch (e) {
        if (!/latest database update/i.test(e.message) || items.length > 1) throw e;
        const c = clean[0];
        const t = await createTask({ title: c.title, category: c.category, description: c.description, taskType: c.task_type, scheduledFor: c.scheduled_for, location: d.location.trim(),
          forWhom: d.forWhom, recipientName: d.forWhom === 'other' ? d.recipientName.trim() : null, recipientRelation: d.forWhom === 'other' ? d.recipientRelation.trim() || null : null,
          recipientPhone: d.forWhom === 'other' ? d.recipientPhone.trim() || null : null }, user.id);
        firstId = t.id;
      }
      resetDraft();
      navigation.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'TrackTask', params: { taskId: firstId } }] });
    } catch (e) {
      setError(/network|fetch/i.test(e.message) ? 'No connection. Nothing was sent and your answers are kept. Try again when you are back online.' : e.message);
    } finally { setBusy(false); }
  }

  const fixed = (p) => p?.approach === 'fixed';
  const priceLine = (p) => (fixed(p) ? `Fixed price ₹${Number(p.price).toLocaleString('en-IN')}` : 'Price set after we review your request. You confirm it before any work starts.');
  const list = all();
  const confirmedTotal = list.reduce((sum, i) => sum + (fixed(i._price) ? Number(i._price.price) : 0), 0);
  const pending = list.filter((i) => !fixed(i._price)).length;

  if (!loaded && serviceId) return <View style={s.center}><Text style={s.muted}>Loading…</Text></View>;
  if (serviceId && loaded && !service) {
    return (
      <View style={[s.center, { padding: pad }]}>
        <Text style={s.h2}>This service is not available right now.</Text>
        <Text style={[s.muted, { textAlign: 'center' }]}>It may have been paused. You can still describe what you need.</Text>
        <Button label="Describe what you need" onPress={() => navigation.replace('Booking', { general: true })} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView ref={scroller} keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: maxContentWidth, alignSelf: 'center', paddingHorizontal: pad, paddingBottom: 140, paddingTop: 4 }}>
        <ScreenHeader
          title={step === 3 ? 'Check your request' : step === 2 ? 'When and where would you like help?' : service ? service.definition.title : 'Tell us what you need'} onBack={back}
          subtitle={step === 3 ? 'Take a last look. Nothing is final until you send it.'
            : step === 2 ? 'This helps us find the right Personal Manager and plan the visit.'
            : service ? service.definition.description : 'Describe the task, and we’ll review your request.'} />
        <View style={{ marginTop: spacing.lg }}><BookingStepHeader step={step} steps={STEPS} /></View>

        {step === 1 && (
          <View style={{ gap: spacing.xl, marginTop: spacing.xl }}>
            {service ? (
              <>
                {!!service.definition.instructions && <Text style={s.body}>{service.definition.instructions}</Text>}
                {!!service.definition.safety_notes && <View style={s.note}><Text style={s.noteText}>{service.definition.safety_notes}</Text></View>}
                <PriceOrQuoteSummary pricing={service.definition.pricing} />
                <DynamicQuestions questions={service.definition.questions} answers={answers} onChange={(a) => { setAnswers(a); setErrors({}); }} />
                <InlineValidationMessage>{errors.answers}</InlineValidationMessage>
                <View><FieldLabel>Anything else we should know? (optional)</FieldLabel><Input multiline value={extra} onChangeText={setExtra} /></View>
              </>
            ) : (
              <>
                <View><FieldLabel>What do you need done?</FieldLabel><Input value={title} onChangeText={(v) => { setTitle(v); setErrors({}); }} placeholder="e.g. Help sorting my father’s paperwork" /><InlineValidationMessage>{errors.title}</InlineValidationMessage></View>
                <View><FieldLabel>What outcome do you want?</FieldLabel><Input multiline value={outcome} onChangeText={setOutcome} placeholder="How will you know it is done?" /><InlineValidationMessage>{errors.outcome}</InlineValidationMessage></View>
                <View><FieldLabel>More context (optional)</FieldLabel><Input multiline value={context} onChangeText={setContext} placeholder="Anything that helps us decide who can help" /></View>
                <View><FieldLabel>How urgent is it?</FieldLabel>
                  <View style={s.chips}>{URGENCY.map(([id, label]) => (
                    <Pressable key={id} accessibilityRole="radio" accessibilityState={{ selected: urgency === id }} onPress={() => setUrgency(id)} style={[s.chip, urgency === id && s.chipOn]}>
                      {urgency === id && <AppIcon name="check" size={16} />}<Text style={[s.chipText, urgency === id && { color: colors.accent }]}>{label}</Text>
                    </Pressable>))}</View></View>
                <View style={s.note}><Text style={s.noteText}>We review general requests, ask for anything missing, and set a price for you to confirm. Nothing is booked until you confirm.</Text></View>
              </>
            )}
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: spacing.xl, marginTop: spacing.xl }}>
            <View>
              <FieldLabel>How many days?</FieldLabel>
              <View style={s.chips}>
                {[[false, 'One day'], [true, 'Several days']].map(([v, label]) => (
                  <Pressable key={label} accessibilityRole="radio" accessibilityState={{ selected: multiDay === v }} onPress={() => setMultiDay(v)} style={[s.chip, multiDay === v && s.chipOn]}>
                    {multiDay === v && <AppIcon name="check" size={16} />}<Text style={[s.chipText, multiDay === v && { color: colors.accent }]}>{label}</Text>
                  </Pressable>))}
              </View>
              <Text style={[s.muted, { marginTop: 8 }]}>Several days does not mean your Personal Manager is there all day, every day. If the work needs more days, you and our team approve the change first.</Text>
            </View>
            <View>
              <FieldLabel>Date and time</FieldLabel>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 3 }}><Input placeholder="2026-11-28" value={dateStr} onChangeText={(v) => { setDateStr(v); setErrors({}); }} accessibilityLabel="Date, year-month-day" autoCapitalize="none" /></View>
                <View style={{ flex: 2 }}><Input placeholder="14:30" value={timeStr} onChangeText={(v) => { setTimeStr(v); setErrors({}); }} accessibilityLabel="Time, 24-hour" autoCapitalize="none" /></View>
              </View>
              <InlineValidationMessage>{errors.schedule}</InlineValidationMessage>
              <Text style={[s.muted, { marginTop: 6 }]}>Leave empty if you are flexible. If you set a time and your Personal Manager is more than 15 minutes late, you can ask our team to step in.</Text>
              <Input placeholder="Or in words, e.g. any weekday evening" value={when} onChangeText={setWhen} style={{ marginTop: 8 }} />
            </View>
            <View>
              <FieldLabel>Where?</FieldLabel>
              <Input placeholder="Flat or building, area" value={draft.location} onChangeText={(v) => { patchDraft({ location: v, point: null }); setErrors({}); }} />
              <InlineValidationMessage>{errors.location}</InlineValidationMessage>
              {recentPlaces.length > 0 && <View style={[s.chips, { marginTop: 8 }]}>{recentPlaces.map((p) => (
                <Pressable key={p} accessibilityRole="button" onPress={() => patchDraft({ location: p, point: null })} style={s.chip}><AppIcon name="map-pin" size={16} color={colors.muted} /><Text style={s.chipText} numberOfLines={1}>{p}</Text></Pressable>))}</View>}
              <Button label={draft.point ? 'Map point saved for matching' : 'Use my current location too'} variant="ghost" size="sm" style={{ marginTop: 8 }}
                onPress={async () => { try { setError(''); patchDraft({ point: await currentPoint() }); } catch (e) { setError(e.message); } }} />
              <Text style={[s.muted, { marginTop: 4 }]}>Optional. Nearby Personal Managers see your area, never your street address, until they accept.</Text>
            </View>
            <BookForSomeoneElseSection value={someone} onChange={(v) => { patchDraft(v); setErrors({}); }} errors={errors} />
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: spacing.lg, marginTop: spacing.xl }}>
            {list.map((i, idx) => (
              <View key={idx} style={s.summary}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={s.service}>{i.title}</Text>
                  <Text style={s.muted}>{i.scheduled_for}{i.schedule_kind === 'multi_day' ? ' · several days' : ''}</Text>
                  {i._price ? <PriceOrQuoteSummary pricing={i._price} compact /> : <Text style={s.price}>Quote required</Text>}
                </View>
                {draft.cart.length > 0 && idx < draft.cart.length && <Button label="Remove" size="sm" variant="ghost" onPress={() => removeFromCart(idx)} />}
              </View>
            ))}
            <View style={s.summary}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={s.service}>{draft.forWhom === 'other' ? `For ${draft.recipientName}${draft.recipientRelation ? ` (${draft.recipientRelation})` : ''}` : 'For you'}</Text>
                <Text style={s.muted}>{draft.location || 'No address yet'}</Text>
              </View>
            </View>
            <View style={s.totalBox}>
              <Text style={s.service}>{confirmedTotal ? `Fixed prices: ₹${confirmedTotal.toLocaleString('en-IN')}` : 'No price set yet'}</Text>
              {pending > 0 && <Text style={s.muted}>{pending} task{pending === 1 ? '' : 's'} will be priced after we review. You confirm each price before work starts. Posting is free.</Text>}
            </View>
            {!resume && <Button label="Add another task to this booking" variant="ghost" onPress={addAnother} />}
          </View>
        )}
        <View style={{ marginTop: spacing.lg }}><ErrorText>{error}</ErrorText></View>
      </ScrollView>

      <View style={[s.bar, { paddingBottom: Math.max(insets.bottom, 12) + 4, paddingHorizontal: pad }]}>
        <View style={{ flex: 1, maxWidth: maxContentWidth, alignSelf: 'center', flexDirection: 'row' }}>
        {step < 3
          ? <Button label="Continue" onPress={next} style={{ flex: 1 }} />
          : <Button label={busy ? 'Sending…' : pending > 0 ? 'Send request' : 'Confirm booking'} onPress={submit} disabled={busy} style={{ flex: 1 }} />}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg },
  h2: { ...typo.h2, color: colors.text, textAlign: 'center' },
  body: { ...typo.body, color: colors.text },
  muted: { ...typo.body, color: colors.muted },
  note: { backgroundColor: colors.accentLight, padding: 12, borderRadius: radius.md },
  noteText: { ...typo.body, color: colors.text },
  priceChip: { ...typo.service, color: colors.brassDark, backgroundColor: colors.brassLight, paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md, overflow: 'hidden' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.accent, backgroundColor: colors.accentLight },
  chipText: { ...typo.body, fontWeight: '600', color: colors.text, flexShrink: 1 },
  summary: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  service: { ...typo.service, color: colors.text },
  price: { ...typo.meta, color: colors.brassDark },
  totalBox: { padding: 16, borderRadius: radius.lg, backgroundColor: colors.accentLight, gap: 4 },
  bar: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, paddingTop: 12, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
});
