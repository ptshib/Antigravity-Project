"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Navigation, User, Phone, Package, DollarSign, X } from "lucide-react";
import { motion } from "framer-motion";

export default function DemandePage() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    // Simulate API call
    setTimeout(() => {
      setIsSubmitting(false);
      alert("Votre demande a été envoyée avec succès !");
      router.push("/");
    }, 1500);
  };

  return (
    <main className="min-h-screen bg-black/40 backdrop-blur-sm flex flex-col items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-2xl bg-[#F5F4EF] rounded-[24px] shadow-2xl relative overflow-hidden"
      >
        {/* Close Button */}
        <Link 
          href="/" 
          className="absolute top-6 right-6 w-8 h-8 bg-black/5 hover:bg-black/10 rounded-full flex items-center justify-center transition-colors"
        >
          <X size={18} className="text-gray-700" />
        </Link>

        <div className="p-8 md:p-10">
          <div className="mb-8">
            <h1 className="text-2xl md:text-3xl font-bold text-gray-900 mb-2">
              Demander une expédition
            </h1>
            <p className="text-gray-500 text-sm md:text-base">
              Remplissez les informations ci-dessous pour une prise en charge immédiate.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Point de collecte */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <MapPin size={14} className="text-[#C55343]" />
                  Point de collecte
                </label>
                <input 
                  type="text" 
                  required
                  placeholder="Ex: Lubumbashi, Centre-ville..." 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

              {/* Point de livraison */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <Navigation size={14} className="text-[#C55343]" />
                  Point de livraison
                </label>
                <input 
                  type="text" 
                  required
                  placeholder="Ex: Kampemba, Bel-Air..." 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

              {/* Nom / Entreprise */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <User size={14} className="text-[#C55343]" />
                  Nom / Entreprise
                </label>
                <input 
                  type="text" 
                  required
                  placeholder="Votre nom" 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

              {/* Téléphone */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <Phone size={14} className="text-[#C55343]" />
                  Téléphone
                </label>
                <input 
                  type="tel" 
                  required
                  placeholder="+243..." 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

              {/* Nature du colis */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <Package size={14} className="text-[#C55343]" />
                  Nature du colis
                </label>
                <input 
                  type="text" 
                  required
                  placeholder="Documents, Électronique..." 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

              {/* Budget estimé */}
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-700">
                  <DollarSign size={14} className="text-[#C55343]" />
                  Budget estimé
                </label>
                <input 
                  type="text" 
                  placeholder="En FC..." 
                  className="w-full h-12 px-4 rounded-xl bg-[#EBE9E4] border border-transparent focus:border-[#C55343] focus:bg-white focus:outline-none focus:ring-1 focus:ring-[#C55343] transition-colors text-gray-800 placeholder-gray-400 font-medium"
                />
              </div>

            </div>

            <button 
              type="submit" 
              disabled={isSubmitting}
              className="w-full h-14 mt-4 bg-[#2A342E] hover:bg-[#1E2621] text-white font-medium rounded-xl transition-colors flex items-center justify-center disabled:opacity-70"
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1, ease: "linear" }}>
                    <Package size={18} />
                  </motion.div>
                  Envoi en cours...
                </span>
              ) : (
                "Confirmer la demande"
              )}
            </button>
          </form>
        </div>
      </motion.div>
    </main>
  );
}
