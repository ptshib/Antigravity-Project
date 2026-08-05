import React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";

export default function EstimationPage() {
  return (
    <main className="min-h-screen bg-gray-50 flex flex-col">
      <Navbar />
      <div className="flex-1 container mx-auto px-4 py-32 flex flex-col items-center justify-center">
        <div className="bg-white p-8 rounded-2xl shadow-xl max-w-lg w-full text-center">
          <h1 className="text-3xl font-bold text-primary mb-4">Estimer le tarif</h1>
          <p className="text-gray-600 mb-8">
            Notre calculateur de tarif sera bientôt disponible. En attendant, veuillez vous référer à notre section Tarifs ou nous contacter pour un devis précis.
          </p>
          <Link href="/" className="inline-flex items-center gap-2 text-secondary hover:underline font-medium">
            <ArrowLeft size={16} /> Retour à l'accueil
          </Link>
        </div>
      </div>
      <Footer />
    </main>
  );
}
