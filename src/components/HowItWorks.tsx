"use client";

import React from "react";
import { motion } from "framer-motion";
import { Smartphone, PackageCheck, Route } from "lucide-react";

export const HowItWorks = () => {
  const steps = [
    {
      icon: <Smartphone size={40} className="text-secondary" />,
      title: "1. Commandez",
      desc: "Contactez-nous via WhatsApp, appel ou via notre application pour décrire votre colis et vos adresses."
    },
    {
      icon: <PackageCheck size={40} className="text-secondary" />,
      title: "2. Enlèvement",
      desc: "Un livreur LivrExpress récupère votre colis en quelques minutes à l'adresse indiquée."
    },
    {
      icon: <Route size={40} className="text-secondary" />,
      title: "3. Livraison",
      desc: "Suivez votre colis jusqu'à sa remise en main propre à votre destinataire. C'est rapide et sûr."
    }
  ];

  return (
    <section className="py-20 bg-primary text-white relative overflow-hidden">
      {/* Decors */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-secondary/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />
      
      <div className="container mx-auto px-4 md:px-6 relative z-10">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Comment ça marche ?
          </h2>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto">
            Trois étapes simples pour expédier votre colis sans tracas.
          </p>
        </div>

        <div className="flex flex-col md:flex-row justify-center items-center gap-12 md:gap-8">
          {steps.map((step, index) => (
            <React.Fragment key={index}>
              <motion.div 
                whileHover={{ scale: 1.05 }}
                className="flex flex-col items-center text-center max-w-xs"
              >
                <div className="w-24 h-24 bg-white/10 backdrop-blur-sm rounded-full flex items-center justify-center mb-6 border border-white/20 shadow-[0_0_30px_rgba(249,115,22,0.2)]">
                  {step.icon}
                </div>
                <h3 className="text-2xl font-bold mb-3">{step.title}</h3>
                <p className="text-gray-300">
                  {step.desc}
                </p>
              </motion.div>
              
              {index < steps.length - 1 && (
                <div className="hidden md:block w-24 border-t-2 border-dashed border-secondary/50" />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
    </section>
  );
};
