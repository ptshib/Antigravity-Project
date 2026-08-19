import React from 'react';
import { LandingNavbar } from '../components/landing/LandingNavbar';
import { HeroSection } from '../components/landing/HeroSection';
import { AdvantagesSection } from '../components/landing/AdvantagesSection';
import { ProfilesSection } from '../components/landing/ProfilesSection';
import { HowItWorksSection } from '../components/landing/HowItWorksSection';
import { ContactSection } from '../components/landing/ContactSection';
import { Footer } from '../components/landing/Footer';

interface LandingPageProps {
  onGoToDemo: () => void;
  onGoToLogin: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onGoToDemo, onGoToLogin }) => {
  const scrollToContact = () => {
    const contactElem = document.getElementById('contact');
    if (contactElem) {
      contactElem.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between">
      <LandingNavbar
        onGoToDemo={onGoToDemo}
        onGoToLogin={onGoToLogin}
      />
      <main className="flex-1">
        <HeroSection onGoToDemo={onGoToDemo} onDiscover={scrollToContact} />
        <AdvantagesSection />
        <ProfilesSection />
        <HowItWorksSection />
        <ContactSection />
      </main>
      <Footer />
    </div>
  );
};
