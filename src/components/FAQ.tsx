"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";

export const FAQ = () => {
  const faqs = [
    {
      question: "Quelles zones couvrez-vous à Lubumbashi ?",
      answer: "Nous livrons dans toute la ville de Lubumbashi, du centre-ville jusqu'aux communes périphériques (Kampemba, Katuba, Kenya, Ruashi, Kamalondo, Lubumbashi)."
    },
    {
      question: "Combien de temps prend une livraison standard ?",
      answer: "Notre service standard garantit une livraison le jour même (généralement dans les 4 à 6 heures suivant la commande). Pour des besoins plus urgents, notre service Express livre en moins de 2 heures."
    },
    {
      question: "Puis-je payer à la livraison ?",
      answer: "Oui, nous offrons l'option de paiement à la livraison (Cash on Delivery). Vous ou votre destinataire pouvez payer le livreur en espèces ou via Mobile Money."
    },
    {
      question: "Que se passe-t-il si mon colis est endommagé ou perdu ?",
      answer: "Tous les colis transportés par LivrExpress sont couverts par notre assurance de base. En cas de perte ou de dommages avérés lors du transport, nous vous remboursons la valeur déclarée de la marchandise."
    }
  ];

  const [activeIndex, setActiveIndex] = useState<number | null>(0);

  return (
    <section className="py-20">
      <div className="container mx-auto px-4 md:px-6 max-w-3xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            Questions <span className="text-secondary">Fréquentes</span>
          </h2>
          <p className="text-gray-600 dark:text-gray-300">
            Tout ce que vous devez savoir sur nos services.
          </p>
        </div>

        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div 
              key={index} 
              className="border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden bg-white dark:bg-primary/20"
            >
              <button
                className="flex items-center justify-between w-full p-6 text-left"
                onClick={() => setActiveIndex(activeIndex === index ? null : index)}
              >
                <span className="font-semibold text-lg text-primary dark:text-white">{faq.question}</span>
                <ChevronDown 
                  className={`text-secondary transition-transform duration-300 ${activeIndex === index ? "rotate-180" : ""}`} 
                />
              </button>
              <AnimatePresence>
                {activeIndex === index && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                  >
                    <div className="p-6 pt-0 text-gray-600 dark:text-gray-400">
                      {faq.answer}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
