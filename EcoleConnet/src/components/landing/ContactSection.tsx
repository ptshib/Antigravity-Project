import React, { useState } from 'react';
import { Phone, MessageSquare, Send, CheckCircle2, AlertCircle } from 'lucide-react';
import { SCHOOL_INFO } from '../../data/mockData';
import { useNotifications } from '../../context/NotificationContext';

export const ContactSection: React.FC = () => {
  const { showToast } = useNotifications();
  const [formData, setFormData] = useState({
    schoolName: '',
    contactName: '',
    phone: '',
    email: '',
    message: ''
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  const whatsappBaseUrl = `https://wa.me/${SCHOOL_INFO.whatsapp.replace(/[^0-9]/g, '')}`;

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!formData.schoolName.trim()) errs.schoolName = 'Le nom de votre établissement est obligatoire.';
    if (!formData.contactName.trim()) errs.contactName = 'Votre nom et fonction sont obligatoires.';
    if (!formData.phone.trim()) errs.phone = 'Votre numéro de téléphone est obligatoire.';
    if (!formData.email.trim() || !formData.email.includes('@')) errs.email = 'Une adresse email valide est obligatoire.';
    if (!formData.message.trim()) errs.message = 'Veuillez préciser votre besoin ou vos questions.';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      showToast('Veuillez corriger les champs en rouge avant de poursuivre.', 'warning');
      return;
    }

    const messageText = `Bonjour PaTShi-Digital, je souhaite une démonstration d'ÉcoleConnect pour mon établissement :\n\n- École: ${formData.schoolName}\n- Demandeur: ${formData.contactName}\n- Téléphone: ${formData.phone}\n- Email: ${formData.email}\n- Message: ${formData.message}`;

    const waLink = `${whatsappBaseUrl}?text=${encodeURIComponent(messageText)}`;
    window.open(waLink, '_blank');

    setSubmitted(true);
    showToast('Votre demande a été préparée et transmise sur WhatsApp !', 'success');
  };

  return (
    <section id="contact" className="py-20 bg-slate-50 border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Banner CTA */}
        <div className="bg-gradient-to-r from-blue-900 via-blue-800 to-amber-600 rounded-3xl p-8 lg:p-12 text-white shadow-2xl mb-16 text-center lg:text-left flex flex-col lg:flex-row items-center justify-between gap-8">
          <div className="space-y-3 max-w-2xl">
            <h3 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Modernisez la communication de votre établissement avec ÉcoleConnect.
            </h3>
            <p className="text-blue-100 text-sm leading-relaxed">
              Planifiez dès aujourd’hui une démonstration sur mesure ou demandez une cotation gratuite pour votre école auprès de nos ingénieurs.
            </p>
          </div>
          <a
            href={whatsappBaseUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-extrabold text-sm shadow-xl transition-all flex items-center gap-3 shrink-0 cursor-pointer"
          >
            <Phone className="w-5 h-5 fill-current" />
            <span>Discuter sur WhatsApp (+420 776 308 018)</span>
          </a>
        </div>

        <div className="grid lg:grid-cols-12 gap-12 items-start">
          {/* Left Column: Contact details (No false address) */}
          <div className="lg:col-span-5 space-y-6">
            <div>
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-blue-600">
                Fournisseur de la Solution
              </h2>
              <h3 className="text-3xl font-extrabold text-slate-900 mt-2">PaTShi-Digital</h3>
              <p className="text-slate-600 text-sm mt-3 leading-relaxed">
                Spécialiste dans le développement de solutions numériques éducatives, mobiles et web sécurisées pour les écoles et institutions.
              </p>
            </div>

            <div className="space-y-4">
              <a
                href={`tel:${SCHOOL_INFO.phone}`}
                className="flex items-center gap-4 p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:border-blue-300 transition-colors block"
              >
                <div className="p-3.5 rounded-xl bg-blue-50 text-blue-600 shrink-0">
                  <Phone className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase">Téléphone Direct</p>
                  <p className="text-base font-extrabold text-slate-900">{SCHOOL_INFO.phone}</p>
                  <p className="text-[11px] text-blue-600 font-medium">Cliquer pour appeler directement</p>
                </div>
              </a>

              <a
                href={whatsappBaseUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 p-5 rounded-2xl bg-emerald-50/90 border border-emerald-200/90 shadow-xs hover:shadow-md transition-all block"
              >
                <div className="p-3.5 rounded-xl bg-emerald-500 text-white shrink-0">
                  <MessageSquare className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-emerald-800 uppercase">WhatsApp (Cliquable)</p>
                  <p className="text-base font-black text-emerald-950">{SCHOOL_INFO.whatsapp}</p>
                  <p className="text-[11px] text-emerald-700 font-semibold">Cliquer pour ouvrir directement WhatsApp</p>
                </div>
              </a>
            </div>
          </div>

          {/* Right Column: Contact Form */}
          <div className="lg:col-span-7 bg-white p-8 rounded-3xl border border-slate-200/80 shadow-lg">
            <h3 className="text-xl font-bold text-slate-900 mb-6">Demande de Démonstration & Information</h3>

            {submitted ? (
              <div className="p-8 text-center bg-emerald-50 rounded-2xl border border-emerald-200 space-y-4">
                <CheckCircle2 className="w-12 h-12 text-emerald-600 mx-auto" />
                <h4 className="font-bold text-slate-900 text-lg">Demande transmise avec succès !</h4>
                <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
                  Votre demande a été préparée et la conversation WhatsApp avec l'équipe de <strong>PaTShi-Digital</strong> s'est ouverte. Un ingénieur vous recontactera très rapidement.
                </p>
                <button
                  onClick={() => { setSubmitted(false); setFormData({ schoolName: '', contactName: '', phone: '', email: '', message: '' }); }}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Envoyer une autre demande
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Nom de votre École *</label>
                    <input
                      type="text"
                      placeholder="Ex: Complexe Scolaire Les Horizons"
                      value={formData.schoolName}
                      onChange={e => {
                        setFormData({ ...formData, schoolName: e.target.value });
                        if (errors.schoolName) setErrors({ ...errors, schoolName: '' });
                      }}
                      className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all ${
                        errors.schoolName ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/40' : 'border-slate-300 hover:border-slate-400 focus:border-blue-600 focus:ring-blue-500/20'
                      }`}
                    />
                    {errors.schoolName && (
                      <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.schoolName}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Votre Nom & Fonction *</label>
                    <input
                      type="text"
                      placeholder="Ex: M. Dieudonné Mukendi (Promoteur)"
                      value={formData.contactName}
                      onChange={e => {
                        setFormData({ ...formData, contactName: e.target.value });
                        if (errors.contactName) setErrors({ ...errors, contactName: '' });
                      }}
                      className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all ${
                        errors.contactName ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/40' : 'border-slate-300 hover:border-slate-400 focus:border-blue-600 focus:ring-blue-500/20'
                      }`}
                    />
                    {errors.contactName && (
                      <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.contactName}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Téléphone / WhatsApp *</label>
                    <input
                      type="tel"
                      placeholder="+243 819 883 084"
                      value={formData.phone}
                      onChange={e => {
                        setFormData({ ...formData, phone: e.target.value });
                        if (errors.phone) setErrors({ ...errors, phone: '' });
                      }}
                      className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all ${
                        errors.phone ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/40' : 'border-slate-300 hover:border-slate-400 focus:border-blue-600 focus:ring-blue-500/20'
                      }`}
                    />
                    {errors.phone && (
                      <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.phone}</span>
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Adresse Email *</label>
                    <input
                      type="email"
                      placeholder="contact@leshorizons.cd"
                      value={formData.email}
                      onChange={e => {
                        setFormData({ ...formData, email: e.target.value });
                        if (errors.email) setErrors({ ...errors, email: '' });
                      }}
                      className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all ${
                        errors.email ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/40' : 'border-slate-300 hover:border-slate-400 focus:border-blue-600 focus:ring-blue-500/20'
                      }`}
                    />
                    {errors.email && (
                      <p className="text-[11px] font-bold text-rose-600 mt-1 flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>{errors.email}</span>
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-extrabold text-slate-800 uppercase tracking-wider mb-1.5">Message ou besoins spécifiques *</label>
                  <textarea
                    rows={4}
                    placeholder="Précisez le nombre d'élèves ou vos attentes..."
                    value={formData.message}
                    onChange={e => {
                      setFormData({ ...formData, message: e.target.value });
                      if (errors.message) setErrors({ ...errors, message: '' });
                    }}
                    className={`w-full px-4 py-3 bg-slate-50 border-2 rounded-xl text-sm font-medium text-slate-900 placeholder:text-slate-500 focus:outline-none focus:ring-4 transition-all ${
                      errors.message ? 'border-rose-500 focus:border-rose-500 focus:ring-rose-500/20 bg-rose-50/40' : 'border-slate-300 hover:border-slate-400 focus:border-blue-600 focus:ring-blue-500/20'
                    }`}
                  />
                  {errors.message && (
                    <p className="text-[11px] font-semibold text-rose-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3 shrink-0" />
                      <span>{errors.message}</span>
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-sm shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>Envoyer & Ouvrir sur WhatsApp (+420 776 308 018)</span>
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
};
