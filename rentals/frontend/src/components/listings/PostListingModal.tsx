'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { X, Upload, Loader2, ImageIcon, ChevronDown } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { listingsApi } from '@/lib/api';
import { useIsAuthenticated } from '@/store/authStore';
import { cn } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import CityAutocomplete from '@/components/ui/CityAutocomplete';
import NeighbourhoodAutocomplete from '@/components/ui/NeighbourhoodAutocomplete';
import AuthModal from '@/components/auth/AuthModal';
import { postListingSchema, PostListingFormData as FormData } from '@/lib/postListingSchema';

interface PostListingModalProps { open: boolean; onClose: () => void; }

const AMENITIES = [
  'Furnished', 'Parking', 'Utilities included', 'Laundry in-unit', 'Laundry shared',
  'Internet included', 'Air conditioning', 'Dishwasher', 'Pet-friendly',
  'Private entrance', 'Basement unit', 'Balcony', 'Backyard access',
];

export default function PostListingModal({ open, onClose }: PostListingModalProps) {
  const isAuth = useIsAuthenticated();
  const [authOpen, setAuthOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedAmenities, setSelectedAmenities] = useState<string[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const { toast } = useToast();

  const { register, handleSubmit, formState: { errors }, setValue, watch, trigger, reset } = useForm<FormData>({
    resolver: zodResolver(postListingSchema),
    defaultValues: { audience: 'ALL', bedrooms: 1, bathrooms: 1, lat: 43.65, lng: -79.38 },
  });

  const city = watch('city');

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles = [...images, ...acceptedFiles].slice(0, 10);
    setImages(newFiles);
    setImagePreviews(newFiles.map(f => URL.createObjectURL(f)));
  }, [images]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/jpeg': [], 'image/png': [], 'image/webp': [] },
    maxFiles: 10,
    maxSize: 10 * 1024 * 1024,
  });

  const removeImage = (i: number) => {
    const newFiles = images.filter((_, idx) => idx !== i);
    const newPreviews = imagePreviews.filter((_, idx) => idx !== i);
    setImages(newFiles);
    setImagePreviews(newPreviews);
  };

  const toggleAmenity = (a: string) => {
    setSelectedAmenities(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a]);
  };

  async function onSubmit(data: FormData) {
    if (!isAuth) { setAuthOpen(true); return; }
    setLoading(true);
    try {
      const listing = await listingsApi.create({
        ...data,
        amenities: selectedAmenities,
        imageUrls: [], // Images would be uploaded separately via /uploads endpoint
      });
      setSuccess(true);
      toast({ title: 'Listing posted! 🎉', description: 'Your rental listing is now live.' });
      setTimeout(() => { setSuccess(false); reset(); setImages([]); setImagePreviews([]); setSelectedAmenities([]); setStep(1); onClose(); }, 2500);
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'Error', description: err.message });
    } finally { setLoading(false); }
  }

  async function nextStep() {
    const fieldsToValidate: (keyof FormData)[] = step === 1
      ? ['title', 'description', 'price', 'bedrooms', 'bathrooms', 'audience']
      : ['city', 'neighbourhood', 'contactInfo'];
    const valid = await trigger(fieldsToValidate);
    if (valid) setStep(s => s + 1);
  }

  const handleClose = () => { if (!loading) { reset(); setStep(1); setImages([]); setImagePreviews([]); setSelectedAmenities([]); onClose(); } };

  if (!isAuth && open) return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-ink/50 backdrop-blur-sm"
            onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
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
          className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center sm:p-4 bg-ink/50 backdrop-blur-sm"
          onClick={e => { if (e.target === e.currentTarget) handleClose(); }}>
          <motion.div initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 60 }}
            transition={{ type: 'spring', damping: 25, stiffness: 280 }}
            className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated overflow-hidden max-h-[95dvh] flex flex-col">

            {/* Header */}
            <div className="px-6 py-5 border-b border-ink/8 flex items-center justify-between shrink-0">
              <div>
                <h2 className="font-serif text-xl">Post rental listing</h2>
                <p className="text-xs text-muted mt-0.5">Step {step} of 3</p>
              </div>
              <button onClick={handleClose} className="p-2 rounded-full hover:bg-gray-100 transition-colors"><X size={18} /></button>
            </div>

            {/* Progress bar */}
            <div className="h-1 bg-gray-100 shrink-0">
              <div className="h-full bg-brand-gradient transition-all duration-400" style={{ width: `${(step / 3) * 100}%` }} />
            </div>

            {/* Success state */}
            {success && (
              <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
                <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', duration: 0.5 }}
                  className="w-20 h-20 rounded-full bg-brand-50 flex items-center justify-center text-4xl mb-4">🎉</motion.div>
                <h3 className="font-serif text-2xl mb-2">Listing posted!</h3>
                <p className="text-muted">Your rental listing is now live.</p>
              </div>
            )}

            {/* Form */}
            {!success && (
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
                          onChange={(city, coords) => {
                            setValue('city', city);
                            if (coords) { setValue('lat', coords[0]); setValue('lng', coords[1]); }
                            // A neighbourhood picked for the previous city no longer
                            // applies -- and its coordinates would silently mislabel
                            // this listing's location if left in place.
                            setValue('neighbourhood', '');
                          }}
                          placeholder="Search city..."
                        />
                        {errors.city && <p className="text-red-500 text-xs mt-1">{errors.city.message}</p>}
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1.5">Neighbourhood *</label>
                        <NeighbourhoodAutocomplete
                          value={watch('neighbourhood') || ''}
                          city={city || ''}
                          onChange={(neighbourhood, coords) => {
                            setValue('neighbourhood', neighbourhood, { shouldValidate: true });
                            if (coords) { setValue('lat', coords[0]); setValue('lng', coords[1]); }
                          }}
                        />
                        <p className="text-xs text-muted mt-1.5">Helps renters find listings near them — pick the closest match.</p>
                        {errors.neighbourhood && <p className="text-red-500 text-xs mt-1">{errors.neighbourhood.message}</p>}
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
                        <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">Photos (up to 10)</label>
                        <div {...getRootProps()} className={cn(
                          'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all',
                          isDragActive ? 'border-brand-500 bg-brand-50' : 'border-ink/15 hover:border-brand-400 hover:bg-brand-50/30'
                        )}>
                          <input {...getInputProps()} />
                          <Upload size={28} className="mx-auto text-muted mb-3" />
                          <p className="text-sm font-semibold text-ink mb-1">{isDragActive ? 'Drop here' : 'Drag photos here, or click to browse'}</p>
                          <p className="text-xs text-muted">JPEG, PNG, WEBP · Max 10MB each · Up to 10 photos</p>
                        </div>
                      </div>

                      {imagePreviews.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
                          {imagePreviews.map((src, i) => (
                            <div key={i} className="relative aspect-square rounded-xl overflow-hidden group">
                              <img src={src} alt="" className="w-full h-full object-cover" />
                              <button type="button" onClick={() => removeImage(i)}
                                className="absolute inset-0 bg-ink/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <X size={18} className="text-white" />
                              </button>
                              {i === 0 && <span className="absolute bottom-1.5 left-1.5 px-2 py-0.5 rounded-full bg-white/90 text-[10px] font-bold text-brand-700">Cover</span>}
                            </div>
                          ))}
                        </div>
                      )}

                      {imagePreviews.length === 0 && (
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
                    <button type="button" onClick={nextStep} className="btn-brand flex-1 py-3">
                      Continue →
                    </button>
                  ) : (
                    <button type="submit" disabled={loading} className="btn-brand flex-1 py-3 flex items-center justify-center gap-2">
                      {loading ? <><Loader2 size={16} className="animate-spin" /> Posting...</> : 'Post listing'}
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
