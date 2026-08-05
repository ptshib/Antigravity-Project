"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Clock, ShieldCheck, MapPin, Package } from "lucide-react";
import { Button } from "./ui/Button";

export const Hero = () => {
  return (
    <section id="home" className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
      {/* Background Image & Overlay */}
      <div 
        className="absolute inset-0 -z-20 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: "url('/hero-bg.jpg')" }}
      />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-white/95 via-white/80 to-white/40 dark:from-[#020617]/95 dark:via-[#020617]/80 dark:to-[#020617]/40" />

      {/* Decorative blurs */}
      <div className="absolute top-0 right-0 -z-10 w-[600px] h-[600px] bg-secondary/20 rounded-full blur-3xl opacity-50 translate-x-1/3 -translate-y-1/4" />
      <div className="absolute bottom-0 left-0 -z-10 w-[400px] h-[400px] bg-primary/20 rounded-full blur-3xl opacity-50 -translate-x-1/2 translate-y-1/4" />

      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="flex flex-col lg:flex-row items-center gap-12 lg:gap-8">
          <motion.div 
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6 }}
            className="flex-1 text-center lg:text-left"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 text-secondary text-sm font-semibold mb-6">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-secondary"></span>
              </span>
              #1 de la livraison à Lubumbashi
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold text-primary dark:text-white leading-tight mb-6">
              Vos colis livrés <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-secondary to-orange-400">
                en un éclair
              </span>
            </h1>
            <p className="text-lg md:text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-2xl mx-auto lg:mx-0">
              LivrExpress est votre partenaire de confiance pour des livraisons rapides, sécurisées et professionnelles partout à Lubumbashi et ses environs.
            </p>
            
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center lg:justify-start mb-12">
              <Link href="/demande" className="w-full sm:w-auto">
                <Button size="lg" className="w-full gap-2">
                  Envoyer un colis <ArrowRight size={18} />
                </Button>
              </Link>
              <Link href="/estimation" className="w-full sm:w-auto">
                <Button variant="outline" size="lg" className="w-full">
                  Estimer le tarif
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-3 gap-4 border-t dark:border-gray-800 pt-8">
              <div className="flex flex-col items-center lg:items-start gap-2">
                <Clock className="text-secondary" size={24} />
                <span className="font-semibold text-primary dark:text-white">Express</span>
                <span className="text-xs text-gray-500">- de 2 heures</span>
              </div>
              <div className="flex flex-col items-center lg:items-start gap-2">
                <ShieldCheck className="text-secondary" size={24} />
                <span className="font-semibold text-primary dark:text-white">Sécurisé</span>
                <span className="text-xs text-gray-500">Garantie 100%</span>
              </div>
              <div className="flex flex-col items-center lg:items-start gap-2">
                <MapPin className="text-secondary" size={24} />
                <span className="font-semibold text-primary dark:text-white">Partout</span>
                <span className="text-xs text-gray-500">Dans tout Lubumbashi</span>
              </div>
            </div>
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="flex-1 w-full max-w-lg lg:max-w-none relative flex justify-center lg:justify-end"
          >
            <div className="relative w-full max-w-md">
              {/* App Mockup Image */}
              <img 
                src="/app-mockup.png" 
                alt="Application LivrExpress - Suivi en temps réel" 
                className="w-full h-auto object-contain rounded-2xl drop-shadow-2xl"
              />
            </div>
            
            {/* Decorative elements */}
            <div className="absolute -top-6 right-10 w-32 h-32 bg-secondary/30 rounded-full blur-2xl -z-10" />
            <div className="absolute -bottom-10 left-10 w-40 h-40 bg-primary/30 rounded-full blur-2xl -z-10" />
          </motion.div>
        </div>
      </div>
    </section>
  );
};
