// Composant Enseignant : Gestion de la Signature Numérique Officielle (Phase 2F.3)
// Fichier : src/components/teacher/TeacherOfficialSignatureCard.tsx

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { useRealAuth } from '../../contexts/RealAuthContext';
import { useNotifications } from '../../context/NotificationContext';
import { Modal } from '../common/Modal';
import {
  FileSignature,
  Upload,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  RotateCw,
  Link as LinkIcon
} from 'lucide-react';

interface TeacherOfficialSignatureProps {
  teacherRecord: any;
  onSignatureUpdated?: (url: string | null) => void;
}

export const TeacherOfficialSignatureCard: React.FC<TeacherOfficialSignatureProps> = ({
  teacherRecord,
  onSignatureUpdated
}) => {
  const { user, profile, school } = useRealAuth();
  const { showToast } = useNotifications();

  // Résolution de l'ID école et de l'utilisateur
  const resolvedSchoolId = useMemo(() => {
    return profile?.school_id || school?.id || teacherRecord?.school_id || null;
  }, [profile?.school_id, school?.id, teacherRecord?.school_id]);

  const [signatureUrl, setSignatureUrl] = useState<string | null>(teacherRecord?.signature_url || null);
  const [signatureSignedUrl, setSignatureSignedUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);
  const [detectedStorageFile, setDetectedStorageFile] = useState<string | null>(null);

  // Replacement Confirmation State
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chemin canonique unique : {school_id}/signatures/teachers/{auth.uid()}.png
  const canonicalPath = useMemo(() => {
    if (!resolvedSchoolId || !user?.id) return null;
    return `${resolvedSchoolId}/signatures/teachers/${user.id}.png`;
  }, [resolvedSchoolId, user?.id]);

  // Helper pour charger une URL signée temporaire depuis le bucket privé
  const loadSignedPreview = useCallback(async (path: string | null) => {
    if (!path || !path.trim()) {
      setSignatureSignedUrl(null);
      return;
    }
    const cleanPath = path.trim();
    try {
      if (cleanPath.startsWith('http://') || cleanPath.startsWith('https://') || cleanPath.startsWith('data:')) {
        setSignatureSignedUrl(cleanPath);
        return;
      }
      const { data, error } = await supabase.storage
        .from('school-official-assets')
        .createSignedUrl(cleanPath, 3600); // 1 heure

      if (error || !data?.signedUrl) {
        console.warn('[TeacherOfficialSignatureCard] Échec URL signée pour:', cleanPath, error);
        setSignatureSignedUrl(null);
        return;
      }
      setSignatureSignedUrl(data.signedUrl);
    } catch (err) {
      console.warn('[TeacherOfficialSignatureCard] Exception URL signée:', err);
      setSignatureSignedUrl(null);
    }
  }, []);

  // Détecter si un fichier existe déjà dans Storage au chemin canonique
  const checkExistingStorageSignature = useCallback(async () => {
    if (!canonicalPath) return;
    try {
      const { data, error } = await supabase.storage
        .from('school-official-assets')
        .createSignedUrl(canonicalPath, 60);

      if (!error && data?.signedUrl) {
        setDetectedStorageFile(canonicalPath);
      } else {
        setDetectedStorageFile(null);
      }
    } catch {
      setDetectedStorageFile(null);
    }
  }, [canonicalPath]);

  // Chargement initial et synchronisation avec les données en base
  const refreshSignatureFromDb = useCallback(async () => {
    if (!user?.id || !resolvedSchoolId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('teachers')
        .select('id, signature_url, account_status, employment_status')
        .eq('profile_id', user.id)
        .eq('school_id', resolvedSchoolId)
        .single();

      if (error) {
        console.error('[TeacherOfficialSignatureCard] Erreur SELECT teachers:', error);
        return;
      }

      if (data) {
        setSignatureUrl(data.signature_url);
        if (data.signature_url) {
          await loadSignedPreview(data.signature_url);
          setDetectedStorageFile(null);
        } else {
          setSignatureSignedUrl(null);
          await checkExistingStorageSignature();
        }
      }
    } catch (err) {
      console.error('[TeacherOfficialSignatureCard] Exception refreshSignatureFromDb:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.id, resolvedSchoolId, loadSignedPreview, checkExistingStorageSignature]);

  useEffect(() => {
    if (teacherRecord?.signature_url) {
      setSignatureUrl(teacherRecord.signature_url);
      loadSignedPreview(teacherRecord.signature_url);
    } else {
      refreshSignatureFromDb();
    }
  }, [teacherRecord?.signature_url, loadSignedPreview, refreshSignatureFromDb]);

  // Sélection d'un fichier PNG
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    e.target.value = '';

    // Validation stricte PNG
    if (file.type !== 'image/png') {
      showToast('Format strict : La signature doit impérativement être une image PNG (fond transparent recommandé).', 'warning');
      return;
    }

    // Validation taille (Max 5 Mo)
    if (file.size > 5 * 1024 * 1024) {
      showToast('Taille excessive : le fichier ne doit pas dépasser 5 Mo.', 'warning');
      return;
    }

    const preview = URL.createObjectURL(file);
    setPendingFile(file);
    setPendingPreviewUrl(preview);

    if (signatureUrl) {
      setShowConfirmModal(true);
    } else {
      executeSignatureUpload(file, preview);
    }
  };

  // Téléversement dans Storage et enregistrement via la RPC update_my_teacher_signature
  const executeSignatureUpload = async (file: File, localPreviewUrl: string) => {
    if (!user?.id || !resolvedSchoolId || !canonicalPath) {
      showToast('Session enseignant incomplète ou non authentifiée.', 'warning');
      return;
    }

    if (profile?.is_active !== true || profile?.role !== 'teacher') {
      showToast('Compte enseignant non autorisé ou inactif.', 'warning');
      return;
    }

    setUploading(true);
    try {
      console.info('[TeacherOfficialSignatureCard] Téléversement Storage:', {
        bucket: 'school-official-assets',
        canonicalPath,
        mimeType: file.type,
        size: file.size
      });

      // 1. Téléversement dans le bucket privé avec upsert
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('school-official-assets')
        .upload(canonicalPath, file, {
          upsert: true,
          contentType: 'image/png'
        });

      if (uploadError) {
        console.error('[TeacherOfficialSignatureCard] Erreur Storage upload:', uploadError);
        throw new Error(`Échec du téléversement Storage : ${uploadError.message || 'Erreur inconnue'}`);
      }

      if (!uploadData?.path) {
        console.error('[TeacherOfficialSignatureCard] Réponse upload sans path:', uploadData);
        throw new Error('Téléversement incomplet : chemin non confirmé par Storage.');
      }

      console.info('[TeacherOfficialSignatureCard] Upload réussi:', uploadData);

      // 2. Génération immédiate de l'URL signée
      const { data: signedData, error: signedError } = await supabase.storage
        .from('school-official-assets')
        .createSignedUrl(canonicalPath, 3600);

      const activePreview = signedData?.signedUrl || localPreviewUrl;
      if (signedError) {
        console.warn('[TeacherOfficialSignatureCard] Avertissement signedUrl, utilisation du preview local:', signedError);
      }

      // 3. Appel de la RPC sécurisée update_my_teacher_signature
      console.info('[TeacherOfficialSignatureCard] Appel RPC update_my_teacher_signature:', { p_signature_path: canonicalPath });
      const { data: rpcData, error: rpcError } = await supabase.rpc('update_my_teacher_signature', {
        p_signature_path: canonicalPath
      });

      if (rpcError) {
        console.error('[TeacherOfficialSignatureCard] Erreur RPC update_my_teacher_signature:', rpcError);
        throw new Error(`Échec de l'enregistrement de la signature : ${rpcError.message || 'Erreur serveur'}`);
      }

      if (!rpcData) {
        console.error('[TeacherOfficialSignatureCard] Réponse vide de la RPC');
        throw new Error("L'enregistrement a échoué : aucune confirmation reçue de la base de données.");
      }

      console.info('[TeacherOfficialSignatureCard] RPC réussie:', rpcData);

      // 4. Mise à jour de l'état local et notification du parent
      setSignatureUrl(canonicalPath);
      setSignatureSignedUrl(activePreview);
      setDetectedStorageFile(null);
      if (onSignatureUpdated) onSignatureUpdated(canonicalPath);

      showToast('Votre signature officielle a été enregistrée et validée avec succès.', 'success');
    } catch (err: any) {
      console.error('[TeacherOfficialSignatureCard] Erreur:', err);
      showToast(err.message || 'Erreur lors de l’enregistrement de la signature.', 'warning');
    } finally {
      setUploading(false);
      setPendingFile(null);
      setPendingPreviewUrl(null);
      setShowConfirmModal(false);
    }
  };

  // Rattachement d'un fichier déjà présent dans Storage via la RPC
  const handleAttachExistingStorageSignature = async () => {
    if (!canonicalPath) return;
    setUploading(true);
    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('update_my_teacher_signature', {
        p_signature_path: canonicalPath
      });

      if (rpcError) throw rpcError;
      if (!rpcData) throw new Error("Échec du rattachement de la signature.");

      setSignatureUrl(canonicalPath);
      await loadSignedPreview(canonicalPath);
      setDetectedStorageFile(null);
      if (onSignatureUpdated) onSignatureUpdated(canonicalPath);

      showToast('Signature existante rattachée à votre dossier enseignant avec succès.', 'success');
    } catch (err: any) {
      console.error('[TeacherOfficialSignatureCard] Erreur rattachement:', err);
      showToast(err.message || 'Impossible de rattacher la signature.', 'warning');
    } finally {
      setUploading(false);
    }
  };

  // Action Buttons
  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <FileSignature className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-base font-black text-white flex items-center gap-2">
              Signature Numérique Officielle
            </h3>
            <p className="text-xs text-slate-400">
              Requise pour la validation et l'apposition légale sur les bulletins périodiques (Titulaire de classe).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={refreshSignatureFromDb}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition-colors cursor-pointer"
            title="Rafraîchir l'état de la signature"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {signatureUrl ? (
            <div className="px-3 py-1.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 rounded-xl flex items-center gap-1.5 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span>Signature Active</span>
            </div>
          ) : (
            <div className="px-3 py-1.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded-xl flex items-center gap-1.5 text-xs font-bold">
              <AlertTriangle className="w-4 h-4 text-amber-400" />
              <span>Non enregistrée</span>
            </div>
          )}
        </div>
      </div>

      {/* Information Banner if Existing File Detected in Storage */}
      {detectedStorageFile && !signatureUrl && (
        <div className="p-4 bg-amber-950/20 border border-amber-800/40 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <LinkIcon className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <p className="font-bold text-white">Un fichier de signature a été détecté dans votre espace sécurisé.</p>
              <p className="text-slate-400 text-[11px]">Vous pouvez le rattacher directement sans avoir à téléverser à nouveau l'image.</p>
            </div>
          </div>
          <button
            type="button"
            disabled={uploading}
            onClick={handleAttachExistingStorageSignature}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl text-xs flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Rattacher ce fichier</span>
          </button>
        </div>
      )}

      {/* Visual Content Box */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
        {/* Preview Zone */}
        <div className="space-y-2">
          <span className="text-xs font-bold text-slate-400 block">Aperçu officiel de votre signature :</span>
          <div className="w-full h-40 bg-slate-950 rounded-2xl border border-dashed border-slate-800 flex items-center justify-center overflow-hidden p-4 relative group">
            {signatureSignedUrl ? (
              <img
                key={signatureSignedUrl}
                src={signatureSignedUrl}
                alt="Signature Enseignant"
                className="max-h-full max-w-full object-contain filter contrast-125"
              />
            ) : (
              <div className="text-center space-y-1">
                <FileSignature className="w-8 h-8 text-slate-700 mx-auto" />
                <p className="text-slate-600 text-xs font-bold">Aucune signature enregistrée</p>
                <p className="text-slate-700 text-[10px]">Format requis : PNG avec fond transparent</p>
              </div>
            )}
          </div>
        </div>

        {/* Instructions & Guidelines */}
        <div className="space-y-4 text-xs">
          <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
            <h4 className="font-extrabold text-white flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-amber-400" />
              <span>Consignes relatives à la signature légale</span>
            </h4>
            <ul className="list-disc list-inside space-y-1 text-slate-400 text-[11px]">
              <li>Numérisez ou photographiez nettement votre signature manuscrite.</li>
              <li>Détourez le fond (fond transparent obligatoire au format <strong className="text-white">.PNG</strong>).</li>
              <li>Taille maximale autorisée : <strong className="text-white">5 Mo</strong>.</li>
              <li>Cette signature sera apposée sur les bulletins des classes dont vous êtes titulaire.</li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/png"
              onChange={handleFileChange}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading || loading}
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-2xl text-xs flex items-center justify-center gap-2 cursor-pointer shadow-lg transition-colors disabled:opacity-50"
            >
              <Upload className="w-4 h-4" />
              <span>{uploading ? 'Enregistrement en cours...' : signatureUrl ? 'Remplacer la signature' : 'Téléverser ma signature (PNG)'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal when replacing signature */}
      {showConfirmModal && pendingFile && (
        <Modal
          isOpen={showConfirmModal}
          onClose={() => {
            setShowConfirmModal(false);
            setPendingFile(null);
            setPendingPreviewUrl(null);
          }}
          title="Remplacement de votre Signature Officielle"
          darkMode={true}
        >
          <div className="space-y-4 text-xs">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-1 text-amber-200">
                <p className="font-extrabold text-white">
                  Êtes-vous sûr de vouloir remplacer votre signature actuelle ?
                </p>
                <p className="text-slate-300">
                  La nouvelle signature sera immédiatement appliquée pour vos futures soumissions de bulletins de classe.
                </p>
              </div>
            </div>

            {pendingPreviewUrl && (
              <div className="space-y-1.5">
                <span className="font-bold text-slate-400 block">Aperçu du nouveau fichier :</span>
                <div className="w-full h-32 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-center p-2">
                  <img src={pendingPreviewUrl} alt="Nouvelle signature" className="max-h-full max-w-full object-contain filter contrast-125" />
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={() => {
                  setShowConfirmModal(false);
                  setPendingFile(null);
                  setPendingPreviewUrl(null);
                }}
                className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white rounded-xl font-bold cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => executeSignatureUpload(pendingFile, pendingPreviewUrl || '')}
                className="px-5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 font-black rounded-xl cursor-pointer disabled:opacity-50"
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
