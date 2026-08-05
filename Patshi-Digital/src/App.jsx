import React, { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import {
  Globe,
  Smartphone,
  Wallet,
  Users,
  Package,
  Store,
  Heart,
  Bot,
  BarChart3,
  ArrowRight,
  CheckCircle2,
  Send,
  X,
  MessageSquare,
  Sparkles,
  ShieldCheck,
  Zap,
  Menu,
  Clock,
  ChevronRight,
  Code2,
  Cpu,
  Layers,
  PhoneCall,
  Mail,
  MapPin,
  ExternalLink
} from 'lucide-react';

gsap.registerPlugin(ScrollTrigger);

// ==========================================
// DATA DEFINITIONS
// ==========================================

const SERVICES_DATA = [
  {
    id: 'web',
    title: 'Création de sites web',
    icon: Globe,
    shortDesc: 'Sites vitrines, e-commerce, portfolios et plateformes institutionnelles haute performance.',
    badge: 'Incontournable',
    details: {
      overview: 'Nous concevons des sites web d\'exception qui captivent votre audience et maximisent votre taux de conversion. Chaque site est pensé sur-mesure, de la ligne de code au design visuel.',
      features: [
        'Sites vitrines & corporate d\'entreprise',
        'Plateformes E-commerce & paiement en ligne',
        'Portfolios & blogs professionnels',
        'Sites institutionnels & événements',
        'Optimisation SEO technique & sémantique',
        'Design 100% responsive & accessible',
        'Formulaires de contact avancés & CRM',
        'Intégration Google Maps & Chat live',
        'Maintenance et hébergement haute sécurité'
      ],
      deliverables: 'Maquette UI/UX, Code source optimisé, Certificat SSL, Documentation administrateur'
    }
  },
  {
    id: 'mobile',
    title: 'Applications web & mobile',
    icon: Smartphone,
    shortDesc: 'Applications natives Android, iOS et PWA fluides, sécurisées et ultra-rapides.',
    badge: 'Multi-plateforme',
    details: {
      overview: 'Transformez vos idées en applications mobiles ultra-performantes. Nous développons pour Android, iOS et le Web avec une expérience utilisateur fluide et une architecture robuste.',
      features: [
        'Applications Android & iOS (Flutter / React Native)',
        'Progressive Web Apps (PWA) installables',
        'Interface utilisateur (UI/UX) ergonomique',
        'Notifications push en temps réel',
        'Mode hors-ligne & synchronisation',
        'Intégration d\'APIs & services tierces',
        'Sécurité renforcée et chiffrement des données',
        'Soumission sur Google Play Store & Apple App Store'
      ],
      deliverables: 'Applications compilées APK/AAB/IPA, APIs REST/GraphQL, Panneau d\'administration web'
    }
  },
  {
    id: 'finance',
    title: 'Gestion financière',
    icon: Wallet,
    shortDesc: 'Suivi des revenus, dépenses, comptabilité simplifiée, devises et prévisions.',
    badge: 'Solution Métier',
    details: {
      overview: 'Prenez le contrôle total de la santé financière de votre organisation grâce à une application métier taillée pour vos flux comptables et budgétaires.',
      features: [
        'Suivi automatisé des recettes et dépenses',
        'Gestion budgétaire & alertes de dépassement',
        'Comptabilité simplifiée et plan comptable',
        'Rapports financiers & bilans en temps réel',
        'Gestion multi-devises (USD, CDF, EUR)',
        'Exportations automatiques en Excel, PDF & CSV',
        'Gestion des droits & rôles multi-utilisateurs',
        'Calcul des taxes et clôtures mensuelles'
      ],
      deliverables: 'Système web/mobile sécurisé, Modules d\'exportation, Formation des équipes comptables'
    }
  },
  {
    id: 'rh',
    title: 'Ressources humaines',
    icon: Users,
    shortDesc: 'Gestion des collaborateurs, paie, congés, présences et dossiers du personnel.',
    badge: 'Solution Métier',
    details: {
      overview: 'Digitalisez la gestion de vos ressources humaines de la phase de recrutement au suivi quotidien des performances et bulletins de paie.',
      features: [
        'Gestion centralisée des dossiers employés',
        'Suivi des congés, absences et présences',
        'Génération automatique de la paie & fiches de paie',
        'Module de recrutement et suivi des candidats',
        'Évaluations de performance et objectifs KPIs',
        'Organigramme interactif d\'entreprise',
        'Coffre-fort documentaire RH sécurisé',
        'Portail en libre-service pour les employés'
      ],
      deliverables: 'Plateforme RH complète, Modèles de documents RH, Session de formation'
    }
  },
  {
    id: 'stocks',
    title: 'Gestion des stocks',
    icon: Package,
    shortDesc: 'Inventaires en temps réel, alertes de rupture, gestion des fournisseurs et codes-barres.',
    badge: 'Solution Métier',
    details: {
      overview: 'Évitez les ruptures de stock et optimisez votre chaîne d\'approvisionnement grâce à un suivi rigoureux des entrées, sorties et réassorts.',
      features: [
        'Suivi des entrées et sorties de marchandises',
        'Inventaire automatique en temps réel',
        'Alertes personnalisées de stock critique',
        'Gestion des fournisseurs et commandes d\'achat',
        'Scan de codes-barres et QR codes via mobile',
        'Gestion multi-entrepôts et emplacements',
        'Valorisation du stock (PUMP, FIFO)',
        'Rapports d\'analyse des rotations de stocks'
      ],
      deliverables: 'Logiciel de gestion, Intégration scanners, Base de données articles'
    }
  },
  {
    id: 'commercial',
    title: 'Gestion commerciale',
    icon: Store,
    shortDesc: 'Devis, facturation, suivi des prospects, historique des ventes et encaissements.',
    badge: 'Solution Métier',
    details: {
      overview: 'Boostez vos ventes et accélérez vos cycles d\'encaissement avec une suite commerciale complète pour gérer prospects, devis et factures.',
      features: [
        'Génération instantanée de devis et factures',
        'Suivi des prospects & pipeline de vente (CRM)',
        'Gestion des clients et historique des échanges',
        'Relances automatiques pour impayés',
        'Paiements en ligne et Mobile Money',
        'Statistiques de vente par agent ou produit',
        'Gestion des remises et remises spéciales',
        'Impression de factures & envoi direct par email/WhatsApp'
      ],
      deliverables: 'Plateforme commerciale, Modèles de factures personnalisés, CRM configuré'
    }
  },
  {
    id: 'community',
    title: 'Applications communautaires',
    icon: Heart,
    shortDesc: 'Plateformes pour ONG, églises, associations, réseaux privés et événements.',
    badge: 'Communauté',
    details: {
      overview: 'Fédérez votre communauté autour d\'un espace numérique engagé. Idéal pour les ONG, fondations, associations et communautés religieuses.',
      features: [
        'Réseau social privé & fil d\'actualités',
        'Gestion des membres et cotisations/dons',
        'Organisation d\'événements & billetterie',
        'Espace de diffusion vidéo/audio en direct',
        'Messagerie interne & groupes de discussion',
        'Gestion des bénévoles et projets sociaux',
        'Notifications & appels à l\'action',
        'Interface d\'administration simplifiée'
      ],
      deliverables: 'Plateforme web et mobile, Espace membres sécurisé, Passerelle de don'
    }
  },
  {
    id: 'ia',
    title: 'Intelligence artificielle',
    icon: Bot,
    shortDesc: 'Chatbots sur-mesure, traitement automatique de documents et assistants virtuels.',
    badge: 'Haute Tech',
    details: {
      overview: 'Intégrez la puissance de l\'IA générative et de l\'apprentissage automatique au cœur de vos opérations pour automatiser les tâches répétitives.',
      features: [
        'Chatbots intelligents entraînés sur vos données',
        'Assistants virtuels de service client 24/7',
        'Extraction et analyse automatique de documents',
        'Génération automatique de synthèses & rapports',
        'Reconnaissance et analyse d\'images',
        'Traduction multilingue intelligente',
        'Moteurs de recommandation personnalisés',
        'Analyse prédictive des tendances et comportements'
      ],
      deliverables: 'Modèles IA configurés, API d\'intégration, Tableau de bord d\'entraînement'
    }
  },
  {
    id: 'bi',
    title: 'Tableaux de bord & BI',
    icon: BarChart3,
    shortDesc: 'Visualisation de données, indicateurs KPIs et rapports décisionnels en temps réel.',
    badge: 'Décisionnel',
    details: {
      overview: 'Transformez vos données brutes en décisions stratégiques grâce à des dashboards interactifs et visuels conçus pour la direction.',
      features: [
        'Dashboards interactifs et sur-mesure',
        'Connexion à vos bases de données & fichiers Excel',
        'Suivi des indicateurs clés de performance (KPIs)',
        'Mise à jour des données en temps réel',
        'Graphiques dynamiques et filtres avancés',
        'Rapports automatiques envoyés par email',
        'Accès sécurisé selon les niveaux hiérarchiques',
        'Version mobile optimisée pour les dirigeants'
      ],
      deliverables: 'Tableaux de bord décisionnels, Connecteurs de données, Guide d\'interprétation'
    }
  }
];

const CLIENT_TYPES = [
  'Entreprises', 'PME', 'Startups', 'Administrations publiques', 
  'ONG', 'Associations', 'Établissements scolaires', 
  'Cabinets de conseil', 'Églises', 'Commerçants', 'Entrepreneurs'
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function App() {
  const [navScrolled, setNavScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [selectedService, setSelectedService] = useState(null);
  const [legalModal, setLegalModal] = useState(null); // 'mentions' | 'privacy' | 'cgv'

  // Contact Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    service: 'web',
    budget: '1000-3000',
    message: ''
  });
  const [formStatus, setFormStatus] = useState({ loading: false, success: false, error: null });

  // Refs for GSAP
  const heroRef = useRef(null);
  const featuresRef = useRef(null);
  const manifestoRef = useRef(null);
  const protocolRef = useRef(null);

  // 1. Scroll listener for floating navbar morphing
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 80) {
        setNavScrolled(true);
      } else {
        setNavScrolled(false);
      }
    };
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // 2. GSAP Animations with ctx cleanup
  useEffect(() => {
    let ctx = gsap.context(() => {
      // Hero Animations
      gsap.fromTo(
        '.hero-animate',
        { y: 50, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 1,
          stagger: 0.12,
          ease: 'power3.out',
          delay: 0.2
        }
      );

      // Features Cards Entrance
      gsap.fromTo(
        '.feature-card-anim',
        { y: 60, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.9,
          stagger: 0.15,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: featuresRef.current,
            start: 'top 80%'
          }
        }
      );

      // Services Grid Entrance
      gsap.fromTo(
        '.service-card-anim',
        { y: 40, opacity: 0 },
        {
          y: 0,
          opacity: 1,
          duration: 0.7,
          stagger: 0.08,
          ease: 'power3.out',
          scrollTrigger: {
            trigger: '#services',
            start: 'top 75%'
          }
        }
      );

      // Manifesto Word Reveal Animation
      const manifestoWords = document.querySelectorAll('.manifesto-word');
      if (manifestoWords.length > 0) {
        gsap.fromTo(
          manifestoWords,
          { opacity: 0.15, y: 10 },
          {
            opacity: 1,
            y: 0,
            duration: 0.6,
            stagger: 0.04,
            ease: 'power2.out',
            scrollTrigger: {
              trigger: manifestoRef.current,
              start: 'top 70%',
              end: 'bottom 40%',
              scrub: 0.5
            }
          }
        );
      }
    });

    return () => ctx.revert();
  }, []);

  // Handle Form Submit
  const handleSubmitForm = (e) => {
    e.preventDefault();
    setFormStatus({ loading: true, success: false, error: null });

    setTimeout(() => {
      setFormStatus({ loading: false, success: true, error: null });
      setFormData({
        name: '',
        email: '',
        phone: '',
        service: 'web',
        budget: '1000-3000',
        message: ''
      });
      setTimeout(() => {
        setFormStatus((prev) => ({ ...prev, success: false }));
      }, 5000);
    }, 1200);
  };

  return (
    <div className="relative min-h-screen bg-[#0A0A14] text-[#F0EFF4] selection:bg-[#7B61FF] selection:text-white font-sora">
      
      {/* ==========================================
          A. NAVBAR — "L'Île Flottante"
      ========================================== */}
      <nav
        className={`fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[92%] max-w-6xl rounded-full px-5 py-3 transition-all duration-500 flex items-center justify-between ${
          navScrolled
            ? 'bg-[#F0EFF4]/85 backdrop-blur-xl text-[#18181B] border border-[#7B61FF]/25 shadow-2xl shadow-[#7B61FF]/10'
            : 'bg-[#0A0A14]/40 backdrop-blur-md text-[#F0EFF4] border border-white/10'
        }`}
      >
        {/* Brand Logo */}
        <a href="#" className="flex items-center gap-3 group">
          <img
            src="/logo.png"
            alt="PaTShi Digital Logo"
            className="w-10 h-10 object-contain rounded-xl group-hover:scale-105 transition-transform drop-shadow-[0_0_12px_rgba(123,97,255,0.4)]"
          />
          <span className="font-bold text-lg tracking-tight">
            PaTShi <span className="text-[#7B61FF]">Digital</span>
          </span>
        </a>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-7 text-sm font-medium">
          <a href="#services" className="hover-lift transition-colors hover:text-[#7B61FF]">Services</a>
          <a href="#methode" className="hover-lift transition-colors hover:text-[#7B61FF]">Méthode</a>
          <a href="#offres" className="hover-lift transition-colors hover:text-[#7B61FF]">Offres</a>
          <a href="#contact" className="hover-lift transition-colors hover:text-[#7B61FF]">Contact</a>
        </div>

        {/* Action CTA & Mobile Toggle */}
        <div className="flex items-center gap-3">
          <a
            href="#contact"
            className="btn-magnetic px-5 py-2 text-xs md:text-sm font-semibold text-white bg-[#7B61FF] shadow-lg shadow-[#7B61FF]/30"
          >
            <span className="bg-slide bg-white/20"></span>
            <span className="btn-content flex items-center gap-1.5">
              Demander un devis <ArrowRight className="w-4 h-4" />
            </span>
          </a>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-full hover:bg-white/10 transition-colors"
            aria-label="Toggle menu"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </nav>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 bg-[#0A0A14]/95 backdrop-blur-2xl flex flex-col justify-center items-center gap-8 text-2xl font-bold md:hidden">
          <button
            onClick={() => setMobileMenuOpen(false)}
            className="absolute top-6 right-6 p-3 rounded-full bg-white/10"
          >
            <X className="w-6 h-6" />
          </button>
          <a href="#services" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#7B61FF]">Services</a>
          <a href="#methode" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#7B61FF]">Méthode</a>
          <a href="#offres" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#7B61FF]">Offres</a>
          <a href="#contact" onClick={() => setMobileMenuOpen(false)} className="hover:text-[#7B61FF]">Contact</a>
          <a
            href="#contact"
            onClick={() => setMobileMenuOpen(false)}
            className="px-8 py-4 rounded-full bg-[#7B61FF] text-white text-lg font-semibold shadow-xl shadow-[#7B61FF]/40 mt-4"
          >
            Demander un devis
          </a>
        </div>
      )}


      {/* ==========================================
          B. HERO — "Le Plan d'Ouverture"
      ========================================== */}
      <section
        ref={heroRef}
        className="relative min-h-screen w-full flex flex-col justify-end pb-16 pt-32 px-6 md:px-16 overflow-hidden bg-cover bg-center"
        style={{
          backgroundImage: `url('https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=2400&q=85')`
        }}
      >
        {/* Dark Heavy Gradients & Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A14] via-[#0A0A14]/75 to-[#0A0A14]/40" />
        <div className="absolute inset-0 bg-radial from-transparent via-[#0A0A14]/50 to-[#0A0A14]" />

        {/* Content Container (Lower-Left Third) */}
        <div className="relative z-10 max-w-4xl space-y-6">
          
          {/* Micro Mono Tagline */}
          <div className="hero-animate inline-flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#F0EFF4]/10 backdrop-blur-md border border-white/10 text-xs md:text-sm font-mono text-[#F0EFF4]/90">
            <span className="w-2 h-2 rounded-full bg-[#7B61FF] animate-pulse"></span>
            Sites web · Applications métier · Intelligence artificielle
          </div>

          {/* Main Title Pattern */}
          <h1 className="hero-animate leading-[1.02] tracking-tight">
            <span className="block text-3xl sm:text-5xl md:text-6xl font-extrabold text-[#F0EFF4]">
              PaTShi Digital, au-delà du
            </span>
            <span className="block font-serif italic text-6xl sm:text-8xl md:text-9xl text-transparent bg-clip-text bg-gradient-to-r from-[#7B61FF] via-[#A895FF] to-[#F0EFF4] pt-2">
              code.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="hero-animate text-lg md:text-2xl text-[#F0EFF4]/80 max-w-2xl font-light leading-relaxed">
            Transformons vos idées en solutions innovantes.
          </p>

          {/* Hero CTAs */}
          <div className="hero-animate flex flex-wrap items-center gap-4 pt-4">
            <a
              href="#contact"
              className="btn-magnetic px-8 py-4 text-sm md:text-base font-semibold text-white bg-[#7B61FF] plasma-glow"
            >
              <span className="bg-slide bg-white/20"></span>
              <span className="btn-content flex items-center gap-2">
                Demander un devis <ArrowRight className="w-5 h-5" />
              </span>
            </a>

            <a
              href="#services"
              className="btn-magnetic px-8 py-4 text-sm md:text-base font-semibold text-[#F0EFF4] bg-white/5 border border-white/15 backdrop-blur-md hover:border-white/30"
            >
              <span className="bg-slide bg-white/10"></span>
              <span className="btn-content">Découvrir nos services</span>
            </a>
          </div>

        </div>

        {/* Ambient Plasma Glow Spot */}
        <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-[#7B61FF]/20 blur-[120px] pointer-events-none" />
      </section>


      {/* ==========================================
          C. FONCTIONNALITÉS — "Artefacts Fonctionnels Interactifs"
      ========================================== */}
      <section ref={featuresRef} className="py-24 px-6 md:px-16 bg-[#0A0A14]">
        <div className="max-w-7xl mx-auto space-y-16">

          {/* Section Header */}
          <div className="space-y-4 max-w-2xl">
            <div className="inline-flex items-center gap-2 text-xs font-mono tracking-widest text-[#7B61FF] uppercase">
              <Zap className="w-4 h-4" /> Notre Philosophie Technique
            </div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#F0EFF4]">
              Des artefacts conçus pour l'impact.
            </h2>
          </div>

          {/* 3 Interactive Software Cards Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* CARTE 1 — Mélangeur Diagnostique */}
            <DiagnosticMixerCard />

            {/* CARTE 2 — Machine à Écrire Télémétrie */}
            <TelemetryTerminalCard />

            {/* CARTE 3 — Planificateur Protocole Curseur */}
            <CursorProtocolCard />

          </div>
        </div>
      </section>


      {/* ==========================================
          C-BIS. SERVICES — "Le Catalogue"
      ========================================== */}
      <section id="services" className="py-28 px-6 md:px-16 bg-[#0A0A14] relative">
        <div className="max-w-7xl mx-auto space-y-16">

          <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-white/10 pb-8">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 text-xs font-mono tracking-widest text-[#7B61FF] uppercase">
                <Layers className="w-4 h-4" /> Le Catalogue de Solutions
              </div>
              <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#F0EFF4]">
                Nos 9 Domaines d'Expertise
              </h2>
            </div>
            <p className="text-[#F0EFF4]/70 max-w-md text-sm md:text-base">
              Chaque module est conçu pour s'intégrer harmonieusement à vos opérations et propulser votre rentabilité.
            </p>
          </div>

          {/* 9 Services 3x3 Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {SERVICES_DATA.map((srv) => {
              const IconComp = srv.icon;
              return (
                <div
                  key={srv.id}
                  onClick={() => setSelectedService(srv)}
                  className="service-card-anim group relative cursor-pointer bg-[#F0EFF4] text-[#18181B] rounded-[2rem] p-8 transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl hover:shadow-[#7B61FF]/20 border border-transparent hover:border-[#7B61FF]/40 flex flex-col justify-between"
                >
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div className="w-14 h-14 rounded-2xl bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center group-hover:bg-[#7B61FF] group-hover:text-white transition-colors duration-300">
                        <IconComp className="w-7 h-7" />
                      </div>
                      <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#18181B]/5 text-[#18181B]/70 group-hover:bg-[#7B61FF]/10 group-hover:text-[#7B61FF]">
                        {srv.badge}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-xl font-bold tracking-tight mb-2 group-hover:text-[#7B61FF] transition-colors">
                        {srv.title}
                      </h3>
                      <p className="text-sm text-[#18181B]/75 leading-relaxed">
                        {srv.shortDesc}
                      </p>
                    </div>
                  </div>

                  <div className="pt-6 mt-6 border-t border-[#18181B]/10 flex items-center justify-between text-xs font-semibold text-[#7B61FF]">
                    <span>Découvrir les détails</span>
                    <ChevronRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </section>


      {/* ==========================================
          D. PHILOSOPHIE — "Le Manifeste"
      ========================================== */}
      <section
        ref={manifestoRef}
        className="relative py-32 px-6 md:px-16 bg-[#0A0A14] overflow-hidden border-y border-white/10"
      >
        {/* Parallax Background Texture */}
        <div
          className="absolute inset-0 opacity-15 bg-cover bg-center pointer-events-none mix-blend-screen"
          style={{
            backgroundImage: `url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=2000&q=80')`
          }}
        />

        <div className="relative z-10 max-w-5xl mx-auto space-y-12 text-center">

          {/* Statement 1 - Neutral / Smaller */}
          <p className="text-base md:text-xl text-[#F0EFF4]/50 max-w-2xl mx-auto leading-relaxed">
            "La plupart des agences se concentrent sur : livrer un site et passer au suivant."
          </p>

          {/* Statement 2 - Massive / Serif Italic with Staggered Word Class */}
          <h2 className="text-3xl sm:text-5xl md:text-7xl leading-tight tracking-tight font-light">
            {`Nous nous concentrons sur : des outils qui simplifient votre gestion, augmentent votre `
              .split(' ')
              .map((word, i) => (
                <span key={i} className="manifesto-word inline-block mr-2">
                  {word}
                </span>
              ))}
            <span className="manifesto-word font-serif italic text-[#7B61FF] plasma-text-glow inline-block mr-2">
              productivité
            </span>
            <span className="manifesto-word inline-block mr-2">et accélèrent votre</span>
            <span className="manifesto-word font-serif italic text-[#7B61FF] plasma-text-glow inline-block">
              croissance.
            </span>
          </h2>

        </div>
      </section>


      {/* ==========================================
          E. PROTOCOLE — "Archive Empilée Sticky"
      ========================================== */}
      <section id="methode" ref={protocolRef} className="py-28 px-6 md:px-16 bg-[#0A0A14]">
        <div className="max-w-6xl mx-auto space-y-16">

          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 text-xs font-mono tracking-widest text-[#7B61FF] uppercase">
              <Code2 className="w-4 h-4" /> Notre Méthodologie
            </div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#F0EFF4]">
              Le Protocole PaTShi en 3 Phases
            </h2>
          </div>

          {/* Stacked Cards Container */}
          <div className="space-y-8">
            
            {/* PHASE 01 */}
            <div className="sticky top-28 bg-[#18181B] text-[#F0EFF4] rounded-[2.5rem] p-8 md:p-14 border border-white/10 shadow-2xl transition-transform duration-500 space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <span className="font-mono text-xs text-[#7B61FF] tracking-widest">PHASE 01</span>
                  <h3 className="text-3xl md:text-5xl font-bold tracking-tight">COMPRENDRE</h3>
                </div>
                
                {/* Visual Animation Widget: Rotating Concentric SVG Circles */}
                <div className="w-24 h-24 rounded-full bg-[#7B61FF]/10 flex items-center justify-center border border-[#7B61FF]/30">
                  <svg className="w-16 h-16 animate-spin-slow text-[#7B61FF]" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="6 6" />
                    <circle cx="50" cy="50" r="28" fill="none" stroke="currentColor" strokeWidth="2" />
                    <circle cx="50" cy="50" r="14" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" />
                  </svg>
                </div>
              </div>

              <p className="text-lg text-[#F0EFF4]/80 leading-relaxed max-w-3xl">
                Analyse approfondie de vos besoins métier, étude de faisabilité technique, élaboration de la proposition de solution et création des maquettes UX/UI interactives.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/10 text-sm font-mono text-[#F0EFF4]/70">
                <div>• Audit & Interview des équipes</div>
                <div>• Spécifications fonctionnelles</div>
                <div>• Prototypes haute fidélité</div>
              </div>
            </div>

            {/* PHASE 02 */}
            <div className="sticky top-36 bg-[#18181B] text-[#F0EFF4] rounded-[2.5rem] p-8 md:p-14 border border-[#7B61FF]/40 shadow-2xl transition-transform duration-500 space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <span className="font-mono text-xs text-[#7B61FF] tracking-widest">PHASE 02</span>
                  <h3 className="text-3xl md:text-5xl font-bold tracking-tight">CONSTRUIRE</h3>
                </div>

                {/* Visual Animation Widget: Laser Grid Matrix */}
                <div className="w-24 h-24 rounded-2xl bg-[#7B61FF]/10 border border-[#7B61FF]/30 p-3 flex flex-col justify-between relative overflow-hidden">
                  <div className="grid grid-cols-4 gap-1.5 opacity-60">
                    {[...Array(16)].map((_, i) => (
                      <div key={i} className="w-2 h-2 rounded-full bg-[#7B61FF]" />
                    ))}
                  </div>
                  <div className="absolute inset-x-0 h-0.5 bg-[#7B61FF] shadow-[0_0_8px_#7B61FF] animate-pulse top-1/2" />
                </div>
              </div>

              <p className="text-lg text-[#F0EFF4]/80 leading-relaxed max-w-3xl">
                Développement informatique rigoureux, intégration des modules d'IA, séries de tests unitaires et de charge, validation client et déploiement sécurisé en production.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-white/10 text-sm font-mono text-[#F0EFF4]/70">
                <div>• Code propre & modulaire</div>
                <div>• Integration IA & APIs</div>
                <div>• Tests & Déploiement CI/CD</div>
              </div>
            </div>

            {/* PHASE 03 */}
            <div className="sticky top-44 bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 md:p-14 border border-white shadow-2xl transition-transform duration-500 space-y-8">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-2">
                  <span className="font-mono text-xs text-[#7B61FF] tracking-widest">PHASE 03</span>
                  <h3 className="text-3xl md:text-5xl font-bold tracking-tight">ACCOMPAGNER</h3>
                </div>

                {/* Visual Animation Widget: ECG Pulsing Line */}
                <div className="w-28 h-20 rounded-2xl bg-[#7B61FF]/10 flex items-center justify-center p-2">
                  <svg className="w-full h-full text-[#7B61FF]" viewBox="0 0 100 40">
                    <path
                      d="M0 20 L25 20 L35 5 L45 35 L55 10 L65 25 L75 20 L100 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      className="animate-pulse"
                    />
                  </svg>
                </div>
              </div>

              <p className="text-lg text-[#18181B]/85 leading-relaxed max-w-3xl">
                Formation personnalisée de vos utilisateurs, assistance technique réactive, maintenance corrective et évolutive, mises à jour régulières et optimisation continue.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-[#18181B]/10 text-sm font-mono text-[#18181B]/70">
                <div>• Transfert de compétences</div>
                <div>• Support technique 7/7</div>
                <div>• Évolutions sur-mesure</div>
              </div>
            </div>

          </div>
        </div>
      </section>


      {/* ==========================================
          F. OFFRES — "Commencer"
      ========================================== */}
      <section id="offres" className="py-28 px-6 md:px-16 bg-[#0A0A14]">
        <div className="max-w-7xl mx-auto space-y-16">

          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 text-xs font-mono tracking-widest text-[#7B61FF] uppercase">
              <Sparkles className="w-4 h-4" /> Tarification Transparent
            </div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#F0EFF4]">
              Des formules adaptées à votre échelle.
            </h2>
            <p className="text-[#F0EFF4]/70 text-sm md:text-base">
              Chaque projet fait l'objet d'une étude personnalisée et d'un devis transparent.
            </p>
          </div>

          {/* Pricing Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-stretch">
            
            {/* TIER 1: Essentiel */}
            <div className="bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 md:p-10 border border-white/20 flex flex-col justify-between hover-lift">
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-mono uppercase tracking-widest text-[#18181B]/60">Offre 01</span>
                  <h3 className="text-2xl font-bold mt-1">Essentiel</h3>
                  <div className="mt-4 text-3xl font-extrabold text-[#7B61FF]">Sur devis</div>
                </div>

                <p className="text-sm text-[#18181B]/75 leading-relaxed">
                  Idéal pour établir une présence digitale professionnelle et captiver vos premiers prospects.
                </p>

                <ul className="space-y-3 text-sm text-[#18181B]/85 pt-4 border-t border-[#18181B]/10">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Site vitrine sur-mesure (1 à 5 pages)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Design 100% responsive & moderne
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Optimisation SEO de base & vitesse
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Formulaire de contact & Google Maps
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Mise en ligne & certificat SSL
                  </li>
                </ul>
              </div>

              <a
                href="#contact"
                className="btn-magnetic w-full py-4 text-sm font-semibold text-[#18181B] bg-white border border-[#18181B]/20 hover:border-[#7B61FF] mt-8"
              >
                <span className="bg-slide bg-[#7B61FF]/10"></span>
                <span className="btn-content">Demander un devis</span>
              </a>
            </div>

            {/* TIER 2: Performance (FEATURED CENTER CARD) */}
            <div className="relative bg-[#0A0A14] text-[#F0EFF4] rounded-[2.5rem] p-8 md:p-10 border-2 border-[#7B61FF] plasma-glow-lg flex flex-col justify-between lg:-translate-y-4">
              <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-[#7B61FF] text-white text-xs font-bold tracking-wider uppercase shadow-md">
                Le plus choisi
              </div>

              <div className="space-y-6">
                <div>
                  <span className="text-xs font-mono uppercase tracking-widest text-[#7B61FF]">Offre 02</span>
                  <h3 className="text-2xl font-bold mt-1">Performance</h3>
                  <div className="mt-4 text-3xl font-extrabold text-[#7B61FF]">Sur devis</div>
                </div>

                <p className="text-sm text-[#F0EFF4]/80 leading-relaxed">
                  Pour les entreprises en croissance souhaitant automatiser leur gestion métier et booster leurs opérations.
                </p>

                <ul className="space-y-3 text-sm text-[#F0EFF4]/90 pt-4 border-t border-white/10">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Tout ce qui est inclus dans Essentiel
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> 1 Application métier au choix (Finance, RH, Stocks, Commercial)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Tableau de bord interactif & statistiques
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Session de formation des équipes
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Maintenance & support garanti 6 mois
                  </li>
                </ul>
              </div>

              <a
                href="#contact"
                className="btn-magnetic w-full py-4 text-sm font-semibold text-white bg-[#7B61FF] plasma-glow mt-8"
              >
                <span className="bg-slide bg-white/20"></span>
                <span className="btn-content">Demander un devis</span>
              </a>
            </div>

            {/* TIER 3: Entreprise */}
            <div className="bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 md:p-10 border border-white/20 flex flex-col justify-between hover-lift">
              <div className="space-y-6">
                <div>
                  <span className="text-xs font-mono uppercase tracking-widest text-[#18181B]/60">Offre 03</span>
                  <h3 className="text-2xl font-bold mt-1">Entreprise</h3>
                  <div className="mt-4 text-3xl font-extrabold text-[#7B61FF]">Sur devis</div>
                </div>

                <p className="text-sm text-[#18181B]/75 leading-relaxed">
                  L'écosystème digital ultime multi-modules avec intégration d'intelligence artificielle sur-mesure.
                </p>

                <ul className="space-y-3 text-sm text-[#18181B]/85 pt-4 border-t border-[#18181B]/10">
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Plateforme complète multi-modules
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Modèle IA sur-mesure (Chatbot/Rapports)
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Business Intelligence & KPIs avancés
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Multi-utilisateurs & droits granulaires
                  </li>
                  <li className="flex items-center gap-2.5">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF]" /> Support prioritaire 24/7 & SLA dédié
                  </li>
                </ul>
              </div>

              <a
                href="#contact"
                className="btn-magnetic w-full py-4 text-sm font-semibold text-[#18181B] bg-white border border-[#18181B]/20 hover:border-[#7B61FF] mt-8"
              >
                <span className="bg-slide bg-[#7B61FF]/10"></span>
                <span className="btn-content">Demander un devis</span>
              </a>
            </div>

          </div>
        </div>
      </section>


      {/* ==========================================
          F-BIS. NOS CLIENTS
      ========================================== */}
      <section className="py-16 bg-[#18181B]/40 border-y border-white/10 overflow-hidden">
        <div className="space-y-6">
          <div className="text-center text-xs font-mono uppercase tracking-widest text-[#7B61FF]">
            Ils nous font confiance & nos secteurs d'intervention
          </div>

          {/* Infinite Marquee Banner */}
          <div className="relative w-full overflow-hidden flex whitespace-nowrap">
            <div className="animate-marquee flex items-center gap-6 text-sm md:text-base font-mono text-[#F0EFF4]/80">
              {CLIENT_TYPES.concat(CLIENT_TYPES).map((client, idx) => (
                <span
                  key={idx}
                  className="px-5 py-2.5 rounded-full bg-white/5 border border-white/10 flex items-center gap-3"
                >
                  <span className="w-2 h-2 rounded-full bg-[#7B61FF]"></span>
                  {client}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>


      {/* ==========================================
          F-TER. CONTACT & DEMANDE DE DEVIS
      ========================================== */}
      <section id="contact" className="py-28 px-6 md:px-16 bg-[#0A0A14] relative">
        <div className="max-w-7xl mx-auto space-y-16">

          <div className="text-center space-y-4 max-w-2xl mx-auto">
            <div className="inline-flex items-center gap-2 text-xs font-mono tracking-widest text-[#7B61FF] uppercase">
              <MessageSquare className="w-4 h-4" /> Démarrer Votre Projet
            </div>
            <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight text-[#F0EFF4]">
              Construisons votre projet ensemble.
            </h2>
            <p className="text-[#F0EFF4]/70 text-sm md:text-base">
              Remplissez le formulaire ci-dessous et notre équipe vous recontactera sous 24 heures.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-start">
            
            {/* Form Column (8 cols) */}
            <div className="lg:col-span-8 bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 md:p-12 border border-white shadow-2xl relative">
              
              {/* Form Success Toast */}
              {formStatus.success && (
                <div className="absolute top-4 right-4 left-4 z-20 bg-[#7B61FF] text-white p-4 rounded-2xl shadow-xl flex items-center justify-between text-sm font-semibold animate-bounce">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-5 h-5" /> Votre demande a bien été envoyée ! Nous vous contacterons très vite.
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmitForm} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Nom */}
                  <div className="space-y-2">
                    <label htmlFor="name" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                      Nom complet *
                    </label>
                    <input
                      id="name"
                      type="text"
                      required
                      placeholder="Ex: Jean Mukendi"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                      Adresse Email *
                    </label>
                    <input
                      id="email"
                      type="email"
                      required
                      placeholder="jean@entreprise.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Téléphone */}
                  <div className="space-y-2">
                    <label htmlFor="phone" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                      Téléphone / WhatsApp *
                    </label>
                    <input
                      id="phone"
                      type="tel"
                      required
                      placeholder="+243 850 663 945"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors"
                    />
                  </div>

                  {/* Type de Projet */}
                  <div className="space-y-2">
                    <label htmlFor="service" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                      Service concerné *
                    </label>
                    <select
                      id="service"
                      value={formData.service}
                      onChange={(e) => setFormData({ ...formData, service: e.target.value })}
                      className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors"
                    >
                      {SERVICES_DATA.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Budget */}
                <div className="space-y-2">
                  <label htmlFor="budget" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                    Budget estimé *
                  </label>
                  <select
                    id="budget"
                    value={formData.budget}
                    onChange={(e) => setFormData({ ...formData, budget: e.target.value })}
                    className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors"
                  >
                    <option value="under1000">Moins de 1 000 $</option>
                    <option value="1000-3000">1 000 $ - 3 000 $</option>
                    <option value="3000-10000">3 000 $ - 10 000 $</option>
                    <option value="10000plus">Plus de 10 000 $</option>
                  </select>
                </div>

                {/* Message */}
                <div className="space-y-2">
                  <label htmlFor="message" className="block text-xs font-bold uppercase tracking-wider text-[#18181B]/70">
                    Description du projet *
                  </label>
                  <textarea
                    id="message"
                    required
                    rows="4"
                    placeholder="Décrivez brièvement vos besoins, objectifs et délais..."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-4 py-3.5 rounded-xl bg-white border border-[#18181B]/15 text-[#18181B] focus:outline-none focus:border-[#7B61FF] transition-colors resize-none"
                  ></textarea>
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={formStatus.loading}
                  className="btn-magnetic w-full py-4 text-base font-bold text-white bg-[#7B61FF] plasma-glow transition-all"
                >
                  <span className="bg-slide bg-white/20"></span>
                  <span className="btn-content flex items-center gap-2">
                    {formStatus.loading ? (
                      'Envoi en cours...'
                    ) : (
                      <>
                        Envoyer la demande <Send className="w-5 h-5" />
                      </>
                    )}
                  </span>
                </button>
              </form>
            </div>

            {/* Sidebar Column (4 cols) */}
            <div className="lg:col-span-4 space-y-8">
              
              <div className="bg-[#18181B] text-[#F0EFF4] rounded-[2.5rem] p-8 border border-white/10 space-y-6">
                <h3 className="text-xl font-bold tracking-tight">Coordonnées Directes</h3>
                
                <div className="space-y-5 text-sm">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center shrink-0">
                      <Mail className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-mono text-[#F0EFF4]/50">Email</div>
                      <a href="mailto:contact@patshi.digital" className="font-semibold hover:text-[#7B61FF]">
                        contact@patshi.digital
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center shrink-0">
                      <PhoneCall className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-mono text-[#F0EFF4]/50">Téléphone Direct</div>
                      <a href="tel:+243850663945" className="font-semibold hover:text-[#7B61FF]">
                        +243 850 663 945
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-mono text-[#F0EFF4]/50">WhatsApp Direct</div>
                      <a href="https://wa.me/420776308018" target="_blank" rel="noreferrer" className="font-semibold hover:text-[#7B61FF]">
                        +420 776 308 018
                      </a>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="text-xs font-mono text-[#F0EFF4]/50">Localisation</div>
                      <div className="font-semibold text-xs leading-relaxed">
                        Rendez-vous sur site ou en visioconférence, selon vos préférences et vos besoins.
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Work Hours Card */}
              <div className="bg-[#7B61FF]/10 border border-[#7B61FF]/30 text-[#F0EFF4] rounded-[2rem] p-6 space-y-3">
                <div className="flex items-center gap-2 font-bold text-sm text-[#7B61FF]">
                  <Clock className="w-4 h-4" /> Disponibilité des équipes
                </div>
                <p className="text-xs text-[#F0EFF4]/80 leading-relaxed">
                  Du Lundi au Samedi : 08h00 — 18h00 (WAT / GMT+1).
                  Support d'urgence 24/7 disponible pour les clients Offre Entreprise.
                </p>
              </div>

            </div>

          </div>
        </div>
      </section>


      {/* ==========================================
          G. PIED DE PAGE — FOOTER
      ========================================== */}
      <footer className="bg-[#0A0A14] border-t border-white/10 rounded-t-[3.5rem] pt-16 pb-12 px-6 md:px-16 text-[#F0EFF4]">
        <div className="max-w-7xl mx-auto space-y-12">

          <div className="grid grid-cols-1 md:grid-cols-4 gap-10">
            {/* Col 1: Brand */}
            <div className="md:col-span-2 space-y-4">
              <div className="flex items-center gap-3">
                <img
                  src="/logo.png"
                  alt="PaTShi Digital Logo"
                  className="w-12 h-12 object-contain rounded-xl drop-shadow-[0_0_12px_rgba(123,97,255,0.4)]"
                />
                <span className="font-bold text-xl tracking-tight">
                  PaTShi <span className="text-[#7B61FF]">Digital</span>
                </span>
              </div>
              <p className="text-sm text-[#F0EFF4]/70 max-w-sm leading-relaxed">
                Agence de solutions digitales sur-mesure. Nous concevons le futur informatique des entreprises et organisations.
              </p>
              <div className="font-serif italic text-lg text-[#7B61FF]">
                "L'innovation au service de votre réussite."
              </div>
            </div>

            {/* Col 2: Navigation Services */}
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-widest text-[#7B61FF]">Services</div>
              <ul className="space-y-2 text-sm text-[#F0EFF4]/70">
                <li><a href="#services" className="hover:text-white transition-colors">Sites web</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Applications mobiles</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Applications métier</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Intelligence artificielle</a></li>
                <li><a href="#services" className="hover:text-white transition-colors">Tableaux de bord BI</a></li>
              </ul>
            </div>

            {/* Col 3: Entreprise & Légal */}
            <div className="space-y-3">
              <div className="text-xs font-mono uppercase tracking-widest text-[#7B61FF]">Informations</div>
              <ul className="space-y-2 text-sm text-[#F0EFF4]/70">
                <li><a href="#methode" className="hover:text-white transition-colors">Notre Méthode</a></li>
                <li><a href="#offres" className="hover:text-white transition-colors">Nos Offres</a></li>
                <li>
                  <button onClick={() => setLegalModal('mentions')} className="hover:text-white transition-colors text-left">
                    Mentions légales
                  </button>
                </li>
                <li>
                  <button onClick={() => setLegalModal('privacy')} className="hover:text-white transition-colors text-left">
                    Politique de confidentialité
                  </button>
                </li>
                <li>
                  <button onClick={() => setLegalModal('cgv')} className="hover:text-white transition-colors text-left">
                    Conditions Générales (CGV)
                  </button>
                </li>
              </ul>
            </div>
          </div>

          {/* System Status Indicator & Copyright Line */}
          <div className="pt-8 border-t border-white/10 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-[#F0EFF4]/60">
            
            <div className="flex items-center gap-2.5 bg-white/5 px-3.5 py-1.5 rounded-full border border-white/10">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              <span className="text-emerald-400">Système Opérationnel</span>
              <span className="text-white/40">|</span>
              <span>Réseau v3.4 Active</span>
            </div>

            <div>
              © 2026 PaTShi Digital. Tous droits réservés.
            </div>
          </div>

        </div>
      </footer>


      {/* ==========================================
          PERSISTENT FLOATING WHATSAPP BUTTON
      ========================================== */}
      <a
        href="https://wa.me/420776308018"
        target="_blank"
        rel="noreferrer"
        className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-2xl shadow-[#25D366]/40 hover:scale-110 transition-transform duration-300"
        title="Discuter sur WhatsApp"
        aria-label="Discuter sur WhatsApp"
      >
        <MessageSquare className="w-7 h-7 fill-current" />
      </a>


      {/* ==========================================
          SERVICE DETAIL MODAL DIALOG
      ========================================== */}
      {selectedService && (
        <div className="fixed inset-0 z-50 bg-[#0A0A14]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] max-w-2xl w-full max-h-[90vh] overflow-y-auto p-8 md:p-10 border border-white shadow-2xl relative space-y-6">
            
            <button
              onClick={() => setSelectedService(null)}
              className="absolute top-6 right-6 p-2.5 rounded-full bg-[#18181B]/5 hover:bg-[#18181B]/10 transition-colors"
            >
              <X className="w-5 h-5 text-[#18181B]" />
            </button>

            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-[#7B61FF] text-white flex items-center justify-center">
                {React.createElement(selectedService.icon, { className: 'w-6 h-6' })}
              </div>
              <div>
                <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-[#7B61FF]/10 text-[#7B61FF]">
                  {selectedService.badge}
                </span>
                <h3 className="text-2xl font-bold tracking-tight">{selectedService.title}</h3>
              </div>
            </div>

            <p className="text-sm text-[#18181B]/80 leading-relaxed font-medium">
              {selectedService.details.overview}
            </p>

            <div className="space-y-3">
              <h4 className="text-xs font-mono uppercase tracking-wider text-[#7B61FF]">Fonctionnalités Clés Included</h4>
              <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-[#18181B]/85">
                {selectedService.details.features.map((feat, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#7B61FF] shrink-0 mt-0.5" />
                    <span>{feat}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#18181B]/10 space-y-1">
              <span className="text-xs font-mono text-[#7B61FF] uppercase font-bold">Livrables fournis :</span>
              <p className="text-xs text-[#18181B]/70">{selectedService.details.deliverables}</p>
            </div>

            <div className="pt-4 flex items-center justify-end gap-4">
              <button
                onClick={() => setSelectedService(null)}
                className="px-5 py-2.5 rounded-full text-sm font-semibold text-[#18181B]/70 hover:text-[#18181B]"
              >
                Fermer
              </button>
              <a
                href="#contact"
                onClick={() => setSelectedService(null)}
                className="btn-magnetic px-6 py-3 text-sm font-semibold text-white bg-[#7B61FF] shadow-lg shadow-[#7B61FF]/30"
              >
                <span className="bg-slide bg-white/20"></span>
                <span className="btn-content">Demander un devis pour ce service</span>
              </a>
            </div>

          </div>
        </div>
      )}


      {/* ==========================================
          LEGAL NOTICES MODALS
      ========================================== */}
      {legalModal && (
        <div className="fixed inset-0 z-50 bg-[#0A0A14]/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] max-w-xl w-full p-8 md:p-10 border border-white shadow-2xl relative space-y-6">
            <button
              onClick={() => setLegalModal(null)}
              className="absolute top-6 right-6 p-2 rounded-full bg-[#18181B]/5 hover:bg-[#18181B]/10"
            >
              <X className="w-5 h-5 text-[#18181B]" />
            </button>

            {legalModal === 'mentions' && (
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Mentions Légales</h3>
                <p className="text-sm text-[#18181B]/80 leading-relaxed">
                  <strong>Éditeur du site :</strong> PaTShi Digital SARL.<br />
                  <strong>Siège social :</strong> Kinshasa, RDC.<br />
                  <strong>Directeur de publication :</strong> Équipe PaTShi Digital.<br />
                  <strong>Hébergement :</strong> Serveurs cloud hautement sécurisés (Vercel Inc. / AWS).
                </p>
              </div>
            )}

            {legalModal === 'privacy' && (
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Politique de Confidentialité</h3>
                <p className="text-sm text-[#18181B]/80 leading-relaxed">
                  PaTShi Digital s'engage à protéger vos données personnelles. Les informations recueillies via notre formulaire de contact sont strictement utilisées pour le traitement de votre demande de devis et ne sont jamais cédées à des tiers.
                </p>
              </div>
            )}

            {legalModal === 'cgv' && (
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Conditions Générales de Vente (CGV)</h3>
                <p className="text-sm text-[#18181B]/80 leading-relaxed">
                  Nos prestations font l'objet d'un cahier des charges préalable et d'un contrat signé. Un acompte est exigé à la commande, le solde étant versé à la livraison et validation définitive du projet.
                </p>
              </div>
            )}

            <button
              onClick={() => setLegalModal(null)}
              className="w-full py-3 rounded-full bg-[#7B61FF] text-white font-semibold text-sm"
            >
              Compris
            </button>
          </div>
        </div>
      )}

    </div>
  );
}


// ====================================================================
// INTERACTIVE SOFTWARE CARDS SUB-COMPONENTS
// ====================================================================

// 1. CARTE 1 — "Mélangeur Diagnostique" (Argument a: Sur mesure, pas sur étagère)
function DiagnosticMixerCard() {
  const [cards, setCards] = useState([
    { id: 1, label: 'Analyse du besoin', step: 'Étape 01', color: 'border-[#7B61FF]' },
    { id: 2, label: 'Maquette sur mesure', step: 'Étape 02', color: 'border-emerald-400' },
    { id: 3, label: 'Code propriétaire', step: 'Étape 03', color: 'border-purple-400' }
  ]);

  // Cycle cards vertically every 3 seconds: unshift(pop())
  useEffect(() => {
    const timer = setInterval(() => {
      setCards((prev) => {
        const newArr = [...prev];
        const last = newArr.pop();
        newArr.unshift(last);
        return newArr;
      });
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="feature-card-anim bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 border border-white/20 shadow-2xl flex flex-col justify-between hover-lift">
      <div className="space-y-6">
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] font-bold">
            Mélangeur Diagnostique
          </span>
          <span className="w-2.5 h-2.5 rounded-full bg-[#7B61FF] animate-pulse"></span>
        </div>

        {/* Stacked Cards Interactive Animation */}
        <div className="relative h-44 flex items-center justify-center overflow-hidden">
          {cards.map((c, index) => {
            // calculate vertical stack offset & scale
            const offsetY = index * 18;
            const scale = 1 - index * 0.05;
            const opacity = 1 - index * 0.25;

            return (
              <div
                key={c.id}
                className={`absolute w-full p-4 rounded-2xl bg-white border-2 ${c.color} shadow-lg transition-all duration-700 ease-[cubic-bezier(0.34,1.56,0.64,1)] flex items-center justify-between`}
                style={{
                  transform: `translateY(${offsetY}px) scale(${scale})`,
                  opacity: opacity,
                  zIndex: 10 - index
                }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] flex items-center justify-center font-mono text-xs font-bold">
                    0{c.id}
                  </div>
                  <span className="font-bold text-sm">{c.label}</span>
                </div>
                <span className="text-xs font-mono text-[#18181B]/50">{c.step}</span>
              </div>
            );
          })}
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-extrabold tracking-tight">Sur mesure, pas sur étagère.</h3>
          <p className="text-xs md:text-sm text-[#18181B]/75 leading-relaxed">
            Solutions 100 % personnalisées, jamais de template générique. Tout est codé spécifiquement pour vos processus métier uniques.
          </p>
        </div>

      </div>

      <div className="pt-6 mt-6 border-t border-[#18181B]/10 flex items-center justify-between text-xs font-mono text-[#7B61FF]">
        <span>Méthodologie Pro</span>
        <span>100% Unique</span>
      </div>
    </div>
  );
}


// 2. CARTE 2 — "Machine à Écrire Télémétrie" (Argument b: Web, Android, iOS + IA)
function TelemetryTerminalCard() {
  const terminalLines = [
    '> build web ... OK',
    '> deploy android ... OK',
    '> deploy ios ... OK',
    '> ai_module: chatbot activé',
    '> analyse prédictive: prête'
  ];

  const [currentLineIndex, setCurrentLineIndex] = useState(0);
  const [displayText, setDisplayText] = useState('');
  const [charIndex, setCharIndex] = useState(0);

  useEffect(() => {
    const fullLine = terminalLines[currentLineIndex];

    if (charIndex < fullLine.length) {
      const typingTimer = setTimeout(() => {
        setDisplayText((prev) => prev + fullLine[charIndex]);
        setCharIndex((prev) => prev + 1);
      }, 40);
      return () => clearTimeout(typingTimer);
    } else {
      const nextLineTimer = setTimeout(() => {
        setDisplayText('');
        setCharIndex(0);
        setCurrentLineIndex((prev) => (prev + 1) % terminalLines.length);
      }, 1800);
      return () => clearTimeout(nextLineTimer);
    }
  }, [charIndex, currentLineIndex]);

  return (
    <div className="feature-card-anim bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 border border-white/20 shadow-2xl flex flex-col justify-between hover-lift">
      <div className="space-y-6">
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] font-bold flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Flux en Direct
          </span>
          <span className="text-xs font-mono text-[#18181B]/60">v3.4-stream</span>
        </div>

        {/* Terminal Screen Box */}
        <div className="bg-[#0A0A14] text-emerald-400 font-mono text-xs p-4 rounded-2xl h-44 overflow-hidden border border-[#7B61FF]/30 flex flex-col justify-between shadow-inner">
          <div className="space-y-2">
            <div className="text-white/40 text-[10px] pb-1 border-b border-white/10 flex items-center justify-between">
              <span>SYSTEM LOGS // IA KERNEL</span>
              <span>ONLINE</span>
            </div>
            
            <div className="space-y-1 pt-1">
              <div className="text-white/50 text-[11px]">&gt; initialisation du pipeline multi-plateforme...</div>
              <div className="text-[#7B61FF] text-[11px]">&gt; modèles IA chargés avec succès</div>
              <div className="text-emerald-400 font-bold text-sm pt-1">
                {displayText}
                <span className="inline-block w-2 h-4 bg-[#7B61FF] ml-1 animate-pulse align-middle" />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[10px] text-white/40 pt-2 border-t border-white/10">
            <span>WEB · ANDROID · IOS</span>
            <span className="text-[#7B61FF]">IA ACTIVÉE</span>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-extrabold tracking-tight">Web, Android, iOS — augmentés par l'IA.</h3>
          <p className="text-xs md:text-sm text-[#18181B]/75 leading-relaxed">
            Applications multi-plateformes fluides enrichies de fonctionnalités d'intelligence artificielle modernes.
          </p>
        </div>

      </div>

      <div className="pt-6 mt-6 border-t border-[#18181B]/10 flex items-center justify-between text-xs font-mono text-[#7B61FF]">
        <span>Cross-Platform</span>
        <span>AI Ready</span>
      </div>
    </div>
  );
}


// 3. CARTE 3 — "Planificateur Protocole Curseur" (Argument c: Accompagnement de A à Z)
function CursorProtocolCard() {
  const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
  const [activeDay, setActiveDay] = useState(2); // Wednesday initial
  const [isSaved, setIsSaved] = useState(false);
  const [cursorPos, setCursorPos] = useState({ x: 40, y: 35, clicking: false });

  // Animated cursor loop moving across days and clicking save
  useEffect(() => {
    const sequence = [
      { day: 0, x: 25, y: 35 },
      { day: 2, x: 50, y: 35 },
      { day: 4, x: 75, y: 35 },
      { day: 'save', x: 80, y: 85 }
    ];

    let step = 0;
    const timer = setInterval(() => {
      const current = sequence[step];
      if (current.day !== 'save') {
        setActiveDay(current.day);
        setIsSaved(false);
        setCursorPos({ x: current.x, y: current.y, clicking: true });
      } else {
        setIsSaved(true);
        setCursorPos({ x: current.x, y: current.y, clicking: true });
      }

      step = (step + 1) % sequence.length;
    }, 2000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="feature-card-anim bg-[#F0EFF4] text-[#18181B] rounded-[2.5rem] p-8 border border-white/20 shadow-2xl flex flex-col justify-between hover-lift">
      <div className="space-y-6">
        
        <div className="flex items-center justify-between">
          <span className="text-xs font-mono px-3 py-1 rounded-full bg-[#7B61FF]/10 text-[#7B61FF] font-bold">
            Planificateur Protocole
          </span>
          <span className="text-xs font-mono text-[#18181B]/60">Suivi 7/7</span>
        </div>

        {/* Interactive SVG Grid Container */}
        <div className="relative bg-white rounded-2xl p-4 border border-[#18181B]/10 h-44 flex flex-col justify-between overflow-hidden shadow-sm">
          
          <div className="space-y-2">
            <div className="text-xs font-bold text-[#18181B]/70 flex items-center justify-between">
              <span>PLANNING D'ACCOMPAGNEMENT</span>
              <span className="text-[#7B61FF] font-mono text-[11px]">PHASE ACTIVE</span>
            </div>

            {/* Weekly Days Row */}
            <div className="grid grid-cols-7 gap-1 pt-2">
              {days.map((d, i) => (
                <div
                  key={i}
                  className={`h-10 rounded-xl flex items-center justify-center font-bold text-xs transition-colors ${
                    activeDay === i
                      ? 'bg-[#7B61FF] text-white shadow-md shadow-[#7B61FF]/40'
                      : 'bg-[#18181B]/5 text-[#18181B]/70'
                  }`}
                >
                  {d}
                </div>
              ))}
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="flex items-center justify-between pt-2 border-t border-[#18181B]/10">
            <div className="flex items-center gap-2 text-xs font-mono text-[#18181B]/70">
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span>Formation & Maintenance</span>
            </div>

            <div
              className={`px-3 py-1 rounded-lg text-xs font-bold font-mono transition-all ${
                isSaved ? 'bg-emerald-500 text-white shadow-sm' : 'bg-[#7B61FF]/20 text-[#7B61FF]'
              }`}
            >
              {isSaved ? 'Sauvegardé !' : 'Sauvegarder'}
            </div>
          </div>

          {/* Animated SVG Cursor */}
          <div
            className="absolute z-20 pointer-events-none transition-all duration-700 ease-out"
            style={{
              left: `${cursorPos.x}%`,
              top: `${cursorPos.y}%`,
              transform: cursorPos.clicking ? 'scale(0.9)' : 'scale(1)'
            }}
          >
            <svg className="w-6 h-6 text-[#7B61FF] drop-shadow-md" viewBox="0 0 24 24" fill="currentColor">
              <path d="M3 3l7 18 3-7 7-3L3 3z" />
            </svg>
          </div>

        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-extrabold tracking-tight">Accompagnement de A à Z.</h3>
          <p className="text-xs md:text-sm text-[#18181B]/75 leading-relaxed">
            De la conception initiale jusqu'à la formation de vos équipes et la maintenance corrective et évolutive.
          </p>
        </div>

      </div>

      <div className="pt-6 mt-6 border-t border-[#18181B]/10 flex items-center justify-between text-xs font-mono text-[#7B61FF]">
        <span>Formation</span>
        <span>Maintenance 360</span>
      </div>
    </div>
  );
}
