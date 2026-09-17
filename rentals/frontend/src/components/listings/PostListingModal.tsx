'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, Upload, ImageIcon, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { listingsApi, needsLocationConfirmation } from '@/lib/api';
import { useIsAuthenticated } from '@/store/authStore';
import { cn, formatCAD, audienceLabel } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import CityAutocomplete from '@/components/ui/CityAutocomplete';
import AuthModal from '@/components/auth/AuthModal';
import ConfirmLocationMap from '@/components/listings/ConfirmLocationMap';
import Button from '@/components/ui/Button';
import { Input, Textarea } from '@/components/ui/Field';
import Chip from '@/components/ui/Chip';
import Badge from '@/components/ui/Badge';
import Surface from '@/components/ui/Surface';
import Spinner from '@/components/ui/Spinner';
import { postListingSchema, PostListingFormData as FormData } from '@/lib/postListingSchema';
import type { Listing, ListingImage } from '@/types';

const MAX_PHOTOS = 10;
const TOTAL_STEPS = 5;

const STEP_LABELS = ['Property', 'Details', 'Preferences', 'Photos', 'Review'] as const;

// Which schema fields gate "Continue" for each step -- Preferences and
// Photos have no schema-validated fields of their own (audience always has
// a valid default, amenities/photos aren't part of postListingSchema), so
// Continue is never blocked there, matching what the backend actually
// requires today.
const STEP_FIELDS: Partial<Record<number, (keyof FormData)[]>> = {
  1: ['city', 'address', 'unit', 'town', 'bedrooms', 'bathrooms'],
  2: ['title', 'description', 'price', 'contactInfo'],
};

interface PostListingModalProps {
  open: boolean;
  onClose: () => void;
  // Absent/'create' (the default) posts a brand new listing. 'edit'
  // reuses this exact same form/modal for an owner editing their own
  // existing listing instead of building a second, parallel form -- the
  // only real differences are: the form starts prefilled, the submit call
  // is PATCH instead of POST, existing photos are shown and individually
  // removable, and a failed post-save photo upload never rolls back an
  // edit's already-saved field changes the way it rolls back a fresh
  // create (there's no "undo" for an edit -- the listing already existed).
  mode?: 'create' | 'edit';
  // Required when mode='edit'. Comes from an owner-authenticated response
  // (GET /users/me/listings or GET /listings/:id as the owner) that
  // carries the REAL address/unit/lat/lng, never the public-redacted
  // shape -- see toPublicListingLocation in utils/geo.ts. This component
  // never fetches it itself.
  listing?: Listing;
  // Called once a PATCH edit actually succeeds (before the success
  // animation/auto-close), so the caller's own listing list can reflect
  // the change immediately rather than waiting for the modal to close.
  // Never called in create mode -- PostListingModal has never reported
  // its create result upward, and this PR doesn't change that.
  onSaved?: (listing: any) => void;
}

// Set after every address submission (see routes/listings.ts's universal
// confirm-property-location flow / resolveGeocodedLocation) -- nothing was
// created/changed yet, regardless of how confident the geocode match was.
// `pinLat`/`pinLng` start at the geocoder's matched point and track the
// landlord's drag/click/search (see ConfirmLocationMap.tsx); confirming
// resubmits the same form payload plus confirmedLat/confirmedLng.
interface PendingLocationConfirmation {
  formData: FormData;
  matchedLat: number;
  matchedLng: number;
  pinLat: number;
  pinLng: number;
}

const AMENITIES = [
  'Furnished', 'Parking', 'Utilities included', 'Laundry in-unit', 'Laundry shared',
  'Internet included', 'Air conditioning', 'Dishwasher', 'Pet-friendly',
  'Private entrance', 'Basement unit', 'Balcony', 'Backyard access',
];

const AUDIENCE_OPTIONS = [
  { v: 'BROTHERS', label: '🧔 Brothers' },
  { v: 'SISTERS', label: '🧕 Sisters' },
  { v: 'COUPLES', label: '💑 Couples' },
  { v: 'FAMILIES', label: '👨‍👩‍👧 Families' },
  { v: 'ALL', label: '🤝 Everyone' },
] as const;

export default function PostListingModal({ open, onClose, mode = 'create', listing, onSaved }: PostListingModalProps) {
  const isAuth = useIsAuthenticated();
  const [authOpen, setAuthOpen] = useState(false);
  const [step, setStep] = useState(1);
  // Create mode: how far forward the poster has actually validated via
  // Continue -- the step-jump row can only ever go back to/through this,
  // never skip ahead unvalidated. Edit mode ignores this entirely (every
  // step is treated as pre-validated from a real, already-live listing --
  // see the step-jump handler below), so its initial value doesn't matter.
  const [maxStepReached, setMaxStepReached] = useState(1);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  // Edit mode only: the listing's photos that already exist on the server.
  // Removing one calls DELETE /uploads/listing-images/:id immediately (the
  // endpoint is a real, immediate delete, not a staged batch) -- it is
  // NOT gated behind pressing "Save changes" below, matching how the
  // endpoint itself already behaves elsewhere in the app (e.g. avatar
  // removal). A failed removal restores it to this list and shows a toast
  // rather than silently leaving the UI out of sync with the server.
  const [existingImages, setExistingImages] = useState<ListingImage[]>([]);
  const [removingImageIds, setRemovingImageIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingLocationConfirmation | null>(null);
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors }, setValue, watch, trigger, reset } = useForm<FormData>({
    resolver: zodResolver(postListingSchema),
    defaultValues: { audience: 'ALL', bedrooms: 1, bathrooms: 1 },
  });

  const city = watch('city');
  const formValues = watch();

  // Populate the form from the listing being edited every time the modal
  // opens for it -- deliberately keyed on `open` (not just `listing.id`)
  // so reopening the SAME listing after a previous close/cancel always
  // starts from its current server state again, not from whatever the
  // form happened to be left at.
  useEffect(() => {
    if (!open || mode !== 'edit' || !listing) return;
    reset({
      title: listing.title,
      description: listing.description,
      price: listing.price,
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      audience: listing.audience,
      city: listing.city,
      town: listing.town ?? undefined,
      province: listing.province ?? undefined,
      // A legacy (pre-geocoding) listing has no real address on file --
      // the field starts empty and the landlord has to supply one to save
      // any edit, same as postListingSchema already requires for create.
      // That's an intentional forced upgrade to the current address-based
      // model, not a bug: this shared form has never supported the legacy
      // neighbourhood-only shape as an input.
      address: listing.address ?? '',
      unit: listing.unit ?? undefined,
      // Editing always requires the listing's own authenticated owner, so
      // this is never actually missing in practice -- the fallback only
      // satisfies the type now that an anonymous fetch omits the field.
      contactInfo: listing.contactInfo ?? '',
    });
    setSelectedAmenities(listing.amenities ?? []);
    setExistingImages(listing.images ?? []);
    setImages([]);
    setImagePreviews([]);
    setStep(1);
    setMaxStepReached(TOTAL_STEPS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, listing?.id]);

  const maxNewPhotos = Math.max(0, MAX_PHOTOS - (mode === 'edit' ? existingImages.length : 0));

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = [...images, ...acceptedFiles].slice(0, maxNewPhotos);
    setImages(newFiles);
    setImagePreviews(newFiles.map(f => URL.createObjectURL(f)));
  }, [images, maxNewPhotos]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    maxFiles: maxNewPhotos,
    maxSize: 10 * 1024 * 1024,
    disabled: maxNewPhotos === 0,
  });

  const removeImage = (i: number) => {
    const newFiles = images.filter((_, idx) => idx !== i);
    const newPreviews = imagePreviews.filter((_, idx) => idx !== i);
    setImages(newFiles);
    setImagePreviews(newPreviews);
  };

  // Reordering the pending (not-yet-uploaded) batch is fully supported by
  // the backend today with zero API changes: uploads.ts assigns each new
  // image's stored `order` as `existingCount + arrayIndex`, so whatever
  // order this array is in when listingsApi.uploadImages actually sends it
  // IS the final stored order. There is no equivalent endpoint to reorder
  // an already-uploaded/existing image after the fact, so this is
  // deliberately only offered for `images`/`imagePreviews`, never
  // `existingImages` (which stay remove-only, exactly as before).
  const moveImage = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= images.length) return;
    const newImages = [...images];
    const newPreviews = [...imagePreviews];
    [newImages[index], newImages[target]] = [newImages[target], newImages[index]];
    [newPreviews[index], newPreviews[target]] = [newPreviews[target], newPreviews[index]];
    setImages(newImages);
    setImagePreviews(newPreviews);
  };

  async function removeExistingImage(image: ListingImage) {
    setRemovingImageIds(prev => new Set(prev).add(image.id));
    try {
      await listingsApi.deleteImage(image.id);
      setExistingImages(prev => prev.filter(img => img.id !== image.id));
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not remove photo', description: err.message });
    } finally {
      setRemovingImageIds(prev => { const next = new Set(prev); next.delete(image.id); return next; });
    }
  }

  const toggleAmenity = (a: string) => {
    setSelectedAmenities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  };

  // Shared by the direct-success path and the post-confirmation resubmit
  // below -- both end by uploading any newly added photos, then showing
  // the success state. Create and edit diverge only in what happens if
  // that photo upload itself fails: a fresh create with no photos live
  // yet is rolled back entirely (an orphaned, photo-less listing isn't a
  // successful post), but an edit's field changes are already saved on
  // the server by this point -- there is nothing to roll back, and doing
  // so would destroy a real, already-live listing over an unrelated photo
  // upload failure. The edit form is instead left open with the same
  // pending photos so the owner can just retry Save.
  async function finalizeSave(savedListing: any) {
    if (images.length > 0) {
      try {
        await listingsApi.uploadImages(savedListing.id, images);
      } catch (uploadErr: any) {
        if (mode === 'create') {
          try {
            await listingsApi.deletePermanent(savedListing.id);
          } catch {
            // Best-effort rollback -- if it fails there's nothing more the
            // client can do here; the listing may need manual cleanup, but
            // we still must not tell the poster this succeeded.
          }
          toast({
            variant: 'destructive',
            title: 'Could not post your listing',
            description: uploadErr.message || 'Uploading your photo failed, so nothing was posted. Please try again.',
          });
          return;
        }
        onSaved?.(savedListing);
        toast({
          variant: 'destructive',
          title: 'Listing updated, but new photos failed to upload',
          description: uploadErr.message || 'Your other changes were saved. Try saving again to retry the photos.',
        });
        return;
      }
    }
    setPendingConfirmation(null);
    setSuccess(true);
    if (mode === 'edit') onSaved?.(savedListing);
    toast(
      mode === 'edit'
        ? { title: 'Listing updated!', description: 'Your changes are live.' }
        : { title: 'Listing posted! 🎉', description: 'Your rental listing is now live.' }
    );
    setTimeout(() => { setSuccess(false); reset(); setImages([]); setImagePreviews([]); setExistingImages([]); setSelectedAmenities([]); setStep(1); setMaxStepReached(1); onClose(); }, 2500);
  }

  async function onSubmit(data: FormData) {
    if (!isAuth) { setAuthOpen(true); return; }
    setLoading(true);
    try {
      const res = mode === 'edit'
        ? await listingsApi.update(listing!.id, { ...data, amenities: selectedAmenities })
        : await listingsApi.create({ ...data, amenities: selectedAmenities, imageUrls: [] });
      if (needsLocationConfirmation(res)) {
        // Nothing was created/changed -- every new listing AND every edit
        // through this shared form requires the landlord to confirm the pin
        // first, regardless of how confident the geocode match was or
        // whether address/city/province even changed (see the universal
        // confirm-property-location flow in routes/listings.ts). For an
        // edit whose location didn't change, matchedLat/Lng here is the
        // listing's own current private coordinate, not a fresh geocode --
        // so the pin preloads on where it already privately is. Show that
        // pin and let them confirm/move/search it before anything is saved.
        setPendingConfirmation({
          formData: data,
          matchedLat: res.data.matchedLat,
          matchedLng: res.data.matchedLng,
          pinLat: res.data.matchedLat,
          pinLng: res.data.matchedLng,
        });
        return;
      }
      await finalizeSave(res.data);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setLoading(false); }
  }

  async function confirmPendingLocation() {
    if (!pendingConfirmation) return;
    setLoading(true);
    try {
      const res = mode === 'edit'
        ? await listingsApi.update(listing!.id, {
            ...pendingConfirmation.formData,
            amenities: selectedAmenities,
            confirmedLat: pendingConfirmation.pinLat,
            confirmedLng: pendingConfirmation.pinLng,
          })
        : await listingsApi.create({
            ...pendingConfirmation.formData,
            amenities: selectedAmenities,
            imageUrls: [],
            confirmedLat: pendingConfirmation.pinLat,
            confirmedLng: pendingConfirmation.pinLng,
          });
      if (needsLocationConfirmation(res)) {
        // Shouldn't happen (the same address now carries a confirmed pin),
        // but guard rather than silently drop the change if it ever does.
        toast({ variant: 'destructive', title: 'Error', description: 'Please try confirming the location again.' });
        return;
      }
      await finalizeSave(res.data);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Could not confirm location', description: err.message });
    } finally { setLoading(false); }
  }

  async function nextStep() {
    const fields = STEP_FIELDS[step];
    if (fields) {
      const valid = await trigger(fields);
      if (!valid) return;
    }
    setStep(s => {
      const next = Math.min(s + 1, TOTAL_STEPS);
      setMaxStepReached(m => Math.max(m, next));
      return next;
    });
  }

  // Step-jump navigation (the labeled step row, desktop-only -- see the
  // header below). Edit mode treats every step as pre-validated, since the
  // form started from a real, already-live listing -- an owner can jump
  // straight to Photos and back to Review without marching through
  // Continue. Create mode can only ever jump back to/through the furthest
  // step already reached via Continue -- never skip ahead unvalidated.
  function goToStep(n: number) {
    if (mode === 'edit' || n <= maxStepReached) setStep(n);
  }

  const handleClose = () => {
    if (!loading) {
      reset(); setStep(1); setMaxStepReached(1); setImages([]); setImagePreviews([]);
      setExistingImages([]); setSelectedAmenities([]); setPendingConfirmation(null); onClose();
    }
  };

  // The effective, combined photo set in real stored order (existing
  // photos first, then pending ones) -- used only for the Review step's
  // preview; every other step keeps existing/pending strictly separate.
  const reviewPhotos: string[] = [
    ...existingImages.map(img => img.url),
    ...imagePreviews,
  ];
  const totalPhotoCount = existingImages.length + images.length;

  if (!isAuth && open) return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
              className="bg-white rounded-3xl p-8 max-w-sm w-full shadow-elevated text-center">
              <div className="text-5xl mb-4">🔒</div>
              <h2 className="text-2xl font-serif mb-2">Sign in to post</h2>
              <p className="text-muted mb-6 text-sm">You need an account to post rental listings.</p>
              <button onClick={() => { handleClose(); setAuthOpen(true); }} className="btn-brand w-full py-3">Sign in / Create account</button>
              <button onClick={handleClose} className="mt-3 text-sm text-muted hover:text-ink transition-colors w-full">Cancel</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} />
    </>
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-ink/50 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }}
            transition={{ type: 'spring', damping: 25, stiffness: 280 }}
            className="w-full sm:max-w-3xl bg-white rounded-t-panel sm:rounded-panel shadow-elevated overflow-hidden max-h-[95dvh] flex flex-col">

            {/* Header */}
            <div className="px-6 py-5 border-b border-neutral-200 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-serif text-xl">
                  {pendingConfirmation ? 'Confirm property location' : mode === 'edit' ? 'Edit listing' : 'Post rental listing'}
                </h2>
                {!pendingConfirmation && !success && (
                  <p className="text-xs text-neutral-500 mt-0.5">Step {step} of {TOTAL_STEPS} — {STEP_LABELS[step - 1]}</p>
                )}
              </div>
              <Button variant="ghost" size="sm" onClick={handleClose} className="w-9 h-9 p-0 rounded-full">
                <X size={18} />
              </Button>
            </div>

            {/* Progress bar */}
            {!pendingConfirmation && !success && (
              <div className="h-1 bg-neutral-100 shrink-0">
                <div className="h-full bg-forest-600 transition-all duration-400" style={{ width: `${(step / TOTAL_STEPS) * 100}%` }} />
              </div>
            )}

            {/* Desktop-only labeled step row with jump navigation */}
            {!pendingConfirmation && !success && (
              <div className="hidden sm:flex items-center gap-2 px-6 py-3 border-b border-neutral-200 shrink-0">
                {STEP_LABELS.map((label, i) => {
                  const n = i + 1;
                  const reachable = mode === 'edit' || n <= maxStepReached;
                  const complete = n < step;
                  return (
                    <Chip
                      key={label}
                      type="button"
                      active={n === step}
                      disabled={!reachable}
                      onClick={() => goToStep(n)}
                      className={cn('gap-1.5', !reachable && 'opacity-40 cursor-not-allowed')}
                    >
                      {complete ? <Check size={12} /> : <span className="text-[11px] font-bold">{n}</span>}
                      {label}
                    </Chip>
                  );
                })}
              </div>
            )}

            {/* Success state */}
            {success && (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.5 }}
                  className="w-20 h-20 rounded-full bg-forest-50 flex items-center justify-center text-4xl mb-4">🎉</motion.div>
                <h3 className="font-serif text-2xl mb-2">{mode === 'edit' ? 'Listing updated!' : 'Listing posted!'}</h3>
                <p className="text-neutral-600">{mode === 'edit' ? 'Your changes are live.' : 'Your rental listing is now live.'}</p>
              </div>
            )}

            {/* Confirm-location step -- shown for EVERY new listing AND
                EVERY edit through this shared form, regardless of whether
                address/city/province changed or how confident the geocode
                match was (see the universal confirm-property-location flow
                in resolveGeocodedLocation, routes/listings.ts). An edit
                whose location didn't change preloads the pin at the
                listing's own current private coordinate rather than
                re-geocoding; a legacy listing with no valid stored
                coordinate preloads from a fresh geocode of its address
                instead of ever exposing the public randomized point.
                Nothing has been saved yet; confirming here is what
                actually creates/updates the listing. "Back" returns to
                Review (the step whose submit triggered this), since `step`
                itself never changes while this overlay is shown. Reuses
                ConfirmLocationMap as-is (drag, click/tap, and search all
                report through the same onChange below) -- identical in
                create and edit mode. */}
            {!success && pendingConfirmation && (
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <p className="text-sm text-neutral-600">
                  Make sure the pin is on the property. Drag, tap, or search for it below. Your exact property location will remain private.
                </p>
                <div className="rounded-panel overflow-hidden">
                  <ConfirmLocationMap
                    initialLat={pendingConfirmation.matchedLat}
                    initialLng={pendingConfirmation.matchedLng}
                    onChange={(lat, lng) => setPendingConfirmation(prev => prev ? { ...prev, pinLat: lat, pinLng: lng } : prev)}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="ghost" size="lg" disabled={loading} onClick={() => setPendingConfirmation(null)} className="flex-1">
                    Back
                  </Button>
                  <Button type="button" variant="primary" size="lg" disabled={loading} loading={loading} onClick={confirmPendingLocation} className="flex-1">
                    {loading ? 'Confirming...' : 'Confirm location'}
                  </Button>
                </div>
              </div>
            )}

            {/* Form */}
            {!success && !pendingConfirmation && (
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                  {/* Step 1: Property */}
                  {step === 1 && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-900 mb-1.5">City <span className="text-destructive">*</span></label>
                        <CityAutocomplete
                          value={city || ''}
                          onChange={(city, _coords, province) => {
                            setValue('city', city);
                            // Passed straight through to server-side geocoding
                            // (utils/geocode.ts) so "Toronto" resolves against
                            // the actual right Toronto/province, not left to
                            // guess from city name + country alone.
                            if (province) setValue('province', province);
                          }}
                          placeholder="Search city..."
                        />
                        {errors.city && <p className="text-[13px] text-destructive mt-1">{errors.city.message}</p>}
                      </div>
                      <Input label="Street address" required {...register('address')} placeholder="e.g. 123 Main Street"
                        error={errors.address?.message}
                        helperText="Used to place your listing on the map. Your exact address is never shown publicly — renters only ever see an approximate area." />
                      <Input label="Unit / Apt #" {...register('unit')} placeholder="e.g. Unit 4B"
                        helperText="Kept private — never shown to renters or used to place your listing on the map." />
                      <Input label="Town / Area" {...register('town')} placeholder="e.g. Mississauga" />
                      <div className="grid grid-cols-2 gap-4">
                        <Input label="Bedrooms" required type="number" inputMode="numeric" step={1} min={0} max={20} placeholder="e.g. 2"
                          {...register('bedrooms')} error={errors.bedrooms?.message} helperText="Enter 0 for a studio" />
                        <Input label="Bathrooms" required type="number" inputMode="numeric" step={1} min={0} max={20} placeholder="e.g. 1"
                          {...register('bathrooms')} error={errors.bathrooms?.message} />
                      </div>
                    </>
                  )}

                  {/* Step 2: Details */}
                  {step === 2 && (
                    <>
                      <Input label="Listing title" required {...register('title')} placeholder="e.g. Bright 2BR in North York, Toronto"
                        error={errors.title?.message} />
                      <Textarea label="Description" required {...register('description')} rows={5}
                        placeholder="Describe the rental: layout, rules, features, what makes it great..."
                        error={errors.description?.message} />
                      <Input label="Price (CAD/mo)" required type="number" min={100} placeholder="1200"
                        {...register('price')} error={errors.price?.message} />
                      <Input label="Contact info" required {...register('contactInfo')} placeholder="Phone, WhatsApp, or email for serious inquiries..."
                        error={errors.contactInfo?.message} />
                    </>
                  )}

                  {/* Step 3: Preferences */}
                  {step === 3 && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-neutral-900 mb-2">Suitable for <span className="text-destructive">*</span></label>
                        <div className="flex flex-wrap gap-2">
                          {AUDIENCE_OPTIONS.map(opt => (
                            <Chip key={opt.v} type="button" active={watch('audience') === opt.v} onClick={() => setValue('audience', opt.v)}>
                              {opt.label}
                            </Chip>
                          ))}
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-neutral-900 mb-1">Amenities</label>
                        <p className="text-[13px] text-neutral-600 mb-2">Optional — select all that apply.</p>
                        <div className="flex flex-wrap gap-2">
                          {AMENITIES.map(a => (
                            <Chip key={a} type="button" active={selectedAmenities.includes(a)} onClick={() => toggleAmenity(a)}>
                              {a}
                            </Chip>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Step 4: Photos */}
                  {step === 4 && (
                    <>
                      <div>
                        <div className="flex items-baseline justify-between mb-2">
                          <label className="block text-sm font-medium text-neutral-900">Photos</label>
                          <span className="text-[13px] text-neutral-500">{totalPhotoCount} of {MAX_PHOTOS} used</span>
                        </div>
                        {mode === 'edit' && existingImages.length > 0 && (
                          <p className="text-[13px] text-neutral-500 mb-2">
                            Your {existingImages.length} existing photo{existingImages.length !== 1 ? 's' : ''} count toward the {MAX_PHOTOS}-photo limit.
                          </p>
                        )}
                        {maxNewPhotos > 0 ? (
                          <div {...getRootProps()} className={cn(
                            'border-2 border-dashed rounded-panel p-8 text-center cursor-pointer transition-all',
                            isDragActive ? 'border-forest-600 bg-forest-50' : 'border-neutral-300 hover:border-forest-400 hover:bg-forest-50/30'
                          )}>
                            <input {...getInputProps()} />
                            <Upload size={28} className="mx-auto text-neutral-400 mb-3" />
                            <p className="text-sm font-semibold text-neutral-900 mb-1">{isDragActive ? 'Drop here' : 'Drag photos here, or click to browse'}</p>
                            <p className="text-xs text-neutral-500">JPEG, PNG, WEBP · Max 10MB each · Up to {MAX_PHOTOS} photos total</p>
                          </div>
                        ) : (
                          <p className="text-xs text-neutral-500">
                            You're at the {MAX_PHOTOS}-photo limit. Remove one below to add another.
                          </p>
                        )}
                      </div>

                      {/* Existing photos (edit mode only) -- remove-only, no
                          reorder control: there is no backend endpoint to
                          persist a reordered existing-image order, only to
                          add new ones or delete one outright. Each removes
                          immediately via DELETE /uploads/listing-images/:id,
                          independent of pressing "Save changes" below. */}
                      {mode === 'edit' && existingImages.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2">Current photos</p>
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {existingImages.map((img, i) => (
                              <div key={img.id} className="relative aspect-square rounded-control overflow-hidden group">
                                <img src={img.url} alt="" className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  aria-label="Remove photo"
                                  disabled={removingImageIds.has(img.id)}
                                  onClick={() => removeExistingImage(img)}
                                  className={cn(
                                    'absolute inset-0 bg-ink/50 flex items-center justify-center transition-opacity disabled:opacity-100',
                                    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
                                    '[@media(hover:none)]:opacity-100 [@media(hover:none)]:bg-ink/25'
                                  )}
                                >
                                  {removingImageIds.has(img.id) ? <Spinner size={18} className="text-white" /> : <X size={18} className="text-white" />}
                                </button>
                                {i === 0 && imagePreviews.length === 0 && (
                                  <Badge variant="emphasis" className="absolute bottom-1.5 left-1.5">Cover</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* New (pending, not-yet-uploaded) photos -- reorderable
                          via the arrow buttons, since the array order sent to
                          listingsApi.uploadImages IS the final stored order
                          for these (see uploads.ts: order = existingCount +
                          arrayIndex). Arrow buttons rather than drag-and-drop
                          so this works identically, and accessibly, on
                          mobile touch and desktop alike. */}
                      {imagePreviews.length > 0 && (
                        <div>
                          {mode === 'edit' && existingImages.length > 0 && (
                            <p className="text-xs font-semibold text-neutral-600 uppercase tracking-wider mb-2">New photos</p>
                          )}
                          <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                            {imagePreviews.map((src, i) => (
                              <div key={i} className="relative aspect-square rounded-control overflow-hidden group">
                                <img src={src} alt="" className="w-full h-full object-cover" />
                                <button
                                  type="button"
                                  aria-label="Remove photo"
                                  onClick={() => removeImage(i)}
                                  className={cn(
                                    'absolute inset-0 bg-ink/50 flex items-center justify-center transition-opacity',
                                    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100',
                                    '[@media(hover:none)]:opacity-100 [@media(hover:none)]:bg-ink/25'
                                  )}
                                >
                                  <X size={18} className="text-white" />
                                </button>
                                {i === 0 && existingImages.length === 0 && (
                                  <Badge variant="emphasis" className="absolute bottom-1.5 left-1.5">Cover</Badge>
                                )}
                                {imagePreviews.length > 1 && (
                                  <div className="absolute top-1.5 right-1.5 flex gap-1">
                                    {i > 0 && (
                                      <button type="button" aria-label="Move photo earlier" onClick={() => moveImage(i, -1)}
                                        className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                                        <ChevronLeft size={13} />
                                      </button>
                                    )}
                                    {i < imagePreviews.length - 1 && (
                                      <button type="button" aria-label="Move photo later" onClick={() => moveImage(i, 1)}
                                        className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center hover:bg-white">
                                        <ChevronRight size={13} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {imagePreviews.length === 0 && existingImages.length === 0 && (
                        <div className="text-center py-4 text-sm text-neutral-500">
                          <ImageIcon size={40} className="mx-auto mb-3 opacity-20" />
                          <p>No photos yet. Listings with photos get 3× more inquiries.</p>
                        </div>
                      )}
                    </>
                  )}

                  {/* Step 5: Review */}
                  {step === 5 && (
                    <>
                      <Surface>
                        {reviewPhotos.length > 0 ? (
                          <div className="mb-4">
                            <div className="relative aspect-video rounded-control overflow-hidden bg-neutral-100 mb-2">
                              <img src={reviewPhotos[0]} alt="" className="w-full h-full object-cover" />
                            </div>
                            {reviewPhotos.length > 1 && (
                              <div className="flex gap-2 overflow-x-auto">
                                {reviewPhotos.slice(1).map((src, i) => (
                                  <img key={i} src={src} alt="" className="w-16 h-16 rounded-control object-cover shrink-0" />
                                ))}
                              </div>
                            )}
                          </div>
                        ) : (
                          <div className="aspect-video rounded-control bg-forest-50 flex items-center justify-center mb-4">
                            <ImageIcon size={32} className="text-forest-300" />
                          </div>
                        )}

                        <Badge variant="emphasis" className="mb-2">{audienceLabel(formValues.audience || 'ALL')}</Badge>
                        <h3 className="font-serif text-xl leading-snug mb-1">{formValues.title || 'Untitled listing'}</h3>
                        <p className="text-2xl font-bold text-forest-700 mb-2">
                          {formValues.price ? formatCAD(Number(formValues.price)) : '$0'}<span className="text-sm font-normal text-neutral-500">/mo</span>
                        </p>
                        <p className="text-sm text-neutral-600 mb-3">{formValues.city}</p>
                        <div className="flex items-center gap-4 text-sm mb-4 pb-4 border-b border-neutral-200">
                          <span className="font-semibold">{formValues.bedrooms === 0 ? 'Studio' : `${formValues.bedrooms} bed`}</span>
                          <span className="font-semibold">{formValues.bathrooms} bath</span>
                        </div>
                        <p className="text-sm text-neutral-600 leading-relaxed whitespace-pre-line mb-4">{formValues.description}</p>
                        {selectedAmenities.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {selectedAmenities.map(a => <Badge key={a} variant="neutral">{a}</Badge>)}
                          </div>
                        )}
                      </Surface>

                      <div className="space-y-3">
                        <p className="text-sm font-medium text-neutral-900">Details you're submitting</p>

                        <div className="flex items-start justify-between gap-3 py-2 border-t border-neutral-200">
                          <p className="text-sm text-neutral-600">
                            <span className="font-semibold text-neutral-900">Address (private — never shown to renters):</span>{' '}
                            {formValues.address}{formValues.unit ? `, ${formValues.unit}` : ''}
                            {formValues.town ? ` · ${formValues.town}` : ''}{formValues.province ? `, ${formValues.province}` : ''}
                          </p>
                          <Button type="button" variant="ghost" size="sm" onClick={() => goToStep(1)}>Edit</Button>
                        </div>

                        <div className="flex items-start justify-between gap-3 py-2 border-t border-neutral-200">
                          <p className="text-sm text-neutral-600">
                            <span className="font-semibold text-neutral-900">Contact info:</span> {formValues.contactInfo}
                          </p>
                          <Button type="button" variant="ghost" size="sm" onClick={() => goToStep(2)}>Edit</Button>
                        </div>

                        <div className="flex items-start justify-between gap-3 py-2 border-t border-neutral-200">
                          <p className="text-sm text-neutral-600">
                            <span className="font-semibold text-neutral-900">Suitability & amenities:</span>{' '}
                            {audienceLabel(formValues.audience || 'ALL')} · {selectedAmenities.length} amenit{selectedAmenities.length === 1 ? 'y' : 'ies'} selected
                          </p>
                          <Button type="button" variant="ghost" size="sm" onClick={() => goToStep(3)}>Edit</Button>
                        </div>

                        <div className="flex items-start justify-between gap-3 py-2 border-t border-neutral-200">
                          <p className="text-sm text-neutral-600">
                            <span className="font-semibold text-neutral-900">Photos:</span> {totalPhotoCount} photo{totalPhotoCount !== 1 ? 's' : ''}
                          </p>
                          <Button type="button" variant="ghost" size="sm" onClick={() => goToStep(4)}>Edit</Button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-neutral-200 flex gap-3 shrink-0 bg-white">
                  {step > 1 && (
                    <Button type="button" variant="ghost" size="lg" onClick={() => setStep(s => s - 1)} className="flex-1">
                      Back
                    </Button>
                  )}
                  {step < TOTAL_STEPS ? (
                    // Distinct `key`s from the type="submit" button below are
                    // required, not cosmetic: without them, React reconciles
                    // both branches as "the same button" at this JSX position
                    // and patches type="button" -> type="submit" in place on
                    // the existing DOM node. nextStep()'s `await trigger(...)`
                    // can resolve fast enough that this attribute flip lands
                    // while the browser is still evaluating that same click's
                    // default action -- so one tap on "Continue" both
                    // advances the step AND submits the form. A `key` forces
                    // a real unmount/remount instead of an in-place patch,
                    // so the click that landed on the old (type="button")
                    // node can never retroactively submit anything.
                    <Button key="continue" type="button" variant="primary" size="lg" onClick={nextStep} className="flex-1">
                      Continue →
                    </Button>
                  ) : (
                    <Button key="submit" type="submit" variant="primary" size="lg" disabled={loading} loading={loading} className="flex-1">
                      {loading
                        ? (mode === 'edit' ? 'Saving...' : 'Posting...')
                        : mode === 'edit' ? 'Save changes' : 'Post listing'}
                    </Button>
                  )}
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
