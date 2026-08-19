// Module Administration : Configuration de l'Identité Officielle & Signatures (Phase 2F.3)
// Fichier : src/components/admin/SchoolOfficialIdentityModule.tsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  ShieldCheck,
  Building2,
  FileSignature,
  Stamp,
  Upload,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Image as ImageIcon,
  Save,
  Trash2,
  HelpCircle,
  RotateCw
} from 'lucide-react';

interface SchoolOfficialIdentityProps {
  onUpdated?: () => void;
}

export const SchoolOfficialIdentityModule: React.FC<SchoolOfficialIdentityProps> = ({ onUpdated }) => {
  const { profile, school, refreshProfile } = useRealAuth();
  const { showToast } = useNotifications();

  // Résolution explicite et sécurisée de l'ID d'établissement depuis le profil authentifié
  const resolvedSchoolId = useMemo(() => {
    return profile?.school_id || school?.id || null;
  }, [profile?.school_id, school?.id]);

  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  // Champs du Formulaire
  const [principalName, setPrincipalName] = useState<string>('');
  const [officialRegNumber, setOfficialRegNumber] = useState<string>('');
  const [motto, setMotto] = useState<string>('');
  const [address, setAddress] = useState<string>('');
  const [phone, setPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [directorSignatureUrl, setDirectorSignatureUrl] = useState<string>('');
  const [stampUrl, setStampUrl] = useState<string>('');

  // URLs signées pour l'aperçu sécurisé des images privées
  const [logoSignedUrl, setLogoSignedUrl] = useState<string | null>(null);
  const [directorSignatureSignedUrl, setDirectorSignatureSignedUrl] = useState<string | null>(null);
  const [stampSignedUrl, setStampSignedUrl] = useState<string | null>(null);

  // États de Téléversement
  const [uploadingField, setUploadingField] = useState<'logo' | 'signature' | 'stamp' | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [pendingTarget, setPendingTarget] = useState<'logo' | 'signature' | 'stamp' | null>(null);
  const [showReplaceModal, setShowReplaceModal] = useState<boolean>(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const signatureInputRef = useRef<HTMLInputElement>(null);
  const stampInputRef = useRef<HTMLInputElement>(null);

  // Helper pour générer une URL signée temporaire avec cache-busting
  const getSignedUrlForPath = useCallback(async (storagePath: string | null | undefined): Promise<string | null> => {
    if (!storagePath || !storagePath.trim()) return null;
    const cleanPath = storagePath.trim();
    try {
      if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://') || cleanPath.startsWith('data:')) {
        return cleanPath;
      }
      const { data, error } = await supabase.storage
        .from('school-official-assets')
        .createSignedUrl(cleanPath, 3600); // Validité 1 heure

      if (error || !data?.signedUrl) {
        console.warn('[SchoolOfficialIdentityModule] Échec création URL signée pour:', cleanPath, error);
        return null;
      }
      // Ajouter un horodatage pour forcer le rafraîchissement d'affichage du navigateur
      const signed = data.signedUrl;
      return signed;
    } catch (err) {
      console.warn('[SchoolOfficialIdentityModule] Exception createSignedUrl:', err);
      return null;
    }
  }, []);

  // Détermination de l'extension canonique selon le type MIME réel
  const getCanonicalExtension = (mimeType: string): string => {
    if (mimeType === 'image/png') return 'png';
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
    return 'png';
  };

  // Chargement des données enregistrées depuis public.schools
  const loadSchoolOfficialData = useCallback(async () => {
    if (!resolvedSchoolId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('schools')
        .select('id, name, principal_name, official_registration_number, motto, address, phone, email, logo_url, director_signature_url, stamp_url')
        .eq('id', resolvedSchoolId)
        .single();

      if (error) {
        console.error('[SchoolOfficialIdentityModule] Erreur SELECT schools:', error);
        throw error;
      }

      if (data) {
        setPrincipalName(data.principal_name || '');
        setOfficialRegNumber(data.official_registration_number || '');
        setMotto(data.motto || '');
        setAddress(data.address || '');
        setPhone(data.phone || '');
        setEmail(data.email || '');
        setLogoUrl(data.logo_url || '');
        setDirectorSignatureUrl(data.director_signature_url || '');
        setStampUrl(data.stamp_url || '');

        // Génération des URLs signées pour les chemins enregistrés
        if (data.logo_url) {
          getSignedUrlForPath(data.logo_url).then(url => setLogoSignedUrl(url));
        } else {
          setLogoSignedUrl(null);
        }

        if (data.director_signature_url) {
          getSignedUrlForPath(data.director_signature_url).then(url => setDirectorSignatureSignedUrl(url));
        } else {
          setDirectorSignatureSignedUrl(null);
        }

        if (data.stamp_url) {
          getSignedUrlForPath(data.stamp_url).then(url => setStampSignedUrl(url));
        } else {
          setStampSignedUrl(null);
        }
      }
    } catch (err: any) {
      console.error('[SchoolOfficialIdentityModule] Erreur chargement identité officielle:', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedSchoolId, getSignedUrlForPath]);

  useEffect(() => {
    loadSchoolOfficialData();
  }, [loadSchoolOfficialData]);

  // Handler de sélection de fichier
  const handleFileSelected = (e: React.ChangeEvent<HTMLInputElement>, target: 'logo' | 'signature' | 'stamp') => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Réinitialiser la valeur de l'input
    e.target.value = '';

    // Validation du type MIME
    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showToast(`Format non supporté (${file.type || 'inconnu'}). Veuillez sélectionner une image PNG, JPEG ou WebP.`, 'warning');
      return;
    }

    // Validation de la taille (Max 5 Mo)
    if (file.size > 5 * 1024 * 1024) {
      showToast('Taille excessive : le fichier ne doit pas dépasser 5 Mo.', 'warning');
      return;
    }

    const preview = URL.createObjectURL(file);
    setPendingFile(file);
    setPendingPreviewUrl(preview);
    setPendingTarget(target);

    // Vérifier si un objet existe déjà pour ce champ
    const currentVal = target === 'logo' ? logoUrl : target === 'signature' ? directorSignatureUrl : stampUrl;
    if (currentVal) {
      setShowReplaceModal(true);
    } else {
      executeUpload(file, target, preview);
    }
  };

  // Exécution du téléversement Storage et génération de l'aperçu signé
  const executeUpload = async (file: File, target: 'logo' | 'signature' | 'stamp', localPreview: string) => {
    if (!resolvedSchoolId) {
      showToast('Identifiant d’établissement introuvable. Veuillez recharger la page.', 'warning');
      return;
    }

    setUploadingField(target);

    try {
      const ext = getCanonicalExtension(file.type);
      let canonicalPath = '';
      if (target === 'logo') {
        canonicalPath = `${resolvedSchoolId}/official/logo.${ext}`;
      } else if (target === 'signature') {
        canonicalPath = `${resolvedSchoolId}/official/director-signature.${ext}`;
      } else if (target === 'stamp') {
        canonicalPath = `${resolvedSchoolId}/official/stamp.${ext}`;
      }

      console.info('[SchoolOfficialIdentityModule] Téléversement Storage:', {
        bucket: 'school-official-assets',
        canonicalPath,
        mimeType: file.type,
        size: file.size
      });

      // 1. Upload dans le bucket privé avec upsert
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('school-official-assets')
        .upload(canonicalPath, file, {
          upsert: true,
          contentType: file.type
        });

      if (uploadError) {
        console.error('[SchoolOfficialIdentityModule] Erreur upload Storage:', uploadError);
        throw new Error(`Échec du téléversement (${uploadError.message || 'Erreur Storage'}).`);
      }

      if (!uploadData?.path) {
        console.error('[SchoolOfficialIdentityModule] Réponse upload sans path:', uploadData);
        throw new Error('Téléversement incomplet : chemin de stockage non confirmé par Supabase.');
      }

      console.info('[SchoolOfficialIdentityModule] Upload réussi:', uploadData);

      // 2. Génération immédiate de l'URL signée pour aperçu sécurisé
      const { data: signedData, error: signedError } = await supabase.storage
        .from('school-official-assets')
        .createSignedUrl(canonicalPath, 3600);

      if (signedError || !signedData?.signedUrl) {
        console.warn('[SchoolOfficialIdentityModule] Avertissement signedUrl, utilisation du preview local:', signedError);
      }

      const activePreviewUrl = signedData?.signedUrl || localPreview;

      // 3. Mise à jour atomique des states React
      if (target === 'logo') {
        setLogoUrl(canonicalPath);
        setLogoSignedUrl(activePreviewUrl);
      } else if (target === 'signature') {
        setDirectorSignatureUrl(canonicalPath);
        setDirectorSignatureSignedUrl(activePreviewUrl);
      } else if (target === 'stamp') {
        setStampUrl(canonicalPath);
        setStampSignedUrl(activePreviewUrl);
      }

      const targetLabel = target === 'logo' ? 'Logo' : target === 'signature' ? 'Signature direction' : 'Cachet';
      showToast(`${targetLabel} téléversé avec succès. Cliquez sur "Enregistrer les Paramètres Officiels" pour finaliser.`, 'success');
    } catch (err: any) {
      console.error('[SchoolOfficialIdentityModule] Erreur executeUpload:', err);
      showToast(err.message || 'Échec du téléversement du fichier.', 'warning');
    } finally {
      setUploadingField(null);
      setPendingFile(null);
      setPendingPreviewUrl(null);
      setPendingTarget(null);
      setShowReplaceModal(false);
    }
  };

  // Enregistrement final via la RPC sécurisée update_school_official_identity
  const handleSaveOfficialIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolvedSchoolId) {
      showToast('Identifiant d’établissement introuvable. Veuillez vous reconnecter.', 'warning');
      return;
    }

    if (profile?.is_active !== true || (profile?.role !== 'school_admin' && profile?.role !== 'super_admin')) {
      showToast('Accès non autorisé : seul un administrateur d’établissement actif peut modifier ces paramètres.', 'warning');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        p_principal_name: principalName.trim() || null,
        p_official_registration_number: officialRegNumber.trim() || null,
        p_motto: motto.trim() || null,
        p_address: address.trim() || null,
        p_phone: phone.trim() || null,
        p_email: email.trim() || null,
        p_logo_url: logoUrl || null,
        p_director_signature_url: directorSignatureUrl || null,
        p_stamp_url: stampUrl || null
      };

      console.info('[SchoolOfficialIdentityModule] Appel RPC update_school_official_identity:', payload);

      const { data, error } = await supabase.rpc('update_school_official_identity', payload);

      if (error) {
        console.error('[SchoolOfficialIdentityModule] Erreur Supabase RPC update_school_official_identity:', error);
        throw error;
      }

      if (!data) {
        console.error('[SchoolOfficialIdentityModule] Réponse vide de la RPC update_school_official_identity');
        throw new Error("L'enregistrement a échoué : aucune donnée retournée par le serveur.");
      }

      console.info('[SchoolOfficialIdentityModule] RPC update_school_official_identity réussie:', data);

      // Réhydratation de l'état local depuis la réponse confirmée de la base de données
      setPrincipalName(data.principal_name || '');
      setOfficialRegNumber(data.official_registration_number || '');
      setMotto(data.motto || '');
      setAddress(data.address || '');
      setPhone(data.phone || '');
      setEmail(data.email || '');
      setLogoUrl(data.logo_url || '');
      setDirectorSignatureUrl(data.director_signature_url || '');
      setStampUrl(data.stamp_url || '');

      // Recréation des URLs signées d'aperçu depuis les chemins validés
      if (data.logo_url) {
        getSignedUrlForPath(data.logo_url).then(url => setLogoSignedUrl(url));
      } else {
        setLogoSignedUrl(null);
      }

      if (data.director_signature_url) {
        getSignedUrlForPath(data.director_signature_url).then(url => setDirectorSignatureSignedUrl(url));
      } else {
        setDirectorSignatureSignedUrl(null);
      }

      if (data.stamp_url) {
        getSignedUrlForPath(data.stamp_url).then(url => setStampSignedUrl(url));
      } else {
        setStampSignedUrl(null);
      }

      // Synchronisation du profil global
      if (refreshProfile) {
        await refreshProfile();
      }

      showToast('Identité officielle et signatures enregistrées avec succès.', 'success');
      if (onUpdated) onUpdated();
    } catch (err: any) {
      console.error('[SchoolOfficialIdentityModule] Échec persistance RPC:', err);
      showToast(err.message || 'Erreur lors de l’enregistrement de l’identité officielle.', 'warning');
    } finally {
      setSaving(false);
    }
  };

  // Suppression d'un fichier officiel
  const handleRemoveAsset = (target: 'logo' | 'signature' | 'stamp') => {
    if (target === 'logo') {
      setLogoUrl('');
      setLogoSignedUrl(null);
    } else if (target === 'signature') {
      setDirectorSignatureUrl('');
      setDirectorSignatureSignedUrl(null);
    } else if (target === 'stamp') {
      setStampUrl('');
      setStampSignedUrl(null);
    }
    showToast('Fichier retiré. Cliquez sur "Enregistrer les Paramètres Officiels" pour valider la suppression.', 'info');
  };

  // Calcul strict de la checklist de conformité
  const hasPrincipalName = Boolean(principalName.trim());
  const hasDirectorSignature = Boolean(directorSignatureUrl);
  const hasStamp = Boolean(stampUrl);
  const isPrerequisitesComplete = hasPrincipalName && hasDirectorSignature && hasStamp;

  if (loading) {
    return (
      <div className="p-12 text-center bg-slate-900 rounded-3xl border border-slate-800 space-y-3">
        <div className="w-8 h-8 border-3 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs font-bold text-slate-400">Chargement des paramètres officiels depuis le serveur...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-xl backdrop-blur-xl flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-xl font-black text-white flex items-center gap-2">
              Identité Officielle & Paramètres Institutionnels
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Configurez le nom du chef d'établissement, les signatures numériques et le cachet officiel requis pour la validation légale des bulletins périodiques.
            </p>
          </div>
        </div>

        {/* Prerequisites Status Badge & Refresh Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={loadSchoolOfficialData}
            disabled={loading}
            className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl border border-slate-700 transition-colors cursor-pointer"
            title="Recharger les données depuis le serveur"
          >
            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {isPrerequisitesComplete ? (
            <div className="px-4 py-2 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-2xl flex items-center gap-2 text-xs font-black">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Prêt pour validation de bulletins</span>
            </div>
          ) : (
            <div className="px-4 py-2 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-2xl flex items-center gap-2 text-xs font-black">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Éléments officiels manquants</span>
            </div>
          )}
        </div>
      </div>

      {/* Official Prerequisites Box */}
      <div className={`p-5 rounded-3xl border ${isPrerequisitesComplete ? 'bg-emerald-950/20 border-emerald-800/40' : 'bg-amber-950/20 border-amber-800/40'} space-y-3`}>
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-300 flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <span>Prérequis obligatoires pour la validation des bulletins de classe (Phase 2F.3)</span>
          </h4>
          <span className="text-[11px] font-bold text-slate-400">
            {Number(hasPrincipalName) + Number(hasDirectorSignature) + Number(hasStamp)} / 3 configurés
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className={`p-3 rounded-2xl border flex items-center gap-2.5 ${hasPrincipalName ? 'bg-slate-900/60 border-emerald-500/30 text-emerald-300' : 'bg-slate-900/60 border-slate-800 text-slate-400'}`}>
            {hasPrincipalName ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
            <div>
              <p className="font-bold">Nom Chef d'Établissement</p>
              <p className="text-[10px] text-slate-500">{principalName || 'Non renseigné'}</p>
            </div>
          </div>

          <div className={`p-3 rounded-2xl border flex items-center gap-2.5 ${hasDirectorSignature ? 'bg-slate-900/60 border-emerald-500/30 text-emerald-300' : 'bg-slate-900/60 border-slate-800 text-slate-400'}`}>
            {hasDirectorSignature ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
            <div>
              <p className="font-bold">Signature Direction</p>
              <p className="text-[10px] text-slate-500">{hasDirectorSignature ? 'Enregistrée' : 'Fichier manquant'}</p>
            </div>
          </div>

          <div className={`p-3 rounded-2xl border flex items-center gap-2.5 ${hasStamp ? 'bg-slate-900/60 border-emerald-500/30 text-emerald-300' : 'bg-slate-900/60 border-slate-800 text-slate-400'}`}>
            {hasStamp ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />}
            <div>
              <p className="font-bold">Cachet Officiel Établissement</p>
              <p className="text-[10px] text-slate-500">{hasStamp ? 'Enregistré' : 'Fichier manquant'}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Form */}
      <form onSubmit={handleSaveOfficialIdentity} className="space-y-6">
        {/* Section 1: Données Légales et Coordonnées */}
        <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
          <h3 className="text-sm font-black text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <Building2 className="w-4 h-4 text-amber-400" />
            <span>Informations Légales & En-tête des Documents</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-bold text-slate-300 mb-1">Nom du Chef d'Établissement (Préfet / Recteur / Directeur) *</label>
              <input
                type="text"
                required
                placeholder="Ex: Prof. Albert Mwamba Ilunga"
                value={principalName}
                onChange={e => setPrincipalName(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">Sera imprimé sur les bulletins officiels sous la mention « Le Chef d'Établissement ».</p>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Numéro d'Agrément / Matricule Officiel Ministère</label>
              <input
                type="text"
                placeholder="Ex: MINEPST/AGR-2024-0899"
                value={officialRegNumber}
                onChange={e => setOfficialRegNumber(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
              <p className="text-[10px] text-slate-500 mt-1">Identifiant légal auprès des autorités éducatives nationales.</p>
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Devise de l'Établissement</label>
              <input
                type="text"
                placeholder="Ex: Discipline - Travail - Excellence"
                value={motto}
                onChange={e => setMotto(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Adresse Physique Officielle</label>
              <input
                type="text"
                placeholder="Ex: 12, Avenue de la Paix, Gombe, Kinshasa"
                value={address}
                onChange={e => setAddress(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Numéro de Téléphone Officiel</label>
              <input
                type="tel"
                placeholder="Ex: +243 81 000 0000"
                value={phone}
                onChange={e => setPhone(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-300 mb-1">Adresse E-mail Officielle</label>
              <input
                type="email"
                placeholder="Ex: direction@ecole.cd"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white font-medium focus:outline-none focus:border-amber-500"
              />
            </div>
          </div>
        </div>

        {/* Section 2: Fichiers & Signatures Numériques */}
        <div className="p-6 bg-slate-900 rounded-3xl border border-slate-800 space-y-4">
          <h3 className="text-sm font-black text-white flex items-center gap-2 border-b border-slate-800 pb-3">
            <FileSignature className="w-4 h-4 text-amber-400" />
            <span>Fichiers Numériques Officiels (Stockage Privé & Sécurisé)</span>
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Logo de l'établissement */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                    <span>Logo Officiel</span>
                  </span>
                  {logoUrl ? (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-bold">Actif</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-slate-800 text-slate-400 rounded-full text-[10px]">Non défini</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Affiché en en-tête des bulletins et documents officiels.</p>
              </div>

              {/* Preview Box */}
              <div className="w-full h-32 bg-slate-900 rounded-xl border border-dashed border-slate-700 flex items-center justify-center overflow-hidden p-2">
                {logoSignedUrl ? (
                  <img
                    key={logoSignedUrl}
                    src={logoSignedUrl}
                    alt="Logo École"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-slate-600 text-xs font-bold">Aucun logo</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={logoInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => handleFileSelected(e, 'logo')}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingField === 'logo'}
                  onClick={() => logoInputRef.current?.click()}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-400" />
                  <span>{uploadingField === 'logo' ? 'Téléversement...' : logoUrl ? 'Remplacer' : 'Téléverser'}</span>
                </button>

                {logoUrl && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAsset('logo')}
                    className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl cursor-pointer"
                    title="Retirer le logo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 2. Signature numérique de la Direction */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <FileSignature className="w-3.5 h-3.5 text-amber-400" />
                    <span>Signature Direction *</span>
                  </span>
                  {directorSignatureUrl ? (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-bold">Actif</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full text-[10px] font-bold">Obligatoire</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Signature manuscrite sur fond transparent du chef d'établissement.</p>
              </div>

              {/* Preview Box */}
              <div className="w-full h-32 bg-slate-900 rounded-xl border border-dashed border-slate-700 flex items-center justify-center overflow-hidden p-2">
                {directorSignatureSignedUrl ? (
                  <img
                    key={directorSignatureSignedUrl}
                    src={directorSignatureSignedUrl}
                    alt="Signature Direction"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-slate-600 text-xs font-bold">Aucune signature</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={signatureInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => handleFileSelected(e, 'signature')}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingField === 'signature'}
                  onClick={() => signatureInputRef.current?.click()}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-400" />
                  <span>{uploadingField === 'signature' ? 'Téléversement...' : directorSignatureUrl ? 'Remplacer' : 'Téléverser'}</span>
                </button>

                {directorSignatureUrl && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAsset('signature')}
                    className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl cursor-pointer"
                    title="Retirer la signature"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* 3. Cachet officiel de l'établissement */}
            <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex flex-col justify-between space-y-3">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-extrabold text-white flex items-center gap-1.5">
                    <Stamp className="w-3.5 h-3.5 text-amber-400" />
                    <span>Cachet Officiel *</span>
                  </span>
                  {stampUrl ? (
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded-full text-[10px] font-bold">Actif</span>
                  ) : (
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full text-[10px] font-bold">Obligatoire</span>
                  )}
                </div>
                <p className="text-[11px] text-slate-400">Sceau rond ou rectangulaire numérisé de l'école (fond transparent recommandé).</p>
              </div>

              {/* Preview Box */}
              <div className="w-full h-32 bg-slate-900 rounded-xl border border-dashed border-slate-700 flex items-center justify-center overflow-hidden p-2">
                {stampSignedUrl ? (
                  <img
                    key={stampSignedUrl}
                    src={stampSignedUrl}
                    alt="Cachet École"
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <span className="text-slate-600 text-xs font-bold">Aucun cachet</span>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2">
                <input
                  type="file"
                  ref={stampInputRef}
                  accept="image/png,image/jpeg,image/webp"
                  onChange={e => handleFileSelected(e, 'stamp')}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingField === 'stamp'}
                  onClick={() => stampInputRef.current?.click()}
                  className="flex-1 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Upload className="w-3.5 h-3.5 text-amber-400" />
                  <span>{uploadingField === 'stamp' ? 'Téléversement...' : stampUrl ? 'Remplacer' : 'Téléverser'}</span>
                </button>

                {stampUrl && (
                  <button
                    type="button"
                    onClick={() => handleRemoveAsset('stamp')}
                    className="p-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl cursor-pointer"
                    title="Retirer le cachet"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Save Button Bar */}
        <div className="flex items-center justify-between p-4 bg-slate-900 rounded-3xl border border-slate-800">
          <p className="text-xs text-slate-400">
            Ces informations sont protégées et intégrées de manière infalsifiable dans chaque bulletin validé.
          </p>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-2xl text-xs flex items-center gap-2 cursor-pointer shadow-lg transition-colors disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            <span>{saving ? 'Enregistrement en cours...' : 'Enregistrer les Paramètres Officiels'}</span>
          </button>
        </div>
      </form>

      {/* Confirmation Modal: Remplacement de Fichier */}
      {showReplaceModal && pendingFile && pendingTarget && (
        <Modal
          isOpen={showReplaceModal}
          onClose={() => {
            setShowReplaceModal(false);
            setPendingFile(null);
            setPendingPreviewUrl(null);
            setPendingTarget(null);
          }}
          title="Confirmation de Remplacement"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-amber-200">
                <p className="font-extrabold text-white">
                  Remplacer le fichier existant pour : {pendingTarget === 'logo' ? 'le Logo' : pendingTarget === 'signature' ? 'la Signature Direction' : 'le Cachet Officiel'} ?
                </p>
                <p className="text-slate-300">
                  L'ancien fichier sera écrasé par le nouveau dans le stockage sécurisé. Les révisions de bulletins déjà publiées conserveront leur instantané figé.
                </p>
              </div>
            </div>

            {pendingPreviewUrl && (
              <div className="space-y-1.5">
                <span className="font-bold text-slate-400 block">Aperçu du nouveau fichier :</span>
                <div className="w-full h-32 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center p-2">
                  <img src={pendingPreviewUrl} alt="Nouveau fichier" className="max-h-full max-w-full object-contain" />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowReplaceModal(false);
                  setPendingFile(null);
                  setPendingPreviewUrl(null);
                  setPendingTarget(null);
                }}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => executeUpload(pendingFile, pendingTarget, pendingPreviewUrl || '')}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer"
              >
                Confirmer le Remplacement
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
};
