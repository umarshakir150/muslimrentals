'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, Upload, Loader2, ImageIcon, ChevronDown } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { listingsApi, needsLocationConfirmation } from '@/lib/api';
import { useIsAuthenticated } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import CityAutocomplete from '@/components/ui/CityAutocomplete';
import AuthModal from '@/components/auth/AuthModal';
import ConfirmLocationMap from '@/components/listings/ConfirmLocationMap';
import { postListingSchema, PostListingFormData as FormData } from '@/lib/postListingSchema';
import type { Listing, ListingImage } from '@/types';

const MAX_PHOTOS = 10;

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

export default function PostListingModal({ open, onClose, mode = 'create', listing, onSaved }: PostListingModalProps) {
  const isAuth = useIsAuthenticated();
  const [authOpen, setAuthOpen] = useState(false);
  const [step, setStep] = useState(1);
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
      contactInfo: listing.contactInfo,
    });
    setSelectedAmenities(listing.amenities ?? []);
    setExistingImages(listing.images ?? []);
    setImages([]);
    setImagePreviews([]);
    setStep(1);
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
    setTimeout(() => { setSuccess(false); reset(); setImages([]); setImagePreviews([]); setExistingImages([]); setSelectedAmenities([]); setStep(1); onClose(); }, 2500);
  }

  async function onSubmit(data: FormData) {
    if (!isAuth) { setAuthOpen(true); return; }
    setLoading(true);
    try {
      const res = mode === 'edit'
        ? await listingsApi.update(listing!.id, { ...data, amenities: selectedAmenities })
        : await listingsApi.create({ ...data, amenities: selectedAmenities, imageUrls: [] });
      if (needsLocationConfirmation(res)) {
        // Nothing was created/changed -- every new or address-changing
        // listing requires the landlord to confirm the pin first,
        // regardless of how confident the geocode match was. An edit that
        // didn't touch address/city/province never reaches this branch at
        // all (the backend only re-geocodes when one of those actually
        // changed), so an unrelated field edit never triggers
        // reconfirmation. Show a pin on the geocoder's matched point and
        // let them confirm/move/search it before anything is saved.
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
    const fieldsToValidate: (keyof FormData)[] = step === 1
      ? ['title', 'description', 'price', 'bedrooms', 'bathrooms', 'audience']
      : ['city', 'address', 'contactInfo'];
    const valid = await trigger(fieldsToValidate);
    if (valid) setStep(s => s + 1);
  }

  const handleClose = () => { if (!loading) { reset(); setStep(1); setImages([]); setImagePreviews([]); setExistingImages([]); setSelectedAmenities([]); setPendingConfirmation(null); onClose(); } };

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
            className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated overflow-hidden max-h-[95dvh] flex flex-col">

            {/* Header */}
            <div className="px-6 py-5 border-b border-ink/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-serif text-xl">
                  {pendingConfirmation ? 'Confirm property location' : mode === 'edit' ? 'Edit listing' : 'Post rental listing'}
                </h2>
                {!pendingConfirmation && <p className="text-xs text-muted mt-0.5">Step {step} of 3</p>}
              </div>
              <button onClick={handleClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={18} /></button>
            </div>

            {/* Progress bar */}
            {!pendingConfirmation && (
              <div className="h-1 bg-gray-100 shrink-0">
                <div className="h-full bg-brand-gradient transition-all duration-400" style={{ width: `${(step / 3) * 100}%` }} />
              </div>
            )}

            {/* Success state */}
            {success && (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.5 }}
                  className="w-20 h-20 rounded-full bg-brand-50 flex items-center justify-center text-4xl mb-4">🎉</motion.div>
                <h3 className="font-serif text-2xl mb-2">{mode === 'edit' ? 'Listing updated!' : 'Listing posted!'}</h3>
                <p className="text-muted">{mode === 'edit' ? 'Your changes are live.' : 'Your rental listing is now live.'}</p>
              </div>
            )}

            {/* Confirm-location step -- shown for EVERY new or
                address/city/province-changing edit, regardless of how
                confident the geocode match was (see the universal
                confirm-property-location flow in resolveGeocodedLocation,
                routes/listings.ts). Nothing has been saved yet; confirming
                here is what actually creates/updates the listing. Reuses
                ConfirmLocationMap as-is (drag, click/tap, and search all
                report through the same onChange below) -- identical in
                create and edit mode. */}
            {!success && pendingConfirmation && (
              <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
                <p className="text-sm text-muted">
                  Make sure the pin is on the property. Drag, tap, or search for it below. Your exact property location will remain private.
                </p>
                <ConfirmLocationMap
                  initialLat={pendingConfirmation.matchedLat}
                  initialLng={pendingConfirmation.matchedLng}
                  onChange={(lat, lng) => setPendingConfirmation(prev => prev ? { ...prev, pinLat: lat, pinLng: lng } : prev)}
                />
                <div className="flex gap-3 pt-1">
                  <button type="button" disabled={loading} onClick={() => setPendingConfirmation(null)} className="btn-ghost flex-1 py-3">
                    Back
                  </button>
                  <button type="button" disabled={loading} onClick={confirmPendingLocation} className="btn-brand flex-1 py-3 flex items-center justify-center gap-2">
                    {loading ? <><Loader2 size={16} className="animate-spin" /> Confirming...</> : 'Confirm location'}
                  </button>
                </div>
              </div>
            )}

            {/* Form */}
            {!success && !pendingConfirmation && (
              <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

                  {/* Step 1: Details */}
                  {step === 1 && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Listing title *</label>
                        <input {...register('title')} placeholder="e.g. Bright 2BR in North York, Toronto" className="input-field" />
                        {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Description *</label>
                        <textarea {...register('description')} rows={4} placeholder="Describe the rental: layout, rules, features, what makes it great..." className="input-field resize-none" />
                        {errors.description && <p className="text-red-500 text-xs mt-1">{errors.description.message}</p>}
                      </div>
                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Price (CAD/mo) *</label>
                          <input {...register('price')} type="number" min={100} placeholder="1200" className="input-field" />
                          {errors.price && <p className="text-red-500 text-xs mt-1">{errors.price.message}</p>}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Beds *</label>
                          <input {...register('bedrooms')} type="number" inputMode="numeric" step={1} min={0} max={20} placeholder="e.g. 2" className="input-field" />
                          <p className="text-[11px] text-muted mt-1">Enter 0 for a studio</p>
                          {errors.bedrooms && <p className="text-red-500 text-xs mt-1">{errors.bedrooms.message}</p>}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Baths *</label>
                          <input {...register('bathrooms')} type="number" inputMode="numeric" step={1} min={0} max={20} placeholder="e.g. 1" className="input-field" />
                          {errors.bathrooms && <p className="text-red-500 text-xs mt-1">{errors.bathrooms.message}</p>}
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Suitable for *</label>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { v: 'BROTHERS', label: '🧔 Brothers' },
                            { v: 'SISTERS', label: '🧕 Sisters' },
                            { v: 'COUPLES', label: '💑 Couples' },
                            { v: 'FAMILIES', label: '👨‍👩‍👧 Families' },
                            { v: 'ALL', label: '🤝 Everyone' },
                          ].map(opt => (
                            <label key={opt.v} className={cn(
                              'flex items-center justify-center gap-2 p-2.5 rounded-xl border-2 cursor-pointer transition-all text-sm font-semibold',
                              watch('audience') === opt.v ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink/10 hover:border-brand-300'
                            )}>
                              <input type="radio" {...register('audience')} value={opt.v} className="sr-only" />
                              {opt.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Step 2: Location + contact */}
                  {step === 2 && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">City *</label>
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
                        {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Street address *</label>
                        <input {...register('address')} placeholder="e.g. 123 Main Street" className="input-field" />
                        <p className="text-xs text-muted mt-1.5">
                          Used to place your listing on the map. Your exact address is never shown publicly — renters only ever see an approximate area.
                        </p>
                        {errors.address && <p className="text-red-500 text-xs mt-1">{errors.address.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Unit / Apt # (optional)</label>
                        <input {...register('unit')} placeholder="e.g. Unit 4B" className="input-field" />
                        <p className="text-xs text-muted mt-1.5">Kept private — never shown to renters or used to place your listing on the map.</p>
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Town / Area</label>
                        <input {...register('town')} placeholder="e.g. Mississauga" className="input-field" />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Contact info *</label>
                        <input {...register('contactInfo')} placeholder="Phone, WhatsApp, or email for serious inquiries..." className="input-field" />
                        {errors.contactInfo && <p className="text-red-500 text-xs mt-1">{errors.contactInfo.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Amenities</label>
                        <div className="flex flex-wrap gap-2">
                          {AMENITIES.map(a => (
                            <button key={a} type="button" onClick={() => toggleAmenity(a)}
                              className={cn('px-3.5 py-2 rounded-full text-sm font-semibold border-2 transition-all',
                                selectedAmenities.includes(a) ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-ink/10 text-muted hover:border-brand-300 hover:text-brand-700')}>
                              {a}
                            </button>
                          ))}
                        </div>
                      </div>
                    </>
                  )}

                  {/* Step 3: Images */}
                  {step === 3 && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Photos (up to {MAX_PHOTOS})</label>
                        {maxNewPhotos > 0 ? (
                          <div {...getRootProps()} className={cn(
                            'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all',
                            isDragActive ? 'border-brand-500 bg-brand-50' : 'border-ink/15 hover:border-brand-400 hover:bg-brand-50/30'
                          )}>
                            <input {...getInputProps()} />
                            <Upload size={28} className="mx-auto text-muted mb-3" />
                            <p className="text-sm font-semibold text-ink mb-1">{isDragActive ? 'Drop here' : 'Drag photos here, or click to browse'}</p>
                            <p className="text-xs text-muted">JPEG, PNG, WEBP · Max 10MB each · Up to {MAX_PHOTOS} photos total</p>
                          </div>
                        ) : (
                          <p className="text-xs text-muted">
                            You're at the {MAX_PHOTOS}-photo limit. Remove one below to add another.
                          </p>
                        )}
                      </div>

                      {/* Existing photos (edit mode only) -- each removes
                          immediately via DELETE /uploads/listing-images/:id,
                          independent of pressing "Save changes" below. */}
                      {mode === 'edit' && existingImages.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {existingImages.map((img, i) => (
                            <div key={img.id} className="relative aspect-square rounded-xl overflow-hidden group">
                              <img src={img.url} alt="" className="w-full h-full object-cover" />
                              <button
                                type="button"
                                aria-label="Remove photo"
                                disabled={removingImageIds.has(img.id)}
                                onClick={() => removeExistingImage(img)}
                                className="absolute inset-0 bg-ink/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:opacity-100"
                              >
                                {removingImageIds.has(img.id) ? <Loader2 size={18} className="text-white animate-spin" /> : <X size={18} className="text-white" />}
                              </button>
                              {i === 0 && imagePreviews.length === 0 && (
                                <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-bold text-brand-700">Cover</span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {imagePreviews.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {imagePreviews.map((src, i) => (
                            <div key={i} className="relative aspect-square rounded-xl overflow-hidden group">
                              <img src={src} alt="" className="w-full h-full object-cover" />
                              <button type="button" aria-label="Remove photo" onClick={() => removeImage(i)}
                                className="absolute inset-0 bg-ink/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <X size={18} className="text-white" />
                              </button>
                              {i === 0 && existingImages.length === 0 && <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-bold text-brand-700">Cover</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {imagePreviews.length === 0 && existingImages.length === 0 && (
                        <div className="text-center py-4 text-sm text-muted">
                          <ImageIcon size={40} className="mx-auto mb-3 opacity-20" />
                          <p>No photos yet. Listings with photos get 3× more inquiries.</p>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="px-6 py-4 border-t border-ink/8 flex gap-3 shrink-0 bg-white">
                  {step > 1 && (
                    <button type="button" onClick={() => setStep(s => s - 1)} className="btn-ghost flex-1 py-3">
                      Back
                    </button>
                  )}
                  {step < 3 ? (
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
                    <button key="continue" type="button" onClick={nextStep} className="btn-brand flex-1 py-3">
                      Continue →
                    </button>
                  ) : (
                    <button key="submit" type="submit" disabled={loading} className="btn-brand flex-1 py-3 flex items-center justify-center gap-2">
                      {loading
                        ? <><Loader2 size={16} className="animate-spin" /> {mode === 'edit' ? 'Saving...' : 'Posting...'}</>
                        : mode === 'edit' ? 'Save changes' : 'Post listing'}
                    </button>
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
